# VJ1 Project Handover

Last updated: 2026-07-16

VJ1 is an experimental browser-based VJ, visual-component, and projection-mapping application. It runs directly from `experiments/vj1` without a build step and uses p5.js plus raw WebGL where tighter control is required. A selected local folder is the project and is the authoritative home for project JSON, media, shaders, mappings, revisions, and generated renditions.

This document describes the whole VJ1 application as it currently exists. Read it before changing rendering, sizing, component semantics, live output, persistence, or project history.

## Product Model

The application has five workspaces:

1. **Components** (`component`) builds reusable image-processing chains.
2. **Canvas** (`canvas`) places reusable components on a larger component and defines named recording frames.
3. **Scenes** (`scene`) routes components or Canvas recording frames to projection surfaces and edits their quadrilateral mappings.
4. **Nodes** (`mapping`) exposes the compiled component graph and scheduler state for inspection. The workspace remains implemented but its top-bar button is currently hidden pending a later product decision.
5. **Live** (`live`) selects the scene sent to the output window and provides temporary performance controls and parameter overrides.

The Components workspace catalog contains only ordinary components. Canvas containers and their derived full-Canvas and recording-frame source nodes belong to the Canvas and Scenes workspaces and must not appear in the Components rail. Components and Canvas each persist their own last selected component in `ui.workspaceSelectionIds`; switching through either workspace, Scene, or Live restores that workspace-specific selection rather than reusing the other workspace's current item. Invalid or deleted remembered IDs fall back to the first component of the matching type.

The top bar groups all four views—Components, Canvas, Scenes, and Live—after the project controls on the left, with Live last. The project title and its small close control are adjacent but separate sections, so the close button never overlays a long project name. All four view buttons use the same workspace state and active/disabled behavior.

Component is the single current term in both the product and render domain. The workspace identifier is `component`; reusable visuals live in `components`, relationships use `componentId`, selection uses `selectedComponentId`, and nested Canvas sources use `type: "component"`. Composition terminology exists only inside compatibility migrations and legacy URL handling.

The output action opens its sole configured output directly. With multiple outputs it opens a menu containing only the individual output windows; there is no bulk “open all” action. Continuous metric updates patch connection indicators in the existing menu buttons and must not replace their DOM, because replacing a button between `pointerdown` and `click` loses the user's click.

The core mental model is one component type:

```text
input image -> component -> output image
```

Media and generators add pixels to the accumulated input. Effects process the accumulated image. A component starts with a transparent image, so a generator does not implicitly replace earlier content. The UI still labels items as `media`, `generator`, or `effect` for clarity, but the chain is sequential.

Groups are isolated subchains. Their children render into a transparent intermediate buffer, effects inside the group apply only to that buffer, and the group result is then composited into the parent chain. Moving an item into or out of a group must preserve this isolation.

The scene compositor is texture-based and two-dimensional. Specialized generators and STL/OBJ sources may render real 3D geometry internally, but each is flattened into its component texture before surface routing and projection mapping. There is no shared scene-wide 3D space, depth buffer, camera, or lighting model between component elements.

## Runtime Entry Points

`js/app.js` selects a client from URL parameters:

| URL mode | Purpose |
| --- | --- |
| no output parameter | Full control UI with embedded preview |
| `?output=1` | Popup/live projection output |
| `?preview=1` | Standalone scene preview |
| `?component=1` | Standalone component preview |
| `?fixture=tests/fixtures/FILE.json` | Load a deterministic fixture in control, output, or preview mode |

The control app creates the state store, media library, project-folder service, BroadcastChannel bridge, control shell, and one embedded p5/WebGL preview. The preview toggle pauses live component rendering and uses stored thumbnails instead; it does not change popup output rendering. Thumbnail mode remains an active editor: selection handles and pointer transforms stay enabled. Canvas reconstructs a lightweight placement proxy from each referenced component's stored thumbnail, including nested Group transforms and opacity, so placements move and scale immediately without executing their generators or effects. Ordinary components apply the selected element's transform delta to the flattened stored thumbnail as a low-cost approximation because a flattened thumbnail cannot recover isolated source pixels. The current component frame is always authoritative: stale thumbnails captured with another aspect are center-cropped with cover and every thumbnail proxy is GPU-scissored to the frame, including while it is moved, rotated, or scaled.

The output clients create their own p5/WebGL canvas and `OutputRenderer`. They receive serializable state over BroadcastChannel and request `File` objects separately because files are not persisted in project JSON.

## Important Files

### Application and state

- `js/app.js`: bootstraps control or output mode and routes state changes to autosave and output synchronization.
- `js/app-state.js`: action-oriented mutable store built on cloned, sanitized state.
- `js/domain/models.js`: defaults, normalization, migration compatibility, scene snapshots, canvas components, chain items, groups, transforms, and live render-state derivation.
- `js/domain/component-frame.js`: component aspect presets, resolution scales, and logical/physical frame metrics.
- `js/constants.js`: workspace names, default resolutions, blend modes, channel name, CDN paths, and default custom shader.
- `js/view-routing.js`: client mode and workspace URL/session routing.

### Control UI

- `js/control/control-shell-controller.js`: the main UI controller and most templates and event binding. It owns component/group editing, drag reorder, scene/surface controls, live controls, dynamic parameter controls, color controls, media pickers, and modal state.
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

- `js/output/output-renderer.js`: the primary renderer. It owns component evaluation, groups, canvas components, render-size requests, specialized sources, media, pooled shared-context framebuffer targets, shader passes, caching, surfaces, mapper integration, thumbnails, handles, readiness blackout, and runtime profiling.
- `js/output/shared-framebuffer-target.js`: a top-left 2D facade over p5 framebuffers. It keeps component and effect targets in the main WebGL context and prevents centered p5 drawing state from shifting buffer copies.
- `js/output/output-app.js`: popup/standalone p5 client, resizing, fixture loading, and output bridge.
- `js/output/embedded-preview-app.js`: embedded preview lifecycle, sizing, local media import, thumbnails, mapping updates, and transform handles.
- `js/output/render-geometry.js`: frame, world, surface-texture, mapping, and preview sizing contracts.
- `js/output/vj-mapper.js`: VJ1's projection mapper, homography calculation, corner handles, overlays, reset, and mapping import/export.
- `js/output/media-utils.js`: image/video fit and playback helpers.
- `js/output/blend-utils.js`: component blend modes.

