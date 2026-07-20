# VJ1 Handover

Updated: 2026-07-20

VJ1 is a build-free browser VJ and projection-mapping app in `experiments/vj1`. It uses p5 as the host/media compatibility layer and raw WebGL for the render pipeline. The user-selected project folder is authoritative.

## Product and Data Model

- **Components** are reusable sequential visual chains.
- **Canvas** uses the same chain model and may place Components in a larger logical frame.
- **Scenes** route Components, Canvases, or Canvas recording frames to surfaces.
- **Live** selects the program Scene and applies temporary performance overrides.

Persisted Component/Canvas groups in `state.nodes` are the visual graph authority. `component.chain` is the materialized in-memory UI projection and compatibility shape; new saves do not persist it when a compiled group exists. Items remain sources, effects, or isolated Groups. Do not restore `component.source`, `component.shaderChain`, chain-level source params, or silent Test Pattern/black fallbacks. Current project schema is version **24**; format changes require one adjacent migration and focused tests.

Visual node graphs compile through the custom Component visual compiler into the existing allocation-stable direct renderer. Do not replace this with generic per-frame packet traversal. Preserve shader fusion, shared framebuffer targets, retained caches, specialized STL/model/terrain paths, and current resource reuse. If a visual relationship requires specialization, keep it behind a compiler/custom node boundary rather than introducing avoidable ping-pong buffers. Call-driven graph execution is for control, data, and utility groups. The generic Visual Source node owns source-family dispatch (`component`, `media`, `camera`, `black`, or `generator`) as compiled renderer metadata; the output host supplies the existing resource-specific methods. Direct placement and media/model cache decisions remain on their established optimized paths.

Scene and Output groups compile authored connections into setup-time reachability; their generated nodes stay synchronized with project structure. Native generators compile a node-owned renderer ID into the visual render plan, and the output host resolves that ID through one specialized renderer registry rather than branching on generator names. Test Pattern, Checker, and Black go further: their editable multi-part JavaScript algorithms live in their node modules, compile to a direct node process, and draw into the existing source target. Project-local JavaScript forks replace that compiled process without adding a scheduler, graph traversal, or intermediate buffer.

Text now owns its editable layout/mask JavaScript and vertex/fragment shader parts in its node folder. The compiled node module supplies those algorithms to the existing specialized host, which retains only browser/GPU resource duties: the bounded mask cache, p5 image conversion, shader object, and existing render target. Helper or shader forks change the module revision, invalidate the relevant retained cache, and reuse the same single shader pass; no extra target, traversal, or per-frame node packet was introduced. Runtime-only module exports are deliberately excluded from serialized packages and are reconstructed from the package's editable JavaScript parts during installation.

Terrain now owns its editable CPU mesh/topology module and all four surface/wire GLSL parts in the Terrain Flyover node folder. The specialized WebGL host consumes the compiler-supplied helpers and shaders while retaining the existing shared framebuffer, two programs, and GPU buffers. JavaScript and shader revisions are tracked separately: topology edits invalidate the existing mesh buffer keys, while shader edits recreate only the corresponding retained programs. Neither path adds a render pass, target, graph traversal, or frame-local packet. `output/specialized/terrain-mesh.js` is compatibility re-export only.

Tile Texture owns its editable repeat-axis JavaScript helper and vertex/fragment GLSL in its node folder. The specialized host still owns the selected-image media lease, existing shared target, and one retained p5 shader object. Project forks supply the compiled helper and shader parts; only a changed Tile Texture program revision recreates the retained shader. `output/specialized/tile-texture-shader.js` is compatibility re-export only.

2D Mesh Patterns owns its complete deterministic topology engine, palette algorithm, and four raw-GLSL stages in its node folder. All ten geometry families, signatures, seeded construction, Voronoi, marching squares, flow integration, and truss solving compile as one editable JavaScript module; palette and fill/wire programs are independently editable parts. `output/specialized/mesh-pattern-algorithms.js` is compatibility re-export only. The raw-WebGL host invokes compiler-supplied modules while retaining the existing bounded CPU topology cache, GPU buffers, linked programs, and draw passes. Node-code revision is part of topology cache identity. Shader edits replace the two small programs while explicitly preserving retained topology buffers; no traversal or render buffers were added.

