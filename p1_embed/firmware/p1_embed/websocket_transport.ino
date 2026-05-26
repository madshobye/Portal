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
static bool g_wsScriptSetPending = false;
static String g_wsScriptSetPendingId;
static bool g_wsScriptSetPendingRun = false;
static bool g_wsScriptSetPendingSave = false;

static bool wsJsonGetString(const uint8_t* payload, size_t length, const char* key, String& out) {
  out = "";
  String needle = String("\"") + key + "\"";
  size_t keyLen = needle.length();
  for (size_t i = 0; i + keyLen < length; i++) {
    if (memcmp(payload + i, needle.c_str(), keyLen) != 0) continue;
    size_t p = i + keyLen;
    while (p < length && isspace((char)payload[p])) p++;
    if (p >= length || payload[p] != ':') continue;
    p++;
    while (p < length && isspace((char)payload[p])) p++;
    if (p >= length || payload[p] != '"') return false;
    p++;
    out.reserve(min((size_t)P1_EMBED_MAX_SCRIPT_BYTES, length - p));
    while (p < length) {
      char c = (char)payload[p++];
      if (c == '"') return true;
      if (c == '\\') {
        if (p >= length) return false;
        char e = (char)payload[p++];
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
      if (out.length() > P1_EMBED_MAX_SCRIPT_BYTES) return false;
    }
    return false;
  }
  return false;
}

static bool wsJsonGetBool(const uint8_t* payload, size_t length, const char* key, bool& out) {
  String needle = String("\"") + key + "\"";
  size_t keyLen = needle.length();
  for (size_t i = 0; i + keyLen < length; i++) {
    if (memcmp(payload + i, needle.c_str(), keyLen) != 0) continue;
    size_t p = i + keyLen;
    while (p < length && isspace((char)payload[p])) p++;
    if (p >= length || payload[p] != ':') continue;
    p++;
    while (p < length && isspace((char)payload[p])) p++;
    if (p + 4 <= length && memcmp(payload + p, "true", 4) == 0) {
      out = true;
      return true;
    }
    if (p + 5 <= length && memcmp(payload + p, "false", 5) == 0) {
      out = false;
      return true;
    }
    return false;
  }
  return false;
}

static bool wsJsonGetInt(const uint8_t* payload, size_t length, const char* key, int& out) {
  String needle = String("\"") + key + "\"";
  size_t keyLen = needle.length();
  for (size_t i = 0; i + keyLen < length; i++) {
    if (memcmp(payload + i, needle.c_str(), keyLen) != 0) continue;
    size_t p = i + keyLen;
    while (p < length && isspace((char)payload[p])) p++;
    if (p >= length || payload[p] != ':') continue;
    p++;
    while (p < length && isspace((char)payload[p])) p++;
    bool negative = false;
    if (p < length && payload[p] == '-') {
      negative = true;
      p++;
    }
    if (p >= length || !isdigit((char)payload[p])) return false;
    long value = 0;
    while (p < length && isdigit((char)payload[p])) {
      value = (value * 10) + (payload[p] - '0');
      if (value > 2147483647L) return false;
      p++;
    }
    out = negative ? -(int)value : (int)value;
    return true;
  }
  return false;
}

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

  String msgType;
  String id;
  String name;
  wsJsonGetString(payload, length, "type", msgType);
  wsJsonGetString(payload, length, "id", id);
  wsJsonGetString(payload, length, "name", name);
  if (msgType == "cmd" && name == "script.set") {
    if (g_wsScriptSetPending) {
      protocolSendResponseError(id.length() ? id : "0", "busy", "Another websocket script.set is already pending");
      return;
    }
    String code;
    String expectedHashHex;
    int expectedBytes = -1;
    bool runAfterSet = false;
    bool saveAfterSet = false;
    wsJsonGetBool(payload, length, "run", runAfterSet);
    wsJsonGetBool(payload, length, "save", saveAfterSet);
    wsJsonGetString(payload, length, "codeHash", expectedHashHex);
    wsJsonGetInt(payload, length, "codeBytes", expectedBytes);
    if (!wsJsonGetString(payload, length, "code", code)) {
      protocolSendResponseError(id.length() ? id : "0", "missing_code", "script.set requires data.code");
      return;
    }
    if (!protocolValidateScriptIntegrity(id.length() ? id : "0", code, expectedBytes, expectedHashHex)) {
      return;
    }
    if (!scriptStoreSaveIncoming(code)) {
      protocolSendResponseError(id.length() ? id : "0", "storage_error", "Failed to stage incoming script");
      return;
    }
    scriptStoreSaveIncomingRunOptions(runAfterSet, saveAfterSet);
    code = "";
    g_wsScriptSetPendingId = id.length() ? id : "0";
    g_wsScriptSetPendingRun = runAfterSet;
    g_wsScriptSetPendingSave = saveAfterSet;
    g_wsScriptSetPending = true;
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
  if (g_wsScriptSetPending) {
    String id = g_wsScriptSetPendingId;
    bool runAfterSet = g_wsScriptSetPendingRun;
    bool saveAfterSet = g_wsScriptSetPendingSave;
    g_wsScriptSetPending = false;
    g_wsScriptSetPendingId = "";
    g_wsScriptSetPendingRun = false;
    g_wsScriptSetPendingSave = false;

    String code;
    if (!scriptStoreLoadIncoming(code) || code.length() == 0) {
      scriptStoreClearIncoming();
      protocolSendResponseError(id, "storage_error", "Failed to load staged incoming script");
    } else {
      if (protocolHandleScriptSetCode(id, code, runAfterSet, saveAfterSet)) {
        scriptStoreClearIncoming();
      }
    }
  }
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
