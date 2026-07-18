# VJ1 Project Handover

Last updated: 2026-07-18

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

- `js/app.js`, `js/app-state.js`, `js/domain/models.js`, `js/domain/render-settings.js`, `js/domain/scene-routing.js`: startup, state, aggregate model compatibility, focused render/output normalization, and Scene source-node routing.
- `js/domain/change-event.js`, `js/domain/chain-operations.js`: structured state-change metadata and chain mutation rules.
- `js/domain/project-migrations.js`: sequential project-schema migrations; current version is **18**.
- `js/control/control-shell-controller.js`, `clipboard-controller.js`, `modal-controller.js`, `input-controller.js`, `path-input-utils.js`, `shell-view.js`, `settings-view.js`, `picker-view.js`, `component-view.js`, `scene-live-view.js`, `mapping-view.js`, `catalog-view.js`, `control-selectors.js`, `parameter-view.js`, `source-control-schema.js`, `view-primitives.js`, `style.css`: control orchestration, global clipboard/drop routing, modal/settings/picker lifecycle, inspector/rail mutation binding, shared path/input conversion, focused workspace views, reusable selectors and parameter/source controls, and shared catalog/section/list primitives.
- `js/graph/render-scheduler.js`, `js/graph/placed-render-result.js`: graph compilation and placed-source contract.
- `js/shaders/*`: generator/effect schemas, GLSL, fusion, and shader caching. `generator-shaders.js` is the stable generator facade over core 2D, spatial/sea, and atmospheric/organic catalogs. `shader-registry.js` is the stable effect facade over stylize, image/key, and motion/alpha catalogs; shared seed/time policy lives in `shader-component-common.js`.
- `js/output/output-renderer.js`: render orchestration, caching, groups, sources, surfaces, thumbnails, and profiling.
- `js/output/component-render-layout.js`, `js/output/component-render-state.js`, `js/output/component-patch-adapter.js`, `js/output/component-preview-interaction.js`, `js/output/output-media-readiness.js`, `js/output/output-media-runtime.js`, `js/output/output-thumbnail-runtime.js`, `js/output/output-surface-runtime.js`, `js/output/render-draw-utils.js`, `js/output/render-runtime-math.js`, `js/output/render-pass-shaders.js`, `js/output/surface-render-planner.js`, `js/output/thumbnail-utils.js`, `js/output/preview-interaction-geometry.js`, `js/output/specialized/*`: demand/layout math, graph-to-source adaptation, component graph/media cache signatures, component/Canvas editor gestures and handles, output loading/blackout traversal, imported-media/camera/rendition lifecycle, thumbnail loading/capture state, surface/transition texture ownership and projection, shared drawing adapters, runtime quality/time/transform policy, render-pass GLSL, pure surface route planning, thumbnail conversion/signatures, pure preview hit/drag geometry, and isolated specialized-source rendering. `specialized-source-runtime.js` owns morph/tile shaders, inference services, terrain/model scratch targets, clocks, GPU resources, and disposal; its sibling modules own anatomy, terrain, model parsing/math/mesh caches, and raw model WebGL details.
- `js/output/render-target-contract.js`, `js/output/content-coordinate-space.js`, `js/output/shared-framebuffer-target.js`: typed logical/physical render-target metadata, the single screen-to-raw-WebGL coordinate boundary, and the shared-context top-left framebuffer compatibility facade.
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
- v18: canonicalizes legacy source/shader chains, Canvas layers/frames, route aliases, time scale, and preview viewports so runtime code consumes one schema.

The local project folder owns project state. `localStorage` is never authoritative. Autosave is debounced by 700 ms; revision files implement undo/redo, with repeated control edits coalesced for six seconds. UI-only state and metrics are excluded from history signatures. Folder refresh and media import update the authoritative asset snapshot without reloading `project.json`; otherwise a debounced, older disk snapshot can replace newer edits or valid selections.

An empty project creates `media/`, `shaders/`, `scenes/`, `mappings/`, and `vj1-cache/renditions/`.

## Components, Canvas, and Scenes

