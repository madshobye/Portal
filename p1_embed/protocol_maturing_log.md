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

## Iteration 16 - Hard Wrench Binding Cleanup

Changes:

- Removed Wrench's JSON status/config telemetry surface:
  - `statusGet`
  - `configGet`
  - `wifiStatus`
  - `serialStatus`
  - `httpStatus`
  - `ledStatus`
- Added explicit scalar script helpers for simple information:
  - `uptimeMs`
  - `minFreeHeap`
  - `scriptState`
  - `loopCount`
  - `deviceId`
  - `deviceName`
  - `timezone`
  - `wifiNetworkCount`
- Removed legacy scalar compatibility helpers:
  - `timeLocalHour`, `timeLocalMinute`, `timeLocalSeconds`
  - `timeLocalDay`, `timeLocalMonth`, `timeLocalYear`
  - `ledGetR`, `ledGetG`, `ledGetB`
  - `hsvToR`, `hsvToG`, `hsvToB`
  - `rgbToH`, `rgbToS`, `rgbToV`
  - `paletteGetR`, `paletteGetG`, `paletteGetB`
- Removed the vendored Wrench `wr_loadFastLEDLib()` hook and its
  `fastled::...` registrations. P1 scripts now use only the `led*` API.
- Removed dead module-owned status JSON builders and declarations:
  - reusable buffer
  - debug events
  - WiFi
  - config store `configAsJson`
  - UART
  - HTTP fetch
  - LED
  - websocket transport
  - MQTT transport
  - WebRTC transport
  - OTA SafeBoot
- Renamed protocol JSON edge helpers away from the old `*StatusJson()` naming
  pattern. JSON still exists as protocol-edge projection from MessagePack.
- Updated Wrench docs/context and serial tests to use scalar helpers and
  structured array/out-buffer LED/color APIs.

Verification:

- SafeBoot app-only compile/upload succeeded at `921600` baud and verified the
  flash hash.
- App image size: `1987728 / 2293760` bytes.
- Host Wrench Python tests passed:
  - `test_wrench_optimizer.py`
  - `test_wrench_containers.py`
- Serial tests passed after upload:
  - `protocol_smoke`: `5 passed, 0 failed`
  - `serial_msgpack_mode`: `1 passed, 0 failed`
  - `http_bindings`: `2 passed, 0 failed`
  - `fastled_bindings`: `3 passed, 0 failed`
  - `wrench_structured_returns`: `7 passed, 0 failed`
- `git diff --check` passed.

Notes:

- A first full `wrench_structured_returns` run had one timeout in the 5k
  allocating-array stress test. The focused rerun passed, and the second full
  suite passed. Treated as serial/test timing, not a firmware regression.
- Internal firmware function names still contain `fastLed*` for the underlying
  FastLED-backed LED runtime. Those are not Wrench script bindings.

## Iteration 17 - Web Protocol Encoding Boundary

Changes:

- Made `ProtocolClient.request()` the single normal web command path.
- Added explicit `ProtocolClient.requestJson()` for legacy/debug and the USB
  `protocol.mode` bootstrap.
- Kept explicit `ProtocolClient.requestMsgPack()` for USB already-binary
  fallback and raw debug forcing.
- Added transport capability flags:
  - MQTT: MsgPack only
  - MQTT-WebRTC: MsgPack only
  - USB serial: JSON bootstrap plus MsgPack once `msgPackMode` is active
  - WebSocket: JSON only
  - PeerJS: JSON only
- Removed normal app-level JSON-vs-MsgPack branching from `sendCommand()`.
  The app now asks `ProtocolClient` which encoding it will use and then calls
  the same request method.
- Corrected the app's binary transport helper so PeerJS is not treated as a
  binary protocol transport.
- Bumped the web cache/version tag to `0.1.87-ui344`.

Verification:

- JavaScript syntax checks passed for:
  - `app.js`
  - `ProtocolClient.js`
  - `MqttTransport.js`
  - `MqttWebRtcTransport.js`
  - `WebSerialTransport.js`
  - `WebSocketTransport.js`
  - `PeerJsTransport.js`
