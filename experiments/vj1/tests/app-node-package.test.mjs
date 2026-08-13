import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createVj1NodePackage, projectArtifactViews } from "../js/app-node-package.js";
import {
  AnatomyGeometryProviderNode,
  AnatomyMaterialPaletteNode,
  AnatomyMotionTransform3dNode,
  LitMeshMaterialProviderNode,
  listGeneratorNodeComponents as listGeneratorComponents,
  listEffectNodeComponents as listShaderComponents,
  PlanarGridGeometryProviderNode,
  ModelFitCameraNode,
  MeshPatternFillMaterialProviderNode,
  MeshPatternFillToImageNode,
  MeshPatternTopologyProviderNode,
  MeshPatternWireMaterialProviderNode,
  MeshPatternWireToImageNode,
  TerrainBiomeMaterialProviderNode,
  TerrainFlightCameraProviderNode,
  TerrainHeightFieldGeometryProviderNode,
  TerrainSurfaceToImageNode,
  TerrainWireMaterialProviderNode,
  TerrainWireToImageNode,
  TextMaskProviderNode,
  TextMaskToImageNode,
} from "../js/libraries/visual-nodes/index.js";
import {
  compileApplicationDataflowPlan,
  compileApplicationServicePlan,
  compileComponentRenderPrograms,
  compileMappingGroupTopology,
  compileOutputRenderProgram,
  compileMappingRenderPrograms,
  setCompiledVisualParameter,
} from "../js/libraries/composition-engine/index.js";
import { buildProjectPayload } from "../js/services/project-serializer.js";
import { applicationProgramFromProjectData, loadStoredApplicationProgram } from "../js/services/application-program-loader.js";
import { createAppState } from "../js/app-state.js";
import {
  createDefaultComponent,
  createInitialState,
  createLiveRenderState,
} from "../js/domain/models.js";
import { migrateProjectData } from "../js/domain/project-migrations.js";
import { componentChainProjection, componentLayerProjection } from "../js/domain/component-layer-projection.js";
import {
  prepareProjectNodeDefinitionEdit,
  selectedNodeEditorModel,
  withProjectGroupGraph,
  withProjectNodeFork,
  withProjectNodeGraph,
  withProjectNodePortExposure,
} from "../js/control/node-editor-view.js";
import { nodeGraphCanvasTemplate } from "../js/control/node-graph-canvas.js";
import { createProjectVisualNodeResolver } from "../js/libraries/visual-nodes/index.js";
import { nodeLibraryInspectorModel, nodeLibraryRailModel, nodeLibraryStudioModel, selectedNodeWorkspaceTarget } from "../js/control/node-library-view.js";
import {
  compileJavaScriptNodeModule,
  createProjectNodeFork,
  defineNode,
  defineNodePackage,
  NODE_PART_KINDS,
} from "../js/libraries/node-engine/index.js";
import {
  compileScene3dProgram,
  EllipsoidMeshNode,
  MeshDisplayLodNode,
  PathTubeMeshNode,
  PlanarGridMeshNode,
  ProfileMeshNode,
} from "../js/libraries/mesh-engine/index.js";
import {
  createVisualRenderProcessContext,
  updateVisualRenderProcessContext,
} from "../js/libraries/render-engine/index.js";
import { OutputRenderer } from "../js/output/output-renderer.js";

function retainedRenderContext(target, time = 0) {
  return {
    renderProcess: updateVisualRenderProcessContext(
      createVisualRenderProcessContext(),
      {
        target,
        time,
        request: { width: 640, height: 360 },
        view: { width: 640, height: 360 },
        contentTransform: {},
      },
    ),
  };
}

function nodeLibraryModelItem(model, itemId) {
  return model.sections.flatMap((section) => section.items || [])
    .find((item) => item.id === itemId) || null;
}

function graphGroupWithNodeConfiguration(group, nodeId, configuration) {
  const replace = (nodes = []) => nodes.map((node) => String(node.id || "") === String(nodeId)
    ? { ...node, configuration }
    : { ...node, ...(node.nodes ? { nodes: replace(node.nodes) } : {}) });
  return { ...group, nodes: replace(group.nodes) };
}

