#include <Arduino.h>
#include <ESP.h>
#include <esp_system.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <time.h>
#include "p1_embed_firmware.h"

static const char* CONFIG_PATH = "/config.json";
static String g_deviceId = "";
static String g_deviceName = "";
static String g_projectId = "";
static String g_projectName = "";
static String g_revisionId = "";
static String g_scriptName = "";
static String g_timezone = "UTC0";
static String g_wifiSsids[P1_EMBED_MAX_WIFI_NETWORKS];
static String g_wifiPasswords[P1_EMBED_MAX_WIFI_NETWORKS];
static int g_wifiNetworkCount = 0;
static String g_mqttHost = "";
static int g_mqttPort = P1_EMBED_MQTT_PORT;
static String g_mqttRoot = "";
static String g_mqttUser = "";
static String g_mqttPassword = "";
static bool g_mqttEnabled = true;
static bool g_mqttAllowAnonymousUi = false;
static bool g_mqttAllowAnonymousScript = false;
static String g_mqttGuestUiKey = "";
static String g_onlineAuthUsernames[P1_EMBED_MQTT_MAX_USERS];
static String g_onlineAuthUserKeys[P1_EMBED_MQTT_MAX_USERS];
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
  if (!g_deviceId.length()) g_deviceId = configBuildDeviceId();
  if (!g_deviceName.length() || g_deviceName == "p1-embed") g_deviceName = configBuildDefaultDeviceName();
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

static int configFindOnlineAuthUser(const String& username) {
  for (int i = 0; i < g_onlineAuthUserCount; i++) {
    if (g_onlineAuthUsernames[i] == username) return i;
  }
  return -1;
}

static int configFindOnlineAuthUser(const char* username) {
  if (!username || !username[0]) return -1;
  for (int i = 0; i < g_onlineAuthUserCount; i++) {
    if (strcmp(g_onlineAuthUsernames[i].c_str(), username) == 0) return i;
  }
  return -1;
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
        g_onlineAuthUsernames[g_onlineAuthUserCount] = username;
        g_onlineAuthUserKeys[g_onlineAuthUserCount] = keyHex;
        g_onlineAuthUserKeys[g_onlineAuthUserCount].toLowerCase();
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
  g_deviceName = prefs.getString("deviceName", g_deviceName);
  configAddWifiNetwork(prefs.getString("wifiSsid", ""), prefs.getString("wifiPass", ""));
  prefs.end();
}

static void configApplyMqttDefaults() {
  if (!g_mqttHost.length()) g_mqttHost = P1_EMBED_MQTT_HOST;
  if (g_mqttPort <= 0 || g_mqttPort > 65535) g_mqttPort = P1_EMBED_MQTT_PORT;
  if (!g_mqttRoot.length()) g_mqttRoot = String(P1_EMBED_MQTT_ROOT);
  if (!g_mqttUser.length()) g_mqttUser = P1_EMBED_MQTT_USER;
  if (!g_mqttPassword.length()) g_mqttPassword = P1_EMBED_MQTT_PASS;
}

