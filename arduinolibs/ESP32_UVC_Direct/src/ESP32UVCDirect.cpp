#include "ESP32UVCDirect.h"

#include <stdarg.h>

ESP32UVCDirect *ESP32UVCDirect::_active = nullptr;

ESP32UVCDirect::ESP32UVCDirect() {}

void ESP32UVCDirect::setLogStream(Stream *stream) {
  _log = stream ? stream : &Serial;
}

void ESP32UVCDirect::setFrameCallback(FrameCallback callback, void *user) {
  _frameCallback = callback;
  _frameUser = user;
}

bool ESP32UVCDirect::begin(const Config &config) {
  _config = config;
  _active = this;

#if defined(CONFIG_USB_HOST_CONTROL_TRANSFER_MAX_SIZE)
  if (CONFIG_USB_HOST_CONTROL_TRANSFER_MAX_SIZE < 1024) {
    logf("warning: CONFIG_USB_HOST_CONTROL_TRANSFER_MAX_SIZE=%u, many UVC cameras need >256\r\n",
         unsigned(CONFIG_USB_HOST_CONTROL_TRANSFER_MAX_SIZE));
  }
#endif

  if (!_deviceQueue) {
    _deviceQueue = xQueueCreate(4, sizeof(uint8_t));
  }
  if (!_controlDone) {
    _controlDone = xSemaphoreCreateBinary();
  }
  if (!_deviceQueue || !_controlDone) {
    setError("queue/semaphore allocation failed");
    logf("%s\r\n", _lastError);
    return false;
  }
  return installHost();
}

bool ESP32UVCDirect::begin() {
  Config config;
  return begin(config);
}

void ESP32UVCDirect::printStatus() {
  uint8_t addresses[8] = {};
  int count = 0;
  usb_host_device_addr_list_fill(8, addresses, &count);
  logf("uvc status devices=%d ready=%u streaming=%u payloads=%lu frames=%lu frameBytes=%lu\r\n",
       count,
       _deviceReady ? 1 : 0,
       _streaming ? 1 : 0,
       (unsigned long)_payloadCount,
       (unsigned long)_frameCount,
       (unsigned long)_frameBytes);
}

bool ESP32UVCDirect::installHost() {
  if (_hostStarted) {
    return true;
  }

  const usb_host_config_t hostConfig = {
    .skip_phy_setup = false,
    .root_port_unpowered = false,
    .intr_flags = ESP_INTR_FLAG_LEVEL1,
    .enum_filter_cb = nullptr,
    .fifo_settings_custom = {
      .nptx_fifo_lines = 16,
      .ptx_fifo_lines = 16,
      .rx_fifo_lines = 96,
    },
    .peripheral_map = 0,
  };

  esp_err_t err = usb_host_install(&hostConfig);
  if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
    setError(esp_err_to_name(err));
    logf("USB host install failed: %s\r\n", _lastError);
    return false;
  }

  _hostStarted = true;
  if (!_hostTaskHandle) {
    xTaskCreatePinnedToCore(hostTaskThunk, "uvc_usb_host", USB_HOST_TASK_STACK, this, 4, &_hostTaskHandle, 1);
  }
  if (!_clientTaskHandle) {
    xTaskCreatePinnedToCore(clientTaskThunk, "uvc_client", USB_CLIENT_TASK_STACK, this, 5, &_clientTaskHandle, 1);
  }
  logf("UVC direct USB host installed fifo rx=96 nptx=16 ptx=16\r\n");
  return true;
}

void ESP32UVCDirect::hostTaskThunk(void *arg) {
  static_cast<ESP32UVCDirect *>(arg)->hostTask();
}

void ESP32UVCDirect::clientTaskThunk(void *arg) {
  static_cast<ESP32UVCDirect *>(arg)->clientTask();
}

void ESP32UVCDirect::clientEventThunk(const usb_host_client_event_msg_t *event, void *arg) {
  static_cast<ESP32UVCDirect *>(arg)->onClientEvent(event);
}

