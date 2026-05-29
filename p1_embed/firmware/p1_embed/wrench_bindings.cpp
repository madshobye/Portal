#include <Arduino.h>
#include <ESP.h>
#include <WiFi.h>
#include <Wire.h>
#include "p1_embed_firmware.h"

static int wrArgInt(const WRValue* argv, int argn, int idx, int def) {
  if (!argv || idx >= argn) return def;
  const WRValue& v = argv[idx];
  if (v.isInt()) return v.asInt();
  if (v.isFloat()) return (int)v.asFloat();
  char buf[32];
  v.asString(buf, sizeof(buf));
  return atoi(buf);
}

static float wrArgFloat(const WRValue* argv, int argn, int idx, float def) {
  if (!argv || idx >= argn) return def;
  const WRValue& v = argv[idx];
  if (v.isFloat()) return v.asFloat();
  if (v.isInt()) return (float)v.asInt();
  char buf[32];
  v.asString(buf, sizeof(buf));
  return (float)atof(buf);
}

static const char* wrArgString(const WRValue* argv, int argn, int idx, char* buf, size_t buflen) {
  if (!buf || buflen == 0) return "";
  buf[0] = 0;
  if (!argv || idx >= argn) return buf;
  unsigned int strLen = 0;
  argv[idx].asString(buf, (unsigned int)buflen, &strLen);
  if (strLen >= buflen) {
    scriptErrorWarn("binding", "argument_truncated", "Wrench string argument was truncated", "\"argIndex\":" + String(idx) + ",\"bufferBytes\":" + String(buflen) + ",\"stringBytes\":" + String(strLen));
  }
  return buf;
}

static void wrRetInt(WRValue& retVal, int v) {
  wr_makeInt(&retVal, v);
}

static void wrRetFloat(WRValue& retVal, float v) {
  wr_makeFloat(&retVal, v);
}

static void wrRetString(WRContext* ctx, WRValue& retVal, const String& v) {
  wr_makeString(ctx, &retVal, v.c_str(), (int)v.length());
}

static String wrArgStringValue(const WRValue* argv, int argn, int idx) {
  char buf[512];
  return String(wrArgString(argv, argn, idx, buf, sizeof(buf)));
}

static String wrArgStringValueMax(const WRValue* argv, int argn, int idx, int maxBytes) {
  if (!argv || idx >= argn) return "";

  const WRValue& v = argv[idx];
  int stringLen = 0;
  if (!v.isString(&stringLen)) {
    char buf[64];
    v.asString(buf, sizeof(buf));
    return String(buf);
  }

  int cap = constrain(maxBytes, 1, P1_EMBED_JSON_ARG_MAX_BYTES);
  if (stringLen < cap) cap = stringLen;

  char* buf = (char*)malloc((size_t)cap + 1);
  if (!buf) {
    scriptErrorWarn("binding", "argument_alloc_failed", "Could not allocate Wrench string argument buffer", "\"argIndex\":" + String(idx) + ",\"bytes\":" + String(cap + 1));
    return "";
  }

  unsigned int copied = 0;
  v.asString(buf, (unsigned int)cap, &copied);
  buf[cap] = 0;
  String out(buf);
  free(buf);

  if (stringLen > cap) {
    scriptErrorWarn("binding", "argument_truncated", "Wrench string argument was truncated", "\"argIndex\":" + String(idx) + ",\"bufferBytes\":" + String(cap) + ",\"stringBytes\":" + String(stringLen));
  }
  return out;
}

static bool wrArgPresent(const WRValue* argv, int argn, int idx) {
  return argv && idx < argn;
}

static void hsvToRgb8(int h, int s, int v, int& r, int& g, int& b) {
  h = constrain(h, 0, 255);
  s = constrain(s, 0, 255);
  v = constrain(v, 0, 255);

  if (s <= 0) {
    r = v;
    g = v;
    b = v;
    return;
  }

  int region = h / 43;
  int remainder = (h - (region * 43)) * 6;
  int p = (v * (255 - s)) / 255;
  int q = (v * (255 - ((s * remainder) / 255))) / 255;
  int t = (v * (255 - ((s * (255 - remainder)) / 255))) / 255;

  if (region == 0) {
    r = v; g = t; b = p;
  } else if (region == 1) {
    r = q; g = v; b = p;
  } else if (region == 2) {
    r = p; g = v; b = t;
  } else if (region == 3) {
    r = p; g = q; b = v;
  } else if (region == 4) {
    r = t; g = p; b = v;
  } else {
    r = v; g = p; b = q;
  }
}

static void rgbToHsv8(int r, int g, int b, int& h, int& s, int& v) {
  r = constrain(r, 0, 255);
  g = constrain(g, 0, 255);
  b = constrain(b, 0, 255);

  int maxValue = max(r, max(g, b));
  int minValue = min(r, min(g, b));
  int delta = maxValue - minValue;

  v = maxValue;
  s = maxValue == 0 ? 0 : (delta * 255) / maxValue;

  if (delta == 0) {
    h = 0;
  } else if (maxValue == r) {
    h = (43 * (g - b)) / delta;
  } else if (maxValue == g) {
    h = 85 + (43 * (b - r)) / delta;
  } else {
    h = 171 + (43 * (r - g)) / delta;
  }

  while (h < 0) h += 255;
  while (h >= 255) h -= 255;
}

static String wrStripJsonObjectBraces(String fields) {
  fields.trim();
  if (fields.startsWith("{") && fields.endsWith("}")) {
    fields = fields.substring(1, fields.length() - 1);
    fields.trim();
  }
  return fields;
}

static String wrJsonJoinArgs(const WRValue* argv, int argn, int startIdx) {
  String out;
  for (int i = startIdx; i < argn; i++) {
    String part = wrArgStringValueMax(argv, argn, i, P1_EMBED_JSON_ARG_MAX_BYTES);
    part = wrStripJsonObjectBraces(part);
    if (!part.length()) continue;
    if (out.length()) out += ",";
    out += part;
  }
  return out;
}

static String wrStatusValue(const String& key) {
  if (!key.length()) {
    String out = "{";
    out += "\"uptimeMs\":" + String(millis());
    out += ",\"freeHeap\":" + String(ESP.getFreeHeap());
    out += ",\"minFreeHeap\":" + String(ESP.getMinFreeHeap());
    out += ",\"scriptState\":" + jsonString(wrenchStateName());
    out += ",\"wrenchLoopCount\":" + String(wrenchLoopCount());
    out += ",\"deviceId\":" + jsonString(configDeviceId());
    out += ",\"deviceName\":" + jsonString(configDeviceName());
    out += ",\"wifi\":" + wifiStatusJson();
    out += "}";
    return out;
  }
  if (key == "uptimeMs") return String(millis());
  if (key == "freeHeap") return String(ESP.getFreeHeap());
  if (key == "minFreeHeap") return String(ESP.getMinFreeHeap());
  if (key == "scriptState") return String(wrenchStateName());
  if (key == "wrenchLoopCount" || key == "loopCount") return String(wrenchLoopCount());
  if (key == "deviceId") return configDeviceId();
  if (key == "deviceName") return configDeviceName();
  if (key == "wifi") return wifiStatusJson();
  if (key == "led") return ledStatusJson();
  if (key == "uart" || key == "serial") return uartStatusJson();
  if (key == "http") return httpFetchStatusJson();
  return "";
}

static String wrConfigValue(const String& key) {
  if (!key.length()) return configAsJson();
  if (key == "deviceId") return configDeviceId();
  if (key == "deviceName") return configDeviceName();
  if (key == "wifiSsid") return configWifiSsid();
  if (key == "wifiNetworkCount") return String(configWifiNetworkCount());
  if (key == "wifi") return wifiStatusJson();
  if (key == "led") return ledStatusJson();
  if (key == "uart" || key == "serial") return uartStatusJson();
  if (key == "http") return httpFetchStatusJson();
  return "";
}

static String wrWifiValue(const String& key) {
  String json = wifiStatusJson();
  if (!key.length()) return json;
  if (key == "configured") return configWifiSsid().length() ? "true" : "false";
  if (key == "networkCount") return String(configWifiNetworkCount());
  if (key == "ssid") return configWifiSsid();
  if (key == "json") return json;
  return "";
}

static String g_lastInboxChannel = "";
static String g_lastUiEventId = "";
static String g_lastUiEventType = "";
static String g_lastUiEventText = "";
static int g_lastUiEventValue = 0;

struct P1UiInputEvent {
  char id[P1_EMBED_UI_ID_MAX];
  char type[P1_EMBED_UI_TYPE_MAX];
  char text[P1_EMBED_UI_TEXT_MAX];
  int value;
};

struct P1UiStateEntry {
  char id[P1_EMBED_UI_ID_MAX];
  char text[P1_EMBED_UI_TEXT_MAX];
  int value;
  bool used;
  bool changed;
};

