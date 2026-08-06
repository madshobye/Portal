# VJ1 Architecture Guide

Snapshot date: 2026-08-06

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
- Feature scope is subordinate to architecture. Defer, reduce, or drop behavior
  that cannot fit the established node, Component, service, or render contracts
  without substantial special-case code. More behavior is not progress when it
  weakens the reusable system.
- Slow down when the cause is uncertain. Instrument, profile, and isolate the
  failing authority before changing code. It is acceptable to stop rather than
  weaken the architecture.
- Preserve established product behavior unless a design change has been
  discussed explicitly.
- Authored project state is the only user truth. Compiled plans, execution/UI
  projections, controls, thumbnails, caches, and runtime resources are derived.
- Derived state must be correct before first execution. A later movement,
  refresh, or unrelated edit must never be required to repair it.
- Invalidation is semantic and narrow: a parameter wakes its owner, placement
  wakes composition, and resource readiness wakes only its consumers.
- Do not silently fail or silently select a weaker path. Errors and meaningful
  fallbacks emit tagged console diagnostics with the cause and chosen behavior.
- Distinguish an unchanged command from a rejected command. A semantic no-op is
  expected and stays quiet; a rejected event, patch, protocol message, resource
  activation, or compiled synchronization emits a structured diagnostic at the
  boundary that rejected it.
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

p5 is the browser canvas, media-wrapper, and interaction host, not the preferred
frame-critical drawing backend. Text, curves, repeated geometry, effects, and
pixel-intensive visuals use retained shaders, SDF techniques, cached
rasterization, or explicit optimized kernels. A p5 drawing path is acceptable
only when it is bounded, measured, and declared by the owning node or compiler.

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

The generated Component Group is the sole editable authority for visual order,
nesting, configuration, and stable node identity. Component and Live layer UIs
are read-only projections of that Group and write back through `nodeId` plus a
configuration-relative path. `component.chain` may exist only as a disposable
execution projection produced from the graph; no active control, diff, patch,
compiler decision, or renderer address may use its positional indices. Older
positional addresses are converted once by project migration and are rejected
by the active runtime afterward.

There is no universal scheduled graph interpreter in the render loop. Ordinary
control/data graphs run when invoked. Visual Groups compile before rendering to
allocation-stable direct programs. Public controls bind to the child parameter
or unconnected inlet that owns the behavior; they cannot override a graph-driven
inlet. Specialized native operations are allowed only as explicit node-owned
lowerings with tests or metrics and an ordinary typed contract around them.

Project-global transports such as DMX, MIDI, OSC, capture, and audio analysis
are services, not hidden Component state. Nodes expose typed values/events to
those services. A service has one resource owner, one lifecycle, and one cadence.
Picker media thumbnails follow the same rule: the media-thumbnail handler owns
bounded image, video-frame, STL, and OBJ thumbnail generation, URL creation,
invalidation, and final cleanup. Every media thumbnail and every Component
thumbnail shares `ProjectDerivedAssetStore` and `vj1-cache/thumbnails`; media
filenames include their source revision. None is authored state. UI nodes only
acquire and release display claims, so closing a modal cannot invalidate an
unchanged generated thumbnail or cause the full source media to be decoded.

The Application graph is both compiled bootstrap topology and indexed runtime
dataflow, but it is not a universal graph scheduler. Dependency edges compile
once into service construction order and injected capabilities. Dataflow edges
compile once into direct event routes between registered ports. Emitting a
runtime event follows that index without traversing the graph, and rendering
never evaluates the Application graph per frame. The graph remains an honest
description of infrastructure ownership and runtime communication while
specialized services retain their appropriate execution models.

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
   dimension exactly and crops the other. Media preserves its intrinsic
   proportions throughout import, demand, placement, caching, and rendering;
   `cover` or `contain` is the default, and stretching is always an explicit
   authored choice.
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
6. **Surface geometry stays authoritative.** A transition retains the exact
   outgoing executable branch but projects it through current calibration;
   transition state never carries a second serialized Surface program.
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
    zoom/pan changes transient presentation navigation only; it is not project
    state, resets to the centered World view on project load, and must not
    rewrite authored parameters, recompile, or become render demand.

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

