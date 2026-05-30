#include <Arduino.h>
#include <WiFi.h>
#include <esp_system.h>
#include <mbedtls/aes.h>
#include <mbedtls/md.h>
#include "p1_embed_firmware.h"

#if P1_EMBED_MQTT_ENABLED
#include <MQTT.h>

static WiFiClient g_mqttNet;
static MQTTClient g_mqtt(P1_EMBED_MQTT_BUFFER_BYTES);
static bool g_mqttBegun = false;
static unsigned long g_mqttLastAttemptMs = 0;
static String g_mqttDeviceId;
static String g_mqttClientId;
static String g_mqttCmdTopicPrefix;
static String g_mqttEvtTopic;
static String g_mqttHelloTopic;
static String g_mqttScriptInTopic;
static String g_mqttScriptOutTopic;
static String g_mqttActiveResponseTopic;
static int g_mqttActiveSessionIndex = -1;

static const uint8_t P1_MQTT_FRAME_AUTH = 3;
static const uint8_t P1_MQTT_FRAME_SECURE = 4;
static const uint8_t P1_MP_FRAME_BATCH = 3;
static const uint8_t P1_MQTT_AUTH_START = 0;
static const uint8_t P1_MQTT_AUTH_CHALLENGE = 1;
static const uint8_t P1_MQTT_AUTH_FINISH = 2;
static const uint8_t P1_MQTT_AUTH_OK = 3;
static const uint8_t P1_MQTT_AUTH_ERROR = 4;
static const unsigned long P1_MQTT_AUTH_PENDING_TIMEOUT_MS = 10000;
static const size_t P1_MQTT_CLIENT_ID_MAX = 64;
static const size_t P1_MQTT_USERNAME_MAX = 32;

struct MqttPendingAuth {
  bool active = false;
  char clientId[P1_MQTT_CLIENT_ID_MAX + 1] = {0};
  char username[P1_MQTT_USERNAME_MAX + 1] = {0};
  uint8_t key[32];
  uint8_t clientNonce[16];
  uint8_t serverNonce[16];
  unsigned long startedAt = 0;
};

struct MqttSession {
  bool active = false;
  char clientId[P1_MQTT_CLIENT_ID_MAX + 1] = {0};
  char username[P1_MQTT_USERNAME_MAX + 1] = {0};
  uint32_t sessionId = 0;
  uint32_t lastRxCounter = 0;
  uint32_t txCounter = 0;
  unsigned long lastSeenAt = 0;
  uint8_t key[32];
};

static MqttPendingAuth g_mqttPendingAuth[P1_EMBED_MQTT_MAX_USERS];
static MqttSession g_mqttSessions[P1_EMBED_MQTT_MAX_USERS];
static uint8_t* g_mqttEventBatch = nullptr;
static size_t g_mqttEventBatchLen = 0;
static uint8_t g_mqttEventBatchCount = 0;

static void mqttCopyText(char* dst, size_t dstLen, const String& src) {
  if (!dst || dstLen == 0) return;
  size_t n = src.length();
  if (n >= dstLen) n = dstLen - 1;
  memcpy(dst, src.c_str(), n);
  dst[n] = 0;
}

static bool mqttTextEquals(const char* stored, const String& value) {
  return stored && strcmp(stored, value.c_str()) == 0;
}

static void mqttClearPendingAuth(MqttPendingAuth& auth) {
  auth.active = false;
  auth.clientId[0] = 0;
  auth.username[0] = 0;
  auth.startedAt = 0;
  memset(auth.key, 0, sizeof(auth.key));
  memset(auth.clientNonce, 0, sizeof(auth.clientNonce));
  memset(auth.serverNonce, 0, sizeof(auth.serverNonce));
}

static void mqttClearSession(MqttSession& session) {
  session.active = false;
  session.clientId[0] = 0;
  session.username[0] = 0;
  session.sessionId = 0;
  session.lastRxCounter = 0;
  session.txCounter = 0;
  session.lastSeenAt = 0;
  memset(session.key, 0, sizeof(session.key));
}

static String mqttNormalizeTopicPart(String value) {
  value.trim();
  value.toLowerCase();
  value.replace(" ", "-");
  return value;
}

static String mqttDeviceTopicId() {
  String id = configDeviceId();
  if (id.length() >= 6) {
    return mqttNormalizeTopicPart(String("p1-embed-") + id.substring(id.length() - 6));
  }
  return mqttNormalizeTopicPart(id.length() ? id : configDeviceName());
}

static String mqttBaseTopic() {
  return String("p1e/") + configMqttRoot() + "/" + g_mqttDeviceId;
}

