# VJ1 Architecture Handover

Updated: 2026-07-27

VJ1 is a build-free browser VJ and projection-mapping application in
`experiments/vj1`. It targets current Chrome with WebGL2. p5 is the browser and
media host; frame-critical work uses compiled plans and retained WebGL resources.
This document states current architectural truth and required invariants. It is
not a changelog.

## Product Ownership

- **Component**: reusable visual graph containing generators, media, effects,
  nested Components, controls, and Groups.
- **Scene**: spatial composition of Components. It owns content, not projector
  calibration.
- **Mapping**: authored collection of Surfaces and their calibration.
- **Surface**: one identity with a relative Scene rectangle and projected
  destination quad. There is no separate Frame model.
- **Live**: transient Overall routing plus optional per-Surface patches.
- **Output**: the selected Mapping and Live routes compiled for Preview or a
  standalone window.

```text
Component/Scene content + Mapping Surface geometry + Live route choices
                         -> compiled Surface routes -> Output
```

`mapping.surfaces` owns Surface identity, order, bounds, destination, fit,
feather, visibility defaults, and direct-output hierarchy. Renderer bindings,
crop, and route state are derived projections. `compileLiveProjectionProgram()`
is the Live-route authority. Transitions may retain old source bindings, but
current Surface geometry remains authoritative for both endpoints.

Old projects migrate on load. Canvas/Frame-era structures and direct
`media`/`camera`/`black` source shapes are migration inputs only. Current schema
is **36**. Authored sources are `generator` or `component`; legacy records become
`mediaImage`/`modelMedia`, `cameraInput`, or `black` before graph preparation.
Never restore runtime dispatch for retired source shapes.

## Nodes, Graphs, and Libraries

Reusable libraries live under `js/libraries`:

- `node-engine`: typed/versioned definitions, ports, Groups, packages, forks,
  dependencies, and editable parts.
- `composition-engine`: Component, Scene, Mapping, Output, control, value, and
  render compilers.
- `render-engine`: demand, ROI, geometry, transforms, invalidation, target and
  native-render contracts.
- `mapping-engine`: projection, homography, fit, and feather.
- `cache-engine`: retained signatures, targets, and shared results.
- media, image, mesh, terrain, ISF, transition, control, timing, storage,
  diagnostics, and synchronization libraries.
- `visual-nodes`: reusable primitives and compounds with metadata, editable
  code/shaders, and declared native capabilities.

Nodes own semantic values and algorithms, not decorative wrappers around hidden
host behavior. Saved graphs are editable authority. Compilers may lower them to
direct calls, retained targets, fused shaders, or small native kernels.

Every executable graph declares one model:

- **Graph**: ordinary typed nodes.
- **Compiled graph**: editable graph lowered into an optimized plan.
- **Native composite**: declared retained kernel where ordinary lowering is not
  yet equivalent.

Editor activation is explicit: live, recompile, restart, read-only, or
unsupported. A displayed graph must match execution.

### Compiled visual programs

Ordinary visual Groups support texture DAGs, scalar/vector/time/event controls,
retained synchronous values, and terminal native image operations. Compilation:

1. validates identities, ports, required inputs, public controls, and cycles;
2. prunes unreachable nodes;
3. produces a direct control program;
4. produces a retained typed-value program;
5. produces an optimized visual render plan.

Control and value programs retain their state and output objects. They do not
allocate generic packets each frame. Public controls bind to the child parameter
or unconnected inlet that owns the behavior; a public control cannot override a
graph-driven inlet.

