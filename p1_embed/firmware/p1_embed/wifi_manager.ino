#include <Arduino.h>
#include <WiFi.h>
#include <time.h>
#include "p1_embed_firmware.h"

static int g_lastWifiStatus = WL_IDLE_STATUS;
static unsigned long g_lastWifiAttemptMs = 0;
static bool g_wifiConfigured = false;
static int g_wifiNetworkIndex = 0;
static bool g_timeSyncStarted = false;
static unsigned long g_lastWifiRssiMs = 0;
static int g_lastWifiRssi = 0;
static char g_wifiActiveSsid[40] = "";
static char g_wifiMacText[24] = "";
static portMUX_TYPE g_wifiCacheMux = portMUX_INITIALIZER_UNLOCKED;

struct WifiCachedState {
  bool configured = false;
  bool connected = false;
  int networkIndex = 0;
  int networkCount = 0;
  int rssi = 0;
  char status[20] = "unknown";
  char ssid[40] = "";
  char ip[24] = "";
  char mac[24] = "";
};

static WifiCachedState g_wifiCached;

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
  if (status == WL_CONNECTED && !g_timeSyncStarted) {
    configApplyTimezone();
    configTime(0, 0, "pool.ntp.org", "time.nist.gov", "time.google.com");
    g_timeSyncStarted = true;
  }
}

static void wifiUpdateCache() {
  int status = WiFi.status();
  bool connected = status == WL_CONNECTED;
  int networkCount = configWifiNetworkCount();
  int rssi = 0;
  char ip[24] = "";
  if (connected) {
    IPAddress ipAddress = WiFi.localIP();
    snprintf(ip, sizeof(ip), "%u.%u.%u.%u", ipAddress[0], ipAddress[1], ipAddress[2], ipAddress[3]);
  }
  if (g_wifiMacText[0] == '\0') {
    uint8_t mac[6] = {0, 0, 0, 0, 0, 0};
    WiFi.macAddress(mac);
    snprintf(
      g_wifiMacText,
      sizeof(g_wifiMacText),
      "%02X:%02X:%02X:%02X:%02X:%02X",
      mac[0],
      mac[1],
      mac[2],
      mac[3],
      mac[4],
      mac[5]);
  }
  const char* statusText = wifiStatusName(status);
  unsigned long now = millis();

  if (connected) {
    if (g_lastWifiRssiMs == 0 || now - g_lastWifiRssiMs >= P1_EMBED_WIFI_RSSI_INTERVAL_MS) {
      g_lastWifiRssi = WiFi.RSSI();
      g_lastWifiRssiMs = now;
    }
    rssi = g_lastWifiRssi;
  } else {
    g_lastWifiRssi = 0;
    g_lastWifiRssiMs = 0;
  }

  portENTER_CRITICAL(&g_wifiCacheMux);
  g_wifiCached.configured = networkCount > 0;
  g_wifiCached.connected = connected;
  g_wifiCached.networkIndex = g_wifiNetworkIndex;
  g_wifiCached.networkCount = networkCount;
  g_wifiCached.rssi = rssi;
  strlcpy(g_wifiCached.status, statusText, sizeof(g_wifiCached.status));
  strlcpy(g_wifiCached.ssid, connected ? g_wifiActiveSsid : "", sizeof(g_wifiCached.ssid));
  strlcpy(g_wifiCached.ip, ip, sizeof(g_wifiCached.ip));
  strlcpy(g_wifiCached.mac, g_wifiMacText, sizeof(g_wifiCached.mac));
  portEXIT_CRITICAL(&g_wifiCacheMux);
}

static void wifiTryNetwork(int index, const char* statusLabel) {
  String ssid = configWifiSsidAt(index);
  if (!ssid.length()) return;

  g_wifiNetworkIndex = index;
  strlcpy(g_wifiActiveSsid, ssid.c_str(), sizeof(g_wifiActiveSsid));
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
  g_timeSyncStarted = false;

  if (!g_wifiConfigured) {
    WiFi.mode(WIFI_OFF);
    memoryProfileMark("wifi", "off");
    wifiUpdateCache();
    return;
  }

  WiFi.mode(WIFI_STA);
  memoryProfileMark("wifi", "sta_mode");
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);
  wifiTryNetwork(0, "connecting");
  wifiUpdateCache();
}

void wifiLoop() {
  wifiUpdateCache();
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
  g_timeSyncStarted = false;
  g_lastWifiStatus = WL_DISCONNECTED;
  wifiUpdateCache();
  P1EventField fields[] = {
    p1FieldString("status", "off"),
  };
  protocolEmitEventFields("wifi.status", fields, 1);
}

P1WifiSnapshot wifiSnapshot() {
  wifiUpdateCache();
  return wifiCachedSnapshot();
}

P1WifiSnapshot wifiCachedSnapshot() {
  WifiCachedState cached;
  portENTER_CRITICAL(&g_wifiCacheMux);
  cached = g_wifiCached;
  portEXIT_CRITICAL(&g_wifiCacheMux);

  P1WifiSnapshot snapshot;
  snapshot.configured = cached.configured;
  snapshot.status = cached.status;
  snapshot.connected = cached.connected;
  snapshot.networkIndex = cached.networkIndex;
  snapshot.networkCount = cached.networkCount;
  snapshot.ssid = cached.ssid;
  snapshot.ip = cached.ip;
  snapshot.rssi = cached.rssi;
  snapshot.mac = cached.mac;
  return snapshot;
}

String wifiStatusJson(const P1WifiSnapshot& snapshot) {
  String out = "{";
  out += "\"configured\":" + String(snapshot.configured ? "true" : "false");
  out += ",\"status\":" + jsonString(snapshot.status);
  out += ",\"connected\":" + String(snapshot.connected ? "true" : "false");
  out += ",\"networkIndex\":" + String(snapshot.networkIndex);
  out += ",\"networkCount\":" + String(snapshot.networkCount);
  out += ",\"ssid\":" + jsonString(snapshot.ssid);
  out += ",\"ip\":" + jsonString(snapshot.ip);
  out += ",\"rssi\":" + String(snapshot.rssi);
  out += ",\"mac\":" + jsonString(snapshot.mac);
  out += "}";
  return out;
}

String wifiStatusJson() {
  return wifiStatusJson(wifiSnapshot());
}

bool wifiIsConnected() {
  return WiFi.status() == WL_CONNECTED && WiFi.localIP() != IPAddress(0, 0, 0, 0);
}
