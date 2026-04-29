/*
  AnimatronicHeadSerial

  Receives high-level Portal chat states over USB serial and animates 4 servos:
  1. eye left/right
  2. eye up/down
  3. eyelids up/down
  4. mouth up/down

  Expected serial messages at 115200 baud:
    STATE:idle
    STATE:ready
    STATE:listening
    STATE:processing
    STATE:speaking
    STATE:waiting_for_reply
    STATE:error
    STATE:reset

  Wiring:
  - Eye left/right servo  -> pin 3
  - Eye up/down servo     -> pin 5
  - Eyelid servo          -> pin 6
  - Mouth servo           -> pin 9

  Notes:
  - Adjust the neutral/min/max values below for your mechanics.
  - This sketch is intentionally servo-agnostic: it responds to conversation state,
    not to low-level movement commands.
*/

#include <Servo.h>

const unsigned long SERIAL_BAUD = 115200;

const uint8_t SERVO_EYE_LR_PIN = 3;
const uint8_t SERVO_EYE_UD_PIN = 5;
const uint8_t SERVO_LIDS_PIN = 6;
const uint8_t SERVO_MOUTH_PIN = 9;

const int EYE_LR_MIN = 60;
const int EYE_LR_CENTER = 90;
const int EYE_LR_MAX = 120;

const int EYE_UD_MIN = 72;
const int EYE_UD_CENTER = 92;
const int EYE_UD_MAX = 112;

const int LIDS_OPEN = 84;
const int LIDS_HALF = 105;
const int LIDS_CLOSED = 132;

const int MOUTH_CLOSED = 88;
const int MOUTH_MID = 106;
const int MOUTH_OPEN = 128;

const float SERVO_SMOOTHING = 0.12f;
const unsigned long BLINK_DURATION_MS = 120;
const unsigned long BOOT_SETTLE_MS = 1400;

Servo servoEyeLR;
Servo servoEyeUD;
Servo servoLids;
Servo servoMouth;

String serialBuffer = "";
String currentState = "boot";

float eyeLRValue = EYE_LR_CENTER;
float eyeUDValue = EYE_UD_CENTER;
float lidsValue = LIDS_HALF;
float mouthValue = MOUTH_CLOSED;

float eyeLRTarget = EYE_LR_CENTER;
float eyeUDTarget = EYE_UD_CENTER;
float lidsTarget = LIDS_HALF;
float mouthTarget = MOUTH_CLOSED;

unsigned long bootStartedAt = 0;
unsigned long blinkStartedAt = 0;
unsigned long lastBlinkAt = 0;
unsigned long nextBlinkDelayMs = 2000;
unsigned long lastGazeShiftAt = 0;
unsigned long nextGazeShiftDelayMs = 1200;
bool blinkActive = false;

void setup() {
  Serial.begin(SERIAL_BAUD);

  servoEyeLR.attach(SERVO_EYE_LR_PIN);
  servoEyeUD.attach(SERVO_EYE_UD_PIN);
  servoLids.attach(SERVO_LIDS_PIN);
  servoMouth.attach(SERVO_MOUTH_PIN);

  bootStartedAt = millis();
  setState("boot");
  writeServosImmediate();

  Serial.println("AnimatronicHeadSerial ready");
}

void loop() {
  readSerialMessages();
  updateStateMachine();
  updateBlink();
  updateGazeTargets();
  updateStateTargets();
  easeServos();
  writeServos();
}

void readSerialMessages() {
  while (Serial.available() > 0) {
    const char ch = (char)Serial.read();
    if (ch == '\r') continue;

    if (ch == '\n') {
      if (serialBuffer.length() > 0) {
        handleLine(serialBuffer);
        serialBuffer = "";
      }
      continue;
    }

    if (serialBuffer.length() < 80) {
      serialBuffer += ch;
    }
  }
}

void handleLine(String line) {
  line.trim();
  if (!line.length()) return;

  if (line.startsWith("STATE:")) {
    String next = line.substring(6);
    next.trim();
    next.toLowerCase();
    setState(next);
    Serial.print("state -> ");
    Serial.println(currentState);
  }
}

