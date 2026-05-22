#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/env.sh"

TERM=xterm screen "${ESP32_PORT}" "${ESP32_BAUD}"
