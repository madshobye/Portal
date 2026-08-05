# VJ1 Node Platform Contract

This document defines the technical contract of the VJ1 node platform. It is a
focused companion to `codex.md`, which owns project-wide architecture, product
authority, performance principles, and working practices. This document owns
node definitions, instances, ports, Groups, execution models, artifacts,
packages, forks, and node-facing editor behavior.

If the documents disagree, `codex.md` is the broader authority and this contract
must be brought into alignment. Implementation-specific formats remain owned by
the modules under `js/libraries/node-engine`; saved projects are migrated at load
time rather than supported through parallel runtime models.

## Purpose and boundary

A node is an executable, versioned capability with typed inlets, outlets,
parameters, editable parts, runtime policy, and presentation metadata. Nodes are
the reusable technical units beneath Components, Scenes, controls, generators,
effects, inputs, and infrastructure services.

A node owns its semantic behavior. It must not be a decorative wrapper that
dispatches by source name into hidden application code or a second registry.
Substantial reusable algorithms belong to their capability library or node-owned
implementation. A compiler may lower a node to a shader, direct function,
retained typed-value step, shared framebuffer sequence, or declared native
kernel without changing the node's public contract.

The dependency direction is:

```text
node platform -> generic types, schemas, runtime, and compiler contracts
libraries     -> node platform + external browser/GPU libraries
application   -> public library entry points + product views + render hosts
```

Every reusable library exposes a public `index.js`. Substantial executable nodes
and Groups live in their own directories. Node modules may use browser APIs and
external libraries, but may not reach through incidental UI or Output imports to
acquire application-global services.

## Platform modules

- `node-types.js` owns extensible value types and structural type validation.
- `node-definition.js` owns normalized versioned definitions, smart ports, and
  the version-aware registry.
- `node-runtime.js` owns direct execution, packets, range mapping, smoothing,
  throttling, and output validation.
- `node-group.js` owns expandable Group definitions and code-owned programs.
- `node-graph-program.js` owns deterministic call-driven control, data, and
  utility graph execution.
- `node-compiler.js` selects declared compiler backends.
- `node-artifact.js` maps technical definitions into product concepts.
- `node-editor.js` exposes editable parts and creates project-local forks.
- `node-project.js` owns the serializable node-project shape.
- `node-package.js` owns package manifests, dependency validation, import,
  export, version selection, fork upgrades, and migrations.

## Definitions and instances

A definition identifies one reusable implementation:

```text
id + version + formatVersion
name + description
inlets + outlets + parameters
execution policy
editable parts
capabilities + presentation
migrations
process or compiler contract
```

An instance identifies one configured occurrence of a definition. Persisted
instances and artifact implementations carry exact node identity and version.
Runtime callbacks, browser resources, compiled programs, and host services are
never serialized.

Definitions are immutable identities. Editing a built-in definition creates a
project-local fork pinned to its exact base definition; it never mutates the
built-in package. Import and upgrade validate the base version and apply explicit
migrations. Missing, incompatible, ambiguous, or modified dependencies fail
closed with a structured diagnostic.

## Typed ports and values

Ports declare value type and may declare expected, allowed, and display ranges,
scaling mode, smoothing, rate policy, editor hints, and descriptive metadata.
Connections are accepted by type compatibility rather than concrete node names.

When compatible numeric ranges differ, the runtime constructs the declared
mapping at connection preparation. Rate overflow supports `latest`, `drop`,
`queue`, and `sample`. These policies are prepared outside frame-critical
execution; metadata is not rediscovered for every packet.

Large media, mesh, scene, texture, and resource values retain stable identity
and explicit ownership. Host bridges pass references or bounded snapshots and
must not copy large values merely to cross a node boundary.

## Groups and execution models

A Group is both a node definition and an inspectable internal graph. Its public
ports are the only external contract; internal nodes and connections describe
how that contract is fulfilled.

VJ1 deliberately has no universal scheduled graph interpreter:

- control, data, and utility graphs run through deterministic call-driven
  programs when invoked;
