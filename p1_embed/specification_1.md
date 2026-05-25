# p1_embed Specification 1

## Aim

`p1_embed` is a Portal-style embedded platform for ESP32 Classic.

The goal is to create Arduino-compatible firmware that can be flashed to an ESP32, run embedded Wrench scripts, and be programmed/debugged from a browser-based interface.

The firmware should be generic and stable. The behavior should live in Wrench scripts and browser-side tooling.

## Current Implementation

Current state, at keyword level:

- Arduino-compatible ESP32 Classic firmware.
- Embedded Wrench runtime.
- Firmware versioning and capability reporting.
- Transport-independent JSON command/event protocol.
- USB Serial JSONL transport.
- WebSocket transport over WiFi.
- mDNS local hostname.
- Browser editor and protocol client.
- Web Serial support.
- WebSocket support.
- Live status, logs, events, and debug level control.
- LittleFS JSON configuration.
- Stable device identity and unique default device name.
- WiFi station configuration.
- Stored WiFi fallback list.
- Wrench script compile/set/run/stop/restart flow.
- Wrench compile worker task for larger scripts.
- `script.set` as compile-valid install.
- `script.run` as stop-current, compile-if-needed, run-pending command.
- Saved script storage.
- Boot-safe saved-script autorun latch.
- Dedicated Wrench FreeRTOS task.
- Runtime mutex and transition state.
- Wrench time slicing.
- Wrench watchdog/status counters.
- Structured script errors.
- Generic debug event bus.
- Wrench print events.
- Wrench input inbox.
- HTTP fetch bindings.
- JSON path extraction and JSON builder bindings.
- Core Arduino bindings.
- ESP/WiFi utility bindings.
- I2C bindings.
- Secondary UART bindings.
- PWM, servo, and CPU fan bindings.
- FastLED-backed LED runtime.
- Runtime-only LED strip configuration.
- Multi-strip WS2812B/GRB support.
- Compatibility `fastLed*` bindings.
- Serial test harness with full-write handling for larger scripts.
- Interactive serial REPL.
- Firmware compile/upload scripts.
- Regression tests for protocol, storage, errors, bindings, HTTP, JSON helpers, PWM, FastLED, Wrench edge cases, the sparkle animation example, and the weather-to-wear LED example.
- Verified on the ESP32 Classic board at `/dev/cu.wchusbserial58741104521`.

## Target List

The Wrench runtime should become a dependable component with clear safety boundaries.

- Done: move Wrench execution out of the main Arduino `loop()`.
- Done: run Wrench on its own FreeRTOS task.
- Done: keep serial, WiFi, and config handling responsive even if Wrench code is slow.
- Done: add a watchdog/status model for slow and hung Wrench `loop()` calls.
- Done: make `script.stop`, `script.restart`, and compile/run transitions thread-safe with a runtime mutex.
- Done: avoid direct protocol/Serial writes from the Wrench task by queueing Wrench-originated events for the main loop.
- Decide what blocking APIs like `delay()` mean inside Wrench.
- Done: add boot-safe behavior for bad saved scripts.

## Debug Events

Firmware subsystems should route diagnostic output through the debug event system instead of writing directly to a transport.

Debug levels:

- `error`
- `warn`
- `info`
- `debug`
- `trace`

The active level is global and can be changed at runtime with `debug.set`. Events above the current level are suppressed before entering the queue.

Current commands:

- `debug.get`
- `debug.set` with `level`

Current event shape:

```json
{
  "type": "evt",
  "name": "debug.log",
  "data": {
    "level": "info",
    "category": "script",
    "message": "hello"
  }
}
```

Domain events such as `device.status`, `wifi.status`, `script.state`, and `script.watchdog` also include `level` and `category` fields.

## Wrench Service Bindings

Wrench can use selected firmware services through typed bindings. These share firmware internals with the external JSON protocol, but scripts do not build raw protocol command packets.

Current service bindings:

