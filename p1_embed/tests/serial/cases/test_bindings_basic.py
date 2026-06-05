from p1_serial import assert_true


def test_basic_bindings_print_values(dev):
    code = """
function setup() {
  randomSeed(7);
  println("micros=" + micros());
  println("random10=" + random(10));
  println("randomRange=" + random(5, 9));
  println("heap=" + freeHeap());
  println("wifiConnected=" + wifiConnected());
  println("wifiIp=" + wifiIp());
  println("wifiRssi=" + wifiRssi());
  println("wifiSsid=" + wifiSsid());
  delayMicroseconds(10);
}

function loop() {
  delay(100);
}
""".strip()
    dev.run_script(code, save=False)
    seen = []
    for _ in range(8):
      seen.append(dev.wait_event("script.print", timeout=4.0).get("data", {}).get("message", ""))
    joined = "\n".join(seen)
    assert_true("micros=" in joined, "micros output")
    assert_true("random10=" in joined, "random output")
    assert_true("heap=" in joined, "heap output")
    assert_true("wifiConnected=" in joined, "wifi output")
