#include <Arduino.h>
#include "p1_embed_firmware.h"

static unsigned long g_bootMs = 0;
static unsigned long g_lastStatusMs = 0;

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
  if (wrenchCompileAndRun(bootScript, err)) {
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
  debugEventFlush();
  transportSerialPoll();
  wifiLoop();
  webTransportLoop();
  webrtcTransportLoop();
  wrenchRuntimePoll();
  wrenchWatchdogPoll();
  scriptStoreVerifyIfDue();

  unsigned long now = millis();
  if (now - g_lastStatusMs >= P1_EMBED_STATUS_INTERVAL_MS) {
    g_lastStatusMs = now;
    protocolEmitStatusEvent();
  }
}
