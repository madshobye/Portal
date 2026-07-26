import test from "node:test";
import assert from "node:assert/strict";
import {
  createCoreValueTypeRegistry,
  createNodeInstance,
  createNodePacket,
  createProjectNodeFork,
  compileJavaScriptNodeModule,
  defineNode,
  defineNodeArtifact,
  defineNodeGroup,
  definePort,
  NodeArtifactCatalog,
  NodeCompilerRegistry,
  nodeEditorPanels,
  nodeEditorProjection,
  NodeInstance,
  NodeRegistry,
  NODE_EDIT_ACTIVATION,
  NODE_GROUP_EXECUTION_MODELS,
  NODE_PART_KINDS,
  NODE_COMPILER_TARGETS,
  numberType,
  recordType,
  materializeProjectNodeFork,
  installNodePackageReference,
  normalizeNodeProjectData,
  pinNodeVersion,
  serializeNodeDefinition,
  serializeNodeProjectData,
  defineNodeCompiler,
  validateNodeGraphProgramDefinition,
  validateProjectNodeFork,
} from "../js/libraries/node-engine/index.js";
import { ImageResizeNode } from "../js/libraries/image-engine/image-resize/index.js";
import { ObjParserNode, StlParserNode } from "../js/libraries/mesh-engine/index.js";
import { SliderArtifact, SliderNode } from "../js/libraries/control-engine/slider/index.js";
import { getGeneratorNodeComponent as getGeneratorComponent } from "../js/libraries/visual-nodes/index.js";
import { createProjectVisualNodeResolver } from "../js/libraries/visual-nodes/index.js";
import { getEffectNodeComponent } from "../js/libraries/visual-nodes/index.js";
import {
  TerrainBiomeMaterialProviderNode,
  TerrainHeightFieldGeometryProviderNode,
  TerrainWireMaterialProviderNode,
  TextMaskProviderNode,
} from "../js/libraries/visual-nodes/index.js";
import {
  compileRenderProgram,
  createRenderContext,
  createTextureFrame,
  RenderContextType,
  TextureFrameType,
} from "../js/libraries/render-engine/render-node-contract.js";
import {
  defineVisualNodeContract,
  visualContractsCompatible,
  VISUAL_HIT_REGION_MODES,
  VISUAL_ROI_MODES,
  VISUAL_TRANSFORM_DOMAINS,
} from "../js/libraries/render-engine/visual-node-contract.js";

test("node definitions expose a versioned editable manifest", () => {
  const definition = defineNode({
    id: "test.shader",
    name: "Test Shader",
    version: "1.2.3",
    description: "A test node with editable JavaScript and shader parts.",
    inlets: { amount: { type: "number", expectedRange: [0, 1] } },
    outlets: { value: "number" },
    parts: [
      { id: "logic", kind: NODE_PART_KINDS.JAVASCRIPT, source: "return input;" },
      { id: "fragment", kind: NODE_PART_KINDS.SHADER, stage: "fragment", source: "void main() {}" },
    ],
    process: ({ amount }) => ({ value: amount }),
  });

  assert.equal(definition.version, "1.2.3");
  assert.equal(definition.formatVersion, 1);
  assert.equal(definition.description, "A test node with editable JavaScript and shader parts.");
  assert.equal(definition.authoring.activation, NODE_EDIT_ACTIVATION.RECOMPILE);
  assert.deepEqual(nodeEditorPanels(definition).map((panel) => panel.editor), [
    "node-overview",
    "code-editor",
    "shader-editor",
  ]);
});

test("groups declare whether their graph or native program owns behavior", () => {
  const graph = defineNodeGroup({
    id: "test.semantic-group",
    name: "Semantic group",
    description: "A graph-owned group.",
    executionModel: NODE_GROUP_EXECUTION_MODELS.GRAPH,
  });
  const native = defineNodeGroup({
    id: "test.native-composite",
    name: "Native composite",
    description: "A code-owned composite with an inspectable graph.",
    nodes: [{ id: "child", type: "test.child" }],
    program: async () => ({}),
  });

  assert.equal(graph.implementation.executionModel, NODE_GROUP_EXECUTION_MODELS.GRAPH);
  assert.equal(graph.parts.find((part) => part.kind === NODE_PART_KINDS.GRAPH).editable, true);
  assert.equal(native.implementation.executionModel, NODE_GROUP_EXECUTION_MODELS.NATIVE_COMPOSITE);
  assert.equal(native.parts.find((part) => part.kind === NODE_PART_KINDS.GRAPH).editable, false);
});

test("Groups declaratively project public controls through semantic child bindings", () => {
  const group = defineNodeGroup({
    id: "test.control-projection",
    name: "Control projection",
    description: "Projects shared controls without custom UI code.",
    parameters: {
      amount: { type: "number", defaultValue: 0.5 },
      tint: { type: "color", defaultValue: "#ffffffff" },
    },
    nodes: [
      { id: "geometry", type: "test.geometry" },
      { id: "material", type: "test.material" },
      { id: "render", type: "test.render" },
    ],
    controlBindings: {
      geometry: [{ publicParameterId: "amount", targetParameterId: "density" }],
      material: ["tint"],
      render: ["amount"],
    },
    controlPresentation: {
      geometry: { sectionId: "shape", label: "Shape", order: 10 },
      material: { label: "Material", order: 20 },
      render: { sectionId: "shape", label: "Shape", order: 10 },
    },
  });

  assert.deepEqual(group.metadata.controlProjection, {
    format: "vj1.control-projection@1",
    sections: [
      {
        id: "shape",
        label: "Shape",
        controls: [{
          parameterId: "amount",
          bindings: [
            { nodeId: "geometry", parameterId: "density" },
            { nodeId: "render", parameterId: "amount" },
          ],
        }],
      },
      {
        id: "material",
        label: "Material",
        controls: [{
          parameterId: "tint",
          bindings: [{ nodeId: "material", parameterId: "tint" }],
        }],
      },
    ],
  });
  assert.throws(() => defineNodeGroup({
    id: "test.invalid-control-node",
    name: "Invalid controls",
    description: "Rejects controls bound to a missing child.",
    parameters: { amount: { type: "number" } },
    controlBindings: { missing: ["amount"] },
  }), /NODE_GROUP_CONTROL_NODE_UNKNOWN/);
  assert.throws(() => defineNodeGroup({
    id: "test.invalid-control-parameter",
    name: "Invalid controls",
    description: "Rejects controls without a public parameter.",
    nodes: [{ id: "child", type: "test.child" }],
    controlBindings: { child: ["missing"] },
  }), /NODE_GROUP_CONTROL_PARAMETER_UNKNOWN/);
});

