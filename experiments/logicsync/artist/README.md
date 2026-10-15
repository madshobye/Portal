# Artist client and p5 studio

Serve the repository using a local HTTP server and open
`/experiments/logicsync/artist/`. Enter the controller address, its configured
fixture counts, and the artist key from the private `access-keys.json` file.
The key is sent in a WebSocket frame, never in the URL or browser storage.
The controller applies saved brightness and safety limits: a blackout setting
keeps the fixture black even when the preview is animated.

The controller exposes plain `ws://`, so use local HTTP for this studio.
The public visitor page uses broker WSS and can be hosted on HTTPS.

```js
import {FacadeArtist} from './client.mjs';
const artist = new FacadeArtist({fixtures: [1, 0, 0, 0]});
await artist.connect('ws://2.0.0.100', artistKey);
await artist.pixel(0, 255, 0, 0);
await artist.range(1, [0, 255, 0, 0, 0, 255]);
await artist.fixture(0, 0, new Uint8Array(84).fill(64));
// In a draw loop: false means the previous frame is still being acknowledged.
artist.frame(new Uint8Array(artist.pixelCount * 3));
// Await completion before another imperative command, or stop the draw loop.
await artist.disconnect();
```

Outputs and fixture indices are zero-based. Virtual pixel indices are zero-based,
while `artist.raw(output, startChannel, bytes)` uses DMX channels 1–512.
Sparse fixture counts are supported: `[0,2,0,1]` maps pixels 0–55 to B and 56–83
to D. Each fixture has 28 RGB pixels (84 bytes); its 112 DMX slots include W=0.

The client keeps only one command in flight. `frame()` drops a busy animation
frame instead of building a queue. Await `pixel`, `range`, `fixture`, `raw` and
`clear`; do not issue them concurrently with a streaming draw loop. `clear()`
zeros custom pixels while retaining ownership. `disconnect()` requests release
and closes the socket; `close()` closes immediately. A heartbeat every three
seconds maintains ownership. Controller timeout is ten seconds; SDK connection
and acknowledgement timeout is four seconds. Reconnect requires a new `connect()`.

## Wire protocol

Connect to `/ws`, send text `claim KEY`, and require `{"ok":true}` before sending
pixel data. Text `keepalive` renews ownership and `release` relinquishes it.
Every command receives a JSON acknowledgement. Binary message formats:

| First byte | Remaining bytes |
|---|---|
| 1 | Complete RGB frame, exactly 3 × configured pixel count bytes |
| 2 | Start pixel as big-endian uint16, followed by one or more RGB triplets |
| 3 | Output byte (0–3), start DMX channel as big-endian uint16, then channel bytes |

Messages must be valid masked RFC6455 client frames. The application message limit
is 1400 bytes; a complete 448-pixel binary frame is 1345 bytes. Large JSON pixel
frames belong on MQTT, whose payload limit is 6144 bytes.

Run offline SDK tests with `node --test tests/artist.test.mjs` from the project
directory. `node hardware/check_artist.mjs` is an explicit connected-controller
test; it keeps brightness zero and records evidence under ignored artifacts.
