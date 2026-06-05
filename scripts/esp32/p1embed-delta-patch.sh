#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 3 ]]; then
  cat >&2 <<'USAGE'
Usage:
  scripts/esp32/p1embed-delta-patch.sh <from-app.bin> <to-app.bin> <patch.bin> [patch-url]

Creates a detools in-place heatshrink patch for the P1E SafeBoot app partition
and writes a JSON prepare payload next to the patch.

If patch-url is omitted, the prepare JSON uses the patch filename. Official
release manifests should be generated with p1embed-safeboot-deploy.sh instead.

Environment:
  DETOOLS         detools executable path, default: detools
  MEMORY_SIZE     app partition size, default: 0x230000
  SEGMENT_SIZE    erase/patch segment size, default: 4096
  PAD_TO_SEGMENT  pad app inputs with 0xff to SEGMENT_SIZE, default: 1
USAGE
  exit 2
fi

FROM_BIN="$1"
TO_BIN="$2"
PATCH_BIN="$3"
PATCH_URL="${4:-$(basename "$PATCH_BIN")}"

DETOOLS_BIN="${DETOOLS:-detools}"
MEMORY_SIZE_RAW="${MEMORY_SIZE:-0x230000}"
SEGMENT_SIZE="${SEGMENT_SIZE:-4096}"
MEMORY_SIZE="$((MEMORY_SIZE_RAW))"
PAD_TO_SEGMENT="${PAD_TO_SEGMENT:-1}"

if [[ ! -f "${FROM_BIN}" ]]; then
  echo "Missing from-app binary: ${FROM_BIN}" >&2
  exit 2
fi
if [[ ! -f "${TO_BIN}" ]]; then
  echo "Missing to-app binary: ${TO_BIN}" >&2
  exit 2
fi

from_size="$(wc -c < "${FROM_BIN}" | tr -d ' ')"
to_size="$(wc -c < "${TO_BIN}" | tr -d ' ')"
if (( from_size > MEMORY_SIZE )); then
  echo "from-app binary is larger than memory size: ${from_size} > ${MEMORY_SIZE}" >&2
  exit 3
fi
if (( to_size > MEMORY_SIZE )); then
  echo "to-app binary is larger than memory size: ${to_size} > ${MEMORY_SIZE}" >&2
  exit 3
fi

PATCH_FROM_BIN="${FROM_BIN}"
PATCH_TO_BIN="${TO_BIN}"
raw_from_size="${from_size}"
raw_to_size="${to_size}"
tmpdir=""
cleanup() {
  if [[ -n "${tmpdir}" && -d "${tmpdir}" ]]; then
    rm -rf "${tmpdir}"
  fi
}
trap cleanup EXIT

pad_to_segment_boundary() {
  local src="$1"
  local dst="$2"
  python3 - "$src" "$dst" "$SEGMENT_SIZE" <<'PY'
import sys
from pathlib import Path

src = Path(sys.argv[1])
dst = Path(sys.argv[2])
segment_size = int(sys.argv[3], 0)
data = src.read_bytes()
padded_size = ((len(data) + segment_size - 1) // segment_size) * segment_size
dst.write_bytes(data + (b"\xff" * (padded_size - len(data))))
PY
}

if [[ "${PAD_TO_SEGMENT}" != "0" ]]; then
  tmpdir="$(mktemp -d)"
  PATCH_FROM_BIN="${tmpdir}/from-padded.bin"
  PATCH_TO_BIN="${tmpdir}/to-padded.bin"
  pad_to_segment_boundary "${FROM_BIN}" "${PATCH_FROM_BIN}"
  pad_to_segment_boundary "${TO_BIN}" "${PATCH_TO_BIN}"
  from_size="$(wc -c < "${PATCH_FROM_BIN}" | tr -d ' ')"
  to_size="$(wc -c < "${PATCH_TO_BIN}" | tr -d ' ')"
  if (( from_size > MEMORY_SIZE )); then
    echo "padded from-app binary is larger than memory size: ${from_size} > ${MEMORY_SIZE}" >&2
    exit 3
  fi
  if (( to_size > MEMORY_SIZE )); then
    echo "padded to-app binary is larger than memory size: ${to_size} > ${MEMORY_SIZE}" >&2
    exit 3
  fi
fi

mkdir -p "$(dirname "${PATCH_BIN}")"
"${DETOOLS_BIN}" create_patch_in_place \
  -c heatshrink \
  --memory-size "${MEMORY_SIZE}" \
  --segment-size "${SEGMENT_SIZE}" \
  "${PATCH_FROM_BIN}" \
  "${PATCH_TO_BIN}" \
  "${PATCH_BIN}"

from_sha="$(shasum -a 256 "${PATCH_FROM_BIN}" | awk '{print $1}')"
to_sha="$(shasum -a 256 "${PATCH_TO_BIN}" | awk '{print $1}')"
patch_sha="$(shasum -a 256 "${PATCH_BIN}" | awk '{print $1}')"
patch_size="$(wc -c < "${PATCH_BIN}" | tr -d ' ')"
payload="${PATCH_BIN}.prepare.json"

cat > "${payload}" <<JSON
{
  "type": "cmd",
  "id": "delta-prepare",
  "name": "firmware.update.prepare",
  "kind": "delta",
  "url": "${PATCH_URL}",
  "sha256": "${patch_sha}",
  "fromSha256": "${from_sha}",
  "toSha256": "${to_sha}",
  "fromSize": ${from_size},
  "toSize": ${to_size},
  "memorySize": ${MEMORY_SIZE},
  "segmentSize": ${SEGMENT_SIZE},
  "reboot": false
}
JSON

cat <<REPORT
P1E delta patch created
  from:       ${FROM_BIN}
  to:         ${TO_BIN}
  patch:      ${PATCH_BIN}
  payload:    ${payload}
  from size:  ${from_size}$(if [[ "${from_size}" != "${raw_from_size}" ]]; then printf ' (raw %s)' "${raw_from_size}"; fi)
  to size:    ${to_size}$(if [[ "${to_size}" != "${raw_to_size}" ]]; then printf ' (raw %s)' "${raw_to_size}"; fi)
  patch size: ${patch_size}
  ratio:      $(python3 -c "print(f'{(${patch_size}/${to_size})*100:.1f}%')")
REPORT