- code-owned Groups may invoke prepared child nodes directly;
- visual Component Groups compile before rendering to retained,
  allocation-stable programs;
- the Application graph compiles service dependencies into bootstrap order and
  dataflow edges into indexed direct event routes;
- specialized native lowering is allowed only when declared by the owning node,
  surrounded by an ordinary typed contract, and covered by a focused test or
  metric.

Editor metadata, definitions, ports, packets, and graph topology are not
allocated or traversed inside the render loop. A displayed graph must describe
the program that executes even when the compiler fuses or specializes it.

## Component graph authority

The generated Component Group is the sole editable authority for visual order,
nesting, stable node identity, and configuration. The Component and Live layer
interfaces are projections of this graph and write through `nodeId` plus a path
relative to that node's configuration.

`component.chain` is only a disposable execution projection materialized from
the authoritative Group. Active UI controls, Live diffs, render patches,
compiler decisions, and renderer synchronization never address it by array
index. Positional legacy addresses are accepted only by load-time migration and
are rejected by the active node and patch runtimes.

Public controls bind to the child parameter or unconnected inlet that owns the
behavior. A public control cannot override an inlet already driven by the graph.
Generated controls and significant-parameter views remain derived projections;
they do not become another parameter authority.

## Artifacts and product views

Execution identity and product identity are separate:

```text
Node definition -> executable technical capability
Artifact        -> Component, control, effect, Scene, input, or utility
View            -> filtered projection of artifacts and instances
```

The application composition root selects packages, registers definitions and
artifacts, and chooses where those artifacts appear. Catalog membership,
placement, editor panels, and visibility use artifact types and capability
metadata rather than checks against concrete node names.

Internal utility nodes do not become Components merely because they exist in a
graph. Conversely, one definition may support several product projections when
its declared capabilities make those projections honest.

The Nodes workspace exposes registered definitions, typed ports, editable
parts, and expandable topology. Shader and JavaScript edits materialize a
project-local fork and compile before activation. Editing never inserts generic
node machinery into the frame loop.

## Services and host ownership

Project-global facilities such as MIDI, DMX, OSC, capture, audio analysis,
storage, diagnostics, synchronization, and media lifecycle are explicit
services. Nodes exchange typed values or events with them through injected
contracts. They do not acquire ownership through incidental Control, Preview,
or Output imports.

Each resource has one lifecycle owner. Preview and Output may host the same
compiled node program, but they share node semantics, patch addressing,
readiness, and disposal contracts. Render-host bridges remain outside node packs.

## Performance and correctness invariants

- Compile graph topology, bindings, ranges, execution policy, and resource
  dependencies before the frame loop.
- Retain definitions, instances, programs, shaders, targets, typed arrays, and
  resource handles across evaluations.
- Do not introduce framebuffer passes, uploads, readbacks, or large-value copies
  merely to preserve a generic node abstraction.
- Preserve compiler-approved fused shaders, shared private linear framebuffer
  sequences, workers, caches, and specialized GPU paths until a replacement is
  measured.
- Disabled and unreachable nodes perform no render work.
- Nodes declare time, feedback, capture, input, and other dirty dependencies so
  stable graphs can sleep.
- A node publishes only complete valid outputs. During asynchronous replacement,
  consumers retain the last valid result until the new result is ready.
- Rejected definitions, connections, packets, migrations, compilations, and
  activations emit structured diagnostics at the rejecting boundary. Ordinary
  unchanged execution remains quiet.

## Primary references

- Node platform: `js/libraries/node-engine/`.
- Application package/composition root: `js/app-node-package.js`.
- Component and visual compilation:
  `js/libraries/composition-engine/shared/`.
- Application bootstrap and dataflow:
  `js/libraries/composition-engine/application-program/index.js`.
- Node-owned visual capabilities: `js/libraries/visual-nodes/`.
- Project migration: `js/domain/project-migrations.js`.
- Project-wide architecture and verification: `codex.md`.
