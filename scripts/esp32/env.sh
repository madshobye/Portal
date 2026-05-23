#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORTAL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

ARDUINO_CLI="${ARDUINO_CLI:-/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli}"
ESP32_PORT="${ESP32_PORT:-/dev/cu.wchusbserial5B5E1092281}"
ESP32_FQBN="${ESP32_FQBN:-esp32:esp32:esp32s3:FlashSize=8M,PartitionScheme=default_8MB,PSRAM=opi}"
ESP32_BAUD="${ESP32_BAUD:-115200}"

SKETCH_DIR="${SKETCH_DIR:-${PORTAL_ROOT}/ArduinoExamples/printhost}"
PORTAL_ARDUINO_LIBS="${PORTAL_ARDUINO_LIBS:-${PORTAL_ROOT}/arduinolibs}"
USER_ARDUINO_LIBS="${USER_ARDUINO_LIBS:-${HOME}/Documents/Arduino/libraries}"

case "${ESP32_FQBN}" in
  esp32:esp32:esp32s3*)
    ESP32_ARCH_DIR_DEFAULT="esp32s3"
    ESP32_PLATFORM_LIBS_DEFAULT="${HOME}/Library/Arduino15/packages/esp32/tools/esp32s3-libs/3.3.7/flags/ld_libs"
    ;;
  esp32:esp32:esp32:*)
    ESP32_ARCH_DIR_DEFAULT="esp32"
    ESP32_PLATFORM_LIBS_DEFAULT="${HOME}/Library/Arduino15/packages/esp32/tools/esp32-libs/3.3.7/flags/ld_libs"
    ;;
  esp32:esp32:esp32)
    ESP32_ARCH_DIR_DEFAULT="esp32"
    ESP32_PLATFORM_LIBS_DEFAULT="${HOME}/Library/Arduino15/packages/esp32/tools/esp32-libs/3.3.7/flags/ld_libs"
    ;;
  *)
    echo "Unsupported ESP32_FQBN for ESP32_WebRTC archive selection: ${ESP32_FQBN}" >&2
    exit 2
    ;;
esac

ESP32_WEBRTC_ARCH_DIR="${ESP32_WEBRTC_ARCH_DIR:-${ESP32_ARCH_DIR_DEFAULT}}"
ESP32_PLATFORM_LIBS="${ESP32_PLATFORM_LIBS:-${ESP32_PLATFORM_LIBS_DEFAULT}}"
ESP32_WEBRTC_ARCH_LIBS="${ESP32_WEBRTC_ARCH_LIBS:-${PORTAL_ROOT}/arduinolibs/ESP32_WebRTC/src/${ESP32_WEBRTC_ARCH_DIR}}"
ESP32_WEBRTC_LINK_LIBS="${ESP32_WEBRTC_LINK_LIBS:-@${ESP32_PLATFORM_LIBS} -L${ESP32_WEBRTC_ARCH_LIBS} -lsepfy__srtp}"
