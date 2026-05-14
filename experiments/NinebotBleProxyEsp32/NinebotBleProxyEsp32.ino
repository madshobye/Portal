#include <NimBLEDevice.h>
#include <esp_mac.h>
#include <esp_system.h>

// Owner-controlled BLE proxy/debug bridge.
// Start with FORWARD_APP_TO_NINEBOT=false to learn whether the official app writes
// anything to the clone before we involve the real vehicle.

// Fake-only app-capture mode for the official app's "add device" scan.
// Preserve the captured leading space because the real advertisement used it.
static const char *FAKE_ADV_NAME = " NinebotS2674";
static const char *REAL_NINEBOT_NAME_HINT = "madsbot";
static const char *REAL_NINEBOT_ADDRESS_HINT = "c9:4f:29:be:9e:d3";  // Optional, e.g. "aa:bb:cc:dd:ee:ff"

static const bool FORWARD_APP_TO_NINEBOT = false;
static const bool FORWARD_NINEBOT_TO_APP = true;
static const bool SCOOTER_WRITE_WITH_RESPONSE = false;
static const bool LOG_SCAN_RESULTS = false;
static const bool CAPTURE_REAL_ADV_ONLY = false;
static const bool CONNECT_TO_REAL_NINEBOT = false;
static const bool CONNECT_REAL_BEFORE_FAKE_ADV = false;
static const bool START_FAKE_AFTER_REAL_CONNECT = false;
static const bool RUN_DIRECT_READ_PROBES_AFTER_CONNECT = false;
static const bool DUMP_KNOWN_GATT_AFTER_CONNECT = true;
static const bool FAKE_INCLUDE_NINEBOT_CUSTOM_SERVICE = false;
static const bool FAKE_ADVERTISE_NUS_SERVICE = true;
static const bool FAKE_INCLUDE_NINEBOT_MANUFACTURER_DATA = true;
static const bool FAKE_MANUFACTURER_USE_ESP32_BT_ADDRESS = true;
static const uint16_t FAKE_APPEARANCE = 0x0000;
static const uint32_t REAL_SCAN_SECONDS = 12;
static const bool USE_CUSTOM_CONNECT_PARAMS = false;
static const bool FORCE_REAL_ADDRESS_RANDOM = true;
static const uint32_t PRE_CONNECT_STOP_SCAN_MS = 1500;
static const uint8_t REAL_CONNECT_ATTEMPTS = 1;
static const uint32_t REAL_RETRY_COOLDOWN_MS = 30000;
static const uint32_t ADV_CAPTURE_SECONDS = 45;

static const char *NUS_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
static const char *NUS_RX_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";  // phone/app writes here
static const char *NUS_TX_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";  // phone/app subscribes here

static const char *NINEBOT_SERVICE_UUID = "6e400001-0000-0000-006e-696e65626f74";
static const char *NINEBOT_WRITE_UUID = "6e400002-0000-0000-006e-696e65626f74";
static const char *NINEBOT_RCTP_WRITE_UUID = "6e400003-0000-0000-006e-696e65626f74";
static const char *NINEBOT_NOTIFY_UUID = "6e400004-0000-0000-006e-696e65626f74";
static const char *NINEBOT_TEST_WRITE_UUID = "6e400005-0000-0000-006e-696e65626f74";
static const char *NINEBOT_TEST_NOTIFY_UUID = "6e400006-0000-0000-006e-696e65626f74";
static const char *HM_SOFT_SERVICE_UUID = "0000ffe0-0000-1000-8000-00805f9b34fb";
static const char *HM_SOFT_DATA_UUID = "0000ffe1-0000-1000-8000-00805f9b34fb";
static const char *GAP_SERVICE_UUID = "00001800-0000-1000-8000-00805f9b34fb";
static const char *GAP_DEVICE_NAME_UUID = "00002a00-0000-1000-8000-00805f9b34fb";
static const char *GAP_APPEARANCE_UUID = "00002a01-0000-1000-8000-00805f9b34fb";
static const char *GATT_SERVICE_UUID = "00001801-0000-1000-8000-00805f9b34fb";
static const char *GATT_SERVICE_CHANGED_UUID = "00002a05-0000-1000-8000-00805f9b34fb";
static const char *DIS_SERVICE_UUID = "0000180a-0000-1000-8000-00805f9b34fb";
static const char *DIS_MANUFACTURER_UUID = "00002a29-0000-1000-8000-00805f9b34fb";
static const char *DIS_MODEL_UUID = "00002a24-0000-1000-8000-00805f9b34fb";
static const char *DIS_SERIAL_UUID = "00002a25-0000-1000-8000-00805f9b34fb";
static const char *DIS_FW_UUID = "00002a26-0000-1000-8000-00805f9b34fb";
static const char *BATTERY_SERVICE_UUID = "0000180f-0000-1000-8000-00805f9b34fb";
static const char *BATTERY_LEVEL_UUID = "00002a19-0000-1000-8000-00805f9b34fb";

