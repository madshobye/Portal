from pathlib import Path
import os

from p1_serial import assert_equal, assert_true


def reboot_and_wait(dev):
    dev.command("device.reboot", timeout=4.0)
    dev.drain(1.0)
    dev.wait_ready(timeout=10.0)
    dev.events = []


def test_var_while_compiles_and_runs(dev):
    code = """
function setup() {
  var i = 0;
  var total = 0;
  while (i < 5) {
    total = total + i;
    i = i + 1;
  }
  println("total=" + total);
}

function loop() {
  delay(100);
}
""".strip()
    dev.command("script.set", {"code": code, "run": True, "save": False}, timeout=8.0)
    event = dev.wait_event("script.print", timeout=4.0)
    assert_equal(event.get("data", {}).get("message"), "total=10", "while loop should run")
    last = dev.command("script.error.get")
    assert_equal(last.get("hasError"), False, "while script should not leave an error")


def test_c_style_int_declaration_fails_cleanly(dev):
    code = """
function setup() {
  int i = 0;
  println(i);
}
""".strip()
    error = dev.command_error("script.set", {"code": code, "run": True, "save": False}, timeout=6.0)
    assert_equal(error.get("code"), "compile_error", "C-style int should fail as compile_error")
    last = dev.command("script.error.get")
    assert_equal(last.get("phase"), "compile", "last error phase")
    assert_equal(last.get("code"), "compile_error", "last error code")
    assert_true("WR_ERR_bad_expression" in last.get("message", ""), "last error should report Wrench expression error")
    status = dev.command("status.get", timeout=4.0)
    runtime = status.get("wrenchRuntime") or {}
    assert_equal(runtime.get("transitionActive"), False, "compile error should release runtime transition")
    assert_equal(runtime.get("phase"), "error", "compile error should leave runtime phase as error")
    assert_true(dev.command("ping", timeout=3.0).get("pong"), "device should respond after compile error")


def test_script_run_bad_compile_stops_current_code(dev):
    good_code = """
function setup() {
  println("run stop guard ready");
}

function loop() {
  delay(100);
}
""".strip()
    bad_code = """
function setup() {
  int broken = 1;
}
""".strip()
    dev.command("script.run", {"code": good_code}, timeout=8.0)
    assert_equal(dev.wait_event("script.print", timeout=4.0).get("data", {}).get("message"), "run stop guard ready", "good setup print")
    error = dev.command_error("script.run", {"code": bad_code}, timeout=6.0)
    assert_equal(error.get("code"), "compile_error", "script.run should return compile_error")
    status = dev.command("status.get", timeout=4.0)
    assert_equal(status.get("scriptState"), "error", "failed run compile should leave runtime stopped/error")
    assert_equal((status.get("wrenchRuntime") or {}).get("phase"), "error", "failed run compile should leave runtime phase error")


def test_script_set_replaces_running_code_without_timeout(dev):
    first = """
function setup() {
  println("replace first ready");
}

function loop() {
  delay(40);
}
""".strip()
    second = """
function setup() {
  println("replace second ready");
}

function loop() {
  delay(40);
}
""".strip()
    dev.command("script.set", {"code": first, "run": True, "save": False}, timeout=8.0)
    assert_equal(dev.wait_event("script.print", timeout=4.0).get("data", {}).get("message"), "replace first ready", "first script setup print")
    result = dev.command("script.set", {"code": second, "run": True, "save": True}, timeout=10.0)
    assert_equal(result.get("state"), "running", "replacement should be accepted and running")
    assert_equal(result.get("scriptBytes"), len(second), "replacement byte count")
    assert_equal(dev.wait_event("script.print", timeout=4.0).get("data", {}).get("message"), "replace second ready", "second script setup print")
    fetched = dev.command("script.get", timeout=4.0)
    assert_equal(fetched.get("code"), second, "script.get should read replaced running script")
    assert_equal(fetched.get("state"), "running", "replacement should be running")


def test_script_get_reads_source_while_running(dev):
    code = """
function setup() {
  println("read source ready");
}

function loop() {
  var i = 0;
  while (i < 50) {
    i = i + 1;
  }
  delay(20);
}
""".strip()
    dev.command("script.set", {"code": code, "run": True, "save": True}, timeout=8.0)
    assert_equal(dev.wait_event("script.print", timeout=4.0).get("data", {}).get("message"), "read source ready", "setup print")
    for _ in range(5):
        fetched = dev.command("script.get", timeout=4.0)
        assert_equal(fetched.get("code"), code, "script.get should return running source")
        assert_equal(fetched.get("stored"), True, "saved running source should report stored")


