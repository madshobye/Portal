#include <Arduino.h>
#include "p1_embed_firmware.h"

enum P1ScriptState {
  SCRIPT_EMPTY,
  SCRIPT_COMPILED,
  SCRIPT_RUNNING,
  SCRIPT_STOPPED,
  SCRIPT_ERROR
};

enum P1WrenchPhase {
  WRENCH_PHASE_IDLE,
  WRENCH_PHASE_COMPILED,
  WRENCH_PHASE_COMPILING,
  WRENCH_PHASE_LOADING,
  WRENCH_PHASE_SETUP,
  WRENCH_PHASE_RUNNING,
  WRENCH_PHASE_STOPPING,
  WRENCH_PHASE_STOPPED,
  WRENCH_PHASE_ERROR
};

static WRState* g_wr = nullptr;
static WRContext* g_ctx = nullptr;
static WRFunction* g_fnSetup = nullptr;
static WRFunction* g_fnLoop = nullptr;
static unsigned char* g_bytecode = nullptr;
static int g_bytecodeLen = 0;
static uint32_t g_currentScriptBytes = 0;
static uint32_t g_currentScriptHash = 2166136261u;
static volatile P1ScriptState g_scriptState = SCRIPT_EMPTY;
static TaskHandle_t g_wrenchTaskHandle = nullptr;
static SemaphoreHandle_t g_wrenchMutex = nullptr;
static SemaphoreHandle_t g_scriptSourceMutex = nullptr;
static volatile bool g_wrenchTaskRunning = false;
static volatile uint32_t g_wrenchLoopCount = 0;
static volatile uint32_t g_wrenchLastLoopMs = 0;
static volatile uint32_t g_wrenchLastLoopDurationMs = 0;
static volatile uint32_t g_wrenchFpsWindowStartedAt = 0;
static volatile uint32_t g_wrenchFpsWindowLoopCount = 0;
static volatile float g_wrenchLoopFps = 0.0f;
static volatile uint32_t g_wrenchCurrentLoopStartedAt = 0;
static volatile uint32_t g_wrenchSlowLoopCount = 0;
static volatile uint32_t g_wrenchHungLoopCount = 0;
static volatile uint32_t g_wrenchLockTimeoutCount = 0;
static volatile int g_wrenchTaskCore = -1;
static volatile bool g_wrenchLoopInProgress = false;
static volatile bool g_wrenchHungCounted = false;
static volatile uint8_t g_wrenchTransitionDepth = 0;
static volatile uint32_t g_wrenchTransitionStartedAt = 0;
static volatile uint32_t g_wrenchTransitionRecoveries = 0;
static volatile bool g_wrenchRunPending = false;
static volatile P1WrenchPhase g_wrenchPhase = WRENCH_PHASE_IDLE;
static char g_wrenchTransitionReason[40] = "";
static uint8_t g_wrenchLoopDebugMarkers = 0;
static uint8_t g_wrenchConsecutiveErrorLoops = 0;
static P1ReusableBuffer g_wrenchCompileSourceBuffer;

struct P1CompileCrashLatch {
  uint32_t magic;
  uint32_t scriptHash;
  uint32_t scriptBytes;
  uint32_t startedAtMs;
};

static RTC_NOINIT_ATTR P1CompileCrashLatch g_compileCrashLatch;
static const uint32_t P1_COMPILE_CRASH_MAGIC = 0xC011A7C5u;

static void wrenchCompileCrashArm(uint32_t scriptHash, uint32_t scriptBytes) {
  g_compileCrashLatch.magic = P1_COMPILE_CRASH_MAGIC;
  g_compileCrashLatch.scriptHash = scriptHash;
  g_compileCrashLatch.scriptBytes = scriptBytes;
  g_compileCrashLatch.startedAtMs = millis();
}

static void wrenchCompileCrashClear() {
  g_compileCrashLatch.magic = 0;
  g_compileCrashLatch.scriptHash = 0;
  g_compileCrashLatch.scriptBytes = 0;
  g_compileCrashLatch.startedAtMs = 0;
}

void wrenchReportCompileCrashIfAny() {
  if (g_compileCrashLatch.magic != P1_COMPILE_CRASH_MAGIC) return;
  uint32_t scriptHash = g_compileCrashLatch.scriptHash;
  uint32_t scriptBytes = g_compileCrashLatch.scriptBytes;
  uint32_t startedAtMs = g_compileCrashLatch.startedAtMs;
  wrenchCompileCrashClear();
  String message = "previous script compile crashed the board";
  String details = "\"scriptHash\":" + String(scriptHash);
  details += ",\"scriptBytes\":" + String(scriptBytes);
  details += ",\"startedAtMs\":" + String(startedAtMs);
  details += ",\"hint\":\"try splitting large functions into smaller helpers\"";
  scriptErrorSet("compile", "compile_crash", message, details);
}

static bool wrenchCheckStateError(WRState* wr, String& errOut, const char* phase) {
  if (!wr) {
    errOut = String(phase) + " failed: no Wrench state";
    return false;
  }
  WRError error = wr_getLastError(wr);
  if (error == WR_ERR_None) return true;
  errOut = String(phase) + " failed: " + scriptErrorWrenchName((int)error);
  String details = "\"wrenchError\":" + String((int)error);
  details += ",\"wrenchErrorName\":" + jsonString(scriptErrorWrenchName((int)error));
  scriptErrorSet("run", "wrench_state_error", errOut, details);
  return false;
}

static const char* wrenchPhaseName(P1WrenchPhase phase) {
  switch (phase) {
    case WRENCH_PHASE_IDLE: return "idle";
    case WRENCH_PHASE_COMPILED: return "compiled";
    case WRENCH_PHASE_COMPILING: return "compiling";
    case WRENCH_PHASE_LOADING: return "loading";
    case WRENCH_PHASE_SETUP: return "setup";
    case WRENCH_PHASE_RUNNING: return "running";
    case WRENCH_PHASE_STOPPING: return "stopping";
    case WRENCH_PHASE_STOPPED: return "stopped";
    case WRENCH_PHASE_ERROR: return "error";
  }
  return "unknown";
}

static const char* wrenchScriptStateName(P1ScriptState state) {
  switch (state) {
    case SCRIPT_EMPTY: return "empty";
    case SCRIPT_COMPILED: return "compiled";
    case SCRIPT_RUNNING: return "running";
    case SCRIPT_STOPPED: return "stopped";
    case SCRIPT_ERROR: return "error";
  }
  return "unknown";
}

