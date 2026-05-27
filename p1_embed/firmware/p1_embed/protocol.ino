#include <Arduino.h>
#include <ESP.h>
#include "p1_embed_firmware.h"

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
  out += ",\"fastled\":" + fastLedStatusJson();
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
  String out = "{\"type\":\"evt\",\"name\":\"script.print\",\"data\":{";
  out += "\"message\":" + jsonString(message);
  out += ",\"newline\":" + String(newline ? "true" : "false");
  out += "}}";
  debugEventSendLine(out);
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

bool protocolHandleScriptSetCode(const String& id, const String& code, bool runAfterSet, bool saveAfterSet, bool sendResponse) {
  String err;
  WrenchTransitionGuard transition("script.set");
  scriptErrorClear();
  debugEventEmit("script.debug", "debug", "script", "script.set begin", "\"run\":" + String(runAfterSet ? "true" : "false") + ",\"save\":" + String(saveAfterSet ? "true" : "false") + ",\"scriptBytes\":" + String(code.length()));
  if (!wrenchCompileAndSet(code, err)) {
    wrenchSetCurrentScript(code);
    debugEventEmit("script.debug", "debug", "script", "script.set compile failed", "\"error\":" + jsonString(err));
    if (sendResponse) protocolSendResponseError(id, "compile_error", err);
    else protocolEmitEvent("script.upload", "\"state\":\"error\",\"phase\":\"compile\",\"message\":" + jsonString(err));
    return false;
  }
  debugEventEmit("script.debug", "debug", "script", "script.set compile ok", "\"run\":" + String(runAfterSet ? "true" : "false") + ",\"save\":" + String(saveAfterSet ? "true" : "false"));

  if (saveAfterSet) {
    if (!scriptStoreSave(code)) {
      debugEventEmit("script.debug", "debug", "script", "script.set save failed");
      if (sendResponse) protocolSendResponseError(id, "storage_error", "Failed to save script to LittleFS");
      else protocolEmitEvent("script.upload", "\"state\":\"error\",\"phase\":\"save\",\"message\":\"Failed to save script to LittleFS\"");
      return false;
    }
    scriptStoreSaveRunState(runAfterSet ? P1_EMBED_SCRIPT_RUN_PENDING_NEW : P1_EMBED_SCRIPT_RUN_OK);
    debugEventEmit("script.debug", "debug", "script", "script.set save ok", "\"runState\":" + jsonString(scriptStoreRunStateName(scriptStoreLoadRunState())));
  }

  if (runAfterSet) {
    String runErr;
    debugEventEmit("script.debug", "debug", "script", "script.set run begin");
    if (!wrenchRunCompiled(runErr)) {
      debugEventEmit("script.debug", "debug", "script", "script.set run failed", "\"error\":" + jsonString(runErr));
      if (sendResponse) protocolSendResponseError(id, "run_error", runErr);
      else protocolEmitEvent("script.upload", "\"state\":\"error\",\"phase\":\"run\",\"message\":" + jsonString(runErr));
      return false;
    }
    debugEventEmit("script.debug", "debug", "script", "script.set run ok", "\"state\":" + jsonString(wrenchStateName()));
    if (saveAfterSet) scriptStoreArmVerification();
  }

  String state = runAfterSet ? "running" : (saveAfterSet ? "saved" : "compiled");
  debugEventEmit("script.debug", "debug", "script", "script.set response", "\"state\":" + jsonString(state));
  if (sendResponse) protocolSendResponseOk(id, protocolScriptMetaJson(code, state));
  else protocolEmitEvent("script.upload", "\"state\":" + jsonString(state) + ",\"scriptBytes\":" + String(code.length()) + ",\"scriptHash\":" + String(protocolFnv1a(code)));
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
  protocolHandleScriptSetCode(id, code, runAfterSet, saveAfterSet);
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
  g_scriptJobPending = true;
  g_scriptJobRun = runAfterSet;
  g_scriptJobSave = saveAfterSet;
  g_scriptJobExpectedBytes = g_scriptChunkExpectedBytes;
  g_scriptJobExpectedHashHex = g_scriptChunkExpectedHashHex;
  g_scriptChunkExpectedHashHex = "";
  protocolSendResponseOk(id, "{\"state\":\"queued\",\"scriptBytes\":" + String(code.length()) + "}");
  protocolEmitEvent("script.upload", "\"state\":\"queued\",\"scriptBytes\":" + String(code.length()));
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
    protocolEmitEvent("script.upload", "\"state\":\"error\",\"phase\":\"load\",\"message\":\"Failed to load staged script\"");
    return;
  }
  if (!protocolValidateScriptIntegrity("0", code, expectedBytes, expectedHashHex)) {
    scriptStoreClearIncoming();
    protocolEmitEvent("script.upload", "\"state\":\"error\",\"phase\":\"integrity\",\"message\":\"Script integrity check failed\"");
    return;
  }
  protocolEmitEvent("script.upload", "\"state\":\"compiling\",\"scriptBytes\":" + String(code.length()));
  if (protocolHandleScriptSetCode("0", code, runAfterSet, saveAfterSet, false)) {
    scriptStoreClearIncoming();
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
