# DMX 112 Fire

Copy of `../dmx16touch` with a GPU simplex-noise fire image driving 28 RGBW
sections, rather than individual channel sliders. The original sketch is unchanged.

Serve the **repository root** over HTTP, then open `/experiments/dmx112fire/`
in Chrome or Edge on localhost. The preview works without a DMX adapter.
Set the light to **112H** in its **Chnd** menu and address **A001**, then click
**Connect DMX** to select the existing Web Serial DMX adapter.
Only one page/application can own the adapter at a time. Close or disconnect
other DMX sketches first. Connection is explicit; this sketch does not open a
previously granted serial port automatically. The status reports successful
serial writes separately from the generated DMX color preview.

The shader renders at 448 × 192 pixels in a dedicated Web Worker using
OffscreenCanvas. Each frame, the worker averages all
pixels in each of 28 outlined rectangles within a movable horizontal band.
Those RGB values become 28 consecutive RGBW groups on channels 1–112.
The lower strip displays the final values after brightness, white extraction,
reversal and blackout. Point along the strip to inspect a section's exact bytes.
Screen RGB+W reconstruction is approximate; the physical white LED's color and
brightness calibration are unknown.

- Fire, Embers and Blue flame presets use animated, layered simplex noise.
- Sample height moves the band between the bright fuel bed and the flame tips.
- Speed and wind change the animation; brightness scales the DMX output.
- White mix transfers the common RGB component into W (default zero).
- Reverse flips physical section order; Pause freezes animation but keeps DMX streaming.
- Blackout continuously transmits zeros. Disconnect only stops transmission;
  the fixture may hold its last received frame. Black out before disconnecting
  if you want the light to remain dark.
- Test cycles through solid red, green, blue and white at value 160, bypassing
  the shader and brightness controls. Blackout still overrides the test.

This version controls one 112-channel fixture. Two fixtures at A001 mirror the
same output. Independent A001/A113 operation is not implemented.

The worker also owns the serial port and uses Portal's existing `DmxSerial`
framing at a 33 ms target interval. It awaits each complete write before starting
the next frame. The main page only grants serial permission and sends control
changes; its p5 `draw()` loop displays a preview. Preview frames are requested one
at a time, so a hidden tab does not build up a message queue or pause the output.
The source shader, sampling, break timing and serial writes do not use
requestAnimationFrame or depend on messages from the main page to keep running.

This requires a browser with WebGL OffscreenCanvas and Web Serial in dedicated
workers (use current Chrome or Edge). Worker/API initialization failures appear
on the page; there is no silent fallback to foreground rendering.

Background operation is best effort: closing/discarding the page, browser/OS
suspension, sleep or WebGL context loss can still stop it. This is not a hardware
DMX clock. Test with the adapter and light: connect with A001/112H selected,
confirm the effect, switch to another tab for at least a minute, and check that
the light continues changing. Pause should freeze the colors while continuing
to transmit; blackout should send zeros. No browser was controlled for validation
of the worker implementation.

Run `node --test experiments/dmx112fire/tests/background.test.cjs` from the
repository root. Tests use simulated WebGL and serial devices with the real
Portal DMX helper to check continued rendering/writing without page draw calls,
bounded preview delivery, RGBW mapping/orientation, blackout, pause and reconnect.
These do not establish actual GPU or hardware behavior while a browser tab is hidden.

API references: [OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas)
and [Web Serial in dedicated workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API).

The simplex-noise implementation in `fire.frag` derives from Ashima Arts /
Stefan Gustavson's webgl-noise implementation, under the MIT license below.

Copyright (C) 2011 Ashima Arts. All rights reserved.
Copyright (C) 2011 Stefan Gustavson. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