Each Surface transition is a retained two-slot compositor. The active slot
continues executing live while the inactive slot is armed with the incoming
Live program, media, and resources. Before arming, the shared renderer transfers
ownership of the exact currently executing Component programs into the active
slot; that branch includes its applied Live parameters, temporal state, and
resources and is never reconstructed from authored Components or a diff-bank
guess. The inactive compiled program is adopted without a second compilation.
Its first valid render occurs at mix zero, and only then does the renderer-local
blend clock begin. Both endpoints continue evaluating while the compositor
projects them through current Surface calibration. Completion swaps active and
standby roles and releases only the obsolete executable branch; the Surface A/B
targets and transition kernel stay mounted for reuse. Static endpoint results
are keyed by semantic state rather than A/B role. Preview and standalone Output
use this same preparation, activation, and compositor lifecycle.

The destination-scoped transition coordinator owns effect parameters, target
routing, requested duration, and latest-wins pending commands. Renderer-local
lanes own the actual blend start because resource preparation is host-local;
Control completion cannot truncate a later-starting Preview or Output blend.
Different Surface lanes may run concurrently; Overall arbitrates with them.
Scheduling and promotion are event-driven control work. Live stores stable IDs
and serializable parameters, never executable functions or a serialized
`fromProgram`.

## Animation and live control

Temporary Live parameters are one sparse `parameterDiffs[targetId]` authority,
never an active copy plus retained per-target copies. Preview and standalone
Output materialize the same compiled Live program from authored Components and
the selected target's diff bank. Editing an authored Component parameter also
updates an existing matching diff in the active Live bank atomically, so the
editor, Live controls, Preview, and Output cannot later restore competing
values. Structural reconciliation rebases sparse chain entries by stable item
identity. A transition only retains the already-running compiled branch; it
does not snapshot or merge a second parameter authority.

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

The media system derives and retains representations sized for actual output
demand. Users select content and authored quality intent; they do not normally
manage intermediate resolutions or caches. Derived renditions are disposable
runtime resources and never replace or modify the authoritative source.

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

Startup is itself UI-node-owned. `index.html` creates `StartupStatusNode` through
`startup.js` before the service-worker source-coherence gate, then passes that
retained surface into `startVj1App()`. Control startup keeps it visible while the
application graph initializes and the stored project restore reaches an
authoritative outcome; only then is it disposed and the control shell mounted.
Output/Preview modes dispose it immediately before mounting their presentation
surface. Startup errors update this node rather than replacing the page with
application-owned HTML.

`OutputRenderer` is a composition root, not a feature container. Dedicated
runtimes own state activation, program compilation, demand, evaluation, media,
targets, shaders, ISF, transitions, Surface planning, interaction, readiness,
presentation, metrics, and disposal. Capabilities communicate through injected
contracts; do not restore forwarding methods, duplicate maps, source-name
dispatch, or alternate registries.

Source rendering keeps three explicit responsibilities: the coordinator selects
the compiled backend and retained render process; `SourceMediaResourceRuntime`
owns media discovery, readiness, acquisition, and resource identity; and
`SourcePlacementRuntime` owns demand rectangles, content transforms, placement,
and drawing into the requested target. Backend-specific execution remains behind
declared compiler metadata or a registered native renderer rather than growing
source-name branches in the coordinator.

Preview and standalone Output are presentation hosts around the same renderer,
not separate rendering implementations. Their shared host lifecycle owns setup
claiming, resize observation, deferred resize delivery, and disposal. A host may
add transport or editor interaction, but wake/suspend, readiness, patch,
transition, projection, and rendering semantics stay in shared runtimes.

Preview activation is scoped. Navigation retains programs; structural changes
recompile only reachable ownership scopes; parameters, transforms, boundaries,
animation fields, and Live overrides cross as compact retained patches. A patch
accepted by Preview remains authoritative through pointer release and deferred
DOM reconciliation. Direct manipulation may keep an optimistic local overlay
only for its active pointer transaction.

Render patches have one stable address: target kind, Component ID, optional
graph node ID, and a path relative to that node's configuration. Compound UI
controls translate at the input boundary into canonical fields—for example,
Boundary scale writes aspect-preserving Boundary width and height patches rather
than inventing a persisted `boundary.scale` field. Preview and Output apply the
same patch runtime and compiled-program synchronization. A rejected patch emits
one deduplicated `VJ1_RENDER_PATCH_REJECTED` warning per semantic address with
host identity, reason, patch identity, and Output transport revision when one
exists. Rejection is never inferred from a routine state update returning
unchanged.

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

