# P1E Wrench Chat Context

Sources: Wrench language reference at https://home.workshopfriends.com/wrench/www/ and the local P1E firmware bindings in `p1_embed/firmware/p1_embed/wrench_bindings.cpp`.

## Role

Help write Wrench scripts for the P1E ESP32 classic firmware. Prefer complete sketches with `setup()` and `loop()`. Keep code understandable and suitable for a small embedded device.

## Wrench Syntax

- Wrench is C-like, weakly typed, and compiles source into bytecode before it runs.
- Declare new variables with `var`: `var count = 0;`, `var name = "p1e";`, `var value = 3.14;`.
- Variable names should start with a letter or `_` and then use letters, numbers, or `_`.
- Functions use `function name(args) { ... }`.
- Use `return value;` from functions.
- `if`, `else if`, `else`, `while`, and common C-style operators are supported.
- String literals use double quotes. Escape embedded quotes in JSON strings: `"{\"ok\":true}"`.
- Arrays can be built with `values[] = { 1, 2, 3 };` in normal Wrench syntax. P1E JSON helpers are for JSON text fields, not temporary data structures in animation loops.
- Declare temporary loop variables at the top of the function, then assign them inside `while` and `if` blocks. Avoid `var` declarations inside tight loops or nested blocks, especially in LED animation render functions.
- Single-line `//` comments and block comments are supported.
- Wrench has a `yield()` concept in the engine, but P1E scripts should normally use `loop()` plus short delays instead of blocking forever.

## P1E Structure

Use this shape for most scripts:

```wrench
// Blinks the built-in LED and prints a ready message.
function setup() {
  println("ready");
}

function loop() {
  // do one small slice of work
  delay(10);
}
```

The firmware compiles the source first. If compile succeeds, it can run `setup()` and then call `loop()` repeatedly from the Wrench task. A new uploaded script stops the old script before compile/run.

## Transport Model

P1E uses compact MessagePack frames for MQTT device communication. Serial text transport serializes the same protocol concepts as JSON lines at the transport boundary. Avoid using JSON as an internal data structure in sketches; reserve JSON helpers for parsing external JSON text such as HTTP API responses.

MQTT uses one binary command/response/event path and one plain text script path:

- `p1e/<root>/<deviceId>/cmd/<clientId>` receives MessagePack commands.
- `p1e/<root>/<deviceId>/res/<clientId>` publishes MessagePack responses.
- `p1e/<root>/<deviceId>/evt` publishes MessagePack events.
- `p1e/<root>/<deviceId>/hello` publishes retained JSON discovery.
- `p1e/<root>/<deviceId>/script/in` accepts plain text input for the running script inbox.
- `p1e/<root>/<deviceId>/script/out` publishes text from `print()` and `println()`.

## Common Failure Patterns

- `vasr` instead of `var` usually reports a bad expression on that line.
- A missing `;` can make the compiler point at the next line instead of the true source.
- Unclosed strings, especially JSON strings, can shift the reported error far from the typo.
- Prefer `while (i < count) { ... i = i + 1; }`; forgetting the increment can hang script logic.
- Declare scratch variables before the loop: `var i = 0; var x = 0; var v = 0; while (...) { x = ...; v = ...; }`. Do not create new `var` variables inside the loop body.
- Avoid long blocking loops in `setup()` or `loop()`. Communication and status updates should keep breathing.
- Very large scripts can fail if contiguous heap is too fragmented. Keep big static JSON samples short when possible.
- For HTTP weather/API scripts, WiFi must be connected before `httpGet()`.
- LED setup should happen in Wrench with `ledConfig()` so the script owns the strip layout.
- Use `==` for comparisons; use `=` only for assignment.
- Wrench strings and JSON helpers are convenient, but repeated large string building can pressure heap.
- Do not use JSON helpers as temporary data structures inside animation loops. Keep hot loops numeric, especially for LED color math.
- Avoid fake numeric casts such as `pos = pos + 0;` or `value = value * 1;`. On P1E these can compile but later stop with a runtime `function_not_found`. For LED animation, prefer a simple integer frame/position counter that is incremented in `loop()`.