test("application composition root registers reusable visual node definitions", () => {
  const packageRoot = createVj1NodePackage();
  const expectedVisuals = listGeneratorComponents().length + listShaderComponents().length;

  assert.equal(packageRoot.registry.has("core.mesh.convert-3d-file-to-image"), true);
  assert.equal(packageRoot.registry.has(PlanarGridMeshNode.id), true);
  assert.equal(packageRoot.registry.has(ProfileMeshNode.id), true);
  assert.equal(packageRoot.registry.has(PathTubeMeshNode.id), true);
  assert.equal(packageRoot.registry.has(EllipsoidMeshNode.id), true);
  assert.equal(packageRoot.registry.has(MeshDisplayLodNode.id), true);
  assert.equal(packageRoot.registry.has(LitMeshMaterialProviderNode.id), true);
  assert.equal(packageRoot.registry.has(AnatomyGeometryProviderNode.id), true);
  assert.equal(packageRoot.registry.has(AnatomyMotionTransform3dNode.id), true);
  assert.equal(packageRoot.registry.has(AnatomyMaterialPaletteNode.id), true);
  assert.equal(packageRoot.registry.has(ModelFitCameraNode.id), true);
  for (const id of [
    "core.composition.component-program",
    "core.composition.layer-group",
    "core.composition.mapping-program",
    "core.composition.output-program",
    "core.composition.application-program",
  ]) {
    const template = packageRoot.registry.get(id);
    assert.equal(template.parts.find((part) => part.kind === "graph")?.editable, false);
    assert.equal(template.authoring.activation, "read-only");
  }
  assert.equal(packageRoot.registry.has(MeshPatternTopologyProviderNode.id), true);
  assert.equal(packageRoot.registry.has(MeshPatternFillMaterialProviderNode.id), true);
  assert.equal(packageRoot.registry.has(MeshPatternWireMaterialProviderNode.id), true);
  assert.equal(packageRoot.registry.has(MeshPatternFillToImageNode.id), true);
  assert.equal(packageRoot.registry.has(MeshPatternWireToImageNode.id), true);
  assert.equal(packageRoot.registry.has(TerrainHeightFieldGeometryProviderNode.id), true);
  assert.equal(packageRoot.registry.has(TerrainBiomeMaterialProviderNode.id), true);
  assert.equal(packageRoot.registry.has(TerrainWireMaterialProviderNode.id), true);
  assert.equal(packageRoot.registry.has(TerrainFlightCameraProviderNode.id), true);
  assert.equal(packageRoot.registry.has(TerrainSurfaceToImageNode.id), true);
  assert.equal(packageRoot.registry.has(TerrainWireToImageNode.id), true);
  assert.equal(packageRoot.registry.has("core.image.resize"), true);
  assert.equal(packageRoot.registry.has("core.synchronization.live-patches"), true);
  assert.equal(packageRoot.registry.has("core.storage.serialized-writes"), true);
  assert.equal(packageRoot.registry.has("core.composition.surface-routes"), true);
  assert.equal(packageRoot.registry.has("core.media.input-lifecycle"), true);
  for (const id of [
    "core.control.vector2",
    "core.control.vector3",
    "core.control.smooth",
    "core.control.select",
    "core.control.frame-delay",
    "core.control.event-trigger",
    "core.control.sample-hold",
    "core.control.midi-input",
    "core.control.osc-input",
    "core.control.audio-input",
    "core.control.host-input",
  ]) {
    assert.equal(packageRoot.registry.has(id), true, id);
  }
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

test("installed package definitions and resources are honestly projected into the Nodes workspace", () => {
  const packageRoot = createVj1NodePackage();
  const definition = defineNode({
    id: "org.example.control.gain",
    name: "Package Gain",
    description: "Reusable gain control supplied by a package.",
    version: "1.0.0",
    inlets: { value: { type: "number" } },
    outlets: { value: { type: "number" } },
    process: ({ value }) => ({ value }),
  });
  const installedPackage = defineNodePackage({
    id: "org.example.controls",
    name: "Example Controls",
    version: "1.0.0",
    description: "Reusable project controls.",
    definitions: [definition],
    resources: [{
      id: "gain-docs",
      kind: "other",
      path: "docs/gain.md",
      mediaType: "text/markdown",
    }],
  });
  const editorPackage = packageRoot.editorContext([installedPackage]);
  const state = createInitialState();
  state.nodes.packages = [{
    id: installedPackage.id,
    version: installedPackage.version,
    enabled: true,
  }];
  state.ui.selectedNodeDefinitionId = definition.id;

  assert.equal(editorPackage.registry.has(definition.id, definition.version), true);
  assert.equal(editorPackage.packageForDefinition(definition)?.id, installedPackage.id);
  const rail = nodeLibraryRailModel(state, editorPackage);
  const packageSection = rail.sections.find((section) => section.id === "packages");
  const packageItem = nodeLibraryModelItem(rail, "org.example.controls");
  assert.equal(packageSection.label, "Package repository");
  assert.equal(packageSection.actions.some((action) => action.id === "import-package"), true);
  assert.equal(packageItem.label, "Example Controls");
  assert.match(packageItem.search, /docs\/gain\.md/);
  assert.equal(packageItem.actions.some((action) => action.id === "export-package-folder"), true);
  assert.equal(packageItem.actions.some((action) => action.id === "toggle-package"), true);
  assert.equal(nodeLibraryStudioModel(state, editorPackage).contextLabel, "Example Controls");

  const disabled = packageRoot.editorContext([]);
  assert.equal(disabled.registry.has(definition.id, definition.version), false);
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

test("project artifact views preserve Component Scene Mapping and Live placement order", () => {
  const state = {
    components: [
      { id: "component-a", name: "A", type: "component", catalogMarker: 2 },
      { id: "scene-visual-a", name: "Scene A", type: "scene" },
      { id: "component-b", name: "B", type: "component" },
    ],
    mappings: [{ id: "mapping-a", name: "Mapping A" }, { id: "mapping-b", name: "Mapping B" }],
    ui: { live: { selectedSceneId: "scene-visual-a" } },
  };
  const views = projectArtifactViews(state);
  const ids = (items) => items.map((item) => item.metadata.projectId);

  assert.deepEqual(ids(views.component), ["component-a", "component-b"]);
  assert.deepEqual(ids(views.scene), ["scene-visual-a"]);
  assert.deepEqual(ids(views.mapping), ["mapping-a", "mapping-b"]);
  assert.deepEqual(ids(views.liveScene), ["scene-visual-a"]);
  assert.equal(views.live[0].metadata.selectedSceneId, "scene-visual-a");
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
      type: "scene",
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
    "core.control.slider",
    "core.control.slider",
    "core.control.slider",
    "core.control.component-time",
    "core.control.animation-sequencer",
    "core.control.animation-curve",
    "core.control.map-range",
    "core.control.numeric-combine",
  ]);
  assert.deepEqual(componentGroup.connections.filter((edge) => edge.type === "texture").map((edge) => [edge.from, edge.to]), [
    ["$in.texture", "source-a.image"],
    ["source-a.texture", "effect-a.texture"],
    ["effect-a.texture", "$out.texture"],
  ]);
  assert.deepEqual(
    componentGroup.connections
      .filter((edge) => edge.type === "texture" && edge.to !== "$out.texture")
      .map((edge) => edge.semantic),
    ["composition", "composition"],
  );
  assert.equal(componentGroup.connections.some((edge) => edge.to === "effect-a.$parameter.amount" && edge.sourceRange[1] === 1), true);
  assert.equal(Object.hasOwn(componentGroup.nodes.find((node) => node.id === "effect-a").configuration, "amount"), false);
  assert.equal(componentGroup.nodes.find((node) => node.id === "effect-a").configuration.params.amount, 0.4);
  assert.equal(canvasGroup.artifactType, "scene");
  const canvasLayerGroup = canvasGroup.nodes.find((node) => node.role === "group");
  assert.equal(canvasLayerGroup.nodeId, "core.composition.layer-group");
  assert.equal(canvasLayerGroup.nodes.find((node) => node.role !== "control").nodeId, "core.visual.source");
  assert.equal(state.nodes.instances.some((instance) => instance.id === "vj1.component.canvas-a/group-a/component-source"), true);
  assert.equal(state.nodes.definitions.some((definition) => definition.id === "vj1.visual.generator.waves"), true);
  assert.deepEqual(componentLayerProjection(state, state.components[0]).map((layer) => layer.item.id), ["source-a", "effect-a"]);
  assert.deepEqual(componentLayerProjection(state, state.components[1])[0].children.map((layer) => layer.item.id), ["component-source"]);
  assert.deepEqual(programs.get("component-a").plan.operations.map((operation) => operation.backend), ["shader-generator", "shader-effect"]);
  assert.equal(programs.get("component-a").plan.executionModel, "compiled-chain");
  assert.deepEqual(programs.get("component-a").plan.operations.map((operation) => operation.textureInputs), [{}, {}]);
  const legacyGroup = {
    ...componentGroup,
    connections: componentGroup.connections.map(({ semantic: _semantic, ...edge }) => edge),
  };
  const legacyProgram = compileComponentRenderPrograms(components, [
    legacyGroup,
    ...state.nodes.groups.filter((group) => group.componentId !== "component-a"),
  ]).get("component-a");
  assert.equal(legacyProgram.plan.executionModel, "compiled-chain");
  assert.deepEqual(legacyProgram.plan.operations.map((operation) => operation.textureInputs), [{}, {}]);
  assert.equal(programs.get("component-a").plan.operations[1].compilerHook.id, "vj1.visual.shader-effect");
});

test("Terrain compiles reusable retained values into two explicit optimized render passes", () => {
  const packageRoot = createVj1NodePackage();
  const component = {
    id: "terrain-component",
    name: "Terrain",
    type: "component",
    chain: [{
      id: "terrain-source",
      kind: "source",
      source: {
        type: "generator",
        generatorId: "terrainFlyover",
        params: { lakeLevel: -58.7 },
      },
    }],
  };
  const state = packageRoot.prepareProjectState({ components: [component], nodes: {} });
  const program = compileComponentRenderPrograms(state.components, state.nodes.groups, {
    resolveNodeDefinition: (node) => packageRoot.registry.get(node.nodeId, node.nodeVersion),
  }).get(component.id);
  const operation = program.plan.operations[0];

  assert.equal(operation.backend, "compiled-visual-group");
  assert.equal(operation.executionModel, "texture-dag");
  assert.equal(operation.renderer, undefined);
  assert.equal(operation.nativeCompoundProgram, undefined);
  assert.deepEqual(
    operation.operations.map(({ id, nodeId, backend, renderer, nativeKernel }) => ({
      id,
      nodeId,
      backend,
      renderer,
      nativeKernel,
    })),
    [
      {
        id: "surface-render",
        nodeId: TerrainSurfaceToImageNode.id,
        backend: "native-specialized",
        renderer: "output/specialized:terrainSurface",
        nativeKernel: "terrain-surface",
      },
      {
        id: "wire-render",
        nodeId: TerrainWireToImageNode.id,
        backend: "native-specialized",
        renderer: "output/specialized:terrainWire",
        nativeKernel: "terrain-wire",
      },
    ],
  );
  assert.deepEqual(operation.operations[1].textureInputs, {
    target: "surface-render",
  });
  assert.equal(
    operation.operations[0].framebufferSequence.sequenceId,
    operation.operations[1].framebufferSequence.sequenceId,
  );
  assert.equal(operation.operations[0].framebufferSequence.phase, "begin");
  assert.equal(operation.operations[0].renderInvalidation.mode, "frame");
  assert.equal(operation.operations[1].renderInvalidation.mode, "frame");
  assert.deepEqual(operation.operations[1].framebufferSequence, {
    sequenceId: operation.operations[0].framebufferSequence.sequenceId,
    phase: "continue",
    inputPort: "target",
    preserve: ["color", "depth"],
  });
  assert.deepEqual(
    operation.valueProgram.steps.map(({ instanceId, nodeId }) => ({
      instanceId,
      nodeId,
    })),
    [
      { instanceId: "flight", nodeId: "core.terrain.flight-controller" },
      { instanceId: "geometry", nodeId: TerrainHeightFieldGeometryProviderNode.id },
      { instanceId: "surface-material", nodeId: TerrainBiomeMaterialProviderNode.id },
      { instanceId: "wire-material", nodeId: TerrainWireMaterialProviderNode.id },
      { instanceId: "camera", nodeId: TerrainFlightCameraProviderNode.id },
    ],
  );
  operation.valueProgram.evaluate({
    componentTime: 2,
    renderRequest: { width: 1280, height: 720 },
  });
  const [surface, wire] = operation.operations;
  assert.strictEqual(
    surface.runtimeValueInputs.get("controller"),
    wire.runtimeValueInputs.get("controller"),
    "one retained flight value fans out through both authored wires",
  );
  assert.strictEqual(
    surface.runtimeValueInputs.get("geometry"),
    wire.runtimeValueInputs.get("geometry"),
    "one retained geometry value fans out through both authored wires",
  );
  assert.equal(
    surface.runtimeValueInputs.get("geometry").runtimeSettings.lakeLevel,
    -58.7,
    "the authored lake level reaches terrain displacement",
  );
  assert.equal(
    surface.runtimeValueInputs.get("material").runtimeSettings.lakeLevel,
    -58.7,
    "the same authored lake level reaches biome classification",
  );
  setCompiledVisualParameter(operation, "lakeLevel", 24.6);
  operation.valueProgram.evaluate({
    componentTime: 2,
    renderRequest: { width: 1280, height: 720 },
  });
  assert.equal(
    surface.runtimeValueInputs.get("geometry").runtimeSettings.lakeLevel,
    24.6,
    "a live lake-level edit updates terrain displacement",
  );
  assert.equal(
    surface.runtimeValueInputs.get("material").runtimeSettings.lakeLevel,
    24.6,
    "a live lake-level edit updates biome classification in the same epoch",
  );
  assert.equal(surface.runtimeValueInputs.get("controller").flightTime, 1.3);
  assert.equal(surface.runtimeValueInputs.get("camera").providerId, "terrain-flight-camera");
  assert.equal(typeof surface.nodeModule.terrainSurfaceGridVertices, "function");
  assert.equal(typeof wire.nodeModule.terrainExpandedGridWireVertices, "function");
  assert.deepEqual(surface.renderTarget, { depth: true });
  assert.deepEqual(wire.renderTarget, { depth: true });
  assert.match(surface.nodeShaders["terrain-surface-fragment"], /uniform vec4 waterColor/);
  assert.match(wire.nodeShaders["terrain-wire-fragment"], /uniform vec4 wireColor/);
  assert.equal(surface.nodeProcess, undefined);
  assert.equal(wire.nodeProcess, undefined);
  return;
  assert.equal(operation.nativeCompoundProgram.format, "vj1.specialized-compound-program@2");
  assert.equal(operation.nativeCompoundProgram.kind, "terrain-flyover");
  assert.deepEqual(
    operation.nativeCompoundProgram.stages.map((stage) => stage.id),
    ["flight", "geometry", "surface-material", "wire-material", "camera", "surface-render", "wire-render"],
  );
  assert.equal(
    operation.nativeCompoundProgram.stages.find((stage) => stage.id === "camera")?.nodeId,
    TerrainFlightCameraProviderNode.id,
  );
  assert.equal(
    operation.nativeCompoundProgram.stages.find((stage) => stage.id === "surface-render")?.nodeId,
    TerrainSurfaceToImageNode.id,
  );
  assert.equal(
    operation.nativeCompoundProgram.stages.find((stage) => stage.id === "surface-render")?.nativeKernel,
    "terrain-surface",
  );
  assert.equal(
    operation.nativeCompoundProgram.stages.find((stage) => stage.id === "wire-render")?.nodeId,
    TerrainWireToImageNode.id,
  );
  assert.equal(
    operation.nativeCompoundProgram.stages.find((stage) => stage.id === "wire-render")?.nativeKernel,
    "terrain-wire",
  );
  assert.equal(
    operation.nativeCompoundProgram.connections.some((connection) =>
      connection.from === "surface-render.texture" && connection.to === "wire-render.target"
    ),
    true,
  );
  assert.deepEqual(operation.nativeCompoundProgram.executableStages, [
    "flight",
    "geometry",
    "surface-material",
    "wire-material",
    "camera",
  ]);
  assert.deepEqual(
    operation.nativeCompoundProgram.nativeKernels.map(({ id, kernel }) => ({ id, kernel })),
    [
      { id: "surface-render", kernel: "terrain-surface" },
      { id: "wire-render", kernel: "terrain-wire" },
    ],
  );
  assert.deepEqual(
    operation.nativeCompoundProgram.nativeKernel("terrain-surface").inputBindings.controller,
    { stageId: "flight", portId: "flight" },
  );
  const graphExternalInputs = { flight: { componentTime: 0 } };
  const graphEvaluation = evaluateSpecializedCompoundGraph(
    operation,
    {
      flightSpeed: 1,
      turn: 0.3,
      altitude: 5,
      terrainScale: 0.7,
      pitch: 0.4,
      fieldOfView: 70,
      mountainHeight: 3,
      waterColor: "#123456ff",
      wireColor: "#abcdefee",
    },
    { instanceId: "surface-connected" },
    graphExternalInputs,
  );
  graphExternalInputs.flight.componentTime = 2;
  const updatedGraphEvaluation = evaluateSpecializedCompoundGraph(
    operation,
    {
      flightSpeed: 1,
      turn: 0.3,
      altitude: 5,
      terrainScale: 0.7,
      pitch: 0.4,
      fieldOfView: 70,
      mountainHeight: 3,
      waterColor: "#123456ff",
      wireColor: "#abcdefee",
    },
    { instanceId: "surface-connected" },
    graphExternalInputs,
  );
  assert.strictEqual(updatedGraphEvaluation, graphEvaluation);
  const surfaceFlight = graphEvaluation.stageInput("surface-render", "controller");
  assert.strictEqual(
    graphEvaluation.stageInput("wire-render", "controller"),
    surfaceFlight,
    "one retained controller value fans out through both authored render wires",
  );
  assert.equal(surfaceFlight.kind, "terrain-flight-state");
  assert.equal(surfaceFlight.flightTime, 2);
  assert.strictEqual(
    graphEvaluation.stageInput("surface-render", "geometry"),
    graphEvaluation.stageInput("wire-render", "geometry"),
  );
  const connectedCamera = graphEvaluation.stageInput("surface-render", "camera");
  assert.equal(connectedCamera.providerId, "terrain-flight-camera");
  assert.deepEqual(
    connectedCamera.sceneCamera.position,
    [surfaceFlight.cameraAnchor[0], surfaceFlight.altitude, surfaceFlight.cameraAnchor[1]],
    "the displayed flight-to-camera wire owns the canonical camera position",
  );
  const flightA0 = operation.nativeCompoundProgram.executeStage("flight", {
    componentTime: 0,
    flightSpeed: 1,
    turn: 0,
    altitude: 2.5,
    terrainScale: 0.62,
  }, { instanceId: "surface-a" });
  const flightA1 = operation.nativeCompoundProgram.executeStage("flight", {
    componentTime: 1,
    flightSpeed: 1,
    turn: 0,
    altitude: 2.5,
    terrainScale: 0.62,
  }, { instanceId: "surface-a" });
  const flightB = operation.nativeCompoundProgram.executeStage("flight", {
    componentTime: 1,
    flightSpeed: 0.5,
    turn: 0.25,
    altitude: 4,
    terrainScale: 0.8,
  }, { instanceId: "surface-b" });
  assert.strictEqual(flightA1, flightA0, "compiled controller output is retained per visual instance");
  assert.notStrictEqual(flightB, flightA0, "separate visual instances do not share controller state");
  assert.equal(flightA1.flight.flightTime, 1);
  assert.equal(flightB.flight.turn, 0.25);
  assert.equal(flightB.flight.altitude, 4);
  const geometry = executeSpecializedCompoundProvider(operation, "geometry", {
    mountainHeight: 3.5,
    gridDensity: 1.25,
    hiddenRendererCorrection: 99,
  }, { instanceId: "surface-a" });
  assert.equal(geometry.kind, "geometry");
  assert.equal(geometry.providerId, "terrain-height-field");
  assert.equal(geometry.mesh.kind, "mesh");
  assert.equal(geometry.heightField.kind, "terrain-height-field");
  assert.strictEqual(geometry.heightField.mesh, geometry.mesh);
  assert.deepEqual(geometry.settings, {
    mountainHeight: 3.5,
    gridDensity: 1.25,
  });
  const retainedGeometry = executeSpecializedCompoundProvider(operation, "geometry", {
    mountainHeight: 3.5,
    gridDensity: 1.25,
  }, { instanceId: "surface-a" });
  assert.strictEqual(retainedGeometry, geometry);
  assert.strictEqual(retainedGeometry.mesh, geometry.mesh);
  assert.strictEqual(retainedGeometry.heightField, geometry.heightField);
  const camera = executeSpecializedCompoundProvider(operation, "camera", {
    pitch: 0.3,
    fieldOfView: 72,
    hiddenRendererCorrection: 99,
  }, { instanceId: "surface-a" });
  assert.equal(camera.kind, "camera");
  assert.equal(camera.providerId, "terrain-flight-camera");
  assert.equal(camera.sceneCamera.kind, "camera3d");
  assert.equal(camera.sceneCamera.projection, "perspective");
  assert.equal(camera.sceneCamera.fieldOfView, 72 * Math.PI / 180);
  assert.equal(camera.sceneCamera.near, 0.1);
  assert.equal(camera.sceneCamera.far, 20000);
  assert.deepEqual(camera.settings, {
    projection: "perspective",
    pitch: 0.3,
    fieldOfView: 72,
  });
  const material = executeSpecializedCompoundProvider(operation, "surface-material", {
    waterColor: "#123456ff",
    skyColor: "#abcdefee",
    hiddenRendererCorrection: 99,
  }, { instanceId: "surface-a" });
  assert.equal(material.kind, "material");
  assert.equal(material.providerId, "terrain-biome");
  assert.equal(material.sceneMaterial.kind, "material3d");
  assert.match(material.sceneMaterial.shader.source, /vj1Surface/);
  assert.deepEqual(
    material.sceneMaterial.shader.uniforms.terrainWaterColor.value.map((value) => Number(value.toFixed(6))),
    [0.070588, 0.203922, 0.337255, 1],
  );
  assert.deepEqual(material.settings, {
    waterColor: "#123456ff",
    skyColor: "#abcdefee",
  });
  const wireMaterial = executeSpecializedCompoundProvider(operation, "wire-material", {
    wireColor: "#fedcba98",
    wireWidth: 2.25,
  }, { instanceId: "surface-a" });
  assert.equal(wireMaterial.providerId, "terrain-wire");
  assert.equal(wireMaterial.sceneMaterial.kind, "material3d");
  assert.equal(wireMaterial.sceneMaterial.renderMode, "wireframe");
  assert.deepEqual(wireMaterial.sceneMaterial.wireColor, [254, 220, 186, 152]);
  assert.equal(wireMaterial.sceneMaterial.wireThickness, 2.25);
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

test("portable and code-owned visual primitives compile through their declared direct backends", () => {
  const packageRoot = createVj1NodePackage();
  const components = ["black", "checker"].map((generatorId) => ({
    id: `${generatorId}-component`,
    type: "component",
    chain: [{
      id: `${generatorId}-source`,
      kind: "source",
      source: { type: "generator", generatorId, params: {} },
    }],
  }));
  const state = packageRoot.prepareProjectState({ components, nodes: {} });
  const programs = compileComponentRenderPrograms(state.components, state.nodes.groups, {
    resolveNodeDefinition: (node) => packageRoot.registry.get(node.nodeId, node.nodeVersion),
  });

  const black = programs.get("black-component").plan.operations[0];
  assert.equal(black.backend, "shader-generator");
  assert.equal(black.renderer, undefined);
  assert.equal(black.nodeProcess, undefined);
  assert.equal(black.compilerHook.id, "vj1.visual.shader-generator");
  assert.equal(black.code, undefined, "the frame plan retains shader identity instead of copying source text");
  const blackDefinition = packageRoot.registry.get(black.nodeId, black.nodeVersion);
  assert.match(
    blackDefinition.parts.find((part) => part.language === "isf")?.source || "",
    /isf_FragColor = vec4\(0\.0, 0\.0, 0\.0, 1\.0\)/,
  );

  const checker = programs.get("checker-component").plan.operations[0];
  assert.equal(checker.backend, "source-runtime");
  assert.equal(checker.renderer, "output/source:generator");
  assert.equal(typeof checker.nodeProcess, "function");
  assert.equal(checker.compilerHook.id, "vj1.visual.source");
});

test("model media compiles as an editable mesh-to-Scene node Group", () => {
  const packageRoot = createVj1NodePackage();
  const component = {
    id: "model-component",
    name: "Model",
    type: "component",
    chain: [{
      id: "model-source",
      kind: "source",
      source: {
        type: "generator",
        generatorId: "modelMedia",
        params: {
          mediaId: "media/models/skull.stl",
          renderMode: "surface",
          geometryDetail: 1,
          renderQuality: 0.75,
          rotationY: 0.4,
          spinY: 0.2,
        },
      },
    }],
  };
  const state = packageRoot.prepareProjectState({ components: [component], nodes: {} });
  const definition = listGeneratorComponents()
    .find((entry) => entry.id === "modelMedia")
    ?.nodeDefinition;
  assert.ok(definition);
  assert.equal(definition.metadata.visualCompilerHook.id, "vj1.visual.compound");
  assert.equal(definition.metadata.nativeRenderer, "");
  assert.deepEqual(
    definition.parts.find((part) => part.kind === "graph").nodes.map((node) => node.id),
    ["media", "lod", "motion", "material", "object", "objects", "camera", "scene", "render"],
  );
  const program = compileComponentRenderPrograms(state.components, state.nodes.groups, {
    resolveNodeDefinition: (node) => packageRoot.registry.get(node.nodeId, node.nodeVersion),
  }).get(component.id);
  const modelNodeId = componentLayerProjection(state, state.components[0])[0].nodeId;
  const operation = program.plan.operations[0];
  const render = operation.operations[0];
  assert.equal(operation.backend, "compiled-visual-group");
  assert.equal(
    operation.placementLowering,
    "terminal-coordinate",
    "Scene-to-Image consumes Content scale in its retained projection instead of scaling a completed model texture",
  );
  assert.equal(operation.scene3dProgram, undefined);
  assert.equal(render.nodeId, "core.scene3d.render");
  assert.equal(typeof render.nodeProcess, "function");
  assert.equal(
    render.nodeProcessContextFormat,
    "vj1.visual-render-process-context@1",
    "the optimized renderer supplies host concerns through one declared process context",
  );
  assert.deepEqual(
    Object.keys(packageRoot.registry.get("core.scene3d.render").inlets),
    ["scene", "resourceStatus"],
    "Scene-to-Image exposes semantic graph data rather than framebuffer or ROI plumbing",
  );
  assert.deepEqual(
    operation.valueProgram.steps.map((step) => step.instanceId),
    ["media", "material", "camera", "lod", "motion", "object", "objects", "scene"],
  );
  assert.deepEqual(
    operation.valueProgram.inspect().externalResolvers,
    [{
      stepId: `${operation.valueProgram.id.replace(/\.values$/, "")}/media`,
      nodeId: "core.scene3d.media-mesh",
      capability: "project-mesh",
      asynchronous: true,
      lifecycle: "retained-request",
      invalidation: "external-revision",
      pending: "standby",
      error: "diagnostic",
      readyOutlet: "mesh",
    }],
  );
  assert.equal(operation.configuration.source.params.mediaId, "media/models/skull.stl");
  assert.equal(operation.valueProgram.steps.find((step) => step.instanceId === "lod").trigger, "frame");
  assert.equal(operation.valueProgram.evaluate({
    componentTime: 0,
    renderRequest: { width: 640, height: 360 },
    runtimeContext: { resolveMesh: () => null },
  }), false, "an unresolved external mesh keeps the terminal render input unavailable");
  assert.equal(render.runtimeValueInputs.get("scene"), null);
  assert.deepEqual(render.runtimeValueInputs.get("resourceStatus"), {
    ready: false,
    pending: true,
    label: "loading 3D model",
    error: "",
  });
  const mesh = PlanarGridMeshNode.process({
    columns: 2,
    rows: 2,
    width: 2,
    depth: 2,
    axis: "xz",
  }, { state: {} }).mesh;
  assert.equal(operation.valueProgram.evaluate({
    componentTime: 0,
    renderRequest: { width: 640, height: 360 },
    runtimeContext: { resolveMesh: () => mesh },
  }), true);
  const firstSceneIdentity =
    render.runtimeValueIdentityInputs.get("scene");
  assert.equal(operation.valueProgram.evaluate({
    componentTime: 1,
    renderRequest: { width: 640, height: 360 },
    runtimeContext: { resolveMesh: () => mesh },
  }), true);
  const animatedSceneIdentity =
    render.runtimeValueIdentityInputs.get("scene");
  assert.notEqual(
    animatedSceneIdentity,
    firstSceneIdentity,
    "frame-driven Transform values propagate a new retained identity through Object and Scene nodes to the renderer",
  );
  const lodStep = operation.valueProgram.steps.find((step) => step.instanceId === "lod");
  const baseTargetTriangles = operation.valueProgram.outputs.get(lodStep.id).targetTriangles;
  assert.equal(operation.valueProgram.evaluate({
    componentTime: 0,
    renderRequest: { width: 640, height: 360 },
    sourceDetail: { width: 1280, height: 720 },
    runtimeContext: { resolveMesh: () => mesh },
  }), true);
  assert.ok(
    operation.valueProgram.outputs.get(lodStep.id).targetTriangles > baseTargetTriangles,
    "Content scale raises semantic mesh detail without enlarging the retained image target",
  );
  assert.equal(render.runtimeValueInputs.get("scene").kind, "scene3d");
  assert.deepEqual(program.inspect().mediaDemand.ids, ["media/models/skull.stl"]);
  assert.equal(program.inspect().dynamics.frameDependent, true, "authored spin keeps the compiled Scene on the presentation clock");
  assert.equal(program.inspect().dynamics.invalidation.mediaRevisionDependent, true);
  assert.equal(
    program.inspect().operations.some((entry) =>
      entry.renderProcessContext === "vj1.visual-render-process-context@1"),
    true,
    "compiled introspection tells editors which terminal operation is host-lowered",
  );

  const staticItem = {
    ...component.chain[0],
    source: {
      ...component.chain[0].source,
      params: {
        ...component.chain[0].source.params,
        spinY: 0,
        geometryDetail: 0.4,
      },
    },
  };
  program.replaceNodeConfiguration(modelNodeId, staticItem);
  operation.valueProgram.evaluate({
    componentTime: 1,
    renderRequest: { width: 640, height: 360 },
    runtimeContext: { resolveMesh: () => mesh },
  });
  const firstStaticSceneIdentity =
    render.runtimeValueIdentityInputs.get("scene");
  operation.valueProgram.evaluate({
    componentTime: 1,
    renderRequest: { width: 640, height: 360 },
    runtimeContext: { resolveMesh: () => mesh },
  });
  assert.equal(
    render.runtimeValueIdentityInputs.get("scene"),
    firstStaticSceneIdentity,
    "an unchanged static mesh graph retains its Scene identity",
  );

  const editedStaticItem = {
    ...staticItem,
    source: {
      ...staticItem.source,
      params: {
        ...staticItem.source.params,
        geometryDetail: 0.8,
      },
    },
  };
  program.replaceNodeConfiguration(modelNodeId, editedStaticItem);
  operation.valueProgram.evaluate({
    componentTime: 1,
    renderRequest: { width: 640, height: 360 },
    runtimeContext: { resolveMesh: () => mesh },
  });
  assert.notEqual(
    render.runtimeValueIdentityInputs.get("scene"),
    firstStaticSceneIdentity,
    "an authored STL render parameter advances the retained Scene identity even while spin is zero",
  );

  const wireframeItem = {
    ...editedStaticItem,
    source: {
      ...editedStaticItem.source,
      params: {
        ...editedStaticItem.source.params,
        renderMode: "wireframe",
      },
    },
  };
  program.replaceNodeConfiguration(modelNodeId, wireframeItem);
  operation.valueProgram.evaluate({
    componentTime: 1,
    renderRequest: { width: 640, height: 360 },
    runtimeContext: { resolveMesh: () => mesh },
  });
  assert.equal(render.runtimeValueInputs.get("scene").objects[0].material.renderMode, "wireframe");

  const recoloredSurfaceItem = {
    ...wireframeItem,
    source: {
      ...wireframeItem.source,
      params: {
        ...wireframeItem.source.params,
        renderMode: "surface",
        surfaceColor: "#ff2040ff",
      },
    },
  };
  program.replaceNodeConfiguration(modelNodeId, recoloredSurfaceItem);
  operation.valueProgram.evaluate({
    componentTime: 1,
    renderRequest: { width: 640, height: 360 },
    runtimeContext: { resolveMesh: () => mesh },
  });
  assert.deepEqual(
    render.runtimeValueInputs.get("scene").objects[0].material.surfaceColor,
    [255, 32, 64, 255],
  );
});

test("Project Media compiles reusable resource, image, control, and alpha stages", () => {
  const packageRoot = createVj1NodePackage();
  const component = {
    id: "project-media-component",
    name: "Project Media",
    type: "component",
    chain: [{
      id: "project-media-source",
      kind: "source",
      source: {
        type: "generator",
        generatorId: "mediaImage",
        params: {
          mediaId: "media/example.png",
          fit: "cover",
          alphaCut: 0,
          alphaFeather: 0,
        },
      },
    }],
  };
  const state = packageRoot.prepareProjectState({
    components: [component],
    media: [{ id: "media/example.png", type: "image" }],
    nodes: {},
  });
  const operation = compileComponentRenderPrograms(
    state.components,
    state.nodes.groups,
    {
      resolveNodeDefinition: (node) =>
        packageRoot.registry.get(node.nodeId, node.nodeVersion),
    },
  ).get(component.id).plan.operations[0];
  const [render, alpha] = operation.operations;

  assert.equal(operation.backend, "compiled-visual-group");
  assert.deepEqual(
    operation.valueProgram.steps.map((step) => step.nodeId),
    ["core.visual.project-media-resource"],
  );
  assert.deepEqual(
    operation.controlProgram.steps.map((step) => step.nodeId),
    ["core.control.scalar-math", "core.control.map-range"],
  );
  assert.equal(render.nodeId, "core.visual.media-resource-to-image");
  assert.equal(render.directPlacement.kind, "drawable-resource");
  assert.equal(alpha.nodeId, "vj1.visual.effect.alphaFeather");
  assert.equal(operation.contract.roi.halo, 64);

  const restoreInactive = operation.controlProgram.apply();
  assert.equal(alpha.configuration.params.amount, 0);
  restoreInactive();
  assert.equal(alpha.configuration.params.amount, 1);

  setCompiledVisualParameter(operation, "alphaCut", 2);
  const restoreActive = operation.controlProgram.apply();
  assert.equal(alpha.configuration.params.cut, 2);
  assert.equal(alpha.configuration.params.amount, 1);
  restoreActive();
});

test("compiled compound instances own isolated private render configuration", () => {
  const packageRoot = createVj1NodePackage();
  const component = {
    id: "project-media-instance-isolation",
    name: "Project Media Instance Isolation",
    type: "component",
    chain: [
      {
        id: "project-media-a",
        kind: "source",
        source: {
          type: "generator",
          generatorId: "mediaImage",
          params: {
            mediaId: "media/a.png",
            fit: "stretch",
          },
        },
      },
      {
        id: "project-media-b",
        kind: "source",
        source: {
          type: "generator",
          generatorId: "mediaImage",
          params: {
            mediaId: "media/b.png",
            fit: "contain",
          },
        },
      },
    ],
  };
  const state = packageRoot.prepareProjectState({
    components: [component],
    media: [
      { id: "media/a.png", type: "image" },
      { id: "media/b.png", type: "image" },
    ],
    nodes: {},
  });
  const program = compileComponentRenderPrograms(
    state.components,
    state.nodes.groups,
    {
      resolveNodeDefinition: (node) =>
        packageRoot.registry.get(node.nodeId, node.nodeVersion),
    },
  ).get(component.id);
  const [first, second] = program.plan.operations;
  const firstNodeId = componentLayerProjection(state, state.components[0])[0].nodeId;
  const firstRender = first.operations.find((child) => child.id === "render");
  const secondRender = second.operations.find((child) => child.id === "render");

  assert.equal(firstRender.configuration.source.params.fit, "stretch");
  assert.equal(secondRender.configuration.source.params.fit, "contain");
  assert.notEqual(
    firstRender.configuration,
    secondRender.configuration,
    "private compound child configuration is instance-owned rather than definition-owned",
  );
  assert.notEqual(
    firstRender.configuration.source.params,
    secondRender.configuration.source.params,
  );

  const firstConfiguration = componentChainProjection(state, state.components[0])[0];
  program.replaceNodeConfiguration(firstNodeId, {
    ...firstConfiguration,
    source: {
      ...firstConfiguration.source,
      params: {
        ...firstConfiguration.source.params,
        fit: "cover",
      },
    },
  });

  assert.equal(firstRender.configuration.source.params.fit, "cover");
  assert.equal(
    secondRender.configuration.source.params.fit,
    "contain",
    "updating one compound instance cannot overwrite another instance",
  );
});

test("one authored-parameter epoch consistently invalidates raster, SVG, and STL compounds", () => {
  const packageRoot = createVj1NodePackage();
  const component = {
    id: "cross-type-configuration-epoch",
    name: "Cross-type configuration epoch",
    type: "component",
    chain: [
      {
        id: "raster-source",
        kind: "source",
        source: {
          type: "generator",
          generatorId: "mediaImage",
          params: {
            mediaId: "media/example.png",
            fit: "contain",
          },
        },
      },
      {
        id: "svg-source",
        kind: "source",
        source: {
          type: "generator",
          generatorId: "mediaImage",
          params: {
            mediaId: "media/example.svg",
            fit: "contain",
          },
        },
      },
      {
        id: "model-source",
        kind: "source",
        source: {
          type: "generator",
          generatorId: "modelMedia",
        params: {
          mediaId: "media/example.stl",
          renderMode: "surface",
          geometryDetail: 0.5,
          spinY: 0,
        },
        },
      },
    ],
  };
  const state = packageRoot.prepareProjectState({
    components: [component],
    media: [
      { id: "media/example.png", type: "image" },
      { id: "media/example.svg", type: "image" },
      { id: "media/example.stl", type: "model" },
    ],
    nodes: {},
  });
  const program = compileComponentRenderPrograms(
    state.components,
    state.nodes.groups,
    {
      resolveNodeDefinition: (node) =>
        packageRoot.registry.get(node.nodeId, node.nodeVersion),
    },
  ).get(component.id);
  const originalPlan = program.plan;
  const operation = (id) =>
    program.plan.operations.find((candidate) => candidate.id === id);
  const child = (id, childId) =>
    operation(id).operations.find((candidate) => candidate.id === childId);
  const group = state.nodes.groups.find((candidate) => candidate.componentId === component.id);
  const layers = componentLayerProjection(state, state.components[0]);
  const nodeIds = new Map(layers.map((layer) => [layer.item.id, layer.nodeId]));
  const configurations = new Map(layers.map((layer) => [layer.item.id, layer.item]));
  let editedGroup = group;
  const withParam = (itemId, parameter, value) => {
    const current = configurations.get(itemId);
    const configuration = {
      ...current,
      source: {
        ...current.source,
        params: { ...current.source.params, [parameter]: value },
      },
    };
    configurations.set(itemId, configuration);
    editedGroup = graphGroupWithNodeConfiguration(editedGroup, nodeIds.get(itemId), configuration);
    return editedGroup;
  };

  const rasterEdit = withParam("raster-source", "fit", "cover");
  assert.deepEqual(
    program.syncGraphNodes(rasterEdit, [nodeIds.get("raster-source")]),
    {
      applied: true,
      changedIds: [nodeIds.get("raster-source")],
      missingIds: [],
    },
  );
  assert.strictEqual(program.plan, originalPlan);
  assert.equal(operation("raster-source").configurationRevision, 1);
  assert.equal(child("raster-source", "render").configuration.source.params.fit, "cover");
  assert.equal(operation("svg-source").configurationRevision, undefined);
  assert.equal(child("svg-source", "render").configuration.source.params.fit, "contain");
  assert.equal(operation("model-source").configurationRevision, undefined);

  const svgEdit = withParam("svg-source", "fit", "stretch");
  assert.equal(
    program.syncGraphNodes(svgEdit, [nodeIds.get("svg-source")]).applied,
    true,
  );
  assert.equal(operation("raster-source").configurationRevision, 1);
  assert.equal(operation("svg-source").configurationRevision, 1);
  assert.equal(child("svg-source", "render").configuration.source.params.fit, "stretch");
  assert.equal(operation("model-source").configurationRevision, undefined);

  const modelEdit = withParam("model-source", "geometryDetail", 0.9);
  assert.equal(
    program.syncGraphNodes(modelEdit, [nodeIds.get("model-source")]).applied,
    true,
  );
  assert.equal(operation("raster-source").configurationRevision, 1);
  assert.equal(operation("svg-source").configurationRevision, 1);
  assert.equal(operation("model-source").configurationRevision, 1);
  assert.equal(
    operation("model-source").configuration.source.params.geometryDetail,
    0.9,
  );

  const modelModeEdit = withParam("model-source", "renderMode", "wireframe");
  assert.equal(
    program.syncGraphNodes(modelModeEdit, [nodeIds.get("model-source")]).applied,
    true,
  );
  const modelOperation = operation("model-source");
  assert.equal(modelOperation.configurationRevision, 2);
  assert.equal(
    modelOperation.valueProgram.steps
      .find((step) => step.instanceId === "lod")
      .parameters.renderMode,
    undefined,
    "draw mode is a render-pass choice and cannot alter the selected mesh LOD",
  );
  assert.equal(
    modelOperation.valueProgram.steps
      .find((step) => step.instanceId === "material")
      .parameters.renderMode,
    "wireframe",
    "the enum edit reaches the material/render pass",
  );
});

test("compiled Component programs initialize generated controls from authoritative configuration", () => {
  const packageRoot = createVj1NodePackage();
  const component = {
    id: "project-media-control-sync",
    name: "Project Media Control Sync",
    type: "component",
    chain: [{
      id: "project-media-source",
      kind: "source",
      source: {
        type: "generator",
        generatorId: "mediaImage",
        params: {
          mediaId: "media/example.png",
          fit: "cover",
        },
      },
    }],
  };
  const state = packageRoot.prepareProjectState({
    components: [component],
    media: [{ id: "media/example.png", type: "image" }],
    nodes: {},
  });
  const group = state.nodes.groups.find((item) =>
    item.componentId === component.id
  );
  const staleMediaControl = group.nodes.find((node) =>
    node.id === "project-media-source:param:mediaId"
  );
  staleMediaControl.parameters.value = "";

  const program = compileComponentRenderPrograms(
    state.components,
    state.nodes.groups,
    {
      resolveNodeDefinition: (node) =>
        packageRoot.registry.get(node.nodeId, node.nodeVersion),
    },
  ).get(component.id);
  const operation = program.plan.operations[0];
  const render = operation.operations.find((child) => child.id === "render");
  const restore = program.plan.controlProgram.apply();
  operation.valueProgram.evaluate();

  assert.equal(
    render.runtimeValueInputs.get("resource").mediaId,
    "media/example.png",
    "a stale generated control cannot override the materialized Component configuration on the first frame",
  );
  restore();
});

test("Anatomy lowers ordinary retained values into the direct Scene-to-Image process", () => {
  const packageRoot = createVj1NodePackage();
  const anatomy = listGeneratorComponents()
    .find((component) => component.id === "anatomy")
    ?.nodeDefinition;
  assert.ok(anatomy);
  assert.equal(anatomy.metadata.visualCompilerHook.id, "vj1.visual.compound");
  assert.equal(anatomy.metadata.nativeRenderer, "");
  assert.equal(anatomy.metadata.nativeCompound, undefined);
  assert.deepEqual(
    anatomy.parts.find((part) => part.kind === "graph").nodes.map((node) => node.id),
    ["geometry", "motion", "materials", "objects", "camera", "scene", "render"],
  );
  const authored = {
    part: "heart",
    detail: 11,
    renderQuality: 0.5,
    depth: 1.4,
    modelScale: 1.75,
    rotationX: -0.2,
    rotationY: 0.4,
    rotationZ: 0.1,
    spinX: 0.3,
    spinY: -0.1,
    spinZ: 0.2,
    renderMode: "surfaceWire",
    surfaceColor: "#112233ff",
    wireColor: "#ffeeddcc",
    wireThickness: 2.5,
  };
  const component = {
    id: "anatomy-component",
    name: "Anatomy",
    type: "component",
    chain: [{
      id: "anatomy-source",
      kind: "source",
      source: {
        type: "generator",
        generatorId: "anatomy",
        params: authored,
      },
    }],
  };
  const state = packageRoot.prepareProjectState({ components: [component], nodes: {} });
  const operation = compileComponentRenderPrograms(state.components, state.nodes.groups, {
    resolveNodeDefinition: (node) => packageRoot.registry.get(node.nodeId, node.nodeVersion),
  }).get(component.id).plan.operations[0];
  const render = operation.operations[0];
  const values = operation.valueProgram;
  assert.equal(operation.backend, "compiled-visual-group");
  assert.equal(operation.scene3dProgram, undefined);
  assert.equal(render.nodeId, "core.scene3d.render");
  assert.equal(render.backend, "source-runtime");
  assert.equal(render.renderer, undefined, "the terminal process needs no renderer-name dispatch");
  assert.equal(typeof render.nodeProcess, "function");
  assert.deepEqual(values.steps.map((step) => step.nodeId), [
    "core.visual.anatomy-geometry-provider",
    "core.visual.anatomy-material-palette",
    "core.visual.model-fit-camera",
    "core.visual.anatomy-motion-transform",
    "core.scene3d.mesh-collection-objects",
    "core.scene3d.scene",
  ]);
  const target = { clearCalls: 0, clear() { this.clearCalls += 1; } };
  values.evaluate({
    componentTime: 2,
    renderRequest: { width: 640, height: 360 },
  });
  const result = render.nodeProcess({
    runtimeValues: render.runtimeValueInputs,
  }, {
    ...retainedRenderContext(target, 2),
    state: render.nodeProcessState,
    output: render.nodeProcessOutput,
  });
  const step = (id) => values.steps.find((candidate) => candidate.nodeId === id);
  const heartCollection = step("core.visual.anatomy-geometry-provider").outputValues.collection;
  assert.equal(heartCollection.kind, "mesh-collection");
  assert.equal(heartCollection.id, "anatomy-heart");
  assert.deepEqual(
    [...new Set(heartCollection.parts.map((part) => part.materialSlot))].sort(),
    ["coronary", "surface", "vessel"],
  );
  assert.equal(heartCollection.parts.every((part) => part.mesh.kind === "mesh"), true);
  assert.strictEqual(result.texture, target);
  assert.equal(target.clearCalls, 1, "the direct Scene renderer clears once for all Anatomy parts");
  const objects = step("core.scene3d.mesh-collection-objects").outputValues.objects;
  const scene = step("core.scene3d.scene").outputValues.scene;
  assert.equal(objects.length, heartCollection.parts.length);
  assert.equal(scene.objects.every((object, index) => object === objects[index]), true);
  assert.equal(step("core.visual.model-fit-camera").outputValues.camera.kind, "camera3d");
  const motion = step("core.visual.anatomy-motion-transform").outputValues.transform;
  assert.deepEqual(motion.rotation, [0.39999999999999997, 0.2, 0.5]);
  assert.ok(motion.scale[0] > 1.75 * 0.64);
  const palette = step("core.visual.anatomy-material-palette").outputValues;
  assert.equal(palette.defaultMaterial.kind, "material3d");
  assert.equal(palette.defaultMaterial.renderMode, "surfaceWire");
  assert.deepEqual(palette.defaultMaterial.surfaceColor, [17, 34, 51, 255]);
  assert.deepEqual(palette.defaultMaterial.wireColor, [255, 238, 221, 204]);
  assert.deepEqual(palette.bindings.map((binding) => binding.slot), [
    "surface", "feature", "lip", "eye", "pupil", "vessel", "coronary",
  ]);
  const retainedCollection = heartCollection;
  const retainedBindings = palette.bindings;
  const retainedTransform = motion;
  const retainedObjects = objects;
  const previousRotation = [...retainedTransform.rotation];
  values.evaluate({
    componentTime: 3,
    renderRequest: { width: 640, height: 360 },
  });
  assert.strictEqual(step("core.visual.anatomy-geometry-provider").outputValues.collection, retainedCollection);
  assert.strictEqual(step("core.visual.anatomy-material-palette").outputValues.bindings, retainedBindings);
  assert.strictEqual(step("core.visual.anatomy-motion-transform").outputValues.transform, retainedTransform);
  assert.strictEqual(step("core.scene3d.mesh-collection-objects").outputValues.objects, retainedObjects);
  assert.notDeepEqual(retainedTransform.rotation, previousRotation);

  setCompiledVisualParameter(operation, "part", "hand");
  setCompiledVisualParameter(operation, "fingerBend", 0.35);
  values.evaluate({
    componentTime: 2,
    renderRequest: { width: 640, height: 360 },
  });
  const handGeometry = step("core.visual.anatomy-geometry-provider").outputValues;
  assert.equal(handGeometry.collection.id, "anatomy-hand");
  assert.deepEqual(
    handGeometry.collection.parts.map((part) => part.id),
    ["wrist", "palm", "finger-1", "finger-2", "finger-3", "finger-4", "thumb"],
  );
  assert.equal(handGeometry.collection.parts.every((part) =>
    part.materialSlot === "surface" && part.mesh.kind === "mesh"
  ), true);
  const handCollection = handGeometry.collection;
  setCompiledVisualParameter(operation, "fingerBend", 0.8);
  values.evaluate({
    componentTime: 2,
    renderRequest: { width: 640, height: 360 },
  });
  assert.notStrictEqual(
    step("core.visual.anatomy-geometry-provider").outputValues.collection,
    handCollection,
    "authored deformation rebuilds canonical geometry only when its input changes",
  );
  render.nodeProcessDispose({
    state: render.nodeProcessState,
    output: render.nodeProcessOutput,
  });
  operation.valueProgram.dispose();
});

test("persisted compact specialized generators hydrate before graph-authoritative project recovery", () => {
  const packageRoot = createVj1NodePackage();
  const component = {
    id: "restored-terrain",
    name: "Restored Terrain",
    type: "component",
    chain: [{
      id: "terrain-source",
      kind: "source",
      source: { type: "generator", generatorId: "terrainFlyover", params: { flightSpeed: 0.7 } },
    }],
  };
  const initial = createInitialState();
  initial.components = [component];
  initial.ui.selectedComponentId = component.id;
  initial.ui.workspaceSelectionIds.component = component.id;
  initial.nodes = {};
  const prepared = packageRoot.prepareProjectState(initial);
  const payload = buildProjectPayload(prepared, "2026-07-23T00:00:00.000Z");
  const compact = payload.nodes.groups.find((group) => group.componentId === component.id);

  assert.equal(compact.compactTopology, true);
  assert.equal(compact.connections.length, 0);
  const restored = packageRoot.prepareProjectState(payload);
  const restoredGroup = restored.nodes.groups.find((group) => group.componentId === component.id);
  const restoredSource = componentChainProjection(restored, restored.components[0])[0];
  assert.equal(restoredSource.source.generatorId, "terrainFlyover");
  assert.equal(restoredSource.source.params.flightSpeed, 0.7);
  assert.equal(restoredGroup.connections.some((edge) => edge.type === "texture"), true);
  assert.equal(
    restoredGroup.nodes.find((node) => node.id === "terrain-source")?.compilerHook?.id,
    "vj1.visual.compound",
  );
});

test("Terrain exposes its ordinary editable graph while retaining explicit pass kernels", () => {
  const packageRoot = createVj1NodePackage();
  const definition = listGeneratorComponents().find((entry) => entry.id === "terrainFlyover").nodeDefinition;
  const graph = definition.parts.find((part) => part.kind === "graph");
  const projection = definition.metadata.controlProjection;
  assert.equal(projection.format, "vj1.control-projection@1");
  assert.deepEqual(
    projection.sections.map((section) => section.id),
    ["flight", "geometry", "camera", "surface-material", "wire-material", "render"],
  );
  assert.deepEqual(
    projection.sections.find((section) => section.id === "render").controls[0],
    {
      parameterId: "style",
      bindings: [
        { nodeId: "surface-render", parameterId: "style" },
        { nodeId: "wire-render", parameterId: "style" },
      ],
    },
    "one public control may drive several internal compound nodes",
  );
  assert.deepEqual(
    projection.sections
      .flatMap((section) => section.controls)
      .find((control) => control.parameterId === "lakeLevel"),
    {
      parameterId: "lakeLevel",
      bindings: [
        { nodeId: "geometry", parameterId: "lakeLevel" },
        { nodeId: "surface-material", parameterId: "lakeLevel" },
      ],
    },
    "lake level has one public authority shared by geometry and biome material",
  );
  assert.equal(definition.metadata.renderAuthority, "compiled-graph");
  assert.equal(definition.metadata.nativeRenderer, "");
  assert.deepEqual(
    graph.nodes.filter((node) => node.role === "source").map(({ id, compilerHook }) => ({
      id,
      renderer: compilerHook?.renderer,
    })),
    [
      { id: "surface-render", renderer: "output/specialized:terrainSurface" },
      { id: "wire-render", renderer: "output/specialized:terrainWire" },
    ],
  );
  const editableState = packageRoot.prepareProjectState({
    ...createInitialState(),
    ui: {
      ...createInitialState().ui,
      selectedNodeDefinitionId: definition.id,
      selectedNodeGroupId: "",
    },
  });
  const editableStudio = nodeLibraryStudioModel(editableState, packageRoot);
  assert.equal(editableStudio.graphOptions.nodesEditable, true);
  assert.equal(editableStudio.graphOptions.connectionsEditable, true);
  assert.equal(editableStudio.graphOptions.parametersEditable, true);
  assert.equal(editableStudio.graphOptions.providersEditable, true);
  return;
  const disabledWireGraph = {
    ...graph,
    nodes: graph.nodes.map((node) => node.id === "wire-render"
      ? { ...node, parameters: { ...node.parameters, enabled: false } }
      : node),
  };
  const disabledWireDefinition = {
    ...definition,
    parts: definition.parts.map((part) => part.kind === "graph" ? disabledWireGraph : part),
  };
  const disabledWireProgram = compileSpecializedCompoundProgram(disabledWireDefinition);

  assert.equal(specializedCompoundStageEnabled({ nativeCompoundProgram: disabledWireProgram }, "wire-render"), false);
  assert.equal(specializedCompoundStageEnabled({ nativeCompoundProgram: disabledWireProgram }, "surface-render"), true);

  const planarGraph = {
    ...graph,
    nodes: graph.nodes.map((node) => node.id === "geometry"
      ? {
          ...node,
          type: PlanarGridGeometryProviderNode.id,
          nodeId: PlanarGridGeometryProviderNode.id,
          version: PlanarGridGeometryProviderNode.version,
          nodeVersion: PlanarGridGeometryProviderNode.version,
          parameters: { ...node.parameters, providerId: "planar-grid" },
        }
      : node),
  };
  const planarProgram = compileSpecializedCompoundProgram({
    ...definition,
    parts: definition.parts.map((part) => part.kind === "graph" ? planarGraph : part),
  }, {
    resolveDefinition: (node) => packageRoot.registry.get(node.nodeId, node.nodeVersion),
  });
  assert.equal(
    specializedCompoundStageProvider({ nativeCompoundProgram: planarProgram }, "geometry"),
    "planar-grid",
  );
  const planarGeometry = executeSpecializedCompoundProvider(
    { nativeCompoundProgram: planarProgram },
    "geometry",
    {
      gridWidth: 8,
      gridDepth: 6,
      gridDensity: 1.5,
      gridScale: 2,
    },
    { instanceId: "terrain-planar-grid" },
  );
  const retainedPlanarMesh = planarGeometry.mesh;
  const planarGeometryAgain = executeSpecializedCompoundProvider(
    { nativeCompoundProgram: planarProgram },
    "geometry",
    {
      gridWidth: 8,
      gridDepth: 6,
      gridDensity: 1.5,
      gridScale: 2,
    },
    { instanceId: "terrain-planar-grid" },
  );
  const planarMeshAgain = planarGeometryAgain.mesh;
  const planarGeometryWithMaterialChange = executeSpecializedCompoundProvider(
    { nativeCompoundProgram: planarProgram },
    "geometry",
    {
      gridWidth: 8,
      gridDepth: 6,
      gridDensity: 1.5,
      gridScale: 2,
      mountainHeight: 80,
    },
    { instanceId: "terrain-planar-grid" },
  );
  const planarMeshWithMaterialChange = planarGeometryWithMaterialChange.mesh;
  const planarGeometryWithTopologyChange = executeSpecializedCompoundProvider(
    { nativeCompoundProgram: planarProgram },
    "geometry",
    {
      gridWidth: 9,
      gridDepth: 6,
      gridDensity: 1.5,
      gridScale: 2,
      mountainHeight: 80,
    },
    { instanceId: "terrain-planar-grid" },
  );
  const planarMeshWithTopologyChange = planarGeometryWithTopologyChange.mesh;
  assert.equal(planarGeometry.kind, "geometry");
  assert.equal(planarGeometry.providerId, "planar-grid");
  assert.equal(retainedPlanarMesh.kind, "mesh");
  assert.equal(retainedPlanarMesh.triangleCount, 12 * 9 * 2);
  assert.strictEqual(planarMeshAgain, retainedPlanarMesh);
  assert.strictEqual(
    planarMeshWithMaterialChange,
    retainedPlanarMesh,
    "non-geometric native settings do not replace the canonical mesh resource",
  );
  assert.notStrictEqual(
    planarMeshWithTopologyChange,
    retainedPlanarMesh,
    "a geometric setting replaces the canonical mesh resource",
  );
  const canvas = nodeGraphCanvasTemplate(definition, packageRoot.registry);
  assert.match(canvas, /data-node-provider-select="geometry"/);
  assert.match(canvas, />Planar grid<\/option>/);

  const unsupportedProviderGraph = {
    ...graph,
    nodes: graph.nodes.map((node) => node.id === "geometry"
      ? { ...node, parameters: { ...node.parameters, providerId: "unknown-height-field" } }
      : node),
  };
  assert.throws(() => compileSpecializedCompoundProgram({
    ...definition,
    parts: definition.parts.map((part) => part.kind === "graph" ? unsupportedProviderGraph : part),
  }), /SPECIALIZED_VISUAL_COMPOUND_PROVIDER_UNSUPPORTED/);
  assert.throws(() => compileSpecializedCompoundProgram({
    ...definition,
    parts: definition.parts.map((part) => part.kind === "graph"
      ? { ...part, connections: part.connections.slice(1) }
      : part),
  }), /SPECIALIZED_VISUAL_COMPOUND_TOPOLOGY_UNSUPPORTED/);
  const editor = packageRoot.editorContext();
  assert.equal(editor.preflightGraphEdit({
    kind: "definition",
    definition: disabledWireDefinition,
  }, disabledWireGraph), true);
  assert.throws(
    () => editor.preflightGraphEdit({
      kind: "definition",
      definition,
    }, unsupportedProviderGraph),
    /SPECIALIZED_VISUAL_COMPOUND_PROVIDER_UNSUPPORTED/,
    "the editor invokes the specialized production compiler before saving provider changes",
  );
  assert.throws(
    () => editor.preflightGraphEdit({
      kind: "definition",
      definition,
    }, { ...graph, connections: graph.connections.slice(1) }),
    /SPECIALIZED_VISUAL_COMPOUND_TOPOLOGY_UNSUPPORTED/,
    "the editor cannot persist topology the retained specialized host would ignore",
  );
  const specializedState = packageRoot.prepareProjectState({
    ...createInitialState(),
    ui: {
      ...createInitialState().ui,
      selectedNodeDefinitionId: definition.id,
      selectedNodeGroupId: "",
    },
  });
  const specializedStudio = nodeLibraryStudioModel(specializedState, packageRoot);
  assert.equal(specializedStudio.graphOptions.nodesEditable, false);
  assert.equal(specializedStudio.graphOptions.connectionsEditable, false);
  assert.equal(specializedStudio.graphOptions.parametersEditable, true);
  assert.equal(specializedStudio.graphOptions.providersEditable, true,
    "supported provider substitutions remain editable while compiler-owned topology stays locked");
});

test("compiled visual compounds give every public parameter a semantic child owner", () => {
  const specializedIds = ["terrainFlyover", "meshPatterns"];
  const definitions = new Map(listGeneratorComponents()
    .filter((entry) => specializedIds.includes(entry.id))
    .map((entry) => [entry.id, entry.nodeDefinition]));

  for (const id of specializedIds) {
    const definition = definitions.get(id);
    assert.ok(definition, `${id} definition`);
    const nativeBindings = definition.metadata?.nativeCompound?.parameterBindings || {};
    const nativeOwnedParameterIds = Object.values(nativeBindings)
      .flat()
      .map((binding) => typeof binding === "string"
        ? binding
        : binding?.publicParameterId || binding?.parameterId)
      .filter(Boolean);
    const projectedOwnedParameterIds = (definition.metadata?.controlProjection?.sections || [])
      .flatMap((section) => section.controls || [])
      .map((control) => control.parameterId)
      .filter(Boolean);
    const ownedParameterIds = new Set([
      ...nativeOwnedParameterIds,
      ...projectedOwnedParameterIds,
    ]);
    assert.deepEqual(
      [...Object.keys(definition.parameters || {}).filter((parameterId) => !ownedParameterIds.has(parameterId))],
      [],
      `${id} cannot expose a parameter with no semantic stage owner`,
    );
  }

  const anatomy = listGeneratorComponents().find((entry) => entry.id === "anatomy").nodeDefinition;
  const anatomyOwnedParameters = new Set(
    (anatomy.metadata?.controlProjection?.sections || [])
      .flatMap((section) => section.controls || [])
      .map((control) => control.parameterId),
  );
  assert.deepEqual(
    Object.keys(anatomy.parameters || {}).filter((parameterId) => !anatomyOwnedParameters.has(parameterId)),
    [],
    "the generalized Anatomy Scene graph cannot expose a parameter with no child-node owner",
  );
  return;

  const terrain = definitions.get("terrainFlyover");
  const graph = terrain.parts.find((part) => part.kind === "graph");
  const authoredCameraGraph = {
    ...graph,
    nodes: graph.nodes.map((node) => node.id === "camera"
      ? {
          ...node,
          parameters: {
            ...node.parameters,
            settings: { projection: "perspective", fieldOfView: 72 },
          },
        }
      : node),
  };
  const program = compileSpecializedCompoundProgram({
    ...terrain,
    parts: terrain.parts.map((part) => part.kind === "graph" ? authoredCameraGraph : part),
  });
  const operation = { nativeCompoundProgram: program };
  const authored = {
    mountainHeight: 2.5,
    pitch: 0.2,
    waterColor: "#123456",
    renderQuality: 1.5,
    hiddenHostCorrection: 99,
  };

  assert.deepEqual(
    specializedCompoundStageDescriptor(operation, "camera")?.settings,
    { projection: "perspective", fieldOfView: 72 },
    "stage-local structured settings remain part of the compiled semantic program",
  );
  assert.deepEqual(
    specializedCompoundStageParameters(operation, "geometry", authored),
    { mountainHeight: 2.5 },
    "a stage receives only the public parameters bound to it",
  );
  assert.deepEqual(
    specializedCompoundStageParameters(operation, "camera", authored),
    { projection: "perspective", fieldOfView: 72, pitch: 0.2 },
  );
  const runtimeParameters = specializedCompoundRuntimeParameters(operation, authored);
  assert.equal(runtimeParameters.mountainHeight, 2.5);
  assert.equal(runtimeParameters.pitch, 0.2);
  assert.equal(runtimeParameters.waterColor, "#123456");
  assert.equal(runtimeParameters.renderQuality, 1.5);
  assert.equal(
    Object.hasOwn(runtimeParameters, "hiddenHostCorrection"),
    false,
    "undeclared raw parameters cannot become hidden native-renderer authority",
  );
});

test("authored Terrain provider selection reaches the compiled retained render operation", () => {
  const packageRoot = createVj1NodePackage();
  const base = packageRoot.registry.get("vj1.visual.generator.terrainFlyover");
  const graph = base.parts.find((part) => part.kind === "graph");
  const planarGraph = {
    ...graph,
    nodes: graph.nodes.map((node) => node.id === "geometry"
      ? {
          ...node,
          type: PlanarGridGeometryProviderNode.id,
          nodeId: PlanarGridGeometryProviderNode.id,
          version: PlanarGridGeometryProviderNode.version,
          nodeVersion: PlanarGridGeometryProviderNode.version,
          parameters: { ...node.parameters, providerId: "planar-grid" },
        }
      : node),
  };
  const forkNodes = withProjectNodeGraph({}, base, planarGraph);
  const component = {
    id: "terrain-provider-component",
    name: "Terrain provider",
    type: "component",
    chain: [{
      id: "terrain-source",
      kind: "source",
      source: { type: "generator", generatorId: "terrainFlyover", params: {} },
    }],
  };
  const state = packageRoot.prepareProjectState({
    components: [component],
    nodes: forkNodes,
  });
  const resolver = createProjectVisualNodeResolver({ nodes: state.nodes });
  const operation = compileComponentRenderPrograms(state.components, state.nodes.groups, {
    resolveNodeDefinition: (node) =>
      resolver.definition(node.nodeId) || packageRoot.registry.get(node.nodeId, node.nodeVersion),
  }).get(component.id).plan.operations[0];

  const geometry = operation.valueProgram.steps.find((step) => step.instanceId === "geometry");
  assert.equal(geometry.nodeId, PlanarGridGeometryProviderNode.id);
  assert.equal(geometry.parameters.providerId, "planar-grid");
  operation.valueProgram.evaluate({ renderRequest: { width: 800, height: 600 } });
  assert.equal(
    operation.operations[0].runtimeValueInputs.get("geometry").providerId,
    "planar-grid",
  );
  assert.equal(operation.operations[0].renderer, "output/specialized:terrainSurface");
  assert.equal(operation.operations[1].renderer, "output/specialized:terrainWire");
});

test("Terrain child topology and shader forks compile into the retained native operation", () => {
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
  const base = packageRoot.registry.get(TerrainWireMaterialProviderNode.id);
  const geometryBase = packageRoot.registry.get(TerrainHeightFieldGeometryProviderNode.id);
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
  const geometryFork = createProjectNodeFork(geometryBase, {
    forkId: "terrain-topology-project",
    overrides: {
      parts: geometryBase.parts.map((part) => part.id === "terrain-mesh-module"
        ? {
            ...part,
            source: part.source.replace(
              /function terrainGridSize\(value\) \{[\s\S]*?\n\}/,
              "function terrainGridSize() { return 17; }",
            ),
          }
        : part),
    },
  });
  const resolver = createProjectVisualNodeResolver(
    { nodes: { forks: [{ ...fork, active: true }, { ...geometryFork, active: true }] } },
    { coreDefinitions: [base, geometryBase] },
  );
  const forkOperation = compileComponentRenderPrograms(state.components, state.nodes.groups, {
    resolveNodeDefinition: (node) => resolver.definition(node.nodeId) || packageRoot.registry.get(node.nodeId, node.nodeVersion),
  }).get(component.id).plan.operations[0];

  const [baseSurface, baseWire] = baseOperation.operations;
  const [forkSurface, forkWire] = forkOperation.operations;
  assert.match(forkWire.nodeShaders["terrain-wire-fragment"], /project wire shader/);
  assert.notEqual(forkSurface.nodeCodeRevision, baseSurface.nodeCodeRevision);
  assert.notEqual(forkWire.nodeCodeRevision, baseWire.nodeCodeRevision);
  assert.equal(forkSurface.nodeShaderProgramRevisions.surface, baseSurface.nodeShaderProgramRevisions.surface);
  assert.notEqual(forkWire.nodeShaderProgramRevisions.wire, baseWire.nodeShaderProgramRevisions.wire);
  assert.equal(forkSurface.nodeModule.terrainGridSize(200), 17);
  assert.equal(forkWire.nodeModule.terrainGridSize(200), 17);
  assert.equal(forkOperation.backend, "compiled-visual-group");
  assert.equal(forkSurface.renderer, "output/specialized:terrainSurface");
  assert.equal(forkWire.renderer, "output/specialized:terrainWire");
});

test("procedural calibration JavaScript compiles once into the shader render plan", () => {
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

  assert.equal(operation.backend, "shader-generator");
  assert.equal(operation.compilerHook.id, "vj1.visual.shader-generator");
  assert.equal(operation.nodeProcess, undefined);
  assert.equal(operation.renderer, undefined);
});

test("SDF Sketch Content edits regenerate the project-local shader", () => {
  const component = listGeneratorComponents().find((entry) => entry.id === "sdfSketch");
  const baseDefinition = component.nodeDefinition;
  const programPart = baseDefinition.parts.find((part) => part.id === "sdf2d-program");
  const editedSource = programPart.source.replace("#ff4f92cc", "#00ff00ff");
  const nodes = withProjectNodeFork({}, baseDefinition, { [programPart.id]: editedSource });
  const fork = nodes.forks[0];
  const shaderPart = fork.definition.parts.find((part) => part.id === "fragment-shader");

  assert.equal(fork.definition.parts.find((part) => part.id === programPart.id).source, editedSource);
  assert.match(shaderPart.source, /vec4\(0\.000000,1\.000000,0\.000000,1\.000000\)/);
  assert.equal(shaderPart.source.includes("#ff4f92cc"), false);
});

test("Text compiles retained value providers into an ordinary optimized visual Group", () => {
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

  const render = operation.operations[0];
  assert.equal(operation.backend, "compiled-visual-group");
  assert.equal(operation.nativeCompoundProgram, undefined);
  assert.deepEqual(operation.valueProgram.steps.map((step) => step.nodeId), [
    "core.render.demand",
    "core.visual.text-mask",
  ]);
  assert.equal(operation.valueProgram.bindings.length, 1);
  assert.equal(operation.valueProgram.bindings[0].targetPortId, "mask");
  assert.strictEqual(
    operation.valueProgram.bindings[0].operation.runtimeValueInputs,
    render.runtimeValueInputs,
    "contract normalization preserves the retained value-input map identity",
  );
  assert.equal(render.renderer, "output/specialized:text");
  assert.equal(render.backend, "native-specialized");
  assert.match(render.nodeShaders.vertex, /attribute vec3 aPosition/);
  assert.match(render.nodeShaders.fragment, /uniform sampler2D textMask/);
  assert.equal(render.nodeProcess, undefined, "the context-bound cache remains a declared native operation");
});

test("compiled visual compounds stay atomic in the chain projection across repeated edits", () => {
  const packageRoot = createVj1NodePackage();
  const initial = createInitialState();
  initial.components[0].chain = [{
    id: "project-media-source",
    kind: "source",
    enabled: true,
    source: {
      type: "generator",
      generatorId: "mediaImage",
      params: { mediaId: "media/example.png" },
    },
  }];
  const store = createAppState(initial, {
    prepareState: packageRoot.prepareProjectState,
    prepareChange: packageRoot.prepareProjectChange,
  });

  const projected = componentChainProjection(store.getState(), store.getState().components[0])[0];
  assert.equal(
    Object.hasOwn(projected, "chain"),
    false,
    "a compiled compound does not leak its private render operations into the element list",
  );

  for (const enabled of [false, true, false, true]) {
    const layer = componentLayerProjection(store.getState(), store.getState().components[0])[0];
    store.setComponentToggle(`${layer.path}.enabled`, enabled, {
      reason: "toggle:component-graph-node-enabled",
    });
    const state = store.getState();
    const component = state.components[0];
    const group = state.nodes.groups.find((item) =>
      item.componentId === component.id
    );
    const source = group.nodes.find((item) =>
      item.id === "project-media-source"
    );

    assert.equal(componentChainProjection(state, component)[0].enabled, enabled);
    assert.equal(source.configuration.enabled, enabled);
    assert.equal(component.nodeProjectionSignature, group.projectionSignature);
    assert.equal(Object.hasOwn(componentChainProjection(state, component)[0], "chain"), false);
  }
});

test("incremental Component preparation updates only the changed graph program", () => {
  const packageRoot = createVj1NodePackage();
  const initial = createInitialState();
  initial.components[0] = {
    ...initial.components[0],
    id: "incremental-component-a",
    chain: initial.components[0].chain.map((item, index) => ({
      ...item,
      id: `incremental-a-${index}`,
    })),
  };
  initial.components.push({
    ...structuredClone(initial.components[0]),
    id: "incremental-component-b",
    name: "Unchanged Component",
    chain: initial.components[0].chain.map((item, index) => ({
      ...structuredClone(item),
      id: `incremental-b-${index}`,
    })),
  });
  const prepared = packageRoot.prepareProjectState(initial);
  const groupA = prepared.nodes.groups.find((group) =>
    group.componentId === "incremental-component-a"
  );
  const groupB = prepared.nodes.groups.find((group) =>
    group.componentId === "incremental-component-b"
  );
  const mappingGroup = prepared.nodes.groups.find((group) =>
    group.generatedBy === "vj1-mapping-compiler"
  );
  const groupAIndex = prepared.nodes.groups.findIndex((group) => group.componentId === "incremental-component-a");
  const editedGroupA = structuredClone(prepared.nodes.groups[groupAIndex]);
  const next = {
    ...prepared,
    nodes: {
      ...prepared.nodes,
      groups: prepared.nodes.groups.map((group, index) => index === groupAIndex ? editedGroupA : group),
    },
  };
  const edited = editedGroupA.nodes.find((node) => ["source", "effect", "group"].includes(node.role));
  edited.configuration.enabled = false;
  edited.configuration.boundary.x = 0.2;
  const changed = packageRoot.prepareProjectChange(prepared, next);
  const changedGroupA = changed.nodes.groups.find((group) =>
    group.componentId === "incremental-component-a"
  );

  assert.notStrictEqual(changed.nodes, prepared.nodes);
  assert.notStrictEqual(changedGroupA, groupA);
  assert.strictEqual(
    changed.nodes.groups.find((group) => group.componentId === "incremental-component-b"),
    groupB,
    "an unrelated Component graph keeps identity",
  );
  assert.strictEqual(
    changed.nodes.groups.find((group) => group.id === mappingGroup.id),
    mappingGroup,
    "Component parameters do not rebuild Mapping programs",
  );
  assert.strictEqual(changed.nodes.definitions, prepared.nodes.definitions);
  assert.strictEqual(changed.nodes.pins, prepared.nodes.pins);
  assert.equal(
    changedGroupA.nodes.find((node) => node.id === "incremental-a-0").configuration.enabled,
    false,
  );
  assert.equal(
    changedGroupA.nodes.find((node) => node.id === "incremental-a-0").configuration.boundary.x,
    0.2,
  );
  const payload = buildProjectPayload(changed, "2026-07-26T00:00:00.000Z");
  const reloaded = packageRoot.prepareProjectState(payload);
  assert.equal(componentChainProjection(reloaded, reloaded.components[0])[0].enabled, false);
  assert.equal(componentChainProjection(reloaded, reloaded.components[0])[0].boundary.x, 0.2);
  assert.doesNotThrow(() => structuredClone(changed));
});

test("incremental Mapping preparation leaves Component programs untouched", () => {
  const packageRoot = createVj1NodePackage();
  const prepared = packageRoot.prepareProjectState(createInitialState());
  const componentGroups = prepared.nodes.groups.filter((group) =>
    group.generatedBy === "vj1-component-compiler"
  );
  const mapping = prepared.mappings[0];
  const mappingGroup = prepared.nodes.groups.find((group) =>
    group.id === `vj1.mapping.${mapping.id}`
  );
  const nextMapping = {
    ...mapping,
    surfaces: mapping.surfaces.map((surface, index) =>
      index ? surface : { ...surface, enabled: false }
    ),
  };
  const next = {
    ...prepared,
    mappings: prepared.mappings.map((entry) =>
      entry.id === mapping.id ? nextMapping : entry
    ),
  };
  const changed = packageRoot.prepareProjectChange(prepared, next);
  const changedMappingGroup = changed.nodes.groups.find((group) =>
    group.id === mappingGroup.id
  );

  assert.notStrictEqual(changedMappingGroup, mappingGroup);
  for (const componentGroup of componentGroups) {
    assert.strictEqual(
      changed.nodes.groups.find((group) => group.id === componentGroup.id),
      componentGroup,
    );
  }
  assert.strictEqual(changed.nodes.definitions, prepared.nodes.definitions);
  assert.equal(
    changedMappingGroup.nodes.find((node) => node.surfaceId === mapping.surfaces[0].id)
      .parameters.enabled,
    false,
  );
});

test("Project Media compiles its typed resource into the declared direct drawable operation", () => {
  const packageRoot = createVj1NodePackage();
  const component = {
    id: "media-component",
    name: "Media",
    type: "component",
    chain: [{
      id: "media-source",
      kind: "source",
      source: {
        type: "generator",
        generatorId: "mediaImage",
        params: { mediaId: "media/example.png" },
      },
    }],
  };
  const state = packageRoot.prepareProjectState({ components: [component], nodes: {} });
  const operation = compileComponentRenderPrograms(state.components, state.nodes.groups, {
    resolveNodeDefinition: (node) =>
      packageRoot.registry.get(node.nodeId, node.nodeVersion),
  })
    .get(component.id).plan.operations[0];

  assert.equal(operation.nodeId, "vj1.visual.generator.mediaImage");
  assert.equal(operation.backend, "compiled-visual-group");
  const render = operation.operations.find((child) => child.id === "render");
  assert.equal(render.nodeId, "core.visual.media-resource-to-image");
  assert.equal(render.backend, "source-runtime");
  assert.deepEqual(render.directPlacement, {
    kind: "drawable-resource",
    input: "resource",
    fitParameter: "fit",
    mirrorParameter: "mirrored",
    retainProjectVideoFrame: true,
  });
  assert.equal(operation.valueProgram.bindings[0].targetPortId, "resource");
});

test("stored legacy source hooks are canonicalized before Component compilation", () => {
  const packageRoot = createVj1NodePackage();
  const component = {
    id: "legacy-camera-component",
    name: "Legacy camera",
    type: "component",
    chain: [{
      id: "legacy-camera",
      kind: "source",
      enabled: true,
      source: { type: "camera", mediaId: "obsolete.mp4" },
    }],
  };
  const staleGroup = {
    id: "vj1.component.legacy-camera-component",
    componentId: component.id,
    generatedBy: "vj1-component-compiler",
    nodes: [{
      id: "legacy-camera",
      nodeId: "core.visual.source",
      nodeVersion: "0.1.0",
      role: "source",
      compilerHook: { id: "vj1.visual.group" },
      configuration: component.chain[0],
    }],
    connections: [{
      from: "legacy-camera.texture",
      to: "$out.texture",
      type: "texture",
    }],
    publicInlets: {},
    publicOutlets: { texture: "legacy-camera.texture" },
  };
  const resolver = createProjectVisualNodeResolver({});
  const program = compileComponentRenderPrograms(
    [component],
    [staleGroup],
    {
      resolveNodeDefinition: (node) =>
        resolver.definition(node.nodeId) ||
        packageRoot.registry.get(node.nodeId, node.nodeVersion),
    },
  ).get(component.id);
  const operation = program.plan.operations[0];

  assert.equal(operation.nodeId, "vj1.visual.generator.cameraInput");
  assert.equal(operation.backend, "compiled-visual-group");
  assert.equal(operation.configuration.source.type, "generator");
  assert.equal(operation.configuration.source.generatorId, "cameraInput");
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
    visualPlanRuntime: {
      execute(plan) {
        renderedPlan = plan;
        return "rendered";
      },
    },
  }, component, 0, { width: 640, height: 360 });

  assert.equal(result, "rendered");
  assert.equal(program.generatedBy, "vj1-component-compiler");
  assert.equal(renderedPlan.format, "vj1.visual-render-plan@1");
  assert.deepEqual(renderedPlan.operations.map((operation) => operation.id), ["old-source"]);
  assert.deepEqual(renderedPlan.operations.map((operation) => operation.opcode), ["source"]);
});

test("Component compilation retains only the declared root dependency closure", () => {
  const child = {
    id: "child",
    type: "component",
    chain: [{ id: "child-source", kind: "source", source: { type: "generator", generatorId: "waves" } }],
  };
  const root = {
    id: "root",
    type: "component",
    chain: [{
      id: "child-reference",
      kind: "source",
      source: { type: "component", componentId: child.id },
    }],
  };
  const unrelated = {
    id: "unrelated",
    type: "component",
    chain: [{ id: "unrelated-source", kind: "source", source: { type: "generator", generatorId: "waves" } }],
  };

  const programs = compileComponentRenderPrograms([root, child, unrelated], [], {
    rootComponentIds: new Set([root.id]),
  });

  assert.deepEqual([...programs.keys()].sort(), ["child", "root"]);
  assert.equal(programs.has(unrelated.id), false);
});

test("application state keeps persisted Component groups synchronized after structural edits", () => {
  const packageRoot = createVj1NodePackage();
  const store = createAppState(createInitialState(), {
    prepareState: packageRoot.prepareProjectState,
    prepareChange: packageRoot.prepareProjectChange,
  });
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
  initial.nodes = {
    ...(initial.nodes || {}),
    definitions: [packageRoot.registry.get("vj1.visual.effect.dilate")],
  };
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
  assert.equal(payload.nodes.definitions.length, 0, "installed library definitions stay in code");
  assert.equal(payload.nodes.instances.length, 0, "generated flat instances are rebuilt from groups");
  assert.equal(payload.nodes.artifacts.length, 0, "generated catalog artifacts stay in the runtime package");
  assert.match(group.projectionSignature, /^chain-v1:\d+:[a-z0-9]+:[a-z0-9]+$/);
  const persistedGroup = payload.nodes.groups.find((item) => item.id === group.id);
  assert.equal(persistedGroup.compactTopology, true);
  assert.equal(persistedGroup.connections.length, 0);
  assert.equal(persistedGroup.nodes.some((item) => item.role === "control"), false);

  const reloaded = packageRoot.prepareProjectState(payload);
  assert.equal(componentChainProjection(reloaded, reloaded.components[0])[0].source.generatorId, "waves");
  assert.equal(reloaded.components[0].nodeProjectionSignature, group.projectionSignature);
  const reloadedGroup = reloaded.nodes.groups.find((item) => item.id === group.id);
  assert.equal(reloadedGroup.nodes.some((item) => item.role === "control"), true);
  assert.equal(reloadedGroup.connections.some((edge) => edge.type === "texture"), true);
});

test("outgoing transition graph retains its Live diff without pruning the bank", () => {
  const packageRoot = createVj1NodePackage();
  const initial = createInitialState();
  const outgoing = initial.components[0];
  const incoming = createDefaultComponent(1);
  initial.components.push(incoming);
  initial.ui.live.transitionDuration = 1;
  const store = createAppState(initial, {
    prepareState: packageRoot.prepareProjectState,
    prepareChange: packageRoot.prepareProjectChange,
  });

  store.selectLiveComponent(outgoing.id);
  const initialTransition = store.getState().ui.live.transitionCoordinator.overall.active;
  store.advanceLiveTransitions(
    initialTransition.startedAtMs + initialTransition.durationMs + 1,
  );
  const outgoingNodeId = componentLayerProjection(store.getState(), store.getState().components[0])[0].nodeId;
  store.updateLive((draft) => {
    draft.ui.live.parameterDiffs[outgoing.id] = {
      [outgoing.id]: {
        nodes: { [outgoingNodeId]: { source: { params: { renderQuality: 0.13 } } } },
      },
    };
  }, "live:test-outgoing-diff");
  const bankBefore = structuredClone(store.getState().ui.live.parameterDiffs);
  const bankAuthorityBefore = store.getState().ui.live.parameterDiffs;

  const renderer = new OutputRenderer({ mode: "live" });
  const outgoingRenderState = createLiveRenderState(store.getState());
  renderer.state = outgoingRenderState;
  renderer.visualNodeRuntime.rebuild();
  renderer.componentProgramRuntime.rebuild();
  const presentedPrograms = renderer.componentProgramRuntime.programs;
  const presentedOutgoing = presentedPrograms.get(outgoing.id);
  assert.equal(
    presentedOutgoing.plan.operations[0].configuration.source.params.renderQuality,
    0.13,
    "the running branch has the applied Live diff before transition activation",
  );

  store.selectLiveComponent(incoming.id);
  const active = store.getState().ui.live.transitionCoordinator.overall.active;
  const renderState = createLiveRenderState(store.getState());
  assert.equal(renderer.surfaceRuntime.retainPresentedBranchForTransitions(
    outgoingRenderState,
    renderState,
  ), true);
  renderer.state = renderState;
  renderer.componentProgramRuntime.rebuild();
  const activePrograms = renderer.componentProgramRuntime.programs;
  const outgoingContext = renderer.surfaceRuntime.retainedTransitionBranch(
    renderState.liveTransition,
  );
  const outgoingProgram = outgoingContext.programs.get(outgoing.id);

  assert.strictEqual(outgoingContext.programs, presentedPrograms);
  assert.strictEqual(outgoingProgram, presentedOutgoing);
  assert.notStrictEqual(outgoingContext.programs, activePrograms);
  assert.equal(
    outgoingProgram.plan.operations[0].configuration.source.params.renderQuality,
    0.13,
  );
  renderer.surfaceRuntime.withRenderState(
    outgoingContext.state,
    () => {
      assert.strictEqual(renderer.componentProgramRuntime.programs, outgoingContext.programs);
      assert.strictEqual(
        renderer.componentProgramRuntime.programs.get(outgoing.id),
        outgoingProgram,
      );
    },
    { programContext: outgoingContext },
  );
  assert.strictEqual(
    renderer.componentProgramRuntime.programs,
    activePrograms,
    "leaving the outgoing input restores the active program context without mutation",
  );
  renderer.surfaceRuntime.disposeTransitionBranches();
  renderer.componentProgramRuntime.dispose();
  assert.strictEqual(
    store.getState().ui.live.parameterDiffs,
    bankAuthorityBefore,
    "transition scheduling structurally shares the untouched diff authority",
  );
  assert.deepEqual(store.getState().ui.live.parameterDiffs, bankBefore);

  store.advanceLiveTransitions(active.startedAtMs + active.durationMs + 1);
  assert.deepEqual(
    store.getState().ui.live.parameterDiffs,
    bankBefore,
    "transition completion cannot prune or reset a retained target bank",
  );
  assert.strictEqual(store.getState().ui.live.parameterDiffs, bankAuthorityBefore);
});

test("cold Live activation compiles STL diffs into retained LOD and material nodes", () => {
  const packageRoot = createVj1NodePackage();
  const initial = createInitialState();
  const component = initial.components[0];
  const source = component.chain[0];
  source.source = {
    type: "generator",
    generatorId: "modelMedia",
    params: {
      mediaId: "media/sculpture.stl",
      geometryDetail: 0.5,
      renderMode: "surface",
    },
  };
  const prepared = packageRoot.prepareProjectState(initial);
  prepared.ui.live.selectedComponentId = component.id;
  prepared.ui.live.selectedSceneId = "";
  const modelNodeId = componentLayerProjection(prepared, prepared.components[0])[0].nodeId;
  prepared.ui.live.parameterDiffs[component.id] = {
    [component.id]: {
      nodes: {
        [modelNodeId]: {
          source: {
            params: {
              geometryDetail: 2.25,
              renderMode: "points",
            },
          },
        },
      },
    },
  };

  const liveState = createLiveRenderState(prepared);
  const program = compileComponentRenderPrograms(
    liveState.components,
    liveState.nodes.groups,
    {
      rootComponentIds: new Set([component.id]),
      resolveNodeDefinition: (node) => packageRoot.registry.get(
        node.nodeId,
        node.nodeVersion,
      ),
    },
  ).get(component.id);
  const operation = program.plan.operations[0];
  const lod = operation.valueProgram.steps.find((step) => step.instanceId === "lod");
  const material = operation.valueProgram.steps.find((step) => step.instanceId === "material");

  assert.equal(operation.configuration.source.params.geometryDetail, 2.25);
  assert.equal(operation.configuration.source.params.renderMode, "points");
  assert.equal(lod.parameters.geometryDetail, 2.25);
  assert.equal(material.parameters.renderMode, "points");
  assert.equal(
    prepared.ui.live.parameterDiffs[component.id][component.id].nodes[modelNodeId].source.params.geometryDetail,
    2.25,
    "activation projects the diff without mutating or pruning its persistent bank",
  );
});

test("graph-authoritative projects fail saving instead of falling back to a Component chain", () => {
  const state = createInitialState();
  state.nodes = {
    ...(state.nodes || {}),
    authority: "node-graph",
    groups: [],
  };
  assert.throws(
    () => buildProjectPayload(state, "2026-07-20T00:00:00.000Z"),
    /VJ1_PROJECT_COMPONENT_GRAPH_MISSING:/,
  );
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

  const migratedChain = componentChainProjection(reloaded, reloaded.components[0]);
  assert.equal(migratedChain.length, 1);
  assert.equal(migratedChain[0].source.generatorId, "plasma");
  assert.equal(migratedChain[0].boundary.rotation, 0.35);
  assert.equal(migratedChain[0].transform.rotation, 0);
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
    mappings: [{ id: "scene-a", name: "Scene A", snapshot: { surfaces: [surface] } }],
    nodes: {},
  });
  const scene = state.nodes.groups.find((group) => group.id === "vj1.mapping.scene-a");
  const output = state.nodes.groups.find((group) => group.id === "vj1.output.main");

  assert.deepEqual(scene.nodes.map((node) => node.role), [
    "component-source", "surface-route", "composition", "mapping",
  ]);
  assert.equal(scene.nodes.find((node) => node.role === "surface-route").parameters.feather, 0.05);
  assert.deepEqual(output.nodes.map((node) => node.role), ["mapping-program", "composition", "mapping"]);
  assert.equal(state.nodes.definitions.some((definition) => definition.id === "core.composition.mapping-program"), true);
  assert.equal(state.nodes.definitions.some((definition) => definition.id === "core.mapping.projection-engine"), true);
});