Numeric parameter Animation tracks are authored control fragments inside the
owning Component/Scene program, never a second animation runtime or parallel
Component property. The shared Animation inspector projects tagged
`Source -> Transport -> Shape -> Mapping -> Combination -> Sink` wiring:
`Component Time -> Animation Sequencer -> Animation Curve -> Map Range ->
Numeric Combine -> $parameter`. The Sequencer owns automatic/triggered loop and
ping-pong timing, endpoint pauses, and one-leg/full-sequence trigger semantics.
The Curve node is a pure bounded mapper and owns easing plus explicit return-leg
behavior. Mapping converts normalized curve output into parameter units.
Combination explicitly replaces, adds to, or multiplies the authored base
value; the generated scalar control remains the base authority rather than
becoming separate animation state.
Deterministic random triggers are separate Component-Time event nodes. Manual
trigger buttons publish sequence-stamped application control signals to Preview
and Output; they never write project state, create history, autosave, or
recompile the graph. Legacy oscillator tracks remain readable and migrate
through the shared fragment factory on their next edit.
General opacity, Content placement, and Boundary placement use reserved
`$general.*` parameter sockets on that same operation; Boundary scale lowers to
one aspect-preserving width/height write rather than becoming duplicate state.
Animated groups persist as project-diff graphs; compatibility parameter edits
refresh compiler-owned visual configuration while preserving authored controls.
The generated scalar control remains dormant as the exact base-value fallback
and is reconnected when a track is disabled or removed. Evaluation stays in the
retained direct control program and never writes per-frame values to project
state. The first Animation iteration is numeric-only. Color interpolation,
Probe/global signal routing, and format-specific conveniences such as ISF
parameter metadata are later typed extensions of this control graph, not new
animation engines.

Reference patterns:

```text
Render Demand -> Text Mask Provider -> Text Mask to Image

Project Media Resource -> Media Resource to Image -> optional Alpha Feather

Screen/Camera Input Resource -> Media Resource to Image

Image A + Image B -> Analysis Provider -> Feature Morph to Image
```

Project media preserves trim, speed, fit, mirroring, and alpha-edge controls.
The host owns one decoder per media identity and playback lifecycle; the graph
owns selection and conversion. Images, screen input, and camera can lower to
direct drawable placement. Video keeps an atomic retained-frame target.
Primary media is published before derived rendition caches are restored;
folder discovery publishes cumulative authoritative batches so a large library
never gates an already discovered source. The embedded preview subscribes to
file-resource availability directly; project-state changes are not used as a
media wake signal. Renditions attach later and never gate their source files.
Standalone Output registration receives one authoritative state/media baseline
and buffers it while p5 initializes. Renderer setup consumes that baseline; it
must not request the same complete ownership snapshots again. The bridge
heartbeat retries registration when Control is not ready. p5 setup waits for
the first Control baseline or fixture state before compiling; `null` is not a
renderable boot state and must never be used as a timing fallback.
Asynchronous image, model, video, and rendition completion emits a
resource-dirty event so on-change presentation schedules exactly one dependent
render. Retained child renderers include readiness and revision discovered
through typed value ports, not only media IDs authored directly on the renderer
node.

Text, Feature Morph, Mesh Pattern, Terrain, Anatomy, Eyeball, Model Media, and
project Groups expose reusable semantic stages. Connected provider modules and
shaders are resolved at compile time, never by generator-name dispatch in the
frame loop. Text and Feature Morph consume only compiler-supplied typed child
values. The former hidden specialized-Group compiler, evaluator, stage
projection API, and `nativeCompoundProgram` runtime field have been deleted.
Reusable providers, render nodes, and their value types live in
`visual-stage-nodes.js` and `visual-stage-types.js`; an obsolete compiler hook
fails compilation instead of creating a second imperative graph authority.

### 3D composition

The goal is composable nodes, not a monolithic universal 3D renderer:

```text
Mesh Resource -> Transform / Material -> Scene Object
Scene Objects -> Object Collection -> Scene Data
Scene Data + Camera -> Scene to Image
```

Canonical values include meshes, transforms, materials, cameras, objects,
collections, and Scene3d bundles. Scene3d is data, not another renderer.
`Scene to Image` accepts arbitrary collections, shares context-bound programs
and buffers, clears once, and returns an image to the ordinary output chain.

