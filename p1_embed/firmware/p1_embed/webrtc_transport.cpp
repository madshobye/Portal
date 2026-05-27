#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <stdarg.h>
#include <peer.h>
#include "p1_embed_firmware.h"
#if P1_EMBED_WEBRTC_SIGNALING_MQTT
#include <MQTT.h>
#endif
#if P1_EMBED_WEBRTC_SIGNALING_PEERJS
#include <WebSockets.h>
#include <WebSocketsClient.h>
#endif

#if P1_EMBED_WEBRTC_ENABLED

extern "C" void peer_log(char* levelTag, const char* fileName, int lineNumber, const char* fmt, ...) {
  char message[192];
  va_list args;
  va_start(args, fmt);
  vsnprintf(message, sizeof(message), fmt, args);
  va_end(args);

  if (strncmp(message, "ICE diag: binding request", 25) == 0 ||
      strncmp(message, "ICE diag: selected incoming ICE pair", 36) == 0 ||
      strncmp(message, "ICE diag: duplicate pair ignored", 32) == 0) {
    return;
  }

  const char* level = "debug";
  if (strcmp(levelTag, "ERROR") == 0) level = "error";
  else if (strcmp(levelTag, "WARN") == 0) level = "warn";
  else if (strcmp(levelTag, "INFO") == 0) level = "debug";
  else if (strcmp(levelTag, "DEBUG") == 0) level = "debug";

  const char* file = strrchr(fileName ? fileName : "", '/');
  file = file ? file + 1 : (fileName ? fileName : "");
  String fields = "\"file\":" + jsonString(file) + ",\"line\":" + String(lineNumber);
  debugEventEmit("webrtc.libpeer", level, "webrtc", String(message), fields);
}

struct WebRtcMessage {
  char* text;
  uint16_t sid;
  bool hasSid;
};

#if P1_EMBED_WEBRTC_SIGNALING_PEERJS
static WebSocketsClient g_peerSocket;
#endif
#if P1_EMBED_WEBRTC_SIGNALING_MQTT
static WiFiClient g_mqttNet;
static MQTTClient g_mqtt(P1_EMBED_WEBRTC_MQTT_BUFFER_BYTES);
#endif
static PeerConnection* g_peerConnection = nullptr;
static SemaphoreHandle_t g_peerMutex = nullptr;
static QueueHandle_t g_outboundQueue = nullptr;
static QueueHandle_t g_inboundQueue = nullptr;
static QueueHandle_t g_signalQueue = nullptr;
static QueueHandle_t g_peerJsQueue = nullptr;
static TaskHandle_t g_peerTaskHandle = nullptr;
static TaskHandle_t g_signalTaskHandle = nullptr;

static bool g_enabled = false;
static bool g_started = false;
static bool g_peerInitialized = false;
static bool g_peerConnectionFresh = false;
static bool g_peerOpen = false;
static bool g_dataChannelOpen = false;
static bool g_dataChannelSidKnown = false;
static bool g_peerConnectionStale = false;
static bool g_wrenchSuspendedForWebRtc = false;
static volatile bool g_wrenchResumePending = false;
static bool g_suspended = false;
static bool g_startFailed = false;
static bool g_peerReconnectScheduled = false;
static bool g_peerJsParkedForDataChannel = false;
static volatile bool g_answerNegotiationActive = false;
static volatile bool g_peerJsPausedForAnswer = false;
static volatile bool g_waitingForAnswerSignalFlush = false;
static uint16_t g_dataChannelSid = 0;
static PeerConnectionState g_peerState = PEER_CONNECTION_CLOSED;
static uint32_t g_lastHeartbeatAt = 0;
static uint32_t g_sendDrops = 0;
static uint32_t g_recvDrops = 0;
static uint32_t g_signalDrops = 0;
static uint32_t g_connectFailures = 0;
static uint32_t g_signalInCount = 0;
static uint32_t g_offerInCount = 0;
static uint32_t g_candidateInCount = 0;
static uint32_t g_answerOutCount = 0;
static uint32_t g_localCandidateOutCount = 0;
static uint32_t g_peerStateChangeCount = 0;
static uint32_t g_lastDisconnectEventAt = 0;
static uint32_t g_answerSignalWaitStartedAt = 0;
static uint32_t g_scriptResumeRetryAt = 0;
static uint32_t g_scriptResumeDeferredLogAt = 0;
static uint32_t g_peerReconnectAt = 0;
static uint16_t g_scriptResumeDeferrals = 0;
static int g_idAttempt = 0;
static char g_staleReason[32] = "";
static char g_lastSocketReason[96] = "";
static char g_lastSignalType[16] = "";
static char g_lastTrace[32] = "";

static String g_peerId;
static String g_peerToken;
static String g_remoteId;
static String g_connectionId;

static void webrtcSetTrace(const char* trace) {
  strlcpy(g_lastTrace, trace && trace[0] ? trace : "", sizeof(g_lastTrace));
}

static void webrtcRequestScriptResume(const char* reason) {
  if (!g_wrenchSuspendedForWebRtc) return;
  g_wrenchResumePending = true;
  g_scriptResumeRetryAt = 0;
  g_scriptResumeDeferredLogAt = 0;
  g_scriptResumeDeferrals = 0;
  debugEventEmit("webrtc.debug", "debug", "webrtc", "script resume requested",
                 "\"reason\":" + jsonString(reason ? reason : "unknown"));
}

static bool webrtcSuspendScriptForNegotiation() {
  if (g_wrenchSuspendedForWebRtc) return true;
  if (strcmp(wrenchStateName(), "running") != 0) return false;

  debugEventEmit("webrtc.debug", "debug", "webrtc", "suspending script for negotiation",
                 "\"freeHeap\":" + String(ESP.getFreeHeap()) + ",\"maxAllocHeap\":" + String(ESP.getMaxAllocHeap()));
  g_wrenchSuspendedForWebRtc = true;
  g_wrenchResumePending = false;
  wrenchStop();
  fastLedReleaseScriptResources();
  debugEventEmit("webrtc.debug", "debug", "webrtc", "script suspended for negotiation",
                 "\"freeHeap\":" + String(ESP.getFreeHeap()) + ",\"maxAllocHeap\":" + String(ESP.getMaxAllocHeap()));
  return true;
}

static void webrtcResumeSuspendedScriptIfPending() {
  if (g_answerNegotiationActive) return;
  if (!g_wrenchResumePending || !g_wrenchSuspendedForWebRtc) return;
  if (g_dataChannelOpen) return;
  if (g_scriptResumeRetryAt && (int32_t)(millis() - g_scriptResumeRetryAt) < 0) return;

  uint32_t freeHeap = ESP.getFreeHeap();
  uint32_t maxAlloc = ESP.getMaxAllocHeap();
  const bool lowResumeHeap =
    freeHeap < P1_EMBED_WEBRTC_SCRIPT_RESUME_MIN_FREE_HEAP ||
    maxAlloc < P1_EMBED_WEBRTC_SCRIPT_RESUME_MIN_MAX_ALLOC;
  if (lowResumeHeap && g_scriptResumeDeferrals < P1_EMBED_WEBRTC_SCRIPT_RESUME_FORCE_AFTER) {
    g_scriptResumeDeferrals++;
    g_scriptResumeRetryAt = millis() + 1500;
    uint32_t now = millis();
    if (!g_scriptResumeDeferredLogAt ||
        (uint32_t)(now - g_scriptResumeDeferredLogAt) >= P1_EMBED_WEBRTC_SCRIPT_RESUME_LOG_MS) {
      g_scriptResumeDeferredLogAt = now;
      debugEventEmit("webrtc.debug", "debug", "webrtc", "script resume deferred",
                     "\"freeHeap\":" + String(freeHeap) +
                       ",\"maxAllocHeap\":" + String(maxAlloc) +
                       ",\"deferrals\":" + String(g_scriptResumeDeferrals) +
                       ",\"minFreeHeap\":" + String(P1_EMBED_WEBRTC_SCRIPT_RESUME_MIN_FREE_HEAP) +
                       ",\"minMaxAllocHeap\":" + String(P1_EMBED_WEBRTC_SCRIPT_RESUME_MIN_MAX_ALLOC));
    }
    return;
  }
  if (lowResumeHeap) {
    debugEventEmit("webrtc.debug", "debug", "webrtc", "script resume trying low heap",
                   "\"freeHeap\":" + String(freeHeap) +
                     ",\"maxAllocHeap\":" + String(maxAlloc) +
                     ",\"deferrals\":" + String(g_scriptResumeDeferrals));
  }

  String err;
  if (!wrenchRunCompiled(err)) {
    g_scriptResumeRetryAt = millis() + 5000;
    debugError("webrtc", "script_resume_failed", "Failed to resume script after WebRTC negotiation: " + err);
    return;
  }
  g_wrenchResumePending = false;
  g_wrenchSuspendedForWebRtc = false;
  g_scriptResumeRetryAt = 0;
  g_scriptResumeDeferredLogAt = 0;
  g_scriptResumeDeferrals = 0;
  debugEventEmit("webrtc.debug", "debug", "webrtc", "script resumed after negotiation",
                 "\"freeHeap\":" + String(ESP.getFreeHeap()) + ",\"maxAllocHeap\":" + String(ESP.getMaxAllocHeap()));
}

