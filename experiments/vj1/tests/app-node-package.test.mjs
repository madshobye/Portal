import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createVj1NodePackage, projectArtifactViews } from "../js/app-node-package.js";
import { listGeneratorNodeComponents as listGeneratorComponents, listEffectNodeComponents as listShaderComponents } from "../js/libraries/visual-nodes/index.js";
import {
  compileApplicationDataflowPlan,
  compileApplicationServicePlan,
  compileComponentRenderPrograms,
  compileOutputRenderProgram,
  compileSceneRenderPrograms,
} from "../js/libraries/composition-engine/index.js";
import { buildProjectPayload } from "../js/services/project-serializer.js";
import { applicationProgramFromProjectData, loadStoredApplicationProgram } from "../js/services/application-program-loader.js";
import { createAppState } from "../js/app-state.js";
import { createInitialState } from "../js/domain/models.js";
import { migrateProjectData } from "../js/domain/project-migrations.js";
import { selectedNodeEditorTemplate, withProjectGroupGraph, withProjectNodeFork } from "../js/control/node-editor-view.js";
import { createProjectVisualNodeResolver } from "../js/libraries/visual-nodes/index.js";
import { nodeLibraryInspectorTemplate, nodeLibraryRailTemplate, nodeLibraryStudioTemplate, selectedNodeWorkspaceTarget } from "../js/control/node-library-view.js";
import { compileJavaScriptNodeModule, createProjectNodeFork, NODE_PART_KINDS } from "../js/libraries/node-engine/index.js";

test("application composition root registers reusable visual node definitions", () => {
  const packageRoot = createVj1NodePackage();
  const expectedVisuals = listGeneratorComponents().length + listShaderComponents().length;

  assert.equal(packageRoot.registry.has("core.mesh.convert-3d-file-to-image"), true);
  assert.equal(packageRoot.registry.has("core.image.resize"), true);
  assert.equal(packageRoot.registry.has("core.synchronization.live-patches"), true);
  assert.equal(packageRoot.registry.has("core.storage.serialized-writes"), true);
  assert.equal(packageRoot.registry.has("core.composition.surface-routes"), true);
  assert.equal(packageRoot.registry.has("core.media.input-lifecycle"), true);
  assert.equal(typeof packageRoot.createProjectPackage, "function");
  assert.equal(typeof packageRoot.exportProjectPackage, "function");
  assert.equal(typeof packageRoot.installProjectPackage, "function");
  const waves = packageRoot.registry.get("vj1.visual.generator.waves");
  assert.equal(waves.implementation.kind, "shader");
  assert.match(waves.parts.find((part) => part.kind === "shader")?.source || "", /gl_FragColor/);
  assert.equal(packageRoot.artifacts.list({ artifactType: "visual-element" }).length, expectedVisuals);
  assert.equal(packageRoot.artifacts.list({ view: "component-catalog" }).some((item) => item.id === "core.control.slider"), false);
  assert.equal(packageRoot.artifacts.list({ catalog: "component" }).length, 0, "built-in elements never become project Components");
});

test("every editable code node links its displayed JavaScript to execution", () => {
  const definitions = createVj1NodePackage().registry.list();
  const missingEntries = [];
  for (const definition of definitions) {
    if (definition.implementation.kind !== "code") continue;
    const parts = definition.parts.filter((part) => part.kind === NODE_PART_KINDS.JAVASCRIPT && part.editable !== false);
    if (!parts.length) continue;
    const processName = definition.process?.name || "";
    const linked = parts.some((part) => part.entry === "process" || [
      ...(part.exports || []),
      part.export,
    ].includes(processName));
    if (!linked) {
      missingEntries.push(definition.id);
      continue;
    }
    assert.doesNotThrow(() => compileJavaScriptNodeModule(parts, definition), definition.id);
  }
  assert.deepEqual(missingEntries, []);
});

test("compiler adapters expose their code as explicitly locked native boundaries", () => {
  const registry = createVj1NodePackage().registry;
  for (const id of ["core.composition.surface-routes", "core.visual.node-definition"]) {
    const definition = registry.get(id);
    assert.equal(definition.implementation.kind, "native");
    assert.equal(definition.parts.every((part) => part.editable === false), true);
    assert.equal(definition.parts.every((part) => part.metadata.compilerLocked === true), true);
  }
});

test("project artifact views preserve Component Canvas Scene and Live placement order", () => {
  const state = {
    components: [
      { id: "component-a", name: "A", type: "component", catalogMarker: 2 },
      { id: "canvas-a", name: "Canvas A", type: "canvas" },
      { id: "component-b", name: "B", type: "component" },
    ],
    scenes: [{ id: "scene-a", name: "Scene A" }, { id: "scene-b", name: "Scene B" }],
    ui: { live: { selectedSceneId: "scene-b" } },
  };
  const views = projectArtifactViews(state);
  const ids = (items) => items.map((item) => item.metadata.projectId);

  assert.deepEqual(ids(views.component), ["component-a", "component-b"]);
  assert.deepEqual(ids(views.canvas), ["canvas-a"]);
  assert.deepEqual(ids(views.scene), ["scene-a", "scene-b"]);
  assert.deepEqual(ids(views.liveScene), ["scene-a", "scene-b"]);
  assert.equal(views.live[0].metadata.selectedSceneId, "scene-b");
});