Target, ROI, time, content transform, and cache ownership are host process
context, not editable ports. Model Media, Anatomy, project multi-object Groups,
and STL/OBJ inputs use the same retained value path and direct Scene-to-Image
process. Mesh readiness is a typed `resource-status`; missing downstream values
bind atomically as missing, so partial invalid Scenes never evaluate.

The standalone Scene compiler is editor/preflight validation, not a production
backend. `SourceRenderRuntime` must not regain a Scene interpreter. Terrain and
Mesh Pattern keep small declared kernels while their geometry, material,
camera, controller, and pass stages remain reusable. Terrain is an ordinary
editable compiled Group: Surface and Wire are separate render nodes. The
compiler lowers their private linear edge into one atomic retained framebuffer
sequence, preserving the same color and depth attachments without restoring a
monolithic parent renderer. Mesh Pattern uses the same general lowering for
Fill and Wire, preserving color in one target instead of allocating and copying
an intermediate texture. Linear continuation chains retain one attachment
contract; public or fan-out aliases fail compilation.

## Optimized Render Path

```text
canonical state
  -> materialize selected Scene/Live routes over selected Mapping
  -> compile reachable Surface/source graph
  -> propagate demand and ROI
  -> render or reuse retained Component results
  -> optional effect/group/transition work
  -> fit + Surface projection + feather + blend
  -> Preview or standalone Output
```

The optimized path is intentional. Never interpret a generic graph or allocate
generic node packets in the frame loop. The renderer may specialize through
typed passes: ROI propagation, transform normalization, fusion, target
elimination, resource sharing, and native lowering.

Hard invariants:

1. Relative geometry is canonical. Physical pixels derive from host size,
   quality, density, visible footprint, content scale, and source demand.
2. Surface geometry is authoritative, including during transitions.
3. Boundary placement/allocation and content-domain transforms are separate.
4. Every visual operation declares ROI mapping, halo, coordinate space, and
   local/global dependency.
   Its visual contract also declares an interaction hit region:
   rendered alpha, authored boundary, or none. Compounds publish the isolated
   public output under their outer identity so editor picking and future
   pointer/event nodes never depend on hidden child-render IDs.
5. ROI output equals cropping the full render. ROI may reduce work, never alter
   visual math, centering, or aspect.
6. Allocation follows visible boundary footprint; source detail follows backing
   demand and content scale. Offscreen areas allocate nothing.
7. `cover`, `contain`, and `stretch` remain explicit.
8. Alpha is premultiplied. Shader passes replace complete target pixels and
   layer composition uses explicit GPU source-over.
9. Dirty mode is compiled. Stable graphs sleep; revision-driven graphs wake for
   authored/resource changes; frame-driven graphs run only for declared time,
   feedback, capture, camera, audio, or similar dependencies.
   Disabled operations are excluded before retained-value evaluation or child
   execution. Historical profiler samples must not imply that sleeping or
   disabled operations are currently running.
10. Resources are retained and owned. Avoid readbacks, cross-context uploads,
    extra WebGL contexts, and unnecessary full-frame/ping-pong targets.
11. Preview and Output use the same Surface, transition, ROI, demand, and
    readiness semantics.
12. A pass that mutates its input framebuffer must declare that alias. The
    compiler accepts only a private linear edge and gives the complete sequence
    one target and cache authority; independent cached nodes never share a
    mutable color/depth target.
13. Authored content placement is screen-oriented: +X is right and +Y is down.
    Each backend derives its matrix from authored state on every evaluation.
    Never accumulate transforms in retained render state or add a second
    framebuffer-orientation compensation to repair a backend sign error.

## Live, Transitions, and Visual Libraries

Overall Live selection materializes a Scene across Mapping Surfaces. An ordinary
Component selected Overall behaves as a virtual Scene covering shared Scene
space. A Surface patch affects only that Surface; clearing it restores Overall
without changing Mapping.

### Live output matrix contract — do not reinterpret

The Live Output matrix has one **Scene Mapping** row plus the actual Direct
Output and Surface rows. These are distinct destinations with fixed routing and
preview semantics:

