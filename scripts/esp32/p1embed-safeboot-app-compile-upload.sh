#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/env.sh" p1embed

APP_BUILD="${ESP32_APP_BUILD_PATH:-/private/tmp/p1-embed-safeboot-app-build}"
ESPTOOL="${HOME}/Library/Arduino15/packages/esp32/tools/esptool_py/5.2.0/esptool"
APP_BIN="${APP_BUILD}/p1_embed.ino.bin"
APP_OFFSET="0x120000"

if [[ "${P1E_SKIP_COMPILE:-0}" != "1" ]]; then
  "${SCRIPT_DIR}/p1embed-safeboot-app-compile.sh"
fi

if [[ ! -f "${APP_BIN}" ]]; then
  echo "Missing app build output: ${APP_BIN}" >&2
  echo "Run scripts/esp32/p1embed-safeboot-app-compile.sh first, or run this script without P1E_SKIP_COMPILE=1." >&2
  exit 2
fi

echo "Flashing P1E SafeBoot app partition only..."
echo "  port: ${ESP32_PORT}"
echo "  baud: ${ESP32_UPLOAD_BAUD}"
echo "  app:  ${APP_BIN}"
echo "  addr: ${APP_OFFSET}"

"${ESPTOOL}" --chip esp32 --port "${ESP32_PORT}" --baud "${ESP32_UPLOAD_BAUD}" \
  --before default-reset --after hard-reset write-flash -z \
  --flash-mode keep --flash-freq keep --flash-size keep \
  "${APP_OFFSET}" "${APP_BIN}"