A chain Component uses `component.chain` containing sources, effects, and Groups. Disabled items are skipped. Legacy `component.source` and `component.shaderChain` remain compatibility inputs only.

A Canvas uses the same chain abstraction. It may reference ordinary Components; ordinary Components cannot nest Components, and Canvas-in-Canvas and self-reference are rejected. A placement stores one normalized base scale plus the standard `x`, `y`, uniform `scale`, and `rotation`. Proportional Component initial-size changes preserve placement size; aspect changes reshape it without stretching.

`recordingFrames` is one project-level registry shared by every Canvas. Frames use Canvas-logical coordinates. Their outlines and corners are directly editable; interiors remain pointer-transparent so underlying placements stay draggable.

Embedded-preview pointer presses participate in the control shell's interaction deferral. Do not rebuild the inspector or resize the p5 canvas between pointer-down and pointer-up: selecting a preview element and dragging it is one uninterrupted gesture. Draggable chain rows select on pointer-down, with click retained for keyboard activation, because native HTML drag can suppress a later click.

Scenes route generic `sceneSourceNodes()` through `surface.sourceNodeId`:

- Ordinary Component → one Component node.
- Canvas → one full-Canvas node plus one node per recording frame.

`sourceNodeId` is authoritative. Compatibility `componentId` and `outputFrameId` may recover only an absent or invalid source-node ID. Recording frames are the only Canvas crop authority.

An empty `sourceNodeId` and `componentId` is an intentional unassigned Surface route, not a request for the first catalog Component. A newly added Surface is enabled only in the currently selected Scene; every other Scene receives the same empty Surface disabled.

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
| Canvas raster | Route demand may downscale freely; Canvas `resolutionScale` is the explicit 0.5×/1×/2× demand and raster-cap multiplier. `render.sampling.limitCanvasToLogicalSize` prevents other implicit supersampling beyond that chosen scale by default. Editor `previewQuality` remains Auto, Low, or Full. |
| Surface/recording-frame sampling | `render.sampling.surfaceOverscan` and `recordingFrameScale`; independent `0.5–2×` demand multipliers defaulting to `1×`. |
| Surface texture | Materialized only for final surface effects, transitions, thumbnail fallback, or blackout. Auto follows demand; Manual only caps this intermediate. |
| Projection | Fit and mapping sample the source; they never change source geometry. |
| Preview zoom/pan | Display-only and must not affect logical or physical render requests. |

Output p5 canvases use backing density 1. Compatibility aliases such as `render.frameWidth`, `worldWidth`, and related fields are derived and excluded from saved projects.

Mappings use shared-world coordinates and cached homographies. `defaultProjectSurfaceMapping()` is the single fallback/reset layout for the control UI, Preview, and every Output window; renderers must not recreate a view-local default layout. `worldPointToDisplay()` and its inverse are the only output-window cover transform: mapped and direct surfaces both pass through it, then the window clips to its viewport. Direct multi-output routes retain the full continuous source span so each window samples the correct slice.

Surface calibration is an acknowledged transaction, not a time-based race guard. While the mapper owns a drag, resize or state changes may update render state but must defer structural surface rebuilding. The final local mapping signature remains authoritative until the store echoes that exact signature. A deferred rebuild preserves the mapper's live corners before consulting persisted corners; only an explicit acknowledgement or a diagnosed acknowledgement timeout may release local ownership.

Preview fit and manual navigation are workspace-semantic and stored independently in `ui.previewViewports`: Scene/Live fit the output world, while Component/Canvas fit their own frame. Switching workspaces must restore that workspace's zoom and pan without modifying the others. DOM canvas fitting is invalidated only by stage geometry, logical canvas size, mode, viewport, or output-frame geometry; ordinary render-state and resolution-demand changes must not refit the canvas or flash a temporary full-frame view. Preview-stage replacement must retarget observers and complete the settle-and-reveal transaction before showing the canvas. At narrow desktop widths the Preview column is hidden and its render loop paused before either control column is removed; this keeps Scene/Live controls usable beside a separate output window.