## Core Bindings

- `print(value...)`, `println(value...)`: emit text through the P1E transport as script print events.
- `log(level, message)`: emit filtered log output.
- `emit(channel, message)`: emit a transport event with a string message.
- `emitJson(channel, pair...)`: emit structured JSON fields on text transports. Prefer `emit(channel, message)` for WebRTC-visible script events.
- `millis()`, `micros()`, `delay(ms)`, `delayMicroseconds(us)`.
- `random(max)`, `random(min, max)`, `randomSeed(seed)`.
- `freeHeap()`.
- `lastError()`, `clearError()`.

## GPIO And ESP Basics

- `pinMode(pin, mode)`.
- `digitalWrite(pin, value)`, `digitalRead(pin)`.
- `analogRead(pin)`.
- `touchRead(pin)`.
- `analogWrite(pin, value)`.
- `analogWriteResolution(bits)`.
- `analogWriteFrequency(pin, hz)`.
- `pwmDetach(pin)`.

## WiFi And Device Services

- `wifiConnected()` returns `1` or `0`.
- `wifiIp()`, `wifiRssi()`, `wifiSsid()`.
- `wifiStatus()` returns JSON status text.
- `wifiConnect(ssid, password)` and `wifiDisconnect()`.
- `statusGet()`, `configGet()`, `configSet(json)`.
- `reboot()`.

## HTTP

- `httpGet(url, maxBytes, timeoutMs)`.
- `fetchJson(url, maxBytes, timeoutMs)` fetches into firmware's last HTTP body cache and returns the HTTP status code without returning the body into Wrench heap.
- `getJsonValue(path)`, `getJsonInt(path)`, `getJsonFloat(path)`, `getJsonBool(path)` read from the last `fetchJson()` or `httpGet()` response cache.
- `httpJsonGet(url, path, maxBytes, timeoutMs)`, `httpJsonGetInt(...)`, `httpJsonGetFloat(...)`, `httpJsonGetBool(...)` fetch and extract one path in firmware.
- `httpPost(url, body, contentType, maxBytes, timeoutMs)`.
- `httpCode()`, `httpError()`, `httpTruncated()`, `httpStatus()`.

HTTP JSON field extraction:

```wrench
var code = fetchJson("https://example.com/data.json", 2048, 6000);
if (code == 200) {
  println(getJsonValue("name"));
  println(getJsonFloat("main.temp"));
}
```

For larger API responses, `fetchJson()` keeps the response in firmware cache and `getJsonValue()` returns selected fields to Wrench. `httpGet()` returns the full body and is best suited to small responses or scripts that need the complete payload.

## JSON Helpers

- `jsonGet(body, path)` returns a string.
- `jsonGetInt(body, path)`, `jsonGetFloat(body, path)`, `jsonGetBool(body, path)`.
- `jsonHas(body, path)`.
- `jsonPair(key, value)`, `jsonPairRaw(key, rawJson)`.
- `jsonPairInt(key, value)`, `jsonPairFloat(key, value, decimals)`, `jsonPairBool(key, value)`.
- `jsonBuild(pair...)` builds an object string.

Paths can address nested object/array values such as `weather.0.main` or `main.temp`.

## LED Bindings

Multi-strip API:

- `ledConfig(strip, pin, count, brightness)`.
- `ledReady(strip)`.
- `ledStripCount()`.
- `ledCount(strip)`.
- `ledSet(strip, index, r, g, b)`.
- `ledSetHsv(strip, index, h, s, v)` converts HSV to RGB in firmware without Wrench JSON/string allocation. This is the compact path for rainbow, sparkle, and chase animations.
- `hsvToR(h, s, v)`, `hsvToG(h, s, v)`, `hsvToB(h, s, v)` return numeric RGB components without building a JSON array. Use these when a sketch needs to reuse individual color channels.
- `rgbToH(r, g, b)`, `rgbToS(r, g, b)`, `rgbToV(r, g, b)` return numeric HSV components without building a JSON array.
- `ledFill(strip, r, g, b)`.
- `ledClear(strip, show)`.
- `ledShow()`.
- `ledBrightness(strip, brightness)`.
- `ledStatus()`.