- `log(level, message)`
- `emit(name, message)`
- `emitJson(name, jsonField...)`
- `statusGet(key)`
- `configGet(key)`
- `configSet(key, value)`
- `wifiStatus(key)`
- `wifiConnect(ssid, password)`
- `wifiDisconnect()`
- `reboot()`
- `httpGet(url, maxBytes, timeoutMs)`
- `httpPost(url, body, contentType, maxBytes, timeoutMs)`
- `httpCode()`
- `httpTruncated()`
- `httpError()`
- `httpStatus()`
- `jsonGet(json, path)`
- `jsonGetInt(json, path)`
- `jsonGetFloat(json, path)`
- `jsonGetBool(json, path)`
- `jsonHas(json, path)`
- `jsonPair(key, value)`
- `jsonPairRaw(key, rawValue)`
- `jsonPairInt(key, value)`
- `jsonPairFloat(key, value, decimals)`
- `jsonPairBool(key, value)`
- `jsonBuild(jsonField...)`
- `jsonArray(rawValue...)`
- `micros()`
- `delayMicroseconds(us)`
- `random(max)` / `random(min, max)`
- `randomSeed(seed)`
- `freeHeap()`
- `touchRead(pin)`
- `wifiConnected()`
- `wifiIp()`
- `wifiRssi()`
- `wifiSsid()`
- `wireBegin(sda, scl)`
- `i2cRead(addr, reg, len)`
- `i2cWrite(addr, reg, value)`
- `analogWrite(pin, value)`
- `analogWriteResolution(bits)`
- `analogWriteFrequency(pin, hz)`
- `pwmDetach(pin)`
- `servoAttach(pin)`
- `servoWrite(pin, angle)`
- `servoWriteMicroseconds(pin, us)`
- `servoDetach(pin)`
- `fanAttach(pin)`
- `fanWrite(pin, percent)`
- `fanWriteRaw(pin, duty)`
- `fanDetach(pin)`
- `inboxAvailable()`
- `inboxRead()`
- `inboxChannel()`
- `inboxClear()`
- `inboxDrops()`
- `lastError()`
- `clearError()`

Not exposed to Wrench:

- script set/save/clear/run/stop/restart commands
- factory reset

## Wrench Programming Notes

Observed Wrench format and runtime notes:

- Use `var` for local variables. C-style declarations such as `int x = 1;` should be treated as invalid for p1_embed examples.
- `while` loops are supported, including infinite loops, but firmware time slicing is what keeps protocol handling responsive.
- Prefer `function setup()` and `function loop()` as the normal script shape.
- `setup()` runs once when the script starts.
- `loop()` repeats while the script is running.
- `delay(ms)` blocks only the Wrench script task, not the firmware main loop or protocol transports.
- Long-running script logic should still yield through normal Wrench execution, `loop()`, or `delay()`.
- Use `println(value)` or `print(value)` for transport-routed script output.
- Use `emit(name, message)` for simple script events.
- Use `emitJson(name, field...)` for structured script events.
- Avoid manually assembling larger JSON objects through repeated string reassignment when possible. Use the JSON helper functions instead.
- Prefer `jsonBuild(jsonPair(...), jsonPairInt(...), ...)` over building field strings by hand.
- Prefer `jsonArray(rawValue...)` for arrays.
- Use `jsonPairRaw(key, rawJson)` only when the value is already valid JSON.
- Use `jsonGet(json, "path.to.value")` for strings and scalar values.
- Use numeric path segments for arrays, for example `weather.0.description`.
- `jsonGetInt`, `jsonGetFloat`, and `jsonGetBool` return typed values and default to zero/false if the path is missing.
- `jsonHas(json, path)` should be used when missing and empty values need to be distinguished.
- Avoid mixing floats directly into long string concatenation chains for human print lines. Emit structured numeric values with `emitJson()` and `jsonPairFloat()` instead.
- Larger Wrench scripts are expected to compile, but host tools must fully write JSON serial commands before waiting for a response.
- Compile errors are reported through `script.error` and `script.error.get`; examples and tests should verify graceful failure, not just happy paths.

## Vision

Remaining vision:

- Browser-based firmware flashing.
- Browser-based firmware update workflow.
- OTA firmware update path.
- More complete WiFi configuration UI.
- Stronger web editor ergonomics.
- Better script/project library in the browser.
- Clear protocol documentation.
- Clear Wrench API documentation.
- Better hardware notes and wiring guides.
- WebSocket-first local network workflow.
- Robust local device discovery strategy.
- Optional remote relay strategy for non-local access.
- More complete runtime state model in the web UI.
- Better visualization of logs, errors, events, and transport state.
- Safer long-running script supervision.
- More hardware binding coverage where useful.
- More examples that double as regression tests.
- Packaging/version manifest for firmware releases.
- A polished "generic firmware, behavior in scripts" workflow.