### Persistence and communication

- `js/services/project-folder-service.js`: folder open/close, scaffold creation, autosave, refresh, revisions, undo/redo, imports, and rendition writes.
- `js/services/media-library-service.js`: recursive media/shader discovery and in-memory `File` ownership.
- `js/services/media-rendition-service.js`: cached media rendition paths and dimensions.
- `js/services/directory-handle-store.js`: stored File System Access directory handle.
- `js/services/output-bridge-service.js`: control/output BroadcastChannel protocol.

### Metrics and tests

- `js/metrics/component-metrics.js`: static project analysis, runtime summaries, comparisons, and bottleneck estimates.
- `metrics.html`: browser runtime collector.
- `tests/*.test.mjs`: Node tests.
- `tests/shader-smoke.html`: real WebGL shader compilation smoke test.
- `tests/fixtures`: deterministic browser fixtures.
- `metrics-results`: checked-in baselines and representative old runs.

GPU timer queries are diagnostic sampling, not part of the render contract. The renderer samples them periodically and strictly bounds unresolved queries so unsupported or slow query delivery cannot create a growing per-frame polling workload. Render-buffer liveness must be refreshed in the usage map with the exact key of the CPU or GPU cache that supplied the active buffer; otherwise the idle-cache pruner can dispose a buffer that is still in use.

Component and Canvas thumbnail maintenance must decide staleness from signatures before reading pixels. Calling `get()` on a shared WebGL framebuffer is a synchronous full-frame GPU-to-CPU readback; it must never run merely to discover that the stored thumbnail is already current. The thumbnail interval throttles both stale checks and actual captures.

Thumbnail capture is live-preview-only. When preview rendering is disabled, parameter and transform edits may manipulate the stored thumbnail proxy but must never capture that proxy back into project state. Both the renderer capture boundary and the embedded-preview receiver reject captures while `ui.debugPreview` is false so an in-flight frame from a toggle transition cannot overwrite a valid thumbnail with a black or proxy frame.

## State and Persistence

Every state replacement passes through `sanitizeState()`. Add new persistent fields to defaults and normalization together; otherwise refreshes can reset parameters or old projects can produce invalid state.

`project.json` uses a strict sequential schema version defined by `CURRENT_PROJECT_VERSION` in `js/domain/project-migrations.js`; the current format is version 13. Increment this version whenever the persisted project data model changes. Each increment must add one adjacent named migration and register it by its source version: version 6→7 is a separate function from 7→8. The migration runner always applies every intervening step in order, so a version 5 project opened by a version 13 application executes 5→6→7→8→9→10→11→12→13 and fails safely if any step is missing. Migrations run before `sanitizeState()`; sanitization then supplies defaults, clamps values, and repairs references, but it is not the version history. Unversioned legacy files enter at version 1. Invalid or newer-than-supported project files are not loaded or autosaved, preventing an older application from overwriting an unknown format. To introduce a new format: bump `CURRENT_PROJECT_VERSION`, add and register exactly one adjacent migration, update current fixtures, and add focused migration tests.

Version 7 adds persisted `activity` metadata to components, Canvases, and shared recording frames: `createdAt`, `updatedAt`, and `lastUsedAt`. Direct edits update only the edited object's marker. A referenced component changing does not update a Canvas that contains it. A Canvas/frame Scene node derives recent activity from that Canvas and frame, so direct Canvas changes and frame geometry changes affect its position. Selecting a component or assigning a Scene source marks it used. Component catalogs default to Changed sorting and also offer Name and Created sorting. Their ordered ID snapshot is captured only when entering Component or Scene view, or when explicitly changing the sort mode; subsequent clicks and edits update persisted activity without making visible cards jump during the current visit.

Version 8 makes the workspace rename persistent. Migration 7→8 changes `ui.workspace: "compose"` to `"component"`, replaces `ui.workspaceCompositionIds` with `ui.workspaceSelectionIds`, and changes its `compose` key to `component`. Legacy `?workspace=compose` URLs and session values normalize to `component` at routing time and are persisted under the current identifier.

Version 9 persists catalog sorting as `ui.catalogSortModes`. Component and Scene source catalogs keep independent `recent`, `name`, or `created` preferences across project refreshes. Only the preference is persisted; the ordered ID snapshot remains local to the current view visit so selecting or editing an item cannot make cards jump immediately.

Version 10 completes the domain rename. Migration 9→10 recursively converts the old `compositions` collection, IDs and references, selected ID, Canvas source types, Scene routes, Live override banks, render settings, metrics fields, paths, and generated names to their Component equivalents. Legacy `?composition=1` standalone-preview URLs remain accepted but normalize to Component mode.

Version 11 removes the obsolete per-surface `sourceRect` crop and derived render geometry from persistence. Migration 10→11 strips those fields from global surfaces, Scene snapshots, and the Live snapshot. `render.outputs` is now the single persisted authority for output dimensions; primary-frame and mapping-world aliases are derived during normalization and are not written back to `project.json`.

Version 12 makes Canvas Component placement independent from Component initial dimensions. Migration 11→12 records each existing referenced Component's current footprint as normalized Canvas-relative width and height, including references nested in Groups and old `canvas.layers`. New references capture that normalized footprint when they are added. Later proportional initial-size changes therefore do not traverse the project or change existing Canvas layouts.

Version 13 makes the referenced Component authoritative for its dimensions and aspect. Migration 12→13 reduces the temporary two-axis Canvas footprint to one normalized placement scale. Canvas retains that scale plus its existing position and rotation transform; proportional Component initial-size changes preserve placement size, while intentional aspect changes reshape the placement from the Component without stretching it into an obsolete Canvas rectangle.

