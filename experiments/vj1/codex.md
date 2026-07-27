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
is **39**. Authored sources are `generator` or `component`; legacy records become
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
  diagnostics, synchronization, and DMX fixture libraries.
- `visual-nodes`: reusable primitives and compounds with metadata, editable
  code/shaders, and declared native capabilities.

Nodes own semantic values and algorithms, not decorative wrappers around hidden
host behavior. Saved graphs are editable authority. Compilers may lower them to
direct calls, retained targets, fused shaders, or small native kernels.

Project-global hardware transports live outside Components. `devices.dmx`
persists fixture profiles and patching; the global DMX service alone owns the
serial port and steady universe cadence. A DMX Probe is a spatial passthrough
observer that publishes fixture-semantic values to that service. Fixture
profiles define channel count, roles, and sample topology, so one-channel,
RGBW, and multi-zone fixtures share the same graph element.

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
the Transport may be an `Animation Sequencer -> Animation Curve`, a
retriggerable piecewise `Segment Envelope`, or deterministic scalar `Noise`.
Noise may be multiplied by an Envelope for a bounded triggered burst. An
optional allocation-stable Smooth stage supplies a time-correct running average
before `Map Range -> Numeric Combine -> $parameter`. The Sequencer owns
automatic/triggered loop and ping-pong timing, endpoint pauses, and
one-leg/full-sequence trigger semantics. Curves and Envelopes are bounded
mappers; Mapping converts normalized output into parameter units. Combination
explicitly replaces, adds to, or multiplies the authored base value; the
generated scalar control remains the base authority rather than becoming
separate animation state.

An Animation track may replace its Timeline source with a typed retained live
signal while keeping the same Mapping, Combination, and parameter Sink.
Pointer X/Y/down/inside, analyzed audio level/peak/low/mid/high and adaptive
overall/low/mid/high beat pulses, and local Probe color features are available
through the Driver selector. Pointer publication is normalized to the
presentation canvas, shared from Live Preview to Output, and remains entirely
dormant unless a compiled program declares a pointer dependency. Audio capture
is requested lazily by the audio control node; its analyzer is the only live
driver that deliberately retains frame cadence.

Probe is a visual passthrough observer in the ordinary Component/Scene chain.
Its Boundary position and scale define the sampled area. Only a Probe address
referenced by a compiled local Animation track activates observation. The
renderer averages a fixed 4x4 lattice into one retained 1x1 GPU target, reads
one pixel at the Probe's configured rate (15 Hz by default), and publishes only
the demanded normalized brightness, RGB, HSV, or alpha values. The control
program consumes the retained result on the following frame; Probe never
copies a full framebuffer, writes project state, or introduces a parallel
render loop.

Trigger routing is explicit graph wiring. Manual buttons, exact Component-Time
periodic events, deterministic random events, pointer press, analyzed audio
beats, and Probe threshold crossings each produce the same event contract.
Manual trigger buttons publish sequence-stamped application control signals to
Preview and Output; they never write project state, create history, autosave, or
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
state.

Visual definitions may declare an ordinary numeric parameter's editable
`defaultAnimation`. Project preparation materializes that declaration through
the same six-stage graph exactly once and records a versioned handled marker on
the target node. The resulting track is not privileged: users can edit,
disable, or remove it, and removal does not cause it to reappear. A converted
visual must expose the value actually consumed by its renderer (for example a
bounded periodic phase), migrate any legacy rate into the initial track timing,
and remove the old renderer-owned clock. Unbounded simulations such as Terrain
flight keep semantic speed/controller inputs until they have an equivalent
graph-native transport; they must not be disguised as bounded phase loops.
`defaultAnimation` and `suggestedAnimations` are editor recipes, not runtime
states: the Animation inspector lists recipes that can create an ordinary track,
hides recipes for parameters that already have one, and offers a removed default
again as an explicit suggestion instead of silently restoring it.

The first Animation iteration is numeric-only. Triggered organic motion extends
the graph with reusable finite Envelope nodes rather than effect-specific
sequencer modes: Heartbeat is a trigger feeding a retriggerable double-beat
envelope preset. Stochastic motion is a bounded deterministic Noise control
source that can run continuously or through a trigger-gated burst envelope.
Running Average is a separate allocation-stable signal processor so Probe,
mouse, FFT, sensor, noise, and other live controls can opt into smoothing
without changing their source or target. These nodes feed the existing Mapping
and Combination stages. Cross-scope/global Probe routing, color interpolation,
and format-specific conveniences such as ISF parameter metadata are later typed
extensions of this control graph, not new animation engines.

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

