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
    finally:
        if entered:
            dev.set_protocol("json")
