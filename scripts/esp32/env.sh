#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORTAL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

ESP32_PROFILE="${ESP32_PROFILE:-${1:-}}"

case "${ESP32_PROFILE}" in
  "")
    ;;
  labelcam)
    ESP32_PORT="${ESP32_PORT:-/dev/cu.wchusbserial5B5E1063521}"
    SKETCH_DIR="${SKETCH_DIR:-${PORTAL_ROOT}/ArduinoExamples/uvc_ble_labelcam}"
    ESP32_SKIP_WEBRTC_LINK="${ESP32_SKIP_WEBRTC_LINK:-1}"
    ESP32_BUILD_PATH="${ESP32_BUILD_PATH:-/private/tmp/labelcam-build}"
    ;;
  bleprint)
    ESP32_PORT="${ESP32_PORT:-/dev/cu.wchusbserial5B5E1063521}"
    SKETCH_DIR="${SKETCH_DIR:-${PORTAL_ROOT}/ArduinoExamples/ble_label_print_sanity}"
    ESP32_SKIP_WEBRTC_LINK="${ESP32_SKIP_WEBRTC_LINK:-1}"
    ESP32_BUILD_PATH="${ESP32_BUILD_PATH:-/private/tmp/ble-print-sanity-build}"
    ;;
  uvcsmoke)
    ESP32_PORT="${ESP32_PORT:-/dev/cu.wchusbserial5B5E1063521}"
    SKETCH_DIR="${SKETCH_DIR:-${PORTAL_ROOT}/arduinolibs/ESP32_UVC_Host/examples/uvc_ascii_smoke}"
    ESP32_SKIP_WEBRTC_LINK="${ESP32_SKIP_WEBRTC_LINK:-1}"
    ESP32_BUILD_PATH="${ESP32_BUILD_PATH:-/private/tmp/uvc-ascii-smoke-build}"
    ;;
  uvccamera)
    ESP32_PORT="${ESP32_PORT:-/dev/cu.wchusbserial5B5E1063521}"
    SKETCH_DIR="${SKETCH_DIR:-${PORTAL_ROOT}/arduinolibs/ESP32_UVC_Host/examples/uvc_camera_test}"
    ESP32_SKIP_WEBRTC_LINK="${ESP32_SKIP_WEBRTC_LINK:-1}"
    ESP32_BUILD_PATH="${ESP32_BUILD_PATH:-/private/tmp/uvc-camera-test-build}"
    ;;
  usbenum)
    ESP32_PORT="${ESP32_PORT:-/dev/cu.wchusbserial5B5E1063521}"
    SKETCH_DIR="${SKETCH_DIR:-${PORTAL_ROOT}/ArduinoExamples/usb_enumerate}"
    ESP32_SKIP_WEBRTC_LINK="${ESP32_SKIP_WEBRTC_LINK:-1}"
    ESP32_BUILD_PATH="${ESP32_BUILD_PATH:-/private/tmp/usb-enumerate-build}"
    ;;
  uvchostprobe)
    ESP32_PORT="${ESP32_PORT:-/dev/cu.wchusbserial5B5E1063521}"
    SKETCH_DIR="${SKETCH_DIR:-${PORTAL_ROOT}/ArduinoExamples/uvc_host_probe}"
    ESP32_SKIP_WEBRTC_LINK="${ESP32_SKIP_WEBRTC_LINK:-1}"
    ESP32_BUILD_PATH="${ESP32_BUILD_PATH:-/private/tmp/uvc-host-probe-build}"
    ;;
  usbstream)
    ESP32_PORT="${ESP32_PORT:-/dev/cu.wchusbserial5B5E1063521}"
    SKETCH_DIR="${SKETCH_DIR:-${PORTAL_ROOT}/arduinolibs/ESP32_USB_STREAM/examples/LogitechUVCProbeSmoke}"
    ESP32_SKIP_WEBRTC_LINK="${ESP32_SKIP_WEBRTC_LINK:-1}"
    ESP32_BUILD_PATH="${ESP32_BUILD_PATH:-/private/tmp/logitech-uvc-stream-build}"
    ;;
  serialsmoke)
    ESP32_PORT="${ESP32_PORT:-/dev/cu.wchusbserial5B5E1063521}"
    ESP32_FQBN="${ESP32_FQBN:-esp32:esp32:esp32s3:USBMode=default,CDCOnBoot=default,UploadMode=default,FlashSize=4M,PartitionScheme=default,PSRAM=disabled}"
    SKETCH_DIR="${SKETCH_DIR:-${PORTAL_ROOT}/ArduinoExamples/serial_smoke}"
    ESP32_SKIP_WEBRTC_LINK="${ESP32_SKIP_WEBRTC_LINK:-1}"
    ESP32_BUILD_PATH="${ESP32_BUILD_PATH:-/private/tmp/serial-smoke-build}"
    ;;
  p1embed)
    ESP32_PORT="${ESP32_PORT:-/dev/cu.wchusbserial58741104521}"
    ESP32_FQBN="${ESP32_FQBN:-esp32:esp32:esp32:PartitionScheme=huge_app}"
    SKETCH_DIR="${SKETCH_DIR:-${PORTAL_ROOT}/p1_embed/firmware/p1_embed}"
    PORTAL_ARDUINO_LIBS="${PORTAL_ARDUINO_LIBS:-${PORTAL_ROOT}/p1_embed/arduino_libraries}"
    ESP32_WEBRTC_LIBRARY_ROOT="${ESP32_WEBRTC_LIBRARY_ROOT:-${PORTAL_ROOT}/arduinolibs/ESP32_WebRTC_light}"
    ESP32_SKIP_WEBRTC_LINK="${ESP32_SKIP_WEBRTC_LINK:-0}"
    ESP32_BUILD_PATH="${ESP32_BUILD_PATH:-/private/tmp/p1-embed-build}"
    ;;
  *)
    echo "Unknown ESP32 script profile: ${ESP32_PROFILE}" >&2
    exit 2
    ;;
