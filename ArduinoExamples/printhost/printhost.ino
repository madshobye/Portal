#include <WiFi.h>
#include <peer.h>
#include "PrintBridge.h"

extern const char *WIFI_SSID;
extern const char *WIFI_PASSWORD;

const char *HOSTNAME = "printhostsdfsdfdsf";
static constexpr uint32_t BOOT_STAGE_SETTLE_MS = 1000;

void peerBegin();
void peerLoop();

void logBootHeap(const char *stage) {
  Serial.printf(
    "Boot heap %-20s free=%u min=%u psram=%u\r\n",
    stage,
    unsigned(ESP.getFreeHeap()),
    unsigned(ESP.getMinFreeHeap()),
    unsigned(ESP.getFreePsram())
  );
}

void settleBootStage(const char *stage) {
  Serial.printf("Boot settle: %s\r\n", stage);
  delay(BOOT_STAGE_SETTLE_MS);
}

void waitForWifiReady() {
  Serial.print("Connecting to WiFi");
  for (;;) {
    const IPAddress ip = WiFi.localIP();
    if (WiFi.status() == WL_CONNECTED && ip != IPAddress(0, 0, 0, 0)) {
      Serial.println();
      return;
    }
    Serial.print(".");
    delay(500);
  }
}

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

  logBootHeap("start");
  Serial.println("Boot step: USB host and printer");
  printBridgeBegin();
  if (printBridgeWaitForPrinterReady(5000)) {
    Serial.println("USB printer ready before WiFi");
  } else {
    Serial.println("USB printer not ready before WiFi; continuing boot");
  }
  logBootHeap("after USB");
  settleBootStage("USB");

  Serial.println("Boot step: WiFi");
  WiFi.mode(WIFI_STA);
  WiFi.setHostname(HOSTNAME);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  waitForWifiReady();

  Serial.print("Hostname: ");
  Serial.println(WiFi.getHostname());
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
  logBootHeap("after WiFi");
  settleBootStage("WiFi");

  Serial.println("Boot step: print resources");
  if (printBridgePreparePrintResources()) {
    Serial.println("PrintBridge persistent resources ready");
  } else {
    Serial.println("PrintBridge persistent resource setup failed; print jobs will retry");
  }
  logBootHeap("after print res");
  settleBootStage("print resources");

  Serial.println("Boot step: PeerJS");
  peerBegin();
  logBootHeap("after PeerJS begin");
}

void loop() {
  handleSerialCommands();
  peerLoop();
}
