#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$ROOT/.build"
XCC="$BUILD_DIR/xcc700"
SOURCE="${1:-$ROOT/guest/blink_led.c}"
OUT="${2:-$BUILD_DIR/$(basename "${SOURCE%.*}").elf}"

mkdir -p "$BUILD_DIR"
rm -f "$OUT"

cc -O2 "$ROOT/tools/xcc700/xcc700.c" -o "$XCC"
"$XCC" "$SOURCE" -o "$OUT"
chmod u+rw "$OUT"

if command -v stat >/dev/null 2>&1; then
  if SIZE="$(stat -f %z "$OUT" 2>/dev/null)"; then
    echo "guest ELF size: $SIZE bytes" >&2
  elif SIZE="$(stat -c %s "$OUT" 2>/dev/null)"; then
    echo "guest ELF size: $SIZE bytes" >&2
  fi
fi

echo "$OUT"
