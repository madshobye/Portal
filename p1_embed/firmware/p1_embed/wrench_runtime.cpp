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
static String g_currentScript = "";
static P1ScriptState g_scriptState = SCRIPT_EMPTY;
static TaskHandle_t g_wrenchTaskHandle = nullptr;
static SemaphoreHandle_t g_wrenchMutex = nullptr;
static volatile bool g_wrenchTaskRunning = false;
static volatile uint32_t g_wrenchLoopCount = 0;
static volatile uint32_t g_wrenchLastLoopMs = 0;
static volatile uint32_t g_wrenchCurrentLoopStartedAt = 0;
static volatile uint32_t g_wrenchSlowLoopCount = 0;
static volatile uint32_t g_wrenchHungLoopCount = 0;
static volatile uint32_t g_wrenchLockTimeoutCount = 0;
static volatile bool g_wrenchLoopInProgress = false;
static volatile bool g_wrenchHungCounted = false;
static volatile uint8_t g_wrenchTransitionDepth = 0;
static volatile uint32_t g_wrenchTransitionStartedAt = 0;
static volatile uint32_t g_wrenchTransitionRecoveries = 0;
static volatile bool g_wrenchRunPending = false;
static volatile P1WrenchPhase g_wrenchPhase = WRENCH_PHASE_IDLE;
static char g_wrenchTransitionReason[40] = "";

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

static void wrenchSetPhase(P1WrenchPhase phase) {
  g_wrenchPhase = phase;
}

