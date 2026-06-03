#include <Arduino.h>
#include <LittleFS.h>
#include <Preferences.h>
#include "p1_embed_firmware.h"

static const char* SCRIPT_STORE_PATH = "/wrench_code.txt";
static const char* SCRIPT_CURRENT_PATH = "/wrench_current.txt";
static const char* SCRIPT_INCOMING_PATH = "/wrench_incoming.txt";
static const char* SCRIPT_STORE_NVS_NS = "p1script";
static const char* SCRIPT_STORE_RUNSTATE_KEY = "runstate";
static const char* SCRIPT_STORE_INCOMING_OPTIONS_KEY = "in_options";

static bool g_scriptFsReady = false;
static bool g_scriptVerifyArmed = false;
static unsigned long g_scriptRunStartedAt = 0;

bool scriptStoreBegin() {
  if (g_scriptFsReady) return true;
  if (!LittleFS.begin(false)) {
    if (!LittleFS.begin(true)) return false;
  }
  g_scriptFsReady = true;
  return true;
}

static bool scriptStoreLoadPath(const char* path, String& out) {
  out = "";
  if (!scriptStoreBegin()) return false;

  File f = LittleFS.open(path, "r");
  if (!f) return false;

  size_t n = (size_t)f.size();
  if (n == 0 || n > P1_EMBED_MAX_SCRIPT_BYTES) {
    f.close();
    return n == 0;
  }

  if (!out.reserve(n)) {
    f.close();
    return false;
  }

  char buf[256];
  size_t got = 0;
  while (got < n) {
    size_t want = min(sizeof(buf), n - got);
    size_t chunk = f.readBytes(buf, want);
    if (chunk == 0) break;
    out.concat(buf, chunk);
    got += chunk;
  }
  f.close();
  return got == n;
}

static bool scriptStoreSavePath(const char* path, const String& code) {
  if (code.length() == 0 || code.length() > P1_EMBED_MAX_SCRIPT_BYTES) return false;
  if (!scriptStoreBegin()) return false;

  if (LittleFS.exists(path)) LittleFS.remove(path);

  File f = LittleFS.open(path, "w");
  if (!f) return false;

  size_t wrote = f.write((const uint8_t*)code.c_str(), code.length());
  f.flush();
  f.close();
  return wrote == code.length();
}

bool scriptStoreLoad(String& out) {
  return scriptStoreLoadPath(SCRIPT_STORE_PATH, out);
}

bool scriptStoreSave(const String& code) {
  return scriptStoreSavePath(SCRIPT_STORE_PATH, code);
}

bool scriptStoreClear() {
  if (!scriptStoreBegin()) return false;
  if (LittleFS.exists(SCRIPT_STORE_PATH) && !LittleFS.remove(SCRIPT_STORE_PATH)) return false;
  scriptStoreSaveRunState(P1_EMBED_SCRIPT_RUN_NONE);
  g_scriptVerifyArmed = false;
  return true;
}

bool scriptStoreHasSaved() {
  if (!scriptStoreBegin()) return false;
  return LittleFS.exists(SCRIPT_STORE_PATH);
}

bool scriptStoreLoadCurrent(String& out) {
  return scriptStoreLoadPath(SCRIPT_CURRENT_PATH, out);
}

bool scriptStoreSaveCurrent(const String& code) {
  return scriptStoreSavePath(SCRIPT_CURRENT_PATH, code);
}

bool scriptStoreClearCurrent() {
  if (!scriptStoreBegin()) return false;
  if (LittleFS.exists(SCRIPT_CURRENT_PATH) && !LittleFS.remove(SCRIPT_CURRENT_PATH)) return false;
  return true;
}

bool scriptStoreLoadIncoming(String& out) {
  return scriptStoreLoadPath(SCRIPT_INCOMING_PATH, out);
}

bool scriptStoreSaveIncoming(const String& code) {
  return scriptStoreSavePath(SCRIPT_INCOMING_PATH, code);
}

bool scriptStoreBeginIncoming() {
  if (!scriptStoreBegin()) return false;
  if (LittleFS.exists(SCRIPT_INCOMING_PATH) && !LittleFS.remove(SCRIPT_INCOMING_PATH)) return false;
  File f = LittleFS.open(SCRIPT_INCOMING_PATH, "w");
  if (!f) return false;
  f.close();
  return true;
}

