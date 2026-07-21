# VJ1 Handover Brief

Updated: 2026-07-21

VJ1 is a build-free browser VJ and projection-mapping application in `experiments/vj1`. It targets current Chrome with a capable GPU. p5 remains the browser/media host, while frame-critical rendering increasingly uses raw WebGL and shared p5 framebuffers. The user-selected project folder and its `project.json` are authoritative.

## Product Model

- **Component**: reusable ordered chain of sources, effects, and isolated Groups.
- **Scene**: the former Canvas. It uses the Component chain model, may arrange reusable Components, and owns the content and fit configuration of each shared Frame slot.
- **Frame**: a stable, proportion-only output slot. In each Scene it exposes either the whole Scene or one ordinary Component, with `cover`, `contain`, or `stretch`.
- **Mapping**: the former Scene preset. It stores physical Surfaces and assigns one Frame slot to each Surface; it does not directly own Components or Scenes.
- **Live**: selects an on-air Scene or ordinary Component and applies temporary overrides. Scenes are the default catalog. The selected Mapping remains independent: a Scene resolves its authored Frame content, while a standalone Component feeds every mapped Frame with an explicit `cover` crop.
- **Output**: renders the selected Live Scene through the selected Mapping in an embedded preview or standalone output window.

The current runtime and persisted model use these names canonically: Scene Components use `type: "scene"` and `.scene`; Mapping presets live in `state.mappings`; every Mapping directly owns its complete `surfaces` and `calibration`; workspace keys are `component`, `scene`, `mapping`, `nodes`, and `live`. Old Canvas/Scene names exist only inside historical migration steps or where “canvas” literally means an HTML/p5 drawing surface.

Project schema is version **28**. The v26→v27 migration renames Canvas Components to Scenes and old Scene presets to Mappings. The v27→v28 migration folds the former global physical Surfaces and calibration into each Mapping and removes those roots from canonical persistence. Persisted format changes require one adjacent migration in `domain/project-migrations.js` plus focused tests. Do not restore obsolete parallel authorities such as `component.source`, `component.shaderChain`, legacy Canvas `layers`, root-level authored Surfaces/calibration, per-surface pixel crops, or chain-level source params.

## Architecture and Library Boundaries

The application root (`app.js`, state, controllers, output hosts, services) configures focused libraries under `js/libraries`:

- `node-engine`: typed/versioned node definitions, ports, groups, packages, forks, and editable parts.
- `composition-engine`: compiled Component, Scene, Mapping, surface-route, and application programs.
- `render-engine`: relative geometry, render views, and ROI contracts.
- `mapping-engine`: surface homography, source fit, feathering, and projection sampling.
- `cache-engine`: retained render-target and signature caches.
- `media-engine`: media/input lifecycle contracts.
- `mesh-engine`: STL/OBJ parsers, format detection, mesh preparation/resolution, mesh rendering, and file-to-image groups.
- `image-engine`: reusable image operations such as resize.
- `isf-engine`: ISF 2 metadata parsing, first-class project nodes, GLSL host adaptation, and relative multipass descriptions.
- `control-engine`, `data-store`, `state-engine`, `storage-engine`, `synchronization-engine`, `timing-engine`, and `diagnostics-engine`: non-render infrastructure.
- `visual-nodes`: one folder per generator/effect with metadata, editable JavaScript, shaders, and runtime parts where applicable.

Nodes are real implementations, not decorative wrappers. Code, shader, parser, and group nodes own their editable algorithms. Optimized hosts may call the same exported implementation directly without allocating a generic NodeInstance or traversing packets each frame. Do not replace the current allocation-stable renderer with generic per-frame graph traversal. Compiler/custom-node boundaries are preferred when a relationship needs specialization.

## Render Pipeline

```text
canonical state
  -> selected Scene + selected Mapping materialization
  -> compiled visible Surface routes
  -> shared Component/Scene demand
  -> retained source/effect textures
  -> optional group/effect/transition materialization
  -> Frame fit/feather + Surface fit/feather + mapping
  -> embedded or standalone output
```