test("visual contracts normalize transform ROI allocation alpha and interaction independently of backend", () => {
  const generator = defineVisualNodeContract({
    transform: { domain: VISUAL_TRANSFORM_DOMAINS.CONTENT },
    roi: { mode: VISUAL_ROI_MODES.NEIGHBORHOOD, halo: 8 },
  });
  const effect = defineVisualNodeContract({
    transform: { domain: VISUAL_TRANSFORM_DOMAINS.COMPOSITION },
    roi: { mode: VISUAL_ROI_MODES.LOCAL },
  });
  const compatibility = visualContractsCompatible(generator, effect);

  assert.equal(generator.roi.halo, 8);
  assert.equal(generator.roi.inputMapping, "identity");
  assert.equal(generator.alpha.output, "premultiplied");
  assert.equal(
    generator.interaction.hitRegion,
    VISUAL_HIT_REGION_MODES.RENDERED_ALPHA,
    "visual outputs expose their rendered coverage to editor and interactive consumers by default",
  );
  assert.equal(
    defineVisualNodeContract({
      interaction: { hitRegion: VISUAL_HIT_REGION_MODES.BOUNDARY },
    }).interaction.hitRegion,
    VISUAL_HIT_REGION_MODES.BOUNDARY,
  );
  assert.deepEqual(compatibility, { coordinates: true, alpha: true });
});

test("compiler targets keep control routing transitions and 3D specialization explicit", () => {
  assert.deepEqual(Object.values(NODE_COMPILER_TARGETS), [
    "direct",
    "visual",
    "control",
    "routing",
    "service",
    "transition",
    "scene-3d",
  ]);
  assert.throws(() => defineNodeCompiler({
    id: "test.unknown-compiler",
    target: "implicit-everything",
    compile: () => ({ execute() {} }),
  }), /NODE_COMPILER_TARGET_UNKNOWN/);
});

test("project node data persists editable definitions, pins, instances, groups, artifacts, forks, and migrations", () => {
  const definition = defineNode({
    id: "test.persisted",
    name: "Persisted node",
    version: "1.2.3",
    description: "Project-persisted node",
    parameters: { amount: { type: "number", defaultValue: 0.5 } },
    outlets: { value: "number" },
    parts: [{ id: "logic", kind: NODE_PART_KINDS.JAVASCRIPT, source: "return amount;" }],
    process: ({ amount }) => ({ value: amount }),
  });
  const persistedDefinition = serializeNodeDefinition(definition);
  const project = serializeNodeProjectData({
    definitions: [persistedDefinition],
    pins: pinNodeVersion([], definition.id, definition.version),
    instances: [{ id: "instance-a", nodeId: definition.id, parameters: { amount: 0.75 } }],
    groups: [{ id: "group-a", nodes: ["instance-a"], connections: [] }],
    artifacts: [{ id: "artifact-a", artifactType: "component", implementation: { nodeType: definition.id } }],
    forks: [{ id: "fork-a", base: { id: definition.id, version: definition.version } }],
    packages: installNodePackageReference([], "org.example.visuals", "2.3.0"),
    migrations: [{ id: "migration-a", from: "1.2.2", to: "1.2.3" }],
  });

  assert.equal(persistedDefinition.process, undefined, "runtime callbacks never enter project JSON");
  assert.equal(JSON.stringify(project).includes("process"), false);
  assert.equal(project.definitions[0].parts[0].source, "return amount;");
  assert.deepEqual(project.pins, [{ nodeId: "test.persisted", version: "1.2.3" }]);
  assert.deepEqual(normalizeNodeProjectData(JSON.parse(JSON.stringify(project))), project);
  assert.deepEqual(project.instances[0].parameters, { amount: 0.75 });
  assert.equal(project.groups[0].id, "group-a");
  assert.equal(project.artifacts[0].artifactType, "component");
  assert.equal(project.forks[0].base.version, "1.2.3");
  assert.deepEqual(project.packages, [{
    id: "org.example.visuals",
    version: "2.3.0",
    enabled: true,
  }]);
  assert.equal(project.migrations[0].to, "1.2.3");
});

test("project node data omits package records and reconstructible runtime projections", () => {
  const project = serializeNodeProjectData({
    definitions: [
      { id: "core.library", version: "1.0.0", persistence: "package", parts: [{ source: "large library code" }] },
      { id: "project.custom", version: "1.0.0", parts: [{ source: "project code" }] },
    ],
    instances: [
      { id: "derived", persistence: "derived" },
      { id: "authored" },
    ],
    groups: [
      { id: "helper", persistence: "package" },
      { id: "default-program", persistence: "derived" },
      { id: "edited-program", persistence: "project-diff", authoredConnections: true },
    ],
    artifacts: [
      { id: "generated-artifact", persistence: "derived" },
      { id: "project-artifact" },
    ],
  });

  assert.deepEqual(project.definitions.map((item) => item.id), ["project.custom"]);
  assert.deepEqual(project.instances.map((item) => item.id), ["authored"]);
  assert.deepEqual(project.groups.map((item) => item.id), ["edited-program"]);
  assert.equal(Object.hasOwn(project.groups[0], "persistence"), false);
  assert.deepEqual(project.artifacts.map((item) => item.id), ["project-artifact"]);
});