test("the application persists the executable model-preview group topology", () => {
  const packageRoot = createVj1NodePackage();
  const state = packageRoot.prepareProjectState({ nodes: {} });
  const instance = state.nodes.instances.find((item) => item.id === "vj1.system.model-preview");
  const convertGroup = state.nodes.groups.find((item) => item.nodeId === "core.mesh.convert-3d-file-to-image");
  const prepareGroup = state.nodes.groups.find((item) => item.nodeId === "core.mesh.prepare-3d-asset");

  assert.equal(instance.nodeId, "core.mesh.convert-3d-file-to-image");
  assert.equal(instance.parameters.profile, "thumbnail");
  assert.deepEqual(convertGroup.nodes.map((node) => node.id), ["prepare", "render", "resize"]);
  assert.deepEqual(prepareGroup.nodes.map((node) => node.id), ["parse", "resolution"]);
  assert.equal(state.nodes.definitions.some((definition) => definition.id === "core.mesh.stl-parser"), true);
  assert.equal(state.nodes.definitions.every((definition) => !("process" in definition)), true);
  assert.equal(state.nodes.artifacts.some((artifact) => artifact.id === "vj1.utility.model-preview-pipeline"), true);
});

test("Components and Canvases persist and compile their executable node topology", () => {
  const packageRoot = createVj1NodePackage();
  const components = [
    {
      id: "component-a",
      name: "Component A",
      type: "component",
      chain: [
        { id: "source-a", kind: "source", source: { type: "generator", generatorId: "waves", params: { renderQuality: 0.7 } } },
        { id: "effect-a", kind: "effect", componentId: "ripple", params: { amount: 0.4 } },
      ],
    },
    {
      id: "canvas-a",
      name: "Canvas A",
      type: "canvas",
      chain: [{
        id: "group-a",
        kind: "group",
        opacity: 0.8,
        chain: [{ id: "component-source", kind: "source", source: { type: "component", componentId: "component-a" } }],
      }],
    },
  ];
  const state = packageRoot.prepareProjectState({ components, nodes: {} });
  const componentGroup = state.nodes.groups.find((group) => group.componentId === "component-a");
  const canvasGroup = state.nodes.groups.find((group) => group.componentId === "canvas-a");
  const programs = compileComponentRenderPrograms(components, state.nodes.groups);

  assert.deepEqual(componentGroup.nodes.filter((node) => node.role !== "control").map((node) => node.nodeId), [
    "vj1.visual.generator.waves", "vj1.visual.effect.ripple",
  ]);
  assert.deepEqual(componentGroup.nodes.filter((node) => node.role === "control").map((node) => node.nodeId), [
    "core.control.slider", "core.control.slider",
  ]);
  assert.deepEqual(componentGroup.connections.filter((edge) => edge.type === "texture").map((edge) => [edge.from, edge.to]), [
    ["$in.texture", "source-a.image"],
    ["source-a.texture", "effect-a.texture"],
    ["effect-a.texture", "$out.texture"],
  ]);
  assert.equal(componentGroup.connections.some((edge) => edge.to === "effect-a.$parameter.amount" && edge.sourceRange[1] === 1), true);
  assert.equal(canvasGroup.artifactType, "canvas");
  const canvasLayerGroup = canvasGroup.nodes.find((node) => node.role === "group");
  assert.equal(canvasLayerGroup.nodeId, "core.composition.layer-group");
  assert.equal(canvasLayerGroup.nodes.find((node) => node.role !== "control").nodeId, "core.visual.source");
  assert.equal(state.nodes.instances.some((instance) => instance.id === "vj1.component.canvas-a/group-a/component-source"), true);
  assert.equal(state.nodes.definitions.some((definition) => definition.id === "vj1.visual.generator.waves"), true);
  assert.deepEqual(programs.get("component-a").chain.map((item) => item.id), ["source-a", "effect-a"]);
  assert.deepEqual(programs.get("canvas-a").chain[0].chain.map((item) => item.id), ["component-source"]);
  assert.deepEqual(programs.get("component-a").plan.operations.map((operation) => operation.backend), ["shader-generator", "shader-effect"]);
  assert.equal(programs.get("component-a").plan.operations[1].compilerHook.id, "vj1.visual.shader-effect");
});

test("native visual nodes compile their specialized host renderer into the render plan", () => {
  const packageRoot = createVj1NodePackage();
  const component = {
    id: "terrain-component",
    name: "Terrain",
    type: "component",
    chain: [{
      id: "terrain-source",
      kind: "source",
      source: { type: "generator", generatorId: "terrainFlyover", params: {} },
    }],
  };
  const state = packageRoot.prepareProjectState({ components: [component], nodes: {} });
  const program = compileComponentRenderPrograms(state.components, state.nodes.groups, {
    resolveNodeDefinition: (node) => packageRoot.registry.get(node.nodeId, node.nodeVersion),
  }).get(component.id);
  const operation = program.plan.operations[0];

  assert.equal(operation.backend, "native-specialized");
  assert.equal(operation.renderer, "output/specialized:terrainFlyover");
  assert.equal(operation.allocationStable, true);
  assert.equal(typeof operation.nodeModule.terrainSurfaceGridVertices, "function");
  assert.equal(typeof operation.nodeModule.terrainSafeNearDistance, "function");
  assert.match(operation.nodeShaders["terrain-surface-vertex"], /attribute vec2 aGridCoord/);
  assert.match(operation.nodeShaders["terrain-surface-fragment"], /uniform vec4 waterColor/);
  assert.match(operation.nodeShaders["terrain-wire-vertex"], /attribute vec2 aStart/);
  assert.match(operation.nodeShaders["terrain-wire-fragment"], /uniform vec4 wireColor/);
  assert.match(operation.nodeCodeRevision, /^[a-z0-9]+$/);
  assert.match(operation.nodeShaderRevision, /^[a-z0-9]+$/);
  assert.match(operation.nodeShaderProgramRevisions.surface, /^[a-z0-9]+$/);
  assert.match(operation.nodeShaderProgramRevisions.wire, /^[a-z0-9]+$/);
  assert.equal(operation.nodeProcess, undefined, "the retained terrain WebGL host remains specialized");
});

