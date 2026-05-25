#include <Arduino.h>

void setup() {
  Serial0.begin(115200, SERIAL_8N1, 44, 43);
}

void loop() {
  Serial0.printf("serial smoke millis=%lu\r\n", static_cast<unsigned long>(millis()));
  delay(1000);
}
