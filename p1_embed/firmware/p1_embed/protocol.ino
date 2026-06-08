#include <Arduino.h>
#include <ESP.h>
#include <WiFi.h>
#include <esp_heap_caps.h>
#include <time.h>
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
static const uint8_t P1_MP_OP_WIFI_FORGET = 18;
static const uint8_t P1_MP_OP_SCRIPT_ERROR_GET = 12;
static const uint8_t P1_MP_OP_SCRIPT_ERROR_CLEAR = 13;
static const uint8_t P1_MP_OP_SCRIPT_INPUT = 14;
static const uint8_t P1_MP_OP_STATUS_GET = 15;
static const uint8_t P1_MP_OP_STATUS_FULL = 16;
static const uint8_t P1_MP_OP_STATUS_LIVE = 17;
static const uint8_t P1_MP_OP_SCRIPT_CHUNK_BEGIN = 19;
static const uint8_t P1_MP_OP_SCRIPT_CHUNK_ADD = 20;
static const uint8_t P1_MP_OP_SCRIPT_CHUNK_COMMIT = 21;
static const uint8_t P1_MP_OP_SCRIPT_STOP = 22;
static const uint8_t P1_MP_OP_SCRIPT_CHUNK_GET = 23;
static const uint8_t P1_MP_OP_SCRIPT_RESTART = 24;
static const uint8_t P1_MP_OP_DEVICE_REBOOT = 30;
static const uint8_t P1_MP_OP_FIRMWARE_UPDATE_STATUS = 40;
static const uint8_t P1_MP_OP_FIRMWARE_UPDATE_PREPARE = 41;
static const uint8_t P1_MP_OP_FIRMWARE_UPDATE_BOOT = 42;
static const uint8_t P1_MP_OP_FIRMWARE_UPDATE_CLEAR = 43;
static const uint8_t P1_MP_OP_PROTOCOL_MODE = 60;
static const size_t P1_PROTOCOL_FRAME_RETAIN_MIN = 512;
static const size_t P1_PROTOCOL_FRAME_RETAIN_MAX = P1_EMBED_MQTT_BUFFER_BYTES;

static P1ReusableBuffer g_protocolFrameBuffer;
static SemaphoreHandle_t g_protocolFrameBufferLock = nullptr;
static portMUX_TYPE g_protocolFrameBufferInitMux = portMUX_INITIALIZER_UNLOCKED;

static void protocolSendMsgPackError(uint32_t id, const char* code, const char* message);
static void protocolSendMsgPackBytes(const uint8_t* data, size_t len);
static void protocolSendMsgPackResponseBytes(uint32_t id, const uint8_t* data, size_t len, const char* tooLargeMessage);
static void protocolMsgPackBeginResponse(P1MsgPackWriter& w, uint32_t id, bool ok, uint32_t mapCount);
static void protocolSendMsgPackStatusLight(uint32_t id);
static void protocolSendMsgPackStatusGet(uint32_t id);
static void protocolSendMsgPackStatusFull(uint32_t id);
static void protocolSendMsgPackStatusLive(uint32_t id);
static void protocolSendJsonWifiStatus(const String& id);
static void protocolSendJsonDebugStatus(const String& id);
static void protocolSendJsonOtaStatus(const String& id);
static void protocolMsgPackWriteStatusLightData(P1MsgPackWriter& w, const P1StatusSnapshot& snapshot);
static void protocolMsgPackWriteStatusGetData(P1MsgPackWriter& w, const P1StatusSnapshot& snapshot);
static void protocolMsgPackWriteStatusFullData(P1MsgPackWriter& w, const P1StatusSnapshot& snapshot);
static void protocolMsgPackWriteStatusLiveData(P1MsgPackWriter& w, const P1StatusSnapshot& snapshot);
static void protocolSendMsgPackConfig(uint32_t id);
static void protocolSendMsgPackPong(uint32_t id);
static void protocolSendMsgPackSystemInfo(uint32_t id);
static void protocolSendMsgPackWifiStatus(uint32_t id);
static void protocolSendMsgPackDebug(uint32_t id);
static void protocolSendMsgPackScriptError(uint32_t id);
static void protocolSendMsgPackScriptGet(uint32_t id);
static void protocolSendMsgPackOtaStatus(uint32_t id);
static void protocolSendMsgPackState(uint32_t id, const char* state);
static void protocolSendMsgPackInbox(uint32_t id);
static void protocolSendMsgPackReceived(uint32_t id, uint32_t received);
static void protocolSendMsgPackChunkBeginOk(uint32_t id, int expectedBytes);
static void protocolSendMsgPackChunkCommitOk(uint32_t id, int scriptBytes);
static String protocolBaseInfoJson();
static String protocolConfigResponseJson(const P1ConfigSnapshot& snapshot);
static String protocolProjectWifiStatusToJson(const P1WifiSnapshot& snapshot);
static String protocolProjectHttpStatusToJson(const P1HttpFetchStatusSnapshot& snapshot);
static P1ScriptSnapshot protocolScriptSnapshot(const String* codeOverride, const char* stateOverride);
static String protocolScriptSnapshotJson(const P1ScriptSnapshot& snapshot, bool includeCode, bool includeMetrics);
static void protocolSendCommandConfig(P1ProtocolReplyMode replyMode, uint32_t msgpackId, const String& jsonId);
static bool protocolHandleCommandFrame(const P1FrameView& frame, P1ProtocolReplyMode replyMode, P1ProtocolSource source, const String& jsonId);

static SemaphoreHandle_t protocolFrameBufferLock() {
  if (g_protocolFrameBufferLock) return g_protocolFrameBufferLock;
  SemaphoreHandle_t created = xSemaphoreCreateMutex();
  if (!created) return nullptr;
  portENTER_CRITICAL(&g_protocolFrameBufferInitMux);
  if (!g_protocolFrameBufferLock) {
    g_protocolFrameBufferLock = created;
    created = nullptr;
  }
  SemaphoreHandle_t lock = g_protocolFrameBufferLock;
  portEXIT_CRITICAL(&g_protocolFrameBufferInitMux);
  if (created) vSemaphoreDelete(created);
  return lock;
}

static bool protocolAcquireFrameBuffer(size_t needed, P1ReusableBufferHandle& handle) {
  SemaphoreHandle_t lock = protocolFrameBufferLock();
  if (!lock) return false;
  if (xSemaphoreTake(lock, pdMS_TO_TICKS(250)) != pdTRUE) return false;
  if (p1ReusableBufferAcquire(g_protocolFrameBuffer, needed, P1_PROTOCOL_FRAME_RETAIN_MIN, P1_PROTOCOL_FRAME_RETAIN_MAX, handle)) {
    return true;
  }
  xSemaphoreGive(lock);
  return false;
}

static void protocolReleaseFrameBuffer(P1ReusableBufferHandle& handle) {
  p1ReusableBufferReleaseHandle(g_protocolFrameBuffer, handle);
  if (g_protocolFrameBufferLock) xSemaphoreGive(g_protocolFrameBufferLock);
}

void protocolPrepareMemoryPressure() {
  httpFetchPrepareMemoryPressure();
  SemaphoreHandle_t lock = protocolFrameBufferLock();
  if (!lock) return;
  if (xSemaphoreTake(lock, pdMS_TO_TICKS(50)) != pdTRUE) return;
  p1ReusableBufferRelease(g_protocolFrameBuffer);
  xSemaphoreGive(lock);
}

static bool protocolParseCommandFrame(const uint8_t* data, size_t len, P1FrameView& frame) {
  frame = P1FrameView();
  if (!data || len == 0) return false;
  P1MsgPackReader r(data, len);
  if (!r.readArray(frame.count) || frame.count < 3 ||
      !r.readUInt(frame.frameType) || !r.readUInt(frame.id) || !r.readUInt(frame.op)) {
    return false;
  }
  if (frame.frameType != P1_MP_FRAME_CMD) return false;
  frame.data = data;
  frame.len = len;
  frame.argsOffset = r.offset;
  return true;
}

static String protocolStringFromView(const P1StringView& view) {
  String out;
  if (view.empty()) return out;
  out.reserve(view.len);
  for (size_t i = 0; i < view.len; i++) out += view.data[i];
  return out;
}

static bool protocolParseJsonIdU32(const String& id, uint32_t& out) {
  out = 0;
  if (!id.length()) return true;
  uint32_t value = 0;
  for (size_t i = 0; i < id.length(); i++) {
    char c = id[i];
    if (c < '0' || c > '9') return false;
    uint32_t next = value * 10u + (uint32_t)(c - '0');
    if (next < value) return false;
    value = next;
  }
  out = value;
  return true;
}

static void protocolSendConfigSetError(P1ProtocolReplyMode replyMode, uint32_t msgpackId, const String& jsonId, const char* code, const char* message) {
  if (replyMode == P1_REPLY_MSGPACK) {
    protocolSendMsgPackError(msgpackId, code, message);
  } else {
    protocolSendResponseError(jsonId, code, message);
  }
}

static void protocolSendConfigSetOk(P1ProtocolReplyMode replyMode, uint32_t msgpackId, const String& jsonId) {
  protocolSendCommandConfig(replyMode, msgpackId, jsonId);
}

static void protocolSendCommandError(P1ProtocolReplyMode replyMode, uint32_t msgpackId, const String& jsonId, const char* code, const char* message) {
  if (replyMode == P1_REPLY_MSGPACK) {
    protocolSendMsgPackError(msgpackId, code, message);
  } else {
    protocolSendResponseError(jsonId, code, message);
  }
}

static void protocolSendCommandPong(P1ProtocolReplyMode replyMode, uint32_t msgpackId, const String& jsonId) {
  if (replyMode == P1_REPLY_MSGPACK) protocolSendMsgPackPong(msgpackId);
  else protocolSendResponseOk(jsonId, "{\"pong\":true}");
}

static void protocolSendCommandSystemInfo(P1ProtocolReplyMode replyMode, uint32_t msgpackId, const String& jsonId) {
  if (replyMode == P1_REPLY_MSGPACK) protocolSendMsgPackSystemInfo(msgpackId);
  else protocolSendResponseOk(jsonId, protocolBaseInfoJson());
}

static void protocolSendCommandStatusGet(P1ProtocolReplyMode replyMode, uint32_t msgpackId, const String& jsonId);
static void protocolSendCommandStatusFull(P1ProtocolReplyMode replyMode, uint32_t msgpackId, const String& jsonId);
static void protocolSendCommandStatusLive(P1ProtocolReplyMode replyMode, uint32_t msgpackId, const String& jsonId);

static const char* protocolSerialModeName(bool msgpackMode) {
  return msgpackMode ? "msgpack" : "json";
}

static String protocolModeResponseJson(bool msgpackMode) {
  String out = "{\"mode\":";
  out += jsonString(protocolSerialModeName(msgpackMode));
  out += ",\"framing\":\"p1mp.u16be\"}";
  return out;
}

static void protocolSendMsgPackMode(uint32_t id, bool msgpackMode) {
  uint8_t frame[96];
  P1MsgPackWriter w(frame, sizeof(frame));
  protocolMsgPackBeginResponse(w, id, true, 2);
  w.writeString("mode"); w.writeString(protocolSerialModeName(msgpackMode));
  w.writeString("framing"); w.writeString("p1mp.u16be");
  if (w.ok) protocolSendMsgPackBytes(frame, w.length);
}

static void protocolSendCommandProtocolMode(P1ProtocolReplyMode replyMode, uint32_t msgpackId, const String& jsonId, bool msgpackMode) {
  if (replyMode == P1_REPLY_MSGPACK) protocolSendMsgPackMode(msgpackId, msgpackMode);
  else protocolSendResponseOk(jsonId, protocolModeResponseJson(msgpackMode));
}

static void protocolSendCommandConfig(P1ProtocolReplyMode replyMode, uint32_t msgpackId, const String& jsonId) {
  if (replyMode == P1_REPLY_MSGPACK) {
    protocolSendMsgPackConfig(msgpackId);
    return;
  }
  P1ConfigSnapshot snapshot = configSnapshot();
  protocolSendResponseOk(jsonId, protocolConfigResponseJson(snapshot));
}

static bool protocolSourceAllowsOtaWrite(P1ProtocolSource source) {
  if (source == P1_PROTOCOL_SOURCE_SERIAL) return true;
  if (source == P1_PROTOCOL_SOURCE_MQTT) return mqttTransportCurrentSessionAuthenticated();
  return false;
}

static void protocolSendCommandWifiStatus(P1ProtocolReplyMode replyMode, uint32_t msgpackId, const String& jsonId) {
  if (replyMode == P1_REPLY_MSGPACK) protocolSendMsgPackWifiStatus(msgpackId);
  else protocolSendJsonWifiStatus(jsonId);
}

static void protocolSendCommandDebug(P1ProtocolReplyMode replyMode, uint32_t msgpackId, const String& jsonId) {
  if (replyMode == P1_REPLY_MSGPACK) protocolSendMsgPackDebug(msgpackId);
  else protocolSendJsonDebugStatus(jsonId);
}

static void protocolSendCommandScriptError(P1ProtocolReplyMode replyMode, uint32_t msgpackId, const String& jsonId) {
  if (replyMode == P1_REPLY_MSGPACK) protocolSendMsgPackScriptError(msgpackId);
  else protocolSendResponseOk(jsonId, scriptErrorLastJson());
}

static void protocolSendCommandScriptGet(P1ProtocolReplyMode replyMode, uint32_t msgpackId, const String& jsonId) {
  if (replyMode == P1_REPLY_MSGPACK) {
    protocolSendMsgPackScriptGet(msgpackId);
    return;
  }
  String code = wrenchCurrentScript();
  if (code.length() > P1_EMBED_LEGACY_SCRIPT_JSON_MAX_BYTES) {
    protocolSendResponseError(jsonId, "legacy_script_too_large", "script.get is limited; use script.chunk.get");
    return;
  }
  String response = protocolScriptSnapshotJson(protocolScriptSnapshot(&code, nullptr), true, false);
  if (response.length() < code.length()) {
    protocolSendResponseError(jsonId, "no_heap", "No heap for script.get response; use script.chunk.get");
    return;
  }
  protocolSendResponseOk(jsonId, response);
}

static bool protocolBuildScriptChunkGetResponse(uint32_t offset, uint32_t maxBytes, uint32_t maxChunkBytes, P1ScriptChunkGetResponse& out) {
  P1ScriptSnapshot snapshot = protocolScriptSnapshot(nullptr, nullptr);
  size_t totalBytes = 0;
  String chunk;
  if (!scriptStoreReadCurrentChunk(offset, 0, chunk, totalBytes)) return false;
  const uint32_t total = (uint32_t)totalBytes;
  if (offset > total) return false;
  if (maxBytes == 0 || maxBytes > maxChunkBytes) maxBytes = maxChunkBytes;
  uint32_t nextOffset = offset + maxBytes;
  if (nextOffset > total) nextOffset = total;
  if (!scriptStoreReadCurrentChunk(offset, nextOffset - offset, chunk, totalBytes)) return false;

  out.offset = offset;
  out.nextOffset = nextOffset;
  out.scriptBytes = total;
  out.done = nextOffset >= total;
  out.chunk = chunk;
  out.state = snapshot.state;
  out.runState = snapshot.runState;
  out.revisionId = configRevisionId();
  out.scriptName = configScriptName();
  return true;
}

static String protocolScriptChunkGetResponseJson(const P1ScriptChunkGetResponse& response) {
  String out;
  out.reserve(response.chunk.length() + response.revisionId.length() + response.scriptName.length() + 180);
  out += "{\"offset\":" + String(response.offset);
  out += ",\"nextOffset\":" + String(response.nextOffset);
  out += ",\"scriptBytes\":" + String(response.scriptBytes);
  out += ",\"done\":" + String(response.done ? "true" : "false");
  out += ",\"chunk\":" + jsonString(response.chunk);
  out += ",\"state\":" + jsonString(response.state);
  out += ",\"runState\":" + jsonString(response.runState);
  out += ",\"revisionId\":" + jsonString(response.revisionId);
  out += ",\"scriptName\":" + jsonString(response.scriptName);
  out += "}";
  return out;
}

static void protocolMsgPackWriteScriptChunkGetResponse(P1MsgPackWriter& w, uint32_t id, const P1ScriptChunkGetResponse& response) {
  protocolMsgPackBeginResponse(w, id, true, 9);
  w.writeString("offset"); w.writeUInt(response.offset);
  w.writeString("nextOffset"); w.writeUInt(response.nextOffset);
  w.writeString("scriptBytes"); w.writeUInt(response.scriptBytes);
  w.writeString("done"); w.writeBool(response.done);
  w.writeString("chunk"); w.writeString(response.chunk);
  w.writeString("state"); w.writeString(response.state);
  w.writeString("runState"); w.writeString(response.runState);
  w.writeString("revisionId"); w.writeString(response.revisionId);
  w.writeString("scriptName"); w.writeString(response.scriptName);
}

static void protocolSendMsgPackScriptChunkGet(uint32_t id, const P1ScriptChunkGetResponse& response) {
  size_t capacity = max<size_t>(P1_EMBED_MSGPACK_MAX_FRAME_BYTES, response.chunk.length() + response.revisionId.length() + response.scriptName.length() + 256);
  if (capacity > P1_EMBED_MQTT_BUFFER_BYTES) capacity = P1_EMBED_MQTT_BUFFER_BYTES;
  P1ReusableBufferHandle frame;
  if (!protocolAcquireFrameBuffer(capacity, frame)) {
    protocolSendMsgPackError(id, "no_heap", "No heap for script.chunk.get response");
    return;
  }
  P1MsgPackWriter w(frame.data, frame.capacity);
  protocolMsgPackWriteScriptChunkGetResponse(w, id, response);
  if (w.ok) protocolSendMsgPackResponseBytes(id, frame.data, w.length, "script.chunk.get response is too large for MQTT");
  if (!w.ok) protocolSendMsgPackError(id, "frame_too_large", "Script chunk did not fit in MessagePack response");
  protocolReleaseFrameBuffer(frame);
}

static void protocolSendCommandScriptChunkGet(P1ProtocolReplyMode replyMode, uint32_t msgpackId, const String& jsonId, uint32_t offset, uint32_t maxBytes) {
  P1ScriptChunkGetResponse response;
  const uint32_t maxChunkBytes = replyMode == P1_REPLY_MSGPACK ? P1_EMBED_MQTT_SCRIPT_CHUNK_BYTES : 1024;
  if (!protocolBuildScriptChunkGetResponse(offset, maxBytes, maxChunkBytes, response)) {
    protocolSendCommandError(replyMode, msgpackId, jsonId, "bad_offset", "script.chunk.get offset is beyond stored script");
    return;
  }
  if (replyMode == P1_REPLY_MSGPACK) {
    protocolSendMsgPackScriptChunkGet(msgpackId, response);
    return;
  }
  String json = protocolScriptChunkGetResponseJson(response);
  if (json.length() < response.chunk.length()) {
    protocolSendResponseError(jsonId, "no_heap", "No heap for script.chunk.get response");
    return;
  }
  protocolSendResponseOk(jsonId, json);
}

static void protocolSendCommandOtaStatus(P1ProtocolReplyMode replyMode, uint32_t msgpackId, const String& jsonId) {
  if (replyMode == P1_REPLY_MSGPACK) protocolSendMsgPackOtaStatus(msgpackId);
  else protocolSendJsonOtaStatus(jsonId);
}

