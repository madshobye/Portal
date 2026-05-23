#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/env.sh"

"${ARDUINO_CLI}" compile \
  --fqbn "${ESP32_FQBN}" \
  --port "${ESP32_PORT}" \
  --build-property "compiler.c.elf.libs=${ESP32_WEBRTC_LINK_LIBS}" \
  --libraries "${PORTAL_ARDUINO_LIBS}" \
  --libraries "${USER_ARDUINO_LIBS}" \
  --upload \
  "${SKETCH_DIR}"
