from p1_serial import assert_equal


def test_empty_strings_do_not_report_malloc_failed(dev):
    code = """
var globalEmpty = "";

function setup() {
  println("");
  var localEmpty = "";
  if (globalEmpty == localEmpty) println("empty compare ok");
  uiUpdate("", 1);
}

function loop() {
  delay(20);
}
""".strip()
    dev.run_script(code, save=False, timeout=8.0)
    event = dev.wait_event("script.print", lambda msg: (msg.get("data") or {}).get("message") == "empty compare ok", timeout=4.0)
    assert_equal((event.get("data") or {}).get("message"), "empty compare ok", "empty strings should compare")
    error = dev.command("script.error.get", timeout=4.0)
    assert_equal(error.get("hasError"), False, "empty strings should not trip malloc_failed")


def test_ui_event_is_allows_empty_id_match(dev):
    code = """
function setup() {
  uiBegin("Empty Id");
  uiButton("go", "Go");
  println("ready");
}

function loop() {
  while (uiPoll()) {
    if (uiEventIs("hello", "")) println("hello");
    if (uiEventIs("press", "go")) println("press");
  }
  delay(20);
}
""".strip()
    dev.run_script(code, save=False, timeout=8.0)
    dev.wait_event("script.print", lambda msg: (msg.get("data") or {}).get("message") == "ready", timeout=4.0)
    dev.command("script.input", {"channel": "ui.go", "message": "press"}, timeout=4.0)
    event = dev.wait_event("script.print", lambda msg: (msg.get("data") or {}).get("message") == "press", timeout=4.0)
    assert_equal((event.get("data") or {}).get("message"), "press", "button press should be handled")
    error = dev.command("script.error.get", timeout=4.0)
    assert_equal(error.get("hasError"), False, "uiEventIs with empty id should not trip malloc_failed")
