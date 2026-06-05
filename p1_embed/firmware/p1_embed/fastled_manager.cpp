#include <Arduino.h>
#define FASTLED_INTERNAL
#ifndef FASTLED_RMT5_PRESET_LEGACY
#define FASTLED_RMT5_PRESET_LEGACY
#endif
#ifndef FASTLED_RMT_NETWORK_REDUCE_CHANNELS
#define FASTLED_RMT_NETWORK_REDUCE_CHANNELS 0
#endif
#ifndef FASTLED_RMT_MEM_BLOCKS
#define FASTLED_RMT_MEM_BLOCKS 4
#endif
#ifndef FASTLED_RMT_MEM_BLOCKS_NETWORK_MODE
#define FASTLED_RMT_MEM_BLOCKS_NETWORK_MODE 4
#endif
#include <FastLED.h>
#include "p1_embed_firmware.h"

#define P1_EMBED_FASTLED_AVAILABLE 1

struct LedStripState {
  bool ready;
  bool configured;
  uint32_t scriptGeneration;
  int pin;
  int count;
  int capacity;
  int brightness;
  int chipset;
  int order;
  CRGB* pixels;
  CLEDController* controller;
};

enum {
  P1_LED_CHIPSET_WS2812B = 0,
  P1_LED_CHIPSET_WS2812 = 1,
  P1_LED_CHIPSET_WS2811 = 2,
  P1_LED_CHIPSET_SK6812 = 3,
};

enum {
  P1_LED_ORDER_GRB = 0,
  P1_LED_ORDER_RGB = 1,
  P1_LED_ORDER_RBG = 2,
  P1_LED_ORDER_GBR = 3,
  P1_LED_ORDER_BRG = 4,
  P1_LED_ORDER_BGR = 5,
};

static LedStripState g_ledStrips[P1_EMBED_MAX_LED_STRIPS];
static int g_activeStripCount = 0;
static int g_totalLedCount = 0;
static uint8_t g_ledSetDebugMarkers = 0;
static uint8_t g_ledShowDebugMarkers = 0;
static uint32_t g_managerBeginCount = 0;
static uint32_t g_controllerAddCount = 0;
static uint32_t g_resourceReleaseCount = 0;
static uint32_t g_ledScriptGeneration = 1;
static volatile bool g_fastLedShowActive = false;
static volatile uint32_t g_fastLedSkipUntilMs = 0;

bool fastLedShowActive() {
  return g_fastLedShowActive;
}

void fastLedSkipFor(uint32_t ms) {
  g_fastLedSkipUntilMs = millis() + ms;
}

static bool fastLedSkipActive() {
  uint32_t until = g_fastLedSkipUntilMs;
  return until != 0 && static_cast<int32_t>(until - millis()) > 0;
}

static void fastLedShowGuarded() {
  if (fastLedSkipActive()) return;
  g_fastLedShowActive = true;
  FastLED.show();
  g_fastLedShowActive = false;
}

static void ledResetRuntimeState() {
  for (int i = 0; i < P1_EMBED_MAX_LED_STRIPS; i++) {
    g_ledStrips[i].ready = false;
    g_ledStrips[i].configured = false;
    g_ledStrips[i].scriptGeneration = 0;
    g_ledStrips[i].pin = -1;
    g_ledStrips[i].count = 0;
    g_ledStrips[i].capacity = 0;
    g_ledStrips[i].brightness = 255;
    g_ledStrips[i].chipset = P1_LED_CHIPSET_WS2812B;
    g_ledStrips[i].order = P1_LED_ORDER_GRB;
    g_ledStrips[i].pixels = nullptr;
    g_ledStrips[i].controller = nullptr;
  }
  g_activeStripCount = 0;
  g_totalLedCount = 0;
  g_ledSetDebugMarkers = 0;
  g_ledShowDebugMarkers = 0;
}