Live transition lifecycle is destination-scoped. `transitionCoordinator` owns
one active and one latest-wins pending snapshot per Overall or Surface
destination. Different Surface lanes may run concurrently; Overall is exclusive
with them. Both endpoints are snapshotted so an armed command cannot retarget an
in-flight fade. Deadline scheduling and pending promotion are event-driven
Control work outside the frame loop; renderers only derive progress and compose
the active endpoint set.

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
transition lowering. The first curated Vidvox proof slice adds 23 original
fragment sources under `visual-library/shaders/isf/`: 6 generators, 8 effects,
and 9 transitions. The second tranche brings the collection to 40 shaders:
10 generators, 17 effects, and 13 transitions pinned to upstream commit
`395072d48b3ce7351ccb20a5fda54470591324df`. At that stage it excluded custom
vertex stages, audio/FFT, imported images, events, and extra non-transition
image inputs. Tranche two deliberately includes persistent, float-buffer, and
multipass shaders supported by the common runtime. Canonical VJ1-profile source
remains the file-backed authority; catalog metadata supplies stable application identity and
presentation without merging shader bodies into JavaScript. Generator and
effect cards remain in their ordinary categories and are additionally
discoverable through the `ISF` picker filter. Metadata declares host contracts;
it never embeds arbitrary JavaScript.

A focused multipass comparison tranche brings the collection to 42 shaders.
Dilate and Erode retain their upstream behavior and attribution after
canonicalization and exercise the same full-size, two-pass,
non-persistent named-target path as Ghosting.

The audio tranche brings the collection to 45 shaders (12 generators, 20
effects, and 13 transitions). FFT Color Lines, FFT Filled Waveform, and
Waveform Displace retain their upstream behavior and attribution after
canonicalization. ISF `audio` and
`audioFFT` inputs are host resources backed by the existing native Web Audio
analyser: one retained waveform texture and one retained FFT texture are
updated once per analysis frame and reused by every audio shader. Audio inputs
do not become graph texture ports and do not create a second analyser.

The event tranche brings the collection to 47 shaders (13 generators, 21
effects, and 13 transitions). Shockwave Pulse and FFT Spectrogram retain their
upstream behavior and attribution after canonicalization. An ISF `event` input materializes as a momentary
control, schedules an `isf-event` for the owning visual instance and parameter,
and is true only while that frame's drained event list is rendered. It resets
on the next frame without entering project state, history, or autosave. The
Animation editor can also author a typed event-automation track whose manual,
periodic, random, pointer, audio-beat, or Probe source feeds the visual event
parameter directly. Stable graph event tokens become one-frame shader pulses;
holding the same token never retriggers, and multipass shaders see the pulse
consistently in every pass of that frame. Each renderer treats its first
observed token as a baseline, so opening Live or a standalone Output never
replays an event that happened before that renderer joined. Live's
`componentOutput` map is per-frame: it is cleared once before Surface routing,
then shared by all Surfaces in that frame. Frame-dynamic control programs
therefore continue to execute in Live without sacrificing same-frame fanout.

The imported-image tranche brings the collection to 49 shaders (14 generators,
22 effects, and 13 transitions). Cursor and Cursor Overlay retain their
upstream behavior and attribution after canonicalization and share the exact
pinned `cursor.png` payload.
`IMPORTED` paths are validated as safe relative paths, resolved by the
built-in repository into closed immutable descriptors, and loaded lazily by
one renderer-owned retained cache. A resource is uploaded once and reused by
every shader instance; readiness changes the normal external-resource cache
key and invalidates presentation once, without making a static shader
frame-dynamic. The resource cache follows the same prune/dispose lifecycle as
other ISF state.

