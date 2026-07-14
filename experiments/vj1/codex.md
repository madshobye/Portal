# VJ1 Project Handover

Last updated: 2026-07-14

VJ1 is an experimental browser-based VJ, visual-composition, and projection-mapping application. It runs directly from `experiments/vj1` without a build step and uses p5.js/WebGL for rendering. A selected local folder is the project and is the authoritative home for project JSON, media, shaders, mappings, revisions, and generated renditions.

This document describes the whole VJ1 application as it currently exists. Read it before changing rendering, sizing, composition semantics, live output, persistence, or project history.

## Product Model

The application has five workspaces:

1. **Compositions** (`compose`) builds reusable image-processing chains.
2. **Canvas** (`canvas`) places compositions on a larger canvas and defines rectangular sample regions for surfaces.
3. **Scenes** (`scene`) assigns compositions to projection surfaces and edits their quadrilateral mappings.
4. **Nodes** (`mapping`) exposes the compiled composition graph and scheduler state for inspection.
5. **Live** (`live`) selects the scene sent to the output window and provides temporary performance controls and parameter overrides.

The core mental model is one component type:

```text
input image -> component -> output image
```

Media and generators add pixels to the accumulated input. Effects process the accumulated image. A composition starts with a transparent image, so a generator does not implicitly replace earlier content. The UI still labels items as `media`, `generator`, or `effect` for clarity, but the chain is sequential.

Groups are isolated subchains. Their children render into a transparent intermediate buffer, effects inside the group apply only to that buffer, and the group result is then composited into the parent chain. Moving an item into or out of a group must preserve this isolation.

## Runtime Entry Points

`js/app.js` selects a client from URL parameters:

| URL mode | Purpose |
| --- | --- |
| no output parameter | Full control UI with embedded preview |
| `?output=1` | Popup/live projection output |
| `?preview=1` | Standalone scene preview |
| `?composition=1` | Standalone composition preview |
| `?fixture=tests/fixtures/FILE.json` | Load a deterministic fixture in output/preview mode |

The control app creates the state store, media library, project-folder service, BroadcastChannel bridge, control shell, and one embedded p5/WebGL preview.

The output clients create their own p5/WebGL canvas and `OutputRenderer`. They receive serializable state over BroadcastChannel and request `File` objects separately because files are not persisted in project JSON.

## Important Files

### Application and state

- `js/app.js`: bootstraps control or output mode and routes state changes to autosave and output synchronization.
- `js/app-state.js`: action-oriented mutable store built on cloned, sanitized state.
- `js/domain/models.js`: defaults, normalization, migration compatibility, scene snapshots, canvas compositions, chain items, groups, transforms, and live render-state derivation.
- `js/constants.js`: workspace names, default resolutions, blend modes, channel name, CDN paths, and default custom shader.
- `js/view-routing.js`: client mode and workspace URL/session routing.

### Control UI

- `js/control/control-shell-controller.js`: the main UI controller and most templates and event binding. It owns composition/group editing, drag reorder, canvas rectangle interaction, scene/surface controls, live controls, dynamic parameter controls, color controls, media pickers, and modal state.
- `js/control/shell-view.js`: top-level shell markup.
- `js/control/reorder-list.js`: drag-reorder behavior.
- `style.css`: all application styling. Several UI regressions have come from overlapping selectors, so prefer one shared control style rather than workspace-specific duplicates.

### Graph and components

- `js/graph/component-schema.js`: common node, port, parameter, and render-contract definitions.
- `js/graph/generator-registry.js`: generator metadata and dynamic UI parameters.
- `js/shaders/shader-registry.js`: effect metadata, GLSL, categories, and parameters.
- `js/shaders/generator-shaders.js`: full-frame GLSL generators.
- `js/graph/render-scheduler.js`: compiles chains into visual nodes and texture edges.
- `js/graph/manual-scheduler.js`: manual scheduling support.
- `js/graph/patch-planner.js`: patch planning.
- `js/shaders/shader-builder.js`: compiles effect GLSL, fuses safe pixel-local effect runs, precomputes transform uniforms, and caches shaders per WebGL context.

### Rendering and mapping

