#include <WiFi.h>
#include <peer.h>
#include "PrintBridge.h"

extern const char *WIFI_SSID;
extern const char *WIFI_PASSWORD;

const char *HOSTNAME = "printhostsdfsdfdsf";

void peerBegin();
void peerLoop();

void handleSerialCommands() {
  static String command;

  while (Serial.available() > 0) {
    const char ch = char(Serial.read());
    if (ch == '\r') {
      continue;
    }
    if (ch != '\n') {
      command += ch;
      if (command.length() > 64) {
        command = "";
      }
      continue;
    }

    command.trim();
    if (command == "reboot" || command == "restart") {
      Serial.println("Rebooting ESP32...");
      Serial.flush();
      ESP.restart();
    } else if (command.length() > 0) {
      Serial.print("Unknown command: ");
      Serial.println(command);
      Serial.println("Available commands: reboot");
    }
    command = "";
  }
}

void setup() {
  Serial.begin(115200);
  Serial.setDebugOutput(true);
  delay(300);

  WiFi.mode(WIFI_STA);
  WiFi.setHostname(HOSTNAME);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print(".");
    delay(500);
  }
  Serial.println();

  Serial.print("Hostname: ");
  Serial.println(WiFi.getHostname());
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());

  printBridgeBegin();
  peerBegin();
}

void loop() {
  handleSerialCommands();
  peerLoop();
}