static void wrenchEmitCompileMemoryTrace(const char* marker, size_t scriptBytes = 0, size_t sourceBytes = 0, size_t bytecodeBytes = 0) {
  P1EventField fields[] = {
    p1FieldString("marker", marker ? marker : ""),
    p1FieldUInt("freeHeap", ESP.getFreeHeap()),
    p1FieldUInt("maxAllocHeap", ESP.getMaxAllocHeap()),
    p1FieldUInt("minFreeHeap", ESP.getMinFreeHeap()),
    p1FieldUInt("scriptBytes", scriptBytes),
    p1FieldUInt("sourceBytes", sourceBytes),
    p1FieldUInt("bytecodeBytes", bytecodeBytes),
  };
  debugEventEmitFields("script.memory", "debug", "script", "compile memory trace", fields, 7);
}

static void wrenchSetPhase(P1WrenchPhase phase) {
  g_wrenchPhase = phase;
}

static void wrenchCollectAfterCall(WRValue* ret) {
  if (!g_ctx || !g_wr || !ret) return;
  g_ctx->allocatedMemoryHint = g_wr->allocatedMemoryLimit;
  g_ctx->gc(ret + 1);
}

static void wrenchEmitRuntimeError(const char* phase, WRError error) {
  String message = String(phase) + " runtime error: " + scriptErrorWrenchName((int)error);
  String details = "\"wrenchError\":" + String((int)error);
  details += ",\"wrenchErrorName\":" + jsonString(scriptErrorWrenchName((int)error));
  details += ",\"loopCount\":" + String(g_wrenchLoopCount);
  details += ",\"scriptBytes\":" + String(g_currentScriptBytes);
  details += ",\"scriptHash\":" + String(g_currentScriptHash);
  details += ",\"freeHeap\":" + String(ESP.getFreeHeap());
  details += ",\"maxAllocHeap\":" + String(ESP.getMaxAllocHeap());
  if (g_wr && error == WR_ERR_function_not_found) {
    uint32_t hash = wr_getLastMissingFunctionHash(g_wr);
    uint8_t op = wr_getLastMissingFunctionOp(g_wr);
    const char* bindingName = wrenchBindingNameForHash(hash);
    details += ",\"missingFunctionHash\":" + String(hash);
    details += ",\"missingFunctionOp\":" + String(op);
    details += ",\"missingFunctionOpName\":";
    details += jsonString(op == 1 ? "call_by_hash" : (op == 2 ? "call_by_hash_and_pop" : "unknown"));
    if (bindingName && bindingName[0]) details += ",\"missingBinding\":" + jsonString(bindingName);
  }
  scriptErrorSet(phase, "runtime_error", message, details);
}

static void wrenchLock() {
  if (g_wrenchMutex) xSemaphoreTake(g_wrenchMutex, portMAX_DELAY);
}

static bool wrenchTryLock(uint32_t timeoutMs) {
  if (!g_wrenchMutex) return true;
  if (xSemaphoreTake(g_wrenchMutex, pdMS_TO_TICKS(timeoutMs)) == pdTRUE) return true;
  g_wrenchLockTimeoutCount++;
  return false;
}

static void wrenchUnlock() {
  if (g_wrenchMutex) xSemaphoreGive(g_wrenchMutex);
}

static void wrenchSourceLock() {
  if (g_scriptSourceMutex) xSemaphoreTake(g_scriptSourceMutex, portMAX_DELAY);
}

static void wrenchSourceUnlock() {
  if (g_scriptSourceMutex) xSemaphoreGive(g_scriptSourceMutex);
}

static bool wrenchSourceHasCode() {
  wrenchSourceLock();
  bool hasCode = g_currentScriptBytes > 0;
  wrenchSourceUnlock();
  return hasCode;
}

static uint32_t wrenchSourceHash(const String& code) {
  uint32_t h = 2166136261u;
  for (size_t i = 0; i < code.length(); i++) {
    h ^= (uint8_t)code[i];
    h *= 16777619u;
  }
  return h;
}

static void wrenchSourceSet(const String& code) {
  wrenchSourceLock();
  if (code.length() > 0 && scriptStoreSaveCurrent(code)) {
    g_currentScriptBytes = code.length();
    g_currentScriptHash = wrenchSourceHash(code);
  } else {
    scriptStoreClearCurrent();
    g_currentScriptBytes = 0;
    g_currentScriptHash = 2166136261u;
  }
  wrenchSourceUnlock();
}

static void wrenchFreeBytecodeLocked() {
  if (g_bytecode) {
    wr_free(g_bytecode);
    g_bytecode = nullptr;
  }
  g_bytecodeLen = 0;
}

static void wrenchStopLocked() {
  g_wrenchConsecutiveErrorLoops = 0;
  wrenchSetPhase(WRENCH_PHASE_STOPPING);
  ledClearAllPhysical(true);
  if (g_wr) {
    wr_destroyState(g_wr);
    g_wr = nullptr;
  }
  g_ctx = nullptr;
  g_fnSetup = nullptr;
  g_fnLoop = nullptr;
  bool hasCode = wrenchSourceHasCode();
  g_scriptState = hasCode ? SCRIPT_STOPPED : SCRIPT_EMPTY;
  wrenchSetPhase(hasCode ? WRENCH_PHASE_STOPPED : WRENCH_PHASE_IDLE);
  P1EventField fields[] = {
    p1FieldString("state", "stopped"),
  };
  protocolEmitEventFields("script.state", fields, 1);
}