The compatible-library import brings the built-in collection to 307 pinned
ISF files: 49 generators, 202 effects, and 56 transitions. Thirty-eight files
have a paired custom vertex stage. All repository
sources use the VJ1-owned `vj1-isf-webgl2@1` profile and execute on a dedicated
GLSL ES 3.00/WebGL2 shader path; ordinary non-ISF rendering remains unchanged.
Legacy project/library files are canonicalized at the project-ingestion
boundary, including the older empty `IMPORTED: []` spelling, while their files
remain untouched and the parser/compiler/runtime stay profile-strict.
A deterministic importer checks the upstream tree against the runtime's existing
pass, input, and resource contracts, canonicalizes legacy fragment syntax
offline, and adds 258 compatible files to the earlier proof tranches. Effects keep their
preceding composition texture as the automatic `inputImage`; generators and
effects persist any additional named image inlet as an authored visual source.
Compilation lowers those choices into ordinary hidden source nodes and explicit
texture-DAG edges, so media, generators, and Components reuse the same retained
render path without per-frame graph traversal. ISF image rectangles, sizes, and
storage orientation are host uniforms derived from those retained textures.
Runtime node creation rejects missing or legacy profile markers, so compatibility
work never enters the frame loop. The rules and migration check live in
`visual-library/ISF-WEBGL2-PROFILE.md`. The real-WebGL
architecture smoke compiles the complete installed catalog in Chrome. Optional
same-stem `.vs` files are canonicalized offline, carried by repository,
project-folder, and package descriptors, and paired with their fragment stage
in the retained WebGL2 program cache. Their source hash participates in program
identity so edits invalidate exactly the affected programs. Custom vertex
stages on transitions are still rejected because transition kernels use a
separate host geometry contract. Two three-image Live transitions whose extra
input belongs to the Surface-transition renderer, unbundled imported resources,
and 17 files that do not compile under the WebGL2 profile remain excluded.
The repository loader fetches the expanded source set with bounded concurrency
while preserving manifest order and strict identity validation.

The ISF backend owns retained pass state generically. Persistent passes use
instance-owned ping-pong framebuffers, including float attachments, and
full-screen shader writes replace their destination without blending. A
full-frame source owns one stable node-boundary target; the compositor extracts
only its visible ROI afterward, so clipping and small boundaries never resize
or reseed persistent history. Single-pass ROI-safe sources still allocate only
their visible output pixels. `RENDERSIZE` describes the complete physical
boundary independently from Content placement, which is applied once through
the UV transform. ISF effects declare editable boundaries separately from
spatial field transforms, preserving local-effect fusion while exposing the
shared preview boundary handles. A strict pass-dimension evaluator supports
ISF arithmetic plus the repository's
standard `floor`, `min`, and `max` functions while rejecting all other calls.
A program-local `FRAMEINDEX` begins at zero when a shader instance, source hash,
pass geometry, or resolution changes, so first-frame initialization never
depends on the age of the Output renderer. Pass targets and their frame clocks
share pruning and disposal lifecycles. When the final ISF pass is itself a
retained target, the effect boundary commits that returned texture into its
evaluation-owned output; retained history never silently replaces cache
ownership or leaves the published buffer empty. ISF coordinates remain
bottom-left as specified, while every image macro crosses once through the
shared render-target orientation contract before sampling; individual shaders
never add corrective flips. The curated collection now proves this contract
with Comet Tails, Freeze Frame, Slit Scan, and the two-pass Ghosting effect
without shader-specific exceptions.

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
Direct manipulation owns an optimistic local transform/Boundary overlay only
while its pointer transaction is active. A retained patch to the same semantic
item record acknowledges or supersedes a completed gesture, so a later
inspector control can never have an older handle value restored over it.

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
  changes. Chain-item patches carry stable item identity; array paths are only
  the current editor projection and never decide which compiled item receives
  a value. Stale clients and incoherent source revisions fail closed.
- Browser source coherence has one graph-wide owner: the source-worker revision
  in `index.html`. Local JavaScript imports are queryless so one file has one
  module identity. Never restore per-import `?v=` tags; they duplicate module
  evaluation and split registries/singletons under different URLs.
- File/object URLs, decoders, captures, models, buffers, programs, and targets
  have explicit release ownership.
- Canonical state must remain structured-cloneable.
- Preview and Output sample one Control-owned `metrics.sessionTimeline` carrying
  a revision, logical epoch, play state, rate, and session seed. Local
  presentation clocks still classify cadence, but they are not animation-time
  authorities. Play and time-stretch commands rebase the shared epoch at the
  command boundary; visual nodes consume logical time and never read wall time.
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

The real-WebGL browser architecture and persistent-ISF smokes must also pass.
They cover compiled shaders, transitions and endpoint equivalence, ROI crop
equivalence, ordinary and retained-value Groups, semantic 3D, aggregate
CPU/Overall metrics, resource revisions, balanced GPU/browser resources, and
two-frame float ping-pong history initialized at a nonzero host frame.

At source coherence revision **214**, semantic sources, typed
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
automated suite passes **1,475 tests**. The top-bar Signal load indicator and
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
