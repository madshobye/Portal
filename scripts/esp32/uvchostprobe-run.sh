#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"${SCRIPT_DIR}/stop-serial.sh" uvchostprobe || true
"${SCRIPT_DIR}/upload.sh" uvchostprobe
sleep "${UVCHOSTPROBE_BOOT_WAIT:-2}"
"${SCRIPT_DIR}/monitor.sh" uvchostprobe
