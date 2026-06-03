#include <Arduino.h>
#include <ESPmDNS.h>
#include <WiFi.h>
#include "p1_embed_firmware.h"

#if P1_EMBED_HA_ENABLED

enum P1HaEntityType : uint8_t {
  P1_HA_SENSOR = 1,
  P1_HA_BINARY_SENSOR = 2,
  P1_HA_SWITCH = 3,
  P1_HA_NUMBER = 4,
  P1_HA_BUTTON = 5,
  P1_HA_LIGHT = 6,
};

struct P1HaEntity {
  bool used = false;
  P1HaEntityType type = P1_HA_SENSOR;
  uint32_t key = 0;
  char id[P1_EMBED_HA_ID_MAX]{};
  char name[P1_EMBED_HA_NAME_MAX]{};
  char unit[P1_EMBED_HA_UNIT_MAX]{};
  float value = 0.0f;
  float minValue = 0.0f;
  float maxValue = 100.0f;
  float step = 1.0f;
  bool changed = false;
};

struct P1HaProtoWriter {
  uint8_t data[P1_EMBED_HA_TX_MAX];
  size_t len = 0;
  bool ok = true;

  void clear() {
    len = 0;
    ok = true;
  }

  bool put(uint8_t v) {
    if (len >= sizeof(data)) {
      ok = false;
      return false;
    }
    data[len++] = v;
    return true;
  }

  void varint(uint32_t v) {
    while (v >= 0x80) {
      put((uint8_t)(v | 0x80));
      v >>= 7;
    }
    put((uint8_t)v);
  }

  void fieldKey(uint32_t field, uint8_t wire) {
    varint((field << 3) | wire);
  }

  void fieldUint(uint32_t field, uint32_t value) {
    fieldKey(field, 0);
    varint(value);
  }

  void fieldPackedUint(uint32_t field, uint32_t value) {
    P1HaProtoWriter child;
    child.varint(value);
    fieldMessage(field, child);
  }

  void fieldBool(uint32_t field, bool value) {
    fieldUint(field, value ? 1 : 0);
  }

  void fieldFixed32(uint32_t field, uint32_t value) {
    fieldKey(field, 5);
    put((uint8_t)(value & 0xff));
    put((uint8_t)((value >> 8) & 0xff));
    put((uint8_t)((value >> 16) & 0xff));
    put((uint8_t)((value >> 24) & 0xff));
  }

  void fieldFloat(uint32_t field, float value) {
    union {
      float f;
      uint32_t u;
    } cvt;
    cvt.f = value;
    fieldFixed32(field, cvt.u);
  }

  void fieldString(uint32_t field, const String& value) {
    fieldKey(field, 2);
    size_t n = value.length();
    varint((uint32_t)n);
    for (size_t i = 0; i < n; i++) put((uint8_t)value[i]);
  }

  void fieldCString(uint32_t field, const char* value) {
    fieldString(field, String(value ? value : ""));
  }

  void fieldMessage(uint32_t field, const P1HaProtoWriter& value) {
    fieldKey(field, 2);
    varint((uint32_t)value.len);
    for (size_t i = 0; i < value.len; i++) put(value.data[i]);
  }
};

static WiFiServer g_haServer(P1_EMBED_HA_PORT);
static WiFiClient g_haClient;
static bool g_haServerStarted = false;
static bool g_haMdnsStarted = false;
static bool g_haRuntimeActive = false;
static bool g_haClientSubscribed = false;
static bool g_haClientHello = false;
static char g_haDeviceName[P1_EMBED_HA_NAME_MAX] = "";
static P1HaEntity g_haEntities[P1_EMBED_HA_ENTITY_MAX];
static P1HaInputEvent g_haEvents[P1_EMBED_HA_EVENT_DEPTH];
static uint8_t g_haEventHead = 0;
static uint8_t g_haEventTail = 0;
static uint8_t g_haEventCount = 0;
static uint8_t g_haRx[P1_EMBED_HA_RX_MAX];
static size_t g_haRxLen = 0;
static portMUX_TYPE g_haMux = portMUX_INITIALIZER_UNLOCKED;