- Node protocol-client probe passed:
  - JSON-only transport uses JSON
  - binary-only transport uses MsgPack
  - USB before MsgPack mode uses JSON
  - binary-only unsupported commands fail instead of falling back to JSON
- `git diff --check` passed.

Notes:

- Browser manual testing is still useful because this pass changes the web
  connection/client boundary rather than firmware behavior.
- LocalStorage/project/chat JSON remains untouched; that is app data, not the
  firmware protocol path.

## Iteration 18 - Static RAM Cleanup

Changes:

- Removed dormant WebSocket static RAM when `P1_EMBED_WS_ENABLED` is off by
  compiling the transport to stubs.
- Split the legacy serial JSON line buffer from the old `P1_EMBED_LINE_MAX`
  worst case and reduced it to `P1_EMBED_SERIAL_JSON_LINE_MAX = 2048`.
  Large USB/script traffic should use MsgPack and chunk commands.
- Disabled the memory profiler by default. When enabled for debug builds, the
  sample ring is now allocated lazily instead of being permanent BSS.
- Moved UI input/state/output/outbound buffers from permanent BSS to lazy heap
  storage, released on UI/runtime reset.
- Moved Home Assistant entity/event/RX buffers from permanent BSS to lazy heap
  storage. HA entity storage appears only after `haBegin(...)`; RX storage
  appears only while a HA client is active.
- Kept UI and HA API shape unchanged for sketches.

Verification:

- SafeBoot app-only compile succeeded.
- App globals dropped from `104464` bytes before this memory pass to `74880`
  bytes after it, recovering `29584` bytes of permanent RAM.
- App image size after this pass: `1958832 / 2293760` bytes.
- App-only SafeBoot upload at `921600` baud succeeded and verified the flash
  hash.
- Serial tests passed after upload:
  - `protocol_smoke`: `5 passed, 0 failed`
  - `serial_msgpack_mode`: `1 passed, 0 failed`
  - `wrench_structured_returns`: `7 passed, 0 failed`
  - `empty_strings`: `2 passed, 0 failed`
- `memory.profile` reports disabled in the default build.
- A small `haBegin(...)`/`haSensor(...)` script queued successfully and left no
  script error.
- `git diff --check` passed.

Notes:

- Two serial test attempts timed out because I accidentally launched multiple
  serial clients against the same port. Sequential reruns passed.
- HA client protocol behavior still deserves manual Home Assistant testing
  because the automated check only covers lazy entity allocation, not an
  external native API connection.

## Iteration 19 - Protocol Frame Buffer Reuse

Changes:

- Added one mutex-protected reusable protocol frame buffer for MsgPack response
  and event construction.
- Converted repeated protocol scratch allocations to the reusable buffer:
  - `status.light`, `status.get`, `status.full`, `status.live`
  - `system.info`
  - `config.get`
  - `script.error`
  - `script.get`
  - `script.chunk.get`
  - `firmware.update.status`
  - protocol MsgPack event emission
  - JSON projection helpers that first build MsgPack and then convert it to
    JSON
- Kept small fixed stack frames for tiny responses such as `ping`, state, inbox,
  and received counters.
- Left true content allocations alone for now, such as decoded bytecode/script
  payload storage. Those have a different ownership lifecycle than temporary
  protocol response frames.
- Released the reusable protocol frame buffer at Wrench compile/run memory
  pressure points, alongside MQTT scratch buffers.

Intent:

- Reduce heap fragmentation from recurring protocol requests without bringing
  back a permanent 4 KB static response array.
- Keep MsgPack as the canonical response shape; JSON helpers still project from
  MsgPack when legacy/debug JSON is needed.

Verification:

- `git diff --check` passed before compile.
- SafeBoot app-only compile succeeded:
  - app image size: `1960000 / 2293760` bytes
  - globals: `74928` bytes, leaving `252752`
- App-only upload at `921600` baud succeeded and verified the flash hash.
- Serial tests passed after upload:
  - `protocol_smoke`: `5 passed, 0 failed`
  - `serial_msgpack_mode`: `1 passed, 0 failed`
  - `wrench_structured_returns`: `7 passed, 0 failed`
  - `empty_strings`: `2 passed, 0 failed`
