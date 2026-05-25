#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEClient.h>
#include <BLEScan.h>

#include <map>
#include <string>

static constexpr uint32_t SERIAL_BAUD = 115200;
static constexpr uint32_t SCAN_SECONDS = 8;
static constexpr uint16_t REQUEST_MTU = 517;
static constexpr size_t WRITE_CHUNK_BYTES = 20;
static constexpr uint32_t CHUNK_DELAY_MS = 8;

struct PrinterProfile {
  const char *serviceUuid;
  const char *fallbackCharacteristicUuid;
};

static const char *NAME_PREFIXES[] = {
  "BlueTooth Printer",
  "Bluetooth Printer",
  "BlueTooth",
  "Bluetooth",
  "Printer",
  "B1",
  "B3S",
  "B18",
  "M2",
  "JingChen",
};

static const PrinterProfile PROFILES[] = {
  {"6e400001-b5a3-f393-e0a9-e50e24dcca9e", "6e400002-b5a3-f393-e0a9-e50e24dcca9e"},
  {"0000ffe0-0000-1000-8000-00805f9b34fb", "0000ffe1-0000-1000-8000-00805f9b34fb"},
  {"0000ffe5-0000-1000-8000-00805f9b34fb", "0000ffe9-0000-1000-8000-00805f9b34fb"},
  {"49535343-fe7d-4ae5-8fa9-9fafd205e455", ""},
  {"e7810a71-73ae-499d-8c15-faa9aef0c3f2", ""},
};

static BLEClient *client = nullptr;

static bool startsWithKnownPrefix(const String &name) {
  if (name.length() == 0) return false;
  for (const char *prefix : NAME_PREFIXES) {
    if (name.startsWith(prefix)) return true;
  }
  return false;
}

static bool advertisesKnownService(BLEAdvertisedDevice &device) {
  if (!device.haveServiceUUID()) return false;
  for (const PrinterProfile &profile : PROFILES) {
    if (device.isAdvertisingService(BLEUUID(profile.serviceUuid))) return true;
  }
  return false;
}

static void logDevice(const char *label, BLEAdvertisedDevice &device) {
  const String name = device.haveName() ? String(device.getName().c_str()) : "";
  Serial.printf(
    "%s name='%s' address=%s service=%s\r\n",
    label,
    name.c_str(),
    device.getAddress().toString().c_str(),
    device.haveServiceUUID() ? device.getServiceUUID().toString().c_str() : ""
  );
}

static bool writable(BLERemoteCharacteristic *ch) {
  return ch != nullptr && (ch->canWrite() || ch->canWriteNoResponse());
}

static void logCharacteristic(BLERemoteCharacteristic *ch) {
  if (ch == nullptr) return;
  Serial.printf(
    "  char uuid=%s write=%u noResponse=%u read=%u notify=%u indicate=%u\r\n",
    ch->getUUID().toString().c_str(),
    unsigned(ch->canWrite()),
    unsigned(ch->canWriteNoResponse()),
    unsigned(ch->canRead()),
    unsigned(ch->canNotify()),
    unsigned(ch->canIndicate())
  );
}

static BLERemoteCharacteristic *selectBrowserStyle(BLERemoteService *service) {
  if (service == nullptr) return nullptr;
  std::map<std::string, BLERemoteCharacteristic *> *chars = service->getCharacteristics();
  if (chars == nullptr) return nullptr;

  BLERemoteCharacteristic *writeNoReadNoNotify = nullptr;
  BLERemoteCharacteristic *writeNoRead = nullptr;
  BLERemoteCharacteristic *anyWrite = nullptr;

  for (auto &entry : *chars) {
    BLERemoteCharacteristic *ch = entry.second;
    logCharacteristic(ch);
    if (!writable(ch)) continue;
    if (writeNoReadNoNotify == nullptr && !ch->canRead() && !ch->canNotify()) {
      writeNoReadNoNotify = ch;
    }
    if (writeNoRead == nullptr && !ch->canRead()) {
      writeNoRead = ch;
    }
    if (anyWrite == nullptr) {
      anyWrite = ch;
    }
  }

  if (writeNoReadNoNotify != nullptr) return writeNoReadNoNotify;
  if (writeNoRead != nullptr) return writeNoRead;
  return anyWrite;
}