Preview transforms use direct Pointer Events on the p5 canvas with pointer capture; do not route drag continuity through p5's replaceable global mouse callbacks. The control shell holds DOM rebuilding for the full pointer sequence, and draggable chain rows select on `pointerdown` so a native drag cannot cancel selection before `click`.

Deferred control renders are requests, not state authorities: when their animation frame runs they consume the newest store snapshot. Persistent slider and transform scrubs are one transaction with a single pre-gesture baseline, lightweight intermediate updates, and one normalized/history-aware release commit. This is the UI form of user truth; an older captured render snapshot must never reverse the latest command.

The project store and the renderer never share mutable transform objects. A preview gesture path-copies only its targeted Component chain or recording frame into renderer-local state. The local value remains authoritative through pointer release and any stale incoming snapshots until the store echoes the exact committed transform/rectangle; acknowledgement then releases ownership without a timer. Selection overlays follow the same immutable state boundary. This transaction applies equally to nested Group children and Canvas recording frames.

Selected-object transform controls have priority over overlapping Canvas recording-frame controls. Their compact cluster follows the established layout: move at the object pivot, scale a fixed distance to its right, and rotate the same distance above. Visual size, offset, stroke, and hit radius are defined in CSS pixels and converted into project pixels for the current fitted preview. High-resolution Components therefore have the same reachable controls as low-resolution Components. Body dragging owns only the transformed object interior. A Group boundary is the union of its enabled physical descendants in Group-local coordinates, never the entire Composition merely because the selected item is a Group. If neither selected handle is hit, Canvas recording-frame borders and corners receive the pointer normally.

Chain content transforms have one screen-space convention: positive X moves right, positive Y moves down, and positive rotation is clockwise. A source always owns the complete Component render frame; its transform changes the coordinates used while that source renders and the result is then composited with a neutral layer rectangle. Shader generators derive their coordinate field from stable top-left vertex UVs; they must not reconstruct composition coordinates from framebuffer-dependent `gl_FragCoord`. Specialized generators receive the same transform in their own shader or world/projection render path. Never transform or clamp-resample an already-rendered generator texture. A Group is a transform scope: its transform is precomposed into every descendant before rendering, while the Group boundary applies only isolation, blend, and opacity. `content-coordinate-space.js` owns normalization, nesting, pointer-delta conversion, Canvas placement, inverse UV sampling matrices, and the one conversion into raw WebGL axes. `render-target-contract.js` owns target kind, logical and physical size, texture orientation, and p5-image safety. Generated-target presentation normalizes only texture storage orientation.

## Render and Performance Contracts

Each frame is broadly:

```text
state -> visible route demand -> needed Component/Canvas textures
      -> direct source-rectangle projection -> output -> HUD
      -> optional surface materialization for exception paths
```

Only required components render. Static results are signature-cached; dynamic inputs invalidate per frame. Compatible intermediates remain in pooled framebuffers in one WebGL context. Safe pixel-local effects may fuse; neighborhood/stateful effects remain separate. Alpha is premultiplied throughout, normally ending shaders with `vec4(rgb * alpha, alpha)`.

The lean render core is WebGL-first. p5 remains the application host and a compatibility/import layer for browser media, fonts, legacy drawing helpers, and fallback model geometry; it is not an authority for coordinates, target orientation, sizing, or surface placement. New GPU stages should consume the explicit render-target contract and raw textures/framebuffers. Do not pass a resized p5 pixel array between targets when its browser canvas/video element or underlying framebuffer is available.

Use the generic source-view and demand path for Components, full Canvases, and recording frames. Cull routes outside the output viewport before rendering or allocation. Multiple routes share the largest required component raster for that renderer/frame. Recording frames are source-rectangle/UV views into that one parent Canvas texture; multiple frames must never allocate or render independent Canvas textures. Never shrink logical geometry as a performance shortcut.

Surface route source, Component, and recording-frame lookups are indexed when renderer state changes. Compatible contiguous mapped routes preserve compositing order while sharing mapper shader/state setup and cached quad geometry. The top-bar render-cost percentage is a button that captures a 10-second Preview/Output profile, downloads an analyzer-ready JSON report, and exposes it as `window.__vj1LastProfileReport`.

