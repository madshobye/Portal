#!/usr/bin/env python3
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
WRENCH_CPP = ROOT / "p1_embed/firmware/p1_embed/wrench.cpp"
WRENCH_INCLUDE = ROOT / "p1_embed/firmware/p1_embed"


HARNESS = r"""
#include <cstdlib>
#include <iostream>
#include <string>
#include <sys/wait.h>
#include <unistd.h>

#include "wrench.h"

static const char* kBareArrayGlobals = R"SCRIPT(
flyPos[] = { 13.0, 39.0, 68.0, 101.0, 126.0 };
)SCRIPT";

static const char* kVisualClockLocalIf = R"SCRIPT(
var stripPin = 16;
var powerPin = 18;
var stripIndex = 0;
var ledCountValue = 144;
var brightness = 50;
var lastFrameAt = 0;
var lastSecond = -1;
var lastMinute = -1;
var lastHour = -1;
var waitingTick = 0;
var lastMillisPixel = -1;

function paintWaiting() {
  waitingTick = (waitingTick + 1) % 12;
}

function paintClock() {
}

function setup() {
}

function loop() {
  var now = 0;
  var currentSecond = 0;
  var currentMinute = 0;
  var currentHour = 0;
  var currentMillis = 0;
  var currentMillisPos = 0;

  currentSecond = 1;
  currentMillis = 1000;

  if (currentSecond < 0) {
    if ((currentMillis - lastFrameAt) >= 1000) {
      lastFrameAt = currentMillis;
      paintWaiting();
    }
    return;
  }

  now = currentMillis;
  currentMinute = 2;
  currentHour = 3;
  currentMillisPos = (currentMillis / 10) % ledCountValue;

  if ((now - lastFrameAt) >= 16 || currentSecond != lastSecond || currentMinute != lastMinute || currentHour != lastHour || currentMillisPos != lastMillisPixel) {
    lastFrameAt = now;
    lastSecond = currentSecond;
    lastMinute = currentMinute;
    lastHour = currentHour;
    paintClock();
  }
}
)SCRIPT";

static const char* kNestedFloatArrayScript = R"SCRIPT(
var fireflyCount = 5;
var motionScale = 0.00018;
var wanderSpeed = 1.18;
var inertia = 0.86;
var attractDistance = 17.0;
var attractStrength = 0.82;
var attractThreshold = 0.58;
var attractGateScale = 0.00042;
var flyPos[] = { 13.0, 39.0, 68.0, 101.0, 126.0 };
var flyVel[] = { 0.46, -0.32, 0.28, -0.44, 0.36 };

function setup() {
  var now = 0;
  var i = 0;
  var j = 0;
  var t = 0.0;
  var wander = 0.0;
  var targetVel = 0.0;
  var pull = 0.0;
  var hold = 0.0;
  var delta = 0.0;
  var distance = 0.0;
  var closeness = 0.0;
  var gate = 0.0;
  var attractAmount = 0.0;
  now = millis();
  while (i < fireflyCount) {
    t = now * motionScale + i * 19.73;
    wander = simplex3(t, i * 0.31, 0.64);
    targetVel = wander * wanderSpeed;
    pull = 0.0;
    hold = 0.0;
    j = 0;
    while (j < fireflyCount) {
      if (i != j) {
        delta = flyPos[j] - flyPos[i];
        distance = delta;
        if (distance < 0) distance = 0.0 - distance;
        if (distance > 0.1 && distance < attractDistance) {
          gate = simplex3_01(now * attractGateScale + i * 1.7, j * 2.3, 4.4);
          if (gate > attractThreshold) {
            closeness = 1.0 - (distance / attractDistance);
            attractAmount = (gate - attractThreshold) / (1.0 - attractThreshold);
            attractAmount = attractAmount * closeness * attractStrength;
            hold = hold + (attractAmount * 0.22);
            if (delta > 0) pull = pull + attractAmount;
            if (delta < 0) pull = pull - attractAmount;
          }
        }
      }
      j = j + 1;
    }
    if (hold > 0.34) hold = 0.34;
    flyVel[i] = (flyVel[i] * inertia) + (((targetVel * (1.0 - hold)) + pull) * (1.0 - inertia));
    i = i + 1;
  }
}

function loop() {
  delay(50);
}
)SCRIPT";

static long g_alloc_count = 0;
static long g_fail_at = -1;

static void* testMalloc(size_t size) {
  long index = g_alloc_count++;
  if (g_fail_at >= 0 && index >= g_fail_at) return nullptr;
  return std::malloc(size);
}

static void testFree(void* ptr) {
  std::free(ptr);
}

static WRError compileScript(const char* script, WRstr* errOut = nullptr) {
  unsigned char* bytecode = nullptr;
  int bytecodeLen = 0;
  WRstr err;
  WRError compileErr = wr_compile(
      script,
      static_cast<int>(std::string(script).size()),
      &bytecode,
      &bytecodeLen,
      &err,
      WR_INCLUDE_GLOBALS);
  if (errOut) *errOut = err;
  if (bytecode) wr_free(bytecode);
  return compileErr;
}

static int compileWithForcedMallocFailure(const char* script, long failAt) {
  alarm(2);
  g_alloc_count = 0;
  g_fail_at = failAt;
  g_mallocFailed = false;
  wr_setGlobalAllocator(testMalloc, testFree);

  unsigned char* bytecode = nullptr;
  int bytecodeLen = 0;
  WRstr err;
  WRError compileErr = wr_compile(
      script,
      static_cast<int>(std::string(script).size()),
      &bytecode,
      &bytecodeLen,
      &err,
      WR_INCLUDE_GLOBALS);
  if (bytecode) wr_free(bytecode);
  wr_setGlobalAllocator(std::malloc, std::free);
  alarm(0);

  if (compileErr == WR_ERR_malloc_failed || g_mallocFailed) return 0;
  std::cerr << "forced allocation failure reported err=" << static_cast<int>(compileErr)
            << " at failAt=" << failAt << "\n" << err.c_str() << "\n";
  return 1;
}

static int runForcedFailureChild(long failAt) {
  pid_t pid = fork();
  if (pid == 0) {
    _exit(compileWithForcedMallocFailure(kNestedFloatArrayScript, failAt));
  }
  int status = 0;
  waitpid(pid, &status, 0);
  if (WIFSIGNALED(status)) return 1000 + WTERMSIG(status);
  return WEXITSTATUS(status);
}

static long countCompileAllocations(const char* script) {
  g_alloc_count = 0;
  g_fail_at = -1;
  g_mallocFailed = false;
  wr_setGlobalAllocator(testMalloc, testFree);
  unsigned char* bytecode = nullptr;
  int bytecodeLen = 0;
  WRstr err;
  (void)wr_compile(
      script,
      static_cast<int>(std::string(script).size()),
      &bytecode,
      &bytecodeLen,
      &err,
      WR_INCLUDE_GLOBALS);
  if (bytecode) wr_free(bytecode);
  wr_setGlobalAllocator(std::malloc, std::free);
  return g_alloc_count;
}

int main() {
  WRstr bareErr;
  WRError bareArray = compileScript(kBareArrayGlobals, &bareErr);
  std::cout << "bare_array_err=" << static_cast<int>(bareArray) << "\n";
  std::cout << "bare_array_msg=" << bareErr.c_str() << "\n";
  if (bareArray != WR_ERR_var_not_seen_before_label) return 10;

  WRstr visualErr;
  WRError visualClock = compileScript(kVisualClockLocalIf, &visualErr);
  std::cout << "visual_clock_err=" << static_cast<int>(visualClock) << "\n";
  std::cout << "visual_clock_msg=" << visualErr.c_str() << "\n";
  if (visualClock != WR_ERR_None) return 20;

  WRstr nestedErr;
  WRError nested = compileScript(kNestedFloatArrayScript, &nestedErr);
  std::cout << "nested_float_err=" << static_cast<int>(nested) << "\n";
  std::cout << "nested_float_msg=" << nestedErr.c_str() << "\n";
  if (nested != WR_ERR_None) return 30;

  long allocations = countCompileAllocations(kNestedFloatArrayScript);
  std::cout << "nested_float_allocations=" << allocations << "\n";
  if (allocations < 16) return 31;

  const long forcedFailPoints[] = {2, 5, 7, allocations / 3, allocations / 2, allocations - 1};
  for (long failAt : forcedFailPoints) {
    int forced = runForcedFailureChild(failAt);
    std::cout << "forced_fail_at_" << failAt << "=" << forced << "\n";
    if (forced != 0) return 40;
  }

  return 0;
}
"""