## Folder Structure

Current planned structure:

```text
p1_embed/
  specification_1.md

  firmware/
    p1_embed/

  web/
    protocol/
    components/
    examples/

  tools/
    firmware_manifest/

  docs/
```

Intended future contents:

```text
p1_embed/
  firmware/
    p1_embed/
      p1_embed.ino
      config.h
      wrench_runtime.ino
      wrench_bindings.ino
      protocol.ino
      serial_transport.ino
      storage.ino
      wifi_transport.ino
      ota_update.ino

  web/
    index.html
    style.css
    app.js

    protocol/
      ProtocolClient.js
      WebSerialTransport.js
      WebSocketTransport.js

    components/
      editor.js
      console.js
      statusPanel.js
      configPanel.js
      firmwareInstall.js

    examples/
      blink.wrench
      analog_read.wrench
      pwm_fade.wrench

  tools/
    firmware_manifest/

  docs/
    protocol.md
    wrench_api.md
    hardware_notes.md
```

## Core Principles

- Start small and develop gradually.
- Use the Reflector project as architectural inspiration, but avoid its complexity at the beginning.
- Keep firmware responsibilities separate from script behavior.
- Make Wrench the flexible runtime layer.
- Make the browser the primary programming and debugging environment.
- Design the communication protocol independently from the transport.

## Main Elements

### ESP32 Firmware

The firmware is the stable runtime on the ESP32.

Responsibilities:

- Boot the board.
- Initialize Serial communication.
- Initialize and manage the Wrench runtime.
- Compile and run Wrench scripts.
- Expose selected hardware functions to Wrench.
- Store configuration.
- Eventually store scripts.
- Report status, logs, compile errors, and runtime errors.
- Support safe script stop/restart/recompile.
- Eventually support firmware updates from a website.

### Wrench Runtime

The Wrench layer should allow small scripts to control device behavior.

Expected script structure:

```cpp
function setup() {
}

function loop() {
}
```

Initial runtime behavior:

- Compile a Wrench script.
- Call `setup()` once.
- Call `loop()` repeatedly from Arduino `loop()`.
- Report compile errors.
- Report runtime errors.
- Allow script reset without reflashing firmware.

Early Wrench API should be minimal:

- `print(value)`
- `millis()`
- `pinMode(pin, mode)`
- `digitalWrite(pin, value)`
- `analogRead(pin)`

More APIs can be added later.

### Web Interface

The web interface is the main user-facing development tool.

It should eventually include:

- Firmware installation from the browser.
- Device connection.
- Wrench code editor.
- Upload/run/stop/restart controls.
- Console output.
- Compile error display.
- Runtime error display.
- Device status panel.
- Configuration panel.
- Example scripts.

The first browser connection should use USB through Web Serial.

### Firmware Upload From Website

The project should support installing firmware from a website.

Initial target:

- Flash ESP32 over USB from the browser.
- Use an ESP Web Tools-style flow if possible.

Future target:

- Firmware update over WiFi/OTA.

### Configuration

The web interface should provide a configuration section.

Configurable values may include:

- Device name.
- Device ID.
- WiFi SSID.
- WiFi password.
- Multiple saved WiFi networks in priority order.
- WiFi mode.
- Autorun script on boot.
- Debug logging level.
- Board profile.

Configuration is currently stored on the ESP32 as LittleFS JSON at `/config.json`.

On first boot after flashing, the firmware should create this file automatically. The stored identity should provide a collision-resistant base for later AP SSIDs, MQTT client IDs, MQTT topic prefixes, and browser-visible device labels.

There should be recovery options:

- Clear WiFi settings.
- Clear saved script.
- Factory reset configuration.

## Transport-Agnostic Protocol

The protocol must be independent of transport.

The same protocol should work over:

- USB Serial / Web Serial.
- WebSocket over WiFi.
- HTTP later, if useful.
- MQTT or BLE later, if useful.

Transport moves bytes. Protocol defines meaning.

### Message Format

Messages should be JSON.

For USB Serial, use newline-delimited JSON:

```text
{"type":"cmd","id":"1","name":"status.get","data":{}}
```

For WebSocket, the same JSON can be sent as text frames.

### Command Message

```json
{
  "type": "cmd",
  "id": "abc123",
  "name": "script.run",
  "data": {}
}
```

### Response Message

```json
{
  "type": "res",
  "id": "abc123",
  "ok": true,
  "data": {}
}
```

