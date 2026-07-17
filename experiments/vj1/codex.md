# VJ1 Project Handover

Last updated: 2026-07-16

VJ1 is a build-free browser VJ, visual-component, and projection-mapping app in `experiments/vj1`. It uses p5.js and raw WebGL. A user-selected local folder is authoritative for `project.json`, media, shaders, mappings, revisions, and renditions.

Read this before changing rendering, sizing, persistence, component semantics, scenes, or Live output.

## Product Model

VJ1 has four visible workspaces:

1. **Components** builds reusable sequential image-processing chains.
2. **Canvas** places Components in a large logical frame and defines shared recording frames.
3. **Scenes** routes Components, full Canvases, or Canvas recording frames to projection surfaces.
4. **Live** selects the scene sent to every output and applies temporary performance overrides.

The implemented **Nodes** workspace is hidden. Components and Canvas keep separate remembered selections in `ui.workspaceSelectionIds`. Canvas items and derived Canvas sources never appear in the Components catalog.

“Component” is the current domain term. Old composition names exist only in migrations and legacy URL handling.

The render model is:

```text
transparent input -> sequential sources/generators/effects/groups -> component texture
```

Sources composite into the accumulated image; they do not implicitly replace it. Groups render isolated subchains into transparent intermediates before compositing into their parent. Specialized 3D sources flatten into component textures; there is no scene-wide 3D space.

## Entry Points and Key Files

`js/app.js` selects the client:

| URL | Client |
| --- | --- |
| no mode parameter | Control UI with embedded preview |
| `?output=1` | Popup projection output |
| `?preview=1` | Standalone scene preview |
| `?component=1` | Standalone component preview |
| `?fixture=tests/fixtures/FILE.json` | Deterministic fixture |

Core files:

- `js/app.js`, `js/app-state.js`, `js/domain/models.js`: startup, state, normalization, and domain models.
- `js/domain/change-event.js`, `js/domain/chain-operations.js`: structured state-change metadata and chain mutation rules.
- `js/domain/project-migrations.js`: sequential project-schema migrations; current version is **17**.
- `js/control/control-shell-controller.js`, `shell-view.js`, `settings-view.js`, `picker-view.js`, `style.css`: control behavior, shell, and focused HTML views.
- `js/graph/render-scheduler.js`, `js/graph/placed-render-result.js`: graph compilation and placed-source contract.
- `js/shaders/*`: generator/effect schemas, GLSL, fusion, and shader caching.
- `js/output/output-renderer.js`: render orchestration, caching, groups, sources, surfaces, thumbnails, and profiling.
- `js/output/component-render-layout.js`, `js/output/specialized/*`: demand/layout math and isolated anatomy, terrain, and model rendering/parsing support.
- `js/output/shared-framebuffer-target.js`: shared-context top-left framebuffer facade.
- `js/output/render-geometry.js`, `js/output/vj-mapper.js`: sizing, source views, mapping, homography, fit, and feathering.
- `js/output/embedded-preview-app.js`, `js/output/output-app.js`: preview and popup lifecycle.
- `js/services/project-folder-service.js`, `project-serializer.js`, `project-history-policy.js`, `media-library-service.js`, `output-bridge-service.js`: persistence coordination, pure serialization/history policy, files, and synchronization.
- `tests/*.test.mjs`, `tests/shader-smoke.html`, `tests/fixtures`: automated and real-WebGL tests.

## State and Persistence

Every replacement passes through `sanitizeState()`. Add persistent fields to defaults and normalization together.

`project.json` migrations are strict and adjacent. To change the format:

1. Increment `CURRENT_PROJECT_VERSION`.
2. Add exactly one registered `N→N+1` migration.
3. Update fixtures and add focused migration tests.

Migrations run before sanitization. Unversioned projects enter at version 1. Invalid or future-version files must not load or autosave.

Important recent migrations:

- v7: activity metadata and stable catalog sorting behavior.
- v8–10: workspace and full Composition→Component rename.
- v11: removes persisted `sourceRect` and derived render geometry; `render.outputs` is authoritative.
- v12: captures Canvas placement independently from Component initial dimensions.
- v13: stores one normalized Canvas placement scale while the referenced Component remains authoritative for aspect.
- v14: persists independent mapped-surface overscan and recording-frame sampling multipliers.
- v15: enables a persisted default limit preventing Canvas rasters from exceeding logical Canvas dimensions.
- v16: removes the obsolete global projection-edge softness setting and mapper shader path.
- v17: persists independent Auto, Low, or Full embedded-preview resolution choices for Scene and Live.

