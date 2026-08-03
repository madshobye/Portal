# VJ1 Architecture Guide

Snapshot date: 2026-08-03

VJ1 is a build-free browser VJ and projection-mapping application in
`experiments/vj1`. It targets current Chrome and WebGL2. p5 provides the browser
canvas, media wrappers, and interaction host; frame-critical rendering uses
compiled plans, retained WebGL resources, and explicit cache ownership.

This is the short architectural handover and a snapshot of what is currently
true. It records durable decisions and invariants, not milestones, test totals,
or a history of completed work. Product ideas and the working inbox remain in
`projectnotes.md`; specialized contracts belong beside their implementation or
in the documents listed at the end.

> **Maintenance rule:** this document must never become a changelog. When the
> architecture changes, revise or remove the affected statement so the whole
> document remains one coherent current snapshot. Do not append dated updates,
> milestone narratives, completed-work sections, or old/new comparisons. Git
> owns history.

## Working principles

- Prefer a small reusable abstraction to feature-specific branches. Do not add
  a workaround merely to make one example pass.
- Slow down when the cause is uncertain. Instrument, profile, and isolate the
  failing authority before changing code. It is acceptable to stop rather than
  weaken the architecture.
- Preserve established product behavior unless a design change has been
  discussed explicitly.
- Authored project state is the only user truth. Compiled plans, compatibility
  projections, controls, thumbnails, caches, and runtime resources are derived.
- Derived state must be correct before first execution. A later movement,
  refresh, or unrelated edit must never be required to repair it.
- Invalidation is semantic and narrow: a parameter wakes its owner, placement
  wakes composition, and resource readiness wakes only its consumers.
- Do not silently fail or silently select a weaker path. Errors and meaningful
  fallbacks emit tagged console diagnostics with the cause and chosen behavior.
- Support the intended modern Chrome/WebGL2/File System Access/Web Serial
  environment. Do not burden the hot path with broad legacy-browser fallbacks.
- Migrate old project data at load time. Never reintroduce retired project
  shapes as parallel runtime authorities.
- Every root-cause bug fix gets a focused regression test. Lifecycle fixes also
  require a clean-reload check.

Performance is a design constraint. Graph traversal, compilation, DOM work,
resource discovery, and project serialization stay outside the frame loop.
Avoid per-pixel CPU work, per-frame object churn, unnecessary framebuffer
copies, readbacks, uploads, contexts, and full-frame passes. Prefer shaders,
typed arrays, workers, retained targets, bounded algorithms, and measured
specialized kernels. Diagnose control DOM, compilation, decoding, CPU render,
GPU render, and presentation cadence as separate systems.

## Product model and authority

- **Component**: reusable visual program containing generators, media, effects,
  nested Components, controls, Groups, and parameter Animation tracks.
- **Scene**: spatial composition of Components. It owns content placement, not
  projector calibration.
- **Mapping**: authored collection of calibrated Surfaces.
- **Surface**: one identity with a relative Scene rectangle, projected
  destination quad, fit, feather, visibility default, and optional direct-output
  hierarchy. There is no separate Frame model.
- **Live**: transient Overall routing plus optional per-Surface/direct-output
  mounts, visibility, and temporary parameter overrides.
- **Output**: the selected Mapping and Live program compiled for Preview or a
  standalone output window.

```text
Component/Scene content + Mapping geometry + Live route choices
                         -> compiled Surface routes -> Preview/Output
```

`mapping.surfaces` owns Surface identity, order, bounds, projection, fit,
feather, visibility defaults, and parent relationships. Crop rectangles,
renderer bindings, route tables, and preview guides are derived projections.
The current schema is owned by `CURRENT_PROJECT_VERSION` in
`project-migrations.js`; do not duplicate migration behavior elsewhere.

Canonical state stores authored data and compact project-node diffs. It never
stores DOM/p5 objects, generated instances, callbacks, GPU handles, decoded
media, thumbnails, or compiled programs. Current authored visual sources are
nodes/Components; legacy source records are migration inputs only.

## Nodes, graphs, and libraries

Reusable capability libraries live under `js/libraries`; each has a public
`index.js`. The important boundaries are:

- `node-engine`: typed/versioned definitions, ports, Groups, packages, forks,
  editable parts, and compiler selection;
- `composition-engine`: Component, Scene, Mapping, Output, control, value, and
  render compilation;
- `render-engine`: demand, ROI, geometry, transforms, invalidation, visual
  contracts, and native-render contracts;
