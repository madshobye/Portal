import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createVj1NodePackage, projectArtifactViews } from "../js/app-node-package.js";
import { listGeneratorNodeComponents as listGeneratorComponents, listEffectNodeComponents as listShaderComponents } from "../js/libraries/visual-nodes/index.js";
import { compileComponentRenderPrograms } from "../js/libraries/composition-engine/index.js";
import { buildProjectPayload } from "../js/services/project-serializer.js";
import { createAppState } from "../js/app-state.js";
import { createInitialState } from "../js/domain/models.js";
import { selectedNodeEditorTemplate, withProjectNodeFork } from "../js/control/node-editor-view.js";
import { createProjectVisualNodeResolver } from "../js/libraries/visual-nodes/index.js";
import { nodeLibraryInspectorTemplate, nodeLibraryRailTemplate, nodeLibraryStudioTemplate } from "../js/control/node-library-view.js";

test("application composition root registers reusable visual node definitions", () => {
  const packageRoot = createVj1NodePackage();
  const expectedVisuals = listGeneratorComponents().length + listShaderComponents().length;

  assert.equal(packageRoot.registry.has("core.mesh.convert-3d-file-to-image"), true);
  assert.equal(packageRoot.registry.has("core.image.resize"), true);
  assert.equal(packageRoot.registry.has("core.synchronization.live-patches"), true);
  assert.equal(packageRoot.registry.has("core.storage.serialized-writes"), true);
  assert.equal(packageRoot.registry.has("core.composition.surface-routes"), true);
  assert.equal(packageRoot.registry.has("core.media.input-lifecycle"), true);
  const waves = packageRoot.registry.get("vj1.visual.generator.waves");
  assert.equal(waves.implementation.kind, "shader");
  assert.match(waves.parts.find((part) => part.kind === "shader")?.source || "", /gl_FragColor/);
  assert.equal(packageRoot.artifacts.list({ artifactType: "visual-element" }).length, expectedVisuals);
  assert.equal(packageRoot.artifacts.list({ view: "component-catalog" }).some((item) => item.id === "core.control.slider"), false);
  assert.equal(packageRoot.artifacts.list({ catalog: "component" }).length, 0, "built-in elements never become project Components");
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
    ["$in.texture", "source-a.texture"],
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
});

test("pre-node project snapshots compile once into the same Component render program", () => {
  const component = {
    id: "old-component",
    type: "component",
    chain: [{ id: "old-source", kind: "source", source: { type: "generator", generatorId: "waves" } }],
  };
  const programs = compileComponentRenderPrograms([component], []);
  const program = programs.get(component.id);
  let renderedChain = null;
  const result = program.execute({
    renderComponentChainState(_component, chain) {
      renderedChain = chain;
      return "rendered";
    },
  }, component, 0, { width: 640, height: 360 });

  assert.equal(result, "rendered");
  assert.equal(program.generatedBy, "vj1-component-compiler");
  assert.deepEqual(renderedChain.map((item) => item.id), ["old-source"]);
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
  assert.equal(packageRoot.applicationProgram.id, program.id);
  assert.equal(packageRoot.registry.get("core.control.slider").presentation.hiddenFrom.includes("component-catalog"), true);
  assert.equal(packageRoot.registry.has("core.control.value"), true);
});

test("the application program constructs real services from its persisted dependency roles", async () => {
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
  assert.match(nodeLibraryStudioTemplate(groupState, packageRoot), /Internal group structure/);
  assert.match(nodeLibraryStudioTemplate(groupState, packageRoot), /STL Parser/);
  const inspector = nodeLibraryInspectorTemplate(shaderState, packageRoot);
  assert.match(inspector, /data-node-editor/);
  assert.match(inspector, /data-node-part-source="fragment-shader"/);
});