static void wrenchEmitRuntimeError(const char* phase, WRError error) {
  String message = String(phase) + " runtime error: " + scriptErrorWrenchName((int)error);
  String details = "\"wrenchError\":" + String((int)error);
  details += ",\"wrenchErrorName\":" + jsonString(scriptErrorWrenchName((int)error));
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

static void wrenchFreeBytecodeLocked() {
  if (g_bytecode) {
    wr_free(g_bytecode);
    g_bytecode = nullptr;
  }
  g_bytecodeLen = 0;
}

static void wrenchStopLocked() {
  wrenchSetPhase(WRENCH_PHASE_STOPPING);
  if (g_wr) {
    wr_destroyState(g_wr);
    g_wr = nullptr;
  }
  g_ctx = nullptr;
  g_fnSetup = nullptr;
  g_fnLoop = nullptr;
  g_scriptState = g_currentScript.length() ? SCRIPT_STOPPED : SCRIPT_EMPTY;
  wrenchSetPhase(g_currentScript.length() ? WRENCH_PHASE_STOPPED : WRENCH_PHASE_IDLE);
  protocolEmitEvent("script.state", "\"state\":\"stopped\"");
}

static void wrenchLoopLocked() {
  if (g_scriptState != SCRIPT_RUNNING || !g_wr || !g_ctx || !g_fnLoop) return;
  uint32_t startedAt = millis();
  g_wrenchCurrentLoopStartedAt = startedAt;
  g_wrenchLoopInProgress = true;
  g_wrenchHungCounted = false;
  WRValue* ret = wr_callFunction(g_ctx, g_fnLoop, nullptr, 0);
  uint32_t elapsed = millis() - startedAt;
  g_wrenchLoopInProgress = false;
  g_wrenchHungCounted = false;
  g_wrenchLoopCount++;
  g_wrenchLastLoopMs = millis();
  if (elapsed >= P1_EMBED_WRENCH_LOOP_WARN_MS) {
    g_wrenchSlowLoopCount++;
    debugEventEmit("script.watchdog", "warn", "script", "", "\"state\":\"slow_loop\",\"elapsedMs\":" + String(elapsed));
  }
  if (!ret && wr_getLastError(g_wr) != WR_ERR_None) {
    wrenchEmitRuntimeError("loop", wr_getLastError(g_wr));
    wrenchStopLocked();
    g_scriptState = SCRIPT_ERROR;
  }
}

static void wrenchTask(void*) {
  g_wrenchTaskRunning = true;
  for (;;) {
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
  if (g_wrenchTaskHandle) return;

  BaseType_t ok = xTaskCreatePinnedToCore(
    wrenchTask,
    "p1Wrench",
    P1_EMBED_WRENCH_TASK_STACK,
    nullptr,
    1,
    &g_wrenchTaskHandle,
    1);
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
  if (!wrenchTryLock(P1_EMBED_WRENCH_LOCK_STATUS_TIMEOUT_MS)) return "";
  String code = g_currentScript;
  wrenchUnlock();
  return code;
}

bool wrenchSetCurrentScript(const String& code) {
  if (code.length() > P1_EMBED_MAX_SCRIPT_BYTES) return false;
  wrenchLock();
  g_currentScript = code;
  if (g_scriptState == SCRIPT_EMPTY) g_scriptState = SCRIPT_STOPPED;
  wrenchUnlock();
  return true;
}

const char* wrenchStateName() {
  if (!wrenchTryLock(P1_EMBED_WRENCH_LOCK_STATUS_TIMEOUT_MS)) return "busy";
  P1ScriptState state = g_scriptState;
  wrenchUnlock();
  return wrenchScriptStateName(state);
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
  debugEventEmit("script.watchdog", "error", "script", "", "\"state\":\"hung_loop\",\"elapsedMs\":" + String(elapsed));
}

void wrenchRuntimePoll() {
  uint8_t depth = g_wrenchTransitionDepth;
  if (depth) {
    uint32_t elapsed = millis() - g_wrenchTransitionStartedAt;
    if (elapsed >= P1_EMBED_WRENCH_TRANSITION_TIMEOUT_MS) {
      g_wrenchTransitionDepth = 0;
      g_wrenchTransitionRecoveries++;
      debugEventEmit("script.runtime", "error", "script", "Recovered stale Wrench transition", "\"reason\":" + jsonString(g_wrenchTransitionReason) + ",\"elapsedMs\":" + String(elapsed));
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
  out += "}";
  return out;
}

uint32_t wrenchTaskStackHighWater() {
  if (!g_wrenchTaskHandle) return 0;
  return (uint32_t)uxTaskGetStackHighWaterMark(g_wrenchTaskHandle);
}

void wrenchStop() {
  wrenchLock();
  g_wrenchRunPending = false;
  wrenchStopLocked();
  wrenchUnlock();
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
  pre += "var INPUT = 0;\n";
  pre += "var OUTPUT = 1;\n";
  pre += "var INPUT_PULLUP = 2;\n";
  pre += "var LOW = 0;\n";
  pre += "var HIGH = 1;\n";
  pre += "var LED_BUILTIN = ";
  pre += String(P1_EMBED_DEFAULT_LED_PIN);
  pre += ";\n";
  return pre;
}

struct WrenchCompileJob {
  const String* source;
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
  job->result = wr_compile(job->source->c_str(), (int)job->source->length(), &job->bytecode, &job->byteLen, &job->compileErr, WR_INCLUDE_GLOBALS);
  xSemaphoreGive(job->done);
  vTaskDelete(nullptr);
}

static WRError wrenchCompileOnWorker(const String& src, unsigned char** bytecodeOut, int* byteLenOut, WRstr& compileErr) {
  WrenchCompileJob job;
  job.source = &src;
  job.bytecode = nullptr;
  job.byteLen = 0;
  job.result = WR_ERR_None;
  job.done = xSemaphoreCreateBinary();
  if (!job.done) {
    return wr_compile(src.c_str(), (int)src.length(), bytecodeOut, byteLenOut, &compileErr, WR_INCLUDE_GLOBALS);
  }

  BaseType_t ok = xTaskCreatePinnedToCore(
    wrenchCompileTaskEntry,
    "p1WrCompile",
    P1_EMBED_WRENCH_COMPILE_TASK_STACK,
    &job,
    1,
    nullptr,
    1);

  if (ok != pdPASS) {
    vSemaphoreDelete(job.done);
    return wr_compile(src.c_str(), (int)src.length(), bytecodeOut, byteLenOut, &compileErr, WR_INCLUDE_GLOBALS);
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

  String src = wrenchPrelude();
  src += "\n";
  src += userCode;

  unsigned char* bytecode = nullptr;
  int byteLen = 0;
  WRstr compileErr;

  WRError ce = wrenchCompileOnWorker(src, &bytecode, &byteLen, compileErr);
  if (ce != WR_ERR_None || !bytecode || byteLen <= 0) {
    errOut = compileErr.size() ? String(compileErr.c_str()) : String("compile failed code=") + String((int)ce);
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
  wrenchSetPhase(WRENCH_PHASE_COMPILING);

  unsigned char* bytecode = nullptr;
  int byteLen = 0;
  if (!wrenchCompileSource(userCode, &bytecode, &byteLen, errOut)) {
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
  g_currentScript = userCode;
  g_bytecode = bytecode;
  g_bytecodeLen = byteLen;
  g_scriptState = SCRIPT_COMPILED;
  wrenchSetPhase(WRENCH_PHASE_COMPILED);
  protocolEmitEvent("script.state", "\"state\":\"compiled\",\"scriptBytes\":" + String(userCode.length()) + ",\"bytecodeBytes\":" + String(byteLen));
  wrenchUnlock();
  return true;
}

bool wrenchRunCompiled(String& errOut) {
  errOut = "";
  wrenchLock();
  if (!g_bytecode || g_bytecodeLen <= 0 || g_currentScript.length() == 0) {
    errOut = "no compiled script";
    g_scriptState = SCRIPT_ERROR;
    wrenchSetPhase(WRENCH_PHASE_ERROR);
    scriptErrorSet("run", "no_compiled_script", errOut);
    wrenchUnlock();
    return false;
  }

  wrenchStopLocked();

  g_wr = wr_newState();
  if (!g_wr) {
    errOut = "wr_newState failed";
    g_scriptState = SCRIPT_ERROR;
    wrenchSetPhase(WRENCH_PHASE_ERROR);
    scriptErrorSet("run", "wrench_state_alloc_failed", errOut);
    wrenchUnlock();
    return false;
  }

  wr_setInstructionsPerSlice(g_wr, P1_EMBED_WRENCH_INSTRUCTIONS_PER_SLICE);

  wr_loadAllLibs(g_wr);
  wrenchRegisterBindings(g_wr);

  wrenchSetPhase(WRENCH_PHASE_LOADING);
  g_ctx = wr_newContext(g_wr, g_bytecode, g_bytecodeLen, false);
  if (!g_ctx) {
    WRError error = wr_getLastError(g_wr);
    errOut = String("runtime load failed: ") + scriptErrorWrenchName((int)error);
    String details = "\"wrenchError\":" + String((int)error);
    details += ",\"wrenchErrorName\":" + jsonString(scriptErrorWrenchName((int)error));
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

  if (g_fnSetup) {
    wrenchSetPhase(WRENCH_PHASE_SETUP);
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
  }

  g_scriptState = SCRIPT_RUNNING;
  wrenchSetPhase(WRENCH_PHASE_RUNNING);
  protocolEmitEvent("script.state", "\"state\":\"running\",\"hasSetup\":" + String(g_fnSetup ? "true" : "false") + ",\"hasLoop\":" + String(g_fnLoop ? "true" : "false"));
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