- `mapping-engine`: projection, homography, fit, feather, and mapping geometry;
- `cache-engine`: retained signatures, targets, and shared result ownership;
- media, image, mesh, terrain, ISF, transition, motion, control, timing,
  diagnostics, storage, synchronization, and DMX libraries;
- `visual-nodes`: executable visual primitives and compounds with declared
  parameters, editable parts, capabilities, and native lowering metadata.

The dependency direction is:

```text
node platform -> generic types/runtime/compiler contracts
libraries     -> node platform + external browser/GPU libraries
application   -> public library entry points + product views + render hosts
```

A node owns semantic behavior; it is not a decorative wrapper around hidden
application code. Saved graphs are editable authority. Compilers may lower them
to direct calls, retained typed values, fused shaders, shared framebuffer
sequences, or a small declared native kernel. Editor activation must state
whether an edit is live, requires recompile/restart, is read-only, or is
unsupported. A displayed graph must describe what executes.

There is no universal scheduled graph interpreter in the render loop. Ordinary
control/data graphs run when invoked. Visual Groups compile before rendering to
allocation-stable direct programs. Public controls bind to the child parameter
or unconnected inlet that owns the behavior; they cannot override a graph-driven
inlet. Specialized native operations are allowed only as explicit node-owned
lowerings with tests or metrics and an ordinary typed contract around them.

Project-global transports such as DMX, MIDI, OSC, capture, and audio analysis
are services, not hidden Component state. Nodes expose typed values/events to
those services. A service has one resource owner, one lifecycle, and one cadence.

## Render and resolution contract

The optimized path is intentional:

```text
canonical state
  -> materialize selected Scene/Live routes over the selected Mapping
  -> compile reachable source and Surface programs
  -> propagate demand and ROI backward
  -> render or reuse retained Component results
  -> compose effects, Groups, transitions, projection, feather, and blend
  -> present through Preview or standalone Output
```

Hard invariants:

1. **Relative geometry is canonical.** Physical allocation derives from the
   presentation canvas, device density, quality ceiling, visible footprint,
   authored scale, and source detail demand. Users normally author proportions
   and scale, not buffer dimensions.
2. **The presentation canvas begins demand calculation.** A source renders only
   the pixels its downstream output can consume. `cover`, `contain`, and
   `stretch` use one shared fit implementation. Cover matches one destination
   dimension exactly and crops the other.
3. **ROI is an allocation window, not a coordinate system.** Cropping an ROI
   must equal cropping the full render. ROI cannot redefine aspect, typography,
   mesh framing, object bounds, shader coordinates, or animation math.
4. **Boundary and Content are separate.** Boundary controls placement and
   allocation. Content transforms operate inside it. Content scale participates
   in backing/source demand but must not resize the output canvas or bypass the
   existing ROI/demand chain.
5. **Transforms have one conversion boundary.** Authored +X is right, +Y is
   down, and positive rotation is screen-oriented. Raw WebGL derives its matrix
   fresh each evaluation and converts Y/orientation once. Never accumulate
   transforms or add shader-specific flip fixes.
6. **Surface geometry stays authoritative**, including both endpoints of a
   transition. Transition history may retain sources, not stale calibration.
7. **Alpha is premultiplied.** Shader passes replace complete target pixels;
   composition uses explicit GPU source-over and declared blend behavior.
8. **Dirty mode is compiled.** Stable graphs sleep. Frame cadence exists only
   for declared time, feedback, capture, camera, audio, or similar dependencies.
   Disabled and unreachable work is removed before child evaluation.
9. **Resources and targets are retained and owned.** A mutable framebuffer may
   be shared only by a compiler-approved private linear sequence with one cache
   authority. Independent cached nodes never alias mutable attachments.
10. **Preview and Output share render semantics.** They use the same demand,
    ROI, fit, readiness, transition, projection, and resource rules. Preview
    zoom/pan changes presentation navigation only; it must not rewrite authored
    parameters, recompile, or become render demand.

Every visual operation declares its ROI mode, halo, coordinate space, mapping,
local/global dependency, dirty policy, and interaction region. Full-frame or
persistent operations remain full-frame when history requires it; the
compositor extracts the visible ROI afterward. Offscreen local work allocates
nothing. A correct image is insufficient evidence: profile allocated pixels,
targets, uploads, draw calls, cache reuse, invalidations, and frame allocations.

## Live routing, Mapping, and transitions

The Live Output matrix has one **Scene Mapping** row plus actual direct-output
and Surface rows. These destinations are related but independent:

- Scene Mapping mounts a Scene or virtual Component as the Overall fallback for
  destinations without an explicit mount.
