# VJ1 Handover Brief

Updated: 2026-07-22

VJ1 is a build-free browser VJ and projection-mapping application in `experiments/vj1`. It targets current Chrome with a capable GPU. p5 remains the browser/media host, while frame-critical work uses retained WebGL targets and specialized renderers. The user-selected folder and its `project.json` are authoritative. Current project schema is **30**.

## Product and Ownership Model

- **Component**: reusable visual chain of media, generators, effects, nested Components, and Groups.
- **Scene**: a spatial Component composition. It owns visual content, not projection geometry.
- **Mapping**: an authored collection of Surfaces and calibration. Different Mappings may contain different Surfaces.
- **Surface**: one identity represented as a relative 2D rectangle in Scene view and a projected quad/destination in Mapping view. There is no separate Frame model.
- **Live**: a transient source program. It selects an Overall Scene/Component and may patch or hide individual Surfaces.
- **Output**: the compiled Mapping program rendered in the embedded preview or a standalone output window.

The central ownership rule is:

```text
Component/Scene content + Mapping Surface geometry + Live route choices
                         -> compiled Surface routes -> Output
```

`mapping.surfaces` contains authored geometry, calibration-facing properties, ordering, destination, fit, feather, visibility defaults, and identity. `state.surfaces` is the selected renderer projection: it may additionally contain derived source bindings such as `sourceNodeId`, `componentId`, crop, and source-fit data. `ui.live.surfaceRoutes` and transition snapshots are transient route programs. Never persist derived bindings into a Mapping or create a parallel per-Scene Surface table.

Old projects are migrated on load. Do not restore runtime compatibility branches for the removed Canvas/Frame models; migration code is their only proper home.

## Libraries and Node Architecture

The application root configures libraries under `js/libraries`:

- `node-engine`: typed/versioned nodes, ports, groups, packages, forks, and editable parts.
- `composition-engine`: Component, Scene, Mapping, Surface-route, Output, and application compilers.
- `render-engine`: relative geometry, render views, and ROI contracts.
- `mapping-engine`: projection sampling, homography, fit, and feathering.
- `cache-engine`: retained render-target and signature caches.
- `media-engine`, `image-engine`, `mesh-engine`, `isf-engine`, and `procedural-2d`: reusable media and visual algorithms.
- `state-engine`, `storage-engine`, `synchronization-engine`, `timing-engine`, `diagnostics-engine`, `control-engine`, and `data-store`: infrastructure.
- `visual-nodes`: one folder per generator/effect with its metadata, editable code/shaders, and runtime parts.

Nodes own real algorithms, not decorative wrappers. The graph is primarily an authored and inspectable program plus a compiler boundary. Optimized hosts may execute compiled node implementations directly; the renderer must not allocate generic packets or traverse a dynamic object graph every frame. Specialized shader fusion, retained targets, mesh renderers, media leases, and required ping-pong passes remain valid node host implementations.

## Render Pipeline and Invariants

```text
canonical state
  -> materialize selected Scene/Live routes over selected Mapping
  -> compile reachable Surface/source graph
  -> plan visible Component and media demand
  -> render/reuse retained Component textures
  -> optional effect/group/transition materialization
  -> fit + Surface projection + feather + blend
  -> preview or standalone Output
```

Keep these contracts intact:

- Geometry is relative. Pixel sizes are derived from the actual host, quality, density, visible footprint, content scale, and source detail demand.
- A Surface is the geometry authority at both transition endpoints. A transition snapshot owns previous source bindings only.
- Boundary transform and content transform are separate. Boundary controls placement, rotation, clipping, and allocation; content transform moves/scales the visual domain inside it.
- ROI reduces allocation and sampling only. It must not recenter or squeeze generator/effect math.
- Buffer size follows the visible boundary footprint. Source detail follows physical backing demand and content scale. Offscreen boundary areas allocate nothing.
- `cover`, `contain`, and `stretch` are explicit presentation choices. Do not silently substitute one to compensate for incorrect aspect math.
- Premultiplied alpha is the render contract.
- Avoid pixel readbacks, resizable cross-context canvas uploads, extra WebGL contexts, and new full-frame or ping-pong targets unless an algorithm genuinely requires them.
- Static Components are signature-cached; dynamic Components invalidate only for real time/media changes. Eligible synchronized clients should share results rather than rerendering the full chain.
- Preview and standalone Output are separate renderer clients but consume the same compiled Surface contract.

