# VJ1 Project Handover

Last updated: 2026-07-15

VJ1 is an experimental browser-based VJ, visual-composition, and projection-mapping application. It runs directly from `experiments/vj1` without a build step and uses p5.js plus raw WebGL where tighter control is required. A selected local folder is the project and is the authoritative home for project JSON, media, shaders, mappings, revisions, and generated renditions.

This document describes the whole VJ1 application as it currently exists. Read it before changing rendering, sizing, composition semantics, live output, persistence, or project history.

## Product Model

The application has five workspaces:

1. **Compositions** (`compose`) builds reusable image-processing chains.
2. **Canvas** (`canvas`) places reusable compositions on a larger composition and defines named recording frames.
3. **Scenes** (`scene`) routes compositions or Canvas recording frames to projection surfaces and edits their quadrilateral mappings.
4. **Nodes** (`mapping`) exposes the compiled composition graph and scheduler state for inspection.
5. **Live** (`live`) selects the scene sent to the output window and provides temporary performance controls and parameter overrides.

The Compositions workspace catalog contains only ordinary compositions. Canvas containers and their derived recording-frame source nodes belong to the Canvas and Scenes workspaces and must not appear in the Compositions rail. Switching from Canvas to Compositions selects an ordinary composition rather than leaving a hidden Canvas active.

The core mental model is one component type:

```text
input image -> component -> output image
```

Media and generators add pixels to the accumulated input. Effects process the accumulated image. A composition starts with a transparent image, so a generator does not implicitly replace earlier content. The UI still labels items as `media`, `generator`, or `effect` for clarity, but the chain is sequential.

Groups are isolated subchains. Their children render into a transparent intermediate buffer, effects inside the group apply only to that buffer, and the group result is then composited into the parent chain. Moving an item into or out of a group must preserve this isolation.

The scene compositor is texture-based and two-dimensional. Specialized generators and STL/OBJ sources may render real 3D geometry internally, but each is flattened into its composition texture before surface routing and projection mapping. There is no shared scene-wide 3D space, depth buffer, camera, or lighting model between composition elements.

## Runtime Entry Points

`js/app.js` selects a client from URL parameters:

| URL mode | Purpose |
| --- | --- |
| no output parameter | Full control UI with embedded preview |
| `?output=1` | Popup/live projection output |
| `?preview=1` | Standalone scene preview |
| `?composition=1` | Standalone composition preview |
| `?fixture=tests/fixtures/FILE.json` | Load a deterministic fixture in control, output, or preview mode |

The control app creates the state store, media library, project-folder service, BroadcastChannel bridge, control shell, and one embedded p5/WebGL preview. The preview toggle pauses live preview rendering and uses stored thumbnails instead; it does not change popup output rendering.

The output clients create their own p5/WebGL canvas and `OutputRenderer`. They receive serializable state over BroadcastChannel and request `File` objects separately because files are not persisted in project JSON.

## Important Files

### Application and state

- `js/app.js`: bootstraps control or output mode and routes state changes to autosave and output synchronization.
- `js/app-state.js`: action-oriented mutable store built on cloned, sanitized state.
- `js/domain/models.js`: defaults, normalization, migration compatibility, scene snapshots, canvas compositions, chain items, groups, transforms, and live render-state derivation.
- `js/domain/composition-frame.js`: composition aspect presets, resolution scales, and logical/physical frame metrics.
- `js/constants.js`: workspace names, default resolutions, blend modes, channel name, CDN paths, and default custom shader.
- `js/view-routing.js`: client mode and workspace URL/session routing.

### Control UI

- `js/control/control-shell-controller.js`: the main UI controller and most templates and event binding. It owns composition/group editing, drag reorder, scene/surface controls, live controls, dynamic parameter controls, color controls, media pickers, and modal state.
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

GPU timer queries are diagnostic sampling, not part of the render contract. The renderer samples them periodically and strictly bounds unresolved queries so unsupported or slow query delivery cannot create a growing per-frame polling workload. Render-buffer liveness must be refreshed in the usage map with the exact key of the CPU or GPU cache that supplied the active buffer; otherwise the idle-cache pruner can dispose a buffer that is still in use.

Composition and Canvas thumbnail maintenance must decide staleness from signatures before reading pixels. Calling `get()` on a shared WebGL framebuffer is a synchronous full-frame GPU-to-CPU readback; it must never run merely to discover that the stored thumbnail is already current. The thumbnail interval throttles both stale checks and actual captures.

## State and Persistence

