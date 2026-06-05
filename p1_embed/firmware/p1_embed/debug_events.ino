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

static bool debugTextEquals(const char* a, const char* b) {
  if (!a) a = "";
  if (!b) b = "";
  return strcmp(a, b) == 0;
}

static bool debugTextStartsWith(const char* value, const char* prefix) {
  if (!value || !prefix) return false;
  return strncmp(value, prefix, strlen(prefix)) == 0;
}

static bool debugShouldMirrorMsgPack(const char* name) {
  return debugTextStartsWith(name, "script.") ||
         debugTextStartsWith(name, "debug.") ||
         debugTextStartsWith(name, "led.") ||
         debugTextStartsWith(name, "webrtc.") ||
         debugTextStartsWith(name, "ui.") ||
         debugTextEquals(name, "wifi.status");
}

static uint8_t debugLevelValue(const char* level) {
  if (debugTextEquals(level, "system")) return 0;
  if (debugTextEquals(level, "error")) return 0;
  if (debugTextEquals(level, "warn")) return 1;
  if (debugTextEquals(level, "info")) return 2;
  if (debugTextEquals(level, "debug")) return 3;
  if (debugTextEquals(level, "trace")) return 4;
  if (debugTextEquals(level, "silent")) return 255;
  return 2;
}

static uint8_t debugLevelValue(const String& level) {
  return debugLevelValue(level.c_str());
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

P1DebugSnapshot debugEventSnapshot() {
  P1DebugSnapshot snapshot;
  snapshot.level = debugLevelName(g_debugLevel);
  snapshot.levelValue = g_debugLevel;
  snapshot.queueDrops = g_debugQueueDrops;
  snapshot.queueHighWater = g_debugQueueHighWater;
  return snapshot;
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

static void debugAppendJsonEventField(String& out, const P1EventField& field) {
  if (!field.key) return;
  out += "\"";
  out += field.key;
  out += "\":";
  switch (field.type) {
    case P1_FIELD_STRING:
      out += jsonString(field.stringValue ? String(field.stringValue) : String(""));
      break;
    case P1_FIELD_INT:
      out += String(field.intValue);
      break;
    case P1_FIELD_UINT:
      out += String(field.uintValue);
      break;
    case P1_FIELD_BOOL:
      out += field.boolValue ? "true" : "false";
      break;
    case P1_FIELD_RAW_JSON:
      out += field.stringValue ? field.stringValue : "null";
      break;
  }
}

void debugEventSendLine(const String& line) {
  debugSendOrQueueLine(line);
}

void debugEventFlush() {
  if (!g_debugQueue) return;

  DebugQueuedEvent event;
  uint8_t sent = 0;
  while (sent < P1_EMBED_DEBUG_FLUSH_BUDGET && xQueueReceive(g_debugQueue, &event, 0) == pdTRUE) {
    transportSendLine(String(event.line));
    sent++;
  }
}

void debugEventEmit(const char* name, const char* level, const char* category, const char* message, const String& dataFieldsJson) {
  uint8_t value = debugLevelValue(level);
  if (value > g_debugLevel) return;

  if (!dataFieldsJson.length() &&
      debugShouldMirrorMsgPack(name)) {
    protocolEmitMsgPackEventFields(name, level, category, message, nullptr, 0);
  }

  String out = "{\"type\":\"evt\",\"name\":" + jsonString(name) + ",\"data\":{";
  out += "\"level\":" + jsonString(level);
  out += ",\"category\":" + jsonString(category);
  if (message && message[0]) out += ",\"message\":" + jsonString(message);
  if (dataFieldsJson.length()) out += "," + dataFieldsJson;
  out += "}}";
  debugSendOrQueueLine(out);
}

void debugEventEmit(const String& name, const String& level, const String& category, const String& message, const String& dataFieldsJson) {
  debugEventEmit(name.c_str(), level.c_str(), category.c_str(), message.c_str(), dataFieldsJson);
}

void debugEventEmitFields(const char* name, const char* level, const char* category, const char* message, const P1EventField* fields, size_t fieldCount) {
  uint8_t value = debugLevelValue(level);
  if (value > g_debugLevel) return;

  if (debugShouldMirrorMsgPack(name)) {
    protocolEmitMsgPackEventFields(name, level, category, message, fields, fieldCount);
  }

  String out = "{\"type\":\"evt\",\"name\":" + jsonString(name) + ",\"data\":{";
  out += "\"level\":" + jsonString(level);
  out += ",\"category\":" + jsonString(category);
  if (message && message[0]) out += ",\"message\":" + jsonString(message);
  for (size_t i = 0; i < fieldCount; i++) {
    out += ",";
    debugAppendJsonEventField(out, fields[i]);
  }
  out += "}}";
  debugSendOrQueueLine(out);
}

void debugEventEmitFields(const String& name, const String& level, const String& category, const String& message, const P1EventField* fields, size_t fieldCount) {
  debugEventEmitFields(name.c_str(), level.c_str(), category.c_str(), message.c_str(), fields, fieldCount);
}

void debugLog(const String& level, const String& category, const String& message) {
  debugLog(level.c_str(), category.c_str(), message.c_str());
}

void debugLog(const char* level, const char* category, const char* message) {
  debugEventEmitFields("debug.log", level, category, message, nullptr, 0);
}

void debugError(const String& category, const String& code, const String& message) {
  debugError(category.c_str(), code.c_str(), message.c_str());
}

void debugError(const char* category, const char* code, const char* message) {
  P1EventField fields[] = {
    p1FieldString("code", code),
  };
  debugEventEmitFields("debug.error", "error", category, message, fields, 1);
}
