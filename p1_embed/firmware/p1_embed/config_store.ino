#include <Arduino.h>
#include <ESP.h>
#include <esp_system.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <time.h>
#include "p1_embed_firmware.h"

static const char* CONFIG_PATH = "/config.json";
static const size_t P1_CONFIG_DEVICE_ID_MAX = 32;
static const size_t P1_CONFIG_DEVICE_NAME_MAX = 48;
static const size_t P1_CONFIG_PROJECT_ID_MAX = 64;
static const size_t P1_CONFIG_PROJECT_NAME_MAX = 64;
static const size_t P1_CONFIG_REVISION_ID_MAX = 80;
static const size_t P1_CONFIG_SCRIPT_NAME_MAX = 80;
static const size_t P1_CONFIG_TIMEZONE_MAX = 64;
static const size_t P1_CONFIG_WIFI_SSID_MAX = 33;
static const size_t P1_CONFIG_WIFI_PASSWORD_MAX = 65;
static const size_t P1_CONFIG_MQTT_HOST_MAX = 96;
static const size_t P1_CONFIG_MQTT_ROOT_MAX = 64;
static const size_t P1_CONFIG_MQTT_USER_MAX = 33;
static const size_t P1_CONFIG_MQTT_PASSWORD_MAX = 129;
static const size_t P1_CONFIG_MQTT_GUEST_KEY_MAX = 41;
static const size_t P1_CONFIG_AUTH_USERNAME_MAX = 33;

struct P1StoredWifiNetwork {
  char ssid[P1_CONFIG_WIFI_SSID_MAX] = {0};
  char password[P1_CONFIG_WIFI_PASSWORD_MAX] = {0};
};

struct P1StoredOnlineAuthUser {
  char username[P1_CONFIG_AUTH_USERNAME_MAX] = {0};
  uint8_t key[32] = {0};
};

static char g_deviceId[P1_CONFIG_DEVICE_ID_MAX] = "";
static char g_deviceName[P1_CONFIG_DEVICE_NAME_MAX] = "";
static char g_projectId[P1_CONFIG_PROJECT_ID_MAX] = "";
static char g_projectName[P1_CONFIG_PROJECT_NAME_MAX] = "";
static char g_revisionId[P1_CONFIG_REVISION_ID_MAX] = "";
static char g_scriptName[P1_CONFIG_SCRIPT_NAME_MAX] = "";
static char g_timezone[P1_CONFIG_TIMEZONE_MAX] = "UTC0";
static P1StoredWifiNetwork g_wifiNetworks[P1_EMBED_MAX_WIFI_NETWORKS];
static int g_wifiNetworkCount = 0;
static char g_mqttHost[P1_CONFIG_MQTT_HOST_MAX] = "";
static int g_mqttPort = P1_EMBED_MQTT_PORT;
static char g_mqttRoot[P1_CONFIG_MQTT_ROOT_MAX] = "";
static char g_mqttUser[P1_CONFIG_MQTT_USER_MAX] = "";
static char g_mqttPassword[P1_CONFIG_MQTT_PASSWORD_MAX] = "";
static bool g_mqttEnabled = true;
static bool g_mqttAllowAnonymousUi = false;
static bool g_mqttAllowAnonymousScript = false;
static char g_mqttGuestUiKey[P1_CONFIG_MQTT_GUEST_KEY_MAX] = "";
static P1StoredOnlineAuthUser g_onlineAuthUsers[P1_EMBED_MQTT_MAX_USERS];
static int g_onlineAuthUserCount = 0;
static bool g_configFsReady = false;

static const char* const P1_TIMEZONE_VALUES[] = {
  "UTC0",
  "GMT0BST,M3.5.0/1,M10.5.0",
  "CET-1CEST,M3.5.0/02,M10.5.0/03",
  "EET-2EEST,M3.5.0/03,M10.5.0/04",
  "MSK-3",
  "GST-4",
  "PKT-5",
  "IST-5:30",
  "NPT-5:45",
  "BST-6",
  "ICT-7",
  "CST-8",
  "JST-9",
  "AEST-10AEDT,M10.1.0/02,M4.1.0/03",
  "NZST-12NZDT,M9.5.0/02,M4.1.0/03",
  "NST11",
  "HST10",
  "AKST9AKDT,M3.2.0/02,M11.1.0/02",
  "PST8PDT,M3.2.0/02,M11.1.0/02",
  "MST7MDT,M3.2.0/02,M11.1.0/02",
  "MST7",
  "CST6CDT,M3.2.0/02,M11.1.0/02",
  "EST5EDT,M3.2.0/02,M11.1.0/02",
  "AST4ADT,M3.2.0/02,M11.1.0/02",
  "AST4",
  "NST3:30NDT,M3.2.0/00:01,M11.1.0/00:01",
  "ART3",
  "BRT3",
  "SAST-2",
};

