#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORTAL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

SRC="${PORTAL_ROOT}/tmp_notgit/Arduino_ESP32_WebRTC/src/esp32/libsepfy__srtp.a"
DST_DIR="${PORTAL_ROOT}/arduinolibs/Arduino_ESP32_WebRTC/src/esp32"
DST="${DST_DIR}/libsepfy__srtp.a"

REQUIRED_SYMBOLS=(
  srtp_init
  srtp_create
  srtp_dealloc
  srtp_protect
  srtp_unprotect
  srtp_unprotect_rtcp
  srtp_crypto_policy_set_rtp_default
  srtp_crypto_policy_set_rtcp_default
)

if [[ ! -f "${SRC}" ]]; then
  echo "Missing classic ESP32 SRTP archive: ${SRC}" >&2
  echo "Expected source comes from tmp_notgit/sepfy__libpeer ESP-IDF packaging output." >&2
  exit 1
fi

mkdir -p "${DST_DIR}"
cp "${SRC}" "${DST}"

echo "Installed classic ESP32 SRTP archive:"
echo "  ${DST}"
echo
echo "Verifying required SRTP symbols..."

for symbol in "${REQUIRED_SYMBOLS[@]}"; do
  if ! nm -g "${DST}" | grep -q " ${symbol}$"; then
    echo "Missing required symbol: ${symbol}" >&2
    exit 1
  fi
done

echo "Classic ESP32 SRTP archive is present and exports the expected symbols."