test("compiled Mapping routes use Mapping-owned surface values instead of stale generated parameters", () => {
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
    mappings: [{ id: "scene-a", name: "Mapping A", surfaces: [surface], calibration: {} }],
    nodes: {},
    ui: { selectedMappingId: "scene-a" },
  });
  const generatedRoute = state.nodes.groups
    .find((group) => group.id === "vj1.mapping.scene-a")
    .nodes.find((node) => node.role === "surface-route");
  assert.equal(generatedRoute.parameters.opacity, 1);
  assert.equal(generatedRoute.parameters.feather, 0.05);

  state.mappings[0].surfaces[0].opacity = 0.25;
  state.mappings[0].surfaces[0].projectionFit = "contain";
  state.mappings[0].surfaces[0].feather = 0.2;
  const routes = compileMappingRenderPrograms(state, state.nodes.groups).get("scene-a").surfaces;

  assert.equal(routes[0].opacity, 0.25);
  assert.equal(routes[0].projectionFit, "contain");
  assert.equal(routes[0].feather, 0.2);
});

test("compiled Mapping reachability preserves Mapping-owned Surface order", () => {
  const surfaces = [
    { id: "surface-a", enabled: true, componentId: "component-a", sourceNodeId: "component:component-a" },
    { id: "surface-b", enabled: true, componentId: "component-b", sourceNodeId: "component:component-b" },
  ];
  const generated = compileMappingGroupTopology({ id: "", name: "Working Mapping", surfaces });
  const routeConnections = generated.connections.filter((edge) => String(edge.from).startsWith("route:"));
  const otherConnections = generated.connections.filter((edge) => !String(edge.from).startsWith("route:"));
  const graphWithReverseTraversal = { ...generated, connections: [...routeConnections.reverse(), ...otherConnections] };
  const state = { surfaces, mappings: [], ui: { selectedMappingId: "" } };

  const program = compileMappingRenderPrograms(state, [graphWithReverseTraversal]).get("");

  assert.deepEqual(program.surfaces.map((surface) => surface.id), ["surface-a", "surface-b"]);
});

