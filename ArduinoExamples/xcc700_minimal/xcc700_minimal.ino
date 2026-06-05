#include "XccElfLoader.h"

#include <Arduino.h>
#include "esp_heap_caps.h"

namespace {

constexpr uint32_t kBaud = 115200;
constexpr size_t kMaxElfBytes = 96 * 1024;
constexpr uint32_t kUploadTimeoutMs = 10000;

XccElfModule gModule;

extern "C" void p1_print(char *text) {
  if (text) {
    Serial.print("[guest] ");
    Serial.print(text);
  }
}

extern "C" void p1_print_int(int value) {
  Serial.print("[guest] ");
  Serial.println(value);
}

extern "C" int p1_millis() {
  return int(millis());
}

extern "C" void p1_delay(int ms) {
  delay(ms);
}

extern "C" void p1_pin_mode(int pin, int mode) {
  pinMode(pin, mode == 0 ? INPUT : OUTPUT);
}

extern "C" void p1_digital_write(int pin, int value) {
  digitalWrite(pin, value ? HIGH : LOW);
}

const XccHostSymbol kHostSymbols[] = {
    {"p1_print", reinterpret_cast<uintptr_t>(&p1_print)},
    {"p1_print_int", reinterpret_cast<uintptr_t>(&p1_print_int)},
    {"p1_millis", reinterpret_cast<uintptr_t>(&p1_millis)},
    {"p1_delay", reinterpret_cast<uintptr_t>(&p1_delay)},
    {"p1_pin_mode", reinterpret_cast<uintptr_t>(&p1_pin_mode)},
    {"p1_digital_write", reinterpret_cast<uintptr_t>(&p1_digital_write)},
};

uint32_t crc32Update(uint32_t crc, const uint8_t *data, size_t len) {
  crc = ~crc;
  for (size_t i = 0; i < len; ++i) {
    crc ^= data[i];
    for (uint8_t bit = 0; bit < 8; ++bit) {
      crc = (crc >> 1) ^ (0xedb88320UL & (0UL - (crc & 1)));
    }
  }
  return ~crc;
}

String readCommandLine() {
  String line;
  while (Serial.available()) {
    char c = char(Serial.read());
    if (c == '\n') {
      line.trim();
      return line;
    }
    if (c != '\r') {
      line += c;
    }
    if (line.length() > 120) {
      line = "";
    }
  }
  return "";
}

bool readExact(uint8_t *dst, size_t size) {
  size_t got = 0;
  uint32_t start = millis();
  while (got < size && millis() - start < kUploadTimeoutMs) {
    int available = Serial.available();
    if (available <= 0) {
      delay(1);
      continue;
    }
    size_t wanted = size - got;
    if (size_t(available) < wanted) {
      wanted = size_t(available);
    }
    int chunk = Serial.readBytes(dst + got, wanted);
    if (chunk > 0) {
      got += size_t(chunk);
      start = millis();
    }
  }
  return got == size;
}

void printHelp() {
  Serial.println();
  Serial.println("P1E xcc700 minimal ELF loader");
  Serial.println("Command: P1E_XCC700_ELF <bytes> <crc32_hex>");
  Serial.println("Host script: tools/upload_elf.py --port <port> .build/blink_led.elf");
  Serial.printf("Free heap: %u, max alloc: %u\n", ESP.getFreeHeap(), ESP.getMaxAllocHeap());
}

void handleElfUpload(const String &line) {
  size_t elfSize = 0;
  uint32_t expectedCrc = 0;
  if (sscanf(line.c_str(), "P1E_XCC700_ELF %u %x", &elfSize, &expectedCrc) != 2) {
    Serial.println("ERR bad upload header");
    return;
  }
  if (elfSize == 0 || elfSize > kMaxElfBytes) {
    Serial.printf("ERR refused ELF size %u, max is %u\n", unsigned(elfSize), unsigned(kMaxElfBytes));
    return;
  }

  uint8_t *elf = static_cast<uint8_t *>(heap_caps_malloc(elfSize, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT));
  if (!elf) {
    Serial.printf("ERR could not allocate %u bytes for upload\n", unsigned(elfSize));
    return;
  }

  Serial.printf("READY %u\n", unsigned(elfSize));
  if (!readExact(elf, elfSize)) {
    heap_caps_free(elf);
    Serial.println("ERR timed out reading ELF payload");
    return;
  }

  uint32_t actualCrc = crc32Update(0, elf, elfSize);
  if (actualCrc != expectedCrc) {
    heap_caps_free(elf);
    Serial.printf("ERR crc mismatch expected=%08x actual=%08x\n", expectedCrc, actualCrc);
    return;
  }

  Serial.printf("ELF received: %u bytes crc=%08x\n", unsigned(elfSize), actualCrc);
  XccElfLoadResult result =
      gModule.load(elf, elfSize, kHostSymbols, sizeof(kHostSymbols) / sizeof(kHostSymbols[0]));
  heap_caps_free(elf);

  if (!result.ok) {
    Serial.print("LOAD_ERROR ");
    Serial.println(result.error);
    return;
  }

  Serial.printf("LOAD_OK freeHeap=%u maxAlloc=%u\n", ESP.getFreeHeap(), ESP.getMaxAllocHeap());
  int rc = gModule.runMain();
  Serial.printf("RESULT %d\n", rc);
  Serial.printf("AFTER_RUN freeHeap=%u maxAlloc=%u\n", ESP.getFreeHeap(), ESP.getMaxAllocHeap());
}

}  // namespace

void setup() {
  Serial.begin(kBaud);
  Serial.setTimeout(100);
  delay(300);
  printHelp();
}

void loop() {
  String line = readCommandLine();
  if (line.length() == 0) {
    delay(5);
    return;
  }
  if (line == "help" || line == "?") {
    printHelp();
  } else if (line.startsWith("P1E_XCC700_ELF ")) {
    handleElfUpload(line);
  } else if (line == "unload") {
    gModule.unload();
    Serial.println("OK unloaded");
  } else {
    Serial.print("ERR unknown command: ");
    Serial.println(line);
  }
}
