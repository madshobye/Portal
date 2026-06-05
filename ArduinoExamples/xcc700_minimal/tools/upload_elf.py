#!/usr/bin/env python3
import argparse
import os
import select
import sys
import termios
import time
import zlib


def configure_serial(fd: int, baud: int) -> None:
    speeds = {
        9600: termios.B9600,
        19200: termios.B19200,
        38400: termios.B38400,
        57600: termios.B57600,
        115200: termios.B115200,
        230400: termios.B230400,
        460800: termios.B460800,
        921600: termios.B921600,
    }
    if baud not in speeds:
        raise ValueError(f"unsupported baud for stdlib serial setup: {baud}")
    attrs = termios.tcgetattr(fd)
    attrs[0] = 0
    attrs[1] = 0
    attrs[2] = termios.CLOCAL | termios.CREAD | termios.CS8
    attrs[3] = 0
    attrs[4] = speeds[baud]
    attrs[5] = speeds[baud]
    attrs[6][termios.VMIN] = 0
    attrs[6][termios.VTIME] = 0
    termios.tcsetattr(fd, termios.TCSANOW, attrs)
    termios.tcflush(fd, termios.TCIOFLUSH)


def read_lines_until(fd: int, needles, timeout: float) -> str:
    deadline = time.monotonic() + timeout
    buf = bytearray()
    while time.monotonic() < deadline:
        readable, _, _ = select.select([fd], [], [], 0.1)
        if not readable:
            continue
        chunk = os.read(fd, 4096)
        if not chunk:
            continue
        sys.stdout.write(chunk.decode("utf-8", errors="replace"))
        sys.stdout.flush()
        buf.extend(chunk)
        text = buf.decode("utf-8", errors="replace")
        for needle in needles:
            if needle in text:
                return needle
    return ""


def main() -> int:
    parser = argparse.ArgumentParser(description="Upload an xcc700 ELF to the Arduino loader sketch.")
    parser.add_argument("elf", help="Compiled xcc700 ELF file")
    parser.add_argument("--port", default=os.environ.get("ESP32_PORT"), help="Serial device")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--ready-timeout", type=float, default=8)
    parser.add_argument("--run-timeout", type=float, default=20)
    args = parser.parse_args()

    if not args.port:
        parser.error("--port or ESP32_PORT is required")

    payload = open(args.elf, "rb").read()
    crc = zlib.crc32(payload) & 0xFFFFFFFF
    header = f"P1E_XCC700_ELF {len(payload)} {crc:08x}\n".encode()

    fd = os.open(args.port, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
    try:
      configure_serial(fd, args.baud)
      time.sleep(1.0)
      termios.tcflush(fd, termios.TCIOFLUSH)

      print(f"uploading {args.elf} ({len(payload)} bytes, crc={crc:08x})")
      os.write(fd, b"\n")
      os.write(fd, header)
      ready = read_lines_until(fd, ["READY", "ERR "], args.ready_timeout)
      if ready != "READY":
          print("upload did not reach READY", file=sys.stderr)
          return 1

      os.write(fd, payload)
      done = read_lines_until(fd, ["RESULT", "LOAD_ERROR", "ERR "], args.run_timeout)
      if done != "RESULT":
          print("upload did not complete successfully", file=sys.stderr)
          return 1
      return 0
    finally:
      os.close(fd)


if __name__ == "__main__":
    raise SystemExit(main())
