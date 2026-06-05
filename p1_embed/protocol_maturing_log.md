# P1E Protocol Maturing Log

This log tracks the protocol architecture cleanup work around JSON, MessagePack,
serial, MQTT, and memory fragmentation. It is intentionally separate from code
comments so larger design decisions and board-test iterations remain easy to
review later.

## Direction

- Treat MessagePack/P1Frame as the canonical firmware wire format.
- Keep JSON as a serial/debug compatibility skin at the transport edge.
- Collapse duplicate command behavior so serial and MQTT do not maintain
  parallel state machines.
- Avoid broad rewrites in one pass; migrate command families in verified
  slices.
- Prefer views, bounded buffers, and single-copy storage over temporary
  Arduino `String` chains on hot paths.

## Iteration 0 - Baseline Verification

- Reread `p1ecodexsetup.md`; current normal board workflow is SafeBoot app-only
  compile/upload.
- Legacy compile was run before noticing the updated SafeBoot note.
- SafeBoot app-only compile/upload succeeded.
- Full SafeBoot USB upload was then run to restore the expected partition
  layout after the legacy upload concern.
- Raw serial listen showed healthy `device.status` events:
  - script running
  - WiFi connected to `SpaceExtreme`
  - MQTT connected

## Iteration 1 - First Restructure Slice

Changes:

- Added a small protocol-frame layer for validated P1 MessagePack command
  frames.
- Add `P1StringView` and command-frame helpers without introducing a generic
  dynamic object model.
- Move `config.set` behavior into one shared handler reached from both:
  - MQTT/WebRTC MessagePack commands
  - serial JSON commands after JSON-to-canonical-command conversion
- Start with WiFi/config as the pilot because it is easy to trace, not because
  it is the hottest memory path.

Verification:

- Host Python unit tests passed:
  - `test_wrench_containers.py`
  - `test_wrench_float_string_concat.py`
  - `test_wrench_compile_regressions.py`
  - `test_wrench_optimizer.py`
- First firmware compile exposed an Arduino `.ino` auto-prototype issue when
  shared structs lived only in `protocol.ino`; moved the shared frame/view types
  into `p1_msgpack.h`.
- SafeBoot app-only compile/upload succeeded on `/dev/cu.wchusbserial110`.
- Focused serial tests passed for:
  - `config.set` with `scriptName`
  - `config.set` with `wifiSsid`
  - WiFi reconnect/status after the setting change
- Existing serial `protocol_smoke` had a stale expectation that `status.get`
  includes `uart` and `http`; the firmware exposes those in `status.full`.

## Iteration 2 - Remove Duplicate Config State Machine

Changes:

- Removed the old unreachable MessagePack `config.set` parsing/apply branch.
- Removed the old unreachable serial JSON `config.set` parsing/apply branch.
- Kept MessagePack and JSON replies separate only at the response edge.
- Added a serial smoke test that proves JSON `config.set` is encoded into the
  canonical frame path and restores the original `scriptName` after the test.
- Updated the status smoke test to check core fields in `status.get` and
  extended UART/HTTP fields in `status.full`.

Verification:

- SafeBoot app-only compile succeeded after the duplicate-branch removal.
- App image size moved from `2002827` bytes to `2000995` bytes.
- SafeBoot app-only compile/upload succeeded on `/dev/cu.wchusbserial110`.
- Serial `protocol_smoke` passed: `4 passed, 0 failed`.
- Direct serial `config.set` of `wifiSsid` triggered reconnect; follow-up
  `wifi.status` showed connected to `SpaceExtreme` at `192.168.3.93`.

## Iteration 3 - Wider Board Test Baseline

Findings:

- Full serial suite was run once after the protocol work.
- Result: `37 passed, 21 failed`.
- The protocol smoke tests passed inside that run.
- Failures were concentrated in older Wrench/LED/error-state expectations:
  `queued` versus `running`, compile-error cases unexpectedly succeeding,
  LED/error event timing, one `script.get` no-heap case, and related stress
  behavior.