static String mqttResponseTopic(const String& clientId) {
  return mqttBaseTopic() + "/res/" + mqttNormalizeTopicPart(clientId);
}

static String mqttClientFromCommandTopic(const String& topic) {
  String prefix = g_mqttCmdTopicPrefix + "/";
  if (!topic.startsWith(prefix)) return "";
  String clientId = topic.substring(prefix.length());
  clientId.trim();
  return clientId;
}

static bool mqttIsScriptInTopic(const String& topic) {
  return g_mqttScriptInTopic.length() && topic == g_mqttScriptInTopic;
}

static bool mqttFrameIsResponse(const uint8_t* data, size_t len) {
  return data && len >= 2 && (data[0] & 0xf0) == 0x90 && data[1] == 1;
}

static bool mqttFrameIsEvent(const uint8_t* data, size_t len) {
  return data && len >= 2 && (data[0] & 0xf0) == 0x90 && data[1] == 2;
}

static bool mqttAuthRequired() {
  return configOnlineAuthUserCount() > 0;
}

static void mqttRandomBytes(uint8_t* out, size_t len) {
  if (!out) return;
  for (size_t i = 0; i < len; i += 4) {
    uint32_t value = esp_random();
    for (size_t j = 0; j < 4 && i + j < len; j++) out[i + j] = uint8_t(value >> (j * 8));
  }
}

static uint32_t mqttRandomSessionId() {
  uint32_t id = 0;
  while (id == 0) id = esp_random();
  return id;
}

static bool mqttHmacStart(mbedtls_md_context_t& ctx, const uint8_t key[32]) {
  const mbedtls_md_info_t* info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if (!info) return false;
  mbedtls_md_init(&ctx);
  if (mbedtls_md_setup(&ctx, info, 1) != 0) return false;
  if (mbedtls_md_hmac_starts(&ctx, key, 32) != 0) return false;
  return true;
}

static void mqttHmacUpdateString(mbedtls_md_context_t& ctx, const char* value) {
  if (!value) value = "";
  mbedtls_md_hmac_update(&ctx, reinterpret_cast<const uint8_t*>(value), strlen(value));
  const uint8_t sep = 0;
  mbedtls_md_hmac_update(&ctx, &sep, 1);
}

static void mqttHmacUpdateU32(mbedtls_md_context_t& ctx, uint32_t value) {
  uint8_t data[4] = {uint8_t(value >> 24), uint8_t(value >> 16), uint8_t(value >> 8), uint8_t(value)};
  mbedtls_md_hmac_update(&ctx, data, sizeof(data));
}

static bool mqttHmacFinish(mbedtls_md_context_t& ctx, uint8_t out[32]) {
  bool ok = mbedtls_md_hmac_finish(&ctx, out) == 0;
  mbedtls_md_free(&ctx);
  return ok;
}

static bool mqttAuthProof(const uint8_t key[32], const String& clientId, const String& username,
                          const uint8_t clientNonce[16], const uint8_t serverNonce[16], uint8_t out[32]) {
  mbedtls_md_context_t ctx;
  if (!mqttHmacStart(ctx, key)) return false;
  mqttHmacUpdateString(ctx, "P1E-MQTT-AUTH-v1");
  mqttHmacUpdateString(ctx, clientId.c_str());
  mqttHmacUpdateString(ctx, username.c_str());
  mbedtls_md_hmac_update(&ctx, clientNonce, 16);
  mbedtls_md_hmac_update(&ctx, serverNonce, 16);
  return mqttHmacFinish(ctx, out);
}

static bool mqttSecureTag(const uint8_t key[32], uint32_t sessionId, uint32_t counter,
                          const uint8_t* payload, size_t payloadLen, uint8_t out[32]) {
  mbedtls_md_context_t ctx;
  if (!mqttHmacStart(ctx, key)) return false;
  mqttHmacUpdateString(ctx, "P1E-MQTT-SECURE-v1");
  mqttHmacUpdateU32(ctx, sessionId);
  mqttHmacUpdateU32(ctx, counter);
  if (payload && payloadLen) mbedtls_md_hmac_update(&ctx, payload, payloadLen);
  return mqttHmacFinish(ctx, out);
}

static void mqttSecureIv(uint32_t sessionId, uint32_t counter, uint8_t direction, uint8_t iv[16]) {
  memset(iv, 0, 16);
  iv[0] = uint8_t(sessionId >> 24);
  iv[1] = uint8_t(sessionId >> 16);
  iv[2] = uint8_t(sessionId >> 8);
  iv[3] = uint8_t(sessionId);
  iv[4] = uint8_t(counter >> 16);
  iv[5] = uint8_t(counter >> 8);
  iv[6] = uint8_t(counter);
  iv[7] = direction;
}

