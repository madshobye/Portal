from p1_serial import assert_equal, assert_true


def test_ping(dev):
    data = dev.command("ping")
    assert_equal(data.get("pong"), True, "ping should return pong")


def test_system_info(dev):
    data = dev.command("system.info")
    assert_equal(data.get("firmwareName"), "p1_embed", "firmware name")
    assert_true(data.get("firmwareVersion"), "firmware version should be present")
    assert_true("wrench.bindings.pwm_servo_fan" in data.get("capabilities", []), "capability should be present")


def test_status(dev):
    data = dev.command("status.get")
    assert_true("freeHeap" in data, "status should include heap")
    assert_true("lastError" in data, "status should include lastError")
    assert_true("uart" in data, "status should include uart")
    assert_true("http" in data, "status should include http")
    runtime = data.get("wrenchRuntime") or {}
    assert_true(runtime.get("phase"), "status should include wrench runtime phase")
    assert_true("transitionActive" in runtime, "status should include transition state")
    assert_true("transitionRecoveries" in runtime, "status should include transition recovery count")