static bool ledValidPin(int pin) {
  if (pin < 0 || pin > 39) return false;
  if (pin >= 6 && pin <= 11) return false;
  if (pin >= 34 && pin <= 39) return false;
  return true;
}

static String ledNormalizeToken(const char* value) {
  String out;
  if (!value) return out;
  for (const char* p = value; *p; ++p) {
    char c = *p;
    if (c == '-' || c == '_' || c == ' ') continue;
    out += (char)toupper((unsigned char)c);
  }
  return out;
}

static const char* ledChipsetName(int chipset) {
  switch (chipset) {
    case P1_LED_CHIPSET_WS2812: return "WS2812";
    case P1_LED_CHIPSET_WS2811: return "WS2811";
    case P1_LED_CHIPSET_SK6812: return "SK6812";
    case P1_LED_CHIPSET_WS2812B:
    default: return "WS2812B";
  }
}

static const char* ledOrderName(int order) {
  switch (order) {
    case P1_LED_ORDER_RGB: return "RGB";
    case P1_LED_ORDER_RBG: return "RBG";
    case P1_LED_ORDER_GBR: return "GBR";
    case P1_LED_ORDER_BRG: return "BRG";
    case P1_LED_ORDER_BGR: return "BGR";
    case P1_LED_ORDER_GRB:
    default: return "GRB";
  }
}

static bool ledParseChipset(const char* value, int& chipsetOut) {
  String token = ledNormalizeToken(value);
  if (!token.length()) {
    chipsetOut = P1_LED_CHIPSET_WS2812B;
    return true;
  }
  if (token == "WS2812B" || token == "NEOPIXEL") {
    chipsetOut = P1_LED_CHIPSET_WS2812B;
    return true;
  }
#if 0
  // Extended chipset support is intentionally disabled in the default firmware
  // because FastLED templates allocate static controller state for every
  // chipset/pin combination. Keep this here as the map for a future extended
  // LED build, but do not carry the RAM cost in the normal NeoPixel path.
  if (token == "WS2812") {
    chipsetOut = P1_LED_CHIPSET_WS2812;
    return true;
  }
  if (token == "WS2811") {
    chipsetOut = P1_LED_CHIPSET_WS2811;
    return true;
  }
  if (token == "SK6812") {
    chipsetOut = P1_LED_CHIPSET_SK6812;
    return true;
  }
#endif
  return false;
}

static bool ledParseOrder(const char* value, int& orderOut) {
  String token = ledNormalizeToken(value);
  if (!token.length() || token == "GRB") {
    orderOut = P1_LED_ORDER_GRB;
    return true;
  }
  if (token == "RGB") orderOut = P1_LED_ORDER_RGB;
  else if (token == "RBG") orderOut = P1_LED_ORDER_RBG;
  else if (token == "GBR") orderOut = P1_LED_ORDER_GBR;
  else if (token == "BRG") orderOut = P1_LED_ORDER_BRG;
  else if (token == "BGR") orderOut = P1_LED_ORDER_BGR;
  else return false;
  return true;
}

static void ledOrderBytes(int order, uint8_t r, uint8_t g, uint8_t b, uint8_t out[3]) {
  switch (order) {
    case P1_LED_ORDER_RGB: out[0] = r; out[1] = g; out[2] = b; break;
    case P1_LED_ORDER_RBG: out[0] = r; out[1] = b; out[2] = g; break;
    case P1_LED_ORDER_GBR: out[0] = g; out[1] = b; out[2] = r; break;
    case P1_LED_ORDER_BRG: out[0] = b; out[1] = r; out[2] = g; break;
    case P1_LED_ORDER_BGR: out[0] = b; out[1] = g; out[2] = r; break;
    case P1_LED_ORDER_GRB:
    default: out[0] = g; out[1] = r; out[2] = b; break;
  }
}

