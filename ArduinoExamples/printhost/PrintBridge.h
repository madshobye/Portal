#pragma once

#include <Arduino.h>

void printBridgeBegin();
bool printBridgeWaitForPrinterReady(uint32_t timeoutMs);
bool printBridgePreparePrintResources();
void printBridgeHandleDataChannelOpen();
bool printBridgeHandleDataChannelMessage(const char *msg, size_t len);
void printBridgeHandleDataChannelClose();
