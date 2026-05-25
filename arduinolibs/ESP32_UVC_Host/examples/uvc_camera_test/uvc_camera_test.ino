#include <Arduino.h>
#include <ESP32UVCHost.h>

ESP32UVCHost camera;

static volatile uint32_t frameCount = 0;
static volatile uint32_t byteCount = 0;
static uint32_t lastReportMs = 0;

static void waitForStartCommand() {
  Serial.println("ready: send g then Enter to start UVC");
  while (true) {
    if (Serial.available()) {
      char c = Serial.read();
      if (c == 'g' || c == 'G') {
        Serial.println("start command received");
        while (Serial.available()) {
          Serial.read();
        }
        return;
      }
    }
    delay(20);
  }
}

static void onFrame(uvc_frame_t *frame, void *user) {
  (void)user;
  frameCount++;
  byteCount += frame->data_bytes;

  if (frameCount <= 3) {
    Serial.printf("first frame %lu: %ux%u format=%d bytes=%u step=%u\n",
                  static_cast<unsigned long>(frameCount),
                  frame->width,
                  frame->height,
                  frame->frame_format,
                  frame->data_bytes,
                  frame->step);
  }
}

void setup() {
  Serial.begin(115200);
  uint32_t start = millis();
  while (!Serial && millis() - start < 3000) {
    delay(10);
  }

  Serial.println();
  Serial.println("ESP32 UVC camera test");
  Serial.printf("heap=%u psram=%u\n", ESP.getFreeHeap(), ESP.getFreePsram());
  waitForStartCommand();

  Serial.println("before camera.begin");
  if (!camera.begin()) {
    Serial.printf("camera begin failed: %s\n", camera.lastError());
    return;
  }
  Serial.println("after camera.begin");

  Serial.println("before camera.open");
  if (!camera.open(160, 120, 5, UVC_FRAME_FORMAT_MJPEG)) {
    Serial.printf("camera open failed: %s\n", camera.lastError());
    return;
  }
  Serial.println("after camera.open");

  const uvc_stream_ctrl_t &ctrl = camera.streamControl();
  Serial.printf("selected stream: formatIndex=%u frameIndex=%u interval=%lu payload=%lu\n",
                ctrl.bFormatIndex,
                ctrl.bFrameIndex,
                static_cast<unsigned long>(ctrl.dwFrameInterval),
                static_cast<unsigned long>(ctrl.dwMaxPayloadTransferSize));

  if (!camera.start(onFrame)) {
    Serial.printf("camera start failed: %s\n", camera.lastError());
    return;
  }

  lastReportMs = millis();
  Serial.println("camera streaming");
}

void loop() {
  uint32_t now = millis();
  if (now - lastReportMs >= 1000) {
    uint32_t frames = frameCount;
    uint32_t bytes = byteCount;
    frameCount = 0;
    byteCount = 0;
    lastReportMs = now;

    Serial.printf("fps=%lu bytes/s=%lu heap=%u psram=%u\n",
                  static_cast<unsigned long>(frames),
                  static_cast<unsigned long>(bytes),
                  ESP.getFreeHeap(),
                  ESP.getFreePsram());
  }
  delay(20);
}
