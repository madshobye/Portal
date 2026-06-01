#!/usr/bin/env python3
import os
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
WRENCH_INCLUDE = ROOT / "p1_embed/firmware/p1_embed"


HARNESS = r"""
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <sys/wait.h>
#include <unistd.h>

#include "wrench.cpp"

static long g_alloc_count = 0;
static long g_fail_at = -1;

static void* test_malloc(size_t size) {
  if (g_fail_at >= 0 && g_alloc_count++ >= g_fail_at) return nullptr;
  return std::malloc(size);
}

static void test_free(void* p) {
  std::free(p);
}

static void reset_alloc(long fail_at = -1) {
  g_alloc_count = 0;
  g_fail_at = fail_at;
  g_mallocFailed = false;
  wr_setGlobalAllocator(test_malloc, test_free);
}

static bool expect(bool ok, const char* label) {
  std::printf("%s %s\n", ok ? "PASS" : "FAIL", label);
  return ok;
}

static int run_child(void (*fn)()) {
  std::fflush(stdout);
  pid_t pid = fork();
  if (pid == 0) {
    fn();
    _exit(0);
  }
  int status = 0;
  waitpid(pid, &status, 0);
  if (WIFSIGNALED(status)) return -WTERMSIG(status);
  if (WIFEXITED(status)) return WEXITSTATUS(status);
  return 255;
}

static void hashtable_get_after_failed_ctor() {
  reset_alloc(0);
  WRHashTable<int> table(1);
  (void)table.get(1234);
}

static void wrstr_append_after_failed_grow() {
  reset_alloc();
  WRstr s;
  for (int i = 0; i < 14; ++i) s.append('x');
  reset_alloc(0);
  s.append('y');
  s.append('z');
}

static void wrstr_exact_fit_is_not_malloc_failure() {
  reset_alloc();
  WRstr s;
  s = "123456789012345";
  if (g_mallocFailed) _exit(1);

  s = "123456789012345678";
  if (g_mallocFailed) _exit(2);
}

static void opcode_stream_append_after_failed_initial_grow() {
  reset_alloc(0);
  WROpcodeStream stream;
  stream += (unsigned char)0x11;
  stream += (unsigned char)0x22;
  if (!g_mallocFailed) _exit(1);
  if (stream.size() != 0) _exit(2);
}

static void opcode_stream_append_after_failed_resize() {
  reset_alloc();
  WROpcodeStream stream;
  stream += (unsigned char)0x11;
  unsigned int before = stream.size();
  reset_alloc(0);
  stream.append((const unsigned char*)"12345678901234567890", 20);
  if (!g_mallocFailed) _exit(1);
  if (stream.size() != before) _exit(2);
  stream += (unsigned char)0x22;
}

int main() {
  int failures = 0;

  reset_alloc();
  {
    WRarray<int> a;
    for (int i = 0; i < 64; ++i) a.append() = i;
    WRarray<int> b(a);
    for (int i = 64; i < 128; ++i) b.append() = i;
    bool ok = (a.count() == 64) && (b.count() == 128);
    for (int i = 0; ok && i < 128; ++i) ok = (b[i] == i);
    failures += !expect(ok, "WRarray copy then append");
  }

  reset_alloc();
  {
    WRarray<int> a;
    for (int i = 0; i < 8; ++i) a.append() = i;
    a.remove(3, 10);
    bool ok = (a.count() == 3) && (a[0] == 0) && (a[1] == 1) && (a[2] == 2);
    failures += !expect(ok, "WRarray remove clamps past end");
  }

  reset_alloc();
  {
    WRarray<int> a;
    a.append() = 7;
    reset_alloc(0);
    unsigned int before = a.count();
    a.get(20) = 99;
    bool ok = g_mallocFailed && (a.count() == before);
    failures += !expect(ok, "WRarray failed get leaves count unchanged");
  }

  reset_alloc();
  {
    WRarray<int> a;
    a.append() = 12;
    reset_alloc(0);
    WRarray<int> b(a);
    bool ok = g_mallocFailed && b.count() == 0;
    failures += !expect(ok, "WRarray failed copy is empty");
  }

  failures += !expect(run_child(hashtable_get_after_failed_ctor) == 0,
                      "WRHashTable get after failed allocation");
  failures += !expect(run_child(wrstr_append_after_failed_grow) == 0,
                      "WRstr append after failed grow");
  failures += !expect(run_child(wrstr_exact_fit_is_not_malloc_failure) == 0,
                      "WRstr exact fit is not malloc failure");
  failures += !expect(run_child(opcode_stream_append_after_failed_initial_grow) == 0,
                      "WROpcodeStream append after failed initial grow");
  failures += !expect(run_child(opcode_stream_append_after_failed_resize) == 0,
                      "WROpcodeStream append after failed resize");

  wr_setGlobalAllocator(std::malloc, std::free);
  return failures ? 1 : 0;
}
"""


class WrenchContainerTests(unittest.TestCase):
    def test_containers_survive_forced_allocation_failures(self):
        with tempfile.TemporaryDirectory(prefix="p1e-wrench-containers-") as temp:
            temp_dir = Path(temp)
            harness_cpp = temp_dir / "wrench_container_harness.cpp"
            harness_bin = temp_dir / "wrench_container_harness"
            harness_cpp.write_text(textwrap.dedent(HARNESS), encoding="utf-8")

            compile_cmd = [
                "c++",
                "-std=c++17",
                "-O0",
                "-g",
                "-fsanitize=address",
                "-fno-omit-frame-pointer",
                "-I",
                str(WRENCH_INCLUDE),
                str(harness_cpp),
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

            env = os.environ.copy()
            env["ASAN_OPTIONS"] = "abort_on_error=1"
            ran = subprocess.run(
                [str(harness_bin)],
                cwd=ROOT,
                env=env,
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
            self.assertIn("PASS WRarray copy then append", ran.stdout)
            self.assertIn("PASS WRHashTable get after failed allocation", ran.stdout)
            self.assertIn("PASS WRstr append after failed grow", ran.stdout)
            self.assertIn("PASS WRstr exact fit is not malloc failure", ran.stdout)
            self.assertIn("PASS WROpcodeStream append after failed initial grow", ran.stdout)
            self.assertIn("PASS WROpcodeStream append after failed resize", ran.stdout)


if __name__ == "__main__":
    unittest.main()
