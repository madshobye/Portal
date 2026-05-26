#include <Arduino.h>
#include <HTTPClient.h>
#include <WebSockets.h>
#include <WebSocketsClient.h>
#include <WiFi.h>
#include <peer.h>
#include "p1_embed_firmware.h"

#if P1_EMBED_WEBRTC_ENABLED

struct WebRtcMessage {
  char* text;
  uint16_t sid;
  bool hasSid;
};

static WebSocketsClient g_peerSocket;
static PeerConnection* g_peerConnection = nullptr;
static SemaphoreHandle_t g_peerMutex = nullptr;
static QueueHandle_t g_outboundQueue = nullptr;
static QueueHandle_t g_inboundQueue = nullptr;
static QueueHandle_t g_signalQueue = nullptr;
static TaskHandle_t g_peerTaskHandle = nullptr;
static TaskHandle_t g_signalTaskHandle = nullptr;

static bool g_enabled = false;
static bool g_started = false;
static bool g_peerInitialized = false;
static bool g_peerOpen = false;
static bool g_dataChannelOpen = false;
static bool g_dataChannelSidKnown = false;
static bool g_peerConnectionStale = false;
static bool g_suspended = false;
static uint16_t g_dataChannelSid = 0;
static PeerConnectionState g_peerState = PEER_CONNECTION_CLOSED;
static uint32_t g_lastHeartbeatAt = 0;
static uint32_t g_sendDrops = 0;
static uint32_t g_recvDrops = 0;
static uint32_t g_signalDrops = 0;
static uint32_t g_connectFailures = 0;
static uint32_t g_lastDisconnectEventAt = 0;
static int g_idAttempt = 0;
static const char* g_staleReason = nullptr;
static char g_lastSocketReason[96] = "";

static String g_peerId;
static String g_peerToken;
static String g_remoteId;
static String g_connectionId;

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

static void webrtcQueueSignal(const String& message) {
  WebRtcMessage* msg = webrtcAllocMessage(message.c_str(), message.length());
  if (!msg || !webrtcQueueText(g_signalQueue, msg)) {
    g_signalDrops++;
    debugLog("warn", "webrtc", "PeerJS signaling queue full");
  }
}

static void webrtcSendHeartbeat() {
  g_peerSocket.sendTXT("{\"type\":\"HEARTBEAT\"}");
  g_lastHeartbeatAt = millis();
}

static void webrtcSendSdp(const char* messageType, const char* sdpType, const String& sdp) {
  if (!g_peerOpen || g_remoteId.length() == 0 || g_connectionId.length() == 0) return;

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
  webrtcQueueSignal(message);
}

static void webrtcSendCandidate(const String& candidate) {
  if (!g_peerOpen || g_remoteId.length() == 0 || g_connectionId.length() == 0) return;

  String message = "{\"type\":\"CANDIDATE\"";
  message += ",\"dst\":\"" + webrtcEscapeJson(g_remoteId) + "\"";
  message += ",\"payload\":{";
  message += "\"candidate\":{\"candidate\":\"" + webrtcEscapeJson(candidate) + "\",\"sdpMid\":\"0\",\"sdpMLineIndex\":0}";
  message += ",\"type\":\"data\"";
  message += ",\"connectionId\":\"" + webrtcEscapeJson(g_connectionId) + "\"";
  message += "}}";
  webrtcQueueSignal(message);
}

static void webrtcMarkStale(const char* reason) {
  if (!g_peerConnection) return;
  g_staleReason = reason;
  g_peerConnectionStale = true;
  g_dataChannelOpen = false;
  g_dataChannelSidKnown = false;
  g_dataChannelSid = 0;
}

static void onWebRtcIceCandidate(char* sdpText, void* userData) {
  if (!sdpText || g_remoteId.length() == 0) return;
  const String sdp = String(sdpText);
  if (sdp.startsWith("candidate:")) {
    webrtcSendCandidate(sdp);
    return;
  }
  webrtcSendSdp("ANSWER", "answer", sdp);
}