static void wrenchLoopLocked() {
  if (g_scriptState != SCRIPT_RUNNING || !g_wr || !g_ctx || !g_fnLoop) return;
  if (g_wrenchLoopDebugMarkers < 5) {
    P1EventField fields[] = {
      p1FieldUInt("marker", g_wrenchLoopDebugMarkers + 1),
      p1FieldUInt("loopCount", g_wrenchLoopCount),
    };
    debugEventEmitFields("script.debug", "trace", "script", "loop call", fields, 2);
    g_wrenchLoopDebugMarkers++;
  }
  uint32_t startedAt = millis();
  uint32_t errorCountBefore = scriptErrorCount();
  g_wrenchCurrentLoopStartedAt = startedAt;
  g_wrenchLoopInProgress = true;
  g_wrenchHungCounted = false;
  WRValue* ret = wr_callFunction(g_ctx, g_fnLoop, nullptr, 0);
  uint32_t elapsed = millis() - startedAt;
  g_wrenchLoopInProgress = false;
  g_wrenchHungCounted = false;
  g_wrenchLoopCount++;
  g_wrenchLastLoopDurationMs = elapsed;
  WRError loopError = wr_getLastError(g_wr);
  if (ret && loopError == WR_ERR_None) wrenchCollectAfterCall(ret);
  if (scriptErrorCount() > errorCountBefore) {
    if (g_wrenchConsecutiveErrorLoops < 255) g_wrenchConsecutiveErrorLoops++;
  } else {
    g_wrenchConsecutiveErrorLoops = 0;
  }
  uint32_t now = millis();
  g_wrenchLastLoopMs = now;
  if (g_wrenchFpsWindowStartedAt == 0) {
    g_wrenchFpsWindowStartedAt = now;
    g_wrenchFpsWindowLoopCount = 0;
  }
  g_wrenchFpsWindowLoopCount++;
  uint32_t windowMs = now - g_wrenchFpsWindowStartedAt;
  if (windowMs >= 1000) {
    g_wrenchLoopFps = (float)g_wrenchFpsWindowLoopCount * 1000.0f / (float)windowMs;
    g_wrenchFpsWindowStartedAt = now;
    g_wrenchFpsWindowLoopCount = 0;
  }
  if (elapsed >= P1_EMBED_WRENCH_LOOP_WARN_MS) {
    g_wrenchSlowLoopCount++;
    P1EventField fields[] = {
      p1FieldString("state", "slow_loop"),
      p1FieldUInt("elapsedMs", elapsed),
    };
    debugEventEmitFields("script.watchdog", "warn", "script", "", fields, 2);
  }
  if (!ret && loopError != WR_ERR_None) {
    wrenchEmitRuntimeError("loop", loopError);
    wrenchStopLocked();
    g_scriptState = SCRIPT_ERROR;
    return;
  }
  if (g_wrenchConsecutiveErrorLoops >= P1_EMBED_WRENCH_ERROR_LOOP_LIMIT) {
    String details = "\"consecutiveLoops\":" + String(g_wrenchConsecutiveErrorLoops);
    details += ",\"lastErrorCode\":" + jsonString(scriptErrorLastCode());
    details += ",\"lastErrorMessage\":" + jsonString(scriptErrorLastMessage());
    details += ",\"loopCount\":" + String(g_wrenchLoopCount);
    details += ",\"scriptBytes\":" + String(g_currentScriptBytes);
    details += ",\"scriptHash\":" + String(g_currentScriptHash);
    scriptErrorSet("loop", "binding_error_flood", "script stopped after repeated binding errors", details);
    wrenchStopLocked();
    g_scriptState = SCRIPT_ERROR;
    P1EventField fields[] = {
      p1FieldString("state", "error"),
      p1FieldString("code", "binding_error_flood"),
    };
    protocolEmitEventFields("script.state", fields, 2);
  }
}

static void wrenchTask(void*) {
  g_wrenchTaskRunning = true;
  for (;;) {
    g_wrenchTaskCore = xPortGetCoreID();
    if (g_wrenchTransitionDepth == 0) {
      wrenchLock();
      wrenchLoopLocked();
      wrenchUnlock();
    }
    delay(P1_EMBED_WRENCH_TASK_DELAY_MS);
  }
}

void wrenchTaskBegin() {
  if (!g_wrenchMutex) g_wrenchMutex = xSemaphoreCreateMutex();
  if (!g_scriptSourceMutex) g_scriptSourceMutex = xSemaphoreCreateMutex();
  if (g_wrenchTaskHandle) return;

  BaseType_t ok = xTaskCreatePinnedToCore(
    wrenchTask,
    "p1Wrench",
    P1_EMBED_WRENCH_TASK_STACK,
    nullptr,
    1,
    &g_wrenchTaskHandle,
    P1_EMBED_WRENCH_TASK_CORE);
  if (ok != pdPASS) {
    g_wrenchTaskHandle = nullptr;
    g_wrenchTaskRunning = false;
    debugError("script", "task_create_failed", "Failed to create Wrench task");
  }
}

String wrenchDefaultScript() {
  String code;
  code += "var last = 0;\n";
  code += "var on = 0;\n\n";
  code += "function setup() {\n";
  code += "  pinMode(LED_BUILTIN, OUTPUT);\n";
  code += "  print(\"p1_embed default Wrench script started\");\n";
  code += "}\n\n";
  code += "function loop() {\n";
  code += "  if (millis() - last > 500) {\n";
  code += "    last = millis();\n";
  code += "    on = 1 - on;\n";
  code += "    digitalWrite(LED_BUILTIN, on);\n";
  code += "  }\n";
  code += "}\n";
  return code;
}

String wrenchCurrentScript() {
  String code;
  scriptStoreLoadCurrent(code);
  return code;
}

uint32_t wrenchCurrentScriptBytes() {
  wrenchSourceLock();
  uint32_t bytes = g_currentScriptBytes;
  wrenchSourceUnlock();
  return bytes;
}

uint32_t wrenchCurrentScriptHash() {
  wrenchSourceLock();
  uint32_t hash = g_currentScriptHash;
  wrenchSourceUnlock();
  return hash;
}

bool wrenchSetCurrentScript(const String& code) {
  if (code.length() > P1_EMBED_MAX_SCRIPT_BYTES) return false;
  wrenchLock();
  wrenchSourceSet(code);
  if (g_scriptState == SCRIPT_EMPTY) g_scriptState = SCRIPT_STOPPED;
  wrenchUnlock();
  return true;
}

const char* wrenchStateName() {
  return wrenchScriptStateName((P1ScriptState)g_scriptState);
}

bool wrenchHasSetup() {
  if (!wrenchTryLock(P1_EMBED_WRENCH_LOCK_STATUS_TIMEOUT_MS)) return false;
  bool hasSetup = g_fnSetup != nullptr;
  wrenchUnlock();
  return hasSetup;
}

bool wrenchHasLoop() {
  if (!wrenchTryLock(P1_EMBED_WRENCH_LOCK_STATUS_TIMEOUT_MS)) return false;
  bool hasLoop = g_fnLoop != nullptr;
  wrenchUnlock();
  return hasLoop;
}

bool wrenchTaskIsRunning() {
  return g_wrenchTaskRunning && g_wrenchTaskHandle != nullptr;
}

