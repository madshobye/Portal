#pragma once

#include <Arduino.h>
#include "FrameBuffer.h"

struct TsplBuffer {
  uint8_t *data = nullptr;
  size_t length = 0;

  void release() {
    if (data != nullptr) {
      free(data);
    }
    data = nullptr;
    length = 0;
  }
};

bool makeTsplBitmapLabel(const GrayscaleFrame &frame, TsplBuffer &out);

