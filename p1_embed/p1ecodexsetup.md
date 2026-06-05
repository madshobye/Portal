# P1E Codex Setup

This is the short handoff for starting a blank Codex thread on the P1E work.

## Repository

- Workspace root: `/Users/madshobye/Media/codeRepo`
- Main repo: `/Users/madshobye/Media/codeRepo/Portal`
- P1E app root: `/Users/madshobye/Media/codeRepo/Portal/p1_embed`
- Firmware: `/Users/madshobye/Media/codeRepo/Portal/p1_embed/firmware/p1_embed`
- Web app: `/Users/madshobye/Media/codeRepo/Portal/p1_embed/web`
- Web installer binaries: `/Users/madshobye/Media/codeRepo/Portal/p1_embed/web/bin`
- AI prompt/context doc: `/Users/madshobye/Media/codeRepo/Portal/p1_embed/web/wrench_chat_context.md`

## Current Direction

P1E is an alpha-stage ESP32 creative coding environment:

- Wrench is the current scripting runtime.
- The browser editor stores projects with revisions.
- AI view combines chat and specification editing.
- Circuit and UI views are part of the same project concept.
- USB is trusted and unencrypted.
- MQTT is the main wireless transport for now.
- WebRTC and WebSocket code may still exist but should stay hidden/commented out in the UI for alpha unless explicitly revived.

The preferred architecture is:

- structured internal firmware state
- MessagePack for binary transports such as MQTT
- JSON only as final translation for serial/debug compatibility
- no new legacy compatibility unless explicitly requested

## Common Commands

Run from `/Users/madshobye/Media/codeRepo/Portal`.

For normal P1E firmware iteration on a board that already has the SafeBoot partition layout, use the app-only SafeBoot command:

```sh
./scripts/esp32/p1embed-safeboot-app-compile-upload.sh
```

This compiles the main app and flashes only the app slot at `0x120000`. Do not use the older `p1embed-compile.sh` / `p1embed-upload.sh` path for current SafeBoot boards unless explicitly working on the pre-SafeBoot profile.

For serial observation:

```sh
./scripts/esp32/p1embed-monitor.sh
./scripts/esp32/p1embed-listen.sh raw 30
./scripts/esp32/p1embed-read-serial.sh
./scripts/esp32/p1embed-stop-serial.sh
```

The P1 Embed wrappers default to the classic ESP32 profile. They use `/dev/cu.wchusbserial10` when present and otherwise auto-pick the latest `/dev/cu.wchusbserial*`, `/dev/cu.usbserial*`, or `/dev/cu.usbmodem*` device. Override with `ESP32_PORT=/dev/cu...` only when multiple boards are connected and the auto-pick is wrong.

For normal serial observation and HA debugging, use the raw listener:

```sh
./scripts/esp32/p1embed-listen.sh raw 120
```

The P1E firmware emits JSON protocol/debug lines at 115200 baud. `p1embed-listen.sh raw` uses `p1_embed/tools/p1_serial_repl.py --raw-listen` and should be the default when watching board behavior, Home Assistant reloads, MQTT reconnects, or Wrench print output. Use decoded mode only for protocol-only event streams:

```sh
./scripts/esp32/p1embed-listen.sh decoded 30
```

Avoid raw `cat` unless deliberately inspecting transport bytes; it can make mixed serial output look like a baud-rate problem.

Use full SafeBoot USB upload only for first install, recovery, partition table changes, or updater changes:

```sh
./scripts/esp32/p1embed-safeboot-upload.sh
```

Use the deploy script only when intentionally minting an official versioned OTA release. It updates `P1_EMBED_FIRMWARE_VERSION`, current USB installer files, versioned release files, delta patches, and SafeBoot manifests together:

```sh
DETOOLS=/private/tmp/p1e-detools-venv/bin/detools ./scripts/esp32/p1embed-safeboot-deploy.sh \
  --from <previous-deploy-version> \
  --to <next-deploy-version>
```

## Versioning