void ESP32UVCDirect::controlCallbackThunk(usb_transfer_t *transfer) {
  if (_active) {
    _active->onControlComplete(transfer);
  }
}

void ESP32UVCDirect::streamCallbackThunk(usb_transfer_t *transfer) {
  auto *streamTransfer = static_cast<StreamTransfer *>(transfer->context);
  if (streamTransfer && streamTransfer->self) {
    streamTransfer->self->onStreamComplete(streamTransfer);
  }
}

void ESP32UVCDirect::hostTask() {
  for (;;) {
    uint32_t eventFlags = 0;
    usb_host_lib_handle_events(portMAX_DELAY, &eventFlags);
    if (eventFlags & USB_HOST_LIB_EVENT_FLAGS_NO_CLIENTS) {
      usb_host_device_free_all();
    }
  }
}

void ESP32UVCDirect::clientTask() {
  const usb_host_client_config_t clientConfig = {
    .is_synchronous = false,
    .max_num_event_msg = 8,
    .async = {
      .client_event_callback = clientEventThunk,
      .callback_arg = this,
    },
  };

  esp_err_t err = usb_host_client_register(&clientConfig, &_client);
  if (err != ESP_OK) {
    setError(esp_err_to_name(err));
    logf("UVC client register failed: %s\r\n", _lastError);
    vTaskDelete(nullptr);
    return;
  }

  logf("UVC direct client ready\r\n");
  for (;;) {
    usb_host_client_handle_events(_client, pdMS_TO_TICKS(50));
    uint8_t address = 0;
    if (xQueueReceive(_deviceQueue, &address, 0) == pdTRUE) {
      openAndProbe(address);
    }
  }
}

void ESP32UVCDirect::onClientEvent(const usb_host_client_event_msg_t *event) {
  if (event->event == USB_HOST_CLIENT_EVENT_NEW_DEV) {
    const uint8_t address = event->new_dev.address;
    logf("UVC USB device connected addr=%u\r\n", address);
    xQueueSend(_deviceQueue, &address, 0);
  } else if (event->event == USB_HOST_CLIENT_EVENT_DEV_GONE) {
    logf("UVC USB device gone\r\n");
    closeDevice();
  }
}

void ESP32UVCDirect::onControlComplete(usb_transfer_t *transfer) {
  _lastControlStatus = transfer->status;
  _lastControlActualBytes = transfer->actual_num_bytes;
  if (_controlDone) {
    xSemaphoreGive(_controlDone);
  }
}

void ESP32UVCDirect::openAndProbe(uint8_t address) {
  closeDevice();

  esp_err_t err = usb_host_device_open(_client, address, &_device);
  if (err != ESP_OK) {
    setError(esp_err_to_name(err));
    logf("UVC open addr=%u failed: %s\r\n", address, _lastError);
    return;
  }

  const usb_device_desc_t *deviceDesc = nullptr;
  if (usb_host_get_device_descriptor(_device, &deviceDesc) == ESP_OK && deviceDesc) {
    logf("UVC device vid=0x%04x pid=0x%04x class=0x%02x mps0=%u\r\n",
         deviceDesc->idVendor,
         deviceDesc->idProduct,
         deviceDesc->bDeviceClass,
         deviceDesc->bMaxPacketSize0);
  }

  const usb_config_desc_t *config = nullptr;
  err = usb_host_get_active_config_descriptor(_device, &config);
  if (err != ESP_OK || !config) {
    setError(esp_err_to_name(err));
    logf("UVC config descriptor failed: %s\r\n", _lastError);
    closeDevice();
    return;
  }

  Target target;
  if (!parseTarget(config, target)) {
    setError("no usable UVC streaming target");
    logf("%s\r\n", _lastError);
    closeDevice();
    return;
  }
  _target = target;

  logf("UVC target ctrl=%u stream=%u alt=%u format=%u frame=%u %ux%u mjpeg=%u ep=0x%02x type=%u mps=%u\r\n",
       _target.controlInterface,
       _target.streamInterface,
       _target.endpointAlt,
       _target.formatIndex,
       _target.frameIndex,
       _target.width,
       _target.height,
       _target.mjpeg ? 1 : 0,
       _target.endpointAddress,
       _target.endpointType,
       _target.endpointMps);
  logf("UVC target interval=%lu maxFrame=%lu\r\n",
       (unsigned long)_target.frameInterval100ns,
       (unsigned long)_target.maxFrameBytes);

  if (!negotiate(_target)) {
    closeDevice();
    return;
  }

  _deviceReady = true;
  if (_config.startStreaming) {
    startStream();
  }
}