Only visible dependencies render. Static nodes are signature-cached; dynamic nodes invalidate on their real time/media revision. Synchronized instances reuse eligible Component results. Frames are texture views into one parent Scene, not separate full-Scene renders. A Frame exposing an ordinary Component can route that retained Component directly.

Important invariants:

- `ui.live.selectedComponentId` identifies the on-air Scene or Component; `ui.live.selectedSceneId` retains the current Scene context; `ui.selectedMappingId` identifies the editor/output Mapping. Editor Mapping selection must never replace the on-air target.
- A Mapping stores `frameSlotId`, never a concrete Component assignment. Resolve the slot against the selected Scene only at the Live/render-state boundary.
- Relative Mapping corners use one canonical world derived from the configured Output proportions. Popup and preview pixel dimensions are raster hosts only and never become geometry authority. Mapping and Live contain this canonical world inside their fixed p5 canvas before applying the ordinary internal viewport zoom. Standalone Output uniformly covers the selected configured Output frame. Resizing may crop but never stretch Surface geometry.
- Components render intrinsic textures. Parent transforms place them on Scenes, Surfaces, and Live.
- Boundaries and content transforms are separate: the boundary owns placement, rotation, and clipping; content transform moves/scales the image or procedural domain inside it.
- Geometry is relative and resolution-independent. Pixel dimensions are derived from host viewport, output proportions, quality, density, and visible demand.
- ROI changes allocation/sampling only; it must not recenter, squeeze, or change generator/effect math.
- Media and SVG detail demand follows the full logical node boundary, then content scale; visible ROI allocation must never be mistaken for the source-resolution demand.
- Chain coordinates are screen-like: positive X right, positive Y down, positive rotation clockwise.
- Premultiplied alpha is the render contract.
- `cover`, `contain`, and `stretch` are explicit route choices and must retain their normal meanings.
- Avoid extra WebGL contexts, pixel readbacks, resizable cross-context canvas uploads, and unnecessary ping-pong buffers.
- Frame fit and Surface fit are composed in the existing mapper shader. Non-direct routes reuse the already-required Surface target. Do not add a Frame framebuffer or mapping pass.
- No silent media/render fallback. Emit structured `VJ1_*` diagnostics.

### ISF shaders

Project `.fs`, `.frag`, and `.glsl` files with an ISF 2 JSON header are discovered as first-class generator or effect nodes. Their declared scalar, boolean, enum, point, and color inputs become ordinary VJ1 parameters; source, metadata, version, description, ports, and editable shader part remain visible in Nodes. The source file is the base authority and is excluded from `project.json`; only references and edited project forks persist.

Single-pass ISF shares the normal cached shader/target path. Multipass execution is invoked only for ISF that declares passes: named transient targets retain one framebuffer, persistent targets use the required two-target swap, float targets request a float shared framebuffer, and relative WIDTH/HEIGHT expressions are evaluated from current render demand. Standard TIME, TIMEDELTA, FRAMEINDEX, PASSINDEX, DATE, RENDERSIZE, image-size, and normalized/pixel sampling contracts are host-bound. Raw ISF `gl_FragCoord` is compiler-virtualized from boundary UV and logical `RENDERSIZE`; never bind it to preview framebuffer pixels, because resizing or ROI would move procedural centers. Ordinary VJ1 effects retain their established fusion and two-target path.

Current Component chains have one image inlet. ISF transitions, auxiliary images, audio, and FFT files remain represented as node ports but are omitted from the visual catalog with `VJ1_ISF_MULTI_INPUT_REQUIRES_NODE_GRAPH`; never bind them silently to the primary image. They should activate when graph-level multi-input placement is implemented.

Effects remain sequential. Shader fusion, direct placement, retained framebuffers, specialized model/terrain paths, and cache reuse must survive node-system work. Do not force optimized paths into a pure generic traversal when a compiled direct node or custom renderer is healthier.

## Current Render and Performance State

The latest committed baseline is `b3de46e2`. It contains the recent browser/video/cache/diagnostic work and the direct recording-frame correction.

### Direct recording-frame presentation

p5's source-rectangle `image()` path could trigger:

`GL_INVALID_VALUE: glCopySubTextureCHROMIUM: Negative offset`

