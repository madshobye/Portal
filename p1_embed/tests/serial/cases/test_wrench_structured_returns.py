import re

from p1_serial import assert_equal, assert_true


def reboot_and_wait(dev):
    dev.command("device.reboot", timeout=4.0)
    dev.drain(1.0)
    dev.wait_ready(timeout=12.0)
    dev.events = []


def parse_diag_numbers(message):
    return {key: int(value) for key, value in re.findall(r"(iter|ops|checksum|start|min|max|end)=(-?\d+)", message)}


def test_diag_array3_return_is_stable_in_hot_loop(dev):
    code = """
var iterations = 0;
var checksum = 0;
var startHeap = 0;
var minHeap = 99999999;
var maxHeap = 0;
var done = 0;

function setup() {
  startHeap = freeHeap();
  minHeap = startHeap;
  maxHeap = startHeap;
  println("diag array start=" + startHeap);
}

function loop() {
  if (done == 0) {
    var j = 0;
    while (j < 200) {
      var tuple = diagArray3(iterations, iterations + 1, iterations + 2);
      checksum = checksum + tuple[0] + tuple[1] - tuple[2];

      var nested = diagArray3(tuple[2], tuple[1], tuple[0]);
      checksum = checksum + nested[0] - nested[1] + nested[2];

      var heap = freeHeap();
      if (heap < minHeap) minHeap = heap;
      if (heap > maxHeap) maxHeap = heap;
      iterations = iterations + 1;
      j = j + 1;
    }

    if (iterations >= 12000) {
      done = 1;
      println("diag array done iter=" + iterations + " checksum=" + checksum + " start=" + startHeap + " min=" + minHeap + " max=" + maxHeap + " end=" + freeHeap());
    }
  }
  delay(1);
}
""".strip()
    before = dev.command("status.get", timeout=4.0).get("freeHeap", 0)
    dev.run_script(code, save=False, timeout=10.0)
    start_event = dev.wait_event("script.print", timeout=5.0)
    assert_true(start_event.get("data", {}).get("message", "").startswith("diag array start="), "array diagnostic should start")
    done_event = dev.wait_event("script.print", timeout=12.0)
    message = done_event.get("data", {}).get("message", "")
    assert_true(message.startswith("diag array done iter="), "array diagnostic should finish")
    values = parse_diag_numbers(message)
    assert_true(values.get("iter", 0) >= 12000, f"array diagnostic iterations: {message}")
    assert_true(values.get("end", 0) >= values.get("start", 0) - 5000, f"array return heap should recover within running script: {message}")
    assert_true(values.get("min", 0) >= values.get("start", 0) - 60000, f"array return transient heap pressure should be bounded: {message}")

    last = dev.command("script.error.get", timeout=4.0)
    assert_equal(last.get("hasError"), False, "array diagnostic should not leave an error")

    dev.stop_script()
    dev.drain(0.8)
    after = dev.command("status.get", timeout=4.0).get("freeHeap", 0)
    assert_true(after > before - 8000, f"free heap should recover after stopping script before={before} after={after}")
    assert_true(dev.command("ping", timeout=3.0).get("pong"), "device should remain responsive after array stress")


def test_time_local_array_binding_shape(dev):
    code = """
var now[] = { 0, 0, 0, 0, 0, 0 };

function setup() {
  timeLocal(now);
  println("time local parts=" + now[0] + "," + now[1] + "," + now[2] + "," + now[3] + "," + now[4] + "," + now[5]);
}

function loop() {
  delay(10);
}
""".strip()
    dev.run_script(code, save=False, timeout=10.0)
    event = dev.wait_event("script.print", timeout=5.0)
    message = event.get("data", {}).get("message", "")
    assert_true(message.startswith("time local parts="), f"timeLocal should emit array parts: {message}")
    parts = [int(value) for value in message.split("=", 1)[1].split(",")]
    assert_equal(len(parts), 6, f"timeLocal part count: {message}")
    if parts[0] != -1:
      assert_true(2024 <= parts[0] <= 2100, f"timeLocal year range: {message}")
      assert_true(1 <= parts[1] <= 12, f"timeLocal month range: {message}")
      assert_true(1 <= parts[2] <= 31, f"timeLocal day range: {message}")
      assert_true(0 <= parts[3] <= 23, f"timeLocal hour range: {message}")
      assert_true(0 <= parts[4] <= 59, f"timeLocal minute range: {message}")
      assert_true(0 <= parts[5] <= 60, f"timeLocal seconds range: {message}")


