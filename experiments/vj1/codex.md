# VJ1 Handover Brief

Updated: 2026-07-21

VJ1 is a build-free browser VJ and projection-mapping application in `experiments/vj1`. It targets current Chrome with a capable GPU. p5 remains the browser/media host, while frame-critical rendering increasingly uses raw WebGL and shared p5 framebuffers. The user-selected project folder and its `project.json` are authoritative.

## Product Model

- **Component**: reusable ordered chain of sources, effects, and isolated Groups.
- **Canvas**: a Component using the same chain model, with relative placement of other Components and shared recording-frame crops.
- **Scene**: routes Components, whole Canvases, or Canvas recording frames to direct or mapped surfaces.
- **Live**: selects the on-air Scene and applies temporary overrides without changing authored state.
- **Output**: renders the Live Scene in an embedded preview or standalone output window from the same canonical render state.

Project schema is version **26**. Persisted format changes require one adjacent migration in `domain/project-migrations.js` plus focused tests. Do not restore obsolete parallel authorities such as `component.source`, `component.shaderChain`, Canvas `layers`, per-surface pixel crops, or chain-level source params.

## Architecture and Library Boundaries

The application root (`app.js`, state, controllers, output hosts, services) configures focused libraries under `js/libraries`:

- `node-engine`: typed/versioned node definitions, ports, groups, packages, forks, and editable parts.
- `composition-engine`: compiled Component, Canvas, Scene, surface-route, and application programs.
- `render-engine`: relative geometry, render views, and ROI contracts.
- `mapping-engine`: surface homography, source fit, feathering, and projection sampling.
- `cache-engine`: retained render-target and signature caches.
- `media-engine`: media/input lifecycle contracts.
- `mesh-engine`: STL/OBJ parsers, format detection, mesh preparation/resolution, mesh rendering, and file-to-image groups.
- `image-engine`: reusable image operations such as resize.
- `control-engine`, `data-store`, `state-engine`, `storage-engine`, `synchronization-engine`, `timing-engine`, and `diagnostics-engine`: non-render infrastructure.
- `visual-nodes`: one folder per generator/effect with metadata, editable JavaScript, shaders, and runtime parts where applicable.

Nodes are real implementations, not decorative wrappers. Code, shader, parser, and group nodes own their editable algorithms. Optimized hosts may call the same exported implementation directly without allocating a generic NodeInstance or traversing packets each frame. Do not replace the current allocation-stable renderer with generic per-frame graph traversal. Compiler/custom-node boundaries are preferred when a relationship needs specialization.

## Render Pipeline

```text
canonical state
  -> compiled visible Scene routes
  -> shared Component/Canvas demand
  -> retained source/effect textures
  -> optional group/effect/transition materialization
  -> frame crop + fit + mapping + feather
  -> embedded or standalone output
```

Only visible dependencies render. Static nodes are signature-cached; dynamic nodes invalidate on their real time/media revision. Synchronized instances reuse eligible Component results. Recording frames are texture views into one parent Canvas, not separate full-Canvas renders.

Important invariants:

- `ui.live.selectedSceneId` is the only on-air Scene authority. Editor selection must never become an output fallback.
- Components render intrinsic textures. Parent transforms place them on Canvas, surfaces, and Live.
- Boundaries and content transforms are separate: the boundary owns placement, rotation, and clipping; content transform moves/scales the image or procedural domain inside it.
- Geometry is relative and resolution-independent. Pixel dimensions are derived from host viewport, output proportions, quality, density, and visible demand.
- ROI changes allocation/sampling only; it must not recenter, squeeze, or change generator/effect math.
- Chain coordinates are screen-like: positive X right, positive Y down, positive rotation clockwise.
- Premultiplied alpha is the render contract.
- `cover`, `contain`, and `stretch` are explicit route choices and must retain their normal meanings.
- Avoid extra WebGL contexts, pixel readbacks, resizable cross-context canvas uploads, and unnecessary ping-pong buffers.
- No silent media/render fallback. Emit structured `VJ1_*` diagnostics.

Effects remain sequential. Shader fusion, direct placement, retained framebuffers, specialized model/terrain paths, and cache reuse must survive node-system work. Do not force optimized paths into a pure generic traversal when a compiled direct node or custom renderer is healthier.

## Current Render and Performance State

The latest committed baseline is `b3de46e2`. It contains the recent browser/video/cache/diagnostic work and the direct recording-frame correction.