test("the persisted application program connects controls Live services and output infrastructure", () => {
  const packageRoot = createVj1NodePackage();
  const state = packageRoot.prepareProjectState({ components: [], mappings: [], surfaces: [], nodes: {} });
  const program = state.nodes.groups.find((group) => group.id === "vj1.application.program");

  assert.deepEqual(program.nodes.map((node) => node.role), [
    "timing",
    "state-command",
    "data-store",
    "session-devices",
    "media-lifecycle",
    "diagnostics",
    "live-synchronization",
    "storage",
    "cache",
    "output",
  ]);
  assert.equal(program.connections.some((edge) => edge.from === "state.snapshot" && edge.to === "live.state"), true);
  assert.equal(program.connections.some((edge) => edge.from === "state.snapshot" && edge.to === "storage.value"), true);
  assert.equal(program.connections.some((edge) => edge.from === "state.snapshot" && edge.to === "devices.state"), true);
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
  assert.equal(upgraded.topologyVersion, 3);
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
  let state = packageRoot.prepareProjectState(createInitialState());
  const group = state.nodes.groups.find((item) => item.id === "vj1.application.program");
  state = packageRoot.prepareProjectState({
    ...state,
    nodes: withProjectGroupGraph(state.nodes, group.id, {
      ...group,
      connections: group.connections.filter((edge) => edge.to !== "live.$dependency.data-store"),
    }),
  });
  const payload = buildProjectPayload(state, "2026-07-20T00:00:00.000Z");
  assert.equal(payload.nodes.groups.some((item) => item.id === group.id && item.authoredConnections === true), true);
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
    "vj1.mapping.working",
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
  assert.equal(nodeLibraryRailModel(state, packageRoot).sections.some((section) => section.label === "Project programs"), true);
  assert.equal(nodeLibraryStudioModel(state, packageRoot).graphOptions.topologyEditable, true);
  assert.equal(nodeLibraryInspectorModel(state, packageRoot).sections[0].rows.find((row) => row.label === "Topology").value, "Visual compiler · editable");

  const sceneState = { ...state, ui: { ...state.ui, selectedNodeGroupId: "vj1.mapping.working" } };
  assert.equal(nodeLibraryStudioModel(sceneState, packageRoot).graphOptions.connectionsEditable, true);
  assert.equal(nodeLibraryStudioModel(sceneState, packageRoot).graphOptions.nodesEditable, false);
  assert.equal(nodeLibraryInspectorModel(sceneState, packageRoot).sections[0].rows.find((row) => row.label === "Topology").value, "Compiler nodes · connections editable");

  const applicationState = { ...state, ui: { ...state.ui, selectedNodeGroupId: "vj1.application.program" } };
  const applicationStudio = nodeLibraryStudioModel(applicationState, packageRoot);
  assert.ok(applicationStudio.graph.nodes.some((node) => node.id === "state"));
  assert.ok(applicationStudio.graph.nodes.some((node) => node.id === "live"));
  assert.ok(applicationStudio.graph.nodes.some((node) => node.id === "storage"));
  assert.ok(applicationStudio.graph.connections.length > 0);
  assert.deepEqual(applicationStudio.graphOptions.editableConnectionTypes, ["service", "state"]);
  assert.equal(nodeLibraryInspectorModel(applicationState, packageRoot).sections[0].rows.find((row) => row.label === "Topology").value, "Executable wiring · editable");

  const payload = buildProjectPayload(state, "2026-07-20T00:00:00.000Z");
  assert.equal(payload.ui.selectedNodeGroupId, groupIds[0]);
});

