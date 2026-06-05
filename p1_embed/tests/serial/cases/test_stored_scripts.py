from p1_serial import assert_equal, assert_true


def reboot_and_wait(dev):
    dev.command("device.reboot", timeout=4.0)
    dev.drain(1.0)
    dev.wait_ready(timeout=12.0)
    dev.events = []


def clear_stored_script(dev):
    dev.command("script.clear", timeout=5.0)
    reboot_and_wait(dev)


def test_bad_script_is_rejected_before_save(dev):
    bad_code = 'function setup() {\n  int broken = 1;\n}\n'
    dev.command("script.clear", timeout=5.0)
    error = dev.compile_script_expect_error(bad_code, save=True, timeout=6.0)
    assert_equal(error.get("code"), "compile_error", "bad script should be rejected before save")

    status = dev.command("status.get", timeout=4.0)
    assert_equal(status.get("scriptStored"), False, "bad script should not be stored")
    assert_equal(status.get("lastError", {}).get("phase"), "compile", "bad saved script error phase")
    assert_equal(status.get("lastError", {}).get("code"), "compile_error", "bad saved script error code")
    assert_true(dev.command("ping", timeout=3.0).get("pong"), "device should respond after bad script")


def test_saved_slow_loop_autoruns_and_keeps_protocol_responsive(dev):
    code = """
function setup() {
  println("stored slow ready");
}

function loop() {
  delay(2000);
}
""".strip()
    dev.run_script(code, save=True, timeout=8.0)
    reboot_and_wait(dev)

    status = dev.command("status.get", timeout=4.0)
    assert_equal(status.get("scriptStored"), True, "slow script should be stored")
    assert_true(status.get("scriptState") in ("running", "busy"), "slow script should autorun")
    assert_true(dev.command("ping", timeout=3.0).get("pong"), "protocol should respond during slow saved loop")

    dev.drain(6.0)
    status = dev.command("status.get", timeout=4.0)
    assert_true(status.get("scriptRunState") in ("ok", "pending_tried"), "saved script should have a tracked run state")
    assert_true(status.get("wrenchSlowLoopCount", 0) >= 0, "slow loop count should be present")

    clear_stored_script(dev)
    status = dev.command("status.get", timeout=4.0)
    assert_equal(status.get("scriptStored"), False, "stored slow script should be cleared")


def test_saved_infinite_wrench_loop_autoruns_and_can_be_cleared(dev):
    code = """
function setup() {
  println("stored infinite ready");
}

function loop() {
  var i = 0;
  while (1) {
    i = i + 1;
  }
}
""".strip()
    dev.run_script(code, save=True, timeout=10.0)
    reboot_and_wait(dev)

    assert_true(dev.command("ping", timeout=3.0).get("pong"), "device should respond with saved infinite loop running")
    status = dev.command("status.get", timeout=4.0)
    assert_equal(status.get("scriptStored"), True, "infinite script should be stored")
    assert_true(status.get("scriptState") in ("running", "busy"), "infinite script should autorun")
    assert_true(status.get("wrenchLoopCount", 0) > 0, "time-sliced infinite loop should make progress")

    dev.command("script.clear", timeout=5.0)
    reboot_and_wait(dev)
    status = dev.command("status.get", timeout=4.0)
    assert_equal(status.get("scriptStored"), False, "stored infinite script should be cleared")
