#include "PrintBridge.h"
#include "UsbPrinterHost.h"

#include <string.h>

void peerSendDataChannelText(const char *message);

static String activePrintId;
static size_t expectedBytes = 0;
static size_t expectedChunks = 0;
static size_t receivedBytes = 0;
static size_t receivedChunks = 0;
static bool printActive = false;
static String dataChannelBuffer;
static size_t nextProgressBytes = 0;
static size_t nextProgressAckBytes = 0;
static bool usbHostRequested = false;
static char printTail[121] = {};
static size_t printTailLen = 0;
static constexpr size_t PRINT_PROGRESS_STEP_BYTES = 4096;

static void resetProgressLog() {
  nextProgressBytes = PRINT_PROGRESS_STEP_BYTES;
  nextProgressAckBytes = PRINT_PROGRESS_STEP_BYTES;
  printTailLen = 0;
  printTail[0] = '\0';
}

static void appendPrintTail(const uint8_t *data, size_t len) {
  for (size_t i = 0; i < len; i++) {
    char ch = char(data[i]);
    if (ch == '\r' || ch == '\n') {
      ch = '.';
    } else if (ch < 32 || ch > 126) {
      ch = '?';
    }

    if (printTailLen < sizeof(printTail) - 1) {
      printTail[printTailLen++] = ch;
    } else {
      memmove(printTail, printTail + 1, sizeof(printTail) - 2);
      printTail[sizeof(printTail) - 2] = ch;
    }
    printTail[printTailLen] = '\0';
  }
}

static void logPrintProgress() {
  if (expectedBytes == 0) return;
  while (receivedBytes >= nextProgressBytes && nextProgressBytes < expectedBytes) {
    Serial.printf(
      "PrintBridge progress id=%s bytes=%u/%u chunks=%u/%u\r\n",
      activePrintId.c_str(),
      unsigned(receivedBytes),
      unsigned(expectedBytes),
      unsigned(receivedChunks),
      unsigned(expectedChunks)
    );
    nextProgressBytes += PRINT_PROGRESS_STEP_BYTES;
  }
}

static bool shouldAckProgress() {
  if (expectedBytes > 0 && receivedBytes >= expectedBytes) {
    return true;
  }
  if (receivedBytes >= nextProgressAckBytes) {
    while (receivedBytes >= nextProgressAckBytes) {
      nextProgressAckBytes += PRINT_PROGRESS_STEP_BYTES;
    }
    return true;
  }
  return false;
}

static int base64Value(char ch) {
  if (ch >= 'A' && ch <= 'Z') return ch - 'A';
  if (ch >= 'a' && ch <= 'z') return ch - 'a' + 26;
  if (ch >= '0' && ch <= '9') return ch - '0' + 52;
  if (ch == '+') return 62;
  if (ch == '/') return 63;
  return -1;
}

static size_t decodeBase64(const String &encoded, uint8_t *out, size_t outSize) {
  int values[4] = {0, 0, 0, 0};
  int count = 0;
  size_t written = 0;

  for (size_t i = 0; i < encoded.length(); i++) {
    const char ch = encoded[i];
    if (ch == '\r' || ch == '\n' || ch == ' ' || ch == '\t') {
      continue;
    }

    values[count++] = ch == '=' ? -2 : base64Value(ch);
    if (values[count - 1] < -1) {
      values[count - 1] = -2;
    }
    if (values[count - 1] == -1) {
      count--;
      continue;
    }

    if (count != 4) {
      continue;
    }

    const int a = values[0] < 0 ? 0 : values[0];
    const int b = values[1] < 0 ? 0 : values[1];
    const int c = values[2] < 0 ? 0 : values[2];
    const int d = values[3] < 0 ? 0 : values[3];

    if (written < outSize) out[written++] = uint8_t((a << 2) | (b >> 4));
    if (values[2] != -2 && written < outSize) out[written++] = uint8_t(((b & 0x0f) << 4) | (c >> 2));
    if (values[3] != -2 && written < outSize) out[written++] = uint8_t(((c & 0x03) << 6) | d);
    count = 0;
  }

  return written;
}