struct P1UiOutputEntry {
  char id[P1_EMBED_UI_ID_MAX];
  int value;
  bool used;
};

static portMUX_TYPE g_uiInputMux = portMUX_INITIALIZER_UNLOCKED;
static P1UiInputEvent g_uiEvents[P1_EMBED_UI_EVENT_DEPTH];
static P1UiStateEntry g_uiStates[P1_EMBED_UI_STATE_MAX];
static P1UiOutputEntry g_uiOutputs[P1_EMBED_UI_STATE_MAX];
static uint8_t g_uiEventHead = 0;
static uint8_t g_uiEventTail = 0;
static uint8_t g_uiEventCount = 0;
static uint32_t g_uiInputDrops = 0;

static void uiCopy(char* dst, size_t len, const String& src) {
  if (!dst || len == 0) return;
  strncpy(dst, src.c_str(), len - 1);
  dst[len - 1] = 0;
}

static bool uiParseInput(const String& channel, const String& message, P1UiInputEvent& event) {
  if (channel != "ui" && !channel.startsWith("ui.") && !channel.startsWith("ui:")) return false;
  String id = channel == "ui" ? String("system") : channel.substring(3);
  id.trim();
  if (!id.length()) id = "system";

  String type = "message";
  int value = 0;
  if (message.startsWith("set:")) {
    type = "set";
    value = message.substring(4).toInt();
  } else if (message == "press") {
    type = "press";
    value = 1;
  } else if (message == "hello" || message == "refresh") {
    type = "hello";
  }

  uiCopy(event.id, sizeof(event.id), id);
  uiCopy(event.type, sizeof(event.type), type);
  uiCopy(event.text, sizeof(event.text), message);
  event.value = value;
  return true;
}

static int uiFindStateLocked(const char* id) {
  for (int i = 0; i < P1_EMBED_UI_STATE_MAX; i++) {
    if (g_uiStates[i].used && strncmp(g_uiStates[i].id, id, P1_EMBED_UI_ID_MAX) == 0) return i;
  }
  return -1;
}

static int uiFindOrCreateStateLocked(const char* id) {
  int index = uiFindStateLocked(id);
  if (index >= 0) return index;
  for (int i = 0; i < P1_EMBED_UI_STATE_MAX; i++) {
    if (!g_uiStates[i].used) {
      g_uiStates[i].used = true;
      strncpy(g_uiStates[i].id, id, sizeof(g_uiStates[i].id) - 1);
      g_uiStates[i].id[sizeof(g_uiStates[i].id) - 1] = 0;
      g_uiStates[i].text[0] = 0;
      g_uiStates[i].value = 0;
      g_uiStates[i].changed = false;
      return i;
    }
  }
  return -1;
}

bool uiInputIsChannel(const String& channel) {
  return channel == "ui" || channel.startsWith("ui.") || channel.startsWith("ui:");
}

bool uiInputPush(const String& channel, const String& message) {
  P1UiInputEvent event;
  if (!uiParseInput(channel, message, event)) return false;

  portENTER_CRITICAL(&g_uiInputMux);
  int stateIndex = uiFindOrCreateStateLocked(event.id);
  if (stateIndex >= 0) {
    if (strncmp(event.type, "set", sizeof(event.type)) == 0) {
      g_uiStates[stateIndex].value = event.value;
      g_uiStates[stateIndex].changed = true;
    }
    strncpy(g_uiStates[stateIndex].text, event.text, sizeof(g_uiStates[stateIndex].text) - 1);
    g_uiStates[stateIndex].text[sizeof(g_uiStates[stateIndex].text) - 1] = 0;
  }

  if (g_uiEventCount >= P1_EMBED_UI_EVENT_DEPTH) {
    g_uiEventTail = (uint8_t)((g_uiEventTail + 1) % P1_EMBED_UI_EVENT_DEPTH);
    g_uiEventCount--;
    g_uiInputDrops++;
  }
  g_uiEvents[g_uiEventHead] = event;
  g_uiEventHead = (uint8_t)((g_uiEventHead + 1) % P1_EMBED_UI_EVENT_DEPTH);
  g_uiEventCount++;
  portEXIT_CRITICAL(&g_uiInputMux);
  return true;
}

static bool uiInputPop(P1UiInputEvent& event) {
  portENTER_CRITICAL(&g_uiInputMux);
  if (g_uiEventCount == 0) {
    portEXIT_CRITICAL(&g_uiInputMux);
    return false;
  }
  event = g_uiEvents[g_uiEventTail];
  g_uiEventTail = (uint8_t)((g_uiEventTail + 1) % P1_EMBED_UI_EVENT_DEPTH);
  g_uiEventCount--;
  portEXIT_CRITICAL(&g_uiInputMux);
  return true;
}

uint32_t uiInputQueued() {
  portENTER_CRITICAL(&g_uiInputMux);
  uint32_t count = g_uiEventCount;
  portEXIT_CRITICAL(&g_uiInputMux);
  return count;
}

uint32_t uiInputDrops() {
  return g_uiInputDrops;
}

static int uiInputValue(const String& id, int fallback) {
  char idBuf[P1_EMBED_UI_ID_MAX];
  uiCopy(idBuf, sizeof(idBuf), id);
  portENTER_CRITICAL(&g_uiInputMux);
  int index = uiFindStateLocked(idBuf);
  int value = index >= 0 ? g_uiStates[index].value : fallback;
  portEXIT_CRITICAL(&g_uiInputMux);
  return value;
}

static bool uiInputChanged(const String& id) {
  char idBuf[P1_EMBED_UI_ID_MAX];
  uiCopy(idBuf, sizeof(idBuf), id);
  portENTER_CRITICAL(&g_uiInputMux);
  int index = uiFindStateLocked(idBuf);
  bool changed = index >= 0 && g_uiStates[index].changed;
  if (index >= 0) g_uiStates[index].changed = false;
  portEXIT_CRITICAL(&g_uiInputMux);
  return changed;
}

static int uiFindOutputLocked(const char* id) {
  for (int i = 0; i < P1_EMBED_UI_STATE_MAX; i++) {
    if (g_uiOutputs[i].used && strncmp(g_uiOutputs[i].id, id, P1_EMBED_UI_ID_MAX) == 0) return i;
  }
  return -1;
}

static int uiFindOrCreateOutputLocked(const char* id) {
  int index = uiFindOutputLocked(id);
  if (index >= 0) return index;
  for (int i = 0; i < P1_EMBED_UI_STATE_MAX; i++) {
    if (!g_uiOutputs[i].used) {
      g_uiOutputs[i].used = true;
      strncpy(g_uiOutputs[i].id, id, sizeof(g_uiOutputs[i].id) - 1);
      g_uiOutputs[i].id[sizeof(g_uiOutputs[i].id) - 1] = 0;
      g_uiOutputs[i].value = 0;
      return i;
    }
  }
  return -1;
}

static void uiClearOutputCache() {
  portENTER_CRITICAL(&g_uiInputMux);
  for (int i = 0; i < P1_EMBED_UI_STATE_MAX; i++) {
    g_uiOutputs[i].used = false;
    g_uiOutputs[i].id[0] = 0;
    g_uiOutputs[i].value = 0;
  }
  portEXIT_CRITICAL(&g_uiInputMux);
}

static bool uiOutputValueChanged(const String& id, int value) {
  char idBuf[P1_EMBED_UI_ID_MAX];
  uiCopy(idBuf, sizeof(idBuf), id);
  portENTER_CRITICAL(&g_uiInputMux);
  int index = uiFindOrCreateOutputLocked(idBuf);
  bool changed = index < 0 || g_uiOutputs[index].value != value;
  if (index >= 0) g_uiOutputs[index].value = value;
  portEXIT_CRITICAL(&g_uiInputMux);
  return changed;
}

static void w_p1_print(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  char buf[512];
  protocolEmitPrint(wrArgString(argv, argn, 0, buf, sizeof(buf)), false);
  wrRetInt(retVal, 0);
}

static void w_p1_println(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  char buf[512];
  protocolEmitPrint(wrArgString(argv, argn, 0, buf, sizeof(buf)), true);
  wrRetInt(retVal, 0);
}

static void w_p1_pinMode(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int pin = wrArgInt(argv, argn, 0, -1);
  int mode = wrArgInt(argv, argn, 1, INPUT);
  if (pin >= 0) pinMode(pin, mode);
  wrRetInt(retVal, 0);
}

static void w_p1_digitalWrite(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int pin = wrArgInt(argv, argn, 0, -1);
  int value = wrArgInt(argv, argn, 1, LOW);
  if (pin >= 0) digitalWrite(pin, value);
  wrRetInt(retVal, 0);
}

static void w_p1_digitalRead(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int pin = wrArgInt(argv, argn, 0, -1);
  wrRetInt(retVal, pin >= 0 ? digitalRead(pin) : 0);
}

