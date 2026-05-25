#include <Arduino.h>
#include "p1_embed_firmware.h"

struct UartState {
  HardwareSerial* serial;
  bool active;
  int rxPin;
  int txPin;
  int baud;
};

static UartState g_uarts[3] = {
  { nullptr, false, -1, -1, 0 },
  { &Serial1, false, -1, -1, 0 },
  { &Serial2, false, -1, -1, 0 },
};

static bool uartValidId(int uart) {
  return uart == 1 || uart == 2;
}

static bool uartTransportPin(int pin) {
  return pin == 1 || pin == 3;
}

static bool uartFlashPin(int pin) {
  return pin >= 6 && pin <= 11;
}

static bool uartValidRxPin(int pin) {
  if (pin < 0 || pin > 39) return false;
  if (uartTransportPin(pin) || uartFlashPin(pin)) return false;
  return true;
}

static bool uartValidTxPin(int pin) {
  if (pin < 0 || pin > 33) return false;
  if (uartTransportPin(pin) || uartFlashPin(pin)) return false;
  return true;
}

void uartManagerBegin() {
  for (int i = 1; i <= 2; i++) {
    g_uarts[i].active = false;
    g_uarts[i].rxPin = -1;
    g_uarts[i].txPin = -1;
    g_uarts[i].baud = 0;
  }
}

bool uartBegin(int uart, int rxPin, int txPin, int baud) {
  if (!uartValidId(uart)) {
    scriptErrorSet("binding", "uart_bad_id", "Only UART1 and UART2 are available to Wrench", "\"uart\":" + String(uart));
    return false;
  }
  if (rxPin == txPin || !uartValidRxPin(rxPin) || !uartValidTxPin(txPin)) {
    scriptErrorSet("binding", "uart_bad_pins", "UART pins are invalid or reserved", "\"uart\":" + String(uart) + ",\"rx\":" + String(rxPin) + ",\"tx\":" + String(txPin));
    return false;
  }
  if (baud < 300 || baud > 2000000) {
    scriptErrorSet("binding", "uart_bad_baud", "UART baud is out of range", "\"uart\":" + String(uart) + ",\"baud\":" + String(baud));
    return false;
  }

  HardwareSerial* serial = g_uarts[uart].serial;
  if (!serial) return false;
  serial->end();
  serial->begin((uint32_t)baud, SERIAL_8N1, rxPin, txPin);
  g_uarts[uart].active = true;
  g_uarts[uart].rxPin = rxPin;
  g_uarts[uart].txPin = txPin;
  g_uarts[uart].baud = baud;
  return true;
}

bool uartEnd(int uart) {
  if (!uartValidId(uart)) return false;
  if (g_uarts[uart].serial) g_uarts[uart].serial->end();
  g_uarts[uart].active = false;
  g_uarts[uart].rxPin = -1;
  g_uarts[uart].txPin = -1;
  g_uarts[uart].baud = 0;
  return true;
}

int uartAvailable(int uart) {
  if (!uartValidId(uart) || !g_uarts[uart].active || !g_uarts[uart].serial) return 0;
  return g_uarts[uart].serial->available();
}

int uartReadByte(int uart) {
  if (!uartValidId(uart) || !g_uarts[uart].active || !g_uarts[uart].serial) return -1;
  if (!g_uarts[uart].serial->available()) return -1;
  return g_uarts[uart].serial->read();
}

String uartReadString(int uart, int maxLen) {
  String out;
  if (!uartValidId(uart) || !g_uarts[uart].active || !g_uarts[uart].serial) return out;
  maxLen = constrain(maxLen, 1, P1_EMBED_UART_READ_STRING_MAX);
  out.reserve(maxLen);
  while (g_uarts[uart].serial->available() && out.length() < (size_t)maxLen) {
    out += (char)g_uarts[uart].serial->read();
  }
  return out;
}

int uartWriteString(int uart, const String& value) {
  if (!uartValidId(uart) || !g_uarts[uart].active || !g_uarts[uart].serial) return -1;
  return (int)g_uarts[uart].serial->write((const uint8_t*)value.c_str(), value.length());
}

int uartWriteByte(int uart, int value) {
  if (!uartValidId(uart) || !g_uarts[uart].active || !g_uarts[uart].serial) return -1;
  return (int)g_uarts[uart].serial->write((uint8_t)(value & 0xff));
}

String uartStatusJson() {
  String out = "{\"ports\":[";
  for (int uart = 1; uart <= 2; uart++) {
    if (uart > 1) out += ",";
    out += "{";
    out += "\"uart\":" + String(uart);
    out += ",\"active\":" + String(g_uarts[uart].active ? "true" : "false");
    out += ",\"rx\":" + String(g_uarts[uart].rxPin);
    out += ",\"tx\":" + String(g_uarts[uart].txPin);
    out += ",\"baud\":" + String(g_uarts[uart].baud);
    out += ",\"available\":" + String(uartAvailable(uart));
    out += "}";
  }
  out += "],\"reserved\":{\"transportUart\":0,\"transportPins\":[1,3],\"flashPins\":[6,7,8,9,10,11]}}";
  return out;
}
