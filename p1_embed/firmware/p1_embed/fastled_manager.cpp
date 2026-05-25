#include <Arduino.h>
#define FASTLED_INTERNAL
#include <FastLED.h>
#include "p1_embed_firmware.h"

#define P1_EMBED_FASTLED_AVAILABLE 1

struct LedStripState {
  bool ready;
  bool configured;
  int pin;
  int count;
  int brightness;
  CRGB* pixels;
  CLEDController* controller;
};

static LedStripState g_ledStrips[P1_EMBED_MAX_LED_STRIPS];
static int g_activeStripCount = 0;
static int g_totalLedCount = 0;

static void ledResetRuntimeState() {
  for (int i = 0; i < P1_EMBED_MAX_LED_STRIPS; i++) {
    g_ledStrips[i].ready = false;
    g_ledStrips[i].configured = false;
    g_ledStrips[i].pin = -1;
    g_ledStrips[i].count = 0;
    g_ledStrips[i].brightness = 255;
    g_ledStrips[i].pixels = nullptr;
    g_ledStrips[i].controller = nullptr;
  }
  g_activeStripCount = 0;
  g_totalLedCount = 0;
}

static bool ledValidPin(int pin) {
  if (pin < 0 || pin > 39) return false;
  if (pin >= 6 && pin <= 11) return false;
  if (pin >= 34 && pin <= 39) return false;
  return true;
}

#if P1_EMBED_FASTLED_AVAILABLE
#define P1_ADD_FASTLED_CASE(PIN) case PIN: controllerOut = &FastLED.addLeds<WS2812B, PIN, GRB>(pixels, count); return controllerOut != nullptr

static bool ledAddController(int pin, CRGB* pixels, int count, CLEDController*& controllerOut) {
  controllerOut = nullptr;
  switch (pin) {
    P1_ADD_FASTLED_CASE(0);
    P1_ADD_FASTLED_CASE(1);
    P1_ADD_FASTLED_CASE(2);
    P1_ADD_FASTLED_CASE(3);
    P1_ADD_FASTLED_CASE(4);
    P1_ADD_FASTLED_CASE(5);
    P1_ADD_FASTLED_CASE(12);
    P1_ADD_FASTLED_CASE(13);
    P1_ADD_FASTLED_CASE(14);
    P1_ADD_FASTLED_CASE(15);
    P1_ADD_FASTLED_CASE(16);
    P1_ADD_FASTLED_CASE(17);
    P1_ADD_FASTLED_CASE(18);
    P1_ADD_FASTLED_CASE(19);
    P1_ADD_FASTLED_CASE(21);
    P1_ADD_FASTLED_CASE(22);
    P1_ADD_FASTLED_CASE(23);
    P1_ADD_FASTLED_CASE(25);
    P1_ADD_FASTLED_CASE(26);
    P1_ADD_FASTLED_CASE(27);
    P1_ADD_FASTLED_CASE(32);
    P1_ADD_FASTLED_CASE(33);
    default:
      return false;
  }
}
#endif

static bool ledStartStrip(int strip, int pin, int count, int brightness) {
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
    if (pin != s.pin || count != s.count) {
      scriptErrorSet(
        "binding",
        "led_reboot_required",
        "LED strip geometry is already active; save the requested config and reboot to change pin or count",
        "\"strip\":" + String(strip) + ",\"pin\":" + String(pin) + ",\"activePin\":" + String(s.pin) + ",\"count\":" + String(count) + ",\"activeCount\":" + String(s.count)
      );
      return false;
    }
    s.brightness = brightness;
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

  if (!ledAddController(pin, s.pixels, count, s.controller)) {
    delete[] s.pixels;
    s.pixels = nullptr;
    s.controller = nullptr;
    scriptErrorSet("binding", "led_pin_not_enabled", "LED pin is not enabled in this firmware", "\"strip\":" + String(strip) + ",\"pin\":" + String(pin));
    return false;
  }

  s.ready = true;
  s.configured = true;
  s.pin = pin;
  s.count = count;
  s.brightness = brightness;
  fill_solid(s.pixels, s.count, CRGB::Black);
  g_activeStripCount = max(g_activeStripCount, strip + 1);
  g_totalLedCount += count;
  FastLED.setBrightness((uint8_t)brightness);
  FastLED.show();
  debugEventEmit("led.status", "info", "led", "strip started", "\"strip\":" + String(strip) + ",\"pin\":" + String(pin) + ",\"count\":" + String(count));
  return true;
}

void fastLedManagerBegin() {
  ledResetRuntimeState();
}

void fastLedReleaseScriptResources() {
  bool hadAny = g_activeStripCount > 0;
  if (hadAny) {
    ledClear(-1, true);
  }
  for (int i = 0; i < P1_EMBED_MAX_LED_STRIPS; i++) {
    LedStripState& s = g_ledStrips[i];
    if (s.controller) {
      s.controller->removeFromDrawList();
      s.controller->setEnabled(false);
      s.controller->setLeds(nullptr, 0);
      s.controller = nullptr;
    }
    if (s.pixels) {
      delete[] s.pixels;
      s.pixels = nullptr;
    }
  }
  ledResetRuntimeState();
  if (hadAny) {
    debugEventEmit("led.status", "debug", "led", "released script LED resources");
  }
}

