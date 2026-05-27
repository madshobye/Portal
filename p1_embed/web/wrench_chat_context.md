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

## Common Failure Patterns

- `vasr` instead of `var` usually reports a bad expression on that line.
- A missing `;` can make the compiler point at the next line instead of the true source.
- Unclosed strings, especially JSON strings, can shift the reported error far from the typo.
- Prefer `while (i < count) { ... i = i + 1; }`; forgetting the increment can hang script logic.
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
- `emitJson(channel, pair...)`: emit a transport event with structured JSON fields.
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

## Output Preference

When asked to generate code, return a complete Wrench sketch and keep explanatory text short. Every generated sketch should start with one short `//` comment explaining what the sketch does. Also provide a short `sketch_name` of 2-5 words, such as `Blue Chase`, `Weather Coat Lights`, or `Fan PWM Test`; this name is shown in the browser history dropdown. Put normal assumptions and caveats in notes. Use warnings only for immediate, concrete risks such as unsafe pins, high current LED loads, blocking code, destructive commands, missing credentials, or likely firmware/resource failure.
