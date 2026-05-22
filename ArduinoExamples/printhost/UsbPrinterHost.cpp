#include "UsbPrinterHost.h"

#include "esp_err.h"
#include "usb/usb_host.h"

static constexpr size_t USB_PRINTER_TRANSFER_SIZE = 4096;
static constexpr TickType_t USB_PRINTER_WRITE_TIMEOUT = pdMS_TO_TICKS(3000);
static constexpr TickType_t USB_PRINTER_QUEUE_TIMEOUT = pdMS_TO_TICKS(5000);
static constexpr TickType_t USB_PRINTER_DRAIN_TIMEOUT = pdMS_TO_TICKS(30000);
static constexpr size_t USB_PRINTER_QUEUE_DEPTH = 96;

static TaskHandle_t usbHostTaskHandle = NULL;
static TaskHandle_t usbPrinterTaskHandle = NULL;
static TaskHandle_t usbPrinterWriterTaskHandle = NULL;
static SemaphoreHandle_t usbPrinterMutex = NULL;
static SemaphoreHandle_t usbTransferDone = NULL;
static QueueHandle_t usbPrintQueue = NULL;

static usb_host_client_handle_t usbClient = NULL;
static usb_device_handle_t printerDevice = NULL;
static usb_transfer_t *printerTransfer = NULL;
static bool usbHostStarted = false;
static bool printerReady = false;
static bool printerClaimed = false;
static uint8_t printerInterface = 0xff;
static uint8_t printerAlt = 0;
static uint8_t printerOutEndpoint = 0;
static uint16_t printerOutMps = 64;
static usb_transfer_status_t lastTransferStatus = USB_TRANSFER_STATUS_ERROR;
static int lastTransferActualBytes = 0;
static volatile bool writerActive = false;
static volatile bool writerError = false;
static portMUX_TYPE usbQueueStatsMux = portMUX_INITIALIZER_UNLOCKED;
static size_t queuedWriteBytes = 0;

struct UsbPrintChunk {
  uint8_t *data;
  size_t len;
};

static void usbPrinterWriterTask(void *arg);
static bool usbPrinterWriteBlocking(const uint8_t *data, size_t len);

static void addQueuedWriteBytes(size_t len) {
  portENTER_CRITICAL(&usbQueueStatsMux);
  queuedWriteBytes += len;
  portEXIT_CRITICAL(&usbQueueStatsMux);
}

static void removeQueuedWriteBytes(size_t len) {
  portENTER_CRITICAL(&usbQueueStatsMux);
  queuedWriteBytes = len >= queuedWriteBytes ? 0 : queuedWriteBytes - len;
  portEXIT_CRITICAL(&usbQueueStatsMux);
}

static const char *espErrName(esp_err_t err) {
  return esp_err_to_name(err);
}

static void lockPrinter() {
  if (usbPrinterMutex) {
    xSemaphoreTake(usbPrinterMutex, portMAX_DELAY);
  }
}

static void unlockPrinter() {
  if (usbPrinterMutex) {
    xSemaphoreGive(usbPrinterMutex);
  }
}

static void clearPrinterLocked() {
  printerReady = false;
  printerOutEndpoint = 0;
  printerOutMps = 64;
  portENTER_CRITICAL(&usbQueueStatsMux);
  queuedWriteBytes = 0;
  portEXIT_CRITICAL(&usbQueueStatsMux);

  if (printerTransfer != NULL) {
    usb_host_transfer_free(printerTransfer);
    printerTransfer = NULL;
  }

  if (printerDevice != NULL && printerClaimed && usbClient != NULL && printerInterface != 0xff) {
    usb_host_interface_release(usbClient, printerDevice, printerInterface);
  }
  printerClaimed = false;
  printerInterface = 0xff;
  printerAlt = 0;

  if (printerDevice != NULL && usbClient != NULL) {
    usb_host_device_close(usbClient, printerDevice);
  }
  printerDevice = NULL;
}