static const char* haMessageName(uint32_t type) {
  switch (type) {
    case 1: return "HelloRequest";
    case 2: return "HelloResponse";
    case 3: return "AuthenticationRequest";
    case 4: return "AuthenticationResponse";
    case 5: return "DisconnectRequest";
    case 6: return "DisconnectResponse";
    case 7: return "PingRequest";
    case 8: return "PingResponse";
    case 9: return "DeviceInfoRequest";
    case 10: return "DeviceInfoResponse";
    case 11: return "ListEntitiesRequest";
    case 12: return "ListEntitiesBinarySensorResponse";
    case 15: return "ListEntitiesLightResponse";
    case 16: return "ListEntitiesSensorResponse";
    case 17: return "ListEntitiesSwitchResponse";
    case 19: return "ListEntitiesDoneResponse";
    case 20: return "SubscribeStatesRequest";
    case 21: return "BinarySensorStateResponse";
    case 24: return "LightStateResponse";
    case 25: return "SensorStateResponse";
    case 26: return "SwitchStateResponse";
    case 32: return "LightCommandRequest";
    case 33: return "SwitchCommandRequest";
    case 35: return "HomeassistantActionRequest";
    case 49: return "ListEntitiesNumberResponse";
    case 50: return "NumberStateResponse";
    case 51: return "NumberCommandRequest";
    case 61: return "ListEntitiesButtonResponse";
    case 62: return "ButtonCommandRequest";
    default: return "unknown";
  }
}

static void haTraceFrame(const char* dir, uint32_t type, size_t bytes) {
  P1EventField fields[] = {
    p1FieldString("dir", dir),
    p1FieldUInt("type", type),
    p1FieldString("name", haMessageName(type)),
    p1FieldUInt("bytes", bytes),
    p1FieldBool("subscribed", g_haClientSubscribed),
  };
  debugEventEmitFields("home_assistant.api", "trace", "home_assistant", "native api frame", fields, 5);
}

static String haDeviceName() {
  if (g_haDeviceName[0]) return String(g_haDeviceName);
  String name = configDeviceName();
  name.trim();
  return name.length() ? name : String("p1-embed");
}

static String haHostName() {
  String name = configDeviceName();
  name.trim();
  name.toLowerCase();

  String clean;
  clean.reserve(32);
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

static String haNodeName() {
  return haHostName();
}

static String haConfigHash() {
  uint32_t hash = wrenchCurrentScriptHash();
  if (hash == 0) hash = protocolFnv1a(configDeviceId() + ":" + configRevisionId());
  char buf[9];
  snprintf(buf, sizeof(buf), "%08x", (unsigned int)hash);
  return String(buf);
}

static void haCopy(char* out, size_t outLen, const String& value) {
  if (!out || outLen == 0) return;
  strlcpy(out, value.c_str(), outLen);
}

static void haSanitizeObjectId(const String& in, char* out, size_t outLen) {
  if (!out || outLen == 0) return;
  size_t n = 0;
  for (size_t i = 0; i < in.length() && n + 1 < outLen; i++) {
    char c = in[i];
    if (c >= 'A' && c <= 'Z') c = (char)(c - 'A' + 'a');
    if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) {
      out[n++] = c;
    } else if ((c == '_' || c == '-' || c == ' ') && n > 0 && out[n - 1] != '_') {
      out[n++] = '_';
    }
  }
  while (n > 0 && out[n - 1] == '_') n--;
  if (n == 0) {
    strlcpy(out, "entity", outLen);
    return;
  }
  out[n] = 0;
}

static uint32_t haKey(P1HaEntityType type, const String& id) {
  return protocolFnv1a(String((int)type) + ":" + id);
}

static int haFindEntityById(const String& id) {
  for (int i = 0; i < P1_EMBED_HA_ENTITY_MAX; i++) {
    if (g_haEntities[i].used && id == g_haEntities[i].id) return i;
  }
  return -1;
}

static int haFindEntityByKey(uint32_t key) {
  for (int i = 0; i < P1_EMBED_HA_ENTITY_MAX; i++) {
    if (g_haEntities[i].used && g_haEntities[i].key == key) return i;
  }
  return -1;
}