uint32_t wrenchLoopCount() {
  return g_wrenchLoopCount;
}

uint32_t wrenchLastLoopMs() {
  return g_wrenchLastLoopMs;
}

uint32_t wrenchLastLoopDurationMs() {
  return g_wrenchLastLoopDurationMs;
}

float wrenchLoopFps() {
  return g_wrenchLoopFps;
}

uint32_t wrenchCurrentLoopStartedAt() {
  return g_wrenchLoopInProgress ? g_wrenchCurrentLoopStartedAt : 0;
}

uint32_t wrenchSlowLoopCount() {
  return g_wrenchSlowLoopCount;
}

uint32_t wrenchHungLoopCount() {
  return g_wrenchHungLoopCount;
}

bool wrenchLoopIsHung() {
  if (!g_wrenchLoopInProgress) return false;
  return millis() - g_wrenchCurrentLoopStartedAt >= P1_EMBED_WRENCH_LOOP_HUNG_MS;
}

uint32_t wrenchLockTimeoutCount() {
  return g_wrenchLockTimeoutCount;
}

void wrenchWatchdogPoll() {
  if (!g_wrenchLoopInProgress || g_wrenchHungCounted) return;
  uint32_t elapsed = millis() - g_wrenchCurrentLoopStartedAt;
  if (elapsed < P1_EMBED_WRENCH_LOOP_HUNG_MS) return;
  g_wrenchHungCounted = true;
  g_wrenchHungLoopCount++;
  P1EventField fields[] = {
    p1FieldString("state", "hung_loop"),
    p1FieldUInt("elapsedMs", elapsed),
  };
  debugEventEmitFields("script.watchdog", "error", "script", "", fields, 2);
}

void wrenchRuntimePoll() {
  uint8_t depth = g_wrenchTransitionDepth;
  if (depth) {
    uint32_t elapsed = millis() - g_wrenchTransitionStartedAt;
    if (elapsed >= P1_EMBED_WRENCH_TRANSITION_TIMEOUT_MS) {
      g_wrenchTransitionDepth = 0;
      g_wrenchTransitionRecoveries++;
      P1EventField fields[] = {
        p1FieldString("reason", g_wrenchTransitionReason),
        p1FieldUInt("elapsedMs", elapsed),
      };
      debugEventEmitFields("script.runtime", "error", "script", "Recovered stale Wrench transition", fields, 2);
      g_wrenchTransitionReason[0] = '\0';
    }
    return;
  }

  if (!g_wrenchRunPending) return;
  g_wrenchRunPending = false;
  String err;
  wrenchBeginTransition("pending_run");
  bool ok = wrenchRunCompiled(err);
  wrenchEndTransition();
  if (!ok) {
    protocolEmitErrorEvent("script.run", "run_failed", err);
  }
}

String wrenchRuntimeStatusJson() {
  uint8_t depth = g_wrenchTransitionDepth;
  uint32_t pausedMs = depth ? millis() - g_wrenchTransitionStartedAt : 0;
  String out = "{";
  out += "\"phase\":" + jsonString(wrenchPhaseName((P1WrenchPhase)g_wrenchPhase));
  out += ",\"transitionActive\":" + String(depth ? "true" : "false");
  out += ",\"transitionDepth\":" + String(depth);
  out += ",\"transitionReason\":" + jsonString(g_wrenchTransitionReason);
  out += ",\"transitionMs\":" + String(pausedMs);
  out += ",\"transitionRecoveries\":" + String(g_wrenchTransitionRecoveries);
  out += ",\"runPending\":" + String(g_wrenchRunPending ? "true" : "false");
  out += ",\"bytecodeBytes\":" + String(g_bytecodeLen);
  out += ",\"taskTargetCore\":" + String(P1_EMBED_WRENCH_TASK_CORE);
  out += ",\"taskCore\":" + String(g_wrenchTaskCore);
  out += ",\"compileTargetCore\":" + String(P1_EMBED_WRENCH_COMPILE_TASK_CORE);
  out += ",\"compileSourceBuffer\":" + p1ReusableBufferStatusJson(g_wrenchCompileSourceBuffer);
  out += "}";
  return out;
}

uint32_t wrenchTaskStackHighWater() {
  if (!g_wrenchTaskHandle) return 0;
  return (uint32_t)uxTaskGetStackHighWaterMark(g_wrenchTaskHandle);
}

bool wrenchHasCompiledProgram() {
  return g_bytecode && g_bytecodeLen > 0;
}

void wrenchStop() {
  wrenchLock();
  g_wrenchRunPending = false;
  wrenchStopLocked();
  wrenchUnlock();
}

void wrenchReleaseCompiledProgram() {
  wrenchLock();
  g_wrenchRunPending = false;
  wrenchStopLocked();
  wrenchFreeBytecodeLocked();
  wrenchSourceSet("");
  g_scriptState = SCRIPT_EMPTY;
  wrenchSetPhase(WRENCH_PHASE_IDLE);
  wrenchUnlock();
  fastLedReleaseScriptResources();
}

void wrenchBeginTransition(const String& reason) {
  if (g_wrenchTransitionDepth == 0) {
    g_wrenchTransitionStartedAt = millis();
    size_t n = reason.length();
    if (n >= sizeof(g_wrenchTransitionReason)) n = sizeof(g_wrenchTransitionReason) - 1;
    memcpy(g_wrenchTransitionReason, reason.c_str(), n);
    g_wrenchTransitionReason[n] = '\0';
  }
  if (g_wrenchTransitionDepth < 255) g_wrenchTransitionDepth++;
}

void wrenchEndTransition() {
  if (g_wrenchTransitionDepth > 0) g_wrenchTransitionDepth--;
  if (g_wrenchTransitionDepth == 0) {
    g_wrenchTransitionStartedAt = 0;
    g_wrenchTransitionReason[0] = '\0';
  }
}

static String wrenchPrelude() {
  String pre;
  pre += "var INPUT = ";
  pre += String((int)INPUT);
  pre += ";\n";
  pre += "var OUTPUT = ";
  pre += String((int)OUTPUT);
  pre += ";\n";
  pre += "var INPUT_PULLUP = ";
  pre += String((int)INPUT_PULLUP);
  pre += ";\n";
#ifdef INPUT_PULLDOWN
  pre += "var INPUT_PULLDOWN = ";
  pre += String((int)INPUT_PULLDOWN);
  pre += ";\n";
#endif
  pre += "var LOW = ";
  pre += String((int)LOW);
  pre += ";\n";
  pre += "var HIGH = ";
  pre += String((int)HIGH);
  pre += ";\n";
  pre += "var LED_BUILTIN = ";
  pre += String(P1_EMBED_DEFAULT_LED_PIN);
  pre += ";\n";
  return pre;
}