- After the broad stress run, serial became unresponsive; a SafeBoot app-only
  upload recovered the board and hard-reset it.
- A mistaken final check briefly opened two serial clients at the same time;
  that caused transient command timeouts. The same focused test was rerun
  sequentially and passed.

Final focused verification:

- SafeBoot app-only compile/upload succeeded again.
- Serial `protocol_smoke` passed sequentially: `4 passed, 0 failed`.
- Final `wifi.status` showed connected to `SpaceExtreme` at `192.168.3.93`.

MQTT verification note:

- The firmware MQTT command path now dispatches MessagePack `config.set` into
  the same shared handler as serial.
- A true live MQTT `config.set` test was not run because the local checkout has
  no MQTT client dependency (`mqtt` for Node or `paho`/`msgpack` for Python),
  and the board currently requires online-auth for non-anonymous MQTT commands.
- Anonymous MQTT cannot cover `config.set`; it is intentionally limited to
  status/system/script-input style commands.

## Iteration 4 - Shared Command Dispatcher

Changes:

- Added one shared `protocolHandleCommandFrame(...)` dispatcher for canonical
  P1 MessagePack command frames.
- Changed binary transports to parse the frame header and call the shared
  dispatcher instead of maintaining their own command state machine.
- Changed serial JSON to act as an edge adapter:
  - parse JSON command envelope
  - encode supported commands into canonical MessagePack command frames
  - call the same shared dispatcher with JSON reply mode
- Removed the duplicate serial branches for the migrated commands.
- Removed obsolete serial-only and MsgPack-only script chunk helper copies.
- Kept JSON-only or legacy serial commands in `protocolHandleLine` for now:
  - `status.get`
  - `status.full`
  - `memory.profile`
  - `memory.profile.reset`
  - `webrtc.probe`
  - `http.probe`
  - `firmware.update.prepare`
  - `script.set`
  - `script.bytecode.set`
  - `script.save`
  - `script.clear`
  - `script.compile`
  - `script.run`
  - `device.factory_reset`

Migrated through the shared dispatcher:

- `ping`
- `status.light`
- `system.info`
- `config.get`
- `config.set`
- `debug.get`
- `debug.set`
- `script.get`
- `script.chunk.get`
- `script.chunk.begin`
- `script.chunk.add`
- `script.chunk.commit`
- `script.error.get`
- `script.error.clear`
- `script.input`
- `wrench.input`
- `script.stop`
- `script.restart`
- `wifi.status`
- `wifi.connect`
- `wifi.disconnect`
- `wifi.forget`
- `device.reboot`
- `firmware.update.status`
- `firmware.update.boot`
- `firmware.update.clear`

Verification:

- SafeBoot app-only compile succeeded.
- App image size moved from `2000995` bytes to `1997535` bytes.
- Host Python unit tests passed:
  - `test_wrench_containers.py`
  - `test_wrench_float_string_concat.py`
  - `test_wrench_compile_regressions.py`
  - `test_wrench_optimizer.py`
- SafeBoot app-only compile/upload succeeded on `/dev/cu.wchusbserial110`.
- Serial `protocol_smoke` passed: `4 passed, 0 failed`.
- Serial `debug.set` returned the expected debug status through the shared
  dispatcher path.
- Serial `print_and_inbox` passed: `2 passed, 0 failed`.
- Serial chunk upload probe passed through `script.chunk.begin/add/commit`.
  The uploaded LED test script then hit an existing LED geometry runtime error;
  that was cleared with `script.stop` and `script.error.clear`.
- Final serial `protocol_smoke` passed again: `4 passed, 0 failed`.
- Final `wifi.status` showed connected to `SpaceExtreme` at `192.168.3.93`.

## Iteration 5 - Status Full/Live Split

Changes:

- Added canonical MessagePack opcodes for:
  - `status.get`
  - `status.full`
  - `status.live`
- Moved `status.get` and `status.full` out of the serial JSON fallback path
  and into the shared command dispatcher.