The major state sections are:

- `project`: name, folder name, save information, warnings.
- `ui`: current workspace and selected component, chain item, scene, surface, preview viewport, live overrides, and UI status.
- `global`: blackout, BPM, crossfade, HUD/debug labels, calibration, and mapping-handle mode.
- `render`: ordered projector output definitions, shared mapping-world size, Component initial dimensions, adaptive intermediate-surface policy, pixel density, edge softness, camera preferences, component upscaling, and full-resolution post-filter settings.
- `media`: serializable media metadata only.
- `components`: chain and canvas components.
- `recordingFrames`: project-level recording rectangles shared by every canvas component.
- `surfaces`: global surface definitions and ordering.
- `scenes`: snapshots of surface assignment, presence, enable state, order, and component selection.
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

The project file persists the selected component, chain item, and surface. Loading and sanitization retain those selections when the referenced IDs still exist and fall back safely when they do not. Folder refreshes update media and shader assets without replacing the project state, which prevents periodic refresh from jumping the selection back to the first component. The control client attempts to restore the last directory handle on startup; if browser permission is unavailable it keeps the project closed and asks the user to restore access.

Do not make localStorage authoritative. Session storage is only used for workspace convenience. Directory handles may be retained in IndexedDB, but permission can still need to be restored by the user.

## Component Semantics

Two component forms exist:

### Chain component

`component.chain` contains source, effect, and group items. Each enabled item consumes the current buffer and produces the next buffer.

- A source is media, camera, black, or a generator.
- A source has blend, opacity, transform, and source-specific parameters.
- An effect has effect parameters and may have a spatial transform.
- A group has its own transform, blend, opacity, and nested chain.
- Disabled items are skipped and should not affect thumbnails or runtime cost.

The graph compiler exposes a linear node graph for inspection, but `OutputRenderer` is authoritative for pixels, especially group isolation.

Older project files may still contain top-level `component.source` and `component.shaderChain`. Normalization migrates these fields into `component.chain`, and a few renderer/graph fallbacks remain for compatibility. New features must use `component.chain`; do not remove the legacy fields or fallbacks until there is an explicit project-format migration.

### Canvas component

A Canvas is a component with a large logical frame. Its `component.chain` uses exactly the same source, effect, and Group abstractions as an ordinary component. Referenced components are ordinary source items added through the shared plus menu; Groups are optional and never created implicitly. A referenced component is initially centered at its own logical width, height, and aspect ratio instead of being expanded to the Canvas. At insertion, its width relative to the Canvas is stored once as a normalized placement scale; the referenced Component remains authoritative for aspect and derives height from that scale. The standard `x`, `y`, uniform user `scale`, and `rotation` transform remains the only manipulation contract. Proportional Component initial-size changes cannot resize an existing placement, while an intentional aspect change reshapes it without stretching. Its row and inspector derive the label directly from the referenced component and do not expose an editable placement-wrapper name or component-replacement dropdown. To replace a Canvas placement, remove it and add the desired component through the plus menu. Placement blend and opacity remain instance properties on the Canvas source item. Sources and Groups use the standard preview transform handles for movement, scale, and rotation. Effects process the accumulated Canvas chain, so component features should be implemented once rather than copied into a Canvas-only abstraction.

Project-level `recordingFrames` contains the named recording rectangles shared by every Canvas, just as surfaces are shared across scenes. Adding, moving, resizing, or removing a frame from any Canvas therefore updates the same frame in every Canvas. Recording-frame creation and removal live in a dedicated left-rail section immediately below the Canvas list, mirroring the shared Surfaces section in Scenes rather than appearing inside a selected Canvas inspector. The real rendered Canvas preview draws each frame with direct manipulation: drag its outline to move it or drag any corner to change width and height independently while keeping the frame rectangular and inside the Canvas. The frame interior is deliberately not hit-active, allowing component and Group handles beneath it to remain draggable. In Scenes, every Canvas is exposed once as a full-Canvas component source and once per shared recording frame as a cropped source; all are routed through `surface.sourceNodeId`. The surface owns the route and projection fit; Canvases do not own or list surfaces. Legacy per-Canvas `canvas.frames` values migrate into the shared registry, legacy `canvas.layers` data migrates to ordinary Groups, and version 11 removes the obsolete surface crop field. Only shared recording-frame geometry may crop a Canvas route. Only Canvas may contain ordinary component sources. Ordinary component-to-component nesting, Canvas-in-canvas nesting, and self-reference are rejected in both the picker and state actions.

Scene routing is based on generic derived source nodes from `sceneSourceNodes()`. An ordinary component produces one `component` node. A Canvas produces one full-Canvas `component` node plus one `recording-frame` node for every shared frame. Both kinds appear in the selected surface's Scene assignment list and are selected through `surface.sourceNodeId`, including on direct/full-output surfaces. Each Canvas stores frame thumbnails keyed by the shared recording-frame ID; the preview renderer crops these from that Canvas's rendered pixels using the frame geometry, while the full-Canvas node uses the whole-Canvas thumbnail and uncropped Canvas dimensions. The node resolves to the underlying Canvas/component and optional frame geometry at the renderer boundary. `componentId` and `outputFrameId` remain synchronized on surfaces and snapshots only for project-format compatibility and old-project migration; new UI paths must select a source node rather than maintaining those fields independently.

`sourceNodeId` is authoritative whenever it resolves. Compatibility `componentId` and `outputFrameId` values may recover a legacy route only when that stable ID is absent or invalid; they must never override a valid ID during sanitization, workspace changes, or catalog reordering.