static bool mqttAesCtrCrypt(const uint8_t key[32], uint32_t sessionId, uint32_t counter, uint8_t direction,
                            const uint8_t* input, uint8_t* output, size_t len) {
  if ((!input || !output) && len) return false;
  mbedtls_aes_context aes;
  mbedtls_aes_init(&aes);
  bool ok = mbedtls_aes_setkey_enc(&aes, key, 256) == 0;
  if (ok) {
    uint8_t nonceCounter[16];
    uint8_t streamBlock[16] = {0};
    size_t ncOff = 0;
    mqttSecureIv(sessionId, counter, direction, nonceCounter);
    ok = mbedtls_aes_crypt_ctr(&aes, len, &ncOff, nonceCounter, streamBlock, input, output) == 0;
  }
  mbedtls_aes_free(&aes);
  return ok;
}

static bool mqttConstantTimeEqual(const uint8_t* a, const uint8_t* b, size_t len) {
  if (!a || !b) return false;
  uint8_t diff = 0;
  for (size_t i = 0; i < len; i++) diff |= a[i] ^ b[i];
  return diff == 0;
}

static int mqttFindSession(uint32_t sessionId, const String& clientId = "") {
  for (int i = 0; i < P1_EMBED_MQTT_MAX_USERS; i++) {
    if (!g_mqttSessions[i].active || g_mqttSessions[i].sessionId != sessionId) continue;
    if (clientId.length() && !mqttTextEquals(g_mqttSessions[i].clientId, clientId)) continue;
    uint8_t key[32];
    if (!configOnlineAuthUserKey(g_mqttSessions[i].username, key)) {
      mqttClearSession(g_mqttSessions[i]);
      return -1;
    }
    memcpy(g_mqttSessions[i].key, key, sizeof(key));
    return i;
  }
  return -1;
}

static bool mqttRawOpAllowed(const uint8_t* data, size_t len) {
  if (!mqttAuthRequired()) return true;
  if (!configMqttAllowAnonymousUi()) return false;
  if (!data || len == 0) return false;
  P1MsgPackReader r(data, len);
  uint32_t count = 0;
  uint32_t frameType = 0;
  uint32_t id = 0;
  uint32_t op = 0;
  if (!r.readArray(count) || count < 3 || !r.readUInt(frameType) || !r.readUInt(id) || !r.readUInt(op)) return false;
  return frameType == 0 && (op == 2 || op == 3 || op == 9 || op == 14);
}

static void mqttReapPendingAuth() {
  unsigned long now = millis();
  for (int i = 0; i < P1_EMBED_MQTT_MAX_USERS; i++) {
    if (!g_mqttPendingAuth[i].active) continue;
    if (now - g_mqttPendingAuth[i].startedAt > P1_MQTT_AUTH_PENDING_TIMEOUT_MS) {
      mqttClearPendingAuth(g_mqttPendingAuth[i]);
    }
  }
}

static void mqttReapIdleSessions() {
  unsigned long now = millis();
  for (int i = 0; i < P1_EMBED_MQTT_MAX_USERS; i++) {
    if (!g_mqttSessions[i].active) continue;
    if (g_mqttSessions[i].lastSeenAt && now - g_mqttSessions[i].lastSeenAt > P1_EMBED_MQTT_SESSION_IDLE_MS) {
      mqttClearSession(g_mqttSessions[i]);
    }
  }
}

static void mqttPublishAuthError(const String& clientId, const char* code) {
  uint8_t frame[96];
  P1MsgPackWriter w(frame, sizeof(frame));
  w.writeArray(3);
  w.writeUInt(P1_MQTT_FRAME_AUTH);
  w.writeUInt(P1_MQTT_AUTH_ERROR);
  w.writeString(code ? code : "auth_error");
  if (w.ok) g_mqtt.publish(mqttResponseTopic(clientId).c_str(), reinterpret_cast<const char*>(frame), (int)w.length, false, 0);
}

