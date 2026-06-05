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

P1 Embed classic ESP32 profile:

```sh
./scripts/esp32/p1embed-compile.sh
./scripts/esp32/p1embed-upload.sh
./scripts/esp32/p1embed-compile-upload.sh
./scripts/esp32/p1embed-monitor.sh
./scripts/esp32/p1embed-upload-monitor.sh
./scripts/esp32/p1embed-listen.sh 30
./scripts/esp32/p1embed-read-serial.sh
./scripts/esp32/p1embed-stop-serial.sh
./scripts/esp32/p1embed-reboot.sh
```

These wrappers use the `p1embed` profile, which defaults to classic ESP32
with `esp32:esp32:esp32:PartitionScheme=huge_app`, the P1 Embed firmware
sketch, the P1 Embed Arduino libraries, `/private/tmp/p1-embed-build`, and
`/dev/cu.wchusbserial10`. Override `ESP32_PORT` if the USB device changes.
Use `p1embed-listen.sh` for normal serial watching: it runs the decoded
Python listener at 115200 baud and filters out compact/binary serial frames
that make raw `cat` output look like a baud-rate problem.

P1 Embed SafeBoot OTA profile:

```sh
./scripts/esp32/p1embed-safeboot-app-compile-upload.sh
./scripts/esp32/p1embed-safeboot-compile.sh
./scripts/esp32/p1embed-safeboot-upload.sh
DETOOLS=/private/tmp/p1e-detools-venv/bin/detools ./scripts/esp32/p1embed-safeboot-deploy.sh --from 0.1.176 --to 0.1.177
```

Use `p1embed-safeboot-app-compile-upload.sh` for normal firmware iteration on
an already-SafeBoot-flashed board. It compiles only the main app partition and
flashes only address `0x120000`, leaving the updater, bootloader, partition
table, and release manifests untouched.

Use `p1embed-safeboot-deploy.sh` for official SafeBoot releases. It is the
single script that should bump `P1_EMBED_FIRMWARE_VERSION`, compile both
partitions, publish current USB installer files, write versioned files under
`p1_embed/web/bin/releases/`, create the delta patch, host-verify the patch,
and update `p1e-firmware-safeboot.json` plus `p1e-firmware-releases.json`.

SafeBoot release URLs are intentionally relative to `p1_embed/web/bin`; the web
UI resolves them from wherever the web utility is hosted before sending an OTA
command to the board. Do not put LAN IPs or local absolute URLs in committed
release manifests. See `p1_embed/docs/safeboot_ota.md` for the full workflow.

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