static CRGB ledPackColor(int order, int r, int g, int b) {
  uint8_t bytes[3];
  ledOrderBytes(order, constrain(r, 0, 255), constrain(g, 0, 255), constrain(b, 0, 255), bytes);
  return CRGB(bytes[1], bytes[0], bytes[2]);
}

static void ledUnpackColor(const CRGB& pixel, int order, int& r, int& g, int& b) {
  uint8_t bytes[3] = { pixel.g, pixel.r, pixel.b };
  r = 0;
  g = 0;
  b = 0;
  switch (order) {
    case P1_LED_ORDER_RGB: r = bytes[0]; g = bytes[1]; b = bytes[2]; break;
    case P1_LED_ORDER_RBG: r = bytes[0]; b = bytes[1]; g = bytes[2]; break;
    case P1_LED_ORDER_GBR: g = bytes[0]; b = bytes[1]; r = bytes[2]; break;
    case P1_LED_ORDER_BRG: b = bytes[0]; r = bytes[1]; g = bytes[2]; break;
    case P1_LED_ORDER_BGR: b = bytes[0]; g = bytes[1]; r = bytes[2]; break;
    case P1_LED_ORDER_GRB:
    default: g = bytes[0]; r = bytes[1]; b = bytes[2]; break;
  }
}

#if P1_EMBED_FASTLED_AVAILABLE
#define P1_ADD_FASTLED_CASE(CHIPSET, PIN) case PIN: controllerOut = &FastLED.addLeds<CHIPSET, PIN, GRB, fl::Bus::RMT>(pixels, count); break
#define P1_FASTLED_PIN_SWITCH(CHIPSET) \
  switch (pin) { \
    P1_ADD_FASTLED_CASE(CHIPSET, 0); \
    P1_ADD_FASTLED_CASE(CHIPSET, 1); \
    P1_ADD_FASTLED_CASE(CHIPSET, 2); \
    P1_ADD_FASTLED_CASE(CHIPSET, 3); \
    P1_ADD_FASTLED_CASE(CHIPSET, 4); \
    P1_ADD_FASTLED_CASE(CHIPSET, 5); \
    P1_ADD_FASTLED_CASE(CHIPSET, 12); \
    P1_ADD_FASTLED_CASE(CHIPSET, 13); \
    P1_ADD_FASTLED_CASE(CHIPSET, 14); \
    P1_ADD_FASTLED_CASE(CHIPSET, 15); \
    P1_ADD_FASTLED_CASE(CHIPSET, 16); \
    P1_ADD_FASTLED_CASE(CHIPSET, 17); \
    P1_ADD_FASTLED_CASE(CHIPSET, 18); \
    P1_ADD_FASTLED_CASE(CHIPSET, 19); \
    P1_ADD_FASTLED_CASE(CHIPSET, 21); \
    P1_ADD_FASTLED_CASE(CHIPSET, 22); \
    P1_ADD_FASTLED_CASE(CHIPSET, 23); \
    P1_ADD_FASTLED_CASE(CHIPSET, 25); \
    P1_ADD_FASTLED_CASE(CHIPSET, 26); \
    P1_ADD_FASTLED_CASE(CHIPSET, 27); \
    P1_ADD_FASTLED_CASE(CHIPSET, 32); \
    P1_ADD_FASTLED_CASE(CHIPSET, 33); \
    default: matchedPin = false; break; \
  }