static String wrenchRemapCompileError(const String& err, int lineOffset) {
  if (lineOffset <= 0 || err.length() == 0) return err;

  String out = err;
  int linePos = out.indexOf("line:");
  if (linePos >= 0) {
    int numStart = linePos + 5;
    while (numStart < (int)out.length() && out[numStart] == ' ') numStart++;
    int numEnd = numStart;
    while (numEnd < (int)out.length() && isDigit(out[numEnd])) numEnd++;
    if (numEnd > numStart) {
      int line = out.substring(numStart, numEnd).toInt();
      if (line > lineOffset) {
        out = out.substring(0, numStart) + String(line - lineOffset) + out.substring(numEnd);
      }
    }
  }

  int scan = 0;
  while (scan < (int)out.length()) {
    int lineStart = scan;
    int lineEnd = out.indexOf('\n', lineStart);
    if (lineEnd < 0) lineEnd = out.length();

    int numStart = lineStart;
    while (numStart < lineEnd && out[numStart] == ' ') numStart++;
    int numEnd = numStart;
    while (numEnd < lineEnd && isDigit(out[numEnd])) numEnd++;
    if (numEnd > numStart && numEnd < lineEnd && out[numEnd] == ' ') {
      int line = out.substring(numStart, numEnd).toInt();
      if (line > lineOffset) {
        String replacement = String(line - lineOffset);
        out = out.substring(0, numStart) + replacement + out.substring(numEnd);
        int delta = replacement.length() - (numEnd - numStart);
        lineEnd += delta;
      }
    }

    scan = lineEnd + 1;
  }

  return out;
}

struct WrenchCompileJob {
  const char* source;
  int sourceLen;
  unsigned char* bytecode;
  int byteLen;
  WRstr compileErr;
  WRError result;
  SemaphoreHandle_t done;
};

static void wrenchCompileTaskEntry(void* arg) {
  WrenchCompileJob* job = (WrenchCompileJob*)arg;
  job->bytecode = nullptr;
  job->byteLen = 0;
  job->result = wr_compile(job->source, job->sourceLen, &job->bytecode, &job->byteLen, &job->compileErr, WR_INCLUDE_GLOBALS);
#ifdef WRENCH_HANDLE_MALLOC_FAIL
  if (g_mallocFailed) {
    g_mallocFailed = false;
    if (job->bytecode) {
      wr_free(job->bytecode);
      job->bytecode = nullptr;
    }
    job->byteLen = 0;
    job->result = WR_ERR_malloc_failed;
  }
#endif
  xSemaphoreGive(job->done);
  vTaskDelete(nullptr);
}

static WRError wrenchCompileOnWorker(const char* src, int srcLen, unsigned char** bytecodeOut, int* byteLenOut, WRstr& compileErr) {
  WrenchCompileJob job;
  job.source = src;
  job.sourceLen = srcLen;
  job.bytecode = nullptr;
  job.byteLen = 0;
  job.result = WR_ERR_None;
  job.done = xSemaphoreCreateBinary();
  if (!job.done) {
    compileErr = "could not allocate compile worker semaphore";
    return WR_ERR_malloc_failed;
  }

  BaseType_t ok = xTaskCreatePinnedToCore(
    wrenchCompileTaskEntry,
    "p1WrCompile",
    P1_EMBED_WRENCH_COMPILE_TASK_STACK,
    &job,
    0,
    nullptr,
    P1_EMBED_WRENCH_COMPILE_TASK_CORE);

  if (ok != pdPASS) {
    vSemaphoreDelete(job.done);
    compileErr = "could not start compile worker task";
    return WR_ERR_malloc_failed;
  }

  while (xSemaphoreTake(job.done, pdMS_TO_TICKS(10)) != pdTRUE) {
    delay(1);
  }
  vSemaphoreDelete(job.done);

  *bytecodeOut = job.bytecode;
  *byteLenOut = job.byteLen;
  compileErr = job.compileErr;
  return job.result;
}

