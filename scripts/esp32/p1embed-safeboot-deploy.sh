#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORTAL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
WEB_BIN="${PORTAL_ROOT}/p1_embed/web/bin"
RELEASE_DIR="${WEB_BIN}/releases"
CONFIG_H="${PORTAL_ROOT}/p1_embed/firmware/p1_embed/config.h"
MANIFEST="${WEB_BIN}/p1e-firmware-releases.json"
INSTALLER_MANIFEST="${WEB_BIN}/p1e-firmware-safeboot.json"
PARTITIONS_CSV="${PORTAL_ROOT}/p1_embed/firmware/partitions-p1e-safeboot-4mb.csv"
MEMORY_SIZE_RAW="${MEMORY_SIZE:-0x230000}"
SEGMENT_SIZE="${SEGMENT_SIZE:-4096}"
MEMORY_SIZE="$((MEMORY_SIZE_RAW))"
DETOOLS_BIN="${DETOOLS:-detools}"
BUILD_ROOT="${P1E_RELEASE_BUILD_ROOT:-/private/tmp/p1e-release}"
TO_VERSION=""
FROM_VERSION=""
ALLOW_HTTP=0
NO_DELTA=0
FORCE=0

usage() {
  cat >&2 <<'USAGE'
Usage:
  scripts/esp32/p1embed-safeboot-deploy.sh --to <version> [options]

Creates one official SafeBoot deploy iteration. This is the only script that
should publish SafeBoot firmware artifacts, update release manifests, or mint
monotonic deploy versions in p1_embed/web/bin.

Required:
  --to VERSION           Official deploy version, e.g. 0.1.173.

Options:
  --from VERSION         Previous official deploy version. Defaults to manifest latest.
  --allow-http          Compile app with lab-only HTTP OTA URL support.
  --no-delta            Bootstrap/full-installer release only; do not create a delta.
  --force               Replace existing release files for --to.

Environment:
  DETOOLS                detools executable path, default: detools.
  MEMORY_SIZE            app partition size, default: 0x230000.
  SEGMENT_SIZE           erase/patch segment size, default: 4096.
  P1E_RELEASE_BUILD_ROOT build root, default: /private/tmp/p1e-release.
USAGE
}

die() {
  echo "error: $*" >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --to)
      [[ $# -ge 2 ]] || die "--to requires a value"
      TO_VERSION="$2"
      shift 2
      ;;
    --from)
      [[ $# -ge 2 ]] || die "--from requires a value"
      FROM_VERSION="$2"
      shift 2
      ;;
    --allow-http)
      ALLOW_HTTP=1
      shift
      ;;
    --no-delta)
      NO_DELTA=1
      shift
      ;;
    --force)
      FORCE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