static void w_p1_analogRead(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int pin = wrArgInt(argv, argn, 0, -1);
  wrRetInt(retVal, pin >= 0 ? analogRead(pin) : 0);
}

static void w_p1_touchRead(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int pin = wrArgInt(argv, argn, 0, -1);
  wrRetInt(retVal, pin >= 0 ? touchRead(pin) : 0);
}

static void w_p1_delay(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int ms = wrArgInt(argv, argn, 0, 0);
  delay((uint32_t)max(0, ms));
  wrRetInt(retVal, 0);
}

static void w_p1_delayMicroseconds(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int us = wrArgInt(argv, argn, 0, 0);
  delayMicroseconds((uint32_t)max(0, us));
  wrRetInt(retVal, 0);
}

static void w_p1_millis(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  wrRetInt(retVal, (int)millis());
}

static void w_p1_micros(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  wrRetInt(retVal, (int)micros());
}

static void w_p1_random(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  if (argn <= 0) {
    wrRetInt(retVal, (int)random(0x7fffffff));
  } else if (argn == 1) {
    long maxValue = wrArgInt(argv, argn, 0, 0);
    wrRetInt(retVal, maxValue > 0 ? (int)random(maxValue) : 0);
  } else {
    long minValue = wrArgInt(argv, argn, 0, 0);
    long maxValue = wrArgInt(argv, argn, 1, 0);
    wrRetInt(retVal, maxValue > minValue ? (int)random(minValue, maxValue) : (int)minValue);
  }
}

static void w_p1_randomSeed(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  randomSeed((uint32_t)wrArgInt(argv, argn, 0, 0));
  wrRetInt(retVal, 0);
}

static void w_p1_freeHeap(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  wrRetInt(retVal, (int)ESP.getFreeHeap());
}

static void w_p1_wifiConnected(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  wrRetInt(retVal, WiFi.status() == WL_CONNECTED ? 1 : 0);
}

static void w_p1_wifiIp(WRContext* ctx, const WRValue*, const int, WRValue& retVal, void*) {
  wrRetString(ctx, retVal, WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : String(""));
}

static void w_p1_wifiRssi(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  wrRetInt(retVal, WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0);
}

static void w_p1_wifiSsid(WRContext* ctx, const WRValue*, const int, WRValue& retVal, void*) {
  wrRetString(ctx, retVal, WiFi.status() == WL_CONNECTED ? WiFi.SSID() : configWifiSsid());
}

static void w_p1_wireBegin(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  bool ok = false;
  if (argn >= 2) {
    int sda = wrArgInt(argv, argn, 0, -1);
    int scl = wrArgInt(argv, argn, 1, -1);
    ok = sda >= 0 && scl >= 0 ? Wire.begin(sda, scl) : Wire.begin();
  } else {
    ok = Wire.begin();
  }
  if (!ok) scriptErrorSet("binding", "wire_begin_failed", "wireBegin failed");
  wrRetInt(retVal, ok ? 1 : 0);
}

static void w_p1_i2cWrite(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int addr = wrArgInt(argv, argn, 0, -1);
  int reg = wrArgInt(argv, argn, 1, -1);
  int value = wrArgInt(argv, argn, 2, -1);
  if (addr < 0 || reg < 0) {
    scriptErrorSet("binding", "i2c_bad_args", "i2cWrite requires address and register");
    wrRetInt(retVal, -1);
    return;
  }

  Wire.beginTransmission((uint8_t)addr);
  Wire.write((uint8_t)reg);
  if (argn >= 3) Wire.write((uint8_t)value);
  uint8_t result = Wire.endTransmission();
  if (result != 0) scriptErrorSet("binding", "i2c_write_failed", "i2cWrite transmission failed", "\"wireResult\":" + String(result) + ",\"addr\":" + String(addr) + ",\"reg\":" + String(reg));
  wrRetInt(retVal, result);
}

static void w_p1_i2cRead(WRContext* ctx, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int addr = wrArgInt(argv, argn, 0, -1);
  int reg = wrArgInt(argv, argn, 1, -1);
  int len = constrain(wrArgInt(argv, argn, 2, 1), 1, 32);
  if (addr < 0 || reg < 0) {
    scriptErrorSet("binding", "i2c_bad_args", "i2cRead requires address and register");
    wrRetInt(retVal, -1);
    return;
  }

  Wire.beginTransmission((uint8_t)addr);
  Wire.write((uint8_t)reg);
  uint8_t tx = Wire.endTransmission(false);
  if (tx != 0) {
    scriptErrorSet("binding", "i2c_read_failed", "i2cRead register select failed", "\"wireResult\":" + String(tx) + ",\"addr\":" + String(addr) + ",\"reg\":" + String(reg));
    wrRetInt(retVal, -1 * (int)tx);
    return;
  }

  int got = Wire.requestFrom((uint8_t)addr, (uint8_t)len);
  if (len == 1) {
    if (got > 0 && Wire.available()) {
      wrRetInt(retVal, Wire.read());
    } else {
      scriptErrorSet("binding", "i2c_read_empty", "i2cRead returned no data", "\"addr\":" + String(addr) + ",\"reg\":" + String(reg));
      wrRetInt(retVal, -1);
    }
    return;
  }

  String out = "[";
  for (int i = 0; i < got && Wire.available(); i++) {
    if (i) out += ",";
    out += String(Wire.read());
  }
  out += "]";
  wrRetString(ctx, retVal, out);
}

static void w_p1_serialBegin(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int uart = wrArgInt(argv, argn, 0, -1);
  int rxPin = wrArgInt(argv, argn, 1, -1);
  int txPin = wrArgInt(argv, argn, 2, -1);
  int baud = wrArgInt(argv, argn, 3, 115200);
  bool ok = uartBegin(uart, rxPin, txPin, baud);
  wrRetInt(retVal, ok ? 1 : 0);
}

static void w_p1_serialEnd(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetInt(retVal, uartEnd(wrArgInt(argv, argn, 0, -1)) ? 1 : 0);
}

static void w_p1_serialAvailable(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetInt(retVal, uartAvailable(wrArgInt(argv, argn, 0, -1)));
}

static void w_p1_serialRead(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetInt(retVal, uartReadByte(wrArgInt(argv, argn, 0, -1)));
}

static void w_p1_serialReadString(WRContext* ctx, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int uart = wrArgInt(argv, argn, 0, -1);
  int maxLen = wrArgInt(argv, argn, 1, P1_EMBED_UART_READ_STRING_MAX);
  wrRetString(ctx, retVal, uartReadString(uart, maxLen));
}

static void w_p1_serialWrite(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int uart = wrArgInt(argv, argn, 0, -1);
  String value = wrArgStringValue(argv, argn, 1);
  int written = uartWriteString(uart, value);
  if (written < 0) scriptErrorSet("binding", "uart_write_failed", "serialWrite failed", "\"uart\":" + String(uart));
  wrRetInt(retVal, written);
}

static void w_p1_serialWriteLine(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int uart = wrArgInt(argv, argn, 0, -1);
  String value = wrArgStringValue(argv, argn, 1);
  value += "\n";
  int written = uartWriteString(uart, value);
  if (written < 0) scriptErrorSet("binding", "uart_write_failed", "serialWriteLine failed", "\"uart\":" + String(uart));
  wrRetInt(retVal, written);
}

static void w_p1_serialWriteByte(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int uart = wrArgInt(argv, argn, 0, -1);
  int written = uartWriteByte(uart, wrArgInt(argv, argn, 1, 0));
  if (written < 0) scriptErrorSet("binding", "uart_write_failed", "serialWriteByte failed", "\"uart\":" + String(uart));
  wrRetInt(retVal, written);
}

static void w_p1_serialStatus(WRContext* ctx, const WRValue*, const int, WRValue& retVal, void*) {
  wrRetString(ctx, retVal, uartStatusJson());
}

static void w_p1_httpGet(WRContext* ctx, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String url = wrArgStringValue(argv, argn, 0);
  int maxBytes = wrArgInt(argv, argn, 1, P1_EMBED_HTTP_MAX_RESPONSE_BYTES);
  int timeoutMs = wrArgInt(argv, argn, 2, P1_EMBED_HTTP_DEFAULT_TIMEOUT_MS);
  wrRetString(ctx, retVal, httpFetchGet(url, maxBytes, timeoutMs));
}

static void w_p1_httpJsonGet(WRContext* ctx, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String url = wrArgStringValue(argv, argn, 0);
  String path = wrArgStringValue(argv, argn, 1);
  int maxBytes = wrArgInt(argv, argn, 2, P1_EMBED_HTTP_MAX_RESPONSE_BYTES);
  int timeoutMs = wrArgInt(argv, argn, 3, P1_EMBED_HTTP_DEFAULT_TIMEOUT_MS);
  wrRetString(ctx, retVal, httpFetchJsonGet(url, path, maxBytes, timeoutMs));
}