- Added `status.live` as the polling/event-sized status surface. It carries
  volatile state such as heap, script/loop state, last script error, and WiFi,
  while omitting repeated/static diagnostic blocks like MQTT, WebRTC, LED,
  memory history, `uart`, `http`, and `debug`.
- Kept `status.full` as the connect-time diagnostic snapshot. It preserves the
  existing full status information including `uart` and `http`.
- Added a single transitional JSON-object-to-MessagePack writer inside
  `protocol.ino`. Legacy subsystem status helpers such as MQTT, memory, LED,
  UART, and HTTP still produce JSON strings, but those conversions now happen
  in one protocol adapter rather than throughout call sites.
- Changed periodic `device.status` emission to publish a direct MessagePack
  event payload on binary transports and keep the existing JSON event for USB.
- Updated the web UI startup path:
  - connect-time status uses `status.full`
  - polling uses `status.live`
- Changed web startup script synchronization to use `script.chunk.get` for USB
  as well as binary transports, avoiding the large `script.get` heap allocation
  that caused USB startup checks to fail.
- Added serial smoke coverage for the full/live split.

Verification:

- Host Python unit tests passed:
  - `test_wrench_optimizer.py`
  - `test_wrench_containers.py`
- SafeBoot app-only compile succeeded.
- App image size: `2003248 / 2293760` bytes.
- SafeBoot app-only compile/upload succeeded on `/dev/cu.wchusbserial110`.
- Serial `protocol_smoke` passed after upload: `4 passed, 0 failed`.
- Direct USB `status.full` returned full diagnostics including `uart` and
  `http`.
- Direct USB `status.live` returned the smaller live status without MQTT,
  WebRTC, LED, memory history, `uart`, and `http`.
- Direct USB `script.chunk.get` returned a script chunk successfully.
- Serial `print_and_inbox` passed: `2 passed, 0 failed`.
- Updated serial `protocol_smoke` passed again with `status.live` assertions:
  `4 passed, 0 failed`.
- A final app-only fast upload test with `ESP32_BAUD=921600` succeeded and
  verified the flash hash. Upload time dropped from `98.2` seconds to `16.8`
  seconds for the same app image.
- Updated SafeBoot upload scripts to default to `ESP32_UPLOAD_BAUD=921600`
  while leaving runtime serial `ESP32_BAUD=115200` by default. Existing
  `ESP32_BAUD=...` upload overrides still work unless `ESP32_UPLOAD_BAUD` is
  set explicitly.
- Final USB `ping` returned `pong` after the fast upload.
- After testing newer web UI against an older firmware, the UI could show a
  stale `status.full` timeout after disconnecting and reconnecting elsewhere.
  Added web-side pending request cancellation on transport disconnect/drop and
  bumped the web cache tag to `0.1.87-ui337`. This is cleanup for ghost logs,
  not legacy opcode fallback.
- USB web startup correctly used `script.chunk.get`, but the JSON chunk response
  was missing `revisionId` and `scriptName` while the MessagePack chunk response
  already had them. This caused USB downloads to create `Revision 1` even when
  MQTT recognized the sketch name. Added those metadata fields to the JSON
  chunk response and added serial smoke coverage.
- This exposed the next architectural cleanup target: command dispatch is now
  shared, but some response encoding still has JSON-vs-MessagePack duplication.
  The next protocol maturity pass should introduce shared response data writers
  or schema-backed response views for commands such as `script.chunk.get`.

## Iteration 6 - Shared Response View Pilot

Changes:

- Refactored `script.chunk.get` response construction to use one shared
  `P1ScriptChunkGetResponse` data view.
- Both USB/JSON and MQTT/MessagePack responses now serialize the same response
  fields from that view:
  - `offset`
  - `nextOffset`
  - `scriptBytes`
  - `done`
  - `chunk`
  - `state`
  - `runState`
  - `revisionId`
  - `scriptName`
- Removed the older MessagePack-only `script.chunk.get` implementation so there
  is no stale parallel chunk slicing/metadata path.

Verification:

- SafeBoot app-only compile succeeded.
- App image size: `2003360 / 2293760` bytes.
- SafeBoot app-only upload succeeded at `921600` baud and verified the flash
  hash.
- Serial `protocol_smoke` passed with the chunk metadata assertion:
  `5 passed, 0 failed`.
- Direct USB `script.chunk.get` returned `scriptName: "Hourglass 11"` and
  `revisionId: "rev-73a84891-b935-4083-898e-f4edb0706436"`.

Notes:

- This is the response-side pattern to repeat for `config.get` and the status
  surfaces: build one response view, then make JSON and MessagePack thin edge
  encoders.

## Iteration 7 - Config Response Encoding

Changes:

- Moved protocol `config.get` JSON response construction out of
  `configAsJson()` and into `protocol.ino`.
- Added protocol-owned config response encoders:
  - `protocolConfigResponseJson(const P1ConfigSnapshot&)`
  - `protocolMsgPackWriteConfigResponse(...)`
- Both USB/JSON and MQTT/MessagePack `config.get` now serialize the same
  `P1ConfigSnapshot` plus the same accessor-backed arrays:
  - `onlineAuthUsers`
  - `wifiNetworks`
- `configAsJson()` remains for non-protocol compatibility such as Wrench
  bindings, but `config.get` no longer uses it.
- `config.set` success responses also return through the shared
  `protocolSendCommandConfig(...)` path.

Verification:

- SafeBoot app-only compile succeeded.
- App image size: `2006016 / 2293760` bytes.
- SafeBoot app-only upload succeeded at `921600` baud and verified the flash
  hash.
- Serial `protocol_smoke` passed: `5 passed, 0 failed`.
- Direct USB `config.get` returned project/script metadata, MQTT settings,
  `onlineAuthUsers`, `wifiNetworks`, and WiFi status.
- Direct USB `script.chunk.get` still returned `scriptName: "Hourglass 11"` and
  the expected board `revisionId`.

Notes:

- This is a halfway step for config: protocol no longer depends on
  `configAsJson()`, but the config snapshot itself still stores only counts for
  auth users and WiFi networks. A later pass can make those arrays fully typed
  in the snapshot if we want to eliminate accessor calls from protocol encoders.

Notes:

- MQTT binary should now be able to request `status.full` and `status.live`
  because the web encoder has opcodes for both and the firmware dispatcher
  handles both. I did not run a clean MQTT-only probe in this iteration; the
  available probes are browser/WebRTC oriented rather than a simple command
  check.
- The transitional JSON-to-MessagePack bridge should be retired later by giving
  each subsystem a direct status writer or schema-backed status view. The
  important architectural constraint is now established: edge adapters convert
  into or out of the shared command/status protocol in one place.

## Iteration 8 - MQTT Config Set Diagnostics

Changes:

- Split online-auth user validation into exact firmware result codes:
  - `missing_online_user`
  - `bad_online_key`
  - `online_user_limit`
- Kept the older boolean `configAddOnlineAuthUserKey(...)` wrapper for existing
  non-protocol callers.
- Updated shared `config.set` handling to return the exact validation error
  instead of the previous generic `bad_online_user` response.
- Added `onlineAuthUserMax` to `config.get` JSON and MessagePack responses.
- Added a web-side guard that blocks adding a new online user when the table is
  full while still allowing an existing user to be updated.
- Bumped the web cache tag to `0.1.87-ui338`.
- Deferred MQTT transport reconfiguration after auth/user changes so the
  `config.set` response has a chance to flush before sessions are cleared and
  the MQTT client reconnects.

Verification:

- SafeBoot app-only compile succeeded.
- App image size: `2006672 / 2293760` bytes.
- SafeBoot app-only upload succeeded at `921600` baud and verified the flash
  hash.
- Serial `protocol_smoke` passed: `5 passed, 0 failed`.
- Direct USB bad-key probe returned
  `bad_online_key Online user key must be 64 hex characters`.
- Direct USB `config.get` returned `onlineAuthUserCount: 4` and
  `onlineAuthUserMax: 4`.
