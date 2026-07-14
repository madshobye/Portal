# VJ1 Metrics: Four Surface Metrics Show

Generated: 2026-07-14T14:48:56.515Z

## Summary

- Compositions: 4
- Active surfaces: 4
- Surface texture: 360.0 KP (800x450)
- World: 1.17 MP (1440x810)
- Estimated render work: 24.65
- Runtime samples: 12, fps avg 60.0, frame p95 4.8 ms
- Runtime steady: 9 samples after 3 warm-up, fps avg 60.0, frame p95 4.3 ms
- Shader profile: 13.0 pass(es)/sample, 13.0 chain(s)/sample, 0.0 handoff(s)/sample

## Costliest Chain Items

- Noise Key Stack / Dilate: 1.89 (effect, dilate shader, depth 4)
- Waves Luma Stack / Blur: 1.88 (effect, blur shader, depth 2)
- Noise Key Stack / Label Grain: 1.87 (effect, labelGrain shader, depth 5)
- Noise Key Stack / Erode: 1.81 (effect, erode shader, depth 3)
- Plasma Geometry Stack / RGB Split: 1.66 (effect, rgbSplit shader, depth 3)
- Test Pattern Stack / Pixelate: 1.63 (effect, pixelate shader, spatial transform, depth 3)
- Test Pattern Stack / RGB Split: 1.58 (effect, rgbSplit shader, depth 2)
- Plasma Geometry Stack / Kaleido: 1.57 (effect, kaleido shader, spatial transform)
- Plasma Geometry Stack / Ripple: 1.55 (effect, ripple shader, spatial transform, depth 2)
- Noise Key Stack / Threshold: 1.53 (effect, threshold shader, depth 2)

## Engine Optimization Targets

- HIGH Sequential shader passes: 15 enabled effect pass(es) across active compositions; each pass is still a full texture render even when ping-pong buffers avoid intermediate handoff copies.
- HIGH Heavy shader components: Noise Key Stack/Dilate, Waves Luma Stack/Blur, Noise Key Stack/Label Grain, Noise Key Stack/Erode are likely expensive fragment passes.
- MEDIUM Per-surface texture and mapper draw: 4 active surface(s) each require a surface texture draw plus a homography mapper pass at 800x450.
- LOW Calibration overlays and labels: Calibration mode draws handles, output-frame overlays, and per-surface text labels on top of render output.

## Bottlenecks

- WARN Noise Key Stack: Longest branch has 5 sequential effects.
- INFO Waves Luma Stack: Cost contributor: Blur (1.88, blur shader, depth 2).
- INFO Noise Key Stack: Cost contributor: Dilate (1.89, dilate shader, depth 4).
- INFO Noise Key Stack: Cost contributor: Label Grain (1.87, labelGrain shader, depth 5).

## Compositions

- Test Pattern Stack: work 4.90, sources 1/1, effects 3/3, branches 1
- Waves Luma Stack: work 6.25, sources 1/1, effects 4/4, branches 1
- Noise Key Stack: work 7.60, sources 1/1, effects 5/5, branches 1
- Plasma Geometry Stack: work 4.90, sources 1/1, effects 3/3, branches 1

## Mapping

- Mapped surfaces: 4/4
- Degenerate surfaces: 0
- Off-world corners: 0

## Comparison

- Previous: 2026-07-10T10:36:14.705Z
- Current: 2026-07-14T14:48:56.515Z
- Estimated work delta: 0.00
- Critical bottleneck delta: 0
- Warning bottleneck delta: -1
- Runtime frame p95 delta: +0.6 ms

### Added Bottlenecks
- None

### Resolved Bottlenecks
- WARN runtime: Average FPS is 38.6.
- INFO runtime: Longest observed shader chain was 5 pass(es).