static bool wrenchCompileSource(const String& userCode, unsigned char** bytecodeOut, int* byteLenOut, String& errOut) {
  errOut = "";
  *bytecodeOut = nullptr;
  *byteLenOut = 0;
  wrenchEmitCompileMemoryTrace("compileSource.begin", userCode.length());
  if (userCode.length() == 0) {
    errOut = "empty script";
    scriptErrorSet("compile", "empty_script", errOut);
    return false;
  }
  if (userCode.length() > P1_EMBED_MAX_SCRIPT_BYTES) {
    errOut = "script too large";
    scriptErrorSet("compile", "script_too_large", errOut, "\"scriptBytes\":" + String(userCode.length()) + ",\"maxScriptBytes\":" + String(P1_EMBED_MAX_SCRIPT_BYTES));
    return false;
  }
  uint32_t freeHeap = ESP.getFreeHeap();
  uint32_t maxAlloc = ESP.getMaxAllocHeap();
  uint32_t bestFreeHeap = freeHeap;
  uint32_t bestMaxAlloc = maxAlloc;
  uint32_t minFreeHeap = P1_EMBED_WRENCH_COMPILE_MIN_FREE_HEAP;
  uint32_t minMaxAlloc = P1_EMBED_WRENCH_COMPILE_MIN_MAX_ALLOC;
  if (userCode.length() >= P1_EMBED_WRENCH_LARGE_SCRIPT_BYTES) {
    minFreeHeap = P1_EMBED_WRENCH_LARGE_COMPILE_MIN_FREE_HEAP;
    minMaxAlloc = P1_EMBED_WRENCH_LARGE_COMPILE_MIN_MAX_ALLOC;
  }
  if (webrtcTransportDataChannelOpen() && userCode.length() >= P1_EMBED_WRENCH_WEBRTC_LARGE_SCRIPT_BYTES) {
    if (minFreeHeap < P1_EMBED_WRENCH_WEBRTC_COMPILE_MIN_FREE_HEAP) {
      minFreeHeap = P1_EMBED_WRENCH_WEBRTC_COMPILE_MIN_FREE_HEAP;
    }
    if (minMaxAlloc < P1_EMBED_WRENCH_WEBRTC_COMPILE_MIN_MAX_ALLOC) {
      minMaxAlloc = P1_EMBED_WRENCH_WEBRTC_COMPILE_MIN_MAX_ALLOC;
    }
  }
  if (freeHeap < minFreeHeap || maxAlloc < minMaxAlloc) {
    uint32_t start = millis();
    while ((uint32_t)(millis() - start) < P1_EMBED_WRENCH_COMPILE_HEAP_SETTLE_MS) {
      delay(50);
      freeHeap = ESP.getFreeHeap();
      maxAlloc = ESP.getMaxAllocHeap();
      if (freeHeap > bestFreeHeap) bestFreeHeap = freeHeap;
      if (maxAlloc > bestMaxAlloc) bestMaxAlloc = maxAlloc;
      if (freeHeap >= minFreeHeap && maxAlloc >= minMaxAlloc) break;
    }
  }
  if (freeHeap < minFreeHeap || maxAlloc < minMaxAlloc) {
    P1EventField fields[] = {
      p1FieldUInt("freeHeap", freeHeap),
      p1FieldUInt("maxAllocHeap", maxAlloc),
      p1FieldUInt("bestFreeHeap", bestFreeHeap),
      p1FieldUInt("bestMaxAllocHeap", bestMaxAlloc),
      p1FieldUInt("minFreeHeap", minFreeHeap),
      p1FieldUInt("minMaxAllocHeap", minMaxAlloc),
      p1FieldUInt("scriptBytes", userCode.length()),
    };
    debugEventEmitFields("script.memory", "warn", "script", "compiling despite low heap guard estimate", fields, 7);
  }

  String prelude = wrenchPrelude();
  wrenchEmitCompileMemoryTrace("prelude.built", userCode.length(), prelude.length());
  int userLineOffset = 1;
  for (size_t i = 0; i < prelude.length(); i++) {
    if (prelude[i] == '\n') userLineOffset++;
  }
  size_t sourceLen = prelude.length() + 1 + userCode.length();
  if (sourceLen > (size_t)INT_MAX - 1) {
    errOut = "script too large";
    scriptErrorSet("compile", "script_too_large", errOut, "\"sourceBytes\":" + String(sourceLen));
    return false;
  }
  P1ReusableBufferHandle sourceHandle;
  if (!p1ReusableBufferAcquire(
        g_wrenchCompileSourceBuffer,
        sourceLen + 1,
        P1_EMBED_WRENCH_COMPILE_SOURCE_RETAIN_MIN,
        P1_EMBED_WRENCH_COMPILE_SOURCE_RETAIN_MAX,
        sourceHandle)) {
    errOut = "No heap for compile source";
    String details = "\"scriptBytes\":" + String(userCode.length());
    details += ",\"sourceBytes\":" + String(sourceLen);
    details += ",\"freeHeap\":" + String(ESP.getFreeHeap());
    details += ",\"maxAllocHeap\":" + String(ESP.getMaxAllocHeap());
    scriptErrorSet("compile", "source_no_heap", errOut, details);
    return false;
  }
  char* source = (char*)sourceHandle.data;
  size_t cursor = 0;
  memcpy(source + cursor, prelude.c_str(), prelude.length());
  cursor += prelude.length();
  source[cursor++] = '\n';
  memcpy(source + cursor, userCode.c_str(), userCode.length());
  cursor += userCode.length();
  source[cursor] = 0;
  prelude = "";
  wrenchEmitCompileMemoryTrace("source.built", userCode.length(), sourceLen);

  unsigned char* bytecode = nullptr;
  int byteLen = 0;
  WRstr compileErr;

  wrenchCompileCrashArm(protocolFnv1a(userCode), userCode.length());
  wrenchEmitCompileMemoryTrace("worker.before", userCode.length(), sourceLen);
  WRError ce = wrenchCompileOnWorker(source, (int)sourceLen, &bytecode, &byteLen, compileErr);
  p1ReusableBufferReleaseHandle(g_wrenchCompileSourceBuffer, sourceHandle);
  p1ReusableBufferMaintain(
    g_wrenchCompileSourceBuffer,
    P1_EMBED_WRENCH_COMPILE_SOURCE_RETAIN_MIN,
    P1_EMBED_WRENCH_COMPILE_SOURCE_RETAIN_MAX,
    P1_EMBED_WRENCH_COMPILE_SOURCE_SHRINK_IDLE_MS);
  wrenchCompileCrashClear();
  wrenchEmitCompileMemoryTrace("worker.after", userCode.length(), sourceLen, byteLen > 0 ? (size_t)byteLen : 0);
  if (ce != WR_ERR_None || !bytecode || byteLen <= 0) {
    errOut = compileErr.size() ? String(compileErr.c_str()) : String("compile failed: ") + scriptErrorWrenchName((int)ce);
    errOut = wrenchRemapCompileError(errOut, userLineOffset);
    g_scriptState = SCRIPT_ERROR;
    wrenchSetPhase(WRENCH_PHASE_ERROR);
    String details = "\"wrenchError\":" + String((int)ce);
    details += ",\"wrenchErrorName\":" + jsonString(scriptErrorWrenchName((int)ce));
    details += ",\"scriptBytes\":" + String(userCode.length());
    scriptErrorSet("compile", "compile_error", errOut, details);
    if (bytecode) wr_free(bytecode);
    return false;
  }

  if (byteLen > P1_EMBED_MAX_BYTECODE_BYTES) {
    errOut = "compiled bytecode too large";
    wrenchSetPhase(WRENCH_PHASE_ERROR);
    String details = "\"bytecodeBytes\":" + String(byteLen);
    details += ",\"maxBytecodeBytes\":" + String(P1_EMBED_MAX_BYTECODE_BYTES);
    scriptErrorSet("compile", "bytecode_too_large", errOut, details);
    wr_free(bytecode);
    return false;
  }

  *bytecodeOut = bytecode;
  *byteLenOut = byteLen;
  return true;
}