def test_script_save_run_and_get_roundtrip(dev):
    code = """
function setup() {
  println("save run roundtrip ready");
}

function loop() {
  delay(30);
}
""".strip()
    saved = dev.command("script.save", {"code": code, "autorun": False}, timeout=8.0)
    assert_equal(saved.get("state"), "saved", "script.save should report saved")
    assert_equal(saved.get("scriptBytes"), len(code), "saved byte count")
    fetched = dev.command("script.get", timeout=4.0)
    assert_equal(fetched.get("code"), code, "script.get should read saved compiled source")
    assert_equal(fetched.get("stored"), True, "script.save should persist source")
    result = dev.command("script.run", timeout=6.0)
    assert_equal(result.get("state"), "run_pending", "script.run without code should run compiled source")
    assert_equal(dev.wait_event("script.print", timeout=4.0).get("data", {}).get("message"), "save run roundtrip ready", "saved script setup print")
    fetched = dev.command("script.get", timeout=4.0)
    assert_equal(fetched.get("code"), code, "script.get should read source after run")
    assert_equal(fetched.get("state"), "running", "saved script should be running")


def test_bad_script_set_stops_running_code_before_compile(dev):
    good_code = """
function setup() {
  println("bad replace guard ready");
}

function loop() {
  delay(40);
}
""".strip()
    bad_code = """
function setup() {
  int broken = 1;
}
""".strip()
    dev.command("script.set", {"code": good_code, "run": True, "save": False}, timeout=8.0)
    assert_equal(dev.wait_event("script.print", timeout=4.0).get("data", {}).get("message"), "bad replace guard ready", "good setup print")
    error = dev.command_error("script.set", {"code": bad_code, "run": True, "save": False}, timeout=8.0)
    assert_equal(error.get("code"), "compile_error", "bad replacement should fail as compile_error")
    status = dev.command("status.get", timeout=4.0)
    assert_equal(status.get("scriptState"), "error", "bad replacement should stop old runtime")
    assert_equal((status.get("wrenchRuntime") or {}).get("phase"), "error", "bad replacement should leave compile error phase")
    assert_true(dev.command("ping", timeout=3.0).get("pong"), "device should respond after bad replacement")


def test_led_bad_strip_fails_gracefully(dev):
    code = """
function setup() {
  clearError();
  println("badStrip=" + ledConfig(9, 4, 1, 16));
}

function loop() {
  delay(100);
}
""".strip()
    ok, result = dev.command_maybe_timeout("script.set", {"code": code, "run": True, "save": False}, timeout=8.0)
    assert_true(ok, "bad strip script should not time out")
    event = dev.wait_event("script.error", timeout=4.0)
    err = event.get("data", {}).get("error", {})
    assert_equal(err.get("phase"), "binding", "bad strip error phase")
    assert_equal(err.get("code"), "led_bad_strip", "bad strip error code")
    assert_true(dev.command("ping", timeout=3.0).get("pong"), "device should respond after binding error")


def test_led_bad_pin_fails_gracefully(dev):
    code = """
function setup() {
  clearError();
  println("badPin=" + ledConfig(0, 39, 1, 16));
}

function loop() {
  delay(100);
}
""".strip()
    dev.command("script.set", {"code": code, "run": True, "save": False}, timeout=8.0)
    event = dev.wait_event("script.error", timeout=4.0)
    err = event.get("data", {}).get("error", {})
    assert_equal(err.get("phase"), "binding", "bad pin error phase")
    assert_equal(err.get("code"), "led_bad_pin", "bad pin error code")
    assert_true(dev.command("ping", timeout=3.0).get("pong"), "device should respond after bad pin")


def test_led_geometry_change_reports_reboot_required(dev):
    reboot_and_wait(dev)
    code = """
function setup() {
  clearError();
  println("first=" + ledConfig(0, 4, 1, 16));
  println("second=" + ledConfig(0, 4, 2, 16));
}

function loop() {
  delay(100);
}
""".strip()
    dev.command("script.set", {"code": code, "run": True, "save": False}, timeout=8.0)
    event = dev.wait_event("script.error", timeout=4.0)
    err = event.get("data", {}).get("error", {})
    assert_equal(err.get("phase"), "binding", "geometry error phase")
    assert_equal(err.get("code"), "led_reboot_required", "geometry change should require reboot")
    status = dev.command("status.get", timeout=4.0)
    assert_equal(status.get("led", {}).get("stripCount"), 1, "LED status should remain available")


def test_loop_heavy_led_script_upload_remains_responsive(dev):
    reboot_and_wait(dev)
    code = """
function setup() {
  ledConfig(0, 4, 30, 48);
  println("edge sparkle ready");
}

function loop() {
  var i = 0;
  while (i < 30) {
    ledSet(0, i, random(80), random(80), random(80));
    i = i + 1;
  }
  ledShow();
  delay(60);
}
""".strip()
    ok, result = dev.command_maybe_timeout("script.set", {"code": code, "run": True, "save": False}, timeout=10.0)
    assert_true(ok, "heavy LED script upload should receive a protocol response")
    assert_equal(result.get("state"), "run_pending", "heavy LED script should be accepted for run")
    assert_equal(dev.wait_event("script.print", timeout=4.0).get("data", {}).get("message"), "edge sparkle ready", "setup print")
    assert_true(dev.command("ping", timeout=3.0).get("pong"), "device should respond while LED script runs")