// Real local Ninebot-S advertisement capture:
//   rawName=" madsbot" NUS=yes manufacturerData=56 00 c9 4f 29 be 9e d3
// The first two bytes are the vendor/prefix. The final six bytes matched that
// board's BLE address, so for "add a new Segway" tests we generate:
//   56 00 + ESP32 BT MAC
static const uint8_t FAKE_NINEBOT_MANUFACTURER_PREFIX[] = {0x56, 0x00};
static const uint8_t FAKE_NINEBOT_MANUFACTURER_FALLBACK[] = {
  0x56, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x01
};

static const uint8_t PROBE_P1_NINEBOT_S_BLE_PWD[] = {0x55, 0xaa, 0x03, 0x03, 0x01, 0x17, 0x06, 0xdb, 0xff};
static const uint8_t PROBE_P1_NINEBOT_S_SERIAL[] = {0x55, 0xaa, 0x03, 0x03, 0x01, 0x10, 0x0e, 0xda, 0xff};
static const uint8_t PROBE_P1_NINEBOT_S2_SERIAL[] = {0x55, 0xaa, 0x03, 0x21, 0x01, 0x10, 0x0e, 0xbc, 0xff};

NimBLECharacteristic *fakeTx = nullptr;
NimBLECharacteristic *fakeNinebotTx = nullptr;
NimBLECharacteristic *fakeNinebotTestTx = nullptr;
NimBLEAddress *realAddress = nullptr;
NimBLEClient *realClient = nullptr;
NimBLERemoteCharacteristic *realRx = nullptr;
NimBLERemoteCharacteristic *realTx = nullptr;
String realAddressText;
String realNameText;

bool appConnected = false;
bool appSubscribed = false;
bool realConnected = false;
bool fakeStarted = false;
bool fakeAdvertising = false;
bool directProbesSent = false;
uint32_t nextRealConnectAfterMs = 0;

const char *resetReasonName(esp_reset_reason_t reason) {
  switch (reason) {
    case ESP_RST_POWERON: return "power-on";
    case ESP_RST_EXT: return "external reset";
    case ESP_RST_SW: return "software reset";
    case ESP_RST_PANIC: return "panic/exception";
    case ESP_RST_INT_WDT: return "interrupt watchdog";
    case ESP_RST_TASK_WDT: return "task watchdog";
    case ESP_RST_WDT: return "other watchdog";
    case ESP_RST_DEEPSLEEP: return "deep sleep wake";
    case ESP_RST_BROWNOUT: return "brownout";
    case ESP_RST_SDIO: return "sdio";
    default: return "unknown";
  }
}

void coolDownRealConnect() {
  nextRealConnectAfterMs = millis() + REAL_RETRY_COOLDOWN_MS;
  Serial.print("Cooling down real Ninebot connect attempts for ms=");
  Serial.println(REAL_RETRY_COOLDOWN_MS);
}

void clearRealCandidate() {
  delete realAddress;
  realAddress = nullptr;
  realAddressText = "";
  realNameText = "";
}

String normalized(String value) {
  value.trim();
  value.toLowerCase();
  return value;
}

String hexBytes(const uint8_t *data, size_t len) {
  static const char *hex = "0123456789abcdef";
  String out;
  out.reserve(len * 3);
  for (size_t i = 0; i < len; i++) {
    if (i) out += ' ';
    out += hex[(data[i] >> 4) & 0x0f];
    out += hex[data[i] & 0x0f];
  }
  return out;
}

String hexStdString(const std::string &data) {
  return hexBytes(reinterpret_cast<const uint8_t *>(data.data()), data.size());
}

void logBytes(const char *prefix, const uint8_t *data, size_t len) {
  Serial.print(prefix);
  Serial.print(" len=");
  Serial.print(len);
  Serial.print(" ");
  Serial.println(hexBytes(data, len));
}

