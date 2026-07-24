# VJ1 Architecture Handover

Updated: 2026-07-24

VJ1 is a build-free browser VJ and projection-mapping application in
`experiments/vj1`. It targets current Chrome with WebGL2. p5 is the browser and
media host, while frame-critical rendering uses retained WebGL resources and
compiled execution plans.

This document describes the current architectural truth and the constraints that
future work must preserve. It is not a changelog. Git history and tests contain
the implementation history.

## Product Model and Ownership

- **Component**: reusable visual graph containing media, generators, effects,
  nested Components, controls, and Groups.
- **Scene**: spatial composition of Components. It owns visual content, not
  projection calibration.
- **Mapping**: authored collection of Surfaces and their calibration.
- **Surface**: one identity represented by a relative Scene rectangle and a
  projected destination quad. There is no separate Frame model.
- **Live**: transient source routing. It selects an Overall Scene or Component
  and may patch or hide individual Surfaces.
- **Output**: the selected Mapping and Live routes compiled for Preview or a
  standalone output window.

The ownership rule is:

```text
Component/Scene content + Mapping Surface geometry + Live route choices
                         -> compiled Surface routes -> Output
```

`mapping.surfaces` is authored geometry and calibration state. It owns Surface
identity, order, relative bounds, destination, fit, feather, visibility defaults,
and direct-output hierarchy. Derived renderer bindings such as `sourceNodeId`,
`componentId`, crop, and route state belong only to the compiled projection.
`compileLiveProjectionProgram()` is the current Live-route authority.

Transitions may retain the previous source bindings, but current Surface geometry
always remains authoritative for both transition endpoints. Never persist derived
Live bindings into a Mapping or create a parallel per-Scene Surface model.

Old projects are migrated on load. Removed Canvas/Frame-era concepts belong only
in migrations; do not restore runtime compatibility branches for them. Current
project schema is **34**.

## Node and Library Architecture

The application root assembles reusable libraries under `js/libraries`:

- `node-engine`: typed/versioned definitions, ports, Groups, packages, forks,
  dependencies, and editable parts.
- `composition-engine`: Component, Scene, Mapping, Surface-route, Output, control,
  visual-value, and visual-render compilers.
- `render-engine`: render demand, relative geometry, render views, ROI,
  transforms, and stable/revision/frame invalidation.
- `mapping-engine`: projection, homography, source fit, and feathering.
- `cache-engine`: retained signatures, targets, and shared results.
- `media-engine`, `image-engine`, `mesh-engine`, `terrain-engine`, `isf-engine`,
  `transition-engine`, and `procedural-2d`: reusable visual algorithms.
- Infrastructure libraries include state, storage, synchronization, timing,
  diagnostics, control, and data-store engines.
- `visual-nodes`: one folder per reusable visual node or compound, containing its
  metadata, implementation, editable shaders/code, and native capability
  declarations where required.

Nodes must own real algorithms and semantic values, not decorative wrappers
around hidden host behavior. Saved graphs are the semantic and editable
authority. Compilers may lower them to allocation-stable direct calls, fused
shaders, retained targets, or native kernels.

The optimized renderer is intentional and must remain. Do not traverse a generic
object graph or allocate generic node packets in the frame loop. A node editor
does not imply interpreted rendering; it edits semantic graphs that compile into
optimized plans.

### Execution models

Every executable graph must honestly declare one of these models:

- **Graph**: ordinary typed nodes evaluated directly.
- **Compiled graph**: editable semantic graph lowered into an optimized plan.
- **Native composite**: a declared retained kernel used where ordinary lowering
  cannot yet provide the same performance or resource lifecycle.

Editor activation must also be honest: live, recompile, restart, read-only, or
unsupported. Editing a displayed compound must never silently continue executing
an unrelated hard-coded topology.

### Ordinary visual compilation

Ordinary visual Groups can contain:

- texture/image DAG operations;
- scalar, vector, time, and event control nodes;
- retained synchronous typed-value providers;
- declared native renderer operations at the terminal image boundary.

The compiler prunes unreachable nodes and validates child identity, endpoints,
port types, required inputs, ambiguous bindings, public controls, and cycles.
Retained typed-value outputs carry stable resource identities into downstream
render signatures and expose their steps, bindings, types, and invalidation
through compiled-plan introspection. The compiler then produces:

- a direct control program for parameter updates;
- a retained typed-value program for reusable CPU/resource values;
- an optimized visual render plan for texture and image operations.

The control and value programs use retained state and output objects. They must
not create generic packets every frame. Public Group controls bind to the actual
child parameters that own the behavior.

Text is the first ordinary compound using the general retained-value path:

```text
Render Demand -> Text Mask Provider -> Text Mask to Image
```

The CPU mask is retained by the value program, while the final image operation
uses a declared native renderer and editable shader. Screen Share similarly
compiles `Screen Input Resource -> Media Resource to Image`; browser capture
lifecycle stays host-owned while the selected resource and presentation are
ordinary typed graph values. Tile Texture is an ordinary media-to-texture Group.
Eyeball is an ordinary control-to-shader Group. These are reference patterns for
removing larger hidden specialized compounds without weakening their fast path.
Both Feature Morph variants now follow the same model: two media-resource
values feed a replaceable retained SuperPoint or MobileNet analysis provider,
then one shared compiled GPU morph renderer. The analysis nodes declare their
host-owned asynchronous lifecycle, pending/error behavior, and
external-revision invalidation.

### 3D composition

The goal is not one monolithic “unified 3D renderer.” The reusable architecture
is a set of typed nodes that can be combined:

```text
Mesh Resource -> Transform / Material -> Scene Object
Scene Objects -> Object Collection -> Scene Data
Scene Data + Camera + Render Demand -> Scene to Image
```

Canonical values include Mesh resources, transforms, materials, cameras, scene
objects, collections, and optional Scene3d bundles. `Scene to Image` consumes
arbitrary object collections, retains canonical GPU buffers, shares programs per
WebGL context, clears once, and produces an image for the normal optimized output
chain. Scene3d is a data bundle, not another rendering authority.

STL/OBJ and Terrain reuse these operations. Terrain and other demanding systems
may retain small declared native kernels where they are beneficial, but geometry,
materials, cameras, animation/controllers, and scene assembly should be reusable
graph elements. The compiler, not a universal renderer object, decides how a
supported graph is lowered.

## Render Pipeline and Hard Invariants

```text
canonical authored state
  -> materialize selected Scene/Live routes over selected Mapping
  -> compile reachable Surface/source graph
  -> plan visible Component and media demand
  -> render or reuse retained Component results
  -> optional effect/group/transition work
  -> source fit + Surface projection + feather + blend
  -> Preview or standalone Output
```

Preserve these invariants:

1. **Relative geometry is canonical.** Pixel sizes derive from the actual host,
   quality, density, visible footprint, content scale, and source-detail demand.
2. **Surface geometry is authoritative.** Transition snapshots retain previous
   source bindings, not stale calibration geometry.
3. **Boundary and content transforms are separate.** Boundary controls placement,
   rotation, clipping, and allocation. Content transform changes the visual
   domain inside that boundary.
4. **ROI is semantic.** Every visual node should declare input-to-output ROI,
   halo, and local/global dependency. ROI reduces allocation and sampling only;
   it must not recenter, squeeze, or otherwise change visual math.
5. **ROI must be pixel-equivalent.** Rendering a requested ROI must equal cropping
   the same region from a full render.
6. **Demand has two dimensions.** Buffer allocation follows visible boundary
   footprint. Source detail follows physical backing demand and content scale.
   Offscreen boundary areas allocate nothing.
7. **Presentation fit is explicit.** `cover`, `contain`, and `stretch` may not be
   substituted to hide aspect or transform errors.
8. **Premultiplied alpha is the contract.**
9. **Dirty state is compiled.** Stable graphs render once and sleep;
   revision-driven graphs wake for authored/resource changes; frame-driven graphs
   run continuously only while time, feedback, capture, camera, or another
   declared dependency requires it.
10. **Resources are retained and owned.** Avoid pixel readbacks, cross-context
    canvas uploads, extra WebGL contexts, and new full-frame or ping-pong targets
    unless the algorithm requires them.
11. **Preview and Output share semantics.** They are separate renderer clients,
    but consume the same compiled Surface, transition, ROI, and demand contracts.

The renderer may specialize through typed render-plan passes: ROI propagation,
transform normalization, shader fusion, target elimination, resource sharing, and
native lowering. These optimizations should become smaller declared passes rather
than accumulating as generator-name branches in `output-renderer.js`.