- `js/output/output-renderer.js`: the primary renderer. It owns composition evaluation, groups, canvas compositions, render-size requests, specialized sources, media, pooled shared-context framebuffer targets, shader passes, caching, surfaces, mapper integration, thumbnails, handles, readiness blackout, and runtime profiling.
- `js/output/shared-framebuffer-target.js`: a top-left 2D facade over p5 framebuffers. It keeps composition and effect targets in the main WebGL context and prevents centered p5 drawing state from shifting buffer copies.
- `js/output/output-app.js`: popup/standalone p5 client, resizing, fixture loading, and output bridge.
- `js/output/embedded-preview-app.js`: embedded preview lifecycle, sizing, local media import, thumbnails, mapping updates, and transform handles.
- `js/output/render-geometry.js`: frame, world, surface-texture, mapping, and preview sizing contracts.
- `js/output/vj-mapper.js`: VJ1's projection mapper, homography calculation, corner handles, overlays, reset, and mapping import/export.
- `js/output/media-utils.js`: image/video fit and playback helpers.
- `js/output/blend-utils.js`: composition blend modes.

### Persistence and communication

- `js/services/project-folder-service.js`: folder open/close, scaffold creation, autosave, refresh, revisions, undo/redo, imports, and rendition writes.
- `js/services/media-library-service.js`: recursive media/shader discovery and in-memory `File` ownership.
- `js/services/media-rendition-service.js`: cached media rendition paths and dimensions.
- `js/services/directory-handle-store.js`: stored File System Access directory handle.
- `js/services/output-bridge-service.js`: control/output BroadcastChannel protocol.

### Metrics and tests

- `js/metrics/composition-metrics.js`: static project analysis, runtime summaries, comparisons, and bottleneck estimates.
- `metrics.html`: browser runtime collector.
- `tests/*.test.mjs`: Node tests.
- `tests/shader-smoke.html`: real WebGL shader compilation smoke test.
- `tests/fixtures`: deterministic browser fixtures.
- `metrics-results`: checked-in baselines and representative old runs.

## State and Persistence

Every state replacement passes through `sanitizeState()`. Add new persistent fields to defaults and normalization together; otherwise refreshes can reset parameters or old projects can produce invalid state.

The major state sections are:

- `project`: name, folder name, save information, warnings.
- `ui`: current workspace and selected composition, chain item, scene, surface, preview viewport, live overrides, and UI status.
- `global`: blackout, BPM, crossfade, HUD/debug labels, calibration, and mapping-handle mode.
- `render`: output frame, world size, surface texture budget, pixel density, and edge softness.
- `media`: serializable media metadata only.
- `compositions`: chain and canvas compositions.
- `surfaces`: global surface definitions and ordering.
- `scenes`: snapshots of surface assignment, presence, enable state, order, and composition selection.
- `mappings`: local quadrilateral mapping data.
- `shaders`: custom shader source and name.
- `metrics`: latest output and preview measurements.

Opening an empty folder creates:

```text
media/
shaders/
scenes/
mappings/
vj1-cache/
  renditions/
```

`project.json` is written on the first save. Autosave is debounced by 700 ms. Meaningful changes create revisions; repeated edits to the same control path coalesce for six seconds. UI-only state and metrics are excluded from history signatures. Undo and redo operate through revision files, not an in-memory command stack.

Do not make localStorage authoritative. Session storage is only used for workspace convenience. Directory handles may be retained in IndexedDB, but permission can still need to be restored by the user.

## Composition Semantics

Two composition forms exist:

### Chain composition

`composition.chain` contains source, effect, and group items. Each enabled item consumes the current buffer and produces the next buffer.

- A source is media, camera, black, or a generator.
- A source has blend, opacity, transform, and source-specific parameters.
- An effect has effect parameters and may have a spatial transform.
- A group has its own transform, blend, opacity, and nested chain.
- Disabled items are skipped and should not affect thumbnails or runtime cost.

The graph compiler exposes a linear node graph for inspection, but `OutputRenderer` is authoritative for pixels, especially group isolation.

### Canvas composition

A canvas composition has a large logical canvas and layers referencing ordinary compositions. Scene surfaces can select rectangular `sourceRect` regions from that canvas. Rectangles can be created, moved, and resized in the Canvas workspace. This lets several surfaces sample different areas of one coordinated visual composition.

Canvas compositions are routable to scene surfaces like ordinary compositions. They currently normalize with an empty `chain`, and `renderCanvasComposition()` returns the layered canvas directly. Applying a post-effect to the complete canvas is therefore a known missing capability, not an existing pipeline feature.

## Generators and Effects

Current generators include test pattern, waves, noise, plasma, gradient, fireflies, 3D eyeball, low-poly anatomy, terrain flyover, Bezier strokes, swaying trees, checker, and black.

Current effects include ripple, RGB split, photo grade, label chromatic/grain/threshold grain, smear, crayon/pen stroke, hard black, blur, erode, dilate, grayscale, threshold, invert, kaleido, pixelate, plasma, luma key, alpha vignette, glitch distortion, spin/rotate, flip, echo fade, mirror fold, heat shimmer, heartbeat pulse, and custom GLSL.