void ESP32UVCDirect::closeDevice() {
  stopStream();
  if (_device && _claimedStream && _client && _target.streamInterface != 0xff) {
    usb_host_interface_release(_client, _device, _target.streamInterface);
  }
  _claimedStream = false;
  _claimedAlt0 = false;
  if (_device && _claimedControl && _client && _target.controlInterface != 0xff) {
    usb_host_interface_release(_client, _device, _target.controlInterface);
  }
  _claimedControl = false;
  if (_device && _client) {
    usb_host_device_close(_client, _device);
  }
  _device = nullptr;
  _deviceReady = false;
  _target = Target();
}

bool ESP32UVCDirect::parseTarget(const usb_config_desc_t *config, Target &target) {
  constexpr uint16_t maxSupportedIsocMps = (96 - 2) * 4;
  const uint8_t *bytes = reinterpret_cast<const uint8_t *>(config);
  const uint8_t *end = bytes + config->wTotalLength;
  const usb_intf_desc_t *currentInterface = nullptr;
  uint8_t lastFormatIndex = 0;
  bool lastFormatMjpeg = false;

  logf("UVC config total=%u interfaces=%u\r\n", config->wTotalLength, config->bNumInterfaces);

  for (const uint8_t *ptr = bytes; ptr + USB_STANDARD_DESC_SIZE <= end;) {
    const auto *standard = reinterpret_cast<const usb_standard_desc_t *>(ptr);
    if (standard->bLength < USB_STANDARD_DESC_SIZE || ptr + standard->bLength > end) {
      logf("UVC descriptor parse stopped: invalid length\r\n");
      break;
    }

    if (standard->bDescriptorType == USB_B_DESCRIPTOR_TYPE_INTERFACE && standard->bLength >= USB_INTF_DESC_SIZE) {
      currentInterface = reinterpret_cast<const usb_intf_desc_t *>(ptr);
      logf("UVC interface %u alt=%u class=0x%02x subclass=0x%02x endpoints=%u\r\n",
           currentInterface->bInterfaceNumber,
           currentInterface->bAlternateSetting,
           currentInterface->bInterfaceClass,
           currentInterface->bInterfaceSubClass,
           currentInterface->bNumEndpoints);

      if (currentInterface->bInterfaceClass == UVC_CLASS_VIDEO &&
          currentInterface->bInterfaceSubClass == UVC_SC_VIDEOCONTROL) {
        target.controlInterface = currentInterface->bInterfaceNumber;
      } else if (currentInterface->bInterfaceClass == UVC_CLASS_VIDEO &&
                 currentInterface->bInterfaceSubClass == UVC_SC_VIDEOSTREAMING &&
                 target.streamInterface == 0xff) {
        target.streamInterface = currentInterface->bInterfaceNumber;
      }
    } else if (standard->bDescriptorType == USB_B_DESCRIPTOR_TYPE_ENDPOINT &&
               standard->bLength >= USB_EP_DESC_SIZE &&
               currentInterface) {
      const auto *endpoint = reinterpret_cast<const usb_ep_desc_t *>(ptr);
      const uint8_t type = USB_EP_DESC_GET_XFERTYPE(endpoint);
      const uint16_t mps = USB_EP_DESC_GET_MPS(endpoint);
      logf("  UVC endpoint 0x%02x type=%u mps=%u interval=%u\r\n",
           endpoint->bEndpointAddress,
           type,
           mps,
           endpoint->bInterval);

      if (currentInterface->bInterfaceClass == UVC_CLASS_VIDEO &&
          currentInterface->bInterfaceSubClass == UVC_SC_VIDEOSTREAMING &&
          (endpoint->bEndpointAddress & 0x80)) {
        const bool endpointUnset = target.endpointAddress == 0;
        const bool preferBulk = target.endpointType != USB_TRANSFER_TYPE_BULK && type == USB_TRANSFER_TYPE_BULK;
        const bool supportedIsoc = type != USB_TRANSFER_TYPE_ISOCHRONOUS || mps <= maxSupportedIsocMps;
        const bool largerIsoc = target.endpointType == USB_TRANSFER_TYPE_ISOCHRONOUS &&
                                type == USB_TRANSFER_TYPE_ISOCHRONOUS &&
                                mps > target.endpointMps &&
                                supportedIsoc;
        if ((endpointUnset && supportedIsoc) || preferBulk || largerIsoc) {
          target.endpointAddress = endpoint->bEndpointAddress;
          target.endpointType = type;
          target.endpointMps = mps;
          target.endpointInterval = endpoint->bInterval;
          target.endpointAlt = currentInterface->bAlternateSetting;
        }
      }
    } else if (standard->bDescriptorType == CS_INTERFACE && standard->bLength >= 4 && currentInterface) {
      const uint8_t subtype = ptr[2];
      if (currentInterface->bInterfaceClass == UVC_CLASS_VIDEO &&
          currentInterface->bInterfaceSubClass == UVC_SC_VIDEOSTREAMING) {
        if ((subtype == VS_FORMAT_UNCOMPRESSED || subtype == VS_FORMAT_MJPEG) && standard->bLength >= 5) {
          lastFormatIndex = ptr[3];
          lastFormatMjpeg = subtype == VS_FORMAT_MJPEG;
          logf("  UVC format subtype=0x%02x index=%u\r\n", subtype, lastFormatIndex);
        } else if ((subtype == VS_FRAME_UNCOMPRESSED || subtype == VS_FRAME_MJPEG) && standard->bLength >= 26) {
          Target candidate = target;
          candidate.found = true;
          candidate.formatIndex = lastFormatIndex;
          candidate.frameIndex = ptr[3];
          candidate.width = rd16(ptr + 5);
          candidate.height = rd16(ptr + 7);
          candidate.mjpeg = lastFormatMjpeg || subtype == VS_FRAME_MJPEG;
          candidate.maxFrameBytes = rd32(ptr + 17);
          candidate.frameInterval100ns = rd32(ptr + 21);
          const uint8_t intervalType = ptr[25];
          if (intervalType > 0 && standard->bLength >= 26 + intervalType * 4) {
            uint32_t bestInterval = rd32(ptr + 26);
            uint32_t bestDelta = UINT32_MAX;
            for (uint8_t i = 0; i < intervalType; i++) {
              const uint32_t interval = rd32(ptr + 26 + i * 4);
              const uint32_t delta = interval > _config.frameInterval100ns
                ? interval - _config.frameInterval100ns
                : _config.frameInterval100ns - interval;
              if (delta < bestDelta) {
                bestDelta = delta;
                bestInterval = interval;
              }
            }
            candidate.frameInterval100ns = bestInterval;
          }
          logf("  UVC frame subtype=0x%02x index=%u %ux%u max=%lu interval=%lu type=%u\r\n",
               subtype,
               candidate.frameIndex,
               candidate.width,
               candidate.height,
               (unsigned long)candidate.maxFrameBytes,
               (unsigned long)candidate.frameInterval100ns,
               intervalType);
          if (lastFormatIndex != 0 && isBetterFrame(candidate, target)) {
            target.found = true;
            target.formatIndex = candidate.formatIndex;
            target.frameIndex = candidate.frameIndex;
            target.width = candidate.width;
            target.height = candidate.height;
            target.frameInterval100ns = candidate.frameInterval100ns;
            target.maxFrameBytes = candidate.maxFrameBytes;
            target.mjpeg = candidate.mjpeg;
          }
        }
      }
    }

    ptr += standard->bLength;
  }

  return target.controlInterface != 0xff &&
         target.streamInterface != 0xff &&
         target.endpointAddress != 0 &&
         target.found;
}