Mapper batching must stop when either the shader variant or sampled texture identity changes. p5 owns sampler allocation for p5.Framebuffer objects; changing sampler objects while retaining its active shader can associate queued surface geometry with the following texture. Surfaces sharing the same texture may remain batched.

Drawable 2D media, cameras, and referenced Components may remain placed textures until composited. Effects and isolated Groups are materialization boundaries. Eligibility belongs in `directPlacementKind()`, not duplicated type-specific branches.

Specialized anatomy, STL/OBJ, and Terrain paths render real 3D internally. They must use one stable resizable scratch target per renderer, not size-keyed context maps. Cache static model buffers per context, dispose them explicitly, and keep logical wire widths resolution-independent. Terrain remains a specialized polygon-grid renderer, not a full-frame shader-registry generator.

Terrain solid and wire passes share p5's main WebGL context and therefore must run inside the common raw-WebGL state boundary. Each pass uses a private VAO when available and restores only the state raw passes own or mutate: VAO, program, array/index buffers, viewport, line width, depth, blend, cull, and polygon offset. Keep this boundary explicit and small rather than querying unrelated GL state every frame. Raw shader compilation, linking, or restoration failures must emit structured `VJ1` console errors; never fail over silently.

Do not add WebGL contexts casually, upload resizable WebGL canvases across contexts, allocate buffers every frame, perform unnecessary framebuffer `get()` readbacks, or assume JavaScript `async` moves rendering off-thread. GPU timer queries are bounded diagnostic samples, not total frame time.

Detailed CPU pass attribution is sampled every six frames rather than wrapping every pass every frame. Full-frame CPU timing remains continuous, and GPU query cadence remains independently bounded. Profiling must measure the renderer without becoming a material part of its steady-state load.

Render-path recovery must be observable. Shared-framebuffer unavailability, sampled-buffer draw fallback/failure, specialized presentation-shader failure, specialized-target recreation, media decoding/playback failure, and camera setup failure emit structured `VJ1` diagnostics. Repeating frame loops deduplicate identical diagnostics. A failed camera configuration retries on a bounded clock instead of restarting capture every frame or remaining permanently stuck.

Thumbnail staleness must be checked before GPU readback. Thumbnail capture is live-preview-only and must be rejected while `ui.debugPreview` is false. Paused Canvas previews reconstruct lightweight thumbnail proxies without running child generators/effects.

## Live Output

Control and outputs communicate over `BroadcastChannel("vj1-output-bridge")`; files are requested separately because `File` objects are not persisted.

Performance profiles include control-to-Output transport telemetry. Full snapshots and Live patches carry an epoch-based high-resolution send timestamp; Output measures delivery/structured-clone delay, receive-to-apply latency, apply-to-first-render latency, total visible latency, revisions, patch counts, and revision/path resyncs. Measurements are reported in the existing half-second metric message as interval values plus cumulative counters. Do not stringify full render states merely to estimate transport bytes—the allocation and traversal would perturb the stream being measured.

`ui.live.selectedSceneId` alone determines every output's program scene. Selecting a Scene for editing must not change Live. The selected Live snapshot refreshes after state changes so persistent edits propagate immediately. Temporary overrides are runtime-only, stored per scene, and pruned only when a persistent edit conflicts with the same field.

Opening an output from Scene is the explicit exception: first select that Scene in Live, then open the popup. Existing and new outputs still receive the same Live-derived state.

Live slider scrubs use the lightweight `updateLive` state path and are coalesced into revisioned parameter patches independently of preview frames. When a standalone output is connected, the duplicate embedded preview is capped at 30 fps and resumes once at the opposite half-frame phase; Output remains presentation truth and ordinary state updates never reset that phase. Trusted in-app render snapshots bypass redundant full-project normalization, while fixtures and other external state still normalize at the renderer boundary.

Live parameter fade is independent from Scene transition duration. A numeric Live patch updates canonical user truth immediately, while each renderer temporarily interpolates that one addressed value from its currently displayed value during a frame and restores the canonical target afterward. Retargeting an active fade begins from the displayed value; toggles, enums, colors, and other nonnumeric values remain immediate. Full state replacement cancels render-only fades.