test("nodes execute directly as ordinary program components", async () => {
  const node = defineNode({
    id: "test.weighted-sum",
    name: "Weighted Sum",
    description: "Computes its algorithm directly inside the node implementation.",
    inlets: { left: "number", right: "number" },
    parameters: { weight: { type: "number", defaultValue: 2 } },
    outlets: { value: "number" },
    process: ({ left, right, weight }) => ({ value: left + right * weight }),
  });
  const instance = new NodeInstance(node);
  assert.deepEqual(await instance.run({ left: 3, right: 4 }), { value: 11 });
});

test("render contracts carry resolution transform timing and texture identity", () => {
  const context = createRenderContext({
    request: { role: "component", width: 640, height: 360, logicalWidth: 1280, logicalHeight: 720 },
    timing: { time: 2.5, delta: 1 / 60, frame: 150 },
    transform: { x: 0.25, y: -0.5, scale: 1.5, rotation: 0.2 },
    quality: 0.75,
  });
  const frame = createTextureFrame({ id: "texture-a" }, context, 4);
  const types = createCoreValueTypeRegistry();

  types.assert(RenderContextType, context);
  types.assert(TextureFrameType, frame);
  assert.deepEqual([context.request.width, context.request.logicalWidth], [640, 1280]);
  assert.deepEqual(context.transform.translation, [0.25, -0.5]);
  assert.equal(frame.version, 4);
});

test("compiled render programs reuse direct step state without generic node packets", () => {
  const stateReferences = [];
  const program = compileRenderProgram({
    id: "test.render-program",
    steps: [
      { id: "double", execute: (value, _context, state) => {
        stateReferences.push(state);
        state.calls = (state.calls || 0) + 1;
        return value * 2;
      } },
      { id: "offset", execute: (value, context, state) => {
        state.calls = (state.calls || 0) + 1;
        return value + context.offset;
      } },
    ],
  });

  assert.equal(program.execute(3, { offset: 1 }), 7);
  assert.equal(program.execute(4, { offset: 2 }), 10);
  assert.equal(stateReferences[0], stateReferences[1]);
  assert.deepEqual(program.stepStates.map((state) => state.calls), [2, 2]);
  assert.equal("outputPackets" in program, false);
});

test("custom compiler backends produce opaque programs without generic frame traversal", () => {
  let compileCalls = 0;
  let executeCalls = 0;
  const compiler = defineNodeCompiler({
    id: "test.visual-compiler",
    target: NODE_COMPILER_TARGETS.VISUAL,
    accepts: (group) => group.nodeId === "test.visual-group",
    compile: (group) => {
      compileCalls++;
      const fusedSteps = group.nodes.map((node) => node.value);
      return {
        execute(input) {
          executeCalls++;
          return fusedSteps.reduce((value, step) => value + step, input);
        },
      };
    },
  });
  const registry = new NodeCompilerRegistry([compiler]);
  const program = registry.compile({
    id: "group-a",
    nodeId: "test.visual-group",
    compiler: { id: compiler.id },
    nodes: [{ value: 2 }, { value: 3 }],
  }, { target: NODE_COMPILER_TARGETS.VISUAL });

  assert.equal(program.execute(1), 6);
  assert.equal(program.execute(2), 7);
  assert.equal(compileCalls, 1);
  assert.equal(executeCalls, 2);
  assert.equal("outputPackets" in program, false);
});

test("materialized shader nodes execute from their node-owned shader and parameters", async () => {
  const component = getEffectNodeComponent("ripple");
  const definition = component.nodeDefinition;
  const input = { id: "input-texture" };
  const output = { id: "output-texture" };
  let rendered = null;
  const instance = new NodeInstance(definition);

  const result = await instance.run({ texture: input }, {
    renderVisualNode: (request) => {
      rendered = request;
      return output;
    },
  });

  assert.equal(result.texture, output);
  assert.equal(rendered.definition, definition);
  assert.equal(rendered.inputs.texture, input);
  assert.match(definition.parts.find((part) => part.kind === "shader").source, /runEffect/);
  assert.equal(component.renderAuthority, "node-definition");
});

test("native calibration generators own executable editable JavaScript render modules", () => {
  const definition = getGeneratorComponent("checker").nodeDefinition;
  assert.equal(definition.metadata.nodeOwnedNativeProcess, true);
  assert.equal(definition.implementation.kind, "code");
  assert.ok(definition.parts.some((part) => part.kind === NODE_PART_KINDS.JAVASCRIPT && part.editable));
  assert.equal(typeof compileJavaScriptNodeModule(definition.parts, definition).process, "function");
  const compiled = compileJavaScriptNodeModule(definition.parts, definition);
  const calls = { fills: 0, rects: 0 };
  const target = {
    width: 100,
    height: 100,
    noStroke() {},
    fill() { calls.fills += 1; },
    rect() { calls.rects += 1; },
  };
  assert.strictEqual(compiled.process({}, { target }), target);
  assert.equal(calls.fills > 0, true);
  assert.equal(calls.rects, calls.fills);
});