static bool ledAddController(int pin, CRGB* pixels, int count, int chipset, CLEDController*& controllerOut) {
  controllerOut = nullptr;
  g_controllerAddCount++;
  bool matchedPin = true;
  P1EventField beginFields[] = {
    p1FieldUInt("call", g_controllerAddCount),
    p1FieldInt("pin", pin),
    p1FieldInt("count", count),
    p1FieldString("chipset", ledChipsetName(chipset)),
  };
  debugEventEmitFields("led.debug", "debug", "led", "FastLED.addLeds begin", beginFields, 4);
  P1_FASTLED_PIN_SWITCH(WS2812B);
#if 0
  // Extended chipset matrix kept for reference. Enabling this in the default
  // firmware costs roughly 18 KB of permanent .bss on classic ESP32 because
  // FastLED creates static controller storage per template specialization.
  switch (chipset) {
    case P1_LED_CHIPSET_WS2812:
      P1_FASTLED_PIN_SWITCH(WS2812);
      break;
    case P1_LED_CHIPSET_WS2811:
      P1_FASTLED_PIN_SWITCH(WS2811);
      break;
    case P1_LED_CHIPSET_SK6812:
      P1_FASTLED_PIN_SWITCH(SK6812);
      break;
    case P1_LED_CHIPSET_WS2812B:
    default:
      P1_FASTLED_PIN_SWITCH(WS2812B);
      break;
  }
#endif
  if (controllerOut) {
    if (!controllerOut->isInList()) {
      controllerOut->addToList();
      P1EventField fields[] = {
        p1FieldUInt("call", g_controllerAddCount),
      };
      debugEventEmitFields("led.debug", "debug", "led", "FastLED controller re-added", fields, 1);
    }
    controllerOut->setEnabled(true);
  }
  P1EventField endFields[] = {
    p1FieldUInt("call", g_controllerAddCount),
    p1FieldBool("matchedPin", matchedPin),
    p1FieldBool("controller", controllerOut != nullptr),
    p1FieldBool("inList", controllerOut && controllerOut->isInList()),
    p1FieldBool("enabled", controllerOut && controllerOut->getEnabled()),
  };
  debugEventEmitFields("led.debug", "debug", "led", "FastLED.addLeds end", endFields, 5);
  return matchedPin && controllerOut != nullptr;
}
#endif