static void protocolSendCommandState(P1ProtocolReplyMode replyMode, uint32_t msgpackId, const String& jsonId, const char* state, const char* runState = nullptr) {
  if (replyMode == P1_REPLY_MSGPACK) {
    protocolSendMsgPackState(msgpackId, state);
    return;
  }
  String response = "{\"state\":" + jsonString(state ? state : "");
  if (runState) response += ",\"runState\":" + jsonString(runState);
  response += "}";
  protocolSendResponseOk(jsonId, response);
}

static void protocolSendCommandInbox(P1ProtocolReplyMode replyMode, uint32_t msgpackId, const String& jsonId, bool uiQueued) {
  if (replyMode == P1_REPLY_MSGPACK) {
    protocolSendMsgPackInbox(msgpackId);
    return;
  }
  if (uiQueued) {
    protocolSendResponseOk(jsonId, "{\"ui\":true,\"queued\":" + String(uiInputQueued()) + ",\"drops\":" + String(uiInputDrops()) + "}");
  } else {
    protocolSendResponseOk(jsonId, "{\"queued\":" + String(wrenchInboxAvailable()) + ",\"drops\":" + String(wrenchInboxDrops()) + "}");
  }
}

static void protocolSendCommandReceived(P1ProtocolReplyMode replyMode, uint32_t msgpackId, const String& jsonId, uint32_t received) {
  if (replyMode == P1_REPLY_MSGPACK) protocolSendMsgPackReceived(msgpackId, received);
  else protocolSendResponseOk(jsonId, "{\"received\":" + String(received) + "}");
}

static void protocolSendCommandChunkBeginOk(P1ProtocolReplyMode replyMode, uint32_t msgpackId, const String& jsonId, uint32_t expectedBytes) {
  if (replyMode == P1_REPLY_MSGPACK) protocolSendMsgPackChunkBeginOk(msgpackId, expectedBytes);
  else protocolSendResponseOk(jsonId, "{\"received\":0,\"expectedBytes\":" + String(expectedBytes) + "}");
}

static void protocolSendCommandChunkCommitOk(P1ProtocolReplyMode replyMode, uint32_t msgpackId, const String& jsonId, uint32_t scriptBytes) {
  if (replyMode == P1_REPLY_MSGPACK) protocolSendMsgPackChunkCommitOk(msgpackId, scriptBytes);
  else protocolSendResponseOk(jsonId, "{\"state\":\"queued\",\"scriptBytes\":" + String(scriptBytes) + "}");
}

static bool protocolReadConfigStringView(P1MsgPackReader& r, bool& hasValue, P1StringView& value) {
  value = {nullptr, 0};
  return r.readBool(hasValue) && r.readStringView(value);
}

static bool protocolHandleConfigSetFrame(const P1FrameView& frame, P1ProtocolReplyMode replyMode, const String& jsonId) {
  P1MsgPackReader r(frame.data, frame.len);
  r.offset = frame.argsOffset;

  bool hasDeviceName = false;
  bool hasWifiSsid = false;
  bool hasWifiPassword = false;
  bool hasProjectId = false;
  bool hasProjectName = false;
  bool hasScriptName = false;
  bool hasTimezone = false;
  bool hasMqttHost = false;
  bool hasMqttPort = false;
  bool hasMqttRoot = false;
  bool hasMqttUser = false;
  bool hasMqttPassword = false;
  bool hasMqttEnabled = false;
  bool hasMqttAllowAnonymousUi = false;
  bool hasMqttAllowAnonymousScript = false;
  bool hasOnlineAuthUserAdd = false;
  bool hasOnlineAuthUserRemove = false;
  bool hasMqttGuestUiKey = false;
  bool hasRevisionId = false;
  bool hasAllowUnauthenticatedAccess = false;

  P1StringView deviceName;
  P1StringView wifiSsid;
  P1StringView wifiPassword;
  P1StringView projectId;
  P1StringView projectName;
  P1StringView revisionId;
  P1StringView scriptName;
  P1StringView timezone;
  P1StringView mqttHost;
  P1StringView mqttRoot;
  P1StringView mqttUser;
  P1StringView mqttPassword;
  P1StringView onlineAuthUsername;
  P1StringView onlineAuthKeyHex;
  P1StringView onlineAuthUserRemove;
  P1StringView mqttGuestUiKey;
  uint32_t mqttPort = 0;
  bool mqttEnabled = true;
  bool allowUnauthenticatedAccess = false;
  bool mqttAllowAnonymousUi = false;
  bool mqttAllowAnonymousScript = false;

  if (!protocolReadConfigStringView(r, hasDeviceName, deviceName) ||
      !protocolReadConfigStringView(r, hasWifiSsid, wifiSsid) ||
      !protocolReadConfigStringView(r, hasWifiPassword, wifiPassword)) {
    protocolSendConfigSetError(replyMode, frame.id, jsonId, "bad_config_frame", "config.set frame is malformed");
    return false;
  }
  if (frame.count >= 19) {
    if (!protocolReadConfigStringView(r, hasMqttHost, mqttHost) ||
        !r.readBool(hasMqttPort) || !r.readUInt(mqttPort) ||
        !protocolReadConfigStringView(r, hasMqttRoot, mqttRoot) ||
        !protocolReadConfigStringView(r, hasMqttUser, mqttUser) ||
        !protocolReadConfigStringView(r, hasMqttPassword, mqttPassword)) {
      protocolSendConfigSetError(replyMode, frame.id, jsonId, "bad_config_frame", "config.set MQTT fields are malformed");
      return false;
    }
  }
  if (frame.count >= 25) {
    if (!r.readBool(hasMqttEnabled) || !r.readBool(mqttEnabled) ||
        !r.readBool(hasMqttAllowAnonymousUi) || !r.readBool(mqttAllowAnonymousUi) ||
        !r.readBool(hasMqttAllowAnonymousScript) || !r.readBool(mqttAllowAnonymousScript)) {
      protocolSendConfigSetError(replyMode, frame.id, jsonId, "bad_config_frame", "config.set MQTT security fields are malformed");
      return false;
    }
  }
  if (frame.count >= 31) {
    if (!protocolReadConfigStringView(r, hasOnlineAuthUserAdd, onlineAuthUsername) ||
        !r.readStringView(onlineAuthKeyHex) ||
        !protocolReadConfigStringView(r, hasOnlineAuthUserRemove, onlineAuthUserRemove)) {
      protocolSendConfigSetError(replyMode, frame.id, jsonId, "bad_config_frame", "config.set online auth user fields are malformed");
      return false;
    }
  }
  if (frame.count >= 35) {
    if (!protocolReadConfigStringView(r, hasProjectId, projectId) ||
        !protocolReadConfigStringView(r, hasProjectName, projectName)) {
      protocolSendConfigSetError(replyMode, frame.id, jsonId, "bad_config_frame", "config.set project fields are malformed");
      return false;
    }
  }
  if (frame.count >= 37 && !protocolReadConfigStringView(r, hasScriptName, scriptName)) {
    protocolSendConfigSetError(replyMode, frame.id, jsonId, "bad_config_frame", "config.set script name field is malformed");
    return false;
  }
  if (frame.count >= 39 && !protocolReadConfigStringView(r, hasTimezone, timezone)) {
    protocolSendConfigSetError(replyMode, frame.id, jsonId, "bad_config_frame", "config.set timezone field is malformed");
    return false;
  }
  if (frame.count >= 41 && !protocolReadConfigStringView(r, hasMqttGuestUiKey, mqttGuestUiKey)) {
    protocolSendConfigSetError(replyMode, frame.id, jsonId, "bad_config_frame", "config.set guest UI key field is malformed");
    return false;
  }
  if (frame.count >= 43 && !protocolReadConfigStringView(r, hasRevisionId, revisionId)) {
    protocolSendConfigSetError(replyMode, frame.id, jsonId, "bad_config_frame", "config.set revision id field is malformed");
    return false;
  }
  if (frame.count >= 45 && (!r.readBool(hasAllowUnauthenticatedAccess) || !r.readBool(allowUnauthenticatedAccess))) {
    protocolSendConfigSetError(replyMode, frame.id, jsonId, "bad_config_frame", "config.set unauthenticated access fields are malformed");
    return false;
  }

  bool changed = false;
  bool mqttChanged = false;
  if (hasDeviceName) {
    configSetDeviceName(protocolStringFromView(deviceName));
    changed = true;
  }
  if (hasWifiSsid) {
    configSetWifiSsid(protocolStringFromView(wifiSsid));
    changed = true;
  }
  if (hasWifiPassword) {
    configSetWifiPassword(protocolStringFromView(wifiPassword));
    changed = true;
  }
  if (hasProjectId || hasProjectName) {
    configSetProject(hasProjectId ? protocolStringFromView(projectId) : configProjectId(),
                     hasProjectName ? protocolStringFromView(projectName) : configProjectName());
    changed = true;
  }
  if (hasScriptName) {
    configSetScriptName(protocolStringFromView(scriptName));
    changed = true;
  }
  if (hasRevisionId) {
    configSetRevisionId(protocolStringFromView(revisionId));
    changed = true;
  }
  if (hasTimezone) {
    configSetTimezone(protocolStringFromView(timezone));
    changed = true;
  }
  if (hasMqttHost) {
    configSetMqttHost(protocolStringFromView(mqttHost));
    changed = true;
    mqttChanged = true;
  }
  if (hasMqttPort) {
    configSetMqttPort((int)mqttPort);
    changed = true;
    mqttChanged = true;
  }
  if (hasMqttRoot) {
    configSetMqttRoot(protocolStringFromView(mqttRoot));
    changed = true;
    mqttChanged = true;
  }
  if (hasMqttUser) {
    configSetMqttUser(protocolStringFromView(mqttUser));
    changed = true;
    mqttChanged = true;
  }
  if (hasMqttPassword) {
    configSetMqttPassword(protocolStringFromView(mqttPassword));
    changed = true;
    mqttChanged = true;
  }
  if (hasMqttEnabled) {
    configSetMqttEnabled(mqttEnabled);
    changed = true;
    mqttChanged = true;
  }
  if (hasAllowUnauthenticatedAccess) {
    configSetAllowUnauthenticatedAccess(allowUnauthenticatedAccess);
    changed = true;
    mqttChanged = true;
  }
  if (hasMqttAllowAnonymousUi) {
    configSetMqttAllowAnonymousUi(mqttAllowAnonymousUi);
    changed = true;
  }
  if (hasMqttGuestUiKey) {
    configSetMqttGuestUiKey(protocolStringFromView(mqttGuestUiKey));
    changed = true;
  }
  if (hasMqttAllowAnonymousScript) {
    configSetMqttAllowAnonymousScript(mqttAllowAnonymousScript);
    changed = true;
  }
  if (hasOnlineAuthUserAdd) {
    P1OnlineAuthUserAddResult addResult = configAddOnlineAuthUserKeyChecked(
      protocolStringFromView(onlineAuthUsername),
      protocolStringFromView(onlineAuthKeyHex)
    );
    if (addResult != P1_ONLINE_AUTH_USER_ADDED) {
      const char* code = "bad_online_user";
      const char* message = "Invalid online user or key";
      if (addResult == P1_ONLINE_AUTH_USER_EMPTY_NAME) {
        code = "missing_online_user";
        message = "Online username is required";
      } else if (addResult == P1_ONLINE_AUTH_USER_BAD_KEY) {
        code = "bad_online_key";
        message = "Online user key must be 64 hex characters";
      } else if (addResult == P1_ONLINE_AUTH_USER_LIMIT) {
        code = "online_user_limit";
        message = "Online user limit reached";
      }
      protocolSendConfigSetError(replyMode, frame.id, jsonId, code, message);
      return false;
    }
    changed = true;
  }
  if (hasOnlineAuthUserRemove) {
    configRemoveOnlineAuthUser(protocolStringFromView(onlineAuthUserRemove));
    changed = true;
  }
  if (changed) {
    configSave();
    if (hasWifiSsid || hasWifiPassword) wifiReconnect();
    if (mqttChanged) mqttTransportRequestApplyConfig();
  }
  protocolSendConfigSetOk(replyMode, frame.id, jsonId);
  return true;
}

static void protocolMsgPackWriteBoolString(P1MsgPackWriter& w, bool hasValue, const String& value) {
  w.writeBool(hasValue);
  w.writeString(hasValue ? value : "");
}

static bool protocolJsonConfigSetToMsgPack(const char* line, const String& jsonId, uint8_t* out, size_t capacity, size_t& outLen) {
  outLen = 0;
  if (!line || !out || capacity == 0) return false;

  uint32_t msgpackId = 0;
  if (!protocolParseJsonIdU32(jsonId, msgpackId)) msgpackId = 0;

  String deviceName;
  String wifiSsid;
  String wifiPassword;
  String projectId;
  String projectName;
  String revisionId;
  String scriptName;
  String timezone;
  String mqttHost;
  String mqttRoot;
  String mqttUser;
  String mqttPassword;
  bool allowUnauthenticatedAccess = false;
  String onlineAuthUsername;
  String onlineAuthKeyHex;
  String onlineAuthUserRemove;
  String mqttGuestUiKey;

  bool hasDeviceName = jsonGetString(line, "deviceName", deviceName);
  bool hasWifiSsid = jsonGetString(line, "wifiSsid", wifiSsid);
  bool hasWifiPassword = jsonGetString(line, "wifiPassword", wifiPassword);
  bool hasProjectId = jsonGetString(line, "projectId", projectId);
  bool hasProjectName = jsonGetString(line, "projectName", projectName);
  bool hasRevisionId = jsonGetString(line, "revisionId", revisionId);
  bool hasScriptName = jsonGetString(line, "scriptName", scriptName);
  bool hasTimezone = jsonGetString(line, "timezone", timezone);
  bool hasMqttHost = jsonGetString(line, "mqttHost", mqttHost);
  bool hasMqttRoot = jsonGetString(line, "mqttRoot", mqttRoot);
  bool hasMqttUser = jsonGetString(line, "mqttUser", mqttUser);
  bool hasMqttPassword = jsonGetString(line, "mqttPassword", mqttPassword);
  bool hasAllowUnauthenticatedAccess = jsonGetBool(line, "allowUnauthenticatedAccess", allowUnauthenticatedAccess);
  bool hasOnlineAuthUserAdd = jsonGetString(line, "onlineAuthUsername", onlineAuthUsername) &&
                              jsonGetString(line, "onlineAuthKey", onlineAuthKeyHex);
  bool hasOnlineAuthUserRemove = jsonGetString(line, "onlineAuthUserRemove", onlineAuthUserRemove);
  bool hasMqttGuestUiKey = jsonGetString(line, "mqttGuestUiKey", mqttGuestUiKey);

  int mqttPortInt = 0;
  bool hasMqttPort = jsonGetInt(line, "mqttPort", mqttPortInt);
  bool mqttEnabled = true;
  bool hasMqttEnabled = jsonGetBool(line, "mqttEnabled", mqttEnabled);
  bool mqttAllowAnonymousUi = false;
  bool hasMqttAllowAnonymousUi = jsonGetBool(line, "mqttAllowAnonymousUi", mqttAllowAnonymousUi);
  bool mqttAllowAnonymousScript = false;
  bool hasMqttAllowAnonymousScript = jsonGetBool(line, "mqttAllowAnonymousScript", mqttAllowAnonymousScript);

  P1MsgPackWriter w(out, capacity);
  w.writeArray(45);
  w.writeUInt(P1_MP_FRAME_CMD);
  w.writeUInt(msgpackId);
  w.writeUInt(P1_MP_OP_CONFIG_SET);
  protocolMsgPackWriteBoolString(w, hasDeviceName, deviceName);
  protocolMsgPackWriteBoolString(w, hasWifiSsid, wifiSsid);
  protocolMsgPackWriteBoolString(w, hasWifiPassword, wifiPassword);
  protocolMsgPackWriteBoolString(w, hasMqttHost, mqttHost);
  w.writeBool(hasMqttPort);
  w.writeUInt((uint32_t)max(0, mqttPortInt));
  protocolMsgPackWriteBoolString(w, hasMqttRoot, mqttRoot);
  protocolMsgPackWriteBoolString(w, hasMqttUser, mqttUser);
  protocolMsgPackWriteBoolString(w, hasMqttPassword, mqttPassword);
  w.writeBool(hasMqttEnabled);
  w.writeBool(mqttEnabled);
  w.writeBool(hasMqttAllowAnonymousUi);
  w.writeBool(mqttAllowAnonymousUi);
  w.writeBool(hasMqttAllowAnonymousScript);
  w.writeBool(mqttAllowAnonymousScript);
  protocolMsgPackWriteBoolString(w, hasOnlineAuthUserAdd, onlineAuthUsername);
  w.writeString(hasOnlineAuthUserAdd ? onlineAuthKeyHex : "");
  protocolMsgPackWriteBoolString(w, hasOnlineAuthUserRemove, onlineAuthUserRemove);
  protocolMsgPackWriteBoolString(w, hasProjectId, projectId);
  protocolMsgPackWriteBoolString(w, hasProjectName, projectName);
  protocolMsgPackWriteBoolString(w, hasScriptName, scriptName);
  protocolMsgPackWriteBoolString(w, hasTimezone, timezone);
  protocolMsgPackWriteBoolString(w, hasMqttGuestUiKey, mqttGuestUiKey);
  protocolMsgPackWriteBoolString(w, hasRevisionId, revisionId);
  w.writeBool(hasAllowUnauthenticatedAccess);
  w.writeBool(allowUnauthenticatedAccess);
  if (!w.ok) return false;
  outLen = w.length;
  return true;
}

static bool protocolJsonNameToMsgPackOp(const String& name, uint32_t& op) {
  if (name == "ping") op = P1_MP_OP_PING;
  else if (name == "status.light") op = P1_MP_OP_STATUS_LIGHT;
  else if (name == "status.get") op = P1_MP_OP_STATUS_GET;
  else if (name == "status.full") op = P1_MP_OP_STATUS_FULL;
  else if (name == "status.live") op = P1_MP_OP_STATUS_LIVE;
  else if (name == "system.info") op = P1_MP_OP_SYSTEM_INFO;
  else if (name == "config.get") op = P1_MP_OP_CONFIG_GET;
  else if (name == "config.set") op = P1_MP_OP_CONFIG_SET;
  else if (name == "debug.get") op = P1_MP_OP_DEBUG_GET;
  else if (name == "debug.set") op = P1_MP_OP_DEBUG_SET;
  else if (name == "script.get") op = P1_MP_OP_SCRIPT_GET;
  else if (name == "wifi.status") op = P1_MP_OP_WIFI_STATUS;
  else if (name == "wifi.connect") op = P1_MP_OP_WIFI_CONNECT;
  else if (name == "wifi.disconnect") op = P1_MP_OP_WIFI_DISCONNECT;
  else if (name == "wifi.forget") op = P1_MP_OP_WIFI_FORGET;
  else if (name == "script.error.get") op = P1_MP_OP_SCRIPT_ERROR_GET;
  else if (name == "script.error.clear") op = P1_MP_OP_SCRIPT_ERROR_CLEAR;
  else if (name == "script.input" || name == "wrench.input") op = P1_MP_OP_SCRIPT_INPUT;
  else if (name == "script.chunk.begin") op = P1_MP_OP_SCRIPT_CHUNK_BEGIN;
  else if (name == "script.chunk.add") op = P1_MP_OP_SCRIPT_CHUNK_ADD;
  else if (name == "script.chunk.commit") op = P1_MP_OP_SCRIPT_CHUNK_COMMIT;
  else if (name == "script.stop") op = P1_MP_OP_SCRIPT_STOP;
  else if (name == "script.chunk.get") op = P1_MP_OP_SCRIPT_CHUNK_GET;
  else if (name == "script.restart") op = P1_MP_OP_SCRIPT_RESTART;
  else if (name == "device.reboot") op = P1_MP_OP_DEVICE_REBOOT;
  else if (name == "firmware.update.status") op = P1_MP_OP_FIRMWARE_UPDATE_STATUS;
  else if (name == "firmware.update.prepare") op = P1_MP_OP_FIRMWARE_UPDATE_PREPARE;
  else if (name == "firmware.update.boot") op = P1_MP_OP_FIRMWARE_UPDATE_BOOT;
  else if (name == "firmware.update.clear") op = P1_MP_OP_FIRMWARE_UPDATE_CLEAR;
  else if (name == "protocol.mode") op = P1_MP_OP_PROTOCOL_MODE;
  else return false;
  return true;
}

