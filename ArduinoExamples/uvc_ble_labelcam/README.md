# UVC BLE LabelCam

ESP32-S3 skeleton for:

1. USB UVC webcam capture.
2. Physical button trigger.
3. TSPL bitmap label generation.
4. BLE write to a label printer.

This example intentionally has no p5.js, no WiFi, and no WebRTC.

## Current State

- The button/job pipeline is implemented.
- TSPL bitmap encoding is implemented.
- BLE scan/connect/write skeleton is implemented using Arduino ESP32 `BLEDevice`.
- BLE discovery/write behavior is modeled after `P1/portal/bleLabelPrinter.js`:
  broad printer-like name prefixes, common transparent-UART services, writable characteristic selection, write-without-response preference, chunk delay, and chunk-size fallback.
- UVC capture is a placeholder backend.
- `ENABLE_TEST_PATTERN_CAPTURE` is `true` in `Config.h`, so button presses generate a test image until the real UVC backend is integrated.

## Files

- `uvc_ble_labelcam.ino`: boot and button-triggered capture/print job.
- `Config.h`: pins, label size, BLE UUID/name configuration.
- `UvcCamera.*`: UVC backend seam; currently generates a test pattern.
- `TsplBitmap.*`: grayscale frame to TSPL `BITMAP`.
- `BleTsplPrinter.*`: BLE scan/connect/write skeleton.
- `ButtonInput.*`: debounced physical button.

## Next Integration Work

1. Add an ESP32-S3 Arduino-compatible UVC host library.
2. Replace `UvcCamera::captureGrayscale()` with real frame capture/decode.
3. Set or extend the BLE printer profiles in `Config.h` once the actual printer/module UUIDs are known.
4. Tune `BLE_WRITE_CHUNK_BYTES` and `BLE_WRITE_DELAY_MS` for the printer.
5. Pick a non-bootstrapping GPIO for `CAPTURE_BUTTON_PIN` in the final hardware.