Surface `feather` is a physical per-surface projection property, clamped from `0` to `0.5` and intentionally excluded from scene snapshots. The mapper applies it as an aspect-correct rounded-rectangle distance field and edge smoothstep to both premultiplied RGB and alpha in the existing projective sampling shader. Cover and stretch feather against the surface boundary; contain feathers against the fitted image boundary so letterboxed image edges soften as expected. Scene transitions calculate this boundary independently for both routes before mixing them. This gives feathered surfaces slightly rounded corners without adding a render pass and remains stable when Scenes change. The default zero value selects the original mapper shader variant, which contains no feather uniform, branch, distance-field, or edge math; the feather-enabled shader is selected only for surfaces with a nonzero value.

Surface presentation is a shared destination abstraction. User-created surfaces have `destination.type: "mapped"` and editable projection corners. Output settings derive `destination.type: "direct"` surfaces: one for every configured output and, when there is more than one output, one continuous `All outputs · Direct` span. New direct routes are disabled and use Contain by default, cannot be deleted or corner-mapped, but share source assignment, scene presence, fit, opacity, blend, ordering, Live behavior, and physical feather with mapped surfaces. Every user-created mapped surface may be deleted, including the last one. Zero-feather direct routes use a straight rectangular compositor with no homography; nonzero feather and opt-in scene transitions reuse the existing fixed-rectangle mapper shader for correct rounded alpha and premultiplied dissolves. Each standalone window clips direct routes to its own output viewport. A combined direct route retains full-span source demand so each window samples the correct continuous slice rather than enlarging a half-resolution crop.

`renderCanvasComponent()` evaluates the shared chain into one GPU target whose physical size comes from the current demand request while transforms and recording frames retain Canvas-logical coordinates. Full-Canvas and recording-frame routes are generic source views over that target. Routes without final surface effects project the relevant source rectangle directly from the Component/Canvas texture, avoiding a crop buffer and a second resampling stage. Surface textures remain explicit materialization boundaries for final surface effects, scene transitions, thumbnail fallback, blackout, and calibration labels. Large logical Canvas dimensions therefore do not require a same-sized GPU texture unless Full-quality preview or a sufficiently large mapped route actually demands it.

Canvas logical dimensions and editor render density are separate. The preview toolbar beside the zoom controls exposes a compact quality toggle that cycles `Auto → Low → Full` for the selected Canvas; the Canvas inspector does not duplicate this setting. The default `canvas.previewQuality: "auto"` renders the editor target at approximately its visible preview size, `"low"` uses half that width and height, and `"full"` renders the complete logical Canvas. The toggle changes the internal Canvas raster rather than its displayed preview dimensions. This preview policy must not alter recording-frame coordinates. Routed output continues to make its own render request and is not reduced by the editor preview-quality setting.

## Sizing and Scaling Contract

Sizing is split into logical geometry, render demand, presentation sampling, and UI display. A field must belong to one of these stages; do not add a second persisted alias for a value another stage can derive.

| Concern | Authority | Effect |
| --- | --- | --- |
| Output window size and order | `render.outputs[]` | Persisted projector viewport dimensions and the side-by-side output span. |
| Mapping world | Derived by `normalizeRenderSettings()` from output sizes plus `VJ1.outputWorldMarginRatio` calibration margins | Runtime-only `worldWidth`/`worldHeight`; never an independently saved setting. |
| Ordinary Component initial frame | `render.componentTexture` plus `component.frameShape` | Starting logical aspect and base dimensions; it is not a physical raster ceiling. |
| Ordinary Component raster demand | Visible consumer footprint × `render.pixelDensity` × `component.resolutionScale`, bounded to 8192 per axis | Adaptive physical request; it does not change logical geometry. |
| Canvas design frame | `component.canvas.width`/`height`, defaulted by `VJ1.canvasWidth`/`canvasHeight` | Logical placement and recording-frame coordinate system. |
| Canvas routed raster ceiling | Maximum of the 1.5× recording-frame sampling allowance and configured pixel density, bounded to 8192 per axis | Allows magnified crops to supersample above logical Canvas size without making logical geometry resolution-dependent. |
| Canvas editor quality | `component.canvas.previewQuality` | Editor request only: Auto follows visible preview demand, Low halves it, Full requests logical Canvas size. |
| Placement geometry | Canvas Component source `placement.scale` plus Source or Group `transform` | One normalized base scale is captured on insertion; the Component supplies aspect, while transforms provide position, user scale, and rotation. Texture resolution cannot rewrite either. |
| Canvas crop | Project-level `recordingFrames[]` selected by a Scene source node | The only Canvas route crop authority. Full-Canvas routes always sample the full logical Canvas. |
| Mapped surface demand | Mapping corners and visible output viewport | Determines useful projected pixel footprint and adaptive upstream raster demand. |
| Intermediate-surface policy | `render.surfaceTexture` | Auto follows mapped demand; Manual caps only materialized surface buffers. Direct projection bypasses it. It does not define Component or Canvas dimensions. |
| Projection presentation | `surface.projectionFit` | Cover, Contain, or Stretch sampling at the surface; it never changes source geometry. |
| Adaptive safety | `SURFACE_DEMAND_OVERSCAN` (1.08) and `RECORDING_FRAME_DEMAND_SCALE` (1.5) | Named render-contract multipliers for filtering/projective sampling, shared by the generic demand planner. |
| Direct output | Direct-surface destination span | Preserves full source footprint so separate windows sample continuous slices correctly. |
| Preview navigation | `ui.previewViewport` zoom/pan and CSS fit | Display-only; it must not affect logical or physical render requests. |
| Component upscaling/post filters | Explicit component pipeline settings | An internal processing stage, not a replacement for source logical size or output size. |
| Media fit and generator/model scale parameters | Individual source parameters | Content-local appearance controls; they are not infrastructure sizing variables. |

The output p5 canvases use backing density 1. `render.pixelDensity` is carried explicitly through render requests so browser device-pixel ratio cannot silently multiply GPU buffers. Runtime compatibility aliases such as `render.frameWidth`, `render.frameHeight`, `render.width`, `render.height`, `render.worldWidth`, and `render.worldHeight` may be read by old call sites, but they are derived from `render.outputs` and excluded from saved projects. `worldScale`, `outputGap`, legacy surface dimensions, and the per-surface crop are removed rather than maintained as hidden inputs.