bool ledConfigureStrip(int strip, int pin, int count, int brightness) {
  if (strip < 0 || strip >= P1_EMBED_MAX_LED_STRIPS) {
    scriptErrorSet("binding", "led_bad_strip", "LED strip index is out of range", "\"strip\":" + String(strip));
    return false;
  }
  count = constrain(count, 1, P1_EMBED_FASTLED_MAX_LEDS);
  brightness = constrain(brightness, 0, 255);
  return ledStartStrip(strip, pin, count, brightness);
}

bool ledRebootRequiredFor(int strip, int pin, int count) {
  if (strip < 0 || strip >= P1_EMBED_MAX_LED_STRIPS) return false;
  LedStripState& s = g_ledStrips[strip];
  return s.ready && (pin != s.pin || count != s.count);
}

bool ledReady(int strip) {
  if (strip < 0 || strip >= P1_EMBED_MAX_LED_STRIPS) return false;
  return g_ledStrips[strip].ready;
}

int ledStripCount() {
  return g_activeStripCount;
}

int ledPin(int strip) {
  if (strip < 0 || strip >= P1_EMBED_MAX_LED_STRIPS) return -1;
  return g_ledStrips[strip].pin;
}

int ledCount(int strip) {
  if (strip < 0 || strip >= P1_EMBED_MAX_LED_STRIPS) return 0;
  return g_ledStrips[strip].count;
}

bool ledSetPixel(int strip, int index, int r, int g, int b) {
  if (!ledReady(strip)) return false;
  LedStripState& s = g_ledStrips[strip];
  if (!s.pixels || index < 0 || index >= s.count) return false;
  s.pixels[index] = CRGB(constrain(r, 0, 255), constrain(g, 0, 255), constrain(b, 0, 255));
  return true;
}

bool ledFill(int strip, int r, int g, int b) {
  if (!ledReady(strip)) return false;
  LedStripState& s = g_ledStrips[strip];
  fill_solid(s.pixels, s.count, CRGB(constrain(r, 0, 255), constrain(g, 0, 255), constrain(b, 0, 255)));
  return true;
}

bool ledClear(int strip, bool show) {
  if (strip < 0) {
    bool any = false;
    for (int i = 0; i < P1_EMBED_MAX_LED_STRIPS; i++) {
      if (!ledReady(i)) continue;
      fill_solid(g_ledStrips[i].pixels, g_ledStrips[i].count, CRGB::Black);
      any = true;
    }
    if (show && any) FastLED.show();
    return any;
  }
  if (!ledReady(strip)) return false;
  fill_solid(g_ledStrips[strip].pixels, g_ledStrips[strip].count, CRGB::Black);
  if (show) FastLED.show();
  return true;
}

bool fastLedShow() {
  if (g_activeStripCount <= 0) return false;
  FastLED.show();
  return true;
}

bool ledSetBrightness(int strip, int brightness) {
  if (!ledReady(strip)) return false;
  g_ledStrips[strip].brightness = constrain(brightness, 0, 255);
  FastLED.setBrightness((uint8_t)g_ledStrips[strip].brightness);
  return true;
}

String ledStatusJson() {
  String out = "{";
  out += "\"available\":" + String(P1_EMBED_FASTLED_AVAILABLE ? "true" : "false");
  out += ",\"ready\":" + String(g_activeStripCount > 0 ? "true" : "false");
  out += ",\"stripCount\":" + String(g_activeStripCount);
  out += ",\"totalLeds\":" + String(g_totalLedCount);
  out += ",\"maxLeds\":" + String(P1_EMBED_FASTLED_MAX_LEDS);
  out += ",\"maxStrips\":" + String(P1_EMBED_MAX_LED_STRIPS);
  out += ",\"driver\":\"FastLED\"";
  out += ",\"chipset\":\"WS2812B\"";
  out += ",\"order\":\"GRB\"";
  out += ",\"strips\":[";
  for (int i = 0; i < g_activeStripCount; i++) {
    if (i) out += ",";
    out += "{\"strip\":" + String(i);
    out += ",\"ready\":" + String(g_ledStrips[i].ready ? "true" : "false");
    out += ",\"pin\":" + String(g_ledStrips[i].pin);
    out += ",\"count\":" + String(g_ledStrips[i].count);
    out += ",\"brightness\":" + String(g_ledStrips[i].brightness);
    out += ",\"chipset\":\"WS2812B\"";
    out += ",\"order\":\"GRB\"";
    out += "}";
  }
  out += "]}";
  return out;
}

bool fastLedBeginWs2812b(int pin, int count, int brightness) {
  return ledConfigureStrip(0, pin, count, brightness);
}

bool fastLedReady() {
  return ledReady(0);
}

int fastLedPin() {
  return ledPin(0);
}

int fastLedCount() {
  return ledCount(0);
}

bool fastLedSetPixel(int index, int r, int g, int b) {
  return ledSetPixel(0, index, r, g, b);
}

bool fastLedFill(int r, int g, int b) {
  return ledFill(0, r, g, b);
}

bool fastLedClear(bool show) {
  return ledClear(0, show);
}

bool fastLedSetBrightness(int brightness) {
  return ledSetBrightness(0, brightness);
}

String fastLedStatusJson() {
  return ledStatusJson();
}
