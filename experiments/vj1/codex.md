# VJ1 Handover Brief

Updated: 2026-07-23

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

`mapping.surfaces` contains authored geometry, calibration-facing properties, ordering, destination, fit, feather, visibility defaults, and identity. `state.surfaces` is the selected renderer projection: it may additionally contain derived source bindings such as `sourceNodeId`, `componentId`, crop, and source-fit data. `compileLiveProjectionProgram()` is the sole current Live-route authority. Only a transition's previous endpoint is retained as historical state. Never persist derived bindings into a Mapping or create a parallel per-Scene Surface table.

Old projects are migrated on load. Do not restore runtime compatibility branches for the removed Canvas/Frame models; migration code is their only proper home.

## Libraries and Node Architecture

The application root configures libraries under `js/libraries`:

- `node-engine`: typed/versioned nodes, ports, groups, packages, forks, and editable parts.
- `composition-engine`: Component, Scene, Mapping, Surface-route, Output, and application compilers.
- `render-engine`: relative geometry, render views, ROI contracts, and shared stable/revision/frame invalidation semantics.
- `mapping-engine`: projection sampling, homography, fit, and feathering.
- `cache-engine`: retained render-target and signature caches.
- `media-engine`, `image-engine`, `mesh-engine`, `terrain-engine`, `isf-engine`, `transition-engine`, and `procedural-2d`: reusable media and visual algorithms.
- `state-engine`, `storage-engine`, `synchronization-engine`, `timing-engine`, `diagnostics-engine`, `control-engine`, and `data-store`: infrastructure.
- `visual-nodes`: one folder per generator/effect with its metadata, editable code/shaders, and runtime parts.

Nodes own real algorithms, not decorative wrappers. The graph is primarily an authored and inspectable program plus a compiler boundary. Optimized hosts may execute compiled node implementations directly; the renderer must not allocate generic packets or traverse a dynamic object graph every frame. Specialized shader fusion, retained targets, mesh renderers, media leases, and required ping-pong passes remain valid node host implementations.

The 3D rule is deliberately not “one unified renderer.” Meshes, materials, transforms, cameras, scene objects, object collections, and optional Scene3d bundles are typed graph values. `Scene to Image` consumes an arbitrary object collection plus target/time context, clears once, shares retained mesh caches across instances, and produces the texture consumed by the normal optimized output chain. Scene3d is only a convenient data bundle, never the rendering authority. The scene compiler prunes unreachable nodes and lowers the reachable typed DAG to direct synchronous calls; the output host resolves declared mesh ports rather than knowing `meshA`/`meshB`. Shared depth targets, caches, batching, and fusion remain backend optimizations. STL/OBJ and Terrain reuse these node operations while retaining their optimized GPU hosts.

Control nodes follow the same split. Component time, oscillators, scalar math, and range mapping are ordinary reusable nodes. The visual compiler extracts only controls reachable from visual parameter edges and emits a synchronous control program that runs beside the optimized visual plan. It does not construct generic node packets in the frame loop.

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
- Static Components are signature-cached. Compiled invalidation has three shared modes: stable, revision-driven, and frame-driven. Shader time, control time, decoded media revisions, nested Components, feedback, and retained state must use that contract rather than host-specific redraw exceptions. Eligible synchronized clients should share results rather than rerendering the full chain.
- Preview and standalone Output are separate renderer clients but consume the same compiled Surface contract.

Mapping preview and its Test Pattern no longer rewrite Mapping data. Runtime source nodes are bound to the authored Mapping graph by `mapping-program-compiler.js`; authored reachability and Surface order remain intact. This compiler boundary is the intended way to combine stable topology with changing preview/Live source assignments.

## Live, Mapping, and Transitions

Overall Live selection materializes a Scene across the Mapping Surfaces. An ordinary Component selected Overall behaves as a virtual Scene and covers the shared Scene space before each Surface samples it. An individual Surface patch assigns the complete selected Scene/Component to only that Surface through the Surface's presentation fit. Clearing a patch restores Overall routing without changing the Mapping.

Direct outputs have a group route (`Full surface`) and per-output children. Current precedence is materialized centrally in `scene-routing.js`: an explicit group patch suppresses unpatched children, while explicitly patched children override their own output. This is route policy, not UI state.