void buildFakeManufacturerData(uint8_t *out, size_t len) {
  if (len < sizeof(FAKE_NINEBOT_MANUFACTURER_FALLBACK)) return;

  for (size_t i = 0; i < sizeof(FAKE_NINEBOT_MANUFACTURER_FALLBACK); i++) {
    out[i] = FAKE_NINEBOT_MANUFACTURER_FALLBACK[i];
  }

  if (!FAKE_MANUFACTURER_USE_ESP32_BT_ADDRESS) return;

  uint8_t btMac[6] = {0};
  if (esp_read_mac(btMac, ESP_MAC_BT) != ESP_OK) {
    Serial.println("ESP32 BT MAC unavailable; using fallback fake manufacturer data");
    return;
  }

  out[0] = FAKE_NINEBOT_MANUFACTURER_PREFIX[0];
  out[1] = FAKE_NINEBOT_MANUFACTURER_PREFIX[1];
  for (size_t i = 0; i < sizeof(btMac); i++) {
    out[i + 2] = btMac[i];
  }
}

void notifyApp(const uint8_t *data, size_t len) {
  if (!appConnected || !appSubscribed) return;
  if (fakeTx) {
    fakeTx->setValue(data, len);
    fakeTx->notify();
  }
  if (fakeNinebotTx) {
    fakeNinebotTx->setValue(data, len);
    fakeNinebotTx->notify();
  }
  if (fakeNinebotTestTx) {
    fakeNinebotTestTx->setValue(data, len);
    fakeNinebotTestTx->notify();
  }
}

class FakeServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer *server, NimBLEConnInfo &connInfo) override {
    appConnected = true;
    Serial.print("APP connected ");
    Serial.println(connInfo.getAddress().toString().c_str());
  }

  void onDisconnect(NimBLEServer *server, NimBLEConnInfo &connInfo, int reason) override {
    appConnected = false;
    appSubscribed = false;
    Serial.print("APP disconnected reason=");
    Serial.println(reason);
    NimBLEDevice::startAdvertising();
  }
};

class FakeRxCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic *characteristic, NimBLEConnInfo &connInfo) override {
    std::string value = characteristic->getValue();
    const uint8_t *data = reinterpret_cast<const uint8_t *>(value.data());
    const size_t len = value.size();

    logBytes("APP->ESP32", data, len);

    if (!FORWARD_APP_TO_NINEBOT) {
      Serial.println("APP->Ninebot forwarding disabled");
      return;
    }

    if (!realConnected || !realRx) {
      Serial.println("APP->Ninebot dropped: real Ninebot not connected");
      return;
    }

    bool ok = realRx->writeValue(data, len, SCOOTER_WRITE_WITH_RESPONSE);
    Serial.print("APP->Ninebot forwarded ok=");
    Serial.println(ok ? "true" : "false");
  }
};

class FakeTxCallbacks : public NimBLECharacteristicCallbacks {
  void onSubscribe(NimBLECharacteristic *characteristic, NimBLEConnInfo &connInfo, uint16_t subValue) override {
    appSubscribed = subValue != 0;
    Serial.print("APP notifications ");
    Serial.println(appSubscribed ? "enabled" : "disabled");
  }
};

class ScanCallbacks : public NimBLEScanCallbacks {
  void onResult(const NimBLEAdvertisedDevice *advertisedDevice) override {
    if (realAddress) return;

    const String address = String(advertisedDevice->getAddress().toString().c_str());
    const String rawName = advertisedDevice->haveName()
      ? String(advertisedDevice->getName().c_str())
      : String("");
    const String cleanName = normalized(rawName);
    const String nameHint = normalized(String(REAL_NINEBOT_NAME_HINT));
    const String addressHint = normalized(String(REAL_NINEBOT_ADDRESS_HINT));
    const bool serviceMatches =
      advertisedDevice->isAdvertisingService(NimBLEUUID(NUS_SERVICE_UUID));
    const bool addressMatches =
      addressHint.length() > 0 && normalized(address) == addressHint;
    const bool nameMatches =
      nameHint.length() > 0 &&
      cleanName.length() > 0 &&
      (cleanName == nameHint || cleanName.indexOf(nameHint) >= 0);

    if (LOG_SCAN_RESULTS) {
      Serial.print("SCAN ");
      Serial.print(address);
      Serial.print(" rssi=");
      Serial.print(advertisedDevice->getRSSI());
      Serial.print(" name=\"");
      Serial.print(rawName);
      Serial.print("\" clean=\"");
      Serial.print(cleanName);
      Serial.print("\" nus=");
      Serial.println(serviceMatches ? "yes" : "no");
    }

    if (!addressMatches && !nameMatches && !serviceMatches) return;

    Serial.print("Found real Ninebot candidate: ");
    Serial.print(address);
    Serial.print(" name=");
    Serial.print(rawName);
    Serial.print(" matchedBy=");
    Serial.println(addressMatches ? "address" : (nameMatches ? "name" : "service"));

    realAddress = new NimBLEAddress(advertisedDevice->getAddress());
    realAddressText = address;
    realNameText = rawName;
    NimBLEDevice::getScan()->stop();
  }
};