static void w_p1_httpJsonGetInt(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String url = wrArgStringValue(argv, argn, 0);
  String path = wrArgStringValue(argv, argn, 1);
  int maxBytes = wrArgInt(argv, argn, 2, P1_EMBED_HTTP_MAX_RESPONSE_BYTES);
  int timeoutMs = wrArgInt(argv, argn, 3, P1_EMBED_HTTP_DEFAULT_TIMEOUT_MS);
  wrRetInt(retVal, httpFetchJsonGetInt(url, path, maxBytes, timeoutMs));
}

static void w_p1_httpJsonGetFloat(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String url = wrArgStringValue(argv, argn, 0);
  String path = wrArgStringValue(argv, argn, 1);
  int maxBytes = wrArgInt(argv, argn, 2, P1_EMBED_HTTP_MAX_RESPONSE_BYTES);
  int timeoutMs = wrArgInt(argv, argn, 3, P1_EMBED_HTTP_DEFAULT_TIMEOUT_MS);
  wrRetFloat(retVal, httpFetchJsonGetFloat(url, path, maxBytes, timeoutMs));
}

static void w_p1_httpJsonGetBool(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String url = wrArgStringValue(argv, argn, 0);
  String path = wrArgStringValue(argv, argn, 1);
  int maxBytes = wrArgInt(argv, argn, 2, P1_EMBED_HTTP_MAX_RESPONSE_BYTES);
  int timeoutMs = wrArgInt(argv, argn, 3, P1_EMBED_HTTP_DEFAULT_TIMEOUT_MS);
  wrRetInt(retVal, httpFetchJsonGetBool(url, path, maxBytes, timeoutMs) ? 1 : 0);
}

static void w_p1_fetchJson(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String url = wrArgStringValue(argv, argn, 0);
  int maxBytes = wrArgInt(argv, argn, 1, P1_EMBED_HTTP_MAX_RESPONSE_BYTES);
  int timeoutMs = wrArgInt(argv, argn, 2, P1_EMBED_HTTP_DEFAULT_TIMEOUT_MS);
  wrRetInt(retVal, httpFetchJson(url, maxBytes, timeoutMs));
}

static void w_p1_httpPost(WRContext* ctx, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String url = wrArgStringValue(argv, argn, 0);
  String body = wrArgStringValue(argv, argn, 1);
  String contentType = wrArgStringValue(argv, argn, 2);
  int maxBytes = wrArgInt(argv, argn, 3, P1_EMBED_HTTP_MAX_RESPONSE_BYTES);
  int timeoutMs = wrArgInt(argv, argn, 4, P1_EMBED_HTTP_DEFAULT_TIMEOUT_MS);
  wrRetString(ctx, retVal, httpFetchPost(url, body, contentType, maxBytes, timeoutMs));
}

static void w_p1_httpCode(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  wrRetInt(retVal, httpFetchLastCode());
}

static void w_p1_httpTruncated(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  wrRetInt(retVal, httpFetchLastTruncated() ? 1 : 0);
}

static void w_p1_httpError(WRContext* ctx, const WRValue*, const int, WRValue& retVal, void*) {
  wrRetString(ctx, retVal, httpFetchLastError());
}

static void w_p1_httpStatus(WRContext* ctx, const WRValue*, const int, WRValue& retVal, void*) {
  wrRetString(ctx, retVal, httpFetchStatusJson());
}

static void w_p1_getJsonValue(WRContext* ctx, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetString(ctx, retVal, httpFetchJsonValue(wrArgStringValue(argv, argn, 0)));
}

static void w_p1_getJsonInt(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetInt(retVal, httpFetchJsonValueInt(wrArgStringValue(argv, argn, 0)));
}

static void w_p1_getJsonFloat(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetFloat(retVal, httpFetchJsonValueFloat(wrArgStringValue(argv, argn, 0)));
}

static void w_p1_getJsonBool(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetInt(retVal, httpFetchJsonValueBool(wrArgStringValue(argv, argn, 0)) ? 1 : 0);
}

static void w_p1_jsonGet(WRContext* ctx, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String json = wrArgStringValueMax(argv, argn, 0, P1_EMBED_JSON_ARG_MAX_BYTES);
  String path = wrArgStringValue(argv, argn, 1);
  bool found = false;
  String value = jsonPathGetRaw(json, path, &found);
  wrRetString(ctx, retVal, found ? value : String(""));
}

static void w_p1_jsonGetInt(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String json = wrArgStringValueMax(argv, argn, 0, P1_EMBED_JSON_ARG_MAX_BYTES);
  String path = wrArgStringValue(argv, argn, 1);
  bool found = false;
  String value = jsonPathGetRaw(json, path, &found);
  wrRetInt(retVal, found ? value.toInt() : 0);
}

static void w_p1_jsonGetFloat(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String json = wrArgStringValueMax(argv, argn, 0, P1_EMBED_JSON_ARG_MAX_BYTES);
  String path = wrArgStringValue(argv, argn, 1);
  bool found = false;
  String value = jsonPathGetRaw(json, path, &found);
  wrRetFloat(retVal, found ? value.toFloat() : 0.0f);
}

static void w_p1_jsonGetBool(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String json = wrArgStringValueMax(argv, argn, 0, P1_EMBED_JSON_ARG_MAX_BYTES);
  String path = wrArgStringValue(argv, argn, 1);
  bool found = false;
  String value = jsonPathGetRaw(json, path, &found);
  value.trim();
  value.toLowerCase();
  wrRetInt(retVal, found && (value == "true" || value.toInt() != 0) ? 1 : 0);
}

static void w_p1_jsonHas(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String json = wrArgStringValueMax(argv, argn, 0, P1_EMBED_JSON_ARG_MAX_BYTES);
  String path = wrArgStringValue(argv, argn, 1);
  wrRetInt(retVal, jsonPathHas(json, path) ? 1 : 0);
}

static void w_p1_jsonPair(WRContext* ctx, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetString(ctx, retVal, jsonPairString(wrArgStringValue(argv, argn, 0), wrArgStringValueMax(argv, argn, 1, P1_EMBED_JSON_ARG_MAX_BYTES)));
}

static void w_p1_jsonPairRaw(WRContext* ctx, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetString(ctx, retVal, jsonPairRaw(wrArgStringValue(argv, argn, 0), wrArgStringValueMax(argv, argn, 1, P1_EMBED_JSON_ARG_MAX_BYTES)));
}

static void w_p1_jsonPairInt(WRContext* ctx, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetString(ctx, retVal, jsonPairIntValue(wrArgStringValue(argv, argn, 0), wrArgInt(argv, argn, 1, 0)));
}

static void w_p1_jsonPairFloat(WRContext* ctx, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int decimals = wrArgInt(argv, argn, 2, 2);
  wrRetString(ctx, retVal, jsonPairFloatValue(wrArgStringValue(argv, argn, 0), wrArgFloat(argv, argn, 1, 0.0f), decimals));
}

static void w_p1_jsonPairBool(WRContext* ctx, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetString(ctx, retVal, jsonPairBoolValue(wrArgStringValue(argv, argn, 0), wrArgInt(argv, argn, 1, 0) != 0));
}

static void w_p1_jsonBuild(WRContext* ctx, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetString(ctx, retVal, jsonBuildObject(wrJsonJoinArgs(argv, argn, 0)));
}

// Disabled deliberately: using JSON arrays as temporary tuples in Wrench
// animation loops caused repeated string allocation and malloc_failed stops.
// Keep the implementation nearby in case a future non-hot-path API needs it.
// static void w_p1_jsonArray(WRContext* ctx, const WRValue* argv, const int argn, WRValue& retVal, void*) {
//   String out = "[";
//   for (int i = 0; i < argn; i++) {
//     String part = wrArgStringValueMax(argv, argn, i, P1_EMBED_JSON_ARG_MAX_BYTES);
//     part.trim();
//     if (!part.length()) part = "null";
//     if (i) out += ",";
//     out += part;
//   }
//   out += "]";
//   wrRetString(ctx, retVal, out);
// }

static void w_p1_analogWrite(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int pin = wrArgInt(argv, argn, 0, -1);
  bool ok = pwmAnalogWrite(pin, wrArgInt(argv, argn, 1, 0));
  if (!ok) scriptErrorSet("binding", "analog_write_failed", "analogWrite failed", "\"pin\":" + String(pin));
  wrRetInt(retVal, ok ? 1 : 0);
}

static void w_p1_analogWriteResolution(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int bits = wrArgInt(argv, argn, 0, 8);
  bool ok = pwmAnalogSetResolution(bits);
  if (!ok) scriptErrorSet("binding", "analog_resolution_failed", "analogWriteResolution failed", "\"bits\":" + String(bits));
  wrRetInt(retVal, ok ? 1 : 0);
}