Mapping preview and its Test Pattern no longer rewrite Mapping data. Runtime source nodes are bound to the authored Mapping graph by `mapping-program-compiler.js`; authored reachability and Surface order remain intact. This compiler boundary is the intended way to combine stable topology with changing preview/Live source assignments.

## Live, Mapping, and Transitions

Overall Live selection materializes a Scene across the Mapping Surfaces. An ordinary Component selected Overall behaves as a virtual Scene and covers the shared Scene space before each Surface samples it. An individual Surface patch assigns the complete selected Scene/Component to only that Surface through the Surface's presentation fit. Clearing a patch restores Overall routing without changing the Mapping.

Direct outputs have a group route (`Full surface`) and per-output children. Current precedence is materialized centrally in `scene-routing.js`: an explicit group patch suppresses unpatched children, while explicitly patched children override their own output. This is route policy, not UI state.

Transitions use the current Surface geometry for both endpoints. `rebaseSurfaceRouteProgram()` combines current authored geometry with previous source bindings. Focused model tests confirm identical Overall monitor placement and identical per-Surface endpoint geometry.

### Transition presentation contract

Ordinary Surface transitions now reuse the stable prepared view contract: source texture, normalized source rectangle, source fit, logical aspect, projection fit, and opacity. Each endpoint retains its own `contain`/`cover` mapping throughout the blend, so the transition no longer substitutes `stretch` and then snaps back to the stable presentation.

Complex routes that require transforms, final shaders, or thumbnail fallback still use retained endpoint textures. Their source-fit stage is already flattened into those textures, while the Surface projection-fit stage remains in the mapper. Unchanged Surfaces stay on the exact stable path. This adds no full-frame pass, ping-pong pair, or new buffer; ordinary changing routes now avoid the former per-Surface transition-buffer allocation.

## Persistence, Transport, and Derived Data

- `project.json` stores canonical authored state and compact project node diffs, not installed node libraries, generated instances, thumbnails, or runtime route bindings.
- Component and per-Surface thumbnails are derived assets in the cache. The last valid thumbnail stays visible until replacement succeeds.
- `project-serializer.js` and model normalization use the same `authoredSurfaceFields()` contract, preventing preview/Live bindings from leaking into saved Mappings.
- Output clients receive full recovery state plus revisioned live patches. High-frequency gestures are latest-value coalesced; do not add a second Mapping-specific protocol or an unbounded patch queue.
- Autosave is quiet-period and lifecycle aware. Browser shutdown writes are best effort; committed autosave remains the crash-safety boundary.
- Media, screen capture, video, parsed models, images, and GPU objects are lease-owned and must be disposed through bounded runtimes.
- ISF source files remain file-backed node definitions. Scalar inputs are ordinary params. Multi-image ISF remains intentionally inactive until graph-level multi-input placement is implemented.

## Cleanup Completed in the Current Worktree

- Removed derived runtime source bindings from Mapping mutations in Mapping preview, Live, transition, and monitor-state construction.
- Added one shared authored/derived Surface-field contract used by normalization and serialization.
- Moved changing preview/Live source binding to the Mapping program compiler while preserving authored graph reachability.
- Rebased transition snapshots onto current Surface geometry rather than letting old route geometry survive.
- Removed the obsolete runtime `(outputIndex, width, height)` output-construction signature; pixel dimensions are now derived only at the host boundary.
- Removed Scene-thumbnail reconstruction from nested Component thumbnails. Scene thumbnails now use only the last authoritative Scene snapshot, so a dirty thumbnail cannot invent a partial composition.
- Updated focused Scene/Mapping/routing/storage tests to the Surface-only schema.
- Updated visible node descriptions away from the removed Frame concept where it is safe to do so.
- Preserved the direct optimized renderer. This cleanup adds no framebuffer, readback, render pass, or ping-pong pair.