static int haFindOrCreate(P1HaEntityType type, const String& id) {
  String cleanId = id;
  cleanId.trim();
  if (!cleanId.length()) return -1;
  int existing = haFindEntityById(cleanId);
  if (existing >= 0) return existing;

  for (int i = 0; i < P1_EMBED_HA_ENTITY_MAX; i++) {
    if (g_haEntities[i].used) continue;
    g_haEntities[i] = P1HaEntity{};
    g_haEntities[i].used = true;
    g_haEntities[i].type = type;
    g_haEntities[i].key = haKey(type, cleanId);
    haCopy(g_haEntities[i].id, sizeof(g_haEntities[i].id), cleanId);
    haCopy(g_haEntities[i].name, sizeof(g_haEntities[i].name), cleanId);
    return i;
  }
  scriptErrorWarn("home_assistant", "entity_limit", "Home Assistant entity registry is full", "\"maxEntities\":" + String(P1_EMBED_HA_ENTITY_MAX));
  return -1;
}

static void haQueueEvent(const char* id, const char* type, float value) {
  P1HaInputEvent event{};
  strlcpy(event.id, id ? id : "", sizeof(event.id));
  strlcpy(event.type, type ? type : "set", sizeof(event.type));
  event.value = value;

  portENTER_CRITICAL(&g_haMux);
  if (g_haEventCount >= P1_EMBED_HA_EVENT_DEPTH) {
    g_haEventTail = (uint8_t)((g_haEventTail + 1) % P1_EMBED_HA_EVENT_DEPTH);
    g_haEventCount--;
  }
  g_haEvents[g_haEventHead] = event;
  g_haEventHead = (uint8_t)((g_haEventHead + 1) % P1_EMBED_HA_EVENT_DEPTH);
  g_haEventCount++;
  portEXIT_CRITICAL(&g_haMux);
}

static bool haTakeMatchingEvent(const char* id, const char* type, P1HaInputEvent& event) {
  bool found = false;
  P1HaInputEvent kept[P1_EMBED_HA_EVENT_DEPTH];
  uint8_t keptCount = 0;
  int foundOldestOffset = -1;

  portENTER_CRITICAL(&g_haMux);
  for (uint8_t offset = 0; offset < g_haEventCount; offset++) {
    uint8_t idx = (uint8_t)((g_haEventTail + offset) % P1_EMBED_HA_EVENT_DEPTH);
    const P1HaInputEvent& candidate = g_haEvents[idx];
    bool idMatches = !id || !id[0] || strncmp(candidate.id, id, sizeof(candidate.id)) == 0;
    bool typeMatches = !type || !type[0] || strncmp(candidate.type, type, sizeof(candidate.type)) == 0;
    if (idMatches && typeMatches) foundOldestOffset = offset;
  }

  if (foundOldestOffset >= 0) {
    for (uint8_t offset = 0; offset < g_haEventCount; offset++) {
      uint8_t idx = (uint8_t)((g_haEventTail + offset) % P1_EMBED_HA_EVENT_DEPTH);
      if (offset == (uint8_t)foundOldestOffset) {
        event = g_haEvents[idx];
        found = true;
      } else {
        kept[keptCount++] = g_haEvents[idx];
      }
    }
    g_haEventHead = 0;
    g_haEventTail = 0;
    g_haEventCount = 0;
    for (uint8_t i = 0; i < keptCount; i++) {
      g_haEvents[g_haEventHead] = kept[i];
      g_haEventHead = (uint8_t)((g_haEventHead + 1) % P1_EMBED_HA_EVENT_DEPTH);
      g_haEventCount++;
    }
  }
  portEXIT_CRITICAL(&g_haMux);
  return found;
}

static void haWriteVarintToClient(uint32_t value) {
  while (value >= 0x80) {
    g_haClient.write((uint8_t)(value | 0x80));
    value >>= 7;
  }
  g_haClient.write((uint8_t)value);
}

static void haSendMessage(uint32_t type, P1HaProtoWriter& msg) {
  if (!g_haClient || !g_haClient.connected() || !msg.ok) return;
  haTraceFrame("tx", type, msg.len);
  g_haClient.write((uint8_t)0);
  haWriteVarintToClient((uint32_t)msg.len);
  haWriteVarintToClient(type);
  if (msg.len) g_haClient.write(msg.data, msg.len);
}

static void haSendEmpty(uint32_t type) {
  P1HaProtoWriter msg;
  haSendMessage(type, msg);
}

static void haAddMapField(P1HaProtoWriter& msg, uint32_t field, const char* key, const String& value) {
  P1HaProtoWriter child;
  child.fieldCString(1, key);
  child.fieldString(2, value);
  msg.fieldMessage(field, child);
}

