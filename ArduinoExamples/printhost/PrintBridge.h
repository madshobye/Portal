#pragma once

#include <Arduino.h>

void printBridgeBegin();
void printBridgeHandleDataChannelOpen();
bool printBridgeHandleDataChannelMessage(const char *msg, size_t len);
void printBridgeHandleDataChannelClose();
bool printBridgeSendUsbTestLabel();