class WrenchCompileRegressionTests(unittest.TestCase):
    def test_compile_regressions(self):
        with tempfile.TemporaryDirectory(prefix="p1e-wrench-compile-") as temp:
            temp_dir = Path(temp)
            harness_cpp = temp_dir / "wrench_compile_regression_harness.cpp"
            harness_bin = temp_dir / "wrench_compile_regression_harness"
            harness_cpp.write_text(textwrap.dedent(HARNESS), encoding="utf-8")

            compile_cmd = [
                "c++",
                "-std=c++17",
                "-DWRENCH_WITH_COMPILER",
                "-DWRENCH_COMPACT",
                "-DWRENCH_HANDLE_MALLOC_FAIL",
                "-I",
                str(WRENCH_INCLUDE),
                str(harness_cpp),
                str(WRENCH_CPP),
                "-o",
                str(harness_bin),
            ]
            compiled = subprocess.run(
                compile_cmd,
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
            self.assertEqual(
                compiled.returncode,
                0,
                f"host harness failed to compile\nSTDOUT:\n{compiled.stdout}\nSTDERR:\n{compiled.stderr}",
            )

            ran = subprocess.run(
                [str(harness_bin)],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
            self.assertEqual(
                ran.returncode,
                0,
                f"host harness failed\nSTDOUT:\n{ran.stdout}\nSTDERR:\n{ran.stderr}",
            )
            self.assertIn("bare_array_err=", ran.stdout)
            self.assertIn("visual_clock_err=0", ran.stdout)


if __name__ == "__main__":
    unittest.main()
