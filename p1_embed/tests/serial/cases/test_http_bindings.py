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
    assert_true(dev.command("ping", timeout=3.0).get("pong"), "device should respond after HTTP binding error")


def test_http_scalar_bindings_are_available(dev):
    code = """
function setup() {
  println("code=" + httpCode());
  println("truncated=" + httpTruncated());
  println("error=" + httpError());
}

function loop() {
  delay(100);
}
""".strip()
    dev.command("script.run", {"code": code}, timeout=8.0)
    seen = []
    for _ in range(3):
        seen.append(dev.wait_event("script.print", timeout=4.0).get("data", {}).get("message", ""))
    joined = "\n".join(seen)
    assert_true("code=" in joined, "httpCode should be callable")
    assert_true("truncated=" in joined, "httpTruncated should be callable")
    assert_true("error=" in joined, "httpError should be callable")
