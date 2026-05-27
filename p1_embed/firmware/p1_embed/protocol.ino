#include <Arduino.h>
#include <ESP.h>
#include <WiFi.h>
#include "p1_embed_firmware.h"
#include "p1_msgpack.h"

static const uint8_t P1_MP_FRAME_CMD = 0;
static const uint8_t P1_MP_FRAME_RES = 1;
static const uint8_t P1_MP_FRAME_EVT = 2;
static const uint8_t P1_MP_OP_PING = 1;
static const uint8_t P1_MP_OP_STATUS_LIGHT = 2;
static const uint8_t P1_MP_OP_SYSTEM_INFO = 3;
static const uint8_t P1_MP_OP_CONFIG_GET = 4;
static const uint8_t P1_MP_OP_CONFIG_SET = 5;
static const uint8_t P1_MP_OP_DEBUG_GET = 6;
static const uint8_t P1_MP_OP_DEBUG_SET = 7;
static const uint8_t P1_MP_OP_SCRIPT_GET = 8;
static const uint8_t P1_MP_OP_WIFI_STATUS = 9;
static const uint8_t P1_MP_OP_WIFI_CONNECT = 10;
static const uint8_t P1_MP_OP_WIFI_DISCONNECT = 11;
static const uint8_t P1_MP_OP_SCRIPT_ERROR_GET = 12;
static const uint8_t P1_MP_OP_SCRIPT_ERROR_CLEAR = 13;
static const uint8_t P1_MP_OP_SCRIPT_INPUT = 14;
static const uint8_t P1_MP_OP_SCRIPT_CHUNK_BEGIN = 19;
static const uint8_t P1_MP_OP_SCRIPT_CHUNK_ADD = 20;
static const uint8_t P1_MP_OP_SCRIPT_CHUNK_COMMIT = 21;
static const uint8_t P1_MP_OP_SCRIPT_STOP = 22;
static const uint8_t P1_MP_OP_SCRIPT_RESTART = 24;
static const uint8_t P1_MP_OP_DEVICE_REBOOT = 30;

static const char* protocolWifiStatusName(int status) {
  switch (status) {
    case WL_IDLE_STATUS: return "idle";
    case WL_NO_SSID_AVAIL: return "no_ssid";
    case WL_SCAN_COMPLETED: return "scan_completed";
    case WL_CONNECTED: return "connected";
    case WL_CONNECT_FAILED: return "connect_failed";
    case WL_CONNECTION_LOST: return "connection_lost";
    case WL_DISCONNECTED: return "disconnected";
  }
  return "unknown";
}

uint32_t protocolFnv1a(const String& s) {
  uint32_t h = 2166136261u;
  for (size_t i = 0; i < s.length(); i++) {
    h ^= (uint8_t)s[i];
    h *= 16777619u;
  }
  return h;
}

static bool protocolParseHexU32(const String& text, uint32_t& out) {
  if (text.length() == 0 || text.length() > 8) return false;
  uint32_t value = 0;
  for (size_t i = 0; i < text.length(); i++) {
    char c = text[i];
    uint8_t nibble;
    if (c >= '0' && c <= '9') nibble = c - '0';
    else if (c >= 'a' && c <= 'f') nibble = c - 'a' + 10;
    else if (c >= 'A' && c <= 'F') nibble = c - 'A' + 10;
    else return false;
    value = (value << 4) | nibble;
  }
  out = value;
  return true;
}

bool protocolValidateScriptIntegrity(const String& id, const String& code, int expectedBytes, const String& expectedHashHex) {
  if (expectedBytes >= 0 && (int)code.length() != expectedBytes) {
    protocolSendResponseError(id, "script_integrity_error", "script.set payload length mismatch");
    return false;
  }

  if (expectedHashHex.length()) {
    uint32_t expectedHash;
    if (!protocolParseHexU32(expectedHashHex, expectedHash)) {
      protocolSendResponseError(id, "script_integrity_error", "script.set payload hash is invalid");
      return false;
    }
    uint32_t actualHash = protocolFnv1a(code);
    if (actualHash != expectedHash) {
      protocolSendResponseError(id, "script_integrity_error", "script.set payload hash mismatch");
      return false;
    }
  }

  return true;
}

static bool protocolScriptIntegrityOk(const String& code, int expectedBytes, const String& expectedHashHex, String& codeOut, String& messageOut) {
  if (expectedBytes >= 0 && (int)code.length() != expectedBytes) {
    codeOut = "script_integrity_error";
    messageOut = "script.set payload length mismatch";
    return false;
  }

  if (expectedHashHex.length()) {
    uint32_t expectedHash;
    if (!protocolParseHexU32(expectedHashHex, expectedHash)) {
      codeOut = "script_integrity_error";
      messageOut = "script.set payload hash is invalid";
      return false;
    }
    uint32_t actualHash = protocolFnv1a(code);
    if (actualHash != expectedHash) {
      codeOut = "script_integrity_error";
      messageOut = "script.set payload hash mismatch";
      return false;
    }
  }

  return true;
}

class WrenchTransitionGuard {
 public:
  explicit WrenchTransitionGuard(const String& reason) {
    wrenchBeginTransition(reason);
  }

  ~WrenchTransitionGuard() {
    wrenchEndTransition();
  }
};

static String protocolBaseInfoJson() {
  String out = "{";
  out += "\"firmwareName\":" + jsonString(P1_EMBED_FIRMWARE_NAME);
  out += ",\"firmwareVersion\":" + jsonString(P1_EMBED_FIRMWARE_VERSION);
  out += ",\"buildChannel\":" + jsonString(P1_EMBED_BUILD_CHANNEL);
  out += ",\"protocolVersion\":" + jsonString(P1_EMBED_PROTOCOL_VERSION);
  out += ",\"wrenchApiVersion\":" + jsonString(P1_EMBED_WRENCH_API_VERSION);
  out += ",\"wrenchEngineVersion\":" + jsonString(String(WRENCH_VERSION_MAJOR) + "." + String(WRENCH_VERSION_MINOR) + "." + String(WRENCH_VERSION_BUILD));
  out += ",\"wrenchUpstreamRepo\":" + jsonString(P1_EMBED_WRENCH_UPSTREAM_REPO);
  out += ",\"wrenchUpstreamCommit\":" + jsonString(P1_EMBED_WRENCH_UPSTREAM_COMMIT);
  out += ",\"deviceId\":" + jsonString(configDeviceId());
  out += ",\"deviceName\":" + jsonString(configDeviceName());
  out += ",\"board\":\"esp32-classic\"";
  out += ",\"chipModel\":" + jsonString(ESP.getChipModel());
  out += ",\"chipRevision\":" + String(ESP.getChipRevision());
  out += ",\"sdkVersion\":" + jsonString(ESP.getSdkVersion());
  out += ",\"heapSize\":" + String(ESP.getHeapSize());
  out += ",\"capabilities\":[";
  for (int i = 0; i < P1_EMBED_CAPABILITY_COUNT; i++) {
    if (i) out += ",";
    out += jsonString(P1_EMBED_CAPABILITIES[i]);
  }
  out += "]}";
  return out;
}