static bool mqttPublishSecure(const String& topic, int sessionIndex, const uint8_t* payload, size_t payloadLen) {
  if (sessionIndex < 0 || sessionIndex >= P1_EMBED_MQTT_MAX_USERS || !g_mqttSessions[sessionIndex].active) return false;
  if (!payload || payloadLen == 0 || payloadLen + 80 > P1_EMBED_MQTT_BUFFER_BYTES) return false;
  MqttSession& session = g_mqttSessions[sessionIndex];
  uint32_t counter = ++session.txCounter;
  session.lastSeenAt = millis();

  size_t frameCapacity = payloadLen + 96;
  uint8_t* frame = static_cast<uint8_t*>(malloc(frameCapacity));
  if (!frame) {
    debugLog("warn", "mqtt", "secure frame alloc failed");
    return false;
  }

  P1MsgPackWriter w(frame, frameCapacity);
  w.writeArray(5);
  w.writeUInt(P1_MQTT_FRAME_SECURE);
  w.writeUInt(session.sessionId);
  w.writeUInt(counter);

  if (payloadLen <= 0xff) {
    w.writeByte(0xc4);
    w.writeByte(payloadLen);
  } else if (payloadLen <= 0xffff) {
    w.writeByte(0xc5);
    w.writeByte(payloadLen >> 8);
    w.writeByte(payloadLen);
  } else {
    free(frame);
    return false;
  }
  if (!w.ok || w.length + payloadLen + 36 > w.capacity) {
    free(frame);
    return false;
  }
  uint8_t* cipher = frame + w.length;
  if (!mqttAesCtrCrypt(session.key, session.sessionId, counter, 1, payload, cipher, payloadLen)) {
    free(frame);
    return false;
  }
  w.length += payloadLen;

  uint8_t tag[32];
  if (!mqttSecureTag(session.key, session.sessionId, counter, cipher, payloadLen, tag)) {
    free(frame);
    return false;
  }
  w.writeBin(tag, sizeof(tag));
  if (!w.ok) {
    free(frame);
    return false;
  }
  size_t tagOffset = w.length >= 34 ? w.length - 34 : 0;
  if (!tagOffset || frame[tagOffset] != 0xc4 || frame[tagOffset + 1] != 32) {
    debugLog("warn", "mqtt", "secure frame self-check failed");
    free(frame);
    return false;
  }
  bool ok = g_mqtt.publish(topic.c_str(), reinterpret_cast<const char*>(frame), (int)w.length, false, 0);
  if (!ok) debugLog("warn", "mqtt", "secure publish failed");
  free(frame);
  return ok;
}