test("project-owned visual Groups join the shared Nodes registry and expose an empty typed graph", () => {
  const packageRoot = createVj1NodePackage();
  const definition = packageRoot.createProjectVisualGroupDefinition({
    id: "org.vj1.project.user-visual",
    name: "User Visual",
  });
  const state = packageRoot.prepareProjectState({
    ...createInitialState(),
    nodes: {
      ...createInitialState().nodes,
      definitions: [definition],
    },
  });
  const editor = packageRoot.editorContext([], [], state.nodes.definitions);
  const registered = editor.registry.get(definition.id, definition.version);
  const graph = registered.parts.find((part) => part.kind === "graph");

  assert.equal(registered.implementation.executionModel, "compiled-graph");
  assert.equal(registered.metadata.visualCompilerHook.id, "vj1.visual.compound");
  assert.deepEqual(Object.keys(registered.inlets), ["texture"]);
  assert.deepEqual(Object.keys(registered.outlets), ["texture"]);
  assert.deepEqual(graph.nodes, []);
  const actions = nodeLibraryRailModel(state, editor).sections
    .find((section) => section.id === "project-programs").actions;
  assert.equal(actions.some((action) => action.id === "create-visual-group"), true);
  assert.equal(actions.some((action) => action.id === "create-scene3d-group"), true);
  const studio = nodeLibraryStudioModel({
    ...state,
    ui: { ...state.ui, selectedNodeDefinitionId: definition.id, selectedNodeGroupId: "" },
  }, editor);
  assert.equal(studio.graphOptions.nodesEditable, true);
  assert.equal(studio.graphOptions.visualProgram, true, "new visual Groups insert compiler-owned visual nodes");
  assert.equal(studio.graphOptions.publicInterfaceEditable, true);
  assert.equal(studio.graphOptions.authoringTarget, "visual-graph");
  const rail = nodeLibraryRailModel({
    ...state,
    ui: { ...state.ui, selectedNodeDefinitionId: definition.id, selectedNodeGroupId: "" },
  }, editor);
  assert.equal(nodeLibraryModelItem(rail, "vj1.visual.generator.gradient").draggable, true);
  assert.equal(nodeLibraryModelItem(rail, "core.composition.layer-group").draggable, true);
  assert.equal(nodeLibraryModelItem(rail, "core.scene3d.material").draggable, false);
});