def test_sun_local_direction_brightness_and_kelvin(dev):
    code = """
var sun[] = { 0, 0, 0, 0 };

function setup() {
  sunLocal(55.6761, 12.5683, 1782036000, sun);
  println("sun noon=" + sun[0] + "," + sun[1] + "," + sun[2] + "," + sun[3]);
  sunLocal(55.6761, 12.5683, 1782079200, sun);
  println("sun night=" + sun[0] + "," + sun[1] + "," + sun[2] + "," + sun[3]);
}

function loop() {
  delay(10);
}
""".strip()
    dev.run_script(code, save=False, timeout=10.0)
    noon_event = dev.wait_event("script.print", timeout=5.0)
    night_event = dev.wait_event("script.print", timeout=5.0)
    noon = noon_event.get("data", {}).get("message", "")
    night = night_event.get("data", {}).get("message", "")
    assert_true(noon.startswith("sun noon="), f"sunLocal noon output: {noon}")
    assert_true(night.startswith("sun night="), f"sunLocal night output: {night}")

    noon_parts = [float(value) for value in noon.split("=", 1)[1].split(",")]
    night_parts = [float(value) for value in night.split("=", 1)[1].split(",")]
    assert_equal(len(noon_parts), 4, f"sunLocal noon part count: {noon}")
    assert_equal(len(night_parts), 4, f"sunLocal night part count: {night}")
    assert_true(45.0 <= noon_parts[0] <= 60.0, f"Copenhagen summer noon elevation: {noon}")
    assert_true(120.0 <= noon_parts[1] <= 240.0, f"Copenhagen summer noon azimuth should face generally south: {noon}")
    assert_true(180.0 <= noon_parts[2] <= 255.0, f"Copenhagen summer noon brightness: {noon}")
    assert_true(5500.0 <= noon_parts[3] <= 6500.0, f"Copenhagen summer noon kelvin: {noon}")
    assert_true(night_parts[0] < 0.0, f"Copenhagen summer night elevation: {night}")
    assert_true(0.0 <= night_parts[1] <= 360.0, f"Copenhagen summer night azimuth range: {night}")
    assert_true(night_parts[2] <= 80.0, f"Copenhagen summer night brightness: {night}")
    assert_true(2200.0 <= night_parts[3] <= 4000.0, f"Copenhagen summer night kelvin: {night}")


def test_palette_get_rgb_output_array(dev):
    code = """
var color[] = { 0, 0, 0 };

function setup() {
  paletteSet2(0, 10, 20, 30, 110, 120, 130);
  paletteGetRgb(0, 0, color);
  println("palette rgb low=" + color[0] + "," + color[1] + "," + color[2]);
  paletteGetRgb(0, 255, color);
  println("palette rgb high=" + color[0] + "," + color[1] + "," + color[2]);
}

function loop() {
  delay(10);
}
""".strip()
    dev.run_script(code, save=False, timeout=10.0)
    low_event = dev.wait_event("script.print", timeout=5.0)
    high_event = dev.wait_event("script.print", timeout=5.0)
    low = low_event.get("data", {}).get("message", "")
    high = high_event.get("data", {}).get("message", "")
    assert_equal(low, "palette rgb low=10,20,30", f"palette low sample: {low}")
    assert_equal(high, "palette rgb high=110,120,130", f"palette high sample: {high}")


