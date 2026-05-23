#pragma once

#include <Arduino.h>

struct GrayscaleFrame {
  uint16_t width = 0;
  uint16_t height = 0;
  uint8_t *pixels = nullptr;
  size_t length = 0;

  bool allocate(uint16_t nextWidth, uint16_t nextHeight) {
    release();
    width = nextWidth;
    height = nextHeight;
    length = size_t(width) * size_t(height);
    pixels = static_cast<uint8_t *>(ps_malloc(length));
    if (pixels == nullptr) {
      pixels = static_cast<uint8_t *>(malloc(length));
    }
    if (pixels == nullptr) {
      width = 0;
      height = 0;
      length = 0;
      return false;
    }
    return true;
  }

  void release() {
    if (pixels != nullptr) {
      free(pixels);
    }
    pixels = nullptr;
    width = 0;
    height = 0;
    length = 0;
  }
};