Transitions use the current Surface geometry for both endpoints. `rebaseSurfaceRouteProgram()` combines current authored geometry with previous source bindings. Focused model tests confirm identical Overall monitor placement and identical per-Surface endpoint geometry.

### Transition presentation and shader contract

Ordinary Surface transitions now reuse the stable prepared view contract: source texture, normalized source rectangle, source fit, logical aspect, projection fit, and opacity. Each endpoint retains its own `contain`/`cover` mapping throughout the blend, so the transition no longer substitutes `stretch` and then snaps back to the stable presentation.

Complex routes that require transforms, final shaders, or thumbnail fallback still use retained endpoint textures. Their source-fit stage is already flattened into those textures, while the Surface projection-fit stage remains in the mapper. Unchanged Surfaces stay on the exact stable path. This adds no full-frame pass, ping-pong pair, or new buffer; ordinary changing routes now avoid the former per-Surface transition-buffer allocation.

Transitions are first-class catalog artifacts. Live state persists a stable `transitionId` and scalar/color parameters, never executable shader functions. The renderer resolves that identity when project node definitions change. A single-pass ISF transition is compiled into the mapper transition-kernel contract and embedded in the existing fit/projection/feather draw. Multipass or persistent ISF transitions remain explicitly rejected until a retained-target policy exists.

The built-in, installed, and project visual-library layers use the same artifact model. ISF is one implementation format; native and node-package artifacts remain valid for work needing richer CPU/GPU behavior. IDs are stable and namespaced. Accidental collisions are diagnostics, while replacement requires explicit metadata.

## Persistence, Transport, and Derived Data

- `project.json` stores canonical authored state and compact project node diffs, not installed node libraries, generated instances, thumbnails, or runtime route bindings.
- Component and per-Surface thumbnails are derived assets in the cache. Surface thumbnails use `surfaceId` and the `__surface__` cache suffix; obsolete `__frame__` files are ignored and regenerated. The last valid thumbnail stays visible until replacement succeeds.
- `project-serializer.js` and model normalization use the same `authoredSurfaceFields()` contract, preventing preview/Live bindings from leaking into saved Mappings.
- Output clients receive full recovery state plus revisioned live patches. High-frequency gestures are latest-value coalesced; do not add a second Mapping-specific protocol or an unbounded patch queue.
- Autosave is quiet-period and lifecycle aware. Browser shutdown writes are best effort; committed autosave remains the crash-safety boundary.
- Media, screen capture, video, parsed models, images, and GPU objects are lease-owned and must be disposed through bounded runtimes.
- ISF source files remain file-backed node definitions. Scalar inputs are ordinary params. Named image inputs are typed texture ports and lower onto the compiled texture DAG; their retained revisions, ROI views, sampler names, image sizes, and multipass bindings stay explicit. Audio/audioFFT textures remain rejected until they have a typed resource and clock contract. ISF transitions remain first-class transition artifacts rather than ordinary Component effects.

## Cleanup Completed in the Current Worktree