def test_rgb_hsv_array_bindings_are_stable_over_5k_led_operations(dev):
    code = """
var ops = 0;
var checksum = 0;
var startHeap = 0;
var minHeap = 99999999;
var maxHeap = 0;
var done = 0;
var ledTotal = 144;

function setup() {
  ledConfig(0, 16, ledTotal, 32);
  var i = 0;
  while (i < ledTotal) {
    ledSet(0, i, i % 255, (i * 3) % 255, (i * 7) % 255);
    i = i + 1;
  }
  startHeap = freeHeap();
  minHeap = startHeap;
  maxHeap = startHeap;
  println("rgb hsv array start=" + startHeap);
}

function loop() {
  if (done == 0) {
    var j = 0;
    while (j < 100) {
      var index = ops % ledTotal;
      var rgb = ledGetRgb(0, index);
      var hsv = rgbToHsv(rgb);
      hsv[0] = (hsv[0] + 17) % 255;
      var nextRgb = hsvToRgb(hsv);
      ledSetRgb(0, index, nextRgb);
      checksum = checksum + nextRgb[0] + nextRgb[1] + nextRgb[2] + hsv[0] + hsv[1] + hsv[2];

      var heap = freeHeap();
      if (heap < minHeap) minHeap = heap;
      if (heap > maxHeap) maxHeap = heap;
      ops = ops + 1;
      j = j + 1;
    }

    if (ops >= 5000) {
      done = 1;
      println("rgb hsv array done ops=" + ops + " checksum=" + checksum + " start=" + startHeap + " min=" + minHeap + " max=" + maxHeap + " end=" + freeHeap());
    }
  }
  delay(1);
}
""".strip()
    before = dev.command("status.get", timeout=4.0).get("freeHeap", 0)
    dev.run_script(code, save=False, timeout=12.0)
    start_event = dev.wait_event("script.print", timeout=5.0)
    assert_true(start_event.get("data", {}).get("message", "").startswith("rgb hsv array start="), "RGB/HSV array diagnostic should start")
    done_event = dev.wait_event("script.print", timeout=14.0)
    message = done_event.get("data", {}).get("message", "")
    assert_true(message.startswith("rgb hsv array done ops="), "RGB/HSV array diagnostic should finish")
    values = parse_diag_numbers(message)
    assert_true(values.get("ops", 0) >= 5000, f"RGB/HSV operations: {message}")
    assert_true(values.get("end", 0) >= values.get("start", 0) - 8000, f"RGB/HSV array heap should recover within running script: {message}")
    assert_true(values.get("min", 0) >= values.get("start", 0) - 70000, f"RGB/HSV transient heap pressure should be bounded: {message}")

    last = dev.command("script.error.get", timeout=4.0)
    assert_equal(last.get("hasError"), False, "RGB/HSV array diagnostic should not leave an error")

    dev.stop_script()
    dev.drain(0.8)
    after = dev.command("status.get", timeout=4.0).get("freeHeap", 0)
    assert_true(after > before - 10000, f"free heap should recover after RGB/HSV script before={before} after={after}")
    assert_true(dev.command("ping", timeout=3.0).get("pong"), "device should remain responsive after RGB/HSV array stress")


def test_rgb_hsv_array_bindings_with_2000_led_buffer_no_modulo(dev):
    reboot_and_wait(dev)
    code = """
var ops = 0;
var checksum = 0;
var startHeap = 0;
var minHeap = 99999999;
var maxHeap = 0;
var done = 0;
var ledTotal = 2000;

function setup() {
  ledConfig(0, 16, ledTotal, 16);
  startHeap = freeHeap();
  minHeap = startHeap;
  maxHeap = startHeap;
  println("rgb hsv array 2000 start=" + startHeap);
}

function loop() {
  if (done == 0) {
    var j = 0;
    while (j < 100 && ops < ledTotal) {
      var rgb = ledGetRgb(0, ops);
      var hsv = rgbToHsv(rgb);
      hsv[0] = (hsv[0] + 17) % 255;
      var nextRgb = hsvToRgb(hsv);
      ledSetRgb(0, ops, nextRgb);
      checksum = checksum + nextRgb[0] + nextRgb[1] + nextRgb[2] + hsv[0] + hsv[1] + hsv[2];

      var heap = freeHeap();
      if (heap < minHeap) minHeap = heap;
      if (heap > maxHeap) maxHeap = heap;
      ops = ops + 1;
      j = j + 1;
    }
    if (ops >= ledTotal) {
      done = 1;
      println("rgb hsv array 2000 done ops=" + ops + " checksum=" + checksum + " start=" + startHeap + " min=" + minHeap + " max=" + maxHeap + " end=" + freeHeap());
    }
  }
  delay(1);
}
""".strip()
    before = dev.command("status.get", timeout=4.0).get("freeHeap", 0)
    dev.run_script(code, save=False, timeout=14.0)
    start_event = dev.wait_event("script.print", timeout=6.0)
    assert_true(start_event.get("data", {}).get("message", "").startswith("rgb hsv array 2000 start="), "2000 LED array diagnostic should start")
    done_event = dev.wait_event("script.print", timeout=18.0)
    message = done_event.get("data", {}).get("message", "")
    assert_true(message.startswith("rgb hsv array 2000 done ops="), "2000 LED array diagnostic should finish")
    values = parse_diag_numbers(message)
    assert_equal(values.get("ops"), 2000, f"2000 LED array operation count: {message}")
    assert_true(values.get("end", 0) >= values.get("start", 0) - 10000, f"2000 LED array heap should recover within running script: {message}")

    last = dev.command("script.error.get", timeout=4.0)
    assert_equal(last.get("hasError"), False, "2000 LED array diagnostic should not leave an error")
    reboot_and_wait(dev)
    after = dev.command("status.get", timeout=4.0).get("freeHeap", 0)
    assert_true(after > before - 18000, f"free heap should recover after rebooting 2000 LED array script before={before} after={after}")