bool ESP32UVCDirect::isBetterFrame(const Target &candidate, const Target &current) const {
  if (!current.found) {
    return true;
  }
  if (candidate.width == _config.preferredWidth && candidate.height == _config.preferredHeight &&
      (current.width != _config.preferredWidth || current.height != _config.preferredHeight)) {
    return true;
  }
  if (candidate.mjpeg == _config.preferMjpeg && current.mjpeg != _config.preferMjpeg) {
    return true;
  }
  const uint32_t candidateDelta = abs(int(candidate.width) - int(_config.preferredWidth)) +
                                  abs(int(candidate.height) - int(_config.preferredHeight));
  const uint32_t currentDelta = abs(int(current.width) - int(_config.preferredWidth)) +
                                abs(int(current.height) - int(_config.preferredHeight));
  return candidateDelta < currentDelta;
}

bool ESP32UVCDirect::negotiate(Target &target) {
  esp_err_t err = usb_host_interface_claim(_client, _device, target.controlInterface, 0);
  if (err != ESP_OK) {
    setError(esp_err_to_name(err));
    logf("UVC claim control interface %u failed: %s\r\n", target.controlInterface, _lastError);
    return false;
  }
  _claimedControl = true;
  logf("UVC claimed control interface %u\r\n", target.controlInterface);

  err = usb_host_interface_claim(_client, _device, target.streamInterface, 0);
  if (err != ESP_OK) {
    setError(esp_err_to_name(err));
    logf("UVC claim stream interface %u alt 0 failed: %s\r\n", target.streamInterface, _lastError);
    return false;
  }
  _claimedStream = true;
  _claimedAlt0 = true;
  logf("UVC claimed stream interface %u alt 0\r\n", target.streamInterface);

  uint8_t probe[UVC_PROBE_LEN] = {};
  const uint16_t index = target.streamInterface;

  memset(probe, 0, sizeof(probe));
  if (!submitControl(_device, 0xa1, UVC_GET_CUR, uint16_t(UVC_VS_PROBE_CONTROL) << 8, index, probe, UVC_PROBE_LEN, "GET_CUR PROBE")) {
    return false;
  }
  logf("UVC probe:");
  for (size_t i = 0; i < UVC_PROBE_LEN; i++) {
    logf(" %02x", probe[i]);
  }
  logf("\r\n");

  return true;
}

