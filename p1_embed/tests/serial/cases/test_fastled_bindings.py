from p1_serial import assert_true


def reboot_and_wait(dev):
    dev.command("device.reboot", timeout=4.0)
    dev.drain(1.0)
    dev.wait_ready(timeout=10.0)
    dev.events = []


def test_led_ws2812b_smoke(dev):
    reboot_and_wait(dev)
    code = """
function setup() {
  println("begin=" + ledConfig(0, 4, 32, 16));
  println("ready=" + ledReady(0));
  println("count=" + ledCount(0));
  println("set=" + ledSet(0, 0, 12, 34, 56));
  println("brightness=" + ledBrightness(0, 16));
  println("show=" + ledShow());
  println("clear=" + ledClear(0, 1));
}

function loop() {
  delay(100);
}
""".strip()
    dev.command("script.set", {"code": code, "run": True, "save": False})
    seen = []
    for _ in range(7):
        seen.append(dev.wait_event("script.print", timeout=4.0).get("data", {}).get("message", ""))
    joined = "\n".join(seen)
    assert_true("begin=1" in joined, "ledConfig should pass")
    assert_true("ready=1" in joined, "ledReady should be true")
    assert_true("count=32" in joined, "ledCount should report strip size")
    assert_true("set=1" in joined, "ledSet should pass")
    assert_true("show=1" in joined, "ledShow should pass")


def test_led_config_is_idempotent(dev):
    reboot_and_wait(dev)
    code = """
function setup() {
  println("beginA=" + ledConfig(0, 4, 20, 255));
  println("beginB=" + ledConfig(0, 4, 10, 255));
  println("fill=" + ledFill(0, 1, 2, 3));
  println("show=" + ledShow());
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
    assert_true("beginA=1" in joined, "first ledConfig should pass")
    assert_true("beginB=1" in joined, "second same ledConfig should pass")
    assert_true("fill=1" in joined, "ledFill should pass")


def test_led_multistrip_bindings(dev):
    reboot_and_wait(dev)
    code = r'''
function setup() {
  println("cfg0=" + ledConfig(0, 4, 1, 24));
  println("cfg1=" + ledConfig(1, 16, 1, 24));
  println("strips=" + ledStripCount());
  println("count1=" + ledCount(1));
  println("set1=" + ledSet(1, 0, 4, 5, 6));
  println("fill0=" + ledFill(0, 7, 8, 9));
  println("show=" + ledShow());
}
'''
    dev.command("script.set", {"code": code, "run": True, "save": False})
    seen = []
    for _ in range(7):
        seen.append(dev.wait_event("script.print", timeout=4.0).get("data", {}).get("message", ""))
    joined = "\n".join(seen)
    assert_true("cfg0=1" in joined, "ledConfig strip 0 should pass")
    assert_true("cfg1=1" in joined, "ledConfig strip 1 should pass")
    assert_true("strips=" in joined, "ledStripCount should print")
    assert_true("count1=1" in joined, "ledCount should report strip 1 size")
    assert_true("set1=1" in joined, "ledSet on strip 1 should pass")
    assert_true("show=1" in joined, "ledShow should pass")