void setState(const String &next) {
  currentState = next;

  if (currentState == "reset") {
    blinkActive = false;
    eyeLRTarget = EYE_LR_CENTER;
    eyeUDTarget = EYE_UD_CENTER;
    lidsTarget = LIDS_HALF;
    mouthTarget = MOUTH_CLOSED;
    return;
  }

  if (currentState == "boot") {
    blinkActive = false;
    eyeLRTarget = EYE_LR_CENTER;
    eyeUDTarget = EYE_UD_CENTER;
    lidsTarget = LIDS_HALF;
    mouthTarget = MOUTH_CLOSED;
    return;
  }

  scheduleBlinkFromNow();
  scheduleGazeShiftFromNow();
}

void updateStateMachine() {
  if (currentState == "boot" && millis() - bootStartedAt > BOOT_SETTLE_MS) {
    setState("ready");
  }
}

void updateBlink() {
  const unsigned long now = millis();

  if (blinkActive && now - blinkStartedAt >= BLINK_DURATION_MS) {
    blinkActive = false;
    lastBlinkAt = now;
    nextBlinkDelayMs = pickBlinkDelayForState();
  }

  if (!blinkActive && now - lastBlinkAt >= nextBlinkDelayMs && shouldBlinkForState()) {
    blinkActive = true;
    blinkStartedAt = now;
  }
}

void updateGazeTargets() {
  if (!shouldRoamEyes()) return;

  const unsigned long now = millis();
  if (now - lastGazeShiftAt < nextGazeShiftDelayMs) return;

  lastGazeShiftAt = now;
  nextGazeShiftDelayMs = pickGazeDelayForState();

  if (currentState == "idle") {
    eyeLRTarget = randomInt(EYE_LR_CENTER - 18, EYE_LR_CENTER + 18);
    eyeUDTarget = randomInt(EYE_UD_CENTER - 8, EYE_UD_CENTER + 8);
  } else if (currentState == "processing") {
    eyeLRTarget = randomInt(EYE_LR_CENTER - 14, EYE_LR_CENTER + 14);
    eyeUDTarget = randomInt(EYE_UD_CENTER - 4, EYE_UD_CENTER + 10);
  } else if (currentState == "speaking") {
    eyeLRTarget = randomInt(EYE_LR_CENTER - 10, EYE_LR_CENTER + 10);
    eyeUDTarget = randomInt(EYE_UD_CENTER - 5, EYE_UD_CENTER + 5);
  } else if (currentState == "waiting_for_reply") {
    eyeLRTarget = randomInt(EYE_LR_CENTER - 8, EYE_LR_CENTER + 8);
    eyeUDTarget = randomInt(EYE_UD_CENTER - 3, EYE_UD_CENTER + 3);
  }
}

void updateStateTargets() {
  const unsigned long now = millis();

  if (currentState == "boot") {
    eyeLRTarget = EYE_LR_CENTER;
    eyeUDTarget = EYE_UD_CENTER;
    lidsTarget = LIDS_HALF;
    mouthTarget = MOUTH_CLOSED;
  } else if (currentState == "idle") {
    lidsTarget = LIDS_HALF;
    mouthTarget = MOUTH_CLOSED;
  } else if (currentState == "ready") {
    eyeLRTarget = EYE_LR_CENTER;
    eyeUDTarget = EYE_UD_CENTER;
    lidsTarget = LIDS_OPEN;
    mouthTarget = MOUTH_CLOSED;
  } else if (currentState == "listening") {
    eyeLRTarget = EYE_LR_CENTER;
    eyeUDTarget = EYE_UD_CENTER - 2;
    lidsTarget = LIDS_OPEN;
    mouthTarget = MOUTH_CLOSED;
  } else if (currentState == "processing") {
    lidsTarget = LIDS_HALF;
    mouthTarget = MOUTH_CLOSED;
  } else if (currentState == "speaking") {
    lidsTarget = LIDS_OPEN;
    mouthTarget = speakingMouthTarget(now);
  } else if (currentState == "waiting_for_reply") {
    lidsTarget = LIDS_OPEN;
    mouthTarget = MOUTH_CLOSED;
  } else if (currentState == "error") {
    eyeLRTarget = EYE_LR_CENTER;
    eyeUDTarget = EYE_UD_CENTER + 3;
    lidsTarget = LIDS_OPEN - 6;
    mouthTarget = MOUTH_MID;
  } else if (currentState == "reset") {
    eyeLRTarget = EYE_LR_CENTER;
    eyeUDTarget = EYE_UD_CENTER;
    lidsTarget = LIDS_HALF;
    mouthTarget = MOUTH_CLOSED;
  } else {
    eyeLRTarget = EYE_LR_CENTER;
    eyeUDTarget = EYE_UD_CENTER;
    lidsTarget = LIDS_HALF;
    mouthTarget = MOUTH_CLOSED;
  }

  if (blinkActive) {
    lidsTarget = LIDS_CLOSED;
  }

  eyeLRTarget = clampf(eyeLRTarget, EYE_LR_MIN, EYE_LR_MAX);
  eyeUDTarget = clampf(eyeUDTarget, EYE_UD_MIN, EYE_UD_MAX);
  lidsTarget = clampf(lidsTarget, LIDS_OPEN - 8, LIDS_CLOSED);
  mouthTarget = clampf(mouthTarget, MOUTH_CLOSED, MOUTH_OPEN);
}

