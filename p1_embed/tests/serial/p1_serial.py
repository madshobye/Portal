import json
import os
import select
import termios
import time


class P1SerialError(Exception):
    pass


class P1Serial:
    def __init__(self, port, baud=115200, trace=False):
        self.port = port
        self.baud = baud
        self.trace = trace
        self.fd = None
        self.buf = b""
        self.next_id = 1
        self.events = []
        self.max_events = 200

    def __enter__(self):
        self.open()
        return self

    def __exit__(self, exc_type, exc, tb):
        self.close()

    def open(self):
        if self.fd is not None:
            return
        self.fd = os.open(self.port, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
        attrs = termios.tcgetattr(self.fd)
        attrs[0] = 0
        attrs[1] = 0
        attrs[2] = self._baud_const() | termios.CS8 | termios.CLOCAL | termios.CREAD
        attrs[3] = 0
        attrs[4] = self._baud_const()
        attrs[5] = self._baud_const()
        termios.tcsetattr(self.fd, termios.TCSANOW, attrs)
        time.sleep(1.5)
        self.drain(0.5)

    def wait_ready(self, timeout=8.0):
        deadline = time.time() + timeout
        last_error = None
        while time.time() < deadline:
            try:
                data = self.command("ping", timeout=1.0)
                if data.get("pong") is True:
                    return True
            except Exception as exc:
                last_error = exc
                time.sleep(0.25)
        raise P1SerialError(f"device did not become ready: {last_error}")

    def close(self):
        if self.fd is None:
            return
        os.close(self.fd)
        self.fd = None

    def command(self, name, data=None, timeout=10.0):
        data = data or {}
        msg_id = str(self.next_id)
        self.next_id += 1
        message = {
            "type": "cmd",
            "id": msg_id,
            "name": name,
            "data": data,
        }
        self.write_json(message)
        deadline = time.time() + timeout
        while time.time() < deadline:
            for msg in self.read_messages(0.2):
                if msg.get("type") == "evt":
                    self.events.append(msg)
                    self.trim_events()
                    continue
                if msg.get("type") == "res" and str(msg.get("id")) == msg_id:
                    if msg.get("ok"):
                        return msg.get("data") or {}
                    err = msg.get("error") or {}
                    raise P1SerialError(f"{name} failed: {err.get('code')} {err.get('message')}")
        raise P1SerialError(f"{name} timed out")

    def command_error(self, name, data=None, timeout=10.0):
        data = data or {}
        msg_id = str(self.next_id)
        self.next_id += 1
        self.write_json({"type": "cmd", "id": msg_id, "name": name, "data": data})
        deadline = time.time() + timeout
        while time.time() < deadline:
            for msg in self.read_messages(0.2):
                if msg.get("type") == "evt":
                    self.events.append(msg)
                    self.trim_events()
                    continue
                if msg.get("type") == "res" and str(msg.get("id")) == msg_id:
                    if msg.get("ok"):
                        raise P1SerialError(f"{name} unexpectedly succeeded")
                    return msg.get("error") or {}
        raise P1SerialError(f"{name} timed out waiting for error")

    def command_maybe_timeout(self, name, data=None, timeout=10.0):
        try:
            return True, self.command(name, data, timeout=timeout)
        except P1SerialError as exc:
            if "timed out" not in str(exc):
                raise
            return False, {"error": str(exc)}

    def write_json(self, message):
        raw = (json.dumps(message, separators=(",", ":")) + "\n").encode()
        if self.trace:
            print(">", raw.decode().strip())
        written = 0
        deadline = time.time() + 5.0
        while written < len(raw):
            if time.time() >= deadline:
                raise P1SerialError(f"serial write timed out after {written}/{len(raw)} bytes")
            _, writable, _ = select.select([], [self.fd], [], 0.2)
            if not writable:
                continue
            try:
                n = os.write(self.fd, raw[written:])
            except BlockingIOError:
                continue
            if n <= 0:
                raise P1SerialError("serial write failed")
            written += n

    def read_messages(self, timeout=0.2):
        messages = []
        readable, _, _ = select.select([self.fd], [], [], timeout)
        if not readable:
            return messages
        try:
            chunk = os.read(self.fd, 4096)
        except BlockingIOError:
            return messages
        if not chunk:
            return messages
        self.buf += chunk
        while b"\n" in self.buf:
            line, self.buf = self.buf.split(b"\n", 1)
            text = line.decode(errors="replace").strip()
            if not text.startswith("{"):
                continue
            try:
                msg = json.loads(text)
            except json.JSONDecodeError:
                continue
            if self.trace:
                print("<", json.dumps(msg, separators=(",", ":")))
            messages.append(msg)
        return messages

    def read_lines(self, timeout=0.2):
        lines = []
        readable, _, _ = select.select([self.fd], [], [], timeout)
        if not readable:
            return lines
        try:
            chunk = os.read(self.fd, 4096)
        except BlockingIOError:
            return lines
        if not chunk:
            return lines
        self.buf += chunk
        while b"\n" in self.buf:
            line, self.buf = self.buf.split(b"\n", 1)
            lines.append(line.decode(errors="replace").rstrip("\r"))
        return lines

    def drain(self, seconds=0.5):
        deadline = time.time() + seconds
        while time.time() < deadline:
            for msg in self.read_messages(0.05):
                if msg.get("type") == "evt":
                    self.events.append(msg)
                    self.trim_events()

    def wait_event(self, name, predicate=None, timeout=4.0):
        predicate = predicate or (lambda event: True)
        deadline = time.time() + timeout
        while time.time() < deadline:
            for idx, msg in enumerate(list(self.events)):
                if msg.get("name") == name and predicate(msg):
                    del self.events[idx]
                    return msg
            for msg in self.read_messages(0.2):
                if msg.get("type") == "evt":
                    if msg.get("name") == name and predicate(msg):
                        return msg
                    self.events.append(msg)
                    self.trim_events()
        raise P1SerialError(f"event {name} timed out")

    def stop_script(self):
        try:
            self.command("script.stop", timeout=3.0)
        except Exception:
            pass
        self.drain(0.2)
        self.events = []

    def clear_error(self):
        self.command("script.error.clear", timeout=3.0)
        self.events = []

    def _baud_const(self):
        if self.baud == 115200:
            return termios.B115200
        raise ValueError(f"unsupported baud: {self.baud}")

    def trim_events(self):
        if len(self.events) > self.max_events:
            self.events = self.events[-self.max_events :]


def assert_true(value, message):
    if not value:
        raise AssertionError(message)


def assert_equal(actual, expected, message):
    if actual != expected:
        raise AssertionError(f"{message}: expected {expected!r}, got {actual!r}")