- Selecting Scene Mapping mounts the chosen Scene as the Overall fallback.
  Its Scene frames route that source indirectly to every available destination
  that has no explicit mount.
- Selecting a Direct Output or Surface mounts the chosen Scene or Component
  directly to that destination. A direct mount always wins over Scene Mapping.
  Its `×` removes only that mount; the destination then returns to the Overall
  fallback when Scene Mapping is enabled, or transparency when it is disabled.
- Scene Mapping visibility gates only its indirect fallback routes. Turning it
  off detaches Overall from unpatched destinations, but does not change their
  own visibility state and never disables an explicit direct mount.
- Each Direct Output/Surface eye controls only that destination. It must never
  toggle Scene Mapping or another row.
- Scene Mapping preview is the only flat Scene-space preview: show the mounted
  source with the Mapping frames in yellow.
- Direct Output and Surface previews always show the complete projected result,
  exactly like Mapping view. Only the selected destination is highlighted
  yellow; selecting or changing a source must not switch preview modes.

An ordinary Component mounted to Scene Mapping is adapted as if placed in a
temporary Scene with `cover`, but no temporary authored object, framebuffer, or
extra render pass is created. The compiler derives the virtual Scene adapter,
shared Scene ROI, and stable guide geometry. Mixed-aspect transition endpoints
use that same Scene space.

This precedence belongs in `materializeLiveProgramSurfaceRoutes()` and
`compileLiveProjectionProgram()`, not in UI button handlers. Preview choice
belongs in `createLiveScenePreviewState()`. Regression tests must cover direct
mount precedence/removal, fallback gating, independent visibility state, fixed
preview modes, selected yellow guides, and mixed-aspect transitions. Never
collapse these rules into a single “visible” flag.

Direct outputs use persisted `destination.parentSurfaceId`. Route materialization
enforces:

- explicit parent patches suppress unpatched descendants;
- explicit descendant patches override their output;
- parent backplanes render before children;
- missing parents, duplicate IDs, self-parenting, and cycles fail explicitly.

Transitions separate lifecycle from appearance. Prepared endpoints carry
texture, normalized source rect, fit, aspect, opacity, and current projection.
Each endpoint retains its own contain/cover mapping.

Transitions are first-class catalog artifacts. Live stores a stable
`transitionId` and scalar/color parameters, never functions. Single-pass ISF
transitions run inside existing projection/feather work. Persistent or multipass
transitions stay rejected until retained-target ownership is explicit.

Built-in, installed, and project libraries merge logically:

```text
built-in library + exact installed package closure + project assets
                             -> resolved visual catalog
```

ISF is one portable format, not a universal runtime. Pure fragment visuals and
simple transitions fit ISF; text, capture, 3D, ML, stateful CPU work, and
allocation-sensitive resources remain nodes or native operations.

The file-backed proving repository is under `visual-library/`. Manifest and ISF
headers repeat stable ID/version and fail closed when they diverge. Black,
Invert, Gray, Threshold, and Dissolve prove direct, fusible, parameterized, and
transition lowering. Metadata declares host contracts; it never embeds arbitrary
JavaScript.

Package dependencies are exact-version and content-integrity pinned.
`project.json` stores the resolved closure without embedding package resources.
Missing, conflicting, modified, or externally referenced content fails closed.

## Runtime Authorities and Safety

`OutputRenderer` is a composition root with narrow public setup, state, draw,
and disposal boundaries. Dedicated retained capabilities own:

- state activation and scoped recompilation;
- visual definitions, Component programs, and Mapping/Output programs;
- render requests, target allocation, evaluation, source execution, composition,
  shader generators/effects, texture operators, ISF, and transitions;
- Surface planning/projection, interaction, thumbnails, readiness, media/input
  lifecycles, shared resources, presentation, frame clocks, profiling, and
  metrics.

