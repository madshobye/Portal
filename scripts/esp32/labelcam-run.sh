#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "${SCRIPT_DIR}/env.sh" labelcam

"${SCRIPT_DIR}/stop-serial.sh" labelcam || true

if [[ "${LABELCAM_SKIP_UPLOAD:-0}" != "1" ]]; then
  "${SCRIPT_DIR}/upload.sh" labelcam
  sleep "${LABELCAM_BOOT_WAIT:-2}"
fi

printf '\n[labelcam-run] streaming serial; Ctrl-C to stop\n'
printf '[labelcam-run] sending g to %s after monitor is attached\n\n' "${ESP32_PORT}"

{
  sleep "${LABELCAM_START_WAIT:-2}"
  printf 'g'
  sleep "${LABELCAM_MONITOR_SECONDS:-120}"
} | "${ARDUINO_CLI}" monitor \
  --port "${ESP32_PORT}" \
  --config "baudrate=${ESP32_BAUD}"
