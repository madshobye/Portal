#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/env.sh"

printf 'reboot\n' > "${ESP32_PORT}"
echo "Sent reboot command to ${ESP32_PORT}."