bool ESP32UVCDirect::startStream() {
  if (!_device || _streaming || !_target.endpointAddress || !_target.endpointMps) {
    return false;
  }

  if (_claimedStream && _claimedAlt0 && _target.endpointAlt != 0) {
    usb_host_interface_release(_client, _device, _target.streamInterface);
    _claimedAlt0 = false;
    _claimedStream = false;
  }

  if (!_claimedStream) {
    esp_err_t err = usb_host_interface_claim(_client, _device, _target.streamInterface, _target.endpointAlt);
    if (err != ESP_OK) {
      setError(esp_err_to_name(err));
      logf("UVC claim stream interface %u alt %u failed: %s\r\n", _target.streamInterface, _target.endpointAlt, _lastError);
      return false;
    }
    _claimedStream = true;
    _claimedAlt0 = _target.endpointAlt == 0;
    logf("UVC claimed stream interface %u alt %u\r\n", _target.streamInterface, _target.endpointAlt);
  }

  _streamTransferCount = max<uint8_t>(1, _config.streamTransferCount);
  _streamTransfers = static_cast<StreamTransfer *>(calloc(_streamTransferCount, sizeof(StreamTransfer)));
  if (!_streamTransfers) {
    setError("stream transfer allocation failed");
    logf("%s\r\n", _lastError);
    return false;
  }

  _streaming = true;
  _payloadCount = 0;
  _frameCount = 0;
  _frameBytes = 0;
  _lastFid = 0xff;

  for (uint8_t i = 0; i < _streamTransferCount; i++) {
    StreamTransfer &streamTransfer = _streamTransfers[i];
    streamTransfer.self = this;
    const bool isIsoc = _target.endpointType == USB_TRANSFER_TYPE_ISOCHRONOUS;
    const int isocPackets = isIsoc ? max<uint8_t>(1, _config.isocPacketsPerTransfer) : 0;
    const size_t packetBytes = max<uint16_t>(1, _target.endpointMps);
    const size_t transferBytes = isIsoc ? packetBytes * isocPackets : packetBytes * max<uint16_t>(1, _config.bulkPacketsPerTransfer);
    streamTransfer.packetBytes = packetBytes;
    esp_err_t err = usb_host_transfer_alloc(transferBytes, isocPackets, &streamTransfer.transfer);
    if (err != ESP_OK || !streamTransfer.transfer) {
      setError(esp_err_to_name(err));
      logf("UVC stream transfer alloc failed: %s\r\n", _lastError);
      stopStream();
      return false;
    }
    streamTransfer.transfer->device_handle = _device;
    streamTransfer.transfer->bEndpointAddress = _target.endpointAddress;
    streamTransfer.transfer->callback = streamCallbackThunk;
    streamTransfer.transfer->context = &streamTransfer;
    streamTransfer.transfer->timeout_ms = 1000;
    if (!submitStreamTransfer(&streamTransfer)) {
      stopStream();
      return false;
    }
  }

  logf("UVC streaming started ep=0x%02x type=%u transfers=%u\r\n",
       _target.endpointAddress,
       _target.endpointType,
       _streamTransferCount);
  return true;
}