- Added a first-run startup project with three procedural Components, two example Scenes, one authored projection Surface, derived Output 1, and useful Live transition defaults. It is created only for a genuinely empty folder; loaded projects are not modified.
- Removed the mutable `ui.live.surfaceRoutes` mirror. Control, monitor, transition setup, and output now compile the same current Live projection program; only the previous transition route snapshot remains stored.
- Removed derived runtime source bindings from Mapping mutations in Mapping preview, Live, transition, and monitor-state construction.
- Added one shared authored/derived Surface-field contract used by normalization and serialization.
- Moved changing preview/Live source binding to the Mapping program compiler while preserving authored graph reachability.
- Rebased transition snapshots onto current Surface geometry rather than letting old route geometry survive.
- Removed the obsolete runtime `(outputIndex, width, height)` output-construction signature; pixel dimensions are now derived only at the host boundary.
- Removed Scene-thumbnail reconstruction from nested Component thumbnails. Scene thumbnails now use only the last authoritative Scene snapshot, so a dirty thumbnail cannot invent a partial composition.
- Updated focused Scene/Mapping/routing/storage tests to the Surface-only schema.
- Updated visible node descriptions away from the removed Frame concept where it is safe to do so.
- Removed dead renderer state for the deleted `frameById` and legacy route-key lookups. Surface route lookup is now the sole runtime authority.
- Renamed the derived thumbnail identity from Frame to Surface throughout storage, parsing, and refresh services. This changes only regenerable cache data, not authored projects.
- Removed a meaningless empty `frameId` field from Component thumbnail jobs.
- Reconciled the broad regression suite with the current shared preview, Surface, Scene, Mapping, and Live contracts. Assertions now follow the owning module instead of preserving deleted UI or model structure.
- Kept the checker/black native-host adapter because it is a valid allocation-stable node execution boundary; only its misleading legacy-compatibility description was removed.
- Preserved the direct optimized renderer. This cleanup adds no framebuffer, readback, render pass, or ping-pong pair.
- Added a shared visual-node contract for ROI, transform domains, alpha, allocation, and render views so compiler layers no longer perform ad hoc correction between nodes.
- Added a layered visual-library resolver and node-package v3 resource/artifact transport. Built-ins and project ISF use identical logical records without copying built-ins into project folders.
- Added real compiler targets for transition and Scene3d programs. Both validate topology and types before rendering, prune unreachable work, and call compiled implementations directly.
- Split 3D composition into reusable mesh, material, transform, camera, object, collection, and image-render operations. The optional 3D Scene node is a data grouping convenience, not another renderer.
- Lowered STL/OBJ rendering through the shared mesh render operation and extracted Terrain flight/controller state into a reusable node while preserving their retained optimized render paths.
- Added reusable time, oscillator, map-range, and scalar-math control nodes, compiled only when they drive reachable visual parameters.
- Made ISF transitions first-class project/library artifacts with stable header IDs, Live selection and parameter controls, persisted selection, renderer-boundary resolution, and direct mapper-kernel execution.
- Projected Anatomy, Mesh Patterns, and Terrain Flyover as typed compiled compounds. Their controller/geometry/topology/material/camera/render stages are visible and forkable while the compiler lowers the supported topology back into each retained custom renderer.
- Made specialized-compound editing honest: stage enablement is consumed by the retained backend, while provider or topology changes that backend cannot execute fail during recompile instead of silently rendering the previous hard-coded behavior.
- Added compiled-plan introspection for dependencies, media demand, readiness, dynamics, references, operations, and editor activation; production output consumers now use it instead of inspecting compatibility chains.
- Added a browser architecture smoke harness covering real WebGL transition compilation, endpoint/midpoint behavior, ROI crop equivalence, retained Terrain/Mesh shader programs, compiled compound contracts, and balanced test resources.
- Made project loading fail closed: an unreadable or malformed existing `project.json` can no longer fall through to fresh-project creation and overwrite the folder. Empty-folder creation remains explicit.
- Fixed large spinning STL invalidation without weakening the optimized renderer. Model spin is declared frame-dependent, Mesh-to-Image retains its renderer state, and Scene-to-Image avoids duplicate clears.
- Added one serializable temporal-invalidation contract across compiled visual plans, ISF, media, nested Components, and node caches. File-backed ISF definitions no longer carry functions in project state; they declare invalidation data that the compiler lowers outside the structured-clone boundary.
- Added shared video invalidation that stays decoded-frame-driven while `requestVideoFrameCallback` is healthy, then falls back to standards-level media time if callbacks stall, preventing both retained-output freezes and unnecessary output-cadence rerenders.
- Replaced the fixed two-mesh 3D lowering with `mesh inputs -> transforms/materials -> objects -> collection -> Scene data -> Scene-to-Image`. The default compound still demonstrates two objects, but the renderer and host have no fixed object count.
- Propagated browser module revisions through control, preview, Output, ISF, composition, and mesh entrypoints so a normal refresh activates the same compiler/runtime graph in every client.
- Removed the legacy `compileComponentPatch` packet construction and raw-chain fallback from the Output frame path. Ordinary Components, Scenes, empty graphs, media ownership, dynamics, and stable signatures now consume compiled programs exclusively; offline metrics may still project compatibility packets.
- Extended compiled stable/revision/frame invalidation to presentation scheduling. Stable previews and standalone Outputs present once and suspend their p5 loop; graph changes, parameter patches, media revisions, decoded video callbacks, scheduler events, and pointer work wake it, while time/camera/feedback/animated ISF plans remain continuous.
- Removed the remaining raw-chain authority from Output media readiness and nested-reference sharing decisions. Both now consume compiled-plan introspection; an enabled Component without a compiled program fails explicitly.
- Made graph-authoritative project persistence fail closed when a non-system Component has no generated graph. Legacy `component-import` projects may still carry a chain through migration, but a current graph project can no longer silently save that projection as replacement authority.
- Added durable, exact-version node-package references to project node data. Installing a package now records the package dependency without embedding shader/media resource contents; dependency-first resolution projects only the declared package versions into installed visual-library layers, and missing or conflicting versions fail explicitly. Loaded package node definitions become ordinary executable generator/effect compiler inputs rather than catalog-only records.
- Added a file-backed node-package repository under `libraries/`. Project startup resolves only the exact declared package/dependency closure, hydrates package ISF resources, publishes packages before render state, and fails closed when a referenced manifest or resource is unavailable.
- Project-installed packages now appear as first-class Nodes-workspace library sections with their node definitions, visual artifacts, resources, dependencies, and exact origin. Direct package references can be enabled, disabled, or removed without mutating package files; the editor registry is rebuilt from the active exact package closure so removed definitions cannot remain stale.
- The Nodes workspace now exposes every exact package version already present in the project repository, supports validated install/version changes, and can export the selected project-owned Group, fork, or definition as a new versioned manifest. Updates fail before state mutation when they remove a node version or visual ID still used by the authored project, and exports refuse to overwrite an existing version.
- Package-folder import now validates the complete manifest, declared resources, integrity hashes, resource paths, and portable ISF compilation before copying. Resources are written first and the manifest last; failed copies are removed and remain undiscoverable, while exact-version collisions fail without overwrite. Executable node packages require an explicit trust confirmation.
- Any exact repository package can now be exported as a complete portable folder. Export revalidates its identity and resources, preserves binary files byte-for-byte, writes the manifest last, cleans failed destinations, and refuses to merge with or overwrite an existing version.
- Unified cached and live thumbnail object-URL ownership. Retired URLs remain leased while a lazy image still references them instead of producing revoked-blob request floods.
- Corrected media-cache accounting for large video. Disk-backed compressed file bytes no longer masquerade as retained decoder memory, and inactive video decoders receive a short grace period so switching between rendered Preview and its thumbnail does not churn blob URLs or decoder state.
- Made video object-URL retirement ordered and explicit. Cache eviction now stops decoded-frame ownership, detaches the underlying video and source elements, forces the browser media resource to release them, and only then revokes the blob URL; an unrelated graph reconciliation can no longer expose a revoked URL still owned by p5/Chrome.
- Added a general compound control-projection contract. A Group can organize public parameters into ordinary inspector sections and bind one public control to one or several internal nodes. Those bindings are now also the execution boundary, so controls reach only their declared child parameters rather than leaking the Group context into every child. Terrain Flyover, Anatomy, and Mesh Patterns all use the shared projection without custom inspector code or any change to their retained render paths.
- Added the first honest Terrain geometry-provider substitution. The semantic graph can switch its Geometry stage from the terrain height field to a reusable planar grid, and that authored selection reaches native lowering while preserving the same retained renderer and downstream optimized Surface/output chain.
- Made specialized compound stages the configuration authority for their retained native lowering. Anatomy consumes separate geometry, transform, material, camera, and render parameter views; Terrain and Mesh Patterns receive only the union of parameters explicitly bound to their displayed stages. Structured stage-local settings such as camera projection/FOV survive compilation, every public parameter has at least one semantic owner, and undeclared raw values can no longer become hidden renderer controls. The compiler still lowers these Groups to the same allocation-stable native operations, with no graph traversal or generic packets in the frame loop.
- Removed transition-wide control-shell rebuilding from both transition start and transition expiry. Those events now refresh only the Live source/projection, inspector, and embedded Preview surfaces that depend on the transition. Control renders exceeding 50 ms also create a bounded `VJ1_CONTROL_UI_LONG_RENDER` in the in-app diagnostics with the state cause and dominant phase, distinguishing control DOM/Preview activation from the optimized Surface/output renderer.
- Made workspace navigation an explicit UI command rather than a project transaction. It structurally shares authored project collections, does not normalize or autosave `project.json`, and schedules the three-column DOM/Preview reconciliation after the input handler returns. Current-version project restore also skips the former no-op `project-restore-migration` autosave; only a missing or older project version requests that write.
- Moved complete project-save preparation off the interaction thread. The Application graph now passes its already-detached emitted snapshot to storage; a module Worker projects canonical `project.json`, pretty-serializes it, and computes exact save/history signatures before the existing ordered write queue touches disk. Worker failure is explicit and falls back safely. A browser probe matching `mappertest` at roughly 868 KB/105 Groups completed in 21 ms end to end with no 50 ms main-thread task.
- Live Preview/Output endpoint projection no longer deep-clones unrelated media, packages, Mappings, and editor state once for a cut and twice for a transition. It clones only renderer/patch-mutable branches while transport remains responsible for serialization.
- Component render programs are now compiled from visible current and transition endpoint roots, recursively following dependencies declared by compiled Group introspection. Unrelated catalog Components are absent from the retained plan; incomplete states with no provable root deliberately retain the complete compiler contract. This pruning happens during state activation and adds no graph traversal to the optimized frame loop.
- Made project-backed 3D meshes explicit graph nodes instead of invisible host-injected values. `Media Mesh` declares its resource dependency, resolves to the canonical typed mesh value, participates in arbitrary object/Scene composition, and is included in compiled-plan media demand/readiness. The Scene3d compiler lowers resource bindings once, while the retained output host reuses one mesh map and execution context; no file lookup, graph traversal, or generic packet allocation was added to the frame loop.
- Added shared literal parameter authoring directly to the graph canvas. Boolean, enum, numeric/ranged, color, structured, and media-backed parameters now update the semantic node instance; visual configurations remain synchronized, connected parameter inputs explicitly supersede literals, and media values reuse the one project media picker rather than a 3D-specific selector.
- Preserved Group compiler identity through normalization and project-fork materialization. A `compiled-graph` no longer reaches its backend through an incidental capability alone: its compiler ID/target remain explicit and inspectable, and edited child values are proven to enter the retained Scene3d program after persistence and recompilation.
- Removed the legacy visual-category restriction from Component graph insertion. Any texture-producing definition with a declared visual compiler hook can now become a compiler-owned Component operation, including the composable Scene3d source and multi-input texture operators. The optimized Surface/window output path remains unchanged.
- Connected file-backed multi-image ISF nodes to that graph host. Imported definitions now declare shader lowering, transform, ROI, and invalidation metadata; the compiler preserves each named texture edge; the retained renderer reuses per-operation input maps, includes every input revision in dirty identity, applies a shared ROI window to bounded inputs, and binds named samplers in single- and multipass shaders without changing Surface/window presentation.
- Extracted ISF retained-target ownership and compiled single/multipass execution from `output-renderer.js` into `isf-render-runtime.js`. The backend owns persistent ping-pong targets, float-target validation, sizing, pruning/disposal, named external/pass samplers, and the ISF host uniforms. The Output orchestrator retains thin synchronous delegates, so compiled traversal and the optimized Surface/window presentation path are unchanged.
- Extracted Mix, Mask, Transition, Feedback, and Delay execution from `output-renderer.js` into `texture-operator-runtime.js`. The backend owns operator/transition shader caches and the explicit Feedback/Delay ping-pong state, including deterministic context-bound shader disposal. The Output orchestrator still resolves compiled texture edges, signatures, ROI demand, and dirty evaluation before issuing one direct backend call; Surface/window presentation is unchanged.
- Extracted ordinary effect scheduling, local shader fusion, program compilation/caching, uniform binding, and direct pass execution into `shader-effect-runtime.js`. The same backend supplies shader programs and parameter binding to generators, so built-in, project, and ISF shader implementations share one execution boundary. Shader-builder invalidation now deletes its context-bound GL programs before targets are released instead of only dropping JavaScript cache references. Graph compilation, ROI, dirty evaluation, target selection, profiling, and final Surface/window presentation remain on their existing optimized paths.
- Extracted fixed Component upscale/post passes, layer content transforms, and overlay blending into `composite-render-runtime.js`. These reusable operations now cache programs per GL context and dispose every program when a context or renderer retires, replacing three orchestrator-owned caches that previously dropped references without deleting GL objects. Target allocation, compiled dirty evaluation, logical/physical resolution selection, and final Surface/window composition remain unchanged.
- Extracted ordinary source execution into `source-render-runtime.js`. Media, camera, black, Component references, native/generic generators, compiled node processes, Scene3d programs, screen input, and diagnostics now dispatch from compiler-declared renderer capabilities in one backend. Retained rasterization and direct placed-source composition share the same media demand, transform, playback, and Component-reference contracts; the Output orchestrator keeps dirty signatures, target allocation, compiled traversal, profiling, and optimized Surface/window presentation. Specialized Terrain, mesh, text, Anatomy, and ML hosts remain intact behind declared native renderer IDs.
- Added first-class project-owned visual Group creation. A new empty typed Group is persisted as an editable semantic definition, appears in the shared node library, compiles its reachable child graph into nested optimized render operations, can be placed in Components, and exports with its fork plus explicit node dependencies.
- Added project-owned Scene3d Group creation from the composable typed template. Visual and Scene3d Groups can expose internal literal parameters as ordinary public controls, reuse the shared Component inspector, compile internal control graphs into direct retained updates, and safely prune orphan controls when child nodes are removed. Visual Groups can also act as texture-input effect modules without changing the optimized Surface/window render path.
- Preserved explicit Group compiler identity through package construction, JSON export/import, repository loading, and project installation. Exported Scene3d Groups therefore remain editable semantic graphs and still select their retained Scene compiler after transport rather than degrading to generic graph execution.
- Corrected nested Component reference accounting to consume compiled-program introspection end to end. Canvas rendering now supplies its compiled parent program, reads the canonical `reference.path`, and no longer emits `VJ1_COMPONENT_PROGRAM_REQUIRED` while drawing a valid nested Component; repeated synchronized references also regain their intended shared-resolution optimization.
- Added typed public Group-port authoring to the shared graph canvas. Published inlets/outlets persist through project forks and package transport, compile directly into Scene3d interfaces, and are pruned with deleted children. Visual compounds preserve multiple named texture inputs through a retained nested DAG instead of collapsing them to one anonymous input; each placement can select one or several published image outlets while compiling only their reachable graph union. Their semantic graph is still compiled outside the frame loop and the optimized Surface/window path is unchanged.
- Extended the compiled visual value model from node-only texture identities to `node`/`node.port` identities. One visual Group placement may now publish several image outputs to different downstream nodes simultaneously: the compiler builds the union of reachable internal roots once, the retained runtime evaluates the Group once, and downstream texture DAG operations read the exact named output state. Single-output Groups retain their existing compiled-chain path; no semantic graph traversal or generic node packets entered the frame loop.