def test_print_flood_does_not_starve_protocol(dev):
    code = """
function setup() {
  println("print flood ready");
}

function loop() {
  var i = 0;
  while (i < 20) {
    print("1");
    i = i + 1;
  }
  delay(1);
}
""".strip()
    result = dev.command("script.set", {"code": code, "run": True, "save": False}, timeout=8.0)
    assert_equal(result.get("state"), "running", "print flood script should start")
    dev.wait_event("script.print", timeout=4.0)
    for _ in range(5):
        ping = dev.command("ping", timeout=2.0)
        assert_equal(ping.get("pong"), True, "ping should respond under print flood")
        status = dev.command("status.get", timeout=2.0)
        assert_true("freeHeap" in status, "status should respond under print flood")


def test_sparkle_animation_example_uploads_and_runs(dev):
    reboot_and_wait(dev)
    path = Path(__file__).resolve().parents[3] / "tools" / "sparkle_30_pin4.wrench"
    code = path.read_text(encoding="utf-8")
    result = dev.command("script.run", {"code": code}, timeout=10.0)
    assert_equal(result.get("state"), "run_pending", "sparkle example should be accepted for run")
    assert_equal(result.get("scriptBytes"), len(code), "sparkle example byte count")
    assert_equal(dev.wait_event("script.print", timeout=4.0).get("data", {}).get("message"), "sparkle celebration ready", "sparkle setup print")
    status = dev.command("status.get", timeout=4.0)
    assert_equal((status.get("led") or {}).get("stripCount"), 1, "sparkle should configure one LED strip")
    strip = ((status.get("led") or {}).get("strips") or [{}])[0]
    assert_equal(strip.get("pin"), 4, "sparkle strip pin")
    assert_equal(strip.get("count"), 30, "sparkle strip count")
    assert_true(dev.command("ping", timeout=3.0).get("pong"), "device should respond while sparkle runs")


def test_weather_wear_example_uploads_and_runs(dev):
    reboot_and_wait(dev)
    path = Path(__file__).resolve().parents[3] / "tools" / "weather_wear_30_pin4.wrench"
    code = path.read_text(encoding="utf-8")
    api_key = os.environ.get("P1_OPENWEATHER_API_KEY", "")
    if api_key:
        code = code.replace("PUT_OPENWEATHER_KEY_HERE", api_key)
    else:
        code = code.replace("var USE_SAMPLE = 0;", "var USE_SAMPLE = 1;")
    result = dev.command("script.run", {"code": code}, timeout=25.0)
    assert_equal(result.get("state"), "run_pending", "weather wear example should be accepted for run")
    assert_equal(result.get("scriptBytes"), len(code), "weather wear example byte count")
    assert_equal(dev.wait_event("script.print", timeout=6.0).get("data", {}).get("message"), "weather wear ready", "weather setup print")
    weather_print = dev.wait_event("script.print", timeout=12.0).get("data", {}).get("message", "")
    assert_true(weather_print.startswith("weather="), "weather script should print parsed weather")
    event = dev.wait_event("weather.wear", timeout=6.0)
    data = event.get("data", {})
    assert_true(data.get("wear"), "weather event should include clothing advice")
    assert_true(data.get("weather"), "weather event should include weather main")
    status = dev.command("status.get", timeout=4.0)
    assert_equal((status.get("led") or {}).get("stripCount"), 1, "weather script should configure one LED strip")
    strip = ((status.get("led") or {}).get("strips") or [{}])[0]
    assert_equal(strip.get("pin"), 4, "weather strip pin")
    assert_equal(strip.get("count"), 30, "weather strip count")
    assert_true(dev.command("ping", timeout=3.0).get("pong"), "device should respond while weather animation runs")
    second = dev.command("script.run", {"code": code}, timeout=25.0)
    assert_equal(second.get("state"), "run_pending", "weather replacement should be accepted while warm")
    assert_equal(second.get("scriptBytes"), len(code), "weather replacement byte count")
    assert_equal(dev.wait_event("script.print", timeout=6.0).get("data", {}).get("message"), "weather wear ready", "weather replacement setup print")
    fetched = dev.command("script.get", timeout=8.0)
    assert_equal(fetched.get("code"), code, "script.get should read large running weather source")
    assert_equal(fetched.get("state"), "running", "weather replacement should be running")
    assert_true(dev.command("ping", timeout=3.0).get("pong"), "device should respond after warm weather replacement")


def test_infinite_wrench_loop_yields_to_protocol_and_stop(dev):
    code = """
function setup() {
  println("infinite ready");
}

function loop() {
  var i = 0;
  while (1) {
    i = i + 1;
  }
}
""".strip()
    result = dev.command("script.set", {"code": code, "run": True, "save": False}, timeout=10.0)
    assert_equal(result.get("state"), "run_pending", "infinite script should be accepted for run")
    assert_equal(dev.wait_event("script.print", timeout=4.0).get("data", {}).get("message"), "infinite ready", "setup print")
    assert_true(dev.command("ping", timeout=3.0).get("pong"), "protocol should respond while infinite Wrench loop runs")
    status = dev.command("status.get", timeout=4.0)
    assert_true(status.get("wrenchLoopCount", 0) > 0, "time-sliced loop should make progress")
    dev.command("script.stop", timeout=4.0)
    status = dev.command("status.get", timeout=4.0)
    assert_equal(status.get("scriptState"), "stopped", "infinite script should stop cleanly")
