/*
  Arduino Micro USB joystick button

  Wiring:
  - One side of the button to pin 16
  - Other side of the button to GND

  Requires the Arduino Joystick Library by MHeironimus:
  https://github.com/MHeironimus/ArduinoJoystickLibrary
*/

#include <Joystick.h>

const uint8_t BUTTON_PIN = 16;
const uint8_t JOYSTICK_BUTTON = 0;
const unsigned long DEBOUNCE_MS = 10;

Joystick_ Joystick(
  JOYSTICK_DEFAULT_REPORT_ID,
  JOYSTICK_TYPE_JOYSTICK,
  1,     // button count
  0,     // hat switch count
  false, // x axis
  false, // y axis
  false, // z axis
  false, // rx axis
  false, // ry axis
  false, // rz axis
  false, // rudder
  false, // throttle
  false, // accelerator
  false, // brake
  false  // steering
);

bool stablePressed = false;
bool lastRawPressed = false;
unsigned long lastDebounceTime = 0;

void setup() {
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  Joystick.begin();
  Joystick.setButton(JOYSTICK_BUTTON, 0);
}

void loop() {
  const bool rawPressed = digitalRead(BUTTON_PIN) == LOW;

  if (rawPressed != lastRawPressed) {
    lastDebounceTime = millis();
    lastRawPressed = rawPressed;
  }

  if ((millis() - lastDebounceTime) >= DEBOUNCE_MS && rawPressed != stablePressed) {
    stablePressed = rawPressed;
    Joystick.setButton(JOYSTICK_BUTTON, stablePressed ? 1 : 0);
  }
}