test("Terrain shader forks compile by part id without invalidating its CPU topology module", () => {
  const packageRoot = createVj1NodePackage();
  const component = {
    id: "terrain-shader-fork-component",
    name: "Terrain shader fork",
    type: "component",
    chain: [{
      id: "terrain-source",
      kind: "source",
      source: { type: "generator", generatorId: "terrainFlyover", params: {} },
    }],
  };
  const state = packageRoot.prepareProjectState({ components: [component], nodes: {} });
  const base = packageRoot.registry.get("vj1.visual.generator.terrainFlyover");
  const baseOperation = compileComponentRenderPrograms(state.components, state.nodes.groups, {
    resolveNodeDefinition: (node) => packageRoot.registry.get(node.nodeId, node.nodeVersion),
  }).get(component.id).plan.operations[0];
  const fork = createProjectNodeFork(base, {
    forkId: "terrain-shader-project",
    overrides: {
      parts: base.parts.map((part) => part.id === "terrain-wire-fragment"
        ? { ...part, source: `${part.source}\n// project wire shader` }
        : part),
    },
  });
  const resolver = createProjectVisualNodeResolver({ nodes: { forks: [{ ...fork, active: true }] } });
  const forkOperation = compileComponentRenderPrograms(state.components, state.nodes.groups, {
    resolveNodeDefinition: (node) => resolver.definition(node.nodeId) || packageRoot.registry.get(node.nodeId, node.nodeVersion),
  }).get(component.id).plan.operations[0];

  assert.match(forkOperation.nodeShaders["terrain-wire-fragment"], /project wire shader/);
  assert.equal(forkOperation.nodeCodeRevision, baseOperation.nodeCodeRevision);
  assert.notEqual(forkOperation.nodeShaderRevision, baseOperation.nodeShaderRevision);
  assert.equal(forkOperation.nodeShaderProgramRevisions.surface, baseOperation.nodeShaderProgramRevisions.surface);
  assert.notEqual(forkOperation.nodeShaderProgramRevisions.wire, baseOperation.nodeShaderProgramRevisions.wire);
  assert.strictEqual(forkOperation.nodeModule.terrainSurfaceGridVertices, baseOperation.nodeModule.terrainSurfaceGridVertices);
});

test("node-owned native JavaScript compiles into the direct render plan", () => {
  const packageRoot = createVj1NodePackage();
  const component = {
    id: "calibration-component",
    name: "Calibration",
    type: "component",
    chain: [{
      id: "calibration-source",
      kind: "source",
      source: { type: "generator", generatorId: "testPattern", params: {} },
    }],
  };
  const state = packageRoot.prepareProjectState({ components: [component], nodes: {} });
  const program = compileComponentRenderPrograms(state.components, state.nodes.groups, {
    resolveNodeDefinition: (node) => packageRoot.registry.get(node.nodeId, node.nodeVersion),
  }).get(component.id);
  const operation = program.plan.operations[0];

  assert.equal(operation.backend, "native-specialized");
  assert.equal(operation.renderer, "output/specialized:testPattern");
  assert.equal(typeof operation.nodeProcess, "function");
  assert.equal(operation.nodeProcessId, "vj1.visual.generator.testPattern@0.1.0");
});

test("specialized Text compiles node-owned helpers and shaders while retaining the host cache", () => {
  const packageRoot = createVj1NodePackage();
  const component = {
    id: "text-component",
    name: "Text",
    type: "component",
    chain: [{
      id: "text-source",
      kind: "source",
      source: { type: "generator", generatorId: "text", params: { text: "NODE" } },
    }],
  };
  const state = packageRoot.prepareProjectState({ components: [component], nodes: {} });
  const operation = compileComponentRenderPrograms(state.components, state.nodes.groups, {
    resolveNodeDefinition: (node) => packageRoot.registry.get(node.nodeId, node.nodeVersion),
  }).get(component.id).plan.operations[0];

  assert.equal(operation.renderer, "output/specialized:text");
  assert.equal(typeof operation.nodeModule.createTextMask, "function");
  assert.equal(typeof operation.nodeModule.textMaskSignature, "function");
  assert.match(operation.nodeShaders.vertex, /attribute vec3 aPosition/);
  assert.match(operation.nodeShaders.fragment, /uniform sampler2D textMask/);
  assert.equal(operation.nodeProcess, undefined, "the cache-owning host adapter remains specialized");
});

test("ordinary source nodes compile their source-family host renderer without changing the direct render path", () => {
  const packageRoot = createVj1NodePackage();
  const component = {
    id: "media-component",
    name: "Media",
    type: "component",
    chain: [{
      id: "media-source",
      kind: "source",
      source: { type: "media", mediaId: "media/example.png", params: {} },
    }],
  };
  const state = packageRoot.prepareProjectState({ components: [component], nodes: {} });
  const operation = compileComponentRenderPrograms(state.components, state.nodes.groups)
    .get(component.id).plan.operations[0];

  assert.equal(operation.nodeId, "core.visual.source");
  assert.equal(operation.backend, "source-runtime");
  assert.equal(operation.renderer, "output/source:media");
  assert.equal(operation.allocationStable, true);
});

