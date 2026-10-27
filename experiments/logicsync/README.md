# LogicSync standalone facade controller

Standalone C application, public visitor interface and artist SDK for the
LS-POE-DMX4 controller. Firmware 0.11 is the latest hardware-tested version.
It supports four DMX universes, 448 virtual RGB pixels, ten effects, MQTT,
authenticated artist takeover, persistent settings and local diagnostics.

## Build and test

Run from this directory with Python 3, Node.js and an ARM GCC toolchain:

```sh
python3 application/fetch_dependencies.py
python3 application/build.py
python3 tests/run.py
node --test tests/artist.test.mjs
```

Existing dependency snapshots without Git metadata require the explicit
`--allow-source-snapshot` fetch option; their revisions are not verified.
Dependencies retain their upstream licenses. Distributing compiled builds also
requires their applicable notices, including component-specific licenses.

Builds and generated private access keys go to
`~/.codex/memories/logicsync-private/`. The public build produces a raw application,
ELF and map. The raw binary is not a factory upload package. Factory packaging,
reverse-engineering utilities and original firmware material are not distributed
in this repository. Device installation requires separately available tooling.

## Controls and application logic

Open the controller's DHCP address, or **http://2.0.0.100/** during maintenance
fallback. The built-in page offers effects, color, brightness, speed, diagnostics
and administrator-protected configuration/update. Each fixture uses 28 RGBW
sections; virtual RGB pixels map to R/G/B with W zero. Output counts are independent
(0–4 each, at least one fixture total). Channels 449–512 remain unused at four
fixtures per output unless an artist explicitly sends raw DMX.

The public visitor page is in `public/`; the local p5 artist studio and reusable
JavaScript client are in [artist/](artist/README.md). GitHub Pages deployment remains pending because GitHub credentials are unavailable.
A real Shiftr command/state round trip passed through a temporary Mac TCP relay;
standalone router/internet connectivity remains unverified.

The MQTT broker is `public.cloud.shiftr.io:1883`, username/password `public`.
All topics start with:

```text
illutron-facade-dmx112-gd32f307-4universe-7c92e6b4a8134f60a9d2
```

| Suffix | Payload example |
|---|---|
| `/set/effect` | `9` or `"Solid Color"` |
| `/set/color` | `{"r":255,"g":100,"b":0}` or `{"h":30,"s":100,"v":100}` |
| `/set/brightness` | `128` (0–255) |
| `/set/speed` | `100` (1–400; 100 = normal speed) |
| `/pixels/set` | `{"index":0,"r":255,"g":0,"b":0}` |
| `/pixels/range` | `{"start":10,"colors":[[255,0,0],[0,255,0]]}` |
| `/pixels/frame` | `{"rgb":[...]}` with exactly 3 bytes per configured pixel |
| `/pixels/clear` | `{}` |
| `/pixels/release` | `{}` |

Use QoS 0 and `retain:false`. Retained commands are rejected. HSV uses degrees
0–360 and percentages 0–100. Incoming MQTT payloads are limited to 6144 bytes.
`/state` and `/status` are retained controller publications, not command topics.
The public broker credentials are shared; the prefix is not access control.

HTTP `POST /api/command` accepts the suffix, one space, then its JSON payload
(maximum 1000 bytes). `GET /api/status` returns live state. `GET /api/dmx/0` through
`/api/dmx/3` returns a hex encoding of each 512-byte output buffer. Configuration
uses `POST /api/config` with JSON and the `X-Facade-Key` administrator header.
Network changes should be followed by a restart. Use “Load saved network settings” with the admin key before editing.
`GET /api/config` requires that same key and returns saved network fields, without
passwords or access keys. Unsaved live-control edits are preserved during polling.

Artist WebSocket `/ws` uses a separate key and exclusive ownership. See the
[client documentation](artist/README.md) for binary formats and examples. Artist
control overrides public commands. Closing the connection or ten seconds without
artist traffic releases ownership. All lighting fades to black after ten minutes
without interaction; local effects continue independently of network service.
Brightness and the administrator's safety limit apply to both RGB and raw DMX.

`hardware/check_facade.py`, `hardware/check_facade_mqtt.py` and
`hardware/check_artist.mjs` explicitly exercise a connected board. The first two
temporarily change fixture configuration; read their setup/cleanup before use.
The artist check keeps brightness zero and verifies commands, heartbeat, explicit
release, socket-close release and ten-second timeout against the real firmware.
`hardware/check_network.py` is historical and targets the superseded 0.3 protocol.

## Remaining validation

- Verify B-D physical outputs and all port timings with a receiver or scope.
- Soak-test a real MQTT broker, concurrent clients and Ethernet cable reconnection.
- Verify cold power-cycle behavior of the standalone application.

The firmware and services are a trusted-LAN prototype, not a production release.

`artifacts/` and `.venv/` are ignored by Git. Artifacts contain downloaded official
images, bootloader/flash readback, configuration backups, dependency snapshots,
disassembly, emulator inputs and generated packages.

## Copenhagen sunset default (firmware 0.11)

The automatic default runs from calculated Copenhagen sunset until 02:00 local
time. All configured RGB pixels share one color, moving through a two-hour hue
cycle with gentle easing. Automatic brightness is 255; the saved Maximum
brightness cap still applies. Daytime default is black. On the autumn clock change,
the first 02:00 ends the evening; on the spring change, cutoff occurs at the jump
to 03:00 because 02:00 does not exist.

Public/manual interactions temporarily override the default. After ten minutes
without interaction, the schedule resumes instead of always fading to black.
Sunset and the nightly cutoff reset a manual override; an active authenticated
artist retains priority and release returns to the scheduled default.

Time is obtained automatically by SNTP from time.cloudflare.com or time.google.com
(UDP 123), refreshed hourly. After synchronization the local clock keeps running
through network outages. After a power cycle it needs network time again; the
automatic default stays dark until the first valid synchronization. Manual controls
remain available. There is no claimed battery-backed clock or authenticated NTP.

Location is Copenhagen, 55.6761 N / 12.5683 E. Sunset uses NOAA's approximate
fractional-year equations with a 90.833-degree zenith, suitable for minute-scale
lighting schedules rather than precision astronomical measurement. Summer/winter
time follows Europe/Copenhagen's current EU last-Sunday rules. The built-in page
shows clock readiness, local time, sunset and whether the default is active.

Firmware settings layout is unchanged, preserving fixture counts, limits, saved
manual presets, network settings and access keys. Factory upload tools remain
private/ignored; the public build still outputs only raw application artifacts.