void ESP32UVCDirect::stopStream() {
  _streaming = false;
  if (_streamTransfers) {
    for (uint8_t i = 0; i < _streamTransferCount; i++) {
      if (_streamTransfers[i].transfer) {
        usb_host_transfer_free(_streamTransfers[i].transfer);
      }
    }
    free(_streamTransfers);
  }
  _streamTransfers = nullptr;
  _streamTransferCount = 0;
}

bool ESP32UVCDirect::submitStreamTransfer(StreamTransfer *streamTransfer) {
  if (!streamTransfer || !streamTransfer->transfer) {
    return false;
  }
  usb_transfer_t *transfer = streamTransfer->transfer;
  const bool isIsoc = _target.endpointType == USB_TRANSFER_TYPE_ISOCHRONOUS;
  transfer->actual_num_bytes = 0;
  transfer->flags = 0;
  if (isIsoc) {
    transfer->num_bytes = streamTransfer->packetBytes * transfer->num_isoc_packets;
    for (int i = 0; i < transfer->num_isoc_packets; i++) {
      transfer->isoc_packet_desc[i].num_bytes = streamTransfer->packetBytes;
      transfer->isoc_packet_desc[i].actual_num_bytes = 0;
      transfer->isoc_packet_desc[i].status = USB_TRANSFER_STATUS_ERROR;
    }
  } else {
    transfer->num_bytes = transfer->data_buffer_size;
  }
  esp_err_t err = usb_host_transfer_submit(transfer);
  if (err != ESP_OK) {
    setError(esp_err_to_name(err));
    logf("UVC stream submit failed: %s\r\n", _lastError);
    return false;
  }
  return true;
}