static BLERemoteCharacteristic *getCharacteristicByUuid(BLERemoteService *service, const char *uuid) {
  if (service == nullptr || uuid == nullptr || strlen(uuid) == 0) return nullptr;
  BLERemoteCharacteristic *ch = service->getCharacteristic(BLEUUID(uuid));
  return writable(ch) ? ch : nullptr;
}

static BLEAdvertisedDevice *findPrinter() {
  BLEScan *scan = BLEDevice::getScan();
  scan->setActiveScan(true);
  BLEScanResults *results = scan->start(SCAN_SECONDS, false);
  BLEAdvertisedDevice *target = nullptr;
  const int count = results != nullptr ? results->getCount() : 0;

  Serial.printf("BLE scan found %d devices\r\n", count);
  Serial.println("BLE candidates:");
  for (int i = 0; i < count; i++) {
    BLEAdvertisedDevice device = results->getDevice(i);
    const String name = device.haveName() ? String(device.getName().c_str()) : "";
    const bool serviceCandidate = advertisesKnownService(device);
    if (name.length() > 0 || serviceCandidate) {
      logDevice(serviceCandidate ? "  candidate service" : "  candidate name", device);
    }
    if (startsWithKnownPrefix(name)) {
      logDevice("target by name", device);
      target = new BLEAdvertisedDevice(device);
      break;
    }
  }
  scan->clearResults();
  return target;
}

static bool connectPrinter() {
  BLEAdvertisedDevice *target = findPrinter();
  if (target == nullptr) {
    Serial.println("No BLE printer found");
    return false;
  }

  if (client != nullptr) {
    if (client->isConnected()) client->disconnect();
    delete client;
    client = nullptr;
  }

  client = BLEDevice::createClient();
  logDevice("connecting", *target);
  const bool ok = client->connect(target);
  delete target;
  if (!ok) {
    Serial.println("BLE connect failed");
    return false;
  }

  const bool mtuRequested = client->setMTU(REQUEST_MTU);
  const bool connParams = client->updateConnParams(6, 12, 0, 400);
  delay(250);
  Serial.printf(
    "BLE connected mtu=%u mtuRequested=%u connParams=%u\r\n",
    unsigned(client->getMTU()),
    unsigned(mtuRequested),
    unsigned(connParams)
  );
  return true;
}

static bool writeBytes(BLERemoteCharacteristic *ch, const uint8_t *data, size_t len) {
  if (!writable(ch)) return false;
  Serial.printf(
    "writing %u bytes to %s mode=browser-order chunk=%u delay=%u\r\n",
    unsigned(len),
    ch->getUUID().toString().c_str(),
    unsigned(WRITE_CHUNK_BYTES),
    unsigned(CHUNK_DELAY_MS)
  );

  size_t offset = 0;
  while (offset < len) {
    const size_t chunkLen = min(WRITE_CHUNK_BYTES, len - offset);
    bool ok = ch->writeValue((uint8_t *)(data + offset), chunkLen, false);
    if (!ok && ch->canWrite()) {
      ok = ch->writeValue((uint8_t *)(data + offset), chunkLen, true);
    }
    if (!ok) {
      Serial.printf("write failed offset=%u chunk=%u\r\n", unsigned(offset), unsigned(chunkLen));
      return false;
    }
    offset += chunkLen;
    if (CHUNK_DELAY_MS > 0) delay(CHUNK_DELAY_MS);
  }
  Serial.printf("write complete %u/%u\r\n", unsigned(offset), unsigned(len));
  return true;
}

static bool writeString(BLERemoteCharacteristic *ch, const char *text) {
  return writeBytes(ch, reinterpret_cast<const uint8_t *>(text), strlen(text));
}