- Direct serial JSON-helper smoke checks passed:
  - `status.full` returned a full status document
  - `config.get` returned config including `scriptName: Hourglass 11`

Notes:

- One direct probe attempt timed out because `status.full` and `config.get`
  were accidentally launched in parallel against the same serial port.
  Sequential reruns passed.

## Iteration 20 - Bounded Script Error State and Debug Overloads

Changes:

- Replaced persistent script error `String` fields with bounded internal
  `char[]` storage for phase, code, message, and detail JSON fragments.
- Replaced script error duplicate-emission key construction with an FNV-style
  hash, avoiding a concatenated `String` on every repeated error.
- Kept the external error schema unchanged:
  - `hasError`
  - `count`
  - `phase`
  - `code`
  - `message`
  - `atMs`
  - detail fields when present
- Added `const char*` debug/event overloads so literal-heavy debug paths do not
  first allocate temporary Arduino `String` objects.
- Added a `const char*` `jsonString(...)` overload for those debug/event paths.
- Released protocol scratch after boot/status event emission. This avoids a
  periodic status event retaining the shared protocol frame buffer during a
  running Wrench script and perturbing heap recovery diagnostics.

Verification:

- `git diff --check` passed.
- SafeBoot app-only compile succeeded:
  - app image size: `1945360 / 2293760` bytes
  - globals: `75368` bytes, leaving `252312`
- App-only upload at `921600` baud succeeded and verified the flash hash.
- Serial tests passed after upload:
  - `protocol_smoke`: `5 passed, 0 failed`
  - `serial_msgpack_mode`: `1 passed, 0 failed`
  - `wrench_structured_returns`: `7 passed, 0 failed`
  - `empty_strings`: `2 passed, 0 failed`
- Direct script compile-error smoke passed:
  - malformed script produced `phase: compile`
  - `code: compile_error`
  - details still projected into `script.error.get`
  - the intentional error was cleared afterward

Notes:

- A `script.chunk.get` timeout immediately after flashing looked like a reset
  during startup. The exact raw command sequence passed afterward, and the full
  protocol suite passed from the settled state.
- A Wrench heap recovery check initially failed because a periodic status event
  retained protocol scratch while the script was running. Releasing scratch
  after status/boot events fixed the case.
- Two remaining test attempts timed out because the USB port was either held by
  the browser or accidentally used in parallel. Sequential reruns passed.

## Iteration 21 - MQTT Runtime Buffer Lifetime

Changes:

- Made the MQTT outbound queue lazy. MQTT begin/connect no longer allocates the
  FreeRTOS queue just because MQTT is enabled; it appears only when a non-owner
  task needs to queue outbound data.
- Added short idle release for the MQTT outbound queue once it is empty.
- Added explicit last-use tracking and idle release for the MQTT event batch
  buffer. The 3 KB batch buffer is retained only long enough to coalesce a
  burst, then released.
- Shortened secure-frame scratch retention. Secure MQTT publish still builds a
  bounded contiguous encrypted frame, but the reusable frame buffer is released
  after the secure publish burst goes quiet.
- Extended MQTT memory-pressure cleanup to release an empty outbound queue and
  reset the new buffer lifetime clocks.

Rationale:

- Keep reusable scratch where it prevents burst fragmentation, but stop turning
  those burst buffers into background heap occupants.
- Avoid adding another buffer framework. Each retained MQTT allocation now has a
  simple reason and a clear release path.
- Leave true streaming encryption for later measurement. AES-CTR can be chunked,
  but the current MQTT publish API and secure frame/HMAC layout still expect one
  contiguous publish payload. The bounded full-frame buffer is acceptable for
  current frame sizes as long as it is short-lived.

Verification:

- SafeBoot app-only compile succeeded:
  - app image size: `1945696 / 2293760` bytes
  - globals: `75376` bytes, leaving `252304`