For the current LED test strip, use pin `4` and count `30`.

Stable chase pattern shape:

```wrench
var pos = 0;
var lastFrameAt = 0;

function setup() {
  ledConfig(0, 4, 30, 70);
  ledClear(0, 1);
  println("chase ready");
}

function loop() {
  if ((millis() - lastFrameAt) >= 80) {
    lastFrameAt = millis();
    ledClear(0, 0);
    ledSet(0, pos, 0, 0, 255);
    ledShow();
    pos = (pos + 1) % ledCount(0);
  }
  delay(10);
}
```

## I2C

- `wireBegin(sda, scl)`.
- `i2cWrite(addr, reg, value)`.
- `i2cRead(addr, reg, len)`.

## Secondary UART

UART0 is reserved for the host transport. Wrench can use UART1 or UART2 only.

- `serialBegin(uart, rxPin, txPin, baud)`.
- `serialEnd(uart)`.
- `serialAvailable(uart)`.
- `serialRead(uart)`.
- `serialReadString(uart, maxLen)`.
- `serialWrite(uart, value)`.
- `serialWriteLine(uart, value)`.
- `serialWriteByte(uart, value)`.
- `serialStatus()`.

Avoid flash pins and transport pins.

## Servo And Fan PWM

- `servoAttach(pin, minUs, maxUs)`.
- `servoWrite(pin, degrees)`.
- `servoWriteMicroseconds(pin, us)`.
- `servoDetach(pin)`.
- `fanAttach(pin, hz)`.
- `fanWrite(pin, percent)`.
- `fanWriteRaw(pin, duty)`.
- `fanDetach(pin)`.

## Inbox

The host can send messages into a running script.

- `inboxAvailable()`.
- `inboxRead()`.
- `inboxChannel()`.
- `inboxClear()`.
- `inboxDrops()`.

## Firmware-Driven UI

The browser has a UI view for Guino-style live interfaces. The sketch owns the interface: it declares controls, pumps incoming UI events, and streams live values back to the browser. The browser renders the UI on a dark canvas and sends button, toggle, and slider interactions back through the compact MessagePack transport. Serial receives the same concepts as JSON lines only at the transport boundary.

Use this lifecycle:

- Declare the interface in a small `drawUi()` function.
- Call `drawUi()` from `setup()`.
- Call `drawUi()` again only when `uiEventIs("hello")` so a newly connected browser can rebuild the view.
- Browser slider and toggle input is captured in the firmware background as state. Use `uiGet(id, fallback)` to read the latest value without manually polling the input queue.
- Use `uiChanged(id)` when code should react only once to a changed slider or toggle value.
- Use `while (uiPoll()) { ... }` when a sketch needs edge-style events such as button presses or browser `hello` redraw requests.
- During normal runtime, update UI values with `uiUpdate(id, value)`. It only sends when the value has changed.
- Use `uiPush(id, value)` for streams that must send every sample, including moving graphs that should show time passing even when the value repeats.
- Do not call `uiBegin()` after every button, toggle, slider, or graph update. `uiBegin()` resets the interface; `uiUpdate()` and `uiPush()` change values.

UI layout and value bindings:

- `uiBegin(title)` clears the current UI view and starts a new interface.
- `uiClear()` clears the UI view.
- `uiLabel(id, text)`.
- `uiButton(id, label)`.
- `uiToggle(id, label, value)`.
- `uiSlider(id, label, value, min, max)`.
- `uiValue(id, label, value, min, max)`.
- `uiGraph(id, label, value, min, max)`.
- `uiSpacer(size)` or `uiSpacer(id, size)` adds a visual spacer. Size is `1`, `2`, or `3`.
- `uiColumn()` requests a column break in wider layouts.
- `uiColor(r, g, b)` sets the UI accent color.
- `uiUpdate(id, value)` updates a numeric value, slider, toggle, gauge, or graph when the value has changed.
- `uiPush(id, value)` updates a numeric value, slider, toggle, gauge, or graph every time it is called.
- `uiText(id, text)` updates label text.

