#include <Arduino.h>
#include <ESP.h>
#include <esp_heap_caps.h>
#include "p1_embed_firmware.h"

#if P1_EMBED_MEMORY_PROFILE_ENABLED

struct MemoryProfileSample {
  uint32_t atMs;
  uint32_t freeHeap;
  uint32_t minFreeHeap;
  uint32_t maxAllocHeap;
  uint32_t internalFree;
  uint32_t internalLargest;
  uint32_t dmaFree;
  uint32_t dmaLargest;
  int32_t deltaFree;
  int32_t deltaMaxAlloc;
  int32_t usedFromBase;
  uint32_t stackFreeWords;
  char component[18];
  char phase[24];
  char task[18];
};

static MemoryProfileSample g_memoryProfileSamples[P1_EMBED_MEMORY_PROFILE_SAMPLES];
static portMUX_TYPE g_memoryProfileMux = portMUX_INITIALIZER_UNLOCKED;
static uint16_t g_memoryProfileNext = 0;
static uint16_t g_memoryProfileCount = 0;
static uint32_t g_memoryProfileBaseFree = 0;
static uint32_t g_memoryProfileBaseMaxAlloc = 0;
static uint32_t g_memoryProfileWorstFree = UINT32_MAX;
static uint32_t g_memoryProfileWorstMaxAlloc = UINT32_MAX;
static bool g_memoryProfileStarted = false;

static void memoryProfileCopyText(char* dst, size_t size, const char* src) {
  if (!dst || size == 0) return;
  if (!src) src = "";
  strlcpy(dst, src, size);
}

static void memoryProfileCapture(MemoryProfileSample& sample, const char* component, const char* phase) {
  sample.atMs = millis();
  sample.freeHeap = ESP.getFreeHeap();
  sample.minFreeHeap = ESP.getMinFreeHeap();
  sample.maxAllocHeap = ESP.getMaxAllocHeap();
  sample.internalFree = heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
  sample.internalLargest = heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
  sample.dmaFree = heap_caps_get_free_size(MALLOC_CAP_DMA);
  sample.dmaLargest = heap_caps_get_largest_free_block(MALLOC_CAP_DMA);
  sample.deltaFree = 0;
  sample.deltaMaxAlloc = 0;
  sample.usedFromBase = 0;
  sample.stackFreeWords = uxTaskGetStackHighWaterMark(nullptr);
  memoryProfileCopyText(sample.component, sizeof(sample.component), component);
  memoryProfileCopyText(sample.phase, sizeof(sample.phase), phase);
  memoryProfileCopyText(sample.task, sizeof(sample.task), pcTaskGetName(nullptr));
}

void memoryProfileBegin() {
  if (g_memoryProfileStarted) return;
  g_memoryProfileStarted = true;
  memoryProfileReset();
}

void memoryProfileReset() {
  MemoryProfileSample baseline;
  memoryProfileCapture(baseline, "profiler", "baseline");
  g_memoryProfileBaseFree = baseline.freeHeap;
  g_memoryProfileBaseMaxAlloc = baseline.maxAllocHeap;
  g_memoryProfileWorstFree = baseline.freeHeap;
  g_memoryProfileWorstMaxAlloc = baseline.maxAllocHeap;

  portENTER_CRITICAL(&g_memoryProfileMux);
  g_memoryProfileNext = 0;
  g_memoryProfileCount = 0;
  portEXIT_CRITICAL(&g_memoryProfileMux);
  memoryProfileMark("profiler", "baseline");
}

void memoryProfileMark(const char* component, const char* phase) {
  MemoryProfileSample sample;
  memoryProfileCapture(sample, component, phase);

  portENTER_CRITICAL(&g_memoryProfileMux);
  if (g_memoryProfileCount > 0) {
    uint16_t previousIndex = g_memoryProfileNext == 0 ? P1_EMBED_MEMORY_PROFILE_SAMPLES - 1 : g_memoryProfileNext - 1;
    const MemoryProfileSample& previous = g_memoryProfileSamples[previousIndex];
    sample.deltaFree = (int32_t)sample.freeHeap - (int32_t)previous.freeHeap;
    sample.deltaMaxAlloc = (int32_t)sample.maxAllocHeap - (int32_t)previous.maxAllocHeap;
  }
  sample.usedFromBase = (int32_t)g_memoryProfileBaseFree - (int32_t)sample.freeHeap;
  if (sample.freeHeap < g_memoryProfileWorstFree) g_memoryProfileWorstFree = sample.freeHeap;
  if (sample.maxAllocHeap < g_memoryProfileWorstMaxAlloc) g_memoryProfileWorstMaxAlloc = sample.maxAllocHeap;

  g_memoryProfileSamples[g_memoryProfileNext] = sample;
  g_memoryProfileNext = (g_memoryProfileNext + 1) % P1_EMBED_MEMORY_PROFILE_SAMPLES;
  if (g_memoryProfileCount < P1_EMBED_MEMORY_PROFILE_SAMPLES) g_memoryProfileCount++;
  portEXIT_CRITICAL(&g_memoryProfileMux);
}