## Unresolved Architecture Decisions

1. **Broader transition presentation verification.** The browser smoke verifies Dissolve start/midpoint/end behavior and ROI crop equivalence in real WebGL. Real-project `mappertest` verification now also covers Component → Scene → Live navigation and a timed Live Scene transition without crossing the 50 ms control-render threshold. Human confirmation is still useful for project-authored ISF transitions, complex buffered routes, large-video endpoint changes, and the complete embedded-preview/output presentation matrix.

2. **Direct-output hierarchy.** Group/child precedence currently derives hierarchy from `destination.outputIds.length`. It is centralized and deterministic, but explicit parent/override graph edges would be clearer if output routing becomes more complex.

3. **Mapping Test Pattern identity.** It is currently a hidden system Component because the renderer consumes Component textures. A system/runtime source node would be cleaner and would remove the hidden Component container, but this requires a general non-project source contract in demand planning and thumbnails.

4. **Overall monitor adapter.** Live Overall preview is represented by a synthetic direct Surface/output in a cloned render state. It no longer mutates the Mapping, but an explicit monitor-output node would better describe this presentation boundary.

5. **Internal Frame terminology.** `scene-frame-guides`, preview interaction names such as `sceneFrameDrag`, and the technical sampling key `recordingFrameScale` now describe Surfaces or sampling windows rather than a persisted Frame model. The persisted node ID needs a schema/node-diff migration; the non-persisted APIs can then be renamed as one coordinated terminology migration. Avoid piecemeal aliases.