static void haSendHello() {
  P1HaProtoWriter msg;
  msg.fieldUint(1, 1);
  msg.fieldUint(2, 10);
  msg.fieldString(3, String(P1_EMBED_FIRMWARE_NAME) + " " + P1_EMBED_FIRMWARE_VERSION);
  msg.fieldString(4, haNodeName());
  haSendMessage(2, msg);
}

static void haSendDeviceInfo() {
  P1HaProtoWriter msg;
  msg.fieldBool(1, false);
  msg.fieldString(2, haNodeName());
  msg.fieldString(3, WiFi.macAddress());
  msg.fieldCString(4, P1_EMBED_FIRMWARE_VERSION);
  msg.fieldCString(5, __DATE__ " " __TIME__);
  msg.fieldCString(6, "P1E ESP32");
  msg.fieldCString(8, "p1e");
  msg.fieldCString(9, P1_EMBED_FIRMWARE_VERSION);
  msg.fieldCString(12, "P1E");
  msg.fieldString(13, haDeviceName());
  msg.fieldBool(19, false);
  haSendMessage(10, msg);
}

static void haSendEntityListOne(const P1HaEntity& entity) {
  P1HaProtoWriter msg;
  char objectId[P1_EMBED_HA_ID_MAX];
  haSanitizeObjectId(entity.id, objectId, sizeof(objectId));
  msg.fieldCString(1, objectId);
  msg.fieldFixed32(2, entity.key);
  msg.fieldCString(3, entity.name);

  switch (entity.type) {
    case P1_HA_BINARY_SENSOR:
      msg.fieldBool(6, false);
      msg.fieldBool(7, false);
      msg.fieldUint(9, 0);
      haSendMessage(12, msg);
      break;
    case P1_HA_SENSOR:
      msg.fieldCString(6, entity.unit);
      msg.fieldUint(7, 1);
      msg.fieldBool(8, false);
      msg.fieldUint(10, 1);
      msg.fieldBool(12, false);
      msg.fieldUint(13, 0);
      haSendMessage(16, msg);
      break;
    case P1_HA_SWITCH:
      msg.fieldBool(6, false);
      msg.fieldBool(7, false);
      msg.fieldUint(8, 0);
      haSendMessage(17, msg);
      break;
    case P1_HA_NUMBER:
      msg.fieldFloat(6, entity.minValue);
      msg.fieldFloat(7, entity.maxValue);
      msg.fieldFloat(8, entity.step);
      msg.fieldBool(9, false);
      msg.fieldUint(10, 0);
      msg.fieldCString(11, entity.unit);
      msg.fieldUint(12, 0);
      haSendMessage(49, msg);
      break;
    case P1_HA_BUTTON:
      msg.fieldBool(6, false);
      msg.fieldUint(7, 0);
      haSendMessage(61, msg);
      break;
    case P1_HA_LIGHT:
      {
        P1EventField fields[] = {
          p1FieldString("id", entity.id),
          p1FieldString("name", entity.name),
          p1FieldUInt("key", entity.key),
          p1FieldInt("brightness", (int)entity.value),
        };
        debugEventEmitFields("home_assistant.entity", "trace", "home_assistant", "list light entity", fields, 4);
      }
      msg.fieldFloat(9, 0.0f);
      msg.fieldFloat(10, 0.0f);
      msg.fieldUint(12, 3);
      msg.fieldBool(13, false);
      msg.fieldUint(15, 0);
      haSendMessage(15, msg);
      break;
  }
}

static void haSendStateOne(const P1HaEntity& entity) {
  P1HaProtoWriter msg;
  msg.fieldFixed32(1, entity.key);
  switch (entity.type) {
    case P1_HA_BINARY_SENSOR:
      msg.fieldBool(2, entity.value != 0.0f);
      msg.fieldBool(3, false);
      haSendMessage(21, msg);
      break;
    case P1_HA_SENSOR:
      msg.fieldFloat(2, entity.value);
      msg.fieldBool(3, false);
      haSendMessage(25, msg);
      break;
    case P1_HA_SWITCH:
      msg.fieldBool(2, entity.value != 0.0f);
      haSendMessage(26, msg);
      break;
    case P1_HA_NUMBER:
      msg.fieldFloat(2, entity.value);
      msg.fieldBool(3, false);
      haSendMessage(50, msg);
      break;
    case P1_HA_LIGHT: {
      float brightness = constrain(entity.value, 0.0f, 100.0f) / 100.0f;
      msg.fieldBool(2, brightness > 0.0f);
      msg.fieldFloat(3, brightness);
      msg.fieldUint(11, 3);
      haSendMessage(24, msg);
      break;
    }
    case P1_HA_BUTTON:
      break;
  }
}