- A direct mount always wins for that destination. Removing it restores Overall
  only when Scene Mapping is enabled; otherwise the destination is transparent.
- Disabling Scene Mapping detaches only indirect fallback routes. It must not
  disable, hide, select, or clear any direct destination.
- Each destination eye controls only that destination. Mapping-view visibility
  and Live routing remain separate state.
- Scene Mapping preview is flat Scene space with Mapping guides. Direct-output
  and Surface previews show the complete projected result and highlight only
  the selected destination.

This precedence belongs in `materializeLiveProgramSurfaceRoutes()` and
`compileLiveProjectionProgram()`, never in button handlers. Preview projection
belongs in `createLiveScenePreviewState()`. An Overall Component is adapted to
Scene space without creating a temporary authored object or extra render pass.

Direct outputs use persisted `destination.parentSurfaceId`. Explicit parent
mounts suppress unpatched descendants; explicit descendants override their
parent; parent backplanes render first. Missing parents, duplicates,
self-parenting, and cycles fail explicitly.

Transitions separate lifecycle from appearance. Prepared endpoints retain
source texture, normalized source rectangle, fit, aspect, opacity, and current
projection. The destination-scoped transition coordinator owns active and
latest-wins pending snapshots. Different Surface lanes may run concurrently;
Overall arbitrates with them. Scheduling and promotion are event-driven control
work; renderers only calculate progress and compose endpoints. Live stores a
stable transition ID and serializable parameters, never executable functions.

## Animation and live control

Numeric Animation tracks are authored graph fragments inside the owning visual
program, not a second animation runtime or per-frame project-state writer:

```text
Source -> Transport -> Shape -> Mapping -> Combination -> parameter Sink
```

Sources include shared logical time, pointer X/Y/down/inside, audio levels and
beats, Probe values, MIDI/OSC/control signals, deterministic noise, and events.
Transports include sequenced loop/ping-pong timing and retriggerable segment
envelopes. Shape supplies curves or bounded noise; Mapping converts normalized
values to parameter units; Combination explicitly replaces, adds, or multiplies
the authored base value. Smoothing/running average is a reusable allocation-
stable stage.

Manual, periodic, deterministic-random, pointer, audio-beat, Probe-threshold,
MIDI, and other triggers share one event contract. A trigger is a sequence/token,
not a persisted boolean. Trigger buttons and live signals never create history,
autosave, or graph recompilation.

Pointer signals are normalized within the visual/presentation boundary and are
shared from Live Preview to Output. They remain dormant unless a compiled
program declares the dependency. Probe is an ordinary visual passthrough
observer whose Boundary defines a sampled area. Only referenced Probe addresses
activate bounded GPU sampling/readback; Probe never copies a framebuffer or
creates another render loop. Audio capture/analyse is lazy and shared; it is the
only live driver that intentionally keeps analysis cadence.

`defaultAnimation` and `suggestedAnimations` are recipes that materialize
ordinary editable tracks. A user can retarget, edit, disable, or remove them;
removed defaults never silently reappear. Renderer-owned clocks should be
converted only when the exposed animated parameter is the renderer’s real
consumed value. Unbounded simulations retain semantic speed/controller inputs
until an equivalent graph-native transport exists.

## Media, 3D, ISF, and external resources

The selected project folder and `project.json` are authoritative. Media paths
may contain subfolders, but UI labels default to the current filename rather
than exposing the complete path. Resource identity remains stable and separate
from its display label.

The host owns one decoder per media identity and its playback lifecycle; graphs
own selection, trim, speed, fit, mirroring, and conversion. Multiple consumers
of one video share retained decoding, while distinct videos keep independent
state. Overlapping consumers must not release a shared decoder early. During
load, seek, loop, or async replacement, retain the last complete valid frame;
never publish black, transparent, placeholder, or partially initialized output
as a successful cache result.

Resource discovery publishes cumulative authoritative batches. Primary media
becomes available before derived renditions; rendition completion never gates
the source. Readiness/revision travels through typed value ports and emits one
dependent resource-dirty wakeup. Preview and standalone Output receive an
authoritative baseline before compiling; `null` is not a renderable boot state.
Every URL, decoder, capture, texture, buffer, program, target, and derived cache
has explicit release ownership.

3D remains composable:

```text
Mesh Resource -> Transform/Material -> Scene Object
Scene Objects -> Object Collection -> Scene3d
Scene3d + Camera -> Scene to Image
```