static void w_p1_analogWriteFrequency(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int pin = wrArgInt(argv, argn, 0, -1);
  int hz = wrArgInt(argv, argn, 1, 5000);
  bool ok = pwmAnalogSetFrequency(pin, hz);
  if (!ok) scriptErrorSet("binding", "analog_frequency_failed", "analogWriteFrequency failed", "\"pin\":" + String(pin) + ",\"hz\":" + String(hz));
  wrRetInt(retVal, ok ? 1 : 0);
}

static void w_p1_pwmDetach(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetInt(retVal, pwmDetachPin(wrArgInt(argv, argn, 0, -1)) ? 1 : 0);
}

static void w_p1_servoAttach(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int pin = wrArgInt(argv, argn, 0, -1);
  bool ok = pwmServoAttach(pin);
  if (!ok) scriptErrorSet("binding", "servo_attach_failed", "servoAttach failed", "\"pin\":" + String(pin));
  wrRetInt(retVal, ok ? 1 : 0);
}

static void w_p1_servoWrite(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int pin = wrArgInt(argv, argn, 0, -1);
  bool ok = pwmServoWrite(pin, wrArgInt(argv, argn, 1, 0));
  if (!ok) scriptErrorSet("binding", "servo_write_failed", "servoWrite failed", "\"pin\":" + String(pin));
  wrRetInt(retVal, ok ? 1 : 0);
}

static void w_p1_servoWriteMicroseconds(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int pin = wrArgInt(argv, argn, 0, -1);
  bool ok = pwmServoWriteMicroseconds(pin, wrArgInt(argv, argn, 1, 1500));
  if (!ok) scriptErrorSet("binding", "servo_write_us_failed", "servoWriteMicroseconds failed", "\"pin\":" + String(pin));
  wrRetInt(retVal, ok ? 1 : 0);
}

static void w_p1_servoDetach(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetInt(retVal, pwmServoDetach(wrArgInt(argv, argn, 0, -1)) ? 1 : 0);
}

static void w_p1_fanAttach(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int pin = wrArgInt(argv, argn, 0, -1);
  bool ok = pwmFanAttach(pin);
  if (!ok) scriptErrorSet("binding", "fan_attach_failed", "fanAttach failed", "\"pin\":" + String(pin));
  wrRetInt(retVal, ok ? 1 : 0);
}

static void w_p1_fanWrite(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int pin = wrArgInt(argv, argn, 0, -1);
  bool ok = pwmFanWrite(pin, wrArgInt(argv, argn, 1, 0));
  if (!ok) scriptErrorSet("binding", "fan_write_failed", "fanWrite failed", "\"pin\":" + String(pin));
  wrRetInt(retVal, ok ? 1 : 0);
}

static void w_p1_fanWriteRaw(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int pin = wrArgInt(argv, argn, 0, -1);
  bool ok = pwmFanWriteRaw(pin, wrArgInt(argv, argn, 1, 0));
  if (!ok) scriptErrorSet("binding", "fan_write_raw_failed", "fanWriteRaw failed", "\"pin\":" + String(pin));
  wrRetInt(retVal, ok ? 1 : 0);
}

static void w_p1_fanDetach(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetInt(retVal, pwmFanDetach(wrArgInt(argv, argn, 0, -1)) ? 1 : 0);
}

static void w_p1_ledConfig(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int strip = wrArgInt(argv, argn, 0, 0);
  int pin = wrArgInt(argv, argn, 1, -1);
  int count = wrArgInt(argv, argn, 2, 0);
  int brightness = wrArgInt(argv, argn, 3, 255);
  bool ok = ledConfigureStrip(strip, pin, count, brightness);
  if (!ok && !scriptErrorHasLast()) scriptErrorSet("binding", "led_config_failed", "ledConfig failed", "\"strip\":" + String(strip));
  wrRetInt(retVal, ok ? 1 : 0);
}

static void w_p1_ledReady(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetInt(retVal, ledReady(wrArgInt(argv, argn, 0, 0)) ? 1 : 0);
}

static void w_p1_ledStripCount(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  wrRetInt(retVal, ledStripCount());
}

static void w_p1_ledCount(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetInt(retVal, ledCount(wrArgInt(argv, argn, 0, 0)));
}

static void w_p1_ledSet(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int strip = wrArgInt(argv, argn, 0, 0);
  int index = wrArgInt(argv, argn, 1, -1);
  bool ok = ledSetPixel(strip, index, wrArgInt(argv, argn, 2, 0), wrArgInt(argv, argn, 3, 0), wrArgInt(argv, argn, 4, 0));
  if (!ok) scriptErrorSet("binding", "led_set_failed", "ledSet failed", "\"strip\":" + String(strip) + ",\"index\":" + String(index));
  wrRetInt(retVal, ok ? 1 : 0);
}

static void w_p1_ledSetHsv(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int strip = wrArgInt(argv, argn, 0, 0);
  int index = wrArgInt(argv, argn, 1, -1);
  int r = 0;
  int g = 0;
  int b = 0;
  hsvToRgb8(wrArgInt(argv, argn, 2, 0), wrArgInt(argv, argn, 3, 255), wrArgInt(argv, argn, 4, 255), r, g, b);
  bool ok = ledSetPixel(strip, index, r, g, b);
  if (!ok) scriptErrorSet("binding", "led_set_hsv_failed", "ledSetHsv failed", "\"strip\":" + String(strip) + ",\"index\":" + String(index));
  wrRetInt(retVal, ok ? 1 : 0);
}

static void wrRetHsvComponent(const WRValue* argv, const int argn, WRValue& retVal, int component) {
  int r = 0;
  int g = 0;
  int b = 0;
  hsvToRgb8(wrArgInt(argv, argn, 0, 0), wrArgInt(argv, argn, 1, 255), wrArgInt(argv, argn, 2, 255), r, g, b);
  wrRetInt(retVal, component == 0 ? r : (component == 1 ? g : b));
}

static void w_p1_hsvToR(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetHsvComponent(argv, argn, retVal, 0);
}

static void w_p1_hsvToG(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetHsvComponent(argv, argn, retVal, 1);
}

static void w_p1_hsvToB(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetHsvComponent(argv, argn, retVal, 2);
}

static void wrRetRgbComponent(const WRValue* argv, const int argn, WRValue& retVal, int component) {
  int h = 0;
  int s = 0;
  int v = 0;
  rgbToHsv8(wrArgInt(argv, argn, 0, 0), wrArgInt(argv, argn, 1, 0), wrArgInt(argv, argn, 2, 0), h, s, v);
  wrRetInt(retVal, component == 0 ? h : (component == 1 ? s : v));
}

static void w_p1_rgbToH(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetRgbComponent(argv, argn, retVal, 0);
}

static void w_p1_rgbToS(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetRgbComponent(argv, argn, retVal, 1);
}

static void w_p1_rgbToV(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetRgbComponent(argv, argn, retVal, 2);
}

static void w_p1_ledFill(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int strip = wrArgInt(argv, argn, 0, 0);
  bool ok = ledFill(strip, wrArgInt(argv, argn, 1, 0), wrArgInt(argv, argn, 2, 0), wrArgInt(argv, argn, 3, 0));
  if (!ok) scriptErrorSet("binding", "led_fill_failed", "ledFill failed", "\"strip\":" + String(strip));
  wrRetInt(retVal, ok ? 1 : 0);
}

static void w_p1_ledClear(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int strip = wrArgInt(argv, argn, 0, -1);
  bool show = wrArgPresent(argv, argn, 1) ? wrArgInt(argv, argn, 1, 1) != 0 : true;
  bool ok = ledClear(strip, show);
  if (!ok) scriptErrorSet("binding", "led_clear_failed", "ledClear failed", "\"strip\":" + String(strip));
  wrRetInt(retVal, ok ? 1 : 0);
}

static void w_p1_ledShow(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  bool ok = fastLedShow();
  if (!ok) scriptErrorSet("binding", "led_show_failed", "ledShow failed");
  wrRetInt(retVal, ok ? 1 : 0);
}

static void w_p1_ledBrightness(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int strip = wrArgInt(argv, argn, 0, 0);
  bool ok = ledSetBrightness(strip, wrArgInt(argv, argn, 1, 255));
  if (!ok) scriptErrorSet("binding", "led_brightness_failed", "ledBrightness failed", "\"strip\":" + String(strip));
  wrRetInt(retVal, ok ? 1 : 0);
}

static void w_p1_ledStatus(WRContext* ctx, const WRValue*, const int, WRValue& retVal, void*) {
  wrRetString(ctx, retVal, ledStatusJson());
}

static void w_p1_log(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String level = wrArgStringValue(argv, argn, 0);
  String message = wrArgStringValue(argv, argn, 1);
  if (!level.length()) level = "info";
  debugLog(level, "script", message);
  wrRetInt(retVal, 0);
}