test("pre-node project snapshots compile once into the native visual render-plan program", () => {
  const component = {
    id: "old-component",
    type: "component",
    chain: [{ id: "old-source", kind: "source", source: { type: "generator", generatorId: "waves" } }],
  };
  const programs = compileComponentRenderPrograms([component], []);
  const program = programs.get(component.id);
  let renderedPlan = null;
  const result = program.execute({
    executeVisualRenderPlan(plan) {
      renderedPlan = plan;
      return "rendered";
    },
  }, component, 0, { width: 640, height: 360 });

  assert.equal(result, "rendered");
  assert.equal(program.generatedBy, "vj1-component-compiler");
  assert.equal(renderedPlan.format, "vj1.visual-render-plan@1");
  assert.deepEqual(renderedPlan.operations.map((operation) => operation.id), ["old-source"]);
  assert.deepEqual(renderedPlan.operations.map((operation) => operation.opcode), ["source"]);
});

test("application state keeps persisted Component groups synchronized after structural edits", () => {
  const packageRoot = createVj1NodePackage();
  const store = createAppState(createInitialState(), { prepareState: packageRoot.prepareProjectState });
  const before = store.getState();
  assert.equal(before.nodes.groups.filter((group) => group.generatedBy === "vj1-component-compiler").length, before.components.length);

  store.addComponent();
  const after = store.getState();
  assert.equal(after.nodes.groups.filter((group) => group.generatedBy === "vj1-component-compiler").length, after.components.length);
  assert.equal(after.nodes.groups.some((group) => group.componentId === after.ui.selectedComponentId), true);
});

test("persisted Component groups own configuration while chain remains an in-memory UI projection", () => {
  const packageRoot = createVj1NodePackage();
  const initial = createInitialState();
  initial.components[0].chain = [{
    id: "source-a",
    kind: "source",
    name: "Waves",
    source: { type: "generator", generatorId: "waves", params: { renderQuality: 0.75 } },
  }];
  const prepared = packageRoot.prepareProjectState(initial);
  const group = prepared.nodes.groups.find((item) => item.componentId === prepared.components[0].id);
  const source = group.nodes.find((item) => item.role === "source");
  const payload = buildProjectPayload(prepared, "2026-07-20T00:00:00.000Z");

  assert.equal(prepared.nodes.authority, "node-graph");
  assert.equal(source.configuration.source.generatorId, "waves");
  assert.equal(Object.hasOwn(payload.components[0], "chain"), false);

  const reloaded = packageRoot.prepareProjectState(payload);
  assert.equal(reloaded.components[0].chain[0].source.generatorId, "waves");
  assert.equal(reloaded.components[0].nodeProjectionSignature, group.projectionSignature);
});

test("v26 migration preserves graph-authoritative Component elements when the persisted chain is omitted", () => {
  const packageRoot = createVj1NodePackage();
  const initial = createInitialState();
  initial.components[0].chain = [{
    id: "source-a",
    kind: "source",
    name: "Plasma",
    transform: { x: 0.1, y: -0.2, scale: 0.8, rotation: 0.35 },
    source: { type: "generator", generatorId: "plasma", params: {} },
  }];
  const prepared = packageRoot.prepareProjectState(initial);
  const payload = buildProjectPayload(prepared, "2026-07-20T00:00:00.000Z");
  payload.version = 25;

  assert.equal(Object.hasOwn(payload.components[0], "chain"), false);
  const migrated = migrateProjectData(payload);
  const reloaded = packageRoot.prepareProjectState(migrated);

  assert.equal(reloaded.components[0].chain.length, 1);
  assert.equal(reloaded.components[0].chain[0].source.generatorId, "plasma");
  assert.equal(reloaded.components[0].chain[0].boundary.rotation, 0.35);
  assert.equal(reloaded.components[0].chain[0].transform.rotation, 0);
});

test("Scenes and main output persist route composition and mapping groups", () => {
  const packageRoot = createVj1NodePackage();
  const surface = {
    id: "surface-a",
    enabled: true,
    sourceNodeId: "component:component-a",
    componentId: "component-a",
    projectionFit: "cover",
    feather: 0.05,
  };
  const state = packageRoot.prepareProjectState({
    components: [{ id: "component-a", type: "component", name: "A", chain: [] }],
    surfaces: [surface],
    scenes: [{ id: "scene-a", name: "Scene A", snapshot: { surfaces: [surface] } }],
    nodes: {},
  });
  const scene = state.nodes.groups.find((group) => group.id === "vj1.scene.scene-a");
  const output = state.nodes.groups.find((group) => group.id === "vj1.output.main");

  assert.deepEqual(scene.nodes.map((node) => node.role), [
    "component-source", "surface-route", "composition", "mapping",
  ]);
  assert.equal(scene.nodes.find((node) => node.role === "surface-route").parameters.feather, 0.05);
  assert.deepEqual(output.nodes.map((node) => node.role), ["scene", "composition", "mapping"]);
  assert.equal(state.nodes.definitions.some((definition) => definition.id === "core.composition.scene-program"), true);
  assert.equal(state.nodes.definitions.some((definition) => definition.id === "core.mapping.projection-engine"), true);
});

