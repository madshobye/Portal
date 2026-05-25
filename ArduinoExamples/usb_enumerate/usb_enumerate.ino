#include <Arduino.h>

#include <ESP32USBHost4096.h>

#include "esp_err.h"
#include "usb/usb_host.h"

static constexpr uint32_t USB_HOST_TASK_STACK = 3072;
static constexpr uint32_t USB_CLIENT_TASK_STACK = 4096;

static usb_host_client_handle_t usbClient = nullptr;
static bool hostStarted = false;
static bool usbClientTaskStarted = false;
static BaseType_t usbHostTaskCreateResult = pdFAIL;
static BaseType_t usbClientTaskCreateResult = pdFAIL;
static bool printedAddress[128] = {};

static const char *espErrName(esp_err_t err) {
  return esp_err_to_name(err);
}

static uint16_t le16(const uint8_t *p) {
  return static_cast<uint16_t>(p[0]) | (static_cast<uint16_t>(p[1]) << 8);
}

static uint32_t le32(const uint8_t *p) {
  return static_cast<uint32_t>(p[0]) |
         (static_cast<uint32_t>(p[1]) << 8) |
         (static_cast<uint32_t>(p[2]) << 16) |
         (static_cast<uint32_t>(p[3]) << 24);
}

static void printUvcStreamingDescriptor(const uint8_t *ptr, uint8_t length) {
  if (length < 3) {
    return;
  }

  const uint8_t subtype = ptr[2];
  switch (subtype) {
    case 0x04: // VS_FORMAT_UNCOMPRESSED
      if (length >= 27) {
        Serial.printf(
          "    UVC format uncompressed index=%u frames=%u guid=%02x%02x%02x%02x...\r\n",
          ptr[3],
          ptr[4],
          ptr[5],
          ptr[6],
          ptr[7],
          ptr[8]
        );
      }
      break;
    case 0x05: // VS_FRAME_UNCOMPRESSED
      if (length >= 26) {
        Serial.printf(
          "    UVC frame uncompressed index=%u %ux%u minBit=%lu maxBit=%lu maxFrame=%lu defaultInterval=%lu intervals=%u\r\n",
          ptr[3],
          le16(ptr + 5),
          le16(ptr + 7),
          static_cast<unsigned long>(le32(ptr + 9)),
          static_cast<unsigned long>(le32(ptr + 13)),
          static_cast<unsigned long>(le32(ptr + 17)),
          static_cast<unsigned long>(le32(ptr + 21)),
          ptr[25]
        );
      }
      break;
    case 0x06: // VS_FORMAT_MJPEG
      if (length >= 11) {
        Serial.printf(
          "    UVC format MJPEG index=%u frames=%u defaultFrame=%u\r\n",
          ptr[3],
          ptr[4],
          ptr[7]
        );
      }
      break;
    case 0x07: // VS_FRAME_MJPEG
      if (length >= 26) {
        Serial.printf(
          "    UVC frame MJPEG index=%u %ux%u minBit=%lu maxBit=%lu maxFrame=%lu defaultInterval=%lu intervals=%u\r\n",
          ptr[3],
          le16(ptr + 5),
          le16(ptr + 7),
          static_cast<unsigned long>(le32(ptr + 9)),
          static_cast<unsigned long>(le32(ptr + 13)),
          static_cast<unsigned long>(le32(ptr + 17)),
          static_cast<unsigned long>(le32(ptr + 21)),
          ptr[25]
        );
      }
      break;
    default:
      Serial.printf("    UVC VS descriptor subtype=0x%02x len=%u\r\n", subtype, length);
      break;
  }
}