bool wrenchCompileAndSet(const String& userCode, String& errOut) {
  errOut = "";
  wrenchEmitCompileMemoryTrace("compileAndSet.begin", userCode.length());
  {
    P1EventField fields[] = {
      p1FieldUInt("scriptBytes", userCode.length()),
    };
    debugEventEmitFields("script.debug", "debug", "script", "compileAndSet begin", fields, 1);
  }
  uiRuntimeReset("", true);
  wrenchReleaseCompiledProgram();
  wrenchEmitCompileMemoryTrace("runtime.released", userCode.length());
  mqttTransportPrepareMemoryPressure();
  p1ReusableBufferMaintain(
    g_wrenchCompileSourceBuffer,
    P1_EMBED_WRENCH_COMPILE_SOURCE_RETAIN_MIN,
    P1_EMBED_WRENCH_COMPILE_SOURCE_RETAIN_MAX,
    0);
  wrenchEmitCompileMemoryTrace("mqtt.released", userCode.length());
  wrenchSetPhase(WRENCH_PHASE_COMPILING);

  unsigned char* bytecode = nullptr;
  int byteLen = 0;
  if (!wrenchCompileSource(userCode, &bytecode, &byteLen, errOut)) {
    wrenchEmitCompileMemoryTrace("compileAndSet.failed", userCode.length());
    P1EventField fields[] = {
      p1FieldString("error", errOut),
    };
    debugEventEmitFields("script.debug", "debug", "script", "compileAndSet compile failed", fields, 1);
    wrenchLock();
    g_scriptState = SCRIPT_ERROR;
    wrenchSetPhase(WRENCH_PHASE_ERROR);
    wrenchUnlock();
    return false;
  }

  wrenchLock();
  g_wrenchRunPending = false;
  wrenchStopLocked();
  wrenchFreeBytecodeLocked();
  wrenchSourceSet(userCode);
  g_bytecode = bytecode;
  g_bytecodeLen = byteLen;
  g_scriptState = SCRIPT_COMPILED;
  wrenchSetPhase(WRENCH_PHASE_COMPILED);
  {
    P1EventField fields[] = {
      p1FieldUInt("scriptBytes", userCode.length()),
      p1FieldUInt("bytecodeBytes", byteLen),
    };
    debugEventEmitFields("script.debug", "debug", "script", "compileAndSet ready", fields, 2);
  }
  P1EventField fields[] = {
    p1FieldString("state", "compiled"),
    p1FieldUInt("scriptBytes", userCode.length()),
    p1FieldUInt("bytecodeBytes", byteLen),
  };
  protocolEmitEventFields("script.state", fields, 3);
  wrenchEmitCompileMemoryTrace("compileAndSet.ready", userCode.length(), 0, byteLen);
  wrenchUnlock();
  return true;
}

bool wrenchSetCompiledBytecode(const String& userCode, const uint8_t* bytecodeData, size_t bytecodeLen, String& errOut) {
  errOut = "";
  if (!bytecodeData || bytecodeLen == 0) {
    errOut = "empty bytecode";
    scriptErrorSet("compile", "empty_bytecode", errOut);
    return false;
  }
  if (bytecodeLen > P1_EMBED_MAX_BYTECODE_BYTES) {
    errOut = "compiled bytecode too large";
    String details = "\"bytecodeBytes\":" + String(bytecodeLen);
    details += ",\"maxBytecodeBytes\":" + String(P1_EMBED_MAX_BYTECODE_BYTES);
    scriptErrorSet("compile", "bytecode_too_large", errOut, details);
    return false;
  }
  if (!wr_isBytecodeValid(bytecodeData, (unsigned int)bytecodeLen)) {
    errOut = "invalid Wrench bytecode";
    String details = "\"bytecodeBytes\":" + String(bytecodeLen);
    scriptErrorSet("compile", "invalid_bytecode", errOut, details);
    return false;
  }
  unsigned char* bytecode = (unsigned char*)wr_malloc(bytecodeLen);
  if (!bytecode) {
    errOut = "No heap for bytecode";
    String details = "\"bytecodeBytes\":" + String(bytecodeLen);
    details += ",\"freeHeap\":" + String(ESP.getFreeHeap());
    details += ",\"maxAllocHeap\":" + String(ESP.getMaxAllocHeap());
    scriptErrorSet("compile", "bytecode_no_heap", errOut, details);
    return false;
  }
  memcpy(bytecode, bytecodeData, bytecodeLen);

  wrenchLock();
  g_wrenchRunPending = false;
  wrenchStopLocked();
  wrenchFreeBytecodeLocked();
  wrenchSourceSet(userCode);
  g_bytecode = bytecode;
  g_bytecodeLen = (int)bytecodeLen;
  g_scriptState = SCRIPT_COMPILED;
  wrenchSetPhase(WRENCH_PHASE_COMPILED);
  P1EventField fields[] = {
    p1FieldString("state", "compiled"),
    p1FieldUInt("scriptBytes", userCode.length()),
    p1FieldUInt("bytecodeBytes", bytecodeLen),
  };
  protocolEmitEventFields("script.state", fields, 3);
  wrenchUnlock();
  return true;
}

