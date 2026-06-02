#include <Arduino.h>
#include <ESP.h>
#include <WiFi.h>
#include <Wire.h>
#include <time.h>
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

static bool wrRetIntArray3(WRContext* ctx, WRValue& retVal, int a, int b, int c) {
  int values[3] = { a, b, c };
  for (int i = 0; i < 3; i++) {
    WRValue* slot = retVal.indexArray(ctx, (uint32_t)i, true);
    if (!slot) return false;
    wr_makeInt(slot, values[i]);
  }
  return true;
}

static bool wrRetFloatArray3(WRContext* ctx, WRValue& retVal, float a, float b, float c) {
  float values[3] = { a, b, c };
  for (int i = 0; i < 3; i++) {
    WRValue* slot = retVal.indexArray(ctx, (uint32_t)i, true);
    if (!slot) return false;
    wr_makeFloat(slot, values[i]);
  }
  return true;
}

static bool wrRetIntArray4(WRContext* ctx, WRValue& retVal, int a, int b, int c, int d) {
  int values[4] = { a, b, c, d };
  for (int i = 0; i < 4; i++) {
    WRValue* slot = retVal.indexArray(ctx, (uint32_t)i, true);
    if (!slot) return false;
    wr_makeInt(slot, values[i]);
  }
  return true;
}

static bool wrRetIntArray6(WRContext* ctx, WRValue& retVal, int a, int b, int c, int d, int e, int f) {
  int values[6] = { a, b, c, d, e, f };
  for (int i = 0; i < 6; i++) {
    WRValue* slot = retVal.indexArray(ctx, (uint32_t)i, true);
    if (!slot) return false;
    wr_makeInt(slot, values[i]);
  }
  return true;
}

static int wrArgArrayInt(WRContext* ctx, const WRValue* argv, int argn, int argIdx, int arrayIdx, int def) {
  if (!argv || argIdx >= argn) return def;
  WRValue* slot = argv[argIdx].indexArray(ctx, (uint32_t)arrayIdx, false);
  if (!slot) return def;
  WRValue& value = slot->deref();
  if (value.isInt()) return value.asInt();
  if (value.isFloat()) return (int)value.asFloat();
  char buf[32];
  value.asString(buf, sizeof(buf));
  return atoi(buf);
}

static bool wrSetArrayInt3(WRContext* ctx, const WRValue* argv, int argn, int argIdx, int a, int b, int c) {
  if (!argv || argIdx >= argn) return false;
  int values[3] = { a, b, c };
  for (int i = 0; i < 3; i++) {
    WRValue* slot = argv[argIdx].indexArray(ctx, (uint32_t)i, true);
    if (!slot) return false;
    wr_makeInt(slot, values[i]);
  }
  return true;
}

static bool wrSetArrayInt4(WRContext* ctx, const WRValue* argv, int argn, int argIdx, int a, int b, int c, int d) {
  if (!argv || argIdx >= argn) return false;
  int values[4] = { a, b, c, d };
  for (int i = 0; i < 4; i++) {
    WRValue* slot = argv[argIdx].indexArray(ctx, (uint32_t)i, true);
    if (!slot) return false;
    wr_makeInt(slot, values[i]);
  }
  return true;
}

static bool wrSetArrayInt6(WRContext* ctx, const WRValue* argv, int argn, int argIdx, int a, int b, int c, int d, int e, int f) {
  if (!argv || argIdx >= argn) return false;
  int values[6] = { a, b, c, d, e, f };
  for (int i = 0; i < 6; i++) {
    WRValue* slot = argv[argIdx].indexArray(ctx, (uint32_t)i, true);
    if (!slot) return false;
    wr_makeInt(slot, values[i]);
  }
  return true;
}