- Firmware version is in `p1_embed/firmware/p1_embed/config.h`.
- Web UI version is in `p1_embed/web/app.js` as `WEB_UI_VERSION`.
- Cache-busting query strings in `p1_embed/web/index.html` and imports in `app.js` should be bumped when changing web code.
- SafeBoot USB installer manifest version is in `p1_embed/web/bin/p1e-firmware-safeboot.json`.
- OTA release chain is in `p1_embed/web/bin/p1e-firmware-releases.json`.

## User Preferences

- Prefer implementation over long proposals.
- Keep alpha code clean; do not preserve old structures just for legacy.
- Use `apply_patch` for manual edits.
- Use `rg` before slower search tools.
- Do not revert user changes.
- Do not hide root causes behind generic errors.
- When debugging an unknown problem, seek the root cause before changing behavior.
- Prefer slow, incremental changes with verification after each step; the system is often already working well in other situations, and broad changes can break those cases.
- Prioritize targeted log/trace output before making functional changes.
- For debugging work, suggest a brief plan first and verify observations before changing many elements.
- When firmware changes affect the board, compile and usually upload if a board is available.
- When installer firmware should be current, update the web binaries and manifest.
- Keep final answers short and concrete.

## Current Transport Model

MQTT binary transport is the active wireless path.

Typical MQTT topics:

- `p1e/<root>/<deviceId>/cmd`
- `p1e/<root>/<deviceId>/res/<clientId>`
- `p1e/<root>/<deviceId>/evt`
- `p1e/<root>/<deviceId>/hello`

Default root should be simple and board-specific, for example `p1-embed-f7a608`. Avoid `lab` or personal names in defaults.

Security model:

- USB is trusted.
- MQTT online users authenticate with username/password-derived keys.
- Session keys are tied to users and should fail if the user is deleted.
- Guest UI can be enabled separately from guest script.
- Guest UI links use a share key, not a full privileged login.

## Project And Revision Model

The browser history should be project-based:

- Project has an id, name, revisions, and active revision.
- Revision has code, name, specification, circuit JSON, chat history, source, created time, and bytes.
- Chat is revision-specific.
- Specification is revision-specific.
- Download should export a project JSON.
- Dropping a `.txt` or Wrench file should create a project around it and use the filename as the name.
- Re-uploading an identical project in the same browser should create a new id/name if needed rather than colliding.

Important behavior:

- New Project asks for a project name.
- New Revision should ask for a revision name.
- Uploading unchanged selected code should not create duplicate revisions.
- Old history structures can be dropped or one-time migrated; clean structure matters more.

## Wrench Runtime Notes

Use Wrench case style:

- `pinMode(pin, OUTPUT)`, not string modes.
- `digitalWrite(pin, HIGH)`, not string values.
- `timeLocal(out)` or `timeLocal()` for `[year, month, day, hour, minute, second]`.
- `sunLocal(lat, lon, out)` or `sunLocal(lat, lon, unixSeconds, out)` for `[elevationDeg, azimuthDeg, brightness, kelvin]`.
- `simplex3()`, `simplex3_01()`, `noiseSeed()`.
- Use top-level math helpers such as `map()`, `constrain()`, `sin()`, `cos()`, `sqrt()`, `pow()`, `floor()`, `ceil()`, `round()`, `abs()`, `min()`, `max()`, `radians()`, and `degrees()`.
- Wrench's namespaced math library is also available as `math::...`, but generated sketches should prefer the top-level helpers.
- `ledGetRgb(strip, index, out)`, `rgbToHsv(rgb, out)`, `hsvToRgb(hsv, out)` in hot LED loops.
- `ledConfig(strip, pin, count, brightness)` configures a WS2812B/NeoPixel-style strip with default GRB packing.
- `ledConfig(strip, pin, count, brightness, "WS2812B", order)` may be used only when the sketch needs explicit color order: `RGB`, `RBG`, `GRB`, `GBR`, `BRG`, or `BGR`. Do not generate non-WS2812B chipsets in normal sketches; extended chipset support is disabled in the default firmware to preserve RAM.
- `paletteSet2/3/4` and `paletteGetRgb(slot, t, out)`.
- `touchRead(pin)` is ESP32 one-pin touch.
- `touchReadPair(drivePin, sensePin, samples, settleMicroseconds)` is the two-wire analog transfer touch helper.