static String webrtcStateName(PeerConnectionState state) {
  switch (state) {
    case PEER_CONNECTION_CLOSED: return "closed";
    case PEER_CONNECTION_NEW: return "new";
    case PEER_CONNECTION_CHECKING: return "checking";
    case PEER_CONNECTION_CONNECTED: return "connected";
    case PEER_CONNECTION_COMPLETED: return "completed";
    case PEER_CONNECTION_FAILED: return "failed";
    case PEER_CONNECTION_DISCONNECTED: return "disconnected";
  }
  return "unknown";
}

static String webrtcHostIdBase() {
  String name = configDeviceName();
  name.toLowerCase();
  String clean;
  clean.reserve(name.length());
  bool lastDash = false;
  for (size_t i = 0; i < name.length(); i++) {
    const char c = name[i];
    const bool ok = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
    if (ok) {
      clean += c;
      lastDash = false;
    } else if (!lastDash && clean.length() > 0) {
      clean += '-';
      lastDash = true;
    }
  }
  while (clean.endsWith("-")) clean.remove(clean.length() - 1);
  if (!clean.length()) clean = configDeviceId();
  clean.toLowerCase();
  if (!clean.startsWith("p1-")) clean = "p1-" + clean;
  if (clean.length() > 63) clean = clean.substring(0, 63);
  return clean;
}

static String webrtcBuildId(int attempt) {
  String id = webrtcHostIdBase();
  if (!P1_EMBED_WEBRTC_AUTO_SUFFIX_ID || attempt <= 0) return id;

  int value = attempt;
  String suffix;
  while (value > 0) {
    value--;
    suffix = String(char('a' + (value % 26))) + suffix;
    value /= 26;
  }
  String withSuffix = id + "-" + suffix;
  if (withSuffix.length() > 63) withSuffix = withSuffix.substring(0, 63);
  return withSuffix;
}

static String webrtcPeerPath() {
  String path = P1_EMBED_WEBRTC_PEERJS_PATH;
  if (!path.startsWith("/")) path = "/" + path;
  if (!path.endsWith("/")) path += "/";
  return path;
}

static String webrtcSignalTopicTo(const String& peerId) {
  return String("/") + P1_EMBED_WEBRTC_MQTT_ROOT + "/to/" + peerId;
}

static String webrtcSignalTopicFrom(const String& peerId) {
  return String("/") + P1_EMBED_WEBRTC_MQTT_ROOT + "/from/" + peerId;
}

static String webrtcSignalTopicPresence() {
  return String("/") + P1_EMBED_WEBRTC_MQTT_ROOT + "/presence";
}

static String webrtcRandomToken() {
  return String(random(0xffff), HEX) + String(random(0xffff), HEX) + String(random(0xffff), HEX);
}

static String webrtcRandomConnectionId() {
  return String("dc_") + webrtcRandomToken();
}

static String webrtcEscapeJson(const String& value) {
  String escaped;
  escaped.reserve(value.length() + 16);
  for (size_t i = 0; i < value.length(); i++) {
    const char ch = value[i];
    if (ch == '"') escaped += "\\\"";
    else if (ch == '\\') escaped += "\\\\";
    else if (ch == '\n') escaped += "\\n";
    else if (ch == '\r') escaped += "\\r";
    else if (ch == '\t') escaped += "\\t";
    else escaped += ch;
  }
  return escaped;
}

static String webrtcUnescapeJson(const String& value) {
  String unescaped;
  unescaped.reserve(value.length());
  for (size_t i = 0; i < value.length(); i++) {
    char ch = value[i];
    if (ch != '\\' || i + 1 >= value.length()) {
      unescaped += ch;
      continue;
    }
    const char next = value[++i];
    if (next == 'n') unescaped += '\n';
    else if (next == 'r') unescaped += '\r';
    else if (next == 't') unescaped += '\t';
    else unescaped += next;
  }
  return unescaped;
}