[[ -n "${TO_VERSION}" ]] || { usage; exit 2; }
[[ "${TO_VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "deploy version must look like 0.1.173, got ${TO_VERSION}"
if [[ -n "${FROM_VERSION}" && ! "${FROM_VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  die "from version must look like 0.1.172, got ${FROM_VERSION}"
fi

mkdir -p "${RELEASE_DIR}"

read_config_version() {
  python3 - "$CONFIG_H" <<'PY'
import re
import sys
text = open(sys.argv[1], encoding="utf-8").read()
match = re.search(r'#define\s+P1_EMBED_FIRMWARE_VERSION\s+"([^"]+)"', text)
if not match:
    raise SystemExit("missing P1_EMBED_FIRMWARE_VERSION")
print(match.group(1))
PY
}

set_config_version() {
  local version="$1"
  python3 - "$CONFIG_H" "$version" <<'PY'
import re
import sys
path, version = sys.argv[1], sys.argv[2]
text = open(path, encoding="utf-8").read()
updated, count = re.subn(
    r'(#define\s+P1_EMBED_FIRMWARE_VERSION\s+)"[^"]+"',
    rf'\1"{version}"',
    text,
    count=1,
)
if count != 1:
    raise SystemExit("failed to update P1_EMBED_FIRMWARE_VERSION")
open(path, "w", encoding="utf-8").write(updated)
PY
}

sha256_file() {
  shasum -a 256 "$1" | awk '{print $1}'
}

file_size() {
  wc -c < "$1" | tr -d ' '
}

pad_to_segment_boundary() {
  local src="$1"
  local dst="$2"
  python3 - "$src" "$dst" "$SEGMENT_SIZE" <<'PY'
from pathlib import Path
import sys
src = Path(sys.argv[1])
dst = Path(sys.argv[2])
segment_size = int(sys.argv[3], 0)
data = src.read_bytes()
padded_size = ((len(data) + segment_size - 1) // segment_size) * segment_size
dst.write_bytes(data + (b"\xff" * (padded_size - len(data))))
PY
}

manifest_latest() {
  if [[ ! -f "${MANIFEST}" ]]; then
    return 0
  fi
  python3 - "$MANIFEST" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)
print(data.get("latest", ""))
PY
}

if [[ -z "${FROM_VERSION}" && "${NO_DELTA}" == "0" ]]; then
  FROM_VERSION="$(manifest_latest)"
fi

if [[ "${NO_DELTA}" == "0" && -z "${FROM_VERSION}" ]]; then
  die "no previous release found; use --no-delta for the first bootstrap deploy"
fi
APP_VERSIONED="${RELEASE_DIR}/p1e-esp32-classic-safeboot-${TO_VERSION}.app.bin"
UPDATER_VERSIONED="${RELEASE_DIR}/p1e-esp32-classic-safeboot-${TO_VERSION}.updater.bin"
BOOTLOADER_VERSIONED="${RELEASE_DIR}/p1e-esp32-classic-safeboot-${TO_VERSION}.bootloader.bin"
PARTITIONS_VERSIONED="${RELEASE_DIR}/p1e-esp32-classic-safeboot-${TO_VERSION}.partitions.bin"
BOOT_APP0_VERSIONED="${RELEASE_DIR}/p1e-esp32-classic-safeboot-${TO_VERSION}.boot_app0.bin"

if [[ "${FORCE}" != "1" && -e "${APP_VERSIONED}" ]]; then
  die "release ${TO_VERSION} already exists; use --force to replace it"
fi

OLD_VERSION="$(read_config_version)"
BACKUP_CONFIG="$(mktemp)"
cp "${CONFIG_H}" "${BACKUP_CONFIG}"
SUCCESS=0
cleanup() {
  if [[ "${SUCCESS}" != "1" ]]; then
    cp "${BACKUP_CONFIG}" "${CONFIG_H}"
  fi
  rm -f "${BACKUP_CONFIG}"
}
trap cleanup EXIT

echo "Setting official deploy version ${TO_VERSION}"
set_config_version "${TO_VERSION}"

UPDATER_BUILD="${BUILD_ROOT}/${TO_VERSION}/updater"
APP_BUILD="${BUILD_ROOT}/${TO_VERSION}/app"
export ESP32_UPDATER_BUILD_PATH="${UPDATER_BUILD}"
export ESP32_APP_BUILD_PATH="${APP_BUILD}"
export P1E_SAFEBOOT_ALLOW_HTTP="${ALLOW_HTTP}"

"${SCRIPT_DIR}/p1embed-safeboot-compile.sh"

BOOT_APP0="$(find "${HOME}/Library/Arduino15/packages/esp32/hardware/esp32" -path '*/tools/partitions/boot_app0.bin' -type f | sort | tail -n 1)"
[[ -f "${BOOT_APP0}" ]] || die "could not find boot_app0.bin"

for file in \
  "${APP_BUILD}/p1_embed.ino.bootloader.bin" \
  "${APP_BUILD}/p1_embed.ino.partitions.bin" \
  "${BOOT_APP0}" \
  "${UPDATER_BUILD}/p1_embed_updater.ino.bin" \
  "${APP_BUILD}/p1_embed.ino.bin"; do
  [[ -f "${file}" ]] || die "missing build output: ${file}"
done

cp "${APP_BUILD}/p1_embed.ino.bin" "${APP_VERSIONED}"
cp "${UPDATER_BUILD}/p1_embed_updater.ino.bin" "${UPDATER_VERSIONED}"
cp "${APP_BUILD}/p1_embed.ino.bootloader.bin" "${BOOTLOADER_VERSIONED}"
cp "${APP_BUILD}/p1_embed.ino.partitions.bin" "${PARTITIONS_VERSIONED}"
cp "${BOOT_APP0}" "${BOOT_APP0_VERSIONED}"

cp "${APP_VERSIONED}" "${WEB_BIN}/p1e-esp32-classic-safeboot.app.bin"
cp "${UPDATER_VERSIONED}" "${WEB_BIN}/p1e-esp32-classic-safeboot.updater.bin"
cp "${BOOTLOADER_VERSIONED}" "${WEB_BIN}/p1e-esp32-classic-safeboot.bootloader.bin"
cp "${PARTITIONS_VERSIONED}" "${WEB_BIN}/p1e-esp32-classic-safeboot.partitions.bin"
cp "${BOOT_APP0_VERSIONED}" "${WEB_BIN}/p1e-esp32-classic-safeboot.boot_app0.bin"

cat > "${INSTALLER_MANIFEST}" <<JSON
{
  "name": "XOBIT ESP32 classic SafeBoot",
  "version": "${TO_VERSION}",
  "flashMode": "dio",
  "flashFreq": "80m",
  "flashSize": "4MB",
  "eraseAll": false,
  "compress": true,
  "experimental": false,
  "files": [
    { "address": "0x1000", "url": "p1e-esp32-classic-safeboot.bootloader.bin" },
    { "address": "0x8000", "url": "p1e-esp32-classic-safeboot.partitions.bin" },
    { "address": "0xe000", "url": "p1e-esp32-classic-safeboot.boot_app0.bin" },
    { "address": "0x10000", "url": "p1e-esp32-classic-safeboot.updater.bin" },
    { "address": "0x120000", "url": "p1e-esp32-classic-safeboot.app.bin" }
  ]
}
JSON

DELTA_JSON="{}"
if [[ "${NO_DELTA}" == "0" ]]; then
  FROM_APP="${RELEASE_DIR}/p1e-esp32-classic-safeboot-${FROM_VERSION}.app.bin"
  [[ -f "${FROM_APP}" ]] || die "missing previous app release: ${FROM_APP}"

  PATCH_REL="releases/p1e-safeboot-delta-${FROM_VERSION}-to-${TO_VERSION}.patch"
  PATCH_BASENAME="$(basename "${PATCH_REL}")"
  PATCH_FILE="${WEB_BIN}/${PATCH_REL}"
  PATCH_PREPARE_FILE="${PATCH_FILE}.prepare.json"
  TMP_DIR="$(mktemp -d)"
  FROM_PADDED="${TMP_DIR}/from-padded.bin"
  TO_PADDED="${TMP_DIR}/to-padded.bin"
  HOST_PROBE="${TMP_DIR}/detools_in_place_probe"
  MEMORY_IMAGE="${TMP_DIR}/memory.bin"

  pad_to_segment_boundary "${FROM_APP}" "${FROM_PADDED}"
  pad_to_segment_boundary "${APP_VERSIONED}" "${TO_PADDED}"

  "${DETOOLS_BIN}" create_patch_in_place \
    -c heatshrink \
    --memory-size "${MEMORY_SIZE}" \
    --segment-size "${SEGMENT_SIZE}" \
    "${FROM_PADDED}" \
    "${TO_PADDED}" \
    "${PATCH_FILE}"

  cc -DDETOOLS_CONFIG_FILE_IO=1 -DDETOOLS_CONFIG_COMPRESSION_HEATSHRINK=1 \
    -I"${PORTAL_ROOT}/p1_embed/firmware/p1_embed_updater/src/detools" \
    "${PORTAL_ROOT}/p1_embed/tests/detools_host/detools_in_place_probe.c" \
    "${PORTAL_ROOT}/p1_embed/firmware/p1_embed_updater/src/detools/detools.c" \
    "${PORTAL_ROOT}/p1_embed/firmware/p1_embed_updater/src/detools/heatshrink_decoder.c" \
    -o "${HOST_PROBE}"

  "${HOST_PROBE}" "${FROM_PADDED}" "${TO_PADDED}" "${PATCH_FILE}" "${MEMORY_IMAGE}" "${MEMORY_SIZE}" "${SEGMENT_SIZE}"

  FROM_SHA="$(sha256_file "${FROM_PADDED}")"
  TO_SHA="$(sha256_file "${TO_PADDED}")"
  PATCH_SHA="$(sha256_file "${PATCH_FILE}")"
  FROM_SIZE="$(file_size "${FROM_PADDED}")"
  TO_SIZE="$(file_size "${TO_PADDED}")"
  PATCH_SIZE="$(file_size "${PATCH_FILE}")"
  RAW_FROM_SIZE="$(file_size "${FROM_APP}")"
  RAW_TO_SIZE="$(file_size "${APP_VERSIONED}")"

  cat > "${PATCH_PREPARE_FILE}" <<JSON
{
  "type": "cmd",
  "id": "delta-prepare",
  "name": "firmware.update.prepare",
  "kind": "delta",
  "url": "${PATCH_BASENAME}",
  "sha256": "${PATCH_SHA}",
  "fromSha256": "${FROM_SHA}",
  "toSha256": "${TO_SHA}",
  "fromSize": ${FROM_SIZE},
  "toSize": ${TO_SIZE},
  "memorySize": ${MEMORY_SIZE},
  "segmentSize": ${SEGMENT_SIZE},
  "reboot": false
}
JSON

  DELTA_JSON="$(python3 - <<PY
import json
print(json.dumps({
  "fromVersion": "${FROM_VERSION}",
  "toVersion": "${TO_VERSION}",
  "kind": "detools-in-place",
  "compression": "heatshrink",
  "url": "${PATCH_REL}",
  "prepareUrl": "${PATCH_REL}.prepare.json",
  "sha256": "${PATCH_SHA}",
  "size": int("${PATCH_SIZE}"),
  "fromSha256": "${FROM_SHA}",
  "toSha256": "${TO_SHA}",
  "fromSize": int("${FROM_SIZE}"),
  "toSize": int("${TO_SIZE}"),
  "rawFromSize": int("${RAW_FROM_SIZE}"),
  "rawToSize": int("${RAW_TO_SIZE}"),
  "memorySize": int("${MEMORY_SIZE}"),
  "segmentSize": int("${SEGMENT_SIZE}"),
  "hostProbe": "passed"
}, separators=(",", ":")))
PY
)"
  rm -rf "${TMP_DIR}"
fi

APP_SHA="$(sha256_file "${APP_VERSIONED}")"
UPDATER_SHA="$(sha256_file "${UPDATER_VERSIONED}")"
BOOTLOADER_SHA="$(sha256_file "${BOOTLOADER_VERSIONED}")"
PARTITIONS_SHA="$(sha256_file "${PARTITIONS_VERSIONED}")"
BOOT_APP0_SHA="$(sha256_file "${BOOT_APP0_VERSIONED}")"
APP_SIZE="$(file_size "${APP_VERSIONED}")"
UPDATER_SIZE="$(file_size "${UPDATER_VERSIONED}")"

export MANIFEST TO_VERSION OLD_VERSION APP_SHA UPDATER_SHA BOOTLOADER_SHA PARTITIONS_SHA BOOT_APP0_SHA APP_SIZE UPDATER_SIZE DELTA_JSON ALLOW_HTTP
python3 - <<'PY'
import datetime as _dt
import json
import os
from pathlib import Path

manifest_path = Path(os.environ["MANIFEST"])
if manifest_path.exists():
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
else:
    data = {
        "schemaVersion": 1,
        "channel": "safeboot-experimental",
        "latest": "",
        "releases": [],
        "deltas": [],
    }

version = os.environ["TO_VERSION"]
release = {
    "version": version,
    "createdAt": _dt.datetime.now(_dt.timezone.utc).isoformat().replace("+00:00", "Z"),
    "buildLabel": "release",
    "allowHttpOtaUrls": os.environ["ALLOW_HTTP"] == "1",
    "fullInstallerManifest": "p1e-firmware-safeboot.json",
    "app": {
        "url": f"releases/p1e-esp32-classic-safeboot-{version}.app.bin",
        "sha256": os.environ["APP_SHA"],
        "size": int(os.environ["APP_SIZE"]),
    },
    "updater": {
        "url": f"releases/p1e-esp32-classic-safeboot-{version}.updater.bin",
        "sha256": os.environ["UPDATER_SHA"],
        "size": int(os.environ["UPDATER_SIZE"]),
    },
    "bootloader": {
        "url": f"releases/p1e-esp32-classic-safeboot-{version}.bootloader.bin",
        "sha256": os.environ["BOOTLOADER_SHA"],
    },
    "partitions": {
        "url": f"releases/p1e-esp32-classic-safeboot-{version}.partitions.bin",
        "sha256": os.environ["PARTITIONS_SHA"],
    },
    "bootApp0": {
        "url": f"releases/p1e-esp32-classic-safeboot-{version}.boot_app0.bin",
        "sha256": os.environ["BOOT_APP0_SHA"],
    },
}

data["schemaVersion"] = 1
data["channel"] = "safeboot-experimental"
data["latest"] = version
data["installerManifest"] = "p1e-firmware-safeboot.json"
data["releases"] = [item for item in data.get("releases", []) if item.get("version") != version]
data["releases"].append(release)
data["releases"].sort(key=lambda item: [int(part) for part in item["version"].split(".")])

delta = json.loads(os.environ["DELTA_JSON"])
if delta:
    data["deltas"] = [
        item for item in data.get("deltas", [])
        if not (item.get("fromVersion") == delta["fromVersion"] and item.get("toVersion") == delta["toVersion"])
    ]
    data["deltas"].append(delta)
    data["deltas"].sort(key=lambda item: ([int(part) for part in item["fromVersion"].split(".")],
                                          [int(part) for part in item["toVersion"].split(".")]))

manifest_path.write_text(json.dumps(data, indent=2, sort_keys=False) + "\n", encoding="utf-8")
PY

SUCCESS=1
trap - EXIT
rm -f "${BACKUP_CONFIG}"

cat <<REPORT
XOBIT SafeBoot deploy complete
  previous config version: ${OLD_VERSION}
  deploy version:          ${TO_VERSION}
  installer manifest:      ${INSTALLER_MANIFEST}
  release manifest:        ${MANIFEST}
  app:                     ${APP_VERSIONED}
  updater:                 ${UPDATER_VERSIONED}
REPORT
if [[ "${NO_DELTA}" == "0" ]]; then
  cat <<REPORT
  delta:                   ${WEB_BIN}/releases/p1e-safeboot-delta-${FROM_VERSION}-to-${TO_VERSION}.patch
  delta prepare:           ${WEB_BIN}/releases/p1e-safeboot-delta-${FROM_VERSION}-to-${TO_VERSION}.patch.prepare.json
REPORT
fi
