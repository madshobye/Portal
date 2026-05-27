#!/usr/bin/env python3
import argparse
import os
import sys

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(TOOLS_DIR)
SERIAL_DIR = os.path.join(ROOT_DIR, "tests", "serial")
sys.path.insert(0, SERIAL_DIR)

from p1_serial import P1Serial  # noqa: E402


def fmt_bytes(value):
    try:
        value = int(value)
    except Exception:
        return "-"
    sign = "-" if value < 0 else ""
    value = abs(value)
    return f"{sign}{value}"


def print_summary(summary):
    print("Memory profile")
    print(f"  samples:          {summary.get('samples')} / {summary.get('capacity')}")
    print(f"  profiler static:  {summary.get('staticBytes')} bytes")
    print(f"  base free:        {summary.get('baseFreeHeap')}")
    print(f"  current free:     {summary.get('currentFreeHeap')}")
    print(f"  current largest:  {summary.get('currentMaxAllocHeap')}")
    print(f"  worst free:       {summary.get('worstFreeHeap')}")
    print(f"  worst largest:    {summary.get('worstMaxAllocHeap')}")
    print()


def print_table(samples):
    headers = [
        "ms",
        "component",
        "phase",
        "free",
        "dFree",
        "used",
        "largest",
        "dLargest",
        "intFree",
        "intLarge",
        "stack",
        "task",
    ]
    rows = []
    for sample in samples:
        rows.append(
            [
                sample.get("atMs", ""),
                sample.get("component", ""),
                sample.get("phase", ""),
                sample.get("freeHeap", ""),
                fmt_bytes(sample.get("deltaFree", "")),
                fmt_bytes(sample.get("usedFromBase", "")),
                sample.get("maxAllocHeap", ""),
                fmt_bytes(sample.get("deltaMaxAlloc", "")),
                sample.get("internalFree", ""),
                sample.get("internalLargest", ""),
                sample.get("stackFreeWords", ""),
                sample.get("task", ""),
            ]
        )

    widths = [len(header) for header in headers]
    for row in rows:
        for idx, value in enumerate(row):
            widths[idx] = max(widths[idx], len(str(value)))

    def line(values):
        return "  ".join(str(value).ljust(widths[idx]) for idx, value in enumerate(values))

    print(line(headers))
    print(line(["-" * width for width in widths]))
    for row in rows:
        print(line(row))


def main():
    parser = argparse.ArgumentParser(description="Query and print the P1E firmware memory profile.")
    parser.add_argument("--port", default="/dev/cu.wchusbserial58741104521")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--limit", type=int, default=32)
    parser.add_argument("--reset", action="store_true", help="Reset the profile before reading it.")
    parser.add_argument("--trace", action="store_true")
    args = parser.parse_args()

    with P1Serial(args.port, args.baud, trace=args.trace) as dev:
        dev.wait_ready(timeout=10.0)
        command = "memory.profile.reset" if args.reset else "memory.profile"
        data = dev.command(command, {"limit": args.limit}, timeout=8.0)

    summary = data.get("summary") or {}
    samples = data.get("samples") or []
    print_summary(summary)
    print_table(samples)


if __name__ == "__main__":
    main()
