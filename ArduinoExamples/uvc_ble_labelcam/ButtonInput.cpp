#include "ButtonInput.h"

ButtonInput::ButtonInput(uint8_t pin, uint32_t debounceMs)
  : _pin(pin), _debounceMs(debounceMs) {}

void ButtonInput::begin() {
  pinMode(_pin, INPUT_PULLUP);
  _lastRawDown = digitalRead(_pin) == LOW;
  _stableDown = _lastRawDown;
  _changedAt = millis();
}

bool ButtonInput::pressed() {
  const bool rawDown = digitalRead(_pin) == LOW;
  const uint32_t now = millis();
  if (rawDown != _lastRawDown) {
    _lastRawDown = rawDown;
    _changedAt = now;
  }
  if (now - _changedAt < _debounceMs) {
    return false;
  }
  if (rawDown && !_stableDown) {
    _stableDown = true;
    return true;
  }
  if (!rawDown) {
    _stableDown = false;
  }
  return false;
}