test("portable calibration generators remain editable ISF while compiling to a direct fragment kernel", () => {
  const component = getGeneratorComponent("black");
  const definition = component.nodeDefinition;

  assert.equal(definition.implementation.kind, "shader");
  assert.equal(definition.implementation.language, "isf");
  assert.equal(definition.metadata.builtInAssetDefinition, true);
  assert.equal(definition.metadata.optimizedIsfLowering, "fragment-generator");
  assert.equal(component.renderAuthority, "built-in-isf-lowered");
  assert.equal(component.type, "fragment");
  assert.match(definition.parts[0].source, /"LOWERING": "fragment-generator"/);
  assert.match(component.code, /gl_FragColor = vec4\(0\.0, 0\.0, 0\.0, 1\.0\)/);
});

test("procedural 2D generators expose editable JS programs compiled to node-owned shaders", () => {
  for (const id of ["sdfSketch", "testPattern"]) {
    const definition = getGeneratorComponent(id).nodeDefinition;
    assert.equal(definition.implementation.kind, "shader");
    assert.equal(definition.metadata.nodeOwnedShader, true);
    assert.ok(definition.parts.some((part) => part.kind === NODE_PART_KINDS.JAVASCRIPT && part.editable));
    assert.ok(definition.parts.some((part) => part.kind === NODE_PART_KINDS.SHADER));
    assert.equal(definition.metadata.nativeRenderer, undefined);
  }
});

test("project-local shader forks become the visual resolver authority", () => {
  const base = getEffectNodeComponent("ripple");
  const editedSource = `${base.code}\n// project edit`;
  const fork = createProjectNodeFork(base.nodeDefinition, {
    forkId: "ripple-project",
    overrides: {
      parts: base.nodeDefinition.parts.map((part) => part.kind === "shader"
        ? { ...part, source: editedSource }
        : part),
    },
  });
  const resolver = createProjectVisualNodeResolver({ nodes: { forks: [{ ...fork, active: true }] } });
  const resolved = resolver.effect("ripple");

  assert.equal(resolved.code, editedSource);
  assert.equal(resolved.projectForkId, fork.id);
  assert.equal(resolved.renderAuthority, "project-node-fork");
  assert.equal(resolver.effect("invert").renderAuthority, "built-in-isf-lowered");
  assert.equal(resolver.effect("gray").renderAuthority, "built-in-isf-lowered");
  assert.equal(resolver.effect("threshold").renderAuthority, "built-in-isf-lowered");
});

test("project-local native JavaScript forks become the compiled node process", () => {
  const base = getGeneratorComponent("checker").nodeDefinition;
  const fork = createProjectNodeFork(base, {
    forkId: "checker-project",
    overrides: {
      parts: base.parts.map((part) => part.id === "checker-algorithm"
        ? { ...part, source: "function drawCheckerNode(pg) { pg.background(7); }" }
        : part),
    },
  });
  const resolver = createProjectVisualNodeResolver({ nodes: { forks: [{ ...fork, active: true }] } });
  const resolved = resolver.definition(base.id);
  const calls = [];
  const target = { background: (value) => calls.push(value) };

  assert.equal(resolved.id, fork.id);
  assert.strictEqual(resolved.process({}, { target }), target);
  assert.deepEqual(calls, [7]);
});

test("project-local helper edits become runtime module exports", () => {
  const outer = getGeneratorComponent("text").nodeDefinition;
  const base = TextMaskProviderNode;
  assert.deepEqual(outer.parts.filter((part) =>
    part.kind === NODE_PART_KINDS.JAVASCRIPT || part.kind === NODE_PART_KINDS.SHADER
  ), [], "the outer Text Group has no hidden editable implementation");
  const fork = createProjectNodeFork(base, {
    forkId: "text-layout-project",
    overrides: {
      parts: base.parts.map((part) => part.id === "text-layout-module"
        ? {
            ...part,
            source: [
              "function createTextMask(_params, _width, _height, existing) { return existing || { forked: true }; }",
              "function textMaskDimensions(width, height) { return { width, height }; }",
              "function textMaskSignature() { return 'forked-layout'; }",
              "function parseTextMarkdown() { return []; }",
            ].join("\n"),
          }
        : part),
    },
  });
  const resolver = createProjectVisualNodeResolver(
    { nodes: { forks: [{ ...fork, active: true }] } },
    { coreDefinitions: [base] },
  );
  const resolved = resolver.definition(base.id);

  assert.equal(resolved.moduleExports.textMaskSignature({}, 1, 1), "forked-layout");
  assert.deepEqual(resolved.moduleExports.textMaskDimensions(3, 2), { width: 3, height: 2 });
  assert.deepEqual(resolved.moduleExports.createTextMask({}, 1, 1), { forked: true });
});

test("export-only native helper modules remain honestly forkable without a process entry", () => {
  const base = defineNode({
    id: "test.native-export-module",
    name: "Native export module",
    version: "1.0.0",
    description: "Tests editable helper exports owned by a native compiler boundary.",
    implementation: { kind: "native", compiler: "test.compiler", kernel: "test-kernel" },
    moduleExports: { nativeScale: () => 1 },
    parts: [{
      id: "native-helper",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      exports: ["nativeScale"],
      source: "function nativeScale() { return 1; }",
    }],
  });
  const fork = createProjectNodeFork(base, {
    forkId: "native-export-project",
    overrides: {
      parts: base.parts.map((part) => ({
        ...part,
        source: "function nativeScale() { return 4; }",
      })),
    },
  });

  assert.equal(validateProjectNodeFork(base, fork), true);
  const materialized = materializeProjectNodeFork(base, fork);
  assert.equal(materialized.process, null);
  assert.equal(materialized.moduleExports.nativeScale(), 4);
});

