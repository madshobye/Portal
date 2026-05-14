# Ninebot BLE Proxy ESP32

Experimental owner-controlled BLE proxy for learning what the official app sends to a
Ninebot/Nordic-UART style BLE endpoint.

The ESP32 advertises a fake Nordic UART peripheral to the phone and, separately,
connects as a BLE central to the real Ninebot. App writes are logged and optionally
forwarded to the Ninebot; Ninebot notifications are logged and forwarded back to the app.

## What This Can Tell Us

- Whether the official app sends plain `55 aa` Proto1 reads or encrypted `5a a5` frames.
- Whether it targets classic Ninebot-S `0x03`, Ninebot S 2 `0x21`, or something else.
- Whether the app refuses a clone before writing anything, which points at bonding,
  manufacturer advertisement data, or app/cloud binding rather than frame format.
- Whether the Ninebot answers the app when traffic is forwarded byte-for-byte.

## Limits

- If the app payload is application-encrypted, this proxy logs ciphertext unless we also
  implement the matching protocol state machine.
- If the app requires OS BLE bonding to the original device identity, a simple ESP32 clone
  may not be accepted.
- If the phone connects directly to the real Ninebot instead of the ESP32, the proxy sees
  nothing. Keep the real device disconnected from the phone app and select the ESP32 clone.

## Build

Use Arduino IDE or PlatformIO with an ESP32 board and the `NimBLE-Arduino` library.

Edit these values in `NinebotBleProxyEsp32.ino`:

- `FAKE_ADV_NAME`: name the phone app should see. For the local Ninebot-S capture this
  is currently ` madsbot` with the leading space preserved, because the real
  advertisement included that byte.
- `REAL_NINEBOT_NAME_HINT`: a trimmed name fragment for the real Ninebot, for example
  `madsbot`. The sketch logs raw and trimmed scan names because some Ninebot names include
  hidden whitespace.
- `REAL_NINEBOT_ADDRESS_HINT`: optional exact BLE address if name matching is ambiguous.
- `FORWARD_APP_TO_NINEBOT`: set `false` for observe-only app logging.
- `CAPTURE_REAL_ADV_ONLY`: set `true` to stop fake advertising and capture the real
  Segway advertisement fields. Paste the `REAL ADV MATCH` block back into the project
  notes before trusting guessed manufacturer data.
- `FAKE_MANUFACTURER_USE_ESP32_BT_ADDRESS`: keep this `true` for "add a new Segway"
  tests. The fake manufacturer data becomes `56 00 + ESP32 BT MAC`, matching the shape
  captured from the real Segway without reusing the real Segway address.
- `FAKE_INCLUDE_NINEBOT_CUSTOM_SERVICE`: keep this `false` for the local Ninebot-S because
  its real GATT fingerprint only exposed Nordic UART plus standard GAP/GATT.
- `CONNECT_REAL_BEFORE_FAKE_ADV`: if real forwarding is re-enabled later, keep this `true`
  while debugging discovery. The ESP32 scans/connects to the real Ninebot before
  advertising the fake clone, which avoids scan+advertise timing problems.

If the serial monitor only prints retry messages, make sure the real Ninebot is powered on,
not connected to Web Bluetooth or the official app, and close any phone/browser connection
that may already occupy its single BLE central slot. With scan logging enabled, you should
see `SCAN ... name="..."` lines for nearby devices.

Test with the vehicle unloaded and wheels off the ground. Start in observe-only mode first.