test("compiled Scene routes use live snapshot and physical-surface values instead of stale generated parameters", () => {
  const packageRoot = createVj1NodePackage();
  const surface = {
    id: "surface-a",
    enabled: true,
    sourceNodeId: "component:component-a",
    componentId: "component-a",
    projectionFit: "cover",
    feather: 0.05,
    opacity: 1,
  };
  const state = packageRoot.prepareProjectState({
    components: [{ id: "component-a", type: "component", name: "A", chain: [] }],
    surfaces: [surface],
    scenes: [{ id: "scene-a", name: "Scene A", snapshot: { surfaces: [surface] } }],
    nodes: {},
    ui: { selectedSceneId: "scene-a" },
  });
  const generatedRoute = state.nodes.groups
    .find((group) => group.id === "vj1.scene.scene-a")
    .nodes.find((node) => node.role === "surface-route");
  assert.equal(generatedRoute.parameters.opacity, 1);
  assert.equal(generatedRoute.parameters.feather, 0.05);

  state.scenes[0].snapshot.surfaces[0].opacity = 0.25;
  state.scenes[0].snapshot.surfaces[0].projectionFit = "contain";
  state.surfaces[0].feather = 0.2;
  const routes = compileSceneRenderPrograms(state, state.nodes.groups).get("scene-a").surfaces;

  assert.equal(routes[0].opacity, 0.25);
  assert.equal(routes[0].projectionFit, "contain");
  assert.equal(routes[0].feather, 0.2);
});

test("the persisted application program connects controls Live services and output infrastructure", () => {
  const packageRoot = createVj1NodePackage();
  const state = packageRoot.prepareProjectState({ components: [], scenes: [], surfaces: [], nodes: {} });
  const program = state.nodes.groups.find((group) => group.id === "vj1.application.program");

  assert.deepEqual(program.nodes.map((node) => node.role), [
    "timing",
    "state-command",
    "data-store",
    "media-lifecycle",
    "diagnostics",
    "live-synchronization",
    "storage",
    "cache",
    "output",
  ]);
  assert.equal(program.connections.some((edge) => edge.from === "state.snapshot" && edge.to === "live.state"), true);
  assert.equal(program.connections.some((edge) => edge.from === "state.snapshot" && edge.to === "storage.value"), true);
  assert.equal(program.connections.some((edge) => edge.from === "state.$service" && edge.to === "live.$dependency.data-store" && edge.phase === "setup"), true);
  assert.deepEqual(compileApplicationServicePlan(program).nodes.find((node) => node.role === "live-synchronization").dependencies, [
    "data-store", "media-lifecycle", "diagnostics",
  ]);
  assert.equal(compileApplicationDataflowPlan(program).routes.some((route) =>
    route.sourceRole === "data-store" && route.sourcePort === "snapshot" &&
    route.targetRole === "live-synchronization" && route.targetPort === "state"), true);
  assert.equal(packageRoot.applicationProgram.id, program.id);
  assert.equal(packageRoot.registry.get("core.control.slider").presentation.hiddenFrom.includes("component-catalog"), true);
  assert.equal(packageRoot.registry.has("core.control.value"), true);
});

test("Application runtime dataflow dispatches only through compiled authored routes", () => {
  const packageRoot = createVj1NodePackage();
  const group = packageRoot.applicationProgram;
  const runtime = packageRoot.createApplicationRuntime({ group });
  const deliveries = [];
  runtime.bindInput("live-synchronization", "state", (value) => deliveries.push(["live", value]));
  runtime.bindInput("storage", "value", (value) => deliveries.push(["storage", value]));
  runtime.emit("data-store", "snapshot", { revision: 3 });
  assert.deepEqual(deliveries, [
    ["live", { revision: 3 }],
    ["storage", { revision: 3 }],
  ]);

  const disconnected = {
    ...group,
    connections: group.connections.filter((edge) => edge.to !== "live.state"),
  };
  const disconnectedRuntime = packageRoot.createApplicationRuntime({ group: disconnected });
  disconnectedRuntime.bindInput("live-synchronization", "state", (value) => deliveries.push(["unexpected", value]));
  disconnectedRuntime.emit("data-store", "snapshot", { revision: 4 });
  assert.equal(deliveries.some(([target]) => target === "unexpected"), false);
});

test("application setup dependencies are compiled from graph wires rather than node ordering metadata", () => {
  const packageRoot = createVj1NodePackage();
  const group = packageRoot.applicationProgram;
  const withoutDataStore = {
    ...group,
    connections: group.connections.filter((edge) => edge.to !== "live.$dependency.data-store"),
  };
  assert.throws(
    () => packageRoot.createApplicationRuntime({ group: withoutDataStore }),
    /APPLICATION_PROGRAM_DEPENDENCY_MISSING:live-synchronization:data-store/
  );

  const mismatchedService = {
    ...group,
    connections: group.connections.map((edge) => edge.to === "live.$dependency.data-store"
      ? { ...edge, from: "diagnostics.$service" }
      : edge),
  };
  assert.throws(
    () => compileApplicationServicePlan(mismatchedService),
    /APPLICATION_PROGRAM_DEPENDENCY_ROLE_MISMATCH:live-synchronization:data-store:diagnostics/
  );
});