`ui-engine` is the reusable retained UI layer on top of `node-engine`. UI node
definitions use the same typed/versioned package registry as other nodes while
adding a DOM lifecycle (`mount`, `update`, `dispose`, and optional named child
slots), semantic state addresses, and DOM-free commands. The registered catalog
currently contains 40 nodes:

- structure: Workspace Shell, Layout, Host Region, Panel, Section Header, Tabs,
  Modal, Popup, Preview Surface, Output Surface, and Presentation HUD;
- collections: Collection, List, List Button, Thumbnail Button, Catalog Picker,
  and Library Catalog;
- controls: Button, Toggle, Slider, Range, Select, Text Input, Color Picker,
  Markdown Input, Choice Group, Resource Button, and Parameter Animation Editor;
- display/editor/reporting: Text, Startup Status, Diagnostics, Metrics Summary,
  Analysis Report, Node Definition Studio, Node Graph Editor, and Node Definition
  Editor;
- browser integrations: Global Input, Clipboard, File Download, and Window Open.

This list is generated by the one `UiNodeDefinitions` catalog. Adding a visible
mechanism requires a named reusable node in that catalog, or a composition made
only from registered nodes. `RetainedUiRuntime` instantiates declarative
`ui-graph` scopes, retains an instance when its scope, node ID, definition, host,
and state address remain compatible, and disposes removed ownership in reverse
order. A node is never moved between unrelated view hierarchies merely because
its type or data is similar.

The library owns node HTML, browser events, keyboard behavior, focus, local
interaction state, and event normalization. The VJ application never owns those
details. Compound nodes may have private DOM internally, but that DOM remains a
single registered node's implementation rather than an application escape
hatch. Range owns both endpoints and one paired value. Markdown Input owns its
contenteditable surface and serialization. Catalog Picker owns its modal,
filtering, cards, media claims, and release lifecycle. Diagnostics, Metrics,
the node editors, Preview/Output surfaces, and Presentation HUD are likewise
registered compound or integration nodes.

There are currently two composition helpers under `ui-engine/compositions`:

- `createThumbnailCatalogModel()` configures Collection → List → Thumbnail
  Button, including fill/overflow, search, selection, actions, and a stable
  state address;
- `createParameterInspectorModel()` configures the shared Tabs contract for a
  descriptor-driven parameter inspector.

Do not claim another hierarchy is library-owned until it actually has a shared
composition there. In particular, the artifact inspector is currently a shared
VJ model in `control-ui-program.js`, not a library composition. Component and
Scene do, however, pass the same `componentOverviewUiModel()` and
`componentElementsUiModel()` branches to that model. Their element-list DOM and
behavior therefore come from the same List node; only projected data and
semantic commands differ.

`ui-model@1` is the application-neutral hierarchy above that graph. Applications
describe nested applications/views, layouts, panels, tabs, collections,
parameter groups, ordinary controls, and specialized hosts. `compileUiModel()`
recursively lowers the hierarchy into the existing `ui-graph`, deriving named
slots, collision-safe path identities, semantic state addresses, and command
bindings. `createUi({ host, model, onCommand })` owns one retained runtime and
exposes only `update(model)`, `dispose()`, and retained-node/element lookup for
specialized integration. Updating a model reconciles compatible nodes in place;
it does not rebuild an independent DOM or application-state tree. Models contain
plain data and semantic actions only—function handlers and DOM authority are
rejected at the compiler boundary.

The VJ application UI boundary is strict and test-enforced. Application
projections may supply hierarchy, semantic presentation names, item/control
data, state addresses, and commands, but never HTML strings, DOM construction,
DOM selectors, browser event handlers, or CSS class names. The architecture
test scans every `js/control` module for those APIs and for removed presenter or
generic-host escape hatches. Specialized renderer/editor integrations receive a
named host owned by a registered UI node; their private canvas or resource
lifecycle does not authorize surrounding application DOM. UI graph inputs and
command bindings recursively reject functions.

`parameterUiGraph()` is the application-neutral descriptor adapter for ordinary
numeric, paired-range, boolean, enum, color, text, Markdown, event, and
enumerated-input parameters. Domain adapters provide semantic addresses,
values, constraints, defaults, and commands; the library chooses and composes
the retained control nodes without learning VJ, synth, or DJ schemas. Context
gestures are semantic node commands as well, so reset and application-specific
parameter actions do not depend on library DOM markup.

