#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORTAL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

ARDUINO_CLI="${ARDUINO_CLI:-/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli}"
ESP32_PORT="${ESP32_PORT:-/dev/cu.wchusbserial5B5E1092281}"
ESP32_FQBN="${ESP32_FQBN:-esp32:esp32:esp32s3:PartitionScheme=huge_app,PSRAM=opi}"
ESP32_BAUD="${ESP32_BAUD:-115200}"

SKETCH_DIR="${SKETCH_DIR:-${PORTAL_ROOT}/ArduinoExamples/printhost}"
PORTAL_ARDUINO_LIBS="${PORTAL_ARDUINO_LIBS:-${PORTAL_ROOT}/arduinolibs}"
USER_ARDUINO_LIBS="${USER_ARDUINO_LIBS:-${HOME}/Documents/Arduino/libraries}"