void easeServos() {
  eyeLRValue += (eyeLRTarget - eyeLRValue) * SERVO_SMOOTHING;
  eyeUDValue += (eyeUDTarget - eyeUDValue) * SERVO_SMOOTHING;
  lidsValue += (lidsTarget - lidsValue) * SERVO_SMOOTHING;
  mouthValue += (mouthTarget - mouthValue) * SERVO_SMOOTHING;
}

void writeServos() {
  servoEyeLR.write((int)round(eyeLRValue));
  servoEyeUD.write((int)round(eyeUDValue));
  servoLids.write((int)round(lidsValue));
  servoMouth.write((int)round(mouthValue));
}

void writeServosImmediate() {
  eyeLRValue = eyeLRTarget;
  eyeUDValue = eyeUDTarget;
  lidsValue = lidsTarget;
  mouthValue = mouthTarget;
  writeServos();
}

bool shouldBlinkForState() {
  return currentState != "speaking" && currentState != "reset";
}

bool shouldRoamEyes() {
  return currentState == "idle" ||
         currentState == "processing" ||
         currentState == "speaking" ||
         currentState == "waiting_for_reply";
}

unsigned long pickBlinkDelayForState() {
  if (currentState == "idle") return (unsigned long)randomInt(1700, 3200);
  if (currentState == "processing") return (unsigned long)randomInt(1600, 2800);
  if (currentState == "listening") return (unsigned long)randomInt(2400, 4200);
  if (currentState == "waiting_for_reply") return (unsigned long)randomInt(2200, 3600);
  return (unsigned long)randomInt(2200, 3400);
}

unsigned long pickGazeDelayForState() {
  if (currentState == "idle") return (unsigned long)randomInt(900, 1700);
  if (currentState == "processing") return (unsigned long)randomInt(700, 1400);
  if (currentState == "speaking") return (unsigned long)randomInt(500, 950);
  if (currentState == "waiting_for_reply") return (unsigned long)randomInt(900, 1500);
  return 1400;
}

void scheduleBlinkFromNow() {
  blinkActive = false;
  lastBlinkAt = millis();
  nextBlinkDelayMs = pickBlinkDelayForState();
}

void scheduleGazeShiftFromNow() {
  lastGazeShiftAt = millis();
  nextGazeShiftDelayMs = pickGazeDelayForState();
}

int speakingMouthTarget(unsigned long now) {
  const float phase = (float)(now % 520UL) / 520.0f;
  const float waveA = sinf(phase * TWO_PI * 2.0f);
  const float waveB = sinf(phase * TWO_PI * 4.0f + 0.8f);
  const float amount = (waveA * 0.65f + waveB * 0.35f + 1.0f) * 0.5f;
  return (int)round(MOUTH_CLOSED + amount * (MOUTH_OPEN - MOUTH_CLOSED));
}

long randomInt(long minValue, long maxValue) {
  if (maxValue <= minValue) return minValue;
  return random(minValue, maxValue + 1);
}

float clampf(float value, float minValue, float maxValue) {
  if (value < minValue) return minValue;
  if (value > maxValue) return maxValue;
  return value;
}
