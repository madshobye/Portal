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

static bool scriptStorePathInfo(const char* path, size_t& bytesOut, uint32_t& hashOut) {
  bytesOut = 0;
  hashOut = 2166136261u;
  if (!scriptStoreBegin()) return false;

  File f = LittleFS.open(path, "r");
  if (!f) return false;

  size_t n = (size_t)f.size();
  if (n == 0 || n > P1_EMBED_MAX_SCRIPT_BYTES) {
    f.close();
    return n == 0;
  }

  uint8_t buf[256];
  size_t got = 0;
  uint32_t h = 2166136261u;
  while (got < n) {
    size_t want = min(sizeof(buf), n - got);
    size_t chunk = f.read(buf, want);
    if (chunk == 0) break;
    for (size_t i = 0; i < chunk; i++) {
      h ^= buf[i];
      h *= 16777619u;
    }
    got += chunk;
  }
  f.close();
  if (got != n) return false;
  bytesOut = got;
  hashOut = h;
  return true;
}

static bool scriptStoreReadPathChunk(const char* path, uint32_t offset, uint32_t maxBytes, String& chunkOut, size_t& totalBytesOut) {
  chunkOut = "";
  totalBytesOut = 0;
  if (!scriptStoreBegin()) return false;

  File f = LittleFS.open(path, "r");
  if (!f) {
    return offset == 0;
  }

  size_t n = (size_t)f.size();
  totalBytesOut = n;
  if (n > P1_EMBED_MAX_SCRIPT_BYTES || offset > n) {
    f.close();
    return false;
  }

  size_t toRead = min((size_t)maxBytes, n - (size_t)offset);
  if (toRead == 0) {
    f.close();
    return true;
  }
  if (!chunkOut.reserve(toRead)) {
    f.close();
    return false;
  }
  if (!f.seek(offset, SeekSet)) {
    f.close();
    return false;
  }

  char buf[128];
  size_t gotTotal = 0;
  while (gotTotal < toRead) {
    size_t want = min(sizeof(buf), toRead - gotTotal);
    size_t got = f.readBytes(buf, want);
    if (got == 0) break;
    chunkOut.concat(buf, got);
    gotTotal += got;
  }
  f.close();
  return gotTotal == toRead;
}

static bool scriptStoreCopyPathToPath(const char* from, const char* to) {
  if (!scriptStoreBegin()) return false;

  File in = LittleFS.open(from, "r");
  if (!in) return false;
  size_t n = (size_t)in.size();
  if (n == 0 || n > P1_EMBED_MAX_SCRIPT_BYTES) {
    in.close();
    return false;
  }

  if (LittleFS.exists(to)) LittleFS.remove(to);
  File out = LittleFS.open(to, "w");
  if (!out) {
    in.close();
    return false;
  }

  uint8_t buf[256];
  size_t copied = 0;
  bool ok = true;
  while (copied < n) {
    size_t want = min(sizeof(buf), n - copied);
    size_t got = in.read(buf, want);
    if (got == 0) {
      ok = false;
      break;
    }
    size_t wrote = out.write(buf, got);
    if (wrote != got) {
      ok = false;
      break;
    }
    copied += got;
  }
  out.flush();
  out.close();
  in.close();
  if (!ok || copied != n) {
    if (LittleFS.exists(to)) LittleFS.remove(to);
    return false;
  }
  return true;
}

static bool scriptStoreCopyPathToBuffer(const char* path, uint8_t* dst, size_t capacity, size_t& bytesOut) {
  bytesOut = 0;
  if (!dst || capacity == 0) return false;
  if (!scriptStoreBegin()) return false;

  File f = LittleFS.open(path, "r");
  if (!f) return false;

  size_t n = (size_t)f.size();
  if (n == 0 || n > capacity || n > P1_EMBED_MAX_SCRIPT_BYTES) {
    f.close();
    return false;
  }

  size_t got = 0;
  while (got < n) {
    size_t chunk = f.read(dst + got, n - got);
    if (chunk == 0) break;
    got += chunk;
  }
  f.close();
  bytesOut = got;
  return got == n;
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

bool scriptStoreReadCurrentChunk(uint32_t offset, uint32_t maxBytes, String& chunkOut, size_t& totalBytesOut) {
  return scriptStoreReadPathChunk(SCRIPT_CURRENT_PATH, offset, maxBytes, chunkOut, totalBytesOut);
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

bool scriptStoreIncomingInfo(size_t& bytesOut, uint32_t& hashOut) {
  return scriptStorePathInfo(SCRIPT_INCOMING_PATH, bytesOut, hashOut);
}

bool scriptStoreCopyIncomingToBuffer(uint8_t* dst, size_t capacity, size_t& bytesOut) {
  return scriptStoreCopyPathToBuffer(SCRIPT_INCOMING_PATH, dst, capacity, bytesOut);
}

bool scriptStoreCopyIncomingToCurrent() {
  return scriptStoreCopyPathToPath(SCRIPT_INCOMING_PATH, SCRIPT_CURRENT_PATH);
}

bool scriptStoreCopyIncomingToSaved() {
  return scriptStoreCopyPathToPath(SCRIPT_INCOMING_PATH, SCRIPT_STORE_PATH);
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