class AdvCaptureCallbacks : public NimBLEScanCallbacks {
  void onResult(const NimBLEAdvertisedDevice *advertisedDevice) override {
    const String address = String(advertisedDevice->getAddress().toString().c_str());
    const String rawName = advertisedDevice->haveName()
      ? String(advertisedDevice->getName().c_str())
      : String("");
    const String cleanName = normalized(rawName);
    const String nameHint = normalized(String(REAL_NINEBOT_NAME_HINT));
    const String addressHint = normalized(String(REAL_NINEBOT_ADDRESS_HINT));
    const bool addressMatches =
      addressHint.length() > 0 && normalized(address) == addressHint;
    const bool nameMatches =
      nameHint.length() > 0 &&
      cleanName.length() > 0 &&
      (cleanName == nameHint || cleanName.indexOf(nameHint) >= 0);
    const bool nusMatches = advertisedDevice->isAdvertisingService(NimBLEUUID(NUS_SERVICE_UUID));
    const bool customMatches = advertisedDevice->isAdvertisingService(NimBLEUUID(NINEBOT_SERVICE_UUID));

    if (!addressMatches && !nameMatches && !nusMatches && !customMatches) return;

    Serial.println("REAL ADV MATCH");
    Serial.print("  address=");
    Serial.println(address);
    Serial.print("  rssi=");
    Serial.println(advertisedDevice->getRSSI());
    Serial.print("  rawName=\"");
    Serial.print(rawName);
    Serial.print("\" clean=\"");
    Serial.print(cleanName);
    Serial.println("\"");
    Serial.print("  matchedBy address=");
    Serial.print(addressMatches ? "yes" : "no");
    Serial.print(" name=");
    Serial.print(nameMatches ? "yes" : "no");
    Serial.print(" nus=");
    Serial.print(nusMatches ? "yes" : "no");
    Serial.print(" custom=");
    Serial.println(customMatches ? "yes" : "no");

    if (advertisedDevice->haveManufacturerData()) {
      const std::string manufacturerData = advertisedDevice->getManufacturerData();
      Serial.print("  manufacturerData len=");
      Serial.print(manufacturerData.size());
      Serial.print(" ");
      Serial.println(hexStdString(manufacturerData));
    } else {
      Serial.println("  manufacturerData none");
    }

    if (advertisedDevice->haveServiceData()) {
      const std::string serviceData = advertisedDevice->getServiceData();
      Serial.print("  serviceData len=");
      Serial.print(serviceData.size());
      Serial.print(" ");
      Serial.println(hexStdString(serviceData));
    } else {
      Serial.println("  serviceData none");
    }
  }
};

class RealClientCallbacks : public NimBLEClientCallbacks {
  void onConnect(NimBLEClient *client) override {
    Serial.println("ESP32 connected to real Ninebot");
  }

  void onDisconnect(NimBLEClient *client, int reason) override {
    realConnected = false;
    realRx = nullptr;
    realTx = nullptr;
    directProbesSent = false;
    Serial.print("Real Ninebot disconnected reason=");
    Serial.println(reason);
  }
};

void onRealNotify(
  NimBLERemoteCharacteristic *characteristic,
  uint8_t *data,
  size_t len,
  bool isNotify
) {
  logBytes("Ninebot->ESP32", data, len);
  if (FORWARD_NINEBOT_TO_APP) notifyApp(data, len);
}

void writeRealProbe(const char *label, const uint8_t *data, size_t len) {
  if (!realConnected || !realRx) {
    Serial.print("Direct probe skipped, real Ninebot not connected: ");
    Serial.println(label);
    return;
  }

  Serial.print("ESP32->Ninebot probe ");
  Serial.print(label);
  Serial.print(" len=");
  Serial.print(len);
  Serial.print(" ");
  Serial.println(hexBytes(data, len));

  const bool ok = realRx->writeValue(data, len, SCOOTER_WRITE_WITH_RESPONSE);
  Serial.print("ESP32->Ninebot probe write ok=");
  Serial.println(ok ? "true" : "false");
}

