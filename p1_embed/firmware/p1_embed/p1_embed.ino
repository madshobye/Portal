#include <Arduino.h>
#include "p1_embed_firmware.h"

static unsigned long g_bootMs = 0;
static unsigned long g_lastStatusMs = 0;
#if P1_EMBED_WRENCH_ENABLED
static bool g_bootAutorunWaitingForWifi = false;
static unsigned long g_bootAutorunWaitStartedAt = 0;
static uint8_t g_bootAutorunRunState = P1_EMBED_SCRIPT_RUN_NONE;

static void bootCompileAndRunStoredScript(const char* reason) {
  String bootScript;
  if (!scriptStoreLoad(bootScript) || bootScript.length() == 0) {
    protocolEmitErrorEvent("script.error", "boot_load_failed", "Stored script could not be loaded");
    return;
  }

  String err;
  if (wrenchCompileAndRun(bootScript, err)) {
    if (g_bootAutorunRunState != P1_EMBED_SCRIPT_RUN_OK) {
      scriptStoreArmVerification();
    }
    protocolEmitEvent("script.state", "\"state\":\"running\",\"source\":\"stored\",\"bootReason\":" + jsonString(reason));
  } else {
    protocolEmitErrorEvent("script.error", "boot_compile_failed", err);
  }
  bootScript = "";
}

static void bootPollDelayedAutorun() {
  if (!g_bootAutorunWaitingForWifi) return;

  bool wifiReady = wifiIsConnected();
  bool waitExpired = millis() - g_bootAutorunWaitStartedAt >= P1_EMBED_BOOT_AUTORUN_WIFI_WAIT_MS;
  if (!wifiReady && !waitExpired) return;

  g_bootAutorunWaitingForWifi = false;
  bootCompileAndRunStoredScript(wifiReady ? "wifi_connected" : "wifi_wait_timeout");
}
#endif

void setup() {
  g_bootMs = millis();
  memoryProfileBegin();
  memoryProfileMark("boot", "entry");
  transportSerialBegin();
  memoryProfileMark("serial", "begin");
  debugEventBegin();
  memoryProfileMark("debug", "begin");
#if P1_EMBED_WRENCH_ENABLED
  wrenchInboxBegin();
  memoryProfileMark("wrench_inbox", "begin");
#endif
  pwmManagerBegin();
  memoryProfileMark("pwm", "begin");
  uartManagerBegin();
  memoryProfileMark("uart", "begin");
  configLoad();
  memoryProfileMark("config", "load");
  fastLedManagerBegin();
  memoryProfileMark("fastled", "begin");
#if P1_EMBED_WRENCH_ENABLED
  scriptStoreBegin();
  memoryProfileMark("script_store", "begin");
#endif
  wifiBegin();
  memoryProfileMark("wifi", "begin");
  webTransportBegin();
  memoryProfileMark("websocket", "begin");
  webrtcTransportBegin();
  memoryProfileMark("webrtc", "begin");
  protocolEmitBoot();
  memoryProfileMark("protocol", "boot_emit");
#if P1_EMBED_WRENCH_ENABLED
#if P1_EMBED_WRENCH_AUTORUN_ENABLED
  wrenchTaskBegin();
  memoryProfileMark("wrench_task", "begin");
#else
  memoryProfileMark("wrench_task", "lazy");
#endif

  String bootScript;
  String bootSource = "default";
  uint8_t runState = scriptStoreLoadRunState();
  bool haveStoredScript = scriptStoreHasSaved();

#if !P1_EMBED_WRENCH_AUTORUN_ENABLED
  protocolEmitEvent("script.state", "\"state\":\"compiled\",\"source\":\"stored\",\"autorun\":\"disabled_for_webrtc_lab\"");
  memoryProfileMark("wrench", "autorun_disabled");
#else

  if (haveStoredScript && runState == P1_EMBED_SCRIPT_RUN_PENDING_TRIED) {
    protocolEmitErrorEvent("script.storage", "stored_script_skipped", "Stored script skipped because the previous boot did not verify");
    bootScript = wrenchDefaultScript();
  } else if (haveStoredScript) {
    bootSource = "stored";
  } else {
    bootScript = wrenchDefaultScript();
  }

  String err;
  bool waitForWifiBeforeStoredRun = bootSource == "stored" && configWifiNetworkCount() > 0 && !wifiIsConnected();
  if (waitForWifiBeforeStoredRun) {
    if (runState == P1_EMBED_SCRIPT_RUN_PENDING_NEW) {
      scriptStoreSaveRunState(P1_EMBED_SCRIPT_RUN_PENDING_TRIED);
    }
    g_bootAutorunWaitingForWifi = true;
    g_bootAutorunWaitStartedAt = millis();
    g_bootAutorunRunState = runState;
    protocolEmitEvent("script.state", "\"state\":\"stored\",\"source\":\"stored\",\"autorun\":\"waiting_for_wifi\",\"timeoutMs\":" + String(P1_EMBED_BOOT_AUTORUN_WIFI_WAIT_MS));
    memoryProfileMark("wrench", "autorun_wait_wifi");
  } else {
    if (bootSource == "stored" && (!scriptStoreLoad(bootScript) || bootScript.length() == 0)) {
      err = "Stored script could not be loaded";
    }
    if (err.length() == 0 && wrenchCompileAndRun(bootScript, err)) {
      if (bootSource == "stored") {
        if (runState == P1_EMBED_SCRIPT_RUN_PENDING_NEW) {
          scriptStoreSaveRunState(P1_EMBED_SCRIPT_RUN_PENDING_TRIED);
        }
        if (runState != P1_EMBED_SCRIPT_RUN_OK) {
          scriptStoreArmVerification();
        }
      }
      protocolEmitEvent("script.state", "\"state\":\"running\",\"source\":" + jsonString(bootSource));
      memoryProfileMark("wrench", "autorun_running");
    } else {
      protocolEmitErrorEvent("script.error", "boot_compile_failed", err);
      memoryProfileMark("wrench", "autorun_error");
      if (bootSource == "stored" && runState == P1_EMBED_SCRIPT_RUN_PENDING_NEW) {
        scriptStoreSaveRunState(P1_EMBED_SCRIPT_RUN_PENDING_TRIED);
      }
    }
  }
#endif
#else
  protocolEmitEvent("script.state", "\"state\":\"disabled\",\"source\":\"webrtc_lab\"");
  memoryProfileMark("wrench", "disabled");
#endif
  memoryProfileMark("boot", "setup_done");
}

void loop() {
  transportSerialPoll();
  wifiLoop();
  webTransportLoop();
#if P1_EMBED_WRENCH_ENABLED
  bootPollDelayedAutorun();
#endif
  webrtcTransportLoop();
  protocolPollScriptJobs();
  debugEventFlush();
#if P1_EMBED_WRENCH_ENABLED
  wrenchRuntimePoll();
  wrenchWatchdogPoll();
  scriptStoreVerifyIfDue();
#endif

  unsigned long now = millis();
  if (now - g_lastStatusMs >= P1_EMBED_STATUS_INTERVAL_MS) {
    g_lastStatusMs = now;
    protocolEmitStatusEvent();
  }
}
