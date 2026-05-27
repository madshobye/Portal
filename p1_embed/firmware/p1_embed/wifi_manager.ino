#include <Arduino.h>
#include <WiFi.h>
#include "p1_embed_firmware.h"

static int g_lastWifiStatus = WL_IDLE_STATUS;
static unsigned long g_lastWifiAttemptMs = 0;
static bool g_wifiConfigured = false;
static int g_wifiNetworkIndex = 0;

static const char* wifiStatusName(int status) {
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

static void wifiEmitStatusIfChanged() {
  int status = WiFi.status();
  if (status == g_lastWifiStatus) return;
  g_lastWifiStatus = status;
  memoryProfileMark("wifi", wifiStatusName(status));
  String ip = WiFi.localIP().toString();
  P1EventField fields[] = {
    p1FieldString("status", wifiStatusName(status)),
    p1FieldString("ip", ip),
  };
  protocolEmitEventFields("wifi.status", fields, 2);
}

static void wifiTryNetwork(int index, const char* statusLabel) {
  String ssid = configWifiSsidAt(index);
  if (!ssid.length()) return;

  g_wifiNetworkIndex = index;
  memoryProfileMark("wifi", "disconnect_before_begin");
  WiFi.disconnect(false, false);
  memoryProfileMark("wifi", "after_disconnect");
  WiFi.begin(ssid.c_str(), configWifiPasswordAt(index).c_str());
  g_lastWifiAttemptMs = millis();
  memoryProfileMark("wifi", statusLabel);
  P1EventField fields[] = {
    p1FieldString("status", statusLabel),
    p1FieldString("ssid", ssid),
    p1FieldInt("networkIndex", index),
  };
  protocolEmitEventFields("wifi.status", fields, 3);
}

void wifiBegin() {
  memoryProfileMark("wifi", "begin_entry");
  g_wifiConfigured = configWifiNetworkCount() > 0;
  g_lastWifiStatus = WiFi.status();
  g_wifiNetworkIndex = 0;

  if (!g_wifiConfigured) {
    WiFi.mode(WIFI_OFF);
    memoryProfileMark("wifi", "off");
    return;
  }

  WiFi.mode(WIFI_STA);
  memoryProfileMark("wifi", "sta_mode");
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);
  wifiTryNetwork(0, "connecting");
}

void wifiLoop() {
  if (!g_wifiConfigured) return;
  wifiEmitStatusIfChanged();

  int status = WiFi.status();
  if (status == WL_CONNECTED) return;
  if (millis() - g_lastWifiAttemptMs < 15000) return;

  int count = configWifiNetworkCount();
  if (count <= 0) return;
  int nextIndex = (g_wifiNetworkIndex + 1) % count;
  wifiTryNetwork(nextIndex, nextIndex == 0 ? "reconnecting" : "fallback_connecting");
}

void wifiReconnect() {
  memoryProfileMark("wifi", "reconnect");
  WiFi.disconnect(false, false);
  g_wifiConfigured = false;
  wifiBegin();
}

void wifiDisconnect() {
  memoryProfileMark("wifi", "disconnect");
  WiFi.disconnect(true, false);
  WiFi.mode(WIFI_OFF);
  g_wifiConfigured = false;
  g_lastWifiStatus = WL_DISCONNECTED;
  P1EventField fields[] = {
    p1FieldString("status", "off"),
  };
  protocolEmitEventFields("wifi.status", fields, 1);
}

String wifiStatusJson() {
  int status = WiFi.status();
  String out = "{";
  out += "\"configured\":" + String(configWifiSsid().length() ? "true" : "false");
  out += ",\"status\":" + jsonString(wifiStatusName(status));
  out += ",\"connected\":" + String(status == WL_CONNECTED ? "true" : "false");
  out += ",\"networkIndex\":" + String(g_wifiNetworkIndex);
  out += ",\"networkCount\":" + String(configWifiNetworkCount());
  out += ",\"ssid\":" + jsonString(status == WL_CONNECTED ? configWifiSsidAt(g_wifiNetworkIndex) : String(""));
  out += ",\"ip\":" + jsonString(status == WL_CONNECTED ? WiFi.localIP().toString() : String(""));
  out += ",\"rssi\":" + String(status == WL_CONNECTED ? WiFi.RSSI() : 0);
  out += ",\"mac\":" + jsonString(WiFi.macAddress());
  out += "}";
  return out;
}

bool wifiIsConnected() {
  return WiFi.status() == WL_CONNECTED && WiFi.localIP() != IPAddress(0, 0, 0, 0);
}