static void usbTransferCallback(usb_transfer_t *transfer) {
  lastTransferStatus = transfer->status;
  lastTransferActualBytes = transfer->actual_num_bytes;
  if (usbTransferDone != NULL) {
    xSemaphoreGive(usbTransferDone);
  }
}

static bool descriptorIsBulkOut(const usb_ep_desc_t *ep) {
  return ep != NULL &&
         USB_EP_DESC_GET_XFERTYPE(ep) == USB_BM_ATTRIBUTES_XFER_BULK &&
         USB_EP_DESC_GET_EP_DIR(ep) == 0;
}

static bool findPrinterEndpoint(
  const usb_config_desc_t *config,
  uint8_t &interfaceNumber,
  uint8_t &altSetting,
  uint8_t &endpointAddress,
  uint16_t &endpointMps
) {
  const uint8_t *bytes = reinterpret_cast<const uint8_t *>(config);
  const uint8_t *end = bytes + config->wTotalLength;
  const usb_intf_desc_t *currentInterface = NULL;
  const usb_intf_desc_t *fallbackInterface = NULL;
  const usb_ep_desc_t *fallbackEndpoint = NULL;

  for (const uint8_t *ptr = bytes; ptr + USB_STANDARD_DESC_SIZE <= end;) {
    const usb_standard_desc_t *standard = reinterpret_cast<const usb_standard_desc_t *>(ptr);
    if (standard->bLength < USB_STANDARD_DESC_SIZE || ptr + standard->bLength > end) {
      break;
    }

    if (standard->bDescriptorType == USB_B_DESCRIPTOR_TYPE_INTERFACE && standard->bLength >= USB_INTF_DESC_SIZE) {
      currentInterface = reinterpret_cast<const usb_intf_desc_t *>(ptr);
      Serial.printf(
        "USB interface %u alt=%u class=0x%02x subclass=0x%02x protocol=0x%02x endpoints=%u\r\n",
        currentInterface->bInterfaceNumber,
        currentInterface->bAlternateSetting,
        currentInterface->bInterfaceClass,
        currentInterface->bInterfaceSubClass,
        currentInterface->bInterfaceProtocol,
        currentInterface->bNumEndpoints
      );
    } else if (
      standard->bDescriptorType == USB_B_DESCRIPTOR_TYPE_ENDPOINT &&
      standard->bLength >= USB_EP_DESC_SIZE &&
      currentInterface != NULL
    ) {
      const usb_ep_desc_t *endpoint = reinterpret_cast<const usb_ep_desc_t *>(ptr);
      Serial.printf(
        "USB endpoint 0x%02x attr=0x%02x mps=%u\r\n",
        endpoint->bEndpointAddress,
        endpoint->bmAttributes,
        USB_EP_DESC_GET_MPS(endpoint)
      );

      if (descriptorIsBulkOut(endpoint)) {
        if (currentInterface->bInterfaceClass == USB_CLASS_PRINTER) {
          interfaceNumber = currentInterface->bInterfaceNumber;
          altSetting = currentInterface->bAlternateSetting;
          endpointAddress = endpoint->bEndpointAddress;
          endpointMps = USB_EP_DESC_GET_MPS(endpoint);
          return true;
        }
        if (fallbackEndpoint == NULL) {
          fallbackInterface = currentInterface;
          fallbackEndpoint = endpoint;
        }
      }
    }

    ptr += standard->bLength;
  }

  if (fallbackInterface != NULL && fallbackEndpoint != NULL) {
    interfaceNumber = fallbackInterface->bInterfaceNumber;
    altSetting = fallbackInterface->bAlternateSetting;
    endpointAddress = fallbackEndpoint->bEndpointAddress;
    endpointMps = USB_EP_DESC_GET_MPS(fallbackEndpoint);
    Serial.println("USB printer using fallback bulk OUT endpoint");
    return true;
  }

  return false;
}

