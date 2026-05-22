#pragma once

#include <Arduino.h>

void usbPrinterHostBegin();
bool usbPrinterHostReady();
bool usbPrinterHostWrite(const uint8_t *data, size_t len);
size_t usbPrinterHostPendingBytes();
bool usbPrinterHostWaitForPendingBytes(size_t maxPendingBytes, uint32_t timeoutMs);
bool usbPrinterHostEndJob();
