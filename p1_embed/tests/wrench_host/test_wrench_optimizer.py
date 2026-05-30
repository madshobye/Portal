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
#include <iostream>
#include <string>

#include "wrench.h"

static const char* kScript = R"SCRIPT(
var globalValue = 0;

function sequentialSelfRead() {
  globalValue = 10;
  globalValue = globalValue * 2;
  return globalValue;
}

function branchSelfRead() {
  var i = 0;
  var out = 0;
  while (i < 30) {
    out = i;
    if (i > 10) {
      out = 10;
    }
    out = out * 2;
    i = i + 1;
  }
  return out;
}

function waveMath() {
  var ledCountTotal = 30;
  var wavePhase = 0;
  var i = 0;
  var x = 0;
  var v = 0;
  while (i < ledCountTotal) {
    x = (i * 16 + wavePhase) % 256;
    v = x;
    if (v > 127) {
      v = 255 - v;
    }
    v = v * 2;
    i = i + 1;
  }
  return v;
}
)SCRIPT";

static int callInt(WRContext* context, const char* name) {
  WRValue* value = wr_callFunction(context, name);
  if (!value || !value->isInt()) {
    std::cerr << "function did not return int: " << name << "\n";
    return -1000000;
  }
  return value->asInt();
}

int main() {
  unsigned char* bytecode = nullptr;
  int bytecodeLen = 0;
  WRstr err;
  WRError compileErr = wr_compile(
      kScript,
      static_cast<int>(std::string(kScript).size()),
      &bytecode,
      &bytecodeLen,
      &err);
  if (compileErr != WR_ERR_None) {
    std::cerr << "compile error: " << err.c_str() << "\n";
    return 2;
  }

  WRState* state = wr_newState();
  WRContext* context = wr_run(state, bytecode, bytecodeLen, true);
  if (!context || state->err != WR_ERR_None) {
    std::cerr << "run error: " << static_cast<int>(state->err) << "\n";
    wr_destroyState(state);
    return 3;
  }

  const int sequential = callInt(context, "sequentialSelfRead");
  const int branch = callInt(context, "branchSelfRead");
  const int wave = callInt(context, "waveMath");
  wr_destroyState(state);

  std::cout << "sequentialSelfRead=" << sequential << "\n";
  std::cout << "branchSelfRead=" << branch << "\n";
  std::cout << "waveMath=" << wave << "\n";

  if (sequential != 20) return 10;
  if (branch != 20) return 11;
  if (wave != 94) return 12;
  return 0;
}
"""


class WrenchOptimizerTests(unittest.TestCase):
    def test_self_read_assignment_and_branch_updates_survive_compile(self):
        with tempfile.TemporaryDirectory(prefix="p1e-wrench-host-") as temp:
            temp_dir = Path(temp)
            harness_cpp = temp_dir / "wrench_optimizer_harness.cpp"
            harness_bin = temp_dir / "wrench_optimizer_harness"
            harness_cpp.write_text(textwrap.dedent(HARNESS), encoding="utf-8")

            compile_cmd = [
                "c++",
                "-std=c++17",
                "-DWRENCH_WITH_COMPILER",
                "-DWRENCH_COMPACT",
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
            self.assertIn("sequentialSelfRead=20", ran.stdout)
            self.assertIn("branchSelfRead=20", ran.stdout)
            self.assertIn("waveMath=94", ran.stdout)


if __name__ == "__main__":
    unittest.main()