static String protocolStatusFullJson() {
  String out = "{";
  out += "\"uptimeMs\":" + String(millis());
  out += ",\"heapSize\":" + String(ESP.getHeapSize());
  out += ",\"freeHeap\":" + String(ESP.getFreeHeap());
  out += ",\"minFreeHeap\":" + String(ESP.getMinFreeHeap());
  out += ",\"maxAllocHeap\":" + String(ESP.getMaxAllocHeap());
#if P1_EMBED_WRENCH_ENABLED
  out += ",\"scriptState\":" + jsonString(wrenchStateName());
#else
  out += ",\"scriptState\":\"disabled\"";
#endif
  out += ",\"scriptBytes\":" + String(wrenchCurrentScriptBytes());
  out += ",\"scriptHash\":" + String(wrenchCurrentScriptHash());
  out += ",\"hasSetup\":" + String(wrenchHasSetup() ? "true" : "false");
  out += ",\"hasLoop\":" + String(wrenchHasLoop() ? "true" : "false");
  out += ",\"wrenchTaskRunning\":" + String(wrenchTaskIsRunning() ? "true" : "false");
  out += ",\"wrenchLoopCount\":" + String(wrenchLoopCount());
  out += ",\"wrenchLastLoopMs\":" + String(wrenchLastLoopMs());
  out += ",\"wrenchLastLoopDurationMs\":" + String(wrenchLastLoopDurationMs());
  out += ",\"wrenchLoopFps\":" + String(wrenchLoopFps(), 2);
  out += ",\"wrenchCurrentLoopStartedAt\":" + String(wrenchCurrentLoopStartedAt());
  out += ",\"wrenchLoopHung\":" + String(wrenchLoopIsHung() ? "true" : "false");
  out += ",\"wrenchSlowLoopCount\":" + String(wrenchSlowLoopCount());
  out += ",\"wrenchHungLoopCount\":" + String(wrenchHungLoopCount());
  out += ",\"wrenchLockTimeoutCount\":" + String(wrenchLockTimeoutCount());
  out += ",\"wrenchTaskStackHighWater\":" + String(wrenchTaskStackHighWater());
  out += ",\"wrenchRuntime\":" + wrenchRuntimeStatusJson();
  out += ",\"wrenchInboxQueued\":" + String(wrenchInboxAvailable());
  out += ",\"wrenchInboxDrops\":" + String(wrenchInboxDrops());
  out += ",\"lastError\":" + scriptErrorSummaryJson();
  out += ",\"debug\":" + debugEventStatusJson();
  out += ",\"memory\":" + memoryProfileSummaryJson();
  out += ",\"web\":" + webTransportStatusJson();
  out += ",\"webrtc\":" + webrtcTransportStatusJson();
  out += ",\"led\":" + ledStatusJson();
  out += ",\"uart\":" + uartStatusJson();
  out += ",\"http\":" + httpFetchStatusJson();
  out += ",\"deviceId\":" + jsonString(configDeviceId());
  out += ",\"deviceName\":" + jsonString(configDeviceName());
#if P1_EMBED_WRENCH_ENABLED
  out += ",\"scriptStored\":" + String(scriptStoreHasSaved() ? "true" : "false");
  out += ",\"scriptRunState\":" + jsonString(scriptStoreRunStateName(scriptStoreLoadRunState()));
  out += ",\"scriptVerificationArmed\":" + String(scriptStoreVerificationArmed() ? "true" : "false");
#else
  out += ",\"scriptStored\":false";
  out += ",\"scriptRunState\":\"disabled\"";
  out += ",\"scriptVerificationArmed\":false";
#endif
  out += ",\"wifi\":" + wifiStatusJson();
  out += "}";
  return out;
}

static String protocolStatusJson() {
  String out;
  out.reserve(1800);
  out += "{";
  out += "\"uptimeMs\":" + String(millis());
  out += ",\"heapSize\":" + String(ESP.getHeapSize());
  out += ",\"freeHeap\":" + String(ESP.getFreeHeap());
  out += ",\"minFreeHeap\":" + String(ESP.getMinFreeHeap());
  out += ",\"maxAllocHeap\":" + String(ESP.getMaxAllocHeap());
#if P1_EMBED_WRENCH_ENABLED
  out += ",\"scriptState\":" + jsonString(wrenchStateName());
#else
  out += ",\"scriptState\":\"disabled\"";
#endif
  out += ",\"scriptBytes\":" + String(wrenchCurrentScriptBytes());
  out += ",\"scriptHash\":" + String(wrenchCurrentScriptHash());
  out += ",\"hasSetup\":" + String(wrenchHasSetup() ? "true" : "false");
  out += ",\"hasLoop\":" + String(wrenchHasLoop() ? "true" : "false");
  out += ",\"wrenchTaskRunning\":" + String(wrenchTaskIsRunning() ? "true" : "false");
  out += ",\"wrenchLoopCount\":" + String(wrenchLoopCount());
  out += ",\"wrenchLoopFps\":" + String(wrenchLoopFps(), 2);
  out += ",\"wrenchLoopHung\":" + String(wrenchLoopIsHung() ? "true" : "false");
  out += ",\"wrenchRuntime\":" + wrenchRuntimeStatusJson();
  out += ",\"lastError\":" + scriptErrorSummaryJson();
  out += ",\"memory\":" + memoryProfileSummaryJson();
  out += ",\"web\":" + webTransportStatusJson();
  out += ",\"webrtc\":" + webrtcTransportStatusJson();
  out += ",\"led\":" + ledStatusJson();
  out += ",\"deviceId\":" + jsonString(configDeviceId());
  out += ",\"deviceName\":" + jsonString(configDeviceName());
#if P1_EMBED_WRENCH_ENABLED
  out += ",\"scriptStored\":" + String(scriptStoreHasSaved() ? "true" : "false");
  out += ",\"scriptRunState\":" + jsonString(scriptStoreRunStateName(scriptStoreLoadRunState()));
#else
  out += ",\"scriptStored\":false";
  out += ",\"scriptRunState\":\"disabled\"";
#endif
  out += ",\"wifi\":" + wifiStatusJson();
  out += "}";
  return out;
}

static String protocolStatusLightJson() {
  String out;
  out.reserve(900);
  out += "{";
  out += "\"uptimeMs\":" + String(millis());
  out += ",\"heapSize\":" + String(ESP.getHeapSize());
  out += ",\"freeHeap\":" + String(ESP.getFreeHeap());
  out += ",\"minFreeHeap\":" + String(ESP.getMinFreeHeap());
  out += ",\"maxAllocHeap\":" + String(ESP.getMaxAllocHeap());
#if P1_EMBED_WRENCH_ENABLED
  out += ",\"scriptState\":" + jsonString(wrenchStateName());
#else
  out += ",\"scriptState\":\"disabled\"";
#endif
  out += ",\"scriptBytes\":" + String(wrenchCurrentScriptBytes());
  out += ",\"scriptHash\":" + String(wrenchCurrentScriptHash());
  out += ",\"hasSetup\":" + String(wrenchHasSetup() ? "true" : "false");
  out += ",\"hasLoop\":" + String(wrenchHasLoop() ? "true" : "false");
  out += ",\"wrenchTaskRunning\":" + String(wrenchTaskIsRunning() ? "true" : "false");
  out += ",\"wrenchLoopCount\":" + String(wrenchLoopCount());
  out += ",\"wrenchLoopFps\":" + String(wrenchLoopFps(), 2);
  out += ",\"wrenchLoopHung\":" + String(wrenchLoopIsHung() ? "true" : "false");
  out += ",\"webrtc\":" + webrtcTransportStatusJson();
  out += ",\"deviceId\":" + jsonString(configDeviceId());
  out += ",\"deviceName\":" + jsonString(configDeviceName());
#if P1_EMBED_WRENCH_ENABLED
  out += ",\"scriptStored\":" + String(scriptStoreHasSaved() ? "true" : "false");
  out += ",\"scriptRunState\":" + jsonString(scriptStoreRunStateName(scriptStoreLoadRunState()));
#else
  out += ",\"scriptStored\":false";
  out += ",\"scriptRunState\":\"disabled\"";
#endif
  out += ",\"wifi\":" + wifiStatusJson();
  out += "}";
  return out;
}

static String protocolStatusEventJson() {
  String out;
  out.reserve(900);
  out += "{";
  out += "\"uptimeMs\":" + String(millis());
  out += ",\"freeHeap\":" + String(ESP.getFreeHeap());
  out += ",\"minFreeHeap\":" + String(ESP.getMinFreeHeap());
  out += ",\"maxAllocHeap\":" + String(ESP.getMaxAllocHeap());
#if P1_EMBED_WRENCH_ENABLED
  out += ",\"scriptState\":" + jsonString(wrenchStateName());
#else
  out += ",\"scriptState\":\"disabled\"";
#endif
  out += ",\"scriptBytes\":" + String(wrenchCurrentScriptBytes());
  out += ",\"wrenchLoopFps\":" + String(wrenchLoopFps(), 2);
  out += ",\"wrenchTaskStackHighWater\":" + String(wrenchTaskStackHighWater());
  out += ",\"memory\":" + memoryProfileSummaryJson();
  out += ",\"webrtc\":" + webrtcTransportStatusJson();
  out += ",\"wifi\":" + wifiStatusJson();
  out += ",\"led\":" + ledStatusJson();
  out += "}";
  return out;
}

void protocolSendResponseOk(const String& id, const String& dataJson) {
  String out = "{\"type\":\"res\",\"id\":" + jsonString(id) + ",\"ok\":true,\"data\":";
  out += dataJson.length() ? dataJson : "{}";
  out += "}";
  transportSendLine(out);
}

void protocolSendResponseError(const String& id, const String& code, const String& message) {
  String out = "{\"type\":\"res\",\"id\":" + jsonString(id) + ",\"ok\":false,\"error\":{";
  out += "\"code\":" + jsonString(code);
  out += ",\"message\":" + jsonString(message);
  out += "}}";
  transportSendLine(out);
}