The local project folder owns project state. `localStorage` is never authoritative. Autosave is debounced by 700 ms; revision files implement undo/redo, with repeated control edits coalesced for six seconds. UI-only state and metrics are excluded from history signatures. Folder refresh must update assets without replacing state or losing valid selections.

An empty project creates `media/`, `shaders/`, `scenes/`, `mappings/`, and `vj1-cache/renditions/`.

## Components, Canvas, and Scenes

A chain Component uses `component.chain` containing sources, effects, and Groups. Disabled items are skipped. Legacy `component.source` and `component.shaderChain` remain compatibility inputs only.

A Canvas uses the same chain abstraction. It may reference ordinary Components; ordinary Components cannot nest Components, and Canvas-in-Canvas and self-reference are rejected. A placement stores one normalized base scale plus the standard `x`, `y`, uniform `scale`, and `rotation`. Proportional Component initial-size changes preserve placement size; aspect changes reshape it without stretching.

`recordingFrames` is one project-level registry shared by every Canvas. Frames use Canvas-logical coordinates. Their outlines and corners are directly editable; interiors remain pointer-transparent so underlying placements stay draggable.

Scenes route generic `sceneSourceNodes()` through `surface.sourceNodeId`:

- Ordinary Component → one Component node.
- Canvas → one full-Canvas node plus one node per recording frame.

`sourceNodeId` is authoritative. Compatibility `componentId` and `outputFrameId` may recover only an absent or invalid source-node ID. Recording frames are the only Canvas crop authority.

Surfaces are shared destinations. User surfaces are mapped quadrilaterals. Output-derived direct surfaces are rectangular, non-deletable, and not corner-mapped. All routes share assignment, fit, opacity, blend, ordering, scene presence, Live behavior, and physical feather. `projectionFit` is `cover`, `contain`, or `stretch`. Surface `feather` is a persistent physical property outside scene snapshots and is clamped to `0–0.5`.

## Sizing Contract

Do not conflate logical geometry, physical render demand, sampling, and UI display.

| Concern | Authority / rule |
| --- | --- |
| Output size/order | Persisted `render.outputs[]`; outputs form one horizontal world with calibration margins. |
| Mapping world | Derived at runtime from outputs; never independently persisted. |
| Component logical frame | `render.componentTexture` plus `component.frameShape`; an initial size/aspect, not a raster ceiling. |
| Component raster | Visible consumer demand × pixel density × resolution scale, aspect-preserving and bounded to 8192 per axis. |
| Canvas logical frame | `component.canvas.width/height`; placement and recording-frame coordinate system. |
| Canvas raster | Route demand may downscale freely; `render.sampling.limitCanvasToLogicalSize` prevents supersampling beyond logical dimensions by default. Editor `previewQuality` remains Auto, Low, or Full. |
| Surface/recording-frame sampling | `render.sampling.surfaceOverscan` and `recordingFrameScale`; independent `0.5–2×` demand multipliers defaulting to `1×`. |
| Surface texture | Materialized only for final surface effects, transitions, thumbnail fallback, or blackout. Auto follows demand; Manual only caps this intermediate. |
| Projection | Fit and mapping sample the source; they never change source geometry. |
| Preview zoom/pan | Display-only and must not affect logical or physical render requests. |

Output p5 canvases use backing density 1. Compatibility aliases such as `render.frameWidth`, `worldWidth`, and related fields are derived and excluded from saved projects.

Mappings use shared-world coordinates and cached homographies. Output windows subtract their output frame origin and clip to their viewport. Direct multi-output routes retain the full continuous source span so each window samples the correct slice.

Preview fit is workspace-semantic: Scene/Live fit the output world; Component/Canvas fit their own frame. Only manual fit deliberately carries exact zoom and pan between workspaces. Preview-stage replacement must retarget observers and complete the settle-and-reveal transaction before showing the canvas.

## Render and Performance Contracts

Each frame is broadly:

```text
state -> visible route demand -> needed Component/Canvas textures
      -> direct source-rectangle projection -> output -> HUD
      -> optional surface materialization for exception paths
```

Only required components render. Static results are signature-cached; dynamic inputs invalidate per frame. Compatible intermediates remain in pooled framebuffers in one WebGL context. Safe pixel-local effects may fuse; neighborhood/stateful effects remain separate. Alpha is premultiplied throughout, normally ending shaders with `vec4(rgb * alpha, alpha)`.

Use the generic source-view and demand path for Components, full Canvases, and recording frames. Cull routes outside the output viewport before rendering or allocation. Multiple routes share the largest required component raster for that renderer/frame. Recording frames are source-rectangle/UV views into that one parent Canvas texture; multiple frames must never allocate or render independent Canvas textures. Never shrink logical geometry as a performance shortcut.

