#include "ESP32UVCHost.h"

#include <ESP32USBHost4096.h>

#include "esp_err.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "usb/usb_host.h"

extern "C" {
#include "libuvc_adapter.h"
}

static const EventBits_t kDeviceConnected = BIT0;
static const EventBits_t kDeviceDisconnected = BIT1;

bool ESP32UVCHost::_hostReady = false;
EventGroupHandle_t ESP32UVCHost::_events = nullptr;
SemaphoreHandle_t ESP32UVCHost::_readyToUninstall = nullptr;
const char *ESP32UVCHost::_lastError = "";

void ESP32UVCHost::setLastError(const char *message) {
  _lastError = message ? message : "";
}

void ESP32UVCHost::usbEventTask(void *arg) {
  (void)arg;
  while (true) {
    uint32_t eventFlags = 0;
    usb_host_lib_handle_events(portMAX_DELAY, &eventFlags);

    if (eventFlags & USB_HOST_LIB_EVENT_FLAGS_NO_CLIENTS) {
      usb_host_device_free_all();
    }
    if ((eventFlags & USB_HOST_LIB_EVENT_FLAGS_ALL_FREE) && _readyToUninstall) {
      xSemaphoreGive(_readyToUninstall);
    }
  }
}

void ESP32UVCHost::adapterEvent(libuvc_adapter_event_t event) {
  if (!_events) {
    return;
  }
  if (event == UVC_DEVICE_CONNECTED) {
    xEventGroupSetBits(_events, kDeviceConnected);
  } else if (event == UVC_DEVICE_DISCONNECTED) {
    xEventGroupSetBits(_events, kDeviceDisconnected);
  }
}

bool ESP32UVCHost::ensureHost() {
  if (_hostReady) {
    return true;
  }

  if (!_events) {
    _events = xEventGroupCreate();
  }
  if (!_events) {
    setLastError("could not create UVC event group");
    return false;
  }

  usb_host_config_t hostConfig = {};
  hostConfig.intr_flags = ESP_INTR_FLAG_LEVEL1;
  hostConfig.fifo_settings_custom.rx_fifo_lines = 96;
  hostConfig.fifo_settings_custom.nptx_fifo_lines = 64;
  hostConfig.fifo_settings_custom.ptx_fifo_lines = 32;
  ESP_LOGI("ESP32UVCHost", "USB host FIFO rx=%u nptx=%u ptx=%u",
           (unsigned)hostConfig.fifo_settings_custom.rx_fifo_lines,
           (unsigned)hostConfig.fifo_settings_custom.nptx_fifo_lines,
           (unsigned)hostConfig.fifo_settings_custom.ptx_fifo_lines);
  esp_err_t err = usb_host_install(&hostConfig);
  if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
    setLastError(esp_err_to_name(err));
    return false;
  }

  if (!_readyToUninstall) {
    _readyToUninstall = xSemaphoreCreateBinary();
  }
  if (!_readyToUninstall) {
    setLastError("could not create USB host semaphore");
    return false;
  }

  TaskHandle_t task = nullptr;
  if (xTaskCreate(usbEventTask, "usb_events", 4096, nullptr, 2, &task) != pdPASS) {
    setLastError("could not create USB host task");
    return false;
  }

  libuvc_adapter_config_t adapterConfig = {};
  adapterConfig.create_background_task = true;
  adapterConfig.task_priority = 5;
  adapterConfig.stack_size = 4096;
  adapterConfig.callback = adapterEvent;
  libuvc_adapter_set_config(&adapterConfig);

  _hostReady = true;
  return true;
}

bool ESP32UVCHost::waitForDevice(uint32_t timeoutMs) {
  if (!_events) {
    return false;
  }

  EventBits_t bits = xEventGroupWaitBits(
      _events, kDeviceConnected, pdTRUE, pdFALSE, pdMS_TO_TICKS(timeoutMs));
  return (bits & kDeviceConnected) != 0;
}

bool ESP32UVCHost::begin() {
  Serial.println("ESP32UVCHost.begin: ensureHost");
  if (!ensureHost()) {
    return false;
  }
  Serial.println("ESP32UVCHost.begin: ensureHost ok");

  if (_ctx) {
    return true;
  }

  Serial.println("ESP32UVCHost.begin: uvc_init");
  uvc_error_t err = uvc_init(&_ctx, nullptr);
  if (err != UVC_SUCCESS) {
    setLastError(uvc_strerror(err));
    _ctx = nullptr;
    return false;
  }

  Serial.println("ESP32UVCHost.begin: uvc_init ok");
  return true;
}

bool ESP32UVCHost::open(uint16_t width,
                        uint16_t height,
                        uint8_t fps,
                        uvc_frame_format format,
                        uint16_t vid,
                        uint16_t pid,
                        const char *serial) {
  if (!begin()) {
    return false;
  }

  close();

  Serial.println("Waiting for UVC camera...");
  uvc_error_t err = UVC_ERROR_NOT_FOUND;
  uint32_t deadline = millis() + 60000;
  uint32_t lastDiagMs = 0;
  while (static_cast<int32_t>(millis() - deadline) < 0) {
    waitForDevice(250);
    err = uvc_find_device(_ctx, &_dev, vid, pid, serial);
    if (err == UVC_SUCCESS) {
      break;
    }
    _dev = nullptr;
    if (millis() - lastDiagMs >= 1000) {
      uint8_t addresses[8] = {};
      int actualCount = 0;
      usb_host_device_addr_list_fill(8, addresses, &actualCount);
      Serial.printf("USB host devices=%d\n", actualCount);
      lastDiagMs = millis();
    }
    delay(250);
  }
  if (err != UVC_SUCCESS) {
    setLastError("UVC camera not connected");
    return false;
  }

  err = uvc_open(_dev, &_devh);
  if (err != UVC_SUCCESS) {
    setLastError(uvc_strerror(err));
    _devh = nullptr;
    return false;
  }

  uvc_print_diag(_devh, stderr);

  for (int attempt = 1; attempt <= 5; attempt++) {
    err = uvc_get_stream_ctrl_format_size(_devh, &_ctrl, format, width, height, fps);
    if (err == UVC_SUCCESS) {
      break;
    }
    Serial.printf("UVC stream negotiation failed attempt %d/5: %s\n", attempt, uvc_strerror(err));
    delay(1000);
  }
  if (err != UVC_SUCCESS) {
    setLastError(uvc_strerror(err));
    close();
    return false;
  }

  return true;
}

bool ESP32UVCHost::start(FrameCallback callback, void *user) {
  if (!_devh) {
    setLastError("UVC camera is not open");
    return false;
  }

  uvc_error_t err = uvc_start_streaming(_devh, &_ctrl, callback, user, 0);
  if (err != UVC_SUCCESS) {
    setLastError(uvc_strerror(err));
    return false;
  }

  _streaming = true;
  return true;
}

void ESP32UVCHost::stop() {
  if (_streaming && _devh) {
    uvc_stop_streaming(_devh);
  }
  _streaming = false;
}

void ESP32UVCHost::close() {
  stop();
  if (_devh) {
    uvc_close(_devh);
    _devh = nullptr;
  }
  _dev = nullptr;
}
