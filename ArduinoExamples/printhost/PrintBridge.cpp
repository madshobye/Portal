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
static constexpr size_t PRINT_USB_WRITE_CHUNK_BYTES = 4096;
static constexpr size_t PRINT_BUFFER_COUNT = 2;
static constexpr size_t PRINT_BUFFER_BYTES = 64 * 1024;
static constexpr size_t PRINT_PROGRESS_STEP_BYTES = 8 * 1024;
static constexpr uint32_t PRINT_BRIDGE_TASK_STACK = 4096;

struct PrintBuffer {
  uint8_t *data = NULL;
  size_t len = 0;
  bool last = false;
  bool complete = false;
  char id[40] = {};
  size_t bytes = 0;
  size_t chunks = 0;
};

static TaskHandle_t printTaskHandle = NULL;
static TaskHandle_t usbReadyNotifyTaskHandle = NULL;
static QueueHandle_t freePrintBuffers = NULL;
static QueueHandle_t fullPrintBuffers = NULL;
static PrintBuffer printBuffers[PRINT_BUFFER_COUNT];
static int activeBufferIndex = -1;
static volatile bool printTaskBusy = false;

static void printBridgeTask(void *arg);
static void printBridgeUsbReadyNotifyTask(void *arg);

static void printBridgeLogHeap(const char *label) {
  Serial.printf(
    "PrintBridge heap %-16s free=%u min=%u maxAlloc=%u psram=%u\r\n",
    label,
    unsigned(ESP.getFreeHeap()),
    unsigned(ESP.getMinFreeHeap()),
    unsigned(ESP.getMaxAllocHeap()),
    unsigned(ESP.getFreePsram())
  );
}

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
  if (receivedBytes >= nextProgressAckBytes) {
    while (receivedBytes >= nextProgressAckBytes) {
      nextProgressAckBytes += PRINT_PROGRESS_STEP_BYTES;
    }
    return true;
  }
  return false;
}

static void resetPrintBufferQueues() {
  if (freePrintBuffers == NULL || fullPrintBuffers == NULL) return;
  xQueueReset(freePrintBuffers);
  xQueueReset(fullPrintBuffers);
  for (uint8_t i = 0; i < PRINT_BUFFER_COUNT; i++) {
    printBuffers[i].len = 0;
    printBuffers[i].last = false;
    printBuffers[i].complete = false;
    printBuffers[i].id[0] = '\0';
    printBuffers[i].bytes = 0;
    printBuffers[i].chunks = 0;
    xQueueSend(freePrintBuffers, &i, 0);
  }
  activeBufferIndex = -1;
}

static bool allocatePrintBuffers() {
  for (size_t i = 0; i < PRINT_BUFFER_COUNT; i++) {
    if (printBuffers[i].data != NULL) continue;
    printBuffers[i].data = (uint8_t *)ps_malloc(PRINT_BUFFER_BYTES);
    if (printBuffers[i].data == NULL) {
      Serial.printf("PrintBridge failed to allocate PSRAM buffer %u bytes=%u\r\n", unsigned(i), unsigned(PRINT_BUFFER_BYTES));
      return false;
    }
  }
  return true;
}

static bool ensurePrintTaskStarted() {
  if (printTaskHandle != NULL) return true;
  const BaseType_t result = xTaskCreatePinnedToCore(
    printBridgeTask,
    "print_bridge",
    PRINT_BRIDGE_TASK_STACK,
    NULL,
    4,
    &printTaskHandle,
    1
  );
  if (result != pdPASS) {
    Serial.println("PrintBridge failed to start print task");
    printTaskHandle = NULL;
    return false;
  }
  return true;
}

static bool takePrintBuffer() {
  if (activeBufferIndex >= 0) return true;
  if (freePrintBuffers == NULL) return false;

  uint8_t index = 0;
  if (xQueueReceive(freePrintBuffers, &index, 0) != pdTRUE) {
    return false;
  }
  activeBufferIndex = index;
  if (printBuffers[index].data == NULL) {
    activeBufferIndex = -1;
    return false;
  }
  printBuffers[index].len = 0;
  printBuffers[index].last = false;
  printBuffers[index].complete = false;
  printBuffers[index].id[0] = '\0';
  printBuffers[index].bytes = 0;
  printBuffers[index].chunks = 0;
  return true;
}

