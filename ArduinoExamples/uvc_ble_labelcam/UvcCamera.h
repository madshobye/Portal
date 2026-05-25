#pragma once

#include <Arduino.h>
#include "FrameBuffer.h"

class UvcCamera {
public:
  bool begin();
  void update();
  bool ready() const;
  bool asciiPreviewDone() const;
  bool copyFrame(const void *data, size_t length, uint32_t width, uint32_t height, int format, uint32_t sequence);
  bool captureGrayscale(GrayscaleFrame &frame, uint16_t width, uint16_t height);
  void suspendStream();
  void resumeStream();
  const char *lastError() const;

private:
  bool _ready = false;
  bool _streamStarted = false;
  bool _streamSuspended = false;
  bool _previewPrinted = false;
  const char *_lastError = "";
  void fillTestPattern(GrayscaleFrame &frame);
  bool beginAsciiPreview();
  void printPendingAsciiPreview();
  bool decodeSnapshotToGrayscale(GrayscaleFrame &frame);
};
