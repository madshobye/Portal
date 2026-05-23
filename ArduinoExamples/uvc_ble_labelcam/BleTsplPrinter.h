#pragma once

#include <Arduino.h>

class BleTsplPrinter {
public:
  bool begin();
  bool connected() const;
  bool connect();
  bool write(const uint8_t *data, size_t len);
  const char *lastError() const;

private:
  const char *_lastError = "";
};

