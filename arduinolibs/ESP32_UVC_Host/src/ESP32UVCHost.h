#ifndef ESP32_UVC_HOST_H
#define ESP32_UVC_HOST_H

#include <Arduino.h>

extern "C" {
#include "libuvc/libuvc.h"
#include "libuvc_adapter.h"
}

class ESP32UVCHost {
public:
  using FrameCallback = void (*)(uvc_frame_t *frame, void *user);

  bool begin();
  bool open(uint16_t width = 160,
            uint16_t height = 120,
            uint8_t fps = 0,
            uvc_frame_format format = UVC_FRAME_FORMAT_ANY,
            uint16_t vid = 0,
            uint16_t pid = 0,
            const char *serial = nullptr);
  bool start(FrameCallback callback, void *user = nullptr);
  void stop();
  void close();

  const char *lastError() const { return _lastError; }
  const uvc_stream_ctrl_t &streamControl() const { return _ctrl; }

private:
  static void usbEventTask(void *arg);
  static void adapterEvent(libuvc_adapter_event_t event);
  static bool ensureHost();
  static bool waitForDevice(uint32_t timeoutMs);
  static void setLastError(const char *message);

  static bool _hostReady;
  static EventGroupHandle_t _events;
  static SemaphoreHandle_t _readyToUninstall;
  static const char *_lastError;

  uvc_context_t *_ctx = nullptr;
  uvc_device_t *_dev = nullptr;
  uvc_device_handle_t *_devh = nullptr;
  uvc_stream_ctrl_t _ctrl = {};
  bool _streaming = false;
};

#endif