static void configSetText(char* dst, size_t dstLen, const String& value, bool trimValue = true) {
  if (!dst || dstLen == 0) return;
  String next = value;
  if (trimValue) next.trim();
  size_t n = next.length();
  if (n >= dstLen) n = dstLen - 1;
  memcpy(dst, next.c_str(), n);
  dst[n] = 0;
}

static void configClearText(char* dst, size_t dstLen) {
  if (!dst || dstLen == 0) return;
  dst[0] = 0;
}

static bool configTextHasValue(const char* value) {
  return value && value[0];
}

static String configText(const char* value) {
  return String(value ? value : "");
}

static void configClearWifiNetworkAt(int index) {
  if (index < 0 || index >= P1_EMBED_MAX_WIFI_NETWORKS) return;
  g_wifiNetworks[index].ssid[0] = 0;
  g_wifiNetworks[index].password[0] = 0;
}

static void configCopyWifiNetworkSlot(int dst, int src) {
  if (dst < 0 || dst >= P1_EMBED_MAX_WIFI_NETWORKS || src < 0 || src >= P1_EMBED_MAX_WIFI_NETWORKS) return;
  memcpy(&g_wifiNetworks[dst], &g_wifiNetworks[src], sizeof(P1StoredWifiNetwork));
}

static void configClearOnlineAuthUserAt(int index) {
  if (index < 0 || index >= P1_EMBED_MQTT_MAX_USERS) return;
  g_onlineAuthUsers[index].username[0] = 0;
  memset(g_onlineAuthUsers[index].key, 0, sizeof(g_onlineAuthUsers[index].key));
}

static void configCopyOnlineAuthUserSlot(int dst, int src) {
  if (dst < 0 || dst >= P1_EMBED_MQTT_MAX_USERS || src < 0 || src >= P1_EMBED_MQTT_MAX_USERS) return;
  memcpy(&g_onlineAuthUsers[dst], &g_onlineAuthUsers[src], sizeof(P1StoredOnlineAuthUser));
}

static String configNormalizeTimezone(const String& value) {
  String next = value;
  next.trim();
  for (size_t i = 0; i < sizeof(P1_TIMEZONE_VALUES) / sizeof(P1_TIMEZONE_VALUES[0]); i++) {
    if (next == P1_TIMEZONE_VALUES[i]) return next;
  }
  return "UTC0";
}

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

static String configBuildDefaultMqttRoot() {
  String id = configDeviceId();
  String root = id.length() >= 6 ? String("p1-embed-") + id.substring(id.length() - 6) : configBuildDefaultDeviceName();
  root.toLowerCase();
  root.replace(" ", "-");
  return root;
}

static String configNormalizeGuestKey(const String& value) {
  String key = value;
  key.trim();
  key.toLowerCase();
  String out;
  out.reserve(40);
  for (size_t i = 0; i < key.length() && out.length() < 40; i++) {
    char c = key[i];
    if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) out += c;
  }
  return out;
}

static String configGenerateGuestKey() {
  uint8_t bytes[16];
  for (size_t i = 0; i < sizeof(bytes); i += 4) {
    uint32_t value = esp_random();
    bytes[i] = value & 0xff;
    if (i + 1 < sizeof(bytes)) bytes[i + 1] = (value >> 8) & 0xff;
    if (i + 2 < sizeof(bytes)) bytes[i + 2] = (value >> 16) & 0xff;
    if (i + 3 < sizeof(bytes)) bytes[i + 3] = (value >> 24) & 0xff;
  }
  static const char* hex = "0123456789abcdef";
  String out;
  out.reserve(32);
  for (uint8_t byte : bytes) {
    out += hex[(byte >> 4) & 0x0f];
    out += hex[byte & 0x0f];
  }
  return out;
}