static void mqttHandleAuthFrame(const String& clientId, const uint8_t* data, size_t len) {
  P1MsgPackReader r(data, len);
  uint32_t count = 0;
  uint32_t frameType = 0;
  uint32_t op = 0;
  if (!r.readArray(count) || count < 2 || !r.readUInt(frameType) || frameType != P1_MQTT_FRAME_AUTH || !r.readUInt(op)) return;

  if (op == P1_MQTT_AUTH_START) {
    mqttReapPendingAuth();
    String frameClientId;
    String username;
    const uint8_t* clientNonce = nullptr;
    size_t clientNonceLen = 0;
    if (count < 5 || !r.readString(frameClientId) || !r.readString(username) || !r.readBin(clientNonce, clientNonceLen) || clientNonceLen != 16) {
      mqttPublishAuthError(clientId, "bad_auth_start");
      return;
    }
    if (frameClientId.length() && frameClientId != clientId) {
      mqttPublishAuthError(clientId, "client_mismatch");
      return;
    }
    uint8_t key[32];
    if (!configOnlineAuthUserKey(username, key)) {
      mqttPublishAuthError(clientId, "unknown_user");
      return;
    }
    int slot = -1;
    for (int i = 0; i < P1_EMBED_MQTT_MAX_USERS; i++) {
      if (g_mqttPendingAuth[i].active && mqttTextEquals(g_mqttPendingAuth[i].clientId, clientId)) {
        slot = i;
        break;
      }
    }
    if (slot < 0) {
      for (int i = 0; i < P1_EMBED_MQTT_MAX_USERS; i++) {
        if (!g_mqttPendingAuth[i].active) {
          slot = i;
          break;
        }
      }
    }
    if (slot < 0) {
      mqttPublishAuthError(clientId, "auth_busy");
      return;
    }
    g_mqttPendingAuth[slot].active = true;
    mqttCopyText(g_mqttPendingAuth[slot].clientId, sizeof(g_mqttPendingAuth[slot].clientId), clientId);
    mqttCopyText(g_mqttPendingAuth[slot].username, sizeof(g_mqttPendingAuth[slot].username), username);
    memcpy(g_mqttPendingAuth[slot].key, key, sizeof(key));
    memcpy(g_mqttPendingAuth[slot].clientNonce, clientNonce, 16);
    mqttRandomBytes(g_mqttPendingAuth[slot].serverNonce, 16);
    g_mqttPendingAuth[slot].startedAt = millis();

    uint8_t frame[128];
    P1MsgPackWriter w(frame, sizeof(frame));
    w.writeArray(5);
    w.writeUInt(P1_MQTT_FRAME_AUTH);
    w.writeUInt(P1_MQTT_AUTH_CHALLENGE);
    w.writeBin(g_mqttPendingAuth[slot].serverNonce, 16);
    w.writeBool(mqttAuthRequired());
    w.writeBool(configMqttAllowAnonymousUi());
    if (w.ok) g_mqtt.publish(mqttResponseTopic(clientId).c_str(), reinterpret_cast<const char*>(frame), (int)w.length, false, 0);
    return;
  }

  if (op == P1_MQTT_AUTH_FINISH) {
    mqttReapPendingAuth();
    mqttReapIdleSessions();
    String username;
    const uint8_t* clientNonce = nullptr;
    const uint8_t* serverNonce = nullptr;
    const uint8_t* tag = nullptr;
    size_t clientNonceLen = 0;
    size_t serverNonceLen = 0;
    size_t tagLen = 0;
    if (count < 6 || !r.readString(username) || !r.readBin(clientNonce, clientNonceLen) ||
        !r.readBin(serverNonce, serverNonceLen) || !r.readBin(tag, tagLen) ||
        clientNonceLen != 16 || serverNonceLen != 16 || tagLen != 32) {
      mqttPublishAuthError(clientId, "bad_auth_finish");
      return;
    }
    int pending = -1;
    for (int i = 0; i < P1_EMBED_MQTT_MAX_USERS; i++) {
      if (g_mqttPendingAuth[i].active && mqttTextEquals(g_mqttPendingAuth[i].clientId, clientId) &&
          mqttTextEquals(g_mqttPendingAuth[i].username, username) &&
          memcmp(g_mqttPendingAuth[i].clientNonce, clientNonce, 16) == 0 &&
          memcmp(g_mqttPendingAuth[i].serverNonce, serverNonce, 16) == 0) {
        pending = i;
        break;
      }
    }
    if (pending < 0) {
      mqttPublishAuthError(clientId, "auth_expired");
      return;
    }
    uint8_t expected[32];
    if (!mqttAuthProof(g_mqttPendingAuth[pending].key, clientId, username, clientNonce, serverNonce, expected) ||
        !mqttConstantTimeEqual(expected, tag, 32)) {
      mqttClearPendingAuth(g_mqttPendingAuth[pending]);
      mqttPublishAuthError(clientId, "auth_failed");
      return;
    }
    for (int i = 0; i < P1_EMBED_MQTT_MAX_USERS; i++) {
      if (g_mqttSessions[i].active && mqttTextEquals(g_mqttSessions[i].clientId, clientId)) {
        mqttClearSession(g_mqttSessions[i]);
      }
    }
    int slot = -1;
    for (int i = 0; i < P1_EMBED_MQTT_MAX_USERS; i++) {
      if (!g_mqttSessions[i].active) {
        slot = i;
        break;
      }
    }
    if (slot < 0) {
      unsigned long oldest = 0;
      for (int i = 0; i < P1_EMBED_MQTT_MAX_USERS; i++) {
        if (!g_mqttSessions[i].active) continue;
        if (slot < 0 || g_mqttSessions[i].lastSeenAt < oldest) {
          slot = i;
          oldest = g_mqttSessions[i].lastSeenAt;
        }
      }
      if (slot < 0) {
        mqttPublishAuthError(clientId, "session_busy");
        return;
      }
      mqttClearSession(g_mqttSessions[slot]);
    }
    g_mqttSessions[slot].active = true;
    mqttCopyText(g_mqttSessions[slot].clientId, sizeof(g_mqttSessions[slot].clientId), clientId);
    mqttCopyText(g_mqttSessions[slot].username, sizeof(g_mqttSessions[slot].username), username);
    g_mqttSessions[slot].sessionId = mqttRandomSessionId();
    g_mqttSessions[slot].lastRxCounter = 0;
    g_mqttSessions[slot].txCounter = 0;
    g_mqttSessions[slot].lastSeenAt = millis();
    memcpy(g_mqttSessions[slot].key, g_mqttPendingAuth[pending].key, 32);
    mqttClearPendingAuth(g_mqttPendingAuth[pending]);

    uint8_t frame[64];
    P1MsgPackWriter w(frame, sizeof(frame));
    w.writeArray(3);
    w.writeUInt(P1_MQTT_FRAME_AUTH);
    w.writeUInt(P1_MQTT_AUTH_OK);
    w.writeUInt(g_mqttSessions[slot].sessionId);
    if (w.ok) g_mqtt.publish(mqttResponseTopic(clientId).c_str(), reinterpret_cast<const char*>(frame), (int)w.length, false, 0);
  }
}