void runDirectReadProbes() {
  if (!RUN_DIRECT_READ_PROBES_AFTER_CONNECT || directProbesSent) return;
  directProbesSent = true;

  Serial.println("Direct read probes start; waiting for Ninebot->ESP32 notifications");
  delay(500);
  writeRealProbe("P1 Ninebot-S BLE pwd 0x03/0x17", PROBE_P1_NINEBOT_S_BLE_PWD, sizeof(PROBE_P1_NINEBOT_S_BLE_PWD));
  delay(1200);
  writeRealProbe("P1 Ninebot-S serial 0x03/0x10", PROBE_P1_NINEBOT_S_SERIAL, sizeof(PROBE_P1_NINEBOT_S_SERIAL));
  delay(1200);
  writeRealProbe("P1 Ninebot-S2 serial 0x21/0x10", PROBE_P1_NINEBOT_S2_SERIAL, sizeof(PROBE_P1_NINEBOT_S2_SERIAL));
  delay(1200);
  Serial.println("Direct read probes sent");
}

void logKnownCharacteristic(NimBLERemoteService *service, const char *label, const char *uuid) {
  NimBLERemoteCharacteristic *characteristic = service->getCharacteristic(uuid);
  Serial.print("  char ");
  Serial.print(label);
  Serial.print(" ");
  Serial.print(uuid);
  if (!characteristic) {
    Serial.println(" missing");
    return;
  }

  Serial.print(" props=");
  bool anyProp = false;
  if (characteristic->canRead()) {
    Serial.print("read");
    anyProp = true;
  }
  if (characteristic->canWrite()) {
    Serial.print(anyProp ? ",write" : "write");
    anyProp = true;
  }
  if (characteristic->canWriteNoResponse()) {
    Serial.print(anyProp ? ",writeNR" : "writeNR");
    anyProp = true;
  }
  if (characteristic->canNotify()) {
    Serial.print(anyProp ? ",notify" : "notify");
    anyProp = true;
  }
  if (characteristic->canIndicate()) {
    Serial.print(anyProp ? ",indicate" : "indicate");
    anyProp = true;
  }
  if (!anyProp) Serial.print("none");
  Serial.println();
}

void dumpKnownService(const char *label, const char *uuid, const char *const *charLabels, const char *const *charUuids, size_t charCount) {
  Serial.print("GATT service probe ");
  Serial.print(label);
  Serial.print(" ");
  Serial.print(uuid);

  NimBLERemoteService *service = realClient ? realClient->getService(uuid) : nullptr;
  if (!service) {
    Serial.println(" missing");
    return;
  }

  Serial.println(" present");
  for (size_t i = 0; i < charCount; i++) {
    logKnownCharacteristic(service, charLabels[i], charUuids[i]);
  }
}

void dumpKnownGattProfile() {
  if (!DUMP_KNOWN_GATT_AFTER_CONNECT || !realClient || !realClient->isConnected()) return;

  Serial.println("Known GATT fingerprint start");

  const char *const nusLabels[] = {"write", "notify"};
  const char *const nusUuids[] = {NUS_RX_UUID, NUS_TX_UUID};
  dumpKnownService("Nordic UART", NUS_SERVICE_UUID, nusLabels, nusUuids, 2);

  const char *const ninebotLabels[] = {"write", "rctp-write", "notify", "test-write", "test-notify"};
  const char *const ninebotUuids[] = {
    NINEBOT_WRITE_UUID,
    NINEBOT_RCTP_WRITE_UUID,
    NINEBOT_NOTIFY_UUID,
    NINEBOT_TEST_WRITE_UUID,
    NINEBOT_TEST_NOTIFY_UUID
  };
  dumpKnownService("Ninebot custom", NINEBOT_SERVICE_UUID, ninebotLabels, ninebotUuids, 5);

  const char *const hmLabels[] = {"data"};
  const char *const hmUuids[] = {HM_SOFT_DATA_UUID};
  dumpKnownService("HMSoft legacy", HM_SOFT_SERVICE_UUID, hmLabels, hmUuids, 1);

  const char *const gapLabels[] = {"device-name", "appearance"};
  const char *const gapUuids[] = {GAP_DEVICE_NAME_UUID, GAP_APPEARANCE_UUID};
  dumpKnownService("Generic Access", GAP_SERVICE_UUID, gapLabels, gapUuids, 2);

  const char *const gattLabels[] = {"service-changed"};
  const char *const gattUuids[] = {GATT_SERVICE_CHANGED_UUID};
  dumpKnownService("Generic Attribute", GATT_SERVICE_UUID, gattLabels, gattUuids, 1);

  const char *const disLabels[] = {"manufacturer", "model", "serial", "firmware"};
  const char *const disUuids[] = {DIS_MANUFACTURER_UUID, DIS_MODEL_UUID, DIS_SERIAL_UUID, DIS_FW_UUID};
  dumpKnownService("Device Information", DIS_SERVICE_UUID, disLabels, disUuids, 4);

  const char *const batteryLabels[] = {"battery-level"};
  const char *const batteryUuids[] = {BATTERY_LEVEL_UUID};
  dumpKnownService("Battery", BATTERY_SERVICE_UUID, batteryLabels, batteryUuids, 1);

  Serial.println("Known GATT fingerprint end");
}

