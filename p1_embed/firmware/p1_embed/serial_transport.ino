#include <Arduino.h>
#include "p1_embed_firmware.h"

static char g_serialLine[P1_EMBED_LINE_MAX];
static size_t g_serialLineLen = 0;
static bool g_serialDiscardLine = false;
static SemaphoreHandle_t g_transportWriteLock = nullptr;

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

void transportSendLine(const String& line) {
  if (g_transportWriteLock) xSemaphoreTake(g_transportWriteLock, portMAX_DELAY);
  Serial.print(line);
  if (!line.endsWith("\n")) Serial.print('\n');
  webTransportSendLine(line);
  if (g_transportWriteLock) xSemaphoreGive(g_transportWriteLock);
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

    char c = (char)value;

    if (g_serialDiscardLine) {
      if (c == '\n') {
        g_serialDiscardLine = false;
        g_serialLineLen = 0;
      }
      continue;
    }

    if (c == '\n') {
      g_serialLine[g_serialLineLen] = 0;
      if (g_serialLineLen > 0) protocolHandleLine(g_serialLine);
      g_serialLineLen = 0;
      continue;
    }

    if (c == '\r') continue;

    if (g_serialLineLen + 1 < sizeof(g_serialLine)) {
      g_serialLine[g_serialLineLen++] = c;
    } else {
      g_serialLineLen = 0;
      g_serialDiscardLine = true;
      protocolEmitErrorEvent("protocol.error", "line_too_long", "Discarding serial input until newline");
    }
  }
}
