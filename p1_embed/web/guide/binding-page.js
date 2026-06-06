const pages = {
  "core-runtime": {
    title: "Core Runtime",
    subtitle: "Logging, timing, random numbers, heap checks, and script errors.",
    intro: "These bindings are the everyday tools for making a sketch observable and responsive. Use them to pace loop work, print diagnostics, and avoid blind debugging.",
    calls: [
      {
        name: "print",
        signature: "print(value...)\nprintln(value...)",
        params: [
          ["value...", "One or more numbers or strings. Values are emitted in order."]
        ],
        returns: "No return value. Output appears in the browser console and script output transport.",
        notes: ["Use println for line-oriented logs.", "For floats, print the label and value separately instead of concatenating strings with floats."],
        example: 'print("brightness=");\nprintln(brightness);'
      },
      {
        name: "log",
        signature: "log(level, message)",
        params: [
          ["level", "String such as \"error\", \"warn\", \"info\", \"debug\", or \"trace\"."],
          ["message", "String message."]
        ],
        returns: "No return value.",
        notes: ["Use for categorized diagnostics; use println for simple sketch output."],
        example: 'log("debug", "frame rendered");'
      },
      {
        name: "timing",
        signature: "millis()\nmicros()\ndelay(ms)\ndelayMicroseconds(us)",
        params: [
          ["ms", "Milliseconds to yield/sleep."],
          ["us", "Microseconds to delay."]
        ],
        returns: "millis and micros return elapsed time counters. delay calls return nothing.",
        notes: ["Prefer a short delay in loop so transports and status can keep breathing.", "Use millis-based intervals for animations instead of long blocking loops."],
        example: "var lastFrameAt = 0;\n\nfunction loop() {\n  if ((millis() - lastFrameAt) >= 50) {\n    lastFrameAt = millis();\n    println(\"frame\");\n  }\n  delay(5);\n}"
      },
      {
        name: "random",
        signature: "random(max)\nrandom(min, max)\nrandomSeed(seed)",
        params: [
          ["max", "Exclusive upper bound."],
          ["min", "Inclusive lower bound."],
          ["seed", "Integer seed for repeatable sequences."]
        ],
        returns: "random returns an integer. randomSeed returns nothing.",
        notes: ["Use randomSeed when you want deterministic test behavior."],
        example: "randomSeed(1234);\nprintln(random(0, 10));"
      },
      {
        name: "error and heap",
        signature: "freeHeap()\nlastError()\nclearError()",
        params: [],
        returns: "freeHeap returns available heap. lastError returns the current script error text. clearError clears it.",
        notes: ["freeHeap is useful for coarse diagnostics; max contiguous heap is a firmware status field, not a Wrench binding."],
        example: "println(freeHeap());\nif (lastError() != \"\") {\n  println(lastError());\n  clearError();\n}"
      }
    ]
  },
  "math-time-sun": {
    title: "Math, Noise, Time, Sun",
    subtitle: "Numeric helpers, simplex noise, local time, and sun-derived brightness/color.",
    intro: "Use these bindings for animation curves, physical-ish motion, clocks, daylight-aware brightness, and color temperature.",
    calls: [
      {
        name: "range helpers",
        signature: "lerp(a, b, t)\nmap(value, inMin, inMax, outMin, outMax)\nconstrain(value, min, max)",
        params: [
          ["a, b", "Start and end values."],
          ["t", "Blend amount, clamped to 0.0..1.0."],
          ["value", "Input value to map or clamp."]
        ],
        returns: "Float result.",
        notes: ["map returns outMin when inMin equals inMax."],
        example: "var raw = analogRead(34);\nvar pct = map(raw, 0, 4095, 0, 100);\npct = constrain(pct, 0, 100);"
      },
      {
        name: "math functions",
        signature: "sin(x), cos(x), tan(x), atan2(y, x), sqrt(x), pow(a, b), floor(x), ceil(x), round(x), abs(x), min(a, b), max(a, b), radians(deg), degrees(rad)",
        params: [
          ["x, y, a, b", "Numeric arguments."],
          ["deg, rad", "Angle values in degrees or radians."]
        ],
        returns: "Numeric result.",
        notes: ["Constants PI, TWO_PI, and HALF_PI are available.", "Prefer top-level functions over math:: names in new sketches."],
        example: "var angle = radians(90);\nprintln(sin(angle));"
      },
      {
        name: "simplex noise",
        signature: "noiseSeed(seed)\nsimplex3(x, y, z)\nsimplex3_01(x, y, z)",
        params: [
          ["seed", "Integer seed for repeatable noise."],
          ["x, y, z", "Float coordinates."]
        ],
        returns: "simplex3 returns roughly -1.0..1.0. simplex3_01 returns 0.0..1.0.",
        notes: ["Use a slowly changing time coordinate for organic motion."],
        example: "var t = millis() / 1000.0;\nvar drift = simplex3_01(0.2, 1.7, t);\nprintln(drift);"
      },
      {
        name: "time",
        signature: "timeNow()\ntimeLocal()\ntimeLocal(out)\ntimeGet()",
        params: [
          ["out", "Six-element array filled as year, month, day, hour, minute, second."]
        ],
        returns: "timeNow returns Unix seconds. timeLocal returns/fills local parts or -1 values before sync. timeGet returns text.",
        notes: ["Use timeLocal(out) in loops to avoid allocating a fresh array.", "Timezone is configured in Settings > General."],
        example: "var parts[] = { 0, 0, 0, 0, 0, 0 };\ntimeLocal(parts);\nif (parts[3] >= 0) {\n  print(\"hour=\");\n  println(parts[3]);\n}"
      },
      {
        name: "sun",
        signature: "sunLocal(lat, lon)\nsunLocal(lat, lon, out)\nsunLocal(lat, lon, unixSeconds, out)",
        params: [
          ["lat, lon", "Latitude and longitude in decimal degrees."],
          ["unixSeconds", "UTC Unix timestamp. Omit to use current device time."],
          ["out", "Four-element array filled as elevationDeg, azimuthDeg, brightness, kelvin."]
        ],
        returns: "Return-array form returns four integers. Output-buffer forms fill out and return no useful value.",
        notes: ["Azimuth uses compass degrees: north 0, east 90, south 180, west 270.", "brightness is 0..255; kelvin is roughly 2200..6500."],
        example: "var sun[] = { 0, 0, 0, 0 };\nsunLocal(55.652116, 12.610874, timeNow(), sun);\nprintln(sun[0]); // elevation\nprintln(sun[1]); // azimuth\nprintln(sun[2]); // brightness\nprintln(sun[3]); // kelvin"
      }
    ]
  },
  "gpio-pwm": {
    title: "GPIO And PWM",
    subtitle: "Digital pins, analog reads, touch, servo control, and fan PWM.",
    intro: "These bindings connect Wrench code to physical pins. Use firmware constants such as OUTPUT, HIGH, and LOW rather than string names.",
    calls: [
      {
        name: "digital GPIO",
        signature: "pinMode(pin, mode)\ndigitalWrite(pin, value)\ndigitalRead(pin)",
        params: [
          ["pin", "ESP32 GPIO number."],
          ["mode", "INPUT, OUTPUT, INPUT_PULLUP, or INPUT_PULLDOWN."],
          ["value", "HIGH/LOW or 1/0."]
        ],
        returns: "digitalRead returns 0 or 1. Others return no useful value.",
        notes: ["Do not pass \"OUTPUT\" or \"HIGH\" as strings.", "Avoid flash pins and transport pins."],
        example: "var ledPin = 2;\n\nfunction setup() {\n  pinMode(ledPin, OUTPUT);\n}\n\nfunction loop() {\n  digitalWrite(ledPin, HIGH);\n  delay(100);\n  digitalWrite(ledPin, LOW);\n  delay(900);\n}"
      },
      {
        name: "analog and touch",
        signature: "analogRead(pin)\ntouchRead(pin)\ntouchReadPair(drivePin, sensePin, samples, settleMicroseconds)",
        params: [
          ["pin", "Analog/touch-capable GPIO."],
          ["drivePin", "Pin driven high/low for two-wire touch."],
          ["sensePin", "Analog pin read during two-wire touch."],
          ["samples", "Sample count, defaults to 32."],
          ["settleMicroseconds", "Delay before reading, defaults to 5."]
        ],
        returns: "analogRead and touchRead return numeric readings. touchReadPair returns averaged high-minus-low delta.",
        notes: ["Smooth touchReadPair in the script if scanning several inputs."],
        example: "var value = touchReadPair(25, 34, 32, 5);\nprintln(value);"
      },
      {
        name: "PWM output",
        signature: "analogWrite(pin, value)\nanalogWriteResolution(bits)\nanalogWriteFrequency(pin, hz)\npwmDetach(pin)",
        params: [
          ["pin", "PWM output GPIO."],
          ["value", "Duty value in the current resolution."],
          ["bits", "Resolution in bits."],
          ["hz", "PWM frequency."]
        ],
        returns: "No useful return value.",
        notes: ["Use pwmDetach before handing a pin to another subsystem."],
        example: "analogWriteResolution(8);\nanalogWriteFrequency(18, 1000);\nanalogWrite(18, 128);"
      },
      {
        name: "servo and fan",
        signature: "servoAttach(pin, minUs, maxUs)\nservoWrite(pin, degrees)\nservoWriteMicroseconds(pin, us)\nservoDetach(pin)\nfanAttach(pin, hz)\nfanWrite(pin, percent)\nfanWriteRaw(pin, duty)\nfanDetach(pin)",
        params: [
          ["pin", "Output GPIO."],
          ["minUs, maxUs", "Servo pulse range."],
          ["degrees", "Servo angle."],
          ["percent", "Fan power 0..100."],
          ["duty", "Raw PWM duty value."]
        ],
        returns: "No useful return value.",
        notes: ["Use a suitable external supply for servos, motors, and fans."],
        example: "function setup() {\n  servoAttach(18, 500, 2500);\n}\n\nfunction loop() {\n  servoWrite(18, 20);\n  delay(500);\n  servoWrite(18, 160);\n  delay(500);\n}"
      }
    ]
  },
  "wifi-device": {
    title: "WiFi And Device",
    subtitle: "Network state, identity, uptime, and device-level helpers.",
    intro: "Use these bindings for diagnostics and simple device configuration from sketches. WiFi settings are normally managed from Settings.",
    calls: [
      {
        name: "WiFi status",
        signature: "wifiConnected()\nwifiIp()\nwifiRssi()\nwifiSsid()\nwifiNetworkCount()",
        params: [],
        returns: "Connected returns 1 or 0. IP/SSID return strings. RSSI and network count return numbers.",
        notes: ["Check wifiConnected before HTTP calls."],
        example: "if (wifiConnected()) {\n  println(wifiSsid());\n  println(wifiIp());\n  println(wifiRssi());\n}"
      },
      {
        name: "WiFi control",
        signature: "wifiConnect(ssid, password)\nwifiDisconnect()",
        params: [
          ["ssid", "Network name."],
          ["password", "Network password."]
        ],
        returns: "No stable script-facing return value.",
        notes: ["Prefer Settings for saved WiFi. Use these only for explicit sketch-driven network experiments."],
        example: 'wifiConnect("MyNetwork", "secret");'
      },
      {
        name: "device info",
        signature: "deviceId()\ndeviceName()\ntimezone()\nuptimeMs()\nminFreeHeap()\nscriptState()\nloopCount()",
        params: [],
        returns: "Strings or numbers depending on the field.",
        notes: ["minFreeHeap is useful for long-run stress checks."],
        example: "println(deviceName());\nprintln(uptimeMs());\nprintln(minFreeHeap());"
      },
      {
        name: "configuration and reboot",
        signature: "configSet(key, value)\nreboot()",
        params: [
          ["key", "Supported firmware config key."],
          ["value", "String or numeric value."]
        ],
        returns: "No useful return value.",
        notes: ["Use with care. Some configuration changes need reboot to take effect."],
        example: 'configSet("deviceName", "desk-light");\nreboot();'
      }
    ]
  },
  "http-json": {
    title: "HTTP And JSON",
    subtitle: "Small web requests and firmware-cached JSON extraction.",
    intro: "For APIs, prefer fetchJson plus getJsonValue/getJsonFloat when you only need a few fields. That avoids copying large bodies into Wrench heap.",
    calls: [
      {
        name: "HTTP GET",
        signature: "httpGet(url, maxBytes, timeoutMs)",
        params: [
          ["url", "HTTP or HTTPS URL."],
          ["maxBytes", "Maximum response bytes to keep."],
          ["timeoutMs", "Request timeout in milliseconds."]
        ],
        returns: "Response body string, or empty string on failure.",
        notes: ["Check httpCode and httpError after a request.", "Large response strings can pressure Wrench heap."],
        example: 'var body = httpGet("http://example.com/status.txt", 256, 4000);\nprintln(httpCode());\nprintln(body);'
      },
      {
        name: "cached JSON fetch",
        signature: "fetchJson(url, maxBytes, timeoutMs)\ngetJsonValue(path)\ngetJsonInt(path)\ngetJsonFloat(path)\ngetJsonBool(path)",
        params: [
          ["url", "JSON API URL."],
          ["maxBytes", "Maximum response bytes in firmware cache."],
          ["timeoutMs", "Request timeout."],
          ["path", "Dot path such as main.temp or weather.0.main."]
        ],
        returns: "fetchJson returns HTTP status code. getJson* returns the selected field converted to the requested type.",
        notes: ["Use this pattern for weather and sensor APIs.", "The path reads from the most recent fetchJson/httpGet cache."],
        example: 'var code = fetchJson("https://api.example.com/weather.json", 4096, 6000);\nif (code == 200) {\n  println(getJsonFloat("main.temp"));\n  println(getJsonValue("weather.0.main"));\n}'
      },
      {
        name: "one-shot JSON helpers",
        signature: "httpJsonGet(url, path, maxBytes, timeoutMs)\nhttpJsonGetInt(...)\nhttpJsonGetFloat(...)\nhttpJsonGetBool(...)",
        params: [
          ["url", "JSON API URL."],
          ["path", "Dot path to extract."],
          ["maxBytes", "Maximum response bytes."],
          ["timeoutMs", "Request timeout."]
        ],
        returns: "Extracted value as string, integer, float, or bool.",
        notes: ["Good for one field. Use fetchJson when reading several fields."],
        example: 'var temp = httpJsonGetFloat("https://api.example.com/weather.json", "main.temp", 4096, 6000);\nprintln(temp);'
      },
      {
        name: "JSON string helpers",
        signature: "jsonGet(body, path)\njsonGetInt(body, path)\njsonGetFloat(body, path)\njsonGetBool(body, path)\njsonHas(body, path)\njsonPair(key, value)\njsonPairRaw(key, rawJson)\njsonPairInt(key, value)\njsonPairFloat(key, value, decimals)\njsonPairBool(key, value)\njsonBuild(pair...)",
        params: [
          ["body", "JSON string."],
          ["path", "Dot path into object/array."],
          ["key", "Object field name."],
          ["value", "Value to encode."],
          ["rawJson", "Already-encoded JSON value."],
          ["decimals", "Float decimal places."]
        ],
        returns: "Extractors return selected value. Pair helpers return encoded pair fragments. jsonBuild returns object text.",
        notes: ["Do not use JSON helpers as data structures in hot animation loops."],
        example: 'var body = "{\\"ok\\":true,\\"value\\":12}";\nprintln(jsonGetBool(body, "ok"));\nprintln(jsonBuild(jsonPairInt("value", 7), jsonPairBool("ok", 1)));'
      },
      {
        name: "HTTP status",
        signature: "httpCode()\nhttpError()\nhttpTruncated()",
        params: [],
        returns: "Status code, error string, and truncation flag.",
        notes: ["Use these after any HTTP binding to make failures visible."],
        example: 'var body = httpGet("http://example.com", 512, 4000);\nif (httpCode() != 200) {\n  println(httpError());\n}'
      }
    ]
  },
  "led-strips": {
    title: "LED Strips",
    subtitle: "NeoPixel-style strip setup, RGB/HSV pixels, brightness, and frame output.",
    intro: "The script owns LED geometry through ledConfig. Configure before drawing, write pixels into the frame buffer, then call ledShow to send the frame.",
    calls: [
      {
        name: "configuration",
        signature: "ledConfig(strip, pin, count, brightness)\nledConfig(strip, pin, count, brightness, \"WS2812B\", order)",
        params: [
          ["strip", "Logical strip index, usually 0."],
          ["pin", "ESP32 GPIO connected to LED data."],
          ["count", "Number of pixels."],
          ["brightness", "Global brightness 0..255 in firmware terms; many sketches use 0..100 by convention."],
          ["order", "Optional color order: RGB, RBG, GRB, GBR, BRG, or BGR."]
        ],
        returns: "No useful return value. Binding errors stop the sketch when setup cannot proceed.",
        notes: ["Default order is GRB.", "Changing pin or growing beyond active capacity can require reboot.", "Changing color order is allowed live."],
        example: 'function setup() {\n  ledConfig(0, 16, 144, 50);\n  ledClear(0, 1);\n}'
      },
      {
        name: "status",
        signature: "ledReady(strip)\nledStripCount()\nledCount(strip)",
        params: [
          ["strip", "Logical strip index."]
        ],
        returns: "ledReady returns 1/0. ledStripCount returns configured strip count. ledCount returns pixel count for a strip.",
        notes: ["Use ledCount in loops so sketches adapt to configured length."],
        example: "if (ledReady(0)) {\n  println(ledCount(0));\n}"
      },
      {
        name: "set pixels",
        signature: "ledSet(strip, index, r, g, b)\nledSetHsv(strip, index, h, s, v)\nledSetRgb(strip, index, rgb)",
        params: [
          ["strip", "Logical strip index."],
          ["index", "Pixel index 0..ledCount(strip)-1."],
          ["r, g, b", "Red, green, blue 0..255."],
          ["h, s, v", "Hue, saturation, value 0..255."],
          ["rgb", "Three-element array [r, g, b]."]
        ],
        returns: "No useful return value.",
        notes: ["ledSetHsv avoids Wrench-side HSV math allocation.", "Out-of-range pixels are binding errors."],
        example: "ledSet(0, 0, 255, 0, 0);\nledSetHsv(0, 1, 96, 255, 180);"
      },
      {
        name: "read and convert color",
        signature: "ledGetRgb(strip, index)\nledGetRgb(strip, index, out)\nrgbToHsv(rgb)\nrgbToHsv(rgb, out)\nhsvToRgb(hsv)\nhsvToRgb(hsv, out)",
        params: [
          ["out", "Three-element output array."],
          ["rgb", "Three-element RGB array."],
          ["hsv", "Three-element HSV array."]
        ],
        returns: "Array-return forms allocate and return a three-element array. Output-buffer forms fill the provided array.",
        notes: ["Use output-buffer forms inside loops to avoid repeated allocations."],
        example: "var rgb[] = { 0, 0, 0 };\nvar hsv[] = { 0, 0, 0 };\nledGetRgb(0, 4, rgb);\nrgbToHsv(rgb, hsv);\nhsv[0] = (hsv[0] + 8) % 255;\nhsvToRgb(hsv, rgb);\nledSetRgb(0, 4, rgb);"
      },
      {
        name: "frame operations",
        signature: "ledFill(strip, r, g, b)\nledClear(strip, show)\nledShow()\nledBrightness(strip, brightness)",
        params: [
          ["show", "1 to immediately push the cleared frame, 0 to only clear the buffer."],
          ["brightness", "Global brightness value."]
        ],
        returns: "No useful return value.",
        notes: ["Call ledShow once per frame after setting pixels.", "Keep a small delay in very fast render loops."],
        example: "ledClear(0, 0);\nledSet(0, pos, 0, 0, 255);\nledShow();"
      }
    ]
  },
  "palettes": {
    title: "Palettes",
    subtitle: "Small firmware-side gradients for animation colors.",
    intro: "Palette bindings let a sketch define gradient slots and sample colors without manually interpolating every channel in Wrench.",
    calls: [
      {
        name: "define palettes",
        signature: "paletteSet2(slot, r0, g0, b0, r1, g1, b1)\npaletteSet3(slot, r0, g0, b0, r1, g1, b1, r2, g2, b2)\npaletteSet4(slot, r0, g0, b0, r1, g1, b1, r2, g2, b2, r3, g3, b3)",
        params: [
          ["slot", "Palette slot 0..3."],
          ["rN, gN, bN", "Color stops as RGB channels 0..255."]
        ],
        returns: "No useful return value.",
        notes: ["Define palettes in setup unless colors are intentionally changing."],
        example: "paletteSet3(0, 20, 0, 120, 255, 110, 0, 255, 255, 40);"
      },
      {
        name: "sample palettes",
        signature: "paletteGetRgb(slot, t)\npaletteGetRgb(slot, t, out)",
        params: [
          ["slot", "Palette slot 0..3."],
          ["t", "Position in gradient, 0..255."],
          ["out", "Three-element RGB output array."]
        ],
        returns: "Array-return form returns [r, g, b]. Output-buffer form fills out.",
        notes: ["Use the output-buffer form in LED loops."],
        example: "var rgb[] = { 0, 0, 0 };\nvar i = 0;\nwhile (i < ledCount(0)) {\n  paletteGetRgb(0, (i * 255) / ledCount(0), rgb);\n  ledSetRgb(0, i, rgb);\n  i = i + 1;\n}"
      }
    ]
  },
  "i2c-uart": {
    title: "I2C And UART",
    subtitle: "Simple bus access for external devices.",
    intro: "Use I2C for register-style sensors and UART1/UART2 for serial modules. UART0 is reserved for the host transport.",
    calls: [
      {
        name: "I2C",
        signature: "wireBegin(sda, scl)\ni2cWrite(addr, reg, value)\ni2cRead(addr, reg, len)",
        params: [
          ["sda, scl", "GPIO pins for the I2C bus."],
          ["addr", "7-bit I2C device address."],
          ["reg", "Register address."],
          ["value", "Byte value to write."],
          ["len", "Number of bytes to read."]
        ],
        returns: "i2cRead returns bytes from the device. Other calls return no useful value.",
        notes: ["The exact shape of i2cRead depends on firmware conversion; keep reads small and print first when integrating a new sensor."],
        example: "wireBegin(21, 22);\ni2cWrite(0x40, 0x00, 0x01);\nprintln(i2cRead(0x40, 0x00, 2));"
      },
      {
        name: "secondary UART",
        signature: "serialBegin(uart, rxPin, txPin, baud)\nserialEnd(uart)\nserialAvailable(uart)\nserialRead(uart)\nserialReadString(uart, maxLen)\nserialWrite(uart, value)\nserialWriteLine(uart, value)\nserialWriteByte(uart, value)",
        params: [
          ["uart", "1 or 2. UART0 is reserved."],
          ["rxPin, txPin", "Receive and transmit GPIO pins."],
          ["baud", "Baud rate."],
          ["maxLen", "Maximum string bytes to read."],
          ["value", "String, number, or byte depending on call."]
        ],
        returns: "serialAvailable returns count/flag. serialRead returns one byte. serialReadString returns text.",
        notes: ["Avoid flash pins and pins already used by USB/host transport."],
        example: "function setup() {\n  serialBegin(1, 16, 17, 9600);\n}\n\nfunction loop() {\n  if (serialAvailable(1)) {\n    println(serialReadString(1, 80));\n  }\n  delay(10);\n}"
      }
    ]
  },
  "browser-ui": {
    title: "Browser UI",
    subtitle: "Sketch-owned live controls rendered in the UI tab.",
    intro: "The sketch declares the UI. The browser renders it and sends interactions back to firmware. Rebuild the interface only when a browser connects or asks for hello.",
    calls: [
      {
        name: "layout",
        signature: "uiBegin(title)\nuiClear()\nuiLabel(id, text)\nuiButton(id, label)\nuiToggle(id, label, value)\nuiSlider(id, label, value, min, max)\nuiValue(id, label, value, min, max)\nuiGraph(id, label, value, min, max)\nuiSpacer(size)\nuiSpacer(id, size)\nuiColumn()\nuiColor(r, g, b)",
        params: [
          ["id", "Stable string id for a UI element."],
          ["title, text, label", "Displayed text."],
          ["value", "Initial numeric value."],
          ["min, max", "Control/display range."],
          ["size", "Spacer size 1, 2, or 3."],
          ["r, g, b", "Accent color channels 0..255."]
        ],
        returns: "No useful return value.",
        notes: ["uiBegin clears the UI; do not call it every frame.", "Use uiColumn for wider layouts."],
        example: "function drawUi() {\n  uiBegin(\"Light\");\n  uiColor(200, 0, 160);\n  uiSlider(\"brightness\", \"Brightness\", 60, 0, 100);\n  uiToggle(\"enabled\", \"Enabled\", 1);\n}"
      },
      {
        name: "input events",
        signature: "uiPoll()\nuiEventIs(type, id)\nuiEventValue()",
        params: [
          ["type", "Event type such as hello, press, toggle, or slider."],
          ["id", "Optional UI element id."],
          ["value", "Read through uiEventValue after uiPoll."]
        ],
        returns: "uiPoll returns 1 when an event is loaded. uiEventIs returns 1/0. uiEventValue returns numeric value.",
        notes: ["Always wrap event-style handling in while (uiPoll())."],
        example: "while (uiPoll()) {\n  if (uiEventIs(\"hello\")) drawUi();\n  if (uiEventIs(\"press\", \"mark\")) println(\"mark\");\n}"
      },
      {
        name: "background values",
        signature: "uiGet(id, fallback)\nuiChanged(id)",
        params: [
          ["id", "Slider or toggle id."],
          ["fallback", "Value returned before browser has sent state."]
        ],
        returns: "uiGet returns latest value. uiChanged returns 1 once after a browser change.",
        notes: ["Prefer uiGet for sliders/toggles instead of manually scanning every event."],
        example: "brightness = uiGet(\"brightness\", brightness);\nif (uiChanged(\"brightness\")) {\n  println(brightness);\n}"
      },
      {
        name: "output updates",
        signature: "uiUpdate(id, value)\nuiPush(id, value)\nuiText(id, text)",
        params: [
          ["id", "UI element id."],
          ["value", "Numeric value."],
          ["text", "Text for label updates."]
        ],
        returns: "No useful return value.",
        notes: ["uiUpdate only sends when value changes.", "uiPush sends every sample and is useful for graphs that should show time passing."],
        example: "uiUpdate(\"brightness\", brightness);\nuiPush(\"sensor\", analogRead(34));\nuiText(\"status\", \"running\");"
      }
    ]
  },
  "home-assistant": {
    title: "Home Assistant",
    subtitle: "Experimental sketch-owned ESPHome native API entities.",
    intro: "A sketch can declare entities that appear in Home Assistant. Home Assistant commands update firmware-side values, and the sketch can read or publish those values.",
    calls: [
      {
        name: "registry",
        signature: "haBegin(name)",
        params: [
          ["name", "Device name shown to Home Assistant."]
        ],
        returns: "No useful return value.",
        notes: ["Call before declaring entities.", "Keep HA separate from browser UI; declare entities in setup."],
        example: 'function setup() {\n  haBegin("P1.E HA Test");\n}'
      },
      {
        name: "declare entities",
        signature: "haSensor(id, name, value, unit)\nhaBinarySensor(id, name, value)\nhaSwitch(id, name, value)\nhaNumber(id, name, value, min, max, step)\nhaButton(id, name)\nhaLight(id, name, brightness)\nhaOnOffLight(id, name, value)\nhaRgbLight(id, name, r, g, b, brightness)",
        params: [
          ["id", "Stable entity id used by Wrench calls."],
          ["name", "Display name in Home Assistant."],
          ["value", "Initial numeric or boolean value."],
          ["unit", "Sensor unit text."],
          ["min, max, step", "Number entity range and step."],
          ["r, g, b", "RGB channels 0..255."],
          ["brightness", "Light brightness 0..100."]
        ],
        returns: "No useful return value.",
        notes: ["Missing ids in later calls are binding errors.", "Use haOnOffLight when you do not want a brightness slider."],
        example: "var brightness = 40;\n\nfunction setup() {\n  haBegin(\"Desk Lamp\");\n  haLight(\"lamp\", \"Desk Lamp\", brightness);\n  haButton(\"next_mode\", \"Next Mode\");\n}"
      },
      {
        name: "read and write state",
        signature: "haGet(id)\nhaSet(id, value)\nhaUpdate(id, value)\nhaSetRgb(id, r, g, b, brightness)\nhaRed(id)\nhaGreen(id)\nhaBlue(id)\nhaChanged(id)",
        params: [
          ["id", "Declared entity id."],
          ["value", "Numeric/boolean value to publish."],
          ["r, g, b", "RGB channels 0..255."],
          ["brightness", "Brightness 0..100."]
        ],
        returns: "haGet and color channel helpers return current values. haChanged returns 1 once after HA changes an entity.",
        notes: ["haUpdate is a compatibility alias for haSet.", "Use haChanged before reacting to external changes."],
        example: "if (haChanged(\"lamp\")) {\n  brightness = haGet(\"lamp\");\n  println(brightness);\n}\n\nif (brightnessChangedInsideSketch) {\n  haSet(\"lamp\", brightness);\n}"
      },
      {
        name: "events",
        signature: "haEvent(id, type)\nhaPoll()\nhaEventIs(id, type)\nhaEventValue()\nhaEventType()\nhaPress(id)",
        params: [
          ["id", "Declared entity id."],
          ["type", "Event type such as press or set."]
        ],
        returns: "haEvent/haPoll/haEventIs return 1/0. haEventValue returns numeric value. haEventType returns text.",
        notes: ["haEvent finds and removes only the latest matching event.", "haPress emits a Wrench-originated button press toward Home Assistant."],
        example: "if (haEvent(\"next_mode\", \"press\")) {\n  println(\"next mode\");\n}\n\nif (someLocalButtonPressed) {\n  haPress(\"next_mode\");\n}"
      }
    ]
  },
  "inbox": {
    title: "Inbox",
    subtitle: "Messages sent from the host into a running script.",
    intro: "The inbox is a lightweight way for the browser or transport to deliver text commands to a running sketch.",
    calls: [
      {
        name: "read messages",
        signature: "inboxAvailable()\ninboxRead()\ninboxChannel()",
        params: [],
        returns: "inboxAvailable returns 1/0. inboxRead returns the next message. inboxChannel returns its channel.",
        notes: ["Read only when inboxAvailable is true."],
        example: "function loop() {\n  if (inboxAvailable()) {\n    println(inboxChannel());\n    println(inboxRead());\n  }\n  delay(10);\n}"
      },
      {
        name: "maintenance",
        signature: "inboxClear()\ninboxDrops()",
        params: [],
        returns: "inboxDrops returns dropped message count. inboxClear returns no useful value.",
        notes: ["Use inboxDrops to detect overload during tests."],
        example: "if (inboxDrops() > 0) {\n  println(\"inbox overflow\");\n  inboxClear();\n}"
      }
    ]
  }
};