Capabilities communicate through explicit injected contracts. Do not restore
renderer forwarding methods, duplicate maps, source-name policy, or alternate
resource registries.

Signal load is a shared architectural diagnostic, not a collection of UI
counters. `metrics/signal-load-meter.js` measures rolling one-second activity at
the state-publication, invalidation, compiler, resource, retained-cache, and
presentation boundaries. Keep authored transactions, wakeups, recompiles,
resource revisions, cache invalidations/hits, and Preview/Output presentations
separate. Presentations and successful cache reuse are visible throughput but
must not increase pressure. Intermediate scrub samples are wakeup throughput
inside one editor gesture; only its commit is an authored transaction. The
ten-second report retains pressure reasons so unexpected compiles or
invalidations can be traced to their shared boundary. New execution paths must
join these shared boundaries rather than add per-feature instrumentation.

Compiled readiness is shared by media files, camera, screen inputs, meshes,
control signals, and external analysis. Resource/capability owners publish
ready, pending, and error states. Feature Morph readiness belongs to its analysis
capability; source rendering has no generator-specific asset traversal.

Preview activation is scoped. UI navigation retains compiled programs; selecting
a new Component compiles only its dependency closure; Mapping edits rebuild
Mapping/Output only; catalog refresh updates retained resources without
recompilation; executable library changes rebuild visual/transition and reachable
Component programs. Structural visibility/reference changes rebuild reachability
atomically. Parameters, transforms, and ROI use compact retained patches.
Once Preview accepts such a patch, that retained program is authoritative
through pointer release and any deferred control-DOM reconciliation. Scheduling
must preserve the patch activation context; a final value-identical commit must
not replace complete Preview state or recompile Component/Mapping programs.

Persistence and transport rules:

- The selected folder and `project.json` are authoritative.
- Malformed or unreadable projects never fall through to fresh creation.
- A starter project is created only in a genuinely empty folder.
- Canonical state stores authored data and compact project-node diffs, not
  generated instances, DOM/p5 objects, thumbnails, or runtime resources.
- Autosave snapshots immutable project truth before asynchronous serialization;
  UI/runtime updates do not autosave.
- Control and Output transport is revisioned. Parameter, transform, boundary,
  and other retained configuration changes cross as compact patches; complete
  state is reserved for restore/resync and topology or routing-reachability
  changes. Stale clients and incoherent source revisions fail closed.
- Browser source coherence has one graph-wide owner: the source-worker revision
  in `index.html`. Local JavaScript imports are queryless so one file has one
  module identity. Never restore per-import `?v=` tags; they duplicate module
  evaluation and split registries/singletons under different URLs.
- File/object URLs, decoders, captures, models, buffers, programs, and targets
  have explicit release ownership.
- Canonical state must remain structured-cloneable.
- Required browser/WebGL capabilities fail explicitly rather than selecting a
  hidden weaker renderer.
- Live session state is a versioned, project-scoped local checkpoint. It retains
  the selected Mapping and Overall target, per-Surface patches and visibility,
  presentation settings, and temporary parameter override banks across Control
  reloads. Restore validates every Mapping, Surface, Scene, and Component
  identity before one atomic Live activation. Active transition progress and
  runtime resources are never checkpointed. The Live reset command clears
  routes and temporary overrides without changing authored project data.

## Remaining Work

1. **Additional external providers.** Any new browser/async resource node must
   declare permission, retry, release, readiness, and invalidation contracts and
   join the shared typed readiness path.
2. **Native-kernel equivalence.** Mesh Pattern and Terrain keep small proven
   pass kernels. Their former/pass-specific composition now lowers from the
   ordinary graph into declared atomic framebuffer sequences. Replace the
   remaining kernels only when an ordinary equivalent matches pixels, depth,
   allocation, timing, and disposal. Never create a universal 3D host.
3. **Extended real-project soak.** The deterministic two-client media/WebGL
   stress harness covers independent decoders, loop/transition churn, resize,
   context loss/recovery, black-frame detection, and balanced GPU resources.
   Continue with multi-hour real-project sessions and browser memory telemetry.

