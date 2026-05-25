#include <Arduino.h>
#include <ESP32UVCHost.h>

ESP32UVCHost camera;

static volatile uint32_t frameCount = 0;

static void printAsciiFrame(uvc_frame_t *frame, void *user) {
  (void)user;
  frameCount++;

  if (frameCount % 10 != 1) {
    return;
  }

  Serial.printf("frame %lu: %ux%u format=%d bytes=%u\n",
                static_cast<unsigned long>(frameCount),
                frame->width,
                frame->height,
                frame->frame_format,
                frame->data_bytes);

  const uint8_t *data = static_cast<const uint8_t *>(frame->data);
  if (!data || frame->data_bytes == 0 || frame->width == 0 || frame->height == 0) {
    return;
  }

  const uint16_t cols = 40;
  const uint16_t rows = 24;
  const char *ramp = " .:-=+*#%@";

  if (frame->frame_format != UVC_FRAME_FORMAT_YUYV &&
      frame->frame_format != UVC_FRAME_FORMAT_GRAY8) {
    Serial.println("ascii preview supports YUYV/GRAY8 frames only");
    return;
  }

  for (uint16_t y = 0; y < rows; y++) {
    uint16_t sy = (static_cast<uint32_t>(y) * frame->height) / rows;
    for (uint16_t x = 0; x < cols; x++) {
      uint16_t sx = (static_cast<uint32_t>(x) * frame->width) / cols;
      uint8_t lum = 0;
      if (frame->frame_format == UVC_FRAME_FORMAT_GRAY8) {
        lum = data[sy * frame->width + sx];
      } else {
        size_t offset = (static_cast<size_t>(sy) * frame->width + sx) * 2;
        if (offset >= frame->data_bytes) {
          lum = 0;
        } else {
          lum = data[offset];
        }
      }
      Serial.print(ramp[(lum * 9) / 255]);
    }
    Serial.println();
  }
}

void setup() {
  Serial.begin(115200);
  uint32_t start = millis();
  while (!Serial && millis() - start < 3000) {
    delay(10);
  }

  Serial.println();
  Serial.println("ESP32 UVC Host ASCII smoke");

  if (!camera.begin()) {
    Serial.printf("camera begin failed: %s\n", camera.lastError());
    return;
  }

  if (!camera.open(160, 120, 0, UVC_FRAME_FORMAT_ANY)) {
    Serial.printf("camera open failed: %s\n", camera.lastError());
    return;
  }

  if (!camera.start(printAsciiFrame)) {
    Serial.printf("camera start failed: %s\n", camera.lastError());
    return;
  }

  Serial.println("streaming");
}

void loop() {
  delay(1000);
  Serial.printf("frames=%lu heap=%u psram=%u\n",
                static_cast<unsigned long>(frameCount),
                ESP.getFreeHeap(),
                ESP.getFreePsram());
}