static bool memoryProfileReadSample(uint16_t chronologicalIndex, MemoryProfileSample& out) {
  portENTER_CRITICAL(&g_memoryProfileMux);
  const uint16_t count = g_memoryProfileCount;
  if (chronologicalIndex >= count) {
    portEXIT_CRITICAL(&g_memoryProfileMux);
    return false;
  }
  const uint16_t first = (g_memoryProfileNext + P1_EMBED_MEMORY_PROFILE_SAMPLES - count) % P1_EMBED_MEMORY_PROFILE_SAMPLES;
  const uint16_t ringIndex = (first + chronologicalIndex) % P1_EMBED_MEMORY_PROFILE_SAMPLES;
  out = g_memoryProfileSamples[ringIndex];
  portEXIT_CRITICAL(&g_memoryProfileMux);
  return true;
}

String memoryProfileSummaryJson() {
  String out;
  out.reserve(420);
  out += "{";
  out += "\"enabled\":true";
  out += ",\"capacity\":" + String(P1_EMBED_MEMORY_PROFILE_SAMPLES);
  out += ",\"samples\":" + String(g_memoryProfileCount);
  out += ",\"staticBytes\":" + String(sizeof(g_memoryProfileSamples));
  out += ",\"baseFreeHeap\":" + String(g_memoryProfileBaseFree);
  out += ",\"baseMaxAllocHeap\":" + String(g_memoryProfileBaseMaxAlloc);
  out += ",\"currentFreeHeap\":" + String(ESP.getFreeHeap());
  out += ",\"currentMaxAllocHeap\":" + String(ESP.getMaxAllocHeap());
  out += ",\"currentMinFreeHeap\":" + String(ESP.getMinFreeHeap());
  out += ",\"worstFreeHeap\":" + String(g_memoryProfileWorstFree == UINT32_MAX ? 0 : g_memoryProfileWorstFree);
  out += ",\"worstMaxAllocHeap\":" + String(g_memoryProfileWorstMaxAlloc == UINT32_MAX ? 0 : g_memoryProfileWorstMaxAlloc);
  out += "}";
  return out;
}

String memoryProfileJson(int limit) {
  if (limit <= 0) limit = P1_EMBED_MEMORY_PROFILE_DEFAULT_LIMIT;
  if (limit > P1_EMBED_MEMORY_PROFILE_SAMPLES) limit = P1_EMBED_MEMORY_PROFILE_SAMPLES;

  uint16_t count;
  portENTER_CRITICAL(&g_memoryProfileMux);
  count = g_memoryProfileCount;
  portEXIT_CRITICAL(&g_memoryProfileMux);

  const uint16_t emitCount = count < (uint16_t)limit ? count : (uint16_t)limit;
  const uint16_t start = count - emitCount;

  String summary = memoryProfileSummaryJson();
  String out;
  out.reserve(900 + emitCount * 220);
  out += "{";
  out += "\"summary\":" + summary;
  out += ",\"limit\":" + String(limit);
  out += ",\"returned\":" + String(emitCount);
  out += ",\"samples\":[";
  for (uint16_t i = 0; i < emitCount; i++) {
    MemoryProfileSample sample;
    if (!memoryProfileReadSample(start + i, sample)) continue;
    if (i) out += ",";
    out += "{";
    out += "\"atMs\":" + String(sample.atMs);
    out += ",\"component\":" + jsonString(sample.component);
    out += ",\"phase\":" + jsonString(sample.phase);
    out += ",\"task\":" + jsonString(sample.task);
    out += ",\"freeHeap\":" + String(sample.freeHeap);
    out += ",\"deltaFree\":" + String(sample.deltaFree);
    out += ",\"usedFromBase\":" + String(sample.usedFromBase);
    out += ",\"maxAllocHeap\":" + String(sample.maxAllocHeap);
    out += ",\"deltaMaxAlloc\":" + String(sample.deltaMaxAlloc);
    out += ",\"minFreeHeap\":" + String(sample.minFreeHeap);
    out += ",\"internalFree\":" + String(sample.internalFree);
    out += ",\"internalLargest\":" + String(sample.internalLargest);
    out += ",\"dmaFree\":" + String(sample.dmaFree);
    out += ",\"dmaLargest\":" + String(sample.dmaLargest);
    out += ",\"stackFreeWords\":" + String(sample.stackFreeWords);
    out += "}";
  }
  out += "]}";
  return out;
}

#else

void memoryProfileBegin() {}
void memoryProfileReset() {}
void memoryProfileMark(const char* component, const char* phase) {}
String memoryProfileSummaryJson() {
  return "{\"enabled\":false}";
}
String memoryProfileJson(int limit) {
  return "{\"summary\":{\"enabled\":false},\"samples\":[]}";
}

#endif
