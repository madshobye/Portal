from p1_serial import assert_true


def reboot_and_wait(dev):
    dev.command("device.reboot", timeout=4.0)
    dev.drain(1.0)
    dev.wait_ready(timeout=10.0)
    dev.events = []


def test_fastled_ws2812b_smoke(dev):
    reboot_and_wait(dev)
    code = """
function setup() {
  println("begin=" + fastLedBegin(4, 1, 32));
  println("ready=" + fastLedReady());
  println("count=" + fastLedCount());
  println("set=" + fastLedSet(0, 12, 34, 56));
  println("brightness=" + fastLedBrightness(16));
  println("show=" + fastLedShow());
  println("clear=" + fastLedClear(1));
  println("status=" + fastLedStatus());
}

function loop() {
  delay(100);
}
""".strip()
    dev.command("script.set", {"code": code, "run": True, "save": False})
    seen = []
    for _ in range(8):
        seen.append(dev.wait_event("script.print", timeout=4.0).get("data", {}).get("message", ""))
    joined = "\n".join(seen)
    assert_true("begin=1" in joined, "fastLedBegin should pass")
    assert_true("ready=1" in joined, "fastLedReady should be true")
    assert_true("count=" in joined, "fastLedCount should report strip size")
    assert_true("set=1" in joined, "fastLedSet should pass")
    assert_true("show=1" in joined, "fastLedShow should pass")
    assert_true('"ready":true' in joined, "fastLedStatus should report ready")


def test_fastled_begin_is_idempotent(dev):
    reboot_and_wait(dev)
    code = """
function setup() {
  println("beginA=" + fastLedBegin(4, 1, 20));
  println("beginB=" + fastLedBegin(4, 1, 10));
  println("fill=" + fastLedFill(1, 2, 3));
  println("show=" + fastLedShow());
}

function loop() {
  delay(100);
}
""".strip()
    dev.command("script.set", {"code": code, "run": True, "save": False})
    seen = []
    for _ in range(4):
        seen.append(dev.wait_event("script.print", timeout=4.0).get("data", {}).get("message", ""))
    joined = "\n".join(seen)
    assert_true("beginA=1" in joined, "first fastLedBegin should pass")
    assert_true("beginB=1" in joined, "second same fastLedBegin should pass")
    assert_true("fill=1" in joined, "fastLedFill should pass")


def test_led_multistrip_bindings(dev):
    reboot_and_wait(dev)
    code = r'''
function setup() {
  println("cfg0=" + ledConfig(0, 4, 1, 24, 0));
  println("cfg1=" + ledConfig(1, 16, 1, 24, 0));
  println("strips=" + ledStripCount());
  println("count1=" + ledCount(1));
  println("set1=" + ledSet(1, 0, 4, 5, 6));
  println("fill0=" + ledFill(0, 7, 8, 9));
  println("show=" + ledShow());
  println("status=" + ledStatus());
}
'''
    dev.command("script.set", {"code": code, "run": True, "save": False})
    seen = []
    for _ in range(8):
        seen.append(dev.wait_event("script.print", timeout=4.0).get("data", {}).get("message", ""))
    joined = "\n".join(seen)
    assert_true("cfg0=1" in joined, "ledConfig strip 0 should pass")
    assert_true("cfg1=1" in joined, "ledConfig strip 1 should pass")
    assert_true("strips=" in joined, "ledStripCount should print")
    assert_true("count1=1" in joined, "ledCount should report strip 1 size")
    assert_true("set1=1" in joined, "ledSet on strip 1 should pass")
    assert_true("show=1" in joined, "ledShow should pass")