Low Poly Anatomy owns its complete procedural geometry implementation as one editable JavaScript module: face, body, hand, arm, leg, heart, tapered/path/profile volumes, ring caching, mesh emission, materials, and part fit. `output/specialized/anatomy-renderer.js` is compatibility re-export only. The specialized host invokes the compiled node functions directly while retaining camera, transform, quality scaling, lighting, target reuse, GPU timing, and presentation. Project forks therefore change actual procedural construction rather than wrapping a hidden host algorithm.

Screen Share is a direct compiled node process. It owns input selection behavior, availability decisions, fit policy, mirroring, and sampling calls. The output host injects stable capture/media capabilities once per compiled operation and retains the user-authorized sharing session, source registry, diagnostics presentation, and media bridge. This keeps security/session state out of the node while making the visible generator behavior editable; no frame-local capability wrappers are allocated.

Every catalog generator routed through a native renderer now has editable executable JavaScript in its node definition. An architecture contract enumerates native generators and rejects future host-only entries. Native rendering still means a compiler-selected optimized host capability, not a generic per-frame node scheduler.

STL and OBJ parsing are owned by their respective editable parser nodes, including both full-fidelity and bounded-preview algorithms. `Parse 3D Object` routes format detection into those nodes; `Prepare 3D Asset` adds the mesh-resolution node; `Convert 3D File to Image` composes preparation, the shared mesh-render node, and optional bounded image resize. Thumbnail mode selects the parser nodes' bounded reservoir/sampling policy before mesh allocation and skips QEM/LOD generation, while live imports retain full parsing and cached meshoptimizer processing. `mesh-preview-renderer.js` contains only SVG projection plus compatibility re-exports—there is no second hidden parser. These utility groups execute only when called and do not participate in per-frame graph traversal or add render targets.

Cache, media-input lifecycle, diagnostics, state-command, serialized-storage, live-patch synchronization, format detection, mesh resolution, and timing nodes now expose linked multi-part JavaScript process entries. They can own state when run as ordinary nodes, while optimized hosts directly reuse the exact same exported classes/functions without NodeInstance allocation in frame-critical paths. An application-catalog contract compiles every editable `code` node and rejects displayed JavaScript that is not linked to execution. Surface Composition and Visual Node Definition are the deliberate exceptions: they are explicitly native, read-only compiler adapters because their execution depends on retained host/compiler capabilities rather than portable node code.

Feature Morph and Feature Morph V2 each own their editable image-fit helper, analysis module, and vertex/fragment program in separate node folders. Feature Morph owns SuperPoint descriptor matching, triangulation, and displacement-field construction; `output/specialized/feature-morph-field.js` is compatibility re-export only. Feature Morph V2 owns MobileNet semantic matching, coherent flow-grid construction, and rigid/elastic MLS field generation. The service hosts keep model/CDN loading, serialized inference, slider debounce, async progress, image-feature reuse, and bounded persistent caching, but invoke compiler-supplied node algorithms. Node JavaScript revisions participate in analysis-cache identity, so an algorithm fork produces one new asynchronous field without affecting render traversal. The specialized render host retains the existing flow-field images, media leases, separate shared targets, and one shader object per variant. A changed shader-program revision recreates only that variant's retained shader. `output/specialized/feature-morph-shader.js` is compatibility re-export only.

Application service dependencies are separate `service` wires with `phase: "setup"`; `ApplicationProgramRuntime` compiles those wires before constructing services. The authored `state.snapshot → live.state` and `state.snapshot → storage.value` routes are also executable and editable. They dispatch through a bootstrap-time route index only when the store changes; the Application-created bridge deliberately has no hidden parallel store subscription. Service and state changes activate on reload through a preflight read of the stored project. Invalid graphs enter an explicit recoverable built-in safe mode. Remaining cross-process/media/cache/output runtime routes are visible but compiler-locked until their host contracts are mature.