static void tryOpenPrinter(uint8_t address) {
  lockPrinter();
  if (printerDevice != NULL) {
    unlockPrinter();
    return;
  }
  unlockPrinter();

  usb_device_handle_t device = NULL;
  esp_err_t err = usb_host_device_open(usbClient, address, &device);
  if (err != ESP_OK) {
    Serial.printf("USB open device %u failed: %s\r\n", address, espErrName(err));
    return;
  }

  const usb_device_desc_t *deviceDesc = NULL;
  err = usb_host_get_device_descriptor(device, &deviceDesc);
  if (err == ESP_OK && deviceDesc != NULL) {
    Serial.printf(
      "USB device vid=0x%04x pid=0x%04x class=0x%02x configs=%u\r\n",
      deviceDesc->idVendor,
      deviceDesc->idProduct,
      deviceDesc->bDeviceClass,
      deviceDesc->bNumConfigurations
    );
  }

  const usb_config_desc_t *config = NULL;
  err = usb_host_get_active_config_descriptor(device, &config);
  if (err != ESP_OK || config == NULL) {
    Serial.printf("USB config descriptor failed: %s\r\n", espErrName(err));
    usb_host_device_close(usbClient, device);
    return;
  }

  uint8_t interfaceNumber = 0xff;
  uint8_t altSetting = 0;
  uint8_t endpointAddress = 0;
  uint16_t endpointMps = 64;
  if (!findPrinterEndpoint(config, interfaceNumber, altSetting, endpointAddress, endpointMps)) {
    Serial.println("USB no printer/bulk OUT endpoint found");
    usb_host_device_close(usbClient, device);
    return;
  }

  err = usb_host_interface_claim(usbClient, device, interfaceNumber, altSetting);
  if (err != ESP_OK) {
    Serial.printf("USB claim interface %u failed: %s\r\n", interfaceNumber, espErrName(err));
    usb_host_device_close(usbClient, device);
    return;
  }

  usb_transfer_t *transfer = NULL;
  err = usb_host_transfer_alloc(USB_PRINTER_TRANSFER_SIZE, 0, &transfer);
  if (err != ESP_OK) {
    Serial.printf("USB transfer alloc failed: %s\r\n", espErrName(err));
    usb_host_interface_release(usbClient, device, interfaceNumber);
    usb_host_device_close(usbClient, device);
    return;
  }

  transfer->device_handle = device;
  transfer->bEndpointAddress = endpointAddress;
  transfer->callback = usbTransferCallback;
  transfer->context = NULL;

  lockPrinter();
  printerDevice = device;
  printerTransfer = transfer;
  printerClaimed = true;
  printerReady = true;
  printerInterface = interfaceNumber;
  printerAlt = altSetting;
  printerOutEndpoint = endpointAddress;
  printerOutMps = endpointMps == 0 ? 64 : endpointMps;
  unlockPrinter();

  Serial.printf(
    "USB printer ready interface=%u alt=%u out=0x%02x mps=%u\r\n",
    interfaceNumber,
    altSetting,
    endpointAddress,
    printerOutMps
  );
}

static void usbClientEventCallback(const usb_host_client_event_msg_t *event, void *arg) {
  (void)arg;
  if (event->event == USB_HOST_CLIENT_EVENT_NEW_DEV) {
    Serial.printf("USB device connected addr=%u\r\n", event->new_dev.address);
    tryOpenPrinter(event->new_dev.address);
  } else if (event->event == USB_HOST_CLIENT_EVENT_DEV_GONE) {
    Serial.println("USB printer/device disconnected");
    lockPrinter();
    clearPrinterLocked();
    unlockPrinter();
  }
}

static void usbHostTask(void *arg) {
  (void)arg;
  for (;;) {
    uint32_t eventFlags = 0;
    usb_host_lib_handle_events(portMAX_DELAY, &eventFlags);
  }
}