void prepareFakePeripheral() {
  if (fakeStarted) return;

  NimBLEServer *server = NimBLEDevice::createServer();
  server->setCallbacks(new FakeServerCallbacks());

  NimBLEService *nusService = server->createService(NUS_SERVICE_UUID);
  NimBLECharacteristic *fakeRx = nusService->createCharacteristic(
    NUS_RX_UUID,
    NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR
  );
  fakeRx->setCallbacks(new FakeRxCallbacks());

  fakeTx = nusService->createCharacteristic(NUS_TX_UUID, NIMBLE_PROPERTY::NOTIFY);
  fakeTx->setCallbacks(new FakeTxCallbacks());

  nusService->start();

  if (FAKE_INCLUDE_NINEBOT_CUSTOM_SERVICE) {
    NimBLEService *ninebotService = server->createService(NINEBOT_SERVICE_UUID);
    NimBLECharacteristic *ninebotWrite = ninebotService->createCharacteristic(
      NINEBOT_WRITE_UUID,
      NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR
    );
    ninebotWrite->setCallbacks(new FakeRxCallbacks());

    NimBLECharacteristic *ninebotRctpWrite = ninebotService->createCharacteristic(
      NINEBOT_RCTP_WRITE_UUID,
      NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR
    );
    ninebotRctpWrite->setCallbacks(new FakeRxCallbacks());

    fakeNinebotTx = ninebotService->createCharacteristic(NINEBOT_NOTIFY_UUID, NIMBLE_PROPERTY::NOTIFY);
    fakeNinebotTx->setCallbacks(new FakeTxCallbacks());

    NimBLECharacteristic *ninebotTestWrite = ninebotService->createCharacteristic(
      NINEBOT_TEST_WRITE_UUID,
      NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR
    );
    ninebotTestWrite->setCallbacks(new FakeRxCallbacks());

    fakeNinebotTestTx = ninebotService->createCharacteristic(NINEBOT_TEST_NOTIFY_UUID, NIMBLE_PROPERTY::NOTIFY);
    fakeNinebotTestTx->setCallbacks(new FakeTxCallbacks());

    ninebotService->start();
  }

  NimBLEAdvertising *advertising = NimBLEDevice::getAdvertising();
  advertising->setName(FAKE_ADV_NAME);
  advertising->setAppearance(FAKE_APPEARANCE);
  if (FAKE_ADVERTISE_NUS_SERVICE) {
    advertising->addServiceUUID(NUS_SERVICE_UUID);
  }
  if (FAKE_INCLUDE_NINEBOT_CUSTOM_SERVICE) {
    advertising->addServiceUUID(NINEBOT_SERVICE_UUID);
  }
  if (FAKE_INCLUDE_NINEBOT_MANUFACTURER_DATA) {
    uint8_t manufacturerBytes[sizeof(FAKE_NINEBOT_MANUFACTURER_FALLBACK)] = {0};
    buildFakeManufacturerData(manufacturerBytes, sizeof(manufacturerBytes));
    std::string manufacturerData(
      reinterpret_cast<const char *>(manufacturerBytes),
      sizeof(manufacturerBytes)
    );
    advertising->setManufacturerData(manufacturerData);
    Serial.print("Fake manufacturer data ");
    Serial.print(hexBytes(manufacturerBytes, sizeof(manufacturerBytes)));
    Serial.print(" source=");
    Serial.println(FAKE_MANUFACTURER_USE_ESP32_BT_ADDRESS ? "esp32-bt-mac" : "fallback");
  }
  advertising->enableScanResponse(true);

  fakeStarted = true;
  Serial.print("Prepared fake Ninebot GATT server as ");
  Serial.println(FAKE_ADV_NAME);
  Serial.print("Fake advertised profile name=\"");
  Serial.print(FAKE_ADV_NAME);
  Serial.print("\" nus=");
  Serial.print(FAKE_ADVERTISE_NUS_SERVICE ? "yes" : "no");
  Serial.print(" custom=");
  Serial.print(FAKE_INCLUDE_NINEBOT_CUSTOM_SERVICE ? "yes" : "no");
  Serial.print(" manufacturer=");
  Serial.println(FAKE_INCLUDE_NINEBOT_MANUFACTURER_DATA ? "yes" : "no");
}