static void protocolMsgPackBeginEvent(P1MsgPackWriter& w, const char* name, uint32_t mapCount) {
  w.writeArray(3);
  w.writeUInt(P1_MP_FRAME_EVT);
  w.writeString(name);
  w.writeMap(mapCount);
}

static bool protocolFieldHasMsgPackValue(const P1EventField& field) {
  return field.key && field.type != P1_FIELD_RAW_JSON;
}

static size_t protocolEventFieldPayloadBytes(const P1EventField& field) {
  if (!field.key) return 0;
  size_t bytes = strlen(field.key) + 8;
  if ((field.type == P1_FIELD_STRING || field.type == P1_FIELD_RAW_JSON) && field.stringValue) {
    bytes += strlen(field.stringValue);
  }
  return bytes;
}

static void protocolMsgPackWriteEventField(P1MsgPackWriter& w, const P1EventField& field) {
  if (!protocolFieldHasMsgPackValue(field)) return;
  w.writeString(field.key);
  switch (field.type) {
    case P1_FIELD_STRING: w.writeString(field.stringValue ? field.stringValue : ""); break;
    case P1_FIELD_INT: w.writeInt(field.intValue); break;
    case P1_FIELD_UINT: w.writeUInt(field.uintValue); break;
    case P1_FIELD_BOOL: w.writeBool(field.boolValue); break;
    case P1_FIELD_RAW_JSON: break;
  }
}