static void usbPrinterTask(void *arg) {
  (void)arg;

  const usb_host_client_config_t clientConfig = {
    .is_synchronous = false,
    .max_num_event_msg = 8,
    .async = {
      .client_event_callback = usbClientEventCallback,
      .callback_arg = NULL,
    },
  };

  esp_err_t err = usb_host_client_register(&clientConfig, &usbClient);
  if (err != ESP_OK) {
    Serial.printf("USB client register failed: %s\r\n", espErrName(err));
    vTaskDelete(NULL);
    return;
  }

  Serial.println("USB printer host client ready");
  for (;;) {
    usb_host_client_handle_events(usbClient, pdMS_TO_TICKS(100));
  }
}

void usbPrinterHostBegin() {
  if (usbHostStarted) {
    return;
  }

  usbPrinterMutex = xSemaphoreCreateMutex();
  usbTransferDone = xSemaphoreCreateBinary();
  usbPrintQueue = xQueueCreate(USB_PRINTER_QUEUE_DEPTH, sizeof(UsbPrintChunk));
  if (usbPrinterMutex == NULL || usbTransferDone == NULL || usbPrintQueue == NULL) {
    Serial.println("USB printer host queue/semaphore allocation failed");
    return;
  }

  const usb_host_config_t hostConfig = {
    .skip_phy_setup = false,
    .root_port_unpowered = false,
    .intr_flags = ESP_INTR_FLAG_LEVEL1,
    .enum_filter_cb = NULL,
    .fifo_settings_custom = {
      .nptx_fifo_lines = 0,
      .ptx_fifo_lines = 0,
      .rx_fifo_lines = 0,
    },
    .peripheral_map = 0,
  };

  esp_err_t err = usb_host_install(&hostConfig);
  if (err != ESP_OK) {
    Serial.printf("USB host install failed: %s\r\n", espErrName(err));
    return;
  }

  usbHostStarted = true;
  xTaskCreatePinnedToCore(usbHostTask, "usb_host", 4096, NULL, 4, &usbHostTaskHandle, 0);
  xTaskCreatePinnedToCore(usbPrinterTask, "usb_printer", 8192, NULL, 5, &usbPrinterTaskHandle, 0);
  xTaskCreatePinnedToCore(usbPrinterWriterTask, "usb_print_writer", 6144, NULL, 4, &usbPrinterWriterTaskHandle, 0);
  Serial.println("USB printer host started");
}

bool usbPrinterHostReady() {
  lockPrinter();
  const bool ready = printerReady && printerDevice != NULL && printerTransfer != NULL && printerOutEndpoint != 0;
  unlockPrinter();
  return ready;
}

size_t usbPrinterHostPendingBytes() {
  portENTER_CRITICAL(&usbQueueStatsMux);
  const size_t pending = queuedWriteBytes;
  portEXIT_CRITICAL(&usbQueueStatsMux);
  return pending;
}

bool usbPrinterHostWaitForPendingBytes(size_t maxPendingBytes, uint32_t timeoutMs) {
  const unsigned long startedAt = millis();
  while (millis() - startedAt < timeoutMs) {
    if (writerError) {
      return false;
    }
    if (usbPrinterHostPendingBytes() <= maxPendingBytes) {
      return true;
    }
    delay(5);
  }
  Serial.printf(
    "USB printer backlog wait timed out pending=%u max=%u\r\n",
    unsigned(usbPrinterHostPendingBytes()),
    unsigned(maxPendingBytes)
  );
  return false;
}