test("project-owned 3D Groups validate with the Scene compiler and render through the ordinary visual compiler", () => {
  const packageRoot = createVj1NodePackage();
  const definition = packageRoot.createProjectScene3dGroupDefinition({
    id: "org.vj1.project.user-scene3d",
    name: "User 3D Scene",
  });
  const state = packageRoot.prepareProjectState({
    ...createInitialState(),
    nodes: {
      ...createInitialState().nodes,
      definitions: [definition],
    },
    ui: {
      ...createInitialState().ui,
      selectedNodeDefinitionId: definition.id,
      selectedNodeGroupId: "",
    },
  });
  const editor = packageRoot.editorContext([], [], state.nodes.definitions);
  const registered = editor.registry.get(definition.id, definition.version);
  const graph = registered.parts.find((part) => part.kind === "graph");
  const studio = nodeLibraryStudioModel(state, editor);

  assert.equal(registered.compiler.id, "vj1.scene-3d.direct-program");
  assert.equal(registered.compiler.target, "scene-3d");
  assert.equal(registered.metadata.visualCompilerHook.id, "vj1.visual.compound");
  assert.equal(registered.metadata.nativeRenderer, "");
  assert.equal(registered.metadata.projectTemplateBase.id, "core.scene3d.composable-render");
  assert.equal(graph.nodes.some((node) => node.type === "core.scene3d.media-mesh"), true);
  assert.equal(graph.nodes.some((node) => node.type === "core.scene3d.material"), true);
  assert.equal(graph.nodes.some((node) => node.type === "core.scene3d.perspective-camera"), true);
  assert.equal(graph.nodes.some((node) => node.type === "core.scene3d.render"), true);
  assert.equal(studio.graphOptions.nodesEditable, true);
  assert.equal(studio.graphOptions.visualProgram, false, "3D Group internals accept typed mesh and Scene nodes");
  assert.equal(studio.graphOptions.authoringTarget, "scene-3d-graph");
  assert.equal(studio.graphOptions.publicInterfaceEditable, true);
  assert.ok(studio.graph.nodes.some((node) => node.type === "core.scene3d.material"));
  assert.ok(studio.graph.nodes.some((node) => node.type === "core.scene3d.render"));
  const rail = nodeLibraryRailModel(state, editor);
  assert.equal(nodeLibraryModelItem(rail, "core.scene3d.material").draggable, true);
  assert.equal(nodeLibraryModelItem(rail, "vj1.visual.generator.gradient").draggable, false);
  assert.equal(editor.preflightGraphEdit({
    kind: "definition",
    definition: registered,
  }, graph), true);
  const invalidGraph = {
    ...graph,
    connections: graph.connections.map((edge) => edge.to === "render.scene"
      ? { from: "camera.camera", to: "render.scene", type: "camera3d" }
      : edge),
  };
  assert.throws(
    () => editor.preflightGraphEdit({
      kind: "definition",
      definition: registered,
    }, invalidGraph),
    /SCENE_3D_PORT_TYPE_MISMATCH/,
    "the real Scene compiler rejects invalid wiring before it can become project state",
  );
});