Node packages use format version 2 and can carry definitions, artifacts, reusable persisted group topology, project-local forks, and executable node-migration source. Group and fork references to nodes outside the package become explicit version requirements. Runtime and project installation preflight requirements and collisions before mutation; identical installs are idempotent. Project installation can explicitly rebase existing forks onto newer packaged definitions through compatibility checks and migrations; it never upgrades forks silently. Format-1 definition/artifact packages import through the additive format migration. The VJ1 composition root exposes project package creation, export, and installation without putting package work in the render path.

Every chain item shares one General contract: `opacity`, `blend`, and `transform`. An authored `params.amount` is algorithm-specific strength, never a second compositing-opacity authority.

Media-source parameters have one type-aware schema shared by Component, Canvas, Live, and significant controls. Do not hand-author parallel inspector control lists.

Scene routes use `surface.sourceNodeId`. An empty route is intentionally empty. `recordingFrames` is a shared project registry and frames remain Canvas-logical crops.

Catalog markers are shared authored metadata (`none → star → heart → pin`). Only pins stay first under every ordering; Scene ordering and surface-source ordering have separate UI sort preferences.

## Critical Invariants

- `ui.live.selectedSceneId` is the only program/output Scene authority.
- `ui.selectedSceneId` is editor selection and must never become an output, recovery, transition, or Live-preview fallback.
- Persistent edits may update Components used by Live but may not change the Live Scene.
- A Component renders an intrinsic full-frame texture. Its root transform is parent-owned placement on Canvas, Scene surfaces, and Live—not baked into that texture.
- Chain transforms use screen coordinates: positive X right, positive Y down, positive rotation clockwise.
- Groups precompose their transform into descendants and isolate blend/opacity.
- Logical frame, physical raster demand, preview zoom, and projection geometry are separate concerns.
- Premultiplied alpha is the render contract.
- Output and embedded preview must consume the same canonical render state.
- No silent render/media fallbacks: emit structured `VJ1_*` diagnostics when a path fails.

## Render Architecture

```text
state -> visible route demand -> Component/Canvas textures
      -> optional materialization for effects/groups/transitions
      -> surface fit + mapping + feather -> output
```

Only visible dependencies render. Static nodes are signature-cached; dynamic nodes invalidate as needed. Recording frames are views into one parent Canvas texture. Raw WebGL stages consume explicit logical/physical target metadata from `render-target-contract.js`; coordinate conversion belongs in `content-coordinate-space.js`.

p5 should not own coordinate, orientation, sizing, placement, or cache policy. Avoid extra WebGL contexts, per-frame buffers, pixel readbacks, and cross-context resizable canvas uploads.

Component and Canvas thumbnails use a derived-asset, stale-while-revalidate pipeline. State changes invalidate the selected item and a latest-wins coordinator waits for the gesture/quiet boundary; the last successful thumbnail remains published throughout dirty, retry, readback, and encoding states. Capture is disabled during direct preview pointer gestures and is never run by standalone output renderers. One retained thumbnail-sized framebuffer downsamples the current component texture in the existing WebGL context before the only GPU readback, so a 4K source no longer causes a full-resolution CPU transfer. Jobs are serialized and idle-scheduled, WebP/PNG encoding uses asynchronous `toBlob`, persistence accepts the Blob directly, and the UI publishes a short object URL through a targeted Component-state update. Obsolete jobs cannot replace newer state, Canvas frame crops use the same coordinator, and failed/not-ready captures retain the prior image and retry without leaving the catalog item blank. Cache-bust tag: `thumbnail-pipeline-1`.

STL/OBJ processing runs off-thread through meshoptimizer QEM and writes versioned artifacts to `vj1-cache/models`. Parsed and GPU resources are leased and evicted by the media runtime. Model thumbnails use a bounded lightweight sample and must not trigger full LOD generation.

