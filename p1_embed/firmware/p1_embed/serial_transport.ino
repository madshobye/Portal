#include <Arduino.h>
#include "p1_embed_firmware.h"

static char g_serialLine[P1_EMBED_LINE_MAX];
static size_t g_serialLineLen = 0;
static bool g_serialDiscardLine = false;
static SemaphoreHandle_t g_transportWriteLock = nullptr;
static bool g_serialMsgPackMode = false;
static uint8_t g_serialFrameHeader[6];
static uint8_t g_serialFrameHeaderLen = 0;
static uint8_t g_serialFrame[P1_EMBED_MSGPACK_MAX_FRAME_BYTES];
static uint16_t g_serialFrameLen = 0;
static uint16_t g_serialFrameReceived = 0;

static void transportSerialResetMsgPackRx() {
  g_serialFrameHeaderLen = 0;
  g_serialFrameLen = 0;
  g_serialFrameReceived = 0;
}

void transportSerialBegin() {
  Serial.begin(P1_EMBED_SERIAL_BAUD);
  if (!g_transportWriteLock) {
    g_transportWriteLock = xSemaphoreCreateMutex();
  }
  delay(200);
}

void transportSendRaw(const char* data) {
  if (!data) return;
  if (g_transportWriteLock) xSemaphoreTake(g_transportWriteLock, portMAX_DELAY);
  Serial.print(data);
  if (g_transportWriteLock) xSemaphoreGive(g_transportWriteLock);
}

bool transportSerialMsgPackMode() {
  return g_serialMsgPackMode;
}

void transportSerialSetMsgPackMode(bool enabled) {
  g_serialMsgPackMode = enabled;
  g_serialLineLen = 0;
  g_serialDiscardLine = false;
  transportSerialResetMsgPackRx();
}

void transportSendMsgPackBytes(const uint8_t* data, size_t len) {
  if (!g_serialMsgPackMode || !data || len == 0 || len > 0xffff) return;
  uint8_t header[6] = {
    'P', '1', 'M', 'P',
    (uint8_t)((len >> 8) & 0xff),
    (uint8_t)(len & 0xff),
  };
  if (g_transportWriteLock) xSemaphoreTake(g_transportWriteLock, portMAX_DELAY);
  Serial.write(header, sizeof(header));
  Serial.write(data, len);
  if (g_transportWriteLock) xSemaphoreGive(g_transportWriteLock);
}

void transportSendLine(const String& line) {
  if (g_transportWriteLock) xSemaphoreTake(g_transportWriteLock, portMAX_DELAY);
  if (!g_serialMsgPackMode) {
    Serial.print(line);
    if (!line.endsWith("\n")) Serial.print('\n');
  }
  webTransportSendLine(line);
  if (g_transportWriteLock) xSemaphoreGive(g_transportWriteLock);
}

static void transportSerialPollMsgPackByte(uint8_t value) {
  if (g_serialFrameLen == 0) {
    static const uint8_t magic[4] = {'P', '1', 'M', 'P'};
    if (g_serialFrameHeaderLen < 4) {
      if (value == magic[g_serialFrameHeaderLen]) {
        g_serialFrameHeader[g_serialFrameHeaderLen++] = value;
      } else {
        g_serialFrameHeaderLen = (value == magic[0]) ? 1 : 0;
      }
      return;
    }
    g_serialFrameHeader[g_serialFrameHeaderLen++] = value;
    if (g_serialFrameHeaderLen < sizeof(g_serialFrameHeader)) return;
    g_serialFrameLen = ((uint16_t)g_serialFrameHeader[4] << 8) | g_serialFrameHeader[5];
    g_serialFrameReceived = 0;
    if (g_serialFrameLen == 0 || g_serialFrameLen > sizeof(g_serialFrame)) {
      protocolEmitErrorEvent("protocol.error", "serial_msgpack_frame_too_large", "Serial MessagePack frame size is invalid");
      transportSerialResetMsgPackRx();
    }
    return;
  }

  g_serialFrame[g_serialFrameReceived++] = value;
  if (g_serialFrameReceived >= g_serialFrameLen) {
    protocolHandleBytes(g_serialFrame, g_serialFrameLen, P1_PROTOCOL_SOURCE_SERIAL);
    transportSerialResetMsgPackRx();
  }
}

static void transportSerialPollJsonByte(char c) {
  if (g_serialDiscardLine) {
    if (c == '\n') {
      g_serialDiscardLine = false;
      g_serialLineLen = 0;
    }
    return;
  }

  if (c == '\n') {
    g_serialLine[g_serialLineLen] = 0;
    if (g_serialLineLen > 0) protocolHandleLine(g_serialLine, P1_PROTOCOL_SOURCE_SERIAL);
    g_serialLineLen = 0;
    return;
  }

  if (c == '\r') return;

  if (g_serialLineLen + 1 < sizeof(g_serialLine)) {
    g_serialLine[g_serialLineLen++] = c;
  } else {
    g_serialLineLen = 0;
    g_serialDiscardLine = true;
    protocolEmitErrorEvent("protocol.error", "line_too_long", "Discarding serial input until newline");
  }
}

void transportSerialPoll() {
  uint8_t budget = 64;
  while (budget-- > 0) {
    if (g_transportWriteLock && xSemaphoreTake(g_transportWriteLock, 0) != pdTRUE) {
      return;
    }
    int available = Serial.available();
    int value = available > 0 ? Serial.read() : -1;
    if (g_transportWriteLock) xSemaphoreGive(g_transportWriteLock);
    if (value < 0) {
      return;
    }

    if (g_serialMsgPackMode) transportSerialPollMsgPackByte((uint8_t)value);
    else transportSerialPollJsonByte((char)value);
  }
}
