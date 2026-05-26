#include <Arduino.h>
#include "p1_embed_firmware.h"

static unsigned long g_bootMs = 0;
static unsigned long g_lastStatusMs = 0;
static bool g_bootAutorunWaitingForWifi = false;
static unsigned long g_bootAutorunWaitStartedAt = 0;
static uint8_t g_bootAutorunRunState = P1_EMBED_SCRIPT_RUN_NONE;

static void bootRunCompiledStoredScript(const char* reason) {
  String err;
  if (wrenchRunCompiled(err)) {
    if (g_bootAutorunRunState != P1_EMBED_SCRIPT_RUN_OK) {
      scriptStoreArmVerification();
    }
    protocolEmitEvent("script.state", "\"state\":\"running\",\"source\":\"stored\",\"bootReason\":" + jsonString(reason));
  } else {
    protocolEmitErrorEvent("script.error", "boot_run_failed", err);
  }
}

static void bootPollDelayedAutorun() {
  if (!g_bootAutorunWaitingForWifi) return;

  bool wifiReady = wifiIsConnected();
  bool waitExpired = millis() - g_bootAutorunWaitStartedAt >= P1_EMBED_BOOT_AUTORUN_WIFI_WAIT_MS;
  if (!wifiReady && !waitExpired) return;

  g_bootAutorunWaitingForWifi = false;
  bootRunCompiledStoredScript(wifiReady ? "wifi_connected" : "wifi_wait_timeout");
}

void setup() {
  g_bootMs = millis();
  transportSerialBegin();
  debugEventBegin();
  wrenchInboxBegin();
  pwmManagerBegin();
  uartManagerBegin();
  configLoad();
  fastLedManagerBegin();
  scriptStoreBegin();
  wifiBegin();
  webTransportBegin();
  webrtcTransportBegin();
  protocolEmitBoot();
  wrenchTaskBegin();

  String bootScript;
  String bootSource = "default";
  uint8_t runState = scriptStoreLoadRunState();
  bool haveStoredScript = scriptStoreLoad(bootScript) && bootScript.length() > 0;

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
    if (wrenchCompileAndSet(bootScript, err)) {
      if (runState == P1_EMBED_SCRIPT_RUN_PENDING_NEW) {
        scriptStoreSaveRunState(P1_EMBED_SCRIPT_RUN_PENDING_TRIED);
      }
      g_bootAutorunWaitingForWifi = true;
      g_bootAutorunWaitStartedAt = millis();
      g_bootAutorunRunState = runState;
      protocolEmitEvent("script.state", "\"state\":\"compiled\",\"source\":\"stored\",\"autorun\":\"waiting_for_wifi\",\"timeoutMs\":" + String(P1_EMBED_BOOT_AUTORUN_WIFI_WAIT_MS));
    } else {
      protocolEmitErrorEvent("script.error", "boot_compile_failed", err);
      if (runState == P1_EMBED_SCRIPT_RUN_PENDING_NEW) {
        scriptStoreSaveRunState(P1_EMBED_SCRIPT_RUN_PENDING_TRIED);
      }
    }
  } else if (wrenchCompileAndRun(bootScript, err)) {
    if (bootSource == "stored") {
      if (runState == P1_EMBED_SCRIPT_RUN_PENDING_NEW) {
        scriptStoreSaveRunState(P1_EMBED_SCRIPT_RUN_PENDING_TRIED);
      }
      if (runState != P1_EMBED_SCRIPT_RUN_OK) {
        scriptStoreArmVerification();
      }
    }
    protocolEmitEvent("script.state", "\"state\":\"running\",\"source\":" + jsonString(bootSource));
  } else {
    protocolEmitErrorEvent("script.error", "boot_compile_failed", err);
    if (bootSource == "stored" && runState == P1_EMBED_SCRIPT_RUN_PENDING_NEW) {
      scriptStoreSaveRunState(P1_EMBED_SCRIPT_RUN_PENDING_TRIED);
    }
  }
}

void loop() {
  transportSerialPoll();
  wifiLoop();
  webTransportLoop();
  webrtcTransportLoop();
  debugEventFlush();
  bootPollDelayedAutorun();
  wrenchRuntimePoll();
  wrenchWatchdogPoll();
  scriptStoreVerifyIfDue();

  unsigned long now = millis();
  if (now - g_lastStatusMs >= P1_EMBED_STATUS_INTERVAL_MS) {
    g_lastStatusMs = now;
    protocolEmitStatusEvent();
  }
}
