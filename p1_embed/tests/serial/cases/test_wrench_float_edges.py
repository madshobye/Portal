from p1_serial import assert_equal, assert_true


def run_script_and_expect_print(dev, code, expected, timeout=10.0):
    result = dev.command("script.set", {"code": code.strip(), "run": True, "save": False}, timeout=timeout)
    assert_true(result.get("state") in ("queued", "running", "run_pending"), "script should be accepted")
    event = dev.wait_event("script.print", timeout=5.0)
    assert_equal(event.get("data", {}).get("message"), expected, "script print")
    last = dev.command("script.error.get", timeout=4.0)
    assert_equal(last.get("hasError"), False, "script should not leave an error")


def test_float_literals_in_if_and_arithmetic_compile_on_board(dev):
    code = """
function setup() {
  var i = 2;
  var t = 0.0;
  var wander = 0.0;
  t = 10 * 0.00018 + i * 19.73;
  wander = simplex3(t, i * 0.31, 0.64);
  if (wander < 2.0) {
    println("float expr ok");
  }
}

function loop() {
  delay(50);
}
"""
    run_script_and_expect_print(dev, code, "float expr ok")


def test_float_array_globals_compile_on_board(dev):
    code = """
var flyPos[] = { 13.0, 39.0, 68.0, 101.0, 126.0 };
var flyVel[] = { 0.46, -0.32, 0.28, -0.44, 0.36 };

function setup() {
  var first = 0.0;
  first = flyPos[0] + flyVel[1];
  if (first > 12.0) {
    println("float arrays ok");
  }
}

function loop() {
  delay(50);
}
"""
    run_script_and_expect_print(dev, code, "float arrays ok")


def test_repeated_float_compile_does_not_decay_into_syntax_error(dev):
    code = """
var phase = 0.0;

function setup() {
  var i = 0;
  var sum = 0.0;
  while (i < 8) {
    phase = phase + 0.31;
    sum = sum + simplex3(phase, i * 0.31, 0.64);
    i = i + 1;
  }
  if (sum < 99.0) {
    println("float repeat ok");
  }
}

function loop() {
  delay(50);
}
"""
    for _ in range(4):
        run_script_and_expect_print(dev, code, "float repeat ok")


def test_large_float_script_compiles_without_misleading_syntax_error(dev):
    code = """
var powerPin = 18;
var ledPin = 16;
var stripCount = 144;
var stripBrightness = 90;
var fireflyCount = 5;
var frameDelayMs = 33;
var lastFrameAt = 0;

var baseHue = 52;
var hueSpread = 12;
var minTail = 2;
var maxTail = 10;
var tailSpeedScale = 3.1;

var motionScale = 0.00018;
var wanderSpeed = 1.18;
var inertia = 0.86;
var maxSpeed = 2.15;

var attractDistance = 17.0;
var attractStrength = 0.82;
var attractThreshold = 0.58;
var attractGateScale = 0.00042;

var flyPos[] = { 13.0, 39.0, 68.0, 101.0, 126.0 };
var flyVel[] = { 0.46, -0.32, 0.28, -0.44, 0.36 };

function setup() {
  var now = 0;
  var i = 0;
  var j = 0;
  var t = 0.0;
  var wander = 0.0;
  var targetVel = 0.0;
  var pull = 0.0;
  var hold = 0.0;
  var delta = 0.0;
  var distance = 0.0;
  var closeness = 0.0;
  var gate = 0.0;
  var attractAmount = 0.0;
  now = millis();
  while (i < fireflyCount) {
    t = now * motionScale + i * 19.73;
    wander = simplex3(t, i * 0.31, 0.64);
    targetVel = wander * wanderSpeed;
    pull = 0.0;
    hold = 0.0;
    j = 0;
    while (j < fireflyCount) {
      if (i != j) {
        delta = flyPos[j] - flyPos[i];
        distance = delta;
        if (distance < 0) distance = 0.0 - distance;
        if (distance > 0.1 && distance < attractDistance) {
          gate = simplex3_01(now * attractGateScale + i * 1.7, j * 2.3, 4.4);
          if (gate > attractThreshold) {
            closeness = 1.0 - (distance / attractDistance);
            attractAmount = (gate - attractThreshold) / (1.0 - attractThreshold);
            attractAmount = attractAmount * closeness * attractStrength;
            hold = hold + (attractAmount * 0.22);
            if (delta > 0) pull = pull + attractAmount;
            if (delta < 0) pull = pull - attractAmount;
          }
        }
      }
      j = j + 1;
    }
    if (hold > 0.34) hold = 0.34;
    flyVel[i] = (flyVel[i] * inertia) + (((targetVel * (1.0 - hold)) + pull) * (1.0 - inertia));
    i = i + 1;
  }
  println("large float ok");
}

function loop() {
  delay(50);
}
"""
    run_script_and_expect_print(dev, code, "large float ok", timeout=14.0)
