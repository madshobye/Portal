#pragma once

#include <Arduino.h>
#include "FrameBuffer.h"

class UvcCamera {
public:
  bool begin();
  bool ready() const;
  bool captureGrayscale(GrayscaleFrame &frame, uint16_t width, uint16_t height);
  const char *lastError() const;

private:
  bool _ready = false;
  const char *_lastError = "";
  void fillTestPattern(GrayscaleFrame &frame);
};

