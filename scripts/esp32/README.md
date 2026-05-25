# ESP32 Arduino Helpers

These scripts wrap the repeated ESP32-S3 Arduino tasks for the `printhost`
sketch. They default to:

- Port: `/dev/cu.wchusbserial5B5E1092281`
- FQBN: `esp32:esp32:esp32s3:FlashSize=8M,PartitionScheme=default_8MB,PSRAM=opi`
- Sketch: `ArduinoExamples/printhost`

The scripts are intended to work from a fresh Arduino IDE + ESP32 board
package install. Project libraries are resolved from `arduinolibs/` by
default, and the ESP32 board package linker flags are discovered from the
installed package version instead of being pinned to one local version.
Set `ESP32_INCLUDE_USER_LIBS=1` only when a sketch intentionally depends on
libraries installed in `~/Documents/Arduino/libraries`.

Override values with environment variables:

```sh
ESP32_PORT=/dev/cu.other ./scripts/esp32/upload.sh
ESP32_FQBN='esp32:esp32:esp32s3:FlashSize=8M,PartitionScheme=default_8MB,PSRAM=opi' ./scripts/esp32/compile.sh
SKETCH_DIR="$PWD/ArduinoExamples/uvc_ble_labelcam" ESP32_PORT=/dev/cu.other ./scripts/esp32/upload.sh
ESP32_BUILD_PATH=/private/tmp/esp32-build ESP32_BUILD_CACHE_PATH=/private/tmp/esp32-cache ./scripts/esp32/compile.sh
ESP32_SKIP_WEBRTC_LINK=1 SKETCH_DIR="$PWD/ArduinoExamples/uvc_ble_labelcam" ./scripts/esp32/compile.sh
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

LabelCam BLE test profile:

```sh
./scripts/esp32/compile.sh labelcam
./scripts/esp32/upload.sh labelcam
./scripts/esp32/monitor.sh labelcam
./scripts/esp32/upload-monitor.sh labelcam
```

ESP32_USB_STREAM UVC smoke test profile:

```sh
./scripts/esp32/usbstream-compile.sh
./scripts/esp32/usbstream-upload.sh
./scripts/esp32/usbstream-compile-upload.sh
./scripts/esp32/usbstream-monitor.sh
./scripts/esp32/usbstream-reboot.sh
./scripts/esp32/usbstream-run.sh
```

The same profile can also be used with the generic wrappers:

```sh
./scripts/esp32/compile.sh usbstream
./scripts/esp32/upload.sh usbstream
./scripts/esp32/monitor.sh usbstream
```

`usbstream-run.sh` uploads the gated smoke sketch, sends `g` over serial to
start USB camera negotiation, and then streams serial output. Use
`USBSTREAM_SKIP_UPLOAD=1 ./scripts/esp32/usbstream-run.sh` to skip the upload
and only start/monitor the already-flashed sketch.

The smoke sketch currently uses the named profile
`USBSTREAM_UVC_LOGITECH_046D_0821_160X120_MJPEG`, which is the verified
old Logitech camera mode:

- VID/PID: `046d:0821`
- MJPEG `160x120` at `5 fps`
- format index `2`, frame index `2`
- streaming interface `3`, alt `1`
- endpoint `0x81`, MPS `192`

Modern USB-host UVC probe test profile:

```sh
./scripts/esp32/uvchostprobe-compile.sh
./scripts/esp32/uvchostprobe-upload.sh
./scripts/esp32/uvchostprobe-monitor.sh
./scripts/esp32/uvchostprobe-run.sh
```

This sketch uses `usb_host_install()` like `printhost`, enumerates UVC
interfaces, then sends `SET_CUR(PROBE)` and `GET_CUR(PROBE)` directly through
`usb_host_transfer_submit_control()`.

Classic ESP32 SRTP/link smoke test:

```sh
./scripts/esp32/compile-classic-smoke.sh
```

That script verifies `src/esp32/libsepfy__srtp.a` exports the SRTP symbols
needed by libpeer, then compiles a small classic ESP32 link test. The archive
is treated as part of `arduinolibs/ESP32_WebRTC`; if it needs to be
rebuilt, use `externallibs_modified/sepfy__libpeer/examples/esp32/managed_components/sepfy__srtp`
rather than the old packaged Arduino snapshot.