static void haSendEntityList() {
  for (int i = 0; i < P1_EMBED_HA_ENTITY_MAX; i++) {
    if (g_haEntities[i].used) haSendEntityListOne(g_haEntities[i]);
  }
  haSendEmpty(19);
}

static void haSendAllStates() {
  for (int i = 0; i < P1_EMBED_HA_ENTITY_MAX; i++) {
    if (g_haEntities[i].used) haSendStateOne(g_haEntities[i]);
  }
}

static void haSendHomeAssistantButtonEvent(const P1HaEntity& entity) {
  if (!g_haClient || !g_haClient.connected()) return;
  P1HaProtoWriter msg;
  msg.fieldCString(1, "p1e_button_press");
  haAddMapField(msg, 2, "id", String(entity.id));
  haAddMapField(msg, 2, "name", String(entity.name));
  haAddMapField(msg, 2, "device", haDeviceName());
  msg.fieldBool(5, true);
  haSendMessage(35, msg);
}

static void haStartMdns() {
  if (g_haMdnsStarted || !wifiIsConnected()) return;

  String host = haHostName();
  if (!MDNS.begin(host.c_str())) {
    debugError("home_assistant", "mdns_begin_failed", "Failed to start Home Assistant mDNS discovery");
    return;
  }

  String friendly = haDeviceName();
  String version = P1_EMBED_FIRMWARE_VERSION;
  String hash = haConfigHash();
  String mac = WiFi.macAddress();
  MDNS.addService("esphomelib", "tcp", P1_EMBED_HA_PORT);
  MDNS.addServiceTxt("esphomelib", "tcp", "friendly_name", friendly.c_str());
  MDNS.addServiceTxt("esphomelib", "tcp", "version", version.c_str());
  MDNS.addServiceTxt("esphomelib", "tcp", "config_hash", hash.c_str());
  MDNS.addServiceTxt("esphomelib", "tcp", "mac", mac.c_str());
  MDNS.addServiceTxt("esphomelib", "tcp", "platform", "ESP32");
  MDNS.addServiceTxt("esphomelib", "tcp", "board", "P1E");
  MDNS.addServiceTxt("esphomelib", "tcp", "network", "wifi");
  MDNS.addServiceTxt("esphomelib", "tcp", "project_name", "p1e");
  MDNS.addServiceTxt("esphomelib", "tcp", "project_version", P1_EMBED_FIRMWARE_VERSION);
  g_haMdnsStarted = true;

  protocolEmitEvent(
    "home_assistant.mdns",
    "\"service\":\"_esphomelib._tcp\",\"host\":" + jsonString(host + ".local") + ",\"port\":" + String(P1_EMBED_HA_PORT)
  );
}

static bool haReadVarintAt(const uint8_t* data, size_t len, size_t& pos, uint32_t& out) {
  out = 0;
  uint8_t shift = 0;
  while (pos < len && shift <= 28) {
    uint8_t b = data[pos++];
    out |= (uint32_t)(b & 0x7f) << shift;
    if ((b & 0x80) == 0) return true;
    shift += 7;
  }
  return false;
}

static bool haReadFixed32At(const uint8_t* data, size_t len, size_t& pos, uint32_t& out) {
  if (pos + 4 > len) return false;
  out = (uint32_t)data[pos] | ((uint32_t)data[pos + 1] << 8) | ((uint32_t)data[pos + 2] << 16) | ((uint32_t)data[pos + 3] << 24);
  pos += 4;
  return true;
}

static bool haSkipField(uint8_t wire, const uint8_t* data, size_t len, size_t& pos) {
  uint32_t n = 0;
  switch (wire) {
    case 0:
      return haReadVarintAt(data, len, pos, n);
    case 2:
      if (!haReadVarintAt(data, len, pos, n)) return false;
      if (pos + n > len) return false;
      pos += n;
      return true;
    case 5:
      if (pos + 4 > len) return false;
      pos += 4;
      return true;
    default:
      return false;
  }
}