test("Terrain child nodes own the editable topology and shaders used by retained GPU kernels", () => {
  const outer = getGeneratorComponent("terrainFlyover").nodeDefinition;
  const base = TerrainHeightFieldGeometryProviderNode;
  const meshPart = base.parts.find((part) => part.id === "terrain-mesh-module");
  assert.equal(outer.metadata.nodeOwnedNativeModule, true);
  assert.equal(outer.metadata.nodeOwnedNativeProcess, false);
  assert.deepEqual(outer.parts.filter((part) =>
    part.kind === NODE_PART_KINDS.JAVASCRIPT || part.kind === NODE_PART_KINDS.SHADER
  ), [], "the outer Terrain Group has no hidden editable implementation");
  assert.equal(meshPart.kind, NODE_PART_KINDS.JAVASCRIPT);
  assert.match(meshPart.source, /function terrainSurfaceTriangleIndices/);
  assert.deepEqual(TerrainBiomeMaterialProviderNode.parts.map((part) => part.id), [
    "terrain-surface-vertex",
    "terrain-surface-fragment",
  ]);
  assert.deepEqual(TerrainWireMaterialProviderNode.parts.map((part) => part.id), [
    "terrain-wire-vertex",
    "terrain-wire-fragment",
  ]);
  assert.equal(base.moduleExports.terrainGridSize(200), 144);

  const fork = createProjectNodeFork(base, {
    forkId: "terrain-topology-project",
    overrides: {
      parts: base.parts.map((part) => part.id === "terrain-mesh-module"
        ? {
            ...part,
            source: part.source.replace(
              /function terrainGridSize\(value\) \{[\s\S]*?\n\}/,
              "function terrainGridSize() { return 17; }"
            ),
          }
        : part),
    },
  });
  const resolver = createProjectVisualNodeResolver(
    { nodes: { forks: [{ ...fork, active: true }] } },
    { coreDefinitions: [base] },
  );
  const resolved = resolver.definition(base.id);

  assert.equal(resolved.moduleExports.terrainGridSize(200), 17);
  assert.equal(typeof resolved.moduleExports.terrainSurfaceGridVertices, "function");
});

test("node editor projects every conceptual editor surface and project-local forks", async () => {
  const base = defineNode({
    id: "test.editor-node",
    name: "Editor Node",
    version: "1.0.0",
    description: "Editable node",
    parameters: { amount: { type: "number", defaultValue: 0.5 } },
    outlets: { value: "number" },
    parts: [
      { id: "logic", kind: NODE_PART_KINDS.JAVASCRIPT, source: "return amount;" },
      { id: "shader", kind: NODE_PART_KINDS.SHADER, source: "void main() {}" },
      { id: "docs", kind: NODE_PART_KINDS.DOCUMENTATION, source: "Usage" },
      { id: "tests", kind: NODE_PART_KINDS.TEST, source: "assert(true)" },
    ],
    process: ({ amount }) => ({ value: amount }),
  });
  const registry = new NodeRegistry([base]);
  const fork = createProjectNodeFork(base, {
    forkId: "project-a",
    overrides: { parts: [{ id: "logic", kind: NODE_PART_KINDS.JAVASCRIPT, source: "return amount * 2;" }] },
  });
  const projection = nodeEditorProjection(base, { nodeRegistry: registry, projectForks: [fork] });
  const materialized = materializeProjectNodeFork(base, fork);

  assert.deepEqual(projection.panels.map((panel) => panel.id), [
    "overview", "parameters", "javascript", "shaders", "graph", "assets", "documentation", "tests", "versions", "forks",
  ]);
  assert.equal(projection.panel("javascript").data.parts[0].editor, "code-editor");
  assert.equal(projection.panel("shaders").data.parts[0].editor, "shader-editor");
  assert.deepEqual(projection.panel("versions").data.available.map((item) => item.version), ["1.0.0"]);
  assert.equal(projection.panel("forks").data.forks[0].id, fork.id);
  assert.equal(materialized.metadata.projectLocal, true);
  assert.equal(materialized.metadata.baseNode.version, "1.0.0");
  assert.deepEqual(await new NodeInstance(materialized).run({}, { parameters: { amount: 0.25 } }), { value: 0.5 });
});

test("invalid project JavaScript is rejected before it can become active", () => {
  const base = defineNode({
    id: "test.invalid-edit",
    name: "Invalid edit",
    description: "Validates project code before save.",
    outlets: { value: "number" },
    parts: [{ id: "logic", kind: NODE_PART_KINDS.JAVASCRIPT, entry: "process", source: "return 1;" }],
    process: () => ({ value: 1 }),
  });
  const fork = createProjectNodeFork(base, {
    overrides: { parts: [{ ...base.parts[0], source: "const value = await loadValue(); return value;" }] },
  });
  assert.throws(() => validateProjectNodeFork(base, fork), /await|Unexpected reserved word|Unexpected identifier/);
});

test("editable JavaScript modules link helper parts into a stable process entry", async () => {
  const base = defineNode({
    id: "test.linked-module",
    name: "Linked module",
    description: "Compiles multiple editable JavaScript parts as one node module.",
    inlets: { value: "number" },
    outlets: { value: "number" },
    parts: [
      {
        id: "math",
        kind: NODE_PART_KINDS.JAVASCRIPT,
        export: "scaleValue",
        source: "function scaleValue(value) { return value * 2; }",
      },
      {
        id: "process",
        kind: NODE_PART_KINDS.JAVASCRIPT,
        export: "linkedProcess",
        entry: "process",
        dependsOn: ["math"],
        source: "function linkedProcess({ value }) { return { value: scaleValue(value) }; }",
      },
    ],
    process: ({ value }) => ({ value: value * 2 }),
  });
  const fork = createProjectNodeFork(base, {
    overrides: {
      parts: base.parts.map((part) => part.id === "math"
        ? { ...part, source: "function scaleValue(value) { return value * 3; }" }
        : part),
    },
  });
  const materialized = materializeProjectNodeFork(base, fork);
  const module = compileJavaScriptNodeModule(fork.definition.parts, base);

  assert.deepEqual(module.parts, ["math", "process"]);
  assert.equal(module.exports.scaleValue(4), 12);
  assert.deepEqual(await new NodeInstance(materialized).run({ value: 5 }), { value: 15 });
});