static String extractJsonString(const String &json, const char *key) {
  const String pattern = "\"" + String(key) + "\":\"";
  int start = json.indexOf(pattern);
  if (start < 0) return "";
  start += pattern.length();

  String value;
  bool escaped = false;
  for (int i = start; i < json.length(); i++) {
    const char ch = json[i];
    if (escaped) {
      value += ch;
      escaped = false;
      continue;
    }
    if (ch == '\\') {
      escaped = true;
      continue;
    }
    if (ch == '"') break;
    value += ch;
  }
  return value;
}

static size_t extractJsonSize(const String &json, const char *key) {
  const String pattern = "\"" + String(key) + "\":";
  int start = json.indexOf(pattern);
  if (start < 0) return 0;
  start += pattern.length();
  while (start < json.length() && json[start] == ' ') start++;

  size_t value = 0;
  for (int i = start; i < json.length(); i++) {
    const char ch = json[i];
    if (ch < '0' || ch > '9') break;
    value = value * 10 + size_t(ch - '0');
  }
  return value;
}

static void sendPrintStatus(const char *state, const String &id, size_t bytes = 0, size_t chunks = 0) {
  Serial.printf(
    "PrintBridge ack state=%s id=%s bytes=%u chunks=%u\r\n",
    state,
    id.c_str(),
    unsigned(bytes),
    unsigned(chunks)
  );

  String message = "{\"type\":\"print\",\"state\":\"";
  message += state;
  message += "\",\"id\":\"";
  message += id;
  message += "\",\"bytes\":";
  message += String(bytes);
  message += ",\"chunks\":";
  message += String(chunks);
  message += "}";
  peerSendDataChannelText(message.c_str());
}

static void sendPeerPong() {
  peerSendDataChannelText("{\"cmd\":\"peer:pong\"}");
}

static void ensureUsbHostStarted() {
  if (usbHostRequested) {
    return;
  }
  usbHostRequested = true;
  usbPrinterHostBegin();
}

static bool waitForUsbPrinterReady(uint32_t timeoutMs) {
  ensureUsbHostStarted();
  const unsigned long startedAt = millis();
  while (!usbPrinterHostReady() && millis() - startedAt < timeoutMs) {
    delay(25);
  }
  return usbPrinterHostReady();
}

static bool printerSinkWrite(const uint8_t *data, size_t len) {
  static bool previewPrinted = false;
  if (!previewPrinted && len > 0) {
    previewPrinted = true;
    Serial.print("PrintBridge TSPL preview: ");
    for (size_t i = 0; i < len && i < 80; i++) {
      const char ch = char(data[i]);
      Serial.print((ch >= 32 && ch <= 126) ? ch : '.');
    }
    Serial.println();
  }

  return usbPrinterHostWrite(data, len);
}

static void handlePrintStart(const String &json) {
  if (!waitForUsbPrinterReady(6000)) {
    const String id = extractJsonString(json, "id");
    Serial.printf("PrintBridge cannot start id=%s: USB printer not ready\r\n", id.c_str());
    sendPrintStatus("error", id, 0, 0);
    return;
  }

  activePrintId = extractJsonString(json, "id");
  expectedBytes = extractJsonSize(json, "bytes");
  expectedChunks = extractJsonSize(json, "chunks");
  receivedBytes = 0;
  receivedChunks = 0;
  printActive = activePrintId.length() > 0;
  dataChannelBuffer = "";
  resetProgressLog();

  Serial.printf(
    "PrintBridge start id=%s bytes=%u chunks=%u\r\n",
    activePrintId.c_str(),
    unsigned(expectedBytes),
    unsigned(expectedChunks)
  );
  sendPrintStatus("started", activePrintId, expectedBytes, expectedChunks);
}

