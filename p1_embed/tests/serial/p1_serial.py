import json
import os
import select
import termios
import time
import struct


class P1SerialError(Exception):
    pass


MSGPACK_FRAME_MAGIC = b"P1MP"
FRAME_CMD = 0
FRAME_RES = 1
FRAME_EVT = 2

OPS = {
    "ping": 1,
    "status.light": 2,
    "status.get": 15,
    "status.full": 16,
    "status.live": 17,
    "system.info": 3,
    "protocol.mode": 60,
}


class P1Serial:
    def __init__(self, port, baud=115200, trace=False):
        self.port = port
        self.baud = baud
        self.trace = trace
        self.raw_callback = None
        self.fd = None
        self.buf = b""
        self.next_id = 1
        self.events = []
        self.max_events = 200
        self.protocol = "json"

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
        if self.protocol == "msgpack":
            return self.command_msgpack(name, data, timeout=timeout)
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

    def command_msgpack(self, name, data=None, timeout=10.0):
        data = data or {}
        msg_id = self.next_id
        self.next_id += 1
        self.write_msgpack_command(msg_id, name, data)
        deadline = time.time() + timeout
        while time.time() < deadline:
            for msg in self.read_msgpack_messages(0.2):
                if msg.get("type") == "evt":
                    self.events.append(msg)
                    self.trim_events()
                    continue
                if msg.get("type") == "res" and str(msg.get("id")) == str(msg_id):
                    if msg.get("ok"):
                        return msg.get("data") or {}
                    err = msg.get("error") or {}
                    raise P1SerialError(f"{name} failed: {err.get('code')} {err.get('message')}")
        raise P1SerialError(f"{name} timed out")

    def set_protocol(self, protocol, timeout=5.0):
        protocol = str(protocol or "json").strip().lower()
        if protocol not in ("json", "msgpack"):
            raise ValueError(f"unsupported serial protocol: {protocol}")
        if protocol == self.protocol:
            return {"mode": protocol}
        if self.protocol == "json":
            data = self.command("protocol.mode", {"mode": protocol}, timeout=timeout)
            self.protocol = protocol
            self.buf = b""
            return data
        data = self.command_msgpack("protocol.mode", {"mode": protocol}, timeout=timeout)
        self.protocol = protocol
        self.buf = b""
        return data

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

    def write_msgpack_command(self, msg_id, name, data=None):
        payload = encode_command_msgpack(msg_id, name, data or {})
        raw = MSGPACK_FRAME_MAGIC + len(payload).to_bytes(2, "big") + payload
        if self.trace:
            print(">", raw.hex())
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
            if self.raw_callback:
                self.raw_callback(text)
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

    def read_msgpack_messages(self, timeout=0.2):
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
        while True:
            start = self.buf.find(MSGPACK_FRAME_MAGIC)
            if start < 0:
                self.buf = self.buf[-3:]
                return messages
            if start > 0:
                self.buf = self.buf[start:]
            if len(self.buf) < 6:
                return messages
            frame_len = int.from_bytes(self.buf[4:6], "big")
            if frame_len <= 0:
                self.buf = self.buf[1:]
                continue
            if len(self.buf) < 6 + frame_len:
                return messages
            frame = self.buf[6:6 + frame_len]
            self.buf = self.buf[6 + frame_len:]
            try:
                msg = decode_frame_msgpack(frame)
            except Exception:
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
            reader = self.read_msgpack_messages if self.protocol == "msgpack" else self.read_messages
            for msg in reader(0.05):
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
            reader = self.read_msgpack_messages if self.protocol == "msgpack" else self.read_messages
            for msg in reader(0.2):
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

    def trim_events(self):
        if len(self.events) > self.max_events:
            self.events = self.events[-self.max_events :]

    def _baud_const(self):
        if self.baud == 115200:
            return termios.B115200
        raise ValueError(f"unsupported baud: {self.baud}")


def encode_uint(value):
    value = int(value)
    if value <= 0x7f:
        return bytes([value])
    if value <= 0xff:
        return b"\xcc" + bytes([value])
    if value <= 0xffff:
        return b"\xcd" + value.to_bytes(2, "big")
    return b"\xce" + value.to_bytes(4, "big")


def encode_bool(value):
    return b"\xc3" if value else b"\xc2"


