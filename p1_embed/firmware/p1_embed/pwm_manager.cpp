#include <Arduino.h>
#include "p1_embed_firmware.h"

enum PwmOwner {
  PWM_OWNER_NONE,
  PWM_OWNER_ANALOG,
  PWM_OWNER_SERVO,
  PWM_OWNER_FAN
};

struct PwmPinState {
  int pin;
  PwmOwner owner;
  uint32_t freq;
  uint8_t resolution;
};

static PwmPinState g_pwmPins[P1_EMBED_PWM_MAX_PINS];
static uint8_t g_analogResolution = 8;
static uint32_t g_analogFrequency = 5000;

static bool pwmUsableOutputPin(int pin) {
  return pin >= 0 && pin <= 33;
}

static uint32_t pwmDutyMax(uint8_t resolution) {
  if (resolution >= 31) return 0x7FFFFFFF;
  return (1UL << resolution) - 1UL;
}

static int pwmFindSlot(int pin) {
  for (int i = 0; i < P1_EMBED_PWM_MAX_PINS; i++) {
    if (g_pwmPins[i].owner != PWM_OWNER_NONE && g_pwmPins[i].pin == pin) return i;
  }
  return -1;
}

static int pwmFindFreeSlot() {
  for (int i = 0; i < P1_EMBED_PWM_MAX_PINS; i++) {
    if (g_pwmPins[i].owner == PWM_OWNER_NONE) return i;
  }
  return -1;
}

void pwmManagerBegin() {
  for (int i = 0; i < P1_EMBED_PWM_MAX_PINS; i++) {
    g_pwmPins[i].pin = -1;
    g_pwmPins[i].owner = PWM_OWNER_NONE;
    g_pwmPins[i].freq = 0;
    g_pwmPins[i].resolution = 0;
  }
}

bool pwmDetachPin(int pin) {
  int slot = pwmFindSlot(pin);
  if (slot < 0) return true;
  ledcDetach((uint8_t)pin);
  g_pwmPins[slot].pin = -1;
  g_pwmPins[slot].owner = PWM_OWNER_NONE;
  g_pwmPins[slot].freq = 0;
  g_pwmPins[slot].resolution = 0;
  pinMode(pin, OUTPUT);
  digitalWrite(pin, LOW);
  return true;
}

static bool pwmEnsure(int pin, PwmOwner owner, uint32_t freq, uint8_t resolution) {
  if (!pwmUsableOutputPin(pin)) return false;
  resolution = constrain(resolution, 1, 14);
  freq = constrain(freq, 1UL, 100000UL);

  int slot = pwmFindSlot(pin);
  if (slot >= 0 && g_pwmPins[slot].owner != owner) {
    pwmDetachPin(pin);
    slot = -1;
  }
  if (slot < 0) slot = pwmFindFreeSlot();
  if (slot < 0) return false;

  if (g_pwmPins[slot].owner == owner && g_pwmPins[slot].freq == freq && g_pwmPins[slot].resolution == resolution) {
    return true;
  }

  bool ok = false;
  if (g_pwmPins[slot].owner == owner) {
    ok = ledcChangeFrequency((uint8_t)pin, freq, resolution) > 0;
  } else {
    ok = ledcAttach((uint8_t)pin, freq, resolution);
  }
  if (!ok) return false;

  g_pwmPins[slot].pin = pin;
  g_pwmPins[slot].owner = owner;
  g_pwmPins[slot].freq = freq;
  g_pwmPins[slot].resolution = resolution;
  return true;
}

bool pwmAnalogSetResolution(int bits) {
  if (bits < 1 || bits > 14) return false;
  g_analogResolution = (uint8_t)bits;
  return true;
}

bool pwmAnalogSetFrequency(int pin, int hz) {
  if (hz < 1 || hz > 100000) return false;
  if (pin < 0) {
    g_analogFrequency = (uint32_t)hz;
    return true;
  }
  if (!pwmEnsure(pin, PWM_OWNER_ANALOG, (uint32_t)hz, g_analogResolution)) return false;
  return true;
}

bool pwmAnalogWrite(int pin, int value) {
  if (!pwmEnsure(pin, PWM_OWNER_ANALOG, g_analogFrequency, g_analogResolution)) return false;
  uint32_t maxDuty = pwmDutyMax(g_analogResolution);
  uint32_t duty = (uint32_t)constrain(value, 0, (int)maxDuty);
  return ledcWrite((uint8_t)pin, duty);
}

bool pwmServoAttach(int pin) {
  return pwmEnsure(pin, PWM_OWNER_SERVO, 50, 16);
}

bool pwmServoWriteMicroseconds(int pin, int us) {
  if (!pwmServoAttach(pin)) return false;
  us = constrain(us, 544, 2400);
  uint32_t maxDuty = pwmDutyMax(16);
  uint32_t duty = ((uint64_t)us * maxDuty) / 20000ULL;
  return ledcWrite((uint8_t)pin, duty);
}

bool pwmServoWrite(int pin, int angle) {
  angle = constrain(angle, 0, 180);
  int us = map(angle, 0, 180, 544, 2400);
  return pwmServoWriteMicroseconds(pin, us);
}

bool pwmServoDetach(int pin) {
  int slot = pwmFindSlot(pin);
  if (slot >= 0 && g_pwmPins[slot].owner != PWM_OWNER_SERVO) return false;
  return pwmDetachPin(pin);
}

bool pwmFanAttach(int pin) {
  return pwmEnsure(pin, PWM_OWNER_FAN, 25000, 10);
}

bool pwmFanWriteRaw(int pin, int duty) {
  if (!pwmFanAttach(pin)) return false;
  uint32_t maxDuty = pwmDutyMax(10);
  return ledcWrite((uint8_t)pin, (uint32_t)constrain(duty, 0, (int)maxDuty));
}

bool pwmFanWrite(int pin, int percent) {
  if (!pwmFanAttach(pin)) return false;
  percent = constrain(percent, 0, 100);
  uint32_t duty = ((uint32_t)percent * pwmDutyMax(10)) / 100UL;
  return ledcWrite((uint8_t)pin, duty);
}

bool pwmFanDetach(int pin) {
  int slot = pwmFindSlot(pin);
  if (slot >= 0 && g_pwmPins[slot].owner != PWM_OWNER_FAN) return false;
  return pwmDetachPin(pin);
}