static bool ledStartStrip(int strip, int pin, int count, int brightness, int chipset, int order) {
  P1EventField startFields[] = {
    p1FieldInt("strip", strip),
    p1FieldInt("pin", pin),
    p1FieldInt("count", count),
    p1FieldInt("brightness", brightness),
    p1FieldString("chipset", ledChipsetName(chipset)),
    p1FieldString("order", ledOrderName(order)),
  };
  debugEventEmitFields("led.debug", "debug", "led", "ledStartStrip begin", startFields, 6);
  if (strip < 0 || strip >= P1_EMBED_MAX_LED_STRIPS) {
    scriptErrorSet("binding", "led_bad_strip", "LED strip index is out of range", "\"strip\":" + String(strip));
    return false;
  }
  if (!ledValidPin(pin)) {
    scriptErrorSet("binding", "led_bad_pin", "LED strip pin is invalid or input-only", "\"strip\":" + String(strip) + ",\"pin\":" + String(pin));
    return false;
  }

  count = constrain(count, 1, P1_EMBED_FASTLED_MAX_LEDS);
  brightness = constrain(brightness, 0, 255);
  LedStripState& s = g_ledStrips[strip];

  if (s.ready) {
    P1EventField existingFields[] = {
      p1FieldInt("strip", strip),
      p1FieldInt("pin", s.pin),
      p1FieldInt("count", s.count),
      p1FieldInt("capacity", s.capacity),
      p1FieldInt("brightness", s.brightness),
      p1FieldString("chipset", ledChipsetName(s.chipset)),
      p1FieldString("order", ledOrderName(s.order)),
    };
    debugEventEmitFields("led.debug", "debug", "led", "ledStartStrip existing", existingFields, 7);
    if (pin != s.pin || chipset != s.chipset) {
      scriptErrorSet(
        "binding",
        "led_reboot_required",
        "LED strip geometry is already active; save the requested config and reboot to change pin or chipset",
        "\"strip\":" + String(strip) + ",\"pin\":" + String(pin) + ",\"activePin\":" + String(s.pin) + ",\"chipset\":\"" + ledChipsetName(chipset) + "\",\"activeChipset\":\"" + ledChipsetName(s.chipset) + "\",\"count\":" + String(count) + ",\"activeCount\":" + String(s.count) + ",\"capacity\":" + String(s.capacity)
      );
      return false;
    }
    if (count > s.capacity) {
      int nextTotal = g_totalLedCount - s.capacity + count;
      if (nextTotal > P1_EMBED_FASTLED_MAX_LEDS) {
        scriptErrorSet("binding", "led_too_many_pixels", "LED strips exceed firmware pixel limit", "\"requestedTotal\":" + String(nextTotal) + ",\"maxLeds\":" + String(P1_EMBED_FASTLED_MAX_LEDS));
        return false;
      }
      CRGB* nextPixels = new CRGB[count];
      if (!nextPixels) {
        scriptErrorSet("binding", "led_alloc_failed", "Failed to grow LED pixel buffer", "\"strip\":" + String(strip) + ",\"count\":" + String(count));
        return false;
      }
      int copied = min(s.count, count);
      if (s.pixels && copied > 0) ::memmove(static_cast<void*>(nextPixels), static_cast<const void*>(s.pixels), copied * sizeof(CRGB));
      if (count > copied) fill_solid(nextPixels + copied, count - copied, CRGB::Black);
      CLEDController* nextController = nullptr;
      CLEDController* oldController = s.controller;
      if (oldController) oldController->setEnabled(false);
      if (!ledAddController(pin, nextPixels, count, chipset, nextController)) {
        if (oldController) oldController->setEnabled(true);
        delete[] nextPixels;
        scriptErrorSet("binding", "led_pin_not_enabled", "LED pin is not enabled in this firmware", "\"strip\":" + String(strip) + ",\"pin\":" + String(pin));
        return false;
      }
      CRGB* oldPixels = s.pixels;
      s.pixels = nextPixels;
      s.controller = nextController;
      s.capacity = count;
      g_totalLedCount = nextTotal;
      delete[] oldPixels;
    }
    bool resized = count != s.count;
    bool orderChanged = order != s.order;
    if (resized && s.pixels && count < s.capacity) {
      fill_solid(s.pixels + count, s.capacity - count, CRGB::Black);
    }
    if (orderChanged && s.pixels) {
      fill_solid(s.pixels, s.capacity, CRGB::Black);
    }
    s.count = count;
    s.brightness = brightness;
    s.order = order;
    s.scriptGeneration = g_ledScriptGeneration;
    FastLED.setBrightness((uint8_t)brightness);
    if (resized || orderChanged) fastLedShowGuarded();
    P1EventField reusedFields[] = {
      p1FieldInt("strip", strip),
      p1FieldInt("pin", pin),
      p1FieldInt("count", count),
      p1FieldInt("capacity", s.capacity),
      p1FieldInt("brightness", brightness),
      p1FieldString("chipset", ledChipsetName(s.chipset)),
      p1FieldString("order", ledOrderName(s.order)),
    };
    debugEventEmitFields("led.status", "debug", "led", resized ? "strip resized" : (orderChanged ? "strip order changed" : "strip reused"), reusedFields, 7);
    return true;
  }

  if (g_totalLedCount + count > P1_EMBED_FASTLED_MAX_LEDS) {
    scriptErrorSet("binding", "led_too_many_pixels", "LED strips exceed firmware pixel limit", "\"requestedTotal\":" + String(g_totalLedCount + count) + ",\"maxLeds\":" + String(P1_EMBED_FASTLED_MAX_LEDS));
    return false;
  }

  s.pixels = new CRGB[count];
  if (!s.pixels) {
    scriptErrorSet("binding", "led_alloc_failed", "Failed to allocate LED pixel buffer", "\"strip\":" + String(strip) + ",\"count\":" + String(count));
    return false;
  }

  if (!ledAddController(pin, s.pixels, count, chipset, s.controller)) {
    delete[] s.pixels;
    s.pixels = nullptr;
    s.controller = nullptr;
    scriptErrorSet("binding", "led_pin_not_enabled", "LED pin is not enabled in this firmware", "\"strip\":" + String(strip) + ",\"pin\":" + String(pin));
    return false;
  }

  s.ready = true;
  s.configured = true;
  s.scriptGeneration = g_ledScriptGeneration;
  s.pin = pin;
  s.count = count;
  s.capacity = count;
  s.brightness = brightness;
  s.chipset = chipset;
  s.order = order;
  fill_solid(s.pixels, s.capacity, CRGB::Black);
  g_activeStripCount = max(g_activeStripCount, strip + 1);
  g_totalLedCount += count;
  g_ledSetDebugMarkers = 0;
  g_ledShowDebugMarkers = 0;
  FastLED.setBrightness((uint8_t)brightness);
  fastLedShowGuarded();
  P1EventField startedFields[] = {
    p1FieldInt("strip", strip),
    p1FieldInt("pin", pin),
    p1FieldInt("count", count),
    p1FieldString("chipset", ledChipsetName(chipset)),
    p1FieldString("order", ledOrderName(order)),
  };
  debugEventEmitFields("led.status", "debug", "led", "strip started", startedFields, 5);
  return true;
}