Every state replacement passes through `sanitizeState()`. Add new persistent fields to defaults and normalization together; otherwise refreshes can reset parameters or old projects can produce invalid state.

The major state sections are:

- `project`: name, folder name, save information, warnings.
- `ui`: current workspace and selected composition, chain item, scene, surface, preview viewport, live overrides, and UI status.
- `global`: blackout, BPM, crossfade, HUD/debug labels, calibration, and mapping-handle mode.
- `render`: ordered projector output definitions, shared mapping-world size, surface texture budget, pixel density, edge softness, composition upscaling, and full-resolution post-filter settings.
- `media`: serializable media metadata only.
- `compositions`: chain and canvas compositions.
- `recordingFrames`: project-level recording rectangles shared by every canvas composition.
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

The project file persists the selected composition, chain item, and surface. Loading and sanitization retain those selections when the referenced IDs still exist and fall back safely when they do not. Folder refreshes update media and shader assets without replacing the project state, which prevents periodic refresh from jumping the selection back to the first composition. The control client attempts to restore the last directory handle on startup; if browser permission is unavailable it keeps the project closed and asks the user to restore access.

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

Older project files may still contain top-level `composition.source` and `composition.shaderChain`. Normalization migrates these fields into `composition.chain`, and a few renderer/graph fallbacks remain for compatibility. New features must use `composition.chain`; do not remove the legacy fields or fallbacks until there is an explicit project-format migration.

### Canvas composition

A Canvas is a composition with a large logical frame. Its `composition.chain` uses exactly the same source, effect, and Group abstractions as an ordinary composition. Referenced compositions are ordinary source items added through the shared plus menu; Groups are optional and never created implicitly. A referenced composition is initially centered at its own logical width, height, and aspect ratio instead of being expanded to the Canvas. Its row and inspector derive the label directly from the referenced composition and do not expose an editable placement-wrapper name or composition-replacement dropdown. To replace a Canvas placement, remove it and add the desired composition through the plus menu. Placement blend and opacity remain instance properties on the Canvas source item. Sources and Groups use the standard preview transform handles for movement, scale, and rotation. Effects process the accumulated Canvas chain, so composition features should be implemented once rather than copied into a Canvas-only abstraction.

Project-level `recordingFrames` contains the named recording rectangles shared by every Canvas, just as surfaces are shared across scenes. Adding, moving, resizing, or removing a frame from any Canvas therefore updates the same frame in every Canvas. The real rendered Canvas preview draws each frame with direct manipulation: drag its outline to move it or drag any corner to change width and height independently while keeping the frame rectangular and inside the Canvas. The frame interior is deliberately not hit-active, allowing composition and Group handles beneath it to remain draggable. The inspector only creates and removes frames; it does not duplicate geometry controls. In Scenes, each Canvas/frame output is exposed as a generic source node beside ordinary composition nodes and routed to a surface through `surface.sourceNodeId`. The surface owns the route and projection fit; Canvases do not own or list surfaces. Legacy per-Canvas `canvas.frames` values migrate into the shared registry, legacy `canvas.layers` data migrates to ordinary Groups, and legacy surface `sourceRect` values remain a renderer fallback for old projects. Canvas-in-canvas nesting and self-reference are rejected during selection and normalization.

Scene routing is based on generic derived source nodes from `sceneSourceNodes()`. An ordinary composition produces one `composition` node; each Canvas and shared recording-frame pair produces one `recording-frame` node. Both kinds appear in the selected surface's Scene assignment list and are selected through `surface.sourceNodeId`. Each Canvas stores frame thumbnails keyed by the shared recording-frame ID; the preview renderer crops these from that Canvas's rendered pixels using the frame geometry, so derived nodes show their own sampled region rather than the whole Canvas. The whole-Canvas thumbnail is only a fallback until a frame crop is captured. The node resolves to the underlying Canvas/composition and optional frame geometry at the renderer boundary. `compositionId` and `outputFrameId` remain synchronized on surfaces and snapshots only for project-format compatibility and old-project migration; new UI paths must select a source node rather than maintaining those fields independently.

Surface `feather` is a physical per-surface projection property, clamped from `0` to `0.5` and intentionally excluded from scene snapshots. The mapper applies it as an edge-alpha smoothstep in the existing projective sampling shader, so feathering adds no render pass and remains stable when Scenes change. The default zero value selects the original mapper shader variant, which contains no feather uniform, branch, or edge math; the feather-enabled shader is selected only for surfaces with a nonzero value.