## Live, Mapping, Output, and Transitions

Overall Live selection materializes a Scene across Mapping Surfaces. An ordinary
Component selected Overall behaves as a virtual Scene covering shared Scene space
before each Surface samples it. A per-Surface patch assigns the selected Scene or
Component only to that Surface through its presentation fit. Clearing the patch
restores Overall routing without mutating the Mapping.

Direct outputs use an explicit persisted `destination.parentSurfaceId` hierarchy.
`outputIds` owns physical output geometry only. Central route materialization
applies precedence:

- an explicit parent patch suppresses unpatched descendants;
- an explicit descendant patch overrides its own output;
- parent backplanes render before children.

Missing parents, duplicate IDs, self-parenting, and cycles fail explicitly.

Transitions separate lifecycle from appearance. Both endpoints use prepared views
containing texture, normalized source rect, source fit, logical aspect, opacity,
and current Surface projection. Each endpoint retains its own `contain`/`cover`
mapping throughout the blend.

Transitions are first-class catalog artifacts. Live state stores a stable
`transitionId` and authored scalar/color parameters, never executable functions.
Single-pass ISF transitions compile into the mapper transition-kernel contract and
run inside the existing projection/feather draw. Multipass or persistent ISF
transitions remain rejected until an explicit retained-target policy exists.

## Visual Library and Packages

Built-in, installed, and project libraries are logical catalog layers using one
artifact model. They are merged, not copied:

```text
built-in library + exact installed package closure + project assets
                             -> resolved visual catalog
```

ISF is one portable implementation format, not the universal runtime. Pure
fragment generators/effects and simple transitions are good ISF candidates.
Text, capture, 3D, ML analysis, stateful CPU algorithms, and allocation-sensitive
resources remain node packages or declared native operations.

Catalog items have stable namespaced IDs, kind, implementation type, version,
origin, tags, attribution, and explicit override metadata. Matching IDs do not
silently override one another.

Node packages use exact dependency versions and content integrity. `project.json`
pins the resolved dependency closure without embedding library resources.
Startup resolves only that closure and fails closed for missing, conflicting, or
modified content. Project-installed packages cannot reference arbitrary external
URL resources. Integrity is exact-content approval, not publisher identity.

## Persistence, Transport, Media, and Safety

- The user-selected folder and `project.json` are authoritative.
- Existing malformed or unreadable projects fail closed. They must never fall
  through to fresh-project creation or overwrite existing data.
- A fresh starter project is created only for a genuinely empty folder.
- `project.json` stores authored state and compact project-node diffs, not
  generated instances, runtime bindings, thumbnails, or installed resources.
- Model normalization and serialization share the same authored Surface-field
  contract so Live/Preview projections cannot leak into saved Mappings.
- Thumbnails are derived cache assets. The last valid thumbnail remains until a
  replacement succeeds.
- Autosave is quiet-period and lifecycle aware. Serialization currently remains
  a known main-thread cost; warnings such as `VJ1_AUTOSAVE_PREPARE_SLOW` are
  diagnostic evidence, not permission to hide or suppress the work.
- Control and Output use a versioned protocol. Packets are bound to client,
  controller session, folder, and recovery identity. Recovery state and media are
  separate atomic messages.
- Media and GPU resources are lease-owned. Images, video decoders, capture,
  parsed models, object URLs, buffers, programs, and targets must be released by
  their bounded runtime.
- Video decoder callbacks identify new media revisions; they do not replace the
  application presentation clock. Loop seeks retain the last confirmed frame
  until a frame for the current seek target is decoded.
- Runtime/project state must remain structured-cloneable. Functions, DOM objects,
  p5 objects, and live resources stay outside canonical state.
- Supported runtime is current Chrome with required WebGL2 and p5 capabilities.
  Missing required capabilities fail explicitly instead of silently selecting a
  weaker renderer.

## Current Migration State

Healthy and established:

- Surface-only Mapping/Scene/Live ownership and explicit output hierarchy.
- Compiled Component/Scene/Mapping/Output programs with fail-closed preflight.
- Optimized retained renderer, shared invalidation, demand, ROI, and sleeping
  stable presentation loops.
- Ordinary texture DAGs, control programs, and the first general retained-value
  program.
