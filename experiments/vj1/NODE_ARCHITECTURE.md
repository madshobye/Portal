# VJ1 Node Platform — First Version

VJ1 is moving toward a node-first architecture. A node is an executable,
versioned software component with typed inlets, outlets, parameters, editable
parts, runtime policy, and presentation metadata. Nodes do not require a graph
scheduler: application code and group programs can invoke the same node
instances directly.

The implementation lives in `js/libraries/`. Every reusable library has a
public `index.js`; every substantial executable node or group has its own
directory and `index.js`. Node packages may use p5, browser
APIs, and other external libraries already available to the application. The
important boundary is internal: node implementations must not become wrappers
that delegate their core behavior back into the existing VJ1 output runtime,
services, or application state.

## Layers

### Node platform

- `node-types.js` owns the extensible value-type registry and structural types.
- `node-definition.js` owns versioned manifests, smart port declarations, and
  the version-aware node registry.
- `node-runtime.js` owns direct execution, packets, automatic numeric-range
  mapping, smoothing, inlet throttling, node throttling, and output validation.
- `node-group.js` owns expandable group manifests and code-owned group programs.
- `node-graph-program.js` owns deterministic call-driven execution for
  low-frequency control, data, and utility graphs.
- `node-compiler.js` selects compiler backends. Visual groups compile to
  opaque allocation-stable programs rather than generic packet traversal.
- `node-artifact.js` projects nodes into product concepts such as components,
  controls, effects, and internal utilities.
- `node-editor.js` maps editable node parts to editor panels.

### Capability libraries

Capability implementations belong in explicit library folders. They keep their
substantial algorithmic code in the node module. They may use external
libraries—including p5—when useful, while avoiding dependencies on existing
VJ-specific implementations. The initial `core.image.resize` node contains its
typed-array bilinear resampling algorithm directly and emits a composite image
frame.

The dependency direction is:

```text
Node platform → generic runtime and schemas
Libraries    → node engine + external libraries
Application  → public library entry points + render hosts + product views
```

External libraries are not required to be rewritten. Internal VJ algorithms
should move into their owning nodes rather than being called through thin node
wrappers.

## Compatibility and performance invariants

Node migration must preserve the current product model and interaction design.
Component, Canvas, Scene, Live, mapping, catalog, inspector, and output behavior
remain unchanged as product concepts while their persisted programs are node
groups. `component.chain` is an in-memory UI compatibility projection of the
persisted Component group, not a second saved authority.
The technical graph may be expandable without forcing users into one enormous
generic graph viewport.

The live renderer must remain at least as smooth as the current implementation:

- Do not allocate node definitions, instances, ports, packets, or group plans
  inside the frame loop.
- Code-owned groups compile to direct calls; editor metadata is not traversed
  while rendering.
- Existing caches, fused shader paths, workers, typed arrays, resource reuse,
  and specialized GPU paths remain in place until replacements are measured.
- Render-host bridges belong outside node packs and must not copy large
  media or mesh values unnecessarily.
- A specialized conditional is acceptable when it preserves established UX or
  a measured fast path. Mark it with an `intentional allocation-stable fast path`
  comment and cover it with a focused test or metric.
- Do not expose internal utility/control nodes as Components merely because
  they are graph nodes; artifact capabilities continue to control each view.

### Product layer

The VJ1 application selects node packs, registers artifacts, and chooses the
views in which they appear. A slider can therefore be a first-class control
node while remaining absent from the visual-component canvas.

## Node definitions and instances

A definition identifies a reusable node implementation:

```text
id + version + formatVersion
name + description
inlets + outlets + parameters
execution policy
editable parts
capabilities + presentation
migrations
process implementation
```

An instance identifies one configured occurrence of that definition. Projects
should eventually pin the definition version used by every persisted instance.
Editing a shared definition should create a new version or a project-local
fork rather than silently changing existing projects.

## Smart ports

Ports declare value type, expected/allowed/display ranges, scaling mode,
smoothing, rate policy, editor hints, and descriptive metadata. When a packet
moves from an outlet with range `10..20` into an inlet with range `0..1`, the
node runtime builds the numeric mapping automatically.

Rate overflow currently supports `latest`, `drop`, `queue`, and `sample` policy
declarations. The call-driven runtime can receive packets and flush eligible
work without owning a graph scheduler.

## Groups

A group is both a node definition and an inspectable internal graph. A
code-owned `program` may execute child nodes explicitly. Editable utility and
control groups without such a program execute through the deterministic
call-driven graph program. Visual groups instead declare a compiler backend;
the compiler may fuse or specialize the graph and returns one opaque direct
program before rendering begins.

## Artifacts and views

Execution identity and product identity are intentionally separate:

```text
Node definition → executable technical capability
Artifact        → component, control, effect, scene, input, or utility
View            → filtered projection of artifacts and node instances
```

Catalog membership and placement use artifact types and capability metadata,
not checks against concrete node names. This allows component, control, scene,
and expanded graph views to show different projections of the same system.

## Implemented application composition

`app-node-package.js` is the control application's composition root. It selects
the packs, registers their definitions and artifacts, and projects current
Component, Canvas, Scene, and Live concepts into separate views. Node projects
persist pinned definition versions, instances, groups, artifacts, editable
forks, and migrations without serializing runtime callbacks.

The first-version capability libraries are divided as follows:

- image and mesh nodes own resizing, STL/OBJ parsing, mesh resolution, WebGL
  preparation/rendering, thumbnails, and recursive parse/prepare/convert groups;
- visual nodes materialize generator/effect shader source as editable node
  parts, with documented native fast paths for specialized generators;
- control, timing, mapping, and state packs own interactive values, clocks,
  transformations, smoothing/rate semantics, and command classification;
- media, storage, synchronization, cache, and diagnostics packs own resource
  lifecycle, serialized writes, live-patch coalescing, retained render results,
  and operational reporting;
- composition owns surface demand and render-request planning while the output
  adapter keeps the compiled planning closure outside the frame loop.

Generators and effects own their metadata, parameters, runtime policy, and
shader/native binding in individual folders under `visual-nodes/generators`
and `visual-nodes/effects`. The visual library catalog only indexes those
node-owned modules; there are no parallel source or shader manifests. Product
views, metrics, scheduling, output, and the application composition root all
consume executable node components through the visual library's public entry
point. Specialized native nodes keep allocation-stable direct renderers
where inserting generic runtime machinery would add frame-time work. These are
node-owned implementations, not a second execution registry. The control
application builds the editable node package; output and preview branches
import node-owned algorithms directly and never construct the package, node
instances, packets, or a scheduler.

There is intentionally no universal scheduled graph executor. Control, data,
and utility graphs run when application code invokes them. Component visual
graphs compile to the established direct renderer, preserving shader fusion,
shared framebuffer targets, retained caches, specialized model/terrain paths,
and allocation stability. A visual node boundary may therefore contain a
specialized compiled renderer rather than forcing extra ping-pong buffers.

## Product-facing Node View

The control application exposes a Nodes workspace in the primary view switch.
Its library rail lists every registered definition, its central structure view
shows typed ports, implementation parts, and expandable group topology, and its
inspector exposes parameters and editable JavaScript/shader parts. Saving an
edit creates a project-local node fork; it does not mutate the built-in library
or add editor work to the live render loop. Shader forks are compiled by the
visual backend. Executable JavaScript process parts compile once when
materialized, while edited utility group graphs use the call-driven program.
