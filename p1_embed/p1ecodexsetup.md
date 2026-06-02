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

```sh
./scripts/esp32/compile.sh
./scripts/esp32/upload.sh
./scripts/esp32/monitor.sh
./scripts/esp32/read-serial.sh
./scripts/esp32/stop-serial.sh
```

For upload, the default configured port may be stale. If upload fails with a missing or busy `/dev/cu.wchusbserial...`, inspect the connected ports and use the repo scripts/env convention already present in the scripts.

After firmware changes, compile first. If upload succeeds or the installer must be updated, copy the build outputs from `/private/tmp/p1-embed-build` into `p1_embed/web/bin`:

```sh
cp /private/tmp/p1-embed-build/p1_embed.ino.bin p1_embed/web/bin/p1e-esp32-classic.app.bin
cp /private/tmp/p1-embed-build/p1_embed.ino.merged.bin p1_embed/web/bin/p1e-esp32-classic.bin
cp /private/tmp/p1-embed-build/p1_embed.ino.bootloader.bin p1_embed/web/bin/p1e-esp32-classic.bootloader.bin
cp /private/tmp/p1-embed-build/p1_embed.ino.partitions.bin p1_embed/web/bin/p1e-esp32-classic.partitions.bin
```

Then update `p1_embed/web/bin/p1e-firmware.json` to the same firmware version as `P1_EMBED_FIRMWARE_VERSION` in `p1_embed/firmware/p1_embed/config.h`.

## Versioning

- Firmware version is in `p1_embed/firmware/p1_embed/config.h`.
- Web UI version is in `p1_embed/web/app.js` as `WEB_UI_VERSION`.
- Cache-busting query strings in `p1_embed/web/index.html` and imports in `app.js` should be bumped when changing web code.
- Installer manifest version is in `p1_embed/web/bin/p1e-firmware.json`.

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
- `simplex3()`, `simplex3_01()`, `noiseSeed()`.
- Use top-level math helpers such as `map()`, `constrain()`, `sin()`, `cos()`, `sqrt()`, `pow()`, `floor()`, `ceil()`, `round()`, `abs()`, `min()`, `max()`, `radians()`, and `degrees()`.
- Wrench's namespaced math library is also available as `math::...`, but generated sketches should prefer the top-level helpers.
- `ledGetRgb(strip, index, out)`, `rgbToHsv(rgb, out)`, `hsvToRgb(hsv, out)` in hot LED loops.
- `paletteSet2/3/4` and `paletteGetRgb(slot, t, out)`.
- `touchRead(pin)` is ESP32 one-pin touch.
- `touchReadPair(drivePin, sensePin, samples, settleMicroseconds)` is the two-wire analog transfer touch helper.

Legacy scalar time and color component bindings remain registered for existing sketches, but do not generate new code that uses them.

Keep `wrench_chat_context.md` current whenever bindings change.

## LED Runtime Gotchas

The LED manager should fail gracefully:

- Uploading new code should stop the old script first.
- UI should clear when compiling/uploading a new script.
- Stopping a script should clear physical LEDs.
- Repeated binding errors should stop the script instead of flooding the console.
- If a sketch changes LED count on the same pin, it should reconfigure without reboot.
- If a sketch changes LED pin, reboot may still be required.
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
./scripts/esp32/compile.sh
```

If changing Wrench internals or bindings, consider:

```sh
python3 p1_embed/tests/wrench_host/test_wrench_optimizer.py
python3 p1_embed/tests/wrench_host/test_wrench_containers.py
python3 p1_embed/tests/serial/run_serial_tests.py
```

Only run serial/board tests when the board is connected and the serial port is free.

For unclear runtime bugs, start by adding the smallest useful logs and reproducing the problem. Avoid changing transport/protocol behavior until the logs identify the failing boundary. Make one change at a time, compile/check it, and ask for or collect a fresh verification log before continuing.

## Current Recent Work

At the time this file was written:

- Firmware was bumped to `0.1.156`.
- Installer manifest was bumped to `0.1.156`.
- `touchReadPair()` was added as an optimized two-wire analog touch helper.
- Common top-level math helpers and Arduino-like `map()`/`constrain()` were added.
- It compiled successfully.
- Upload failed because the configured serial port was unavailable or busy.