`renderCanvasComposition()` evaluates the shared chain into one GPU target whose physical size comes from the current demand request while transforms and recording frames retain Canvas-logical coordinates. A routed frame is sampled from that adaptively sized Canvas raster into an adaptively bounded surface texture before projection mapping. Large logical Canvas dimensions therefore do not require a same-sized GPU texture unless Full-quality preview or a sufficiently large mapped route actually demands it.

Canvas logical dimensions and editor render density are separate. The default `canvas.previewQuality: "auto"` renders the editor target at approximately its visible preview size, `"low"` uses half that width and height, and `"full"` renders the complete logical Canvas. This preview policy must not alter recording-frame coordinates. Routed output continues to make its own render request and is not reduced by the editor preview-quality setting.

## Generators and Effects

Current generators include test pattern, waves, noise, plasma, gradient, fireflies, 3D eyeball, low-poly anatomy, terrain flyover, Bezier strokes, Base Warp, Seascape, Paint Drips, Cloudy Tunnel, Cherenkov Volume, Biomine Lite, swaying trees, checker, and black.

Current effects include ripple, RGB split, photo grade, label chromatic/grain/threshold grain, smear, crayon/pen stroke, hard black, blur, erode, dilate, grayscale, threshold, invert, kaleido, pixelate, pixel-art upscale, plasma tint, luma key, HSV alpha key, alpha vignette, glitch distortion, spin/rotate, flip, echo fade, mirror fold, heat shimmer, heartbeat pulse, and custom GLSL.

Parameter controls are generated from component schemas. Number, paired numeric range, enum, boolean, and RGBA color types must work in both composition and Live views. Paired ranges use two handles on one track and keep the lower and upper values ordered. Do not add a one-off UI control when the schema can describe it.

The HSV alpha key removes pixels inside a selected hue, saturation, and value box, with a feathered boundary. Its defaults target dark blues: `200–260°` hue, `40–100%` saturation, and `0–45%` value. It converts premultiplied input to straight RGB only for HSV classification, then applies the resulting keep factor back to both premultiplied RGB and alpha.

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
10. Each output canvas follows its window size, while its selected logical projector viewport keeps the configured aspect and fills/crops according to output fitting rules.
11. Canvas containers render at their logical dimensions so recording-frame coordinates remain exact; their referenced compositions can still reuse the normal composition cache.

Project settings can enable an experimental composition output pipeline. When enabled, chain compositions render at `render.upscaling.amount` of their normal physical texture size while retaining their original logical dimensions, then pass through one fast spatial upscale at the normal composition target size. Optional grayscale and animated monochrome noise are combined into a second post pass at that full target size. The pipeline is off by default, canvas containers do not receive a second upscale over their already-processed child compositions, and animated post noise disables stable-frame caching for the affected output.

Alpha is premultiplied through shader passes. Effects must not turn transparent black into opaque white or black. Shader output should generally follow:

```glsl
gl_FragColor = vec4(rgb * alpha, alpha);
```

Never clear a compositing intermediate with opaque black unless black is the explicit source.

## Specialized Rendering Paths

Not every generator is rendered through `generator-shaders.js`.

- **Low-poly anatomy** is generated as p5/WebGL geometry in `drawAnatomyGenerator()`.
- **STL/OBJ media** uses parsed model data and raw WebGL surface, wire, and point renderers with cached GPU buffers. Source transforms are folded into the raw model matrix, and visible-depth clipping is calculated from the transformed normalized mesh bounds rather than a fixed guessed radius.
- **Terrain flyover** is handled by `drawTerrainGenerator()` using cached raw-WebGL surface and wire resources plus the terrain shaders in `output-renderer.js`.

Terrain is polygon-based, not a full-screen ray marcher. Grid width and depth define logical terrain extents, while grid density and render quality determine tessellation. Surface, wire, and hybrid styles share the same displaced terrain coordinate system. Geometry and shader resources are cached per WebGL context and rebuilt only when their topology key changes. Spatial scale changes preserve phase continuity so moving scale-related controls does not cause the terrain/noise field to jump wildly. Terrain exists only in the specialized raw-WebGL path; do not add it to the full-frame generator shader registry or shader smoke list.

## Mapping, Frame, World, and Texture Sizes

These dimensions have different jobs and must not be conflated:

- **Output size** is one configured projector's logical resolution/aspect. `render.outputs` is ordered and old `frameWidth`/`frameHeight` projects migrate to one `output-main` definition.
- **World size** contains every output frame arranged edge-to-edge horizontally, with outer margins but no gap between projectors. Scene mapping operates in this shared coordinate system, so a surface may lie inside one output or span several.
- **Surface texture size** is the maximum per-surface render budget, not a mandatory allocation size.
- **Preview canvas size** is a UI/display concern. The embedded renderer keeps logical world coordinates intact but adds a transient `previewRasterScale`, so physical canvas and intermediate buffers follow the pixels the preview can actually display.
- **Popup window size** controls the HTML/p5 canvas display, not composition texture quality.

Preview viewport fit modes are semantic rather than reusable numeric zooms. Scene/Live resolves `fit: "frame"` against the shared output world, while Composition/Canvas resolves automatic fits to its already frame-sized logical canvas. Only `fit: "manual"` deliberately carries the exact zoom and pan between workspaces; otherwise a Scene frame-fit zoom must never leak into Canvas and cause a transition overscale.

Mappings are stored in world coordinates. `VjMapper` computes and caches a homography from four corners, applies the inverse transform at the quad vertices, and rasterizes the routed texture as a real projective quadrilateral. Mapping reset, import, resize, and scene snapshots must use the same coordinate convention. Surface order is draw order.

Projection handle and whole-surface drags emit live `scrub:mapping-state` updates so connected outputs follow the pointer before release. These live updates are animation-frame throttled by the control bridge and excluded from autosave; pointer release emits the final `mapping-state` update through the normal persistence path.

Standalone output renderers hard-disable mapper calibration regardless of incoming workspace commands or stale state. Surface corner markers, frame guides, and calibration labels must only appear in the embedded Scene preview, never in an output window.

Each surface and scene-surface snapshot stores `projectionFit`. The default is `cover`; `contain` preserves the whole texture with transparent unused space, and `stretch` ignores source proportions. Fit is implemented in the existing mapper shader, so it does not add a render pass. Canvas recording-frame sampling happens before projection fit.

Each output window carries an `outputId`, subtracts that output frame's shared-world origin, and renders only that viewport. The embedded Scene preview shows every named output frame together. When a popup and its Scene frame differ, inspect `render-geometry.js`, `mappingForRenderMode()`, `buildSurfaceRenderPlan()`, and the output frame transform before changing source-fit behavior.

## Media

Supported media includes images, videos, SVG, STL, and OBJ. Camera input is supplied through the Portal camera integration.

- Images support contain/cover behavior and source transforms without losing access to pixels outside the composition frame.
- Videos support start/end trim and playback speed.
- SVG loading is asynchronous and must resolve to a drawable image before removing loading state.
- STL/OBJ parsing produces triangles and cached surface/wire/point GPU buffers.
- Model draw mode, colors, rotations, spin, scale, depth, visible-depth cutoff, wire thickness, and point budget are source parameters.
- Media renditions are PNG to avoid noise damage from lossy JPEG compression.

Composition thumbnails retain their source aspect within a maximum `768 x 432` image. Paused composition previews contain the complete thumbnail, while list cards use `object-fit: cover` so they fill without distortion. Scene surfaces route thumbnails through canvas sampling and the surface's projection-fit logic. Existing project thumbnails retain their old pixels until that composition is selected and captured again. Unselected composition and media thumbnails use a brighter, higher-contrast grayscale treatment for legibility.

When media is missing in an output client, the entire output blacks out and shows only the small loading indicator/HUD. Do not render effects over loading placeholders.

## Live Output and Synchronization

Control and output clients use `BroadcastChannel("vj1-output-bridge")`.

- Output clients announce themselves every two seconds.
- Output clients include their configured `outputId`; connection status is tracked per output.
- Control responds with render state and media files.
- Output sends FPS, frame time, render cost, pass profiles, mapping updates, and media requests.
- Slider scrubs are transmitted on the next animation frame for low-latency live performance.
- Live and non-Scene edits send immediately unless excluded as UI-only state. Scene editing does not broadcast full program state; projection changes use the mapping-only sync command so live mapping remains responsive without changing the routed program scene.

Scene editing and Live selection are deliberately separate. Live owns a captured `ui.live.sceneSnapshot`; editing or selecting scenes does not mutate that program snapshot. Selecting a scene in Live explicitly replaces it. The Live scene ID and captured snapshot persist in the project UI payload, while temporary composition overrides do not. An empty Live selector initializes from its own first-scene fallback and must never copy `ui.selectedSceneId` during a workspace change. Opening an output while in Scene adds a one-use `initialSceneId` to the popup URL: the bridge sends that Scene snapshot only to the newly announced client, acknowledges it, and sends the captured Live state for all later updates. Targeted startup state must never change already-open outputs.