static bool protocolJsonCommandToMsgPack(const char* line, const String& jsonId, const String& name, uint8_t* out, size_t capacity, size_t& outLen) {
  outLen = 0;
  uint32_t op = 0;
  if (!protocolJsonNameToMsgPackOp(name, op)) return false;
  if (op == P1_MP_OP_CONFIG_SET) return protocolJsonConfigSetToMsgPack(line, jsonId, out, capacity, outLen);

  uint32_t msgpackId = 0;
  if (!protocolParseJsonIdU32(jsonId, msgpackId)) msgpackId = 0;

  P1MsgPackWriter w(out, capacity);
  if (op == P1_MP_OP_DEBUG_SET) {
    String level;
    jsonGetString(line, "level", level);
    w.writeArray(4);
    w.writeUInt(P1_MP_FRAME_CMD);
    w.writeUInt(msgpackId);
    w.writeUInt(op);
    w.writeString(level);
  } else if (op == P1_MP_OP_WIFI_FORGET) {
    int index = 0;
    jsonGetInt(line, "index", index);
    w.writeArray(4);
    w.writeUInt(P1_MP_FRAME_CMD);
    w.writeUInt(msgpackId);
    w.writeUInt(op);
    w.writeUInt((uint32_t)max(0, index));
  } else if (op == P1_MP_OP_SCRIPT_INPUT) {
    String channel;
    String message;
    jsonGetString(line, "channel", channel);
    jsonGetString(line, "message", message);
    w.writeArray(5);
    w.writeUInt(P1_MP_FRAME_CMD);
    w.writeUInt(msgpackId);
    w.writeUInt(op);
    w.writeString(channel);
    w.writeString(message);
  } else if (op == P1_MP_OP_SCRIPT_CHUNK_BEGIN) {
    int expectedBytes = 0;
    String expectedHashHex;
    bool runAfterSet = false;
    bool saveAfterSet = false;
    jsonGetInt(line, "codeBytes", expectedBytes);
    jsonGetString(line, "codeHash", expectedHashHex);
    jsonGetBool(line, "run", runAfterSet);
    jsonGetBool(line, "save", saveAfterSet);
    w.writeArray(7);
    w.writeUInt(P1_MP_FRAME_CMD);
    w.writeUInt(msgpackId);
    w.writeUInt(op);
    w.writeUInt((uint32_t)max(0, expectedBytes));
    w.writeString(expectedHashHex);
    w.writeBool(runAfterSet);
    w.writeBool(saveAfterSet);
  } else if (op == P1_MP_OP_SCRIPT_CHUNK_ADD) {
    int offset = 0;
    String chunk;
    jsonGetInt(line, "offset", offset);
    jsonGetString(line, "chunk", chunk);
    w.writeArray(5);
    w.writeUInt(P1_MP_FRAME_CMD);
    w.writeUInt(msgpackId);
    w.writeUInt(op);
    w.writeUInt((uint32_t)max(0, offset));
    w.writeBin(reinterpret_cast<const uint8_t*>(chunk.c_str()), chunk.length());
  } else if (op == P1_MP_OP_SCRIPT_CHUNK_GET) {
    int offset = 0;
    int maxBytes = 512;
    jsonGetInt(line, "offset", offset);
    jsonGetInt(line, "maxBytes", maxBytes);
    w.writeArray(5);
    w.writeUInt(P1_MP_FRAME_CMD);
    w.writeUInt(msgpackId);
    w.writeUInt(op);
    w.writeUInt((uint32_t)max(0, offset));
    w.writeUInt((uint32_t)max(1, maxBytes));
  } else if (op == P1_MP_OP_PROTOCOL_MODE) {
    String mode;
    jsonGetString(line, "mode", mode);
    mode.toLowerCase();
    w.writeArray(4);
    w.writeUInt(P1_MP_FRAME_CMD);
    w.writeUInt(msgpackId);
    w.writeUInt(op);
    w.writeString(mode);
  } else if (op == P1_MP_OP_FIRMWARE_UPDATE_PREPARE) {
    String url;
    String sha256;
    String kind;
    String fromSha256;
    String toSha256;
    int value = 0;
    uint32_t fromSize = 0;
    uint32_t toSize = 0;
    uint32_t memorySize = 0;
    uint32_t segmentSize = 0;
    bool reboot = false;
    jsonGetString(line, "url", url);
    jsonGetString(line, "sha256", sha256);
    jsonGetString(line, "kind", kind);
    jsonGetString(line, "fromSha256", fromSha256);
    jsonGetString(line, "toSha256", toSha256);
    if (jsonGetInt(line, "fromSize", value)) fromSize = (uint32_t)max(0, value);
    if (jsonGetInt(line, "toSize", value)) toSize = (uint32_t)max(0, value);
    if (jsonGetInt(line, "memorySize", value)) memorySize = (uint32_t)max(0, value);
    if (jsonGetInt(line, "segmentSize", value)) segmentSize = (uint32_t)max(0, value);
    jsonGetBool(line, "reboot", reboot);
    w.writeArray(13);
    w.writeUInt(P1_MP_FRAME_CMD);
    w.writeUInt(msgpackId);
    w.writeUInt(op);
    w.writeString(url);
    w.writeString(sha256);
    w.writeBool(reboot);
    w.writeString(kind);
    w.writeString(fromSha256);
    w.writeString(toSha256);
    w.writeUInt(fromSize);
    w.writeUInt(toSize);
    w.writeUInt(memorySize);
    w.writeUInt(segmentSize);
  } else {
    w.writeArray(3);
    w.writeUInt(P1_MP_FRAME_CMD);
    w.writeUInt(msgpackId);
    w.writeUInt(op);
  }
  if (!w.ok) return false;
  outLen = w.length;
  return true;
}

static const char* protocolJsonSkipWs(const char* p) {
  while (p && *p && (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n')) p++;
  return p;
}

static const char* protocolJsonSkipString(const char* p) {
  p = protocolJsonSkipWs(p);
  if (!p || *p != '"') return p;
  p++;
  while (*p) {
    char c = *p++;
    if (c == '\\') {
      if (*p) p++;
    } else if (c == '"') {
      return p;
    }
  }
  return p;
}

static const char* protocolJsonSkipValue(const char* p);

static const char* protocolJsonSkipContainer(const char* p, char open, char close) {
  p = protocolJsonSkipWs(p);
  if (!p || *p != open) return p;
  p++;
  while (*p) {
    p = protocolJsonSkipWs(p);
    if (*p == close) return p + 1;
    if (open == '{') {
      if (*p != '"') return p;
      p = protocolJsonSkipString(p);
      p = protocolJsonSkipWs(p);
      if (*p != ':') return p;
      p = protocolJsonSkipValue(p + 1);
    } else {
      p = protocolJsonSkipValue(p);
    }
    p = protocolJsonSkipWs(p);
    if (*p == ',') {
      p++;
      continue;
    }
    if (*p == close) return p + 1;
    return p;
  }
  return p;
}

static const char* protocolJsonSkipValue(const char* p) {
  p = protocolJsonSkipWs(p);
  if (!p || !*p) return p;
  if (*p == '"') return protocolJsonSkipString(p);
  if (*p == '{') return protocolJsonSkipContainer(p, '{', '}');
  if (*p == '[') return protocolJsonSkipContainer(p, '[', ']');
  while (*p && *p != ',' && *p != '}' && *p != ']') p++;
  return p;
}

static bool protocolJsonParseStringToken(const char*& p, String& out) {
  out = "";
  p = protocolJsonSkipWs(p);
  if (!p || *p != '"') return false;
  p++;
  while (*p) {
    char c = *p++;
    if (c == '"') return true;
    if (c == '\\') {
      char e = *p++;
      if (!e) return false;
      switch (e) {
        case '"': out += '"'; break;
        case '\\': out += '\\'; break;
        case '/': out += '/'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'n': out += '\n'; break;
        case 'r': out += '\r'; break;
        case 't': out += '\t'; break;
        default: out += e; break;
      }
    } else {
      out += c;
    }
  }
  return false;
}

static uint32_t protocolJsonCountMembers(const char* p, char open, char close) {
  p = protocolJsonSkipWs(p);
  if (!p || *p != open) return 0;
  p++;
  uint32_t count = 0;
  while (*p) {
    p = protocolJsonSkipWs(p);
    if (*p == close) return count;
    if (open == '{') {
      if (*p != '"') return count;
      p = protocolJsonSkipString(p);
      p = protocolJsonSkipWs(p);
      if (*p != ':') return count;
      p = protocolJsonSkipValue(p + 1);
    } else {
      p = protocolJsonSkipValue(p);
    }
    count++;
    p = protocolJsonSkipWs(p);
    if (*p == ',') {
      p++;
      continue;
    }
    if (*p == close) return count;
    return count;
  }
  return count;
}

static bool protocolMsgPackWriteJsonValue(P1MsgPackWriter& w, const char*& p, uint8_t depth) {
  if (depth > 8) return false;
  p = protocolJsonSkipWs(p);
  if (!p || !*p) return false;
  if (*p == '"') {
    String value;
    if (!protocolJsonParseStringToken(p, value)) return false;
    return w.writeString(value);
  }
  if (*p == '{') {
    uint32_t count = protocolJsonCountMembers(p, '{', '}');
    if (!w.writeMap(count)) return false;
    p++;
    for (uint32_t i = 0; i < count; i++) {
      String key;
      if (!protocolJsonParseStringToken(p, key)) return false;
      p = protocolJsonSkipWs(p);
      if (*p != ':') return false;
      p++;
      if (!w.writeString(key) || !protocolMsgPackWriteJsonValue(w, p, depth + 1)) return false;
      p = protocolJsonSkipWs(p);
      if (i + 1 < count) {
        if (*p != ',') return false;
        p++;
      }
    }
    p = protocolJsonSkipWs(p);
    if (*p == '}') p++;
    return true;
  }
  if (*p == '[') {
    uint32_t count = protocolJsonCountMembers(p, '[', ']');
    if (!w.writeArray(count)) return false;
    p++;
    for (uint32_t i = 0; i < count; i++) {
      if (!protocolMsgPackWriteJsonValue(w, p, depth + 1)) return false;
      p = protocolJsonSkipWs(p);
      if (i + 1 < count) {
        if (*p != ',') return false;
        p++;
      }
    }
    p = protocolJsonSkipWs(p);
    if (*p == ']') p++;
    return true;
  }
  if (strncmp(p, "true", 4) == 0) {
    p += 4;
    return w.writeBool(true);
  }
  if (strncmp(p, "false", 5) == 0) {
    p += 5;
    return w.writeBool(false);
  }
  if (strncmp(p, "null", 4) == 0) {
    p += 4;
    return w.writeNil();
  }
  char* end = nullptr;
  double number = strtod(p, &end);
  if (end == p) return false;
  bool isFloat = false;
  for (const char* q = p; q < end; q++) {
    if (*q == '.' || *q == 'e' || *q == 'E') {
      isFloat = true;
      break;
    }
  }
  p = end;
  if (isFloat) return w.writeFloat((float)number);
  long iv = (long)number;
  if (iv < 0) return w.writeInt((int32_t)iv);
  return w.writeUInt((uint32_t)iv);
}

static void protocolMsgPackWriteJsonObject(P1MsgPackWriter& w, const String& json) {
  const char* p = json.c_str();
  if (!protocolMsgPackWriteJsonValue(w, p, 0)) w.writeMap(0);
}

static void protocolAppendJsonEscapedBytes(String& out, const char* data, size_t len) {
  out += '"';
  for (size_t i = 0; i < len; i++) {
    char c = data[i];
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if ((uint8_t)c < 0x20) out += ' ';
        else out += c;
        break;
    }
  }
  out += '"';
}

static bool protocolMsgPackValueToJson(P1MsgPackReader& r, String& out, uint8_t depth) {
  if (depth > 12) return false;
  uint8_t b = 0;
  if (!r.readByte(b)) return false;

  if (b <= 0x7f) {
    out += String((uint32_t)b);
    return true;
  }
  if (b >= 0xe0) {
    out += String((int32_t)(int8_t)b);
    return true;
  }
  if ((b & 0xe0) == 0xa0) {
    size_t len = b & 0x1f;
    if (r.offset + len > r.length) return false;
    protocolAppendJsonEscapedBytes(out, reinterpret_cast<const char*>(r.data + r.offset), len);
    r.offset += len;
    return true;
  }
  if ((b & 0xf0) == 0x80 || b == 0xde) {
    uint32_t count = b & 0x0f;
    if (b == 0xde) {
      if (r.offset + 2 > r.length) return false;
      count = (uint32_t(r.data[r.offset]) << 8) | r.data[r.offset + 1];
      r.offset += 2;
    }
    out += '{';
    for (uint32_t i = 0; i < count; i++) {
      if (i) out += ',';
      if (!protocolMsgPackValueToJson(r, out, depth + 1)) return false;
      out += ':';
      if (!protocolMsgPackValueToJson(r, out, depth + 1)) return false;
    }
    out += '}';
    return true;
  }
  if ((b & 0xf0) == 0x90 || b == 0xdc) {
    uint32_t count = b & 0x0f;
    if (b == 0xdc) {
      if (r.offset + 2 > r.length) return false;
      count = (uint32_t(r.data[r.offset]) << 8) | r.data[r.offset + 1];
      r.offset += 2;
    }
    out += '[';
    for (uint32_t i = 0; i < count; i++) {
      if (i) out += ',';
      if (!protocolMsgPackValueToJson(r, out, depth + 1)) return false;
    }
    out += ']';
    return true;
  }

  if (b == 0xc0) {
    out += "null";
    return true;
  }
  if (b == 0xc2 || b == 0xc3) {
    out += (b == 0xc3) ? "true" : "false";
    return true;
  }
  if (b == 0xcc || b == 0xcd || b == 0xce) {
    uint32_t value = 0;
    if (b == 0xcc) {
      if (r.offset + 1 > r.length) return false;
      value = r.data[r.offset++];
    } else if (b == 0xcd) {
      if (r.offset + 2 > r.length) return false;
      value = (uint32_t(r.data[r.offset]) << 8) | r.data[r.offset + 1];
      r.offset += 2;
    } else {
      if (r.offset + 4 > r.length) return false;
      value = (uint32_t(r.data[r.offset]) << 24) | (uint32_t(r.data[r.offset + 1]) << 16) |
              (uint32_t(r.data[r.offset + 2]) << 8) | r.data[r.offset + 3];
      r.offset += 4;
    }
    out += String(value);
    return true;
  }
  if (b == 0xd0 || b == 0xd1 || b == 0xd2) {
    int32_t value = 0;
    if (b == 0xd0) {
      if (r.offset + 1 > r.length) return false;
      value = (int8_t)r.data[r.offset++];
    } else if (b == 0xd1) {
      if (r.offset + 2 > r.length) return false;
      uint16_t raw = (uint16_t(r.data[r.offset]) << 8) | r.data[r.offset + 1];
      value = (int16_t)raw;
      r.offset += 2;
    } else {
      if (r.offset + 4 > r.length) return false;
      uint32_t raw = (uint32_t(r.data[r.offset]) << 24) | (uint32_t(r.data[r.offset + 1]) << 16) |
                     (uint32_t(r.data[r.offset + 2]) << 8) | r.data[r.offset + 3];
      value = (int32_t)raw;
      r.offset += 4;
    }
    out += String(value);
    return true;
  }
  if (b == 0xca) {
    if (r.offset + 4 > r.length) return false;
    union {
      uint32_t u;
      float f;
    } v;
    v.u = (uint32_t(r.data[r.offset]) << 24) | (uint32_t(r.data[r.offset + 1]) << 16) |
          (uint32_t(r.data[r.offset + 2]) << 8) | r.data[r.offset + 3];
    r.offset += 4;
    if (!isfinite(v.f)) out += "0";
    else out += String(v.f, 3);
    return true;
  }
  if (b == 0xd9 || b == 0xda) {
    size_t len = 0;
    if (b == 0xd9) {
      if (r.offset + 1 > r.length) return false;
      len = r.data[r.offset++];
    } else {
      if (r.offset + 2 > r.length) return false;
      len = (size_t(r.data[r.offset]) << 8) | r.data[r.offset + 1];
      r.offset += 2;
    }
    if (r.offset + len > r.length) return false;
    protocolAppendJsonEscapedBytes(out, reinterpret_cast<const char*>(r.data + r.offset), len);
    r.offset += len;
    return true;
  }

  return false;
}

static bool protocolMsgPackPayloadToJson(const uint8_t* data, size_t len, String& out) {
  out = "";
  P1MsgPackReader r(data, len);
  if (!protocolMsgPackValueToJson(r, out, 0)) return false;
  return r.offset == r.length;
}

static void protocolSendJsonResponseFromMsgPackPayload(const String& id, const uint8_t* data, size_t len) {
  String json;
  json.reserve(len * 2);
  if (!protocolMsgPackPayloadToJson(data, len, json)) {
    protocolSendResponseError(id, "bad_payload_projection", "Could not project MessagePack payload to JSON");
    return;
  }
  if (!json.length()) {
    protocolSendResponseError(id, "empty_payload_projection", "MessagePack payload projected to an empty JSON response");
    return;
  }
  protocolSendResponseOk(id, json);
}

static String protocolHeapSnapshotJson(const char* prefix) {
  String out;
  out.reserve(160);
  out += "\"";
  out += prefix;
  out += "FreeHeap\":";
  out += String(ESP.getFreeHeap());
  out += ",\"";
  out += prefix;
  out += "MaxAllocHeap\":";
  out += String(ESP.getMaxAllocHeap());
  out += ",\"";
  out += prefix;
  out += "InternalFree\":";
  out += String(heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT));
  out += ",\"";
  out += prefix;
  out += "InternalLargest\":";
  out += String(heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT));
  return out;
}

static String protocolHttpProbeJson(const String& url, int maxBytes, int timeoutMs) {
  maxBytes = constrain(maxBytes <= 0 ? 64 : maxBytes, 0, P1_EMBED_HTTP_MAX_RESPONSE_BYTES);
  timeoutMs = constrain(timeoutMs <= 0 ? P1_EMBED_HTTP_DEFAULT_TIMEOUT_MS : timeoutMs, 500, 15000);

  String out = "{";
  out += "\"url\":" + jsonString(url);
  out += ",";
  out += protocolHeapSnapshotJson("before");
  String body = httpFetchGet(url, maxBytes, timeoutMs);
  out += ",\"bodyBytes\":" + String(body.length());
  out += ",\"code\":" + String(httpFetchLastCode());
  out += ",\"error\":" + jsonString(httpFetchLastError());
  out += ",\"http\":" + protocolProjectHttpStatusToJson(httpFetchStatusSnapshot());
  out += ",";
  out += protocolHeapSnapshotJson("after");
  out += "}";
  return out;
}

