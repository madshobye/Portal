#include <peer.h>

void setup() {
  Serial.begin(115200);
  peer_init();

  PeerConfiguration config = {
      .ice_servers = {
          {.urls = "stun:stun.l.google.com:19302"}},
      .audio_codec = CODEC_NONE,
      .video_codec = CODEC_NONE,
      .datachannel = DATA_CHANNEL_BINARY,
  };

  PeerConnection* pc = peer_connection_create(&config);
  Serial.printf("classic ESP32 libpeer link smoke: %s\n", pc ? "ok" : "failed");
}

void loop() {
  delay(1000);
}