Direct Frame routes now sample the parent Scene through the existing mapping shader. This preserves fit semantics and remains one GPU draw. It adds no surface buffer, readback, or ping-pong pass. Crop bounds are normalized once by the mapper; a redundant outer clamp was removed after audit.

### Parsed STL/OBJ presentation

The same Chromium error was later confirmed in Scene view when a cached STL became ready. The cache was not corrupt: readiness merely activated a per-frame upload from a separate p5 WebGL canvas.

The current worktree routes parsed STL/OBJ raw rendering into one retained shared-context depth framebuffer (`modelRaw`). The existing mesh renderer, transforms, LOD selection, QEM cache, and final presentation draw are unchanged. The cross-context texture upload is removed; no new pass or ping-pong pair is introduced.

For STL/OBJ-only use, target count remains one. If parsed meshes and procedural/imported p5 models are both used, `modelRaw` and the legacy p5 `model` scratch target can coexist. This is the only possible memory increase and is deliberate: sharing the incompatible target recreated the GPU fault. Both targets are retained, resized, reused, and disposed by `SpecializedSourceRuntime`. A failure emits `VJ1_MODEL_SHARED_RENDER_FAILED` once.

### Video and retained caching

Modern video elements use decoded-frame callbacks to advance a revision; cached Components invalidate only for presented frames rather than every renderer tick. A cached video Component renews its media lease so playback does not pause after its first retained frame. This is separate from the STL fix and is intended to reduce duplicate work.

SVG media stays logically vector but is rasterized into one retained demand-sized image for GPU upload. Render resolution and content scale may upgrade that image up to the normal media cap; the media revision invalidates stable Component output only when the variant changes. SVG bypasses persisted PNG rendition caches so an older low-resolution rendition cannot mask a sharper vector rasterization. This creates no render pass or ping-pong target.

### Thumbnails

Component, Scene, and Frame thumbnails use stale-while-revalidate behavior. Mapping presets intentionally have no thumbnails because they contain geometry and routing rather than visual content. The last valid thumbnail stays visible until a replacement succeeds. Capture is serialized, idle/gesture-aware, GPU-downsampled before its small readback, and disabled in standalone outputs. Do not clear thumbnails on a dirty flag.

## Scene, Mapping, Live, and Output Semantics

Mapping routes use stable Frame slot IDs. At runtime `materializeSceneSurfaceRoutes()` resolves each slot against the selected Scene: either the Scene's own Frame view or the ordinary Component selected in that Scene's Frame configuration. A whole Scene and `Scene · Frame N` remain distinct render views. Frame fit is applied before the Surface's projection fit, and both retain their normal meanings. No automatic `cover` to `contain` migration exists.

Live has one source catalog with Scene and Component filters; Scenes are selected by default. Selecting a Component does not create or persist a temporary Scene. `materializeLiveTargetSurfaceRoutes()` routes the Component through every Mapping Frame with `frameFit: "cover"`, while leaving Surface geometry and projection fit untouched. Scene↔Component transitions reuse the existing transition textures; this adds no renderer, framebuffer, or ping-pong pass.

Control and outputs communicate through `BroadcastChannel("vj1-output-bridge")`. Full state comes from `store.getLiveRenderState()`. Gestures use stable-ID revisioned patches; resync must preserve Live Scene identity. Preview and standalone output remain separate renderer clients and may intentionally run different Components unless instances are synchronized.

Transitions may prepare media before activation. Missing required media blacks out explicitly rather than flashing partial output. Numeric Live parameter truth updates immediately; interpolation stays renderer-local.

## Persistence and Media