Live parameter editing mirrors Component editing: the selected scene exposes a thumbnail catalog of all directly and recursively referenced Components; the selected Component exposes one nested element outline; and only the selected element owns the separate Content/Transform settings section. Group indentation is structural rather than an attempt to indent an all-at-once parameter dump.

The selected Live Component separates its public performance surface from its implementation. Controls contains Component opacity, speed, and blend plus parameters and transforms explicitly published through `significantParams`; Elements contains the nested chain outline and the selected element's Primary, Details, and Transform editor. Do not flatten every internal element parameter into the Component Controls view.

The transport play/pause command applies only to renderers in `output` mode, including their video clocks. Embedded Component, Canvas, Scene, and Live previews remain active monitors while a connected output is held. The top-bar transport remains disabled when no output client is connected because there is then no transport target.

Terrain camera parameters remain internal to the Terrain renderer. Camera-space Y is world-up and passes unchanged into WebGL clip Y; `placeTerrainInComposition()` is the one boundary that converts clip coordinates to the Composition's screen-down UV convention. Never negate camera Y before that boundary. The chain transform places projected surface and wire geometry inside the immutable Composition frame before rasterization; it never resamples the finished Terrain image or changes the frame allocation. Projected placement is a homogeneous affine transform: do not divide by `abs(w)` or otherwise normalize vertices before the GPU clips the camera and near planes, because behind-camera vertices would be mirrored into screen-spanning triangles. `terrainSafeNearDistance()` computes the configured-minimum versus tessellated-cell footprint once in testable CPU math; surface depth projection and explicit wire clipping consume that exact value through their shared near-plane uniform. This prevents a triangle closer than its own representable footprint from crossing the camera as a screen-spanning wedge. Terrain's coordinates are already screen-down after placement, but its raw framebuffer texture storage remains bottom-left; the target descriptor records that storage orientation and generated-target presentation owns the single normalization into the top-left compositor.

Scene transitions default to zero cost at duration `0`. Nonzero dissolves use one shared wall-clock start time; each output derives progress locally. Source and target routes resolve independently, preserve their own projection fit, and apply physical surface feather once. A temporary transition render state and all of its derived component, recording-frame, and source-node route indexes are one atomic render context; never swap the state without switching those indexes, and restore their exact prior objects after the scope. Transition textures and descriptors are runtime-only and disposed promptly.

With one configured output, the Output action opens it directly. With several, the menu lists individual outputs only. Never rebuild menu buttons during metric patches, because replacing DOM between `pointerdown` and `click` drops clicks. Avoid rebuilding active sliders, selects, trim ranges, color pickers, and the mount-once settings modal.

## Media and Missing Assets

Supported media: images, videos, SVG, STL, OBJ, and Portal camera input. Camera capture restarts only when its stable settings signature changes; stale asynchronous requests must dispose their stream. Media renditions are PNG.

The media library owns only metadata and `File` handles at rest. Importing or broadcasting a complete project snapshot must not decode an image or video, create a video element, parse STL/OBJ, create an object URL, or allocate a GPU resource. An active render path acquires a typed runtime lease; images, videos, parsed models, object URLs, derived renditions, and model GPU resources share one LRU owner bounded by both resource count and estimated decoded bytes. Derived rendition pixels are included in that estimate. Active leases are never evicted. Inactive leases are disposed least-recently-used, including context-local model buffers and programs. A renderer may retain a small bounded warm set, but library size must not determine runtime memory use.

