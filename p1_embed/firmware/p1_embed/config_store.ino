#include <Arduino.h>
#include <ESP.h>
#include <LittleFS.h>
#include <Preferences.h>
#include "p1_embed_firmware.h"

static const char* CONFIG_PATH = "/config.json";
static String g_deviceId = "";
static String g_deviceName = "";
static String g_wifiSsids[P1_EMBED_MAX_WIFI_NETWORKS];
static String g_wifiPasswords[P1_EMBED_MAX_WIFI_NETWORKS];
static int g_wifiNetworkCount = 0;
static bool g_configFsReady = false;

static bool configEnsureFs() {
  if (g_configFsReady) return true;
  if (!LittleFS.begin(false)) {
    if (!LittleFS.begin(true)) return false;
  }
  g_configFsReady = true;
  return true;
}

static String configBuildDeviceId() {
  uint64_t mac = ESP.getEfuseMac();
  char buf[24];
  snprintf(buf, sizeof(buf), "p1-%04X%08X", (uint16_t)(mac >> 32), (uint32_t)mac);
  return String(buf);
}

static String configBuildDefaultDeviceName() {
  uint64_t mac = ESP.getEfuseMac();
  char buf[24];
  snprintf(buf, sizeof(buf), "p1-embed-%06X", (uint32_t)(mac & 0xFFFFFF));
  return String(buf);
}

static void configApplyIdentityDefaults() {
  if (!g_deviceId.length()) g_deviceId = configBuildDeviceId();
  if (!g_deviceName.length() || g_deviceName == "p1-embed") g_deviceName = configBuildDefaultDeviceName();
}

static bool configJsonGetString(const String& json, const char* key, String& out) {
  out = "";
  String needle = String("\"") + key + "\"";
  int keyPos = json.indexOf(needle);
  if (keyPos < 0) return false;
  int colon = json.indexOf(':', keyPos + needle.length());
  if (colon < 0) return false;
  int quote = json.indexOf('"', colon + 1);
  if (quote < 0) return false;

  bool escaped = false;
  for (int i = quote + 1; i < json.length(); i++) {
    char c = json[i];
    if (escaped) {
      switch (c) {
        case 'n': out += '\n'; break;
        case 'r': out += '\r'; break;
        case 't': out += '\t'; break;
        case '"': out += '"'; break;
        case '\\': out += '\\'; break;
        default: out += c; break;
      }
      escaped = false;
      continue;
    }
    if (c == '\\') {
      escaped = true;
      continue;
    }
    if (c == '"') return true;
    out += c;
  }
  return false;
}

static int configFindWifiSsid(const String& ssid) {
  for (int i = 0; i < g_wifiNetworkCount; i++) {
    if (g_wifiSsids[i] == ssid) return i;
  }
  return -1;
}

static void configAddWifiNetwork(const String& ssid, const String& password) {
  if (!ssid.length()) return;

  int existing = configFindWifiSsid(ssid);
  if (existing >= 0) {
    for (int i = existing; i > 0; i--) {
      g_wifiSsids[i] = g_wifiSsids[i - 1];
      g_wifiPasswords[i] = g_wifiPasswords[i - 1];
    }
  } else if (g_wifiNetworkCount < P1_EMBED_MAX_WIFI_NETWORKS) {
    for (int i = g_wifiNetworkCount; i > 0; i--) {
      g_wifiSsids[i] = g_wifiSsids[i - 1];
      g_wifiPasswords[i] = g_wifiPasswords[i - 1];
    }
    g_wifiNetworkCount++;
  } else {
    for (int i = P1_EMBED_MAX_WIFI_NETWORKS - 1; i > 0; i--) {
      g_wifiSsids[i] = g_wifiSsids[i - 1];
      g_wifiPasswords[i] = g_wifiPasswords[i - 1];
    }
  }

  g_wifiSsids[0] = ssid;
  g_wifiPasswords[0] = password;
}

static void configLoadWifiNetworks(const String& json) {
  g_wifiNetworkCount = 0;

  int arrayPos = json.indexOf("\"wifiNetworks\"");
  if (arrayPos < 0) {
    String ssid;
    String password;
    if (configJsonGetString(json, "wifiSsid", ssid)) {
      configJsonGetString(json, "wifiPassword", password);
      configAddWifiNetwork(ssid, password);
    }
    return;
  }

  int pos = json.indexOf('{', arrayPos);
  while (pos >= 0 && g_wifiNetworkCount < P1_EMBED_MAX_WIFI_NETWORKS) {
    int end = json.indexOf('}', pos);
    if (end < 0) break;

    String entry = json.substring(pos, end + 1);
    String ssid;
    String password;
    if (configJsonGetString(entry, "ssid", ssid)) {
      configJsonGetString(entry, "password", password);
      g_wifiSsids[g_wifiNetworkCount] = ssid;
      g_wifiPasswords[g_wifiNetworkCount] = password;
      g_wifiNetworkCount++;
    }

    pos = json.indexOf('{', end + 1);
    int arrayEnd = json.indexOf(']', arrayPos);
    if (arrayEnd >= 0 && pos > arrayEnd) break;
  }
}

static bool configReadFile(String& out) {
  out = "";
  if (!configEnsureFs()) return false;
  File f = LittleFS.open(CONFIG_PATH, "r");
  if (!f) return false;
  size_t n = (size_t)f.size();
  if (n > 4096) {
    f.close();
    return false;
  }
  out.reserve(n + 1);
  while (f.available()) out += (char)f.read();
  f.close();
  return true;
}