void ESP32UVCDirect::onStreamComplete(StreamTransfer *streamTransfer) {
  if (!streamTransfer || !streamTransfer->transfer) {
    return;
  }
  usb_transfer_t *transfer = streamTransfer->transfer;
  if (transfer->status == USB_TRANSFER_STATUS_COMPLETED) {
    if (_target.endpointType == USB_TRANSFER_TYPE_ISOCHRONOUS) {
      size_t offset = 0;
      for (int i = 0; i < transfer->num_isoc_packets; i++) {
        const auto &packet = transfer->isoc_packet_desc[i];
        if (packet.status == USB_TRANSFER_STATUS_COMPLETED && packet.actual_num_bytes > 0) {
          handlePayload(transfer->data_buffer + offset, packet.actual_num_bytes);
        }
        offset += streamTransfer->packetBytes;
      }
    } else if (transfer->actual_num_bytes > 0) {
      handlePayload(transfer->data_buffer, transfer->actual_num_bytes);
    }
  } else if (transfer->status != USB_TRANSFER_STATUS_CANCELED && transfer->status != USB_TRANSFER_STATUS_NO_DEVICE) {
    logf("UVC stream transfer status=%d actual=%d\r\n", int(transfer->status), transfer->actual_num_bytes);
  }

  if (_streaming) {
    submitStreamTransfer(streamTransfer);
  }
}

void ESP32UVCDirect::handlePayload(const uint8_t *data, size_t length) {
  if (!data || length < 2) {
    return;
  }
  const uint8_t headerLength = data[0];
  const uint8_t flags = data[1];
  if (headerLength < 2 || headerLength > length) {
    return;
  }
  const uint8_t fid = flags & 0x01;
  const bool eof = flags & 0x02;
  const size_t payloadLength = length - headerLength;
  if (_lastFid != 0xff && fid != _lastFid && _frameBytes > 0) {
    _frameCount++;
    logf("UVC frame #%lu bytes=%lu fid-toggle\r\n", (unsigned long)_frameCount, (unsigned long)_frameBytes);
    _frameBytes = 0;
  }
  _lastFid = fid;
  _payloadCount++;
  _frameBytes += payloadLength;
  if (_frameCallback && payloadLength > 0) {
    _frameCallback(data + headerLength, payloadLength, eof, _frameUser);
  }
  if (eof) {
    _frameCount++;
    logf("UVC frame #%lu bytes=%lu eof payloads=%lu\r\n",
         (unsigned long)_frameCount,
         (unsigned long)_frameBytes,
         (unsigned long)_payloadCount);
    _frameBytes = 0;
  } else if (_payloadCount <= 10 || (_payloadCount % 100) == 0) {
    logf("UVC payload #%lu len=%u data=%u flags=0x%02x\r\n",
         (unsigned long)_payloadCount,
         unsigned(length),
         unsigned(payloadLength),
         flags);
  }
}

