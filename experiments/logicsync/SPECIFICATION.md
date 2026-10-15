# Interactive Facade DMX Controller — Specification

## 1. Hardware

- **Controller:** LogicSync LS-POE-DMX4, GD32F307 ARM Cortex-M4 (120 MHz, 96 KB RAM).
- **Outputs:** 4 DMX universes, 512 channels each.
- **Fixtures:** Up to 16 LED fixtures, 4 per universe.
- **Each fixture:** 112 DMX channels (448 channels per universe).
- **Total:** 1,792 active DMX channels.
- **Network:** Ethernet / PoE with DHCP.
- **Firmware:** Custom firmware; flashing already working.

Fixture: [https://www.aliexpress.com/item/1005008517113007.html](https://www.aliexpress.com/item/1005008517113007.html)

**Existing working 112-channel example (reference for channel mapping and effects):**

[https://github.com/madshobye/Portal/tree/main/experiments/dmx112fire](https://github.com/madshobye/Portal/tree/main/experiments/dmx112fire)

## 2. Development Repository

Develop everything inside the `experiments` folder of:

[https://github.com/madshobye/Portal](https://github.com/madshobye/Portal)

Create a dedicated project folder containing firmware, web interfaces, configuration and documentation.

## 3. Virtual LED String

Treat all connected DMX fixtures as **one continuous virtual RGB LED string**.

- Each physical RGB pixel corresponds to one virtual pixel.
- Combine all four universes into one sequential pixel array.
- Automatically map virtual pixel indices to DMX universes, fixtures and channels.
- Effects operate across the entire virtual string, independently of physical wiring.
- Support individual pixels, pixel ranges, fixture groups and all pixels.
- Use the existing `dmx112fire` example to determine the precise 112-channel mapping.

**Configuration:**

- `fixtureCount`: 1–16.
- Maximum 4 fixtures per universe.
- Allow configuration of fixture counts per DMX output.
- Automatically calculate total pixel count.
- Store configuration persistently.
- Make fixture configuration editable through the built-in web interface.

## 4. Firmware and Effects

- Continuously generate DMX on all four universes at approximately 30–40 Hz.
- Implement 10 built-in effects: Fire, Water Waves, Chase, Rainbow, Pulse, Sparkle, Color Wash, Lightning, Moving Gradient and Solid Color.
- Each effect supports color, brightness and speed.
- Effects run locally without an external computer.
- Support smooth transitions and global brightness limiting.
- Save settings and recover automatically after power loss.
- **Inactivity timeout:** After 10 minutes without interaction, smoothly fade all lights to black.
- New interaction restores lighting.

## 5. MQTT — Public and Custom Control

**Broker:**

`mqtt://public:public@public.cloud.shiftr.io:1883`

**Topic prefix:**

`illutron-facade-dmx112-gd32f307-4universe-7c92e6b4a8134f60a9d2`

### Standard control topics

- `/set/effect` — select effect.
- `/set/color` — set RGB/HSV color.
- `/set/brightness` — global brightness.
- `/set/speed` — animation speed.
- `/state` — current configuration and effect state.
- `/status` — connectivity and controller status.

### Custom LED control over MQTT

Allow external applications to control individual virtual RGB pixels directly.

Additional topics:

- `/pixels/set` — update one pixel.
- `/pixels/range` — update a range of pixels.
- `/pixels/frame` — update the complete virtual LED string.
- `/pixels/clear` — clear custom pixel data.
- `/pixels/release` — return to built-in effects.

Example JSON:

Single pixel:

`{"index":42,"r":255,"g":100,"b":0}`

Pixel range:

`{"start":10,"colors":[[255,0,0],[0,255,0],[0,0,255]]}`

Full frame:

`{"rgb":[255,0,0,0,255,0,0,0,255]}`

**Requirements:**

- Support partial updates without clearing unchanged pixels.
- Support complete frame updates for custom animations.
- Map all updates through the virtual LED string abstraction.
- Enter custom pixel mode when pixel commands are received.
- Apply configured brightness and safety limits.
- Return to normal effects on `/pixels/release` or inactivity timeout.
- Limit message sizes to avoid exceeding available RAM.
- Avoid retained messages for pixel updates.
- Use MQTT QoS 0 for real-time animation data.
- WebSocket artist takeover has higher priority than MQTT pixel control.

## 6. Public Web Interface

A mobile-friendly **Portal/p5.js sketch hosted on GitHub Pages**, accessed by scanning a QR code.

Features:

- Large color wheel.
- 10 effect buttons.
- Brightness and speed sliders.
- Immediate lighting updates.
- Live synchronization of current settings.
- Multiple simultaneous visitors.
- No installation or login required.

Communicate with Shiftr.io through MQTT over secure WebSockets (`wss://`).

## 7. WebSocket — Artist Takeover

- Run a lightweight WebSocket server directly on the controller.
- Allow external JavaScript/p5.js applications to stream RGB pixel arrays.
- Support single pixels, ranges, full frames and raw DMX channel updates.
- Provide exclusive artist takeover, overriding MQTT and built-in effects.
- Allow takeover through a pre-generated shared access key.
- Automatically release control after disconnection or timeout.
- Restore the previous effect when released, subject to inactivity rules.

## 8. Built-in Status and Configuration Web Server

Run a lightweight HTTP server on the controller's DHCP-assigned IP.

Display:

- IP address, firmware version and uptime.
- MQTT and WebSocket connection status.
- Current control mode and effect.
- Brightness, color and speed.
- DMX activity for all four universes.
- Configurable fixture counts (1–16).
- Total number of virtual RGB pixels.
- Time since last interaction and inactivity countdown.
- Recent commands, connections and errors.
- Available memory and basic diagnostics.

Allow saving fixture and network configuration through this interface.

## 9. Security and Networking

- Prioritize reliability, performance and low memory usage.
- TLS/SSL is not required on the microcontroller.
- Use unencrypted MQTT and WebSocket where appropriate.
- WebSocket artist access may use a pre-generated shared key.
- No complex authentication or certificate management.
- Public MQTT control remains unauthenticated.
- Protect configuration and firmware update functionality from unauthorized changes.
- Use DHCP for automatic IP addressing.
- Automatically reconnect MQTT and other network services.
- Continue operating during network outages.
- The GitHub Pages interface uses WSS to communicate with the MQTT broker.

The public broker and shared credentials do not provide secure access control; the long topic prefix only reduces accidental collisions.

## 10. Control Priority

1. **WebSocket artist takeover** — highest priority, direct RGB/DMX streaming.
2. **MQTT custom pixel mode** — external control of the virtual LED string.
3. **MQTT public interaction** — control of built-in effects.
4. **Autonomous mode** — continue the selected effect without network communication.
5. **Idle mode** — fade to black after 10 minutes without activity.

All custom control modes must use inactivity detection and safely return to the previous effect or black.

## 11. Development Tasks

1. Create project under `Portal/experiments/`.
2. Verify GD32F307 hardware and DMX output pin mapping.
3. Port the 112-channel fixture mapping.
4. Implement the unified virtual RGB LED string.
5. Implement configurable fixture counts.
6. Implement ten effects and inactivity fadeout.
7. Implement DHCP, MQTT and custom pixel topics.
8. Implement the lightweight status/configuration web server.
9. Build the QR-accessible p5.js interface.
10. Implement WebSocket takeover and raw DMX control.
11. Test timing, memory usage, recovery and continuous operation.

**Goal:** A standalone facade controller treating up to 16 DMX fixtures as one continuous virtual LED string, supporting QR-based public interaction, MQTT pixel animations, WebSocket artist takeover, configurable fixture counts, live diagnostics and automatic inactivity fadeout.

Clarify the physical pixel and channel mapping