- Direct USB fifth-user probe returned
  `online_user_limit Online user limit reached`.
- Host Wrench Python tests passed:
  - `test_wrench_optimizer.py`
  - `test_wrench_containers.py`
- `git diff --check` passed.

Notes:

- The latest observed web error was an explicit `config.set` validation error,
  not a reset/backtrace. The earlier timeout remains consistent with immediate
  MQTT reconfiguration closing the response path, but should be verified with
  a fresh MQTT add-user attempt while serial is watched.

## Iteration 9 - Online User Actions Do Not Own Login

Changes:

- Stopped treating online-auth user add/remove as MQTT transport
  reconfiguration. Existing MQTT sessions are left alone; new credentials are
  picked up when a client signs in.
- Removed the web-side coupling where adding an online user replaced the
  browser's remembered MQTT login.
- Removed the web-side coupling where removing any online user cleared the
  browser's remembered MQTT login.
- Made the MQTT sign-in dialog submit as a real form, so Return submits from
  the password field.
- Disabled shared username autocomplete wiring between the add-user fields and
  the MQTT sign-in fields.
- Bumped the web cache tag to `0.1.87-ui339`.

Verification:

- SafeBoot app-only compile succeeded.
- App image size: `2006688 / 2293760` bytes.
- SafeBoot app-only upload succeeded at `921600` baud and verified the flash
  hash.
- Serial `protocol_smoke` passed: `5 passed, 0 failed`.
- Serial watch after upload showed script startup/running, WiFi connected, Home
  Assistant connected, and no reset/backtrace.
- Host Wrench Python tests passed:
  - `test_wrench_optimizer.py`
  - `test_wrench_containers.py`
- `git diff --check` passed.

Notes:

- I did not add/remove real online users during verification because the board
  currently contains real user entries and the table is full. The behavior was
  verified by code path inspection plus compile/upload/smoke/serial health.

## Iteration 10 - Preserve Remembered Login On Unknown User

Changes:

- Confirmed the observed forced sign-in came through the MQTT `unknown_user`
  auth error path.
- Stopped clearing the browser's remembered online auth immediately when a
  background `unknown_user` or `auth_failed` frame arrives.
- Remembered auth is now cleared only by the explicit force-prompt sign-in
  path, not by a background auth rejection.
- Added a web guard that prevents removing the online user currently remembered
  by this browser. Sign in as another user first, then remove the old one.
- Bumped the web cache tag to `0.1.87-ui340`.

Verification:

- SafeBoot app-only compile/upload succeeded at `921600` baud and verified the
  flash hash.
- Serial `protocol_smoke` passed: `5 passed, 0 failed`.
- Serial watch after upload showed periodic status, WiFi connected, and no
  reset/backtrace.

Notes:

- If the browser was already polluted by the older add-user behavior, it may
  still remember a user that no longer exists on the board. This change stops
  the silent clearing and prevents deleting the currently remembered user from
  the UI, but the browser may need one explicit sign-in as the intended user to
  repair old localStorage state.

## Iteration 11 - Wrench Runtime Status Snapshot

Changes:

- Added typed Wrench runtime status structures:
  - `P1WrenchRuntimeSnapshot`
  - `P1WrenchAllocStats`
- Added `wrenchRuntimeSnapshot()` as the source of truth for Wrench runtime
  diagnostics.
- Kept `wrenchRuntimeStatusJson()` for compatibility, but changed it to encode
  the typed snapshot instead of reading globals directly.
- Added direct MessagePack encoders for:
  - Wrench runtime status
  - reusable buffer status
  - Wrench allocation stats
- Replaced the `wrenchRuntimeStatusJson() -> JSON parse -> MessagePack` bridge
  in `status.get` and `status.full`.
- Tightened serial smoke tests to assert nested `wrenchRuntime` fields remain
  present.

Verification:

- SafeBoot app-only compile/upload succeeded at `921600` baud and verified the
  flash hash.
