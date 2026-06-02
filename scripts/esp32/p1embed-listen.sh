#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ESP32_PROFILE=p1embed
source "${SCRIPT_DIR}/env.sh"

SECONDS_TO_LISTEN="${1:-30}"

python3 "${PORTAL_ROOT}/p1_embed/tools/p1_serial_repl.py" \
  --port "${ESP32_PORT}" \
  --baud "${ESP32_BAUD}" \
  --listen "${SECONDS_TO_LISTEN}"
