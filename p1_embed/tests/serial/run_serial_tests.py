#!/usr/bin/env python3
import argparse
import importlib
import os
import pkgutil
import sys
import time
from pathlib import Path

from p1_serial import P1Serial


ROOT = Path(__file__).resolve().parent
CASES_DIR = ROOT / "cases"


def load_cases(only=None):
    sys.path.insert(0, str(ROOT))
    sys.path.insert(0, str(CASES_DIR))
    cases = []
    for module_info in pkgutil.iter_modules([str(CASES_DIR)]):
        if not module_info.name.startswith("test_"):
            continue
        module = importlib.import_module(module_info.name)
        for name in sorted(dir(module)):
            if name.startswith("test_") and callable(getattr(module, name)):
                full_name = f"{module_info.name}.{name}"
                if only and only not in module_info.name and only not in name and only not in full_name:
                    continue
                cases.append((full_name, getattr(module, name)))
    return cases


def main():
    parser = argparse.ArgumentParser(description="Run p1_embed serial hardware tests")
    parser.add_argument("--port", default="/dev/cu.wchusbserial58741104521")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--only", default=None, help="substring filter for test module names")
    parser.add_argument("--trace", action="store_true")
    parser.add_argument("--openweather-api-key", default=None, help="optional API key for live weather Wrench tests")
    args = parser.parse_args()
    if args.openweather_api_key:
        os.environ["P1_OPENWEATHER_API_KEY"] = args.openweather_api_key

    cases = load_cases(args.only)
    if not cases:
        print("No tests matched")
        return 2

    passed = 0
    failed = 0
    started = time.time()

    with P1Serial(args.port, args.baud, trace=args.trace) as dev:
        print("WAIT device ready")
        dev.wait_ready()
        for name, fn in cases:
            print(f"RUN  {name}")
            snapshot = None
            try:
                snapshot = dev.board_snapshot()
                dev.stop_script()
                dev.clear_error()
                fn(dev)
                dev.stop_script()
                print(f"PASS {name}")
                passed += 1
            except Exception as exc:
                failed += 1
                print(f"FAIL {name}: {exc}")
                dev.stop_script()
            finally:
                if snapshot:
                    try:
                        dev.restore_board_snapshot(snapshot)
                    except Exception as exc:
                        failed += 1
                        print(f"FAIL {name}: restore failed: {exc}")

    elapsed = time.time() - started
    print(f"\n{passed} passed, {failed} failed in {elapsed:.1f}s")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