Surface route source, Component, and recording-frame lookups are indexed when renderer state changes. Compatible contiguous mapped routes preserve compositing order while sharing mapper shader/state setup and cached quad geometry. The top-bar render-cost percentage is a button that captures a 10-second Preview/Output profile, downloads an analyzer-ready JSON report, and exposes it as `window.__vj1LastProfileReport`.

Drawable 2D media, cameras, and referenced Components may remain placed textures until composited. Effects and isolated Groups are materialization boundaries. Eligibility belongs in `directPlacementKind()`, not duplicated type-specific branches.

Specialized anatomy, STL/OBJ, and Terrain paths render real 3D internally. They must use one stable resizable scratch target per renderer, not size-keyed context maps. Cache static model buffers per context, dispose them explicitly, and keep logical wire widths resolution-independent. Terrain remains a specialized polygon-grid renderer, not a full-frame shader-registry generator.

Do not add WebGL contexts casually, upload resizable WebGL canvases across contexts, allocate buffers every frame, perform unnecessary framebuffer `get()` readbacks, or assume JavaScript `async` moves rendering off-thread. GPU timer queries are bounded diagnostic samples, not total frame time.

Thumbnail staleness must be checked before GPU readback. Thumbnail capture is live-preview-only and must be rejected while `ui.debugPreview` is false. Paused Canvas previews reconstruct lightweight thumbnail proxies without running child generators/effects.

## Live Output

Control and outputs communicate over `BroadcastChannel("vj1-output-bridge")`; files are requested separately because `File` objects are not persisted.

`ui.live.selectedSceneId` alone determines every output's program scene. Selecting a Scene for editing must not change Live. The selected Live snapshot refreshes after state changes so persistent edits propagate immediately. Temporary overrides are runtime-only, stored per scene, and pruned only when a persistent edit conflicts with the same field.

Opening an output from Scene is the explicit exception: first select that Scene in Live, then open the popup. Existing and new outputs still receive the same Live-derived state.

Scene transitions default to zero cost at duration `0`. Nonzero dissolves use one shared wall-clock start time; each output derives progress locally. Source and target routes resolve independently, preserve their own projection fit, and apply physical surface feather once. Transition textures and descriptors are runtime-only and disposed promptly.

With one configured output, the Output action opens it directly. With several, the menu lists individual outputs only. Never rebuild menu buttons during metric patches, because replacing DOM between `pointerdown` and `click` drops clicks. Avoid rebuilding active sliders, selects, trim ranges, color pickers, and the mount-once settings modal.

## Media and Missing Assets

Supported media: images, videos, SVG, STL, OBJ, and Portal camera input. Camera capture restarts only when its stable settings signature changes; stale asynchronous requests must dispose their stream. Media renditions are PNG.

If an output lacks required media, black out the entire output and show only the loading indicator/HUD. Do not render effects over placeholders.

## Verification

From `experiments/vj1`:

```sh
npm test
npm run test:metrics
npm run test:render
npm run metrics -- /path/to/project.json --save
```

Before finishing renderer work:

1. Run `npm test` and `git diff --check`.
2. Open the relevant fixture in Chrome; use `tests/shader-smoke.html` for GLSL.
3. Check desktop and narrow UI layouts when UI changes.
4. Compare embedded Component, Scene, and popup output for sizing/mapping changes.
5. Inspect `#vj1-runtime-metrics` or `window.__vj1RuntimeMetrics` and save meaningful comparisons under `metrics-results/runs`.

## Current Baseline

The implementation baseline is committed. Recent work centers on generic direct projection for Components, full Canvases, and recording-frame source rectangles; adaptive Component raster demand; demand-sized previews; shared 8192 bounds; static performance estimates; cache-busting imports; a local SuperPoint-powered two-image Feature Morph generator; and focused render-geometry/output tests. Surface textures remain only on explicit materialization paths.

The handover reports **324 passing Node tests**. Real GLSL still requires a browser smoke page; Feature Morph has its own inference-and-shader smoke fixture at `tests/browser/feature-morph-smoke.html`. The representative performance comparison is `metrics-results/runs/four-surface-show-gpu-architecture.*`.

## Change Discipline

- Preserve project compatibility through migrations and normalization.
- Preserve premultiplied alpha, Group isolation, and transform ownership.
- Keep preview and popup output equivalent.
- Keep Scene editing separate from Live selection.
- Keep logical geometry independent from raster demand and UI display.
- Avoid extra WebGL contexts and unbounded caches/readbacks.
- Add focused tests for bugs, especially sizing, scene snapshots, groups, alpha, caching, and specialized render paths.
- Update cache-busting query strings when browser modules change.