esac

if [[ -z "${ARDUINO_CLI:-}" ]]; then
  if [[ -x "/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli" ]]; then
    ARDUINO_CLI="/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli"
  elif command -v arduino-cli >/dev/null 2>&1; then
    ARDUINO_CLI="$(command -v arduino-cli)"
  else
    echo "Could not find arduino-cli. Install Arduino IDE, install arduino-cli, or set ARDUINO_CLI." >&2
    exit 2
  fi
fi
ESP32_PORT="${ESP32_PORT:-/dev/cu.wchusbserial5B5E1092281}"
ESP32_FQBN="${ESP32_FQBN:-esp32:esp32:esp32s3:FlashSize=8M,PartitionScheme=default_8MB,PSRAM=opi}"
ESP32_BAUD="${ESP32_BAUD:-115200}"

SKETCH_DIR="${SKETCH_DIR:-${PORTAL_ROOT}/ArduinoExamples/printhost}"
PORTAL_ARDUINO_LIBS="${PORTAL_ARDUINO_LIBS:-${PORTAL_ROOT}/arduinolibs}"
USER_ARDUINO_LIBS="${USER_ARDUINO_LIBS:-${HOME}/Documents/Arduino/libraries}"

esp32_ld_libs_for_tool() {
  local tool_dir="$1"
  local tool_root="${HOME}/Library/Arduino15/packages/esp32/tools/${tool_dir}"
  local latest_version=""
  local latest=""

  if [[ -n "${ESP32_ARDUINO_VERSION:-}" ]]; then
    latest_version="${ESP32_ARDUINO_VERSION}"
  elif [[ -d "${tool_root}" ]]; then
    latest_version="$(
      find "${tool_root}" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; \
        | sort -t. -k1,1n -k2,2n -k3,3n \
        | tail -n 1
    )"
  fi

  if [[ -n "${latest_version}" ]]; then
    latest="${tool_root}/${latest_version}/flags/ld_libs"
  fi

  if [[ ! -f "${latest}" ]]; then
    echo "Could not find Arduino ESP32 linker flags for ${tool_dir}." >&2
    echo "Install the esp32 board package in Arduino IDE or set ESP32_PLATFORM_LIBS." >&2
    exit 2
  fi

  printf '%s\n' "${latest}"
}

case "${ESP32_FQBN}" in
  esp32:esp32:esp32s3*)
    ESP32_ARCH_DIR_DEFAULT="esp32s3"
    ESP32_PLATFORM_LIBS_DEFAULT="$(esp32_ld_libs_for_tool esp32s3-libs)"
    ;;
  esp32:esp32:esp32:*)
    ESP32_ARCH_DIR_DEFAULT="esp32"
    ESP32_PLATFORM_LIBS_DEFAULT="$(esp32_ld_libs_for_tool esp32-libs)"
    ;;
  esp32:esp32:esp32)
    ESP32_ARCH_DIR_DEFAULT="esp32"
    ESP32_PLATFORM_LIBS_DEFAULT="$(esp32_ld_libs_for_tool esp32-libs)"
    ;;
  *)
    echo "Unsupported ESP32_FQBN for ESP32_WebRTC archive selection: ${ESP32_FQBN}" >&2
    exit 2
    ;;
esac

ESP32_WEBRTC_ARCH_DIR="${ESP32_WEBRTC_ARCH_DIR:-${ESP32_ARCH_DIR_DEFAULT}}"
ESP32_PLATFORM_LIBS="${ESP32_PLATFORM_LIBS:-${ESP32_PLATFORM_LIBS_DEFAULT}}"
ESP32_WEBRTC_LIBRARY_ROOT="${ESP32_WEBRTC_LIBRARY_ROOT:-${PORTAL_ROOT}/arduinolibs/ESP32_WebRTC}"
ESP32_WEBRTC_ARCH_LIBS="${ESP32_WEBRTC_ARCH_LIBS:-${ESP32_WEBRTC_LIBRARY_ROOT}/src/${ESP32_WEBRTC_ARCH_DIR}}"
ESP32_WEBRTC_LINK_LIBS="${ESP32_WEBRTC_LINK_LIBS:-@${ESP32_PLATFORM_LIBS} -L${ESP32_WEBRTC_ARCH_LIBS} -lsepfy__srtp}"

if [[ "${ESP32_PROFILE}" == "labelcam" || "${ESP32_PROFILE}" == "bleprint" || "${ESP32_PROFILE}" == "uvcsmoke" || "${ESP32_PROFILE}" == "uvccamera" || "${ESP32_PROFILE}" == "usbenum" || "${ESP32_PROFILE}" == "uvchostprobe" || "${ESP32_PROFILE}" == "usbstream" ]]; then
  ESP32_LINK_LIBS="${ESP32_LINK_LIBS:-@${ESP32_PLATFORM_LIBS}}"
fi