static void mqttHandleSecureFrame(const String& clientId, uint8_t* data, size_t len) {
  P1MsgPackReader r(data, len);
  uint32_t count = 0;
  uint32_t frameType = 0;
  uint32_t sessionId = 0;
  uint32_t counter = 0;
  const uint8_t* payload = nullptr;
  const uint8_t* tag = nullptr;
  size_t payloadLen = 0;
  size_t tagLen = 0;
  if (!r.readArray(count) || count < 5 || !r.readUInt(frameType) || frameType != P1_MQTT_FRAME_SECURE ||
      !r.readUInt(sessionId) || !r.readUInt(counter) || !r.readBin(payload, payloadLen) ||
      !r.readBin(tag, tagLen) || tagLen != 32) {
    mqttPublishAuthError(clientId, "bad_secure_frame");
    return;
  }
  int sessionIndex = mqttFindSession(sessionId, clientId);
  if (sessionIndex < 0) {
    mqttPublishAuthError(clientId, "session_invalid");
    return;
  }
  MqttSession& session = g_mqttSessions[sessionIndex];
  session.lastSeenAt = millis();
  if (counter <= session.lastRxCounter) {
    mqttPublishAuthError(clientId, "replay");
    return;
  }
  uint8_t expected[32];
  if (!mqttSecureTag(session.key, sessionId, counter, payload, payloadLen, expected) ||
      !mqttConstantTimeEqual(expected, tag, 32)) {
    mqttPublishAuthError(clientId, "bad_signature");
    return;
  }
  session.lastRxCounter = counter;
  uint8_t* plain = const_cast<uint8_t*>(payload);
  if (!mqttAesCtrCrypt(session.key, sessionId, counter, 0, payload, plain, payloadLen)) {
    mqttPublishAuthError(clientId, "decrypt_failed");
    return;
  }
  g_mqttActiveSessionIndex = sessionIndex;
  protocolHandleBytes(plain, payloadLen);
  g_mqttActiveSessionIndex = -1;
}

static void mqttPublishHello() {
  String payload = "{";
  payload += "\"deviceId\":" + jsonString(configDeviceId());
  payload += ",\"deviceName\":" + jsonString(configDeviceName());
  payload += ",\"topicId\":" + jsonString(g_mqttDeviceId);
  payload += ",\"firmwareVersion\":" + jsonString(P1_EMBED_FIRMWARE_VERSION);
  payload += ",\"transport\":\"mqtt.msgpack\"";
  payload += ",\"auth\":" + jsonString(mqttAuthRequired() ? "required" : "open");
  payload += ",\"onlineAuthUsers\":" + String(configOnlineAuthUserCount());
  payload += ",\"anonymousUi\":" + String(configMqttAllowAnonymousUi() ? "true" : "false");
  payload += ",\"anonymousScript\":" + String(configMqttAllowAnonymousScript() ? "true" : "false");
  payload += "}";
  g_mqtt.publish(g_mqttHelloTopic, payload, true, 0);
}

static void mqttHandleMessage(MQTTClient*, char topic[], char bytes[], int length) {
  if (!topic || !bytes || length <= 0) return;
  String topicText(topic);
  if (mqttIsScriptInTopic(topicText)) {
    if (!configMqttAllowAnonymousScript()) return;
    String message;
    message.reserve(length);
    for (int i = 0; i < length; i++) message += bytes[i];
    message.trim();
    if (!wrenchInboxPush("mqtt", message)) {
      debugLog("warn", "mqtt", "script text inbox full");
    }
    return;
  }

  String clientId = mqttClientFromCommandTopic(topicText);
  if (clientId.length() == 0) return;
  g_mqttActiveResponseTopic = mqttResponseTopic(clientId);
  uint8_t* data = reinterpret_cast<uint8_t*>(bytes);
  size_t len = (size_t)length;
  if (len >= 2 && (data[0] & 0xf0) == 0x90 && data[1] == P1_MQTT_FRAME_AUTH) {
    mqttHandleAuthFrame(clientId, data, len);
  } else if (len >= 2 && (data[0] & 0xf0) == 0x90 && data[1] == P1_MQTT_FRAME_SECURE) {
    mqttHandleSecureFrame(clientId, data, len);
  } else if (mqttRawOpAllowed(data, len)) {
    protocolHandleBytes(data, len);
  } else {
    mqttPublishAuthError(clientId, "auth_required");
  }
  g_mqttActiveResponseTopic = "";
}

