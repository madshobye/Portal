#include <HTTPClient.h>
#include <WebSocketsClient.h>

const char *PEER_HOST = "192.168.1.10";
const uint16_t PEER_PORT = 9000;
const char *PEER_PATH = "/myapp/";
const char *PEER_KEY = "peerjs";
const char *PEER_ID = "printhost-esp32";
const bool PEER_SECURE = false;

WebSocketsClient peerSocket;

String peerId = "";
String peerToken = "";
bool peerOpen = false;
unsigned long lastHeartbeatAt = 0;

String peerProtocol() {
  return PEER_SECURE ? "https://" : "http://";
}

String peerPath() {
  String path = PEER_PATH;
  if (!path.startsWith("/")) {
    path = "/" + path;
  }
  if (!path.endsWith("/")) {
    path += "/";
  }
  return path;
}

String randomPeerToken() {
  return String(random(0xffff), HEX) + String(random(0xffff), HEX) + String(random(0xffff), HEX);
}

String getGeneratedPeerId() {
  HTTPClient http;
  String url = peerProtocol() + PEER_HOST + ":" + String(PEER_PORT) + peerPath() + PEER_KEY + "/id";
  url += "?ts=" + String(millis()) + "&version=1.5.5";

  if (!http.begin(url)) {
    return "";
  }

  int status = http.GET();
  if (status != 200) {
    Serial.print("Peer ID request failed: ");
    Serial.println(status);
    http.end();
    return "";
  }

  String id = http.getString();
  id.trim();
  http.end();
  return id;
}

void sendPeerHeartbeat() {
  if (!peerOpen) {
    return;
  }

  peerSocket.sendTXT("{\"type\":\"HEARTBEAT\"}");
  lastHeartbeatAt = millis();
}

void sendPeerLeave(const String &dst) {
  if (!peerOpen) {
    return;
  }

  String message = "{\"type\":\"LEAVE\",\"dst\":\"" + dst + "\"}";
  peerSocket.sendTXT(message);
}

void handlePeerServerMessage(const String &message) {
  Serial.print("PeerServer: ");
  Serial.println(message);

  if (message.indexOf("\"type\":\"OPEN\"") >= 0) {
    peerOpen = true;
    lastHeartbeatAt = millis();
    Serial.print("PeerJS client open as: ");
    Serial.println(peerId);
    return;
  }

  if (message.indexOf("\"type\":\"OFFER\"") >= 0) {
    Serial.println("Offer received. Add ESP32 WebRTC handling here.");
    return;
  }

  if (message.indexOf("\"type\":\"CANDIDATE\"") >= 0) {
    Serial.println("ICE candidate received. Add ESP32 WebRTC handling here.");
    return;
  }

  if (message.indexOf("\"type\":\"ANSWER\"") >= 0) {
    Serial.println("Answer received. Add ESP32 WebRTC handling here.");
    return;
  }
}

void peerSocketEvent(WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.println("PeerServer websocket connected");
      break;

    case WStype_DISCONNECTED:
      peerOpen = false;
      Serial.println("PeerServer websocket disconnected");
      break;

    case WStype_TEXT:
      {
        String message;
        message.reserve(length + 1);
        for (size_t i = 0; i < length; i++) {
          message += (char)payload[i];
        }
        handlePeerServerMessage(message);
      }
      break;

    case WStype_ERROR:
      peerOpen = false;
      Serial.println("PeerServer websocket error");
      break;

    default:
      break;
  }
}

void peerBegin() {
  randomSeed(micros());

  peerId = PEER_ID;
  if (peerId.length() == 0) {
    peerId = getGeneratedPeerId();
  }

  if (peerId.length() == 0) {
    Serial.println("No PeerJS id available");
    return;
  }

  peerToken = randomPeerToken();

  String url = peerPath() + PEER_KEY;
  url += "?key=" + String(PEER_KEY);
  url += "&id=" + peerId;
  url += "&token=" + peerToken;
  url += "&version=1.5.5";

  Serial.print("Connecting to PeerServer as ");
  Serial.println(peerId);

  if (PEER_SECURE) {
    peerSocket.beginSSL(PEER_HOST, PEER_PORT, url.c_str());
  } else {
    peerSocket.begin(PEER_HOST, PEER_PORT, url.c_str());
  }

  peerSocket.onEvent(peerSocketEvent);
  peerSocket.setReconnectInterval(5000);
}

void peerLoop() {
  peerSocket.loop();

  if (peerOpen && millis() - lastHeartbeatAt >= 5000) {
    sendPeerHeartbeat();
  }
}
