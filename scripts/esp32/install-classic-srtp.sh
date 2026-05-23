#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORTAL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

ARCHIVE="${PORTAL_ROOT}/arduinolibs/ESP32_WebRTC/src/esp32/libsepfy__srtp.a"

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

if [[ ! -f "${ARCHIVE}" ]]; then
  echo "Missing classic ESP32 SRTP archive: ${ARCHIVE}" >&2
  echo "Rebuild it from externallibs_modified/sepfy__libpeer/examples/esp32/managed_components/sepfy__srtp before compiling classic ESP32." >&2
  exit 1
fi

echo "Classic ESP32 SRTP archive:"
echo "  ${ARCHIVE}"
echo
echo "Verifying required SRTP symbols..."

for symbol in "${REQUIRED_SYMBOLS[@]}"; do
  if ! nm -g "${ARCHIVE}" | grep -q " ${symbol}$"; then
    echo "Missing required symbol: ${symbol}" >&2
    exit 1
  fi
done

echo "Classic ESP32 SRTP archive is present and exports the expected symbols."