Large raster images are decoded toward the physical render demand rather than their original dimensions. A bounded header probe reads dimensions without decoding pixels; sources already smaller than the requested render bucket retain their native size and are never upscaled. On browsers with resize-at-decode support, larger common static raster formats become a bounded p5-compatible render variant without first creating an object URL for the full-resolution file. If later render demand grows, the current drawable remains valid while a larger bounded variant decodes, then is atomically replaced; its media revision invalidates stable render nodes. Persisted renditions likewise increment the revision when their asynchronous decode completes. Structured `[VJ1_MEDIA_DIMENSION_PROBE_FAILED]` and `[VJ1_MEDIA_RESIZE_DECODE_FALLBACK]` warnings report failed optimized paths before the ordinary loader is used. This is essential because a compressed 42-megapixel file can transiently occupy roughly 168 MB as RGBA. GIF and unsupported decode paths retain their native behavior. Picker templates remain metadata-only: an intersection observer leases image/video preview URLs only for cards near the viewport, unloads off-screen decoders after a short grace period, and revokes all remaining leases when the picker closes. If viewport observation is unavailable, a structured warning reports the bounded first-batch fallback.

Imported-video decode and playback have separate owners. Only acquiring an active video source creates its muted, default-muted, inline browser element; importing the library does not. The current rendered frame alone owns loop/segment state, rate, pause, and play. Unrouted videos pause immediately, and inactive decoders participate in the generic media LRU. Promise and synchronous playback rejection emit one `[VJ1_VIDEO_PLAYBACK_FAILED]` diagnostic per element; they are never silently swallowed.

If an output lacks required media, black out the entire output and show only the loading indicator/HUD. Do not render effects over placeholders.

Runtime media identity includes the File fingerprint, load generation, readiness revision, and load error. Replacing a File under the same media ID must dispose and reload the old runtime item. Async callbacks from a disposed generation must never make the replacement ready, and stable Component signatures must include runtime media revisions. Feature Morph analysis status is valid only for the exact two File fingerprints used to create it.

Media-file messages are authoritative snapshots, not additive notifications. Before importing a new snapshot, every runtime image, video, model, rendition, object URL, and cached GPU resource absent from it must be disposed. Raw STL/OBJ resources attached to a media item include every context-local VAO, buffer, and shader program; deleting or replacing the item disposes those resources before removing it from the media map. An empty snapshot is meaningful and must propagate through the control/output bridge so closing or changing a project cannot leave old media addressable in Preview or Output.

Persisted image renditions are keyed by media ID, dimensions, and a deterministic source-file revision. A rendition without the exact current source revision is ignored, including legacy unversioned renditions. Async rendition decodes and saves re-check item generation/revision before publishing, and removed rendition snapshots dispose their decoded image and object URL. Replacing a file at the same path must therefore regenerate pixels rather than sampling the prior file's cache.

p5 WebGL texture upload accepts p5 media wrappers, not raw browser image/video/canvas elements. Canvas2D targets may draw the browser element directly; shared WebGL targets bridge raw browser media through a cached p5.Image and mark dynamic bridges modified on every draw. A media bridge or draw failure must emit a structured `VJ1` console error and block the source rather than silently substituting content.

Video playback rate is a render-time property in both direct-placement and rasterized paths. Apply output play/pause, global visual time stretch, source speed, and owning Component speed exactly once regardless of whether later effects force materialization.

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

The handover reports **445 passing Node tests**. Imported images, live camera capture, Scene projection mapping, Feature Morph, and Component/Canvas selection, move, scale, and rotation controls have been confirmed in the running app. The transform-editor fix makes p5 logical canvas dimensions authoritative for pointer conversion instead of DOM backing-store dimensions. Real GLSL, imported-video playback, Terrain orientation after the latest raw-storage correction, cross-window projection parity, and the latest responsive/Live inspector presentation still require live smoke evidence; Feature Morph has its own inference-and-shader smoke fixture at `tests/browser/feature-morph-smoke.html`. The representative performance comparison is `metrics-results/runs/four-surface-show-gpu-architecture.*`.

## Change Discipline

- Preserve project compatibility through migrations and normalization.
- Preserve premultiplied alpha, Group isolation, and transform ownership.
- Keep preview and popup output equivalent.
- Keep Scene editing separate from Live selection.
- Keep logical geometry independent from raster demand and UI display.
- Avoid extra WebGL contexts and unbounded caches/readbacks.
- Add focused tests for bugs, especially sizing, scene snapshots, groups, alpha, caching, and specialized render paths.
- Update cache-busting query strings when browser modules change.
