# ESP32 Arduino Helpers

These scripts wrap the repeated ESP32-S3 Arduino tasks for the `printhost`
sketch. They default to:

- Port: `/dev/cu.wchusbserial5B5E1092281`
- FQBN: `esp32:esp32:esp32s3:PartitionScheme=huge_app,PSRAM=opi`
- Sketch: `ArduinoExamples/printhost`

Override values with environment variables:

```sh
ESP32_PORT=/dev/cu.other ./scripts/esp32/upload.sh
ESP32_FQBN='esp32:esp32:esp32s3:PartitionScheme=huge_app,PSRAM=opi' ./scripts/esp32/compile.sh
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
