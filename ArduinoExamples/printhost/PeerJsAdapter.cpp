/*
  Dependencies:
  - kakopappa/esp32-arduino-webrtc for the precompiled libpeer archive
  - WebSockets by Markus Sattler for WebSocketsClient.h
*/

#include <Arduino.h>
#include <peer.h>
#include <HTTPClient.h>
#include <WebSockets.h>
#include <WebSocketsClient.h>
#include "PrintBridge.h"

static TaskHandle_t peerConnectionTaskHandle = NULL;
static TaskHandle_t peerJsTaskHandle = NULL;
static SemaphoreHandle_t peerSemaphore = NULL;
static QueueHandle_t peerDataChannelSendQueue = NULL;

struct PeerDataChannelMessage {
  char text[256];
  uint16_t sid;
  bool hasSid;
};

PeerConnection *peerConnection = NULL;
enum PeerConnectionState peerState = PEER_CONNECTION_CLOSED;
bool dataChannelOpen = false;
static bool dataChannelSidKnown = false;
static uint16_t dataChannelSid = 0;
static bool peerInitialized = false;

#ifndef LED_BUILTIN
#define LED_BUILTIN 2
#endif

const char *PEERJS_HOST = "0.peerjs.com";
const uint16_t PEERJS_PORT = 443;
const char *PEERJS_PATH = "/";
const char *PEERJS_KEY = "peerjs";
const char *PEERJS_ID = "printhost";
const bool PEERJS_SECURE = true;
const char *PEERJS_CONNECT_TO = "";
const bool PEERJS_AUTO_SUFFIX_ID = true;

// Browser PeerJS side should use raw serialization for plain text.
// Use the exact "PeerJS open as:" ID printed in Serial Monitor.

WebSocketsClient peerJsSocket;

String peerJsId = "";
String peerJsToken = "";
String peerJsRemoteId = "";
String peerJsConnectionId = "";
bool peerJsOpen = false;
bool peerJsWaitingForAnswer = false;
bool peerJsWaitingForOffer = false;
unsigned long peerJsLastHeartbeatAt = 0;
int peerJsIdAttempt = 0;

void peerJsConnect();
void peerJsTryNextId();
static void onPeerIceCandidate(char *sdpText, void *userData);

static void peerLogHeap(const char *label) {
  Serial.printf(
    "Heap %-18s free=%u min=%u maxAlloc=%u psram=%u\r\n",
    label,
    ESP.getFreeHeap(),
    ESP.getMinFreeHeap(),
    ESP.getMaxAllocHeap(),
    ESP.getFreePsram()
  );
}

String peerJsBuildId(int attempt) {
  String id = PEERJS_ID;
  if (!PEERJS_AUTO_SUFFIX_ID || attempt <= 0 || id.length() == 0) {
    return id;
  }

  int value = attempt;
  String suffix = "";
  while (value > 0) {
    value--;
    suffix = String(char('a' + (value % 26))) + suffix;
    value /= 26;
  }
  return id + suffix;
}

String peerJsPath() {
  String path = PEERJS_PATH;
  if (!path.startsWith("/")) {
    path = "/" + path;
  }
  if (!path.endsWith("/")) {
    path += "/";
  }
  return path;
}

String peerJsHttpProtocol() {
  return PEERJS_SECURE ? "https://" : "http://";
}

String peerJsRandomToken() {
  return String(random(0xffff), HEX) + String(random(0xffff), HEX) + String(random(0xffff), HEX);
}

String peerJsRandomConnectionId() {
  return String("dc_") + peerJsRandomToken();
}

String peerJsEscapeJson(const String &value) {
  String escaped;
  escaped.reserve(value.length() + 16);

  for (size_t i = 0; i < value.length(); i++) {
    const char ch = value[i];
    if (ch == '"') {
      escaped += "\\\"";
    } else if (ch == '\\') {
      escaped += "\\\\";
    } else if (ch == '\n') {
      escaped += "\\n";
    } else if (ch == '\r') {
      escaped += "\\r";
    } else if (ch == '\t') {
      escaped += "\\t";
    } else {
      escaped += ch;
    }
  }

  return escaped;
}