- `project.json` stores canonical authored state, not generated thumbnails or cache artifacts.
- Each persisted Mapping owns its Surfaces and calibration. Runtime `state.surfaces` and `state.mappingCalibration` are transient renderer projections of the selected Mapping and are never serialized as competing authorities. Live `surfaceRoutes` are materialized transiently from the selected Scene and Mapping.
- Node persistence is a compact project diff, not a snapshot of the installed node system. Built-in definitions, package helper groups, generated flat instances, compiler hooks, control nodes, default wiring, and catalog artifacts are reconstructed from the installed libraries on load. Persist only version pins, project-local forks/special definitions, Component content topology, and explicitly authored graph edits. Untouched Scene/Application programs are derived and omitted.
- The current `mappertest` fixture compacts from 3.13 MB of JSON (5.0 MB formatted on disk) to 489 KB compact / 902 KB formatted. Save-load-save is byte-stable and preserves Component/Scene chains, Mapping presets, and Surface state. Its legacy embedded package definitions compact to zero; genuine project forks remain separately persisted.
- UI-only selection and recent-use changes remain pending instead of serializing the full project after every click. They join the next authored save or flush when Chrome hides, refreshes, closes, or the project is explicitly closed. Non-transactional checkpoints use a five-second quiet period; committed edits retain transaction/undo semantics.
- Derived assets live outside canonical state; model artifacts use versioned entries under `vj1-cache/models`.
- Undo records completed user transactions, not selection, metrics, thumbnails, or scrub samples.
- Never scan `revisions` or `vj1-cache` during media discovery.
- Media, decoded images, video, capture streams, parsed meshes, and GPU resources are acquired by active leases and disposed through bounded runtimes.
- Screen sharing is explicitly user-started and session-owned; generators sample the registered stream.
- Browser capability and internal fallback paths should produce mini-console diagnostics. Current Chrome is the supported target.

## Important Files

- `js/domain/models.js`, `project-migrations.js`, `scene-routing.js`: canonical schema, Scene Frame configuration, and Mapping materialization.
- `js/control/*`, `style.css`: workspaces, inspectors, gestures, Live UI, diagnostics.
- `js/libraries/node-engine`, `composition-engine`, `visual-nodes`: node definitions and compiled programs.
- `js/output/output-renderer.js`: render orchestration and Component caching.
- `js/output/component-render-*`, `surface-render-planner.js`, `output-surface-runtime.js`: demand, intrinsic rendering, placement, and surface presentation.
- `js/output/render-draw-utils.js`, `shared-framebuffer-target.js`, `render-target-contract.js`: low-level target and orientation contracts.
- `js/output/specialized/specialized-source-runtime.js`: retained model/terrain/morph/specialized targets.
- `js/output/output-media-*`, `output-thumbnail-runtime.js`: media lifecycle and derived thumbnails.
- `js/services/project-folder-service.js`, `project-serializer.js`, `media-library-service.js`, `output-bridge-service.js`: storage and transport.
- `tests/*.test.mjs`: architecture and regression contracts.

## Handover Status

### Open regression notes

- Adding an ordinary Component to a Scene can currently make the placement inherit the Scene proportion instead of preserving the Component's intrinsic landscape, portrait, or square proportion. Treat this as a coordinate/placement contract bug: the Scene owns the relative placement and boundary, while the child Component must retain its own aspect. Do not paper over it with authored pixel width/height or a renderer-specific scaling exception.

### Architecture audit

- The canonical ownership chain is sound: Components own intrinsic visual logic; Scenes arrange Components; Frames expose relative Scene views; Mappings assign Frames to physical Surfaces; Output presents the selected Mapping. Runtime route materialization is derived rather than a second persisted authority.
- Frame content fit and Surface projection fit are separate, necessary stages. Direct routes compose both in the existing mapper shader; raster-required routes apply Frame fit while filling the already-required Surface target and then apply Surface fit during projection. There is no Frame buffer and no new ping-pong pair.
- Live and Output use the same renderer and surface runtime. Transitions use the existing two retained transition textures; their former route-alias bug is fixed by planning the previous state's already-materialized Surfaces rather than recompiling or reading the target Mapping program.
- The obsolete node-style `control/mapping-view.js` parallel UI was removed. The active Mapping presentation is `mapping-live-view.js` plus the generic embedded preview host.
- Component, Scene, Mapping, and Live now share one embedded preview-host contract: one fixed p5 canvas fills the measured HTML stage, while renderer mode changes content semantics only. Frame, World, Manual, wheel, and +/- navigation use the same controller in all four workspaces; their zoom/pan is applied once as a final p5 presentation transform inside the fixed canvas, with inverse pointer mapping, rather than resizing the canvas element in CSS. The independent viewport states persist in `project.json`. Embedded render demand applies that same transform to authored Surface corners and clips demand to the fixed p5 viewport before allocating source textures; off-canvas pixels are not rendered. Standalone Output preserves its full projection request. This changes allocation only and adds no framebuffer, pass, readback, or ping-pong target. Do not restore per-mode canvas sizing or add viewport-specific render buffers.
- Component and Frame editing handles counter-scale against the final preview viewport transform. Their visible dimensions and hit radii stay constant while zoom changes only the artwork and authored geometry.
- Embedded HUD resolution reports the largest final content request presented by the preview render chain, including its effective quality density. At 1:1 fit, a Good preview occupying `W×H` visible pixels should therefore report a `2W×2H @2x` target. Standalone Output continues to report its GPU drawing buffer. Lower-level intermediate targets remain performance diagnostics. The temporary detailed HUD markup remains dormant in `previewDiagnosticHudMarkup()`, and the cyan p5 bounds, green diagonal, and magenta CSS bounds remain dormant in `drawPreviewGeometryDiagnostics()` for future geometry investigations; neither helper is called by the normal preview path.
- Remaining risk is concentrated in intrinsic child placement, recorded above. Do not compensate for it inside shader aspect math or with per-mode rendering buffers.