Scene3d is typed data, not a second renderer. Mesh readiness is atomic. Geometry
detail selects retained mesh LOD through output/ROI demand; draw mode is a pass
over that selected topology. STL/OBJ preparation, simplification, winding repair,
derived caches, transforms, clipping, and material parameters belong to
`mesh-engine`, not generator-specific host branches.

ISF is a portable shader format, not the center of the application architecture.
Built-in, exact installed-package, and project libraries merge into one resolved
catalog. Repository files are pinned and conform to the strict
`vj1-isf-webgl2@1` profile; compatibility canonicalization happens at ingestion,
never per frame. Effects receive their preceding texture as `inputImage` and
additional image inlets lower to ordinary explicit source edges. Audio/FFT,
events, imported resources, custom vertex stages, multipass, persistence, and
float targets are shared host capabilities with retained ownership. Persistent
history has stable full-frame targets and program-local frame clocks. Package
versions and content integrity fail closed when missing or modified.

## Runtime, persistence, UI, and diagnostics

`OutputRenderer` is a composition root, not a feature container. Dedicated
runtimes own state activation, program compilation, demand, evaluation, media,
targets, shaders, ISF, transitions, Surface planning, interaction, readiness,
presentation, metrics, and disposal. Capabilities communicate through injected
contracts; do not restore forwarding methods, duplicate maps, source-name
dispatch, or alternate registries.

Preview activation is scoped. Navigation retains programs; structural changes
recompile only reachable ownership scopes; parameters, transforms, boundaries,
animation fields, and Live overrides cross as compact retained patches. A patch
accepted by Preview remains authoritative through pointer release and deferred
DOM reconciliation. Direct manipulation may keep an optimistic local overlay
only for its active pointer transaction.

Autosave snapshots immutable authored truth before asynchronous serialization.
Runtime/UI events do not autosave. Complete state transport is reserved for
restore, resync, and topology/routing changes; stable identity, not a current
array index, selects patch targets. Browser module coherence has one revision
owner in `index.html`; local imports remain queryless to avoid duplicate module
identities and split singletons.

Live session state is a versioned project-scoped checkpoint for selected
Mapping, routes, visibility, presentation settings, and temporary overrides.
Restore validates identities and activates atomically. Transition progress,
runtime resources, and decoded content are never checkpointed.

UI should be assembled from shared primitives: section, list, thumbnail card,
element row, parameter row, slider, select, color input, toggle, search, modal,
and media picker. One semantic control owns styling, keyboard behavior, context
actions, defaults/significance support, disabled state, spacing, and focus.
Feature views configure primitives instead of cloning markup and event logic.

Signal-load diagnostics measure state publication, wakeups, compilation,
resource revisions, cache activity, and presentations at shared boundaries.
Successful cache reuse and ordinary presentation are throughput, not pressure.
Warnings must name the responsible domain and must not misattribute control-DOM
cost to rendering or GPU cost to CPU work.

## Change workflow and verification

Before changing a complex path:

1. identify canonical state, compiler, runtime owner, cache/resource owner, and
   Preview/Output consumers;
2. reproduce and measure the failure in the responsible domain;
3. design the smallest change at the shared authority;
4. add a focused failing test, then implement;
5. verify clean reload, Preview/Output equivalence, disposal, and performance
   proportional to risk;
6. preserve unrelated dirty work and report any remaining uncertainty.

Common verification from `experiments/vj1`:

```sh
npm test
npm run test:metrics
npm run test:render
git diff --check
```

Use browser/WebGL smoke and stress harnesses when work touches real shader
compilation, media lifecycle, persistent targets, context recovery, or
Preview/Output synchronization. Never claim performance from unit tests alone.

Important references:

- Project model/routing: `js/domain/models.js`, `project-migrations.js`,
  `live-projection-program.js`, `scene-routing.js`.
- Compilation: `js/libraries/composition-engine/shared/`.
- Render contracts: `js/libraries/render-engine/` and
  `ARCHITECTURE_CLEANUP.md`.
- Node platform: `js/libraries/node-engine/` and `NODE_ARCHITECTURE.md`.
- Visuals/libraries: `js/libraries/visual-nodes/`, `visual-library/`, and
  `visual-library/ISF-WEBGL2-PROFILE.md`.
- 3D: `js/libraries/mesh-engine/` and `terrain-engine/`.
- Runtime: `js/output/output-renderer.js` plus the focused runtimes beside it.
- Persistence/transport: `js/services/project-serializer.js`,
  `project-folder-service.js`, and `output-bridge-service.js`.
- Editor/UI: `js/control/`, `style.css`.
- Active product ideas and design notes: `projectnotes.md`.