Parameter controls are generated from component schemas. Number, enum, boolean, and RGBA color types must work in both composition and Live views. Do not add a one-off UI control when the schema can describe it.

Timing-based effects and generators use instance-derived offsets so separate chain instances and separate surface routes do not synchronize unintentionally.

## Render Pipeline

At a high level each frame does:

```text
state -> needed compositions -> composition buffers -> surface textures
      -> homography mapping -> output frame -> HUD/debug overlay
```

Important details:

1. Only compositions required by the current workspace/scene are rendered.
2. Static compositions are signature-cached.
3. Dynamic sources and effects invalidate per frame.
4. Composition, group, source, and effect intermediates prefer pooled p5 framebuffers in the output canvas's WebGL context, so compatible chains remain GPU-resident.
5. Consecutive safe pixel-local effects are fused into one physical shader draw; neighborhood and stateful effects remain separate.
6. Groups use isolated transparent intermediates.
7. Surface presentation/timing identity is separate from composition render identity, so two surfaces can share the same composition result without synchronizing route-specific timing.
8. Surface textures are bounded by `render.surfaceWidth`/`surfaceHeight` and can be reduced to the mapped surface size.
9. Composition previews use the current preview frame or requested texture resolution, not the popup window's dimensions.
10. The output canvas follows the window size, while the logical output frame keeps the configured frame aspect and fills/crops according to output fitting rules.

Alpha is premultiplied through shader passes. Effects must not turn transparent black into opaque white or black. Shader output should generally follow:

```glsl
gl_FragColor = vec4(rgb * alpha, alpha);
```

Never clear a compositing intermediate with opaque black unless black is the explicit source.

## Specialized Rendering Paths

Not every generator is rendered through `generator-shaders.js`.

- **Low-poly anatomy** is generated as p5/WebGL geometry in `drawAnatomyGenerator()`.
- **STL/OBJ media** uses parsed model data and raw WebGL surface, wire, and point renderers with cached GPU buffers.
- **Terrain flyover** is handled by `drawTerrainGenerator()` using `TERRAIN_VERTEX_SHADER` and `TERRAIN_FRAGMENT_SHADER` in `output-renderer.js`.

Terrain currently renders a p5 plane subdivided `48 x 48`; the vertex shader displaces that polygon grid. This is the active terrain renderer. A separate older `terrainFlyover` fragment definition remains in `generator-shaders.js`, but the renderer explicitly bypasses it. Treat that definition as stale fallback/technical debt, not evidence that the active terrain is ray-marched.

The terrain fragment shader currently draws a UV grid using `40.0 * gridDensity`. Therefore the visible wires follow the displaced terrain but do not exactly represent the `48 x 48` mesh edges. A pending improvement is to align wire frequency with real mesh cells, make non-terrain pixels transparent instead of sky/white, and improve the camera perspective. Keep the polygon path; a full-screen ray marcher would generally do more height evaluations per pixel and is not preferred here.

## Mapping, Frame, World, and Texture Sizes

These dimensions have different jobs and must not be conflated:

- **Frame size** is the configured final output resolution/aspect.
- **World size** is currently fixed to 1.5 times the frame and gives scene mapping room around the output frame.
- **Surface texture size** is the maximum per-surface composition render budget.
- **Preview canvas size** is a UI/display concern and must not silently increase render resolution.
- **Popup window size** controls the HTML/p5 canvas display, not composition texture quality.

Mappings are stored in world coordinates. `VjMapper` computes and caches a homography from four corners, applies the inverse transform at the quad vertices, and rasterizes the routed texture as a real projective quadrilateral. Mapping reset, import, resize, and scene snapshots must use the same coordinate convention. Surface order is draw order.

The output window and embedded preview must show the same crop, aspect, and mapping. When they differ, inspect `render-geometry.js`, `surfaceRouteRenderRequest()`, `drawSurfaceRoute()`, and the output frame transform before changing source-fit behavior.

## Media

Supported media includes images, videos, SVG, STL, and OBJ. Camera input is supplied through the Portal camera integration.

- Images support contain/cover behavior and source transforms without losing access to pixels outside the composition frame.
- Videos support start/end trim and playback speed.
- SVG loading is asynchronous and must resolve to a drawable image before removing loading state.
- STL/OBJ parsing produces triangles and cached surface/wire/point GPU buffers.
- Model draw mode, colors, rotations, spin, scale, depth, visible-depth cutoff, wire thickness, and point budget are source parameters.
- Media renditions are PNG to avoid noise damage from lossy JPEG compression.