6. **Protocol compatibility.** Output recovery still accepts older recovery payload shapes so a stale output window can reconnect during application reload. Replacing this requires an explicit protocol-version handshake that reloads or rejects stale clients; do not grow more compatibility branches around it.

7. **Fallback policy.** Shared-framebuffer, media draw, sample draw, font, video-callback, and specialized ML fallbacks still exist and emit diagnostics. The product targets current Chrome/GPU, but removal should be a deliberate startup capability/fail-fast policy, not scattered deletion during render work.

8. **Effect parameter migration.** Runtime effect normalization still merges the old top-level `amount` field into the canonical param map, with `params` taking precedence. This should eventually become a project migration only, but needs a schema cutoff and fixtures for affected saved projects.

9. **Installed visual-library management.** File-backed discovery, exact dependency loading, ISF hydration, Output transport, repository inspection, activation, exact-version install/update, reference removal, selected-node manifest export, and manifest-last complete resource-folder import/export now exist. The remaining boundary is a durable signature/trust policy for executable packages and URL-backed resources; immutable package contents remain outside `project.json`.

10. **Specialized compound provider expansion.** Anatomy, Mesh Patterns, and Terrain now expose expandable compiled graphs; their displayed stages own every parameter/settings value admitted to native lowering, and supported stage switches reach their retained backends. Their current native specializations deliberately reject unknown provider/topology substitutions. Add new substitutions only when a compiler adapter can lower them faithfully; the general Scene3d graph remains the flexible path for arbitrary mesh/material/camera composition.