`parameterUiNodes()` provides the identical projection as a composable branch
inside Panels and other graphs; inspectors must not mount a second raw-control
parameter path. Parameter presentation is an explicit library input rather than
an application-supplied bundle of DOM classes.

UI state has explicit ephemeral, session, or project lifetime and is addressed
by semantic identity rather than DOM position. `createRetainedScrollController`
commits scroll synchronously on scroll and before pointer-driven reconciliation,
then restores from the UI state controller. This is the one intended scroll
contract for List and other retained scrolling nodes. Controlled selection
still comes from canonical application state. Scroll restoration currently
depends on retaining or reattaching the same semantic state address; Component
and Scene catalog/element selection still has reactivation cases where the
viewport jumps. Treat those failures as violations of the shared node contract,
not as reasons to add view-specific scroll handlers.

A UI node emits `change`/`commit` or semantic actions to the controller; it never
edits project or Live state directly. Persistent parameter commands enter the
same authority as other authored edits, preserving render-patch and Live-diff
semantics. Controllers route on semantic action and address rather than node ID,
DOM selector, or current list index.

The control workspace columns are a configured Layout node. The Component rail
and both halves of the Scene and Mapping rails are generic Collection nodes
that compose the same List behavior with retained headers, local search where
configured, and semantic tool actions; the
application supplies only item/action descriptors. Scene and Surface
collections are children of one retained Layout graph. The Surface Collection
configures generic leading actions, clipboard paste scope, selection, and List
reordering. Its descriptors are projected from executable `state.surfaces`,
but visibility commands resolve by stable Surface identity to the selected
Mapping's authored Surface before writing. Reorder and removal remain canonical
store actions, so direct Surface mounts and Scene-mediated mounts retain the
same domain behavior while the UI has one DOM/event owner.
The Mapping graph projects Mapping cards and authored Mapping Surfaces as data,
composes a generic Text Input into the Surface Collection title slot, and
composes a generic Toggle into its tools slot for the test pattern. Its Scene
Mapping membership row is a disabled List selection with a semantic leading
action; it changes the Mapping default without becoming another routing model.
Collection/List context menus likewise cross a semantic `itemContext` command,
so converting a Component to a Scene no longer depends on catalog HTML.
Thumbnail cards, markers, item actions, selection, keyboard navigation, search,
and scroll restoration are therefore data-driven configuration rather than
separate card templates or binders.

Component editing is projected as Component Collection → artifact inspector
Panel → quick-toolbar Layout + Elements List → parameter Tabs/controls. The
Elements List derives from the canonical Component Group by stable node
identity. It owns row DOM, selection, keyboard focus, scroll, nested drop
targets, and clipboard targeting. There is no parallel Scene row renderer:
Scene editing calls the same `componentElementsUiModel()` and changes only the
domain projection. Its Surface Collection remains a sibling view of the
selected Mapping's authored Surfaces. Choosing a Surface changes the mutually
exclusive inspector target; it never copies Surfaces into Scene state or
changes direct-versus-Scene-mediated mounting rules.

The Live source rail is a retained Collection with composed Scene/Part Toggle
nodes and a retained timing Panel. The Live projection rail is one retained
Layout containing the Output Collection, significant-control Panel, and
Component navigation Collection. Its item descriptors are a read-only
projection of the selected Mapping and materialized Live routes. Semantic
commands call the same store operations that drive Preview and standalone
Output; there is no separately maintained window-output model. Selecting Scene
Mapping changes only the inspected presentation to flat Scene space with guides,
while selecting a Surface shows its complete projected result. Visibility and
source actions preserve the Overall-versus-direct mounting precedence described
above and never infer routing from Collection DOM.