def encode_string(value):
    raw = str(value or "").encode()
    if len(raw) <= 31:
        return bytes([0xa0 | len(raw)]) + raw
    if len(raw) <= 0xff:
        return b"\xd9" + bytes([len(raw)]) + raw
    if len(raw) <= 0xffff:
        return b"\xda" + len(raw).to_bytes(2, "big") + raw
    raise P1SerialError("string too large for test MessagePack encoder")


def encode_array(count):
    if count <= 15:
        return bytes([0x90 | count])
    return b"\xdc" + int(count).to_bytes(2, "big")


def encode_command_msgpack(msg_id, name, data):
    op = OPS.get(name)
    if not op:
        raise P1SerialError(f"no test MessagePack opcode for {name}")
    if name == "protocol.mode":
        return b"".join([
            encode_array(4),
            encode_uint(FRAME_CMD),
            encode_uint(msg_id),
            encode_uint(op),
            encode_string(data.get("mode", "json")),
        ])
    return b"".join([
        encode_array(3),
        encode_uint(FRAME_CMD),
        encode_uint(msg_id),
        encode_uint(op),
    ])


class MsgPackCursor:
    def __init__(self, data):
        self.data = data
        self.offset = 0

    def byte(self):
        if self.offset >= len(self.data):
            raise P1SerialError("truncated MessagePack")
        value = self.data[self.offset]
        self.offset += 1
        return value

    def read(self, n):
        if self.offset + n > len(self.data):
            raise P1SerialError("truncated MessagePack")
        value = self.data[self.offset:self.offset + n]
        self.offset += n
        return value

    def value(self):
        b = self.byte()
        if b <= 0x7f:
            return b
        if b >= 0xe0:
            return b - 256
        if (b & 0xe0) == 0xa0:
            return self.read(b & 0x1f).decode(errors="replace")
        if (b & 0xf0) == 0x90:
            return [self.value() for _ in range(b & 0x0f)]
        if (b & 0xf0) == 0x80:
            return {self.value(): self.value() for _ in range(b & 0x0f)}
        if b == 0xc0:
            return None
        if b == 0xc2:
            return False
        if b == 0xc3:
            return True
        if b == 0xcc:
            return self.byte()
        if b == 0xcd:
            return int.from_bytes(self.read(2), "big")
        if b == 0xce:
            return int.from_bytes(self.read(4), "big")
        if b == 0xd0:
            return int.from_bytes(self.read(1), "big", signed=True)
        if b == 0xd1:
            return int.from_bytes(self.read(2), "big", signed=True)
        if b == 0xd2:
            return int.from_bytes(self.read(4), "big", signed=True)
        if b == 0xd9:
            return self.read(self.byte()).decode(errors="replace")
        if b == 0xda:
            return self.read(int.from_bytes(self.read(2), "big")).decode(errors="replace")
        if b == 0xc4:
            return self.read(self.byte())
        if b == 0xc5:
            return self.read(int.from_bytes(self.read(2), "big"))
        if b == 0xca:
            return struct.unpack(">f", self.read(4))[0]
        if b == 0xdc:
            return [self.value() for _ in range(int.from_bytes(self.read(2), "big"))]
        if b == 0xde:
            return {self.value(): self.value() for _ in range(int.from_bytes(self.read(2), "big"))}
        raise P1SerialError(f"unsupported MessagePack byte 0x{b:02x}")


def decode_frame_msgpack(frame):
    value = MsgPackCursor(frame).value()
    if not isinstance(value, list) or len(value) < 2:
        raise P1SerialError("bad MessagePack frame")
    frame_type = value[0]
    if frame_type == FRAME_EVT:
        return {"type": "evt", "name": str(value[1] or ""), "data": value[2] if len(value) > 2 and isinstance(value[2], dict) else {}}
    if frame_type != FRAME_RES or len(value) < 4:
        raise P1SerialError("unsupported MessagePack frame")
    data = value[3] if isinstance(value[3], dict) else {}
    if value[2]:
        return {"type": "res", "id": str(value[1]), "ok": True, "data": data}
    return {"type": "res", "id": str(value[1]), "ok": False, "error": data, "data": data}


def assert_true(value, message):
    if not value:
        raise AssertionError(message)


def assert_equal(actual, expected, message):
    if actual != expected:
        raise AssertionError(f"{message}: expected {expected!r}, got {actual!r}")