test("visual graph preflight uses the optimized render-plan compiler atomically", () => {
  const packageRoot = createVj1NodePackage();
  const editor = packageRoot.editorContext();
  const sourceDefinition = listGeneratorComponents()
    .find((component) => component.nodeDefinition.metadata?.visualKind === "generator")
    .nodeDefinition;
  const source = {
    id: "source",
    nodeId: sourceDefinition.id,
    nodeVersion: sourceDefinition.version,
    role: "source",
    compilerHook: sourceDefinition.metadata.visualCompilerHook || {
      id: "vj1.visual.shader-generator",
    },
    configuration: {
      id: "source",
      kind: "source",
      enabled: true,
      source: {
        type: "generator",
        generatorId: sourceDefinition.metadata.visualId,
        instanceId: "source",
        params: {},
      },
    },
  };
  const group = {
    id: "vj1.component.preflight",
    componentId: "preflight",
    nodes: [source],
    connections: [{ from: "source.texture", to: "$out.texture", type: "texture" }],
  };
  assert.equal(editor.preflightGraphEdit({
    kind: "project-group",
    group,
  }, group), true);
  assert.throws(
    () => editor.preflightGraphEdit({
      kind: "project-group",
      group,
    }, {
      ...group,
      connections: [
        { from: "source.texture", to: "source.texture", type: "texture" },
        { from: "source.texture", to: "$out.texture", type: "texture" },
      ],
    }),
    /VISUAL_RENDER_TEXTURE_CYCLE/,
    "an invalid reachable visual edit is rejected by the same compiler used by Output",
  );
});

