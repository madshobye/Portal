#include <WiFi.h>

const char *WIFI_SSID = "your-wifi-ssid";
const char *WIFI_PASSWORD = "your-wifi-password";
const char *HOSTNAME = "printhost";

void peerBegin();
void peerLoop();

void setup() {
  Serial.begin(115200);
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

  peerBegin();
}

void loop() {
  peerLoop();
}
