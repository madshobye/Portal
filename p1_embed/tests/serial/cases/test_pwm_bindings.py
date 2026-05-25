from p1_serial import assert_true


def run_script_and_collect_prints(dev, code, count):
    dev.command("script.set", {"code": code.strip(), "run": True, "save": False})
    values = []
    for _ in range(count):
      values.append(dev.wait_event("script.print", timeout=4.0).get("data", {}).get("message", ""))
    return "\n".join(values)


def test_analog_pwm_smoke(dev):
    code = """
function setup() {
  println("analogWrite=" + analogWrite(2, 64));
  println("pwmDetach=" + pwmDetach(2));
}

function loop() {
  delay(100);
}
""".strip()
    joined = run_script_and_collect_prints(dev, code, 2)
    assert_true("analogWrite=1" in joined, "analogWrite should pass")


def test_servo_pwm_smoke(dev):
    code = """
function setup() {
  println("servoAttach=" + servoAttach(2));
  println("servoWrite=" + servoWrite(2, 90));
  println("servoDetach=" + servoDetach(2));
}

function loop() {
  delay(100);
}
""".strip()
    joined = run_script_and_collect_prints(dev, code, 3)
    assert_true("servoWrite=1" in joined, "servoWrite should pass")


def test_fan_pwm_smoke(dev):
    code = """
function setup() {
  println("fanAttach=" + fanAttach(2));
  println("fanWrite=" + fanWrite(2, 40));
  println("fanRaw=" + fanWriteRaw(2, 512));
  println("fanDetach=" + fanDetach(2));
}

function loop() {
  delay(100);
}
""".strip()
    joined = run_script_and_collect_prints(dev, code, 4)
    assert_true("fanWrite=1" in joined, "fanWrite should pass")
