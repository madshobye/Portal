#include "UvcCamera.h"
#include "Config.h"

bool UvcCamera::begin() {
  // TODO: Integrate an ESP32-S3 USB host UVC backend here.
  // Expected flow:
  // 1. Start USB host.
  // 2. Detect a video-class UVC device.
  // 3. Select a small MJPEG/YUY2 stream.
  // 4. Decode/convert into the requested GrayscaleFrame.
  _ready = ENABLE_TEST_PATTERN_CAPTURE;
  _lastError = _ready ? "" : "UVC backend not integrated";
  return _ready;
}

bool UvcCamera::ready() const {
  return _ready;
}

bool UvcCamera::captureGrayscale(GrayscaleFrame &frame, uint16_t width, uint16_t height) {
  if (!frame.allocate(width, height)) {
    _lastError = "frame allocation failed";
    return false;
  }

  if (ENABLE_TEST_PATTERN_CAPTURE) {
    fillTestPattern(frame);
    return true;
  }

  _lastError = "UVC capture not implemented";
  return false;
}

const char *UvcCamera::lastError() const {
  return _lastError;
}

void UvcCamera::fillTestPattern(GrayscaleFrame &frame) {
  for (uint16_t y = 0; y < frame.height; y++) {
    for (uint16_t x = 0; x < frame.width; x++) {
      const uint8_t gradient = uint8_t((uint32_t(x) * 255) / max<uint16_t>(1, frame.width - 1));
      const bool stripe = ((x / 32) + (y / 32)) % 2 == 0;
      frame.pixels[size_t(y) * frame.width + x] = stripe ? gradient : uint8_t(255 - gradient);
    }
  }
}

