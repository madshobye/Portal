# ESP32 Arduino Helpers

These scripts wrap the repeated ESP32-S3 Arduino tasks for the `printhost`
sketch. They default to:

- Port: `/dev/cu.wchusbserial5B5E1092281`
- FQBN: `esp32:esp32:esp32s3:FlashSize=8M,PartitionScheme=default_8MB,PSRAM=opi`
- Sketch: `ArduinoExamples/printhost`

Override values with environment variables:

```sh
ESP32_PORT=/dev/cu.other ./scripts/esp32/upload.sh
ESP32_FQBN='esp32:esp32:esp32s3:FlashSize=8M,PartitionScheme=default_8MB,PSRAM=opi' ./scripts/esp32/compile.sh
```

Common commands:

```sh
./scripts/esp32/compile.sh
./scripts/esp32/upload.sh
./scripts/esp32/compile-upload.sh
./scripts/esp32/monitor.sh
./scripts/esp32/read-serial.sh
./scripts/esp32/stop-serial.sh
./scripts/esp32/reboot.sh
```

Classic ESP32 SRTP/link smoke test:

```sh
./scripts/esp32/compile-classic-smoke.sh
```

That script verifies `src/esp32/libsepfy__srtp.a` exports the SRTP symbols
needed by libpeer, then compiles a small classic ESP32 link test. The archive
is treated as part of `arduinolibs/ESP32_WebRTC`; if it needs to be
rebuilt, use `externallibs_modified/sepfy__libpeer/examples/esp32/managed_components/sepfy__srtp`
rather than the old packaged Arduino snapshot.
