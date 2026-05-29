#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import sys
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SERIAL_DIR = os.path.join(ROOT, "tests", "serial")
sys.path.insert(0, SERIAL_DIR)

from p1_serial import P1Serial, P1SerialError  # noqa: E402


DEFAULT_PORT = "/dev/cu.wchusbserial58741104521"


def fnv1a_hex(text):
    h = 0x811C9DC5
    for b in text.encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}"


def read_code(path):
    with open(os.path.expanduser(path), "r", encoding="utf-8") as f:
        return f.read()


def summarize_msg(msg):
    if msg.get("type") == "evt":
        name = msg.get("name")
        data = msg.get("data") or {}
        status = data.get("status")
        status_obj = status if isinstance(status, dict) else {}
        summary = {
            "evt": name,
            "state": data.get("state") or (status if isinstance(status, str) else None),
            "message": data.get("message"),
            "freeHeap": status_obj.get("freeHeap"),
            "maxAllocHeap": status_obj.get("maxAllocHeap"),
            "scriptState": status_obj.get("scriptState"),
        }
        return {k: v for k, v in summary.items() if v is not None}
    return msg


def drain_print(dev, seconds, prefix=""):
    deadline = time.time() + seconds
    while time.time() < deadline:
        for msg in dev.read_messages(0.2):
            print(prefix + json.dumps(summarize_msg(msg), separators=(",", ":")), flush=True)


def upload_chunked(dev, code, chunk_size, save):
    code_bytes = code.encode("utf-8")
    code_hash = fnv1a_hex(code)
    print(f"script bytes={len(code_bytes)} sha256={hashlib.sha256(code_bytes).hexdigest()[:12]} fnv={code_hash}")
    begin = dev.command(
        "script.chunk.begin",
        {"codeBytes": len(code_bytes), "codeHash": code_hash, "run": True, "save": save},
        timeout=10.0,
    )
    print("begin", json.dumps(begin, separators=(",", ":")))
    offset = 0
    index = 0
    while offset < len(code):
        chunk = code[offset : offset + chunk_size]
        data = dev.command("script.chunk.add", {"offset": offset, "chunk": chunk}, timeout=10.0)
        offset = int(data.get("received", offset + len(chunk)))
        index += 1
        if index % 10 == 0 or offset >= len(code):
            print(f"chunk {index} received={offset}", flush=True)
    commit = dev.command("script.chunk.commit", {}, timeout=15.0)
    print("commit", json.dumps(commit, separators=(",", ":")))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("script")
    parser.add_argument("--port", default=DEFAULT_PORT)
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--chunk-size", type=int, default=360)
    parser.add_argument("--save", action="store_true")
    parser.add_argument("--monitor", type=float, default=30.0)
    parser.add_argument("--raw", action="store_true")
    args = parser.parse_args()

    code = read_code(args.script)
    dev = P1Serial(args.port, baud=args.baud)
    if args.raw:
        dev.raw_callback = lambda line: print("raw " + line, flush=True)
    dev.open()
    try:
        dev.wait_ready()
        try:
            dev.command("debug.set", {"level": "debug"}, timeout=4.0)
        except P1SerialError:
            pass
        try:
            dev.command("script.stop", timeout=4.0)
        except P1SerialError:
            pass
        try:
            dev.command("script.error.clear", timeout=4.0)
        except P1SerialError:
            pass
        drain_print(dev, 0.5, "pre ")
        upload_chunked(dev, code, args.chunk_size, args.save)
        drain_print(dev, args.monitor)
        try:
            print("status", json.dumps(dev.command("status.get", timeout=5.0), separators=(",", ":")))
        except P1SerialError as exc:
            print(f"status_error {exc}")
        try:
            print("last_error", json.dumps(dev.command("script.error.get", timeout=5.0), separators=(",", ":")))
        except P1SerialError as exc:
            print(f"last_error_read_failed {exc}")
    finally:
        dev.close()


if __name__ == "__main__":
    main()
