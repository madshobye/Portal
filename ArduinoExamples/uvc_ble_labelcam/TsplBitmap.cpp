#include "TsplBitmap.h"
#include "Config.h"

static void ditherFloydSteinberg(float *lum, uint16_t width, uint16_t height) {
  for (uint16_t y = 0; y < height; y++) {
    for (uint16_t x = 0; x < width; x++) {
      const size_t index = size_t(y) * width + x;
      const float oldValue = lum[index];
      const float newValue = oldValue < DITHER_THRESHOLD ? 0.0f : 255.0f;
      const float error = oldValue - newValue;
      lum[index] = newValue;
      if (x + 1 < width) lum[index + 1] += error * 7.0f / 16.0f;
      if (y + 1 < height) {
        if (x > 0) lum[index + width - 1] += error * 3.0f / 16.0f;
        lum[index + width] += error * 5.0f / 16.0f;
        if (x + 1 < width) lum[index + width + 1] += error * 1.0f / 16.0f;
      }
    }
  }
}

bool makeTsplBitmapLabel(const GrayscaleFrame &frame, TsplBuffer &out) {
  out.release();
  if (frame.pixels == nullptr || frame.width == 0 || frame.height == 0) {
    return false;
  }

  const uint16_t widthBytes = (frame.width + 7) / 8;
  const size_t bitmapBytes = size_t(widthBytes) * frame.height;
  float *lum = static_cast<float *>(ps_malloc(sizeof(float) * frame.length));
  if (lum == nullptr) {
    lum = static_cast<float *>(malloc(sizeof(float) * frame.length));
  }
  if (lum == nullptr) {
    return false;
  }

  for (size_t i = 0; i < frame.length; i++) {
    lum[i] = frame.pixels[i];
  }
  ditherFloydSteinberg(lum, frame.width, frame.height);

  String header;
  header.reserve(128);
  header += "SIZE ";
  header += String(LABEL_WIDTH_MM, 0);
  header += " mm,";
  header += String(LABEL_HEIGHT_MM, 0);
  header += " mm\r\nGAP ";
  header += String(LABEL_GAP_MM, 0);
  header += " mm,0 mm\r\nDIRECTION 1\r\nDENSITY ";
  header += String(LABEL_DENSITY);
  header += "\r\nCLS\r\nBITMAP 0,0,";
  header += String(widthBytes);
  header += ",";
  header += String(frame.height);
  header += ",0,";
  const char *footer = "\r\nPRINT 1,1\r\n";
  const size_t footerLen = strlen(footer);
  out.length = header.length() + bitmapBytes + footerLen;
  out.data = static_cast<uint8_t *>(ps_malloc(out.length));
  if (out.data == nullptr) {
    out.data = static_cast<uint8_t *>(malloc(out.length));
  }
  if (out.data == nullptr) {
    free(lum);
    out.length = 0;
    return false;
  }

  memcpy(out.data, header.c_str(), header.length());
  uint8_t *bitmap = out.data + header.length();
  memset(bitmap, 0xff, bitmapBytes);
  for (uint16_t y = 0; y < frame.height; y++) {
    for (uint16_t x = 0; x < frame.width; x++) {
      if (lum[size_t(y) * frame.width + x] >= DITHER_THRESHOLD) continue;
      const size_t byteIndex = size_t(y) * widthBytes + x / 8;
      bitmap[byteIndex] &= ~(0x80 >> (x % 8));
    }
  }
  memcpy(out.data + header.length() + bitmapBytes, footer, footerLen);
  free(lum);
  return true;
}

