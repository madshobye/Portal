#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/env.sh"

compile_args=(
  --fqbn "${ESP32_FQBN}"
  --port "${ESP32_PORT}"
  --libraries "${PORTAL_ARDUINO_LIBS}"
  --upload
)

if [[ "${ESP32_INCLUDE_USER_LIBS:-0}" == "1" && -d "${USER_ARDUINO_LIBS}" ]]; then
  compile_args+=(--libraries "${USER_ARDUINO_LIBS}")
fi

if [[ -n "${ESP32_LINK_LIBS:-}" ]]; then
  compile_args+=(--build-property "compiler.c.elf.libs=${ESP32_LINK_LIBS}")
elif [[ "${ESP32_SKIP_WEBRTC_LINK:-0}" != "1" && -n "${ESP32_WEBRTC_LINK_LIBS:-}" ]]; then
  compile_args+=(--build-property "compiler.c.elf.libs=${ESP32_WEBRTC_LINK_LIBS}")
fi

if [[ -n "${ESP32_BUILD_PATH:-}" ]]; then
  compile_args+=(--build-path "${ESP32_BUILD_PATH}")
fi

if [[ -n "${ESP32_BUILD_CACHE_PATH:-}" ]]; then
  compile_args+=(--build-cache-path "${ESP32_BUILD_CACHE_PATH}")
fi

"${ARDUINO_CLI}" compile \
  "${compile_args[@]}" \
  "${SKETCH_DIR}"