String peerJsUnescapeJson(const String &value) {
  String unescaped;
  unescaped.reserve(value.length());

  for (size_t i = 0; i < value.length(); i++) {
    char ch = value[i];
    if (ch != '\\' || i + 1 >= value.length()) {
      unescaped += ch;
      continue;
    }

    const char next = value[++i];
    if (next == 'n') {
      unescaped += '\n';
    } else if (next == 'r') {
      unescaped += '\r';
    } else if (next == 't') {
      unescaped += '\t';
    } else {
      unescaped += next;
    }
  }

  return unescaped;
}

String peerJsExtractString(const String &json, const char *key, int fromIndex = 0) {
  String pattern = "\"" + String(key) + "\":\"";
  int start = json.indexOf(pattern, fromIndex);
  if (start < 0) {
    pattern = "\"" + String(key) + "\" : \"";
    start = json.indexOf(pattern, fromIndex);
  }
  if (start < 0) {
    return "";
  }

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
    if (ch == '"') {
      break;
    }
    value += ch;
  }

  return peerJsUnescapeJson(value);
}

String peerJsExtractType(const String &json) {
  const String pattern = "\"type\":\"";
  const int start = json.lastIndexOf(pattern);
  if (start < 0) {
    return "";
  }

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
    if (ch == '"') {
      break;
    }
    value += ch;
  }

  return peerJsUnescapeJson(value);
}

String peerJsExtractPayloadSdp(const String &json) {
  const int payloadIndex = json.indexOf("\"payload\"");
  const int sdpIndex = json.indexOf("\"sdp\"", payloadIndex >= 0 ? payloadIndex : 0);
  return peerJsExtractString(json, "sdp", sdpIndex);
}

String peerJsExtractCandidate(const String &json) {
  const int candidateIndex = json.indexOf("\"candidate\"");
  return peerJsExtractString(json, "candidate", candidateIndex);
}

String peerJsGetGeneratedId() {
  HTTPClient http;
  String url = peerJsHttpProtocol() + PEERJS_HOST + ":" + String(PEERJS_PORT);
  url += peerJsPath() + PEERJS_KEY + "/id";
  url += "?ts=" + String(millis()) + "&version=1.5.5";

  if (!http.begin(url)) {
    return "";
  }

  const int status = http.GET();
  if (status != 200) {
    Serial.printf("PeerJS id request failed: %d\r\n", status);
    http.end();
    return "";
  }

  String id = http.getString();
  id.trim();
  http.end();
  return id;
}

void peerJsSendText(const String &message) {
  if (peerJsOpen) {
    String writableMessage = message;
    peerJsSocket.sendTXT(writableMessage);
  }
}

void peerJsSendHeartbeat() {
  peerJsSocket.sendTXT("{\"type\":\"HEARTBEAT\"}");
  peerJsLastHeartbeatAt = millis();
}

void peerJsSendSdp(const char *messageType, const char *sdpType, const String &sdp) {
  if (!peerJsOpen || peerJsRemoteId.length() == 0 || peerJsConnectionId.length() == 0) {
    return;
  }

  String message = String("{\"type\":\"") + messageType + "\"";
  message += ",\"dst\":\"" + peerJsEscapeJson(peerJsRemoteId) + "\"";
  message += ",\"payload\":{";
  message += "\"sdp\":{\"type\":\"" + String(sdpType) + "\",\"sdp\":\"" + peerJsEscapeJson(sdp) + "\"}";
  message += ",\"type\":\"data\"";
  message += ",\"connectionId\":\"" + peerJsEscapeJson(peerJsConnectionId) + "\"";

  if (String(messageType) == "OFFER") {
    message += ",\"metadata\":null";
    message += ",\"label\":\"" + peerJsEscapeJson(peerJsConnectionId) + "\"";
    message += ",\"reliable\":false";
    message += ",\"serialization\":\"raw\"";
  }

  message += "}}";
  peerJsSendText(message);
}

