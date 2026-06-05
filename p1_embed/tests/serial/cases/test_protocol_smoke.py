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
    runtime = data.get("wrenchRuntime") or {}
    assert_true(runtime.get("phase"), "status should include wrench runtime phase")
    assert_true("transitionActive" in runtime, "status should include transition state")
    assert_true("transitionRecoveries" in runtime, "status should include transition recovery count")
    assert_true("compileSourceBuffer" in runtime, "status should include compile source buffer")
    assert_true("lastCompileAlloc" in runtime, "status should include compile allocation stats")
    assert_true("allocs" in (runtime.get("lastCompileAlloc") or {}), "allocation stats should include alloc count")

    full = dev.command("status.full")
    assert_true("uart" in full, "full status should include uart")
    assert_true("http" in full, "full status should include http")
    full_runtime = full.get("wrenchRuntime") or {}
    assert_true("compileSourceBuffer" in full_runtime, "full status should include compile source buffer")

    live = dev.command("status.live")
    assert_true("freeHeap" in live, "live status should include heap")
    assert_true("wifi" in live, "live status should include wifi")
    assert_true("uart" not in live, "live status should omit static uart diagnostics")
    assert_true("http" not in live, "live status should omit static http diagnostics")


def test_config_set_uses_shared_frame_path(dev):
    before = dev.command("config.get")
    original_name = before.get("scriptName") or ""
    smoke_name = "serial-config-frame-smoke"
    try:
        data = dev.command("config.set", {"scriptName": smoke_name})
        assert_equal(data.get("scriptName"), smoke_name, "config.set should update script name")
    finally:
        dev.command("config.set", {"scriptName": original_name})


def test_script_chunk_get_includes_metadata(dev):
    before = dev.command("config.get")
    original_name = before.get("scriptName") or ""
    chunk_name = "serial-chunk-metadata-smoke"
    try:
        dev.command("config.set", {"scriptName": chunk_name})
        data = dev.command("script.chunk.get", {"offset": 0, "maxBytes": 64})
        assert_equal(data.get("scriptName"), chunk_name, "script.chunk.get should include script name")
        assert_true("revisionId" in data, "script.chunk.get should include revision id")
    finally:
        dev.command("config.set", {"scriptName": original_name})
