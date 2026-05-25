#include <Arduino.h>
#include <ESPmDNS.h>
#include <WebSockets.h>
#include <WebSocketsServer.h>
#include <WiFi.h>
#include "p1_embed_firmware.h"

static WebSocketsServer g_ws(P1_EMBED_WS_PORT);
static bool g_wsEnabled = false;
static bool g_wsStarted = false;
static bool g_mdnsStarted = false;
static String g_mdnsName;
static uint8_t g_wsClients = 0;

static String webTransportHostName() {
  String name = configDeviceName();
  name.toLowerCase();

  String clean;
  clean.reserve(name.length());
  bool lastDash = false;
  for (size_t i = 0; i < name.length(); i++) {
    char c = name[i];
    bool ok = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
    if (ok) {
      clean += c;
      lastDash = false;
    } else if (!lastDash && clean.length() > 0) {
      clean += '-';
      lastDash = true;
    }
  }

  while (clean.endsWith("-")) clean.remove(clean.length() - 1);
  if (!clean.length()) clean = "p1-embed";
  if (clean.length() > 63) clean = clean.substring(0, 63);
  return clean;
}

static void webTransportStartMdns() {
  if (g_mdnsStarted || !wifiIsConnected()) return;

  g_mdnsName = webTransportHostName();
  if (!MDNS.begin(g_mdnsName.c_str())) {
    debugError("websocket", "mdns_begin_failed", "Failed to start mDNS");
    return;
  }

  MDNS.addService("p1-embed", "tcp", P1_EMBED_WS_PORT);
  String id = configDeviceId();
  String name = configDeviceName();
  MDNS.addServiceTxt("p1-embed", "tcp", "id", id.c_str());
  MDNS.addServiceTxt("p1-embed", "tcp", "name", name.c_str());
  MDNS.addServiceTxt("p1-embed", "tcp", "protocol", P1_EMBED_PROTOCOL_VERSION);
  MDNS.addServiceTxt("p1-embed", "tcp", "transport", "websocket");
  MDNS.addService("ws", "tcp", P1_EMBED_WS_PORT);
  g_mdnsStarted = true;

  protocolEmitEvent(
    "websocket.status",
    "\"status\":\"mdns\",\"host\":" + jsonString(g_mdnsName + ".local") + ",\"port\":" + String(P1_EMBED_WS_PORT)
  );
}

static void webTransportEvent(uint8_t num, int type, uint8_t* payload, size_t length) {
  if (type == WStype_CONNECTED) {
    if (g_wsClients < 255) g_wsClients++;
    protocolEmitEvent("websocket.client", "\"state\":\"connected\",\"client\":" + String(num));
    return;
  }

  if (type == WStype_DISCONNECTED) {
    if (g_wsClients > 0) g_wsClients--;
    protocolEmitEvent("websocket.client", "\"state\":\"disconnected\",\"client\":" + String(num));
    return;
  }

  if (type != WStype_TEXT) return;
  if (length == 0) return;
  if (length >= P1_EMBED_LINE_MAX) {
    protocolEmitErrorEvent("protocol.error", "line_too_long", "Discarding websocket input");
    return;
  }

  String line;
  line.reserve(length);
  for (size_t i = 0; i < length; i++) line += (char)payload[i];
  protocolHandleLine(line.c_str());
}

void webTransportBegin() {
  g_wsEnabled = true;
}

static void webTransportStartServer() {
  if (!g_wsEnabled || g_wsStarted || !wifiIsConnected()) return;
  g_ws.begin();
  g_ws.onEvent([](uint8_t num, WStype_t type, uint8_t* payload, size_t length) {
    webTransportEvent(num, (int)type, payload, length);
  });
  g_wsStarted = true;
  protocolEmitEvent("websocket.status", "\"status\":\"started\",\"port\":" + String(P1_EMBED_WS_PORT));
}

void webTransportLoop() {
  webTransportStartServer();
  if (g_wsStarted) g_ws.loop();
  webTransportStartMdns();
}

void webTransportSendLine(const String& line) {
  if (!g_wsStarted || g_wsClients == 0) return;
  String payload = line;
  g_ws.broadcastTXT(payload);
}

String webTransportStatusJson() {
  String out = "{";
  out += "\"enabled\":true";
  out += ",\"started\":" + String(g_wsStarted ? "true" : "false");
  out += ",\"port\":" + String(P1_EMBED_WS_PORT);
  out += ",\"clients\":" + String(g_wsClients);
  out += ",\"mdns\":" + String(g_mdnsStarted ? "true" : "false");
  out += ",\"host\":" + jsonString(g_mdnsStarted ? g_mdnsName + ".local" : webTransportHostName() + ".local");
  out += "}";
  return out;
}