void peerJsSendCandidate(const String &candidate) {
  if (!peerJsOpen || peerJsRemoteId.length() == 0 || peerJsConnectionId.length() == 0) {
    return;
  }

  String message = "{\"type\":\"CANDIDATE\"";
  message += ",\"dst\":\"" + peerJsEscapeJson(peerJsRemoteId) + "\"";
  message += ",\"payload\":{";
  message += "\"candidate\":{\"candidate\":\"" + peerJsEscapeJson(candidate) + "\",\"sdpMid\":\"0\",\"sdpMLineIndex\":0}";
  message += ",\"type\":\"data\"";
  message += ",\"connectionId\":\"" + peerJsEscapeJson(peerJsConnectionId) + "\"";
  message += "}}";
  peerJsSendText(message);
}

bool peerTakeConnection() {
  return peerSemaphore != NULL && xSemaphoreTake(peerSemaphore, portMAX_DELAY);
}

void peerGiveConnection() {
  xSemaphoreGive(peerSemaphore);
}

void peerSendDataChannelText(const char *message) {
  if (!dataChannelOpen || peerConnection == NULL || message == NULL) {
    return;
  }
  if (peerDataChannelSendQueue == NULL) {
    return;
  }

  PeerDataChannelMessage *queued = static_cast<PeerDataChannelMessage *>(ps_malloc(sizeof(PeerDataChannelMessage)));
  if (queued == NULL) {
    Serial.println("PeerJS datachannel send alloc failed");
    return;
  }
  memset(queued, 0, sizeof(PeerDataChannelMessage));
  strlcpy(queued->text, message, sizeof(queued->text));
  queued->sid = dataChannelSid;
  queued->hasSid = dataChannelSidKnown;
  if (xQueueSend(peerDataChannelSendQueue, &queued, 0) != pdTRUE) {
    free(queued);
    Serial.println("PeerJS datachannel send queue full");
  }
}

static void peerFlushDataChannelSendQueue() {
  if (!dataChannelOpen || peerConnection == NULL || peerDataChannelSendQueue == NULL) {
    return;
  }

  PeerDataChannelMessage *queued = NULL;
  while (xQueueReceive(peerDataChannelSendQueue, &queued, 0) == pdTRUE) {
    if (queued == NULL) {
      continue;
    }
    if (!dataChannelOpen || peerConnection == NULL) {
      free(queued);
      break;
    }
    const bool quietMessage =
      strcmp(queued->text, "{\"cmd\":\"peer:pong\"}") == 0 ||
      strstr(queued->text, "\"state\":\"progress\"") != NULL;
    if (!quietMessage) {
      Serial.print("PeerJS datachannel send: ");
      Serial.println(queued->text);
    }
    int result = -1;
    if (queued->hasSid) {
      result = peer_connection_datachannel_send_sid(peerConnection, queued->text, strlen(queued->text), queued->sid);
    } else {
      result = peer_connection_datachannel_send(peerConnection, queued->text, strlen(queued->text));
    }
    if (!quietMessage || result <= 0) {
      Serial.printf("PeerJS datachannel send result: %d sid=%u known=%s\r\n", result, queued->sid, queued->hasSid ? "yes" : "no");
    }
    free(queued);
    queued = NULL;
  }
}

void peerJsStartOffer(const String &dst) {
  peerJsRemoteId = dst;
  peerJsConnectionId = peerJsRandomConnectionId();
  peerJsWaitingForOffer = false;
  peerJsWaitingForAnswer = false;

  if (peerTakeConnection()) {
    peer_connection_create_datachannel(peerConnection, DATA_CHANNEL_RELIABLE, 0, 0, (char *)peerJsConnectionId.c_str(), (char *)"");
    const char *offer = peer_connection_create_offer(peerConnection);
    if (offer != NULL) {
      peerJsSendSdp("OFFER", "offer", String(offer));
    }
    peerGiveConnection();
  }
}