- Typed 3D values and arbitrary object collections feeding Scene-to-Image.
- First-class ISF generators, effects, named image inputs, and transitions.
- Layered visual libraries and exact-version/integrity package loading.
- Compiled-plan introspection for dependencies, readiness, dynamics, references,
  operations, and editor activation.
- Source-coherent build-free module loading through the scoped worker.
- Project loading and executable graph compilation that fail closed.

Still requiring generalization:

1. **Retained typed values.** Port validation, required-input checks,
   invalidation introspection, and reusable resource identity are established.
   Text, Screen Share, and both Feature Morph variants now use this path.
   Continue applying it to resource/provider compounds; browser permission
   lifecycles beyond Screen Share still need explicit capability contracts.
2. **Remaining native compounds.** Terrain and Mesh Patterns still have declared
   retained kernels. Continue extracting reusable controllers, geometry,
   materials, and cameras while retaining proven kernel schedules.
3. **Texture graph breadth.** Expand multi-input image effects, Mix, Mask, Select,
   and explicit Feedback/Delay without losing fusion or direct-target rendering.
4. **Control graph breadth.** Add MIDI/OSC/audio, selection, smoothing, delay, and
   sample-and-hold using direct compiled parameter updates.
5. **Renderer modularity.** Continue moving source, effect, transition, 3D, and
   projection responsibilities out of the large orchestration class into typed
   plan operations and capability-owned runtimes.
6. **Autosave preparation.** Move canonical snapshot/serialization work away from
   interaction frames while preserving ordered, atomic folder writes and visible
   diagnostics.
7. **Real-world transition/media validation.** Continue testing buffered routes,
   large video endpoint changes, multiple output windows, resizing, and long
   sessions.

Structural render patches that change visibility or Component-reference
identity rebuild the compiler-derived reachable program closure atomically.
Parameter, transform, and ROI patches remain on the compact retained path.

The migration rule is: move reusable semantics into nodes now, keep small
declared optimized kernels where necessary, and delete duplicate hosts only after
visual and performance equivalence is proven.

## Important Files

- Domain and routing: `js/domain/models.js`, `project-migrations.js`,
  `direct-surface-hierarchy.js`, `live-projection-program.js`,
  `scene-routing.js`, and `render-settings.js`.
- Core compilers: `js/libraries/composition-engine/shared/`, especially
  `visual-render-plan.js`, `visual-control-program.js`,
  `visual-value-program.js`, and `mapping-program-compiler.js`.
- Render contracts: `js/libraries/render-engine/`, including render demand,
  invalidation, geometry, transforms, and ROI.
- Visual definitions: `js/libraries/visual-nodes/`.
- 3D: `js/libraries/mesh-engine/` and `terrain-engine/`.
- Libraries and shaders: `js/libraries/visual-library/`, `isf-engine/`, and
  `transition-engine/`.
- Runtime: `js/output/output-renderer.js`, `source-render-runtime.js`,
  `specialized-source-runtime.js`, `isf-render-runtime.js`,
  `texture-operator-runtime.js`, `shader-effect-runtime.js`,
  `output-surface-runtime.js`, and `surface-render-planner.js`.
- Persistence and transport: `js/services/project-serializer.js`,
  `project-folder-service.js`, and `output-bridge-service.js`.
- UI/editor: `js/control/node-graph-canvas.js`, `mapping-live-view.js`,
  `control-shell-controller.js`, and `style.css`.
- Architectural tests: `tests/app-node-package.test.mjs`,
  `visual-render-plan.test.mjs`, `scene-routing.test.mjs`, and
  `scene-mapping-model.test.mjs`.

## Verification

Run all four checks before declaring an architectural migration complete:

```sh
npm test
npm run test:metrics
npm run test:render
git diff --check
```

The browser architecture smoke must also pass with real WebGL. It covers compiled
shader programs, transitions and endpoint equivalence, ROI crop equivalence,
ordinary and retained-value Groups, semantic 3D compounds, stable resource
revisions, and balanced GPU/browser resources.

Performance validation must track render targets, allocated pixels, GPU buffers,
programs, uploads, draw calls, per-frame allocations, dirty-stage renders, and
presentation wakeups. Preserve or improve these measurements throughout
migration. Never treat a green image alone as proof that the optimized output
path remains healthy.