void fastLedManagerBegin() {
  g_managerBeginCount++;
  P1EventField fields[] = {
    p1FieldUInt("call", g_managerBeginCount),
  };
  debugEventEmitFields("led.debug", "debug", "led", "fastLedManagerBegin", fields, 1);
  ledResetRuntimeState();
}

void fastLedReleaseScriptResources() {
  g_resourceReleaseCount++;
  bool hadAny = g_activeStripCount > 0;
  P1EventField fields[] = {
    p1FieldUInt("call", g_resourceReleaseCount),
    p1FieldBool("hadAny", hadAny),
    p1FieldInt("stripCount", g_activeStripCount),
    p1FieldInt("totalLeds", g_totalLedCount),
  };
  debugEventEmitFields("led.debug", "debug", "led", "FastLED release begin", fields, 4);
  if (hadAny) {
    debugEventEmitFields("led.status", "debug", "led", "kept FastLED resources for reuse", fields, 4);
  }
}

void ledBeginScriptRun() {
  g_ledScriptGeneration++;
  if (g_ledScriptGeneration == 0) g_ledScriptGeneration = 1;
  g_ledSetDebugMarkers = 0;
  g_ledShowDebugMarkers = 0;
}

bool ledConfigureStrip(int strip, int pin, int count, int brightness) {
  return ledConfigureStrip(strip, pin, count, brightness, nullptr, nullptr);
}

bool ledConfigureStrip(int strip, int pin, int count, int brightness, const char* chipsetName, const char* orderName) {
  if (strip < 0 || strip >= P1_EMBED_MAX_LED_STRIPS) {
    scriptErrorSet("binding", "led_bad_strip", "LED strip index is out of range", "\"strip\":" + String(strip));
    return false;
  }
  int chipset = P1_LED_CHIPSET_WS2812B;
  int order = P1_LED_ORDER_GRB;
  if (!ledParseChipset(chipsetName, chipset)) {
    scriptErrorSet("binding", "led_bad_chipset", "LED chipset is not supported", "\"chipset\":\"" + String(chipsetName ? chipsetName : "") + "\"");
    return false;
  }
  if (!ledParseOrder(orderName, order)) {
    scriptErrorSet("binding", "led_bad_order", "LED color order is not supported", "\"order\":\"" + String(orderName ? orderName : "") + "\"");
    return false;
  }
  count = constrain(count, 1, P1_EMBED_FASTLED_MAX_LEDS);
  brightness = constrain(brightness, 0, 255);
  return ledStartStrip(strip, pin, count, brightness, chipset, order);
}