static void onPeerStateChange(enum PeerConnectionState state, void *userData) {
  const char *stateName = "unknown";
  switch (state) {
    case PEER_CONNECTION_CLOSED:
      stateName = "closed";
      break;
    case PEER_CONNECTION_NEW:
      stateName = "new";
      break;
    case PEER_CONNECTION_CHECKING:
      stateName = "checking";
      break;
    case PEER_CONNECTION_CONNECTED:
      stateName = "connected";
      break;
    case PEER_CONNECTION_COMPLETED:
      stateName = "completed";
      break;
    case PEER_CONNECTION_FAILED:
      stateName = "failed";
      break;
    case PEER_CONNECTION_DISCONNECTED:
      stateName = "disconnected";
      break;
  }

  Serial.printf("PeerConnectionState: %d (%s)\r\n", state, stateName);

  peerState = state;
  if (peerState != PEER_CONNECTION_COMPLETED) {
    dataChannelOpen = false;
  }
}

static void onDataChannelMessage(char *msg, size_t len, void *userData, uint16_t sid) {
  dataChannelSid = sid;
  dataChannelSidKnown = true;
  if (printBridgeHandleDataChannelMessage(msg, len)) {
    return;
  }
  Serial.printf("Datachannel message: %.*s\r\n", len, msg);
}

static void onDataChannelOpen(void *userData) {
  Serial.println("Datachannel opened");
  dataChannelOpen = true;
  dataChannelSidKnown = false;
  dataChannelSid = 0;
  digitalWrite(LED_BUILTIN, HIGH);
  printBridgeHandleDataChannelOpen();
}

static void onDataChannelClose(void *userData) {
  Serial.println("Datachannel closed");
  printBridgeHandleDataChannelClose();
  dataChannelOpen = false;
  dataChannelSidKnown = false;
  dataChannelSid = 0;
  digitalWrite(LED_BUILTIN, LOW);
}

static bool peerCreateConnection() {
  if (!peerInitialized) {
    peer_init();
    peerInitialized = true;
    peerLogHeap("after peer_init");
  }

  PeerConfiguration config = {
    .ice_servers = {
      {.urls = "stun:stun.l.google.com:19302"}
    },
    .audio_codec = CODEC_NONE,
    .video_codec = CODEC_NONE,
    .datachannel = DATA_CHANNEL_STRING,
  };

  peerConnection = peer_connection_create(&config);
  if (peerConnection == NULL) {
    Serial.println("Failed to create peer connection");
    return false;
  }

  peer_connection_oniceconnectionstatechange(peerConnection, onPeerStateChange);
  peer_connection_onicecandidate(peerConnection, onPeerIceCandidate);
  peer_connection_ondatachannel(peerConnection, onDataChannelMessage, onDataChannelOpen, onDataChannelClose);
  peerState = PEER_CONNECTION_NEW;
  dataChannelOpen = false;
  dataChannelSidKnown = false;
  dataChannelSid = 0;
  peerLogHeap("after pc");
  return true;
}

static bool peerResetConnection() {
  if (peerConnection != NULL) {
    peer_connection_destroy(peerConnection);
    peerConnection = NULL;
  }
  return peerCreateConnection();
}

static void onPeerIceCandidate(char *sdpText, void *userData) {
  if (sdpText == NULL || peerJsRemoteId.length() == 0) {
    return;
  }

  const String sdp = String(sdpText);
  if (sdp.startsWith("candidate:")) {
    peerJsSendCandidate(sdp);
    return;
  }

  if (peerJsWaitingForAnswer) {
    peerJsSendSdp("ANSWER", "answer", sdp);
    peerJsWaitingForAnswer = false;
    return;
  }

  if (peerJsWaitingForOffer) {
    peerJsSendSdp("OFFER", "offer", sdp);
    peerJsWaitingForOffer = false;
  }
}

static void peerConnectionTask(void *arg) {
  Serial.println("peerConnectionTask started");

  for (;;) {
    if (xSemaphoreTake(peerSemaphore, portMAX_DELAY)) {
      if (peerConnection != NULL) {
        peer_connection_loop(peerConnection);
        peerFlushDataChannelSendQueue();
      }
      xSemaphoreGive(peerSemaphore);
    }

    vTaskDelay(pdMS_TO_TICKS(1));
  }
}