static void configLoadLegacyPrefsIfPresent() {
  Preferences prefs;
  if (!prefs.begin("p1embed", true)) return;
  g_deviceName = prefs.getString("deviceName", g_deviceName);
  configAddWifiNetwork(prefs.getString("wifiSsid", ""), prefs.getString("wifiPass", ""));
  prefs.end();
}

void configLoad() {
  configApplyIdentityDefaults();

  String json;
  if (configReadFile(json)) {
    String value;
    bool changed = false;
    if (configJsonGetString(json, "deviceId", value)) g_deviceId = value;
    else changed = true;
    if (configJsonGetString(json, "deviceName", value)) g_deviceName = value.length() ? value : configBuildDefaultDeviceName();
    else changed = true;
    configApplyIdentityDefaults();
    configLoadWifiNetworks(json);
    if (changed) configSave();
    return;
  }

  configLoadLegacyPrefsIfPresent();
  configApplyIdentityDefaults();
  configSave();
}

void configSave() {
  if (!configEnsureFs()) return;

  String json = "{";
  json += "\"deviceId\":" + jsonString(g_deviceId);
  json += ",\"deviceName\":" + jsonString(g_deviceName);
  json += ",\"wifiSsid\":" + jsonString(configWifiSsid());
  json += ",\"wifiPassword\":" + jsonString(configWifiPassword());
  json += ",\"wifiNetworks\":[";
  for (int i = 0; i < g_wifiNetworkCount; i++) {
    if (i) json += ",";
    json += "{\"ssid\":" + jsonString(g_wifiSsids[i]);
    json += ",\"password\":" + jsonString(g_wifiPasswords[i]) + "}";
  }
  json += "]";
  json += "}\n";

  if (LittleFS.exists(CONFIG_PATH)) LittleFS.remove(CONFIG_PATH);
  File f = LittleFS.open(CONFIG_PATH, "w");
  if (!f) return;
  f.print(json);
  f.flush();
  f.close();
}

void configFactoryReset() {
  if (configEnsureFs() && LittleFS.exists(CONFIG_PATH)) LittleFS.remove(CONFIG_PATH);

  Preferences prefs;
  if (prefs.begin("p1embed", false)) {
    prefs.clear();
    prefs.end();
  }

  g_deviceId = configBuildDeviceId();
  g_deviceName = configBuildDefaultDeviceName();
  for (int i = 0; i < P1_EMBED_MAX_WIFI_NETWORKS; i++) {
    g_wifiSsids[i] = "";
    g_wifiPasswords[i] = "";
  }
  g_wifiNetworkCount = 0;
  configSave();
}

String configDeviceId() {
  return g_deviceId.length() ? g_deviceId : configBuildDeviceId();
}

String configDeviceName() {
  return g_deviceName.length() ? g_deviceName : configBuildDefaultDeviceName();
}

void configSetDeviceName(const String& value) {
  g_deviceName = value.length() ? value : configBuildDefaultDeviceName();
}

void configSetWifiSsid(const String& value) {
  if (!value.length()) return;
  String password = g_wifiNetworkCount > 0 ? g_wifiPasswords[0] : "";
  configAddWifiNetwork(value, password);
}

void configSetWifiPassword(const String& value) {
  if (g_wifiNetworkCount > 0) g_wifiPasswords[0] = value;
}

String configWifiSsid() {
  return configWifiSsidAt(0);
}

String configWifiPassword() {
  return configWifiPasswordAt(0);
}

int configWifiNetworkCount() {
  return g_wifiNetworkCount;
}

String configWifiSsidAt(int index) {
  if (index < 0 || index >= g_wifiNetworkCount) return "";
  return g_wifiSsids[index];
}

String configWifiPasswordAt(int index) {
  if (index < 0 || index >= g_wifiNetworkCount) return "";
  return g_wifiPasswords[index];
}

P1ConfigSnapshot configSnapshot() {
  P1ConfigSnapshot snapshot;
  snapshot.deviceId = configDeviceId();
  snapshot.deviceName = configDeviceName();
  snapshot.wifiSsid = configWifiSsid();
  snapshot.wifiPasswordSet = configWifiPassword().length() > 0;
  snapshot.wifiNetworkCount = g_wifiNetworkCount;
  snapshot.wifi = wifiSnapshot();
  return snapshot;
}

String configAsJson(const P1ConfigSnapshot& snapshot) {
  String out = "{";
  out += "\"deviceId\":" + jsonString(snapshot.deviceId);
  out += ",\"deviceName\":" + jsonString(snapshot.deviceName);
  out += ",\"wifiSsid\":" + jsonString(snapshot.wifiSsid);
  out += ",\"wifiPasswordSet\":" + String(snapshot.wifiPasswordSet ? "true" : "false");
  out += ",\"wifiNetworkCount\":" + String(snapshot.wifiNetworkCount);
  out += ",\"wifiNetworks\":[";
  for (int i = 0; i < g_wifiNetworkCount; i++) {
    if (i) out += ",";
    out += "{\"ssid\":" + jsonString(g_wifiSsids[i]);
    out += ",\"passwordSet\":" + String(g_wifiPasswords[i].length() ? "true" : "false") + "}";
  }
  out += "]";
  out += ",\"storage\":\"littlefs:/config.json\"";
  out += ",\"wifi\":" + wifiStatusJson(snapshot.wifi);
  out += "}";
  return out;
}

String configAsJson() {
  return configAsJson(configSnapshot());
}
