#!/usr/bin/env python3
import argparse
import json
import os
import shlex
import sys
import time


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SERIAL_DIR = os.path.join(ROOT, "tests", "serial")
sys.path.insert(0, SERIAL_DIR)

from p1_serial import P1Serial, P1SerialError


DEFAULT_PORT = "/dev/cu.wchusbserial58741104521"


HELP = """Commands:
  help                         Show this help
  ping                         Send ping
  status                       Send status.get
  info                         Send system.info
  stop                         Send script.stop
  restart                      Send script.restart
  reboot                       Send device.reboot
  error                        Send script.error.get
  clear-error                  Send script.error.clear
  cmd NAME [JSON]              Send arbitrary protocol command
  run FILE [--save]            Upload and run a Wrench file
  paste [--save]               Paste Wrench code, end with a line containing only .
  monitor [SECONDS]            Print incoming protocol messages
  quit                         Exit
"""


def print_json(value):
    print(json.dumps(value, indent=2, sort_keys=True))


def parse_json_arg(text):
    if not text:
        return {}
    try:
        value = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise ValueError("JSON argument must be an object")
    return value


def read_file(path):
    with open(os.path.expanduser(path), "r", encoding="utf-8") as f:
        return f.read()


def paste_code():
    print("Paste Wrench code. End with a line containing only .")
    lines = []
    while True:
        line = input()
        if line == ".":
            break
        lines.append(line)
    return "\n".join(lines)


def run_code(dev, code, save=False):
    try:
        return dev.run_script(code, save=save, timeout=20.0)
    except P1SerialError as exc:
        details = {"error": str(exc)}
        try:
            details["lastScriptError"] = dev.command("script.error.get", timeout=3.0)
        except P1SerialError as status_exc:
            details["lastScriptErrorReadFailed"] = str(status_exc)
        try:
            details["status"] = dev.command("status.get", timeout=3.0)
        except P1SerialError as status_exc:
            details["statusReadFailed"] = str(status_exc)
        raise P1SerialError(json.dumps(details, separators=(",", ":"))) from exc


def monitor(dev, seconds):
    deadline = time.time() + seconds
    try:
        while time.time() < deadline:
            for msg in dev.read_messages(0.25):
                print(json.dumps(msg, separators=(",", ":")))
    except KeyboardInterrupt:
        return


def raw_monitor(dev, seconds):
    deadline = time.time() + seconds
    try:
        while time.time() < deadline:
            for line in dev.read_lines(0.25):
                print(line, flush=True)
    except KeyboardInterrupt:
        return


def handle_line(dev, line):
    parts = shlex.split(line)
    if not parts:
        return True

    name = parts[0]
    if name in ("quit", "exit"):
        return False
    if name == "help":
        print(HELP)
    elif name == "ping":
        print_json(dev.command("ping"))
    elif name == "status":
        print_json(dev.command("status.get"))
    elif name == "info":
        print_json(dev.command("system.info"))
    elif name == "stop":
        print_json(dev.command("script.stop"))
    elif name == "restart":
        print_json(dev.command("script.restart"))
    elif name == "reboot":
        print_json(dev.command("device.reboot"))
    elif name == "error":
        print_json(dev.command("script.error.get"))
    elif name == "clear-error":
        print_json(dev.command("script.error.clear"))
    elif name == "cmd":
        if len(parts) < 2:
            print("usage: cmd NAME [JSON]")
        else:
            data = parse_json_arg(parts[2] if len(parts) > 2 else "")
            print_json(dev.command(parts[1], data, timeout=20.0))
    elif name == "run":
        if len(parts) < 2:
            print("usage: run FILE [--save]")
        else:
            save = "--save" in parts[2:]
            print_json(run_code(dev, read_file(parts[1]), save=save))
    elif name == "paste":
        save = "--save" in parts[1:]
        print_json(run_code(dev, paste_code(), save=save))
    elif name == "monitor":
        seconds = float(parts[1]) if len(parts) > 1 else 10.0
        monitor(dev, seconds)
    else:
        print(f"unknown command: {name}")
    return True


def main():
    parser = argparse.ArgumentParser(description="Interactive p1_embed serial protocol REPL")
    parser.add_argument("--port", default=DEFAULT_PORT)
    parser.add_argument("--baud", default=115200, type=int)
    parser.add_argument("--run", metavar="FILE", help="Upload and run a Wrench file, then exit")
    parser.add_argument("--cmd", metavar="NAME", help="Send one protocol command, then exit")
    parser.add_argument("--data", default="{}", help="JSON object for --cmd")
    parser.add_argument("--save", action="store_true", help="Save uploaded script when used with --run")
    parser.add_argument("--monitor", default=0, type=float, help="Monitor for N seconds after --run")
    parser.add_argument("--listen", default=0, type=float, help="Monitor incoming protocol messages for N seconds, then exit")
    parser.add_argument("--raw-listen", default=0, type=float, help="Monitor raw serial lines for N seconds, then exit")
    parser.add_argument("--trace", action="store_true")
    args = parser.parse_args()

    dev = P1Serial(args.port, baud=args.baud, trace=args.trace)
    dev.open()
    try:
        if args.raw_listen > 0:
            raw_monitor(dev, args.raw_listen)
            return
        dev.wait_ready()
        if args.cmd:
            print_json(dev.command(args.cmd, parse_json_arg(args.data), timeout=20.0))
            return
        if args.listen > 0:
            monitor(dev, args.listen)
            return
        if args.run:
            print_json(run_code(dev, read_file(args.run), save=args.save))
            if args.monitor > 0:
                monitor(dev, args.monitor)
            return

        print(f"connected: {args.port}")
        print("type help for commands")
        while True:
            try:
                line = input("p1> ")
            except EOFError:
                print()
                break
            try:
                if not handle_line(dev, line):
                    break
            except (P1SerialError, ValueError, OSError) as exc:
                print(f"error: {exc}")
    finally:
        dev.close()


if __name__ == "__main__":
    main()
