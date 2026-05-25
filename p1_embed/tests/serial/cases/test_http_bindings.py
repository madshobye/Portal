from p1_serial import assert_equal, assert_true


def test_http_bad_url_fails_gracefully(dev):
    code = """
function setup() {
  clearError();
  println("body=" + httpGet("ftp://example.local/test"));
  println("code=" + httpCode());
  println("err=" + httpError());
}

function loop() {
  delay(100);
}
""".strip()
    dev.command("script.run", {"code": code}, timeout=8.0)
    assert_equal(dev.wait_event("script.print", timeout=4.0).get("data", {}).get("message"), "body=", "bad URL body should be empty")
    assert_equal(dev.wait_event("script.print", timeout=4.0).get("data", {}).get("message"), "code=0", "bad URL code should be zero")
    assert_equal(dev.wait_event("script.print", timeout=4.0).get("data", {}).get("message"), "err=http_bad_url", "bad URL error should be visible")
    last = dev.command("script.error.get", timeout=4.0)
    assert_equal(last.get("phase"), "binding", "HTTP error phase")
    assert_equal(last.get("code"), "http_bad_url", "HTTP error code")
    assert_true(dev.command("ping", timeout=3.0).get("pong"), "device should respond after HTTP binding error")


def test_http_status_binding_is_available(dev):
    code = """
function setup() {
  println("http=" + httpStatus());
}

function loop() {
  delay(100);
}
""".strip()
    dev.command("script.run", {"code": code}, timeout=8.0)
    msg = dev.wait_event("script.print", timeout=4.0).get("data", {}).get("message")
    assert_true("maxResponseBytes" in msg, "HTTP status should expose response limit")