## Generators and Effects

Current generators include test pattern, waves, noise, plasma, gradient, fireflies, 3D eyeball, low-poly anatomy, terrain flyover, Bezier strokes, Base Warp, Seascape, Paint Drips, Cloudy Tunnel, Cherenkov Volume, Biomine Lite, swaying trees, checker, and black.

Current effects include ripple, RGB split, photo grade, label chromatic/grain/threshold grain, smear, crayon/pen stroke, hard black, blur, erode, dilate, grayscale, threshold, invert, kaleido, pixelate, pixel-art upscale, plasma tint, luma key, HSV alpha key, alpha vignette, glitch distortion, spin/rotate, flip, echo fade, mirror fold, heat shimmer, heartbeat pulse, and custom GLSL.

Parameter controls are generated from component schemas. Number, paired numeric range, enum, boolean, and RGBA color types must work in both component and Live views. Paired ranges use two handles on one track and keep the lower and upper values ordered. Do not add a one-off UI control when the schema can describe it.

The HSV alpha key removes pixels inside a selected hue, saturation, and value box, with a feathered boundary. Its defaults target dark blues: `200–260°` hue, `40–100%` saturation, and `0–45%` value. It converts premultiplied input to straight RGB only for HSV classification, then applies the resulting keep factor back to both premultiplied RGB and alpha.

Timing-based effects and generators use instance-derived offsets so separate chain instances and separate surface routes do not synchronize unintentionally.

## Render Pipeline

At a high level each frame does:

```text
state -> route demand -> needed component/Canvas textures
      -> direct source-rectangle projection -> output frame -> HUD/debug overlay
      -> optional materialized surface texture for exception paths
```

Important details:

1. Only components required by the current workspace/scene are rendered.
2. Static components are signature-cached.
3. Dynamic sources and effects invalidate per frame.
4. Component, group, source, and effect intermediates prefer pooled p5 framebuffers in the output canvas's WebGL context, so compatible chains remain GPU-resident.
5. Consecutive safe pixel-local effects are fused into one physical shader draw; neighborhood and stateful effects remain separate.
6. Groups use isolated transparent intermediates.
7. Surface presentation/timing identity is separate from component render identity, so two surfaces can share the same component result without synchronizing route-specific timing.
8. Component initial dimensions come from `render.componentTexture`; runtime Component rasters follow visible demand and may render below or above that initial size. The independent `render.surfaceTexture` policy only controls whether materialized per-surface demand is automatic or manually capped. Pixel density and Component resolution scale multiply adaptive demand.
9. Component previews derive physical raster demand from the visible fitted preview and may render below or above the configured initial dimensions.
10. Each output canvas follows its window size, while its selected logical projector viewport keeps the configured aspect and fills/crops according to output fitting rules.
11. Canvas containers retain logical coordinates for placement and recording frames while their physical accumulation target follows preview or route demand; referenced components still use the normal adaptive request and cache path.

Project settings can enable an experimental component output pipeline. When enabled, chain components render at `render.upscaling.amount` of their normal physical texture size while retaining their original logical dimensions, then pass through one fast spatial upscale at the normal component target size. Optional grayscale and animated monochrome noise are combined into a second post pass at that full target size. The pipeline is off by default, canvas containers do not receive a second upscale over their already-processed child components, and animated post noise disables stable-frame caching for the affected output.

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

All specialized 3D sources use the same bounded scratch-target lifecycle. Model and terrain drawing each retain one resizable WebGL target per renderer, render sequentially, and copy their result into the component accumulation target immediately. Placement scaling therefore resizes a stable context instead of caching a context for every intermediate demand size. This is especially important for STL/OBJ: raw mesh programs and static vertex buffers are cached per context, so size-keyed targets would duplicate the entire mesh on every drag step and eventually exhaust WebGL resources. Do not reintroduce dimension-keyed target maps for specialized sources.

STL/OBJ surface geometry is uploaded once per context as one interleaved position/normal `STATIC_DRAW` buffer; the temporary interleaved CPU array is not retained after upload. Point and thick-wire buffers are also static, but only the currently requested budget variant is retained for each mesh and mode. Model programs are created lazily by render mode, checked with `isProgram`/`isBuffer` when available, and explicitly deleted together with every model buffer before its specialized context is discarded. Arbitrary imported meshes must retain their actual vertex geometry; unlike terrain, they cannot be reduced to a small regular grid displaced procedurally in the vertex shader.

Specialized wire widths are authored in logical component pixels. Before either p5 geometry or raw WebGL draws, `resolutionScaledStrokeWidth()` converts that width once to the requested raster scale; raw STL and terrain additionally account for the actual WebGL backing-buffer density. This keeps the apparent STL, anatomy, and terrain wire thickness stable when component resolution, render quality, demand size, or pixel density changes without adding per-fragment resolution work.

## Mapping, Frame, World, and Texture Sizes

These dimensions have different jobs and must not be conflated:

- **Output size** is one configured projector's logical resolution/aspect. `render.outputs` is ordered and old `frameWidth`/`frameHeight` projects migrate to one `output-main` definition.
- **World size** contains every output frame arranged edge-to-edge horizontally, with outer margins but no gap between projectors. Scene mapping operates in this shared coordinate system, so a surface may lie inside one output or span several.
- **Component initial size** defines an ordinary Component's starting landscape frame and aspect, but does not cap native detail. Runtime raster dimensions follow the largest visible consumer demand, with an aspect-preserving 8192-per-axis safety bound. Canvas references snapshot one normalized scale when inserted: proportional initial-size changes preserve placement size, while aspect changes follow the Component rather than stretching it.
- **Intermediate surface texture size** is demand-driven only when a route must materialize for final surface effects, transitions, thumbnail fallback, blackout, or calibration labels. `render.surfaceTexture.mode: "auto"` follows projected demand; `"manual"` activates `maxWidth`/`maxHeight` as ceilings for that intermediate only. Direct routes bypass this texture and therefore ignore its limit. Neither mode changes Component or Canvas geometry.
- **Preview canvas size** is a UI/display concern. The embedded renderer keeps logical world coordinates intact but adds a transient `previewRasterScale`, so physical canvas and intermediate buffers follow the pixels the preview can actually display.
- **Popup window size** controls the HTML/p5 canvas display. Its visible footprint contributes to adaptive Component demand but does not change Component geometry.

