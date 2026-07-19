# VJ1 Handover

Updated: 2026-07-19

VJ1 is a build-free browser VJ and projection-mapping app in `experiments/vj1`. It uses p5 as the host/media compatibility layer and raw WebGL for the render pipeline. The user-selected project folder is authoritative.

## Product and Data Model

- **Components** are reusable sequential visual chains.
- **Canvas** uses the same chain model and may place Components in a larger logical frame.
- **Scenes** route Components, Canvases, or Canvas recording frames to surfaces.
- **Live** selects the program Scene and applies temporary performance overrides.

`component.chain` is the only Component/Canvas graph authority. Items are sources, effects, or isolated Groups. Do not restore `component.source`, `component.shaderChain`, chain-level source params, or silent Test Pattern/black fallbacks. Current project schema is version **19**; format changes require one adjacent migration and focused tests.

Scene routes use `surface.sourceNodeId`. An empty route is intentionally empty. `recordingFrames` is a shared project registry and frames remain Canvas-logical crops.

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
- Large images decode toward render demand. Import/catalog presence must not decode full media.
- Media snapshots sent to outputs are authoritative, including an empty list.
- Missing required media blacks out output and reports loading/failure explicitly.

## Main Files

- `js/app.js`, `js/app-state.js`, `js/domain/models.js`: startup, state, normalization, Live render state.
- `js/domain/project-migrations.js`, `scene-routing.js`, `change-event.js`: schema, routing, transaction classification.
- `js/control/*`, `style.css`: workspaces, inspectors, gestures, modals, shared UI.
- `js/graph/*`: chain compilation and scheduling.
- `js/output/output-renderer.js`: render orchestration.
- `js/output/component-render-*`, `surface-render-planner.js`, `output-surface-runtime.js`: intrinsic Component rendering and parent placement.
- `js/output/embedded-preview-app.js`, `output-app.js`: preview/output lifecycle and Scene transitions.
- `js/output/output-media-*`, `specialized/*`: media leases, readiness, models, terrain, morph, and specialized generators.
- `js/services/project-folder-service.js`, `project-serializer.js`, `media-library-service.js`, `output-bridge-service.js`: persistence and transport.
- `tests/*.test.mjs`: contract and regression tests.

## Current State and Next Checks

- Full Node suite: **564 passing** on 2026-07-19.
- Latest changes were not browser-tested, by request.
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
