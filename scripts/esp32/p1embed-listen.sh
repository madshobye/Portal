#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ESP32_PROFILE=p1embed
source "${SCRIPT_DIR}/env.sh"

SECONDS_TO_LISTEN="${1:-30}"
MODE="${P1EMBED_LISTEN_MODE:-raw}"

if [[ "${1:-}" == "raw" || "${1:-}" == "decoded" ]]; then
  MODE="$1"
  SECONDS_TO_LISTEN="${2:-30}"
fi

case "${MODE}" in
  raw)
    LISTEN_FLAG="--raw-listen"
    ;;
  decoded)
    LISTEN_FLAG="--listen"
    ;;
  *)
    echo "Usage: $0 [raw|decoded] [seconds]" >&2
    echo "Or set P1EMBED_LISTEN_MODE=raw|decoded." >&2
    exit 2
    ;;
esac

python3 "${PORTAL_ROOT}/p1_embed/tools/p1_serial_repl.py" \
  --port "${ESP32_PORT}" \
  --baud "${ESP32_BAUD}" \
  "${LISTEN_FLAG}" "${SECONDS_TO_LISTEN}"