static void configApplyIdentityDefaults() {
  if (!configTextHasValue(g_deviceId)) configSetText(g_deviceId, sizeof(g_deviceId), configBuildDeviceId());
  if (!configTextHasValue(g_deviceName) || strcmp(g_deviceName, "p1-embed") == 0) {
    configSetText(g_deviceName, sizeof(g_deviceName), configBuildDefaultDeviceName());
  }
}

void configApplyTimezone() {
  String tz = configTimezone();
  setenv("TZ", tz.c_str(), 1);
  tzset();
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

static bool configJsonGetInt(const String& json, const char* key, int& out) {
  String needle = String("\"") + key + "\"";
  int keyPos = json.indexOf(needle);
  if (keyPos < 0) return false;
  int colon = json.indexOf(':', keyPos + needle.length());
  if (colon < 0) return false;
  int pos = colon + 1;
  while (pos < json.length() && isspace((unsigned char)json[pos])) pos++;
  bool neg = false;
  if (pos < json.length() && json[pos] == '-') {
    neg = true;
    pos++;
  }
  if (pos >= json.length() || !isdigit((unsigned char)json[pos])) return false;
  long value = 0;
  while (pos < json.length() && isdigit((unsigned char)json[pos])) {
    value = value * 10 + (json[pos] - '0');
    pos++;
  }
  out = neg ? -value : value;
  return true;
}

static bool configJsonGetBool(const String& json, const char* key, bool& out) {
  String needle = String("\"") + key + "\"";
  int keyPos = json.indexOf(needle);
  if (keyPos < 0) return false;
  int colon = json.indexOf(':', keyPos + needle.length());
  if (colon < 0) return false;
  int pos = colon + 1;
  while (pos < json.length() && isspace((unsigned char)json[pos])) pos++;
  if (json.startsWith("true", pos)) {
    out = true;
    return true;
  }
  if (json.startsWith("false", pos)) {
    out = false;
    return true;
  }
  return false;
}

static bool configHexToBytes(const String& hex, uint8_t* out, size_t outLen) {
  if (!out || hex.length() != outLen * 2) return false;
  for (size_t i = 0; i < outLen; i++) {
    char hi = hex[i * 2];
    char lo = hex[i * 2 + 1];
    int hv = (hi >= '0' && hi <= '9') ? hi - '0' : (hi >= 'a' && hi <= 'f') ? hi - 'a' + 10 : (hi >= 'A' && hi <= 'F') ? hi - 'A' + 10 : -1;
    int lv = (lo >= '0' && lo <= '9') ? lo - '0' : (lo >= 'a' && lo <= 'f') ? lo - 'a' + 10 : (lo >= 'A' && lo <= 'F') ? lo - 'A' + 10 : -1;
    if (hv < 0 || lv < 0) return false;
    out[i] = uint8_t((hv << 4) | lv);
  }
  return true;
}

static void configAppendHex(String& out, const uint8_t* bytes, size_t len) {
  static const char* hex = "0123456789abcdef";
  if (!bytes) return;
  out.reserve(out.length() + len * 2);
  for (size_t i = 0; i < len; i++) {
    out += hex[(bytes[i] >> 4) & 0x0f];
    out += hex[bytes[i] & 0x0f];
  }
}

static int configFindOnlineAuthUser(const String& username) {
  for (int i = 0; i < g_onlineAuthUserCount; i++) {
    if (strcmp(g_onlineAuthUsers[i].username, username.c_str()) == 0) return i;
  }
  return -1;
}

static int configFindOnlineAuthUser(const char* username) {
  if (!username || !username[0]) return -1;
  for (int i = 0; i < g_onlineAuthUserCount; i++) {
    if (strcmp(g_onlineAuthUsers[i].username, username) == 0) return i;
  }
  return -1;
}

static int configFindWifiSsid(const String& ssid) {
  for (int i = 0; i < g_wifiNetworkCount; i++) {
    if (strcmp(g_wifiNetworks[i].ssid, ssid.c_str()) == 0) return i;
  }
  return -1;
}

static void configAddWifiNetwork(const String& ssid, const String& password) {
  if (!ssid.length()) return;

  int existing = configFindWifiSsid(ssid);
  if (existing >= 0) {
    for (int i = existing; i > 0; i--) {
      configCopyWifiNetworkSlot(i, i - 1);
    }
  } else if (g_wifiNetworkCount < P1_EMBED_MAX_WIFI_NETWORKS) {
    for (int i = g_wifiNetworkCount; i > 0; i--) {
      configCopyWifiNetworkSlot(i, i - 1);
    }
    g_wifiNetworkCount++;
  } else {
    for (int i = P1_EMBED_MAX_WIFI_NETWORKS - 1; i > 0; i--) {
      configCopyWifiNetworkSlot(i, i - 1);
    }
  }

  configSetText(g_wifiNetworks[0].ssid, sizeof(g_wifiNetworks[0].ssid), ssid);
  configSetText(g_wifiNetworks[0].password, sizeof(g_wifiNetworks[0].password), password, false);
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
      configSetText(g_wifiNetworks[g_wifiNetworkCount].ssid, sizeof(g_wifiNetworks[g_wifiNetworkCount].ssid), ssid);
      configSetText(g_wifiNetworks[g_wifiNetworkCount].password, sizeof(g_wifiNetworks[g_wifiNetworkCount].password), password, false);
      g_wifiNetworkCount++;
    }

    pos = json.indexOf('{', end + 1);
    int arrayEnd = json.indexOf(']', arrayPos);
    if (arrayEnd >= 0 && pos > arrayEnd) break;
  }
}