static void w_p1_emit(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String name = wrArgStringValue(argv, argn, 0);
  String message = wrArgStringValue(argv, argn, 1);
  if (!name.length()) name = "script.event";
  debugEventEmit(name, "info", "script", message);
  wrRetInt(retVal, 0);
}

static void w_p1_emitJson(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String name = wrArgStringValue(argv, argn, 0);
  String fields = wrJsonJoinArgs(argv, argn, 1);
  if (!name.length()) name = "script.event";
  debugEventEmit(name, "info", "script", "", fields);
  wrRetInt(retVal, 0);
}

enum P1UiCommand : int {
  P1_UI_INIT = 0,
  P1_UI_ADD_SLIDER = 1,
  P1_UI_ADD_BUTTON = 2,
  P1_UI_ADD_TOGGLE = 4,
  P1_UI_CLEAR_LABEL = 7,
  P1_UI_ADD_WAVEFORM = 9,
  P1_UI_ADD_COLUMN = 10,
  P1_UI_ADD_SPACER = 11,
  P1_UI_ADD_LABEL = 12,
  P1_UI_ADD_MOVING_GRAPH = 13,
  P1_UI_SET_VALUE = 20,
  P1_UI_SET_COLOR = 21,
};

static uint16_t g_uiAutoItemCounter = 0;

static String wrUiAutoId(const char* prefix) {
  String id(prefix && prefix[0] ? prefix : "item");
  id += String(g_uiAutoItemCounter++);
  return id;
}

static void uiEmitValue(const String& id, int value) {
  P1EventField fields[] = {
    p1FieldInt("cmd", P1_UI_SET_VALUE),
    p1FieldString("id", id),
    p1FieldInt("value", value),
  };
  protocolEmitEventFields("ui.value", fields, 3);
}

static String wrUiId(const WRValue* argv, int argn, int idx, const char* fallback) {
  String id = wrArgStringValue(argv, argn, idx);
  id.trim();
  if (!id.length()) id = fallback ? fallback : "item";
  return id;
}

static void wrUiEmitItem(int cmd, const char* type, const String& id, const String& label, int value, int minValue, int maxValue) {
  P1EventField fields[] = {
    p1FieldInt("cmd", cmd),
    p1FieldString("id", id),
    p1FieldString("type", type ? type : "value"),
    p1FieldString("label", label.length() ? label : id),
    p1FieldInt("value", value),
    p1FieldInt("min", minValue),
    p1FieldInt("max", maxValue),
  };
  protocolEmitEventFields("ui.item", fields, 7);
}

static void w_p1_uiBegin(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String title = wrArgStringValue(argv, argn, 0);
  if (!title.length()) title = "Live UI";
  g_uiAutoItemCounter = 0;
  uiClearOutputCache();
  P1EventField fields[] = {
    p1FieldInt("cmd", P1_UI_INIT),
    p1FieldString("title", title),
  };
  protocolEmitEventFields("ui.reset", fields, 2);
  wrRetInt(retVal, 1);
}

static void w_p1_uiClear(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  g_uiAutoItemCounter = 0;
  uiClearOutputCache();
  P1EventField fields[] = {
    p1FieldInt("cmd", P1_UI_INIT),
  };
  protocolEmitEventFields("ui.reset", fields, 1);
  wrRetInt(retVal, 1);
}

static void w_p1_uiLabel(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String id = wrUiId(argv, argn, 0, "label");
  String label = wrArgStringValue(argv, argn, 1);
  if (!label.length()) label = id;
  P1EventField fields[] = {
    p1FieldInt("cmd", P1_UI_ADD_LABEL),
    p1FieldString("id", id),
    p1FieldString("type", "label"),
    p1FieldString("label", label),
    p1FieldString("text", label),
  };
  protocolEmitEventFields("ui.item", fields, 5);
  wrRetInt(retVal, 1);
}

static void w_p1_uiButton(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String id = wrUiId(argv, argn, 0, "button");
  String label = wrArgStringValue(argv, argn, 1);
  wrUiEmitItem(P1_UI_ADD_BUTTON, "button", id, label, 0, 0, 1);
  wrRetInt(retVal, 1);
}

static void w_p1_uiToggle(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String id = wrUiId(argv, argn, 0, "toggle");
  String label = wrArgStringValue(argv, argn, 1);
  int value = wrArgInt(argv, argn, 2, 0);
  wrUiEmitItem(P1_UI_ADD_TOGGLE, "toggle", id, label, value ? 1 : 0, 0, 1);
  wrRetInt(retVal, 1);
}

static void w_p1_uiSlider(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String id = wrUiId(argv, argn, 0, "slider");
  String label = wrArgStringValue(argv, argn, 1);
  int value = wrArgInt(argv, argn, 2, 0);
  int minValue = wrArgInt(argv, argn, 3, 0);
  int maxValue = wrArgInt(argv, argn, 4, 100);
  wrUiEmitItem(P1_UI_ADD_SLIDER, "slider", id, label, value, minValue, maxValue);
  wrRetInt(retVal, 1);
}

static void w_p1_uiValue(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String id = wrUiId(argv, argn, 0, "value");
  String label = wrArgStringValue(argv, argn, 1);
  int value = wrArgInt(argv, argn, 2, 0);
  int minValue = wrArgInt(argv, argn, 3, 0);
  int maxValue = wrArgInt(argv, argn, 4, 100);
  wrUiEmitItem(P1_UI_SET_VALUE, "value", id, label, value, minValue, maxValue);
  wrRetInt(retVal, 1);
}

static void w_p1_uiGraph(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String id = wrUiId(argv, argn, 0, "graph");
  String label = wrArgStringValue(argv, argn, 1);
  int value = wrArgInt(argv, argn, 2, 0);
  int minValue = wrArgInt(argv, argn, 3, 0);
  int maxValue = wrArgInt(argv, argn, 4, 100);
  wrUiEmitItem(P1_UI_ADD_MOVING_GRAPH, "graph", id, label, value, minValue, maxValue);
  wrRetInt(retVal, 1);
}

static void w_p1_uiSpacer(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String id = argn >= 2 ? wrUiId(argv, argn, 0, "spacer") : wrUiAutoId("spacer");
  int size = constrain(wrArgInt(argv, argn, argn >= 2 ? 1 : 0, 1), 1, 3);
  wrUiEmitItem(P1_UI_ADD_SPACER, "spacer", id, "", size, 1, 3);
  wrRetInt(retVal, 1);
}

static void w_p1_uiColumn(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  String id = wrUiAutoId("column");
  wrUiEmitItem(P1_UI_ADD_COLUMN, "column", id, "", 0, 0, 1);
  wrRetInt(retVal, 1);
}

static void w_p1_uiColor(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int r = constrain(wrArgInt(argv, argn, 0, 127), 0, 255);
  int g = constrain(wrArgInt(argv, argn, 1, 208), 0, 255);
  int b = constrain(wrArgInt(argv, argn, 2, 223), 0, 255);
  P1EventField fields[] = {
    p1FieldInt("cmd", P1_UI_SET_COLOR),
    p1FieldInt("r", r),
    p1FieldInt("g", g),
    p1FieldInt("b", b),
  };
  protocolEmitEventFields("ui.style", fields, 4);
  wrRetInt(retVal, 1);
}

static void w_p1_uiUpdate(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String id = wrUiId(argv, argn, 0, "value");
  int value = wrArgInt(argv, argn, 1, 0);
  if (uiOutputValueChanged(id, value)) {
    uiEmitValue(id, value);
    wrRetInt(retVal, 1);
  } else {
    wrRetInt(retVal, 0);
  }
}

static void w_p1_uiPush(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String id = wrUiId(argv, argn, 0, "value");
  int value = wrArgInt(argv, argn, 1, 0);
  uiOutputValueChanged(id, value);
  uiEmitValue(id, value);
  wrRetInt(retVal, 1);
}

static void w_p1_uiText(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String id = wrUiId(argv, argn, 0, "label");
  String text = wrArgStringValue(argv, argn, 1);
  P1EventField fields[] = {
    p1FieldInt("cmd", P1_UI_CLEAR_LABEL),
    p1FieldString("id", id),
    p1FieldString("text", text),
  };
  protocolEmitEventFields("ui.text", fields, 3);
  wrRetInt(retVal, 1);
}

static void w_p1_uiPoll(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  P1UiInputEvent event;
  if (!uiInputPop(event)) {
    wrRetInt(retVal, 0);
    return;
  }
  g_lastUiEventId = event.id;
  g_lastUiEventType = event.type;
  g_lastUiEventText = event.text;
  g_lastUiEventValue = event.value;
  wrRetInt(retVal, 1);
}

static void w_p1_uiEventId(WRContext* ctx, const WRValue*, const int, WRValue& retVal, void*) {
  wrRetString(ctx, retVal, g_lastUiEventId);
}

