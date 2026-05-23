#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORTAL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

"${SCRIPT_DIR}/install-classic-srtp.sh"

ESP32_FQBN="${ESP32_FQBN:-esp32:esp32:esp32}" \
SKETCH_DIR="${PORTAL_ROOT}/arduinolibs/ESP32_WebRTC/examples/classic-link-smoke" \
"${SCRIPT_DIR}/compile.sh"