void startFakeAdvertising() {
  prepareFakePeripheral();
  if (fakeAdvertising) return;
  NimBLEDevice::startAdvertising();
  fakeAdvertising = true;
  Serial.print("Advertising fake Ninebot as ");
  Serial.println(FAKE_ADV_NAME);
}

bool scanForRealNinebot(uint32_t seconds = REAL_SCAN_SECONDS) {
  clearRealCandidate();

  NimBLEScan *scan = NimBLEDevice::getScan();
  scan->setScanCallbacks(new ScanCallbacks(), false);
  scan->setActiveScan(true);
  scan->setDuplicateFilter(true);
  scan->setInterval(45);
  scan->setWindow(30);
  scan->start(seconds, false, true);
  Serial.print("Scan returned candidate=");
  Serial.println(realAddress ? "yes" : "no");
  return realAddress != nullptr;
}

void captureRealAdvertisements(uint32_t seconds = ADV_CAPTURE_SECONDS) {
  Serial.print("Capturing real Segway advertisements for seconds=");
  Serial.println(seconds);
  Serial.println("Keep the real Segway on and nearby; fake advertising is disabled in this mode.");

  NimBLEScan *scan = NimBLEDevice::getScan();
  scan->setScanCallbacks(new AdvCaptureCallbacks(), false);
  scan->setActiveScan(true);
  scan->setDuplicateFilter(false);
  scan->setInterval(45);
  scan->setWindow(30);
  scan->start(seconds, false, true);

  Serial.println("Advertisement capture complete");
}

bool connectRealNinebot() {
  if (!realAddress) {
    Serial.println("connectRealNinebot skipped: no candidate");
    return false;
  }

  Serial.println("Stopping scanner before GATT connect");
  NimBLEDevice::getScan()->stop();
  delay(PRE_CONNECT_STOP_SCAN_MS);

  if (!realClient) {
    realClient = NimBLEDevice::createClient();
    realClient->setClientCallbacks(new RealClientCallbacks(), false);
    if (USE_CUSTOM_CONNECT_PARAMS) {
      realClient->setConnectionParams(48, 72, 0, 400);
      Serial.println("Using custom conservative connection params");
    } else {
      Serial.println("Using NimBLE default connection params");
    }
    realClient->setConnectTimeout(20);
  } else if (realClient->isConnected()) {
    Serial.println("Existing real client is connected; disconnecting before retry");
    realClient->disconnect();
    delay(500);
  }

  Serial.print("Connecting to real Ninebot candidate ");
  Serial.print(realAddressText);
  Serial.print(" name=\"");
  Serial.print(realNameText);
  Serial.println("\"");

  bool gattConnected = false;
  for (uint8_t attempt = 1; attempt <= REAL_CONNECT_ATTEMPTS; attempt++) {
    Serial.print("Real Ninebot GATT connect attempt ");
    Serial.print(attempt);
    Serial.print("/");
    Serial.println(REAL_CONNECT_ATTEMPTS);

    // Ninebot BLE modules commonly advertise with a random/static address.
    // Address-only connects can fail if NimBLE assumes the address is public.
    NimBLEAddress connectAddress(
      realAddressText.c_str(),
      FORCE_REAL_ADDRESS_RANDOM ? 1 : 0
    );
    Serial.print("Real Ninebot address type=");
    Serial.println(FORCE_REAL_ADDRESS_RANDOM ? "random" : "public");

    if (realClient->connect(connectAddress)) {
      gattConnected = true;
      break;
    }
    Serial.println("Real Ninebot GATT connect attempt failed");
    delay(900);
  }

  if (!gattConnected) {
    Serial.println("Failed connecting to real Ninebot; keeping NimBLE client allocated to avoid failed-connect cleanup crash");
    return false;
  }

  Serial.println("Real Ninebot GATT connected; discovering Nordic UART service");

  NimBLERemoteService *service = realClient->getService(NUS_SERVICE_UUID);
  if (!service) {
    Serial.println("Real Ninebot NUS service not found");
    realClient->disconnect();
    return false;
  }

  realRx = service->getCharacteristic(NUS_RX_UUID);
  realTx = service->getCharacteristic(NUS_TX_UUID);
  if (!realRx || !realTx) {
    Serial.print("Real Ninebot NUS characteristics not found rx=");
    Serial.print(realRx ? "yes" : "no");
    Serial.print(" tx=");
    Serial.println(realTx ? "yes" : "no");
    realClient->disconnect();
    return false;
  }

  Serial.print("Real RX props write=");
  Serial.print(realRx->canWrite() ? "yes" : "no");
  Serial.print(" writeNR=");
  Serial.println(realRx->canWriteNoResponse() ? "yes" : "no");
  Serial.print("Real TX props notify=");
  Serial.println(realTx->canNotify() ? "yes" : "no");

  if (!realTx->canNotify() || !realTx->subscribe(true, onRealNotify)) {
    Serial.println("Real Ninebot notify subscribe failed");
    realClient->disconnect();
    return false;
  }

  realConnected = true;
  Serial.println("Real Ninebot bridge ready");
  dumpKnownGattProfile();
  runDirectReadProbes();
  return true;
}