static bool mqttConnect() {
  if (!configMqttEnabled()) return false;
  g_mqttDeviceId = mqttDeviceTopicId();
  g_mqttClientId = String("p1e-device-") + g_mqttDeviceId;
  g_mqttCmdTopicPrefix = mqttBaseTopic() + "/cmd";
  g_mqttEvtTopic = mqttBaseTopic() + "/evt";
  g_mqttHelloTopic = mqttBaseTopic() + "/hello";
  g_mqttScriptInTopic = mqttBaseTopic() + "/script/in";
  g_mqttScriptOutTopic = mqttBaseTopic() + "/script/out";

  if (!g_mqttBegun) {
    g_mqtt.begin(configMqttHost().c_str(), configMqttPort(), g_mqttNet);
    g_mqtt.setOptions(P1_EMBED_MQTT_KEEPALIVE_SECONDS, true, P1_EMBED_MQTT_TIMEOUT_MS);
    g_mqtt.onMessageAdvanced(mqttHandleMessage);
    g_mqttBegun = true;
  }

  debugLog("debug", "mqtt", "connecting");
  String user = configMqttUser();
  String pass = configMqttPassword();
  bool ok = g_mqtt.connect(g_mqttClientId.c_str(), user.c_str(), pass.c_str());
  if (!ok) {
    debugLog("debug", "mqtt", "connect failed");
    return false;
  }

  g_mqtt.subscribe(g_mqttCmdTopicPrefix + "/+");
  g_mqtt.subscribe(g_mqttScriptInTopic);
  mqttPublishHello();
  debugLog("info", "mqtt", "open");
  return true;
}

void mqttTransportBegin() {
  g_mqttDeviceId = mqttDeviceTopicId();
}

void mqttTransportApplyConfig() {
  if (g_mqtt.connected()) g_mqtt.disconnect();
  g_mqttBegun = false;
  g_mqttCmdTopicPrefix = "";
  g_mqttEvtTopic = "";
  g_mqttHelloTopic = "";
  g_mqttScriptInTopic = "";
  g_mqttScriptOutTopic = "";
  g_mqttLastAttemptMs = 0;
  for (int i = 0; i < P1_EMBED_MQTT_MAX_USERS; i++) {
    mqttClearPendingAuth(g_mqttPendingAuth[i]);
    mqttClearSession(g_mqttSessions[i]);
  }
}

static bool mqttPublishEventPayload(const uint8_t* data, size_t len) {
  if (!data || len == 0 || len > P1_EMBED_MQTT_BUFFER_BYTES || !g_mqtt.connected()) return false;
  bool sent = false;
  if (mqttAuthRequired()) {
    for (int i = 0; i < P1_EMBED_MQTT_MAX_USERS; i++) {
      if (!g_mqttSessions[i].active) continue;
      if (g_mqttSessions[i].lastSeenAt && millis() - g_mqttSessions[i].lastSeenAt > P1_EMBED_MQTT_SESSION_IDLE_MS) continue;
      if (mqttPublishSecure(mqttResponseTopic(String(g_mqttSessions[i].clientId)), i, data, len)) sent = true;
    }
    if (!configMqttAllowAnonymousUi()) return sent;
  }
  if (g_mqttEvtTopic.length()) {
    if (g_mqtt.publish(g_mqttEvtTopic.c_str(), reinterpret_cast<const char*>(data), (int)len, false, 0)) sent = true;
  }
  return sent;
}

static void mqttEventBatchReset() {
  if (!g_mqttEventBatch) return;
  g_mqttEventBatch[0] = 0x92;
  g_mqttEventBatch[1] = P1_MP_FRAME_BATCH;
  g_mqttEventBatch[2] = 0x90;
  g_mqttEventBatchLen = 3;
  g_mqttEventBatchCount = 0;
}

static void mqttFlushEventBatch() {
  if (!g_mqttEventBatch || g_mqttEventBatchCount == 0) return;
  g_mqttEventBatch[2] = 0x90 | (g_mqttEventBatchCount & 0x0f);
  mqttPublishEventPayload(g_mqttEventBatch, g_mqttEventBatchLen);
  mqttEventBatchReset();
}

static bool mqttAppendEventBatch(const uint8_t* data, size_t len) {
  if (!data || len == 0 || len > 0xffff) return false;
  if (!g_mqttEventBatch) {
    g_mqttEventBatch = static_cast<uint8_t*>(malloc(P1_EMBED_MQTT_EVENT_BATCH_BYTES));
    if (!g_mqttEventBatch) return false;
    mqttEventBatchReset();
  }

  size_t overhead = len <= 0xff ? 2 : 3;
  if (g_mqttEventBatchCount >= P1_EMBED_MQTT_EVENT_BATCH_FRAMES ||
      g_mqttEventBatchLen + overhead + len > P1_EMBED_MQTT_EVENT_BATCH_BYTES) {
    mqttFlushEventBatch();
  }
  if (g_mqttEventBatchLen + overhead + len > P1_EMBED_MQTT_EVENT_BATCH_BYTES) return false;

  if (len <= 0xff) {
    g_mqttEventBatch[g_mqttEventBatchLen++] = 0xc4;
    g_mqttEventBatch[g_mqttEventBatchLen++] = (uint8_t)len;
  } else {
    g_mqttEventBatch[g_mqttEventBatchLen++] = 0xc5;
    g_mqttEventBatch[g_mqttEventBatchLen++] = (uint8_t)(len >> 8);
    g_mqttEventBatch[g_mqttEventBatchLen++] = (uint8_t)len;
  }
  memcpy(g_mqttEventBatch + g_mqttEventBatchLen, data, len);
  g_mqttEventBatchLen += len;
  g_mqttEventBatchCount++;
  return true;
}