static void haParseCommand(uint32_t messageType, const uint8_t* data, size_t len) {
  uint32_t key = 0;
  bool haveState = false;
  bool state = false;
  bool haveValue = false;
  float value = 0.0f;
  size_t pos = 0;

  while (pos < len) {
    uint32_t tag = 0;
    if (!haReadVarintAt(data, len, pos, tag)) return;
    uint32_t field = tag >> 3;
    uint8_t wire = (uint8_t)(tag & 7);
    if (field == 1 && wire == 5) {
      haReadFixed32At(data, len, pos, key);
    } else if ((messageType == 33 && field == 2 && wire == 0) || (messageType == 32 && field == 3 && wire == 0)) {
      uint32_t raw = 0;
      if (!haReadVarintAt(data, len, pos, raw)) return;
      haveState = true;
      state = raw != 0;
    } else if ((messageType == 51 && field == 2 && wire == 5) || (messageType == 32 && field == 5 && wire == 5)) {
      uint32_t raw = 0;
      if (!haReadFixed32At(data, len, pos, raw)) return;
      union {
        uint32_t u;
        float f;
      } cvt;
      cvt.u = raw;
      haveValue = true;
      value = cvt.f;
    } else {
      if (!haSkipField(wire, data, len, pos)) return;
    }
  }

  int idx = haFindEntityByKey(key);
  if (idx < 0) {
    P1EventField fields[] = {
      p1FieldUInt("messageType", messageType),
      p1FieldString("messageName", haMessageName(messageType)),
      p1FieldUInt("key", key),
    };
    debugEventEmitFields("home_assistant.command", "warn", "home_assistant", "command for unknown key", fields, 3);
    return;
  }
  P1HaEntity& entity = g_haEntities[idx];
  {
    P1EventField fields[] = {
      p1FieldString("id", entity.id),
      p1FieldString("entityType", entity.type == P1_HA_LIGHT ? "light" : (entity.type == P1_HA_NUMBER ? "number" : (entity.type == P1_HA_SWITCH ? "switch" : (entity.type == P1_HA_BUTTON ? "button" : "other")))),
      p1FieldString("messageName", haMessageName(messageType)),
      p1FieldBool("haveState", haveState),
      p1FieldBool("haveValue", haveValue),
      p1FieldInt("value", (int)value),
    };
    debugEventEmitFields("home_assistant.command", "trace", "home_assistant", "command parsed", fields, 6);
  }
  if (messageType == 62) {
    haQueueEvent(entity.id, "press", 1.0f);
    return;
  }
  if (messageType == 32 && haveValue) value = constrain(value, 0.0f, 1.0f) * 100.0f;
  if (!haveValue && haveState) value = state ? 1.0f : 0.0f;
  if (!haveValue && !haveState) return;
  entity.value = value;
  entity.changed = true;
  haSendStateOne(entity);
  haQueueEvent(entity.id, "set", value);
}

static void haHandleFrame(uint32_t type, const uint8_t* data, size_t len) {
  (void)data;
  (void)len;
  haTraceFrame("rx", type, len);
  switch (type) {
    case 1:
      g_haClientHello = true;
      haSendHello();
      break;
    case 3:
      haSendEmpty(4);
      break;
    case 5:
      haSendEmpty(6);
      g_haClient.stop();
      break;
    case 7:
      haSendEmpty(8);
      break;
    case 9:
      haSendDeviceInfo();
      break;
    case 11:
      haSendEntityList();
      break;
    case 20:
      g_haClientSubscribed = true;
      haSendAllStates();
      break;
    case 32:
    case 33:
    case 51:
    case 62:
      haParseCommand(type, data, len);
      break;
    default:
      break;
  }
}

static void haParseRx() {
  while (g_haRxLen > 0) {
    if (g_haRx[0] != 0) {
      memmove(g_haRx, g_haRx + 1, g_haRxLen - 1);
      g_haRxLen--;
      continue;
    }

    size_t pos = 1;
    uint32_t size = 0;
    uint32_t type = 0;
    if (!haReadVarintAt(g_haRx, g_haRxLen, pos, size)) return;
    if (!haReadVarintAt(g_haRx, g_haRxLen, pos, type)) return;
    if (size > P1_EMBED_HA_RX_MAX) {
      g_haClient.stop();
      g_haRxLen = 0;
      return;
    }
    if (g_haRxLen - pos < size) return;
    haHandleFrame(type, g_haRx + pos, size);
    size_t consumed = pos + size;
    if (consumed < g_haRxLen) memmove(g_haRx, g_haRx + consumed, g_haRxLen - consumed);
    g_haRxLen -= consumed;
  }
}