static String webrtcExtractString(const String& json, const char* key, int fromIndex = 0) {
  String pattern = "\"" + String(key) + "\":\"";
  int start = json.indexOf(pattern, fromIndex);
  if (start < 0) {
    pattern = "\"" + String(key) + "\" : \"";
    start = json.indexOf(pattern, fromIndex);
  }
  if (start < 0) return "";

  start += pattern.length();
  String value;
  bool escaped = false;
  for (int i = start; i < json.length(); i++) {
    const char ch = json[i];
    if (escaped) {
      value += '\\';
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
  return webrtcUnescapeJson(value);
}

static String webrtcExtractType(const String& json) {
  const String pattern = "\"type\":\"";
  const int start = json.lastIndexOf(pattern);
  if (start < 0) return "";

  String value;
  bool escaped = false;
  for (int i = start + pattern.length(); i < json.length(); i++) {
    const char ch = json[i];
    if (escaped) {
      value += '\\';
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
  return webrtcUnescapeJson(value);
}

static String webrtcExtractEnvelopeType(const String& json) {
  const String pattern = "\"type\":\"";
  const int start = json.indexOf(pattern);
  if (start < 0) return "";

  String value;
  bool escaped = false;
  for (int i = start + pattern.length(); i < json.length(); i++) {
    const char ch = json[i];
    if (escaped) {
      value += '\\';
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
  return webrtcUnescapeJson(value);
}

static String webrtcExtractPayloadSdp(const String& json) {
  const int payloadIndex = json.indexOf("\"payload\"");
  const int sdpIndex = json.indexOf("\"sdp\"", payloadIndex >= 0 ? payloadIndex : 0);
  return webrtcExtractString(json, "sdp", sdpIndex);
}

static String webrtcExtractCandidate(const String& json) {
  const int candidateIndex = json.indexOf("\"candidate\"");
  return webrtcExtractString(json, "candidate", candidateIndex);
}

static WebRtcMessage* webrtcAllocMessage(const char* text, size_t len, uint16_t sid = 0, bool hasSid = false) {
  if (!text) return nullptr;
  WebRtcMessage* msg = static_cast<WebRtcMessage*>(malloc(sizeof(WebRtcMessage)));
  if (!msg) return nullptr;
  msg->text = static_cast<char*>(malloc(len + 1));
  if (!msg->text) {
    free(msg);
    return nullptr;
  }
  memcpy(msg->text, text, len);
  msg->text[len] = 0;
  msg->sid = sid;
  msg->hasSid = hasSid;
  return msg;
}

static void webrtcFreeMessage(WebRtcMessage* msg) {
  if (!msg) return;
  free(msg->text);
  free(msg);
}

static void webrtcClearQueue(QueueHandle_t queue);

static void webrtcReleaseStartResources() {
  memoryProfileMark("webrtc", "release_start_resources");
  if (g_outboundQueue) {
    webrtcClearQueue(g_outboundQueue);
    vQueueDelete(g_outboundQueue);
    g_outboundQueue = nullptr;
  }
  if (g_inboundQueue) {
    webrtcClearQueue(g_inboundQueue);
    vQueueDelete(g_inboundQueue);
    g_inboundQueue = nullptr;
  }
  if (g_signalQueue) {
    webrtcClearQueue(g_signalQueue);
    vQueueDelete(g_signalQueue);
    g_signalQueue = nullptr;
  }
  if (g_peerJsQueue) {
    webrtcClearQueue(g_peerJsQueue);
    vQueueDelete(g_peerJsQueue);
    g_peerJsQueue = nullptr;
  }
  if (g_peerMutex) {
    vSemaphoreDelete(g_peerMutex);
    g_peerMutex = nullptr;
  }
}

static bool webrtcQueueText(QueueHandle_t queue, WebRtcMessage* msg) {
  if (!queue || !msg) return false;
  if (xQueueSend(queue, &msg, 0) == pdTRUE) return true;
  webrtcFreeMessage(msg);
  return false;
}

static void webrtcClearQueue(QueueHandle_t queue) {
  if (!queue) return;
  WebRtcMessage* msg = nullptr;
  while (xQueueReceive(queue, &msg, 0) == pdTRUE) {
    webrtcFreeMessage(msg);
  }
}

static bool webrtcTakePeer() {
  return g_peerMutex && xSemaphoreTake(g_peerMutex, portMAX_DELAY) == pdTRUE;
}

static void webrtcGivePeer() {
  if (g_peerMutex) xSemaphoreGive(g_peerMutex);
}

static bool webrtcQueueSignal(const String& message) {
  WebRtcMessage* msg = webrtcAllocMessage(message.c_str(), message.length());
  if (!msg || !webrtcQueueText(g_signalQueue, msg)) {
    g_signalDrops++;
    debugLog("warn", "webrtc", "PeerJS signaling queue full");
    return false;
  }
  debugEventEmit("webrtc.debug", "debug", "webrtc", "signal queued", "\"bytes\":" + String(message.length()));
  return true;
}

static void webrtcQueuePeerJsMessage(const String& message) {
  WebRtcMessage* msg = webrtcAllocMessage(message.c_str(), message.length());
  if (!msg || !webrtcQueueText(g_peerJsQueue, msg)) {
    g_signalDrops++;
    debugLog("warn", "webrtc", "PeerJS inbound queue full");
  } else {
    debugEventEmit("webrtc.debug", "debug", "webrtc", "peerjs queued", "\"bytes\":" + String(message.length()) + ",\"type\":" + jsonString(webrtcExtractType(message)));
  }
}

static void webrtcSendHeartbeat() {
#if P1_EMBED_WEBRTC_SIGNALING_PEERJS
  g_peerSocket.sendTXT("{\"type\":\"HEARTBEAT\"}");
#elif P1_EMBED_WEBRTC_SIGNALING_MQTT
  if (g_mqtt.connected()) {
    String payload = "{\"type\":\"HEARTBEAT\",\"src\":\"" + webrtcEscapeJson(g_peerId) + "\"}";
    g_mqtt.publish(webrtcSignalTopicPresence(), payload);
  }
#endif
  g_lastHeartbeatAt = millis();
}

static bool webrtcSendSdp(const char* messageType, const char* sdpType, const String& sdp) {
  if ((!g_peerOpen && !g_peerJsPausedForAnswer) || g_remoteId.length() == 0 || g_connectionId.length() == 0) {
    debugEventEmit("webrtc.debug", "debug", "webrtc", "sdp not sent", "\"messageType\":" + jsonString(messageType) + ",\"peerOpen\":" + String(g_peerOpen ? "true" : "false") + ",\"remoteId\":" + jsonString(g_remoteId) + ",\"connectionId\":" + jsonString(g_connectionId));
    return false;
  }

  int hostCandidates = 0;
  int srflxCandidates = 0;
  int prflxCandidates = 0;
  int relayCandidates = 0;
  int searchAt = 0;
  while ((searchAt = sdp.indexOf(" typ ", searchAt)) >= 0) {
    if (sdp.startsWith(" typ host", searchAt)) hostCandidates++;
    else if (sdp.startsWith(" typ srflx", searchAt)) srflxCandidates++;
    else if (sdp.startsWith(" typ prflx", searchAt)) prflxCandidates++;
    else if (sdp.startsWith(" typ relay", searchAt)) relayCandidates++;
    searchAt += 5;
  }
  protocolEmitEvent("webrtc.sdp",
                    "\"type\":" + jsonString(messageType) +
                    ",\"bytes\":" + String(sdp.length()) +
                    ",\"host\":" + String(hostCandidates) +
                    ",\"srflx\":" + String(srflxCandidates) +
                    ",\"prflx\":" + String(prflxCandidates) +
                    ",\"relay\":" + String(relayCandidates));

  String message = String("{\"type\":\"") + messageType + "\"";
  message += ",\"dst\":\"" + webrtcEscapeJson(g_remoteId) + "\"";
  message += ",\"payload\":{";
  message += "\"sdp\":{\"type\":\"" + String(sdpType) + "\",\"sdp\":\"" + webrtcEscapeJson(sdp) + "\"}";
  message += ",\"type\":\"data\"";
  message += ",\"connectionId\":\"" + webrtcEscapeJson(g_connectionId) + "\"";
  if (String(messageType) == "OFFER") {
    message += ",\"metadata\":null";
    message += ",\"label\":\"" + webrtcEscapeJson(g_connectionId) + "\"";
    message += ",\"reliable\":false";
    message += ",\"serialization\":\"raw\"";
  }
  message += "}}";
  debugEventEmit("webrtc.debug", "debug", "webrtc", "sdp queued", "\"messageType\":" + jsonString(messageType) + ",\"sdpBytes\":" + String(sdp.length()) + ",\"messageBytes\":" + String(message.length()) + ",\"remoteId\":" + jsonString(g_remoteId));
  return webrtcQueueSignal(message);
}

static bool webrtcSendCandidate(const String& candidate) {
  if ((!g_peerOpen && !g_peerJsPausedForAnswer) || g_remoteId.length() == 0 || g_connectionId.length() == 0) return false;

  String message = "{\"type\":\"CANDIDATE\"";
  message += ",\"dst\":\"" + webrtcEscapeJson(g_remoteId) + "\"";
  message += ",\"payload\":{";
  message += "\"candidate\":{\"candidate\":\"" + webrtcEscapeJson(candidate) + "\",\"sdpMid\":\"0\",\"sdpMLineIndex\":0}";
  message += ",\"type\":\"data\"";
  message += ",\"connectionId\":\"" + webrtcEscapeJson(g_connectionId) + "\"";
  message += "}}";
  return webrtcQueueSignal(message);
}

static bool webrtcPausePeerJsForAnswer() {
#if !P1_EMBED_WEBRTC_PAUSE_SIGNALING_FOR_ANSWER
  return false;
#else
  if (!g_peerOpen) return false;
  g_peerOpen = false;
  g_peerJsPausedForAnswer = true;
#if P1_EMBED_WEBRTC_SIGNALING_PEERJS
  g_peerSocket.disconnect();
#elif P1_EMBED_WEBRTC_SIGNALING_MQTT
  g_mqtt.disconnect();
#endif
  delay(25);
  debugEventEmit("webrtc.debug", "debug", "webrtc", "peerjs paused for answer",
                 "\"freeHeap\":" + String(ESP.getFreeHeap()) + ",\"maxAllocHeap\":" + String(ESP.getMaxAllocHeap()));
  return true;
#endif
}

static void webrtcResumePeerJsAfterAnswer(bool wasPaused) {
  if (!wasPaused) return;
#if P1_EMBED_WEBRTC_SIGNALING_PEERJS
  g_peerSocket.setReconnectInterval(P1_EMBED_WEBRTC_ANSWER_RECONNECT_MS);
#endif
  g_peerJsPausedForAnswer = false;
  debugEventEmit("webrtc.debug", "debug", "webrtc", "peerjs resume after answer",
                 "\"freeHeap\":" + String(ESP.getFreeHeap()) + ",\"maxAllocHeap\":" + String(ESP.getMaxAllocHeap()));
}

static void webrtcMarkStale(const char* reason) {
  if (!g_peerConnection) return;
  strlcpy(g_staleReason, reason && reason[0] ? reason : "unknown", sizeof(g_staleReason));
  g_peerConnectionStale = true;
  webrtcRequestScriptResume(reason);
  g_waitingForAnswerSignalFlush = false;
  g_answerSignalWaitStartedAt = 0;
  g_dataChannelOpen = false;
  g_dataChannelSidKnown = false;
  g_dataChannelSid = 0;
}

static void onWebRtcIceCandidate(char* sdpText, void* userData) {
  if (!sdpText || g_remoteId.length() == 0) return;
  const String sdp = String(sdpText);
  if (sdp.startsWith("candidate:")) {
    g_localCandidateOutCount++;
    webrtcSetTrace("local_candidate");
    protocolEmitEvent("webrtc.trace", "\"event\":\"local_candidate\",\"count\":" + String(g_localCandidateOutCount) + ",\"remoteId\":" + jsonString(g_remoteId));
    webrtcSendCandidate(sdp);
  }
}

static void onWebRtcStateChange(PeerConnectionState state, void* userData) {
  g_peerState = state;
  g_peerStateChangeCount++;
  if (state != PEER_CONNECTION_COMPLETED) g_dataChannelOpen = false;

  const String stateName = webrtcStateName(state);
  webrtcSetTrace(stateName.c_str());
  memoryProfileMark("webrtc.ice", stateName.c_str());
  protocolEmitEvent("webrtc.peer", "\"state\":" + jsonString(stateName) + ",\"count\":" + String(g_peerStateChangeCount) + ",\"remoteId\":" + jsonString(g_remoteId));
  if (state == PEER_CONNECTION_FAILED ||
      state == PEER_CONNECTION_DISCONNECTED ||
      state == PEER_CONNECTION_CLOSED) {
    webrtcMarkStale(stateName.c_str());
  }
}

static void onWebRtcDataChannelMessage(char* msg, size_t len, void* userData, uint16_t sid) {
  g_dataChannelSid = sid;
  g_dataChannelSidKnown = true;
  if (!msg || len == 0) return;
  if (len >= P1_EMBED_LINE_MAX) {
    g_recvDrops++;
    protocolEmitErrorEvent("webrtc.input", "line_too_long", "Discarding WebRTC datachannel input");
    return;
  }
  WebRtcMessage* queued = webrtcAllocMessage(msg, len, sid, true);
  if (!queued || !webrtcQueueText(g_inboundQueue, queued)) {
    g_recvDrops++;
    debugLog("warn", "webrtc", "WebRTC inbound queue full");
  }
}

static void onWebRtcDataChannelOpen(void* userData) {
  g_dataChannelOpen = true;
  g_dataChannelSidKnown = false;
  g_dataChannelSid = 0;
  memoryProfileMark("webrtc.data", "open");
  protocolEmitEvent("webrtc.client", "\"state\":\"connected\",\"peerId\":" + jsonString(g_peerId) + ",\"remoteId\":" + jsonString(g_remoteId));
#if P1_EMBED_WEBRTC_PARK_SIGNALING_WHEN_CONNECTED
  if (g_peerOpen) {
    g_peerOpen = false;
    g_peerJsParkedForDataChannel = true;
    strlcpy(g_lastSocketReason, "parked_for_datachannel", sizeof(g_lastSocketReason));
#if P1_EMBED_WEBRTC_SIGNALING_PEERJS
    g_peerSocket.disconnect();
#elif P1_EMBED_WEBRTC_SIGNALING_MQTT
    g_mqtt.disconnect();
#endif
    memoryProfileMark("webrtc.peerjs", "parked");
    protocolEmitEvent("webrtc.peerjs", "\"state\":\"parked\",\"reason\":\"datachannel_connected\",\"freeHeap\":" + String(ESP.getFreeHeap()) + ",\"maxAllocHeap\":" + String(ESP.getMaxAllocHeap()));
  }
#endif
}

static void onWebRtcDataChannelClose(void* userData) {
  g_dataChannelOpen = false;
  g_dataChannelSidKnown = false;
  g_dataChannelSid = 0;
  memoryProfileMark("webrtc.data", "close");
  protocolEmitEvent("webrtc.client", "\"state\":\"disconnected\",\"peerId\":" + jsonString(g_peerId));
  webrtcMarkStale("datachannel_close");
}

static bool webrtcCreateConnection() {
  if (!g_peerInitialized) {
    memoryProfileMark("webrtc.peer", "peer_init_before");
    if (peer_init() != 0) {
      debugError("webrtc", "peer_init_failed", "Failed to initialize libpeer");
      return false;
    }
    g_peerInitialized = true;
    memoryProfileMark("webrtc.peer", "peer_init_after");
  }

  PeerConfiguration config = {
    .ice_servers = {
      {.urls = "stun:stun.l.google.com:19302", .username = nullptr, .credential = nullptr},
      {.urls = "stun:stun1.l.google.com:19302", .username = nullptr, .credential = nullptr},
      {.urls = "stun:stun.cloudflare.com:3478", .username = nullptr, .credential = nullptr}
    },
    .datachannel = DATA_CHANNEL_STRING,
    .user_data = nullptr,
  };

  memoryProfileMark("webrtc.peer", "create_before");
  g_peerConnection = peer_connection_create(&config);
  memoryProfileMark("webrtc.peer", g_peerConnection ? "create_after" : "create_failed");
  if (!g_peerConnection) {
    String details = "Failed to create peer connection";
    const char* peerError = peer_connection_last_error();
    if (peerError && peerError[0]) details += " detail=" + String(peerError);
    details += " freeHeap=" + String(ESP.getFreeHeap());
    details += " maxAllocHeap=" + String(ESP.getMaxAllocHeap());
    details += " minFreeHeap=" + String(ESP.getMinFreeHeap());
    debugError("webrtc", "peer_connection_failed", details);
    return false;
  }

  peer_connection_oniceconnectionstatechange(g_peerConnection, onWebRtcStateChange);
  peer_connection_onicecandidate(g_peerConnection, onWebRtcIceCandidate);
  peer_connection_ondatachannel(g_peerConnection, onWebRtcDataChannelMessage, onWebRtcDataChannelOpen, onWebRtcDataChannelClose);
  memoryProfileMark("webrtc.peer", "callbacks");
  g_peerState = PEER_CONNECTION_NEW;
  g_peerConnectionFresh = true;
  g_dataChannelOpen = false;
  g_dataChannelSidKnown = false;
  g_dataChannelSid = 0;
  return true;
}

static bool webrtcResetConnection() {
  memoryProfileMark("webrtc.peer", "reset_before");
  g_peerConnectionStale = false;
  g_staleReason[0] = 0;
  g_waitingForAnswerSignalFlush = false;
  g_answerSignalWaitStartedAt = 0;
  g_peerConnectionFresh = false;
  webrtcClearQueue(g_outboundQueue);
  g_dataChannelOpen = false;
  g_dataChannelSidKnown = false;
  g_dataChannelSid = 0;
  if (g_peerConnection) {
    peer_connection_reset(g_peerConnection);
  } else if (!webrtcCreateConnection()) {
    return false;
  }
  memoryProfileMark("webrtc.peer", "reset_after");
  g_peerState = PEER_CONNECTION_NEW;
  return true;
}

static bool webrtcEnsureConnectionForOffer() {
  if (!g_peerConnection) return webrtcCreateConnection();
  if (g_peerConnectionFresh && !g_dataChannelOpen && g_peerState == PEER_CONNECTION_NEW) {
    g_peerConnectionStale = false;
    g_staleReason[0] = 0;
    g_waitingForAnswerSignalFlush = false;
    g_answerSignalWaitStartedAt = 0;
    webrtcClearQueue(g_outboundQueue);
    g_dataChannelSidKnown = false;
    g_dataChannelSid = 0;
    return true;
  }
  return webrtcResetConnection();
}

static void webrtcCleanupStaleConnection() {
  if (!g_peerConnectionStale) return;

  g_peerConnectionStale = false;
  char reason[sizeof(g_staleReason)];
  strlcpy(reason, g_staleReason[0] ? g_staleReason : "unknown", sizeof(reason));
  g_staleReason[0] = 0;
  g_waitingForAnswerSignalFlush = false;
  g_answerSignalWaitStartedAt = 0;
  g_peerConnectionFresh = false;
  webrtcClearQueue(g_outboundQueue);
  g_dataChannelOpen = false;
  g_dataChannelSidKnown = false;
  g_dataChannelSid = 0;
  g_remoteId = "";
  g_connectionId = "";
  if (g_peerConnection) {
    memoryProfileMark("webrtc.peer", "destroy_before");
    peer_connection_destroy(g_peerConnection);
    g_peerConnection = nullptr;
    g_peerState = PEER_CONNECTION_CLOSED;
    memoryProfileMark("webrtc.peer", "destroy_after");
  }
  protocolEmitEvent("webrtc.peer", "\"state\":\"closed\",\"reason\":" + jsonString(reason));
  webrtcRequestScriptResume(reason);
}

static void webrtcFlushOutbound() {
  if (!g_dataChannelOpen || !g_peerConnection || !g_outboundQueue) return;

  WebRtcMessage* queued = nullptr;
  while (xQueueReceive(g_outboundQueue, &queued, 0) == pdTRUE) {
    if (!queued) continue;
    if (!g_dataChannelOpen || !g_peerConnection) {
      webrtcFreeMessage(queued);
      break;
    }
    if (queued->hasSid) {
      peer_connection_datachannel_send_sid(g_peerConnection, queued->text, strlen(queued->text), queued->sid);
    } else {
      peer_connection_datachannel_send(g_peerConnection, queued->text, strlen(queued->text));
    }
    webrtcFreeMessage(queued);
  }
}

static void webrtcHandlePeerJsMessage(const String& message);

static void webrtcDrainPeerJsMessages() {
  if (!g_peerJsQueue) return;

  WebRtcMessage* queued = nullptr;
  while (xQueueReceive(g_peerJsQueue, &queued, 0) == pdTRUE) {
    if (queued && queued->text) webrtcHandlePeerJsMessage(String(queued->text));
    webrtcFreeMessage(queued);
  }
}

static void webrtcPeerTask(void* arg) {
  uint32_t lastTimerAt = millis();
  for (;;) {
    uint32_t now = millis();
    uint32_t elapsed = now - lastTimerAt;
    if (elapsed >= 10) {
      peer_handle_timers(elapsed);
      lastTimerAt = now;
    }
    webrtcDrainPeerJsMessages();
    if (webrtcTakePeer()) {
      if (g_peerConnection) {
        if (g_peerConnectionStale) {
          webrtcCleanupStaleConnection();
        } else if (!g_waitingForAnswerSignalFlush) {
          peer_connection_loop(g_peerConnection);
          if (g_peerConnectionStale) {
            webrtcCleanupStaleConnection();
          } else {
            webrtcFlushOutbound();
          }
        } else {
          if (g_signalQueue && uxQueueMessagesWaiting(g_signalQueue) == 0) {
            g_waitingForAnswerSignalFlush = false;
            g_answerSignalWaitStartedAt = 0;
          } else if (millis() - g_answerSignalWaitStartedAt >= P1_EMBED_WEBRTC_ANSWER_SIGNAL_WAIT_MS) {
            g_waitingForAnswerSignalFlush = false;
            g_answerSignalWaitStartedAt = 0;
            debugLog("warn", "webrtc", "Answer signal wait timed out; continuing peer loop");
          }
        }
      }
      webrtcGivePeer();
    }
    vTaskDelay(pdMS_TO_TICKS(1));
  }
}

static void webrtcStartOffer(const String& dst) {
  g_remoteId = dst;
  g_connectionId = webrtcRandomConnectionId();
  if (!webrtcTakePeer()) return;
  if (!g_peerConnection && !webrtcCreateConnection()) {
    webrtcGivePeer();
    return;
  }
  g_peerConnectionFresh = false;
  peer_connection_create_datachannel(g_peerConnection, DATA_CHANNEL_RELIABLE, 0, 0, (char*)g_connectionId.c_str(), (char*)"");
  const char* offer = peer_connection_create_offer(g_peerConnection);
  if (offer) webrtcSendSdp("OFFER", "offer", String(offer));
  webrtcGivePeer();
}

static void webrtcTryNextId();

static void webrtcHandlePeerJsMessage(const String& message) {
  const String type = webrtcExtractEnvelopeType(message);

  if (type == "OPEN") {
    g_peerOpen = true;
    g_lastHeartbeatAt = millis();
#if P1_EMBED_WEBRTC_SIGNALING_PEERJS
    g_peerSocket.setReconnectInterval(P1_EMBED_WEBRTC_RECONNECT_INTERVAL_MS);
#endif
    memoryProfileMark("webrtc.peerjs", "open");
    protocolEmitEvent("webrtc.peerjs", "\"state\":\"open\",\"peerId\":" + jsonString(g_peerId));
    return;
  }

  if (type == "ID-TAKEN") {
    memoryProfileMark("webrtc.peerjs", "id_taken");
    protocolEmitEvent("webrtc.peerjs", "\"state\":\"id_taken\",\"peerId\":" + jsonString(g_peerId));
    webrtcTryNextId();
    return;
  }

  if (type == "ERROR" || type == "INVALID-KEY" || type == "EXPIRE") {
    g_peerOpen = false;
    debugError("webrtc", "peerjs_error", message);
    return;
  }

  if (type == "LEAVE") {
    g_dataChannelOpen = false;
    if (webrtcTakePeer()) {
      if (g_peerConnection) peer_connection_close(g_peerConnection);
      webrtcGivePeer();
    }
    protocolEmitEvent("webrtc.client", "\"state\":\"left\"");
    return;
  }

  if (type == "OFFER") {
    memoryProfileMark("webrtc.signal", "offer_received");
    g_offerInCount++;
    webrtcSetTrace("offer_received");
    g_remoteId = webrtcExtractString(message, "src");
    g_connectionId = webrtcExtractString(message, "connectionId");
    const String sdp = webrtcExtractPayloadSdp(message);
    protocolEmitEvent("webrtc.trace", "\"event\":\"offer_received\",\"count\":" + String(g_offerInCount) + ",\"remoteId\":" + jsonString(g_remoteId) + ",\"connectionId\":" + jsonString(g_connectionId) + ",\"sdpBytes\":" + String(sdp.length()) + ",\"messageBytes\":" + String(message.length()));
    debugEventEmit("webrtc.debug", "debug", "webrtc", "offer received", "\"remoteId\":" + jsonString(g_remoteId) + ",\"connectionId\":" + jsonString(g_connectionId) + ",\"sdpBytes\":" + String(sdp.length()) + ",\"messageBytes\":" + String(message.length()));
    if (g_remoteId.length() == 0 || g_connectionId.length() == 0 || sdp.length() == 0) {
      debugError("webrtc", "bad_offer", "Malformed PeerJS offer");
      return;
    }

    if (webrtcTakePeer()) {
      if (webrtcEnsureConnectionForOffer()) {
        g_answerNegotiationActive = true;
        bool pausedSignaling = webrtcPausePeerJsForAnswer();
        bool suspendedScript = webrtcSuspendScriptForNegotiation();
        g_peerConnectionFresh = false;
        memoryProfileMark("webrtc.signal", "set_remote_before");
        peer_connection_set_remote_description(g_peerConnection, sdp.c_str(), SDP_TYPE_OFFER);
        memoryProfileMark("webrtc.signal", "set_remote_after");
        const char* answer = peer_connection_create_answer(g_peerConnection);
        memoryProfileMark("webrtc.signal", answer ? "answer_created" : "answer_failed");
        if (answer) {
          debugEventEmit("webrtc.debug", "debug", "webrtc", "answer created", "\"answerBytes\":" + String(strlen(answer)) + ",\"freeHeap\":" + String(ESP.getFreeHeap()) + ",\"maxAllocHeap\":" + String(ESP.getMaxAllocHeap()));
          if (webrtcSendSdp("ANSWER", "answer", String(answer))) {
            memoryProfileMark("webrtc.signal", "answer_queued");
            g_answerOutCount++;
            webrtcSetTrace("answer_queued");
            protocolEmitEvent("webrtc.trace", "\"event\":\"answer_queued\",\"count\":" + String(g_answerOutCount) + ",\"remoteId\":" + jsonString(g_remoteId) + ",\"answerBytes\":" + String(strlen(answer)) + ",\"freeHeap\":" + String(ESP.getFreeHeap()) + ",\"maxAllocHeap\":" + String(ESP.getMaxAllocHeap()));
            g_waitingForAnswerSignalFlush = true;
            g_answerSignalWaitStartedAt = millis();
          }
        } else {
          String details = "Failed to create WebRTC answer";
          const char* peerError = peer_connection_last_error();
          if (peerError && peerError[0]) details += " detail=" + String(peerError);
          debugError("webrtc", "answer_failed", details);
          webrtcMarkStale("answer_failed");
        }
        g_answerNegotiationActive = false;
        if (suspendedScript && !answer) {
          webrtcRequestScriptResume("answer_failed");
        }
        webrtcResumePeerJsAfterAnswer(pausedSignaling);
      }
      webrtcGivePeer();
    }
    return;
  }

  if (type == "ANSWER") {
    memoryProfileMark("webrtc.signal", "answer_received");
    const String sdp = webrtcExtractPayloadSdp(message);
    if (sdp.length() == 0) {
      debugError("webrtc", "bad_answer", "Malformed PeerJS answer");
      return;
    }
    if (webrtcTakePeer()) {
      if (g_peerConnection) peer_connection_set_remote_description(g_peerConnection, sdp.c_str(), SDP_TYPE_ANSWER);
      webrtcGivePeer();
    }
    return;
  }

  if (type == "CANDIDATE") {
    memoryProfileMark("webrtc.signal", "candidate_received");
    g_candidateInCount++;
    webrtcSetTrace("candidate_received");
    String candidate = webrtcExtractCandidate(message);
    if (candidate.length() == 0) {
      debugError("webrtc", "bad_candidate", "Malformed PeerJS candidate");
      return;
    }
    if (candidate.indexOf(" tcp ") >= 0) {
      protocolEmitEvent("webrtc.trace", "\"event\":\"candidate_dropped\",\"reason\":\"tcp\",\"count\":" + String(g_candidateInCount) + ",\"remoteId\":" + jsonString(g_remoteId));
      return;
    }
    protocolEmitEvent("webrtc.trace", "\"event\":\"candidate_received\",\"count\":" + String(g_candidateInCount) + ",\"remoteId\":" + jsonString(g_remoteId) + ",\"bytes\":" + String(candidate.length()));
    if (webrtcTakePeer()) {
      if (g_peerConnection) peer_connection_add_ice_candidate(g_peerConnection, (char*)candidate.c_str());
      webrtcGivePeer();
    }
  }
}

#if P1_EMBED_WEBRTC_SIGNALING_PEERJS
static void webrtcPeerJsSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      g_connectFailures = 0;
      memoryProfileMark("webrtc.peerjs", "socket_connected");
      protocolEmitEvent("webrtc.peerjs", "\"state\":\"socket_connected\",\"peerId\":" + jsonString(g_peerId));
      break;
    case WStype_DISCONNECTED:
      g_peerOpen = false;
      memoryProfileMark("webrtc.peerjs", "socket_disconnected");
#if P1_EMBED_WEBRTC_PARK_SIGNALING_WHEN_CONNECTED
      if (g_peerJsParkedForDataChannel && g_dataChannelOpen) {
        strlcpy(g_lastSocketReason, "parked_for_datachannel", sizeof(g_lastSocketReason));
        break;
      }
#endif
      g_connectFailures++;
      if (millis() - g_lastDisconnectEventAt < 5000) {
        break;
      }
      g_lastDisconnectEventAt = millis();
      if (payload && length > 0) {
        String reason;
        reason.reserve(length);
        for (size_t i = 0; i < length; i++) reason += (char)payload[i];
        reason.toCharArray(g_lastSocketReason, sizeof(g_lastSocketReason));
        protocolEmitEvent("webrtc.peerjs", "\"state\":\"socket_disconnected\",\"peerId\":" + jsonString(g_peerId) + ",\"failures\":" + String(g_connectFailures) + ",\"reason\":" + jsonString(reason));
      } else {
        strlcpy(g_lastSocketReason, "disconnected", sizeof(g_lastSocketReason));
        protocolEmitEvent("webrtc.peerjs", "\"state\":\"socket_disconnected\",\"peerId\":" + jsonString(g_peerId) + ",\"failures\":" + String(g_connectFailures));
      }
      if (P1_EMBED_WEBRTC_MAX_CONNECT_FAILURES > 0 &&
          g_connectFailures >= P1_EMBED_WEBRTC_MAX_CONNECT_FAILURES) {
        g_suspended = true;
        debugLog("warn", "webrtc", "PeerJS signaling suspended after repeated connection failures");
      }
      break;
    case WStype_TEXT: {
      memoryProfileMark("webrtc.peerjs", "text");
      String message;
      message.reserve(length + 1);
      for (size_t i = 0; i < length; i++) message += (char)payload[i];
      const String messageType = webrtcExtractEnvelopeType(message);
      if (messageType == "OFFER" ||
          messageType == "ANSWER" ||
          messageType == "CANDIDATE" ||
          messageType == "LEAVE") {
        webrtcQueuePeerJsMessage(message);
      } else {
        webrtcHandlePeerJsMessage(message);
      }
      break;
    }
    case WStype_ERROR:
      g_peerOpen = false;
      memoryProfileMark("webrtc.peerjs", "socket_error");
      if (payload && length > 0) {
        String reason;
        reason.reserve(length);
        for (size_t i = 0; i < length; i++) reason += (char)payload[i];
        reason.toCharArray(g_lastSocketReason, sizeof(g_lastSocketReason));
        debugError("webrtc", "peerjs_socket_error", reason);
      } else {
        strlcpy(g_lastSocketReason, "socket_error", sizeof(g_lastSocketReason));
        debugError("webrtc", "peerjs_socket_error", "PeerJS websocket error");
      }
      break;
    default:
      break;
  }
}
#endif

static void webrtcFlushSignals() {
  if (!g_peerOpen || !g_signalQueue) return;
  WebRtcMessage* queued = nullptr;
  while (xQueueReceive(g_signalQueue, &queued, 0) == pdTRUE) {
    if (!queued) continue;
    debugEventEmit("webrtc.debug", "debug", "webrtc", "signal send", "\"bytes\":" + String(strlen(queued->text)) + ",\"peerOpen\":" + String(g_peerOpen ? "true" : "false"));
#if P1_EMBED_WEBRTC_SIGNALING_PEERJS
    g_peerSocket.sendTXT(queued->text);
#elif P1_EMBED_WEBRTC_SIGNALING_MQTT
    if (g_remoteId.length() > 0) {
      if (!g_mqtt.publish(webrtcSignalTopicTo(g_remoteId), queued->text)) {
        g_signalDrops++;
        debugLog("warn", "webrtc", "MQTT signaling publish failed");
      }
    }
#endif
    webrtcFreeMessage(queued);
  }
  if (g_waitingForAnswerSignalFlush && uxQueueMessagesWaiting(g_signalQueue) == 0) {
    g_waitingForAnswerSignalFlush = false;
    g_answerSignalWaitStartedAt = 0;
    memoryProfileMark("webrtc.signal", "answer_flushed");
    debugEventEmit("webrtc.debug", "debug", "webrtc", "answer signal flushed",
                   "\"freeHeap\":" + String(ESP.getFreeHeap()) + ",\"maxAllocHeap\":" + String(ESP.getMaxAllocHeap()));
  }
}

#if P1_EMBED_WEBRTC_SIGNALING_MQTT
static void webrtcMqttMessageReceived(String& topic, String& payload) {
  memoryProfileMark("webrtc.mqtt", "message");
  if (payload.length() == 0) return;
  g_signalInCount++;
  const String type = webrtcExtractEnvelopeType(payload);
  strlcpy(g_lastSignalType, type.c_str(), sizeof(g_lastSignalType));
  webrtcSetTrace("mqtt_signal");
  protocolEmitEvent("webrtc.trace", "\"event\":\"mqtt_signal\",\"count\":" + String(g_signalInCount) + ",\"type\":" + jsonString(type) + ",\"bytes\":" + String(payload.length()));
  debugEventEmit("webrtc.debug", "debug", "webrtc", "mqtt signal in",
                 "\"topic\":" + jsonString(topic) + ",\"bytes\":" + String(payload.length()) + ",\"type\":" + jsonString(type));
  if (type == "OFFER" ||
      type == "ANSWER" ||
      type == "CANDIDATE" ||
      type == "LEAVE") {
    webrtcQueuePeerJsMessage(payload);
  } else {
    webrtcHandlePeerJsMessage(payload);
  }
}
#endif

static void webrtcConnectPeerJs() {
  memoryProfileMark("webrtc.peerjs", "connect_begin");
  g_peerReconnectScheduled = false;
  g_peerReconnectAt = 0;
  g_peerId = webrtcBuildId(g_idAttempt);
  g_peerToken = webrtcRandomToken();

#if P1_EMBED_WEBRTC_SIGNALING_PEERJS
  String url = webrtcPeerPath() + "peerjs";
  url += "?key=" + String(P1_EMBED_WEBRTC_PEERJS_KEY);
  url += "&id=" + g_peerId;
  url += "&token=" + g_peerToken;
  url += "&version=1.5.5";

  if (P1_EMBED_WEBRTC_PEERJS_SECURE) {
    g_peerSocket.beginSSL(P1_EMBED_WEBRTC_PEERJS_HOST, P1_EMBED_WEBRTC_PEERJS_PORT, url.c_str(), "", "");
  } else {
    g_peerSocket.begin(P1_EMBED_WEBRTC_PEERJS_HOST, P1_EMBED_WEBRTC_PEERJS_PORT, url.c_str(), "");
  }
  g_peerSocket.onEvent(webrtcPeerJsSocketEvent);
  g_peerSocket.setReconnectInterval(P1_EMBED_WEBRTC_RECONNECT_INTERVAL_MS);
  memoryProfileMark("webrtc.peerjs", "connect_issued");
  protocolEmitEvent("webrtc.peerjs", "\"state\":\"connecting\",\"peerId\":" + jsonString(g_peerId));
#elif P1_EMBED_WEBRTC_SIGNALING_MQTT
  memoryProfileMark("webrtc.mqtt", "connect_begin");
  g_peerOpen = false;
  g_mqtt.setOptions(15, true, 1000);
  g_mqtt.begin(P1_EMBED_WEBRTC_MQTT_HOST, P1_EMBED_WEBRTC_MQTT_PORT, g_mqttNet);
  g_mqtt.onMessage(webrtcMqttMessageReceived);
  String clientId = g_peerId;
  if (clientId.length() > 60) clientId = clientId.substring(0, 60);
  protocolEmitEvent("webrtc.mqtt", "\"state\":\"connecting\",\"peerId\":" + jsonString(g_peerId) + ",\"host\":" + jsonString(P1_EMBED_WEBRTC_MQTT_HOST) + ",\"root\":" + jsonString(P1_EMBED_WEBRTC_MQTT_ROOT));
  if (!g_mqtt.connect(clientId.c_str(), P1_EMBED_WEBRTC_MQTT_USER, P1_EMBED_WEBRTC_MQTT_PASS)) {
    g_connectFailures++;
    strlcpy(g_lastSocketReason, "mqtt_connect_failed", sizeof(g_lastSocketReason));
    memoryProfileMark("webrtc.mqtt", "connect_failed");
    protocolEmitEvent("webrtc.mqtt", "\"state\":\"connect_failed\",\"peerId\":" + jsonString(g_peerId) + ",\"failures\":" + String(g_connectFailures));
    g_peerReconnectAt = millis() + P1_EMBED_WEBRTC_RECONNECT_INTERVAL_MS;
    g_peerReconnectScheduled = true;
    return;
  }
  String topic = webrtcSignalTopicTo(g_peerId);
  if (!g_mqtt.subscribe(topic)) {
    g_connectFailures++;
    strlcpy(g_lastSocketReason, "mqtt_subscribe_failed", sizeof(g_lastSocketReason));
    memoryProfileMark("webrtc.mqtt", "subscribe_failed");
    protocolEmitEvent("webrtc.mqtt", "\"state\":\"subscribe_failed\",\"peerId\":" + jsonString(g_peerId) + ",\"topic\":" + jsonString(topic));
    g_mqtt.disconnect();
    g_peerReconnectAt = millis() + P1_EMBED_WEBRTC_RECONNECT_INTERVAL_MS;
    g_peerReconnectScheduled = true;
    return;
  }
  g_connectFailures = 0;
  g_peerOpen = true;
  g_lastHeartbeatAt = millis();
  strlcpy(g_lastSocketReason, "", sizeof(g_lastSocketReason));
  memoryProfileMark("webrtc.mqtt", "open");
  protocolEmitEvent("webrtc.mqtt", "\"state\":\"open\",\"peerId\":" + jsonString(g_peerId) + ",\"topic\":" + jsonString(topic));
  protocolEmitEvent("webrtc.peerjs", "\"state\":\"open\",\"peerId\":" + jsonString(g_peerId) + ",\"signaling\":\"mqtt\"");
  g_mqtt.publish(webrtcSignalTopicPresence(), "{\"type\":\"ONLINE\",\"src\":\"" + webrtcEscapeJson(g_peerId) + "\"}");
#endif
}

static void webrtcTryNextId() {
  g_peerOpen = false;
  if (P1_EMBED_WEBRTC_AUTO_SUFFIX_ID) {
    g_idAttempt++;
  } else {
    g_idAttempt = 0;
#if P1_EMBED_WEBRTC_SIGNALING_PEERJS
    g_peerSocket.setReconnectInterval(P1_EMBED_WEBRTC_ID_TAKEN_RETRY_MS);
#endif
    g_peerReconnectAt = millis() + P1_EMBED_WEBRTC_ID_TAKEN_RETRY_MS;
    g_peerReconnectScheduled = true;
  }
#if P1_EMBED_WEBRTC_SIGNALING_PEERJS
  g_peerSocket.disconnect();
#elif P1_EMBED_WEBRTC_SIGNALING_MQTT
  g_mqtt.disconnect();
#endif
  if (P1_EMBED_WEBRTC_AUTO_SUFFIX_ID) {
    delay(100);
    webrtcConnectPeerJs();
  } else {
    protocolEmitEvent("webrtc.peerjs", "\"state\":\"id_retry_wait\",\"peerId\":" + jsonString(g_peerId) + ",\"retryMs\":" + String(P1_EMBED_WEBRTC_ID_TAKEN_RETRY_MS));
  }
}

static void webrtcSignalTask(void* arg) {
  for (;;) {
    if (!g_suspended) {
      if (!g_peerJsPausedForAnswer) {
#if P1_EMBED_WEBRTC_PARK_SIGNALING_WHEN_CONNECTED
        if (g_peerJsParkedForDataChannel && !g_dataChannelOpen) {
          g_peerJsParkedForDataChannel = false;
          delay(25);
          webrtcConnectPeerJs();
        }
#endif
        if (g_peerReconnectScheduled && (int32_t)(millis() - g_peerReconnectAt) >= 0) {
#if P1_EMBED_WEBRTC_SIGNALING_PEERJS
          g_peerSocket.disconnect();
#elif P1_EMBED_WEBRTC_SIGNALING_MQTT
          g_mqtt.disconnect();
          g_peerOpen = false;
#endif
          delay(25);
          webrtcConnectPeerJs();
        }
#if P1_EMBED_WEBRTC_SIGNALING_PEERJS
        g_peerSocket.loop();
#elif P1_EMBED_WEBRTC_SIGNALING_MQTT
        if (g_peerOpen && !g_mqtt.connected()) {
          g_peerOpen = false;
          g_connectFailures++;
          strlcpy(g_lastSocketReason, "mqtt_disconnected", sizeof(g_lastSocketReason));
          memoryProfileMark("webrtc.mqtt", "disconnected");
          protocolEmitEvent("webrtc.mqtt", "\"state\":\"disconnected\",\"peerId\":" + jsonString(g_peerId) + ",\"failures\":" + String(g_connectFailures));
          g_peerReconnectAt = millis() + P1_EMBED_WEBRTC_RECONNECT_INTERVAL_MS;
          g_peerReconnectScheduled = true;
        } else if (g_mqtt.connected()) {
          g_mqtt.loop();
        }
#endif
        webrtcFlushSignals();
        if (g_peerOpen && millis() - g_lastHeartbeatAt >= 5000) {
          webrtcSendHeartbeat();
        }
      }
    }
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

static bool webrtcStart() {
  if (g_started || g_startFailed || !g_enabled || !wifiIsConnected()) return false;

  memoryProfileMark("webrtc", "start_begin");
  g_peerMutex = xSemaphoreCreateMutex();
  g_outboundQueue = xQueueCreate(P1_EMBED_WEBRTC_SEND_QUEUE_DEPTH, sizeof(WebRtcMessage*));
  g_inboundQueue = xQueueCreate(P1_EMBED_WEBRTC_SEND_QUEUE_DEPTH, sizeof(WebRtcMessage*));
  g_signalQueue = xQueueCreate(P1_EMBED_WEBRTC_SEND_QUEUE_DEPTH, sizeof(WebRtcMessage*));
  g_peerJsQueue = xQueueCreate(P1_EMBED_WEBRTC_SEND_QUEUE_DEPTH, sizeof(WebRtcMessage*));
  memoryProfileMark("webrtc", "queues_created");
  if (!g_peerMutex || !g_outboundQueue || !g_inboundQueue || !g_signalQueue || !g_peerJsQueue) {
    debugError("webrtc", "queue_init_failed", "Failed to allocate WebRTC queues");
    webrtcReleaseStartResources();
    g_startFailed = true;
    return false;
  }

  randomSeed(micros());
  webrtcConnectPeerJs();
  memoryProfileMark("webrtc", "peerjs_started");

  BaseType_t peerOk = xTaskCreatePinnedToCore(
    webrtcPeerTask,
    "p1_webrtc_peer",
    P1_EMBED_WEBRTC_PEER_TASK_STACK,
    nullptr,
    5,
    &g_peerTaskHandle,
    0
  );
  BaseType_t signalOk = xTaskCreatePinnedToCore(
    webrtcSignalTask,
    "p1_webrtc_sig",
    P1_EMBED_WEBRTC_SIGNAL_TASK_STACK,
    nullptr,
    6,
    &g_signalTaskHandle,
    0
  );
  memoryProfileMark("webrtc", "tasks_created");

  if (peerOk != pdPASS || signalOk != pdPASS) {
    debugError("webrtc", "task_create_failed", "Failed to start WebRTC tasks");
    if (g_peerTaskHandle) {
      vTaskDelete(g_peerTaskHandle);
      g_peerTaskHandle = nullptr;
    }
    if (g_signalTaskHandle) {
      vTaskDelete(g_signalTaskHandle);
      g_signalTaskHandle = nullptr;
    }
    if (g_peerConnection) {
      peer_connection_destroy(g_peerConnection);
      g_peerConnection = nullptr;
    }
    webrtcReleaseStartResources();
    g_startFailed = true;
    return false;
  }

  g_started = true;
  memoryProfileMark("webrtc", "started");
  protocolEmitEvent("webrtc.status", "\"state\":\"started\",\"host\":" + jsonString(P1_EMBED_WEBRTC_PEERJS_HOST));
  return true;
}

void webrtcTransportBegin() {
  g_enabled = true;
  memoryProfileMark("webrtc", "transport_begin");
}

void webrtcTransportLoop() {
  if (!g_started) webrtcStart();
  webrtcResumeSuspendedScriptIfPending();
  WebRtcMessage* inbound = nullptr;
  while (g_inboundQueue && xQueueReceive(g_inboundQueue, &inbound, 0) == pdTRUE) {
    if (inbound && inbound->text) protocolHandleLine(inbound->text);
    webrtcFreeMessage(inbound);
  }
}

void webrtcTransportSendLine(const String& line) {
  if (!g_started || !g_dataChannelOpen || !g_outboundQueue) return;
  if (line.length() > P1_EMBED_WEBRTC_SEND_MAX_BYTES) {
    g_sendDrops++;
    debugLog("warn", "webrtc", "WebRTC output line too large");
    return;
  }
  WebRtcMessage* msg = webrtcAllocMessage(line.c_str(), line.length(), g_dataChannelSid, g_dataChannelSidKnown);
  if (!msg || !webrtcQueueText(g_outboundQueue, msg)) {
    g_sendDrops++;
    if (msg) webrtcFreeMessage(msg);
  }
}

String webrtcTransportStatusJson() {
  String out = "{";
  out += "\"enabled\":true";
  out += ",\"started\":" + String(g_started ? "true" : "false");
  out += ",\"peerOpen\":" + String(g_peerOpen ? "true" : "false");
  out += ",\"dataChannelOpen\":" + String(g_dataChannelOpen ? "true" : "false");
  out += ",\"signalingParked\":" + String(g_peerJsParkedForDataChannel ? "true" : "false");
  out += ",\"peerState\":" + jsonString(webrtcStateName(g_peerState));
  out += ",\"peerId\":" + jsonString(g_peerId.length() ? g_peerId : webrtcBuildId(g_idAttempt));
  out += ",\"remoteId\":" + jsonString(g_remoteId);
#if P1_EMBED_WEBRTC_SIGNALING_MQTT
  out += ",\"signaling\":\"mqtt\"";
  out += ",\"host\":" + jsonString(P1_EMBED_WEBRTC_MQTT_HOST);
  out += ",\"port\":" + String(P1_EMBED_WEBRTC_MQTT_PORT);
  out += ",\"root\":" + jsonString(P1_EMBED_WEBRTC_MQTT_ROOT);
  out += ",\"secure\":false";
#else
  out += ",\"signaling\":\"peerjs\"";
  out += ",\"host\":" + jsonString(P1_EMBED_WEBRTC_PEERJS_HOST);
  out += ",\"secure\":" + String(P1_EMBED_WEBRTC_PEERJS_SECURE ? "true" : "false");
#endif
  out += ",\"sendDrops\":" + String(g_sendDrops);
  out += ",\"recvDrops\":" + String(g_recvDrops);
  out += ",\"signalDrops\":" + String(g_signalDrops);
  out += ",\"connectFailures\":" + String(g_connectFailures);
  out += ",\"lastSocketReason\":" + jsonString(g_lastSocketReason);
  out += ",\"suspended\":" + String(g_suspended ? "true" : "false");
  out += ",\"scriptSuspended\":" + String(g_wrenchSuspendedForWebRtc ? "true" : "false");
  out += "}";
  return out;
}

String webrtcTransportProbeJson() {
  String out = "{";
  out += "\"started\":" + String(g_started ? "true" : "false");
  out += ",\"peerOpen\":" + String(g_peerOpen ? "true" : "false");
  out += ",\"signalingParked\":" + String(g_peerJsParkedForDataChannel ? "true" : "false");
  out += ",\"hadConnection\":" + String(g_peerConnection ? "true" : "false");
  out += ",\"beforeFreeHeap\":" + String(ESP.getFreeHeap());
  out += ",\"beforeMaxAllocHeap\":" + String(ESP.getMaxAllocHeap());
  out += ",\"beforeMinFreeHeap\":" + String(ESP.getMinFreeHeap());

  if (g_peerConnection) {
    out += ",\"created\":false,\"reason\":\"connection_active\"}";
    return out;
  }

  if (!webrtcTakePeer()) {
    out += ",\"created\":false,\"reason\":\"lock_unavailable\"}";
    return out;
  }

  bool created = webrtcCreateConnection();
  out += ",\"created\":" + String(created ? "true" : "false");
  out += ",\"afterCreateFreeHeap\":" + String(ESP.getFreeHeap());
  out += ",\"afterCreateMaxAllocHeap\":" + String(ESP.getMaxAllocHeap());
  out += ",\"afterCreateMinFreeHeap\":" + String(ESP.getMinFreeHeap());

  if (created && g_peerConnection) {
    peer_connection_destroy(g_peerConnection);
    g_peerConnection = nullptr;
    g_peerState = PEER_CONNECTION_CLOSED;
    g_peerConnectionFresh = false;
    g_peerConnectionStale = false;
    g_dataChannelOpen = false;
    g_dataChannelSidKnown = false;
    g_dataChannelSid = 0;
  }

  out += ",\"afterDestroyFreeHeap\":" + String(ESP.getFreeHeap());
  out += ",\"afterDestroyMaxAllocHeap\":" + String(ESP.getMaxAllocHeap());
  out += ",\"afterDestroyMinFreeHeap\":" + String(ESP.getMinFreeHeap());
  webrtcGivePeer();
  out += "}";
  return out;
}

#else

void webrtcTransportBegin() {}
void webrtcTransportLoop() {}
void webrtcTransportSendLine(const String& line) {}
String webrtcTransportStatusJson() {
  return "{\"enabled\":false}";
}
String webrtcTransportProbeJson() {
  return "{\"enabled\":false}";
}

#endif
