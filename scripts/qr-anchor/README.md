# QR anchor build and repeatable tests

The runtime strategy and configuration are documented in
[`P1/portal/qr-anchor/README.md`](../../P1/portal/qr-anchor/README.md).

```sh
npm ci --prefix scripts/qr-anchor
npm run build --prefix scripts/qr-anchor
node --test P1/tests/*.test.cjs
node scripts/qr-anchor/benchmark.cjs
```

## Replay a camera recording

The replay uses the actual QrAnchor analysis engine with recorded presentation
timestamps. It does not open a browser, acquire a camera, upload the video, or
change the input. The default input size is 1280×720 for a 16:9 recording, matching
the camera request in the live example. Every decoded frame is presented to the
normal 30 Hz analysis scheduler. The default target is `qr7`.

On macOS with the Swift command-line tools installed:

```sh
node scripts/qr-anchor/replay.cjs ~/Desktop/qrtracking.mov \
  --output /tmp/portal-qr-replay/baseline

# After a tracker change, replay the identical recording and compare:
node scripts/qr-anchor/replay.cjs ~/Desktop/qrtracking.mov \
  --baseline /tmp/portal-qr-replay/baseline/report.json \
  --output /tmp/portal-qr-replay/candidate
```

`--width 1920` tests the original full-HD pixels. `--target another-id` changes the
expected payload. Keep the same width and target for baseline comparisons.
The native decoder streams RGBA frames with backpressure; no uncompressed video
is retained. A compiled decoder is cached in the OS temporary directory. Phone
rotation metadata is applied during decoding, with oriented source dimensions
and `orientationApplied` recorded in the report. The source movie is never
rewritten. Rotated movies use an AVFoundation video composition at the track's
frame duration; identity-transform movies retain the original decoder path.
The width limit applies after orientation, so portrait footage can be taller
than 1280 pixels. Keep these dimensions identical between comparisons.

The output directory contains:

- `report.json`: input SHA-256, resolution, settings, runtime code hash, per-frame
  measurements, processing time, centres/corners, state transitions and dropouts.
- `report.html`: original video with measured points and QR outline, a seekable
  timeline, and buttons for every dropout. Open the local HTML file to review it.
  The video stays at its original path; moving it breaks that report's playback.

Green timeline segments are actual measurements. Amber segments only hold/predict
the previous pose, and red segments are searching. Initial acquisition time is
reported separately; a dropout begins on the first unmeasured frame after acquisition.
A marker leaving the frame, becoming edge-on or fully occluded still counts as a
dropout: inspect those intervals before treating them as a regression.

Baseline comparison refuses mismatched inputs/settings. It returns exit code 2
if measurement coverage loses more than two frames or the longest dropout grows
by more than 100 ms. Processing-time deltas are reported, not used as pass/fail
criteria because host load varies. Exit code 1 indicates a setup/decoding error.
An identical replay should produce identical measured frames and dropout intervals.

This is **not a browser FPS benchmark**: analysis runs synchronously for deterministic
frame order, while the live sketch normally runs it in a worker and can skip frames
when busy. Worker lifecycle/queue behavior has separate automated tests. Coverage
is also **not geometric accuracy**: an incorrect black-square lock can count as a
measurement. Use the point overlay to check alignment; reviewed landmarks are the
next step for an independent positional-accuracy score. No ground truth is inferred
from the tracker's own output.

The supplied `qrtracking.mov` is a short movement/tilt/glare regression fixture,
not a long-duration thermal or memory test. The worker tests also exercise a
simulated minute of searching without a QR and assert bounded capture/reply state.
Keep personal recordings and generated reports out of Git; pass local paths instead.

## Supplied movement fixture baseline

[`fixtures/qrtracking-baseline.json`](fixtures/qrtracking-baseline.json) records the
input hash, settings and initial results for the supplied 10.53-second, 316-frame
`qrtracking.mov`. Two runs produced exactly the same per-frame observations,
including centre/corner coordinates (CPU times excluded):

- 95 measured frames (30.1%); acquisition on the first frame.
- 17 dropout intervals; longest gap 1.934 seconds.
- 14 decoded frames, showing repeated reacquisition.

This deliberately records the current movement failure, **not an acceptable
tracking target**. Most rejected tracking frames report “three black squares
unclear”. That aggregate reason does not establish whether blur, predicted scale,
position search or local validation caused each rejection.

```sh
node scripts/qr-anchor/replay.cjs ~/Desktop/qrtracking.mov \
  --baseline scripts/qr-anchor/fixtures/qrtracking-baseline.json \
  --output /tmp/portal-qr-replay/current
```