void configLoad() {
  configApplyIdentityDefaults();
  configApplyMqttDefaults();

  String json;
  if (configReadFile(json)) {
    String value;
    bool changed = false;
    if (configJsonGetString(json, "deviceId", value)) g_deviceId = value;
    else changed = true;
    if (configJsonGetString(json, "deviceName", value)) g_deviceName = value.length() ? value : configBuildDefaultDeviceName();
    else changed = true;
    if (configJsonGetString(json, "projectId", value)) g_projectId = value;
    else changed = true;
    if (configJsonGetString(json, "projectName", value)) g_projectName = value;
    else changed = true;
    if (configJsonGetString(json, "revisionId", value)) g_revisionId = value;
    else changed = true;
    if (configJsonGetString(json, "scriptName", value)) g_scriptName = value;
    else changed = true;
    if (configJsonGetString(json, "timezone", value)) g_timezone = configNormalizeTimezone(value);
    else changed = true;
    configApplyIdentityDefaults();
    configApplyTimezone();
    configLoadWifiNetworks(json);
    configLoadOnlineAuthUsers(json);
    int port = 0;
    if (configJsonGetString(json, "mqttHost", value)) g_mqttHost = value;
    else changed = true;
    if (configJsonGetInt(json, "mqttPort", port)) g_mqttPort = port;
    else changed = true;
    if (configJsonGetString(json, "mqttRoot", value)) {
      g_mqttRoot = value;
    }
    else changed = true;
    if (configJsonGetString(json, "mqttUser", value)) g_mqttUser = value;
    else changed = true;
    if (configJsonGetString(json, "mqttPassword", value)) g_mqttPassword = value;
    else changed = true;
    if (!configJsonGetBool(json, "mqttEnabled", g_mqttEnabled)) changed = true;
    if (!configJsonGetBool(json, "mqttAllowAnonymousUi", g_mqttAllowAnonymousUi)) changed = true;
    if (!configJsonGetBool(json, "mqttAllowAnonymousScript", g_mqttAllowAnonymousScript)) changed = true;
    if (configJsonGetString(json, "mqttGuestUiKey", value)) g_mqttGuestUiKey = configNormalizeGuestKey(value);
    else changed = true;
    if (g_mqttAllowAnonymousUi && g_mqttGuestUiKey.length() < 16) {
      g_mqttGuestUiKey = configGenerateGuestKey();
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
    json += "{\"username\":" + jsonString(g_onlineAuthUsernames[i]);
    json += ",\"key\":" + jsonString(g_onlineAuthUserKeys[i]) + "}";
  }
  json += "]";
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
  g_projectId = "";
  g_projectName = "";
  g_revisionId = "";
  g_scriptName = "";
  g_timezone = "UTC0";
  g_mqttHost = P1_EMBED_MQTT_HOST;
  g_mqttPort = P1_EMBED_MQTT_PORT;
  g_mqttRoot = P1_EMBED_MQTT_ROOT;
  g_mqttUser = P1_EMBED_MQTT_USER;
  g_mqttPassword = P1_EMBED_MQTT_PASS;
  g_mqttEnabled = true;
  g_mqttAllowAnonymousUi = false;
  g_mqttAllowAnonymousScript = false;
  g_onlineAuthUserCount = 0;
  for (int i = 0; i < P1_EMBED_MQTT_MAX_USERS; i++) {
    g_onlineAuthUsernames[i] = "";
    g_onlineAuthUserKeys[i] = "";
  }
  for (int i = 0; i < P1_EMBED_MAX_WIFI_NETWORKS; i++) {
    g_wifiSsids[i] = "";
    g_wifiPasswords[i] = "";
  }
  g_wifiNetworkCount = 0;
  configApplyTimezone();
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

String configProjectId() {
  return g_projectId;
}

String configProjectName() {
  return g_projectName;
}

void configSetProject(const String& id, const String& name) {
  g_projectId = id;
  g_projectId.trim();
  g_projectName = name;
  g_projectName.trim();
}

String configRevisionId() {
  return g_revisionId;
}

void configSetRevisionId(const String& id) {
  g_revisionId = id;
  g_revisionId.trim();
}

String configScriptName() {
  return g_scriptName;
}

void configSetScriptName(const String& name) {
  g_scriptName = name;
  g_scriptName.trim();
}

String configTimezone() {
  return configNormalizeTimezone(g_timezone);
}

void configSetTimezone(const String& value) {
  g_timezone = configNormalizeTimezone(value);
  configApplyTimezone();
}

void configSetWifiSsid(const String& value) {
  if (!value.length()) return;
  String password = g_wifiNetworkCount > 0 ? g_wifiPasswords[0] : "";
  configAddWifiNetwork(value, password);
}

void configSetWifiPassword(const String& value) {
  if (g_wifiNetworkCount > 0) g_wifiPasswords[0] = value;
}

bool configRemoveWifiNetworkAt(int index) {
  if (index < 0 || index >= g_wifiNetworkCount) return false;
  for (int i = index; i < g_wifiNetworkCount - 1; i++) {
    g_wifiSsids[i] = g_wifiSsids[i + 1];
    g_wifiPasswords[i] = g_wifiPasswords[i + 1];
  }
  g_wifiNetworkCount--;
  if (g_wifiNetworkCount < 0) g_wifiNetworkCount = 0;
  g_wifiSsids[g_wifiNetworkCount] = "";
  g_wifiPasswords[g_wifiNetworkCount] = "";
  return true;
}

void configSetMqttHost(const String& value) {
  String next = value;
  next.trim();
  g_mqttHost = next.length() ? next : String(P1_EMBED_MQTT_HOST);
}

void configSetMqttPort(int value) {
  g_mqttPort = (value > 0 && value <= 65535) ? value : P1_EMBED_MQTT_PORT;
}

void configSetMqttRoot(const String& value) {
  String next = value;
  next.trim();
  g_mqttRoot = next.length() ? next : String(P1_EMBED_MQTT_ROOT);
}

void configSetMqttUser(const String& value) {
  String next = value;
  next.trim();
  g_mqttUser = next.length() ? next : String(P1_EMBED_MQTT_USER);
}

void configSetMqttPassword(const String& value) {
  g_mqttPassword = value.length() ? value : String(P1_EMBED_MQTT_PASS);
}

void configSetMqttEnabled(bool value) {
  g_mqttEnabled = value;
}

void configSetMqttAllowAnonymousUi(bool value) {
  g_mqttAllowAnonymousUi = value;
  if (value && g_mqttGuestUiKey.length() < 16) g_mqttGuestUiKey = configGenerateGuestKey();
}

void configSetMqttAllowAnonymousScript(bool value) {
  g_mqttAllowAnonymousScript = value;
}

void configSetMqttGuestUiKey(const String& value) {
  g_mqttGuestUiKey = configNormalizeGuestKey(value);
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
  g_onlineAuthUsernames[index] = user;
  g_onlineAuthUserKeys[index] = key;
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
    g_onlineAuthUsernames[i] = g_onlineAuthUsernames[i + 1];
    g_onlineAuthUserKeys[i] = g_onlineAuthUserKeys[i + 1];
  }
  g_onlineAuthUserCount--;
  g_onlineAuthUsernames[g_onlineAuthUserCount] = "";
  g_onlineAuthUserKeys[g_onlineAuthUserCount] = "";
  return true;
}

int configOnlineAuthUserCount() {
  return g_onlineAuthUserCount;
}

String configOnlineAuthUserNameAt(int index) {
  if (index < 0 || index >= g_onlineAuthUserCount) return "";
  return g_onlineAuthUsernames[index];
}

bool configOnlineAuthUserKey(const String& username, uint8_t outKey[32]) {
  int index = configFindOnlineAuthUser(username);
  if (index < 0) return false;
  return configHexToBytes(g_onlineAuthUserKeys[index], outKey, 32);
}

bool configOnlineAuthUserKey(const char* username, uint8_t outKey[32]) {
  int index = configFindOnlineAuthUser(username);
  if (index < 0) return false;
  return configHexToBytes(g_onlineAuthUserKeys[index], outKey, 32);
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

String configMqttHost() {
  return g_mqttHost.length() ? g_mqttHost : String(P1_EMBED_MQTT_HOST);
}

int configMqttPort() {
  return (g_mqttPort > 0 && g_mqttPort <= 65535) ? g_mqttPort : P1_EMBED_MQTT_PORT;
}

String configMqttRoot() {
  if (g_mqttRoot.length()) return g_mqttRoot;
  String root = P1_EMBED_MQTT_ROOT;
  return root.length() ? root : configBuildDefaultMqttRoot();
}

String configMqttUser() {
  return g_mqttUser.length() ? g_mqttUser : String(P1_EMBED_MQTT_USER);
}

String configMqttPassword() {
  return g_mqttPassword.length() ? g_mqttPassword : String(P1_EMBED_MQTT_PASS);
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
  return g_mqttGuestUiKey;
}

bool configMqttGuestUiKeyMatches(const String& value) {
  String expected = configMqttGuestUiKey();
  String provided = configNormalizeGuestKey(value);
  return expected.length() >= 16 && provided.length() >= 16 && provided == expected;
}

String configEnsureMqttGuestUiKey() {
  if (g_mqttGuestUiKey.length() < 16) {
    g_mqttGuestUiKey = configGenerateGuestKey();
    configSave();
  }
  return g_mqttGuestUiKey;
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

String configAsJson(const P1ConfigSnapshot& snapshot) {
  String out = "{";
  out += "\"deviceId\":" + jsonString(snapshot.deviceId);
  out += ",\"deviceName\":" + jsonString(snapshot.deviceName);
  out += ",\"projectId\":" + jsonString(snapshot.projectId);
  out += ",\"projectName\":" + jsonString(snapshot.projectName);
  out += ",\"revisionId\":" + jsonString(snapshot.revisionId);
  out += ",\"scriptName\":" + jsonString(snapshot.scriptName);
  out += ",\"timezone\":" + jsonString(snapshot.timezone);
  out += ",\"wifiSsid\":" + jsonString(snapshot.wifiSsid);
  out += ",\"wifiPasswordSet\":" + String(snapshot.wifiPasswordSet ? "true" : "false");
  out += ",\"wifiNetworkCount\":" + String(snapshot.wifiNetworkCount);
  out += ",\"mqttHost\":" + jsonString(snapshot.mqttHost);
  out += ",\"mqttPort\":" + String(snapshot.mqttPort);
  out += ",\"mqttRoot\":" + jsonString(snapshot.mqttRoot);
  out += ",\"mqttUser\":" + jsonString(snapshot.mqttUser);
  out += ",\"mqttPasswordSet\":" + String(snapshot.mqttPasswordSet ? "true" : "false");
  out += ",\"mqttEnabled\":" + String(snapshot.mqttEnabled ? "true" : "false");
  out += ",\"mqttAllowAnonymousUi\":" + String(snapshot.mqttAllowAnonymousUi ? "true" : "false");
  out += ",\"mqttAllowAnonymousScript\":" + String(snapshot.mqttAllowAnonymousScript ? "true" : "false");
  out += ",\"mqttGuestUiKeySet\":" + String(snapshot.mqttGuestUiKeySet ? "true" : "false");
  out += ",\"mqttGuestUiKey\":" + jsonString(snapshot.mqttGuestUiKey);
  out += ",\"onlineAuthUserCount\":" + String(snapshot.onlineAuthUserCount);
  out += ",\"onlineAuthUserMax\":" + String(snapshot.onlineAuthUserMax);
  out += ",\"onlineAuthUsers\":[";
  for (int i = 0; i < g_onlineAuthUserCount; i++) {
    if (i) out += ",";
    out += "{\"username\":" + jsonString(g_onlineAuthUsernames[i]) + "}";
  }
  out += "]";
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
