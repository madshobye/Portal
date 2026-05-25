from p1_serial import assert_equal


def test_print_event(dev):
    code = """
function setup() {
  print("plain print");
  println("plain println");
}

function loop() {
  delay(100);
}
""".strip()
    dev.command("script.set", {"code": code, "run": True, "save": False})
    first = dev.wait_event("script.print", lambda e: e.get("data", {}).get("message") == "plain print")
    second = dev.wait_event("script.print", lambda e: e.get("data", {}).get("message") == "plain println")
    assert_equal(first.get("data", {}).get("newline"), False, "print newline flag")
    assert_equal(second.get("data", {}).get("newline"), True, "println newline flag")


def test_inbox_roundtrip(dev):
    code = """
function setup() {
  println("inbox ready");
}

function loop() {
  if (inboxAvailable() > 0) {
    var message = inboxRead();
    emit("script.input.received", message);
    emit("script.input.channel", inboxChannel());
  }
  delay(25);
}
""".strip()
    dev.command("script.set", {"code": code, "run": True, "save": False})
    dev.command("script.input", {"channel": "serial-test", "message": "hello wrench"})
    got_msg = dev.wait_event("script.input.received")
    got_channel = dev.wait_event("script.input.channel")
    assert_equal(got_msg.get("data", {}).get("message"), "hello wrench", "inbox message")
    assert_equal(got_channel.get("data", {}).get("message"), "serial-test", "inbox channel")