void setup() {
  Serial.begin(115200);
  delay(800);
  Serial.println();
  Serial.println("Ninebot BLE proxy starting");
  Serial.print("ESP32 reset reason=");
  Serial.println(resetReasonName(esp_reset_reason()));
  Serial.print("Real name hint=\"");
  Serial.print(REAL_NINEBOT_NAME_HINT);
  Serial.print("\" address hint=\"");
  Serial.print(REAL_NINEBOT_ADDRESS_HINT);
  Serial.println("\"");

  NimBLEDevice::init(FAKE_ADV_NAME);
  NimBLEDevice::setPower(ESP_PWR_LVL_P3);
  NimBLEDevice::setMTU(185);

  if (CAPTURE_REAL_ADV_ONLY) {
    captureRealAdvertisements();
    return;
  }

  const bool fakeMayBeUsed =
    !CONNECT_TO_REAL_NINEBOT ||
    !CONNECT_REAL_BEFORE_FAKE_ADV ||
    START_FAKE_AFTER_REAL_CONNECT;
  if (fakeMayBeUsed) prepareFakePeripheral();

  if (!CONNECT_TO_REAL_NINEBOT) {
    Serial.println("Real Ninebot connection disabled; advertising fake BLE only");
    startFakeAdvertising();
    return;
  }

  if (!CONNECT_REAL_BEFORE_FAKE_ADV) startFakeAdvertising();

  Serial.println(
    CONNECT_REAL_BEFORE_FAKE_ADV
      ? "Scanning for real Ninebot before fake advertising..."
      : "Scanning for real Ninebot..."
  );
  if (scanForRealNinebot()) {
    const bool connected = connectRealNinebot();
    if (connected && CONNECT_REAL_BEFORE_FAKE_ADV && START_FAKE_AFTER_REAL_CONNECT) {
      startFakeAdvertising();
    } else if (!connected) {
      clearRealCandidate();
      coolDownRealConnect();
    }
  } else {
    Serial.println("Real Ninebot not found yet; will retry in loop");
  }
}

void loop() {
  if (!CONNECT_TO_REAL_NINEBOT) {
    delay(1000);
    return;
  }

  if (!realConnected) {
    const uint32_t now = millis();
    if (nextRealConnectAfterMs && (int32_t)(now - nextRealConnectAfterMs) < 0) {
      Serial.print("Real Ninebot connect cooldown remaining ms=");
      Serial.println(nextRealConnectAfterMs - now);
      delay(3000);
      return;
    }

    Serial.println("Retry scan/connect for real Ninebot");
    if (realAddress) {
      Serial.print("Using pending real Ninebot candidate ");
      Serial.println(realAddressText);
    } else {
      scanForRealNinebot();
    }

    if (realAddress) {
      const bool connected = connectRealNinebot();
      Serial.print("Real Ninebot connect attempt result=");
      Serial.println(connected ? "connected" : "not-connected");
      if (connected && CONNECT_REAL_BEFORE_FAKE_ADV && START_FAKE_AFTER_REAL_CONNECT) {
        startFakeAdvertising();
      } else if (!connected) {
        clearRealCandidate();
        coolDownRealConnect();
      }
    } else {
      Serial.println("No real Ninebot candidate available after scan");
    }
  } else if (START_FAKE_AFTER_REAL_CONNECT && !fakeAdvertising) {
    startFakeAdvertising();
  }
  delay(3000);
}