When media is missing in an output client, the entire output blacks out and shows only the small loading indicator/HUD. Do not render effects over loading placeholders.

## Live Output and Synchronization

Control and output clients use `BroadcastChannel("vj1-output-bridge")`.

- Output clients announce themselves every two seconds.
- Control responds with render state and media files.
- Output sends FPS, frame time, render cost, pass profiles, mapping updates, and media requests.
- Slider scrubs are transmitted on the next animation frame for low-latency live performance.
- Normal edits send immediately unless excluded as UI-only state.

Scene editing and Live selection are deliberately separate. Editing a scene must not switch the live output scene. Opening the output while in scene mode should initially show the selected scene, while later Live selection remains explicit.

Avoid rebuilding large DOM subtrees while a slider, select, trim range, or color picker is active. Background state refreshes previously closed color pickers and interrupted pointer interaction.

## Performance Rules

The main risks are pixel count, pass count, duplicate WebGL contexts, unnecessary dynamic invalidation, and CPU-generated geometry.

- Keep one embedded WebGL preview and one context per actual output window. Dispose graphics and renderer resources on page hide.
- Reuse WebGL targets; do not create graphics buffers on resize or every frame without cache/disposal rules.
- Keep framebuffer copies on the shared top-left drawing contract; p5's main WEBGL renderer otherwise inherits centered image state across targets.
- Prefer one bounded shader pass over chains of small passes where behavior can be combined cleanly.
- Skip neutral/zero-amount passes before drawing.
- Preserve static-composition caching by accurately reporting whether sources/effects are dynamic.
- Use cheap hash functions rather than p5 random/noise in per-pixel or per-particle loops.
- Avoid shader `sin`, `cos`, `sqrt`, and `distance` where a stable cheaper formulation is sufficient, but do not sacrifice required visual correctness blindly.
- Bound loops at compile time for WebGL compatibility.
- For 3D terrain, prefer a reusable displaced polygon grid over per-pixel ray marching.
- Treat CPU load in the UI as incomplete: GPU timer data is not universally available. Pass timings and frame behavior are still useful comparative signals.

The debug HUD displays FPS and active render resolution. Runtime profiles contain source, shader-pass, ping-pong, surface, and frame information where available.

## Testing and Metrics

From `experiments/vj1`:

```sh
npm test
npm run test:metrics
npm run test:render
npm run metrics -- /path/to/project.json --save
```

Before finishing renderer work:

1. Run `npm test`.
2. Run `git diff --check`.
3. Open the relevant fixture in Chrome.
4. Verify the actual WebGL output at desktop and a narrow viewport when UI changed.
5. Compare embedded composition preview, scene preview, and popup output when sizing or mapping changed.
6. Inspect `#vj1-runtime-metrics` or `window.__vj1RuntimeMetrics` for runtime samples.
7. Save meaningful before/after reports in `metrics-results/runs` and compare them.

Useful fixture URL:

```text
https://127.0.0.1:8082/experiments/vj1/?output=1&fixture=tests/fixtures/four-surface-show.json
```

The shader smoke page must be used for new GLSL because Node tests only inspect strings and schemas; they do not compile WebGL shaders.

## Current Handover Status

The VJ1 worktree contains uncommitted changes spanning terrain, low-poly anatomy, STL/OBJ rendering, render geometry, output synchronization, UI controls, crayon stroke, Bezier strokes, the GPU-resident composition architecture, fixtures, metrics reports, and tests. Do not discard or broadly rewrite these changes. Read the diff before touching files that already changed.

The test suite currently has 115 passing Node tests. The shared-framebuffer composition pipeline, effect fusion, projective quad mapper, cached shader noise, shader smoke page, popup output, scene preview, and composition preview were last verified together on 2026-07-14. The representative before/after runtime comparison is stored under `metrics-results/runs/four-surface-show-gpu-architecture.*`.

## Change Discipline

- Preserve project-file compatibility through normalization.
- Preserve alpha through every stage.
- Keep preview and popup output behavior equivalent.
- Keep scene editing separate from Live output selection.
- Keep groups isolated.
- Keep transforms attached to their intended source/effect field rather than transforming the entire accumulated image accidentally.
- Do not create extra WebGL contexts to solve local rendering problems.
- Add focused tests for every bug fix, especially sizing, scene snapshots, chain/group ordering, alpha, caching, and specialized render paths.
- Update cache-busting query strings when browser modules would otherwise stay stale during manual verification.
