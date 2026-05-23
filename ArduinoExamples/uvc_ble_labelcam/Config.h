#pragma once

#include <Arduino.h>

// ESP32-S3 USB-UVC camera to BLE label printer skeleton.
// Fill these in for the physical build.

static constexpr uint8_t CAPTURE_BUTTON_PIN = 0;
static constexpr uint32_t BUTTON_HOLD_DEBOUNCE_MS = 35;

static constexpr uint16_t LABEL_WIDTH_DOTS = 800;
static constexpr uint16_t LABEL_HEIGHT_DOTS = 1200;
static constexpr float LABEL_WIDTH_MM = 100.0f;
static constexpr float LABEL_HEIGHT_MM = 150.0f;
static constexpr float LABEL_GAP_MM = 2.0f;
static constexpr uint8_t LABEL_DENSITY = 6;
static constexpr uint8_t DITHER_THRESHOLD = 180;

// Keep true while the UVC backend is not integrated; the button will print
// a generated grayscale frame so the BLE/TSPL side can be tested.
static constexpr bool ENABLE_TEST_PATTERN_CAPTURE = true;

// BLE printer settings based on P1/portal/bleLabelPrinter.js:
// scan broad printer-like names, try common transparent UART services, and
// prefer write-without-response with chunk/delay flow control.
static const char *BLE_PRINTER_NAME_PREFIXES[] = {
  "BlueTooth Printer",
  "Bluetooth Printer",
  "BlueTooth",
  "Bluetooth",
  "Printer",
  "Zebra",
  "ZQ",
  "QLn",
  "ZD",
  "GK",
  "GX",
  "LP",
  "JK",
  "JK-",
  "BLE",
  "NIIMBOT",
  "Niimbot",
  "niimbot",
  "D110",
  "D11",
  "B21",
  "B1",
  "B3S",
  "B18",
  "M2",
  "JingChen",
};

struct BlePrinterProfile {
  const char *serviceUuid;
  const char *writeCharacteristicUuid;
};

static const BlePrinterProfile BLE_PRINTER_PROFILES[] = {
  // Nordic UART Service.
  {"6e400001-b5a3-f393-e0a9-e50e24dcca9e", "6e400002-b5a3-f393-e0a9-e50e24dcca9e"},
  // HM-10 / transparent serial variants.
  {"0000ffe0-0000-1000-8000-00805f9b34fb", "0000ffe1-0000-1000-8000-00805f9b34fb"},
  {"0000ffe5-0000-1000-8000-00805f9b34fb", "0000ffe9-0000-1000-8000-00805f9b34fb"},
  // Microchip/ISSC transparent UART service. Write characteristic may vary;
  // leave characteristic empty to ask the BLE library for a writable one.
  {"49535343-fe7d-4ae5-8fa9-9fafd205e455", ""},
  // Niimbot service from the portal module. Protocol is not TSPL for many
  // Niimbot devices, so this profile is discovery-only until protocol support
  // is added.
  {"e7810a71-73ae-499d-8c15-faa9aef0c3f2", ""},
};

static constexpr uint32_t BLE_SCAN_SECONDS = 8;
static constexpr size_t BLE_WRITE_CHUNK_BYTES = 180;
static constexpr size_t BLE_MIN_WRITE_CHUNK_BYTES = 20;
static constexpr uint32_t BLE_WRITE_DELAY_MS = 8;
static constexpr bool BLE_PREFER_WRITE_WITH_RESPONSE = false;