def test_rgb_hsv_reused_array_bindings_with_2000_led_buffer_no_modulo(dev):
    reboot_and_wait(dev)
    code = """
var ops = 0;
var checksum = 0;
var startHeap = 0;
var minHeap = 99999999;
var maxHeap = 0;
var done = 0;
var ledTotal = 2000;
var rgb[] = { 0, 0, 0 };
var hsv[] = { 0, 0, 0 };

function setup() {
  ledConfig(0, 16, ledTotal, 16);
  startHeap = freeHeap();
  minHeap = startHeap;
  maxHeap = startHeap;
  println("rgb hsv reuse 2000 start=" + startHeap);
}

function loop() {
  if (done == 0) {
    var j = 0;
    while (j < 100 && ops < ledTotal) {
      ledGetRgb(0, ops, rgb);
      rgbToHsv(rgb, hsv);
      hsv[0] = (hsv[0] + 17) % 255;
      hsvToRgb(hsv, rgb);
      ledSetRgb(0, ops, rgb);
      checksum = checksum + rgb[0] + rgb[1] + rgb[2] + hsv[0] + hsv[1] + hsv[2];

      var heap = freeHeap();
      if (heap < minHeap) minHeap = heap;
      if (heap > maxHeap) maxHeap = heap;
      ops = ops + 1;
      j = j + 1;
    }
    if (ops >= ledTotal) {
      done = 1;
      println("rgb hsv reuse 2000 done ops=" + ops + " checksum=" + checksum + " start=" + startHeap + " min=" + minHeap + " max=" + maxHeap + " end=" + freeHeap());
    }
  }
  delay(1);
}
""".strip()
    before = dev.command("status.get", timeout=4.0).get("freeHeap", 0)
    dev.run_script(code, save=False, timeout=14.0)
    start_event = dev.wait_event("script.print", timeout=6.0)
    assert_true(start_event.get("data", {}).get("message", "").startswith("rgb hsv reuse 2000 start="), "2000 LED reused-array diagnostic should start")
    done_event = dev.wait_event("script.print", timeout=18.0)
    message = done_event.get("data", {}).get("message", "")
    assert_true(message.startswith("rgb hsv reuse 2000 done ops="), "2000 LED reused-array diagnostic should finish")
    values = parse_diag_numbers(message)
    assert_equal(values.get("ops"), 2000, f"2000 LED reused-array operation count: {message}")
    assert_true(values.get("end", 0) >= values.get("start", 0) - 5000, f"2000 LED reused-array heap should recover within running script: {message}")

    last = dev.command("script.error.get", timeout=4.0)
    assert_equal(last.get("hasError"), False, "2000 LED reused-array diagnostic should not leave an error")
    reboot_and_wait(dev)
    after = dev.command("status.get", timeout=4.0).get("freeHeap", 0)
    assert_true(after > before - 18000, f"free heap should recover after rebooting 2000 LED reused-array script before={before} after={after}")
