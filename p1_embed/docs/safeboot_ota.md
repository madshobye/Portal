# P1E SafeBoot OTA

P1E SafeBoot OTA uses one small updater partition and one large app partition.
The main app downloads a verified delta patch into a `patch` data partition,
then reboots into the updater. The updater has no WiFi, MQTT, HTTP, or TLS
code; it only verifies and applies the already-downloaded patch to the app
partition.

USB flashing remains the recovery path. This system is designed for controlled
firmware updates, not impossible-to-brick remote updates.

## Partition Layout

`p1_embed/firmware/partitions-p1e-safeboot-4mb.csv`

```csv
nvs,      data, nvs,     0x9000,  0x5000,
otadata,  data, ota,     0xe000,  0x2000,
updater,  app,  factory, 0x10000, 0x110000,
app,      app,  ota_0,   0x120000,0x230000,
patch,    data, spiffs,  0x350000,0x60000,
spiffs,   data, spiffs,  0x3B0000,0x30000,
coredump, data, coredump,0x3E0000,0x20000,
```

- Updater partition: `0x110000` bytes.
- App partition: `0x230000` bytes.
- Patch partition: `0x60000` bytes.
- Filesystem: `0x30000` bytes.

Changing to this layout requires a full USB/browser flash because the partition
table changes.

## Update Flow

1. The browser reads `p1_embed/web/bin/p1e-firmware-releases.json`.
2. The browser finds one exact delta from the board firmware version to the next release.
3. The browser resolves relative patch URLs from the current web utility location.
4. The browser sends `firmware.update.prepare` with `reboot:true`.
5. The main app stores the request as `downloadPending` and reboots back into the main app.
6. Early in app boot, after WiFi starts but before MQTT/WebRTC/HA/Wrench autorun, `otaSafeBootHandleBootDownload()` downloads the patch and verifies SHA-256.
7. The main app marks the request `pending`, selects the updater partition, and reboots.
8. The updater verifies the source app SHA-256, applies the in-place detools patch, verifies the target app SHA-256, clears the request, and boots the app partition.

Do not boot directly into the updater while `downloadPending` is true. The updater expects a verified patch already present in the patch partition.

## Official Deploy

Use one script for official SafeBoot deploy iterations:

```sh
DETOOLS=/private/tmp/p1e-detools-venv/bin/detools ./scripts/esp32/p1embed-safeboot-deploy.sh \
  --from <previous-version> \
  --to <next-version>
```

For the first bootstrap release, use:

```sh
DETOOLS=/private/tmp/p1e-detools-venv/bin/detools ./scripts/esp32/p1embed-safeboot-deploy.sh \
  --to <version> \
  --no-delta
```

Use `--force` only to replace the same not-yet-committed version during local
testing.

The deploy script:

- updates `P1_EMBED_FIRMWARE_VERSION` in `config.h`
- compiles updater and app partitions
- checks both image sizes
- writes current USB installer files in `p1_embed/web/bin`
- writes versioned release files in `p1_embed/web/bin/releases`
- creates and host-verifies a detools in-place delta patch
- writes `p1e-firmware-safeboot.json`
- updates `p1e-firmware-releases.json`

Committed release URLs must stay relative to `p1_embed/web/bin`. The browser
resolves them from the current hosted web utility before asking the ESP32 to
download the patch. Do not commit LAN IPs or absolute local URLs in release
manifests.

## Manual USB Install

The web Install page uses:

```text
p1_embed/web/bin/p1e-firmware-safeboot.json
```

That manifest flashes:

- bootloader
- partition table
- `boot_app0`
- updater partition
- app partition

This is the manual install and recovery path.

## OTA From Web UI

OTA updates live in `Settings -> Firmware`.

The UI enables the update button only when:

- a board is connected
- `system.info` reports a firmware version
- the release manifest has an exact delta from that version

If a board is multiple versions behind, update one step at a time. Example:

```text
0.1.174 -> 0.1.175 -> 0.1.176 -> 0.1.177
```

The UI should offer only the next available step.

## Development Scripts

Useful scripts:

```sh
./scripts/esp32/p1embed-safeboot-app-compile-upload.sh
./scripts/esp32/p1embed-safeboot-compile.sh
./scripts/esp32/p1embed-safeboot-upload.sh
./scripts/esp32/p1embed-safeboot-deploy.sh --to <version> --from <previous>
```

Use `p1embed-safeboot-app-compile-upload.sh` for normal local firmware
iteration after the board already has SafeBoot installed. It builds the app
partition only and flashes only `0x120000`.

`p1embed-delta-patch.sh` is a low-level experiment helper. Do not use it for
official releases; use `p1embed-safeboot-deploy.sh`.

## Delta Details

Patches use detools in-place heatshrink mode. The deploy script pads both app
images with `0xff` to the 4096-byte segment size before hashing and patching.
This is intentional because ESP32 flash erases complete sectors.

One detools caveat remains: the embedded C applier returns
`DETOOLS_NOT_IMPLEMENTED` if it sees a non-empty `dfpatch` section. Current
tested deploy patches report zero data-format bytes and do not hit that branch.
If a future binary pair requires non-empty `dfpatch`, implement and host-test
that branch before trying it on flash.

## HTTPS

HTTPS patch download runs in the main firmware before Wrench autorun because
TLS needs a large contiguous heap block. Testing showed normal Wrench runtime
could leave too little contiguous heap for TLS. Early boot download keeps the
network step isolated from Wrench and LED runtime pressure.

The current HTTPS path uses `WiFiClientSecure::setInsecure()` and relies on the
patch SHA-256 for integrity. This keeps transport encrypted but does not validate
the server certificate.

## Commit Hygiene

Keep `p1_embed/web/bin` tidy:

- top-level `p1e-esp32-classic-safeboot.*` files are the current USB installer
- `p1e-firmware-safeboot.json` is the current USB installer manifest
- `p1e-firmware-releases.json` is the OTA release index
- versioned app/updater/delta files live under `p1_embed/web/bin/releases`
- do not commit scratch patches in top-level `web/bin`
