#include <Arduino.h>
#include "p1_embed_firmware.h"

static size_t p1ReusableBufferClamp(size_t value, size_t low, size_t high) {
  if (high > 0 && value > high) return high;
  if (value < low) return low;
  return value;
}

static void p1ReusableBufferObserve(P1ReusableBuffer& buffer, size_t needed) {
  buffer.lastNeed = needed;
  if (needed > buffer.peakNeed) buffer.peakNeed = needed;
  if (buffer.emaNeed == 0) {
    buffer.emaNeed = needed;
  } else {
    buffer.emaNeed = ((buffer.emaNeed * 7) + needed + 7) / 8;
  }
  buffer.lastUseMs = millis();
}

bool p1ReusableBufferAcquire(P1ReusableBuffer& buffer, size_t needed, size_t retainMin, size_t retainMax, P1ReusableBufferHandle& handle) {
  handle.data = nullptr;
  handle.capacity = 0;
  handle.temporary = false;
  if (needed == 0) {
    buffer.failCount++;
    return false;
  }

  p1ReusableBufferObserve(buffer, needed);

  if (retainMax > 0 && needed > retainMax) {
    uint8_t* temp = static_cast<uint8_t*>(malloc(needed));
    if (!temp) {
      buffer.failCount++;
      return false;
    }
    memset(temp, 0, needed);
    buffer.tempAllocCount++;
    handle.data = temp;
    handle.capacity = needed;
    handle.temporary = true;
    return true;
  }

  if (buffer.data && buffer.capacity >= needed) {
    memset(buffer.data, 0, needed);
    buffer.reuseCount++;
    handle.data = buffer.data;
    handle.capacity = buffer.capacity;
    return true;
  }

  size_t nextCapacity = p1ReusableBufferClamp(needed, retainMin, retainMax);
  uint8_t* next = static_cast<uint8_t*>(realloc(buffer.data, nextCapacity));
  if (!next) {
    buffer.failCount++;
    return false;
  }

  buffer.data = next;
  buffer.capacity = nextCapacity;
  memset(buffer.data, 0, needed);
  buffer.growCount++;
  handle.data = buffer.data;
  handle.capacity = buffer.capacity;
  return true;
}

void p1ReusableBufferReleaseHandle(P1ReusableBuffer& buffer, P1ReusableBufferHandle& handle) {
  if (handle.temporary && handle.data) {
    free(handle.data);
    buffer.tempFreeCount++;
  }
  handle.data = nullptr;
  handle.capacity = 0;
  handle.temporary = false;
}

void p1ReusableBufferMaintain(P1ReusableBuffer& buffer, size_t retainMin, size_t retainMax, uint32_t idleMs) {
  if (!buffer.data || buffer.capacity == 0) return;
  if (idleMs > 0 && millis() - buffer.lastUseMs < idleMs) return;

  size_t target = buffer.emaNeed ? buffer.emaNeed * 2 : retainMin;
  target = p1ReusableBufferClamp(target, retainMin, retainMax);
  if (target == 0 || buffer.capacity <= target + (target / 2)) return;

  uint8_t* next = static_cast<uint8_t*>(realloc(buffer.data, target));
  if (!next) return;
  buffer.data = next;
  buffer.capacity = target;
  buffer.shrinkCount++;
}

void p1ReusableBufferRelease(P1ReusableBuffer& buffer) {
  if (buffer.data) {
    free(buffer.data);
  }
  buffer.data = nullptr;
  buffer.capacity = 0;
}
