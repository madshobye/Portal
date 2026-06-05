#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${ESP32_PORT:-${1:-}}"

if [[ -z "$PORT" ]]; then
  echo "usage: ESP32_PORT=/dev/cu.usbserial... $0" >&2
  echo "   or: $0 /dev/cu.usbserial..." >&2
  exit 2
fi

ELF="$("$ROOT/tools/build_guest.sh")"
"$ROOT/tools/upload_elf.py" --port "$PORT" "$ELF"