11. **Compound interface completeness.** The Nodes workspace can create project-owned visual and Scene3d Groups, expose and rename child parameters—including configuration owned by internal control nodes—as public controls, publish/unpublish/rename typed child ports, compile internal control graphs, use multiple named texture inputs in a retained visual DAG, and publish several named image outputs from one placement simultaneously through compiled output-port identities. Scene3d and ordinary graph programs can publish typed data outputs. Runtime signal ports remain distinct from this public literal-configuration contract.

## Important Files

- `js/domain/models.js`, `live-projection-program.js`, `scene-routing.js`, `project-migrations.js`: schema, current Live route compilation, route materialization, migrations.
- `js/libraries/composition-engine/shared/mapping-program-compiler.js`: authored Mapping graph plus runtime source binding.
- `js/libraries/mesh-engine`, `terrain-engine`, `transition-engine`: composable 3D values/operations, reusable terrain control, and transition kernels.
- `js/libraries/composition-engine/shared/visual-control-program.js`, `visual-render-plan.js`, `js/libraries/render-engine/invalidation`: compiled controls, optimized visual operations, and shared temporal invalidation.
- `js/libraries/visual-library`, `visual-nodes/project-visual-library.js`, `isf-engine`: layered artifacts and portable shader implementations.
- `js/output/output-renderer.js`, `source-render-runtime.js`, `isf-render-runtime.js`, `texture-operator-runtime.js`, `shader-effect-runtime.js`, `composite-render-runtime.js`, `output-surface-runtime.js`, `surface-render-planner.js`: orchestration, retained source/portable-shader/texture/effect/compositing execution, transition composition, demand.
- `js/output/component-render-*`, `render-geometry.js`, `content-coordinate-space.js`: Component detail, placement, ROI.
- `js/services/project-serializer.js`, `project-folder-service.js`, `output-bridge-service.js`: persistence and transport.
- `js/control/mapping-live-view.js`, `control-shell-controller.js`, `style.css`: Mapping/Live UI and shared preview host.
- `tests/scene-routing.test.mjs`, `scene-mapping-model.test.mjs`, `app-node-package.test.mjs`: current architectural contracts.

## Verification Status

The complete automated VJ1 suite is green: **1065/1065**.

```sh
npm test                       # 1065/1065
npm run test:metrics           # 10/10
npm run test:render            # 30/30
git diff --check               # clean
```

Browser/WebGL validation is green. The architecture smoke compiled and linked the transition, named two-image ISF, Mesh Patterns, and Terrain shader programs; verified the two named ISF samplers against their expected pixel mix, Dissolve endpoints, midpoint, ROI pixel equivalence, cloneable animated ISF graph data, and frame invalidation; and balanced every shader/program/texture/buffer created by the harness with no console errors. A real-project enabled/disabled comparison verified presentation invalidation: animated GreatBallOfFire sustained approximately 60 fps with one Component render and three dirty-stage renders per sample, while the same stable graph produced one presentation/cache-hit sample across ten seconds and then slept with zero Component, stage, or shader renders. The four-Surface output fixture sustained approximately 60 fps with four visible direct routes, zero shader handoffs, roughly 2.75 million avoided Surface raster pixels per sampled frame, and no console warnings or errors. Manual verification should still prioritize project-authored ISF transitions, complex buffered transition routes, multiple output windows, and interactive output resize.
