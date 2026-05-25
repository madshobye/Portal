#include <Arduino.h>

#include <ESP32USBHost4096.h>
#include <ESP32UVCDirect.h>

static ESP32UVCDirect uvc;

void setup() {
  Serial.begin(115200);
  uint32_t start = millis();
  while (!Serial && millis() - start < 3000) {
    delay(10);
  }
  Serial.println();
  Serial.println("UVC modern USB host direct test");
  Serial.printf("heap=%u psram=%u\r\n", ESP.getFreeHeap(), ESP.getFreePsram());
  Serial.println("Send g to start UVC host");
  while (true) {
    if (Serial.available() > 0) {
      int c = Serial.read();
      if (c == 'g' || c == 'G') {
        break;
      }
    }
    delay(20);
  }
  Serial.println("Starting UVC host now");

  ESP32UVCDirect::Config config;
  config.preferredWidth = 160;
  config.preferredHeight = 120;
  config.frameInterval100ns = 666666;
  config.startStreaming = true;
  uvc.setLogStream(&Serial);
  uvc.begin(config);
}

void loop() {
  static uint32_t lastMs = 0;
  if (millis() - lastMs > 3000) {
    uvc.printStatus();
    lastMs = millis();
  }
  delay(20);
}