void mqttTransportLoop() {
  mqttReapPendingAuth();
  if (!configMqttEnabled()) {
    if (g_mqtt.connected()) {
      g_mqtt.disconnect();
      debugLog("info", "mqtt", "disabled");
    }
    return;
  }

  if (!wifiIsConnected()) {
    if (g_mqtt.connected()) {
      g_mqtt.disconnect();
      debugLog("debug", "mqtt", "disconnected");
    }
    return;
  }

  if (g_mqtt.connected()) {
    mqttReapIdleSessions();
    if (!g_mqtt.loop()) {
      debugLog("warn", "mqtt", "loop closed");
    }
    mqttFlushEventBatch();
    return;
  }

  unsigned long now = millis();
  if (now - g_mqttLastAttemptMs < P1_EMBED_MQTT_RECONNECT_MS) return;
  g_mqttLastAttemptMs = now;
  mqttConnect();
}

void mqttTransportSendBytes(const uint8_t* data, size_t len) {
  if (!data || len == 0 || len > P1_EMBED_MQTT_BUFFER_BYTES || !g_mqtt.connected()) return;
  if (mqttFrameIsResponse(data, len)) {
    mqttFlushEventBatch();
    if (g_mqttActiveResponseTopic.length() == 0) return;
    if (g_mqttActiveSessionIndex >= 0) {
      mqttPublishSecure(g_mqttActiveResponseTopic, g_mqttActiveSessionIndex, data, len);
      return;
    }
    if (mqttAuthRequired() && !configMqttAllowAnonymousUi()) return;
    g_mqtt.publish(g_mqttActiveResponseTopic.c_str(), reinterpret_cast<const char*>(data), (int)len, false, 0);
    return;
  }
  if (mqttFrameIsEvent(data, len)) {
    if (!mqttAppendEventBatch(data, len)) mqttPublishEventPayload(data, len);
  }
}

void mqttTransportSendScriptText(const String& message, bool newline) {
  if (!g_mqtt.connected() || !g_mqttScriptOutTopic.length()) return;
  String payload = message;
  if (newline && !payload.endsWith("\n")) payload += "\n";
  if (!payload.length()) return;
  g_mqtt.publish(g_mqttScriptOutTopic.c_str(), payload.c_str(), payload.length(), false, 0);
}

bool mqttTransportConnected() {
  return g_mqtt.connected();
}

String mqttTransportStatusJson() {
  String out = "{";
  out += "\"enabled\":true";
  out += ",\"configured\":" + String(configMqttEnabled() ? "true" : "false");
  out += ",\"connected\":" + String(g_mqtt.connected() ? "true" : "false");
  out += ",\"host\":" + jsonString(configMqttHost());
  out += ",\"port\":" + String(configMqttPort());
  out += ",\"root\":" + jsonString(configMqttRoot());
  out += ",\"deviceId\":" + jsonString(g_mqttDeviceId);
  out += ",\"cmd\":" + jsonString(g_mqttCmdTopicPrefix);
  out += ",\"evt\":" + jsonString(g_mqttEvtTopic);
  out += ",\"scriptIn\":" + jsonString(g_mqttScriptInTopic);
  out += ",\"scriptOut\":" + jsonString(g_mqttScriptOutTopic);
  out += ",\"authRequired\":" + String(mqttAuthRequired() ? "true" : "false");
  out += ",\"onlineAuthUsers\":" + String(configOnlineAuthUserCount());
  out += ",\"anonymousUi\":" + String(configMqttAllowAnonymousUi() ? "true" : "false");
  out += ",\"anonymousScript\":" + String(configMqttAllowAnonymousScript() ? "true" : "false");
  out += "}";
  return out;
}

#else
void mqttTransportBegin() {}
void mqttTransportLoop() {}
void mqttTransportSendBytes(const uint8_t*, size_t) {}
void mqttTransportSendScriptText(const String&, bool) {}
bool mqttTransportConnected() { return false; }
String mqttTransportStatusJson() { return "{\"enabled\":false,\"connected\":false}"; }
void mqttTransportApplyConfig() {}
#endif