- Current uncommitted work includes the Scene/Mapping migration plus the earlier parsed STL/OBJ shared target, direct-frame cleanup, quiet routine model-cache diagnostics, lower-frequency/lifecycle-aware autosave, compact node-project persistence, and ISF integration.
- Scene/Mapping migration is canonical throughout current state, persistence, workspace selection, UI events, clipboard routing, node/compiler identities, renderer helper names, and CSS selectors. Legacy names are confined to migrations and literal browser canvas APIs. Live lists Scenes; Surfaces select only Frame slots; each Scene owns per-Frame Component/fit; every Mapping owns an independent set of complete Surfaces plus calibration; Mapping cards have no thumbnails. Alpha-era direct Component routes in old Mapping presets may be discarded in favor of Frame-slot routing.
- The migration adds no framebuffer, ping-pong pair, readback, or generic per-frame node traversal. Direct routes compose Frame fit and Surface fit in the existing mapper shader; raster-required routes use the existing Surface target.
- Scene editing now keeps the p5 canvas as the full project-world host and fits the Scene inside the established world margin. User Frames retain enlarged border/corner hit targets; inactive Frames are thin translucent guides. Derived Output Frames remain selectable but locked, follow configured Output proportions, and deliberately show no resize handles.
- Last full automated run before the final internal viewport/demand patch passed **848/848**. The latest patch was not rerun at the user's request. File-backed nodes may be unresolved between the lightweight project snapshot and asset scan: UI and rendering treat them as pending/dynamic, and graph compilation temporarily represents a pending source as transparent or a pending effect as pass-through. Their IDs never enter the strict built-in catalog and the temporary result is never cached as stable; the same graph activates when asset definitions arrive. The real `mappertest` project also passes an in-memory compact save/load/save equivalence check.
- Latest changes were not browser-tested, following the user's request. The user should reload and verify that the skull appears normally without repeated `glCopySubTextureCHROMIUM` errors. If `VJ1_MODEL_SHARED_RENDER_FAILED` appears, inspect the raw mesh renderer against `SharedFramebufferTarget` rather than restoring a cross-context canvas upload.
- Routine model cache-hit/write and LOD-ready success events are intentionally silent; cache failures, non-manifold topology, and simplification limits remain diagnostic warnings.
- `VJ1_AUTOSAVE_PREPARE_SLOW` should no longer follow ordinary Component selection. Lifecycle writes are best-effort because Chrome cannot guarantee completion of asynchronous folder writes after shutdown begins; normal committed autosaves remain the crash-safety boundary.
- Preserve unrelated user work and avoid broad reversions.

## Verification

From `experiments/vj1`:

```sh
npm test
npm run test:metrics
npm run test:render
git diff --check
```

Update browser module query strings when changing cached modules. Keep performance verification focused on draw count, retained-target count, decoded-frame invalidation, cross-context uploads, and full-resolution readbacks.