void peerJsHandleMessage(const String &message) {
  const String type = peerJsExtractType(message);

  if (type == "OPEN") {
    peerJsOpen = true;
    peerJsLastHeartbeatAt = millis();
    Serial.print("PeerJS open as: ");
    Serial.println(peerJsId);

    if (strlen(PEERJS_CONNECT_TO) > 0) {
      peerJsStartOffer(String(PEERJS_CONNECT_TO));
    }
    return;
  }

  if (type == "ID-TAKEN") {
    Serial.print("PeerJS id taken: ");
    Serial.println(peerJsId);
    peerJsTryNextId();
    return;
  }

  if (type == "ERROR" || type == "INVALID-KEY" || type == "EXPIRE") {
    Serial.print("PeerJS signaling error: ");
    Serial.println(message);
    return;
  }

  if (type == "LEAVE") {
    Serial.println("PeerJS remote left");
    dataChannelOpen = false;
    digitalWrite(LED_BUILTIN, LOW);
    if (peerTakeConnection()) {
      peer_connection_close(peerConnection);
      peerGiveConnection();
    }
    return;
  }

  if (type == "OFFER") {
    peerJsRemoteId = peerJsExtractString(message, "src");
    peerJsConnectionId = peerJsExtractString(message, "connectionId");
    const String sdp = peerJsExtractPayloadSdp(message);

    if (peerJsRemoteId.length() == 0 || peerJsConnectionId.length() == 0 || sdp.length() == 0) {
      Serial.println("Malformed PeerJS OFFER");
      return;
    }

    peerJsWaitingForAnswer = true;
    peerJsWaitingForOffer = false;
    Serial.print("PeerJS offer from: ");
    Serial.println(peerJsRemoteId);

    if (peerTakeConnection()) {
      if (peerResetConnection()) {
        peer_connection_set_remote_description(peerConnection, sdp.c_str(), SDP_TYPE_OFFER);
        const char *answer = peer_connection_create_answer(peerConnection);
        if (answer != NULL) {
          if (peerJsWaitingForAnswer) {
            Serial.println("PeerJS answer SDP preview:");
            Serial.println(String(answer).substring(0, 420));
            peerJsSendSdp("ANSWER", "answer", String(answer));
            peerJsWaitingForAnswer = false;
          } else {
            Serial.println("PeerJS answer sent from ICE callback");
          }
        } else {
          Serial.println("PeerJS answer creation failed");
        }
      }
      peerGiveConnection();
    }
    return;
  }

  if (type == "ANSWER") {
    const String sdp = peerJsExtractPayloadSdp(message);
    if (sdp.length() == 0) {
      Serial.println("Malformed PeerJS ANSWER");
      return;
    }

    Serial.println("PeerJS answer received");
    if (peerTakeConnection()) {
      peer_connection_set_remote_description(peerConnection, sdp.c_str(), SDP_TYPE_ANSWER);
      peerGiveConnection();
    }
    return;
  }

  if (type == "CANDIDATE") {
    String candidate = peerJsExtractCandidate(message);
    if (candidate.length() == 0) {
      Serial.println("Malformed PeerJS CANDIDATE");
      return;
    }
    if (candidate.indexOf(" tcp ") >= 0) {
      Serial.println("Ignoring TCP ICE candidate");
      return;
    }

    if (peerTakeConnection()) {
      const int result = peer_connection_add_ice_candidate(peerConnection, (char *)candidate.c_str());
      Serial.printf("Added UDP ICE candidate: %d | %s\r\n", result, candidate.substring(0, 96).c_str());
      peerGiveConnection();
    }
    return;
  }

  Serial.print("PeerJS unhandled message: ");
  Serial.println(message);
}