test("Application activation status distinguishes active, restart-required, and invalid setup graphs", () => {
  const packageRoot = createVj1NodePackage();
  const state = packageRoot.prepareProjectState(createInitialState());
  packageRoot.createApplicationRuntime();
  assert.deepEqual(
    { active: packageRoot.applicationProgramStatus(state).active, requiresRestart: packageRoot.applicationProgramStatus(state).requiresRestart },
    { active: true, requiresRestart: false }
  );

  const group = state.nodes.groups.find((item) => item.id === "vj1.application.program");
  const changedState = {
    ...state,
    nodes: {
      ...state.nodes,
      groups: state.nodes.groups.map((item) => item.id !== group.id ? item : {
        ...item,
        nodes: item.nodes.map((node) => node.id === "clock"
          ? { ...node, nodeId: "core.timing.rate-clock" }
          : node),
      }),
    },
  };
  assert.equal(packageRoot.applicationProgramStatus(changedState).requiresRestart, true);

  const invalidState = {
    ...state,
    nodes: {
      ...state.nodes,
      groups: state.nodes.groups.map((item) => item.id !== group.id ? item : {
        ...item,
        connections: item.connections.filter((edge) => edge.to !== "live.$dependency.data-store"),
      }),
    },
  };
  const invalid = packageRoot.applicationProgramStatus(invalidState);
  assert.equal(invalid.valid, false);
  assert.match(invalid.error, /APPLICATION_PROGRAM_DEPENDENCY_MISSING/);

  const dataflowChangedState = {
    ...state,
    nodes: {
      ...state.nodes,
      groups: state.nodes.groups.map((item) => item.id !== group.id ? item : {
        ...item,
        connections: item.connections.filter((edge) => edge.to !== "storage.value"),
      }),
    },
  };
  assert.equal(packageRoot.applicationProgramStatus(dataflowChangedState).requiresRestart, true);
});

test("application topology upgrades add setup wires once without restoring later authored removals", () => {
  const packageRoot = createVj1NodePackage();
  let state = packageRoot.prepareProjectState(createInitialState());
  const group = state.nodes.groups.find((item) => item.id === "vj1.application.program");
  const legacyGroup = {
    ...group,
    topologyVersion: 1,
    authoredConnections: true,
    connections: group.connections.filter((edge) => edge.phase !== "setup"),
  };
  state = packageRoot.prepareProjectState({
    ...state,
    nodes: {
      ...state.nodes,
      groups: state.nodes.groups.map((item) => item.id === legacyGroup.id ? legacyGroup : item),
    },
  });
  let upgraded = state.nodes.groups.find((item) => item.id === legacyGroup.id);
  assert.equal(upgraded.topologyVersion, 2);
  assert.equal(upgraded.connections.some((edge) => edge.phase === "setup"), true);

  upgraded = {
    ...upgraded,
    connections: upgraded.connections.filter((edge) => edge.to !== "live.$dependency.data-store"),
  };
  state = packageRoot.prepareProjectState({
    ...state,
    nodes: {
      ...state.nodes,
      groups: state.nodes.groups.map((item) => item.id === upgraded.id ? upgraded : item),
    },
  });
  assert.equal(state.nodes.groups.find((item) => item.id === upgraded.id).connections
    .some((edge) => edge.to === "live.$dependency.data-store"), false);
});

test("stored project Application wiring is preflighted before service construction", async () => {
  const packageRoot = createVj1NodePackage();
  const state = packageRoot.prepareProjectState(createInitialState());
  const payload = buildProjectPayload(state, "2026-07-20T00:00:00.000Z");
  const extracted = applicationProgramFromProjectData(payload, packageRoot);
  assert.equal(extracted.id, "vj1.application.program");
  assert.equal(packageRoot.compileApplicationProgram(extracted).services.nodes.length, extracted.nodes.length);

  const handle = {
    async queryPermission() { return "granted"; },
    async getFileHandle(name) {
      assert.equal(name, "project.json");
      return { async getFile() { return { async text() { return JSON.stringify(payload); } }; } };
    },
  };
  const loaded = await loadStoredApplicationProgram(packageRoot, {
    canLoad: () => true,
    loadHandle: async () => handle,
  });
  assert.equal(loaded.source, "stored-project");
  assert.equal(loaded.group.id, extracted.id);

  const permissionRequired = await loadStoredApplicationProgram(packageRoot, {
    canLoad: () => true,
    loadHandle: async () => ({ async queryPermission() { return "prompt"; } }),
  });
  assert.equal(permissionRequired.source, "permission-required");
  assert.equal(permissionRequired.group, packageRoot.applicationProgram);
});

test("invalid stored Application wiring enters explicit recoverable safe mode", async () => {
  const packageRoot = createVj1NodePackage();
  const state = packageRoot.prepareProjectState(createInitialState());
  const payload = buildProjectPayload(state, "2026-07-20T00:00:00.000Z");
  const group = payload.nodes.groups.find((item) => item.id === "vj1.application.program");
  group.authoredConnections = true;
  group.connections = group.connections.filter((edge) => edge.to !== "live.$dependency.data-store");
  const previousError = console.error;
  console.error = () => {};
  try {
    const result = await loadStoredApplicationProgram(packageRoot, {
      canLoad: () => true,
      loadHandle: async () => ({
        async queryPermission() { return "granted"; },
        async getFileHandle() {
          return { async getFile() { return { async text() { return JSON.stringify(payload); } }; } };
        },
      }),
    });
    assert.equal(result.source, "rejected");
    assert.match(result.warning, /APPLICATION_PROGRAM_DEPENDENCY_MISSING:live-synchronization:data-store/);
    assert.equal(result.group, packageRoot.applicationProgram);
  } finally {
    console.error = previousError;
  }
});

