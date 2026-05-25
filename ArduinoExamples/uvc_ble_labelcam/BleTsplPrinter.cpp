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

static bool deviceAdvertisesPreferredService(BLEAdvertisedDevice &device) {
  return device.haveServiceUUID() &&
         device.isAdvertisingService(BLEUUID("49535343-fe7d-4ae5-8fa9-9fafd205e455"));
}

static void logAdvertisedDevice(const char *label, BLEAdvertisedDevice &device) {
  const String name = device.haveName() ? String(device.getName().c_str()) : "";
  Serial.printf(
    "%s name='%s' address=%s service=%s\r\n",
    label,
    name.c_str(),
    device.getAddress().toString().c_str(),
    device.haveServiceUUID() ? device.getServiceUUID().toString().c_str() : ""
  );
}

static bool characteristicWritable(BLERemoteCharacteristic *characteristic) {
  return characteristic != nullptr && (characteristic->canWrite() || characteristic->canWriteNoResponse());
}

static void logCharacteristic(BLERemoteCharacteristic *characteristic) {
  if (characteristic == nullptr) return;
  Serial.printf(
    "BLE characteristic uuid=%s write=%u noResponse=%u read=%u notify=%u\r\n",
    characteristic->getUUID().toString().c_str(),
    unsigned(characteristic->canWrite()),
    unsigned(characteristic->canWriteNoResponse()),
    unsigned(characteristic->canRead()),
    unsigned(characteristic->canNotify())
  );
}

static BLERemoteCharacteristic *findWritableCharacteristicInService(BLERemoteService *service) {
  if (service == nullptr) return nullptr;

  std::map<std::string, BLERemoteCharacteristic *> *characteristics = service->getCharacteristics();
  if (characteristics == nullptr) return nullptr;

  BLERemoteCharacteristic *writableWithoutReadNotify = nullptr;
  BLERemoteCharacteristic *writableWithoutRead = nullptr;
  BLERemoteCharacteristic *writable = nullptr;
  for (auto &entry : *characteristics) {
    BLERemoteCharacteristic *candidate = entry.second;
    logCharacteristic(candidate);
    if (!characteristicWritable(candidate)) continue;
    if (writableWithoutReadNotify == nullptr && !candidate->canRead() && !candidate->canNotify()) {
      writableWithoutReadNotify = candidate;
    }
    if (writableWithoutRead == nullptr && !candidate->canRead()) {
      writableWithoutRead = candidate;
    }
    if (writable == nullptr) {
      writable = candidate;
    }
  }
  if (writableWithoutReadNotify != nullptr) return writableWithoutReadNotify;
  if (writableWithoutRead != nullptr) return writableWithoutRead;
  return writable;
}