The separate synthetic before/lost/after-recovery benchmark measured 90/90 clear
frames on each side of loss, one acquisition per side, no local searches while
tracking, and restored the same crop limit after recovery. Local median analysis
cost was 18.9 ms before and 18.5 ms after recovery. These synthetic results do not
replace the much harder real recording or prove live rendering FPS.

## Movement fix regression target

[`fixtures/qrtracking-fixed.json`](fixtures/qrtracking-fixed.json) is the current
regression target. The original failing baseline above is retained for comparison.

```sh
node scripts/qr-anchor/replay.cjs ~/Desktop/qrtracking.mov \
  --baseline scripts/qr-anchor/fixtures/qrtracking-fixed.json \
  --output /tmp/portal-qr-replay/current
```

Two runs matched all 316 per-frame observations exactly (excluding CPU timing):
275 measured frames (87.0%), 2 full decodes and 5 dropout intervals, compared with
95 frames, 14 decodes and 17 intervals before the fix. Four remaining gaps are
33–67 ms during extreme tilt; the long gap is 5.567–6.701 s during strong glare.
The final run's median analysis cost was 14.3 ms and p95 was 58.0 ms, versus
48.3/88.0 ms in the original run. These are offline CPU costs, not browser FPS.

The changes address three measured failure causes: motion softened the edges
used by the solidity check; uniform centroid weighting let outer dark pixels pull
centres away; and a stale perspective approximation could reject a valid measured
triangle before refinement ran. The tracker now checks the dark core and area,
weights the centre, uses validated flow to update projected sampling geometry,
and attempts immediate inner-edge refinement before discarding a poor pose.
New pixel tests cover known-centre motion blur, rapid tilt and smaller 2×2 data
islands, in addition to the existing false-texture and lifecycle regressions.

## Second movement recording

`jjh.mov` is a separate 23.50-second, 705-frame movement/tilt fixture. Its input
hash and initial results are in `fixtures/jjh-baseline.json`; compare subsequent
changes against `fixtures/jjh-fixed.json`. The recording stays outside Git.

```sh
node scripts/qr-anchor/replay.cjs ~/Desktop/jjh.mov \
  --baseline scripts/qr-anchor/fixtures/jjh-fixed.json \
  --output /tmp/portal-qr-replay/jjh
```

Initial acquisition is at 3.467 seconds. The original run measured 508 frames,
with 15 dropout intervals and 7 full decodes. Allowing directional blur in the
white gap around a solid inner square raises that to 521 measured frames, with
12 intervals and 5 decodes. This allowance requires two clean perpendicular gaps
and sufficient whiteness on both blurred sides; the core, area and surrounding
contrast checks still apply. It does not add a separate blur-tracking mode.
Two runs matched all 705 per-frame observations and coordinates exactly, excluding
CPU timing. The existing 89-test suite also passes, including false-data locks.

This is a partial improvement: the longest gap remains 0.867 seconds at
9.868–10.734 seconds. The final interval also grows from 0.333 to 0.600 seconds,
starting earlier at 22.136 seconds. Reviewed recovered frames at 17–18 seconds
align with the finder squares, but coverage alone is not proof of accuracy.
The first recording retains 275 measured frames, 5 dropouts and 2 decodes.

## Portrait mobile recording and URL marker

`fixtures/mobile-8453-baseline.json` contains metadata and results for the local
`IMG_8453.MOV` recording. It targets the full URL rather than `qr7`:

```sh
node scripts/qr-anchor/replay.cjs ~/Downloads/IMG_8453.MOV \
  --target 'https://192.168.3.80:8082/P1/sketches/qr-anchor/' \
  --baseline scripts/qr-anchor/fixtures/mobile-8453-baseline.json \
  --output /tmp/portal-qr-replay/mobile-8453
```

The phone's 1920×1080 encoded frames are oriented to 1080×1920 before analysis.
Two runs matched all 357 frame observations and coordinates exactly (timings
excluded): initial acquisition at 1.333 s, 267 measured frames (74.8% of the whole
clip), 3 full decodes and 4 dropout intervals. The longer gaps are 1.700–2.567 s
and 4.033–4.767 s, both initially rejected as `pose fit`; the other two gaps last
one frame each. Reviewed frames show the selected URL marker on the box, with
the three dots aligned on its finder squares. Blur is visible near the first
loss, but the reason alone does not establish the cause of every rejection.

These timings/coverage are offline measurements at this portrait resolution,
not phone FPS. The runtime tracker was not changed for this recording.
Videos stay in their original Downloads/Desktop locations and reports in `/tmp`.
Git ignores common video extensions (case-insensitively) and local replay/report
folders. The pre-existing tracked demo asset `P1/assets/videoOne.mp4` is retained;
ignore rules do not untrack existing files.
