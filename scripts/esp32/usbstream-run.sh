#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "${SCRIPT_DIR}/env.sh" usbstream

"${SCRIPT_DIR}/stop-serial.sh" usbstream || true

if [[ "${USBSTREAM_SKIP_UPLOAD:-0}" != "1" ]]; then
  "${SCRIPT_DIR}/upload.sh" usbstream
  sleep "${USBSTREAM_BOOT_WAIT:-2}"
fi

printf '\n[usbstream-run] streaming serial; Ctrl-C to stop\n'
printf '[usbstream-run] sending g to %s after startup wait\n\n' "${ESP32_PORT}"

{
  sleep "${USBSTREAM_START_WAIT:-2}"
  printf 'g'
  sleep 3
  printf 'g'
  sleep 5
  printf 'g'
  cat
} | "${ARDUINO_CLI}" monitor \
  --port "${ESP32_PORT}" \
  --config "baudrate=${ESP32_BAUD}"