static void configLoadOnlineAuthUsers(const String& json) {
  g_onlineAuthUserCount = 0;
  int arrayPos = json.indexOf("\"onlineAuthUsers\"");
  if (arrayPos < 0) arrayPos = json.indexOf("\"mqttAuthUsers\"");
  if (arrayPos < 0) return;

  int arrayEnd = json.indexOf(']', arrayPos);
  int pos = json.indexOf('{', arrayPos);
  while (pos >= 0 && (arrayEnd < 0 || pos < arrayEnd) && g_onlineAuthUserCount < P1_EMBED_MQTT_MAX_USERS) {
    int end = json.indexOf('}', pos);
    if (end < 0 || (arrayEnd >= 0 && end > arrayEnd)) break;

    String entry = json.substring(pos, end + 1);
    String username;
    String keyHex;
    if (configJsonGetString(entry, "username", username) && configJsonGetString(entry, "key", keyHex)) {
      username.trim();
      keyHex.trim();
      uint8_t key[32];
      if (username.length() && configHexToBytes(keyHex, key, sizeof(key))) {
        configSetText(g_onlineAuthUsers[g_onlineAuthUserCount].username, sizeof(g_onlineAuthUsers[g_onlineAuthUserCount].username), username);
        memcpy(g_onlineAuthUsers[g_onlineAuthUserCount].key, key, sizeof(key));
        g_onlineAuthUserCount++;
      }
    }

    pos = json.indexOf('{', end + 1);
  }
}

