# VJ1 Metrics: Four Surface Metrics Show

Generated: 2026-07-10T10:20:26.856Z

## Summary

- Compositions: 4
- Active surfaces: 4
- Surface texture: 360.0 KP (800x450)
- World: 1.17 MP (1440x810)
- Estimated render work: 24.65
- Runtime samples: 69, fps avg 15.0, frame p95 428.4 ms
- Runtime steady: 66 samples after 3 warm-up, fps avg 13.4, frame p95 139.4 ms
- Shader profile: 15.0 pass(es)/sample, 4.0 chain(s)/sample, 0.0 handoff(s)/sample

## Runtime Slow Passes

- composition: 1336.70 ms (800x450, composition)
- composition: 953.90 ms (800x450, composition)
- composition: 798.30 ms (800x450, composition)
- composition: 388.20 ms (800x450, composition)
- Blur: 287.90 ms (800x450, webgl)
- Luma Key: 277.10 ms (800x450, webgl)
- Label Grain: 240.80 ms (800x450, webgl)
- Plasma Tint: 236.90 ms (800x450, drawable)

## Costliest Chain Items

- Noise Key Stack / Dilate: 1.89 (effect, dilate shader, depth 4)
- Waves Luma Stack / Blur: 1.88 (effect, blur shader, depth 2)
- Noise Key Stack / Label Grain: 1.87 (effect, labelGrain shader, depth 5)
- Noise Key Stack / Erode: 1.81 (effect, erode shader, depth 3)
- Plasma Geometry Stack / RGB Split: 1.66 (effect, rgbSplit shader, depth 3)
- Test Pattern Stack / RGB Split: 1.58 (effect, rgbSplit shader, depth 2)
- Noise Key Stack / Threshold: 1.53 (effect, threshold shader, depth 2)
- Test Pattern Stack / Pixelate: 1.51 (effect, pixelate shader, depth 3)
- Plasma Geometry Stack / Kaleido: 1.45 (effect, kaleido shader)
- Plasma Geometry Stack / Ripple: 1.43 (effect, ripple shader, depth 2)

## Engine Optimization Targets

- HIGH Sequential shader passes: 15 enabled effect pass(es) across active compositions; each pass is still a full texture render even when ping-pong buffers avoid intermediate handoff copies.
- HIGH Heavy shader components: Noise Key Stack/Dilate, Waves Luma Stack/Blur, Noise Key Stack/Label Grain, Noise Key Stack/Erode are likely expensive fragment passes.
- MEDIUM Per-surface texture and mapper draw: 4 active surface(s) each require a surface texture draw plus a homography mapper pass at 800x450.
- LOW Calibration overlays and labels: Calibration mode draws handles, output-frame overlays, and per-surface text labels on top of render output.

## Bottlenecks

- CRITICAL runtime: 95th percentile render cost is 5141% of a 120fps frame budget.
- CRITICAL runtime: Steady 95th percentile render cost is 1672% of a 120fps frame budget.
- WARN Noise Key Stack: Longest branch has 5 sequential effects.
- WARN runtime: Average FPS is 15.0.
- WARN runtime: 95th percentile frame time is 428.4 ms.
- INFO Waves Luma Stack: Cost contributor: Blur (1.88, blur shader, depth 2).
- INFO Noise Key Stack: Cost contributor: Dilate (1.89, dilate shader, depth 4).
- INFO Noise Key Stack: Cost contributor: Label Grain (1.87, labelGrain shader, depth 5).
- INFO runtime: Longest observed shader chain was 5 pass(es).

## Compositions

- Test Pattern Stack: work 4.90, sources 1/1, effects 3/3, branches 1
- Waves Luma Stack: work 6.25, sources 1/1, effects 4/4, branches 1
- Noise Key Stack: work 7.60, sources 1/1, effects 5/5, branches 1
- Plasma Geometry Stack: work 4.90, sources 1/1, effects 3/3, branches 1

## Mapping

- Mapped surfaces: 4/4
- Degenerate surfaces: 0
- Off-world corners: 0