static bool usbPrinterWriteBlocking(const uint8_t *data, size_t len) {
  if (data == NULL || len == 0) {
    return true;
  }

  size_t offset = 0;
  while (offset < len) {
    lockPrinter();
    usb_transfer_t *transfer = printerTransfer;
    const bool ready = printerReady && printerDevice != NULL && transfer != NULL && printerOutEndpoint != 0;
    if (!ready) {
      unlockPrinter();
      Serial.println("USB printer write failed: no printer ready");
      return false;
    }

    const size_t count = min(len - offset, USB_PRINTER_TRANSFER_SIZE);
    memcpy(transfer->data_buffer, data + offset, count);
    transfer->num_bytes = int(count);
    transfer->actual_num_bytes = 0;
    transfer->flags = 0;
    transfer->timeout_ms = 1000;
    lastTransferStatus = USB_TRANSFER_STATUS_ERROR;
    lastTransferActualBytes = 0;
    xSemaphoreTake(usbTransferDone, 0);

    esp_err_t err = usb_host_transfer_submit(transfer);
    unlockPrinter();

    if (err != ESP_OK) {
      Serial.printf("USB printer transfer submit failed: %s\r\n", espErrName(err));
      return false;
    }

    if (xSemaphoreTake(usbTransferDone, USB_PRINTER_WRITE_TIMEOUT) != pdTRUE) {
      Serial.println("USB printer transfer timed out");
      return false;
    }

    if (lastTransferStatus != USB_TRANSFER_STATUS_COMPLETED || lastTransferActualBytes != int(count)) {
      Serial.printf(
        "USB printer transfer failed status=%d actual=%d expected=%u\r\n",
        int(lastTransferStatus),
        lastTransferActualBytes,
        unsigned(count)
      );
      return false;
    }

    offset += count;
  }

  return true;
}

static void usbPrinterWriterTask(void *arg) {
  (void)arg;
  UsbPrintChunk chunk = {};

  for (;;) {
    if (xQueueReceive(usbPrintQueue, &chunk, portMAX_DELAY) != pdTRUE) {
      continue;
    }

    writerActive = true;
    if (!usbPrinterWriteBlocking(chunk.data, chunk.len)) {
      writerError = true;
    }
    removeQueuedWriteBytes(chunk.len);
    free(chunk.data);
    chunk = {};
    writerActive = false;
  }
}

bool usbPrinterHostWrite(const uint8_t *data, size_t len) {
  if (data == NULL || len == 0) {
    return true;
  }

  if (!usbPrinterHostReady() || usbPrintQueue == NULL || writerError) {
    Serial.println("USB printer enqueue failed: printer not ready");
    return false;
  }

  uint8_t *copy = static_cast<uint8_t *>(ps_malloc(len));
  if (copy == NULL) {
    copy = static_cast<uint8_t *>(malloc(len));
  }
  if (copy == NULL) {
    Serial.printf("USB printer enqueue failed: malloc %u\r\n", unsigned(len));
    return false;
  }

  memcpy(copy, data, len);
  UsbPrintChunk chunk = {.data = copy, .len = len};
  addQueuedWriteBytes(len);
  if (xQueueSend(usbPrintQueue, &chunk, USB_PRINTER_QUEUE_TIMEOUT) != pdTRUE) {
    removeQueuedWriteBytes(len);
    free(copy);
    Serial.println("USB printer enqueue failed: queue full");
    return false;
  }

  return true;
}

bool usbPrinterHostEndJob() {
  const unsigned long startedAt = millis();
  while (
    (uxQueueMessagesWaiting(usbPrintQueue) > 0 || writerActive || usbPrinterHostPendingBytes() > 0) &&
    millis() - startedAt < pdTICKS_TO_MS(USB_PRINTER_DRAIN_TIMEOUT)
  ) {
    delay(10);
  }

  if (writerError) {
    Serial.println("USB printer job failed while writing");
    writerError = false;
    return false;
  }

  if (uxQueueMessagesWaiting(usbPrintQueue) > 0 || writerActive || usbPrinterHostPendingBytes() > 0) {
    Serial.println("USB printer job drain timed out");
    return false;
  }

  Serial.println("USB printer job bytes flushed to bulk endpoint");
  return true;
}