static bool configReadFile(String& out) {
  out = "";
  if (!configEnsureFs()) return false;
  File f = LittleFS.open(CONFIG_PATH, "r");
  if (!f) return false;
  size_t n = (size_t)f.size();
  if (n > 8192) {
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
  configSetText(g_deviceName, sizeof(g_deviceName), prefs.getString("deviceName", configText(g_deviceName)));
  configAddWifiNetwork(prefs.getString("wifiSsid", ""), prefs.getString("wifiPass", ""));
  prefs.end();
}

static void configApplyMqttDefaults() {
  if (!configTextHasValue(g_mqttHost)) configSetText(g_mqttHost, sizeof(g_mqttHost), P1_EMBED_MQTT_HOST);
  if (g_mqttPort <= 0 || g_mqttPort > 65535) g_mqttPort = P1_EMBED_MQTT_PORT;
  if (!configTextHasValue(g_mqttRoot)) configSetText(g_mqttRoot, sizeof(g_mqttRoot), P1_EMBED_MQTT_ROOT);
  if (!configTextHasValue(g_mqttUser)) configSetText(g_mqttUser, sizeof(g_mqttUser), P1_EMBED_MQTT_USER);
  if (!configTextHasValue(g_mqttPassword)) configSetText(g_mqttPassword, sizeof(g_mqttPassword), P1_EMBED_MQTT_PASS, false);
}

void configLoad() {
  configApplyIdentityDefaults();
  configApplyMqttDefaults();

  String json;
  if (configReadFile(json)) {
    String value;
    bool changed = false;
    if (configJsonGetString(json, "deviceId", value)) configSetText(g_deviceId, sizeof(g_deviceId), value);
    else changed = true;
    if (configJsonGetString(json, "deviceName", value)) configSetText(g_deviceName, sizeof(g_deviceName), value.length() ? value : configBuildDefaultDeviceName());
    else changed = true;
    if (configJsonGetString(json, "projectId", value)) configSetText(g_projectId, sizeof(g_projectId), value);
    else changed = true;
    if (configJsonGetString(json, "projectName", value)) configSetText(g_projectName, sizeof(g_projectName), value);
    else changed = true;
    if (configJsonGetString(json, "revisionId", value)) configSetText(g_revisionId, sizeof(g_revisionId), value);
    else changed = true;
    if (configJsonGetString(json, "scriptName", value)) configSetText(g_scriptName, sizeof(g_scriptName), value);
    else changed = true;
    if (configJsonGetString(json, "timezone", value)) configSetText(g_timezone, sizeof(g_timezone), configNormalizeTimezone(value));
    else changed = true;
    configApplyIdentityDefaults();
    configApplyTimezone();
    configLoadWifiNetworks(json);
    configLoadOnlineAuthUsers(json);
    int port = 0;
    if (configJsonGetString(json, "mqttHost", value)) configSetText(g_mqttHost, sizeof(g_mqttHost), value);
    else changed = true;
    if (configJsonGetInt(json, "mqttPort", port)) g_mqttPort = port;
    else changed = true;
    if (configJsonGetString(json, "mqttRoot", value)) {
      configSetText(g_mqttRoot, sizeof(g_mqttRoot), value);
    }
    else changed = true;
    if (configJsonGetString(json, "mqttUser", value)) configSetText(g_mqttUser, sizeof(g_mqttUser), value);
    else changed = true;
    if (configJsonGetString(json, "mqttPassword", value)) configSetText(g_mqttPassword, sizeof(g_mqttPassword), value, false);
    else changed = true;
    if (!configJsonGetBool(json, "mqttEnabled", g_mqttEnabled)) changed = true;
    if (!configJsonGetBool(json, "mqttAllowAnonymousUi", g_mqttAllowAnonymousUi)) changed = true;
    if (!configJsonGetBool(json, "mqttAllowAnonymousScript", g_mqttAllowAnonymousScript)) changed = true;
    if (configJsonGetString(json, "mqttGuestUiKey", value)) configSetText(g_mqttGuestUiKey, sizeof(g_mqttGuestUiKey), configNormalizeGuestKey(value));
    else changed = true;
    if (g_mqttAllowAnonymousUi && strlen(g_mqttGuestUiKey) < 16) {
      configSetText(g_mqttGuestUiKey, sizeof(g_mqttGuestUiKey), configGenerateGuestKey());
      changed = true;
    }
    configApplyMqttDefaults();
    if (changed) configSave();
    return;
  }

  configLoadLegacyPrefsIfPresent();
  configApplyIdentityDefaults();
  configApplyMqttDefaults();
  configApplyTimezone();
  configSave();
}

void configSave() {
  if (!configEnsureFs()) return;

  String json = "{";
  json += "\"deviceId\":" + jsonString(g_deviceId);
  json += ",\"deviceName\":" + jsonString(g_deviceName);
  json += ",\"projectId\":" + jsonString(g_projectId);
  json += ",\"projectName\":" + jsonString(g_projectName);
  json += ",\"revisionId\":" + jsonString(g_revisionId);
  json += ",\"scriptName\":" + jsonString(g_scriptName);
  json += ",\"timezone\":" + jsonString(configTimezone());
  json += ",\"wifiSsid\":" + jsonString(configWifiSsid());
  json += ",\"wifiPassword\":" + jsonString(configWifiPassword());
  json += ",\"mqttHost\":" + jsonString(configMqttHost());
  json += ",\"mqttPort\":" + String(configMqttPort());
  json += ",\"mqttRoot\":" + jsonString(configMqttRoot());
  json += ",\"mqttUser\":" + jsonString(configMqttUser());
  json += ",\"mqttPassword\":" + jsonString(configMqttPassword());
  json += ",\"mqttEnabled\":" + String(configMqttEnabled() ? "true" : "false");
  json += ",\"mqttAllowAnonymousUi\":" + String(configMqttAllowAnonymousUi() ? "true" : "false");
  json += ",\"mqttAllowAnonymousScript\":" + String(configMqttAllowAnonymousScript() ? "true" : "false");
  json += ",\"mqttGuestUiKey\":" + jsonString(configMqttGuestUiKey());
  json += ",\"onlineAuthUsers\":[";
  for (int i = 0; i < g_onlineAuthUserCount; i++) {
    if (i) json += ",";
    json += "{\"username\":" + jsonString(g_onlineAuthUsers[i].username);
    json += ",\"key\":\"";
    configAppendHex(json, g_onlineAuthUsers[i].key, sizeof(g_onlineAuthUsers[i].key));
    json += "\"}";
  }
  json += "]";
  json += ",\"wifiNetworks\":[";
  for (int i = 0; i < g_wifiNetworkCount; i++) {
    if (i) json += ",";
    json += "{\"ssid\":" + jsonString(g_wifiNetworks[i].ssid);
    json += ",\"password\":" + jsonString(g_wifiNetworks[i].password) + "}";
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

  configSetText(g_deviceId, sizeof(g_deviceId), configBuildDeviceId());
  configSetText(g_deviceName, sizeof(g_deviceName), configBuildDefaultDeviceName());
  configClearText(g_projectId, sizeof(g_projectId));
  configClearText(g_projectName, sizeof(g_projectName));
  configClearText(g_revisionId, sizeof(g_revisionId));
  configClearText(g_scriptName, sizeof(g_scriptName));
  configSetText(g_timezone, sizeof(g_timezone), "UTC0");
  configSetText(g_mqttHost, sizeof(g_mqttHost), P1_EMBED_MQTT_HOST);
  g_mqttPort = P1_EMBED_MQTT_PORT;
  configSetText(g_mqttRoot, sizeof(g_mqttRoot), P1_EMBED_MQTT_ROOT);
  configSetText(g_mqttUser, sizeof(g_mqttUser), P1_EMBED_MQTT_USER);
  configSetText(g_mqttPassword, sizeof(g_mqttPassword), P1_EMBED_MQTT_PASS, false);
  g_mqttEnabled = true;
  g_mqttAllowAnonymousUi = false;
  g_mqttAllowAnonymousScript = false;
  configClearText(g_mqttGuestUiKey, sizeof(g_mqttGuestUiKey));
  g_onlineAuthUserCount = 0;
  for (int i = 0; i < P1_EMBED_MQTT_MAX_USERS; i++) {
    configClearOnlineAuthUserAt(i);
  }
  for (int i = 0; i < P1_EMBED_MAX_WIFI_NETWORKS; i++) {
    configClearWifiNetworkAt(i);
  }
  g_wifiNetworkCount = 0;
  configApplyTimezone();
  configSave();
}

String configDeviceId() {
  return configTextHasValue(g_deviceId) ? configText(g_deviceId) : configBuildDeviceId();
}

String configDeviceName() {
  return configTextHasValue(g_deviceName) ? configText(g_deviceName) : configBuildDefaultDeviceName();
}

void configSetDeviceName(const String& value) {
  configSetText(g_deviceName, sizeof(g_deviceName), value.length() ? value : configBuildDefaultDeviceName());
}

String configProjectId() {
  return configText(g_projectId);
}

String configProjectName() {
  return configText(g_projectName);
}

void configSetProject(const String& id, const String& name) {
  configSetText(g_projectId, sizeof(g_projectId), id);
  configSetText(g_projectName, sizeof(g_projectName), name);
}

String configRevisionId() {
  return configText(g_revisionId);
}

void configSetRevisionId(const String& id) {
  configSetText(g_revisionId, sizeof(g_revisionId), id);
}

String configScriptName() {
  return configText(g_scriptName);
}

void configSetScriptName(const String& name) {
  configSetText(g_scriptName, sizeof(g_scriptName), name);
}

String configTimezone() {
  return configNormalizeTimezone(configText(g_timezone));
}

void configSetTimezone(const String& value) {
  configSetText(g_timezone, sizeof(g_timezone), configNormalizeTimezone(value));
  configApplyTimezone();
}

void configSetWifiSsid(const String& value) {
  if (!value.length()) return;
  String password = g_wifiNetworkCount > 0 ? configText(g_wifiNetworks[0].password) : "";
  configAddWifiNetwork(value, password);
}

void configSetWifiPassword(const String& value) {
  if (g_wifiNetworkCount > 0) configSetText(g_wifiNetworks[0].password, sizeof(g_wifiNetworks[0].password), value, false);
}

bool configRemoveWifiNetworkAt(int index) {
  if (index < 0 || index >= g_wifiNetworkCount) return false;
  for (int i = index; i < g_wifiNetworkCount - 1; i++) {
    configCopyWifiNetworkSlot(i, i + 1);
  }
  g_wifiNetworkCount--;
  if (g_wifiNetworkCount < 0) g_wifiNetworkCount = 0;
  configClearWifiNetworkAt(g_wifiNetworkCount);
  return true;
}

void configSetMqttHost(const String& value) {
  String next = value;
  next.trim();
  configSetText(g_mqttHost, sizeof(g_mqttHost), next.length() ? next : String(P1_EMBED_MQTT_HOST));
}

void configSetMqttPort(int value) {
  g_mqttPort = (value > 0 && value <= 65535) ? value : P1_EMBED_MQTT_PORT;
}

void configSetMqttRoot(const String& value) {
  String next = value;
  next.trim();
  configSetText(g_mqttRoot, sizeof(g_mqttRoot), next.length() ? next : String(P1_EMBED_MQTT_ROOT));
}

void configSetMqttUser(const String& value) {
  String next = value;
  next.trim();
  configSetText(g_mqttUser, sizeof(g_mqttUser), next.length() ? next : String(P1_EMBED_MQTT_USER));
}

void configSetMqttPassword(const String& value) {
  configSetText(g_mqttPassword, sizeof(g_mqttPassword), value.length() ? value : String(P1_EMBED_MQTT_PASS), false);
}

void configSetMqttEnabled(bool value) {
  g_mqttEnabled = value;
}

void configSetMqttAllowAnonymousUi(bool value) {
  g_mqttAllowAnonymousUi = value;
  if (value && strlen(g_mqttGuestUiKey) < 16) configSetText(g_mqttGuestUiKey, sizeof(g_mqttGuestUiKey), configGenerateGuestKey());
}

void configSetMqttAllowAnonymousScript(bool value) {
  g_mqttAllowAnonymousScript = value;
}

void configSetMqttGuestUiKey(const String& value) {
  configSetText(g_mqttGuestUiKey, sizeof(g_mqttGuestUiKey), configNormalizeGuestKey(value));
}

P1OnlineAuthUserAddResult configAddOnlineAuthUserKeyChecked(const String& username, const String& keyHex) {
  String user = username;
  String key = keyHex;
  user.trim();
  key.trim();
  key.toLowerCase();
  uint8_t parsed[32];
  if (!user.length()) return P1_ONLINE_AUTH_USER_EMPTY_NAME;
  if (!configHexToBytes(key, parsed, sizeof(parsed))) return P1_ONLINE_AUTH_USER_BAD_KEY;

  int index = configFindOnlineAuthUser(user);
  if (index < 0) {
    if (g_onlineAuthUserCount >= P1_EMBED_MQTT_MAX_USERS) return P1_ONLINE_AUTH_USER_LIMIT;
    index = g_onlineAuthUserCount++;
  }
  configSetText(g_onlineAuthUsers[index].username, sizeof(g_onlineAuthUsers[index].username), user);
  memcpy(g_onlineAuthUsers[index].key, parsed, sizeof(parsed));
  return P1_ONLINE_AUTH_USER_ADDED;
}

bool configAddOnlineAuthUserKey(const String& username, const String& keyHex) {
  return configAddOnlineAuthUserKeyChecked(username, keyHex) == P1_ONLINE_AUTH_USER_ADDED;
}

bool configRemoveOnlineAuthUser(const String& username) {
  String user = username;
  user.trim();
  int index = configFindOnlineAuthUser(user);
  if (index < 0) return false;
  for (int i = index; i < g_onlineAuthUserCount - 1; i++) {
    configCopyOnlineAuthUserSlot(i, i + 1);
  }
  g_onlineAuthUserCount--;
  configClearOnlineAuthUserAt(g_onlineAuthUserCount);
  return true;
}

int configOnlineAuthUserCount() {
  return g_onlineAuthUserCount;
}

String configOnlineAuthUserNameAt(int index) {
  if (index < 0 || index >= g_onlineAuthUserCount) return "";
  return configText(g_onlineAuthUsers[index].username);
}

bool configOnlineAuthUserKey(const String& username, uint8_t outKey[32]) {
  int index = configFindOnlineAuthUser(username);
  if (index < 0) return false;
  if (!outKey) return false;
  memcpy(outKey, g_onlineAuthUsers[index].key, 32);
  return true;
}

bool configOnlineAuthUserKey(const char* username, uint8_t outKey[32]) {
  int index = configFindOnlineAuthUser(username);
  if (index < 0) return false;
  if (!outKey) return false;
  memcpy(outKey, g_onlineAuthUsers[index].key, 32);
  return true;
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
  return configText(g_wifiNetworks[index].ssid);
}

String configWifiPasswordAt(int index) {
  if (index < 0 || index >= g_wifiNetworkCount) return "";
  return configText(g_wifiNetworks[index].password);
}

String configMqttHost() {
  return configTextHasValue(g_mqttHost) ? configText(g_mqttHost) : String(P1_EMBED_MQTT_HOST);
}

int configMqttPort() {
  return (g_mqttPort > 0 && g_mqttPort <= 65535) ? g_mqttPort : P1_EMBED_MQTT_PORT;
}

String configMqttRoot() {
  if (configTextHasValue(g_mqttRoot)) return configText(g_mqttRoot);
  String root = P1_EMBED_MQTT_ROOT;
  return root.length() ? root : configBuildDefaultMqttRoot();
}

String configMqttUser() {
  return configTextHasValue(g_mqttUser) ? configText(g_mqttUser) : String(P1_EMBED_MQTT_USER);
}

String configMqttPassword() {
  return configTextHasValue(g_mqttPassword) ? configText(g_mqttPassword) : String(P1_EMBED_MQTT_PASS);
}

bool configMqttEnabled() {
  return g_mqttEnabled;
}

bool configMqttAllowAnonymousUi() {
  return g_mqttAllowAnonymousUi;
}

bool configMqttAllowAnonymousScript() {
  return g_mqttAllowAnonymousScript;
}

String configMqttGuestUiKey() {
  return configText(g_mqttGuestUiKey);
}

bool configMqttGuestUiKeyMatches(const String& value) {
  String expected = configMqttGuestUiKey();
  String provided = configNormalizeGuestKey(value);
  return expected.length() >= 16 && provided.length() >= 16 && provided == expected;
}

String configEnsureMqttGuestUiKey() {
  if (strlen(g_mqttGuestUiKey) < 16) {
    configSetText(g_mqttGuestUiKey, sizeof(g_mqttGuestUiKey), configGenerateGuestKey());
    configSave();
  }
  return configText(g_mqttGuestUiKey);
}

P1ConfigSnapshot configSnapshot() {
  P1ConfigSnapshot snapshot;
  snapshot.deviceId = configDeviceId();
  snapshot.deviceName = configDeviceName();
  snapshot.projectId = configProjectId();
  snapshot.projectName = configProjectName();
  snapshot.revisionId = configRevisionId();
  snapshot.scriptName = configScriptName();
  snapshot.timezone = configTimezone();
  snapshot.wifiSsid = configWifiSsid();
  snapshot.wifiPasswordSet = configWifiPassword().length() > 0;
  snapshot.wifiNetworkCount = g_wifiNetworkCount;
  snapshot.mqttHost = configMqttHost();
  snapshot.mqttPort = configMqttPort();
  snapshot.mqttRoot = configMqttRoot();
  snapshot.mqttUser = configMqttUser();
  snapshot.mqttPasswordSet = configMqttPassword().length() > 0;
  snapshot.mqttEnabled = configMqttEnabled();
  snapshot.mqttAllowAnonymousUi = configMqttAllowAnonymousUi();
  snapshot.mqttAllowAnonymousScript = configMqttAllowAnonymousScript();
  snapshot.mqttGuestUiKey = configMqttGuestUiKey();
  snapshot.mqttGuestUiKeySet = snapshot.mqttGuestUiKey.length() >= 16;
  snapshot.onlineAuthUserCount = configOnlineAuthUserCount();
  snapshot.onlineAuthUserMax = P1_EMBED_MQTT_MAX_USERS;
  snapshot.wifi = wifiSnapshot();
  return snapshot;
}