Preview viewport fit modes are semantic rather than reusable numeric zooms. Scene/Live resolves `fit: "frame"` against the shared output world, while Component/Canvas resolves automatic fits to its already frame-sized logical canvas. Only `fit: "manual"` deliberately carries the exact zoom and pan between workspaces; otherwise a Scene frame-fit zoom must never leak into Canvas and cause a transition overscale. Workspace DOM commits are synchronous so their rails and component lists cannot lag behind the mode change. When the preview changes between component-sized and world-sized modes, it waits for two matching stage measurements, applies the new canvas size and fit, and reveals the canvas only after a frame has rendered with that settled contract. Resize observation must ignore intermediate measurements during this transaction. When workspace rendering replaces the preview stage DOM, the embedded preview must also unobserve the detached stage and observe the replacement. Pausing or replacing a stage cancels its pending settle transaction; a remount onto a new stage, or any remount that inherits a hidden canvas, starts a fresh settle-and-reveal transaction so an interrupted workspace switch cannot leave the shared preview permanently invisible.

Mappings are stored in world coordinates. `VjMapper` computes and caches a homography from four corners, applies the inverse transform at the quad vertices, and rasterizes the routed texture as a real projective quadrilateral. Mapping reset, import, resize, and scene snapshots must use the same coordinate convention. Surface order is draw order.

The old top-level `render.surfaceWidth`/`surfaceHeight` fields migrate once into editable `componentTexture` dimensions, then disappear. They never become an automatic surface ceiling. Projects without the nested surface policy—including all legacy files—enter Auto mode. Surface targets are created lazily by requested dimensions, with no eager fixed-resolution scratch or fallback surface allocation. Projective demand uses the longest opposing quad edge rather than their average so strongly trapezoidal surfaces retain detail on their magnified side.

Render demand accepts a generic `samplingScale` supplied by the source-view contract. A routed Canvas recording frame declares 1.5× to preserve detail when a smaller Canvas subrectangle is magnified and projectively filtered. The mapper now samples that subrectangle directly, so the multiplier is sampling headroom rather than compensation for a mandatory crop buffer. It raises the Canvas and every referenced component/effect upstream as one demand graph; whole-Canvas routes remain at 1×. Keep this requirement in the source view rather than adding Canvas branches to the geometry planner.

Projection handle and whole-surface drags emit live `scrub:mapping-state` updates so connected outputs follow the pointer before release. These live updates are animation-frame throttled by the control bridge and excluded from autosave; pointer release emits the final `mapping-state` update through the normal persistence path.

Standalone output renderers hard-disable mapper calibration regardless of incoming workspace commands or stale state. Surface corner markers, frame guides, and calibration labels must only appear in the embedded Scene preview, never in an output window.

Each surface and scene-surface snapshot stores `projectionFit`. The default is `cover`; `contain` preserves the whole texture with transparent unused space, and `stretch` ignores source proportions. Cover and contain compare the source texture aspect with the current mapped quadrilateral's aspect, calculated from the average opposing edge lengths; stored logical surface dimensions are not presentation geometry. Fit is implemented in the existing mapper shader, so it does not add a render pass. Canvas recording-frame sampling happens before projection fit.

Each output window carries an `outputId`, subtracts that output frame's shared-world origin, and renders only that viewport. The embedded Scene preview shows every named output frame together. When a popup and its Scene frame differ, inspect `render-geometry.js`, `mappingForRenderMode()`, `buildSurfaceRenderPlan()`, and the output frame transform before changing source-fit behavior.

## Media

Supported media includes images, videos, SVG, STL, and OBJ. Camera input is supplied through the Portal camera integration. Project Settings owns the shared camera capture request: target width and height, front/rear preference, mirroring, and optional maximum-supported resolution. Renderers derive one stable capture signature from these settings and restart an active or pending capture only when that signature changes; stale asynchronous camera requests dispose their stream instead of replacing the newer capture.

Project Settings is a tabbed, mount-once modal with Outputs, Camera, and Rendering views. Rendering labels `render.componentTexture` as **Component initial size** because it defines starting logical geometry and aspect, not a fixed runtime texture. State changes patch existing controls in place instead of regenerating the modal HTML. Only the configured-output card list may be rebuilt when its output identity structure changes. Settings must not use scroll capture or scroll restoration to compensate for DOM replacement.

- Images support contain/cover behavior and source transforms without losing access to pixels outside the component frame.
- Videos support start/end trim and playback speed.
- SVG loading is asynchronous and must resolve to a drawable image before removing loading state.
- STL/OBJ parsing produces triangles and cached surface/wire/point GPU buffers.
- Model draw mode, colors, rotations, spin, scale, depth, visible-depth cutoff, wire thickness, and point budget are source parameters.
- Media renditions are PNG to avoid noise damage from lossy JPEG compression.

Component thumbnails retain their source aspect within a maximum `768 x 432` image. Paused component previews contain the complete thumbnail, while list cards use `object-fit: cover` so they fill without distortion. Scene surfaces route thumbnails through canvas sampling and the surface's projection-fit logic. Existing project thumbnails retain their old pixels until that component is selected and captured again. Unselected component and media thumbnails use a brighter, higher-contrast grayscale treatment for legibility.

When media is missing in an output client, the entire output blacks out and shows only the small loading indicator/HUD. Do not render effects over loading placeholders.

## Live Output and Synchronization

Control and output clients use `BroadcastChannel("vj1-output-bridge")`.