bool ESP32UVCDirect::submitControl(
  usb_device_handle_t device,
  uint8_t requestType,
  uint8_t request,
  uint16_t value,
  uint16_t index,
  uint8_t *payload,
  size_t payloadLen,
  const char *label
) {
  usb_transfer_t *transfer = nullptr;
  esp_err_t err = usb_host_transfer_alloc(USB_SETUP_PACKET_SIZE + payloadLen, 0, &transfer);
  if (err != ESP_OK) {
    setError(esp_err_to_name(err));
    logf("%s alloc failed: %s\r\n", label, _lastError);
    return false;
  }

  transfer->device_handle = device;
  transfer->bEndpointAddress = 0;
  transfer->callback = controlCallbackThunk;
  transfer->context = this;
  transfer->num_bytes = USB_SETUP_PACKET_SIZE + payloadLen;
  transfer->actual_num_bytes = 0;
  transfer->timeout_ms = _config.controlTimeoutMs;
  transfer->flags = 0;

  auto *setup = reinterpret_cast<usb_setup_packet_t *>(transfer->data_buffer);
  setup->bmRequestType = requestType;
  setup->bRequest = request;
  setup->wValue = value;
  setup->wIndex = index;
  setup->wLength = payloadLen;
  if (payloadLen > 0 && payload) {
    memcpy(transfer->data_buffer + USB_SETUP_PACKET_SIZE, payload, payloadLen);
  }

  _lastControlStatus = USB_TRANSFER_STATUS_ERROR;
  _lastControlActualBytes = 0;
  xSemaphoreTake(_controlDone, 0);

  err = usb_host_transfer_submit_control(_client, transfer);
  if (err != ESP_OK) {
    setError(esp_err_to_name(err));
    logf("%s submit failed: %s\r\n", label, _lastError);
    usb_host_transfer_free(transfer);
    return false;
  }

  const uint32_t started = millis();
  while (xSemaphoreTake(_controlDone, pdMS_TO_TICKS(20)) != pdTRUE) {
    usb_host_client_handle_events(_client, 0);
    if (millis() - started > _config.controlTimeoutMs) {
      setError("control transfer timed out");
      logf("%s timed out\r\n", label);
      usb_host_transfer_free(transfer);
      return false;
    }
  }

  if ((requestType & 0x80) && payloadLen > 0 && payload) {
    memcpy(payload, transfer->data_buffer + USB_SETUP_PACKET_SIZE, payloadLen);
  }

  logf("%s done status=%d actual=%d bytes\r\n", label, int(_lastControlStatus), _lastControlActualBytes);
  const bool ok = _lastControlStatus == USB_TRANSFER_STATUS_COMPLETED;
  if (!ok) {
    setError("control transfer failed");
  }
  usb_host_transfer_free(transfer);
  return ok;
}

void ESP32UVCDirect::fillProbe(uint8_t *data, const Target &target, bool includeSizes) const {
  memset(data, 0, UVC_PROBE_LEN);
  wr16(data + 0, 0);
  data[2] = target.formatIndex;
  data[3] = target.frameIndex;
  wr32(data + 4, target.frameInterval100ns ? target.frameInterval100ns : _config.frameInterval100ns);
  wr16(data + 8, 0);
  wr16(data + 10, 0);
  wr16(data + 12, 0);
  wr16(data + 14, 0);
  wr16(data + 16, 0);
  if (includeSizes) {
    uint32_t frameBytes = target.maxFrameBytes;
    if (frameBytes == 0) {
      frameBytes = uint32_t(target.width) * uint32_t(target.height) * (target.mjpeg ? 1 : 2);
    }
    wr32(data + 18, frameBytes);
    wr32(data + 22, target.endpointMps ? target.endpointMps : 512);
  }
}

uint16_t ESP32UVCDirect::rd16(const uint8_t *p) {
  return uint16_t(p[0]) | (uint16_t(p[1]) << 8);
}

uint32_t ESP32UVCDirect::rd32(const uint8_t *p) {
  return uint32_t(p[0]) |
         (uint32_t(p[1]) << 8) |
         (uint32_t(p[2]) << 16) |
         (uint32_t(p[3]) << 24);
}

void ESP32UVCDirect::wr16(uint8_t *p, uint16_t value) {
  p[0] = uint8_t(value & 0xff);
  p[1] = uint8_t((value >> 8) & 0xff);
}

void ESP32UVCDirect::wr32(uint8_t *p, uint32_t value) {
  p[0] = uint8_t(value & 0xff);
  p[1] = uint8_t((value >> 8) & 0xff);
  p[2] = uint8_t((value >> 16) & 0xff);
  p[3] = uint8_t((value >> 24) & 0xff);
}

void ESP32UVCDirect::logf(const char *format, ...) {
  if (!_log || !format) {
    return;
  }
  char buffer[256];
  va_list args;
  va_start(args, format);
  vsnprintf(buffer, sizeof(buffer), format, args);
  va_end(args);
  _log->print(buffer);
}

void ESP32UVCDirect::setError(const char *message) {
  _lastError = message ? message : "";
}