Mapping Surface calibration uses generic Slider and Select nodes. Scene Surface
geometry edits use the same generic controls and write the canonical Mapping
Surface addresses; direct-output Surfaces follow the same path. Live public
Component controls, selected-element General and ordinary Primary/Details
parameters, timing, transition parameters, and significant-value controls are
retained graphs of the same generic controls over canonical Live/session
addresses. Significant-value commands write the one sparse Live diff bank;
authored Component or Scene edits atomically update a matching active diff
rather than maintaining a competing Live model. Live retained controls also
write that bank directly; a temporary merged model may be materialized for
execution but is never another maintained authority. Project Settings delegates
its overlay lifecycle, tab selection, panels, and controls to generic Modal,
Tabs, Panel, and control nodes. Component, Scene, and Live parameter-view tab DOM
and keyboard navigation are owned by generic Tabs nodes at semantic
project/component/element addresses; feature-specific content occupies retained
named slots. Nodes, Component, Scene, and Live inspectors use the shared VJ
artifact-inspector model over generic Layout and Panel nodes. Titles, thumbnails,
title editing, and header actions are descriptors owned by those nodes;
specialized editors mount only into named node-owned content slots.
The selected Component/Scene element's General controls and ordinary
Primary/Details effect or generator parameters are retained parameter graphs.
Paired ranges compile to one generic Range node and commit both persistent
endpoints or both sparse Live diffs atomically. Markdown parameters compile to
one generic Markdown Input node; related style toggles resolve through descriptor
data and write authored values or the same sparse Live diff bank without DOM
selectors or a second editor model. Media/source/element selection uses the
generic Catalog Picker node. The application supplies section, item, category,
selection, action, and lazy-media descriptors; the node exclusively owns its
overlay, search/filter behavior, card DOM, media acquisition/release, scroll,
and session restoration. Generator parameters declare media inputs through the
ordinary `ui: "media"` parameter contract; the Component inspector projects
those descriptors into Resource Button nodes and opens the same Catalog Picker
command path. It does not use generator-specific media HTML or click binders.
Preview viewport tools are a retained Layout of generic Button nodes that emit
semantic zoom, fit, quality, diagnostics, and mapping-handle commands. Preview
Surface and Output Surface own stable renderer hosts; Presentation HUD receives
structured data and owns HUD DOM. Workspace reconfiguration must not remount a
renderer host or reuse a node from a different view hierarchy. Node Library,
editors, menus, diagnostics, settings, modals, lists, parameters, Mapping, Live,
Preview, and standalone Output all enter through registered nodes. Each visible
surface has one DOM/event owner; removed legacy presenters are not fallbacks.

Structural layout belongs to `ui-engine/base.css`; reusable compact VJ
presentation belongs to `ui-engine/themes/vj.css`; `style.css` is limited to
root/bootstrap/document and renderer-canvas concerns. `LayoutNode` uses Flexbox
for row and column orientation and CSS Grid only for explicit grid orientation.
Its slots own grow, shrink, basis, fill, and overflow. A theme may style
spacing and surfaces but must not replace that structural algorithm. At this
snapshot, a broad Studio Inspector theme rule still changes every nested Layout
content container to Grid and violates that contract. It causes content-dependent
inspector widths and stretched vertical distribution and must be removed at the
shared theme boundary, never compensated separately in Component or Scene.

Panel and Collection create the same `SectionHeaderNode` for titled sections;
it owns header height, typography, icon, media, and action slots. The current
Diagnostics compound node is registered and remains inside the no-DOM
application boundary, but it still constructs its own private title, status,
and action header rather than composing Section Header and Button nodes. Its
typography and spacing can therefore differ from ordinary sections. That is the
current implementation, not an alternate style contract: convergence belongs
in the library compound, never in VJ-specific markup or controller CSS.

`index.html` remains the one revision owner for styles and browser modules.

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
- Application topology/dataflow:
  `js/libraries/composition-engine/application-program/index.js`.
- Render contracts: `js/libraries/render-engine/` and
  `ARCHITECTURE_CLEANUP.md`.
- Node platform: `js/libraries/node-engine/` and `NODE_ARCHITECTURE.md`.
- Visuals/libraries: `js/libraries/visual-nodes/`, `visual-library/`, and
  `visual-library/ISF-WEBGL2-PROFILE.md`.
- 3D: `js/libraries/mesh-engine/` and `terrain-engine/`.
- Runtime: `js/output/output-renderer.js`, `presentation-host-lifecycle.js`,
  `live-render-patch-runtime.js`, and the focused runtimes beside them.
- Device services: `js/libraries/device-engine/`.
- Persistence/transport: `js/services/project-serializer.js`,
  `project-folder-service.js`, and `output-bridge-service.js`.
- Editor/UI: `js/control/control-ui-program.js`,
  `js/libraries/ui-engine/`, and `style.css`.
- Active product ideas and design notes: `projectnotes.md`.
