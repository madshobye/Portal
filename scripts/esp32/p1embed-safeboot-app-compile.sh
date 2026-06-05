#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORTAL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PARTITIONS_CSV="${PORTAL_ROOT}/p1_embed/firmware/partitions-p1e-safeboot-4mb.csv"
APP_BUILD="${ESP32_APP_BUILD_PATH:-/private/tmp/p1-embed-safeboot-app-build}"

mkdir -p "${APP_BUILD}"
cp "${PARTITIONS_CSV}" "${APP_BUILD}/partitions.csv"

main_flags="${ESP32_CPP_EXTRA_FLAGS:--DP1_EMBED_MQTT_AVOID_CONNECTED_PROBE=1} -DP1_EMBED_OTA_SAFEBOOT_ENABLED=1"
if [[ "${P1E_SAFEBOOT_ALLOW_HTTP:-0}" == "1" ]]; then
  main_flags="${main_flags} -DP1_EMBED_OTA_ALLOW_HTTP_URLS=1"
fi

echo "Compiling P1E SafeBoot app partition only..."
ESP32_BUILD_PATH="${APP_BUILD}" \
SKETCH_DIR="${PORTAL_ROOT}/p1_embed/firmware/p1_embed" \
ESP32_CPP_EXTRA_FLAGS="${main_flags}" \
ESP32_SKIP_WEBRTC_LINK="${ESP32_SKIP_WEBRTC_LINK:-0}" \
  "${SCRIPT_DIR}/p1embed-compile.sh"

size="$(wc -c < "${APP_BUILD}/p1_embed.ino.bin" | tr -d ' ')"
if (( size > 0x230000 )); then
  echo "app image is too large: ${size} > $((0x230000))" >&2
  exit 3
fi

echo "app image size ok: ${size} / $((0x230000))"
echo "app: ${APP_BUILD}/p1_embed.ino.bin"