static bool queueActivePrintBuffer(bool last, bool complete) {
  if (activeBufferIndex < 0 || fullPrintBuffers == NULL) return false;

  PrintBuffer &buffer = printBuffers[activeBufferIndex];
  buffer.last = last;
  buffer.complete = complete;
  strlcpy(buffer.id, activePrintId.c_str(), sizeof(buffer.id));
  buffer.bytes = receivedBytes;
  buffer.chunks = receivedChunks;

  const uint8_t index = uint8_t(activeBufferIndex);
  activeBufferIndex = -1;
  if (xQueueSend(fullPrintBuffers, &index, pdMS_TO_TICKS(5)) != pdTRUE) {
    return false;
  }
  return true;
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

static void sendPrintStatus(const char *state, const String &id, size_t bytes = 0, size_t chunks = 0, const char *reason = NULL) {
  Serial.printf(
    "PrintBridge ack state=%s id=%s bytes=%u chunks=%u%s%s\r\n",
    state,
    id.c_str(),
    unsigned(bytes),
    unsigned(chunks),
    reason != NULL ? " reason=" : "",
    reason != NULL ? reason : ""
  );

  String message = "{\"type\":\"print\",\"state\":\"";
  message += state;
  message += "\",\"id\":\"";
  message += id;
  message += "\",\"bytes\":";
  message += String(bytes);
  message += ",\"chunks\":";
  message += String(chunks);
  if (reason != NULL) {
    message += ",\"reason\":\"";
    message += reason;
    message += "\"";
  }
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

static bool writePrintBufferToUsb(const PrintBuffer &buffer) {
  for (size_t offset = 0; offset < buffer.len; offset += PRINT_USB_WRITE_CHUNK_BYTES) {
    const size_t len = min(PRINT_USB_WRITE_CHUNK_BYTES, buffer.len - offset);
    if (!printerSinkWrite(buffer.data + offset, len)) {
      Serial.printf("PrintBridge USB write failed offset=%u len=%u\r\n", unsigned(offset), unsigned(len));
      return false;
    }
    if (!usbPrinterHostWaitForPendingBytes(2048, 15000)) {
      Serial.printf("PrintBridge USB drain timeout offset=%u\r\n", unsigned(offset));
      return false;
    }
  }
  return true;
}

static void printBridgeTask(void *arg) {
  Serial.println("printBridgeTask started on core 1");

  for (;;) {
    uint8_t index = 0;
    if (fullPrintBuffers == NULL || xQueueReceive(fullPrintBuffers, &index, portMAX_DELAY) != pdTRUE) {
      continue;
    }
    if (index >= PRINT_BUFFER_COUNT) {
      continue;
    }

    printTaskBusy = true;
    PrintBuffer &buffer = printBuffers[index];
    bool ok = true;
    if (buffer.len > 0) {
      ok = writePrintBufferToUsb(buffer);
    }
    if (ok && buffer.last) {
      ok = usbPrinterHostEndJob();
    }

    if (!ok) {
      printTaskBusy = false;
    }
    if (buffer.last) {
      if (ok && buffer.complete) {
        sendPrintStatus("done", String(buffer.id), buffer.bytes, buffer.chunks);
      } else {
        sendPrintStatus("error", String(buffer.id), buffer.bytes, buffer.chunks);
      }
      printTaskBusy = false;
    }

    buffer.len = 0;
    buffer.last = false;
    buffer.complete = false;
    buffer.id[0] = '\0';
    buffer.bytes = 0;
    buffer.chunks = 0;
    if (freePrintBuffers != NULL) {
      xQueueSend(freePrintBuffers, &index, portMAX_DELAY);
    }
  }
}

static void printBridgeUsbReadyNotifyTask(void *arg) {
  (void)arg;
  if (waitForUsbPrinterReady(20000)) {
    peerSendDataChannelText("esp32 connected");
  } else {
    Serial.println("PrintBridge USB printer not ready after datachannel open");
  }
  usbReadyNotifyTaskHandle = NULL;
  vTaskDelete(NULL);
}

static void handlePrintStart(const String &json) {
  const String id = extractJsonString(json, "id");
  printBridgeLogHeap("start entry");
  if (printActive && id == activePrintId) {
    sendPrintStatus("started", activePrintId, expectedBytes, expectedChunks);
    return;
  }
  if (printActive || printTaskBusy) {
    Serial.printf("PrintBridge busy, cannot start id=%s active=%s taskBusy=%s\r\n", id.c_str(), printActive ? "yes" : "no", printTaskBusy ? "yes" : "no");
    printBridgeLogHeap("start busy");
    sendPrintStatus("error", id, 0, 0, "busy");
    return;
  }

  if (!waitForUsbPrinterReady(20000)) {
    Serial.printf("PrintBridge cannot start id=%s: USB printer not ready\r\n", id.c_str());
    printBridgeLogHeap("usb not ready");
    sendPrintStatus("error", id, 0, 0, "usb_not_ready");
    return;
  }
  if (!allocatePrintBuffers()) {
    printBridgeLogHeap("buffer fail");
    sendPrintStatus("error", id, 0, 0, "buffer_alloc_failed");
    return;
  }
  if (!ensurePrintTaskStarted()) {
    printBridgeLogHeap("task fail");
    sendPrintStatus("error", id, 0, 0, "print_task_failed");
    return;
  }

  activePrintId = id;
  expectedBytes = extractJsonSize(json, "bytes");
  expectedChunks = extractJsonSize(json, "chunks");
  receivedBytes = 0;
  receivedChunks = 0;
  printActive = false;
  dataChannelBuffer = "";
  resetProgressLog();
  resetPrintBufferQueues();

  if (activePrintId.length() == 0 || expectedBytes == 0) {
    Serial.println("PrintBridge cannot start: missing id or bytes");
    printBridgeLogHeap("invalid start");
    sendPrintStatus("error", activePrintId, 0, 0, "invalid_start");
    activePrintId = "";
    return;
  }
  printActive = true;

  Serial.printf(
    "PrintBridge start id=%s bytes=%u chunks=%u\r\n",
    activePrintId.c_str(),
    unsigned(expectedBytes),
    unsigned(expectedChunks)
  );
  printBridgeLogHeap("start ready");
  sendPrintStatus("started", activePrintId, expectedBytes, expectedChunks);
  printBridgeLogHeap("started ack");
}

static void handleRawPrintBytes(const uint8_t *data, size_t len) {
  if (!printActive) {
    Serial.println("PrintBridge ignored raw bytes without active job");
    return;
  }
  const size_t remaining = expectedBytes > receivedBytes ? expectedBytes - receivedBytes : 0;
  size_t bytesToWrite = min(len, remaining);
  size_t offset = 0;

  while (bytesToWrite > 0) {
    if (!takePrintBuffer()) {
      Serial.println("PrintBridge no free print buffer");
      sendPrintStatus("error", activePrintId, receivedBytes, receivedChunks);
      printActive = false;
      activePrintId = "";
      resetProgressLog();
      return;
    }

    PrintBuffer &buffer = printBuffers[activeBufferIndex];
    const size_t space = PRINT_BUFFER_BYTES - buffer.len;
    const size_t copyLen = min(bytesToWrite, space);
    memcpy(buffer.data + buffer.len, data + offset, copyLen);
    buffer.len += copyLen;
    offset += copyLen;
    bytesToWrite -= copyLen;

    if (buffer.len >= PRINT_BUFFER_BYTES && !queueActivePrintBuffer(false, false)) {
      Serial.println("PrintBridge full print queue blocked");
      sendPrintStatus("error", activePrintId, receivedBytes, receivedChunks);
      printActive = false;
      activePrintId = "";
      resetProgressLog();
      return;
    }
  }

  if (offset > 0) {
    receivedBytes += offset;
    receivedChunks++;
    appendPrintTail(data, offset);
    logPrintProgress();
    if (shouldAckProgress() && receivedBytes < expectedBytes) {
      printBridgeLogHeap("progress ack");
      sendPrintStatus("progress", activePrintId, receivedBytes, receivedChunks);
      printBridgeLogHeap("progress sent");
    }
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
  uint8_t *buffer = (uint8_t *)ps_malloc(bufferSize);
  if (buffer == NULL) {
    buffer = (uint8_t *)malloc(bufferSize);
  }
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
  printBridgeLogHeap("end received");

  const bool complete = receivedBytes == expectedBytes && receivedChunks == expectedChunks;
  if (activeBufferIndex < 0 && !takePrintBuffer()) {
    Serial.println("PrintBridge failed to take final print buffer");
    printBridgeLogHeap("final buf fail");
    sendPrintStatus("error", activePrintId, receivedBytes, receivedChunks);
    printActive = false;
    activePrintId = "";
    resetProgressLog();
    return;
  }
  if (!queueActivePrintBuffer(true, complete)) {
    Serial.println("PrintBridge failed to queue final print buffer");
    printBridgeLogHeap("final queue fail");
    sendPrintStatus("error", activePrintId, receivedBytes, receivedChunks);
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
  if (freePrintBuffers == NULL) {
    freePrintBuffers = xQueueCreate(PRINT_BUFFER_COUNT, sizeof(uint8_t));
  }
  if (fullPrintBuffers == NULL) {
    fullPrintBuffers = xQueueCreate(PRINT_BUFFER_COUNT, sizeof(uint8_t));
  }
  resetPrintBufferQueues();
  ensureUsbHostStarted();

  Serial.println("PrintBridge ready (TSPL over PeerJS; double-buffered printer task starts after USB ready)");
}

bool printBridgeWaitForPrinterReady(uint32_t timeoutMs) {
  return waitForUsbPrinterReady(timeoutMs);
}

bool printBridgePreparePrintResources() {
  if (!allocatePrintBuffers()) {
    return false;
  }
  resetPrintBufferQueues();
  return ensurePrintTaskStarted();
}

void printBridgeHandleDataChannelOpen() {
  ensureUsbHostStarted();
  if (usbReadyNotifyTaskHandle == NULL) {
    xTaskCreatePinnedToCore(
      printBridgeUsbReadyNotifyTask,
      "usb_ready_notify",
      4096,
      NULL,
      3,
      &usbReadyNotifyTaskHandle,
      1
    );
  }
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
  printBridgeLogHeap("channel close");
  printActive = false;
  activePrintId = "";
  dataChannelBuffer = "";
  if (!printTaskBusy) {
    resetPrintBufferQueues();
  }
  resetProgressLog();
}

bool printBridgeHandleDataChannelMessage(const char *msg, size_t len) {
  if (msg == NULL || len == 0) return false;

  if (msg[0] == '{' && memmem(msg, len, "\"cmd\":\"", 7) != NULL) {
    String json;
    json.reserve(len + 1);
    for (size_t i = 0; i < len; i++) {
      json += msg[i];
    }
    if (processPrintBridgeJson(json)) {
      return true;
    }
  }

  if (printActive && receivedBytes < expectedBytes) {
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