When a routed Canvas appears in Live, each composition placement expands into the referenced composition's element tree and schema-generated parameters. Nested controls write to that referenced composition's entry in `ui.live.compositionOverrides`, while the placement's own opacity and blend remain overrides on the Canvas chain item. Expansion tracks composition ancestry to avoid recursive UI cycles.

The top-bar Output menu opens one named popup per configured output, or all outputs. Popup names include the output ID so repeated opens focus/reuse the same window. Browser window dimensions are only presentation hints; the output definition remains the authoritative logical resolution.

The top-bar play/pause button is always present but disabled until an output client is connected. It controls the shared visual clock, including time-based generators and video playback, without tearing down the renderer. The control UI can refresh or restore its project while an already-open output window remains connected; output clients announce themselves periodically and receive the current render state and requested media files.

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
- Treat CPU and GPU metrics as related but different signals. GPU timer data is not universally available, and GPU work can overlap CPU submission or remain queued.

Mapped rendering uses one generic demand path for ordinary compositions and Canvas recording-frame sources. `compositionSourceView()` describes logical source size and the sampled rectangle; `sourceRenderDemand()` intersects the mapped quad with the current renderer viewport and derives the physical composition raster plus final surface raster. Multiple routes sampling one composition share the largest required composition raster for that renderer/frame. Routes outside an output viewport are culled before source rendering or surface allocation. Canvas is special only when resolving its recording-frame sample rectangle; crop, demand, cache, and projection code remain shared.

Logical composition/Canvas dimensions must never be reduced to improve performance. Physical raster demand is allowed to vary by preview size, projector viewport, mapped footprint, and nested placement. Composition references inherit the pixel demand of their placement and remain capped by the referenced composition's configured maximum. Static caching follows the complete composition dependency graph, including Canvas dimensions and nested media; thumbnail data is excluded from render signatures. A static Canvas must be cacheable under the same rules as a static ordinary composition.

Composition chains use the shared placed-render-result contract from `js/graph/placed-render-result.js`. A drawable 2D media, camera, or referenced-composition source may remain a texture plus destination rectangle, fit, transform, opacity, and blend until it is drawn directly into the next accumulation target. This applies identically to ordinary and Canvas compositions. It avoids allocating, clearing, writing, and resampling a transparent parent-sized source buffer. Effects and isolated Groups are explicit materialization boundaries; shader generators, 3D/model sources, unavailable media placeholders, Canvas nesting, and overlay blend retain the conservative materialized path. Eligibility is centralized in `directPlacementKind()` rather than duplicated as Canvas/source-type branches. A placement scale increases the referenced composition's raster demand without changing its logical destination rectangle.

Runtime profiles expose `surfaceRouteCandidates`, `surfaceRoutesVisible`, `surfaceRoutesCulled`, `compositionRasterPixels`, `surfaceRasterPixels`, `directSourceComposites`, and `avoidedSourceRasterPixels`. Use these with wall-clock frame time and FPS to verify that an optimization removes planned work. The GPU readout is an averaged query signal and must not be interpreted as total frame GPU time.

The debug HUD displays FPS and active render resolution. Runtime profiles contain source, shader-pass, ping-pong, surface, and frame information where available. The top-bar CPU value is smoothed main-thread render work, not requestAnimationFrame interval. The GPU value is a rolling average of completed non-overlapping WebGL timer queries, not a wall-clock frame duration. FPS remains the definitive presentation-rate measurement. The load, CPU, GPU, and output readouts use fixed-width tabular fields to avoid top-bar layout jumps.

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

The VJ1 worktree contains uncommitted changes. The current diff primarily covers the optional composition upscale/post pipeline, projection fit, STL/OBJ transform and visible-depth behavior, project refresh/selection preservation, output metrics and controls, thumbnail generation/styling, cache-busting imports, and focused tests. Do not discard or broadly rewrite these changes. Read the diff before touching files that already changed.

The test suite currently has 187 passing Node tests. Coverage includes composition sizing, workspace-specific preview fitting, generic render demand and viewport culling, direct placed-texture compositing, bounded GPU timing instrumentation, nested/Canvas dependency caching, shared-framebuffer placement, effect fusion, projective mapping and projection fit, composition upscale/post settings, model transforms and depth cutoff, guarded thumbnail readback and cover cropping, control UI contracts, media loading, and project persistence. The shader smoke page is still required for real GLSL compilation. The representative before/after runtime comparison is stored under `metrics-results/runs/four-surface-show-gpu-architecture.*`.

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
