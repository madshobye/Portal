#include <Arduino.h>
#include "p1_embed_firmware.h"

static char g_serialLine[P1_EMBED_LINE_MAX];
static size_t g_serialLineLen = 0;
static bool g_serialDiscardLine = false;

void transportSerialBegin() {
  Serial.begin(P1_EMBED_SERIAL_BAUD);
  delay(200);
}

void transportSendRaw(const char* data) {
  if (!data) return;
  Serial.print(data);
}

void transportSendLine(const String& line) {
  Serial.print(line);
  if (!line.endsWith("\n")) Serial.print('\n');
  webTransportSendLine(line);
  webrtcTransportSendLine(line);
}

void transportSerialPoll() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();

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