Legacy scalar time and color component bindings remain registered for existing sketches, but do not generate new code that uses them.

Float arithmetic, float arrays, and direct `println(floatValue)` work on the board. Avoid generating `"label=" + floatValue` or other string concatenation with floats; serial tests showed that path can print integer-looking garbage even when the underlying float value is valid.

Keep `wrench_chat_context.md` current whenever bindings change.

## LED Runtime Gotchas

The LED manager should fail gracefully:

- Uploading new code should stop the old script first.
- UI should clear when compiling/uploading a new script.
- Stopping a script should clear physical LEDs.
- Repeated binding errors should stop the script instead of flooding the console.
- If a sketch changes LED count on the same pin, it should reconfigure without reboot.
- If a sketch changes LED pin, reboot may still be required. Color order changes are live because they are handled by P1E byte packing.
- If a new sketch does not call `ledConfig()` but uses LED calls, it should stop with a clear error.

Do not just say “reboot”; try to identify whether the issue is pin change, missing `ledConfig`, invalid index, or heap/runtime failure.

## Known Memory Themes

Wrench compilation can need much more contiguous heap than the final running script.

Watch for:

- `not enough contiguous heap to compile safely`
- `compile failed: malloc_failed`
- `runtime load failed: malloc_failed`
- array-heavy code
- float-heavy code
- many functions plus UI bindings
- MQTT/Web/UI traffic during compile

Do not replace weird Wrench compile errors with a generic heap preflight unless the root is actually heap. There have been real parser/array/optimizer issues before.

## SafeBoot OTA Notes

SafeBoot delta OTA is experimental. Generate detools in-place patches with `scripts/esp32/p1embed-delta-patch.sh`; it pads app images with `0xff` to the 4096-byte segment boundary before hashing and patching. This avoids ESP32 flash rejecting a final partial-sector erase. Verify patches with `p1_embed/tests/detools_host/detools_in_place_probe.c` before trying them on the board.

Do not assume `code=-1 Function not implemented` from the updater means detools lacks a feature. Raw callback `-1` also maps to that text. The updater callbacks should return specific detools errors such as `-DETOOLS_IO_FAILED`.

The embedded detools C applier still has an explicit unsupported `dfpatch` branch. Current sector-padded test patches avoid it. Keep implementing `dfpatch` support on the future list if patch generation ever needs it.

## Console Levels

The firmware should decide what level of communication it sends where possible. Avoid relying on client-side filtering for operational state.

Good split:

- user-facing progress and errors as info/error
- transport chatter as debug
- UI item dumps as debug
- state/progress events must still reach the UI even when console is in info mode

## UI And Settings

Settings has tabs:

- General
- WiFi
- MQTT
- Users
- AI

Use human wording:

- “WiFi name”, not SSID in visible UI.
- “Online sign-in users”, not MQTT users.
- Guest UI and Guest script are access concepts, not MQTT-only concepts.

AI settings include:

- model
- refresh models
- max output tokens
- API key
- encrypted key share
- specification detail level
- prompt debug

## Frontend UX Notes

- Keep iOS top bar compact; P1E must not overlap buttons.
- Buttons/dropdowns in toolbars should have consistent height.
- Avoid blue focus borders where they look accidental.
- Status bar should show board name, active transport (`USB` or `MQTT`), state, fps rounded to integer, WiFi name, and memory percent without the word `mem`.
- Info panel QR/connect list should only show currently available connection options.
- When disconnected, UI view should be grey/disabled or empty rather than noisy.

## Tests And Verification

Minimum checks after web edits:

```sh
node --check p1_embed/web/app.js
git diff --check -- p1_embed/web/app.js p1_embed/web/index.html p1_embed/web/style.css
```

Minimum checks after firmware edits:

```sh
./scripts/esp32/p1embed-safeboot-app-compile.sh
```

If changing Wrench internals or bindings, consider:

```sh
python3 p1_embed/tests/wrench_host/test_wrench_optimizer.py
python3 p1_embed/tests/wrench_host/test_wrench_containers.py
python3 p1_embed/tests/serial/run_serial_tests.py
```

Only run serial/board tests when the board is connected and the serial port is free.

For unclear runtime bugs, start by adding the smallest useful logs and reproducing the problem. Avoid changing transport/protocol behavior until the logs identify the failing boundary. Make one change at a time, compile/check it, and ask for or collect a fresh verification log before continuing.

## SafeBoot OTA Notes

The SafeBoot delta OTA flow is intentionally split into phases:

- `firmware.update.prepare` validates and stores the URL, patch hash, source/target hashes, and delta sizing metadata.
- The stored request is first marked `downloadPending`, not `pending`.
- If `reboot:true` is supplied, the main app reboots back into the main app first.
- Very early in app boot, after WiFi starts but before MQTT/WebRTC/HA and before Wrench autorun, `otaSafeBootHandleBootDownload()` checks `downloadPending`.
- That early download mode waits briefly for WiFi, downloads the patch over HTTP/HTTPS into the `patch` partition, verifies SHA-256, then marks the request `pending`.
- Only after the patch is downloaded and verified does the app select the `updater` partition and reboot into it.
- The updater applies the already-downloaded patch and clears the request.

Current 4 MB SafeBoot layout uses a `0x60000` patch partition and a `0x30000`
LittleFS partition. Changing this layout requires a full USB/browser install,
not an app-only OTA.

Do not boot directly into the updater while `downloadPending` is true. The updater expects a verified patch already present in the patch partition.

HTTPS needs a large contiguous heap block. Testing showed normal Wrench script runtime could leave only about 35 KB largest allocation and fail TLS with `SSL - Memory allocation failed`. With the OTA download running before Wrench autorun, largest allocation was about 94 KB and HTTPS worked.

For quick firmware experiments on a board that already has the SafeBoot partition layout, use the app-only script:

```sh
./scripts/esp32/p1embed-safeboot-app-compile-upload.sh
```

This compiles only the main app partition and flashes only `0x120000`. It does not rebuild or flash the updater partition, does not touch bootloader/partitions, does not bump `P1_EMBED_FIRMWARE_VERSION`, and does not update OTA manifests. Use it for local testing, not official releases.

For official OTA/release experiments where a versioned delta and manifest are part of the test, use the deploy script and test the generated release manifest through the web UI:

```sh
DETOOLS=/private/tmp/p1e-detools-venv/bin/detools ./scripts/esp32/p1embed-safeboot-deploy.sh \
  --from <previous-deploy-version> \
  --to <next-deploy-version>
```

SafeBoot release deploys must go through that one command so versions, binaries, delta patches, and manifests stay in sync. Use `--force` only when intentionally replacing the same not-yet-committed deploy version:

```sh
DETOOLS=/private/tmp/p1e-detools-venv/bin/detools ./scripts/esp32/p1embed-safeboot-deploy.sh \
  --from <previous-deploy-version> \
  --to <next-deploy-version> \
  --force
```

The deploy script writes `p1_embed/web/bin/p1e-firmware-releases.json` for OTA deltas and `p1_embed/web/bin/p1e-firmware-safeboot.json` for full USB installation. OTA release URLs in committed manifests should stay relative to `p1_embed/web/bin`; the browser resolves them from the current web utility location before asking the ESP32 to download. The web Install page stays the manual USB install/recovery path and uses the SafeBoot manifest. OTA updates live in Settings -> Firmware as an explicit test panel; it only enables the update button when the connected board reports a firmware version with an exact delta entry in the release manifest. If a board is several versions behind, update one delta step at a time. If no delta path exists, use USB install.

Keep `p1_embed/web/bin` tidy:

- Current USB SafeBoot installer files live directly in `p1_embed/web/bin` as `p1e-esp32-classic-safeboot.*` plus `p1e-firmware-safeboot.json`.
- Official versioned app/updater/delta artifacts live under `p1_embed/web/bin/releases/`.
- Do not commit one-off scratch patches in the top-level `web/bin` directory.
