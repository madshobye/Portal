#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/env.sh"

pattern="(${ESP32_PORT}|arduino-cli monitor)"
matches="$(ps -axo pid=,command= | awk -v pat="${pattern}" '
  $0 ~ pat && $0 !~ /stop-serial\.sh/ && $0 !~ /awk -v pat/ { print $1 }
')"

if [[ -z "${matches}" ]]; then
  echo "No serial monitor/read process found for ${ESP32_PORT}."
  exit 0
fi

echo "${matches}" | while read -r pid; do
  if [[ -n "${pid}" ]]; then
    echo "Stopping serial process ${pid}"
    kill "${pid}" 2>/dev/null || true
  fi
done