static void protocolSendMsgPackBytes(const uint8_t* data, size_t len) {
  transportSendMsgPackBytes(data, len);
  webrtcTransportSendBytes(data, len);
  mqttTransportSendBytes(data, len);
}

static void protocolSendMsgPackResponseBytes(uint32_t id, const uint8_t* data, size_t len, const char* tooLargeMessage) {
  if (mqttTransportConnected() && len > P1_EMBED_MQTT_BUFFER_BYTES) {
    protocolSendMsgPackError(id, "response_too_large", tooLargeMessage ? tooLargeMessage : "Response is too large for MQTT");
    return;
  }
  protocolSendMsgPackBytes(data, len);
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

static int protocolHexNibble(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

static uint8_t* protocolParseHexBytes(const String& text, size_t& outLen) {
  outLen = 0;
  if (text.length() == 0 || (text.length() % 2) != 0) return nullptr;
  size_t byteLen = text.length() / 2;
  if (byteLen > P1_EMBED_MAX_BYTECODE_BYTES) return nullptr;
  uint8_t* bytes = (uint8_t*)malloc(byteLen);
  if (!bytes) return nullptr;
  for (size_t i = 0; i < byteLen; i++) {
    int hi = protocolHexNibble(text[i * 2]);
    int lo = protocolHexNibble(text[i * 2 + 1]);
    if (hi < 0 || lo < 0) {
      free(bytes);
      return nullptr;
    }
    bytes[i] = (uint8_t)((hi << 4) | lo);
  }
  outLen = byteLen;
  return bytes;
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

static bool protocolScriptIntegrityInfoOk(size_t scriptBytes,
                                          uint32_t scriptHash,
                                          int expectedBytes,
                                          const String& expectedHashHex,
                                          String& codeOut,
                                          String& messageOut) {
  if (expectedBytes >= 0 && (int)scriptBytes != expectedBytes) {
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
    if (scriptHash != expectedHash) {
      codeOut = "script_integrity_error";
      messageOut = "script.set payload hash mismatch";
      return false;
    }
  }

  return true;
}

static bool protocolValidateScriptIntegrityInfo(const String& id,
                                                size_t scriptBytes,
                                                uint32_t scriptHash,
                                                int expectedBytes,
                                                const String& expectedHashHex) {
  String code;
  String message;
  if (!protocolScriptIntegrityInfoOk(scriptBytes, scriptHash, expectedBytes, expectedHashHex, code, message)) {
    protocolSendResponseError(id, code.c_str(), message.c_str());
    return false;
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

static P1ScriptSnapshot protocolScriptSnapshot(const String* codeOverride = nullptr, const char* stateOverride = nullptr) {
  P1ScriptSnapshot snapshot;
#if P1_EMBED_WRENCH_ENABLED
  if (codeOverride) {
    snapshot.code = *codeOverride;
    snapshot.bytes = codeOverride->length();
    snapshot.hash = protocolFnv1a(*codeOverride);
  } else {
    snapshot.bytes = wrenchCurrentScriptBytes();
    snapshot.hash = wrenchCurrentScriptHash();
  }
  snapshot.state = stateOverride ? stateOverride : wrenchStateName();
  snapshot.stored = scriptStoreHasSaved();
  snapshot.runState = scriptStoreRunStateName(scriptStoreLoadRunState());
  snapshot.runPending = wrenchRunIsPending();
  snapshot.verificationArmed = scriptStoreVerificationArmed();
  snapshot.hasSetup = wrenchHasSetup();
  snapshot.hasLoop = wrenchHasLoop();
  snapshot.taskRunning = wrenchTaskIsRunning();
  snapshot.loopCount = wrenchLoopCount();
  snapshot.loopFps = wrenchLoopFps();
  snapshot.loopHung = wrenchLoopIsHung();
  snapshot.taskStackHighWater = wrenchTaskStackHighWater();
#else
  if (codeOverride) snapshot.code = *codeOverride;
  snapshot.state = "disabled";
  snapshot.runState = "disabled";
  snapshot.bytes = codeOverride ? codeOverride->length() : 0;
  snapshot.hash = codeOverride ? protocolFnv1a(*codeOverride) : 2166136261u;
#endif
  return snapshot;
}

static P1StatusSnapshot protocolStatusSnapshot() {
  P1StatusSnapshot snapshot;
  snapshot.uptimeMs = millis();
  snapshot.heapSize = ESP.getHeapSize();
  snapshot.freeHeap = ESP.getFreeHeap();
  snapshot.minFreeHeap = ESP.getMinFreeHeap();
  snapshot.maxAllocHeap = ESP.getMaxAllocHeap();
  snapshot.timezone = configTimezone();
  time_t now = time(nullptr);
  snapshot.timeSynced = now >= 100000;
  if (snapshot.timeSynced) {
    tm info;
    localtime_r(&now, &info);
    char buf[24];
    snprintf(buf, sizeof(buf), "%04d-%02d-%02d %02d:%02d:%02d", info.tm_year + 1900, info.tm_mon + 1, info.tm_mday, info.tm_hour, info.tm_min, info.tm_sec);
    snapshot.localTime = buf;
  } else {
    snapshot.localTime = "";
  }
  snapshot.deviceId = configDeviceId();
  snapshot.deviceName = configDeviceName();
  snapshot.script = protocolScriptSnapshot();
  snapshot.wifi = wifiSnapshot();
  snapshot.lastError = scriptErrorSnapshot();
  snapshot.debug = debugEventSnapshot();
  return snapshot;
}

static String protocolScriptSnapshotJson(const P1ScriptSnapshot& snapshot, bool includeCode, bool includeMetrics) {
  String out = "{";
  size_t reserveBytes = 128;
  if (includeCode) reserveBytes += snapshot.code.length() + 64;
  if (includeMetrics) reserveBytes += 96;
  out.reserve(reserveBytes);
  bool first = true;
  if (includeCode) {
    out += "\"code\":" + jsonString(snapshot.code);
    first = false;
  }
  if (!first) out += ",";
  out += "\"state\":" + jsonString(snapshot.state);
  out += ",\"stored\":" + String(snapshot.stored ? "true" : "false");
  out += ",\"runState\":" + jsonString(snapshot.runState);
  out += ",\"revisionId\":" + jsonString(configRevisionId());
  out += ",\"scriptName\":" + jsonString(configScriptName());
  if (includeMetrics) {
    out += ",\"scriptBytes\":" + String(snapshot.bytes);
    out += ",\"scriptHash\":" + String(snapshot.hash);
    out += ",\"runPending\":" + String(snapshot.runPending ? "true" : "false");
  }
  out += "}";
  return out;
}

static void protocolAppendStatusCoreJson(String& out, const P1StatusSnapshot& snapshot) {
  out += "\"uptimeMs\":" + String(snapshot.uptimeMs);
  out += ",\"heapSize\":" + String(snapshot.heapSize);
  out += ",\"freeHeap\":" + String(snapshot.freeHeap);
  out += ",\"minFreeHeap\":" + String(snapshot.minFreeHeap);
  out += ",\"maxAllocHeap\":" + String(snapshot.maxAllocHeap);
  out += ",\"timeSynced\":" + String(snapshot.timeSynced ? "true" : "false");
  out += ",\"localTime\":" + jsonString(snapshot.localTime);
  out += ",\"timezone\":" + jsonString(snapshot.timezone);
  out += ",\"scriptState\":" + jsonString(snapshot.script.state);
  out += ",\"scriptBytes\":" + String(snapshot.script.bytes);
  out += ",\"scriptHash\":" + String(snapshot.script.hash);
  out += ",\"hasSetup\":" + String(snapshot.script.hasSetup ? "true" : "false");
  out += ",\"hasLoop\":" + String(snapshot.script.hasLoop ? "true" : "false");
  out += ",\"wrenchTaskRunning\":" + String(snapshot.script.taskRunning ? "true" : "false");
  out += ",\"wrenchLoopCount\":" + String(snapshot.script.loopCount);
  out += ",\"wrenchLoopFps\":" + String(snapshot.script.loopFps, 2);
  out += ",\"wrenchLoopHung\":" + String(snapshot.script.loopHung ? "true" : "false");
  out += ",\"deviceId\":" + jsonString(snapshot.deviceId);
  out += ",\"deviceName\":" + jsonString(snapshot.deviceName);
  out += ",\"scriptStored\":" + String(snapshot.script.stored ? "true" : "false");
  out += ",\"scriptRunState\":" + jsonString(snapshot.script.runState);
}

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

static String protocolProjectStatusFullToJson() {
  P1StatusSnapshot snapshot = protocolStatusSnapshot();
  P1ReusableBufferHandle payload;
  if (!protocolAcquireFrameBuffer(P1_EMBED_MQTT_BUFFER_BYTES, payload)) return "{}";
  P1MsgPackWriter w(payload.data, payload.capacity);
  protocolMsgPackWriteStatusFullData(w, snapshot);
  String out;
  if (!w.ok || !protocolMsgPackPayloadToJson(payload.data, w.length, out)) out = "{}";
  protocolReleaseFrameBuffer(payload);
  return out;
}

static String protocolProjectStatusGetToJson() {
  P1StatusSnapshot snapshot = protocolStatusSnapshot();
  P1ReusableBufferHandle payload;
  if (!protocolAcquireFrameBuffer(P1_EMBED_MQTT_BUFFER_BYTES, payload)) return "{}";
  P1MsgPackWriter w(payload.data, payload.capacity);
  protocolMsgPackWriteStatusGetData(w, snapshot);
  String out;
  if (!w.ok || !protocolMsgPackPayloadToJson(payload.data, w.length, out)) out = "{}";
  protocolReleaseFrameBuffer(payload);
  return out;
}

static String protocolProjectStatusLightToJson() {
  P1StatusSnapshot snapshot = protocolStatusSnapshot();
  uint8_t payload[P1_EMBED_MSGPACK_MAX_FRAME_BYTES];
  P1MsgPackWriter w(payload, sizeof(payload));
  protocolMsgPackWriteStatusLightData(w, snapshot);
  String out;
  if (!w.ok || !protocolMsgPackPayloadToJson(payload, w.length, out)) return "{}";
  return out;
}

static String protocolProjectStatusLiveToJson() {
  P1StatusSnapshot snapshot = protocolStatusSnapshot();
  uint8_t payload[P1_EMBED_MSGPACK_MAX_FRAME_BYTES];
  P1MsgPackWriter w(payload, sizeof(payload));
  protocolMsgPackWriteStatusLiveData(w, snapshot);
  String out;
  if (!w.ok || !protocolMsgPackPayloadToJson(payload, w.length, out)) return "{}";
  return out;
}

static void protocolSendCommandStatusGet(P1ProtocolReplyMode replyMode, uint32_t msgpackId, const String& jsonId) {
  if (replyMode == P1_REPLY_MSGPACK) protocolSendMsgPackStatusGet(msgpackId);
  else protocolSendJsonStatusGet(jsonId);
}

static void protocolSendCommandStatusFull(P1ProtocolReplyMode replyMode, uint32_t msgpackId, const String& jsonId) {
  if (replyMode == P1_REPLY_MSGPACK) protocolSendMsgPackStatusFull(msgpackId);
  else protocolSendJsonStatusFull(jsonId);
}

static void protocolSendCommandStatusLive(P1ProtocolReplyMode replyMode, uint32_t msgpackId, const String& jsonId) {
  if (replyMode == P1_REPLY_MSGPACK) protocolSendMsgPackStatusLive(msgpackId);
  else protocolSendJsonStatusLive(jsonId);
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
  P1ReusableBufferHandle frame;
  if (!protocolAcquireFrameBuffer(capacity, frame)) return;

  P1MsgPackWriter w(frame.data, frame.capacity);
  protocolMsgPackBeginEvent(w, name ? name : "", mapCount);
  if (level) { w.writeString("level"); w.writeString(level); }
  if (category) { w.writeString("category"); w.writeString(category); }
  if (message && message[0]) { w.writeString("message"); w.writeString(message); }
  for (size_t i = 0; i < fieldCount; i++) {
    protocolMsgPackWriteEventField(w, fields[i]);
  }
  if (w.ok) protocolSendMsgPackBytes(frame.data, w.length);
  protocolReleaseFrameBuffer(frame);
}

void protocolEmitEventFields(const char* name, const P1EventField* fields, size_t fieldCount) {
  String eventName = name ? String(name) : String("");
  if (eventName.startsWith("ui.")) {
    protocolEmitMsgPackEventFields(eventName.c_str(), "info", "ui", "", fields, fieldCount);
    String out = "{\"type\":\"evt\",\"name\":" + jsonString(eventName) + ",\"data\":{";
    out += "\"level\":\"info\",\"category\":\"ui\"";
    for (size_t i = 0; i < fieldCount; i++) {
      out += ",";
      protocolAppendJsonEventField(out, fields[i]);
    }
    out += "}}";
    transportSendLine(out);
    return;
  }
  if (eventName.startsWith("script.") || eventName.startsWith("wifi.") ||
      eventName.startsWith("device.")) {
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
  if (name.startsWith("ui.")) {
    protocolEmitMsgPackEventFields(name.c_str(), "info", "ui", "", nullptr, 0);
    String out = "{\"type\":\"evt\",\"name\":" + jsonString(name) + ",\"data\":{";
    out += "\"level\":\"info\",\"category\":\"ui\"";
    if (dataFieldsJson.length()) out += "," + dataFieldsJson;
    out += "}}";
    transportSendLine(out);
    return;
  }
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
  mqttTransportSendScriptText(message, newline);
  P1EventField fields[] = {
    p1FieldBool("newline", newline),
  };
  debugEventEmitFields("script.print", "info", "script", message, fields, 1);
}

void protocolEmitBoot() {
  protocolEmitEvent("device.boot", "\"info\":" + protocolBaseInfoJson() + ",\"status\":" + protocolProjectStatusGetToJson());
  protocolPrepareMemoryPressure();
}

void protocolEmitStatusEvent() {
  fastLedSkipFor(20);
  P1StatusSnapshot snapshot = protocolStatusSnapshot();
  P1ReusableBufferHandle frame;
  if (protocolAcquireFrameBuffer(P1_EMBED_MSGPACK_MAX_FRAME_BYTES, frame)) {
    P1MsgPackWriter w(frame.data, frame.capacity);
    protocolMsgPackBeginEvent(w, "device.status", 1);
    w.writeString("status");
    protocolMsgPackWriteStatusLiveData(w, snapshot);
    if (w.ok) protocolSendMsgPackBytes(frame.data, w.length);
    protocolReleaseFrameBuffer(frame);
  }
  protocolEmitEvent("device.status", "\"status\":" + protocolProjectStatusLiveToJson());
  protocolPrepareMemoryPressure();
}

static String protocolScriptMetaJson(const String& code, const String& state) {
  P1ScriptSnapshot snapshot = protocolScriptSnapshot(&code, state.c_str());
  return protocolScriptSnapshotJson(snapshot, false, true);
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

static void protocolEmitScriptUploadEvent(const char* consoleLevel, const P1EventField* fields, size_t fieldCount) {
  if (consoleLevel && strcmp(consoleLevel, "error") == 0) {
    debugEventEmitFields("script.upload", "error", "script", "", fields, fieldCount);
    return;
  }

  P1EventField systemFields[8];
  size_t count = min(fieldCount, (size_t)7);
  for (size_t i = 0; i < count; i++) {
    systemFields[i] = fields[i];
  }
  systemFields[count++] = p1FieldString("consoleLevel", consoleLevel && consoleLevel[0] ? consoleLevel : "debug");
  debugEventEmitFields("script.upload", "system", "script", "", systemFields, count);
}

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
  protocolEmitScriptUploadEvent("debug", fields, 2);
}

void protocolPrepareScriptUpload() {
  wrenchStop();
  if (scriptStoreHasSaved()) {
    scriptStoreSaveRunState(P1_EMBED_SCRIPT_RUN_STOPPED);
  }
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
      protocolEmitScriptUploadEvent("error", fields, 3);
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
        protocolEmitScriptUploadEvent("error", fields, 3);
      }
      return false;
    }
    scriptStoreSaveRunState(runAfterSet ? P1_EMBED_SCRIPT_RUN_PENDING_NEW : P1_EMBED_SCRIPT_RUN_STOPPED);
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
      if (saveAfterSet) scriptStoreMarkVerificationFailed("run_failed");
      if (sendResponse) protocolSendResponseError(id, "run_error", runErr);
      else {
        P1EventField fields[] = {
          p1FieldString("state", "error"),
          p1FieldString("phase", "run"),
          p1FieldString("message", runErr),
        };
        protocolEmitScriptUploadEvent("error", fields, 3);
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
    protocolEmitScriptUploadEvent("debug", fields, 3);
  }
  return true;
}

static bool protocolHandleScriptSetIncoming(bool runAfterSet, bool saveAfterSet) {
  size_t scriptBytes = 0;
  uint32_t scriptHash = 2166136261u;
  if (!scriptStoreIncomingInfo(scriptBytes, scriptHash) || scriptBytes == 0 || scriptBytes > P1_EMBED_MAX_SCRIPT_BYTES) {
    P1EventField fields[] = {
      p1FieldString("state", "error"),
      p1FieldString("phase", "load"),
      p1FieldString("message", "Failed to load staged script"),
    };
    protocolEmitScriptUploadEvent("error", fields, 3);
    return false;
  }

  String err;
  WrenchTransitionGuard transition("script.set.incoming");
  scriptErrorClear();
  {
    P1EventField fields[] = {
      p1FieldBool("run", runAfterSet),
      p1FieldBool("save", saveAfterSet),
      p1FieldUInt("scriptBytes", scriptBytes),
    };
    debugEventEmitFields("script.debug", "debug", "script", "script.set incoming begin", fields, 3);
  }
  if (!wrenchCompileAndSetIncoming(scriptBytes, scriptHash, err)) {
    wrenchSetCurrentScriptFromIncoming();
    P1EventField debugFields[] = {
      p1FieldString("error", err),
    };
    debugEventEmitFields("script.debug", "debug", "script", "script.set incoming compile failed", debugFields, 1);
    P1EventField fields[] = {
      p1FieldString("state", "error"),
      p1FieldString("phase", "compile"),
      p1FieldString("message", err),
    };
    protocolEmitScriptUploadEvent("error", fields, 3);
    return false;
  }
  {
    P1EventField fields[] = {
      p1FieldBool("run", runAfterSet),
      p1FieldBool("save", saveAfterSet),
    };
    debugEventEmitFields("script.debug", "debug", "script", "script.set incoming compile ok", fields, 2);
  }

  if (saveAfterSet) {
    if (!scriptStoreCopyIncomingToSaved()) {
      debugEventEmitFields("script.debug", "debug", "script", "script.set incoming save failed", nullptr, 0);
      P1EventField fields[] = {
        p1FieldString("state", "error"),
        p1FieldString("phase", "save"),
        p1FieldString("message", "Failed to save script to LittleFS"),
      };
      protocolEmitScriptUploadEvent("error", fields, 3);
      return false;
    }
    scriptStoreSaveRunState(runAfterSet ? P1_EMBED_SCRIPT_RUN_PENDING_NEW : P1_EMBED_SCRIPT_RUN_STOPPED);
    P1EventField fields[] = {
      p1FieldString("runState", scriptStoreRunStateName(scriptStoreLoadRunState())),
    };
    debugEventEmitFields("script.debug", "debug", "script", "script.set incoming save ok", fields, 1);
  }

  if (runAfterSet) {
    String runErr;
    debugEventEmitFields("script.debug", "debug", "script", "script.set incoming run begin", nullptr, 0);
    if (!wrenchRunCompiled(runErr)) {
      P1EventField debugFields[] = {
        p1FieldString("error", runErr),
      };
      debugEventEmitFields("script.debug", "debug", "script", "script.set incoming run failed", debugFields, 1);
      if (saveAfterSet) scriptStoreMarkVerificationFailed("run_failed");
      P1EventField fields[] = {
        p1FieldString("state", "error"),
        p1FieldString("phase", "run"),
        p1FieldString("message", runErr),
      };
      protocolEmitScriptUploadEvent("error", fields, 3);
      return false;
    }
    P1EventField fields[] = {
      p1FieldString("state", wrenchStateName()),
    };
    debugEventEmitFields("script.debug", "debug", "script", "script.set incoming run ok", fields, 1);
    if (saveAfterSet) scriptStoreArmVerification();
  }

  String state = runAfterSet ? "running" : (saveAfterSet ? "saved" : "compiled");
  {
    P1EventField fields[] = {
      p1FieldString("state", state),
    };
    debugEventEmitFields("script.debug", "debug", "script", "script.set incoming response", fields, 1);
  }
  P1EventField fields[] = {
    p1FieldString("state", state),
    p1FieldUInt("scriptBytes", scriptBytes),
    p1FieldUInt("scriptHash", scriptHash),
  };
  protocolEmitScriptUploadEvent("debug", fields, 3);
  return true;
}

static void protocolHandleScriptSet(const String& id, const char* line, bool runAfterSet, bool saveAfterSet) {
  String code;
  if (!jsonGetString(line, "code", code)) {
    protocolSendResponseError(id, "missing_code", "script.set requires data.code");
    return;
  }
  if (code.length() > P1_EMBED_LEGACY_SCRIPT_JSON_MAX_BYTES) {
    protocolSendResponseError(id, "legacy_script_too_large", "script.set is limited; use script.chunk.begin/add/commit");
    return;
  }
  int expectedBytes = -1;
  String expectedHashHex;
  jsonGetInt(line, "codeBytes", expectedBytes);
  jsonGetString(line, "codeHash", expectedHashHex);
  if (!protocolValidateScriptIntegrity(id, code, expectedBytes, expectedHashHex)) return;
  protocolPrepareScriptUpload();
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

static void protocolHandleScriptBytecodeSet(const String& id, const char* line) {
  String code;
  String bytecodeHex;
  bool runAfterSet = true;
  bool saveAfterSet = false;
  jsonGetString(line, "code", code);
  jsonGetString(line, "bytecodeHex", bytecodeHex);
  jsonGetBool(line, "run", runAfterSet);
  jsonGetBool(line, "save", saveAfterSet);
  if (!code.length()) {
    protocolSendResponseError(id, "missing_code", "script.bytecode.set requires data.code");
    return;
  }
  if (!bytecodeHex.length()) {
    protocolSendResponseError(id, "missing_bytecode", "script.bytecode.set requires data.bytecodeHex");
    return;
  }

  size_t bytecodeLen = 0;
  uint8_t* bytecode = protocolParseHexBytes(bytecodeHex, bytecodeLen);
  if (!bytecode) {
    protocolSendResponseError(id, "bad_bytecode", "script.bytecode.set bytecodeHex is invalid or too large");
    return;
  }

  protocolPrepareScriptUpload();
  scriptErrorClear();
  String err;
  bool ok = wrenchSetCompiledBytecode(code, bytecode, bytecodeLen, err);
  free(bytecode);
  if (!ok) {
    protocolSendResponseError(id, "bytecode_error", err);
    return;
  }

  if (saveAfterSet) {
    if (!scriptStoreSave(code)) {
      protocolSendResponseError(id, "storage_error", "Failed to save script to LittleFS");
      return;
    }
    scriptStoreSaveRunState(runAfterSet ? P1_EMBED_SCRIPT_RUN_PENDING_NEW : P1_EMBED_SCRIPT_RUN_STOPPED);
  }

  if (runAfterSet) {
    String runErr;
    if (!wrenchRunCompiled(runErr)) {
      if (saveAfterSet) scriptStoreMarkVerificationFailed("run_failed");
      protocolSendResponseError(id, "run_error", runErr);
      return;
    }
    if (saveAfterSet) scriptStoreArmVerification();
  }

  String state = runAfterSet ? "running" : (saveAfterSet ? "saved" : "compiled");
  protocolSendResponseOk(id, protocolScriptMetaJson(code, state));
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

  size_t scriptBytes = 0;
  uint32_t scriptHash = 2166136261u;
  if (!scriptStoreIncomingInfo(scriptBytes, scriptHash) || scriptBytes == 0) {
    scriptStoreClearIncoming();
    P1EventField fields[] = {
      p1FieldString("state", "error"),
      p1FieldString("phase", "load"),
      p1FieldString("message", "Failed to load staged script"),
    };
    protocolEmitScriptUploadEvent("error", fields, 3);
    return;
  }
  String integrityCode;
  String integrityMessage;
  if (!protocolScriptIntegrityInfoOk(scriptBytes, scriptHash, expectedBytes, expectedHashHex, integrityCode, integrityMessage)) {
    scriptStoreClearIncoming();
    P1EventField fields[] = {
      p1FieldString("state", "error"),
      p1FieldString("phase", "integrity"),
      p1FieldString("message", integrityMessage),
    };
    protocolEmitScriptUploadEvent("error", fields, 3);
    return;
  }
  P1EventField fields[] = {
    p1FieldString("state", "compiling"),
    p1FieldUInt("scriptBytes", scriptBytes),
  };
  protocolEmitScriptUploadEvent("debug", fields, 2);
  bool ok = protocolHandleScriptSetIncoming(runAfterSet, saveAfterSet);
  if (ok) {
    scriptStoreClearIncoming();
  }
}

static void protocolMsgPackWriteWifi(P1MsgPackWriter& w, const P1WifiSnapshot& snapshot);

static void protocolMsgPackWriteWebTransport(P1MsgPackWriter& w, const P1WebTransportSnapshot& snapshot) {
  w.writeMap(6);
  w.writeString("enabled"); w.writeBool(snapshot.enabled);
  w.writeString("started"); w.writeBool(snapshot.started);
  w.writeString("port"); w.writeUInt(snapshot.port);
  w.writeString("clients"); w.writeUInt(snapshot.clients);
  w.writeString("mdns"); w.writeBool(snapshot.mdns);
  w.writeString("host"); w.writeString(snapshot.host);
}

static void protocolMsgPackWriteMqttTransport(P1MsgPackWriter& w, const P1MqttTransportSnapshot& snapshot) {
  if (!snapshot.enabled) {
    w.writeMap(2);
    w.writeString("enabled"); w.writeBool(false);
    w.writeString("connected"); w.writeBool(false);
    return;
  }
  w.writeMap(35);
  w.writeString("enabled"); w.writeBool(snapshot.enabled);
  w.writeString("configured"); w.writeBool(snapshot.configured);
  w.writeString("connected"); w.writeBool(snapshot.connected);
  w.writeString("begun"); w.writeBool(snapshot.begun);
  w.writeString("queueAllocated"); w.writeBool(snapshot.queueAllocated);
  w.writeString("host"); w.writeString(snapshot.host);
  w.writeString("port"); w.writeUInt(snapshot.port);
  w.writeString("root"); w.writeString(snapshot.root);
  w.writeString("deviceId"); w.writeString(snapshot.deviceId);
  w.writeString("cmd"); w.writeString(snapshot.cmd);
  w.writeString("evt"); w.writeString(snapshot.evt);
  w.writeString("scriptIn"); w.writeString(snapshot.scriptIn);
  w.writeString("scriptOut"); w.writeString(snapshot.scriptOut);
  w.writeString("authRequired"); w.writeBool(snapshot.authRequired);
  w.writeString("onlineAuthUsers"); w.writeUInt(snapshot.onlineAuthUsers);
  w.writeString("anonymousUi"); w.writeBool(snapshot.anonymousUi);
  w.writeString("anonymousScript"); w.writeBool(snapshot.anonymousScript);
  w.writeString("guestUiKeySet"); w.writeBool(snapshot.guestUiKeySet);
  w.writeString("ownerCore"); w.writeInt(snapshot.ownerCore);
  w.writeString("loopCore"); w.writeInt(snapshot.loopCore);
  w.writeString("outQueuedCount"); w.writeUInt(snapshot.outQueuedCount);
  w.writeString("outDropCount"); w.writeUInt(snapshot.outDropCount);
  w.writeString("outHighWater"); w.writeUInt(snapshot.outHighWater);
  w.writeString("connectCount"); w.writeUInt(snapshot.connectCount);
  w.writeString("lostCount"); w.writeUInt(snapshot.lostCount);
  w.writeString("loopClosedCount"); w.writeUInt(snapshot.loopClosedCount);
  w.writeString("publishFailCount"); w.writeUInt(snapshot.publishFailCount);
  w.writeString("securePublishFailCount"); w.writeUInt(snapshot.securePublishFailCount);
  w.writeString("scriptOutPublishFailCount"); w.writeUInt(snapshot.scriptOutPublishFailCount);
  w.writeString("helloPublishFailCount"); w.writeUInt(snapshot.helloPublishFailCount);
  w.writeString("lastLostMs"); w.writeUInt(snapshot.lastLostMs);
  w.writeString("lastLoopClosedMs"); w.writeUInt(snapshot.lastLoopClosedMs);
  w.writeString("lastPublishFailMs"); w.writeUInt(snapshot.lastPublishFailMs);
  w.writeString("secureFrameBuffer"); protocolMsgPackWriteReusableBuffer(w, snapshot.secureFrameBuffer);
  w.writeString("eventBatchBuffer"); protocolMsgPackWriteReusableBuffer(w, snapshot.eventBatchBuffer);
}

static void protocolMsgPackWriteWebRtcTransport(P1MsgPackWriter& w, const P1WebRtcTransportSnapshot& snapshot) {
  if (!snapshot.enabled) {
    w.writeMap(1);
    w.writeString("enabled"); w.writeBool(false);
    return;
  }
  uint32_t count = snapshot.root.length() ? 20 : 19;
  if (snapshot.port == 0) count--;
  w.writeMap(count);
  w.writeString("enabled"); w.writeBool(snapshot.enabled);
  w.writeString("started"); w.writeBool(snapshot.started);
  w.writeString("peerOpen"); w.writeBool(snapshot.peerOpen);
  w.writeString("dataChannelOpen"); w.writeBool(snapshot.dataChannelOpen);
  w.writeString("signalingParked"); w.writeBool(snapshot.signalingParked);
  w.writeString("peerState"); w.writeString(snapshot.peerState);
  w.writeString("peerId"); w.writeString(snapshot.peerId);
  w.writeString("remoteId"); w.writeString(snapshot.remoteId);
  w.writeString("signaling"); w.writeString(snapshot.signaling);
  w.writeString("host"); w.writeString(snapshot.host);
  if (snapshot.port > 0) {
    w.writeString("port"); w.writeUInt(snapshot.port);
  }
  if (snapshot.root.length()) {
    w.writeString("root"); w.writeString(snapshot.root);
  }
  w.writeString("secure"); w.writeBool(snapshot.secure);
  w.writeString("sendDrops"); w.writeUInt(snapshot.sendDrops);
  w.writeString("recvDrops"); w.writeUInt(snapshot.recvDrops);
  w.writeString("signalDrops"); w.writeUInt(snapshot.signalDrops);
  w.writeString("connectFailures"); w.writeUInt(snapshot.connectFailures);
  w.writeString("lastSocketReason"); w.writeString(snapshot.lastSocketReason);
  w.writeString("suspended"); w.writeBool(snapshot.suspended);
  w.writeString("scriptSuspended"); w.writeBool(snapshot.scriptSuspended);
}

static void protocolMsgPackWriteLedStatus(P1MsgPackWriter& w, const P1LedStatusSnapshot& snapshot) {
  w.writeMap(10);
  w.writeString("available"); w.writeBool(snapshot.available);
  w.writeString("ready"); w.writeBool(snapshot.ready);
  w.writeString("stripCount"); w.writeUInt(snapshot.stripCount);
  w.writeString("totalLeds"); w.writeUInt(snapshot.totalLeds);
  w.writeString("maxLeds"); w.writeUInt(snapshot.maxLeds);
  w.writeString("maxStrips"); w.writeUInt(snapshot.maxStrips);
  w.writeString("driver"); w.writeString(snapshot.driver);
  w.writeString("chipset"); w.writeString(snapshot.chipset);
  w.writeString("order"); w.writeString(snapshot.order);
  w.writeString("strips");
  w.writeArray(snapshot.stripCount);
  for (uint8_t i = 0; i < snapshot.stripCount; i++) {
    const P1LedStripSnapshot& strip = snapshot.strips[i];
    w.writeMap(8);
    w.writeString("strip"); w.writeUInt(strip.strip);
    w.writeString("ready"); w.writeBool(strip.ready);
    w.writeString("pin"); w.writeInt(strip.pin);
    w.writeString("count"); w.writeUInt(strip.count);
    w.writeString("capacity"); w.writeUInt(strip.capacity);
    w.writeString("brightness"); w.writeUInt(strip.brightness);
    w.writeString("chipset"); w.writeString(strip.chipset);
    w.writeString("order"); w.writeString(strip.order);
  }
}

static void protocolMsgPackWriteUartStatus(P1MsgPackWriter& w, const P1UartStatusSnapshot& snapshot) {
  w.writeMap(2);
  w.writeString("ports");
  w.writeArray(snapshot.portCount);
  for (uint8_t i = 0; i < snapshot.portCount; i++) {
    const P1UartPortSnapshot& port = snapshot.ports[i];
    w.writeMap(6);
    w.writeString("uart"); w.writeUInt(port.uart);
    w.writeString("active"); w.writeBool(port.active);
    w.writeString("rx"); w.writeInt(port.rx);
    w.writeString("tx"); w.writeInt(port.tx);
    w.writeString("baud"); w.writeUInt(port.baud);
    w.writeString("available"); w.writeUInt(port.available);
  }
  w.writeString("reserved");
  w.writeMap(3);
  w.writeString("transportUart"); w.writeUInt(0);
  w.writeString("transportPins"); w.writeArray(2); w.writeUInt(1); w.writeUInt(3);
  w.writeString("flashPins"); w.writeArray(6); w.writeUInt(6); w.writeUInt(7); w.writeUInt(8); w.writeUInt(9); w.writeUInt(10); w.writeUInt(11);
}

static void protocolMsgPackWriteHttpStatus(P1MsgPackWriter& w, const P1HttpFetchStatusSnapshot& snapshot) {
  w.writeMap(12);
  w.writeString("lastCode"); w.writeInt(snapshot.lastCode);
  w.writeString("lastTruncated"); w.writeBool(snapshot.lastTruncated);
  w.writeString("lastError"); w.writeString(snapshot.lastError);
  w.writeString("lastMessage"); w.writeString(snapshot.lastMessage);
  w.writeString("lastDetails"); protocolMsgPackWriteJsonObject(w, "{" + snapshot.lastDetails + "}");
  w.writeString("lastBodyBytes"); w.writeUInt(snapshot.lastBodyBytes);
  w.writeString("lastSecure"); w.writeBool(snapshot.lastSecure);
  w.writeString("lastDurationMs"); w.writeUInt(snapshot.lastDurationMs);
  w.writeString("maxResponseBytes"); w.writeUInt(snapshot.maxResponseBytes);
  w.writeString("defaultTimeoutMs"); w.writeUInt(snapshot.defaultTimeoutMs);
  w.writeString("tlsInsecureDefault"); w.writeBool(snapshot.tlsInsecureDefault);
  w.writeString("failuresAreScriptErrors"); w.writeBool(snapshot.failuresAreScriptErrors);
}

static void protocolMsgPackWriteOtaStatus(P1MsgPackWriter& w, const P1OtaSafeBootStatusSnapshot& snapshot) {
  w.writeMap(19);
  w.writeString("enabled"); w.writeBool(snapshot.enabled);
  w.writeString("updaterPartition"); w.writeBool(snapshot.updaterPartition);
  w.writeString("updaterLabel"); w.writeString(snapshot.updaterLabel);
  w.writeString("pending"); w.writeBool(snapshot.pending);
  w.writeString("downloadPending"); w.writeBool(snapshot.downloadPending);
  w.writeString("kind"); w.writeString(snapshot.kind);
  w.writeString("phase"); w.writeString(snapshot.phase);
  w.writeString("url"); w.writeString(snapshot.url);
  w.writeString("sha256Set"); w.writeBool(snapshot.sha256Set);
  w.writeString("fromSha256Set"); w.writeBool(snapshot.fromSha256Set);
  w.writeString("toSha256Set"); w.writeBool(snapshot.toSha256Set);
  w.writeString("lastError"); w.writeString(snapshot.lastError);
  w.writeString("fromSize"); w.writeUInt(snapshot.fromSize);
  w.writeString("toSize"); w.writeUInt(snapshot.toSize);
  w.writeString("patchSize"); w.writeUInt(snapshot.patchSize);
  w.writeString("patchPartitionSize"); w.writeUInt(snapshot.patchPartitionSize);
  w.writeString("memorySize"); w.writeUInt(snapshot.memorySize);
  w.writeString("segmentSize"); w.writeUInt(snapshot.segmentSize);
  w.writeString("restartPending"); w.writeBool(snapshot.restartPending);
}

static String protocolProjectWifiStatusToJson(const P1WifiSnapshot& snapshot) {
  uint8_t payload[256];
  P1MsgPackWriter w(payload, sizeof(payload));
  protocolMsgPackWriteWifi(w, snapshot);
  String out;
  if (!w.ok || !protocolMsgPackPayloadToJson(payload, w.length, out)) return "{}";
  return out;
}

static String protocolProjectHttpStatusToJson(const P1HttpFetchStatusSnapshot& snapshot) {
  uint8_t payload[512];
  P1MsgPackWriter w(payload, sizeof(payload));
  protocolMsgPackWriteHttpStatus(w, snapshot);
  String out;
  if (!w.ok || !protocolMsgPackPayloadToJson(payload, w.length, out)) return "{}";
  return out;
}

static void protocolMsgPackWriteStatusLightData(P1MsgPackWriter& w, const P1StatusSnapshot& snapshot) {
  w.writeMap(17);
  w.writeString("uptimeMs"); w.writeUInt(snapshot.uptimeMs);
  w.writeString("heapSize"); w.writeUInt(snapshot.heapSize);
  w.writeString("freeHeap"); w.writeUInt(snapshot.freeHeap);
  w.writeString("maxAllocHeap"); w.writeUInt(snapshot.maxAllocHeap);
  w.writeString("timeSynced"); w.writeBool(snapshot.timeSynced);
  w.writeString("localTime"); w.writeString(snapshot.localTime);
  w.writeString("timezone"); w.writeString(snapshot.timezone);
  w.writeString("scriptState"); w.writeString(snapshot.script.state);
  w.writeString("scriptBytes"); w.writeUInt(snapshot.script.bytes);
  w.writeString("scriptHash"); w.writeUInt(snapshot.script.hash);
  w.writeString("wrenchLoopFps"); w.writeFloat(snapshot.script.loopFps);
  w.writeString("wrenchTaskRunning"); w.writeBool(snapshot.script.taskRunning);
  w.writeString("deviceId"); w.writeString(snapshot.deviceId);
  w.writeString("deviceName"); w.writeString(snapshot.deviceName);
  w.writeString("protocol"); w.writeString("msgpack.v0_2");
  w.writeString("wifi"); protocolMsgPackWriteWifi(w, snapshot.wifi);
  w.writeString("lastError");
  if (!snapshot.lastError.hasError) {
    w.writeMap(2);
    w.writeString("hasError"); w.writeBool(false);
    w.writeString("count"); w.writeUInt(snapshot.lastError.count);
  } else {
    w.writeMap(6);
    w.writeString("hasError"); w.writeBool(true);
    w.writeString("phase"); w.writeString(snapshot.lastError.phase);
    w.writeString("code"); w.writeString(snapshot.lastError.code);
    w.writeString("message"); w.writeString(snapshot.lastError.message);
    w.writeString("atMs"); w.writeUInt(snapshot.lastError.atMs);
    w.writeString("count"); w.writeUInt(snapshot.lastError.count);
  }
}

static void protocolSendMsgPackStatusLight(uint32_t id) {
  P1StatusSnapshot snapshot = protocolStatusSnapshot();
  P1ReusableBufferHandle frame;
  if (!protocolAcquireFrameBuffer(P1_EMBED_MSGPACK_MAX_FRAME_BYTES, frame)) {
    protocolSendMsgPackError(id, "no_heap", "No heap for status.light response");
    return;
  }
  P1MsgPackWriter w(frame.data, frame.capacity);
  w.writeArray(4);
  w.writeUInt(P1_MP_FRAME_RES);
  w.writeUInt(id);
  w.writeBool(true);
  protocolMsgPackWriteStatusLightData(w, snapshot);
  if (w.ok) protocolSendMsgPackResponseBytes(id, frame.data, w.length, "status.light response is too large for MQTT");
  else protocolSendMsgPackError(id, "frame_too_large", "status.light response is too large");
  protocolReleaseFrameBuffer(frame);
}

static void protocolMsgPackWriteWifi(P1MsgPackWriter& w, const P1WifiSnapshot& snapshot) {
  w.writeMap(9);
  w.writeString("configured"); w.writeBool(snapshot.configured);
  w.writeString("status"); w.writeString(snapshot.status);
  w.writeString("connected"); w.writeBool(snapshot.connected);
  w.writeString("networkIndex"); w.writeInt(snapshot.networkIndex);
  w.writeString("networkCount"); w.writeInt(snapshot.networkCount);
  w.writeString("ssid"); w.writeString(snapshot.ssid);
  w.writeString("ip"); w.writeString(snapshot.ip);
  w.writeString("rssi"); w.writeInt(snapshot.rssi);
  w.writeString("mac"); w.writeString(snapshot.mac);
}

static void protocolMsgPackBeginResponse(P1MsgPackWriter& w, uint32_t id, bool ok, uint32_t mapCount) {
  w.writeArray(4);
  w.writeUInt(P1_MP_FRAME_RES);
  w.writeUInt(id);
  w.writeBool(ok);
  w.writeMap(mapCount);
}

static void protocolMsgPackWriteStatusCoreFields(P1MsgPackWriter& w, const P1StatusSnapshot& snapshot) {
  w.writeString("uptimeMs"); w.writeUInt(snapshot.uptimeMs);
  w.writeString("heapSize"); w.writeUInt(snapshot.heapSize);
  w.writeString("freeHeap"); w.writeUInt(snapshot.freeHeap);
  w.writeString("minFreeHeap"); w.writeUInt(snapshot.minFreeHeap);
  w.writeString("maxAllocHeap"); w.writeUInt(snapshot.maxAllocHeap);
  w.writeString("timeSynced"); w.writeBool(snapshot.timeSynced);
  w.writeString("localTime"); w.writeString(snapshot.localTime);
  w.writeString("timezone"); w.writeString(snapshot.timezone);
  w.writeString("scriptState"); w.writeString(snapshot.script.state);
  w.writeString("scriptBytes"); w.writeUInt(snapshot.script.bytes);
  w.writeString("scriptHash"); w.writeUInt(snapshot.script.hash);
  w.writeString("hasSetup"); w.writeBool(snapshot.script.hasSetup);
  w.writeString("hasLoop"); w.writeBool(snapshot.script.hasLoop);
  w.writeString("wrenchTaskRunning"); w.writeBool(snapshot.script.taskRunning);
  w.writeString("wrenchLoopCount"); w.writeUInt(snapshot.script.loopCount);
  w.writeString("wrenchLoopFps"); w.writeFloat(snapshot.script.loopFps);
  w.writeString("wrenchLoopHung"); w.writeBool(snapshot.script.loopHung);
  w.writeString("deviceId"); w.writeString(snapshot.deviceId);
  w.writeString("deviceName"); w.writeString(snapshot.deviceName);
  w.writeString("scriptStored"); w.writeBool(snapshot.script.stored);
  w.writeString("scriptRunState"); w.writeString(snapshot.script.runState);
}

static void protocolMsgPackWriteLastError(P1MsgPackWriter& w, const P1ScriptErrorSnapshot& error) {
  if (!error.hasError) {
    w.writeMap(2);
    w.writeString("hasError"); w.writeBool(false);
    w.writeString("count"); w.writeUInt(error.count);
    return;
  }
  const bool hasDetails = error.details && error.details[0];
  w.writeMap(hasDetails ? 7 : 6);
  w.writeString("hasError"); w.writeBool(true);
  w.writeString("phase"); w.writeString(error.phase);
  w.writeString("code"); w.writeString(error.code);
  w.writeString("message"); w.writeString(error.message);
  if (hasDetails) {
    w.writeString("details"); w.writeString(error.details);
  }
  w.writeString("atMs"); w.writeUInt(error.atMs);
  w.writeString("count"); w.writeUInt(error.count);
}

static void protocolMsgPackWriteDebug(P1MsgPackWriter& w, const P1DebugSnapshot& debug) {
  w.writeMap(4);
  w.writeString("level"); w.writeString(debug.level);
  w.writeString("levelValue"); w.writeUInt(debug.levelValue);
  w.writeString("queueDrops"); w.writeUInt(debug.queueDrops);
  w.writeString("queueHighWater"); w.writeUInt(debug.queueHighWater);
}

static void protocolMsgPackWriteReusableBuffer(P1MsgPackWriter& w, const P1ReusableBuffer& buffer) {
  w.writeMap(10);
  w.writeString("capacity"); w.writeUInt((uint32_t)buffer.capacity);
  w.writeString("emaNeed"); w.writeUInt((uint32_t)buffer.emaNeed);
  w.writeString("peakNeed"); w.writeUInt((uint32_t)buffer.peakNeed);
  w.writeString("lastNeed"); w.writeUInt((uint32_t)buffer.lastNeed);
  w.writeString("reuseCount"); w.writeUInt(buffer.reuseCount);
  w.writeString("growCount"); w.writeUInt(buffer.growCount);
  w.writeString("shrinkCount"); w.writeUInt(buffer.shrinkCount);
  w.writeString("tempAllocCount"); w.writeUInt(buffer.tempAllocCount);
  w.writeString("tempFreeCount"); w.writeUInt(buffer.tempFreeCount);
  w.writeString("failCount"); w.writeUInt(buffer.failCount);
}

static void protocolMsgPackWriteWrenchAllocStats(P1MsgPackWriter& w, const P1WrenchAllocStats& stats) {
  w.writeMap(12);
  w.writeString("allocs"); w.writeUInt(stats.allocCount);
  w.writeString("frees"); w.writeUInt(stats.freeCount);
  w.writeString("fails"); w.writeUInt(stats.failCount);
  w.writeString("externalFrees"); w.writeUInt(stats.externalFreeCount);
  w.writeString("requestedBytes"); w.writeUInt(stats.requestedBytes);
  w.writeString("allocatedBytes"); w.writeUInt(stats.allocatedBytes);
  w.writeString("freedBytes"); w.writeUInt(stats.freedBytes);
  w.writeString("activeBytes"); w.writeUInt(stats.activeBytes);
  w.writeString("highWaterBytes"); w.writeUInt(stats.highWaterBytes);
  w.writeString("largestRequest"); w.writeUInt(stats.largestRequest);
  w.writeString("largestAllocated"); w.writeUInt(stats.largestAllocated);
  w.writeString("failedRequest"); w.writeUInt(stats.failedRequest);
}

static void protocolMsgPackWriteWrenchRuntime(P1MsgPackWriter& w, const P1WrenchRuntimeSnapshot& runtime) {
  w.writeMap(13);
  w.writeString("phase"); w.writeString(runtime.phase);
  w.writeString("transitionActive"); w.writeBool(runtime.transitionActive);
  w.writeString("transitionDepth"); w.writeUInt(runtime.transitionDepth);
  w.writeString("transitionReason"); w.writeString(runtime.transitionReason);
  w.writeString("transitionMs"); w.writeUInt(runtime.transitionMs);
  w.writeString("transitionRecoveries"); w.writeUInt(runtime.transitionRecoveries);
  w.writeString("runPending"); w.writeBool(runtime.runPending);
  w.writeString("bytecodeBytes"); w.writeUInt(runtime.bytecodeBytes);
  w.writeString("taskTargetCore"); w.writeInt(runtime.taskTargetCore);
  w.writeString("taskCore"); w.writeInt(runtime.taskCore);
  w.writeString("compileTargetCore"); w.writeInt(runtime.compileTargetCore);
  w.writeString("compileSourceBuffer"); protocolMsgPackWriteReusableBuffer(w, runtime.compileSourceBuffer);
  w.writeString("lastCompileAlloc"); protocolMsgPackWriteWrenchAllocStats(w, runtime.lastCompileAlloc);
}

static void protocolMsgPackWriteMemorySummary(P1MsgPackWriter& w, const P1MemoryProfileSummary& memory) {
  if (!memory.enabled) {
    w.writeMap(1);
    w.writeString("enabled"); w.writeBool(false);
    return;
  }
  w.writeMap(11);
  w.writeString("enabled"); w.writeBool(true);
  w.writeString("capacity"); w.writeUInt(memory.capacity);
  w.writeString("samples"); w.writeUInt(memory.samples);
  w.writeString("staticBytes"); w.writeUInt(memory.staticBytes);
  w.writeString("baseFreeHeap"); w.writeUInt(memory.baseFreeHeap);
  w.writeString("baseMaxAllocHeap"); w.writeUInt(memory.baseMaxAllocHeap);
  w.writeString("currentFreeHeap"); w.writeUInt(memory.currentFreeHeap);
  w.writeString("currentMaxAllocHeap"); w.writeUInt(memory.currentMaxAllocHeap);
  w.writeString("currentMinFreeHeap"); w.writeUInt(memory.currentMinFreeHeap);
  w.writeString("worstFreeHeap"); w.writeUInt(memory.worstFreeHeap);
  w.writeString("worstMaxAllocHeap"); w.writeUInt(memory.worstMaxAllocHeap);
}

static void protocolMsgPackWriteStatusGetData(P1MsgPackWriter& w, const P1StatusSnapshot& snapshot) {
  w.writeMap(29);
  protocolMsgPackWriteStatusCoreFields(w, snapshot);
  w.writeString("wrenchRuntime"); protocolMsgPackWriteWrenchRuntime(w, wrenchRuntimeSnapshot());
  w.writeString("lastError"); protocolMsgPackWriteLastError(w, snapshot.lastError);
  w.writeString("memory"); protocolMsgPackWriteMemorySummary(w, memoryProfileSummarySnapshot());
  w.writeString("web"); protocolMsgPackWriteWebTransport(w, webTransportSnapshot());
  w.writeString("mqtt"); protocolMsgPackWriteMqttTransport(w, mqttTransportSnapshot());
  w.writeString("webrtc"); protocolMsgPackWriteWebRtcTransport(w, webrtcTransportSnapshot());
  w.writeString("led"); protocolMsgPackWriteLedStatus(w, ledStatusSnapshot());
  w.writeString("wifi"); protocolMsgPackWriteWifi(w, snapshot.wifi);
}

static void protocolMsgPackWriteStatusFullData(P1MsgPackWriter& w, const P1StatusSnapshot& snapshot) {
  w.writeMap(42);
  protocolMsgPackWriteStatusCoreFields(w, snapshot);
  w.writeString("wrenchLastLoopMs"); w.writeUInt(wrenchLastLoopMs());
  w.writeString("wrenchLastLoopDurationMs"); w.writeUInt(wrenchLastLoopDurationMs());
  w.writeString("wrenchCurrentLoopStartedAt"); w.writeUInt(wrenchCurrentLoopStartedAt());
  w.writeString("wrenchSlowLoopCount"); w.writeUInt(wrenchSlowLoopCount());
  w.writeString("wrenchHungLoopCount"); w.writeUInt(wrenchHungLoopCount());
  w.writeString("wrenchLockTimeoutCount"); w.writeUInt(wrenchLockTimeoutCount());
  w.writeString("wrenchTaskStackHighWater"); w.writeUInt(snapshot.script.taskStackHighWater);
  w.writeString("wrenchRuntime"); protocolMsgPackWriteWrenchRuntime(w, wrenchRuntimeSnapshot());
  w.writeString("wrenchInboxQueued"); w.writeUInt(wrenchInboxAvailable());
  w.writeString("wrenchInboxDrops"); w.writeUInt(wrenchInboxDrops());
  w.writeString("lastError"); protocolMsgPackWriteLastError(w, snapshot.lastError);
  w.writeString("debug"); protocolMsgPackWriteDebug(w, snapshot.debug);
  w.writeString("memory"); protocolMsgPackWriteMemorySummary(w, memoryProfileSummarySnapshot());
  w.writeString("web"); protocolMsgPackWriteWebTransport(w, webTransportSnapshot());
  w.writeString("mqtt"); protocolMsgPackWriteMqttTransport(w, mqttTransportSnapshot());
  w.writeString("webrtc"); protocolMsgPackWriteWebRtcTransport(w, webrtcTransportSnapshot());
  w.writeString("led"); protocolMsgPackWriteLedStatus(w, ledStatusSnapshot());
  w.writeString("uart"); protocolMsgPackWriteUartStatus(w, uartStatusSnapshot());
  w.writeString("http"); protocolMsgPackWriteHttpStatus(w, httpFetchStatusSnapshot());
  w.writeString("scriptVerificationArmed"); w.writeBool(snapshot.script.verificationArmed);
  w.writeString("wifi"); protocolMsgPackWriteWifi(w, snapshot.wifi);
}

static void protocolMsgPackWriteStatusLiveData(P1MsgPackWriter& w, const P1StatusSnapshot& snapshot) {
  w.writeMap(14);
  w.writeString("uptimeMs"); w.writeUInt(snapshot.uptimeMs);
  w.writeString("freeHeap"); w.writeUInt(snapshot.freeHeap);
  w.writeString("minFreeHeap"); w.writeUInt(snapshot.minFreeHeap);
  w.writeString("maxAllocHeap"); w.writeUInt(snapshot.maxAllocHeap);
  w.writeString("scriptState"); w.writeString(snapshot.script.state);
  w.writeString("scriptBytes"); w.writeUInt(snapshot.script.bytes);
  w.writeString("scriptHash"); w.writeUInt(snapshot.script.hash);
  w.writeString("scriptRunState"); w.writeString(snapshot.script.runState);
  w.writeString("wrenchLoopCount"); w.writeUInt(snapshot.script.loopCount);
  w.writeString("wrenchLoopFps"); w.writeFloat(snapshot.script.loopFps);
  w.writeString("wrenchLoopHung"); w.writeBool(snapshot.script.loopHung);
  w.writeString("wrenchTaskStackHighWater"); w.writeUInt(snapshot.script.taskStackHighWater);
  w.writeString("lastError"); protocolMsgPackWriteLastError(w, snapshot.lastError);
  w.writeString("wifi"); protocolMsgPackWriteWifi(w, snapshot.wifi);
}

static void protocolSendMsgPackStatusGet(uint32_t id) {
  P1StatusSnapshot snapshot = protocolStatusSnapshot();
  P1ReusableBufferHandle frame;
  if (!protocolAcquireFrameBuffer(P1_EMBED_MQTT_BUFFER_BYTES, frame)) {
    protocolSendMsgPackError(id, "no_heap", "No heap for status.get response");
    return;
  }
  P1MsgPackWriter w(frame.data, frame.capacity);
  w.writeArray(4);
  w.writeUInt(P1_MP_FRAME_RES);
  w.writeUInt(id);
  w.writeBool(true);
  protocolMsgPackWriteStatusGetData(w, snapshot);
  if (w.ok) protocolSendMsgPackResponseBytes(id, frame.data, w.length, "status.get response is too large for MQTT");
  else protocolSendMsgPackError(id, "frame_too_large", "status.get response is too large");
  protocolReleaseFrameBuffer(frame);
}

static void protocolSendMsgPackStatusFull(uint32_t id) {
  P1StatusSnapshot snapshot = protocolStatusSnapshot();
  P1ReusableBufferHandle frame;
  if (!protocolAcquireFrameBuffer(P1_EMBED_MQTT_BUFFER_BYTES, frame)) {
    protocolSendMsgPackError(id, "no_heap", "No heap for status.full response");
    return;
  }
  P1MsgPackWriter w(frame.data, frame.capacity);
  w.writeArray(4);
  w.writeUInt(P1_MP_FRAME_RES);
  w.writeUInt(id);
  w.writeBool(true);
  protocolMsgPackWriteStatusFullData(w, snapshot);
  if (w.ok) protocolSendMsgPackResponseBytes(id, frame.data, w.length, "status.full response is too large for MQTT");
  else protocolSendMsgPackError(id, "frame_too_large", "status.full response is too large");
  protocolReleaseFrameBuffer(frame);
}

static void protocolSendMsgPackStatusLive(uint32_t id) {
  P1StatusSnapshot snapshot = protocolStatusSnapshot();
  P1ReusableBufferHandle frame;
  if (!protocolAcquireFrameBuffer(P1_EMBED_MSGPACK_MAX_FRAME_BYTES, frame)) {
    protocolSendMsgPackError(id, "no_heap", "No heap for status.live response");
    return;
  }
  P1MsgPackWriter w(frame.data, frame.capacity);
  w.writeArray(4);
  w.writeUInt(P1_MP_FRAME_RES);
  w.writeUInt(id);
  w.writeBool(true);
  protocolMsgPackWriteStatusLiveData(w, snapshot);
  if (w.ok) protocolSendMsgPackResponseBytes(id, frame.data, w.length, "status.live response is too large for MQTT");
  else protocolSendMsgPackError(id, "frame_too_large", "status.live response is too large");
  protocolReleaseFrameBuffer(frame);
}

static void protocolSendJsonWifiStatus(const String& id) {
  uint8_t payload[192];
  P1MsgPackWriter w(payload, sizeof(payload));
  protocolMsgPackWriteWifi(w, wifiSnapshot());
  if (w.ok) protocolSendJsonResponseFromMsgPackPayload(id, payload, w.length);
  else protocolSendResponseError(id, "frame_too_large", "wifi.status response is too large");
}

static void protocolSendJsonDebugStatus(const String& id) {
  uint8_t payload[128];
  P1MsgPackWriter w(payload, sizeof(payload));
  protocolMsgPackWriteDebug(w, debugEventSnapshot());
  if (w.ok) protocolSendJsonResponseFromMsgPackPayload(id, payload, w.length);
  else protocolSendResponseError(id, "frame_too_large", "debug.get response is too large");
}

static void protocolSendJsonOtaStatus(const String& id) {
  uint8_t payload[1024];
  P1MsgPackWriter w(payload, sizeof(payload));
  protocolMsgPackWriteOtaStatus(w, otaSafeBootStatusSnapshot());
  if (w.ok) protocolSendJsonResponseFromMsgPackPayload(id, payload, w.length);
  else protocolSendResponseError(id, "frame_too_large", "firmware.update.status response is too large");
}

static void protocolSendJsonStatusGet(const String& id) {
  P1StatusSnapshot snapshot = protocolStatusSnapshot();
  P1ReusableBufferHandle payload;
  if (!protocolAcquireFrameBuffer(P1_EMBED_MQTT_BUFFER_BYTES, payload)) {
    protocolSendResponseError(id, "no_heap", "No heap for status.get response");
    return;
  }
  P1MsgPackWriter w(payload.data, payload.capacity);
  protocolMsgPackWriteStatusGetData(w, snapshot);
  if (w.ok) protocolSendJsonResponseFromMsgPackPayload(id, payload.data, w.length);
  else protocolSendResponseError(id, "frame_too_large", "status.get response is too large");
  protocolReleaseFrameBuffer(payload);
}

static void protocolSendJsonStatusFull(const String& id) {
  P1StatusSnapshot snapshot = protocolStatusSnapshot();
  P1ReusableBufferHandle payload;
  if (!protocolAcquireFrameBuffer(P1_EMBED_MQTT_BUFFER_BYTES, payload)) {
    protocolSendResponseError(id, "no_heap", "No heap for status.full response");
    return;
  }
  P1MsgPackWriter w(payload.data, payload.capacity);
  protocolMsgPackWriteStatusFullData(w, snapshot);
  if (w.ok) protocolSendJsonResponseFromMsgPackPayload(id, payload.data, w.length);
  else protocolSendResponseError(id, "frame_too_large", "status.full response is too large");
  protocolReleaseFrameBuffer(payload);
}

static void protocolSendJsonStatusLive(const String& id) {
  P1StatusSnapshot snapshot = protocolStatusSnapshot();
  P1ReusableBufferHandle payload;
  if (!protocolAcquireFrameBuffer(P1_EMBED_MSGPACK_MAX_FRAME_BYTES, payload)) {
    protocolSendResponseError(id, "no_heap", "No heap for status.live response");
    return;
  }
  P1MsgPackWriter w(payload.data, payload.capacity);
  protocolMsgPackWriteStatusLiveData(w, snapshot);
  if (w.ok) protocolSendJsonResponseFromMsgPackPayload(id, payload.data, w.length);
  else protocolSendResponseError(id, "frame_too_large", "status.live response is too large");
  protocolReleaseFrameBuffer(payload);
}

static void protocolSendMsgPackSystemInfo(uint32_t id) {
  P1ConfigSnapshot config = configSnapshot();
  P1ReusableBufferHandle frame;
  if (!protocolAcquireFrameBuffer(P1_EMBED_MSGPACK_MAX_FRAME_BYTES, frame)) {
    protocolSendMsgPackError(id, "no_heap", "No heap for system.info response");
    return;
  }
  P1MsgPackWriter w(frame.data, frame.capacity);
  protocolMsgPackBeginResponse(w, id, true, 13);
  w.writeString("firmwareName"); w.writeString(P1_EMBED_FIRMWARE_NAME);
  w.writeString("firmwareVersion"); w.writeString(P1_EMBED_FIRMWARE_VERSION);
  w.writeString("buildChannel"); w.writeString(P1_EMBED_BUILD_CHANNEL);
  w.writeString("protocolVersion"); w.writeString(P1_EMBED_PROTOCOL_VERSION);
  w.writeString("wrenchApiVersion"); w.writeString(P1_EMBED_WRENCH_API_VERSION);
  w.writeString("deviceId"); w.writeString(config.deviceId);
  w.writeString("deviceName"); w.writeString(config.deviceName);
  w.writeString("board"); w.writeString("esp32-classic");
  w.writeString("chipModel"); w.writeString(ESP.getChipModel());
  w.writeString("sdkVersion"); w.writeString(ESP.getSdkVersion());
  w.writeString("heapSize"); w.writeUInt(ESP.getHeapSize());
  w.writeString("capabilities"); w.writeArray(5);
  w.writeString("transport.mqtt.msgpack");
  w.writeString("protocol.msgpack.v0_2");
  w.writeString("wrench.compile");
  w.writeString("wrench.bindings.ui_guino");
  w.writeString("wifi.station");
  w.writeString("wifi"); protocolMsgPackWriteWifi(w, config.wifi);
  if (w.ok) protocolSendMsgPackResponseBytes(id, frame.data, w.length, "system.info response is too large for MQTT");
  else protocolSendMsgPackError(id, "frame_too_large", "system.info response is too large");
  protocolReleaseFrameBuffer(frame);
}

static String protocolConfigResponseJson(const P1ConfigSnapshot& snapshot) {
  String out = "{";
  out += "\"deviceId\":" + jsonString(snapshot.deviceId);
  out += ",\"deviceName\":" + jsonString(snapshot.deviceName);
  out += ",\"projectId\":" + jsonString(snapshot.projectId);
  out += ",\"projectName\":" + jsonString(snapshot.projectName);
  out += ",\"revisionId\":" + jsonString(snapshot.revisionId);
  out += ",\"scriptName\":" + jsonString(snapshot.scriptName);
  out += ",\"timezone\":" + jsonString(snapshot.timezone);
  out += ",\"wifiSsid\":" + jsonString(snapshot.wifiSsid);
  out += ",\"wifiPasswordSet\":" + String(snapshot.wifiPasswordSet ? "true" : "false");
  out += ",\"wifiNetworkCount\":" + String(snapshot.wifiNetworkCount);
  out += ",\"mqttHost\":" + jsonString(snapshot.mqttHost);
  out += ",\"mqttPort\":" + String(snapshot.mqttPort);
  out += ",\"mqttRoot\":" + jsonString(snapshot.mqttRoot);
  out += ",\"mqttUser\":" + jsonString(snapshot.mqttUser);
  out += ",\"mqttPasswordSet\":" + String(snapshot.mqttPasswordSet ? "true" : "false");
  out += ",\"mqttEnabled\":" + String(snapshot.mqttEnabled ? "true" : "false");
  out += ",\"allowUnauthenticatedAccess\":" + String(snapshot.allowUnauthenticatedAccess ? "true" : "false");
  out += ",\"mqttAllowAnonymousUi\":" + String(snapshot.mqttAllowAnonymousUi ? "true" : "false");
  out += ",\"mqttAllowAnonymousScript\":" + String(snapshot.mqttAllowAnonymousScript ? "true" : "false");
  out += ",\"mqttGuestUiKeySet\":" + String(snapshot.mqttGuestUiKeySet ? "true" : "false");
  out += ",\"mqttGuestUiKey\":" + jsonString(snapshot.mqttGuestUiKey);
  out += ",\"onlineAuthUserCount\":" + String(snapshot.onlineAuthUserCount);
  out += ",\"onlineAuthUserMax\":" + String(snapshot.onlineAuthUserMax);
  out += ",\"onlineAuthUsers\":[";
  for (int i = 0; i < snapshot.onlineAuthUserCount; i++) {
    if (i) out += ",";
    out += "{\"username\":" + jsonString(configOnlineAuthUserNameAt(i)) + "}";
  }
  out += "]";
  out += ",\"wifiNetworks\":[";
  for (int i = 0; i < snapshot.wifiNetworkCount; i++) {
    if (i) out += ",";
    out += "{\"ssid\":" + jsonString(configWifiSsidAt(i));
    out += ",\"passwordSet\":" + String(configWifiPasswordAt(i).length() ? "true" : "false") + "}";
  }
  out += "]";
  out += ",\"storage\":\"littlefs:/config.json\"";
  out += ",\"wifi\":" + protocolProjectWifiStatusToJson(snapshot.wifi);
  out += "}";
  return out;
}

static void protocolMsgPackWriteConfigResponse(P1MsgPackWriter& w, uint32_t id, const P1ConfigSnapshot& snapshot) {
  protocolMsgPackBeginResponse(w, id, true, 27);
  w.writeString("deviceId"); w.writeString(snapshot.deviceId);
  w.writeString("deviceName"); w.writeString(snapshot.deviceName);
  w.writeString("projectId"); w.writeString(snapshot.projectId);
  w.writeString("projectName"); w.writeString(snapshot.projectName);
  w.writeString("revisionId"); w.writeString(snapshot.revisionId);
  w.writeString("scriptName"); w.writeString(snapshot.scriptName);
  w.writeString("timezone"); w.writeString(snapshot.timezone);
  w.writeString("wifiSsid"); w.writeString(snapshot.wifiSsid);
  w.writeString("wifiPasswordSet"); w.writeBool(snapshot.wifiPasswordSet);
  w.writeString("wifiNetworkCount"); w.writeUInt(snapshot.wifiNetworkCount);
  w.writeString("mqttHost"); w.writeString(snapshot.mqttHost);
  w.writeString("mqttPort"); w.writeUInt(snapshot.mqttPort);
  w.writeString("mqttRoot"); w.writeString(snapshot.mqttRoot);
  w.writeString("mqttUser"); w.writeString(snapshot.mqttUser);
  w.writeString("mqttPasswordSet"); w.writeBool(snapshot.mqttPasswordSet);
  w.writeString("mqttEnabled"); w.writeBool(snapshot.mqttEnabled);
  w.writeString("allowUnauthenticatedAccess"); w.writeBool(snapshot.allowUnauthenticatedAccess);
  w.writeString("mqttAllowAnonymousUi"); w.writeBool(snapshot.mqttAllowAnonymousUi);
  w.writeString("mqttAllowAnonymousScript"); w.writeBool(snapshot.mqttAllowAnonymousScript);
  w.writeString("mqttGuestUiKeySet"); w.writeBool(snapshot.mqttGuestUiKeySet);
  w.writeString("mqttGuestUiKey"); w.writeString(snapshot.mqttGuestUiKey);
  w.writeString("onlineAuthUserCount"); w.writeUInt(snapshot.onlineAuthUserCount);
  w.writeString("onlineAuthUserMax"); w.writeUInt(snapshot.onlineAuthUserMax);
  w.writeString("onlineAuthUsers");
  w.writeArray(snapshot.onlineAuthUserCount);
  for (int i = 0; i < snapshot.onlineAuthUserCount; i++) {
    w.writeMap(1);
    w.writeString("username"); w.writeString(configOnlineAuthUserNameAt(i));
  }
  w.writeString("wifiNetworks");
  w.writeArray(snapshot.wifiNetworkCount);
  for (int i = 0; i < snapshot.wifiNetworkCount; i++) {
    w.writeMap(2);
    w.writeString("ssid"); w.writeString(configWifiSsidAt(i));
    w.writeString("passwordSet"); w.writeBool(configWifiPasswordAt(i).length() > 0);
  }
  w.writeString("storage"); w.writeString("littlefs:/config.json");
  w.writeString("wifi"); protocolMsgPackWriteWifi(w, snapshot.wifi);
}

static void protocolSendMsgPackConfig(uint32_t id) {
  P1ConfigSnapshot snapshot = configSnapshot();
  P1ReusableBufferHandle frame;
  if (!protocolAcquireFrameBuffer(P1_EMBED_MSGPACK_MAX_FRAME_BYTES, frame)) {
    protocolSendMsgPackError(id, "no_heap", "No heap for config.get response");
    return;
  }
  P1MsgPackWriter w(frame.data, frame.capacity);
  protocolMsgPackWriteConfigResponse(w, id, snapshot);
  if (w.ok) protocolSendMsgPackResponseBytes(id, frame.data, w.length, "config.get response is too large for MQTT");
  else protocolSendMsgPackError(id, "frame_too_large", "config.get response is too large");
  protocolReleaseFrameBuffer(frame);
}

static void protocolSendMsgPackWifiStatus(uint32_t id) {
  P1WifiSnapshot snapshot = wifiSnapshot();
  uint8_t frame[256];
  P1MsgPackWriter w(frame, sizeof(frame));
  protocolMsgPackBeginResponse(w, id, true, 1);
  w.writeString("wifi"); protocolMsgPackWriteWifi(w, snapshot);
  if (w.ok) protocolSendMsgPackBytes(frame, w.length);
}

static void protocolSendMsgPackDebug(uint32_t id) {
  P1DebugSnapshot snapshot = debugEventSnapshot();
  uint8_t frame[160];
  P1MsgPackWriter w(frame, sizeof(frame));
  protocolMsgPackBeginResponse(w, id, true, 5);
  w.writeString("level"); w.writeString(snapshot.level);
  w.writeString("levelName"); w.writeString(snapshot.level);
  w.writeString("levelValue"); w.writeUInt(snapshot.levelValue);
  w.writeString("queueDrops"); w.writeUInt(snapshot.queueDrops);
  w.writeString("queueHighWater"); w.writeUInt(snapshot.queueHighWater);
  if (w.ok) protocolSendMsgPackBytes(frame, w.length);
}

static void protocolSendMsgPackScriptError(uint32_t id) {
  P1ScriptErrorSnapshot snapshot = scriptErrorSnapshot();
  P1ReusableBufferHandle frame;
  if (!protocolAcquireFrameBuffer(512, frame)) {
    protocolSendMsgPackError(id, "no_heap", "No heap for script.error response");
    return;
  }
  P1MsgPackWriter w(frame.data, frame.capacity);
  if (!snapshot.hasError) {
    protocolMsgPackBeginResponse(w, id, true, 2);
    w.writeString("hasError"); w.writeBool(false);
    w.writeString("count"); w.writeUInt(snapshot.count);
  } else {
    const size_t detailsLen = snapshot.details ? strlen(snapshot.details) : 0;
    const bool hasDetails = detailsLen > 0 && detailsLen < 128;
    protocolMsgPackBeginResponse(w, id, true, hasDetails ? 8 : 7);
    w.writeString("hasError"); w.writeBool(true);
    w.writeString("phase"); w.writeString(snapshot.phase);
    w.writeString("code"); w.writeString(snapshot.code);
    w.writeString("message"); w.writeString(snapshot.message);
    w.writeString("atMs"); w.writeUInt(snapshot.atMs);
    w.writeString("count"); w.writeUInt(snapshot.count);
    w.writeString("detailText"); w.writeString(hasDetails ? snapshot.details : "");
    if (hasDetails) {
      w.writeString("detailFormat");
      w.writeString("json-fields");
    }
  }
  if (w.ok) protocolSendMsgPackResponseBytes(id, frame.data, w.length, "script.error response is too large for MQTT");
  else protocolSendMsgPackError(id, "frame_too_large", "script.error response is too large");
  protocolReleaseFrameBuffer(frame);
}

static void protocolSendMsgPackScriptGet(uint32_t id) {
  String code = wrenchCurrentScript();
  if (code.length() > P1_EMBED_LEGACY_SCRIPT_JSON_MAX_BYTES) {
    protocolSendMsgPackError(id, "legacy_script_too_large", "script.get is limited; use script.chunk.get");
    return;
  }
  P1ScriptSnapshot snapshot = protocolScriptSnapshot(&code);
  size_t capacity = code.length() + 192;
  if (capacity < 512) capacity = 512;
  if (capacity > P1_EMBED_WEBRTC_SEND_MAX_BYTES) {
    protocolSendMsgPackError(id, "script_too_large", "Stored script is too large for one MessagePack response");
    return;
  }
  P1ReusableBufferHandle frame;
  if (!protocolAcquireFrameBuffer(capacity, frame)) {
    protocolSendMsgPackError(id, "no_heap", "No heap for script.get response");
    return;
  }
  P1MsgPackWriter w(frame.data, frame.capacity);
  protocolMsgPackBeginResponse(w, id, true, 6);
  w.writeString("code"); w.writeString(snapshot.code);
  w.writeString("state"); w.writeString(snapshot.state);
  w.writeString("stored"); w.writeBool(snapshot.stored);
  w.writeString("runState"); w.writeString(snapshot.runState);
  w.writeString("revisionId"); w.writeString(configRevisionId());
  w.writeString("scriptName"); w.writeString(configScriptName());
  if (w.ok) protocolSendMsgPackResponseBytes(id, frame.data, w.length, "script.get response is too large for MQTT; use script.chunk.get");
  if (!w.ok) protocolSendMsgPackError(id, "frame_too_large", "Stored script did not fit in MessagePack response");
  protocolReleaseFrameBuffer(frame);
}

static void protocolSendMsgPackOtaStatus(uint32_t id) {
  P1ReusableBufferHandle frame;
  if (!protocolAcquireFrameBuffer(1024, frame)) {
    protocolSendMsgPackError(id, "no_heap", "No heap for firmware.update.status response");
    return;
  }
  P1MsgPackWriter w(frame.data, frame.capacity);
  w.writeArray(4);
  w.writeUInt(P1_MP_FRAME_RES);
  w.writeUInt(id);
  w.writeBool(true);
  protocolMsgPackWriteOtaStatus(w, otaSafeBootStatusSnapshot());
  if (w.ok) protocolSendMsgPackBytes(frame.data, w.length);
  else protocolSendMsgPackError(id, "frame_too_large", "firmware.update.status response is too large");
  protocolReleaseFrameBuffer(frame);
}

static void protocolSendMsgPackState(uint32_t id, const char* state) {
  uint8_t frame[96];
  P1MsgPackWriter w(frame, sizeof(frame));
  protocolMsgPackBeginResponse(w, id, true, 1);
  w.writeString("state"); w.writeString(state);
  if (w.ok) protocolSendMsgPackBytes(frame, w.length);
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
  if (w.ok) protocolSendMsgPackBytes(frame, w.length);
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
  if (w.ok) protocolSendMsgPackBytes(frame, w.length);
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
  if (w.ok) protocolSendMsgPackBytes(frame, w.length);
}

static void protocolSendMsgPackInbox(uint32_t id) {
  uint8_t frame[96];
  P1MsgPackWriter w(frame, sizeof(frame));
  protocolMsgPackBeginResponse(w, id, true, 2);
  w.writeString("queued"); w.writeUInt(wrenchInboxAvailable());
  w.writeString("drops"); w.writeUInt(wrenchInboxDrops());
  if (w.ok) protocolSendMsgPackBytes(frame, w.length);
}

static void protocolSendMsgPackChunkBeginOk(uint32_t id, int expectedBytes) {
  uint8_t frame[96];
  P1MsgPackWriter w(frame, sizeof(frame));
  protocolMsgPackBeginResponse(w, id, true, 2);
  w.writeString("received"); w.writeUInt(0);
  w.writeString("expectedBytes"); w.writeUInt(expectedBytes);
  if (w.ok) protocolSendMsgPackBytes(frame, w.length);
}

static void protocolSendMsgPackChunkCommitOk(uint32_t id, int scriptBytes) {
  uint8_t frame[96];
  P1MsgPackWriter w(frame, sizeof(frame));
  protocolMsgPackBeginResponse(w, id, true, 2);
  w.writeString("state"); w.writeString("queued");
  w.writeString("scriptBytes"); w.writeUInt(scriptBytes);
  if (w.ok) protocolSendMsgPackBytes(frame, w.length);
}

static bool protocolHandleCommandFrame(const P1FrameView& frame, P1ProtocolReplyMode replyMode, P1ProtocolSource source, const String& jsonId) {
  P1MsgPackReader r(frame.data, frame.len);
  r.offset = frame.argsOffset;
  const uint32_t id = frame.id;
  const uint32_t op = frame.op;

  if (op == P1_MP_OP_PING) {
    protocolSendCommandPong(replyMode, id, jsonId);
  } else if (op == P1_MP_OP_STATUS_LIGHT) {
    if (replyMode == P1_REPLY_MSGPACK) protocolSendMsgPackStatusLight(id);
    else protocolSendResponseOk(jsonId, protocolProjectStatusLightToJson());
  } else if (op == P1_MP_OP_STATUS_GET) {
    protocolSendCommandStatusGet(replyMode, id, jsonId);
  } else if (op == P1_MP_OP_STATUS_FULL) {
    protocolSendCommandStatusFull(replyMode, id, jsonId);
  } else if (op == P1_MP_OP_STATUS_LIVE) {
    protocolSendCommandStatusLive(replyMode, id, jsonId);
  } else if (op == P1_MP_OP_SYSTEM_INFO) {
    protocolSendCommandSystemInfo(replyMode, id, jsonId);
  } else if (op == P1_MP_OP_CONFIG_GET) {
    protocolSendCommandConfig(replyMode, id, jsonId);
  } else if (op == P1_MP_OP_CONFIG_SET) {
    protocolHandleConfigSetFrame(frame, replyMode, jsonId);
  } else if (op == P1_MP_OP_PROTOCOL_MODE) {
    if (source != P1_PROTOCOL_SOURCE_SERIAL) {
      protocolSendCommandError(replyMode, id, jsonId, "unsupported_source", "protocol.mode only applies to the serial transport");
      return true;
    }
    String mode;
    if (!r.readString(mode)) {
      protocolSendCommandError(replyMode, id, jsonId, "bad_protocol_mode_frame", "protocol.mode requires mode");
      return true;
    }
    mode.toLowerCase();
    bool msgpackMode = mode == "msgpack" || mode == "binary";
    bool jsonMode = mode == "json" || mode == "line";
    if (!msgpackMode && !jsonMode) {
      protocolSendCommandError(replyMode, id, jsonId, "bad_protocol_mode", "Use json or msgpack");
      return true;
    }
    protocolSendCommandProtocolMode(replyMode, id, jsonId, msgpackMode);
    transportSerialSetMsgPackMode(msgpackMode);
  } else if (op == P1_MP_OP_WIFI_STATUS) {
    protocolSendCommandWifiStatus(replyMode, id, jsonId);
  } else if (op == P1_MP_OP_WIFI_CONNECT) {
    wifiReconnect();
    protocolSendCommandWifiStatus(replyMode, id, jsonId);
  } else if (op == P1_MP_OP_WIFI_DISCONNECT) {
    wifiDisconnect();
    protocolSendCommandWifiStatus(replyMode, id, jsonId);
  } else if (op == P1_MP_OP_WIFI_FORGET) {
    uint32_t index = 0;
    if (!r.readUInt(index)) {
      protocolSendCommandError(replyMode, id, jsonId, "bad_wifi_forget_frame", "wifi.forget frame is malformed");
      return true;
    }
    if (!configRemoveWifiNetworkAt((int)index)) {
      protocolSendCommandError(replyMode, id, jsonId, "bad_wifi_index", "WiFi network index is invalid");
      return true;
    }
    configSave();
    wifiReconnect();
    protocolSendCommandConfig(replyMode, id, jsonId);
  } else if (op == P1_MP_OP_SCRIPT_ERROR_GET) {
    protocolSendCommandScriptError(replyMode, id, jsonId);
  } else if (op == P1_MP_OP_SCRIPT_ERROR_CLEAR) {
    scriptErrorClear();
    protocolSendCommandScriptError(replyMode, id, jsonId);
  } else if (op == P1_MP_OP_SCRIPT_INPUT) {
    String channel;
    String message;
    if (!r.readString(channel) || !r.readString(message) || message.length() == 0) {
      protocolSendCommandError(replyMode, id, jsonId, "missing_message", "script.input requires message");
      return true;
    }
    if (uiInputPush(channel, message)) {
      protocolSendCommandInbox(replyMode, id, jsonId, true);
      return true;
    }
    if (!wrenchInboxPush(channel, message)) {
      protocolSendCommandError(replyMode, id, jsonId, "inbox_full", "Wrench input inbox is full");
      return true;
    }
    protocolSendCommandInbox(replyMode, id, jsonId, false);
  } else if (op == P1_MP_OP_DEBUG_GET) {
    protocolSendCommandDebug(replyMode, id, jsonId);
  } else if (op == P1_MP_OP_DEBUG_SET) {
    String level;
    if (!r.readString(level)) {
      protocolSendCommandError(replyMode, id, jsonId, "missing_level", "debug.set requires level");
      return true;
    }
    if (!debugEventSetLevelName(level)) {
      protocolSendCommandError(replyMode, id, jsonId, "bad_level", "Use error, warn, info, debug, or trace");
      return true;
    }
    protocolSendCommandDebug(replyMode, id, jsonId);
  } else if (op == P1_MP_OP_SCRIPT_GET) {
    protocolSendCommandScriptGet(replyMode, id, jsonId);
  } else if (op == P1_MP_OP_SCRIPT_CHUNK_BEGIN) {
    uint32_t expectedBytes = 0;
    String expectedHashHex;
    bool runAfterSet = false;
    bool saveAfterSet = false;
    if (!r.readUInt(expectedBytes) || !r.readString(expectedHashHex) ||
        !r.readBool(runAfterSet) || !r.readBool(saveAfterSet)) {
      protocolSendCommandError(replyMode, id, jsonId, "bad_begin_frame", "script.chunk.begin frame is malformed");
      return true;
    }
    if (expectedBytes == 0 || expectedBytes > P1_EMBED_MAX_SCRIPT_BYTES) {
      protocolSendCommandError(replyMode, id, jsonId, "script_too_large", "Invalid script size");
      return true;
    }
    if (expectedHashHex.length() == 0) {
      protocolSendCommandError(replyMode, id, jsonId, "missing_hash", "script.chunk.begin requires codeHash");
      return true;
    }
    if (!scriptStoreBeginIncoming()) {
      protocolSendCommandError(replyMode, id, jsonId, "storage_error", "Failed to start staged script upload");
      return true;
    }
    protocolPrepareScriptUpload();
    g_scriptChunkActive = true;
    g_scriptChunkRun = runAfterSet;
    g_scriptChunkSave = saveAfterSet;
    g_scriptChunkExpectedBytes = expectedBytes;
    g_scriptChunkReceivedBytes = 0;
    g_scriptChunkExpectedHashHex = expectedHashHex;
    protocolSendCommandChunkBeginOk(replyMode, id, jsonId, expectedBytes);
  } else if (op == P1_MP_OP_SCRIPT_CHUNK_ADD) {
    if (!g_scriptChunkActive) {
      protocolSendCommandError(replyMode, id, jsonId, "no_upload", "No chunked script upload is active");
      return true;
    }
    uint32_t offset = 0;
    const uint8_t* chunk = nullptr;
    size_t chunkLen = 0;
    if (!r.readUInt(offset) || !r.readBin(chunk, chunkLen)) {
      protocolSendCommandError(replyMode, id, jsonId, "bad_chunk_frame", "script.chunk.add frame requires offset and bytes");
      return true;
    }
    if ((int)offset != g_scriptChunkReceivedBytes) {
      protocolSendCommandError(replyMode, id, jsonId, "bad_offset", "Script chunk offset did not match received bytes");
      return true;
    }
    if (g_scriptChunkReceivedBytes + (int)chunkLen > g_scriptChunkExpectedBytes) {
      protocolSendCommandError(replyMode, id, jsonId, "too_many_bytes", "Script chunk exceeds expected size");
      return true;
    }
    if (!scriptStoreAppendIncomingBytes(chunk, chunkLen)) {
      protocolSendCommandError(replyMode, id, jsonId, "storage_error", "Failed to append script chunk");
      return true;
    }
    g_scriptChunkReceivedBytes += chunkLen;
    protocolSendCommandReceived(replyMode, id, jsonId, g_scriptChunkReceivedBytes);
  } else if (op == P1_MP_OP_SCRIPT_CHUNK_GET) {
    uint32_t offset = 0;
    uint32_t maxBytes = 0;
    if (!r.readUInt(offset) || !r.readUInt(maxBytes)) {
      protocolSendCommandError(replyMode, id, jsonId, "bad_chunk_get_frame", "script.chunk.get frame requires offset and maxBytes");
      return true;
    }
    protocolSendCommandScriptChunkGet(replyMode, id, jsonId, offset, maxBytes);
  } else if (op == P1_MP_OP_SCRIPT_CHUNK_COMMIT) {
    if (!g_scriptChunkActive) {
      protocolSendCommandError(replyMode, id, jsonId, "no_upload", "No chunked script upload is active");
      return true;
    }
    if (g_scriptChunkReceivedBytes != g_scriptChunkExpectedBytes) {
      protocolSendCommandError(replyMode, id, jsonId, "incomplete_upload", "Script upload is missing chunks");
      return true;
    }
    size_t scriptBytes = 0;
    uint32_t scriptHash = 2166136261u;
    if (!scriptStoreIncomingInfo(scriptBytes, scriptHash) || scriptBytes == 0) {
      scriptStoreClearIncoming();
      g_scriptChunkActive = false;
      protocolSendCommandError(replyMode, id, jsonId, "storage_error", "Failed to load staged script");
      return true;
    }
    String errorCode;
    String errorMessage;
    if (!protocolScriptIntegrityInfoOk(scriptBytes, scriptHash, g_scriptChunkExpectedBytes, g_scriptChunkExpectedHashHex, errorCode, errorMessage)) {
      scriptStoreClearIncoming();
      g_scriptChunkActive = false;
      protocolSendCommandError(replyMode, id, jsonId, errorCode.c_str(), errorMessage.c_str());
      return true;
    }
    bool runAfterSet = g_scriptChunkRun;
    bool saveAfterSet = g_scriptChunkSave;
    g_scriptChunkActive = false;
    int expectedBytes = g_scriptChunkExpectedBytes;
    String expectedHashHex = g_scriptChunkExpectedHashHex;
    g_scriptChunkExpectedHashHex = "";
    protocolSendCommandChunkCommitOk(replyMode, id, jsonId, scriptBytes);
    protocolQueueScriptJob(runAfterSet, saveAfterSet, expectedBytes, expectedHashHex, scriptBytes);
  } else if (op == P1_MP_OP_SCRIPT_STOP) {
    wrenchStop();
    if (scriptStoreHasSaved()) scriptStoreSaveRunState(P1_EMBED_SCRIPT_RUN_STOPPED);
    protocolSendCommandState(replyMode, id, jsonId, "stopped", "stopped");
  } else if (op == P1_MP_OP_SCRIPT_RESTART) {
    if (wrenchCurrentScript().length() == 0) {
      protocolSendCommandError(replyMode, id, jsonId, "no_script", "No compiled script is available");
      return true;
    }
    if (scriptStoreHasSaved()) scriptStoreSaveRunState(P1_EMBED_SCRIPT_RUN_PENDING_NEW);
    wrenchRequestRun();
    protocolSendCommandState(replyMode, id, jsonId, "run_pending");
  } else if (op == P1_MP_OP_DEVICE_REBOOT) {
    if (replyMode == P1_REPLY_MSGPACK) {
      uint8_t responseFrame[80];
      P1MsgPackWriter w(responseFrame, sizeof(responseFrame));
      protocolMsgPackBeginResponse(w, id, true, 1);
      w.writeString("rebooting"); w.writeBool(true);
      if (w.ok) protocolSendMsgPackBytes(responseFrame, w.length);
    } else {
      protocolSendResponseOk(jsonId, "{\"rebooting\":true}");
    }
    delay(50);
    ESP.restart();
  } else if (op == P1_MP_OP_FIRMWARE_UPDATE_STATUS) {
    protocolSendCommandOtaStatus(replyMode, id, jsonId);
  } else if (op == P1_MP_OP_FIRMWARE_UPDATE_CLEAR) {
    if (!protocolSourceAllowsOtaWrite(source)) {
      protocolSendCommandError(replyMode, id, jsonId, "auth_required", "Firmware update changes require USB or authenticated MQTT");
      return true;
    }
    if (!otaSafeBootClearRequest()) {
      protocolSendCommandError(replyMode, id, jsonId, "ota_clear_failed", "Failed to clear firmware update request");
      return true;
    }
    protocolSendCommandOtaStatus(replyMode, id, jsonId);
  } else if (op == P1_MP_OP_FIRMWARE_UPDATE_PREPARE) {
    if (!protocolSourceAllowsOtaWrite(source)) {
      protocolSendCommandError(replyMode, id, jsonId, "auth_required", "Firmware update changes require USB or authenticated MQTT");
      return true;
    }
    P1OtaRequest request;
    bool reboot = false;
    if (!r.readString(request.url) || !r.readString(request.sha256) || !r.readBool(reboot)) {
      protocolSendCommandError(replyMode, id, jsonId, "bad_ota_prepare_frame", "firmware.update.prepare frame is malformed");
      return true;
    }
    if (r.offset < r.length && !r.readString(request.kind)) {
      protocolSendCommandError(replyMode, id, jsonId, "bad_ota_prepare_frame", "firmware.update.prepare kind is malformed");
      return true;
    }
    if (r.offset < r.length && !r.readString(request.fromSha256)) {
      protocolSendCommandError(replyMode, id, jsonId, "bad_ota_prepare_frame", "firmware.update.prepare fromSha256 is malformed");
      return true;
    }
    if (r.offset < r.length && !r.readString(request.toSha256)) {
      protocolSendCommandError(replyMode, id, jsonId, "bad_ota_prepare_frame", "firmware.update.prepare toSha256 is malformed");
      return true;
    }
    if (r.offset < r.length && !r.readUInt(request.fromSize)) {
      protocolSendCommandError(replyMode, id, jsonId, "bad_ota_prepare_frame", "firmware.update.prepare fromSize is malformed");
      return true;
    }
    if (r.offset < r.length && !r.readUInt(request.toSize)) {
      protocolSendCommandError(replyMode, id, jsonId, "bad_ota_prepare_frame", "firmware.update.prepare toSize is malformed");
      return true;
    }
    if (r.offset < r.length && !r.readUInt(request.memorySize)) {
      protocolSendCommandError(replyMode, id, jsonId, "bad_ota_prepare_frame", "firmware.update.prepare memorySize is malformed");
      return true;
    }
    if (r.offset < r.length && !r.readUInt(request.segmentSize)) {
      protocolSendCommandError(replyMode, id, jsonId, "bad_ota_prepare_frame", "firmware.update.prepare segmentSize is malformed");
      return true;
    }
    String err;
    if (!otaSafeBootRequestUpdate(request, err)) {
      protocolSendCommandError(replyMode, id, jsonId, "ota_prepare_failed", err.c_str());
      return true;
    }
    if (reboot && !otaSafeBootBootUpdater(err)) {
      protocolSendCommandError(replyMode, id, jsonId, "ota_boot_failed", err.c_str());
      return true;
    }
    protocolSendCommandOtaStatus(replyMode, id, jsonId);
  } else if (op == P1_MP_OP_FIRMWARE_UPDATE_BOOT) {
    if (!protocolSourceAllowsOtaWrite(source)) {
      protocolSendCommandError(replyMode, id, jsonId, "auth_required", "Firmware update changes require USB or authenticated MQTT");
      return true;
    }
    String err;
    if (!otaSafeBootBootUpdater(err)) {
      protocolSendCommandError(replyMode, id, jsonId, "ota_boot_failed", err.c_str());
      return true;
    }
    protocolSendCommandOtaStatus(replyMode, id, jsonId);
  } else {
    return false;
  }
  return true;
}

void protocolHandleBytes(const uint8_t* data, size_t len, P1ProtocolSource source) {
  if (!data || len == 0) return;
  if (data[0] == '{' || data[0] == '[') {
    protocolEmitErrorEvent("protocol.error", "json_on_binary_channel", "Binary protocol channel only accepts MessagePack frames");
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
  P1FrameView frame;
  frame.data = data;
  frame.len = len;
  frame.count = count;
  frame.frameType = frameType;
  frame.id = id;
  frame.op = op;
  frame.argsOffset = r.offset;

  if (!protocolHandleCommandFrame(frame, P1_REPLY_MSGPACK, source, String())) {
    protocolEmitErrorEvent("protocol.error", "unknown_msgpack_op", "Unknown MessagePack command");
  }
}

void protocolHandleLine(const char* line, P1ProtocolSource source) {
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

  uint8_t frameBytes[P1_EMBED_MSGPACK_MAX_FRAME_BYTES];
  size_t frameLen = 0;
  if (protocolJsonCommandToMsgPack(line, id, name, frameBytes, sizeof(frameBytes), frameLen)) {
    P1FrameView frame;
    if (!protocolParseCommandFrame(frameBytes, frameLen, frame)) {
      protocolSendResponseError(id, "bad_command_frame", "JSON command could not be encoded");
      return;
    }
    if (!protocolHandleCommandFrame(frame, P1_REPLY_JSON, source, id)) {
      protocolSendResponseError(id, "unknown_command", String("Unknown command: ") + name);
    }
    return;
  }

  if (name == "memory.profile") {
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
  } else if (name == "http.probe") {
    String url;
    int maxBytes = 64;
    int timeoutMs = P1_EMBED_HTTP_DEFAULT_TIMEOUT_MS;
    if (!jsonGetString(line, "url", url) || !url.length()) {
      protocolSendResponseError(id, "missing_url", "http.probe requires data.url");
      return;
    }
    jsonGetInt(line, "maxBytes", maxBytes);
    jsonGetInt(line, "timeoutMs", timeoutMs);
    protocolSendResponseOk(id, protocolHttpProbeJson(url, maxBytes, timeoutMs));
  } else if (!P1_EMBED_WRENCH_ENABLED && (name.startsWith("script.") || name == "wrench.input")) {
    protocolSendResponseError(id, "wrench_disabled", "Wrench is disabled in this WebRTC lab firmware");
  } else if (name == "script.set") {
    bool runAfterSet = false;
    bool saveAfterSet = false;
    jsonGetBool(line, "run", runAfterSet);
    jsonGetBool(line, "save", saveAfterSet);
    protocolHandleScriptSet(id, line, runAfterSet, saveAfterSet);
  } else if (name == "script.bytecode.set") {
    protocolHandleScriptBytecodeSet(id, line);
  } else if (name == "script.save") {
    String code;
    if (!jsonGetString(line, "code", code)) code = wrenchCurrentScript();
    if (code.length() > P1_EMBED_LEGACY_SCRIPT_JSON_MAX_BYTES) {
      protocolSendResponseError(id, "legacy_script_too_large", "script.save with inline code is limited; use script.chunk.begin/add/commit");
      return;
    }
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
    scriptStoreSaveRunState(autorun ? P1_EMBED_SCRIPT_RUN_PENDING_NEW : P1_EMBED_SCRIPT_RUN_STOPPED);
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
    if (code.length() > P1_EMBED_LEGACY_SCRIPT_JSON_MAX_BYTES) {
      protocolSendResponseError(id, "legacy_script_too_large", "script.compile with inline code is limited; use script.chunk.begin/add/commit");
      return;
    }
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
      if (code.length() > P1_EMBED_LEGACY_SCRIPT_JSON_MAX_BYTES) {
        protocolSendResponseError(id, "legacy_script_too_large", "script.run with inline code is limited; use script.chunk.begin/add/commit");
        return;
      }
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
    if (scriptStoreHasSaved()) scriptStoreSaveRunState(P1_EMBED_SCRIPT_RUN_PENDING_NEW);
    wrenchRequestRun();
    protocolSendResponseOk(id, "{\"state\":\"run_pending\",\"scriptBytes\":" + String(code.length()) + ",\"scriptHash\":" + String(protocolFnv1a(code)) + "}");
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