test("the Nodes workspace selects persisted project programs and preserves their authored layout", () => {
  const packageRoot = createVj1NodePackage();
  let state = packageRoot.prepareProjectState(createInitialState());
  const groupIds = [
    `vj1.component.${state.components[0].id}`,
    "vj1.scene.working",
    "vj1.output.main",
    "vj1.application.program",
  ];
  let nodes = state.nodes;
  for (const [index, groupId] of groupIds.entries()) {
    const group = nodes.groups.find((item) => item.id === groupId);
    assert.ok(group?.nodes?.length, `${groupId} has a visible graph`);
    nodes = withProjectGroupGraph(nodes, groupId, {
      ...group,
      nodes: group.nodes.map((node, nodeIndex) => nodeIndex === 0
        ? { ...node, position: { x: 120 + index * 10, y: 80 + index * 10 } }
        : node),
    });
  }
  state = packageRoot.prepareProjectState({
    ...state,
    nodes,
    ui: { ...state.ui, selectedNodeGroupId: groupIds[0] },
  });

  for (const [index, groupId] of groupIds.entries()) {
    assert.deepEqual(state.nodes.groups.find((item) => item.id === groupId).nodes[0].position, {
      x: 120 + index * 10,
      y: 80 + index * 10,
    });
  }
  const target = selectedNodeWorkspaceTarget(state, packageRoot);
  assert.equal(target.kind, "project-group");
  assert.equal(target.id, groupIds[0]);
  assert.match(nodeLibraryRailTemplate(state, packageRoot), /Project programs/);
  assert.match(nodeLibraryStudioTemplate(state, packageRoot), /data-topology-editable="true"/);
  assert.match(nodeLibraryInspectorTemplate(state, packageRoot), /Visual compiler · editable/);

  const sceneState = { ...state, ui: { ...state.ui, selectedNodeGroupId: "vj1.scene.working" } };
  assert.match(nodeLibraryStudioTemplate(sceneState, packageRoot), /data-connections-editable="true"/);
  assert.match(nodeLibraryStudioTemplate(sceneState, packageRoot), /data-nodes-editable="false"/);
  assert.match(nodeLibraryInspectorTemplate(sceneState, packageRoot), /Compiler nodes · connections editable/);

  const applicationState = { ...state, ui: { ...state.ui, selectedNodeGroupId: "vj1.application.program" } };
  const applicationStudio = nodeLibraryStudioTemplate(applicationState, packageRoot);
  assert.match(applicationStudio, /data-node-graph-port="state\.\$service"/);
  assert.match(applicationStudio, /data-node-graph-port="state\.snapshot"/);
  assert.match(applicationStudio, /data-node-graph-port="live\.\$dependency\.data-store"/);
  assert.match(applicationStudio, /data-node-graph-port="storage\.value"/);
  assert.match(applicationStudio, /\["service","state"\]/);
  assert.match(applicationStudio, /data-edge-editable="true"/);
  assert.match(applicationStudio, /data-edge-editable="false"/);
  assert.match(nodeLibraryInspectorTemplate(applicationState, packageRoot), /Executable wiring · editable/);

  const payload = buildProjectPayload(state, "2026-07-20T00:00:00.000Z");
  assert.equal(payload.ui.selectedNodeGroupId, groupIds[0]);
});

test("authored Scene routes survive topology refresh and control the compiled render program", () => {
  const packageRoot = createVj1NodePackage();
  let state = packageRoot.prepareProjectState(createInitialState());
  const groupId = "vj1.scene.working";
  const group = state.nodes.groups.find((item) => item.id === groupId);
  const removedSurfaceId = state.surfaces[0].id;
  const removedRouteOutput = `route:${removedSurfaceId}.route`;
  const connections = group.connections.filter((edge) => edge.from !== removedRouteOutput);

  state = packageRoot.prepareProjectState({
    ...state,
    nodes: withProjectGroupGraph(state.nodes, groupId, { ...group, connections }),
  });

  const refreshed = state.nodes.groups.find((item) => item.id === groupId);
  const program = compileSceneRenderPrograms(state, state.nodes.groups).get("");
  assert.equal(refreshed.authoredConnections, true);
  assert.equal(refreshed.connections.some((edge) => edge.from === removedRouteOutput), false);
  assert.equal(program.surfaces.some((surface) => surface.id === removedSurfaceId), false);
  assert.equal(program.surfaces.some((surface) => surface.id === state.surfaces[1].id), true);
});

test("a new Surface receives default Scene wiring without restoring an authored disconnection", () => {
  const packageRoot = createVj1NodePackage();
  let state = packageRoot.prepareProjectState(createInitialState());
  const groupId = "vj1.scene.working";
  const group = state.nodes.groups.find((item) => item.id === groupId);
  const removedSurfaceId = state.surfaces[0].id;
  const removedRouteOutput = `route:${removedSurfaceId}.route`;
  const nodes = withProjectGroupGraph(state.nodes, groupId, {
    ...group,
    connections: group.connections.filter((edge) => edge.from !== removedRouteOutput),
  });
  const addedSurface = { ...state.surfaces[1], id: "surface-added" };

  state = packageRoot.prepareProjectState({
    ...state,
    surfaces: [...state.surfaces, addedSurface],
    nodes,
  });

  const refreshed = state.nodes.groups.find((item) => item.id === groupId);
  const addedRouteId = `route:${addedSurface.id}`;
  const program = compileSceneRenderPrograms(state, state.nodes.groups).get("");
  assert.equal(refreshed.connections.some((edge) => edge.from === removedRouteOutput), false);
  assert.equal(refreshed.connections.some((edge) => edge.from === `${addedRouteId}.route` && edge.to === "surface-composition.state"), true);
  assert.equal(program.surfaces.some((surface) => surface.id === removedSurfaceId), false);
  assert.equal(program.surfaces.some((surface) => surface.id === addedSurface.id), true);
});