static void handleRawPrintBytes(const uint8_t *data, size_t len) {
  if (!printActive) {
    Serial.println("PrintBridge ignored raw bytes without active job");
    return;
  }

  const size_t remaining = expectedBytes > receivedBytes ? expectedBytes - receivedBytes : 0;
  const size_t bytesToWrite = min(len, remaining);
  if (bytesToWrite > 0 && !printerSinkWrite(data, bytesToWrite)) {
    Serial.printf(
      "PrintBridge sink write failed id=%s bytes=%u/%u chunks=%u/%u\r\n",
      activePrintId.c_str(),
      unsigned(receivedBytes),
      unsigned(expectedBytes),
      unsigned(receivedChunks),
      unsigned(expectedChunks)
    );
    sendPrintStatus("error", activePrintId, receivedBytes, receivedChunks);
    printActive = false;
    activePrintId = "";
    resetProgressLog();
    return;
  }

  if (bytesToWrite > 0) {
    receivedBytes += bytesToWrite;
    receivedChunks++;
    appendPrintTail(data, bytesToWrite);
    logPrintProgress();
    if (shouldAckProgress()) {
      if (!usbPrinterHostWaitForPendingBytes(4096, 15000)) {
        sendPrintStatus("error", activePrintId, receivedBytes, receivedChunks);
        printActive = false;
        activePrintId = "";
        resetProgressLog();
        return;
      }
      sendPrintStatus("progress", activePrintId, receivedBytes, receivedChunks);
    }
  }

  if (expectedBytes > 0 && receivedBytes >= expectedBytes) {
    Serial.printf(
      "PrintBridge done id=%s bytes=%u/%u chunks=%u/%u\r\n",
      activePrintId.c_str(),
      unsigned(receivedBytes),
      unsigned(expectedBytes),
      unsigned(receivedChunks),
      unsigned(expectedChunks)
    );
    Serial.printf("PrintBridge TSPL tail: %s\r\n", printTail);
    if (usbPrinterHostEndJob()) {
      sendPrintStatus("done", activePrintId, receivedBytes, receivedChunks);
    } else {
      sendPrintStatus("error", activePrintId, receivedBytes, receivedChunks);
    }
    printActive = false;
    activePrintId = "";
    resetProgressLog();
  }
}

static void handlePrintChunk(const String &json) {
  if (!printActive) {
    Serial.println("PrintBridge ignored chunk without active job");
    return;
  }

  const String id = extractJsonString(json, "id");
  if (id != activePrintId) {
    Serial.printf("PrintBridge ignored chunk for stale id=%s\r\n", id.c_str());
    return;
  }

  const String data = extractJsonString(json, "data");
  const size_t bufferSize = (data.length() * 3) / 4 + 4;
  uint8_t *buffer = (uint8_t *)malloc(bufferSize);
  if (buffer == NULL) {
    Serial.println("PrintBridge failed to allocate chunk buffer");
    sendPrintStatus("error", activePrintId, receivedBytes, receivedChunks);
    return;
  }

  const size_t decoded = decodeBase64(data, buffer, bufferSize);
  handleRawPrintBytes(buffer, decoded);
  free(buffer);
}

static void handlePrintEnd(const String &json) {
  const String id = extractJsonString(json, "id");
  if (!printActive || id != activePrintId) {
    Serial.printf("PrintBridge ignored end for id=%s\r\n", id.c_str());
    return;
  }

  Serial.printf(
    "PrintBridge done id=%s bytes=%u/%u chunks=%u/%u\r\n",
    activePrintId.c_str(),
    unsigned(receivedBytes),
    unsigned(expectedBytes),
    unsigned(receivedChunks),
    unsigned(expectedChunks)
  );

  const bool complete = receivedBytes == expectedBytes && receivedChunks == expectedChunks;
  if (complete && !usbPrinterHostEndJob()) {
    sendPrintStatus("error", activePrintId, receivedBytes, receivedChunks);
  } else {
    sendPrintStatus(complete ? "done" : "incomplete", activePrintId, receivedBytes, receivedChunks);
  }
  printActive = false;
  activePrintId = "";
  resetProgressLog();
}