- App image size: `2007920 / 2293760` bytes.
- Serial `protocol_smoke` passed: `5 passed, 0 failed`.
- Host Wrench Python tests passed:
  - `test_wrench_optimizer.py`
  - `test_wrench_containers.py`
- `git diff --check` passed.
- Serial watch after upload showed periodic status, WiFi connected, and no
  reset/backtrace.

Notes:

- This is the pattern for the remaining status JSON bridges: introduce a typed
  snapshot, keep JSON as compatibility encoding, and use direct MessagePack for
  protocol responses.

## Iteration 12 - Serial MessagePack Mode And JSON Projection

Changes:

- Added a serial protocol mode command: `protocol.mode`.
- Serial defaults to JSON line mode for Python tests and human debugging.
- Serial can switch to framed MessagePack mode using:
  - magic: `P1MP`
  - length: 16-bit big-endian payload length
  - payload: canonical P1 MessagePack command frame
- Added `transportSendMsgPackBytes()` so the same MessagePack responses/events
  can be emitted on serial when binary mode is active.
- Added source-aware protocol dispatch context:
  - serial
  - websocket
  - mqtt
  - webrtc
- Kept the command dispatcher unified, but guarded `protocol.mode` so MQTT and
  WebRTC cannot accidentally flip the USB serial framing.
- Added a firmware MessagePack-to-JSON projection helper.
- Moved JSON `status.get`, `status.full`, and `status.live` responses onto the
  same canonical MessagePack status payload writers used by binary transports.
  JSON is now an edge/debug projection for these status commands rather than a
  separate status-generation path.
- Added a typed `P1MemoryProfileSummary` so status MessagePack no longer parses
  memory summary from JSON.
- Extended the Python serial harness with a minimal stdlib MessagePack encoder
  and decoder for protocol smoke tests.
- Added `test_serial_msgpack_mode.py` covering:
  - JSON -> MessagePack serial mode switch
  - MessagePack `ping`
  - MessagePack `status.live`
  - MessagePack -> JSON switch-back in cleanup

Verification:

- SafeBoot app-only compile/upload succeeded at `921600` baud and verified the
  flash hash.
- App image size: `2010064 / 2293760` bytes.
- Serial `protocol_smoke` passed: `5 passed, 0 failed`.
- Serial `serial_msgpack_mode` passed: `1 passed, 0 failed`.
- Host Wrench Python tests passed:
  - `test_wrench_optimizer.py`
  - `test_wrench_containers.py`
- `git diff --check` passed.
- Serial watch after upload showed `device.status`, WiFi connected, and no
  reset/backtrace.

Notes:

- This is the cleaner long-term rule: build canonical typed payloads as
  MessagePack, then project JSON centrally for serial/debug/unit-test consumers.
- Remaining JSON builders should be retired by moving each response/event onto
  typed payload writers, then using the central projection for JSON transport
  compatibility.
- Wrench script-facing JSON helpers can stay as explicit user/script API
  helpers; they should not be used as protocol internals.

## Iteration 13 - Web USB Uses Serial MessagePack

Changes:

- Added raw byte support to the shared `PortalUsbSerial` browser helper:
  - `sendBytes(bytes)`
  - `setRawMode(enabled)`
  - `onBytes(bytes)` callback
- Added `P1MP` framed MessagePack support to `WebSerialTransport`.
- Web USB now connects in JSON line mode, sends `protocol.mode` with
  `mode=msgpack`, then switches the browser serial transport to raw framed
  MessagePack.
- Once the USB binary channel is open, the existing web `sendCommand()` path
  uses `ProtocolClient.requestMsgPack()` and the shared `P1MsgPack.js`
  encoder/decoder, just like MQTT/WebRTC.
- USB script upload now uses binary chunk payloads after the serial MsgPack
  handshake succeeds.
- Bumped the web cache tag to `0.1.87-ui342`.

Verification:

- JavaScript syntax checks passed:
  - `node --check p1_embed/web/protocol/WebSerialTransport.js`
  - `node --check p1_embed/web/app.js`
  - `node --check P1/portal/usbSerial.js`