### Direct recording-frame presentation

p5's source-rectangle `image()` path could trigger:

`GL_INVALID_VALUE: glCopySubTextureCHROMIUM: Negative offset`

Direct recording-frame routes now sample the parent Canvas through the existing mapping shader. This preserves fit semantics and remains one GPU draw. It adds no surface buffer, readback, or ping-pong pass. Crop bounds are normalized once by the mapper; a redundant outer clamp was removed after audit.

### Parsed STL/OBJ presentation

The same Chromium error was later confirmed in Canvas view when a cached STL became ready. The cache was not corrupt: readiness merely activated a per-frame upload from a separate p5 WebGL canvas.

The current worktree routes parsed STL/OBJ raw rendering into one retained shared-context depth framebuffer (`modelRaw`). The existing mesh renderer, transforms, LOD selection, QEM cache, and final presentation draw are unchanged. The cross-context texture upload is removed; no new pass or ping-pong pair is introduced.

For STL/OBJ-only use, target count remains one. If parsed meshes and procedural/imported p5 models are both used, `modelRaw` and the legacy p5 `model` scratch target can coexist. This is the only possible memory increase and is deliberate: sharing the incompatible target recreated the GPU fault. Both targets are retained, resized, reused, and disposed by `SpecializedSourceRuntime`. A failure emits `VJ1_MODEL_SHARED_RENDER_FAILED` once.

### Video and retained caching

Modern video elements use decoded-frame callbacks to advance a revision; cached Components invalidate only for presented frames rather than every renderer tick. A cached video Component renews its media lease so playback does not pause after its first retained frame. This is separate from the STL fix and is intended to reduce duplicate work.

### Thumbnails

Component, Canvas, recording-frame, and Scene thumbnails use stale-while-revalidate behavior. The last valid thumbnail stays visible until a replacement succeeds. Capture is serialized, idle/gesture-aware, GPU-downsampled before its small readback, and disabled in standalone outputs. Do not clear thumbnails on a dirty flag.

## Scene, Live, and Output Semantics

Scene routes use stable `sourceNodeId` values. A whole Canvas and `Canvas · Frame N` are distinct source nodes. The recent apparent Live scaling fault was a valid narrow recording frame using `cover`, not a Canvas scale regression. No automatic `cover` to `contain` migration was added.

Control and outputs communicate through `BroadcastChannel("vj1-output-bridge")`. Full state comes from `store.getLiveRenderState()`. Gestures use stable-ID revisioned patches; resync must preserve Live Scene identity. Preview and standalone output remain separate renderer clients and may intentionally run different Components unless instances are synchronized.

Transitions may prepare media before activation. Missing required media blacks out explicitly rather than flashing partial output. Numeric Live parameter truth updates immediately; interpolation stays renderer-local.

## Persistence and Media

- `project.json` stores canonical authored state, not generated thumbnails or cache artifacts.
- Derived assets live outside canonical state; model artifacts use versioned entries under `vj1-cache/models`.
- Undo records completed user transactions, not selection, metrics, thumbnails, or scrub samples.
- Never scan `revisions` or `vj1-cache` during media discovery.
- Media, decoded images, video, capture streams, parsed meshes, and GPU resources are acquired by active leases and disposed through bounded runtimes.
- Screen sharing is explicitly user-started and session-owned; generators sample the registered stream.
- Browser capability and internal fallback paths should produce mini-console diagnostics. Current Chrome is the supported target.

## Important Files

- `js/domain/models.js`, `project-migrations.js`, `scene-routing.js`: canonical schema and routing.
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

- Current uncommitted implementation changes are limited to the parsed STL/OBJ shared target, its cache-bust import, the redundant direct-frame clamp removal, and focused tests.
- Targeted render/model/surface suites pass: **167/167** after the latest cleanup.
- Latest changes were not browser-tested, following the user's request. The user should reload and verify that the skull appears normally without repeated `glCopySubTextureCHROMIUM` errors. If `VJ1_MODEL_SHARED_RENDER_FAILED` appears, inspect the raw mesh renderer against `SharedFramebufferTarget` rather than restoring a cross-context canvas upload.
- Repeated `VJ1_MODEL_CACHE_HIT`/`VJ1_MODEL_LOD_READY` entries may reflect separate preview/output renderer clients; they do not by themselves indicate mesh recomputation.
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
