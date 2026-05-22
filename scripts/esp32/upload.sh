#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/env.sh"

"${ARDUINO_CLI}" upload \
  --fqbn "${ESP32_FQBN}" \
  --port "${ESP32_PORT}" \
  "${SKETCH_DIR}"