- Node framing probe passed for split `P1MP` serial frames.
- Serial `serial_msgpack_mode` passed on hardware: `1 passed, 0 failed`.
- Serial `protocol_smoke` passed on hardware after the binary test returned
  the board to JSON mode: `5 passed, 0 failed`.
- `git diff --check` passed.

Notes:

- Browser Web Serial permission/user flow still needs manual browser testing.
- Expected browser console sequence is JSON connect, `protocol.mode`, then
  `USB binary channel open`; after that status/config/script traffic should be
  MessagePack over USB.

## Iteration 14 - Remove Wrench Runtime JSON Builder

Changes:

- Removed `wrenchRuntimeStatusJson()`.
- Removed the private `wrenchAllocStatsJson()` helper that only existed to
  support `wrenchRuntimeStatusJson()`.
- Removed the public firmware header declaration for Wrench runtime JSON.
- Kept `wrenchRuntimeSnapshot()` as the Wrench runtime source of truth.
- Status JSON helpers now write the canonical MessagePack status payload and
  project it to JSON centrally:
  - `protocolStatusJson()`
  - `protocolStatusFullJson()`
  - `protocolStatusEventJson()`
- This means `wrenchRuntime` in JSON status/event output is generated from the
  same MessagePack writer used by binary transports, not from a Wrench-owned
  Arduino `String` builder.

Verification:

- SafeBoot app-only compile/upload succeeded at `921600` baud and verified the
  flash hash.
- App image size: `2005088 / 2293760` bytes.
- Serial `protocol_smoke` passed: `5 passed, 0 failed`.
- Serial `serial_msgpack_mode` passed: `1 passed, 0 failed`.
- Host Wrench Python tests passed:
  - `test_wrench_optimizer.py`
  - `test_wrench_containers.py`
- `git diff --check` passed.

Notes:

- JSON still exists at the serial/debug/event transport edge where needed, but
  Wrench runtime no longer owns any JSON serialization path.
- The same pattern should be applied to the remaining subsystem status helpers:
  typed snapshot, direct MessagePack writer, optional central JSON projection.

## Iteration 15 - Subsystem Status Snapshots

Changes:

- Added typed subsystem snapshots for:
  - web transport
  - MQTT transport
  - WebRTC transport
  - LED manager
  - UART manager
  - HTTP fetch
  - OTA SafeBoot
- Moved protocol status payloads away from `*StatusJson()` bridges for those
  subsystems. `status.get`, `status.full`, and `status.live` now use direct
  MessagePack writers for the subsystem blocks and only project to JSON at the
  protocol edge when a JSON response/event is needed.
- Changed protocol-owned JSON helper responses for WiFi/debug/OTA to project
  from the same MessagePack payloads used by binary responses.
- Changed the HTTP probe and JSON `config.get` response path to embed WiFi/HTTP
  status through protocol-local MessagePack-to-JSON projection instead of
  directly calling subsystem `*StatusJson()` builders.
- Kept the remaining `*StatusJson()` functions as compatibility wrappers for
  Wrench/script/debug helper APIs. They are no longer the protocol's internal
  status serialization path.

Verification:

- SafeBoot app-only compile/upload succeeded at `921600` baud and verified the
  flash hash.
- App image size: `2001344 / 2293760` bytes.
- Serial `protocol_smoke` passed after upload: `5 passed, 0 failed`.
- Serial `serial_msgpack_mode` passed after upload: `1 passed, 0 failed`.
- Host Wrench Python tests passed:
  - `test_wrench_optimizer.py`
  - `test_wrench_containers.py`
- `git diff --check` passed.

Notes:

- Two serial test suites were briefly run in parallel and both timed out on
  `script.error.clear`; rerunning them sequentially passed. The failure was test
  port contention, not a firmware regression.
- Remaining direct `*StatusJson()` callers are in Wrench/script compatibility
  bindings and the lower-level config JSON helper. They should be treated as
  human/debug API wrappers, not canonical protocol paths.
