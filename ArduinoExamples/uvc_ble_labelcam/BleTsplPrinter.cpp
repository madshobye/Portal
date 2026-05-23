#include "BleTsplPrinter.h"
#include "Config.h"

#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEClient.h>
#include <BLEScan.h>
#include <map>
#include <string>

static BLEClient *bleClient = nullptr;
static BLERemoteCharacteristic *writeCharacteristic = nullptr;
static size_t effectiveChunkBytes = BLE_WRITE_CHUNK_BYTES;

static bool nameMatchesPortalPrefixes(const String &name) {
  if (name.length() == 0) return false;
  for (size_t i = 0; i < sizeof(BLE_PRINTER_NAME_PREFIXES) / sizeof(BLE_PRINTER_NAME_PREFIXES[0]); i++) {
    if (name.startsWith(BLE_PRINTER_NAME_PREFIXES[i])) {
      return true;
    }
  }
  return false;
}

static bool deviceAdvertisesKnownService(BLEAdvertisedDevice &device) {
  if (!device.haveServiceUUID()) return false;
  for (size_t i = 0; i < sizeof(BLE_PRINTER_PROFILES) / sizeof(BLE_PRINTER_PROFILES[0]); i++) {
    if (device.isAdvertisingService(BLEUUID(BLE_PRINTER_PROFILES[i].serviceUuid))) {
      return true;
    }
  }
  return false;
}

static bool characteristicWritable(BLERemoteCharacteristic *characteristic) {
  return characteristic != nullptr && (characteristic->canWrite() || characteristic->canWriteNoResponse());
}

static BLERemoteCharacteristic *findWritableCharacteristicInService(BLERemoteService *service) {
  if (service == nullptr) return nullptr;

  std::map<std::string, BLERemoteCharacteristic *> *characteristics = service->getCharacteristics();
  if (characteristics == nullptr) return nullptr;

  BLERemoteCharacteristic *fallback = nullptr;
  for (auto &entry : *characteristics) {
    BLERemoteCharacteristic *candidate = entry.second;
    if (!characteristicWritable(candidate)) continue;
    if (candidate->canWriteNoResponse()) {
      return candidate;
    }
    if (fallback == nullptr) {
      fallback = candidate;
    }
  }
  return fallback;
}

bool BleTsplPrinter::begin() {
  BLEDevice::init("labelcam-s3");
  BLEDevice::setPower(ESP_PWR_LVL_P9);
  return true;
}

bool BleTsplPrinter::connected() const {
  return bleClient != nullptr && bleClient->isConnected() && writeCharacteristic != nullptr;
}

bool BleTsplPrinter::connect() {
  if (connected()) return true;

  BLEScan *scan = BLEDevice::getScan();
  scan->setActiveScan(true);
  BLEScanResults *results = scan->start(BLE_SCAN_SECONDS, false);
  BLEAdvertisedDevice *target = nullptr;
  const int count = results != nullptr ? results->getCount() : 0;
  for (int i = 0; i < count; i++) {
    BLEAdvertisedDevice device = results->getDevice(i);
    const String name = device.haveName() ? String(device.getName().c_str()) : "";
    if (nameMatchesPortalPrefixes(name)) {
      target = new BLEAdvertisedDevice(device);
      break;
    }
    if (deviceAdvertisesKnownService(device)) {
      target = new BLEAdvertisedDevice(device);
      break;
    }
  }
  scan->clearResults();
  if (target == nullptr) {
    _lastError = "BLE printer not found";
    return false;
  }

  if (bleClient != nullptr) {
    delete bleClient;
  }
  bleClient = BLEDevice::createClient();
  if (!bleClient->connect(target)) {
    delete target;
    _lastError = "BLE connect failed";
    return false;
  }
  delete target;

  writeCharacteristic = nullptr;
  for (size_t i = 0; i < sizeof(BLE_PRINTER_PROFILES) / sizeof(BLE_PRINTER_PROFILES[0]); i++) {
    const BlePrinterProfile &profile = BLE_PRINTER_PROFILES[i];
    BLERemoteService *service = bleClient->getService(BLEUUID(profile.serviceUuid));
    if (service == nullptr) {
      continue;
    }
    if (profile.writeCharacteristicUuid != nullptr && strlen(profile.writeCharacteristicUuid) > 0) {
      BLERemoteCharacteristic *candidate = service->getCharacteristic(BLEUUID(profile.writeCharacteristicUuid));
      if (characteristicWritable(candidate)) {
        writeCharacteristic = candidate;
        break;
      }
    }
    writeCharacteristic = findWritableCharacteristicInService(service);
    if (writeCharacteristic != nullptr) {
      break;
    }
  }

  if (!characteristicWritable(writeCharacteristic)) {
    _lastError = "BLE writable characteristic missing";
    bleClient->disconnect();
    writeCharacteristic = nullptr;
    return false;
  }
  _lastError = "";
  effectiveChunkBytes = BLE_WRITE_CHUNK_BYTES;
  return true;
}

bool BleTsplPrinter::write(const uint8_t *data, size_t len) {
  if (data == nullptr || len == 0) return true;
  if (!connected() && !connect()) return false;

  size_t offset = 0;
  while (offset < len) {
    const size_t chunkLen = min(effectiveChunkBytes, len - offset);
    bool ok = true;
    if (!BLE_PREFER_WRITE_WITH_RESPONSE && writeCharacteristic->canWriteNoResponse()) {
      ok = writeCharacteristic->writeValue((uint8_t *)(data + offset), chunkLen, false);
    } else {
      ok = writeCharacteristic->writeValue((uint8_t *)(data + offset), chunkLen, true);
    }
    if (!ok) {
      if (effectiveChunkBytes <= BLE_MIN_WRITE_CHUNK_BYTES) {
        _lastError = "BLE write failed";
        return false;
      }
      effectiveChunkBytes = max(BLE_MIN_WRITE_CHUNK_BYTES, effectiveChunkBytes / 2);
      Serial.printf("BLE write fallback chunk=%u\r\n", unsigned(effectiveChunkBytes));
      continue;
    }
    offset += chunkLen;
    if (BLE_WRITE_DELAY_MS > 0) {
      delay(BLE_WRITE_DELAY_MS);
    }
  }
  return true;
}

const char *BleTsplPrinter::lastError() const {
  return _lastError;
}
