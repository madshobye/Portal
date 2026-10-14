# QrAnchor: acquisition once, fast tracking afterwards

QrAnchor is a single-marker prototype using a supplied Portal camera. It does not
open or stop cameras and does not change QrReader or its ZXing global. The example
tracks the exact URL `https://192.168.3.80:8082/P1/sketches/qr-anchor/` (including
the trailing slash). The recorded regression fixtures still target `qr7`.
With Portal's debug overlay on, it shows the tracking console, a
WebGL wireframe and the three measured black centres. With debug off, it renders
a floating crystal, rings, satellites and particle trails spanning about fifteen
QR widths, with the entire scene enlarged threefold in height as well. A black
circle of diameter 3 QR widths covers the printed marker in presentation mode;
the tracker continues to analyze the unmodified camera image.

## Strategy

| State | Work | Exit |
| --- | --- | --- |
| Search | Coarse finder scan, native-resolution ROI, payload decode and pose fit. At most one search cycle per 120 ms; high-resolution search at most once per second. | A verified target establishes an immutable reference. |
| Track | Optical flow predicts motion; measure the three inner black squares in a padded ROI. No finder scan or payload decode. | Valid centres refresh pose. Missing/invalid centres enter recovery. |
| Recover | Retain the last accepted image for 350 ms, predict the ROI direction, enlarge it, and retry the same tracker. | Good measurements return to Track. Timeout returns to Search. |
| Confirm identity | Every 4 seconds, check 36 data samples on a clear frame. Below 30% match starts decoding through the tracked homography, at most every 500 ms for 3 seconds. | Successful decode resumes the 4-second clock; timeout releases the ID. |

Identity confirmation is an independent clock, not a per-frame gate on motion.
Unclear checks retry after 250 ms. A 30% alarm threshold intentionally tolerates
large appearance changes; this sparse check is not proof that two QR payloads are
identical. Real geometric loss can require acquisition sooner.

## Inner-square tracker

Initial identification still uses the QR finder pattern and payload decoder.
After that, the fast path follows the central black 3×3 islands rather than the
outer black rings:

1. Pyramidal optical flow on inner **corners**, with forward/backward checking,
   predicts movement. Two agreeing diagonal corners per finder are sufficient;
   other corners are tried only when needed. Straight edge midpoints were poorer
   two-dimensional motion features.
2. Fit a shared perspective update from validated inner-corner flow when all
   three finders contribute. Sample windows follow the current tilt and size.
   A centre-weighted darkness average refines each island without being pulled
   onto the outer ring. Fixed layouts/histograms avoid per-patch sorting.
3. Require a dark core, enough total dark area for the expected 3×3 size, and a
   white gap on all four sides. Directional blur may soften two opposing gaps
   when the perpendicular gaps remain clear and the core remains solid. This
   tolerates softened edges without accepting a
   smaller 2×2 data block or checkerboard. It is a local shape test, not a payload read.
4. The three finders share most translation. If flow is unclear or disagrees,
   test candidate motions against all three squares together. Search around both
   last and predicted positions so a missed reversal does not exclude the target.
   Validate triangle deformation and pose, not each square's translation distance.
5. Fit the inner islands' edges every 200 ms, or immediately when the approximate
   pose fails its reprojection check. This happens before rejecting the measurement.
   No outer-ring scan or decode is required. A pose that still fails is not published.

Three centres alone constrain an affine update. Validated optical flow supplies
perspective changes between edge fits; when it is insufficient, the prior
perspective is retained. Subpixel averaging improves centre estimation;
it does not recover image detail erased by glare. Large occlusions, very small
codes, violent scale changes and similar black structures can still defeat it.

The ROI covers both last and predicted positions, with 0.5 marker-span padding.
Recovery preserves the earlier pixel sampling scale, bounded to twice `maxWidth`.
Once recovered, ordinary crop limits and the normal fast path resume. No chain of
blur, glare, corner and decoder fallbacks runs after one failed centre measurement.

## Rendering and analysis are separate

`worker: true` is the default. Where Worker and OffscreenCanvas are available,
Portal transfers a frame to a dedicated worker. The **same analysis engine** runs
there; only small pose/diagnostic observations return. Pyramids and tracking history
remain in the worker. There is exactly one frame in flight, including asynchronous
capture. Busy means skip the intermediate frame, not queue it.

The display thread keeps the camera preview, WebGL drawing, smoothing and optional
Kalman filter. Stop, restart and tracker changes invalidate old replies. Disposal
terminates the worker; transferred ImageBitmaps are closed after processing. If
video-to-ImageBitmap capture is unsupported, canvas readback transfers an RGBA
buffer instead. Cross-origin cloud-editor pages use a blob worker bootstrap that
imports the public absolute Portal script URLs.

If worker startup is unavailable, the synchronous path remains usable. The overlay
explicitly says `Main thread`; diagnostics include `workerUnavailable` when startup
failed. Set `worker: false` for controlled comparison. Camera capture/readback and
rendering still have a cost: using a worker is not a promise of 60 fps on every device.

`fps: 30` caps analysis requests, not p5 drawing. The scheduler accounts for
processing time and skips duplicate video frames. `update()` with a worker starts
work and returns the latest available observation; use `getLatest()` when drawing.
There is no catch-up queue. Idle search also skips capture until the next search
is due. Background tabs may still be throttled by the browser.

## Decisions from the experiments