test("JavaScript module dependencies reject missing parts and cycles before activation", () => {
  const definition = defineNode({
    id: "test.module-errors",
    name: "Module errors",
    description: "Validates linked module dependencies.",
    parts: [],
    process: () => ({}),
  });
  assert.throws(() => compileJavaScriptNodeModule([
    { id: "entry", kind: NODE_PART_KINDS.JAVASCRIPT, entry: "process", dependsOn: ["missing"], source: "return {};" },
  ], definition), /NODE_FORK_JAVASCRIPT_DEPENDENCY_MISSING/);
  assert.throws(() => compileJavaScriptNodeModule([
    { id: "a", kind: NODE_PART_KINDS.JAVASCRIPT, dependsOn: ["b"], source: "function a() {}" },
    { id: "b", kind: NODE_PART_KINDS.JAVASCRIPT, dependsOn: ["a"], source: "function b() {}" },
  ], definition), /NODE_FORK_JAVASCRIPT_DEPENDENCY_CYCLE/);
});

test("STL and OBJ node modules execute their editable parser parts with explicit runtime bindings", async () => {
  const stlModule = compileJavaScriptNodeModule(StlParserNode.parts, StlParserNode);
  const objModule = compileJavaScriptNodeModule(ObjParserNode.parts, ObjParserNode);
  const stl = await stlModule.process({
    source: new TextEncoder().encode("solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t"),
  });
  const obj = await objModule.process({ source: "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3" });

  assert.equal(stl.mesh.triangleCount, 1);
  assert.equal(obj.mesh.triangleCount, 1);
  assert.equal(typeof stlModule.exports.parseStlMesh, "function");
  assert.equal(typeof objModule.exports.parseObjMesh, "function");
  assert.deepEqual(StlParserNode.parts.at(-1).dependsOn, ["stl-parser", "stl-source-reader"]);
});

test("a project STL parser fork changes parser-node execution", async () => {
  const parserSource = [
    "function forkMesh() {",
    "  return attachLegacyTriangleView({ positions: new Float32Array([77, 0, 0, 0, 1, 0, 0, 0, 1]), faceNormals: new Float32Array([0, 0, 1]), triangleCount: 1, bounds: { min: [0, 0, 0], max: [77, 1, 1] }, sourceBounds: { min: [0, 0, 0], max: [77, 1, 1] } });",
    "}",
    "function parseStlMesh() { return forkMesh(); }",
    "function parseStlPreviewMesh() { return forkMesh(); }",
  ].join("\n");
  const fork = createProjectNodeFork(StlParserNode, {
    forkId: "stl-project",
    overrides: {
      parts: StlParserNode.parts.map((part) => part.id === "stl-parser"
        ? { ...part, source: parserSource }
        : part),
    },
  });
  const materialized = materializeProjectNodeFork(StlParserNode, fork);
  const result = await new NodeInstance(materialized, { parameters: { profile: "preview" } })
    .run({ source: new ArrayBuffer(15) });

  assert.equal(result.mesh.positions[0], 77);
  assert.equal(materialized.moduleExports.parseStlPreviewMesh().positions[0], 77);
});

test("editable groups execute their graph directly without a scheduler", async () => {
  const add = defineNode({
    id: "test.graph-add",
    name: "Graph add",
    description: "Adds a configured amount.",
    inlets: { value: "number" },
    parameters: { amount: { type: "number", defaultValue: 1 } },
    outlets: { value: "number" },
    process: ({ value, amount }) => ({ value: value + amount }),
  });
  const group = defineNodeGroup({
    id: "test.editable-graph",
    name: "Editable graph",
    description: "Runs a persisted graph on demand.",
    inlets: { value: "number" },
    outlets: { value: "number" },
    nodes: [
      { id: "first", type: add.id, parameters: { amount: 2 } },
      { id: "second", type: add.id, parameters: { amount: 3 } },
    ],
    connections: [
      { from: "$in.value", to: "first.value" },
      { from: "first.value", to: "second.value" },
      { from: "second.value", to: "$out.value" },
    ],
  });
  const registry = new NodeRegistry([add, group]);
  const instance = createNodeInstance(group, { registry });

  assert.deepEqual(await instance.run({ value: 4 }), { value: 9 });
  assert.equal(instance.graphProgram instanceof Object, true);
  assert.equal("scheduler" in instance.graphProgram, false);
});