bool scriptStoreAppendIncoming(const String& chunk) {
  return scriptStoreAppendIncomingBytes((const uint8_t*)chunk.c_str(), chunk.length());
}

bool scriptStoreAppendIncomingBytes(const uint8_t* data, size_t len) {
  if (!scriptStoreBegin()) return false;
  File f = LittleFS.open(SCRIPT_INCOMING_PATH, "a");
  if (!f) return false;
  size_t wrote = f.write(data, len);
  f.flush();
  f.close();
  return wrote == len;
}

bool scriptStoreClearIncoming() {
  if (!scriptStoreBegin()) return false;
  if (LittleFS.exists(SCRIPT_INCOMING_PATH) && !LittleFS.remove(SCRIPT_INCOMING_PATH)) return false;
  return true;
}

void scriptStoreSaveIncomingRunOptions(bool runAfterSet, bool saveAfterSet) {
  uint8_t options = (runAfterSet ? 1 : 0) | (saveAfterSet ? 2 : 0);
  Preferences p;
  if (!p.begin(SCRIPT_STORE_NVS_NS, false)) return;
  p.putUChar(SCRIPT_STORE_INCOMING_OPTIONS_KEY, options);
  p.end();
}

void scriptStoreLoadIncomingRunOptions(bool& runAfterSet, bool& saveAfterSet) {
  Preferences p;
  uint8_t options = 0;
  if (p.begin(SCRIPT_STORE_NVS_NS, true)) {
    options = p.getUChar(SCRIPT_STORE_INCOMING_OPTIONS_KEY, 0);
    p.end();
  }
  runAfterSet = (options & 1) != 0;
  saveAfterSet = (options & 2) != 0;
}

uint8_t scriptStoreLoadRunState() {
  Preferences p;
  if (!p.begin(SCRIPT_STORE_NVS_NS, true)) return P1_EMBED_SCRIPT_RUN_NONE;
  uint8_t state = p.getUChar(SCRIPT_STORE_RUNSTATE_KEY, P1_EMBED_SCRIPT_RUN_NONE);
  p.end();
  return state;
}

void scriptStoreSaveRunState(uint8_t state) {
  Preferences p;
  if (!p.begin(SCRIPT_STORE_NVS_NS, false)) return;
  p.putUChar(SCRIPT_STORE_RUNSTATE_KEY, state);
  p.end();
}

const char* scriptStoreRunStateName(uint8_t state) {
  switch (state) {
    case P1_EMBED_SCRIPT_RUN_NONE: return "none";
    case P1_EMBED_SCRIPT_RUN_PENDING_NEW: return "pending_new";
    case P1_EMBED_SCRIPT_RUN_PENDING_TRIED: return "pending_tried";
    case P1_EMBED_SCRIPT_RUN_OK: return "ok";
    case P1_EMBED_SCRIPT_RUN_STOPPED: return "stopped";
  }
  return "unknown";
}

bool scriptStoreVerificationArmed() {
  return g_scriptVerifyArmed;
}

void scriptStoreArmVerification() {
  g_scriptRunStartedAt = millis();
  g_scriptVerifyArmed = true;
}

void scriptStoreMarkVerificationFailed(const char* reason) {
  uint8_t runState = scriptStoreLoadRunState();
  if (!g_scriptVerifyArmed && runState != P1_EMBED_SCRIPT_RUN_PENDING_NEW) return;
  scriptStoreSaveRunState(P1_EMBED_SCRIPT_RUN_PENDING_TRIED);
  g_scriptVerifyArmed = false;
  P1EventField fields[] = {
    p1FieldString("runState", scriptStoreRunStateName(P1_EMBED_SCRIPT_RUN_PENDING_TRIED)),
    p1FieldString("reason", reason && reason[0] ? reason : "script_error"),
  };
  debugEventEmitFields("script.storage", "warn", "script", "autorun validation failed", fields, 2);
}

void scriptStoreVerifyIfDue() {
  if (!g_scriptVerifyArmed) return;
  if (millis() - g_scriptRunStartedAt < P1_EMBED_SCRIPT_VERIFY_MS) return;
  scriptStoreSaveRunState(P1_EMBED_SCRIPT_RUN_OK);
  g_scriptVerifyArmed = false;
  P1EventField fields[] = {
    p1FieldUInt("verifyMs", P1_EMBED_SCRIPT_VERIFY_MS),
  };
  debugEventEmitFields("script.storage", "debug", "script", "verified", fields, 1);
}