| Earlier idea or problem | Current decision |
| --- | --- |
| Decode continuously / confidence-based re-decoding | Occasional clear-frame checks and a bounded confirmation window. |
| Blur and partial-glare fallback cascade | Removed; one inner-square tracker handles ordinary frames and recovery. |
| Separate corner tracker | Kept only as an explicitly selected comparison (`centreTracking: false`); never tried automatically after a centre miss. |
| Square-motion threshold rejects real movement | Validate shared motion and triangle shape; translate the ROI toward measured motion. |
| Dot locks onto QR data | Check known inner-square size, solid interior, white gap and agreement with the other squares. |
| FPS drops when no QR is present | Search is throttled and analysis runs outside the rendering thread. |
| FPS stays low after a loss | Bound recovery, clear stale references, restore ordinary crop size, and forbid queued frames. Test before/lost/after-recovery phases. |
| Kalman and smoothing | Display-only. Predict position briefly, never feed predictions into image measurements or refresh identity. |
| Wireframe and live points | Kept. Live points disappear during held/predicted poses. |
| SLAM / accelerometer start marker | Deferred as requested; no room tracking or sensor integration added. |

The old blur/glare implementation and its options were removed from this prototype.
The comparison tracker can explicitly use `patternIntervalMs: 0` for the earlier
strict per-frame check and a `maxReuseMs` decode deadline. Normal sketches need
neither setting; the default and example use tracking-first behaviour.

## Display, status and configuration

- `markerSize: 1` is the full QR grid width, excluding the quiet zone. Inner square
  coordinates are modules 2–5 of each finder, not the outer 0–7 outline.
- `horizontalFov: 60` is an approximation. Explicit `{fx,fy,cx,cy,width,height}`
  intrinsics improve pose scale. Uncalibrated acquisition can make a bounded focal
  correction. Lens distortion is not modeled.
- `maxWidth: 640` caps the long edge of ordinary processing crops. Native camera
  detail is retained when the crop is smaller; the example requests 1280×720.
- `kalmanFilter: false` in the module, true in the example. Its constant-velocity
  position filter predicts for at most `predictionMs: 150`, shortened by uncertainty
  and displacement bounds. Rotation is smoothed, not predicted.
- `lostAfterMs: 650` is total display grace from the last actual observation;
  prediction is included in it. Display reads cannot extend it.
- `smoothing: 0.55` blends accepted observations. `renderSmoothingMs: 0` optionally
  eases display corrections; the example uses 0.4 and 60 ms. Neither modifies pixels,
  measured points or optical-flow history.

`drawCamera()` and `drawCubeWebGL({target: layer, size: 1, wireframe: true})` use
matching camera intrinsics and cover cropping. Use a transparent p5 WEBGL graphics
layer over the 2D camera canvas. The p5 2.2 adapter uses renderer camera/frustum
methods where Graphics does not expose wrappers. `drawCube()` remains a 2D helper.

Use `anchor.drawWebGL({target: layer}, g => { /* draw 3D geometry */ })` for your
own models and animation. It sets the same projection and marker transform, calls
your drawing function only while the anchor is visible, and restores drawing
state afterwards. Coordinates are in marker units, centred on the QR; positive Z
extends out of the printed surface. The example's `drawOrbitalGarden()` uses this
callback without changing the tracking pipeline.

`getLatest()` exposes native-video `corners`, `finderCentres`, intrinsics, pose,
`visible`, `holding`, `predicting`, `poseAgeMs`, and `statusMessage`. Measured
`finderCentres` is null during holding. The example keeps seven state-change log
entries, retains the last loss reason, and updates statistics four times per second.

Diagnostics include `backend`, `processingMs`, `phase` (search/track/recover),
`searchAttempted`, `cropWidth`, `cropHeight`, `centreLocalSearches`,
`centreFlowPoints`, `flowPerspective`, `centresFound`, `centreReason`, `centreChecks`, `patternVerification`,
`identityVerification`, `patternMatch` and `confidence`. Cached pattern scores
are labelled as the last check. Finder counts during acquisition are candidates,
not verified IDs. Confidence is a heuristic, not a probability. `centreChecks` describes the first
predicted patch for each finder (contrast, dark core/area, white sides); a later
local recovery can succeed after those initial checks failed.

## Source, tests and performance

The isolated local bundle uses modified ZXing 0.21.3 finder detection, binarization
and decoding. Portal owns geometry, flow, centroid tracking, lifecycle, scheduling
and rendering. No OpenCV, external tracker runtime or browser camera reader is bundled.
See NOTICE and the preserved licenses.

From the repository root:

```sh
npm ci --prefix scripts/qr-anchor
npm run build --prefix scripts/qr-anchor
node --test P1/tests/*.test.cjs
node scripts/qr-anchor/benchmark.cjs
```

The benchmark constructs images before timing, then reports before-loss, lost and
recovered phases, processing times, crop size and actual detector/tracker calls.
Run it without competing tests for useful comparisons. It measures the CPU pipeline
with synthetic canvas resampling, **not browser rendering FPS**.

Tests cover real encoded QR pixels, tilt, rotations, native ROI changes, translation
and reversal, false data patches, pose projection, identity timing, bounded loss,
camera ownership, worker transfer, queue bounds, stale replies and disposal. Real
sunlight, motion blur, browser capture paths and phone rendering still need device
validation. This remains a marker-following prototype, not an occlusion-tolerant
SLAM system.

For a consistent real-camera regression test, use the [recording replay](../../../scripts/qr-anchor/README.md). It generates per-frame results and a video overlay without controlling a browser.