static void w_p1_uiEventType(WRContext* ctx, const WRValue*, const int, WRValue& retVal, void*) {
  wrRetString(ctx, retVal, g_lastUiEventType);
}

static void w_p1_uiEventValue(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  wrRetInt(retVal, g_lastUiEventValue);
}

static void w_p1_uiEventText(WRContext* ctx, const WRValue*, const int, WRValue& retVal, void*) {
  wrRetString(ctx, retVal, g_lastUiEventText);
}

static void w_p1_uiGet(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String id = wrUiId(argv, argn, 0, "value");
  int fallback = wrArgInt(argv, argn, 1, 0);
  wrRetInt(retVal, uiInputValue(id, fallback));
}

static void w_p1_uiChanged(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String id = wrUiId(argv, argn, 0, "value");
  wrRetInt(retVal, uiInputChanged(id) ? 1 : 0);
}

static void w_p1_statusGet(WRContext* ctx, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetString(ctx, retVal, wrStatusValue(wrArgStringValue(argv, argn, 0)));
}

static void w_p1_configGet(WRContext* ctx, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetString(ctx, retVal, wrConfigValue(wrArgStringValue(argv, argn, 0)));
}

static void w_p1_configSet(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String key = wrArgStringValue(argv, argn, 0);
  String value = wrArgStringValue(argv, argn, 1);
  bool changed = false;

  if (key == "deviceName") {
    configSetDeviceName(value);
    changed = true;
  } else if (key == "wifiSsid") {
    configSetWifiSsid(value);
    changed = true;
  } else if (key == "wifiPassword") {
    configSetWifiPassword(value);
    changed = true;
  } else if (key == "debugLevel") {
    changed = debugEventSetLevelName(value);
  }

  if (changed) {
    configSave();
    if (key == "wifiSsid" || key == "wifiPassword") wifiReconnect();
  }
  if (!changed) scriptErrorSet("binding", "config_set_failed", "configSet failed", "\"key\":" + jsonString(key));
  wrRetInt(retVal, changed ? 1 : 0);
}

static void w_p1_wifiStatus(WRContext* ctx, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetString(ctx, retVal, wrWifiValue(wrArgStringValue(argv, argn, 0)));
}

static void w_p1_wifiConnect(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String ssid = wrArgStringValue(argv, argn, 0);
  String password = wrArgStringValue(argv, argn, 1);
  if (!ssid.length()) {
    scriptErrorSet("binding", "wifi_missing_ssid", "wifiConnect requires an SSID");
    wrRetInt(retVal, 0);
    return;
  }
  configSetWifiSsid(ssid);
  if (wrArgPresent(argv, argn, 1)) configSetWifiPassword(password);
  configSave();
  wifiReconnect();
  wrRetInt(retVal, 1);
}

static void w_p1_wifiDisconnect(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  wifiDisconnect();
  wrRetInt(retVal, 1);
}

static void w_p1_reboot(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  protocolEmitEvent("device.reboot", "\"requestedBy\":\"script\"");
  wrRetInt(retVal, 1);
  delay(50);
  ESP.restart();
}

static void w_p1_inboxAvailable(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  wrRetInt(retVal, (int)wrenchInboxAvailable());
}

static void w_p1_inboxRead(WRContext* ctx, const WRValue*, const int, WRValue& retVal, void*) {
  String channel;
  String message;
  if (!wrenchInboxRead(channel, message)) {
    g_lastInboxChannel = "";
    wrRetString(ctx, retVal, "");
    return;
  }
  g_lastInboxChannel = channel;
  wrRetString(ctx, retVal, message);
}

static void w_p1_inboxChannel(WRContext* ctx, const WRValue*, const int, WRValue& retVal, void*) {
  wrRetString(ctx, retVal, g_lastInboxChannel);
}

static void w_p1_inboxClear(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  wrenchInboxClear();
  g_lastInboxChannel = "";
  wrRetInt(retVal, 0);
}

static void w_p1_inboxDrops(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  wrRetInt(retVal, (int)wrenchInboxDrops());
}

static void w_p1_lastError(WRContext* ctx, const WRValue*, const int, WRValue& retVal, void*) {
  wrRetString(ctx, retVal, scriptErrorLastJson());
}

static void w_p1_clearError(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  scriptErrorClear();
  wrRetInt(retVal, 0);
}

const char* wrenchBindingNameForHash(uint32_t hash) {
  static const char* const names[] = {
    "print", "println",
    "pinMode", "digitalWrite", "digitalRead", "analogRead", "touchRead",
    "delay", "delayMicroseconds", "millis", "micros",
    "random", "randomSeed", "freeHeap",
    "wifiConnected", "wifiIp", "wifiRssi", "wifiSsid",
    "wireBegin", "i2cWrite", "i2cRead",
    "serialBegin", "serialEnd", "serialAvailable", "serialRead",
    "serialReadString", "serialWrite", "serialWriteLine",
    "serialWriteByte", "serialStatus",
    "httpGet", "httpPost", "httpCode", "httpTruncated", "httpError",
    "httpStatus", "httpJsonGet", "httpJsonGetInt", "httpJsonGetFloat", "httpJsonGetBool", "fetchJson",
    "getJsonValue", "getJsonInt", "getJsonFloat", "getJsonBool",
    "jsonGet", "jsonGetInt", "jsonGetFloat", "jsonGetBool", "jsonHas",
    "jsonPair", "jsonPairRaw", "jsonPairInt", "jsonPairFloat",
    "jsonPairBool", "jsonBuild",
    // "jsonArray",
    "analogWrite", "analogWriteResolution", "analogWriteFrequency",
    "pwmDetach",
    "servoAttach", "servoWrite", "servoWriteMicroseconds", "servoDetach",
    "fanAttach", "fanWrite", "fanWriteRaw", "fanDetach",
    "ledConfig", "ledReady", "ledStripCount", "ledCount", "ledSet", "ledSetHsv",
    "hsvToR", "hsvToG", "hsvToB", "rgbToH", "rgbToS", "rgbToV",
    "ledFill", "ledClear", "ledShow", "ledBrightness", "ledStatus",
    "log", "emit", "emitJson", "statusGet", "configGet", "configSet",
    "wifiStatus", "wifiConnect", "wifiDisconnect", "reboot",
    "inboxAvailable", "inboxRead", "inboxChannel", "inboxClear",
    "inboxDrops", "lastError", "clearError",
    "uiBegin", "uiClear", "uiLabel", "uiButton", "uiToggle", "uiSlider",
    "uiValue", "uiGraph", "uiSpacer", "uiColumn", "uiColor",
    "uiUpdate", "uiPush", "uiText", "uiPoll",
    "uiEventId", "uiEventType", "uiEventValue", "uiEventText",
    "uiGet", "uiChanged",
  };
  for (size_t i = 0; i < sizeof(names) / sizeof(names[0]); i++) {
    if ((uint32_t)wr_hashStr(names[i]) == hash) return names[i];
  }
  return "";
}

