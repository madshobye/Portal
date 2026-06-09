export const EXAMPLES_PROJECT_ID = "xobit-examples";

export function isExamplesProject(project = {}) {
  return Boolean(project?.isExampleProject || project?.id === EXAMPLES_PROJECT_ID);
}

export function createExamplesProject({ buildRevision, normalizeProjectRecord } = {}) {
  const revisions = exampleSketches.map((example, index) => buildRevision({
    id: `xobit-example-${String(index + 1).padStart(2, "0")}`,
    name: example.name,
    code: example.code.trim(),
    specification: example.specification.trim(),
    specificationMode: "middle",
    source: "example",
    createdAt: "2026-06-10T00:00:00.000Z",
    chat: [],
    exampleProjectName: example.projectName || example.name,
  }));
  return normalizeProjectRecord({
    id: EXAMPLES_PROJECT_ID,
    name: "Examples",
    isExampleProject: true,
    specialLabel: "examples",
    createdAt: "2026-06-10T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
    activeRevisionId: revisions[0]?.id || "",
    revisions,
  });
}

const exampleSketches = [
  {
    name: "Basics Start Here Blink",
    specification: `
Base sketch: blink one output slowly so the upload and runtime are easy to verify.
Uses GPIO 2 as a simple output and leaves a short pause in loop.
    `,
    code: `
var ledPin = 2;

function setup() {
  pinMode(ledPin, OUTPUT);
  println("hello xobit");
}

function loop() {
  digitalWrite(ledPin, HIGH);
  delay(250);
  digitalWrite(ledPin, LOW);
  delay(750);
}
    `,
  },
  {
    name: "Inputs Button Toggle Led",
    specification: `
Read a push button on GPIO 0 with INPUT_PULLUP and toggle an LED on GPIO 2.
The code watches for a clean press edge and prints the new state.
    `,
    code: `
var buttonPin = 0;
var ledPin = 2;
var ledOn = 0;
var lastButton = HIGH;

function setup() {
  pinMode(buttonPin, INPUT_PULLUP);
  pinMode(ledPin, OUTPUT);
}

function loop() {
  var button = digitalRead(buttonPin);
  if (lastButton == HIGH && button == LOW) {
    ledOn = 1 - ledOn;
    if (ledOn) digitalWrite(ledPin, HIGH);
    else digitalWrite(ledPin, LOW);
    print("led=");
    println(ledOn);
  }
  lastButton = button;
  delay(20);
}
    `,
  },
  {
    name: "Inputs Analog Meter",
    specification: `
Read an analog sensor or knob on GPIO 34 and map it to a percentage.
Only print when the value changes enough to be useful.
    `,
    code: `
var sensorPin = 34;
var lastPercent = -1;

function setup() {
  println("analog meter ready");
}

function loop() {
  var raw = analogRead(sensorPin);
  var percent = map(raw, 0, 4095, 0, 100);
  percent = constrain(percent, 0, 100);
  if (abs(percent - lastPercent) >= 2) {
    lastPercent = percent;
    print("sensor=");
    println(percent);
  }
  delay(50);
}
    `,
  },
  {
    name: "Actuator PWM Fade",
    specification: `
Fade a single PWM output on GPIO 18 up and down.
This is a useful template for dimming, small motors, and simple analog-style output.
    `,
    code: `
var pwmPin = 18;
var value = 0;
var step = 4;

function setup() {
  analogWriteResolution(8);
  analogWriteFrequency(pwmPin, 1000);
}

function loop() {
  analogWrite(pwmPin, value);
  value = value + step;
  if (value >= 255 || value <= 0) {
    step = -step;
  }
  delay(20);
}
    `,
  },
  {
    name: "Actuator Servo Sweep",
    specification: `
Move a servo on GPIO 18 through a slow sweep.
Use an external supply for real servos and keep grounds connected.
    `,
    code: `
var servoPin = 18;
var angle = 20;
var step = 2;

function setup() {
  servoAttach(servoPin, 500, 2500);
}

function loop() {
  servoWrite(servoPin, angle);
  angle = angle + step;
  if (angle >= 160 || angle <= 20) {
    step = -step;
  }
  delay(25);
}
    `,
  },
  {
    name: "Light NeoPixel Minimal",
    specification: `
Configure a small NeoPixel strip on GPIO 16 and light the first pixel.
This is the smallest LED strip template.
    `,
    code: `
var strip = 0;
var ledPin = 16;
var ledCountValue = 8;

function setup() {
  ledConfig(strip, ledPin, ledCountValue, 50);
  ledClear(strip, 0);
  ledSet(strip, 0, 255, 60, 0);
  ledShow();
}

function loop() {
  delay(100);
}
    `,
  },
  {
    name: "Light NeoPixel Chase",
    specification: `
Move one bright pixel through a strip.
The sketch uses ledCount so it adapts when the strip length changes.
    `,
    code: `
var strip = 0;
var pos = 0;
var ledPin = 16;
var ledCountValue = 24;

function setup() {
  ledConfig(strip, ledPin, ledCountValue, 60);
}

function loop() {
  ledClear(strip, 0);
  ledSet(strip, pos, 0, 120, 255);
  ledShow();
  pos = (pos + 1) % ledCount(strip);
  delay(35);
}
    `,
  },
  {
    name: "Light Mood Controls",
    specification: `
Create a browser UI for brightness and speed, then draw a soft moving color wash.
The specification is the source of truth: editable live controls should shape the animation.
    `,
    code: `
var strip = 0;
var ledPin = 16;
var ledCountValue = 48;
var hue = 0;
var lastFrameAt = 0;

function drawUi() {
  uiBegin("Mood Strip");
  uiColor(30, 120, 255);
  uiSlider("brightness", "Brightness", 45, 0, 100);
  uiSlider("speed", "Speed", 25, 1, 100);
  uiToggle("enabled", "Enabled", 1);
}

function setup() {
  ledConfig(strip, ledPin, ledCountValue, 70);
  paletteSet3(0, 20, 0, 160, 0, 180, 255, 255, 120, 20);
  drawUi();
}

function loop() {
  while (uiPoll()) {
    if (uiEventIs("hello")) drawUi();
  }
  var enabled = uiGet("enabled", 1);
  var brightness = uiGet("brightness", 45);
  var speed = uiGet("speed", 25);
  if (!enabled) {
    ledClear(strip, 1);
    delay(30);
    return;
  }
  if ((millis() - lastFrameAt) < max(10, 90 - speed)) {
    delay(5);
    return;
  }
  lastFrameAt = millis();
  ledBrightness(strip, map(brightness, 0, 100, 0, 120));
  var rgb[] = { 0, 0, 0 };
  var i = 0;
  while (i < ledCount(strip)) {
    paletteGetRgb(0, (i * 255 / ledCount(strip) + hue) % 255, rgb);
    ledSetRgb(strip, i, rgb);
    i = i + 1;
  }
  ledShow();
  hue = (hue + 1) % 255;
}
    `,
  },
  {
    name: "Light Fireflies",
    specification: `
Draw an elegant low-power animation with random fireflies fading across the strip.
UI sliders control brightness and density.
    `,
    code: `
var strip = 0;
var ledPin = 16;
var ledCountValue = 60;
var glow[] = { 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 };

function drawUi() {
  uiBegin("Fireflies");
  uiSlider("brightness", "Brightness", 40, 0, 100);
  uiSlider("density", "Density", 12, 1, 50);
}

function setup() {
  ledConfig(strip, ledPin, ledCountValue, 60);
  randomSeed(42);
  drawUi();
}

function loop() {
  while (uiPoll()) {
    if (uiEventIs("hello")) drawUi();
  }
  var brightness = uiGet("brightness", 40);
  var density = uiGet("density", 12);
  ledBrightness(strip, map(brightness, 0, 100, 0, 130));
  var i = 0;
  while (i < ledCount(strip)) {
    glow[i] = max(0, glow[i] - 5);
    ledSet(strip, i, glow[i], glow[i] / 2, 0);
    i = i + 1;
  }
  if (random(0, 100) < density) {
    glow[random(0, ledCount(strip))] = random(120, 255);
  }
  ledShow();
  delay(35);
}
    `,
  },
  {
    name: "Environment Sun Clock",
    specification: `
Use local time and sun position to make a daylight-aware strip.
The first pixel shows the current hour and brightness follows sun brightness.
    `,
    code: `
var strip = 0;
var ledPin = 16;
var ledCountValue = 24;
var timeParts[] = { 0, 0, 0, 0, 0, 0 };
var sun[] = { 0, 0, 0, 0 };

function setup() {
  ledConfig(strip, ledPin, ledCountValue, 70);
}

function loop() {
  timeLocal(timeParts);
  sunLocal(55.652116, 12.610874, timeNow(), sun);
  ledClear(strip, 0);
  if (timeParts[3] >= 0) {
    var hour = timeParts[3] % ledCount(strip);
    var brightness = constrain(sun[2], 10, 120);
    ledBrightness(strip, brightness);
    ledSetHsv(strip, hour, map(timeParts[4], 0, 59, 0, 255), 200, 255);
  }
  ledShow();
  delay(1000);
}
    `,
  },
  {
    name: "Controls Browser Basics",
    specification: `
Create a small browser UI with a toggle, slider, button, and live value.
This example is useful before connecting UI controls to hardware.
    `,
    code: `
var count = 0;
var brightness = 50;
var enabled = 1;

function drawUi() {
  uiBegin("UI Basics");
  uiToggle("enabled", "Enabled", enabled);
  uiSlider("brightness", "Brightness", brightness, 0, 100);
  uiButton("mark", "Mark");
  uiValue("count", "Marks", count, 0, 20);
}

function setup() {
  drawUi();
}

function loop() {
  while (uiPoll()) {
    if (uiEventIs("hello")) drawUi();
    if (uiEventIs("press", "mark")) {
      count = count + 1;
      uiUpdate("count", count);
    }
  }
  brightness = uiGet("brightness", brightness);
  enabled = uiGet("enabled", enabled);
  delay(20);
}
    `,
  },
  {
    name: "Controls Sensor Dashboard",
    specification: `
Read an analog value and stream it to the browser as a value and graph.
Use this as a starting point for knobs, light sensors, and simple analog modules.
    `,
    code: `
var sensorPin = 34;
var lastAt = 0;

function drawUi() {
  uiBegin("Sensor");
  uiValue("raw", "Raw", 0, 0, 4095);
  uiGraph("trend", "Trend", 0, 0, 4095);
}

function setup() {
  drawUi();
}

function loop() {
  while (uiPoll()) {
    if (uiEventIs("hello")) drawUi();
  }
  if ((millis() - lastAt) >= 100) {
    lastAt = millis();
    var raw = analogRead(sensorPin);
    uiUpdate("raw", raw);
    uiPush("trend", raw);
  }
  delay(5);
}
    `,
  },
  {
    name: "Home Assistant Lamp",
    specification: `
Expose one lamp brightness control to Home Assistant and mirror it on a NeoPixel strip.
Home Assistant becomes another way to control the same live object.
    `,
    code: `
var strip = 0;
var ledPin = 16;
var brightness = 40;

function setup() {
  ledConfig(strip, ledPin, 16, 60);
  haBegin("Example Lamp");
  haLight("lamp", "Example Lamp", brightness);
}

function loop() {
  if (haChanged("lamp")) {
    brightness = haGet("lamp");
  }
  ledBrightness(strip, map(brightness, 0, 100, 0, 120));
  ledFill(strip, 255, 180, 80);
  ledShow();
  haSet("lamp", brightness);
  delay(50);
}
    `,
  },
  {
    name: "Online Weather Console",
    specification: `
Fetch a small JSON weather response and print the temperature.
Replace the URL with a real endpoint when building a connected project.
    `,
    code: `
var url = "https://api.example.com/weather.json";
var lastFetchAt = 0;

function setup() {
  println("weather console");
}

function loop() {
  if (wifiConnected() && (millis() - lastFetchAt) > 60000) {
    lastFetchAt = millis();
    var code = fetchJson(url, 4096, 6000);
    if (code == 200) {
      print("temp=");
      println(getJsonFloat("main.temp"));
    } else {
      print("http error=");
      println(httpError());
    }
  }
  delay(100);
}
    `,
  },
  {
    name: "External Module Serial Echo",
    specification: `
Open UART1 and echo short lines from an attached serial module into the browser console.
UART0 is reserved for the host connection, so this uses GPIO 16 and 17.
    `,
    code: `
function setup() {
  serialBegin(1, 16, 17, 9600);
  println("uart1 echo ready");
}

function loop() {
  if (serialAvailable(1)) {
    println(serialReadString(1, 80));
  }
  delay(10);
}
    `,
  },
  {
    name: "Messages Command Lamp",
    specification: `
Read text commands sent from the host inbox.
The commands on, off, and pulse control a simple LED output.
    `,
    code: `
var ledPin = 2;

function setup() {
  pinMode(ledPin, OUTPUT);
  inboxClear();
}

function loop() {
  if (inboxAvailable()) {
    var command = inboxRead();
    if (command == "on") digitalWrite(ledPin, HIGH);
    if (command == "off") digitalWrite(ledPin, LOW);
    if (command == "pulse") {
      digitalWrite(ledPin, HIGH);
      delay(120);
      digitalWrite(ledPin, LOW);
    }
  }
  delay(10);
}
    `,
  },
];