static void runPrintsForCharacteristic(const char *label, BLERemoteCharacteristic *ch) {
  if (!writable(ch)) return;

  Serial.printf("\r\n=== %s %s ===\r\n", label, ch->getUUID().toString().c_str());
  delay(500);

  const char *rawText =
    "BLE RAW TEXT\r\n"
    "\r\n"
    "\r\n";
  Serial.println("probe raw text");
  writeString(ch, rawText);
  delay(900);

  const char *tsplTextCrLf =
    "SIZE 150 mm,100 mm\r\n"
    "GAP 2 mm,0 mm\r\n"
    "DIRECTION 1\r\n"
    "CLS\r\n"
    "TEXT 80,80,\"3\",0,3,3,\"BLE SANITY\"\r\n"
    "PRINT 1,1\r\n";
  Serial.println("probe TSPL CRLF text");
  writeString(ch, tsplTextCrLf);
  delay(900);

  const char *tsplTextLf =
    "SIZE 150 mm,100 mm\n"
    "GAP 2 mm,0 mm\n"
    "DIRECTION 1\n"
    "CLS\n"
    "TEXT 80,80,\"3\",0,3,3,\"BLE LF\"\n"
    "PRINT 1,1\n";
  Serial.println("probe TSPL LF text");
  writeString(ch, tsplTextLf);
  delay(900);

  const char *tsplBarcode =
    "SIZE 150 mm,100 mm\r\n"
    "GAP 2 mm,0 mm\r\n"
    "DIRECTION 1\r\n"
    "CLS\r\n"
    "BARCODE 80,180,\"128\",120,1,0,3,3,\"1234567890\"\r\n"
    "PRINT 1,1\r\n";
  Serial.println("probe TSPL barcode");
  writeString(ch, tsplBarcode);
  delay(900);

  const char *zpl =
    "^XA\n"
    "^PW1200\n"
    "^LL800\n"
    "^FO80,80^A0N,70,70^FDBLE ZPL^FS\n"
    "^PQ1\n"
    "^XZ\n";
  Serial.println("probe ZPL");
  writeString(ch, zpl);
  delay(900);

  const char *cpcl =
    "! 0 200 200 800 1\r\n"
    "TEXT 4 0 80 80 BLE CPCL\r\n"
    "FORM\r\n"
    "PRINT\r\n";
  Serial.println("probe CPCL");
  writeString(ch, cpcl);
  delay(900);

  const uint8_t escpos[] = {
    0x1b, 0x40,
    'B', 'L', 'E', ' ', 'E', 'S', 'C', '/', 'P', 'O', 'S', '\n',
    '\n', '\n', '\n',
    0x1d, 0x56, 0x00
  };
  Serial.println("probe ESC/POS text");
  writeBytes(ch, escpos, sizeof(escpos));
  delay(900);
}

static void runSuite() {
  if (!connectPrinter()) return;

  for (const PrinterProfile &profile : PROFILES) {
    BLERemoteService *service = client->getService(BLEUUID(profile.serviceUuid));
    if (service == nullptr) continue;

    Serial.printf("\r\nservice %s\r\n", profile.serviceUuid);
    BLERemoteCharacteristic *browserStyle = selectBrowserStyle(service);
    BLERemoteCharacteristic *fallback = getCharacteristicByUuid(service, profile.fallbackCharacteristicUuid);

    if (browserStyle != nullptr) {
      runPrintsForCharacteristic("browser-style", browserStyle);
    }
    if (fallback != nullptr && fallback != browserStyle) {
      runPrintsForCharacteristic("fallback-explicit", fallback);
    }
  }

  Serial.println("BLE print sanity suite done");
}

static void waitForStart() {
  Serial.println("send 'g' to run BLE print sanity suite");
  while (true) {
    while (Serial.available() > 0) {
      const char c = Serial.read();
      if (c == 'g' || c == 'G') {
        Serial.println("start command received");
        return;
      }
    }
    delay(20);
  }
}

void setup() {
  Serial.begin(SERIAL_BAUD);
  Serial.setDebugOutput(true);
  delay(300);

  Serial.println();
  Serial.println("BLE Label Print Sanity");
  Serial.printf("heap free=%u min=%u psram=%u\r\n", unsigned(ESP.getFreeHeap()), unsigned(ESP.getMinFreeHeap()), unsigned(ESP.getFreePsram()));

  BLEDevice::init("ble-print-sanity");
  BLEDevice::setPower(ESP_PWR_LVL_P9);
  BLEDevice::setMTU(REQUEST_MTU);

  waitForStart();
  runSuite();
}

void loop() {
  delay(100);
}