## Live and Output Transport

Control and outputs use `BroadcastChannel("vj1-output-bridge")`. Full Live state comes from `store.getLiveRenderState()`. Parameter gestures use stable-ID revisioned patches; a patch or resync must preserve the explicit Live Scene identity.

The latest fix removed editor-Scene fallbacks from popup output, embedded Live preview, and Live render-state construction. Regression tests cover editing a Component while another Scene is on air. Cache-bust tag: `live-scene-authority-1`.

Scene transition duration and parameter fade are independent. Numeric Live values update user truth immediately; interpolation is renderer-local. Media preparation may delay a timed transition, but must not substitute a different Scene.

## Persistence and Media

- `project.json` stores canonical authored state; thumbnails and derived assets do not belong in it.
- Undo records completed user transactions, not UI selection, metrics, thumbnails, or scrub samples.
- Never scan `revisions` or `vj1-cache` during media discovery.
- Images, video, camera, STL, OBJ, renditions, and GPU resources are acquired only by active render leases and disposed through the shared bounded runtime.
- Screen sharing is the explicit exception: Settings owns one user-started session capture until Stop/page exit; `Screen Share` generators only sample its live native-size frame, including from same-origin output windows.
- Large images decode toward render demand. Import/catalog presence must not decode full media.
- Media snapshots sent to outputs are authoritative, including an empty list.
- Missing required media blacks out output and reports loading/failure explicitly.

## Main Files

- `js/app.js`, `js/app-state.js`, `js/domain/models.js`: startup, state, normalization, Live render state.
- `js/domain/project-migrations.js`, `scene-routing.js`, `change-event.js`: schema, routing, transaction classification.
- `js/control/*`, `style.css`: workspaces, inspectors, gestures, modals, shared UI; the shell delegates project-rail presentation, diagnostics, and profiling session ownership to focused controllers.
- `js/graph/*`: chain compilation and scheduling.
- `js/output/output-renderer.js`: render orchestration.
- `js/output/component-render-*`, `surface-render-planner.js`, `output-surface-runtime.js`: intrinsic Component rendering and parent placement.
- `js/output/output-render-cache.js`, `output-render-profile.js`, `shader-target-runtime.js`: bounded render-target caching, sampled CPU attribution, and low-level shader-target operations.
- `js/output/embedded-preview-app.js`, `output-app.js`: preview/output lifecycle and Scene transitions.
- `js/output/output-media-*`, `specialized/*`: media leases, readiness, models, terrain, morph, and specialized generators.
- `js/services/project-folder-service.js`, `project-history-store.js`, `project-derived-asset-store.js`, `project-serializer.js`, `media-library-service.js`, `output-bridge-service.js`: folder lifecycle, bounded history, derived rendition/thumbnail storage, serialization, and transport.
- `tests/*.test.mjs`: contract and regression tests.

## Current State and Next Checks

- Full Node suite: **758 passing** on 2026-07-20. Metrics (**10**) and render-geometry (**12**) suites also pass.
- Latest changes were not browser-tested, by request.
- Live parameters were manually confirmed working continuously by the user after the transport fix.
- Current browser cache-bust tag for control/application and thumbnail capture: `thumbnail-pipeline-1`; render/compiler-specialized path: `node-program-hooks-15`; visual catalog path: `node-catalog-13`.
- First manual check: keep Scene A live, open/edit a Component associated with Scene B, move several sliders, and confirm embedded Live preview and popup output remain on Scene A.
- If a Scene still changes, inspect `VJ1_LIVE_PATCH_RESYNC`, transport revision/session metadata, and the explicit `ui.live.selectedSceneId`; do not add another fallback.
- The worktree contains substantial ongoing user work. Preserve unrelated edits and avoid broad reversions.

## Verification

From `experiments/vj1`:

```sh
npm test
npm run test:metrics
npm run test:render
git diff --check
```

Update browser module query strings whenever a changed module would otherwise retain an old cached URL.
