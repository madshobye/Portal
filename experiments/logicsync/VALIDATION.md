# Application validation

Firmware 0.10 has booted on hardware. Three C sanitizer suites, eleven compiled
control/update tests and the compiled startup test passed. Six artist SDK tests
passed during development. ARM tests require Unicorn and a local compiled ELF;
they do not prove electrical timing.

Verified during development:
- Virtual mapping across four universes and 448 RGB pixels; RGBW white slots zero.
- Physical output A red across 28 sections, confirmed by the user.
- Persistent settings after firmware replacement; interrupted-write simulation.
- Ten-minute inactivity fade, blackout and wake on hardware.
- Two browser sessions synchronized controls through the public MQTT broker.
- Broker outage left animation and DMX running; reconnect preserved settings.
- Artist ownership, release, disconnect, timeout, ranges, full frames and raw DMX.
- Maximum-size artist stream around 25.6 fps while four DMX counters met 30–40 Hz.
- Version 0.8 artist-state round trips through the real broker: 30–143 ms.
- Version 0.8 artist/HTTP workload: 45 seconds, DMX 33.34 Hz, minimum untouched
  stack estimate 15780 bytes. A preceding attempt had an HTTP EPIPE error;
  this result is not a claim of a fault-free extended soak.
- DHCP and direct broker connectivity through macOS Internet Sharing at
  192.168.2.3, without the temporary bench relay.
- Version 0.9 command-state updates do not wait for lighting transitions or a
  minimum publication interval; compiled tests exercise same-millisecond updates.
- Version 0.10 Fire tests cover black/red/yellow and rarer white peaks over a
  simulated minute. Visual effect quality still needs user assessment.

Remaining: physical B–D ordering and electrical timing, cold power-cycle checks,
final-network extended soak and visual assessment. GitHub Pages last returned
404; publication is not claimed. The QR targets that intended deployment URL.

Detailed local evidence is under ignored artifacts/analysis. Private historical
notes and packaging-tool tests are retained locally but excluded from publication.