bool ledRebootRequiredFor(int strip, int pin, int count) {
  if (strip < 0 || strip >= P1_EMBED_MAX_LED_STRIPS) return false;
  LedStripState& s = g_ledStrips[strip];
  return s.ready && pin != s.pin;
}

bool ledReady(int strip) {
  if (strip < 0 || strip >= P1_EMBED_MAX_LED_STRIPS) return false;
  return g_ledStrips[strip].ready && g_ledStrips[strip].scriptGeneration == g_ledScriptGeneration;
}

int ledStripCount() {
  int count = 0;
  for (int i = 0; i < g_activeStripCount; i++) {
    if (g_ledStrips[i].ready && g_ledStrips[i].scriptGeneration == g_ledScriptGeneration) count = i + 1;
  }
  return count;
}

int ledPin(int strip) {
  if (strip < 0 || strip >= P1_EMBED_MAX_LED_STRIPS) return -1;
  return g_ledStrips[strip].pin;
}

int ledCount(int strip) {
  if (strip < 0 || strip >= P1_EMBED_MAX_LED_STRIPS) return 0;
  if (!ledReady(strip)) return 0;
  return g_ledStrips[strip].count;
}

bool ledSetPixel(int strip, int index, int r, int g, int b) {
  if (!ledReady(strip)) return false;
  LedStripState& s = g_ledStrips[strip];
  if (!s.pixels || index < 0 || index >= s.count) return false;
  s.pixels[index] = ledPackColor(s.order, r, g, b);
  if (g_ledSetDebugMarkers < 8) {
    P1EventField fields[] = {
      p1FieldUInt("marker", g_ledSetDebugMarkers + 1),
      p1FieldInt("strip", strip),
      p1FieldInt("index", index),
      p1FieldInt("r", constrain(r, 0, 255)),
      p1FieldInt("g", constrain(g, 0, 255)),
      p1FieldInt("b", constrain(b, 0, 255)),
    };
    debugEventEmitFields("led.debug", "trace", "led", "ledSetPixel", fields, 6);
    g_ledSetDebugMarkers++;
  }
  return true;
}

bool ledGetPixel(int strip, int index, int& r, int& g, int& b) {
  r = 0;
  g = 0;
  b = 0;
  if (!ledReady(strip)) return false;
  LedStripState& s = g_ledStrips[strip];
  if (!s.pixels || index < 0 || index >= s.count) return false;
  ledUnpackColor(s.pixels[index], s.order, r, g, b);
  return true;
}

bool ledFill(int strip, int r, int g, int b) {
  if (!ledReady(strip)) return false;
  LedStripState& s = g_ledStrips[strip];
  fill_solid(s.pixels, s.count, ledPackColor(s.order, r, g, b));
  if (s.capacity > s.count) {
    fill_solid(s.pixels + s.count, s.capacity - s.count, CRGB::Black);
  }
  return true;
}

bool ledClear(int strip, bool show) {
  if (strip < 0) {
    bool any = false;
    for (int i = 0; i < P1_EMBED_MAX_LED_STRIPS; i++) {
      if (!ledReady(i)) continue;
      fill_solid(g_ledStrips[i].pixels, g_ledStrips[i].capacity, CRGB::Black);
      any = true;
    }
    if (show && any) fastLedShowGuarded();
    return any;
  }
  if (!ledReady(strip)) return false;
  fill_solid(g_ledStrips[strip].pixels, g_ledStrips[strip].capacity, CRGB::Black);
  if (show) fastLedShowGuarded();
  return true;
}

bool ledClearAllPhysical(bool show) {
  bool any = false;
  for (int i = 0; i < P1_EMBED_MAX_LED_STRIPS; i++) {
    LedStripState& s = g_ledStrips[i];
    if (!s.ready || !s.pixels || s.capacity <= 0) continue;
    fill_solid(s.pixels, s.capacity, CRGB::Black);
    any = true;
  }
  if (show && any) fastLedShowGuarded();
  return any;
}