void haBridgeBegin() {
  g_haDeviceName[0] = 0;
  haRuntimeReset();
}

void haBridgeLoop() {
  if (!g_haRuntimeActive) {
    if (g_haClient) g_haClient.stop();
    if (g_haServerStarted) {
      g_haServer.end();
      g_haServerStarted = false;
      debugLog("info", "home_assistant", "ESPHome native API inactive");
    }
    return;
  }

  if (!wifiIsConnected()) return;

  haStartMdns();

  if (!g_haServerStarted) {
    g_haServer.begin(P1_EMBED_HA_PORT);
    g_haServer.setNoDelay(true);
    g_haServerStarted = true;
    debugLog("info", "home_assistant", String("ESPHome native API listening on port ") + P1_EMBED_HA_PORT);
  }

  if (!g_haClient || !g_haClient.connected()) {
    WiFiClient incoming = g_haServer.available();
    if (incoming) {
      if (g_haClient) g_haClient.stop();
      g_haClient = incoming;
      g_haClient.setNoDelay(true);
      g_haClientSubscribed = false;
      g_haClientHello = false;
      g_haRxLen = 0;
      debugLog("info", "home_assistant", "ESPHome native API client connected");
    }
    return;
  }

  while (g_haClient.available() && g_haRxLen < sizeof(g_haRx)) {
    g_haRx[g_haRxLen++] = (uint8_t)g_haClient.read();
  }
  if (g_haRxLen >= sizeof(g_haRx) && g_haClient.available()) {
    g_haClient.stop();
    g_haRxLen = 0;
    return;
  }
  haParseRx();
}

void haRuntimeReset() {
  g_haRuntimeActive = false;
  if (g_haClient) g_haClient.stop();
  if (g_haServerStarted) {
    g_haServer.end();
    g_haServerStarted = false;
  }
  g_haClientSubscribed = false;
  g_haClientHello = false;
  g_haRxLen = 0;
  portENTER_CRITICAL(&g_haMux);
  g_haEventHead = 0;
  g_haEventTail = 0;
  g_haEventCount = 0;
  portEXIT_CRITICAL(&g_haMux);
  for (int i = 0; i < P1_EMBED_HA_ENTITY_MAX; i++) g_haEntities[i] = P1HaEntity{};
}

bool haBeginDevice(const String& name) {
  String clean = name;
  clean.trim();
  haRuntimeReset();
  haCopy(g_haDeviceName, sizeof(g_haDeviceName), clean.length() ? clean : configDeviceName());
  g_haRuntimeActive = true;
  return true;
}

bool haDeclareSensor(const String& id, const String& name, float value, const String& unit) {
  int idx = haFindOrCreate(P1_HA_SENSOR, id);
  if (idx < 0) return false;
  haCopy(g_haEntities[idx].name, sizeof(g_haEntities[idx].name), name.length() ? name : id);
  haCopy(g_haEntities[idx].unit, sizeof(g_haEntities[idx].unit), unit);
  g_haEntities[idx].value = value;
  if (g_haClientSubscribed) haSendStateOne(g_haEntities[idx]);
  return true;
}

bool haDeclareBinarySensor(const String& id, const String& name, bool value) {
  int idx = haFindOrCreate(P1_HA_BINARY_SENSOR, id);
  if (idx < 0) return false;
  haCopy(g_haEntities[idx].name, sizeof(g_haEntities[idx].name), name.length() ? name : id);
  g_haEntities[idx].value = value ? 1.0f : 0.0f;
  if (g_haClientSubscribed) haSendStateOne(g_haEntities[idx]);
  return true;
}

bool haDeclareSwitch(const String& id, const String& name, bool value) {
  int idx = haFindOrCreate(P1_HA_SWITCH, id);
  if (idx < 0) return false;
  haCopy(g_haEntities[idx].name, sizeof(g_haEntities[idx].name), name.length() ? name : id);
  g_haEntities[idx].value = value ? 1.0f : 0.0f;
  if (g_haClientSubscribed) haSendStateOne(g_haEntities[idx]);
  return true;
}

