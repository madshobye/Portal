#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/env.sh" p1embed

UPDATER_BUILD="${ESP32_UPDATER_BUILD_PATH:-/private/tmp/p1-embed-safeboot-updater-build}"
APP_BUILD="${ESP32_APP_BUILD_PATH:-/private/tmp/p1-embed-safeboot-app-build}"
ESPTOOL="${HOME}/Library/Arduino15/packages/esp32/tools/esptool_py/5.2.0/esptool"
BOOT_APP0="$(find "${HOME}/Library/Arduino15/packages/esp32/hardware/esp32" -path '*/tools/partitions/boot_app0.bin' -type f | sort | tail -n 1)"

for file in \
  "${APP_BUILD}/p1_embed.ino.bootloader.bin" \
  "${APP_BUILD}/p1_embed.ino.partitions.bin" \
  "${BOOT_APP0}" \
  "${UPDATER_BUILD}/p1_embed_updater.ino.bin" \
  "${APP_BUILD}/p1_embed.ino.bin"; do
  if [[ ! -f "${file}" ]]; then
    echo "Missing build output: ${file}" >&2
    echo "Run scripts/esp32/p1embed-safeboot-compile.sh first." >&2
    exit 2
  fi
done

"${ESPTOOL}" --chip esp32 --port "${ESP32_PORT}" --baud "${ESP32_BAUD}" \
  --before default-reset --after hard-reset write-flash -z \
  --flash-mode keep --flash-freq keep --flash-size keep \
  0x1000 "${APP_BUILD}/p1_embed.ino.bootloader.bin" \
  0x8000 "${APP_BUILD}/p1_embed.ino.partitions.bin" \
  0xe000 "${BOOT_APP0}" \
  0x10000 "${UPDATER_BUILD}/p1_embed_updater.ino.bin" \
  0x120000 "${APP_BUILD}/p1_embed.ino.bin"