static void printConfigDescriptor(const usb_config_desc_t *config) {
  if (config == nullptr) {
    return;
  }

  Serial.printf(
    "USB config value=%u interfaces=%u total=%u maxPower=%u attr=0x%02x\r\n",
    config->bConfigurationValue,
    config->bNumInterfaces,
    config->wTotalLength,
    config->bMaxPower,
    config->bmAttributes
  );

  const uint8_t *bytes = reinterpret_cast<const uint8_t *>(config);
  const uint8_t *end = bytes + config->wTotalLength;
  const usb_intf_desc_t *currentInterface = nullptr;

  for (const uint8_t *ptr = bytes; ptr + USB_STANDARD_DESC_SIZE <= end;) {
    const usb_standard_desc_t *standard = reinterpret_cast<const usb_standard_desc_t *>(ptr);
    if (standard->bLength < USB_STANDARD_DESC_SIZE || ptr + standard->bLength > end) {
      Serial.println("USB descriptor parse stopped: invalid length");
      break;
    }

    if (standard->bDescriptorType == USB_B_DESCRIPTOR_TYPE_INTERFACE &&
        standard->bLength >= USB_INTF_DESC_SIZE) {
      currentInterface = reinterpret_cast<const usb_intf_desc_t *>(ptr);
      Serial.printf(
        "  interface %u alt=%u class=0x%02x subclass=0x%02x protocol=0x%02x endpoints=%u\r\n",
        currentInterface->bInterfaceNumber,
        currentInterface->bAlternateSetting,
        currentInterface->bInterfaceClass,
        currentInterface->bInterfaceSubClass,
        currentInterface->bInterfaceProtocol,
        currentInterface->bNumEndpoints
      );
    } else if (standard->bDescriptorType == USB_B_DESCRIPTOR_TYPE_ENDPOINT &&
               standard->bLength >= USB_EP_DESC_SIZE &&
               currentInterface != nullptr) {
      const usb_ep_desc_t *endpoint = reinterpret_cast<const usb_ep_desc_t *>(ptr);
      Serial.printf(
        "    endpoint 0x%02x attr=0x%02x type=%u dir=%u mps=%u interval=%u\r\n",
        endpoint->bEndpointAddress,
        endpoint->bmAttributes,
        USB_EP_DESC_GET_XFERTYPE(endpoint),
        USB_EP_DESC_GET_EP_DIR(endpoint),
        USB_EP_DESC_GET_MPS(endpoint),
        endpoint->bInterval
      );
    } else if (standard->bDescriptorType == 0x24 &&
               currentInterface != nullptr &&
               currentInterface->bInterfaceClass == 0x0e &&
               currentInterface->bInterfaceSubClass == 0x02) {
      printUvcStreamingDescriptor(ptr, standard->bLength);
    }

    ptr += standard->bLength;
  }
}

static void openAndPrintDevice(uint8_t address) {
  usb_device_handle_t device = nullptr;
  esp_err_t err = usb_host_device_open(usbClient, address, &device);
  if (err != ESP_OK) {
    Serial.printf("USB open addr=%u failed: %s\r\n", address, espErrName(err));
    return;
  }

  const usb_device_desc_t *deviceDesc = nullptr;
  err = usb_host_get_device_descriptor(device, &deviceDesc);
  if (err == ESP_OK && deviceDesc != nullptr) {
    Serial.printf(
      "USB device addr=%u vid=0x%04x pid=0x%04x class=0x%02x subclass=0x%02x protocol=0x%02x configs=%u mps0=%u\r\n",
      address,
      deviceDesc->idVendor,
      deviceDesc->idProduct,
      deviceDesc->bDeviceClass,
      deviceDesc->bDeviceSubClass,
      deviceDesc->bDeviceProtocol,
      deviceDesc->bNumConfigurations,
      deviceDesc->bMaxPacketSize0
    );
  } else {
    Serial.printf("USB device descriptor addr=%u failed: %s\r\n", address, espErrName(err));
  }

  const usb_config_desc_t *config = nullptr;
  err = usb_host_get_active_config_descriptor(device, &config);
  if (err == ESP_OK && config != nullptr) {
    printConfigDescriptor(config);
  } else {
    Serial.printf("USB config descriptor addr=%u failed: %s\r\n", address, espErrName(err));
  }

  err = usb_host_device_close(usbClient, device);
  if (err != ESP_OK) {
    Serial.printf("USB close addr=%u failed: %s\r\n", address, espErrName(err));
  }
}

static void usbClientEventCallback(const usb_host_client_event_msg_t *event, void *arg) {
  (void)arg;
  if (event->event == USB_HOST_CLIENT_EVENT_NEW_DEV) {
    Serial.printf("USB event: new device addr=%u\r\n", event->new_dev.address);
    printedAddress[event->new_dev.address] = true;
    openAndPrintDevice(event->new_dev.address);
  } else if (event->event == USB_HOST_CLIENT_EVENT_DEV_GONE) {
    Serial.println("USB event: device gone");
    memset(printedAddress, 0, sizeof(printedAddress));
  }
}