UI input bindings:

- `uiPoll()` returns `1` when a UI input is available and loads that input for `uiEventIs()` and `uiEventValue()`.
- `uiEventIs(type, id)` returns `1` when the current event matches both fields. Use this for button-heavy interfaces because it avoids repeated string comparisons in Wrench code. Omit `id` to match only the event type, for example `uiEventIs("hello")`.
- `uiEventValue()` returns the numeric value for sliders and toggles.
- `uiGet(id, fallback)` returns the latest background value for a slider or toggle, or `fallback` when the browser has not sent a value yet.
- `uiChanged(id)` returns `1` once after a browser slider or toggle update, then clears that changed flag.

Always wrap event-style UI input handling in `while (uiPoll()) { ... }`. Calling `uiEventIs()` or `uiEventValue()` without first calling `uiPoll()` will keep reading the previous event, or no event at all. For simple toggles and sliders, prefer `uiGet()`.

```wrench
// Streams an analog value to the UI and lets the browser control the refresh speed.
var sensorPin = 34;
var delayMs = 80;
var running = 1;
var lastUpdate = 0;

function drawUi() {
  uiBegin("Sensor Panel");
  uiColor(127, 208, 223);
  uiLabel("sliders", "SLIDERS");
  uiGraph("sensor", "Analog", 0, 0, 4095);
  uiColumn();
  uiSlider("speed", "Delay", delayMs, 10, 300);
  uiToggle("running", "Running", running);
  uiButton("mark", "Mark");
}

function setup() {
  drawUi();
  println("ui sensor ready");
}

function loop() {
  while (uiPoll()) {
    if (uiEventIs("hello")) drawUi();
    if (uiEventIs("press", "mark")) println("mark");
  }

  delayMs = uiGet("speed", delayMs);
  running = uiGet("running", running);

  if (running && (millis() - lastUpdate) >= delayMs) {
    lastUpdate = millis();
    uiPush("sensor", analogRead(sensorPin));
  }
  delay(10);
}
```

## Output Preference

When asked to generate code, return a complete Wrench sketch and keep explanatory text short. Every generated sketch should start with one short `//` comment explaining what the sketch does. Also provide a short `sketch_name` of 2-5 words, such as `Blue Chase`, `Weather Coat Lights`, or `Fan PWM Test`; this name is shown in the browser history dropdown. Put normal assumptions and caveats in notes. Use warnings only for immediate, concrete risks such as unsafe pins, high current LED loads, blocking code, destructive commands, missing credentials, or likely firmware/resource failure.

The browser also has a Circuit view. For generated hardware sketches, provide a `circuit_layout` object with this shape:

```json
{
  "version": "0.1",
  "board": { "type": "esp32-classic" },
  "components": [
    { "id": "button-27", "type": "button", "label": "Button", "pin": "27", "pins": { "signal": "27" }, "confidence": 0.9 }
  ],
  "connections": [
    { "from": { "component": "button-27", "pin": "signal" }, "to": { "boardPin": "27" }, "label": "signal" },
    { "from": { "component": "button-27", "pin": "gnd" }, "to": { "boardPin": "GND" }, "label": "GND" }
  ],
  "assumptions": ["INPUT_PULLUP means the button closes to ground."],
  "notes": []
}
```

Common component `type` values are `button`, `led`, `ledStrip`, `neopixelRing`, `neopixelMatrix`, `analogSensor`, `digitalSensor`, `distanceSensor`, `ultrasonicSensor`, `microphone`, `joystick`, `potentiometer`, `servo`, `fan`, `dcMotor`, `stepperMotor`, `buzzer`, `relay`, `i2cDevice`, `imu`, `uartDevice`, `mp3Player`, `touchPad`, `wifiService`, and `unknown`. Use direct wires rather than breadboard abstractions. Use `unknown` and an assumption when a connection is ambiguous. Use an empty object for `circuit_layout` when no physical wiring is involved.