test("generic Group compilation rejects invalid topology before constructing child instances", () => {
  const requiredNumber = defineNode({
    id: "test.graph-required-number",
    name: "Required number",
    description: "Requires one numeric input.",
    inlets: { value: { type: "number", required: true } },
    outlets: { value: "number" },
    process: ({ value }) => ({ value }),
  });
  const stringSource = defineNode({
    id: "test.graph-string-source",
    name: "String source",
    description: "Produces text for type-validation coverage.",
    outlets: { value: "string" },
    process: () => ({ value: "text" }),
  });
  const group = defineNodeGroup({
    id: "test.graph-validation",
    name: "Validated graph",
    description: "Uses the generic call-driven compiler contract.",
    inlets: { value: "number" },
    outlets: { value: "number" },
    nodes: [
      { id: "first", type: requiredNumber.id },
      { id: "second", type: requiredNumber.id },
      { id: "text", type: stringSource.id },
    ],
    connections: [
      { from: "$in.value", to: "first.value" },
      { from: "first.value", to: "second.value" },
      { from: "second.value", to: "$out.value" },
    ],
  });
  const registry = new NodeRegistry([requiredNumber, stringSource, group]);
  const withGraph = (connections) => ({
    ...group,
    parts: group.parts.map((part) => part.kind === NODE_PART_KINDS.GRAPH
      ? { ...part, connections }
      : part),
  });

  assert.equal(validateNodeGraphProgramDefinition(group, { registry }), true);
  assert.throws(
    () => validateNodeGraphProgramDefinition(withGraph([
      { from: "first.value", to: "second.value" },
      { from: "second.value", to: "first.value" },
      { from: "second.value", to: "$out.value" },
    ]), { registry }),
    /NODE_GRAPH_CYCLE/,
  );
  assert.throws(
    () => validateNodeGraphProgramDefinition(withGraph([
      { from: "text.value", to: "first.value" },
      { from: "first.value", to: "second.value" },
      { from: "second.value", to: "$out.value" },
    ]), { registry }),
    /NODE_GRAPH_PORT_TYPE_MISMATCH/,
  );
  assert.throws(
    () => validateNodeGraphProgramDefinition(withGraph([
      { from: "first.value", to: "second.value" },
      { from: "second.value", to: "$out.value" },
    ]), { registry }),
    /NODE_GRAPH_INLET_REQUIRED/,
  );
});

test("Group public controls execute through their declared child parameter bindings", async () => {
  const scale = defineNode({
    id: "test.group-control-scale",
    name: "Scale",
    description: "Scales a value by a parameter.",
    inlets: { value: "number" },
    parameters: { factor: { type: "number", defaultValue: 1 } },
    outlets: { value: "number" },
    process: ({ value, factor }) => ({ value: value * factor }),
  });
  const group = defineNodeGroup({
    id: "test.group-control-execution",
    name: "Controlled group",
    description: "Routes a public control into child parameters.",
    inlets: { value: "number" },
    parameters: { amount: { type: "number", defaultValue: 2 } },
    outlets: { value: "number" },
    nodes: [{ id: "scale", type: scale.id, parameters: { factor: 9 } }],
    connections: [
      { from: "$in.value", to: "scale.value" },
      { from: "scale.value", to: "$out.value" },
    ],
    controlBindings: {
      scale: [{ publicParameterId: "amount", targetParameterId: "factor" }],
    },
  });
  const registry = new NodeRegistry([scale, group]);
  const instance = createNodeInstance(group, { registry, parameters: { amount: 3 } });

  assert.deepEqual(await instance.run({ value: 4 }), { value: 12 });
  assert.deepEqual(await instance.run({ value: 4 }, { parameters: { amount: 5 } }), { value: 20 });
});

test("Group inlet literals and public controls execute through the same typed child inlet", async () => {
  const offset = defineNode({
    id: "test.group-inlet-offset",
    name: "Offset",
    description: "Adds a configurable inlet literal.",
    inlets: {
      value: { type: "number", required: true },
      amount: { type: "number", defaultValue: 1 },
    },
    outlets: { value: "number" },
    process: ({ value, amount }) => ({ value: value + amount }),
  });
  const group = defineNodeGroup({
    id: "test.group-inlet-control-execution",
    name: "Inlet-controlled group",
    description: "Routes stored and public values into a child inlet.",
    inlets: { value: "number" },
    parameters: { offset: { type: "number" } },
    outlets: { value: "number" },
    nodes: [{ id: "offset", type: offset.id, parameters: { amount: 2 } }],
    connections: [
      { from: "$in.value", to: "offset.value" },
      { from: "offset.value", to: "$out.value" },
    ],
    controlBindings: {
      offset: [{ publicParameterId: "offset", targetParameterId: "amount" }],
    },
  });
  const registry = new NodeRegistry([offset, group]);
  const instance = createNodeInstance(group, { registry });

  assert.deepEqual(await instance.run({ value: 3 }), { value: 5 });
  assert.deepEqual(
    await instance.run({ value: 3 }, { parameters: { offset: 6 } }),
    { value: 9 },
  );
});

test("smart ports map declared numeric ranges automatically", async () => {
  const target = defineNode({
    id: "test.range-target",
    name: "Range Target",
    description: "Receives normalized values.",
    inlets: { amount: { type: "number", expectedRange: [0, 1], clamp: true } },
    outlets: { amount: "number" },
    process: ({ amount }) => ({ amount }),
  });
  const sourcePort = definePort("level", { type: "number", expectedRange: [10, 20] }, "outlet");
  const instance = new NodeInstance(target, { clock: () => 0 });

  instance.receive("amount", createNodePacket(15, { timestamp: 0, port: sourcePort }));
  const result = await instance.flush(0);
  assert.equal(result.executed, true);
  assert.equal(result.outputs.amount, 0.5);
});

test("smart ports smooth numeric values and coalesce values beyond their rate limit", async () => {
  let executions = 0;
  const target = defineNode({
    id: "test.smart-input",
    name: "Smart Input",
    description: "Smooths and rate-limits its numeric inlet.",
    inlets: {
      amount: {
        type: "number",
        smoothing: { mode: "exponential", timeConstantMs: 100 },
        rate: { maxHz: 30, overflow: "latest" },
      },
    },
    outlets: { amount: "number" },
    process: ({ amount }) => {
      executions++;
      return { amount };
    },
  });
  const instance = new NodeInstance(target, { clock: () => 0 });

  instance.receive("amount", createNodePacket(0, { timestamp: 0 }));
  await instance.flush(0);
  instance.receive("amount", createNodePacket(1, { timestamp: 10 }));
  instance.receive("amount", createNodePacket(0.8, { timestamp: 20 }));
  assert.equal((await instance.flush(20)).executed, false);
  const result = await instance.flush(40);

  assert.equal(executions, 2);
  assert.equal(result.executed, true);
  assert.ok(result.outputs.amount > 0.25 && result.outputs.amount < 0.27);
});

