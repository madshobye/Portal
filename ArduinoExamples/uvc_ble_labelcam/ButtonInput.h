#pragma once

#include <Arduino.h>

class ButtonInput {
public:
  ButtonInput(uint8_t pin, uint32_t debounceMs);
  void begin();
  bool pressed();

private:
  uint8_t _pin;
  uint32_t _debounceMs;
  bool _stableDown = false;
  bool _lastRawDown = false;
  uint32_t _changedAt = 0;
};