- Output clients announce themselves every two seconds.
- Output clients include their configured `outputId`; connection status is tracked per output.
- Control responds with render state and media files.
- Output sends FPS, frame time, render cost, pass profiles, mapping updates, and media requests.
- Slider scrubs are transmitted on the next animation frame for low-latency live performance.
- Live and non-Scene edits send immediately unless excluded as UI-only state. Scene editing does not broadcast full program state; projection changes use the mapping-only sync command so live mapping remains responsive without changing the routed program scene.

Scene editing and Live selection are separate only at the scene-selection boundary. `ui.live.selectedSceneId` alone decides which scene every output presents; selecting another scene in Scene must never change it by itself. The captured `ui.live.sceneSnapshot` is refreshed from that selected canonical scene after every state update, so surface additions, removals, routes, and persistent edits reach Live immediately without requiring a scene switch. All workspaces broadcast the derived Live render state; Scene view must never broadcast its own selected preview state to an existing output. Temporary component overrides are retained in `ui.live.sceneOverrides` per scene while the app is open and restored when switching back; each Live scene card exposes an enabled Reset action only when that scene has overrides. A persistent component edit prunes only conflicting temporary override fields across the override banks, so the persistent value wins while unrelated performance tweaks remain. These overrides remain intentionally absent from the saved project payload. The Live scene ID and captured snapshot persist in the project UI payload. An empty Live selector initializes from its own first-scene fallback and must never copy `ui.selectedSceneId` during a workspace change. Opening an output while in Scene is the explicit exception: the selected Scene is first selected in Live, then the popup opens and follows the same Live state as every existing output. Output windows never receive a private or one-use Scene selection. Targeted hello responses still prevent a newly opened popup from causing redundant state delivery to existing outputs.

Live exposes a persisted `ui.live.transitionDuration` in seconds, clamped to `0–30` with the UI slider currently exposing `0–10`. Its default is `0`, and selecting a Live scene at zero creates no transition descriptor, allocates no transition textures, compiles no transition shader, and follows the original single-scene surface render path. At a nonzero duration, selection captures the outgoing scene snapshot and its temporary override bank in a runtime-only transition descriptor, switches the program selection to the target, and sends one absolute wall-clock start time to every output. Each projector derives progress locally from that shared timestamp rather than receiving per-frame scrub messages.

The active dissolve resolves source and target scene routes independently. Each visible physical surface retains one temporary source and target route texture and the mapper samples both in one premultiplied projection shader, preserving each side's projection-fit mode before applying the physical surface feather once. Missing routes use transparent textures so surfaces fade in or out. Identical component state can reuse the frame-local component output across both route plans; differing override state receives separate render identities. Per-surface final effects also receive source/target identities. Transition textures are disposed immediately when the transition expires or is replaced. The active descriptor is excluded from project saves; only the duration preference persists.

When a routed Canvas appears in Live, each component placement expands into the referenced component's element tree and schema-generated parameters. Nested controls write to that referenced component's entry in `ui.live.componentOverrides`, while the placement's own opacity and blend remain overrides on the Canvas chain item. Expansion tracks component ancestry to avoid recursive UI cycles.

With one configured output, the top-bar Output action opens it directly. With multiple outputs, the menu opens one named popup per configured output and has no bulk “open all” action. Popup names include the output ID so repeated opens focus/reuse the same window. Browser window dimensions are only presentation hints; the output definition remains the authoritative logical resolution.

The top-bar play/pause button is always present but disabled until an output client is connected. It controls the shared visual clock, including time-based generators and video playback, without tearing down the renderer. The control UI can refresh or restore its project while an already-open output window remains connected; output clients announce themselves periodically and receive the current render state and requested media files.

Avoid rebuilding large DOM subtrees while a slider, select, trim range, or color picker is active. Background state refreshes previously closed color pickers and interrupted pointer interaction.

## Performance Rules

The main risks are pixel count, pass count, duplicate WebGL contexts, unnecessary dynamic invalidation, and CPU-generated geometry.

- Keep one embedded WebGL preview and one context per actual output window. Dispose graphics and renderer resources on page hide.
- Reuse WebGL targets; do not create graphics buffers on resize or every frame without cache/disposal rules.
- Specialized 3D renderers must use a stable resizable scratch-target lifecycle so adaptive component demand does not multiply WebGL contexts or static geometry uploads. Raw-GL renderers such as Terrain should use a depth-enabled framebuffer in the main WebGL context; p5-3D renderers may retain one dedicated `p5.Graphics` context when they require p5's 3D API.
- Never upload a resizable WebGL canvas as a texture into another WebGL context. Chromium/p5 may retain the old texture allocation and issue invalid sub-texture copies after the source backing size changes. Prefer same-context framebuffers for resizable intermediate targets.
- Keep framebuffer copies on the shared top-left drawing contract; p5's main WEBGL renderer otherwise inherits centered image state across targets.
- Prefer one bounded shader pass over chains of small passes where behavior can be combined cleanly.
- Skip neutral/zero-amount passes before drawing.
- Preserve static-component caching by accurately reporting whether sources/effects are dynamic.
- Use cheap hash functions rather than p5 random/noise in per-pixel or per-particle loops.
- Avoid shader `sin`, `cos`, `sqrt`, and `distance` where a stable cheaper formulation is sufficient, but do not sacrifice required visual correctness blindly.
- Bound loops at compile time for WebGL compatibility.
- For 3D terrain, prefer a reusable displaced polygon grid over per-pixel ray marching.
- Treat CPU and GPU metrics as related but different signals. GPU timer data is not universally available, and GPU work can overlap CPU submission or remain queued.

JavaScript `async` does not move rendering onto another CPU thread, and WebGL command submission is already asynchronous to the GPU. The browser already presents through a swap chain, so adding an application-level two-frame display buffer normally adds a frame of latency without increasing steady-state throughput. Web Workers are appropriate for transferable CPU-only preparation such as model parsing, mesh generation, media metadata, and graph/shader planning. Splitting live component rendering across worker-owned `OffscreenCanvas` WebGL contexts is not currently a default optimization because textures cannot be shared directly between contexts; transferring `ImageBitmap` results adds copies, synchronization, memory, and latency. A future whole-renderer OffscreenCanvas worker or WebGPU backend should be evaluated as an architectural migration with measurements, not as per-element async branches.