- App-only upload at `921600` baud succeeded and verified the flash hash.
- Serial tests passed after upload:
  - `protocol_smoke`: `5 passed, 0 failed`
  - `serial_msgpack_mode`: `1 passed, 0 failed`
  - `wrench_structured_returns`: `7 passed, 0 failed`
  - `empty_strings`: `2 passed, 0 failed`
- Final `status.full` after idle showed:
  - MQTT outbound queue not allocated
  - MQTT event batch buffer capacity `0`
  - MQTT secure frame buffer capacity `0`

Notes:

- The event batch buffer can appear briefly during MQTT status/event bursts; it
  released correctly after the idle window.
- This pass does not change MQTT encryption semantics or wire format.

## Iteration 22 - Serial Test Board Preservation

Changes:

- Replaced the earlier serial-test metadata stamping idea with a board
  snapshot/restore flow.
- Before each serial test, the harness now snapshots:
  - `projectId`
  - `projectName`
  - `revisionId`
  - `scriptName`
  - stored script source via `script.chunk.get`
  - whether the script was stored/running
- After each test, the harness restores the script source with chunk upload,
  then restores the original project/revision/script metadata.

Rationale:

- The earlier approach of stamping `Unit Testing` metadata was too blunt: it
  protected against code/name mismatch but overwrote real project metadata that
  the web UI depends on.
- The correct default for hardware tests is to leave the board as it was found,
  including revision ids/hashes that matter for web-side matching.

Verification:

- Python syntax check passed with bytecode cache redirected to `/private/tmp`.
- Serial script-writing smoke passed with restore:
  - `test_empty_strings_do_not_report_malloc_failed`: `1 passed, 0 failed`
- Before and after the test, `config.get` stayed at:
  - `projectId: p1e-prj-mpu4efko-2phe29`
  - `scriptName: Hourglass 11`
  - `revisionId: rev-73a84891-b935-4083-898e-f4edb0706436`
- `script.chunk.get` after the test returned the 9288-byte Hourglass source
  beginning with the hourglass comment, not the unit-test snippet.

Notes:

- The board still showed `projectName: Unit Testing` from the earlier bad
  stamp. I did not guess the original project name.

## Iteration 23 - Config Backing Storage

Changes:

- Replaced long-lived config `String` globals with bounded backing storage in
  `config_store.ino`.
- Moved WiFi networks from parallel `String` arrays to fixed credential slots:
  SSID and password are copied into bounded fields.
- Moved online auth users from username/key hex `String` arrays to bounded
  usernames plus 32-byte binary keys.
- Kept the public config API returning `String` for compatibility with the rest
  of the firmware.
- Kept JSON save/load behavior and the on-disk `/config.json` schema unchanged.

Rationale:

- Config is always needed, so the goal is not lazy loading. The goal is to stop
  config from owning scattered, long-lived heap allocations.
- Online auth keys are runtime secrets, not text. Storing them as raw bytes
  avoids retaining 64-character hex strings and avoids reparsing on every auth
  lookup.
- Fixed backing storage is a deliberate tradeoff: globals increased modestly,
  but the config heap shape is now predictable and stable.

Verification:

- SafeBoot app-only compile succeeded:
  - app image size: `1945376 / 2293760` bytes
  - globals: `76440` bytes, leaving `251240`
- App-only upload at `921600` baud succeeded and verified the flash hash.
- Config/auth live checks passed:
  - added temporary online auth user `unit-auth`
  - removed `unit-auth`
  - rebooted
  - `config.get` showed WiFi, MQTT, project metadata, and the remaining auth
    user persisted correctly
- Serial tests passed after upload/reboot:
  - `protocol_smoke`: `5 passed, 0 failed`
  - `serial_msgpack_mode`: `1 passed, 0 failed`
  - `empty_strings`: `2 passed, 0 failed`
  - `wrench_structured_returns`: `7 passed, 0 failed`

Notes:

- The reboot shell helper still points at an old serial device path; protocol
  `device.reboot` was used on `/dev/cu.wchusbserial110` instead.
- This pass does not remove temporary `String` use while parsing/saving config
  JSON. Those are load/save-time allocations, not permanent config state.
