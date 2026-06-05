from p1_serial import assert_equal, assert_true


def test_serial_msgpack_mode_ping_and_status(dev):
    entered = False
    try:
        mode = dev.set_protocol("msgpack")
        entered = True
        assert_equal(mode.get("mode"), "msgpack", "serial should enter msgpack mode")
        assert_equal(mode.get("framing"), "p1mp.u16be", "serial msgpack framing")

        ping = dev.command("ping", timeout=4.0)
        assert_equal(ping.get("pong"), True, "msgpack serial ping should return pong")

        status = dev.command("status.live", timeout=4.0)
        assert_true("freeHeap" in status, "msgpack serial status.live should include heap")
        assert_true("wifi" in status, "msgpack serial status.live should include wifi")

        code = """
function setup() {
  println("msgpack chunk upload ready");
}

function loop() {
  delay(100);
}
""".strip()
        result = dev.run_script(code, save=False, timeout=10.0)
        assert_true(result.get("state") in ("run_pending", "running"), "msgpack chunk upload should run")
        event = dev.wait_event("script.print", timeout=4.0)
        assert_equal(event.get("data", {}).get("message"), "msgpack chunk upload ready", "msgpack upload setup print")
        fetched = dev.download_script_source_with_metadata()
        assert_equal(fetched.get("code"), code, "msgpack chunk download should return uploaded source")
    finally:
        if entered:
            dev.set_protocol("json")
