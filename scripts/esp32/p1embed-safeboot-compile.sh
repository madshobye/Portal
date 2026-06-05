#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORTAL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PARTITIONS_CSV="${PORTAL_ROOT}/p1_embed/firmware/partitions-p1e-safeboot-4mb.csv"

compile_with_partitions() {
  local sketch_dir="$1"
  local build_path="$2"
  local extra_flags="$3"

  mkdir -p "${build_path}"
  cp "${PARTITIONS_CSV}" "${build_path}/partitions.csv"

  ESP32_BUILD_PATH="${build_path}" \
  SKETCH_DIR="${sketch_dir}" \
  ESP32_CPP_EXTRA_FLAGS="${extra_flags}" \
  ESP32_SKIP_WEBRTC_LINK="${ESP32_SKIP_WEBRTC_LINK:-0}" \
    "${SCRIPT_DIR}/p1embed-compile.sh"
}

check_size() {
  local label="$1"
  local file="$2"
  local max_bytes="$3"
  local size

  size="$(wc -c < "${file}" | tr -d ' ')"
  if (( size > max_bytes )); then
    echo "${label} image is too large: ${size} > ${max_bytes}" >&2
    exit 3
  fi
  echo "${label} image size ok: ${size} / ${max_bytes}"
}

main_flags="${ESP32_CPP_EXTRA_FLAGS:--DP1_EMBED_MQTT_AVOID_CONNECTED_PROBE=1} -DP1_EMBED_OTA_SAFEBOOT_ENABLED=1"
if [[ "${P1E_SAFEBOOT_ALLOW_HTTP:-0}" == "1" ]]; then
  main_flags="${main_flags} -DP1_EMBED_OTA_ALLOW_HTTP_URLS=1"
fi
updater_flags="${ESP32_UPDATER_CPP_EXTRA_FLAGS:-}"
if [[ "${P1E_SAFEBOOT_DELTA_ENABLED:-1}" == "1" ]]; then
  updater_flags="${updater_flags} -DP1E_UPDATER_DELTA_ENABLED=1"
fi

echo "Compiling P1E updater partition..."
ESP32_SKIP_WEBRTC_LINK=1 compile_with_partitions \
  "${PORTAL_ROOT}/p1_embed/firmware/p1_embed_updater" \
  "${ESP32_UPDATER_BUILD_PATH:-/private/tmp/p1-embed-safeboot-updater-build}" \
  "${updater_flags}"

echo "Compiling P1E app partition with safeboot hooks enabled..."
ESP32_SKIP_WEBRTC_LINK=0 compile_with_partitions \
  "${PORTAL_ROOT}/p1_embed/firmware/p1_embed" \
  "${ESP32_APP_BUILD_PATH:-/private/tmp/p1-embed-safeboot-app-build}" \
  "${main_flags}"

check_size "updater" "${ESP32_UPDATER_BUILD_PATH:-/private/tmp/p1-embed-safeboot-updater-build}/p1_embed_updater.ino.bin" $((0x110000))
check_size "app" "${ESP32_APP_BUILD_PATH:-/private/tmp/p1-embed-safeboot-app-build}/p1_embed.ino.bin" $((0x230000))

echo
echo "SafeBoot build outputs:"
echo "  updater: ${ESP32_UPDATER_BUILD_PATH:-/private/tmp/p1-embed-safeboot-updater-build}/p1_embed_updater.ino.bin"
echo "  app:     ${ESP32_APP_BUILD_PATH:-/private/tmp/p1-embed-safeboot-app-build}/p1_embed.ino.bin"
echo "  layout:  ${PARTITIONS_CSV}"