static void usbHostTask(void *arg) {
  (void)arg;
  for (;;) {
    uint32_t eventFlags = 0;
    usb_host_lib_handle_events(portMAX_DELAY, &eventFlags);
    if (eventFlags & USB_HOST_LIB_EVENT_FLAGS_NO_CLIENTS) {
      usb_host_device_free_all();
    }
  }
}

static void usbClientTask(void *arg) {
  (void)arg;
  usbClientTaskStarted = true;
  Serial.println("USB client task running");

  const usb_host_client_config_t clientConfig = {
    .is_synchronous = false,
    .max_num_event_msg = 8,
    .async = {
      .client_event_callback = usbClientEventCallback,
      .callback_arg = nullptr,
    },
  };

  esp_err_t err = usb_host_client_register(&clientConfig, &usbClient);
  if (err != ESP_OK) {
    Serial.printf("USB client register failed: %s\r\n", espErrName(err));
    vTaskDelete(nullptr);
    return;
  }

  Serial.println("USB enumerate client ready");
  for (;;) {
    usb_host_client_handle_events(usbClient, pdMS_TO_TICKS(100));
  }
}

static void beginUsbHost() {
  if (hostStarted) {
    return;
  }

  const usb_host_config_t hostConfig = {
    .skip_phy_setup = false,
    .root_port_unpowered = false,
    .intr_flags = ESP_INTR_FLAG_LEVEL1,
    .enum_filter_cb = nullptr,
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

  hostStarted = true;
  usbHostTaskCreateResult = xTaskCreatePinnedToCore(usbHostTask, "usb_host", USB_HOST_TASK_STACK, nullptr, 4, nullptr, 1);
  usbClientTaskCreateResult = xTaskCreatePinnedToCore(usbClientTask, "usb_client", USB_CLIENT_TASK_STACK, nullptr, 5, nullptr, 1);
  Serial.printf(
    "USB host started hostTask=%ld clientTask=%ld\r\n",
    static_cast<long>(usbHostTaskCreateResult),
    static_cast<long>(usbClientTaskCreateResult)
  );
}

void setup() {
  Serial.begin(115200);
  uint32_t start = millis();
  while (!Serial && millis() - start < 3000) {
    delay(10);
  }
  Serial.println();
  Serial.println("ESP32 USB enumerate test");
  Serial.printf("heap=%u psram=%u\r\n", ESP.getFreeHeap(), ESP.getFreePsram());
  Serial.println("Send g to start USB host");
  while (true) {
    if (Serial.available() > 0) {
      int c = Serial.read();
      if (c == 'g' || c == 'G') {
        break;
      }
    }
    delay(20);
  }
  Serial.println("Starting USB host now");
  beginUsbHost();
}

void loop() {
  static uint32_t lastReportMs = 0;
  if (millis() - lastReportMs >= 3000) {
    uint8_t addresses[8] = {};
    int actualCount = 0;
    usb_host_device_addr_list_fill(8, addresses, &actualCount);
    Serial.printf(
      "USB poll devices=%d client=%s clientTask=%d hostTaskCreate=%ld clientTaskCreate=%ld",
      actualCount,
      usbClient != nullptr ? "yes" : "no",
      usbClientTaskStarted ? 1 : 0,
      static_cast<long>(usbHostTaskCreateResult),
      static_cast<long>(usbClientTaskCreateResult)
    );
    for (int i = 0; i < actualCount; i++) {
      Serial.printf(" %u", addresses[i]);
    }
    Serial.println();
    if (usbClient != nullptr) {
      for (int i = 0; i < actualCount; i++) {
        const uint8_t address = addresses[i];
        if (address < sizeof(printedAddress) && !printedAddress[address]) {
          Serial.printf("USB poll: opening addr=%u\r\n", address);
          printedAddress[address] = true;
          openAndPrintDevice(address);
        }
      }
    }
    lastReportMs = millis();
  }
  delay(20);
}