static bool processPrintBridgeJson(const String &json) {
  const String cmd = extractJsonString(json, "cmd");
  if (cmd == "peer:ping") {
    sendPeerPong();
    return true;
  }

  if (!cmd.startsWith("print:")) {
    return false;
  }

  if (cmd == "print:start") {
    handlePrintStart(json);
  } else if (cmd == "print:chunk") {
    handlePrintChunk(json);
  } else if (cmd == "print:end") {
    handlePrintEnd(json);
  } else {
    Serial.printf("PrintBridge unknown command: %s\r\n", cmd.c_str());
  }

  return true;
}

static bool popNextJsonObject(String &buffer, String &json) {
  int start = buffer.indexOf('{');
  if (start < 0) {
    if (buffer.length() > 0) {
      buffer = "";
    }
    return false;
  }
  if (start > 0) {
    buffer.remove(0, start);
  }

  int depth = 0;
  bool inString = false;
  bool escaped = false;

  for (int i = 0; i < buffer.length(); i++) {
    const char ch = buffer[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch == '\\') {
      escaped = inString;
      continue;
    }
    if (ch == '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (ch == '{') {
      depth++;
    } else if (ch == '}') {
      depth--;
      if (depth == 0) {
        json = buffer.substring(0, i + 1);
        buffer.remove(0, i + 1);
        return true;
      }
    }
  }

  return false;
}

void printBridgeBegin() {
  dataChannelBuffer.reserve(1024);
  Serial.println("PrintBridge ready (TSPL over PeerJS; USB printer sink starts after WebRTC)");
}

void printBridgeHandleDataChannelOpen() {
  ensureUsbHostStarted();
}

void printBridgeHandleDataChannelClose() {
  if (!printActive) {
    return;
  }

  Serial.printf(
    "PrintBridge channel closed during job id=%s bytes=%u/%u chunks=%u/%u buffered=%u\r\n",
    activePrintId.c_str(),
    unsigned(receivedBytes),
    unsigned(expectedBytes),
    unsigned(receivedChunks),
    unsigned(expectedChunks),
    unsigned(dataChannelBuffer.length())
  );
  sendPrintStatus("incomplete", activePrintId, receivedBytes, receivedChunks);
  printActive = false;
  activePrintId = "";
  dataChannelBuffer = "";
  resetProgressLog();
}

bool printBridgeHandleDataChannelMessage(const char *msg, size_t len) {
  if (msg == NULL || len == 0) return false;

  const bool startsWithJson = msg[0] == '{' || dataChannelBuffer.length() > 0;
  if (printActive && receivedBytes < expectedBytes && !startsWithJson) {
    handleRawPrintBytes((const uint8_t *)msg, len);
    return true;
  }

  const bool looksLikePrintBridgeData =
    dataChannelBuffer.length() > 0 ||
    (len > 0 && memchr(msg, '{', len) != NULL) ||
    (len > 0 && memchr(msg, '}', len) != NULL);

  if (!looksLikePrintBridgeData) {
    return false;
  }

  for (size_t i = 0; i < len; i++) {
    dataChannelBuffer += msg[i];
  }

  if (dataChannelBuffer.length() > 4096) {
    Serial.println("PrintBridge dropped oversized partial message");
    dataChannelBuffer = "";
    return true;
  }

  bool handled = false;
  String json;
  while (popNextJsonObject(dataChannelBuffer, json)) {
    handled = processPrintBridgeJson(json) || handled;
    json = "";
  }

  return handled || dataChannelBuffer.length() > 0;
}