test("authored Output wiring survives preparation and gates the compiled Output program", () => {
  const packageRoot = createVj1NodePackage();
  let state = packageRoot.prepareProjectState(createInitialState());
  const groupId = "vj1.output.main";
  const group = state.nodes.groups.find((item) => item.id === groupId);

  state = packageRoot.prepareProjectState({
    ...state,
    nodes: withProjectGroupGraph(state.nodes, groupId, {
      ...group,
      connections: group.connections.filter((edge) => edge.to !== "$out.output"),
    }),
  });

  const refreshed = state.nodes.groups.find((item) => item.id === groupId);
  assert.equal(refreshed.connections.some((edge) => edge.to === "$out.output"), false);
  assert.equal(compileOutputRenderProgram(state.nodes.groups).enabled, false);
});

test("the application program constructs real services from its compiled setup wires", async () => {
  const packageRoot = createVj1NodePackage();
  const created = [];
  const service = (role, dependencies = {}) => {
    const value = { role, dependencies };
    created.push(role);
    return value;
  };
  const runtime = packageRoot.createApplicationRuntime({
    factories: {
      timing: () => service("timing"),
      "state-command": () => service("state-command"),
      "data-store": (dependencies) => service("data-store", dependencies),
      "media-lifecycle": () => service("media-lifecycle"),
      diagnostics: () => service("diagnostics"),
      "live-synchronization": (dependencies) => service("live-synchronization", dependencies),
      storage: (dependencies) => service("storage", dependencies),
      output: (dependencies) => service("output", dependencies),
    },
  });

  await runtime.initialize();

  assert.equal(runtime.get("data-store").dependencies["state-command"], runtime.get("state-command"));
  assert.equal(runtime.get("live-synchronization").dependencies["data-store"], runtime.get("data-store"));
  assert.equal(runtime.get("storage").dependencies["live-synchronization"], runtime.get("live-synchronization"));
  assert.equal(runtime.get("output").dependencies.cache.executionDomain, "output");
  assert.equal(packageRoot.registry.has(runtime.node("cache").nodeId, runtime.node("cache").nodeVersion), true);
  assert.deepEqual(created, [
    "timing", "state-command", "data-store", "media-lifecycle", "diagnostics",
    "live-synchronization", "storage", "output",
  ]);
});

test("the selected task editor exposes node parts and saves a live project shader version", () => {
  const packageRoot = createVj1NodePackage();
  const component = {
    id: "component-a",
    name: "A",
    type: "component",
    chain: [{
      id: "gradient-a",
      kind: "source",
      source: { type: "generator", generatorId: "gradient", params: { mode: "radial" } },
    }],
  };
  let state = packageRoot.prepareProjectState({
    components: [component],
    scenes: [],
    surfaces: [],
    ui: { selectedChainItemId: "gradient-a" },
    nodes: {},
  });
  const html = selectedNodeEditorTemplate(component, state, packageRoot);
  const definition = packageRoot.registry.get("vj1.visual.generator.gradient");
  const shader = definition.parts.find((part) => part.kind === "shader");
  const edited = `${shader.source}\n// edited in project`;

  assert.match(html, /data-node-editor/);
  assert.match(html, /Shaders/);
  assert.match(html, /data-node-part-source="fragment-shader"/);
  assert.match(html, /visual graphs retain their specialized compiler path/);

  state = {
    ...state,
    nodes: withProjectNodeFork(state.nodes, definition, { "fragment-shader": edited }),
  };
  const resolved = createProjectVisualNodeResolver(state).generatorShader("gradient");
  assert.equal(resolved.code, edited);
  assert.equal(resolved.renderAuthority, "project-node-fork");
});

test("composition root is instantiated only by the control application branch", () => {
  const source = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const outputBranch = source.slice(source.indexOf('if (mode === "output"'), source.indexOf("} else {"));
  const controlBranch = source.slice(source.indexOf("} else {"));
  assert.doesNotMatch(outputBranch, /createVj1NodePackage\(/);
  assert.match(controlBranch, /createVj1NodePackage\(/);
  assert.match(source, /no live-frame work is introduced/);
});

test("the Nodes workspace renders the registered library, group structure, and editable shader", () => {
  const packageRoot = createVj1NodePackage();
  const state = packageRoot.prepareProjectState(createInitialState());
  const rail = nodeLibraryRailTemplate(state, packageRoot);
  const groupState = { ...state, ui: { ...state.ui, selectedNodeDefinitionId: "core.mesh.parse-3d-object" } };
  const shaderState = { ...state, ui: { ...state.ui, selectedNodeDefinitionId: "vj1.visual.generator.gradient" } };

  assert.match(rail, /Node library/);
  assert.match(rail, /Test Pattern/);
  assert.match(rail, /Parse 3D Object/);
  assert.match(nodeLibraryStudioTemplate(groupState, packageRoot), /Graph canvas/);
  assert.match(nodeLibraryStudioTemplate(groupState, packageRoot), /data-node-graph-edge/);
  assert.match(nodeLibraryStudioTemplate(groupState, packageRoot), /STL Parser/);
  const inspector = nodeLibraryInspectorTemplate(shaderState, packageRoot);
  assert.match(inspector, /data-node-editor/);
  assert.match(inspector, /data-node-part-source="fragment-shader"/);
});
