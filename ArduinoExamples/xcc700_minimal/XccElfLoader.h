#pragma once

#include <Arduino.h>

struct XccHostSymbol {
  const char *name;
  uintptr_t address;
};

struct XccElfLoadResult {
  bool ok;
  String error;
};

class XccElfModule {
public:
  XccElfModule();
  ~XccElfModule();

  XccElfLoadResult load(const uint8_t *elfData, size_t elfSize,
                        const XccHostSymbol *symbols, size_t symbolCount);
  int runMain();
  void unload();
  bool loaded() const { return entry_ != nullptr; }

private:
  uint8_t *text_;
  uint8_t *data_;
  size_t textSize_;
  size_t dataSize_;
  uintptr_t textAddr_;
  uintptr_t rodataAddr_;
  size_t rodataSize_;
  uintptr_t bssAddr_;
  size_t bssSize_;
  int (*entry_)();

  void *mapVirtual(uintptr_t virtualAddress, size_t width);
};