bool BleTsplPrinter::begin() {
  BLEDevice::init("labelcam-s3");
  BLEDevice::setPower(ESP_PWR_LVL_P9);
  BLEDevice::setMTU(BLE_REQUEST_MTU);
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
  BLEAdvertisedDevice *serviceFallback = nullptr;
  const int count = results != nullptr ? results->getCount() : 0;
  Serial.printf("BLE scan found %d devices\r\n", count);
  for (int i = 0; i < count; i++) {
    BLEAdvertisedDevice device = results->getDevice(i);
    const String name = device.haveName() ? String(device.getName().c_str()) : "";
    const bool knownService = deviceAdvertisesKnownService(device);
    if (name.length() > 0 || knownService) {
      logAdvertisedDevice(knownService ? "BLE candidate service" : "BLE candidate name", device);
    }
    if (nameMatchesPortalPrefixes(name)) {
      logAdvertisedDevice("BLE target by name", device);
      target = new BLEAdvertisedDevice(device);
      break;
    }
    if (serviceFallback == nullptr && deviceAdvertisesPreferredService(device)) {
      serviceFallback = new BLEAdvertisedDevice(device);
    }
  }
  scan->clearResults();
  if (target == nullptr && serviceFallback != nullptr) {
    logAdvertisedDevice("BLE target by preferred service", *serviceFallback);
    target = serviceFallback;
    serviceFallback = nullptr;
  }
  if (serviceFallback != nullptr) {
    delete serviceFallback;
  }
  if (target == nullptr) {
    _lastError = "BLE printer not found";
    return false;
  }

  if (bleClient != nullptr) {
    delete bleClient;
  }
  bleClient = BLEDevice::createClient();
  logAdvertisedDevice("BLE connecting", *target);
  if (!bleClient->connect(target)) {
    delete target;
    _lastError = "BLE connect failed";
    return false;
  }
  delete target;
  const bool mtuRequested = bleClient->setMTU(BLE_REQUEST_MTU);
  const bool connParamsRequested = bleClient->updateConnParams(
    BLE_CONN_INTERVAL_MIN,
    BLE_CONN_INTERVAL_MAX,
    BLE_CONN_LATENCY,
    BLE_CONN_TIMEOUT
  );
  delay(250);

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
        Serial.printf("BLE selected explicit characteristic %s\r\n", profile.writeCharacteristicUuid);
        break;
      }
    }
    writeCharacteristic = findWritableCharacteristicInService(service);
    if (writeCharacteristic != nullptr) {
      Serial.printf("BLE selected writable characteristic in service %s\r\n", profile.serviceUuid);
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
  const uint16_t mtu = bleClient->getMTU();
  const size_t mtuPayloadBytes = mtu > 3 ? size_t(mtu - 3) : BLE_MIN_WRITE_CHUNK_BYTES;
  effectiveChunkBytes = min(BLE_WRITE_CHUNK_BYTES, max(BLE_MIN_WRITE_CHUNK_BYTES, mtuPayloadBytes));
  Serial.printf(
    "BLE writable characteristic uuid=%s write=%u noResponse=%u mtu=%u mtuRequested=%u connParams=%u chunk=%u delay=%u\r\n",
    writeCharacteristic->getUUID().toString().c_str(),
    unsigned(writeCharacteristic->canWrite()),
    unsigned(writeCharacteristic->canWriteNoResponse()),
    unsigned(mtu),
    unsigned(mtuRequested),
    unsigned(connParamsRequested),
    unsigned(effectiveChunkBytes),
    unsigned(BLE_WRITE_DELAY_MS)
  );
  delay(500);
  return true;
}

bool BleTsplPrinter::write(const uint8_t *data, size_t len) {
  if (data == nullptr || len == 0) return true;
  if (!connected() && !connect()) return false;

  size_t offset = 0;
  size_t nextProgress = 4096;
  while (offset < len) {
    const size_t chunkLen = min(effectiveChunkBytes, len - offset);
    bool ok = true;
    if (BLE_PREFER_WRITE_WITH_RESPONSE && writeCharacteristic->canWrite()) {
      ok = writeCharacteristic->writeValue((uint8_t *)(data + offset), chunkLen, true);
      if (!ok) {
        ok = writeCharacteristic->writeValue((uint8_t *)(data + offset), chunkLen, false);
      }
    } else {
      ok = writeCharacteristic->writeValue((uint8_t *)(data + offset), chunkLen, false);
      if (!ok && writeCharacteristic->canWrite()) {
        ok = writeCharacteristic->writeValue((uint8_t *)(data + offset), chunkLen, true);
      }
    }
    if (!ok) {
      Serial.printf(
        "BLE write failed at offset=%u chunk=%u write=%u noResponse=%u\r\n",
        unsigned(offset),
        unsigned(chunkLen),
        unsigned(writeCharacteristic->canWrite()),
        unsigned(writeCharacteristic->canWriteNoResponse())
      );
      if (!connected()) {
        _lastError = "BLE disconnected during write";
        return false;
      }
      if (effectiveChunkBytes <= BLE_MIN_WRITE_CHUNK_BYTES) {
        _lastError = "BLE write failed";
        return false;
      }
      effectiveChunkBytes = max(BLE_MIN_WRITE_CHUNK_BYTES, effectiveChunkBytes / 2);
      Serial.printf("BLE write fallback chunk=%u\r\n", unsigned(effectiveChunkBytes));
      delay(max<uint32_t>(20, BLE_WRITE_DELAY_MS));
      continue;
    }
    offset += chunkLen;
    if (offset >= nextProgress || offset >= len) {
      Serial.printf("BLE write progress %u/%u\r\n", unsigned(offset), unsigned(len));
      nextProgress += 4096;
    }
    if (BLE_WRITE_DELAY_MS > 0) {
      delay(BLE_WRITE_DELAY_MS);
    }
  }
  return true;
}

const char *BleTsplPrinter::lastError() const {
  return _lastError;
}