static void protocolAppendJsonEventField(String& out, const P1EventField& field) {
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

void protocolEmitMsgPackEventFields(const char* name, const P1EventField* fields, size_t fieldCount) {
  protocolEmitMsgPackEventFields(name, nullptr, nullptr, nullptr, fields, fieldCount);
}

void protocolEmitMsgPackEventFields(const char* name, const char* level, const char* category, const char* message, const P1EventField* fields, size_t fieldCount) {
  uint32_t mapCount = 0;
  size_t capacity = 96 + (name ? strlen(name) : 0);
  if (level) { mapCount++; capacity += strlen(level) + 12; }
  if (category) { mapCount++; capacity += strlen(category) + 16; }
  if (message && message[0]) { mapCount++; capacity += strlen(message) + 16; }
  for (size_t i = 0; i < fieldCount; i++) {
    if (!protocolFieldHasMsgPackValue(fields[i])) continue;
    mapCount++;
    capacity += protocolEventFieldPayloadBytes(fields[i]);
  }
  capacity = min((size_t)P1_EMBED_WEBRTC_SEND_MAX_BYTES, max((size_t)160, capacity));
  uint8_t stackFrame[512];
  uint8_t* frame = capacity <= sizeof(stackFrame) ? stackFrame : static_cast<uint8_t*>(malloc(capacity));
  if (!frame) return;

  P1MsgPackWriter w(frame, capacity);
  protocolMsgPackBeginEvent(w, name ? name : "", mapCount);
  if (level) { w.writeString("level"); w.writeString(level); }
  if (category) { w.writeString("category"); w.writeString(category); }
  if (message && message[0]) { w.writeString("message"); w.writeString(message); }
  for (size_t i = 0; i < fieldCount; i++) {
    protocolMsgPackWriteEventField(w, fields[i]);
  }
  if (w.ok) webrtcTransportSendBytes(frame, w.length);
  if (frame != stackFrame) free(frame);
}

void protocolEmitEventFields(const char* name, const P1EventField* fields, size_t fieldCount) {
  String eventName = name ? String(name) : String("");
  if (eventName.startsWith("script.") || eventName.startsWith("wifi.") || eventName.startsWith("device.")) {
    int dot = eventName.indexOf('.');
    String category = dot > 0 ? eventName.substring(0, dot) : eventName;
    debugEventEmitFields(eventName, "info", category, "", fields, fieldCount);
    return;
  }
  if (eventName.startsWith("webrtc.")) {
    int dot = eventName.indexOf('.');
    String category = dot > 0 ? eventName.substring(0, dot) : eventName;
    debugEventEmitFields(eventName, "debug", category, "", fields, fieldCount);
    return;
  }

  String out = "{\"type\":\"evt\",\"name\":" + jsonString(eventName) + ",\"data\":{";
  for (size_t i = 0; i < fieldCount; i++) {
    if (i > 0) out += ",";
    protocolAppendJsonEventField(out, fields[i]);
  }
  out += "}}";
  transportSendLine(out);
}

void protocolEmitEvent(const String& name, const String& dataFieldsJson) {
  if (name.startsWith("script.") || name.startsWith("wifi.") || name.startsWith("device.")) {
    debugEventEmit(name, "info", name.substring(0, name.indexOf('.')), "", dataFieldsJson);
    return;
  }
  if (name == "webrtc.trace" || name == "webrtc.sdp") {
    String category = name.substring(0, name.indexOf('.'));
    debugEventEmit(name, "debug", category, "", dataFieldsJson);
    return;
  }
  String out = "{\"type\":\"evt\",\"name\":" + jsonString(name) + ",\"data\":{";
  out += dataFieldsJson;
  out += "}}";
  transportSendLine(out);
}

void protocolEmitErrorEvent(const String& name, const String& code, const String& message) {
  debugError(name, code, message);
}

void protocolEmitLog(const String& level, const String& message) {
  debugLog(level, "script", message);
}

void protocolEmitPrint(const String& message, bool newline) {
  P1EventField fields[] = {
    p1FieldBool("newline", newline),
  };
  debugEventEmitFields("script.print", "info", "script", message, fields, 1);
}

void protocolEmitBoot() {
  protocolEmitEvent("device.boot", "\"info\":" + protocolBaseInfoJson() + ",\"status\":" + protocolStatusJson());
}

void protocolEmitStatusEvent() {
  protocolEmitEvent("device.status", "\"status\":" + protocolStatusEventJson());
}

static String protocolScriptMetaJson(const String& code, const String& state) {
  String out = "{";
  out += "\"state\":" + jsonString(state);
  out += ",\"scriptBytes\":" + String(code.length());
  out += ",\"scriptHash\":" + String(protocolFnv1a(code));
  out += ",\"stored\":" + String(scriptStoreHasSaved() ? "true" : "false");
  out += ",\"runState\":" + jsonString(scriptStoreRunStateName(scriptStoreLoadRunState()));
  out += ",\"runPending\":" + String(wrenchRunIsPending() ? "true" : "false");
  out += "}";
  return out;
}

static bool g_scriptChunkActive = false;
static bool g_scriptChunkRun = false;
static bool g_scriptChunkSave = false;
static int g_scriptChunkExpectedBytes = -1;
static int g_scriptChunkReceivedBytes = 0;
static String g_scriptChunkExpectedHashHex;
static bool g_scriptJobPending = false;
static bool g_scriptJobRun = false;
static bool g_scriptJobSave = false;
static int g_scriptJobExpectedBytes = -1;
static String g_scriptJobExpectedHashHex;

static void protocolQueueScriptJob(bool runAfterSet, bool saveAfterSet, int expectedBytes, const String& expectedHashHex, size_t scriptBytes) {
  g_scriptJobPending = true;
  g_scriptJobRun = runAfterSet;
  g_scriptJobSave = saveAfterSet;
  g_scriptJobExpectedBytes = expectedBytes;
  g_scriptJobExpectedHashHex = expectedHashHex;
  P1EventField fields[] = {
    p1FieldString("state", "queued"),
    p1FieldUInt("scriptBytes", scriptBytes),
  };
  protocolEmitEventFields("script.upload", fields, 2);
}

bool protocolHandleScriptSetCode(const String& id, const String& code, bool runAfterSet, bool saveAfterSet, bool sendResponse) {
  String err;
  WrenchTransitionGuard transition("script.set");
  scriptErrorClear();
  {
    P1EventField fields[] = {
      p1FieldBool("run", runAfterSet),
      p1FieldBool("save", saveAfterSet),
      p1FieldUInt("scriptBytes", code.length()),
    };
    debugEventEmitFields("script.debug", "debug", "script", "script.set begin", fields, 3);
  }
  if (!wrenchCompileAndSet(code, err)) {
    wrenchSetCurrentScript(code);
    P1EventField debugFields[] = {
      p1FieldString("error", err),
    };
    debugEventEmitFields("script.debug", "debug", "script", "script.set compile failed", debugFields, 1);
    if (sendResponse) protocolSendResponseError(id, "compile_error", err);
    else {
      P1EventField fields[] = {
        p1FieldString("state", "error"),
        p1FieldString("phase", "compile"),
        p1FieldString("message", err),
      };
      protocolEmitEventFields("script.upload", fields, 3);
    }
    return false;
  }
  {
    P1EventField fields[] = {
      p1FieldBool("run", runAfterSet),
      p1FieldBool("save", saveAfterSet),
    };
    debugEventEmitFields("script.debug", "debug", "script", "script.set compile ok", fields, 2);
  }

  if (saveAfterSet) {
    if (!scriptStoreSave(code)) {
      debugEventEmitFields("script.debug", "debug", "script", "script.set save failed", nullptr, 0);
      if (sendResponse) protocolSendResponseError(id, "storage_error", "Failed to save script to LittleFS");
      else {
        P1EventField fields[] = {
          p1FieldString("state", "error"),
          p1FieldString("phase", "save"),
          p1FieldString("message", "Failed to save script to LittleFS"),
        };
        protocolEmitEventFields("script.upload", fields, 3);
      }
      return false;
    }
    scriptStoreSaveRunState(runAfterSet ? P1_EMBED_SCRIPT_RUN_PENDING_NEW : P1_EMBED_SCRIPT_RUN_OK);
    P1EventField fields[] = {
      p1FieldString("runState", scriptStoreRunStateName(scriptStoreLoadRunState())),
    };
    debugEventEmitFields("script.debug", "debug", "script", "script.set save ok", fields, 1);
  }

  if (runAfterSet) {
    String runErr;
    debugEventEmitFields("script.debug", "debug", "script", "script.set run begin", nullptr, 0);
    if (!wrenchRunCompiled(runErr)) {
      P1EventField debugFields[] = {
        p1FieldString("error", runErr),
      };
      debugEventEmitFields("script.debug", "debug", "script", "script.set run failed", debugFields, 1);
      if (sendResponse) protocolSendResponseError(id, "run_error", runErr);
      else {
        P1EventField fields[] = {
          p1FieldString("state", "error"),
          p1FieldString("phase", "run"),
          p1FieldString("message", runErr),
        };
        protocolEmitEventFields("script.upload", fields, 3);
      }
      return false;
    }
    P1EventField fields[] = {
      p1FieldString("state", wrenchStateName()),
    };
    debugEventEmitFields("script.debug", "debug", "script", "script.set run ok", fields, 1);
    if (saveAfterSet) scriptStoreArmVerification();
  }

  String state = runAfterSet ? "running" : (saveAfterSet ? "saved" : "compiled");
  {
    P1EventField fields[] = {
      p1FieldString("state", state),
    };
    debugEventEmitFields("script.debug", "debug", "script", "script.set response", fields, 1);
  }
  if (sendResponse) protocolSendResponseOk(id, protocolScriptMetaJson(code, state));
  else {
    P1EventField fields[] = {
      p1FieldString("state", state),
      p1FieldUInt("scriptBytes", code.length()),
      p1FieldUInt("scriptHash", protocolFnv1a(code)),
    };
    protocolEmitEventFields("script.upload", fields, 3);
  }
  return true;
}

static void protocolHandleScriptSet(const String& id, const char* line, bool runAfterSet, bool saveAfterSet) {
  String code;
  if (!jsonGetString(line, "code", code)) {
    protocolSendResponseError(id, "missing_code", "script.set requires data.code");
    return;
  }
  int expectedBytes = -1;
  String expectedHashHex;
  jsonGetInt(line, "codeBytes", expectedBytes);
  jsonGetString(line, "codeHash", expectedHashHex);
  if (!protocolValidateScriptIntegrity(id, code, expectedBytes, expectedHashHex)) return;
  if (!scriptStoreSaveIncoming(code)) {
    protocolSendResponseError(id, "storage_error", "Failed to stage script upload");
    return;
  }
  g_scriptChunkActive = false;
  g_scriptChunkExpectedHashHex = "";
  if (expectedBytes <= 0) expectedBytes = code.length();
  String response = "{\"state\":\"queued\",\"scriptBytes\":" + String(code.length());
  response += ",\"scriptHash\":" + String(protocolFnv1a(code));
  response += "}";
  protocolSendResponseOk(id, response);
  protocolQueueScriptJob(runAfterSet, saveAfterSet, expectedBytes, expectedHashHex, code.length());
}

static void protocolHandleScriptChunkBegin(const String& id, const char* line) {
  bool runAfterSet = false;
  bool saveAfterSet = false;
  int expectedBytes = -1;
  String expectedHashHex;
  jsonGetBool(line, "run", runAfterSet);
  jsonGetBool(line, "save", saveAfterSet);
  jsonGetInt(line, "codeBytes", expectedBytes);
  jsonGetString(line, "codeHash", expectedHashHex);
  if (expectedBytes <= 0 || expectedBytes > P1_EMBED_MAX_SCRIPT_BYTES) {
    protocolSendResponseError(id, "script_too_large", "Invalid script size");
    return;
  }
  if (expectedHashHex.length() == 0) {
    protocolSendResponseError(id, "missing_hash", "script.chunk.begin requires codeHash");
    return;
  }
  if (!scriptStoreBeginIncoming()) {
    protocolSendResponseError(id, "storage_error", "Failed to start staged script upload");
    return;
  }
  g_scriptChunkActive = true;
  g_scriptChunkRun = runAfterSet;
  g_scriptChunkSave = saveAfterSet;
  g_scriptChunkExpectedBytes = expectedBytes;
  g_scriptChunkReceivedBytes = 0;
  g_scriptChunkExpectedHashHex = expectedHashHex;
  protocolSendResponseOk(id, "{\"received\":0,\"expectedBytes\":" + String(expectedBytes) + "}");
}

static void protocolHandleScriptChunkAdd(const String& id, const char* line) {
  if (!g_scriptChunkActive) {
    protocolSendResponseError(id, "no_upload", "No chunked script upload is active");
    return;
  }
  int offset = -1;
  String chunk;
  jsonGetInt(line, "offset", offset);
  if (!jsonGetString(line, "chunk", chunk)) {
    protocolSendResponseError(id, "missing_chunk", "script.chunk.add requires chunk");
    return;
  }
  if (offset != g_scriptChunkReceivedBytes) {
    protocolSendResponseError(id, "bad_offset", "Script chunk offset did not match received bytes");
    return;
  }
  if (g_scriptChunkReceivedBytes + (int)chunk.length() > g_scriptChunkExpectedBytes) {
    protocolSendResponseError(id, "too_many_bytes", "Script chunk exceeds expected size");
    return;
  }
  if (!scriptStoreAppendIncoming(chunk)) {
    protocolSendResponseError(id, "storage_error", "Failed to append script chunk");
    return;
  }
  g_scriptChunkReceivedBytes += chunk.length();
  protocolSendResponseOk(id, "{\"received\":" + String(g_scriptChunkReceivedBytes) + "}");
}

static void protocolHandleScriptChunkCommit(const String& id) {
  if (!g_scriptChunkActive) {
    protocolSendResponseError(id, "no_upload", "No chunked script upload is active");
    return;
  }
  if (g_scriptChunkReceivedBytes != g_scriptChunkExpectedBytes) {
    protocolSendResponseError(id, "incomplete_upload", "Script upload is missing chunks");
    return;
  }
  String code;
  if (!scriptStoreLoadIncoming(code) || code.length() == 0) {
    scriptStoreClearIncoming();
    g_scriptChunkActive = false;
    protocolSendResponseError(id, "storage_error", "Failed to load staged script");
    return;
  }
  if (!protocolValidateScriptIntegrity(id, code, g_scriptChunkExpectedBytes, g_scriptChunkExpectedHashHex)) {
    scriptStoreClearIncoming();
    g_scriptChunkActive = false;
    return;
  }
  bool runAfterSet = g_scriptChunkRun;
  bool saveAfterSet = g_scriptChunkSave;
  g_scriptChunkActive = false;
  int expectedBytes = g_scriptChunkExpectedBytes;
  String expectedHashHex = g_scriptChunkExpectedHashHex;
  g_scriptChunkExpectedHashHex = "";
  protocolSendResponseOk(id, "{\"state\":\"queued\",\"scriptBytes\":" + String(code.length()) + "}");
  protocolQueueScriptJob(runAfterSet, saveAfterSet, expectedBytes, expectedHashHex, code.length());
}

void protocolPollScriptJobs() {
  if (!g_scriptJobPending) return;
  bool runAfterSet = g_scriptJobRun;
  bool saveAfterSet = g_scriptJobSave;
  int expectedBytes = g_scriptJobExpectedBytes;
  String expectedHashHex = g_scriptJobExpectedHashHex;
  g_scriptJobPending = false;
  g_scriptJobRun = false;
  g_scriptJobSave = false;
  g_scriptJobExpectedBytes = -1;
  g_scriptJobExpectedHashHex = "";

  String code;
  if (!scriptStoreLoadIncoming(code) || code.length() == 0) {
    scriptStoreClearIncoming();
    P1EventField fields[] = {
      p1FieldString("state", "error"),
      p1FieldString("phase", "load"),
      p1FieldString("message", "Failed to load staged script"),
    };
    protocolEmitEventFields("script.upload", fields, 3);
    return;
  }
  if (!protocolValidateScriptIntegrity("0", code, expectedBytes, expectedHashHex)) {
    scriptStoreClearIncoming();
    P1EventField fields[] = {
      p1FieldString("state", "error"),
      p1FieldString("phase", "integrity"),
      p1FieldString("message", "Script integrity check failed"),
    };
    protocolEmitEventFields("script.upload", fields, 3);
    return;
  }
  P1EventField fields[] = {
    p1FieldString("state", "compiling"),
    p1FieldUInt("scriptBytes", code.length()),
  };
  protocolEmitEventFields("script.upload", fields, 2);
  bool ok = protocolHandleScriptSetCode("0", code, runAfterSet, saveAfterSet, false);
  if (ok) {
    scriptStoreClearIncoming();
  }
}

static void protocolSendMsgPackStatusLight(uint32_t id) {
  uint8_t frame[P1_EMBED_MSGPACK_MAX_FRAME_BYTES];
  P1MsgPackWriter w(frame, sizeof(frame));
  w.writeArray(4);
  w.writeUInt(P1_MP_FRAME_RES);
  w.writeUInt(id);
  w.writeBool(true);
  w.writeMap(13);
  w.writeString("uptimeMs"); w.writeUInt(millis());
  w.writeString("heapSize"); w.writeUInt(ESP.getHeapSize());
  w.writeString("freeHeap"); w.writeUInt(ESP.getFreeHeap());
  w.writeString("maxAllocHeap"); w.writeUInt(ESP.getMaxAllocHeap());
  w.writeString("scriptState"); w.writeString(wrenchStateName());
  w.writeString("scriptBytes"); w.writeUInt(wrenchCurrentScriptBytes());
  w.writeString("scriptHash"); w.writeUInt(wrenchCurrentScriptHash());
  w.writeString("wrenchLoopFps"); w.writeFloat(wrenchLoopFps());
  w.writeString("wrenchTaskRunning"); w.writeBool(wrenchTaskIsRunning());
  w.writeString("deviceId"); w.writeString(configDeviceId());
  w.writeString("deviceName"); w.writeString(configDeviceName());
  w.writeString("protocol"); w.writeString("msgpack.v0_2");
  const int wifiStatus = WiFi.status();
  const bool wifiConnected = wifiStatus == WL_CONNECTED;
  w.writeString("wifi");
  w.writeMap(7);
  w.writeString("configured"); w.writeBool(configWifiNetworkCount() > 0);
  w.writeString("status"); w.writeString(protocolWifiStatusName(wifiStatus));
  w.writeString("connected"); w.writeBool(wifiConnected);
  w.writeString("ssid"); w.writeString(wifiConnected ? WiFi.SSID() : String(""));
  w.writeString("ip"); w.writeString(wifiConnected ? WiFi.localIP().toString() : String(""));
  w.writeString("rssi"); w.writeInt(wifiConnected ? WiFi.RSSI() : 0);
  w.writeString("mac"); w.writeString(WiFi.macAddress());
  if (w.ok) webrtcTransportSendBytes(frame, w.length);
}

static void protocolMsgPackWriteWifi(P1MsgPackWriter& w) {
  const int wifiStatus = WiFi.status();
  const bool wifiConnected = wifiStatus == WL_CONNECTED;
  w.writeMap(7);
  w.writeString("configured"); w.writeBool(configWifiNetworkCount() > 0);
  w.writeString("status"); w.writeString(protocolWifiStatusName(wifiStatus));
  w.writeString("connected"); w.writeBool(wifiConnected);
  w.writeString("ssid"); w.writeString(wifiConnected ? WiFi.SSID() : String(""));
  w.writeString("ip"); w.writeString(wifiConnected ? WiFi.localIP().toString() : String(""));
  w.writeString("rssi"); w.writeInt(wifiConnected ? WiFi.RSSI() : 0);
  w.writeString("mac"); w.writeString(WiFi.macAddress());
}

static void protocolMsgPackBeginResponse(P1MsgPackWriter& w, uint32_t id, bool ok, uint32_t mapCount) {
  w.writeArray(4);
  w.writeUInt(P1_MP_FRAME_RES);
  w.writeUInt(id);
  w.writeBool(ok);
  w.writeMap(mapCount);
}

static void protocolSendMsgPackSystemInfo(uint32_t id) {
  uint8_t frame[P1_EMBED_MSGPACK_MAX_FRAME_BYTES];
  P1MsgPackWriter w(frame, sizeof(frame));
  protocolMsgPackBeginResponse(w, id, true, 13);
  w.writeString("firmwareName"); w.writeString(P1_EMBED_FIRMWARE_NAME);
  w.writeString("firmwareVersion"); w.writeString(P1_EMBED_FIRMWARE_VERSION);
  w.writeString("buildChannel"); w.writeString(P1_EMBED_BUILD_CHANNEL);
  w.writeString("protocolVersion"); w.writeString(P1_EMBED_PROTOCOL_VERSION);
  w.writeString("wrenchApiVersion"); w.writeString(P1_EMBED_WRENCH_API_VERSION);
  w.writeString("deviceId"); w.writeString(configDeviceId());
  w.writeString("deviceName"); w.writeString(configDeviceName());
  w.writeString("board"); w.writeString("esp32-classic");
  w.writeString("chipModel"); w.writeString(ESP.getChipModel());
  w.writeString("sdkVersion"); w.writeString(ESP.getSdkVersion());
  w.writeString("heapSize"); w.writeUInt(ESP.getHeapSize());
  w.writeString("capabilities"); w.writeArray(4);
  w.writeString("transport.webrtc.msgpack");
  w.writeString("protocol.msgpack.v0_2");
  w.writeString("wrench.compile");
  w.writeString("wifi.station");
  w.writeString("wifi"); protocolMsgPackWriteWifi(w);
  if (w.ok) webrtcTransportSendBytes(frame, w.length);
}

static void protocolSendMsgPackConfig(uint32_t id) {
  uint8_t frame[P1_EMBED_MSGPACK_MAX_FRAME_BYTES];
  P1MsgPackWriter w(frame, sizeof(frame));
  protocolMsgPackBeginResponse(w, id, true, 7);
  w.writeString("deviceId"); w.writeString(configDeviceId());
  w.writeString("deviceName"); w.writeString(configDeviceName());
  w.writeString("wifiSsid"); w.writeString(configWifiSsid());
  w.writeString("wifiPasswordSet"); w.writeBool(configWifiPassword().length() > 0);
  w.writeString("wifiNetworkCount"); w.writeUInt(configWifiNetworkCount());
  w.writeString("storage"); w.writeString("littlefs:/config.json");
  w.writeString("wifi"); protocolMsgPackWriteWifi(w);
  if (w.ok) webrtcTransportSendBytes(frame, w.length);
}

static void protocolSendMsgPackWifiStatus(uint32_t id) {
  uint8_t frame[256];
  P1MsgPackWriter w(frame, sizeof(frame));
  protocolMsgPackBeginResponse(w, id, true, 1);
  w.writeString("wifi"); protocolMsgPackWriteWifi(w);
  if (w.ok) webrtcTransportSendBytes(frame, w.length);
}

static void protocolSendMsgPackDebug(uint32_t id) {
  uint8_t frame[160];
  P1MsgPackWriter w(frame, sizeof(frame));
  protocolMsgPackBeginResponse(w, id, true, 5);
  w.writeString("level"); w.writeString(debugLevelName(debugEventLevel()));
  w.writeString("levelName"); w.writeString(debugLevelName(debugEventLevel()));
  w.writeString("levelValue"); w.writeUInt(debugEventLevel());
  w.writeString("queueDrops"); w.writeUInt(debugEventDrops());
  w.writeString("queueHighWater"); w.writeUInt(debugEventHighWater());
  if (w.ok) webrtcTransportSendBytes(frame, w.length);
}

static void protocolSendMsgPackScriptError(uint32_t id) {
  uint8_t frame[512];
  P1MsgPackWriter w(frame, sizeof(frame));
  if (!scriptErrorHasLast()) {
    protocolMsgPackBeginResponse(w, id, true, 2);
    w.writeString("hasError"); w.writeBool(false);
    w.writeString("count"); w.writeUInt(scriptErrorCount());
  } else {
    String phase = scriptErrorLastPhase();
    String code = scriptErrorLastCode();
    String message = scriptErrorLastMessage();
    String details = scriptErrorLastDetails();
    const bool hasDetails = details.length() > 0 && details.length() < 128;
    protocolMsgPackBeginResponse(w, id, true, hasDetails ? 8 : 7);
    w.writeString("hasError"); w.writeBool(true);
    w.writeString("phase"); w.writeString(phase);
    w.writeString("code"); w.writeString(code);
    w.writeString("message"); w.writeString(message);
    w.writeString("atMs"); w.writeUInt(scriptErrorLastAtMs());
    w.writeString("count"); w.writeUInt(scriptErrorCount());
    w.writeString("detailText"); w.writeString(hasDetails ? details : "");
    if (hasDetails) {
      w.writeString("detailFormat");
      w.writeString("json-fields");
    }
  }
  if (w.ok) webrtcTransportSendBytes(frame, w.length);
}

static void protocolSendMsgPackScriptGet(uint32_t id) {
  String code = wrenchCurrentScript();
  size_t capacity = code.length() + 192;
  if (capacity < 512) capacity = 512;
  if (capacity > P1_EMBED_WEBRTC_SEND_MAX_BYTES) {
    protocolSendMsgPackError(id, "script_too_large", "Stored script is too large for one MessagePack response");
    return;
  }
  uint8_t* frame = static_cast<uint8_t*>(malloc(capacity));
  if (!frame) {
    protocolSendMsgPackError(id, "no_heap", "No heap for script.get response");
    return;
  }
  P1MsgPackWriter w(frame, capacity);
  protocolMsgPackBeginResponse(w, id, true, 4);
  w.writeString("code"); w.writeString(code);
  w.writeString("state"); w.writeString(wrenchStateName());
  w.writeString("stored"); w.writeBool(scriptStoreHasSaved());
  w.writeString("runState"); w.writeString(scriptStoreRunStateName(scriptStoreLoadRunState()));
  if (w.ok) webrtcTransportSendBytes(frame, w.length);
  free(frame);
  if (!w.ok) protocolSendMsgPackError(id, "frame_too_large", "Stored script did not fit in MessagePack response");
}

static void protocolSendMsgPackState(uint32_t id, const char* state) {
  uint8_t frame[96];
  P1MsgPackWriter w(frame, sizeof(frame));
  protocolMsgPackBeginResponse(w, id, true, 1);
  w.writeString("state"); w.writeString(state);
  if (w.ok) webrtcTransportSendBytes(frame, w.length);
}

static void protocolSendMsgPackPong(uint32_t id) {
  uint8_t frame[64];
  P1MsgPackWriter w(frame, sizeof(frame));
  w.writeArray(4);
  w.writeUInt(P1_MP_FRAME_RES);
  w.writeUInt(id);
  w.writeBool(true);
  w.writeMap(1);
  w.writeString("pong");
  w.writeBool(true);
  if (w.ok) webrtcTransportSendBytes(frame, w.length);
}

static void protocolSendMsgPackError(uint32_t id, const char* code, const char* message) {
  uint8_t frame[192];
  P1MsgPackWriter w(frame, sizeof(frame));
  w.writeArray(4);
  w.writeUInt(P1_MP_FRAME_RES);
  w.writeUInt(id);
  w.writeBool(false);
  w.writeMap(2);
  w.writeString("code"); w.writeString(code);
  w.writeString("message"); w.writeString(message);
  if (w.ok) webrtcTransportSendBytes(frame, w.length);
}

static void protocolSendMsgPackReceived(uint32_t id, uint32_t received) {
  uint8_t frame[64];
  P1MsgPackWriter w(frame, sizeof(frame));
  w.writeArray(4);
  w.writeUInt(P1_MP_FRAME_RES);
  w.writeUInt(id);
  w.writeBool(true);
  w.writeMap(1);
  w.writeString("received");
  w.writeUInt(received);
  if (w.ok) webrtcTransportSendBytes(frame, w.length);
}

static void protocolSendMsgPackInbox(uint32_t id) {
  uint8_t frame[96];
  P1MsgPackWriter w(frame, sizeof(frame));
  protocolMsgPackBeginResponse(w, id, true, 2);
  w.writeString("queued"); w.writeUInt(wrenchInboxAvailable());
  w.writeString("drops"); w.writeUInt(wrenchInboxDrops());
  if (w.ok) webrtcTransportSendBytes(frame, w.length);
}

static void protocolSendMsgPackChunkBeginOk(uint32_t id, int expectedBytes) {
  uint8_t frame[96];
  P1MsgPackWriter w(frame, sizeof(frame));
  protocolMsgPackBeginResponse(w, id, true, 2);
  w.writeString("received"); w.writeUInt(0);
  w.writeString("expectedBytes"); w.writeUInt(expectedBytes);
  if (w.ok) webrtcTransportSendBytes(frame, w.length);
}

static void protocolSendMsgPackChunkCommitOk(uint32_t id, int scriptBytes) {
  uint8_t frame[96];
  P1MsgPackWriter w(frame, sizeof(frame));
  protocolMsgPackBeginResponse(w, id, true, 2);
  w.writeString("state"); w.writeString("queued");
  w.writeString("scriptBytes"); w.writeUInt(scriptBytes);
  if (w.ok) webrtcTransportSendBytes(frame, w.length);
}

static void protocolHandleMsgPackScriptChunkBegin(uint32_t id, P1MsgPackReader& r) {
  uint32_t expectedBytes = 0;
  String expectedHashHex;
  bool runAfterSet = false;
  bool saveAfterSet = false;
  if (!r.readUInt(expectedBytes) || !r.readString(expectedHashHex) ||
      !r.readBool(runAfterSet) || !r.readBool(saveAfterSet)) {
    protocolSendMsgPackError(id, "bad_begin_frame", "script.chunk.begin frame is malformed");
    return;
  }
  if (expectedBytes == 0 || expectedBytes > P1_EMBED_MAX_SCRIPT_BYTES) {
    protocolSendMsgPackError(id, "script_too_large", "Invalid script size");
    return;
  }
  if (expectedHashHex.length() == 0) {
    protocolSendMsgPackError(id, "missing_hash", "script.chunk.begin requires codeHash");
    return;
  }
  if (!scriptStoreBeginIncoming()) {
    protocolSendMsgPackError(id, "storage_error", "Failed to start staged script upload");
    return;
  }
  g_scriptChunkActive = true;
  g_scriptChunkRun = runAfterSet;
  g_scriptChunkSave = saveAfterSet;
  g_scriptChunkExpectedBytes = expectedBytes;
  g_scriptChunkReceivedBytes = 0;
  g_scriptChunkExpectedHashHex = expectedHashHex;
  protocolSendMsgPackChunkBeginOk(id, expectedBytes);
}

static void protocolHandleMsgPackScriptChunkAdd(uint32_t id, const uint8_t* data, size_t len, size_t payloadOffset) {
  if (!g_scriptChunkActive) {
    protocolSendMsgPackError(id, "no_upload", "No chunked script upload is active");
    return;
  }
  P1MsgPackReader r(data, len);
  r.offset = payloadOffset;
  uint32_t offset = 0;
  const uint8_t* chunk = nullptr;
  size_t chunkLen = 0;
  if (!r.readUInt(offset) || !r.readBin(chunk, chunkLen)) {
    protocolSendMsgPackError(id, "bad_chunk_frame", "script.chunk.add frame requires offset and bytes");
    return;
  }
  if ((int)offset != g_scriptChunkReceivedBytes) {
    protocolSendMsgPackError(id, "bad_offset", "Script chunk offset did not match received bytes");
    return;
  }
  if (g_scriptChunkReceivedBytes + (int)chunkLen > g_scriptChunkExpectedBytes) {
    protocolSendMsgPackError(id, "too_many_bytes", "Script chunk exceeds expected size");
    return;
  }
  if (!scriptStoreAppendIncomingBytes(chunk, chunkLen)) {
    protocolSendMsgPackError(id, "storage_error", "Failed to append script chunk");
    return;
  }
  g_scriptChunkReceivedBytes += chunkLen;
  protocolSendMsgPackReceived(id, g_scriptChunkReceivedBytes);
}

void protocolHandleBytes(const uint8_t* data, size_t len) {
  if (!data || len == 0) return;
  if (data[0] == '{' || data[0] == '[') {
    protocolEmitErrorEvent("protocol.error", "json_on_binary_channel", "WebRTC data channel only accepts MessagePack frames");
    return;
  }

  P1MsgPackReader r(data, len);
  uint32_t count = 0;
  uint32_t frameType = 0;
  uint32_t id = 0;
  uint32_t op = 0;
  if (!r.readArray(count) || count < 3 || !r.readUInt(frameType) || !r.readUInt(id) || !r.readUInt(op)) {
    protocolEmitErrorEvent("protocol.error", "bad_msgpack", "Bad MessagePack frame");
    return;
  }
  if (frameType != P1_MP_FRAME_CMD) {
    protocolEmitErrorEvent("protocol.error", "bad_msgpack_type", "Expected MessagePack command frame");
    return;
  }

  if (op == P1_MP_OP_PING) {
    protocolSendMsgPackPong(id);
  } else if (op == P1_MP_OP_STATUS_LIGHT) {
    protocolSendMsgPackStatusLight(id);
  } else if (op == P1_MP_OP_SYSTEM_INFO) {
    protocolSendMsgPackSystemInfo(id);
  } else if (op == P1_MP_OP_CONFIG_GET) {
    protocolSendMsgPackConfig(id);
  } else if (op == P1_MP_OP_CONFIG_SET) {
    bool hasDeviceName = false;
    bool hasWifiSsid = false;
    bool hasWifiPassword = false;
    String deviceName;
    String wifiSsid;
    String wifiPassword;
    if (!r.readBool(hasDeviceName) || !r.readString(deviceName) ||
        !r.readBool(hasWifiSsid) || !r.readString(wifiSsid) ||
        !r.readBool(hasWifiPassword) || !r.readString(wifiPassword)) {
      protocolSendMsgPackError(id, "bad_config_frame", "config.set frame is malformed");
      return;
    }
    bool changed = false;
    if (hasDeviceName) {
      configSetDeviceName(deviceName);
      changed = true;
    }
    if (hasWifiSsid) {
      configSetWifiSsid(wifiSsid);
      changed = true;
    }
    if (hasWifiPassword) {
      configSetWifiPassword(wifiPassword);
      changed = true;
    }
    if (changed) {
      configSave();
      if (hasWifiSsid || hasWifiPassword) wifiReconnect();
    }
    protocolSendMsgPackConfig(id);
  } else if (op == P1_MP_OP_WIFI_STATUS) {
    protocolSendMsgPackWifiStatus(id);
  } else if (op == P1_MP_OP_WIFI_CONNECT) {
    wifiReconnect();
    protocolSendMsgPackWifiStatus(id);
  } else if (op == P1_MP_OP_WIFI_DISCONNECT) {
    wifiDisconnect();
    protocolSendMsgPackWifiStatus(id);
  } else if (op == P1_MP_OP_SCRIPT_ERROR_GET) {
    protocolSendMsgPackScriptError(id);
  } else if (op == P1_MP_OP_SCRIPT_ERROR_CLEAR) {
    scriptErrorClear();
    protocolSendMsgPackScriptError(id);
  } else if (op == P1_MP_OP_SCRIPT_INPUT) {
    String channel;
    String message;
    if (!r.readString(channel) || !r.readString(message) || message.length() == 0) {
      protocolSendMsgPackError(id, "missing_message", "script.input requires message");
      return;
    }
    if (!wrenchInboxPush(channel, message)) {
      protocolSendMsgPackError(id, "inbox_full", "Wrench input inbox is full");
      return;
    }
    protocolSendMsgPackInbox(id);
  } else if (op == P1_MP_OP_DEBUG_GET) {
    protocolSendMsgPackDebug(id);
  } else if (op == P1_MP_OP_DEBUG_SET) {
    String level;
    if (!r.readString(level)) {
      protocolSendMsgPackError(id, "missing_level", "debug.set requires level");
      return;
    }
    if (!debugEventSetLevelName(level)) {
      protocolSendMsgPackError(id, "bad_level", "Use error, warn, info, debug, or trace");
      return;
    }
    protocolSendMsgPackDebug(id);
  } else if (op == P1_MP_OP_SCRIPT_GET) {
    protocolSendMsgPackScriptGet(id);
  } else if (op == P1_MP_OP_SCRIPT_CHUNK_BEGIN) {
    protocolHandleMsgPackScriptChunkBegin(id, r);
  } else if (op == P1_MP_OP_SCRIPT_CHUNK_ADD) {
    protocolHandleMsgPackScriptChunkAdd(id, data, len, r.offset);
  } else if (op == P1_MP_OP_SCRIPT_CHUNK_COMMIT) {
    if (!g_scriptChunkActive) {
      protocolSendMsgPackError(id, "no_upload", "No chunked script upload is active");
      return;
    }
    if (g_scriptChunkReceivedBytes != g_scriptChunkExpectedBytes) {
      protocolSendMsgPackError(id, "incomplete_upload", "Script upload is missing chunks");
      return;
    }
    String code;
    if (!scriptStoreLoadIncoming(code) || code.length() == 0) {
      scriptStoreClearIncoming();
      g_scriptChunkActive = false;
      protocolSendMsgPackError(id, "storage_error", "Failed to load staged script");
      return;
    }
    String errorCode;
    String errorMessage;
    if (!protocolScriptIntegrityOk(code, g_scriptChunkExpectedBytes, g_scriptChunkExpectedHashHex, errorCode, errorMessage)) {
      scriptStoreClearIncoming();
      g_scriptChunkActive = false;
      protocolSendMsgPackError(id, errorCode.c_str(), errorMessage.c_str());
      return;
    }
    bool runAfterSet = g_scriptChunkRun;
    bool saveAfterSet = g_scriptChunkSave;
    g_scriptChunkActive = false;
    int expectedBytes = g_scriptChunkExpectedBytes;
    String expectedHashHex = g_scriptChunkExpectedHashHex;
    g_scriptChunkExpectedHashHex = "";
    protocolSendMsgPackChunkCommitOk(id, code.length());
    protocolQueueScriptJob(runAfterSet, saveAfterSet, expectedBytes, expectedHashHex, code.length());
  } else if (op == P1_MP_OP_SCRIPT_STOP) {
    wrenchStop();
    protocolSendMsgPackState(id, "stopped");
  } else if (op == P1_MP_OP_SCRIPT_RESTART) {
    if (wrenchCurrentScript().length() == 0) {
      protocolSendMsgPackError(id, "no_script", "No compiled script is available");
      return;
    }
    wrenchRequestRun();
    protocolSendMsgPackState(id, "run_pending");
  } else if (op == P1_MP_OP_DEVICE_REBOOT) {
    uint8_t frame[80];
    P1MsgPackWriter w(frame, sizeof(frame));
    protocolMsgPackBeginResponse(w, id, true, 1);
    w.writeString("rebooting"); w.writeBool(true);
    if (w.ok) webrtcTransportSendBytes(frame, w.length);
    delay(50);
    ESP.restart();
  } else {
    protocolEmitErrorEvent("protocol.error", "unknown_msgpack_op", "Unknown MessagePack command");
  }
}

void protocolHandleLine(const char* line) {
  String type;
  String id;
  String name;
  jsonGetString(line, "type", type);
  jsonGetString(line, "id", id);
  jsonGetString(line, "name", name);

  if (id.length() == 0) id = "0";
  if (type != "cmd") {
    protocolSendResponseError(id, "bad_type", "Expected JSON message with type=cmd");
    return;
  }
  if (name.length() == 0) {
    protocolSendResponseError(id, "missing_name", "Command missing name");
    return;
  }

  if (name == "ping") {
    protocolSendResponseOk(id, "{\"pong\":true}");
  } else if (name == "system.info") {
    protocolSendResponseOk(id, protocolBaseInfoJson());
  } else if (name == "status.get") {
    protocolSendResponseOk(id, protocolStatusJson());
  } else if (name == "status.light") {
    protocolSendResponseOk(id, protocolStatusLightJson());
  } else if (name == "status.full") {
    protocolSendResponseOk(id, protocolStatusFullJson());
  } else if (name == "memory.profile") {
    int limit = P1_EMBED_MEMORY_PROFILE_DEFAULT_LIMIT;
    jsonGetInt(line, "limit", limit);
    memoryProfileMark("protocol", "memory_profile");
    protocolSendResponseOk(id, memoryProfileJson(limit));
  } else if (name == "memory.profile.reset") {
    int limit = P1_EMBED_MEMORY_PROFILE_DEFAULT_LIMIT;
    jsonGetInt(line, "limit", limit);
    memoryProfileReset();
    protocolSendResponseOk(id, memoryProfileJson(limit));
  } else if (name == "webrtc.probe") {
    memoryProfileMark("webrtc", "probe");
    protocolSendResponseOk(id, webrtcTransportProbeJson());
  } else if (name == "config.get") {
    protocolSendResponseOk(id, configAsJson());
  } else if (name == "config.set") {
    String deviceName;
    String wifiSsid;
    String wifiPassword;
    bool changed = false;
    if (jsonGetString(line, "deviceName", deviceName)) {
      configSetDeviceName(deviceName);
      changed = true;
    }
    if (jsonGetString(line, "wifiSsid", wifiSsid)) {
      configSetWifiSsid(wifiSsid);
      changed = true;
    }
    if (jsonGetString(line, "wifiPassword", wifiPassword)) {
      configSetWifiPassword(wifiPassword);
      changed = true;
    }
    if (changed) {
      configSave();
      if (wifiSsid.length() || wifiPassword.length()) wifiReconnect();
    }
    protocolSendResponseOk(id, configAsJson());
  } else if (name == "wifi.status") {
    protocolSendResponseOk(id, wifiStatusJson());
  } else if (name == "wifi.connect") {
    wifiReconnect();
    protocolSendResponseOk(id, wifiStatusJson());
  } else if (name == "wifi.disconnect") {
    wifiDisconnect();
    protocolSendResponseOk(id, wifiStatusJson());
  } else if (name == "debug.get") {
    protocolSendResponseOk(id, debugEventStatusJson());
  } else if (name == "debug.set") {
    String level;
    if (!jsonGetString(line, "level", level)) {
      protocolSendResponseError(id, "missing_level", "debug.set requires data.level");
      return;
    }
    if (!debugEventSetLevelName(level)) {
      protocolSendResponseError(id, "bad_level", "Use error, warn, info, debug, or trace");
      return;
    }
    protocolSendResponseOk(id, debugEventStatusJson());
  } else if (name == "script.error.get") {
    protocolSendResponseOk(id, scriptErrorLastJson());
  } else if (name == "script.error.clear") {
    scriptErrorClear();
    protocolSendResponseOk(id, scriptErrorLastJson());
  } else if (!P1_EMBED_WRENCH_ENABLED && name == "script.get") {
    protocolSendResponseOk(id, "{\"code\":\"\",\"state\":\"disabled\",\"stored\":false,\"runState\":\"disabled\"}");
  } else if (!P1_EMBED_WRENCH_ENABLED && name == "script.stop") {
    protocolSendResponseOk(id, "{\"state\":\"disabled\"}");
  } else if (!P1_EMBED_WRENCH_ENABLED && (name.startsWith("script.") || name == "wrench.input")) {
    protocolSendResponseError(id, "wrench_disabled", "Wrench is disabled in this WebRTC lab firmware");
  } else if (name == "script.get") {
    String data = "{\"code\":" + jsonString(wrenchCurrentScript());
    data += ",\"state\":" + jsonString(wrenchStateName());
    data += ",\"stored\":" + String(scriptStoreHasSaved() ? "true" : "false");
    data += ",\"runState\":" + jsonString(scriptStoreRunStateName(scriptStoreLoadRunState()));
    data += "}";
    protocolSendResponseOk(id, data);
  } else if (name == "script.set") {
    bool runAfterSet = false;
    bool saveAfterSet = false;
    jsonGetBool(line, "run", runAfterSet);
    jsonGetBool(line, "save", saveAfterSet);
    protocolHandleScriptSet(id, line, runAfterSet, saveAfterSet);
  } else if (name == "script.chunk.begin") {
    protocolHandleScriptChunkBegin(id, line);
  } else if (name == "script.chunk.add") {
    protocolHandleScriptChunkAdd(id, line);
  } else if (name == "script.chunk.commit") {
    protocolHandleScriptChunkCommit(id);
  } else if (name == "script.input" || name == "wrench.input") {
    String channel;
    String message;
    jsonGetString(line, "channel", channel);
    if (!jsonGetString(line, "message", message)) {
      protocolSendResponseError(id, "missing_message", "script.input requires data.message");
      return;
    }
    if (!wrenchInboxPush(channel, message)) {
      protocolSendResponseError(id, "inbox_full", "Wrench input inbox is full");
      return;
    }
    protocolSendResponseOk(id, "{\"queued\":" + String(wrenchInboxAvailable()) + ",\"drops\":" + String(wrenchInboxDrops()) + "}");
  } else if (name == "script.save") {
    String code;
    if (!jsonGetString(line, "code", code)) code = wrenchCurrentScript();
    String err;
    WrenchTransitionGuard transition("script.save");
    if (!wrenchCompileAndSet(code, err)) {
      protocolSendResponseError(id, "compile_error", err);
      return;
    }
    if (!scriptStoreSave(code)) {
      protocolSendResponseError(id, "storage_error", "Failed to save script to LittleFS");
      return;
    }
    bool autorun = true;
    jsonGetBool(line, "autorun", autorun);
    scriptStoreSaveRunState(autorun ? P1_EMBED_SCRIPT_RUN_PENDING_NEW : P1_EMBED_SCRIPT_RUN_OK);
    protocolSendResponseOk(id, protocolScriptMetaJson(code, "saved"));
  } else if (name == "script.clear") {
    if (!scriptStoreClear()) {
      protocolSendResponseError(id, "storage_error", "Failed to clear saved script");
      return;
    }
    protocolSendResponseOk(id, "{\"stored\":false,\"runState\":\"none\"}");
  } else if (name == "script.compile") {
    String code;
    if (!jsonGetString(line, "code", code)) code = wrenchCurrentScript();
    String err;
    WrenchTransitionGuard transition(name);
    if (!wrenchCompileAndSet(code, err)) {
      protocolSendResponseError(id, "compile_error", err);
      return;
    }
    protocolSendResponseOk(id, protocolScriptMetaJson(code, "compiled"));
  } else if (name == "script.run") {
    String code;
    String err;
    wrenchStop();
    if (jsonGetString(line, "code", code)) {
      WrenchTransitionGuard transition("script.run.compile");
      if (!wrenchCompileAndSet(code, err)) {
        protocolSendResponseError(id, "compile_error", err);
        return;
      }
    } else {
      code = wrenchCurrentScript();
      if (code.length() == 0) {
        protocolSendResponseError(id, "no_script", "No compiled script is available");
        return;
      }
    }
    wrenchRequestRun();
    protocolSendResponseOk(id, "{\"state\":\"run_pending\",\"scriptBytes\":" + String(code.length()) + ",\"scriptHash\":" + String(protocolFnv1a(code)) + "}");
  } else if (name == "script.stop") {
    wrenchStop();
    protocolSendResponseOk(id, "{\"state\":\"stopped\"}");
  } else if (name == "script.restart") {
    if (wrenchCurrentScript().length() == 0) {
      protocolSendResponseError(id, "no_script", "No compiled script is available");
      return;
    }
    wrenchRequestRun();
    protocolSendResponseOk(id, "{\"state\":\"run_pending\"}");
  } else if (name == "device.reboot") {
    protocolSendResponseOk(id, "{\"rebooting\":true}");
    delay(50);
    ESP.restart();
  } else if (name == "device.factory_reset") {
    configFactoryReset();
    wifiDisconnect();
#if P1_EMBED_WRENCH_ENABLED
    scriptStoreClear();
    String defaultScript = wrenchDefaultScript();
    wrenchSetCurrentScript(defaultScript);
    String err;
    WrenchTransitionGuard transition("device.factory_reset");
    if (!wrenchCompileAndRun(defaultScript, err)) {
      protocolSendResponseError(id, "reset_compile_error", err);
      return;
    }
    protocolSendResponseOk(id, "{\"reset\":true,\"scriptState\":\"running\"}");
#else
    protocolSendResponseOk(id, "{\"reset\":true,\"scriptState\":\"disabled\"}");
#endif
  } else {
    protocolSendResponseError(id, "unknown_command", String("Unknown command: ") + name);
  }
}