bool fastLedShow() {
  if (ledStripCount() <= 0) return false;
  if (g_ledShowDebugMarkers < 8) {
    P1EventField fields[] = {
      p1FieldUInt("marker", g_ledShowDebugMarkers + 1),
      p1FieldInt("stripCount", g_activeStripCount),
      p1FieldInt("totalLeds", g_totalLedCount),
    };
    debugEventEmitFields("led.debug", "trace", "led", "ledShow", fields, 3);
    g_ledShowDebugMarkers++;
  }
  fastLedShowGuarded();
  return true;
}

bool ledSetBrightness(int strip, int brightness) {
  if (!ledReady(strip)) return false;
  g_ledStrips[strip].brightness = constrain(brightness, 0, 255);
  FastLED.setBrightness((uint8_t)g_ledStrips[strip].brightness);
  return true;
}

String ledStatusJson() {
  P1LedStatusSnapshot snapshot = ledStatusSnapshot();
  String out = "{";
  out += "\"available\":" + String(snapshot.available ? "true" : "false");
  out += ",\"ready\":" + String(snapshot.ready ? "true" : "false");
  out += ",\"stripCount\":" + String(snapshot.stripCount);
  out += ",\"totalLeds\":" + String(snapshot.totalLeds);
  out += ",\"maxLeds\":" + String(snapshot.maxLeds);
  out += ",\"maxStrips\":" + String(snapshot.maxStrips);
  out += ",\"driver\":" + jsonString(snapshot.driver);
  out += ",\"chipset\":" + jsonString(snapshot.chipset);
  out += ",\"order\":" + jsonString(snapshot.order);
  out += ",\"strips\":[";
  for (int i = 0; i < snapshot.stripCount; i++) {
    const P1LedStripSnapshot& strip = snapshot.strips[i];
    if (i) out += ",";
    out += "{\"strip\":" + String(strip.strip);
    out += ",\"ready\":" + String(strip.ready ? "true" : "false");
    out += ",\"pin\":" + String(strip.pin);
    out += ",\"count\":" + String(strip.count);
    out += ",\"capacity\":" + String(strip.capacity);
    out += ",\"brightness\":" + String(strip.brightness);
    out += ",\"chipset\":" + jsonString(strip.chipset);
    out += ",\"order\":" + jsonString(strip.order);
    out += "}";
  }
  out += "]}";
  return out;
}

P1LedStatusSnapshot ledStatusSnapshot() {
  P1LedStatusSnapshot snapshot;
  snapshot.available = P1_EMBED_FASTLED_AVAILABLE;
  snapshot.ready = g_activeStripCount > 0;
  snapshot.stripCount = constrain(g_activeStripCount, 0, P1_EMBED_MAX_LED_STRIPS);
  snapshot.totalLeds = g_totalLedCount;
  snapshot.maxLeds = P1_EMBED_FASTLED_MAX_LEDS;
  snapshot.maxStrips = P1_EMBED_MAX_LED_STRIPS;
  snapshot.driver = "FastLED";
  snapshot.chipset = "WS2812B";
  snapshot.order = "configurable";
  for (int i = 0; i < snapshot.stripCount; i++) {
    snapshot.strips[i].strip = i;
    snapshot.strips[i].ready = g_ledStrips[i].ready;
    snapshot.strips[i].pin = g_ledStrips[i].pin;
    snapshot.strips[i].count = g_ledStrips[i].count;
    snapshot.strips[i].capacity = g_ledStrips[i].capacity;
    snapshot.strips[i].brightness = g_ledStrips[i].brightness;
    snapshot.strips[i].chipset = ledChipsetName(g_ledStrips[i].chipset);
    snapshot.strips[i].order = ledOrderName(g_ledStrips[i].order);
  }
  return snapshot;
}