const pageOrder = [
  ["core-runtime", "Core Runtime"],
  ["math-time-sun", "Math, Time, Sun"],
  ["gpio-pwm", "GPIO And PWM"],
  ["wifi-device", "WiFi And Device"],
  ["http-json", "HTTP And JSON"],
  ["led-strips", "LED Strips"],
  ["palettes", "Palettes"],
  ["i2c-uart", "I2C And UART"],
  ["browser-ui", "Browser UI"],
  ["home-assistant", "Home Assistant"],
  ["inbox", "Inbox"]
];

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === "className") node.className = value;
    else if (key === "text") node.textContent = value;
    else node.setAttribute(key, value);
  });
  children.forEach((child) => node.append(child));
  return node;
}

function renderCall(call) {
  const params = el("div", { className: "params" });
  call.params.forEach(([name, description]) => {
    params.append(el("div", { className: "param" }, [
      el("code", { text: name }),
      el("span", { text: description })
    ]));
  });

  const notes = el("ul", { className: "note-list" });
  (call.notes || []).forEach((note) => notes.append(el("li", { text: note })));

  return el("article", { className: "card" }, [
    el("header", {}, [el("h3", { text: call.name })]),
    el("div", { className: "card-body" }, [
      el("pre", { className: "signature", text: call.signature }),
      params,
      el("div", { className: "returns", text: `Returns: ${call.returns}` }),
      notes,
      el("pre", { className: "example", text: call.example })
    ])
  ]);
}

function render() {
  const key = document.body.dataset.bindingPage;
  const page = pages[key] || pages["core-runtime"];
  document.title = `${page.title} - P1.E Guide`;
  document.querySelector("[data-page-title]").textContent = page.title;
  document.querySelector("[data-page-subtitle]").textContent = page.subtitle;
  document.querySelector("[data-page-intro]").textContent = page.intro;

  const grid = document.querySelector("[data-call-grid]");
  page.calls.forEach((call) => grid.append(renderCall(call)));

  const related = document.querySelector("[data-related]");
  pageOrder
    .filter(([otherKey]) => otherKey !== key)
    .forEach(([otherKey, label]) => {
      related.append(el("a", { href: `${otherKey}.html`, text: label }));
    });
}

render();