Mapped rendering uses one generic demand path for ordinary components and Canvas recording-frame sources. `componentSourceView()` describes logical source size, sampled rectangle, quality multiplier, and the shared 8192 safety bound; `sourceRenderDemand()` intersects the mapped quad with the current renderer viewport and derives the physical component raster plus any required surface raster. Multiple routes sampling one component share the largest required component raster for that renderer/frame. Routes outside an output viewport are culled before source rendering or surface allocation. Canvas is special only when resolving its recording-frame sample rectangle and routed raster allowance; crop, demand, cache, and projection code remain shared. The mapper accepts a normalized source rectangle, so ordinary Components, full Canvases, and recording frames all use the same direct projection path.

Logical Component/Canvas dimensions must never be reduced to improve performance. Physical raster demand is allowed to vary by preview size, projector viewport, mapped footprint, and nested placement. Component references inherit the pixel demand of their placement; `render.componentTexture` supplies initial logical dimensions but is not their physical ceiling. Ordinary Components use an aspect-preserving 8192-per-axis safety bound, while Canvas uses its routed quality allowance and the same per-axis bound. Static caching follows the complete component dependency graph, including Canvas dimensions and nested media; thumbnail data is excluded from render signatures. A static Canvas must be cacheable under the same rules as a static ordinary component.

Component chains use the shared placed-render-result contract from `js/graph/placed-render-result.js`. A drawable 2D media, camera, or referenced-component source may remain a texture plus destination rectangle, fit, transform, opacity, and blend until it is drawn directly into the next accumulation target. This applies identically to ordinary and Canvas components. It avoids allocating, clearing, writing, and resampling a transparent parent-sized source buffer. Effects and isolated Groups are explicit materialization boundaries; shader generators, 3D/model sources, unavailable media placeholders, Canvas nesting, and overlay blend retain the conservative materialized path. Eligibility is centralized in `directPlacementKind()` rather than duplicated as Canvas/source-type branches. A placement scale increases the referenced component's raster demand without changing its logical destination rectangle.

Runtime profiles expose `surfaceRouteCandidates`, `surfaceRoutesVisible`, `surfaceRoutesCulled`, `componentRasterPixels`, `surfaceRasterPixels`, `directSourceComposites`, `avoidedSourceRasterPixels`, `directSurfaceSamples`, and `avoidedSurfaceRasterPixels`. Use these with wall-clock frame time and FPS to verify that an optimization removes planned work. The GPU readout is an averaged query signal and must not be interpreted as total frame GPU time.

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
5. Compare embedded component preview, scene preview, and popup output when sizing or mapping changed.
6. Inspect `#vj1-runtime-metrics` or `window.__vj1RuntimeMetrics` for runtime samples.
7. Save meaningful before/after reports in `metrics-results/runs` and compare them.

Useful fixture URL:

```text
https://127.0.0.1:8082/experiments/vj1/?output=1&fixture=tests/fixtures/four-surface-show.json
```

The shader smoke page must be used for new GLSL because Node tests only inspect strings and schemas; they do not compile WebGL shaders.

## Current Handover Status

The VJ1 worktree contains uncommitted changes. The current diff centers on generic direct source-view projection for ordinary Components, full Canvases, and recording-frame subrectangles; adaptive Component raster demand above or below the configured initial size; demand-sized Component previews; shared 8192 safety bounds; updated static performance estimates; cache-busting imports; and focused render-geometry/output tests. Surface textures remain only on explicit materialization paths. Do not discard or broadly rewrite these changes. Read the diff before touching files that already changed.

The test suite currently has 255 passing Node tests. Coverage includes sequential project-schema migration and future-version guards, normalized Canvas Component placement independent from texture resolution, the deep v9→v10 Component-domain migration and legacy standalone URL alias, persisted independent catalog-sort preferences, the persisted Component-workspace migration, stable activity-based component sorting, non-propagating Canvas activity, per-scene Live selection, Live-authoritative output startup, workspace-specific component memory, override reconciliation, zero-cost scene cuts, synchronized dissolve state, compact naming, nesting guards, component filtering, component sizing, independent component/surface resolution policy, recording-frame supersampling and legacy-field migration, workspace-specific preview fitting and observer retargeting, label-controlled mapping overlays, generic render demand and viewport culling, direct source-rectangle projection, derived direct-output destinations, continuous multi-output slicing, removable projection surfaces, direct fit geometry, direct feather routing, direct placed-texture compositing, bounded GPU timing instrumentation, nested/Canvas dependency caching, shared-framebuffer placement, effect fusion, projective mapping and mapped-quadrilateral fit geometry, premultiplied surface feather and scene dissolve, component upscale/post settings, resolution-relative specialized wire widths, same-context Terrain scratch rendering, model transforms and depth cutoff, guarded thumbnail readback and cover cropping, shared compact text-list structure, control UI contracts, media loading, and project persistence. The shader smoke page is still required for real GLSL compilation. The representative before/after runtime comparison is stored under `metrics-results/runs/four-surface-show-gpu-architecture.*`.

## Change Discipline

- Preserve project-file compatibility through normalization.
- Preserve alpha through every stage.
- Keep preview and popup output behavior equivalent.
- Keep Scene selection separate from Live output selection, while allowing edits to the Live-selected scene and shared project data to propagate immediately.
- Keep groups isolated.
- Keep transforms attached to their intended source/effect field rather than transforming the entire accumulated image accidentally.
- Do not create extra WebGL contexts to solve local rendering problems.
- Add focused tests for every bug fix, especially sizing, scene snapshots, chain/group ordering, alpha, caching, and specialized render paths.
- Update cache-busting query strings when browser modules would otherwise stay stale during manual verification.
