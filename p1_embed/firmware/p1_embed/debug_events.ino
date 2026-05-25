#include <Arduino.h>
#include "p1_embed_firmware.h"

struct DebugQueuedEvent {
  char line[P1_EMBED_PROTOCOL_QUEUE_LINE_MAX];
};

static TaskHandle_t g_debugMainTask = nullptr;
static QueueHandle_t g_debugQueue = nullptr;
static volatile uint32_t g_debugQueueDrops = 0;
static volatile uint32_t g_debugQueueHighWater = 0;
static uint8_t g_debugLevel = P1_EMBED_DEBUG_DEFAULT_LEVEL;

static uint8_t debugLevelValue(const String& level) {
  if (level == "error") return 0;
  if (level == "warn") return 1;
  if (level == "info") return 2;
  if (level == "debug") return 3;
  if (level == "trace") return 4;
  if (level == "silent") return 255;
  return 2;
}

const char* debugLevelName(uint8_t level) {
  switch (level) {
    case 0: return "error";
    case 1: return "warn";
    case 2: return "info";
    case 3: return "debug";
    case 4: return "trace";
  }
  return "silent";
}

void debugEventBegin() {
  g_debugMainTask = xTaskGetCurrentTaskHandle();
  if (!g_debugQueue) {
    g_debugQueue = xQueueCreate(P1_EMBED_PROTOCOL_QUEUE_DEPTH, sizeof(DebugQueuedEvent));
  }
}

static bool debugIsMainTask() {
  return !g_debugMainTask || xTaskGetCurrentTaskHandle() == g_debugMainTask;
}

void debugEventSetLevel(uint8_t level) {
  g_debugLevel = level > 4 ? 4 : level;
}

bool debugEventSetLevelName(const String& level) {
  if (level == "error") debugEventSetLevel(0);
  else if (level == "warn") debugEventSetLevel(1);
  else if (level == "info") debugEventSetLevel(2);
  else if (level == "debug") debugEventSetLevel(3);
  else if (level == "trace") debugEventSetLevel(4);
  else return false;
  return true;
}

uint8_t debugEventLevel() {
  return g_debugLevel;
}

uint32_t debugEventDrops() {
  return g_debugQueueDrops;
}

uint32_t debugEventHighWater() {
  return g_debugQueueHighWater;
}

String debugEventStatusJson() {
  String out = "{";
  out += "\"level\":" + jsonString(debugLevelName(g_debugLevel));
  out += ",\"levelValue\":" + String(g_debugLevel);
  out += ",\"queueDrops\":" + String(g_debugQueueDrops);
  out += ",\"queueHighWater\":" + String(g_debugQueueHighWater);
  out += "}";
  return out;
}

static void debugSendOrQueueLine(const String& line) {
  if (debugIsMainTask() || !g_debugQueue) {
    transportSendLine(line);
    return;
  }

  DebugQueuedEvent event;
  line.toCharArray(event.line, sizeof(event.line));
  if (xQueueSend(g_debugQueue, &event, 0) != pdTRUE) {
    g_debugQueueDrops++;
    return;
  }

  UBaseType_t waiting = uxQueueMessagesWaiting(g_debugQueue);
  if (waiting > g_debugQueueHighWater) g_debugQueueHighWater = waiting;
}

void debugEventSendLine(const String& line) {
  debugSendOrQueueLine(line);
}

void debugEventFlush() {
  if (!g_debugQueue) return;

  DebugQueuedEvent event;
  while (xQueueReceive(g_debugQueue, &event, 0) == pdTRUE) {
    transportSendLine(String(event.line));
  }
}

void debugEventEmit(const String& name, const String& level, const String& category, const String& message, const String& dataFieldsJson) {
  uint8_t value = debugLevelValue(level);
  if (value > g_debugLevel) return;

  String out = "{\"type\":\"evt\",\"name\":" + jsonString(name) + ",\"data\":{";
  out += "\"level\":" + jsonString(level);
  out += ",\"category\":" + jsonString(category);
  if (message.length()) out += ",\"message\":" + jsonString(message);
  if (dataFieldsJson.length()) out += "," + dataFieldsJson;
  out += "}}";
  debugSendOrQueueLine(out);
}

void debugLog(const String& level, const String& category, const String& message) {
  debugEventEmit("debug.log", level, category, message, "");
}

void debugError(const String& category, const String& code, const String& message) {
  debugEventEmit("debug.error", "error", category, message, "\"code\":" + jsonString(code));
}