static const char* wrArgString(const WRValue* argv, int argn, int idx, char* buf, size_t buflen) {
  if (!buf || buflen == 0) return "";
  buf[0] = 0;
  if (!argv || idx >= argn) return buf;
  int stringLen = 0;
  if (argv[idx].isString(&stringLen) && stringLen == 0) return buf;
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

static bool wrArgIsArray(const WRValue* argv, int argn, int idx) {
  return argv && idx < argn && argv[idx].isWrenchArray();
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

static double solarDegToRad(double deg) {
  return deg * PI / 180.0;
}

static double solarRadToDeg(double rad) {
  return rad * 180.0 / PI;
}

static double solarNormalizeDeg(double deg) {
  double out = fmod(deg, 360.0);
  if (out < 0.0) out += 360.0;
  return out;
}

static int sunBrightnessFromElevation(float elevationDeg) {
  if (elevationDeg <= -6.0f) return 0;
  if (elevationDeg >= 60.0f) return 255;
  float x = (elevationDeg + 6.0f) / 66.0f;
  x = constrain(x, 0.0f, 1.0f);
  x = x * x * (3.0f - 2.0f * x);
  return constrain((int)roundf(x * 255.0f), 0, 255);
}

static int sunKelvinFromElevation(float elevationDeg) {
  if (elevationDeg <= -6.0f) return 2200;
  if (elevationDeg >= 45.0f) return 6500;
  float x = (elevationDeg + 6.0f) / 51.0f;
  x = constrain(x, 0.0f, 1.0f);
  x = x * x * (3.0f - 2.0f * x);
  return constrain(2200 + (int)roundf(x * 4300.0f), 2200, 6500);
}

static bool sunCalculate(double latitudeDeg, double longitudeDeg, time_t unixSeconds, float& elevationDeg, float& azimuthDeg, int& brightness, int& kelvin) {
  if (unixSeconds < 100000) {
    elevationDeg = -90.0f;
    azimuthDeg = 0.0f;
    brightness = 0;
    kelvin = 2200;
    return false;
  }

  latitudeDeg = constrain(latitudeDeg, -89.9, 89.9);
  longitudeDeg = constrain(longitudeDeg, -180.0, 180.0);

  double jd = ((double)unixSeconds / 86400.0) + 2440587.5;
  double t = (jd - 2451545.0) / 36525.0;
  double geomMeanLong = solarNormalizeDeg(280.46646 + t * (36000.76983 + t * 0.0003032));
  double geomMeanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  double eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  double anomalyRad = solarDegToRad(geomMeanAnomaly);
  double sunEqCenter = sin(anomalyRad) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + sin(2.0 * anomalyRad) * (0.019993 - 0.000101 * t)
    + sin(3.0 * anomalyRad) * 0.000289;
  double trueLong = geomMeanLong + sunEqCenter;
  double omega = 125.04 - 1934.136 * t;
  double appLong = trueLong - 0.00569 - 0.00478 * sin(solarDegToRad(omega));
  double meanObliq = 23.0 + (26.0 + ((21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60.0)) / 60.0;
  double obliqCorr = meanObliq + 0.00256 * cos(solarDegToRad(omega));
  double obliqRad = solarDegToRad(obliqCorr);
  double appLongRad = solarDegToRad(appLong);
  double declRad = asin(sin(obliqRad) * sin(appLongRad));

  double y = tan(obliqRad / 2.0);
  y *= y;
  double longRad = solarDegToRad(geomMeanLong);
  double eqTime = 4.0 * solarRadToDeg(
    y * sin(2.0 * longRad)
    - 2.0 * eccentricity * sin(anomalyRad)
    + 4.0 * eccentricity * y * sin(anomalyRad) * cos(2.0 * longRad)
    - 0.5 * y * y * sin(4.0 * longRad)
    - 1.25 * eccentricity * eccentricity * sin(2.0 * anomalyRad));

  double minutesUtc = fmod((double)unixSeconds / 60.0, 1440.0);
  if (minutesUtc < 0.0) minutesUtc += 1440.0;
  double trueSolarTime = fmod(minutesUtc + eqTime + (4.0 * longitudeDeg), 1440.0);
  if (trueSolarTime < 0.0) trueSolarTime += 1440.0;
  double hourAngleDeg = trueSolarTime / 4.0 - 180.0;
  if (hourAngleDeg < -180.0) hourAngleDeg += 360.0;

  double latRad = solarDegToRad(latitudeDeg);
  double hourAngleRad = solarDegToRad(hourAngleDeg);
  double cosZenith = sin(latRad) * sin(declRad) + cos(latRad) * cos(declRad) * cos(hourAngleRad);
  cosZenith = constrain(cosZenith, -1.0, 1.0);
  double zenithDeg = solarRadToDeg(acos(cosZenith));
  double elevation = 90.0 - zenithDeg;

  double azDenom = cos(latRad) * sin(solarDegToRad(zenithDeg));
  double azimuth = 180.0;
  if (fabs(azDenom) > 0.001) {
    double az = ((sin(latRad) * cos(solarDegToRad(zenithDeg))) - sin(declRad)) / azDenom;
    az = constrain(az, -1.0, 1.0);
    azimuth = solarRadToDeg(acos(az));
    if (hourAngleDeg > 0.0) azimuth = solarNormalizeDeg(azimuth + 180.0);
    else azimuth = solarNormalizeDeg(540.0 - azimuth);
  }

  elevationDeg = (float)elevation;
  azimuthDeg = (float)azimuth;
  brightness = sunBrightnessFromElevation(elevationDeg);
  kelvin = sunKelvinFromElevation(elevationDeg);
  return true;
}

static uint8_t g_noisePerm[512];
static bool g_noisePermReady = false;
static uint32_t g_noiseSeed = 1;

static uint32_t noiseNextRandom(uint32_t& state) {
  state ^= state << 13;
  state ^= state >> 17;
  state ^= state << 5;
  return state;
}

static void noiseSeedSimplex(uint32_t seed) {
  if (seed == 0) seed = 1;
  g_noiseSeed = seed;
  uint8_t p[256];
  for (int i = 0; i < 256; i++) p[i] = (uint8_t)i;
  uint32_t state = seed;
  for (int i = 255; i > 0; i--) {
    int j = noiseNextRandom(state) % (i + 1);
    uint8_t tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  for (int i = 0; i < 512; i++) g_noisePerm[i] = p[i & 255];
  g_noisePermReady = true;
}

static int noiseFastFloor(float x) {
  int xi = (int)x;
  return x < xi ? xi - 1 : xi;
}

static float noiseGrad3(int hash, float x, float y, float z) {
  int h = hash & 15;
  float u = h < 8 ? x : y;
  float v = h < 4 ? y : ((h == 12 || h == 14) ? x : z);
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
}

static float noiseSimplex3(float x, float y, float z) {
  if (!g_noisePermReady) noiseSeedSimplex(1);
  const float f3 = 1.0f / 3.0f;
  const float g3 = 1.0f / 6.0f;
  float s = (x + y + z) * f3;
  int i = noiseFastFloor(x + s);
  int j = noiseFastFloor(y + s);
  int k = noiseFastFloor(z + s);
  float t = (i + j + k) * g3;
  float x0 = x - (i - t);
  float y0 = y - (j - t);
  float z0 = z - (k - t);

  int i1 = 0, j1 = 0, k1 = 0;
  int i2 = 0, j2 = 0, k2 = 0;
  if (x0 >= y0) {
    if (y0 >= z0) { i1 = 1; i2 = 1; j2 = 1; }
    else if (x0 >= z0) { i1 = 1; i2 = 1; k2 = 1; }
    else { k1 = 1; i2 = 1; k2 = 1; }
  } else {
    if (y0 < z0) { k1 = 1; j2 = 1; k2 = 1; }
    else if (x0 < z0) { j1 = 1; j2 = 1; k2 = 1; }
    else { j1 = 1; i2 = 1; j2 = 1; }
  }

  float x1 = x0 - i1 + g3;
  float y1 = y0 - j1 + g3;
  float z1 = z0 - k1 + g3;
  float x2 = x0 - i2 + 2.0f * g3;
  float y2 = y0 - j2 + 2.0f * g3;
  float z2 = z0 - k2 + 2.0f * g3;
  float x3 = x0 - 1.0f + 3.0f * g3;
  float y3 = y0 - 1.0f + 3.0f * g3;
  float z3 = z0 - 1.0f + 3.0f * g3;

  int ii = i & 255;
  int jj = j & 255;
  int kk = k & 255;
  float n0 = 0.0f, n1 = 0.0f, n2 = 0.0f, n3 = 0.0f;

  float tt = 0.6f - x0 * x0 - y0 * y0 - z0 * z0;
  if (tt > 0) {
    tt *= tt;
    n0 = tt * tt * noiseGrad3(g_noisePerm[ii + g_noisePerm[jj + g_noisePerm[kk]]], x0, y0, z0);
  }
  tt = 0.6f - x1 * x1 - y1 * y1 - z1 * z1;
  if (tt > 0) {
    tt *= tt;
    n1 = tt * tt * noiseGrad3(g_noisePerm[ii + i1 + g_noisePerm[jj + j1 + g_noisePerm[kk + k1]]], x1, y1, z1);
  }
  tt = 0.6f - x2 * x2 - y2 * y2 - z2 * z2;
  if (tt > 0) {
    tt *= tt;
    n2 = tt * tt * noiseGrad3(g_noisePerm[ii + i2 + g_noisePerm[jj + j2 + g_noisePerm[kk + k2]]], x2, y2, z2);
  }
  tt = 0.6f - x3 * x3 - y3 * y3 - z3 * z3;
  if (tt > 0) {
    tt *= tt;
    n3 = tt * tt * noiseGrad3(g_noisePerm[ii + 1 + g_noisePerm[jj + 1 + g_noisePerm[kk + 1]]], x3, y3, z3);
  }
  return 32.0f * (n0 + n1 + n2 + n3);
}

#define P1_WRENCH_PALETTE_SLOTS 4
#define P1_WRENCH_PALETTE_STOPS 4

static uint8_t g_paletteCounts[P1_WRENCH_PALETTE_SLOTS] = {0};
static uint8_t g_paletteR[P1_WRENCH_PALETTE_SLOTS * P1_WRENCH_PALETTE_STOPS] = {0};
static uint8_t g_paletteG[P1_WRENCH_PALETTE_SLOTS * P1_WRENCH_PALETTE_STOPS] = {0};
static uint8_t g_paletteB[P1_WRENCH_PALETTE_SLOTS * P1_WRENCH_PALETTE_STOPS] = {0};

static int paletteIndex(int slot, int stop) {
  return slot * P1_WRENCH_PALETTE_STOPS + stop;
}

static bool paletteValidSlot(int slot) {
  return slot >= 0 && slot < P1_WRENCH_PALETTE_SLOTS;
}

static void paletteSetStop(int slot, int stop, int r, int g, int b) {
  int index = paletteIndex(slot, stop);
  g_paletteR[index] = (uint8_t)constrain(r, 0, 255);
  g_paletteG[index] = (uint8_t)constrain(g, 0, 255);
  g_paletteB[index] = (uint8_t)constrain(b, 0, 255);
}

static bool paletteSet(int slot, int count, const int* rgb) {
  if (!paletteValidSlot(slot) || count < 2 || count > P1_WRENCH_PALETTE_STOPS || !rgb) return false;
  g_paletteCounts[slot] = (uint8_t)count;
  for (int i = 0; i < count; i++) paletteSetStop(slot, i, rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
  return true;
}

static int paletteSampleComponent(int slot, int t, int component) {
  if (!paletteValidSlot(slot) || g_paletteCounts[slot] < 2) return 0;
  int count = g_paletteCounts[slot];
  t = constrain(t, 0, 255);
  int scaled = t * (count - 1);
  int left = scaled / 255;
  int right = left + 1;
  if (right >= count) right = count - 1;
  int localT = scaled - (left * 255);
  int li = paletteIndex(slot, left);
  int ri = paletteIndex(slot, right);
  int a = component == 0 ? g_paletteR[li] : (component == 1 ? g_paletteG[li] : g_paletteB[li]);
  int b = component == 0 ? g_paletteR[ri] : (component == 1 ? g_paletteG[ri] : g_paletteB[ri]);
  return a + ((b - a) * localT) / 255;
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
  if (key == "timezone") return configTimezone();
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
static char g_lastUiEventId[P1_EMBED_UI_ID_MAX] = {0};
static char g_lastUiEventType[P1_EMBED_UI_TYPE_MAX] = {0};
static int g_lastUiEventValue = 0;
static char g_lastHaEventId[P1_EMBED_HA_ID_MAX] = {0};
static char g_lastHaEventType[P1_EMBED_HA_TYPE_MAX] = {0};
static float g_lastHaEventValue = 0.0f;

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
  unsigned long sentAt;
  bool used;
  bool pending;
};

enum P1UiOutboundKind : uint8_t {
  P1_UI_OUT_RESET = 1,
  P1_UI_OUT_ITEM = 2,
  P1_UI_OUT_STYLE = 3,
  P1_UI_OUT_TEXT = 4,
};

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

struct P1UiOutboundEvent {
  P1UiOutboundKind kind;
  char id[P1_EMBED_UI_ID_MAX];
  char type[P1_EMBED_UI_TYPE_MAX];
  char label[P1_EMBED_UI_TEXT_MAX];
  char text[P1_EMBED_UI_TEXT_MAX];
  int cmd;
  int value;
  int minValue;
  int maxValue;
  int r;
  int g;
  int b;
};

static portMUX_TYPE g_uiInputMux = portMUX_INITIALIZER_UNLOCKED;
static P1UiInputEvent g_uiEvents[P1_EMBED_UI_EVENT_DEPTH];
static P1UiStateEntry g_uiStates[P1_EMBED_UI_STATE_MAX];
static P1UiOutputEntry g_uiOutputs[P1_EMBED_UI_STATE_MAX];
static P1UiOutboundEvent g_uiOut[P1_EMBED_UI_OUT_DEPTH];
static uint8_t g_uiEventHead = 0;
static uint8_t g_uiEventTail = 0;
static uint8_t g_uiEventCount = 0;
static uint8_t g_uiOutHead = 0;
static uint8_t g_uiOutTail = 0;
static uint8_t g_uiOutCount = 0;
static uint32_t g_uiInputDrops = 0;
static uint32_t g_uiOutDrops = 0;

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

static int uiInputValue(const char* id, int fallback) {
  if (!id || !id[0]) id = "value";
  portENTER_CRITICAL(&g_uiInputMux);
  int index = uiFindStateLocked(id);
  int value = index >= 0 ? g_uiStates[index].value : fallback;
  portEXIT_CRITICAL(&g_uiInputMux);
  return value;
}

static bool uiInputChanged(const char* id) {
  if (!id || !id[0]) id = "value";
  portENTER_CRITICAL(&g_uiInputMux);
  int index = uiFindStateLocked(id);
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
      g_uiOutputs[i].sentAt = 0;
      g_uiOutputs[i].pending = false;
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
    g_uiOutputs[i].sentAt = 0;
    g_uiOutputs[i].pending = false;
  }
  portEXIT_CRITICAL(&g_uiInputMux);
}

static void uiClearOutboundLocked() {
  g_uiOutHead = 0;
  g_uiOutTail = 0;
  g_uiOutCount = 0;
}

static bool uiQueueOutbound(const P1UiOutboundEvent& event) {
  portENTER_CRITICAL(&g_uiInputMux);
  if (g_uiOutCount >= P1_EMBED_UI_OUT_DEPTH) {
    g_uiOutTail = (uint8_t)((g_uiOutTail + 1) % P1_EMBED_UI_OUT_DEPTH);
    g_uiOutCount--;
    g_uiOutDrops++;
  }
  g_uiOut[g_uiOutHead] = event;
  g_uiOutHead = (uint8_t)((g_uiOutHead + 1) % P1_EMBED_UI_OUT_DEPTH);
  g_uiOutCount++;
  portEXIT_CRITICAL(&g_uiInputMux);
  return true;
}

static void uiQueueReset(const String& title) {
  P1UiOutboundEvent event{};
  event.kind = P1_UI_OUT_RESET;
  event.cmd = P1_UI_INIT;
  uiCopy(event.text, sizeof(event.text), title);
  portENTER_CRITICAL(&g_uiInputMux);
  uiClearOutboundLocked();
  g_uiOut[g_uiOutHead] = event;
  g_uiOutHead = (uint8_t)((g_uiOutHead + 1) % P1_EMBED_UI_OUT_DEPTH);
  g_uiOutCount = 1;
  portEXIT_CRITICAL(&g_uiInputMux);
}

void uiRuntimeReset(const String& title, bool emitReset) {
  P1UiOutboundEvent event{};
  event.kind = P1_UI_OUT_RESET;
  event.cmd = P1_UI_INIT;
  uiCopy(event.text, sizeof(event.text), title);

  portENTER_CRITICAL(&g_uiInputMux);
  g_uiEventHead = 0;
  g_uiEventTail = 0;
  g_uiEventCount = 0;
  for (int i = 0; i < P1_EMBED_UI_STATE_MAX; i++) {
    g_uiStates[i].used = false;
    g_uiStates[i].id[0] = 0;
    g_uiStates[i].text[0] = 0;
    g_uiStates[i].value = 0;
    g_uiStates[i].changed = false;
    g_uiOutputs[i].used = false;
    g_uiOutputs[i].id[0] = 0;
    g_uiOutputs[i].value = 0;
    g_uiOutputs[i].sentAt = 0;
    g_uiOutputs[i].pending = false;
  }
  uiClearOutboundLocked();
  if (emitReset) {
    g_uiOut[g_uiOutHead] = event;
    g_uiOutHead = (uint8_t)((g_uiOutHead + 1) % P1_EMBED_UI_OUT_DEPTH);
    g_uiOutCount = 1;
  }
  portEXIT_CRITICAL(&g_uiInputMux);
}

static void uiQueueItem(int cmd, const char* type, const String& id, const String& label, int value, int minValue, int maxValue) {
  P1UiOutboundEvent event{};
  event.kind = P1_UI_OUT_ITEM;
  event.cmd = cmd;
  event.value = value;
  event.minValue = minValue;
  event.maxValue = maxValue;
  uiCopy(event.id, sizeof(event.id), id);
  uiCopy(event.type, sizeof(event.type), String(type ? type : "value"));
  uiCopy(event.label, sizeof(event.label), label.length() ? label : id);
  if (cmd == P1_UI_ADD_LABEL) uiCopy(event.text, sizeof(event.text), label.length() ? label : id);
  uiQueueOutbound(event);
}

static void uiQueueStyle(int r, int g, int b) {
  P1UiOutboundEvent event{};
  event.kind = P1_UI_OUT_STYLE;
  event.cmd = P1_UI_SET_COLOR;
  event.r = r;
  event.g = g;
  event.b = b;
  uiQueueOutbound(event);
}

static void uiQueueText(const String& id, const String& text) {
  P1UiOutboundEvent event{};
  event.kind = P1_UI_OUT_TEXT;
  event.cmd = P1_UI_CLEAR_LABEL;
  uiCopy(event.id, sizeof(event.id), id);
  uiCopy(event.text, sizeof(event.text), text);
  uiQueueOutbound(event);
}

static bool uiOutputShouldSend(const char* id, int value, bool force, unsigned long minIntervalMs) {
  if (!id || !id[0]) id = "value";
  unsigned long now = millis();
  portENTER_CRITICAL(&g_uiInputMux);
  int index = uiFindOrCreateOutputLocked(id);
  bool changed = index < 0 || g_uiOutputs[index].value != value;
  bool due = index < 0 || g_uiOutputs[index].sentAt == 0 || (now - g_uiOutputs[index].sentAt) >= minIntervalMs;
  bool send = (changed || force) && due;
  if (index >= 0) {
    g_uiOutputs[index].value = value;
    if (send) {
      g_uiOutputs[index].sentAt = now;
      g_uiOutputs[index].pending = true;
    }
  }
  portEXIT_CRITICAL(&g_uiInputMux);
  return send;
}

static bool uiOutputValueChanged(const char* id, int value) {
  return uiOutputShouldSend(id, value, false, P1_EMBED_UI_VALUE_MIN_MS);
}

static bool uiOutputValuePushed(const char* id, int value) {
  return uiOutputShouldSend(id, value, true, P1_EMBED_UI_PUSH_MIN_MS);
}

static bool uiPopOutbound(P1UiOutboundEvent& event) {
  portENTER_CRITICAL(&g_uiInputMux);
  if (g_uiOutCount == 0) {
    portEXIT_CRITICAL(&g_uiInputMux);
    return false;
  }
  event = g_uiOut[g_uiOutTail];
  g_uiOutTail = (uint8_t)((g_uiOutTail + 1) % P1_EMBED_UI_OUT_DEPTH);
  g_uiOutCount--;
  portEXIT_CRITICAL(&g_uiInputMux);
  return true;
}

static void uiEmitOutboundEvent(const P1UiOutboundEvent& event) {
  if (event.kind == P1_UI_OUT_RESET) {
    if (event.text[0]) {
      P1EventField fields[] = {
        p1FieldInt("cmd", event.cmd),
        p1FieldString("title", event.text),
      };
      protocolEmitEventFields("ui.reset", fields, 2);
    } else {
      P1EventField fields[] = {
        p1FieldInt("cmd", event.cmd),
      };
      protocolEmitEventFields("ui.reset", fields, 1);
    }
    return;
  }

  if (event.kind == P1_UI_OUT_ITEM) {
    if (event.cmd == P1_UI_ADD_LABEL) {
      P1EventField fields[] = {
        p1FieldInt("cmd", event.cmd),
        p1FieldString("id", event.id),
        p1FieldString("type", event.type),
        p1FieldString("label", event.label),
        p1FieldString("text", event.text[0] ? event.text : event.label),
      };
      protocolEmitEventFields("ui.item", fields, 5);
    } else {
      P1EventField fields[] = {
        p1FieldInt("cmd", event.cmd),
        p1FieldString("id", event.id),
        p1FieldString("type", event.type),
        p1FieldString("label", event.label),
        p1FieldInt("value", event.value),
        p1FieldInt("min", event.minValue),
        p1FieldInt("max", event.maxValue),
      };
      protocolEmitEventFields("ui.item", fields, 7);
    }
    return;
  }

  if (event.kind == P1_UI_OUT_STYLE) {
    P1EventField fields[] = {
      p1FieldInt("cmd", event.cmd),
      p1FieldInt("r", event.r),
      p1FieldInt("g", event.g),
      p1FieldInt("b", event.b),
    };
    protocolEmitEventFields("ui.style", fields, 4);
    return;
  }

  if (event.kind == P1_UI_OUT_TEXT) {
    P1EventField fields[] = {
      p1FieldInt("cmd", event.cmd),
      p1FieldString("id", event.id),
      p1FieldString("text", event.text),
    };
    protocolEmitEventFields("ui.text", fields, 3);
  }
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

static void w_p1_touchReadPair(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int drivePin = wrArgInt(argv, argn, 0, -1);
  int sensePin = wrArgInt(argv, argn, 1, -1);
  int samples = constrain(wrArgInt(argv, argn, 2, 32), 1, 256);
  int settleUs = constrain(wrArgInt(argv, argn, 3, 5), 0, 1000);
  if (drivePin < 0 || sensePin < 0 || drivePin == sensePin) {
    wrRetInt(retVal, 0);
    return;
  }

  int32_t total = 0;
  pinMode(drivePin, OUTPUT);
  pinMode(sensePin, INPUT);
  for (int i = 0; i < samples; i++) {
    digitalWrite(drivePin, HIGH);
    if (settleUs > 0) delayMicroseconds((uint32_t)settleUs);
    int high = analogRead(sensePin);

    digitalWrite(drivePin, LOW);
    if (settleUs > 0) delayMicroseconds((uint32_t)settleUs);
    int low = analogRead(sensePin);

    total += high - low;
  }

  digitalWrite(drivePin, LOW);
  pinMode(drivePin, INPUT);
  pinMode(sensePin, INPUT);
  wrRetInt(retVal, (int)(total / samples));
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

static void w_p1_diagArray3(WRContext* ctx, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  if (!wrRetIntArray3(ctx, retVal, wrArgInt(argv, argn, 0, 0), wrArgInt(argv, argn, 1, 0), wrArgInt(argv, argn, 2, 0))) {
    scriptErrorSet("binding", "diag_array_alloc_failed", "diagArray3 failed to allocate return array");
  }
}

static void w_p1_diagFloatArray3(WRContext* ctx, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  if (!wrRetFloatArray3(ctx, retVal, wrArgFloat(argv, argn, 0, 0.0f), wrArgFloat(argv, argn, 1, 0.0f), wrArgFloat(argv, argn, 2, 0.0f))) {
    scriptErrorSet("binding", "diag_float_array_alloc_failed", "diagFloatArray3 failed to allocate return array");
  }
}

static void w_p1_wifiConnected(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  wrRetInt(retVal, wifiCachedSnapshot().connected ? 1 : 0);
}

static void w_p1_wifiIp(WRContext* ctx, const WRValue*, const int, WRValue& retVal, void*) {
  P1WifiSnapshot wifi = wifiCachedSnapshot();
  wrRetString(ctx, retVal, wifi.connected ? wifi.ip : String(""));
}

static void w_p1_wifiRssi(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  P1WifiSnapshot wifi = wifiCachedSnapshot();
  wrRetInt(retVal, wifi.connected ? wifi.rssi : 0);
}

static void w_p1_wifiSsid(WRContext* ctx, const WRValue*, const int, WRValue& retVal, void*) {
  P1WifiSnapshot wifi = wifiCachedSnapshot();
  wrRetString(ctx, retVal, wifi.connected ? wifi.ssid : configWifiSsid());
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

static void w_p1_lerp(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  float a = wrArgFloat(argv, argn, 0, 0.0f);
  float b = wrArgFloat(argv, argn, 1, 0.0f);
  float t = constrain(wrArgFloat(argv, argn, 2, 0.0f), 0.0f, 1.0f);
  wrRetFloat(retVal, a + (b - a) * t);
}

static void w_p1_map(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  float value = wrArgFloat(argv, argn, 0, 0.0f);
  float inMin = wrArgFloat(argv, argn, 1, 0.0f);
  float inMax = wrArgFloat(argv, argn, 2, 1.0f);
  float outMin = wrArgFloat(argv, argn, 3, 0.0f);
  float outMax = wrArgFloat(argv, argn, 4, 1.0f);
  float span = inMax - inMin;
  if (span == 0.0f) {
    wrRetFloat(retVal, outMin);
    return;
  }
  wrRetFloat(retVal, outMin + ((value - inMin) * (outMax - outMin)) / span);
}

static void w_p1_constrain(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  float value = wrArgFloat(argv, argn, 0, 0.0f);
  float low = wrArgFloat(argv, argn, 1, 0.0f);
  float high = wrArgFloat(argv, argn, 2, 1.0f);
  if (low > high) {
    float tmp = low;
    low = high;
    high = tmp;
  }
  wrRetFloat(retVal, constrain(value, low, high));
}

static void w_p1_min(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetFloat(retVal, min(wrArgFloat(argv, argn, 0, 0.0f), wrArgFloat(argv, argn, 1, 0.0f)));
}

static void w_p1_max(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetFloat(retVal, max(wrArgFloat(argv, argn, 0, 0.0f), wrArgFloat(argv, argn, 1, 0.0f)));
}

static void w_p1_abs(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetFloat(retVal, fabsf(wrArgFloat(argv, argn, 0, 0.0f)));
}

static void w_p1_sin(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetFloat(retVal, sinf(wrArgFloat(argv, argn, 0, 0.0f)));
}

static void w_p1_cos(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetFloat(retVal, cosf(wrArgFloat(argv, argn, 0, 0.0f)));
}

static void w_p1_tan(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetFloat(retVal, tanf(wrArgFloat(argv, argn, 0, 0.0f)));
}

static void w_p1_asin(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetFloat(retVal, asinf(constrain(wrArgFloat(argv, argn, 0, 0.0f), -1.0f, 1.0f)));
}

static void w_p1_acos(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetFloat(retVal, acosf(constrain(wrArgFloat(argv, argn, 0, 0.0f), -1.0f, 1.0f)));
}

static void w_p1_atan(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetFloat(retVal, atanf(wrArgFloat(argv, argn, 0, 0.0f)));
}

static void w_p1_atan2(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetFloat(retVal, atan2f(wrArgFloat(argv, argn, 0, 0.0f), wrArgFloat(argv, argn, 1, 0.0f)));
}

static void w_p1_sqrt(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetFloat(retVal, sqrtf(max(0.0f, wrArgFloat(argv, argn, 0, 0.0f))));
}

static void w_p1_pow(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetFloat(retVal, powf(wrArgFloat(argv, argn, 0, 0.0f), wrArgFloat(argv, argn, 1, 1.0f)));
}

static void w_p1_floor(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetFloat(retVal, floorf(wrArgFloat(argv, argn, 0, 0.0f)));
}

static void w_p1_ceil(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetFloat(retVal, ceilf(wrArgFloat(argv, argn, 0, 0.0f)));
}

static void w_p1_round(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetFloat(retVal, roundf(wrArgFloat(argv, argn, 0, 0.0f)));
}

static void w_p1_exp(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetFloat(retVal, expf(wrArgFloat(argv, argn, 0, 0.0f)));
}

static void w_p1_ln(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetFloat(retVal, logf(max(0.000001f, wrArgFloat(argv, argn, 0, 1.0f))));
}

static void w_p1_log10(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetFloat(retVal, log10f(max(0.000001f, wrArgFloat(argv, argn, 0, 1.0f))));
}

static void w_p1_fmod(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  float divisor = wrArgFloat(argv, argn, 1, 1.0f);
  wrRetFloat(retVal, divisor == 0.0f ? 0.0f : fmodf(wrArgFloat(argv, argn, 0, 0.0f), divisor));
}

static void w_p1_radians(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetFloat(retVal, wrArgFloat(argv, argn, 0, 0.0f) * (3.14159265358979323846f / 180.0f));
}

static void w_p1_degrees(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetFloat(retVal, wrArgFloat(argv, argn, 0, 0.0f) * (180.0f / 3.14159265358979323846f));
}

static void w_p1_noiseSeed(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  uint32_t seed = wrArgPresent(argv, argn, 0) ? (uint32_t)wrArgInt(argv, argn, 0, 1) : (uint32_t)micros();
  noiseSeedSimplex(seed);
  wrRetInt(retVal, (int)g_noiseSeed);
}

static void w_p1_simplex3(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetFloat(retVal, noiseSimplex3(wrArgFloat(argv, argn, 0, 0.0f), wrArgFloat(argv, argn, 1, 0.0f), wrArgFloat(argv, argn, 2, 0.0f)));
}

static void w_p1_simplex3_01(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  float value = (noiseSimplex3(wrArgFloat(argv, argn, 0, 0.0f), wrArgFloat(argv, argn, 1, 0.0f), wrArgFloat(argv, argn, 2, 0.0f)) + 1.0f) * 0.5f;
  wrRetFloat(retVal, constrain(value, 0.0f, 1.0f));
}

static bool wrLocalTime(tm& out) {
  time_t now = time(nullptr);
  if (now < 100000) return false;
  localtime_r(&now, &out);
  return true;
}

static void w_p1_timeNow(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  wrRetInt(retVal, (int)time(nullptr));
}

static void w_p1_timeLocal(WRContext* ctx, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  tm info;
  int year = -1;
  int month = -1;
  int day = -1;
  int hour = -1;
  int minute = -1;
  int second = -1;
  if (wrLocalTime(info)) {
    year = info.tm_year + 1900;
    month = info.tm_mon + 1;
    day = info.tm_mday;
    hour = info.tm_hour;
    minute = info.tm_min;
    second = info.tm_sec;
  }

  if (argn >= 1) {
    bool ok = wrSetArrayInt6(ctx, argv, argn, 0, year, month, day, hour, minute, second);
    if (!ok) scriptErrorSet("binding", "time_local_into_failed", "timeLocal failed to write output array");
    wrRetInt(retVal, ok ? 1 : 0);
    return;
  }

  if (!wrRetIntArray6(ctx, retVal, year, month, day, hour, minute, second)) {
    scriptErrorSet("binding", "time_local_alloc_failed", "timeLocal failed to allocate return array");
  }
}

// Legacy scalar time bindings kept for existing sketches. Prefer timeLocal(out).
static void w_p1_timeLocalHour(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  tm info;
  wrRetInt(retVal, wrLocalTime(info) ? info.tm_hour : -1);
}

static void w_p1_timeLocalMinute(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  tm info;
  wrRetInt(retVal, wrLocalTime(info) ? info.tm_min : -1);
}

static void w_p1_timeLocalSeconds(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  tm info;
  wrRetInt(retVal, wrLocalTime(info) ? info.tm_sec : -1);
}

static void w_p1_timeLocalDay(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  tm info;
  wrRetInt(retVal, wrLocalTime(info) ? info.tm_mday : -1);
}

static void w_p1_timeLocalMonth(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  tm info;
  wrRetInt(retVal, wrLocalTime(info) ? info.tm_mon + 1 : -1);
}

static void w_p1_timeLocalYear(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  tm info;
  wrRetInt(retVal, wrLocalTime(info) ? info.tm_year + 1900 : -1);
}

static void w_p1_timeGet(WRContext* ctx, const WRValue*, const int, WRValue& retVal, void*) {
  tm info;
  if (!wrLocalTime(info)) {
    wrRetString(ctx, retVal, "");
    return;
  }
  char buf[24];
  snprintf(buf, sizeof(buf), "%04d-%02d-%02d %02d:%02d:%02d", info.tm_year + 1900, info.tm_mon + 1, info.tm_mday, info.tm_hour, info.tm_min, info.tm_sec);
  wrRetString(ctx, retVal, String(buf));
}

static void w_p1_sunLocal(WRContext* ctx, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  float elevation = -90.0f;
  float azimuth = 0.0f;
  int brightness = 0;
  int kelvin = 2200;
  double latitude = wrArgFloat(argv, argn, 0, 0.0f);
  double longitude = wrArgFloat(argv, argn, 1, 0.0f);
  int outIdx = -1;
  time_t timestamp = time(nullptr);

  if (wrArgIsArray(argv, argn, 2)) {
    outIdx = 2;
  } else {
    if (wrArgPresent(argv, argn, 2)) timestamp = (time_t)wrArgInt(argv, argn, 2, (int)timestamp);
    if (wrArgIsArray(argv, argn, 3)) outIdx = 3;
  }

  sunCalculate(latitude, longitude, timestamp, elevation, azimuth, brightness, kelvin);
  int elevationInt = (int)roundf(elevation);
  int azimuthInt = constrain((int)roundf(azimuth), 0, 360);
  if (outIdx >= 0) {
    bool ok = wrSetArrayInt4(ctx, argv, argn, outIdx, elevationInt, azimuthInt, brightness, kelvin);
    if (!ok) scriptErrorSet("binding", "sun_local_into_failed", "sunLocal failed to write output array");
    wrRetInt(retVal, ok ? 1 : 0);
    return;
  }

  if (!wrRetIntArray4(ctx, retVal, elevationInt, azimuthInt, brightness, kelvin)) {
    scriptErrorSet("binding", "sun_local_alloc_failed", "sunLocal failed to allocate return array");
  }
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

static void w_p1_ledGetRgb(WRContext* ctx, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int r = 0;
  int g = 0;
  int b = 0;
  ledGetPixel(wrArgInt(argv, argn, 0, 0), wrArgInt(argv, argn, 1, -1), r, g, b);
  if (argn >= 3) {
    bool ok = wrSetArrayInt3(ctx, argv, argn, 2, r, g, b);
    if (!ok) scriptErrorSet("binding", "led_get_rgb_into_failed", "ledGetRgb failed to write output array");
    wrRetInt(retVal, ok ? 1 : 0);
    return;
  }
  if (!wrRetIntArray3(ctx, retVal, r, g, b)) {
    scriptErrorSet("binding", "led_get_rgb_alloc_failed", "ledGetRgb failed to allocate return array");
  }
}

static void w_p1_ledGetRgbInto(WRContext* ctx, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  w_p1_ledGetRgb(ctx, argv, argn, retVal, nullptr);
}

static void w_p1_ledSetRgb(WRContext* ctx, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int strip = wrArgInt(argv, argn, 0, 0);
  int index = wrArgInt(argv, argn, 1, -1);
  int r = wrArgArrayInt(ctx, argv, argn, 2, 0, wrArgInt(argv, argn, 2, 0));
  int g = wrArgArrayInt(ctx, argv, argn, 2, 1, wrArgInt(argv, argn, 3, 0));
  int b = wrArgArrayInt(ctx, argv, argn, 2, 2, wrArgInt(argv, argn, 4, 0));
  bool ok = ledSetPixel(strip, index, r, g, b);
  if (!ok) scriptErrorSet("binding", "led_set_rgb_failed", "ledSetRgb failed", "\"strip\":" + String(strip) + ",\"index\":" + String(index));
  wrRetInt(retVal, ok ? 1 : 0);
}

static void w_p1_hsvToRgb(WRContext* ctx, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int r = 0;
  int g = 0;
  int b = 0;
  bool inputArray = wrArgIsArray(argv, argn, 0);
  int h = inputArray ? wrArgArrayInt(ctx, argv, argn, 0, 0, 0) : wrArgInt(argv, argn, 0, 0);
  int s = inputArray ? wrArgArrayInt(ctx, argv, argn, 0, 1, 255) : wrArgInt(argv, argn, 1, 255);
  int v = inputArray ? wrArgArrayInt(ctx, argv, argn, 0, 2, 255) : wrArgInt(argv, argn, 2, 255);
  hsvToRgb8(h, s, v, r, g, b);
  int outIdx = inputArray ? (argn >= 2 ? 1 : -1) : (argn >= 4 ? 3 : -1);
  if (outIdx >= 0) {
    bool ok = wrSetArrayInt3(ctx, argv, argn, outIdx, r, g, b);
    if (!ok) scriptErrorSet("binding", "hsv_to_rgb_into_failed", "hsvToRgb failed to write output array");
    wrRetInt(retVal, ok ? 1 : 0);
    return;
  }
  if (!wrRetIntArray3(ctx, retVal, r, g, b)) {
    scriptErrorSet("binding", "hsv_to_rgb_alloc_failed", "hsvToRgb failed to allocate return array");
  }
}

static void w_p1_hsvToRgbInto(WRContext* ctx, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  w_p1_hsvToRgb(ctx, argv, argn, retVal, nullptr);
}

static void w_p1_rgbToHsv(WRContext* ctx, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int h = 0;
  int s = 0;
  int v = 0;
  bool inputArray = wrArgIsArray(argv, argn, 0);
  int r = inputArray ? wrArgArrayInt(ctx, argv, argn, 0, 0, 0) : wrArgInt(argv, argn, 0, 0);
  int g = inputArray ? wrArgArrayInt(ctx, argv, argn, 0, 1, 0) : wrArgInt(argv, argn, 1, 0);
  int b = inputArray ? wrArgArrayInt(ctx, argv, argn, 0, 2, 0) : wrArgInt(argv, argn, 2, 0);
  rgbToHsv8(r, g, b, h, s, v);
  int outIdx = inputArray ? (argn >= 2 ? 1 : -1) : (argn >= 4 ? 3 : -1);
  if (outIdx >= 0) {
    bool ok = wrSetArrayInt3(ctx, argv, argn, outIdx, h, s, v);
    if (!ok) scriptErrorSet("binding", "rgb_to_hsv_into_failed", "rgbToHsv failed to write output array");
    wrRetInt(retVal, ok ? 1 : 0);
    return;
  }
  if (!wrRetIntArray3(ctx, retVal, h, s, v)) {
    scriptErrorSet("binding", "rgb_to_hsv_alloc_failed", "rgbToHsv failed to allocate return array");
  }
}

static void w_p1_rgbToHsvInto(WRContext* ctx, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  w_p1_rgbToHsv(ctx, argv, argn, retVal, nullptr);
}

// Legacy scalar color component bindings kept for existing sketches.
// Prefer ledGetRgb(..., out), rgbToHsv(..., out), and hsvToRgb(..., out).
static void wrRetLedComponent(const WRValue* argv, const int argn, WRValue& retVal, int component) {
  int r = 0;
  int g = 0;
  int b = 0;
  ledGetPixel(wrArgInt(argv, argn, 0, 0), wrArgInt(argv, argn, 1, -1), r, g, b);
  wrRetInt(retVal, component == 0 ? r : (component == 1 ? g : b));
}

static void w_p1_ledGetR(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetLedComponent(argv, argn, retVal, 0);
}

static void w_p1_ledGetG(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetLedComponent(argv, argn, retVal, 1);
}

static void w_p1_ledGetB(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetLedComponent(argv, argn, retVal, 2);
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

static void w_p1_paletteSet2(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int rgb[6] = {
    wrArgInt(argv, argn, 1, 0), wrArgInt(argv, argn, 2, 0), wrArgInt(argv, argn, 3, 0),
    wrArgInt(argv, argn, 4, 255), wrArgInt(argv, argn, 5, 255), wrArgInt(argv, argn, 6, 255),
  };
  wrRetInt(retVal, paletteSet(wrArgInt(argv, argn, 0, 0), 2, rgb) ? 1 : 0);
}

static void w_p1_paletteSet3(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int rgb[9] = {
    wrArgInt(argv, argn, 1, 0), wrArgInt(argv, argn, 2, 0), wrArgInt(argv, argn, 3, 0),
    wrArgInt(argv, argn, 4, 127), wrArgInt(argv, argn, 5, 127), wrArgInt(argv, argn, 6, 127),
    wrArgInt(argv, argn, 7, 255), wrArgInt(argv, argn, 8, 255), wrArgInt(argv, argn, 9, 255),
  };
  wrRetInt(retVal, paletteSet(wrArgInt(argv, argn, 0, 0), 3, rgb) ? 1 : 0);
}

static void w_p1_paletteSet4(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int rgb[12] = {
    wrArgInt(argv, argn, 1, 0), wrArgInt(argv, argn, 2, 0), wrArgInt(argv, argn, 3, 0),
    wrArgInt(argv, argn, 4, 85), wrArgInt(argv, argn, 5, 85), wrArgInt(argv, argn, 6, 85),
    wrArgInt(argv, argn, 7, 170), wrArgInt(argv, argn, 8, 170), wrArgInt(argv, argn, 9, 170),
    wrArgInt(argv, argn, 10, 255), wrArgInt(argv, argn, 11, 255), wrArgInt(argv, argn, 12, 255),
  };
  wrRetInt(retVal, paletteSet(wrArgInt(argv, argn, 0, 0), 4, rgb) ? 1 : 0);
}

static void w_p1_paletteGetRgb(WRContext* ctx, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int slot = wrArgInt(argv, argn, 0, 0);
  int t = wrArgInt(argv, argn, 1, 0);
  int r = paletteSampleComponent(slot, t, 0);
  int g = paletteSampleComponent(slot, t, 1);
  int b = paletteSampleComponent(slot, t, 2);
  if (argn >= 3) {
    bool ok = wrSetArrayInt3(ctx, argv, argn, 2, r, g, b);
    if (!ok) scriptErrorSet("binding", "palette_get_rgb_into_failed", "paletteGetRgb failed to write output array");
    wrRetInt(retVal, ok ? 1 : 0);
    return;
  }
  if (!wrRetIntArray3(ctx, retVal, r, g, b)) {
    scriptErrorSet("binding", "palette_get_rgb_alloc_failed", "paletteGetRgb failed to allocate return array");
  }
}

// Legacy scalar palette component bindings kept for existing sketches.
// Prefer paletteGetRgb(slot, t, out).
static void wrRetPaletteComponent(const WRValue* argv, const int argn, WRValue& retVal, int component) {
  wrRetInt(retVal, paletteSampleComponent(wrArgInt(argv, argn, 0, 0), wrArgInt(argv, argn, 1, 0), component));
}

static void w_p1_paletteGetR(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetPaletteComponent(argv, argn, retVal, 0);
}

static void w_p1_paletteGetG(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetPaletteComponent(argv, argn, retVal, 1);
}

static void w_p1_paletteGetB(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wrRetPaletteComponent(argv, argn, retVal, 2);
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

void uiOutputFlush() {
  uint8_t layoutSent = 0;
  while (layoutSent < P1_EMBED_UI_OUT_FLUSH_BUDGET) {
    P1UiOutboundEvent event;
    if (!uiPopOutbound(event)) break;
    uiEmitOutboundEvent(event);
    layoutSent++;
  }

  uint8_t sent = 0;
  while (sent < P1_EMBED_UI_VALUE_FLUSH_BUDGET) {
    char id[P1_EMBED_UI_ID_MAX];
    int value = 0;
    bool found = false;

    portENTER_CRITICAL(&g_uiInputMux);
    for (int i = 0; i < P1_EMBED_UI_STATE_MAX; i++) {
      if (g_uiOutputs[i].used && g_uiOutputs[i].pending) {
        strlcpy(id, g_uiOutputs[i].id, sizeof(id));
        value = g_uiOutputs[i].value;
        g_uiOutputs[i].pending = false;
        found = true;
        break;
      }
    }
    portEXIT_CRITICAL(&g_uiInputMux);

    if (!found) return;
    uiEmitValue(String(id), value);
    sent++;
  }
}

static String wrUiId(const WRValue* argv, int argn, int idx, const char* fallback) {
  String id = wrArgStringValue(argv, argn, idx);
  id.trim();
  if (!id.length()) id = fallback ? fallback : "item";
  return id;
}

static void wrUiIdBuf(const WRValue* argv, int argn, int idx, const char* fallback, char* out, size_t outLen) {
  if (!out || outLen == 0) return;
  wrArgString(argv, argn, idx, out, outLen);
  if (!out[0] && fallback) strlcpy(out, fallback, outLen);
}

static void wrUiEmitItem(int cmd, const char* type, const String& id, const String& label, int value, int minValue, int maxValue) {
  uiQueueItem(cmd, type, id, label, value, minValue, maxValue);
}

static void w_p1_uiBegin(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String title = wrArgStringValue(argv, argn, 0);
  if (!title.length()) title = "Live UI";
  g_uiAutoItemCounter = 0;
  uiClearOutputCache();
  uiQueueReset(title);
  wrRetInt(retVal, 1);
}

static void w_p1_uiClear(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  g_uiAutoItemCounter = 0;
  uiClearOutputCache();
  uiQueueReset("");
  wrRetInt(retVal, 1);
}

static void w_p1_uiLabel(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String id = wrUiId(argv, argn, 0, "label");
  String label = wrArgStringValue(argv, argn, 1);
  if (!label.length()) label = id;
  uiQueueItem(P1_UI_ADD_LABEL, "label", id, label, 0, 0, 1);
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
  uiQueueStyle(r, g, b);
  wrRetInt(retVal, 1);
}

static void w_p1_uiUpdate(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  char id[P1_EMBED_UI_ID_MAX];
  wrUiIdBuf(argv, argn, 0, "value", id, sizeof(id));
  int value = wrArgInt(argv, argn, 1, 0);
  if (uiOutputValueChanged(id, value)) {
    wrRetInt(retVal, 1);
  } else {
    wrRetInt(retVal, 0);
  }
}

static void w_p1_uiPush(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  char id[P1_EMBED_UI_ID_MAX];
  wrUiIdBuf(argv, argn, 0, "value", id, sizeof(id));
  int value = wrArgInt(argv, argn, 1, 0);
  if (uiOutputValuePushed(id, value)) {
    wrRetInt(retVal, 1);
  } else {
    wrRetInt(retVal, 0);
  }
}

static void w_p1_uiText(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String id = wrUiId(argv, argn, 0, "label");
  String text = wrArgStringValue(argv, argn, 1);
  uiQueueText(id, text);
  wrRetInt(retVal, 1);
}

static void w_p1_uiPoll(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  P1UiInputEvent event;
  if (!uiInputPop(event)) {
    wrRetInt(retVal, 0);
    return;
  }
  strlcpy(g_lastUiEventId, event.id, sizeof(g_lastUiEventId));
  strlcpy(g_lastUiEventType, event.type, sizeof(g_lastUiEventType));
  g_lastUiEventValue = event.value;
  wrRetInt(retVal, 1);
}

static void w_p1_uiEventValue(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  wrRetInt(retVal, g_lastUiEventValue);
}

static void w_p1_uiEventIs(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  char type[P1_EMBED_UI_TYPE_MAX];
  char id[P1_EMBED_UI_ID_MAX];
  wrArgString(argv, argn, 0, type, sizeof(type));
  wrArgString(argv, argn, 1, id, sizeof(id));
  bool typeMatches = !type[0] || strncmp(g_lastUiEventType, type, sizeof(g_lastUiEventType)) == 0;
  bool idMatches = !id[0] || strncmp(g_lastUiEventId, id, sizeof(g_lastUiEventId)) == 0;
  wrRetInt(retVal, (typeMatches && idMatches) ? 1 : 0);
}

static void w_p1_uiGet(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  char id[P1_EMBED_UI_ID_MAX];
  wrUiIdBuf(argv, argn, 0, "value", id, sizeof(id));
  int fallback = wrArgInt(argv, argn, 1, 0);
  wrRetInt(retVal, uiInputValue(id, fallback));
}

static void w_p1_uiChanged(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  char id[P1_EMBED_UI_ID_MAX];
  wrUiIdBuf(argv, argn, 0, "value", id, sizeof(id));
  wrRetInt(retVal, uiInputChanged(id) ? 1 : 0);
}

static void w_p1_haBegin(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String name = wrArgStringValue(argv, argn, 0);
  wrRetInt(retVal, haBeginDevice(name) ? 1 : 0);
}

static void w_p1_haSensor(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String id = wrArgStringValue(argv, argn, 0);
  String name = wrArgStringValue(argv, argn, 1);
  float value = wrArgFloat(argv, argn, 2, 0.0f);
  String unit = wrArgStringValue(argv, argn, 3);
  wrRetInt(retVal, haDeclareSensor(id, name, value, unit) ? 1 : 0);
}

static void w_p1_haBinarySensor(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String id = wrArgStringValue(argv, argn, 0);
  String name = wrArgStringValue(argv, argn, 1);
  bool value = wrArgInt(argv, argn, 2, 0) != 0;
  wrRetInt(retVal, haDeclareBinarySensor(id, name, value) ? 1 : 0);
}

static void w_p1_haSwitch(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String id = wrArgStringValue(argv, argn, 0);
  String name = wrArgStringValue(argv, argn, 1);
  bool value = wrArgInt(argv, argn, 2, 0) != 0;
  wrRetInt(retVal, haDeclareSwitch(id, name, value) ? 1 : 0);
}

static void w_p1_haNumber(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String id = wrArgStringValue(argv, argn, 0);
  String name = wrArgStringValue(argv, argn, 1);
  float value = wrArgFloat(argv, argn, 2, 0.0f);
  float minValue = wrArgFloat(argv, argn, 3, 0.0f);
  float maxValue = wrArgFloat(argv, argn, 4, 100.0f);
  float step = wrArgFloat(argv, argn, 5, 1.0f);
  wrRetInt(retVal, haDeclareNumber(id, name, value, minValue, maxValue, step) ? 1 : 0);
}

static void w_p1_haButton(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String id = wrArgStringValue(argv, argn, 0);
  String name = wrArgStringValue(argv, argn, 1);
  wrRetInt(retVal, haDeclareButton(id, name) ? 1 : 0);
}

static void w_p1_haLight(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String id = wrArgStringValue(argv, argn, 0);
  String name = wrArgStringValue(argv, argn, 1);
  float brightness = wrArgFloat(argv, argn, 2, 100.0f);
  wrRetInt(retVal, haDeclareLight(id, name, brightness) ? 1 : 0);
}

static void w_p1_haUpdate(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String id = wrArgStringValue(argv, argn, 0);
  float value = wrArgFloat(argv, argn, 1, 0.0f);
  bool ok = haUpdateValue(id, value);
  if (!ok) scriptErrorSet("binding", "ha_entity_missing", "haSet failed because the Home Assistant entity does not exist", "\"id\":" + jsonString(id));
  wrRetInt(retVal, ok ? 1 : 0);
}

static void w_p1_haSet(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String id = wrArgStringValue(argv, argn, 0);
  float value = wrArgFloat(argv, argn, 1, 0.0f);
  bool ok = haUpdateValue(id, value);
  if (!ok) scriptErrorSet("binding", "ha_entity_missing", "haSet failed because the Home Assistant entity does not exist", "\"id\":" + jsonString(id));
  wrRetInt(retVal, ok ? 1 : 0);
}

static void w_p1_haGet(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String id = wrArgStringValue(argv, argn, 0);
  float value = 0.0f;
  if (!haInputValue(id, value)) {
    scriptErrorSet("binding", "ha_entity_missing", "haGet failed because the Home Assistant entity does not exist", "\"id\":" + jsonString(id));
    wrRetFloat(retVal, 0.0f);
    return;
  }
  wrRetFloat(retVal, value);
}

static void w_p1_haChanged(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String id = wrArgStringValue(argv, argn, 0);
  wrRetInt(retVal, haInputChanged(id) ? 1 : 0);
}

static void w_p1_haPoll(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  P1HaInputEvent event;
  if (!haInputPop(event)) {
    wrRetInt(retVal, 0);
    return;
  }
  strlcpy(g_lastHaEventId, event.id, sizeof(g_lastHaEventId));
  strlcpy(g_lastHaEventType, event.type, sizeof(g_lastHaEventType));
  g_lastHaEventValue = event.value;
  wrRetInt(retVal, 1);
}

static void w_p1_haEvent(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String id = wrArgStringValue(argv, argn, 0);
  String type = wrArgStringValue(argv, argn, 1);
  P1HaInputEvent event;
  if (!haInputTakeMatching(id, type, event)) {
    wrRetInt(retVal, 0);
    return;
  }
  strlcpy(g_lastHaEventId, event.id, sizeof(g_lastHaEventId));
  strlcpy(g_lastHaEventType, event.type, sizeof(g_lastHaEventType));
  g_lastHaEventValue = event.value;
  wrRetInt(retVal, 1);
}

static void w_p1_haPress(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  String id = wrArgStringValue(argv, argn, 0);
  bool ok = haPressButton(id);
  if (!ok) scriptErrorSet("binding", "ha_button_missing", "haPress failed because the Home Assistant button does not exist", "\"id\":" + jsonString(id));
  wrRetInt(retVal, ok ? 1 : 0);
}

static void w_p1_haEventValue(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  wrRetFloat(retVal, g_lastHaEventValue);
}

static void w_p1_haEventIs(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  char id[P1_EMBED_HA_ID_MAX];
  char type[P1_EMBED_HA_TYPE_MAX];
  wrArgString(argv, argn, 0, id, sizeof(id));
  wrArgString(argv, argn, 1, type, sizeof(type));
  bool idMatches = !id[0] || strncmp(g_lastHaEventId, id, sizeof(g_lastHaEventId)) == 0;
  bool typeMatches = !type[0] || strncmp(g_lastHaEventType, type, sizeof(g_lastHaEventType)) == 0;
  wrRetInt(retVal, (idMatches && typeMatches) ? 1 : 0);
}

static void w_p1_haEventType(WRContext* ctx, const WRValue*, const int, WRValue& retVal, void*) {
  wrRetString(ctx, retVal, String(g_lastHaEventType));
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
  } else if (key == "timezone") {
    configSetTimezone(value);
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
    "pinMode", "digitalWrite", "digitalRead", "analogRead", "touchRead", "touchReadPair",
    "delay", "delayMicroseconds", "millis", "micros",
    "random", "randomSeed", "freeHeap", "diagArray3", "diagFloatArray3",
    "lerp", "map", "constrain", "min", "max", "abs",
    "sin", "cos", "tan", "asin", "acos", "atan", "atan2",
    "sqrt", "pow", "floor", "ceil", "round", "exp", "ln", "log10",
    "fmod", "radians", "degrees",
    "noiseSeed", "simplex3", "simplex3_01",
    "timeNow", "timeLocal", "timeGet", "sunLocal",
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
    "ledGetRgb", "ledGetRgbInto", "ledSetRgb",
    "hsvToRgb", "hsvToRgbInto", "rgbToHsv", "rgbToHsvInto",
    "paletteSet2", "paletteSet3", "paletteSet4", "paletteGetRgb",
    "ledFill", "ledClear", "ledShow", "ledBrightness", "ledStatus",
    "log", "emit", "emitJson", "statusGet", "configGet", "configSet",
    "wifiStatus", "wifiConnect", "wifiDisconnect", "reboot",
    "inboxAvailable", "inboxRead", "inboxChannel", "inboxClear",
    "inboxDrops", "lastError", "clearError",
    "uiBegin", "uiClear", "uiLabel", "uiButton", "uiToggle", "uiSlider",
    "uiValue", "uiGraph", "uiSpacer", "uiColumn", "uiColor",
    "uiUpdate", "uiPush", "uiText", "uiPoll",
    "uiEventIs", "uiEventValue", "uiGet", "uiChanged",
#if P1_EMBED_HA_ENABLED
    "haBegin", "haSensor", "haBinarySensor", "haSwitch", "haNumber",
    "haButton", "haLight", "haSet", "haUpdate", "haGet", "haChanged",
    "haEvent", "haPoll", "haEventIs", "haEventValue", "haEventType", "haPress",
#endif
    // Legacy scalar bindings kept for existing compiled and saved sketches.
    "timeLocalHour", "timeLocalMinute", "timeLocalSeconds",
    "timeLocalDay", "timeLocalMonth", "timeLocalYear",
    "ledGetR", "ledGetG", "ledGetB",
    "hsvToR", "hsvToG", "hsvToB",
    "rgbToH", "rgbToS", "rgbToV",
    "paletteGetR", "paletteGetG", "paletteGetB",
  };
  for (size_t i = 0; i < sizeof(names) / sizeof(names[0]); i++) {
    if ((uint32_t)wr_hashStr(names[i]) == hash) return names[i];
  }
  return "";
}

void wrenchRegisterBindings(WRState* wr) {
  wr_loadMathLib(wr);

  wr_registerFunction(wr, "print", w_p1_print);
  wr_registerFunction(wr, "println", w_p1_println);
  wr_registerFunction(wr, "pinMode", w_p1_pinMode);
  wr_registerFunction(wr, "digitalWrite", w_p1_digitalWrite);
  wr_registerFunction(wr, "digitalRead", w_p1_digitalRead);
  wr_registerFunction(wr, "analogRead", w_p1_analogRead);
  wr_registerFunction(wr, "touchRead", w_p1_touchRead);
  wr_registerFunction(wr, "touchReadPair", w_p1_touchReadPair);
  wr_registerFunction(wr, "delay", w_p1_delay);
  wr_registerFunction(wr, "delayMicroseconds", w_p1_delayMicroseconds);
  wr_registerFunction(wr, "millis", w_p1_millis);
  wr_registerFunction(wr, "micros", w_p1_micros);
  wr_registerFunction(wr, "random", w_p1_random);
  wr_registerFunction(wr, "randomSeed", w_p1_randomSeed);
  wr_registerFunction(wr, "freeHeap", w_p1_freeHeap);
  wr_registerFunction(wr, "diagArray3", w_p1_diagArray3);
  wr_registerFunction(wr, "diagFloatArray3", w_p1_diagFloatArray3);
  wr_registerFunction(wr, "lerp", w_p1_lerp);
  wr_registerFunction(wr, "map", w_p1_map);
  wr_registerFunction(wr, "constrain", w_p1_constrain);
  wr_registerFunction(wr, "min", w_p1_min);
  wr_registerFunction(wr, "max", w_p1_max);
  wr_registerFunction(wr, "abs", w_p1_abs);
  wr_registerFunction(wr, "sin", w_p1_sin);
  wr_registerFunction(wr, "cos", w_p1_cos);
  wr_registerFunction(wr, "tan", w_p1_tan);
  wr_registerFunction(wr, "asin", w_p1_asin);
  wr_registerFunction(wr, "acos", w_p1_acos);
  wr_registerFunction(wr, "atan", w_p1_atan);
  wr_registerFunction(wr, "atan2", w_p1_atan2);
  wr_registerFunction(wr, "sqrt", w_p1_sqrt);
  wr_registerFunction(wr, "pow", w_p1_pow);
  wr_registerFunction(wr, "floor", w_p1_floor);
  wr_registerFunction(wr, "ceil", w_p1_ceil);
  wr_registerFunction(wr, "round", w_p1_round);
  wr_registerFunction(wr, "exp", w_p1_exp);
  wr_registerFunction(wr, "ln", w_p1_ln);
  wr_registerFunction(wr, "log10", w_p1_log10);
  wr_registerFunction(wr, "fmod", w_p1_fmod);
  wr_registerFunction(wr, "radians", w_p1_radians);
  wr_registerFunction(wr, "degrees", w_p1_degrees);
  wr_registerFunction(wr, "noiseSeed", w_p1_noiseSeed);
  wr_registerFunction(wr, "simplex3", w_p1_simplex3);
  wr_registerFunction(wr, "simplex3_01", w_p1_simplex3_01);
  wr_registerFunction(wr, "timeNow", w_p1_timeNow);
  wr_registerFunction(wr, "timeLocal", w_p1_timeLocal);
  wr_registerFunction(wr, "timeGet", w_p1_timeGet);
  wr_registerFunction(wr, "sunLocal", w_p1_sunLocal);
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
  wr_registerFunction(wr, "ledGetRgb", w_p1_ledGetRgb);
  wr_registerFunction(wr, "ledGetRgbInto", w_p1_ledGetRgbInto);
  wr_registerFunction(wr, "ledSetRgb", w_p1_ledSetRgb);
  wr_registerFunction(wr, "hsvToRgb", w_p1_hsvToRgb);
  wr_registerFunction(wr, "hsvToRgbInto", w_p1_hsvToRgbInto);
  wr_registerFunction(wr, "rgbToHsv", w_p1_rgbToHsv);
  wr_registerFunction(wr, "rgbToHsvInto", w_p1_rgbToHsvInto);
  wr_registerFunction(wr, "paletteSet2", w_p1_paletteSet2);
  wr_registerFunction(wr, "paletteSet3", w_p1_paletteSet3);
  wr_registerFunction(wr, "paletteSet4", w_p1_paletteSet4);
  wr_registerFunction(wr, "paletteGetRgb", w_p1_paletteGetRgb);
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
  wr_registerFunction(wr, "uiEventIs", w_p1_uiEventIs);
  wr_registerFunction(wr, "uiEventValue", w_p1_uiEventValue);
  wr_registerFunction(wr, "uiGet", w_p1_uiGet);
  wr_registerFunction(wr, "uiChanged", w_p1_uiChanged);
#if P1_EMBED_HA_ENABLED
  wr_registerFunction(wr, "haBegin", w_p1_haBegin);
  wr_registerFunction(wr, "haSensor", w_p1_haSensor);
  wr_registerFunction(wr, "haBinarySensor", w_p1_haBinarySensor);
  wr_registerFunction(wr, "haSwitch", w_p1_haSwitch);
  wr_registerFunction(wr, "haNumber", w_p1_haNumber);
  wr_registerFunction(wr, "haButton", w_p1_haButton);
  wr_registerFunction(wr, "haLight", w_p1_haLight);
  wr_registerFunction(wr, "haSet", w_p1_haSet);
  wr_registerFunction(wr, "haUpdate", w_p1_haUpdate);
  wr_registerFunction(wr, "haGet", w_p1_haGet);
  wr_registerFunction(wr, "haChanged", w_p1_haChanged);
  wr_registerFunction(wr, "haEvent", w_p1_haEvent);
  wr_registerFunction(wr, "haPoll", w_p1_haPoll);
  wr_registerFunction(wr, "haEventIs", w_p1_haEventIs);
  wr_registerFunction(wr, "haEventValue", w_p1_haEventValue);
  wr_registerFunction(wr, "haEventType", w_p1_haEventType);
  wr_registerFunction(wr, "haPress", w_p1_haPress);
#endif

  // Legacy scalar bindings kept for existing sketches; new code should use
  // timeLocal(out), ledGetRgb(..., out), rgbToHsv(..., out), hsvToRgb(..., out),
  // and paletteGetRgb(..., out).
  wr_registerFunction(wr, "timeLocalHour", w_p1_timeLocalHour);
  wr_registerFunction(wr, "timeLocalMinute", w_p1_timeLocalMinute);
  wr_registerFunction(wr, "timeLocalSeconds", w_p1_timeLocalSeconds);
  wr_registerFunction(wr, "timeLocalDay", w_p1_timeLocalDay);
  wr_registerFunction(wr, "timeLocalMonth", w_p1_timeLocalMonth);
  wr_registerFunction(wr, "timeLocalYear", w_p1_timeLocalYear);
  wr_registerFunction(wr, "ledGetR", w_p1_ledGetR);
  wr_registerFunction(wr, "ledGetG", w_p1_ledGetG);
  wr_registerFunction(wr, "ledGetB", w_p1_ledGetB);
  wr_registerFunction(wr, "hsvToR", w_p1_hsvToR);
  wr_registerFunction(wr, "hsvToG", w_p1_hsvToG);
  wr_registerFunction(wr, "hsvToB", w_p1_hsvToB);
  wr_registerFunction(wr, "rgbToH", w_p1_rgbToH);
  wr_registerFunction(wr, "rgbToS", w_p1_rgbToS);
  wr_registerFunction(wr, "rgbToV", w_p1_rgbToV);
  wr_registerFunction(wr, "paletteGetR", w_p1_paletteGetR);
  wr_registerFunction(wr, "paletteGetG", w_p1_paletteGetG);
  wr_registerFunction(wr, "paletteGetB", w_p1_paletteGetB);

  wr_registerLibraryConstant(wr, "INPUT", (int32_t)INPUT);
  wr_registerLibraryConstant(wr, "OUTPUT", (int32_t)OUTPUT);
  wr_registerLibraryConstant(wr, "INPUT_PULLUP", (int32_t)INPUT_PULLUP);
#ifdef INPUT_PULLDOWN
  wr_registerLibraryConstant(wr, "INPUT_PULLDOWN", (int32_t)INPUT_PULLDOWN);
#endif
  wr_registerLibraryConstant(wr, "HIGH", (int32_t)HIGH);
  wr_registerLibraryConstant(wr, "LOW", (int32_t)LOW);
  wr_registerLibraryConstant(wr, "LED_BUILTIN", (int32_t)P1_EMBED_DEFAULT_LED_PIN);
  wr_registerLibraryConstant(wr, "PI", 3.14159265358979323846f);
  wr_registerLibraryConstant(wr, "TWO_PI", 6.28318530717958647692f);
  wr_registerLibraryConstant(wr, "HALF_PI", 1.57079632679489661923f);
}