void peerJsSocketEvent(WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.println("PeerJS websocket connected");
      peerLogHeap("ws connected");
      break;

    case WStype_DISCONNECTED:
      peerJsOpen = false;
      if (payload && length > 0) {
        Serial.printf("PeerJS websocket disconnected: %.*s\r\n", (int)length, (const char *)payload);
      } else {
        Serial.println("PeerJS websocket disconnected");
      }
      peerLogHeap("ws disconnected");
      break;

    case WStype_TEXT:
      {
        String message;
        message.reserve(length + 1);
        for (size_t i = 0; i < length; i++) {
          message += (char)payload[i];
        }
        peerJsHandleMessage(message);
      }
      break;

    case WStype_ERROR:
      peerJsOpen = false;
      if (payload && length > 0) {
        Serial.printf("PeerJS websocket error: %.*s\r\n", (int)length, (const char *)payload);
      } else {
        Serial.println("PeerJS websocket error");
      }
      peerLogHeap("ws error");
      break;

    default:
      break;
  }
}

void peerJsConnect() {
  peerJsId = peerJsBuildId(peerJsIdAttempt);
  if (peerJsId.length() == 0) {
    peerJsId = peerJsGetGeneratedId();
  }

  if (peerJsId.length() == 0) {
    Serial.println("No PeerJS id available");
    return;
  }

  peerJsToken = peerJsRandomToken();

  Serial.print("PeerJS trying id: ");
  Serial.println(peerJsId);
  peerLogHeap("before ws");

  String url = peerJsPath() + "peerjs";
  url += "?key=" + String(PEERJS_KEY);
  url += "&id=" + peerJsId;
  url += "&token=" + peerJsToken;
  url += "&version=1.5.5";

  if (PEERJS_SECURE) {
    peerJsSocket.beginSSL(PEERJS_HOST, PEERJS_PORT, url.c_str());
  } else {
    peerJsSocket.begin(PEERJS_HOST, PEERJS_PORT, url.c_str());
  }

  peerJsSocket.onEvent(peerJsSocketEvent);
  peerJsSocket.setReconnectInterval(5000);
}

void peerJsTryNextId() {
  if (!PEERJS_AUTO_SUFFIX_ID || String(PEERJS_ID).length() == 0) {
    return;
  }

  peerJsOpen = false;
  peerJsIdAttempt++;
  peerJsSocket.disconnect();
  delay(100);
  peerJsConnect();
}

static void peerJsTask(void *arg) {
  Serial.println("peerJsTask started");

  for (;;) {
    peerJsSocket.loop();
    if (peerJsOpen && millis() - peerJsLastHeartbeatAt >= 5000) {
      peerJsSendHeartbeat();
    }
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

void peerBegin() {
  randomSeed(micros());
  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, LOW);
  peerLogHeap("peerBegin");

  peerSemaphore = xSemaphoreCreateMutex();
  if (peerSemaphore == NULL) {
    Serial.println("Failed to create peer semaphore");
    return;
  }

  peerDataChannelSendQueue = xQueueCreate(16, sizeof(PeerDataChannelMessage *));
  if (peerDataChannelSendQueue == NULL) {
    Serial.println("Failed to create peer datachannel send queue");
    return;
  }

  peerJsConnect();

  xTaskCreatePinnedToCore(
    peerConnectionTask,
    "peer_connection",
    8192 * 4,
    NULL,
    5,
    &peerConnectionTaskHandle,
    0
  );

  xTaskCreatePinnedToCore(
    peerJsTask,
    "peerjs_signaling",
    8192 * 4,
    NULL,
    6,
    &peerJsTaskHandle,
    0
  );

  Serial.println("============= PeerJS Configuration =============");
  Serial.printf("Host  : %s:%u\n", PEERJS_HOST, PEERJS_PORT);
  Serial.printf("Path  : %s\n", PEERJS_PATH);
  Serial.printf("Key   : %s\n", PEERJS_KEY);
  Serial.printf("ID    : %s\n", peerJsId.c_str());
  Serial.printf("TLS   : %s\n", PEERJS_SECURE ? "yes" : "no");
  Serial.println("================================================");
}

void peerLoop() {
  delay(10);
}
