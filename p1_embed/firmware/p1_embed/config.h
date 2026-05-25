#pragma once

#include <Arduino.h>

#define P1_EMBED_FIRMWARE_NAME "p1_embed"
#define P1_EMBED_FIRMWARE_VERSION "0.1.38"
#define P1_EMBED_PROTOCOL_VERSION "0.1"
#define P1_EMBED_WRENCH_API_VERSION "0.1"
#define P1_EMBED_WRENCH_UPSTREAM_REPO "https://github.com/jingoro2112/wrench"
#define P1_EMBED_WRENCH_UPSTREAM_COMMIT "c84d57ee7df6032e90a9cfee2ba24033045b81ec"
#define P1_EMBED_BUILD_CHANNEL "dev"

#define P1_EMBED_SERIAL_BAUD 115200
#define P1_EMBED_LINE_MAX 32768
#define P1_EMBED_MAX_SCRIPT_BYTES 24576
#define P1_EMBED_STATUS_INTERVAL_MS 5000
#define P1_EMBED_DEFAULT_LED_PIN 2
#define P1_EMBED_SCRIPT_VERIFY_MS 5000
#define P1_EMBED_MAX_WIFI_NETWORKS 5
#define P1_EMBED_WRENCH_TASK_STACK 16384
#define P1_EMBED_WRENCH_COMPILE_TASK_STACK 12288
#define P1_EMBED_WRENCH_COMPILE_MIN_FREE_HEAP 65536
#define P1_EMBED_WRENCH_COMPILE_MIN_MAX_ALLOC 24576
#define P1_EMBED_WRENCH_LARGE_SCRIPT_BYTES 4096
#define P1_EMBED_WRENCH_LARGE_COMPILE_MIN_FREE_HEAP 81920
#define P1_EMBED_WRENCH_LARGE_COMPILE_MIN_MAX_ALLOC 32768
#define P1_EMBED_WRENCH_TASK_DELAY_MS 1
#define P1_EMBED_WRENCH_LOCK_STATUS_TIMEOUT_MS 5
#define P1_EMBED_WRENCH_LOOP_WARN_MS 1000
#define P1_EMBED_WRENCH_LOOP_HUNG_MS 10000
#define P1_EMBED_WRENCH_INSTRUCTIONS_PER_SLICE 1000
#define P1_EMBED_WRENCH_TRANSITION_TIMEOUT_MS 5000
#define P1_EMBED_PROTOCOL_QUEUE_DEPTH 16
#define P1_EMBED_PROTOCOL_QUEUE_LINE_MAX 384
#define P1_EMBED_DEBUG_DEFAULT_LEVEL 2
#define P1_EMBED_WRENCH_INBOX_DEPTH 8
#define P1_EMBED_WRENCH_INBOX_CHANNEL_MAX 32
#define P1_EMBED_WRENCH_INBOX_MESSAGE_MAX 256
#define P1_EMBED_PWM_MAX_PINS 12
#define P1_EMBED_MAX_BYTECODE_BYTES 49152
#define P1_EMBED_WS_PORT 81
#define P1_EMBED_WEBRTC_ENABLED 0
#define P1_EMBED_WEBRTC_PEERJS_HOST "0.peerjs.com"
#define P1_EMBED_WEBRTC_PEERJS_PORT 443
#define P1_EMBED_WEBRTC_PEERJS_PATH "/"
#define P1_EMBED_WEBRTC_PEERJS_KEY "peerjs"
#define P1_EMBED_WEBRTC_PEERJS_SECURE 1
#define P1_EMBED_WEBRTC_AUTO_SUFFIX_ID 1
#define P1_EMBED_WEBRTC_PEER_TASK_STACK 16384
#define P1_EMBED_WEBRTC_SIGNAL_TASK_STACK 12288
#define P1_EMBED_WEBRTC_SEND_QUEUE_DEPTH 16
#define P1_EMBED_WEBRTC_SEND_MAX_BYTES 4096
#define P1_EMBED_WEBRTC_MAX_CONNECT_FAILURES 3
#define P1_EMBED_WEBRTC_RECONNECT_INTERVAL_MS 5000
#define P1_EMBED_FASTLED_MAX_LEDS 512
#define P1_EMBED_MAX_LED_STRIPS 4
#define P1_EMBED_UART_READ_STRING_MAX 256
#define P1_EMBED_HTTP_MAX_RESPONSE_BYTES 4096
#define P1_EMBED_HTTP_DEFAULT_TIMEOUT_MS 5000
#define P1_EMBED_JSON_ARG_MAX_BYTES 4096
#define P1_EMBED_JSON_PATH_MAX_PARTS 8

#define P1_EMBED_SCRIPT_RUN_NONE 0
#define P1_EMBED_SCRIPT_RUN_PENDING_NEW 1
#define P1_EMBED_SCRIPT_RUN_PENDING_TRIED 2
#define P1_EMBED_SCRIPT_RUN_OK 3

static const char* P1_EMBED_CAPABILITIES[] = {
  "transport.serial.jsonl",
  "transport.websocket.json",
  "discovery.mdns",
  "protocol.v0_1",
  "wrench.compile",
  "wrench.setup_loop",
  "wrench.task",
  "wrench.time_slices",
  "wrench.runtime_mutex",
  "wrench.watchdog.status",
  "debug.event_bus",
  "debug.level_filter",
  "wrench.bindings.core",
  "config.fs.json",
  "config.identity.mac",
  "wifi.station",
  "wifi.station.fallbacks",
  "script.storage.littlefs",
  "script.autorun.safe_latch",
  "wrench.bindings.protocol_services",
  "wrench.bindings.http_fetch",
  "wrench.bindings.json_helpers",
  "wrench.inbox.protocol_input",
  "wrench.bindings.esp_basic",
  "wrench.bindings.i2c_basic",
  "wrench.bindings.secondary_uart",
  "wrench.bindings.pwm_servo_fan",
  "wrench.bindings.fastled_ws2812b",
  "led.manager.multistrip",
  "script.error.last"
};

static const int P1_EMBED_CAPABILITY_COUNT =
  sizeof(P1_EMBED_CAPABILITIES) / sizeof(P1_EMBED_CAPABILITIES[0]);