static void onWebRtcStateChange(PeerConnectionState state, void* userData) {
  g_peerState = state;
  if (state != PEER_CONNECTION_COMPLETED) g_dataChannelOpen = false;

  const String stateName = webrtcStateName(state);
  protocolEmitEvent("webrtc.peer", "\"state\":" + jsonString(stateName));
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
  protocolEmitEvent("webrtc.client", "\"state\":\"connected\",\"peerId\":" + jsonString(g_peerId) + ",\"remoteId\":" + jsonString(g_remoteId));
}

static void onWebRtcDataChannelClose(void* userData) {
  g_dataChannelOpen = false;
  g_dataChannelSidKnown = false;
  g_dataChannelSid = 0;
  protocolEmitEvent("webrtc.client", "\"state\":\"disconnected\",\"peerId\":" + jsonString(g_peerId));
  webrtcMarkStale("datachannel_close");
}

static bool webrtcCreateConnection() {
  if (!g_peerInitialized) {
    if (peer_init() != 0) {
      debugError("webrtc", "peer_init_failed", "Failed to initialize libpeer");
      return false;
    }
    g_peerInitialized = true;
  }

  PeerConfiguration config = {
    .ice_servers = {
      {.urls = "stun:stun.l.google.com:19302", .username = nullptr, .credential = nullptr}
    },
    .audio_codec = CODEC_NONE,
    .video_codec = CODEC_NONE,
    .datachannel = DATA_CHANNEL_STRING,
    .onaudiotrack = nullptr,
    .onvideotrack = nullptr,
    .on_request_keyframe = nullptr,
    .user_data = nullptr,
  };

  g_peerConnection = peer_connection_create(&config);
  if (!g_peerConnection) {
    debugError("webrtc", "peer_connection_failed", "Failed to create peer connection");
    return false;
  }

  peer_connection_oniceconnectionstatechange(g_peerConnection, onWebRtcStateChange);
  peer_connection_onicecandidate(g_peerConnection, onWebRtcIceCandidate);
  peer_connection_ondatachannel(g_peerConnection, onWebRtcDataChannelMessage, onWebRtcDataChannelOpen, onWebRtcDataChannelClose);
  g_peerState = PEER_CONNECTION_NEW;
  g_dataChannelOpen = false;
  g_dataChannelSidKnown = false;
  g_dataChannelSid = 0;
  return true;
}

static bool webrtcResetConnection() {
  g_peerConnectionStale = false;
  g_staleReason = nullptr;
  webrtcClearQueue(g_outboundQueue);
  g_dataChannelOpen = false;
  g_dataChannelSidKnown = false;
  g_dataChannelSid = 0;
  if (g_peerConnection) {
    peer_connection_destroy(g_peerConnection);
    g_peerConnection = nullptr;
  }
  return webrtcCreateConnection();
}

