# ESP32-S3 USB host override

This folder contains a replacement `libusb.a` for Arduino ESP32-S3 builds.

The stock Arduino ESP32 3.3.8 ESP32-S3 USB host archive was built with:

```text
CONFIG_USB_HOST_CONTROL_TRANSFER_MAX_SIZE=256
```

Several UVC cameras have configuration descriptors larger than that, which
causes enumeration to fail before sketch code receives a device event:

```text
ENUM: Configuration descriptor larger than control transfer max length
ENUM: [0:0] CHECK_SHORT_CONFIG_DESC FAILED
```

This archive was built from the ESP-IDF UVC smoke build in `tmp_notgit` with:

```text
CONFIG_USB_HOST_CONTROL_TRANSFER_MAX_SIZE=4096
```

The scripts in `scripts/esp32` pass this archive by absolute path before
Arduino's normal `@ld_libs` list for the `usbenum`, `uvchostprobe`,
`uvcsmoke`, and `uvccamera` profiles. Using an absolute path matters because
Arduino injects its SDK library path before custom linker flags, so `-L ...`
alone does not reliably override the stock `libusb.a`.
