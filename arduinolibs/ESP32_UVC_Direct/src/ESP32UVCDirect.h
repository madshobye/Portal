#pragma once

#include <Arduino.h>

#include "esp_err.h"
#include "usb/usb_host.h"

class ESP32UVCDirect {
public:
  struct Config {
    uint16_t preferredWidth = 160;
    uint16_t preferredHeight = 120;
    uint32_t frameInterval100ns = 666666; // 15 fps
    bool preferMjpeg = false;
    bool startStreaming = true;
    uint8_t streamTransferCount = 4;
    uint8_t isocPacketsPerTransfer = 4;
    uint16_t bulkPacketsPerTransfer = 16;
    uint32_t controlTimeoutMs = 2500;
  };

  struct Target {
    bool found = false;
    uint8_t controlInterface = 0xff;
    uint8_t streamInterface = 0xff;
    uint8_t endpointAlt = 0;
    uint8_t endpointAddress = 0;
    uint8_t endpointType = 0xff;
    uint8_t endpointInterval = 0;
    uint16_t endpointMps = 0;
    uint8_t formatIndex = 1;
    uint8_t frameIndex = 1;
    uint16_t width = 160;
    uint16_t height = 120;
    uint32_t frameInterval100ns = 0;
    uint32_t maxFrameBytes = 0;
    bool mjpeg = false;
  };

  using FrameCallback = void (*)(const uint8_t *data, size_t length, bool endOfFrame, void *user);

  ESP32UVCDirect();

  void setLogStream(Stream *stream);
  void setFrameCallback(FrameCallback callback, void *user = nullptr);
  bool begin();
  bool begin(const Config &config);
  void printStatus();

  const char *lastError() const { return _lastError; }
  const Target &target() const { return _target; }
  bool hostStarted() const { return _hostStarted; }
  bool deviceReady() const { return _deviceReady; }
  bool streaming() const { return _streaming; }

private:
  static constexpr uint32_t USB_HOST_TASK_STACK = 3072;
  static constexpr uint32_t USB_CLIENT_TASK_STACK = 6144;
  static constexpr uint8_t UVC_CLASS_VIDEO = 0x0e;
  static constexpr uint8_t UVC_SC_VIDEOCONTROL = 0x01;
  static constexpr uint8_t UVC_SC_VIDEOSTREAMING = 0x02;
  static constexpr uint8_t CS_INTERFACE = 0x24;
  static constexpr uint8_t VS_FORMAT_UNCOMPRESSED = 0x04;
  static constexpr uint8_t VS_FRAME_UNCOMPRESSED = 0x05;
  static constexpr uint8_t VS_FORMAT_MJPEG = 0x06;
  static constexpr uint8_t VS_FRAME_MJPEG = 0x07;
  static constexpr uint8_t UVC_SET_CUR = 0x01;
  static constexpr uint8_t UVC_GET_CUR = 0x81;
  static constexpr uint8_t UVC_VS_PROBE_CONTROL = 0x01;
  static constexpr uint8_t UVC_VS_COMMIT_CONTROL = 0x02;
  static constexpr size_t UVC_PROBE_LEN = 26;

  struct StreamTransfer {
    ESP32UVCDirect *self = nullptr;
    usb_transfer_t *transfer = nullptr;
    size_t packetBytes = 0;
  };

  static ESP32UVCDirect *_active;

  static void hostTaskThunk(void *arg);
  static void clientTaskThunk(void *arg);
  static void clientEventThunk(const usb_host_client_event_msg_t *event, void *arg);
  static void controlCallbackThunk(usb_transfer_t *transfer);
  static void streamCallbackThunk(usb_transfer_t *transfer);

  void hostTask();
  void clientTask();
  void onClientEvent(const usb_host_client_event_msg_t *event);
  void onControlComplete(usb_transfer_t *transfer);
  void onStreamComplete(StreamTransfer *streamTransfer);

  bool installHost();
  void openAndProbe(uint8_t address);
  void closeDevice();
  bool parseTarget(const usb_config_desc_t *config, Target &target);
  bool isBetterFrame(const Target &candidate, const Target &current) const;
  bool submitControl(
    usb_device_handle_t device,
    uint8_t requestType,
    uint8_t request,
    uint16_t value,
    uint16_t index,
    uint8_t *payload,
    size_t payloadLen,
    const char *label
  );
  bool negotiate(Target &target);
  bool startStream();
  void stopStream();
  bool submitStreamTransfer(StreamTransfer *streamTransfer);
  void handlePayload(const uint8_t *data, size_t length);
  void fillProbe(uint8_t *data, const Target &target, bool includeSizes) const;
  void logf(const char *format, ...);
  void setError(const char *message);

  static uint16_t rd16(const uint8_t *p);
  static uint32_t rd32(const uint8_t *p);
  static void wr16(uint8_t *p, uint16_t value);
  static void wr32(uint8_t *p, uint32_t value);

  Config _config;
  Stream *_log = &Serial;
  FrameCallback _frameCallback = nullptr;
  void *_frameUser = nullptr;
  const char *_lastError = "";

  usb_host_client_handle_t _client = nullptr;
  usb_device_handle_t _device = nullptr;
  QueueHandle_t _deviceQueue = nullptr;
  SemaphoreHandle_t _controlDone = nullptr;
  TaskHandle_t _hostTaskHandle = nullptr;
  TaskHandle_t _clientTaskHandle = nullptr;
  bool _hostStarted = false;
  bool _deviceReady = false;
  bool _claimedControl = false;
  bool _claimedAlt0 = false;
  bool _claimedStream = false;
  bool _streaming = false;
  Target _target;

  usb_transfer_status_t _lastControlStatus = USB_TRANSFER_STATUS_ERROR;
  int _lastControlActualBytes = 0;
  StreamTransfer *_streamTransfers = nullptr;
  uint8_t _streamTransferCount = 0;
  uint32_t _payloadCount = 0;
  uint32_t _frameCount = 0;
  uint32_t _frameBytes = 0;
  uint8_t _lastFid = 0xff;
};