## Unresolved Architecture Decisions

1. **Transition presentation verification — high priority.** Manually verify `contain` and `cover` at transition start, midpoint, and end in both embedded preview and output windows, including ordinary direct routes and complex buffered fallback routes.

2. **Direct-output hierarchy.** Group/child precedence currently derives hierarchy from `destination.outputIds.length`. It is centralized and deterministic, but explicit parent/override graph edges would be clearer if output routing becomes more complex.

3. **Mapping Test Pattern identity.** It is currently a hidden system Component because the renderer consumes Component textures. A system/runtime source node would be cleaner and would remove the hidden Component container, but this requires a general non-project source contract in demand planning and thumbnails.

4. **Overall monitor adapter.** Live Overall preview is represented by a synthetic direct Surface/output in a cloned render state. It no longer mutates the Mapping, but an explicit monitor-output node would better describe this presentation boundary.

5. **Legacy persisted identities.** `scene-frame-guides` has Surface-oriented display text but a legacy internal ID and function names, and the technical sampling key is still `recordingFrameScale`. Renaming either needs a schema/node-diff migration policy; changing them directly could invalidate saved project edits or settings.

6. **Fallback policy.** Shared-framebuffer, media draw, sample draw, font, video-callback, and specialized ML fallbacks still exist and emit diagnostics. The product targets current Chrome/GPU, but removal should be a deliberate fail-fast policy with capability checks, not scattered deletion during render work.

7. **Serializer recovery fallback.** Project serialization can retain a legacy chain when graph compilation is unavailable. This protects data, but conflicts with a strict graph-authoritative model. Decide whether invalid graphs should block saving, enter explicit recovery mode, or retain this path.

8. **Stale regression suite.** The broad suite has many Frame-era assertions and UI fixtures. The last complete run was 903 tests: **852 passed, 51 failed**. Do not report the suite as green. Failures must be classified and rewritten against Surface-only behavior; some may expose real UI/layout regressions. The metrics suite also has one stale expectation for the removed "Sequential shader passes" hotspot label (9/10); render geometry is green (30/30).

## Important Files

- `js/domain/models.js`, `scene-routing.js`, `project-migrations.js`: schema, route materialization, migrations.
- `js/libraries/composition-engine/shared/mapping-program-compiler.js`: authored Mapping graph plus runtime source binding.
- `js/output/output-renderer.js`, `output-surface-runtime.js`, `surface-render-planner.js`: orchestration, transition composition, demand.
- `js/output/component-render-*`, `render-geometry.js`, `content-coordinate-space.js`: Component detail, placement, ROI.
- `js/services/project-serializer.js`, `project-folder-service.js`, `output-bridge-service.js`: persistence and transport.
- `js/control/mapping-live-view.js`, `control-shell-controller.js`, `style.css`: Mapping/Live UI and shared preview host.
- `tests/scene-routing.test.mjs`, `scene-mapping-model.test.mjs`, `app-node-package.test.mjs`: current architectural contracts.

## Verification Status

Focused architecture/storage/render-settings tests pass **60/60**:

```sh
node --test tests/render-settings.test.mjs tests/project-storage.test.mjs tests/project-serializer.test.mjs \
  tests/app-node-package.test.mjs tests/scene-routing.test.mjs \
  tests/scene-mapping-model.test.mjs
```

Before handoff also run:

```sh
npm test
npm run test:metrics
npm run test:render
git diff --check
```

The current changes were not browser-tested, following the user's request. When manually verifying, prioritize transition progress 0/1 equivalence, Scene Mapping with different source aspects, individual Surface patch add/remove, multiple output windows, output resize, retained target count, and absence of delayed patch queues.
