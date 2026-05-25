from p1_serial import assert_equal, assert_true


def test_secondary_uart_rejects_transport_uart_and_pins(dev):
    code = """
function setup() {
  clearError();
  println("uart0=" + serialBegin(0, 16, 17, 9600));
  println("pin3=" + serialBegin(1, 3, 17, 9600));
}

function loop() {
  delay(100);
}
""".strip()
    dev.command("script.run", {"code": code}, timeout=8.0)
    assert_equal(dev.wait_event("script.print", timeout=4.0).get("data", {}).get("message"), "uart0=0", "UART0 should be rejected")
    assert_equal(dev.wait_event("script.print", timeout=4.0).get("data", {}).get("message"), "pin3=0", "transport pin should be rejected")
    last = dev.command("script.error.get", timeout=4.0)
    assert_equal(last.get("phase"), "binding", "UART collision error phase")
    assert_equal(last.get("code"), "uart_bad_pins", "transport pin collision error code")
    assert_true(dev.command("ping", timeout=3.0).get("pong"), "main transport should still respond")


def test_secondary_uart_begin_write_status_and_end(dev):
    code = """
function setup() {
  clearError();
  println("begin=" + serialBegin(2, 16, 17, 9600));
  println("write=" + serialWrite(2, "hi"));
  println("available=" + serialAvailable(2));
  println("end=" + serialEnd(2));
}

function loop() {
  delay(100);
}
""".strip()
    dev.command("script.run", {"code": code}, timeout=8.0)
    assert_equal(dev.wait_event("script.print", timeout=4.0).get("data", {}).get("message"), "begin=1", "UART2 should begin on safe pins")
    assert_equal(dev.wait_event("script.print", timeout=4.0).get("data", {}).get("message"), "write=2", "UART2 should write bytes")
    available = dev.wait_event("script.print", timeout=4.0).get("data", {}).get("message")
    assert_true(available.startswith("available="), "UART2 should report availability without blocking")
    assert_equal(dev.wait_event("script.print", timeout=4.0).get("data", {}).get("message"), "end=1", "UART2 should end cleanly")
    assert_true(dev.command("ping", timeout=3.0).get("pong"), "main transport should still respond after UART2 use")