bool haDeclareNumber(const String& id, const String& name, float value, float minValue, float maxValue, float step) {
  int idx = haFindOrCreate(P1_HA_NUMBER, id);
  if (idx < 0) return false;
  haCopy(g_haEntities[idx].name, sizeof(g_haEntities[idx].name), name.length() ? name : id);
  g_haEntities[idx].value = value;
  g_haEntities[idx].minValue = minValue;
  g_haEntities[idx].maxValue = maxValue;
  g_haEntities[idx].step = step > 0.0f ? step : 1.0f;
  if (g_haClientSubscribed) haSendStateOne(g_haEntities[idx]);
  return true;
}

bool haDeclareButton(const String& id, const String& name) {
  int idx = haFindOrCreate(P1_HA_BUTTON, id);
  if (idx < 0) return false;
  haCopy(g_haEntities[idx].name, sizeof(g_haEntities[idx].name), name.length() ? name : id);
  return true;
}

bool haDeclareLight(const String& id, const String& name, float brightness) {
  int idx = haFindOrCreate(P1_HA_LIGHT, id);
  if (idx < 0) return false;
  haCopy(g_haEntities[idx].name, sizeof(g_haEntities[idx].name), name.length() ? name : id);
  g_haEntities[idx].value = constrain(brightness, 0.0f, 100.0f);
  if (g_haClientSubscribed) haSendStateOne(g_haEntities[idx]);
  return true;
}

bool haUpdateValue(const String& id, float value) {
  int idx = haFindEntityById(id);
  if (idx < 0) return false;
  g_haEntities[idx].value = value;
  g_haEntities[idx].changed = false;
  if (g_haClientSubscribed) haSendStateOne(g_haEntities[idx]);
  return true;
}

bool haInputValue(const String& id, float& valueOut) {
  int idx = haFindEntityById(id);
  if (idx < 0) return false;
  valueOut = g_haEntities[idx].value;
  return true;
}

bool haInputChanged(const String& id) {
  int idx = haFindEntityById(id);
  if (idx < 0) return false;
  bool changed = g_haEntities[idx].changed;
  g_haEntities[idx].changed = false;
  return changed;
}

bool haInputPop(P1HaInputEvent& event) {
  bool found = false;
  portENTER_CRITICAL(&g_haMux);
  if (g_haEventCount > 0) {
    event = g_haEvents[g_haEventTail];
    g_haEventTail = (uint8_t)((g_haEventTail + 1) % P1_EMBED_HA_EVENT_DEPTH);
    g_haEventCount--;
    found = true;
  }
  portEXIT_CRITICAL(&g_haMux);
  return found;
}

bool haInputTakeMatching(const String& id, const String& type, P1HaInputEvent& event) {
  return haTakeMatchingEvent(id.c_str(), type.c_str(), event);
}

bool haPressButton(const String& id) {
  int idx = haFindEntityById(id);
  if (idx < 0 || g_haEntities[idx].type != P1_HA_BUTTON) return false;
  haQueueEvent(g_haEntities[idx].id, "press", 1.0f);
  haSendHomeAssistantButtonEvent(g_haEntities[idx]);
  return true;
}

#else

void haBridgeBegin() {}
void haBridgeLoop() {}
void haRuntimeReset() {}
bool haBeginDevice(const String&) { return false; }
bool haDeclareSensor(const String&, const String&, float, const String&) { return false; }
bool haDeclareBinarySensor(const String&, const String&, bool) { return false; }
bool haDeclareSwitch(const String&, const String&, bool) { return false; }
bool haDeclareNumber(const String&, const String&, float, float, float, float) { return false; }
bool haDeclareButton(const String&, const String&) { return false; }
bool haDeclareLight(const String&, const String&, float) { return false; }
bool haUpdateValue(const String&, float) { return false; }
bool haInputValue(const String&, float&) { return false; }
bool haInputChanged(const String&) { return false; }
bool haInputPop(P1HaInputEvent&) { return false; }
bool haInputTakeMatching(const String&, const String&, P1HaInputEvent&) { return false; }
bool haPressButton(const String&) { return false; }

#endif