void wrenchRegisterBindings(WRState* wr) {
  wr_registerFunction(wr, "print", w_p1_print);
  wr_registerFunction(wr, "println", w_p1_println);
  wr_registerFunction(wr, "pinMode", w_p1_pinMode);
  wr_registerFunction(wr, "digitalWrite", w_p1_digitalWrite);
  wr_registerFunction(wr, "digitalRead", w_p1_digitalRead);
  wr_registerFunction(wr, "analogRead", w_p1_analogRead);
  wr_registerFunction(wr, "touchRead", w_p1_touchRead);
  wr_registerFunction(wr, "delay", w_p1_delay);
  wr_registerFunction(wr, "delayMicroseconds", w_p1_delayMicroseconds);
  wr_registerFunction(wr, "millis", w_p1_millis);
  wr_registerFunction(wr, "micros", w_p1_micros);
  wr_registerFunction(wr, "random", w_p1_random);
  wr_registerFunction(wr, "randomSeed", w_p1_randomSeed);
  wr_registerFunction(wr, "freeHeap", w_p1_freeHeap);
  wr_registerFunction(wr, "wifiConnected", w_p1_wifiConnected);
  wr_registerFunction(wr, "wifiIp", w_p1_wifiIp);
  wr_registerFunction(wr, "wifiRssi", w_p1_wifiRssi);
  wr_registerFunction(wr, "wifiSsid", w_p1_wifiSsid);
  wr_registerFunction(wr, "wireBegin", w_p1_wireBegin);
  wr_registerFunction(wr, "i2cWrite", w_p1_i2cWrite);
  wr_registerFunction(wr, "i2cRead", w_p1_i2cRead);
  wr_registerFunction(wr, "serialBegin", w_p1_serialBegin);
  wr_registerFunction(wr, "serialEnd", w_p1_serialEnd);
  wr_registerFunction(wr, "serialAvailable", w_p1_serialAvailable);
  wr_registerFunction(wr, "serialRead", w_p1_serialRead);
  wr_registerFunction(wr, "serialReadString", w_p1_serialReadString);
  wr_registerFunction(wr, "serialWrite", w_p1_serialWrite);
  wr_registerFunction(wr, "serialWriteLine", w_p1_serialWriteLine);
  wr_registerFunction(wr, "serialWriteByte", w_p1_serialWriteByte);
  wr_registerFunction(wr, "serialStatus", w_p1_serialStatus);
  wr_registerFunction(wr, "httpGet", w_p1_httpGet);
  wr_registerFunction(wr, "httpJsonGet", w_p1_httpJsonGet);
  wr_registerFunction(wr, "httpJsonGetInt", w_p1_httpJsonGetInt);
  wr_registerFunction(wr, "httpJsonGetFloat", w_p1_httpJsonGetFloat);
  wr_registerFunction(wr, "httpJsonGetBool", w_p1_httpJsonGetBool);
  wr_registerFunction(wr, "fetchJson", w_p1_fetchJson);
  wr_registerFunction(wr, "httpPost", w_p1_httpPost);
  wr_registerFunction(wr, "httpCode", w_p1_httpCode);
  wr_registerFunction(wr, "httpTruncated", w_p1_httpTruncated);
  wr_registerFunction(wr, "httpError", w_p1_httpError);
  wr_registerFunction(wr, "httpStatus", w_p1_httpStatus);
  wr_registerFunction(wr, "getJsonValue", w_p1_getJsonValue);
  wr_registerFunction(wr, "getJsonInt", w_p1_getJsonInt);
  wr_registerFunction(wr, "getJsonFloat", w_p1_getJsonFloat);
  wr_registerFunction(wr, "getJsonBool", w_p1_getJsonBool);
  wr_registerFunction(wr, "jsonGet", w_p1_jsonGet);
  wr_registerFunction(wr, "jsonGetInt", w_p1_jsonGetInt);
  wr_registerFunction(wr, "jsonGetFloat", w_p1_jsonGetFloat);
  wr_registerFunction(wr, "jsonGetBool", w_p1_jsonGetBool);
  wr_registerFunction(wr, "jsonHas", w_p1_jsonHas);
  wr_registerFunction(wr, "jsonPair", w_p1_jsonPair);
  wr_registerFunction(wr, "jsonPairRaw", w_p1_jsonPairRaw);
  wr_registerFunction(wr, "jsonPairInt", w_p1_jsonPairInt);
  wr_registerFunction(wr, "jsonPairFloat", w_p1_jsonPairFloat);
  wr_registerFunction(wr, "jsonPairBool", w_p1_jsonPairBool);
  wr_registerFunction(wr, "jsonBuild", w_p1_jsonBuild);
  // wr_registerFunction(wr, "jsonArray", w_p1_jsonArray);
  wr_registerFunction(wr, "analogWrite", w_p1_analogWrite);
  wr_registerFunction(wr, "analogWriteResolution", w_p1_analogWriteResolution);
  wr_registerFunction(wr, "analogWriteFrequency", w_p1_analogWriteFrequency);
  wr_registerFunction(wr, "pwmDetach", w_p1_pwmDetach);
  wr_registerFunction(wr, "servoAttach", w_p1_servoAttach);
  wr_registerFunction(wr, "servoWrite", w_p1_servoWrite);
  wr_registerFunction(wr, "servoWriteMicroseconds", w_p1_servoWriteMicroseconds);
  wr_registerFunction(wr, "servoDetach", w_p1_servoDetach);
  wr_registerFunction(wr, "fanAttach", w_p1_fanAttach);
  wr_registerFunction(wr, "fanWrite", w_p1_fanWrite);
  wr_registerFunction(wr, "fanWriteRaw", w_p1_fanWriteRaw);
  wr_registerFunction(wr, "fanDetach", w_p1_fanDetach);
  wr_registerFunction(wr, "ledConfig", w_p1_ledConfig);
  wr_registerFunction(wr, "ledReady", w_p1_ledReady);
  wr_registerFunction(wr, "ledStripCount", w_p1_ledStripCount);
  wr_registerFunction(wr, "ledCount", w_p1_ledCount);
  wr_registerFunction(wr, "ledSet", w_p1_ledSet);
  wr_registerFunction(wr, "ledSetHsv", w_p1_ledSetHsv);
  wr_registerFunction(wr, "hsvToR", w_p1_hsvToR);
  wr_registerFunction(wr, "hsvToG", w_p1_hsvToG);
  wr_registerFunction(wr, "hsvToB", w_p1_hsvToB);
  wr_registerFunction(wr, "rgbToH", w_p1_rgbToH);
  wr_registerFunction(wr, "rgbToS", w_p1_rgbToS);
  wr_registerFunction(wr, "rgbToV", w_p1_rgbToV);
  wr_registerFunction(wr, "ledFill", w_p1_ledFill);
  wr_registerFunction(wr, "ledClear", w_p1_ledClear);
  wr_registerFunction(wr, "ledShow", w_p1_ledShow);
  wr_registerFunction(wr, "ledBrightness", w_p1_ledBrightness);
  wr_registerFunction(wr, "ledStatus", w_p1_ledStatus);
  wr_registerFunction(wr, "log", w_p1_log);
  wr_registerFunction(wr, "emit", w_p1_emit);
  wr_registerFunction(wr, "emitJson", w_p1_emitJson);
  wr_registerFunction(wr, "statusGet", w_p1_statusGet);
  wr_registerFunction(wr, "configGet", w_p1_configGet);
  wr_registerFunction(wr, "configSet", w_p1_configSet);
  wr_registerFunction(wr, "wifiStatus", w_p1_wifiStatus);
  wr_registerFunction(wr, "wifiConnect", w_p1_wifiConnect);
  wr_registerFunction(wr, "wifiDisconnect", w_p1_wifiDisconnect);
  wr_registerFunction(wr, "reboot", w_p1_reboot);
  wr_registerFunction(wr, "inboxAvailable", w_p1_inboxAvailable);
  wr_registerFunction(wr, "inboxRead", w_p1_inboxRead);
  wr_registerFunction(wr, "inboxChannel", w_p1_inboxChannel);
  wr_registerFunction(wr, "inboxClear", w_p1_inboxClear);
  wr_registerFunction(wr, "inboxDrops", w_p1_inboxDrops);
  wr_registerFunction(wr, "lastError", w_p1_lastError);
  wr_registerFunction(wr, "clearError", w_p1_clearError);
  wr_registerFunction(wr, "uiBegin", w_p1_uiBegin);
  wr_registerFunction(wr, "uiClear", w_p1_uiClear);
  wr_registerFunction(wr, "uiLabel", w_p1_uiLabel);
  wr_registerFunction(wr, "uiButton", w_p1_uiButton);
  wr_registerFunction(wr, "uiToggle", w_p1_uiToggle);
  wr_registerFunction(wr, "uiSlider", w_p1_uiSlider);
  wr_registerFunction(wr, "uiValue", w_p1_uiValue);
  wr_registerFunction(wr, "uiGraph", w_p1_uiGraph);
  wr_registerFunction(wr, "uiSpacer", w_p1_uiSpacer);
  wr_registerFunction(wr, "uiColumn", w_p1_uiColumn);
  wr_registerFunction(wr, "uiColor", w_p1_uiColor);
  wr_registerFunction(wr, "uiUpdate", w_p1_uiUpdate);
  wr_registerFunction(wr, "uiPush", w_p1_uiPush);
  wr_registerFunction(wr, "uiText", w_p1_uiText);
  wr_registerFunction(wr, "uiPoll", w_p1_uiPoll);
  wr_registerFunction(wr, "uiEventId", w_p1_uiEventId);
  wr_registerFunction(wr, "uiEventType", w_p1_uiEventType);
  wr_registerFunction(wr, "uiEventValue", w_p1_uiEventValue);
  wr_registerFunction(wr, "uiEventText", w_p1_uiEventText);
  wr_registerFunction(wr, "uiGet", w_p1_uiGet);
  wr_registerFunction(wr, "uiChanged", w_p1_uiChanged);

  wr_registerLibraryConstant(wr, "INPUT", (int32_t)INPUT);
  wr_registerLibraryConstant(wr, "OUTPUT", (int32_t)OUTPUT);
  wr_registerLibraryConstant(wr, "INPUT_PULLUP", (int32_t)INPUT_PULLUP);
#ifdef INPUT_PULLDOWN
  wr_registerLibraryConstant(wr, "INPUT_PULLDOWN", (int32_t)INPUT_PULLDOWN);
#endif
  wr_registerLibraryConstant(wr, "HIGH", (int32_t)HIGH);
  wr_registerLibraryConstant(wr, "LOW", (int32_t)LOW);
  wr_registerLibraryConstant(wr, "LED_BUILTIN", (int32_t)P1_EMBED_DEFAULT_LED_PIN);
}