### Error Response

```json
{
  "type": "res",
  "id": "abc123",
  "ok": false,
  "error": {
    "code": "compile_error",
    "message": "Unexpected token",
    "line": 12,
    "column": 4
  }
}
```

### Event Message

```json
{
  "type": "evt",
  "name": "script.log",
  "data": {
    "level": "info",
    "message": "hello"
  }
}
```

### Candidate Commands

- `status.get`
- `config.get`
- `config.set`
- `wifi.status`
- `wifi.connect`
- `wifi.disconnect`
- `script.set`
- `script.save`
- `script.clear`
- `script.get`
- `script.compile`
- `script.run`
- `script.stop`
- `script.restart`
- `device.reboot`
- `device.factory_reset`

## Browser Architecture

The browser side should have a protocol client that is independent of transport.

```text
ProtocolClient
  uses Transport
```

Transport implementations:

```text
WebSerialTransport
WebSocketTransport
```

Each transport should provide:

- `connect()`
- `disconnect()`
- `send(message)`
- `onMessage(callback)`
- `onStatus(callback)`

The editor, console, config panel, and firmware tools should talk to `ProtocolClient`, not directly to Serial or WebSocket.

## Firmware Architecture

Early structure can be simple, but should grow toward:

```text
p1_embed/
  p1_embed.ino
  p1_embed_firmware.h
  wrench_runtime.cpp
  wrench_bindings.cpp
  protocol.ino
  serial_transport.ino
  wifi_manager.ino
  config.h
  config_store.ino
  script_store.ino
  json_protocol.ino
  wrenchio.cpp
  wrench.h
  wrench.cpp
```

Initial Arduino flow:

```text
setup()
  -> initialize Serial
  -> load configuration from LittleFS
  -> initialize WiFi if configured
  -> initialize Wrench
  -> compile initial script
  -> call Wrench setup()

loop()
  -> process incoming protocol messages
  -> maintain WiFi connection
  -> call Wrench loop()
  -> emit logs/status/errors
```

## Important Early Decisions

### Board Target

The first target should be a specific ESP32 Classic Arduino board profile, likely `ESP32 Dev Module`.

Need to decide:

- Exact board profile.
- Partition scheme.
- Available flash.
- Whether LittleFS is available from the start.

### Storage

Possible storage split:

- LittleFS JSON file for configuration.
- LittleFS file for larger Wrench scripts.
- Preferences/NVS for small safety latches such as saved-script run state.

The firmware currently uses `/config.json` for device and WiFi configuration, and `/wrench_code.txt` for the saved Wrench script.

### Debugging

Initial debugging should include:

- Compile errors.
- Runtime errors.
- Script `print()` output.
- Device status.
- Memory/free heap.
- Uptime.
- Script running/stopped state.

Advanced debugging can come later.

### Safety

The firmware should avoid becoming unrecoverable because of a bad script.

Consider:

- Script stop command.
- Autorun disable.
- Safe boot mode.
- Factory reset.
- Runtime error handling.
- Avoiding long blocking Wrench loops.

## Development Phases

### Phase 1: Minimal Firmware

- Arduino compile works for ESP32 Classic.
- Wrench compiles into firmware.
- Hardcoded Wrench script runs.
- Script can print.
- Script can blink a pin.

### Phase 2: Protocol Over Serial

- USB Serial receives JSON commands.
- Browser or serial monitor can send script commands.
- Firmware returns JSON responses and events.

### Phase 3: Web Editor

- Browser connects over Web Serial.
- User can edit Wrench.
- User can upload, compile, run, stop.
- Console shows logs/errors.

### Phase 4: Configuration

- Web interface can read/write device configuration.
- WiFi credentials can be configured.
- Device identity is stored.

### Phase 5: Browser Firmware Install

- Website can flash firmware over USB.
- Firmware artifacts and manifest are generated.

### Phase 6: WiFi Control

- Device can connect to WiFi.
- Browser can communicate with device over WebSocket.
- Same protocol is reused.

### Phase 7: OTA Update

- Firmware can be updated over WiFi.

## First Success Criteria

The first meaningful success should be:

- A clean Arduino firmware compiles for ESP32 Classic.
- Wrench is embedded.
- A hardcoded Wrench script runs.
- `setup()` and `loop()` work.
- `print()` emits messages.
- A GPIO pin can blink from Wrench.
