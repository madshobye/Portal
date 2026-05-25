from p1_serial import assert_equal, assert_true


def test_compile_error(dev):
    bad_code = 'function setup() {\n  println("oops")\n'
    error = dev.command_error("script.set", {"code": bad_code, "run": True, "save": False})
    assert_equal(error.get("code"), "compile_error", "script.set should fail with compile_error")
    last = dev.command("script.error.get")
    assert_equal(last.get("phase"), "compile", "last error phase")
    assert_equal(last.get("code"), "compile_error", "last error code")
    assert_true("wrenchErrorName" in last, "last error should include wrench name")


def test_binding_last_error(dev):
    code = """
function setup() {
  clearError();
  println("badPin=" + analogWrite(39, 20));
  println("lastError=" + lastError());
}

function loop() {
  delay(100);
}
""".strip()
    dev.command("script.set", {"code": code, "run": True, "save": False})
    event = dev.wait_event("script.error", timeout=4.0)
    err = event.get("data", {}).get("error", {})
    assert_equal(err.get("phase"), "binding", "binding phase")
    assert_equal(err.get("code"), "analog_write_failed", "binding code")
    last = dev.command("script.error.get")
    assert_equal(last.get("code"), "analog_write_failed", "last error should persist")