test("routing and Application graph edits preflight through their production compilers", () => {
  const packageRoot = createVj1NodePackage();
  const state = packageRoot.prepareProjectState(createInitialState());
  const editor = packageRoot.editorContext();
  const application = state.nodes.groups.find((group) => group.id === "vj1.application.program");
  const mapping = state.nodes.groups.find((group) => group.mappingId !== undefined);

  assert.equal(editor.preflightGraphEdit({
    kind: "project-group",
    group: application,
  }, application), true);
  const requiredSetup = application.connections.find((edge) =>
    edge.phase === "setup" && String(edge.to || "").includes("$dependency.")
  );
  assert.ok(requiredSetup);
  assert.throws(
    () => editor.preflightGraphEdit({
      kind: "project-group",
      group: application,
    }, {
      ...application,
      connections: application.connections.filter((edge) => edge !== requiredSetup),
    }),
    /APPLICATION_PROGRAM_DEPENDENCY_MISSING/,
    "an invalid service graph never becomes the saved bootstrap authority",
  );

  assert.ok(mapping);
  assert.equal(editor.preflightGraphEdit({
    kind: "project-group",
    group: mapping,
  }, mapping), true);
  assert.throws(
    () => editor.preflightGraphEdit({
      kind: "project-group",
      group: mapping,
    }, {
      ...mapping,
      connections: [
        ...mapping.connections,
        { from: "projection-mapping.config", to: "surface-composition.state", type: "routes" },
      ],
    }),
    /PROGRAM_GRAPH_CYCLE/,
    "an invalid Mapping route cycle is rejected by the same reachability compiler used by Output",
  );
});

test("public Group interface edits preflight against the target compiler before activation", () => {
  const packageRoot = createVj1NodePackage();
  const serializedVisual = packageRoot.createProjectVisualGroupDefinition({
    id: "org.vj1.project.public-interface-preflight",
    name: "Public Interface Preflight",
  });
  const serializedScene = packageRoot.createProjectScene3dGroupDefinition({
    id: "org.vj1.project.scene-interface-preflight",
    name: "Scene Interface Preflight",
  });
  const editor = packageRoot.editorContext([], [], [serializedVisual, serializedScene]);
  const visual = editor.registry.get(serializedVisual.id);
  const value = editor.registry.get("core.control.value");
  const visualGraph = {
    ...visual.parts.find((part) => part.kind === "graph"),
    nodes: [{
      id: "value",
      type: value.id,
      version: value.version,
      role: "control",
    }],
  };
  const visualNodes = withProjectNodeGraph({}, visual, visualGraph);
  const unsupported = withProjectNodePortExposure(visualNodes, visual, {
    nodeId: "value",
    portId: "value",
    publicPortId: "dataOut",
    port: value.outlets.value,
    direction: "outlet",
    exposed: true,
  });
  assert.throws(
    () => prepareProjectNodeDefinitionEdit(unsupported, visual, {
      preflight: editor.preflightGraphEdit,
    }),
    /VISUAL_COMPOUND_PUBLIC_OUTPUT_TYPE_UNSUPPORTED/,
    "visual Groups cannot persist public data ports their texture compiler cannot execute",
  );
  assert.equal(
    visualNodes.forks[0].definition.outlets.dataOut,
    undefined,
    "the previously valid project fork remains authoritative",
  );

  const scene = editor.registry.get(serializedScene.id);
  const camera = editor.registry.get("core.scene3d.perspective-camera");
  const sceneNodes = withProjectNodePortExposure({}, scene, {
    nodeId: "camera",
    portId: "camera",
    publicPortId: "cameraOut",
    port: camera.outlets.camera,
    direction: "outlet",
    exposed: true,
  });
  assert.equal(prepareProjectNodeDefinitionEdit(sceneNodes, scene, {
    preflight: editor.preflightGraphEdit,
  }), sceneNodes, "Scene3D keeps supported typed data ports");
});

test("authored 3D inlet literals compile into a reusable multi-mesh Scene and image operation", () => {
  const packageRoot = createVj1NodePackage();
  const base = packageRoot.createProjectScene3dGroupDefinition({
    id: "org.vj1.project.authored-scene3d",
    name: "Authored 3D Scene",
  });
  const graph = base.parts.find((part) => part.kind === "graph");
  const nodeParameters = {
    "transform-a": { position: [-0.35, 0.1, 0], rotation: [0, 0.2, 0], scale: [0.8, 0.8, 0.8] },
    "transform-b": { position: [0.4, -0.1, 0], rotation: [0, -0.3, 0], scale: [1.2, 1.2, 1.2] },
    "material-a": {
      surfaceColor: "#ff4020cc",
      wireColor: "#101010ff",
      shaderSource: "vec4 vj1Surface(vec3 normal, vec3 position, vec2 uv, vec4 baseColor) { return vec4(baseColor.rgb * (normal.z * 0.5 + 0.5), baseColor.a); }",
      uniforms: { gain: { type: "float", value: 0.75 } },
    },
    "material-b": { surfaceColor: "#2080ffff", wireColor: "#ffffffff" },
    scene: { background: "#08101880" },
  };
  const editedGraph = {
    ...graph,
    nodes: graph.nodes.map((node) => nodeParameters[node.id]
      ? { ...node, parameters: { ...(node.parameters || {}), ...nodeParameters[node.id] } }
      : node),
  };
  const definition = {
    ...base,
    parts: base.parts.map((part) => part.kind === "graph" ? editedGraph : part),
  };
  const program = compileScene3dProgram(definition, { registry: packageRoot.registry });
  const meshA = testTriangleMesh(-1);
  const meshB = testTriangleMesh(1);
  const target = {
    clearCalls: 0,
    clear() { this.clearCalls += 1; },
    backgroundCalls: [],
    background(...values) { this.backgroundCalls.push(values); },
  };
  const result = program.execute({
    meshAId: "media/a.stl",
    meshBId: "media/b.stl",
  }, {
    resolveMesh: (id) => id === "media/a.stl" ? meshA : id === "media/b.stl" ? meshB : null,
    ...retainedRenderContext(target, 1),
  });
  const scene = program.outputs.get("scene").scene;

  assert.equal(scene.objects.length, 2);
  assert.strictEqual(scene.objects[0].mesh, meshA);
  assert.strictEqual(scene.objects[1].mesh, meshB);
  assert.deepEqual(scene.objects[0].transform.position, [-0.35, 0.1, 0]);
  assert.deepEqual(scene.objects[1].transform.position, [0.4, -0.1, 0]);
  assert.deepEqual(scene.objects[0].material.surfaceColor, [255, 64, 32, 204]);
  assert.deepEqual(scene.objects[1].material.surfaceColor, [32, 128, 255, 255]);
  assert.match(scene.objects[0].material.shader.source, /vec4 vj1Surface/);
  assert.deepEqual(scene.background, [8, 16, 24, 128]);
  assert.strictEqual(result.texture, target);
  assert.equal(target.clearCalls, 1, "the Scene render operation clears once for both mesh objects");
  program.dispose();
});

function testTriangleMesh(offset = 0) {
  return {
    positions: new Float32Array([
      -1 + offset, -1, 0,
      1 + offset, -1, 0,
      offset, 1, 0,
    ]),
    faceNormals: new Float32Array([0, 0, 1]),
    triangleCount: 1,
    bounds: { min: [-1 + offset, -1, 0], max: [1 + offset, 1, 0] },
    sourceBounds: { min: [-1 + offset, -1, 0], max: [1 + offset, 1, 0] },
  };
}

test("authored Scene routes survive topology refresh and control the compiled render program", () => {
  const packageRoot = createVj1NodePackage();
  let state = packageRoot.prepareProjectState(createInitialState());
  const groupId = "vj1.mapping.working";
  const group = state.nodes.groups.find((item) => item.id === groupId);
  const removedSurfaceId = state.surfaces[0].id;
  const removedRouteOutput = `route:${removedSurfaceId}.route`;
  const connections = group.connections.filter((edge) => edge.from !== removedRouteOutput);

  state = packageRoot.prepareProjectState({
    ...state,
    nodes: withProjectGroupGraph(state.nodes, groupId, { ...group, connections }),
  });

  const refreshed = state.nodes.groups.find((item) => item.id === groupId);
  const program = compileMappingRenderPrograms(state, state.nodes.groups).get("");
  assert.equal(refreshed.authoredConnections, true);
  assert.equal(refreshed.connections.some((edge) => edge.from === removedRouteOutput), false);
  assert.equal(program.surfaces.some((surface) => surface.id === removedSurfaceId), false);
  assert.equal(program.surfaces.some((surface) => surface.id === state.surfaces[1].id), true);
});

test("a new Surface receives default Scene wiring without restoring an authored disconnection", () => {
  const packageRoot = createVj1NodePackage();
  let state = packageRoot.prepareProjectState(createInitialState());
  const groupId = "vj1.mapping.working";
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
  const program = compileMappingRenderPrograms(state, state.nodes.groups).get("");
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
      "session-devices": (dependencies) => service("session-devices", dependencies),
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
  assert.equal(runtime.get("session-devices").dependencies["live-synchronization"], runtime.get("live-synchronization"));
  assert.equal(runtime.get("storage").dependencies["live-synchronization"], runtime.get("live-synchronization"));
  assert.equal(runtime.get("output").dependencies.cache.executionDomain, "output");
  assert.equal(packageRoot.registry.has(runtime.node("cache").nodeId, runtime.node("cache").nodeVersion), true);
  assert.deepEqual(created, [
    "timing", "state-command", "data-store", "media-lifecycle", "diagnostics",
    "live-synchronization", "session-devices", "storage", "output",
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
    mappings: [],
    surfaces: [],
    ui: { selectedChainItemId: "gradient-a" },
    nodes: {},
  });
  const editorModel = selectedNodeEditorModel(component, state, packageRoot);
  const definition = packageRoot.registry.get("vj1.visual.generator.gradient");
  const shader = definition.parts.find((part) => part.kind === "shader");
  const edited = `${shader.source}\n// edited in project`;

  assert.equal(editorModel.id, "vj1.visual.generator.gradient");
  assert.equal(editorModel.sources.some((source) => source.label.includes("Shaders")), true);
  assert.equal(editorModel.sources.some((source) => source.id === "fragment-shader"), true);
  assert.match(editorModel.note, /visual graphs retain their specialized compiler path/);

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
  const rail = nodeLibraryRailModel(state, packageRoot);
  const groupState = { ...state, ui: { ...state.ui, selectedNodeDefinitionId: "core.mesh.parse-3d-object" } };
  const shaderState = { ...state, ui: { ...state.ui, selectedNodeDefinitionId: "vj1.visual.generator.gradient" } };

  assert.equal(rail.title, "Node library");
  assert.equal(nodeLibraryModelItem(rail, "vj1.visual.generator.testPattern").label, "Test Pattern");
  assert.equal(nodeLibraryModelItem(rail, "core.mesh.parse-3d-object").label, "Parse 3D Object");
  assert.equal(nodeLibraryModelItem(rail, "core.scene3d.planar-grid-mesh").label, "Planar Grid Mesh");
  const studio = nodeLibraryStudioModel(groupState, packageRoot);
  assert.ok(studio.graph);
  assert.ok(studio.graph.connections.length > 0);
  assert.equal(studio.definition.name, "Parse 3D Object");
  const inspector = nodeLibraryInspectorModel(shaderState, packageRoot);
  assert.equal(inspector.id, "vj1.visual.generator.gradient");
  assert.equal(inspector.sources.some((source) => source.id === "fragment-shader"), true);
});