test("record types validate atomic composite node outputs", async () => {
  const registry = createCoreValueTypeRegistry();
  const frameType = recordType("simple-frame", {
    image: "image",
    transform: "transform2d",
    timestamp: numberType(),
  });
  assert.equal(registry.validate(frameType, {
    image: { width: 1, height: 1 },
    transform: { translation: [0, 0] },
    timestamp: 10,
  }), true);
  assert.equal(registry.validate(frameType, {
    image: { width: 1, height: 1 },
    timestamp: 10,
  }), false);
});

test("the first image node owns its resize algorithm and emits an image frame", async () => {
  const instance = new NodeInstance(ImageResizeNode, {
    parameters: { width: 1, height: 1, fit: "stretch" },
  });
  const source = {
    width: 2,
    height: 2,
    channels: 4,
    data: new Uint8ClampedArray([
      0, 0, 0, 255,
      100, 0, 0, 255,
      0, 100, 0, 255,
      100, 100, 0, 255,
    ]),
  };

  const result = await instance.run({ image: source }, { timestamp: 42 });
  assert.equal(result.frame.image.width, 1);
  assert.equal(result.frame.image.height, 1);
  assert.deepEqual(Array.from(result.frame.image.data), [50, 50, 0, 255]);
  assert.equal(result.frame.timestamp, 42);
  assert.equal(ImageResizeNode.parts[0].module.includes("image-engine/image-resize/index.js"), true);
  assert.equal(ImageResizeNode.parts[0].source.includes("function resizeRasterImage"), true);
  assert.equal(ImageResizeNode.execution.workload, "bounded");
  await assert.rejects(
    () => instance.run({ image: source }, { executionClass: "live-frame" }),
    /NODE_EXECUTION_CLASS_MISMATCH:core\.image\.resize:bounded:live-frame/
  );
  const oversized = new NodeInstance(ImageResizeNode, { parameters: { width: 3000, height: 3000, fit: "stretch" } });
  await assert.rejects(() => oversized.run({ image: source }, { executionClass: "bounded" }), /IMAGE_RESIZE_CPU_BUDGET_EXCEEDED/);
});

test("group nodes can execute code-owned relationships without a graph scheduler", async () => {
  const double = defineNode({
    id: "test.double",
    name: "Double",
    description: "Doubles a number.",
    inlets: { value: "number" },
    outlets: { value: "number" },
    process: ({ value }) => ({ value: value * 2 }),
  });
  const offset = defineNode({
    id: "test.offset",
    name: "Offset",
    description: "Offsets a number.",
    inlets: { value: "number" },
    parameters: { amount: { type: "number", defaultValue: 3 } },
    outlets: { value: "number" },
    process: ({ value, amount }) => ({ value: value + amount }),
  });
  const registry = new NodeRegistry([double, offset]);
  const group = defineNodeGroup({
    id: "test.double-and-offset",
    name: "Double and Offset",
    description: "Runs a visible two-node program with hardcoded first-version relationships.",
    inlets: { value: "number" },
    outlets: { value: "number" },
    nodes: [
      { id: "double", type: double.id, version: double.version },
      { id: "offset", type: offset.id, version: offset.version },
    ],
    connections: [{ from: "double.value", to: "offset.value" }],
    program: async ({ value }, { run }) => {
      const doubled = await run("double", { value });
      return run("offset", doubled);
    },
  });
  const instance = createNodeInstance(group, { registry });

  assert.deepEqual(await instance.run({ value: 5 }), { value: 13 });
  assert.equal(group.parts.find((part) => part.kind === "graph").nodes.length, 2);
});

test("artifact metadata keeps control nodes out of the visual component catalog", () => {
  const catalog = new NodeArtifactCatalog([
    defineNodeArtifact({
      id: "artifact.stl-component",
      name: "STL Component",
      artifactType: "visual-component",
      implementation: { nodeType: "mesh.stl-render", nodeVersion: "1.0.0" },
      capabilities: ["canvas-placeable"],
      presentation: { catalogs: ["components", "graph"], placeableOn: ["component-canvas"] },
    }),
    SliderArtifact,
  ]);

  assert.deepEqual(catalog.list({ catalog: "components" }).map((item) => item.id), ["artifact.stl-component"]);
  assert.deepEqual(catalog.list({ placeableOn: "component-canvas" }).map((item) => item.id), ["artifact.stl-component"]);
  assert.deepEqual(catalog.list({ catalog: "controls" }).map((item) => item.id), [SliderArtifact.id]);
});

test("slider is an executable node but is not a visual component", async () => {
  const slider = new NodeInstance(SliderNode, { parameters: { value: 0.625 } });
  assert.deepEqual(await slider.run(), { value: 0.625 });
  assert.equal(SliderNode.parts.some((part) => part.kind === "ui" && part.control === "slider"), true);
  assert.equal(SliderNode.presentation.hiddenFrom.includes("component-canvas"), true);
});

test("visual components expose the generic node meta-model", () => {
  const component = getGeneratorComponent("plasma");
  assert.equal(component.nodeDefinition.id, "vj1.visual.generator.plasma");
  assert.equal(component.nodeDefinition.version, "0.1.0");
  assert.match(component.nodeDefinition.description, /Plasma generator node/);
  assert.equal(component.nodeDefinition.parameters.speed.type.type, "number");
  assert.equal(component.nodeDefinition.outlets.texture.type.type, "texture");
  assert.equal(component.nodeDefinition.presentation.catalogs.includes("graph"), true);
});