bool wrenchRunCompiled(String& errOut) {
  errOut = "";
  wrenchTaskBegin();
  {
    P1EventField fields[] = {
      p1FieldUInt("bytecodeBytes", g_bytecodeLen),
    };
    debugEventEmitFields("script.debug", "debug", "script", "runCompiled begin", fields, 1);
  }
  wrenchLock();
  if (!g_bytecode || g_bytecodeLen <= 0) {
    errOut = "no compiled script";
    g_scriptState = SCRIPT_ERROR;
    wrenchSetPhase(WRENCH_PHASE_ERROR);
    scriptErrorSet("run", "no_compiled_script", errOut);
    wrenchUnlock();
    return false;
  }

  wrenchStopLocked();
  debugEventEmitFields("script.debug", "debug", "script", "runCompiled after stop", nullptr, 0);
  g_wrenchConsecutiveErrorLoops = 0;

  mqttTransportPrepareMemoryPressure();
  ledBeginScriptRun();
  haRuntimeReset();

  g_wr = wr_newState(P1_EMBED_WRENCH_VM_STACK);
  if (!g_wr) {
    errOut = "wr_newState failed";
    g_scriptState = SCRIPT_ERROR;
    wrenchSetPhase(WRENCH_PHASE_ERROR);
    scriptErrorSet("run", "wrench_state_alloc_failed", errOut);
    wrenchUnlock();
    return false;
  }

  wr_setInstructionsPerSlice(g_wr, P1_EMBED_WRENCH_INSTRUCTIONS_PER_SLICE);
  wr_setAllocatedMemoryGCHint(g_wr, P1_EMBED_WRENCH_GC_HINT_BYTES);

  g_wr->globalRegistry.growHash(WRENCH_NULL_HASH, 256);
  if (!wrenchCheckStateError(g_wr, errOut, "wrench registry prealloc")) {
    wrenchStopLocked();
    g_scriptState = SCRIPT_ERROR;
    wrenchSetPhase(WRENCH_PHASE_ERROR);
    wrenchUnlock();
    return false;
  }

  wr_loadAllLibs(g_wr);
  wrenchRegisterBindings(g_wr);
  if (!wrenchCheckStateError(g_wr, errOut, "wrench binding registration")) {
    wrenchStopLocked();
    g_scriptState = SCRIPT_ERROR;
    wrenchSetPhase(WRENCH_PHASE_ERROR);
    wrenchUnlock();
    return false;
  }
  debugEventEmitFields("script.debug", "debug", "script", "runCompiled state created", nullptr, 0);

  wrenchSetPhase(WRENCH_PHASE_LOADING);
  g_ctx = wr_newContext(g_wr, g_bytecode, g_bytecodeLen, false);
  if (!g_ctx) {
    WRError error = wr_getLastError(g_wr);
    errOut = String("runtime load failed: ") + scriptErrorWrenchName((int)error);
    String details = "\"wrenchError\":" + String((int)error);
    details += ",\"wrenchErrorName\":" + jsonString(scriptErrorWrenchName((int)error));
    details += ",\"bytecodeBytes\":" + String(g_bytecodeLen);
    details += ",\"vmStackValues\":" + String(P1_EMBED_WRENCH_VM_STACK);
    if (g_bytecode && g_bytecodeLen >= 3) {
      details += ",\"globals\":" + String((uint8_t)g_bytecode[0]);
      details += ",\"localFunctions\":" + String((uint8_t)g_bytecode[1]);
    }
    scriptErrorSet("load", "runtime_load_error", errOut, details);
    wrenchStopLocked();
    g_scriptState = SCRIPT_ERROR;
    wrenchSetPhase(WRENCH_PHASE_ERROR);
    wrenchUnlock();
    return false;
  }

  g_fnSetup = wr_getFunction(g_ctx, "setup");
  g_fnLoop = wr_getFunction(g_ctx, "loop");
  g_scriptState = SCRIPT_COMPILED;
  {
    P1EventField fields[] = {
      p1FieldBool("hasSetup", g_fnSetup != nullptr),
      p1FieldBool("hasLoop", g_fnLoop != nullptr),
    };
    debugEventEmitFields("script.debug", "debug", "script", "runCompiled functions", fields, 2);
  }

  WRValue* top = wr_executeContext(g_ctx);
  if (!top && wr_getLastError(g_wr) != WR_ERR_None) {
    WRError error = wr_getLastError(g_wr);
    errOut = String("global runtime error: ") + scriptErrorWrenchName((int)error);
    wrenchEmitRuntimeError("global", error);
    wrenchStopLocked();
    g_scriptState = SCRIPT_ERROR;
    wrenchSetPhase(WRENCH_PHASE_ERROR);
    wrenchUnlock();
    return false;
  }
  wrenchCollectAfterCall(top);
  {
    P1EventField fields[] = {
      p1FieldBool("hasSetup", g_fnSetup != nullptr),
      p1FieldBool("hasLoop", g_fnLoop != nullptr),
    };
    debugEventEmitFields("script.debug", "debug", "script", "runCompiled global ok", fields, 2);
  }

  if (g_fnSetup) {
    wrenchSetPhase(WRENCH_PHASE_SETUP);
    debugEventEmitFields("script.debug", "debug", "script", "setup begin", nullptr, 0);
    uint32_t errorCountBefore = scriptErrorCount();
    WRValue* ret = wr_callFunction(g_ctx, g_fnSetup, nullptr, 0);
    if (!ret && wr_getLastError(g_wr) != WR_ERR_None) {
      WRError error = wr_getLastError(g_wr);
      errOut = String("setup runtime error: ") + scriptErrorWrenchName((int)error);
      wrenchEmitRuntimeError("setup", error);
      wrenchStopLocked();
      g_scriptState = SCRIPT_ERROR;
      wrenchSetPhase(WRENCH_PHASE_ERROR);
      wrenchUnlock();
      return false;
    }
    if (scriptErrorCount() > errorCountBefore) {
      errOut = String("setup binding error: ") + scriptErrorLastMessage();
      String details = "\"lastErrorCode\":" + jsonString(scriptErrorLastCode());
      details += ",\"lastErrorMessage\":" + jsonString(scriptErrorLastMessage());
      details += ",\"scriptBytes\":" + String(g_currentScriptBytes);
      details += ",\"scriptHash\":" + String(g_currentScriptHash);
      scriptErrorSet("setup", "setup_binding_error", errOut, details);
      wrenchStopLocked();
      g_scriptState = SCRIPT_ERROR;
      wrenchSetPhase(WRENCH_PHASE_ERROR);
      wrenchUnlock();
      return false;
    }
    wrenchCollectAfterCall(ret);
    debugEventEmitFields("script.debug", "debug", "script", "setup ok", nullptr, 0);
  } else {
    debugEventEmitFields("script.debug", "debug", "script", "setup missing", nullptr, 0);
  }

  g_scriptState = SCRIPT_RUNNING;
  g_wrenchLoopDebugMarkers = 0;
  wrenchSetPhase(WRENCH_PHASE_RUNNING);
  {
    P1EventField fields[] = {
      p1FieldBool("hasSetup", g_fnSetup != nullptr),
      p1FieldBool("hasLoop", g_fnLoop != nullptr),
    };
    debugEventEmitFields("script.debug", "debug", "script", "runCompiled running", fields, 2);
  }
  P1EventField fields[] = {
    p1FieldString("state", "running"),
    p1FieldBool("hasSetup", g_fnSetup != nullptr),
    p1FieldBool("hasLoop", g_fnLoop != nullptr),
  };
  protocolEmitEventFields("script.state", fields, 3);
  wrenchUnlock();
  return true;
}

void wrenchRequestRun() {
  g_wrenchRunPending = true;
}

bool wrenchRunIsPending() {
  return g_wrenchRunPending;
}

bool wrenchCompileAndRun(const String& userCode, String& errOut) {
  if (!wrenchCompileAndSet(userCode, errOut)) return false;
  return wrenchRunCompiled(errOut);
}
