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
function intConcat() {
  var value = 12;
  return "scalar=" + value;
}

function floatDirect() {
  var value = 12.5;
  return value;
}

function floatConcat() {
  var value = 12.5;
  return "scalar=" + value;
}

function floatVariableConcat() {
  var prefix = "scalar=";
  var value = 12.5;
  return prefix + value;
}

function floatReverseConcat() {
  var value = 12.5;
  return value + " suffix";
}
)SCRIPT";

static std::string valueToString(WRValue* value) {
  if (!value) return "<null>";
  char buf[128];
  value->asString(buf, sizeof(buf));
  return std::string(buf);
}

static int expectString(WRContext* context, const char* name, const char* expected) {
  WRValue* value = wr_callFunction(context, name);
  std::string actual = valueToString(value);
  std::cout << name << "=" << actual << "\n";
  if (actual != expected) return 1;
  return 0;
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
    wr_free(bytecode);
    return 3;
  }

  int failures = 0;
  failures += expectString(context, "intConcat", "scalar=12");
  failures += expectString(context, "floatDirect", "12.5");
  failures += expectString(context, "floatConcat", "scalar=12.5");
  failures += expectString(context, "floatVariableConcat", "scalar=12.5");
  failures += expectString(context, "floatReverseConcat", "12.5 suffix");

  wr_destroyState(state);
  wr_free(bytecode);
  return failures ? 1 : 0;
}
"""


class WrenchFloatStringConcatTests(unittest.TestCase):
    def _run_harness(self, extra_flags):
        with tempfile.TemporaryDirectory(prefix="p1e-wrench-float-concat-") as temp:
            temp_dir = Path(temp)
            harness_cpp = temp_dir / "wrench_float_concat_harness.cpp"
            harness_bin = temp_dir / "wrench_float_concat_harness"
            harness_cpp.write_text(textwrap.dedent(HARNESS), encoding="utf-8")

            compile_cmd = [
                "c++",
                "-std=c++17",
                "-DWRENCH_WITH_COMPILER",
                *extra_flags,
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

    def test_normal_float_string_concat_matches_int_concat(self):
        self._run_harness([])

    def test_compact_float_string_concat_matches_int_concat(self):
        self._run_harness(["-DWRENCH_COMPACT"])


if __name__ == "__main__":
    unittest.main()