Move reusable semantics into nodes now. Keep native work only as a declared
optimized lowering, and remove an old host only after measured equivalence.

## Important Files

- Domain/routing: `js/domain/models.js`, `project-migrations.js`,
  `live-projection-program.js`, `scene-routing.js`, `render-settings.js`.
- Compilers: `js/libraries/composition-engine/shared/`.
- Render contracts: `js/libraries/render-engine/`.
- Visual definitions: `js/libraries/visual-nodes/`.
- 3D: `js/libraries/mesh-engine/`, `terrain-engine/`.
- Libraries: `js/libraries/visual-library/`, `isf-engine/`,
  `transition-engine/`.
- Runtime: `js/output/output-renderer.js`, `visual-plan-runtime.js`,
  `source-render-runtime.js`, `render-evaluation-runtime.js`,
  `render-target-runtime.js`, `component-program-runtime.js`,
  `component-render-runtime.js`, `mapping-program-runtime.js`,
  `output-surface-runtime.js`, `output-readiness-runtime.js`,
  `output-media-runtime.js`, `output-frame-runtime.js`,
  `output-presentation-runtime.js`, and `specialized/`.
- Persistence/transport: `js/services/project-serializer.js`,
  `project-folder-service.js`, `output-bridge-service.js`.
- Diagnostics: `js/metrics/signal-load-meter.js`,
  `js/control/control-performance-session.js`,
  `js/output/output-presentation-metrics.js`.
- Editor: `js/control/node-graph-canvas.js`, `mapping-live-view.js`,
  `control-shell-controller.js`, `style.css`.
- Architecture tests: `tests/architecture-boundaries.test.mjs`,
  `app-node-package.test.mjs`, `visual-render-plan.test.mjs`,
  `scene-3d-program.test.mjs`, `output-media-readiness.test.mjs`.

## Verification

Run:

```sh
npm test
npm run test:metrics
npm run test:render
git diff --check
```

The real-WebGL browser architecture smoke must also pass. It covers compiled
shaders, transitions and endpoint equivalence, ROI crop equivalence, ordinary
and retained-value Groups, semantic 3D, aggregate CPU/Overall metrics, resource
revisions, and balanced GPU/browser resources.

At source coherence revision **186**, semantic sources, typed
resource/capability readiness, progressive primary-media restore, aggregate
metrics, atomic retained framebuffer passes, and the complete browser import
chain share one cache identity. A retained render result renews the lifetime of
every image, video, and model resource declared by its compiled program without
rerendering or decoding it; folder reconciliation publishes one atomic exact
resource snapshot after incremental discovery. Ordinary compiled Groups own
specialized child values; native terminal operations remain explicit optimized
backends rather than hidden parent programs. Output scheduling, signatures,
dependency/media state, and thumbnails consume compiled-program APIs; raw
Component chains are limited to migration and explicit editor projections. The
automated suite passes **1,420 tests**. The top-bar Signal load indicator and
ten-second report expose state, invalidation, compile, resource, cache, and
presentation rates without classifying ordinary presentation or cache reuse as
coordination pressure.

The reusable `tests/browser/runtime-stress.html` harness passes two concurrent
640×360 clients for 20 seconds at 60 fps: no accepted black frames or WebGL
errors, independent playback rates, repeated loop seeks, 26 resizes per output,
one context loss/recovery per secondary output, and balanced resource disposal.
`tests/browser/async-media-dirty.html` proves real PNG and JPEG resources move
from unavailable through incremental library discovery into the retained media
runtime; decode completion then wakes an idle on-change presentation once and
replaces the unavailable frame with verified pixels without pointer or
animation activity.

Performance evidence must track render targets, allocated pixels, buffers,
programs, uploads, draw calls, per-frame allocations, dirty-stage renders,
presentation wakeups, decoders, and object URLs. A correct image alone does not
prove the optimized path is healthy.