static void webrtcCleanupStaleConnection() {
  if (!g_peerConnectionStale) return;

  g_peerConnectionStale = false;
  const char* reason = g_staleReason ? g_staleReason : "unknown";
  g_staleReason = nullptr;
  webrtcClearQueue(g_outboundQueue);
  g_dataChannelOpen = false;
  g_dataChannelSidKnown = false;
  g_dataChannelSid = 0;
  g_remoteId = "";
  g_connectionId = "";
  if (g_peerConnection) {
    peer_connection_destroy(g_peerConnection);
    g_peerConnection = nullptr;
  }
  protocolEmitEvent("webrtc.peer", "\"state\":\"closed\",\"reason\":" + jsonString(reason));
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

static void webrtcPeerTask(void* arg) {
  for (;;) {
    if (webrtcTakePeer()) {
      if (g_peerConnection) {
        peer_connection_loop(g_peerConnection);
        if (g_peerConnectionStale) {
          webrtcCleanupStaleConnection();
        } else {
          webrtcFlushOutbound();
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
  peer_connection_create_datachannel(g_peerConnection, DATA_CHANNEL_RELIABLE, 0, 0, (char*)g_connectionId.c_str(), (char*)"");
  const char* offer = peer_connection_create_offer(g_peerConnection);
  if (offer) webrtcSendSdp("OFFER", "offer", String(offer));
  webrtcGivePeer();
}

static void webrtcTryNextId();

static void webrtcHandlePeerJsMessage(const String& message) {
  const String type = webrtcExtractType(message);

  if (type == "OPEN") {
    g_peerOpen = true;
    g_lastHeartbeatAt = millis();
    protocolEmitEvent("webrtc.peerjs", "\"state\":\"open\",\"peerId\":" + jsonString(g_peerId));
    return;
  }

  if (type == "ID-TAKEN") {
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
    g_remoteId = webrtcExtractString(message, "src");
    g_connectionId = webrtcExtractString(message, "connectionId");
    const String sdp = webrtcExtractPayloadSdp(message);
    if (g_remoteId.length() == 0 || g_connectionId.length() == 0 || sdp.length() == 0) {
      debugError("webrtc", "bad_offer", "Malformed PeerJS offer");
      return;
    }

    if (webrtcTakePeer()) {
      if (webrtcResetConnection()) {
        peer_connection_set_remote_description(g_peerConnection, sdp.c_str(), SDP_TYPE_OFFER);
        const char* answer = peer_connection_create_answer(g_peerConnection);
        if (answer) {
          webrtcSendSdp("ANSWER", "answer", String(answer));
        } else {
          debugError("webrtc", "answer_failed", "Failed to create WebRTC answer");
        }
      }
      webrtcGivePeer();
    }
    return;
  }

  if (type == "ANSWER") {
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
    String candidate = webrtcExtractCandidate(message);
    if (candidate.length() == 0) {
      debugError("webrtc", "bad_candidate", "Malformed PeerJS candidate");
      return;
    }
    if (candidate.indexOf(" tcp ") >= 0) return;
    if (webrtcTakePeer()) {
      if (g_peerConnection) peer_connection_add_ice_candidate(g_peerConnection, (char*)candidate.c_str());
      webrtcGivePeer();
    }
  }
}

static void webrtcPeerJsSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      g_connectFailures = 0;
      protocolEmitEvent("webrtc.peerjs", "\"state\":\"socket_connected\",\"peerId\":" + jsonString(g_peerId));
      break;
    case WStype_DISCONNECTED:
      g_peerOpen = false;
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
      String message;
      message.reserve(length + 1);
      for (size_t i = 0; i < length; i++) message += (char)payload[i];
      webrtcHandlePeerJsMessage(message);
      break;
    }
    case WStype_ERROR:
      g_peerOpen = false;
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

static void webrtcFlushSignals() {
  if (!g_peerOpen || !g_signalQueue) return;
  WebRtcMessage* queued = nullptr;
  while (xQueueReceive(g_signalQueue, &queued, 0) == pdTRUE) {
    if (!queued) continue;
    g_peerSocket.sendTXT(queued->text);
    webrtcFreeMessage(queued);
  }
}

static void webrtcConnectPeerJs() {
  g_peerId = webrtcBuildId(g_idAttempt);
  g_peerToken = webrtcRandomToken();

  String url = webrtcPeerPath() + "peerjs";
  url += "?key=" + String(P1_EMBED_WEBRTC_PEERJS_KEY);
  url += "&id=" + g_peerId;
  url += "&token=" + g_peerToken;
  url += "&version=1.5.5";

  g_peerSocket.setExtraHeaders("Origin: https://madshobye.github.io");
  if (P1_EMBED_WEBRTC_PEERJS_SECURE) {
    g_peerSocket.beginSSL(P1_EMBED_WEBRTC_PEERJS_HOST, P1_EMBED_WEBRTC_PEERJS_PORT, url.c_str(), "", "");
  } else {
    g_peerSocket.begin(P1_EMBED_WEBRTC_PEERJS_HOST, P1_EMBED_WEBRTC_PEERJS_PORT, url.c_str(), "");
  }
  g_peerSocket.onEvent(webrtcPeerJsSocketEvent);
  g_peerSocket.setReconnectInterval(P1_EMBED_WEBRTC_RECONNECT_INTERVAL_MS);
  protocolEmitEvent("webrtc.peerjs", "\"state\":\"connecting\",\"peerId\":" + jsonString(g_peerId));
}

static void webrtcTryNextId() {
  if (!P1_EMBED_WEBRTC_AUTO_SUFFIX_ID) return;
  g_peerOpen = false;
  g_idAttempt++;
  g_peerSocket.disconnect();
  delay(100);
  webrtcConnectPeerJs();
}

static void webrtcSignalTask(void* arg) {
  for (;;) {
    if (!g_suspended) {
      g_peerSocket.loop();
      webrtcFlushSignals();
      if (g_peerOpen && millis() - g_lastHeartbeatAt >= 5000) {
        webrtcSendHeartbeat();
      }
    }
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

static bool webrtcStart() {
  if (g_started || !g_enabled || !wifiIsConnected()) return false;

  g_peerMutex = xSemaphoreCreateMutex();
  g_outboundQueue = xQueueCreate(P1_EMBED_WEBRTC_SEND_QUEUE_DEPTH, sizeof(WebRtcMessage*));
  g_inboundQueue = xQueueCreate(P1_EMBED_WEBRTC_SEND_QUEUE_DEPTH, sizeof(WebRtcMessage*));
  g_signalQueue = xQueueCreate(P1_EMBED_WEBRTC_SEND_QUEUE_DEPTH, sizeof(WebRtcMessage*));
  if (!g_peerMutex || !g_outboundQueue || !g_inboundQueue || !g_signalQueue) {
    debugError("webrtc", "queue_init_failed", "Failed to allocate WebRTC queues");
    return false;
  }

  randomSeed(micros());
  webrtcConnectPeerJs();

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

  if (peerOk != pdPASS || signalOk != pdPASS) {
    debugError("webrtc", "task_create_failed", "Failed to start WebRTC tasks");
    return false;
  }

  g_started = true;
  protocolEmitEvent("webrtc.status", "\"state\":\"started\",\"host\":" + jsonString(P1_EMBED_WEBRTC_PEERJS_HOST));
  return true;
}

void webrtcTransportBegin() {
  g_enabled = true;
}

void webrtcTransportLoop() {
  if (!g_started) webrtcStart();
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
    debugLog("warn", "webrtc", "WebRTC outbound queue full");
  }
}

String webrtcTransportStatusJson() {
  String out = "{";
  out += "\"enabled\":true";
  out += ",\"started\":" + String(g_started ? "true" : "false");
  out += ",\"peerOpen\":" + String(g_peerOpen ? "true" : "false");
  out += ",\"dataChannelOpen\":" + String(g_dataChannelOpen ? "true" : "false");
  out += ",\"peerState\":" + jsonString(webrtcStateName(g_peerState));
  out += ",\"peerId\":" + jsonString(g_peerId.length() ? g_peerId : webrtcBuildId(g_idAttempt));
  out += ",\"remoteId\":" + jsonString(g_remoteId);
  out += ",\"host\":" + jsonString(P1_EMBED_WEBRTC_PEERJS_HOST);
  out += ",\"secure\":" + String(P1_EMBED_WEBRTC_PEERJS_SECURE ? "true" : "false");
  out += ",\"sendDrops\":" + String(g_sendDrops);
  out += ",\"recvDrops\":" + String(g_recvDrops);
  out += ",\"signalDrops\":" + String(g_signalDrops);
  out += ",\"connectFailures\":" + String(g_connectFailures);
  out += ",\"lastSocketReason\":" + jsonString(g_lastSocketReason);
  out += ",\"suspended\":" + String(g_suspended ? "true" : "false");
  out += ",\"peerTaskStackHighWater\":" + String(g_peerTaskHandle ? uxTaskGetStackHighWaterMark(g_peerTaskHandle) : 0);
  out += ",\"signalTaskStackHighWater\":" + String(g_signalTaskHandle ? uxTaskGetStackHighWaterMark(g_signalTaskHandle) : 0);
  out += ",\"outQueued\":" + String(g_outboundQueue ? uxQueueMessagesWaiting(g_outboundQueue) : 0);
  out += ",\"inQueued\":" + String(g_inboundQueue ? uxQueueMessagesWaiting(g_inboundQueue) : 0);
  out += ",\"signalQueued\":" + String(g_signalQueue ? uxQueueMessagesWaiting(g_signalQueue) : 0);
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

#endif
