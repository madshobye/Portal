import test from "node:test";
import assert from "node:assert/strict";

import { createProjectGroupDefinitionFromTemplate, defineNode, defineNodeGroup, NodeRegistry } from "../js/libraries/node-engine/index.js";
import {
  ComposableScene3dGroup,
  compileScene3dProgram,
  Material3dNode,
  MeshRenderNode,
  PerspectiveCamera3dNode,
  Scene3dNodeDefinitions,
  Transform3dNode,
} from "../js/libraries/mesh-engine/index.js";
import { compileVisualRenderPlan } from "../js/libraries/composition-engine/index.js";
import { graphNodeFromDefinition, graphWithNodeParameter } from "../js/control/node-graph-canvas.js";
import { withProjectNodeGraph, withProjectNodeParameterExposure, withProjectNodePortExposure } from "../js/control/node-editor-view.js";
import { materializeProjectNodeFork } from "../js/libraries/node-engine/index.js";

function triangleMesh() {
  return {
    positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
    faceNormals: new Float32Array([0, 0, 1]),
    triangleCount: 1,
    bounds: { min: [-1, -1, 0], max: [1, 1, 0] },
    sourceBounds: { min: [-1, -1, 0], max: [1, 1, 0] },
  };
}

test("scene-3d graphs compile mesh material transform camera and mesh-to-image as direct reusable steps", () => {
  const group = defineNodeGroup({
    id: "test.scene-3d.program",
    name: "Composable 3D",
    description: "Combines independently reusable 3D values into one image operation.",
    executionModel: "compiled-graph",
    compiler: { id: "vj1.scene-3d.direct-program", target: "scene-3d" },
    capabilities: ["scene-3d-program"],
    inlets: {
      mesh: { type: "mesh", required: true },
      target: { type: "any", required: true },
      time: { type: "number", defaultValue: 0 },
    },
    outlets: { image: { type: "image", optional: true } },
    publicInlets: {
      mesh: "render.mesh",
      target: "render.target",
      time: "render.componentTime",
    },
    publicOutlets: { image: "render.image" },
    nodes: [
      { id: "transform", type: Transform3dNode.id },
      { id: "material", type: Material3dNode.id, parameters: { renderMode: "surface" } },
      { id: "camera", type: PerspectiveCamera3dNode.id },
      { id: "render", type: MeshRenderNode.id, parameters: { backend: "webgl", renderMode: "surface" } },
      { id: "unused", type: Transform3dNode.id },
    ],
    connections: [
      { from: "transform.transform", to: "render.transform", type: "transform3d" },
      { from: "material.material", to: "render.material", type: "material3d" },
      { from: "camera.camera", to: "render.camera", type: "camera3d" },
    ],
  });
  const registry = new NodeRegistry([
    Transform3dNode,
    Material3dNode,
    PerspectiveCamera3dNode,
    MeshRenderNode,
  ]);
  const program = compileScene3dProgram(group, { registry });
  const target = { clearCalls: 0, clear() { this.clearCalls++; } };
  const result = program.execute({ mesh: triangleMesh(), target, time: 3 });
  const retainedStepOutputs = program.steps.map((step) => step.outputValues);
  const secondResult = program.execute({ mesh: triangleMesh(), target, time: 4 });

  assert.equal(result.image, target);
  assert.strictEqual(secondResult, result);
  assert.deepEqual(program.steps.map((step) => step.outputValues), retainedStepOutputs);
  assert.deepEqual(program.steps.map((step) => step.id), ["transform", "material", "camera", "render"]);
  assert.equal(program.diagnostics.some((item) => item.path.endsWith("/unused")), true);
  assert.equal(program.format, "vj1.scene-3d-program@1");
  assert.equal(target.clearCalls, 2);
  program.dispose();
});

test("scene-3d compilation rejects cycles before entering the render path", () => {
  const Pass = defineNode({
    id: "test.scene-3d.pass",
    name: "3D pass",
    description: "Passes a typed 3D transform through the graph.",
    inlets: { transform: { type: "transform3d", optional: true } },
    outlets: { transform: { type: "transform3d" } },
    process: ({ transform }) => ({ transform }),
  });
  const group = {
    id: "test.scene-3d.cycle",
    compiler: { id: "vj1.scene-3d.direct-program", target: "scene-3d" },
    capabilities: ["scene-3d-program"],
    nodes: [
      { id: "a", type: Pass.id },
      { id: "b", type: Pass.id },
    ],
    connections: [
      { from: "a.transform", to: "b.transform" },
      { from: "b.transform", to: "a.transform" },
      { from: "a.transform", to: "$out.transform" },
    ],
    outlets: { transform: { type: "transform3d" } },
  };
  const registry = new NodeRegistry([Pass]);
  assert.throws(() => compileScene3dProgram(group, { registry }), /SCENE_3D_GRAPH_CYCLE/);
});

test("scene-3d compilation enforces typed ports at the authoring boundary", () => {
  const group = {
    id: "test.scene-3d.types",
    compiler: { id: "vj1.scene-3d.direct-program", target: "scene-3d" },
    capabilities: ["scene-3d-program"],
    nodes: [
      { id: "transform", type: Transform3dNode.id },
      { id: "camera", type: PerspectiveCamera3dNode.id },
    ],
    connections: [
      { from: "transform.transform", to: "camera.position" },
      { from: "camera.camera", to: "$out.camera" },
    ],
    outlets: { camera: { type: "camera3d" } },
  };
  const registry = new NodeRegistry([Transform3dNode, PerspectiveCamera3dNode]);
  assert.throws(() => compileScene3dProgram(group, { registry }), /SCENE_3D_PORT_TYPE_MISMATCH/);
});

test("expandable multi-object 3D groups lower into production visual source operations", () => {
  const sceneNode = graphNodeFromDefinition(ComposableScene3dGroup, {
    id: "scene3d",
    visualProgram: true,
  });
  sceneNode.parameters.meshAId = "mesh-a";
  sceneNode.parameters.meshBId = "mesh-b";
  sceneNode.configuration.source.params.meshAId = "mesh-a";
  sceneNode.configuration.source.params.meshBId = "mesh-b";
  const plan = compileVisualRenderPlan({
    id: "vj1.component.composable-3d",
    nodes: [sceneNode],
    connections: [
      { from: "scene3d.texture", to: "$out.texture", type: "texture" },
    ],
  }, {}, {
    resolveDefinition: (node) => node.nodeId === ComposableScene3dGroup.id
      ? ComposableScene3dGroup
      : null,
  });

  const operation = plan.operations[0];
  assert.equal(operation.backend, "scene-3d-program");
  assert.equal(operation.renderer, "output/specialized:scene3d-program");
  assert.equal(operation.scene3dProgram.format, "vj1.scene-3d-program@1");
  assert.deepEqual(operation.scene3dProgram.steps.map((step) => step.id), [
    "mesh-a",
    "mesh-b",
    "transform-a",
    "transform-b",
    "material-a",
    "material-b",
    "camera",
    "object-a",
    "object-b",
    "objects",
    "scene",
    "render",
  ]);
  assert.deepEqual(operation.scene3dProgram.publicInputs, [
    { id: "meshAId", type: "string", required: true },
    { id: "meshBId", type: "string", required: true },
    { id: "target", type: "any", required: true },
    { id: "componentTime", type: "number", required: false },
    { id: "viewport", type: "viewport", required: false },
    { id: "contentTransform", type: "transform2d", required: false },
  ]);
  assert.deepEqual(operation.scene3dProgram.resourceBindings, [
    {
      nodeId: "mesh-a",
      kind: "media",
      valueType: "mesh",
      parameterId: "mediaId",
      publicInputId: "meshAId",
      staticId: "",
      required: true,
    },
    {
      nodeId: "mesh-b",
      kind: "media",
      valueType: "mesh",
      parameterId: "mediaId",
      publicInputId: "meshBId",
      staticId: "",
      required: true,
    },
  ]);
  assert.equal(operation.configuration.source.params.meshAId, "mesh-a");
  assert.equal(operation.configuration.source.params.meshBId, "mesh-b");
  const inspection = plan.inspect();
  assert.deepEqual(inspection.mediaDemand.ids, ["mesh-a", "mesh-b"]);
  assert.deepEqual(
    inspection.references.filter((reference) => reference.kind === "media-mesh").map((reference) => reference.id),
    ["mesh-a", "mesh-b"],
  );
});

test("authored child values persist through project forks into the compiled retained 3D program", () => {
  const graph = ComposableScene3dGroup.parts.find((part) => part.kind === "graph");
  const editedGraph = graphWithNodeParameter(graph, "material-a", "renderMode", "points");
  const projectNodes = withProjectNodeGraph({}, ComposableScene3dGroup, editedGraph);
  const fork = projectNodes.forks.find((item) => item.base.id === ComposableScene3dGroup.id);
  const definition = materializeProjectNodeFork(ComposableScene3dGroup, fork);
  const program = compileScene3dProgram(definition, {
    registry: new NodeRegistry(Scene3dNodeDefinitions),
  });

  assert.equal(definition.implementation.executionModel, "compiled-graph");
  assert.equal(definition.compiler.id, "vj1.scene-3d.direct-program");
  assert.equal(definition.capabilities.includes("scene-3d-program"), true);
  assert.equal(program.steps.find((step) => step.id === "material-a").parameters.renderMode, "points");
  assert.equal(program.format, "vj1.scene-3d-program@1");
});

test("a new project-owned 3D Group compiles through the same retained Scene program", () => {
  const definition = createProjectGroupDefinitionFromTemplate(ComposableScene3dGroup, {
    id: "org.vj1.project.scene3d-fixture",
    name: "Project Scene3D Fixture",
  });
  const program = compileScene3dProgram(definition, {
    registry: new NodeRegistry(Scene3dNodeDefinitions),
  });

  assert.equal(definition.persistence, "project");
  assert.equal(definition.compiler.id, "vj1.scene-3d.direct-program");
  assert.equal(definition.metadata.visualCompilerHook.id, "vj1.visual.scene-3d-program");
  assert.deepEqual(program.steps.map((step) => step.id), [
    "mesh-a",
    "mesh-b",
    "transform-a",
    "transform-b",
    "material-a",
    "material-b",
    "camera",
    "object-a",
    "object-b",
    "objects",
    "scene",
    "render",
  ]);
});

test("project 3D public controls lower into direct retained-step inputs", () => {
  const base = createProjectGroupDefinitionFromTemplate(ComposableScene3dGroup, {
    id: "org.vj1.project.scene3d-public-control",
    name: "Project Scene3D Public Control",
  });
  const nodes = withProjectNodeParameterExposure({}, base, {
    nodeId: "material-a",
    parameterId: "renderMode",
    publicParameterId: "material-mode",
    parameter: Material3dNode.parameters.renderMode,
    sectionLabel: Material3dNode.name,
    exposed: true,
  });
  const definition = materializeProjectNodeFork(base, nodes.forks[0]);
  const program = compileScene3dProgram(definition, {
    registry: new NodeRegistry(Scene3dNodeDefinitions),
  });
  const material = program.steps.find((step) => step.id === "material-a");

  assert.equal(program.publicInputs.some((input) =>
    input.id === "material-mode" && input.type === "enum"), true);
  assert.equal(material.inputs.some((input) =>
    input.sourceNodeId === "$in" &&
    input.sourcePortId === "material-mode" &&
    input.targetPortId === "renderMode"), true);
});

test("project Groups publish typed child ports into the compiled Scene interface", () => {
  const base = createProjectGroupDefinitionFromTemplate(ComposableScene3dGroup, {
    id: "org.vj1.project.scene3d-public-port",
    name: "Project Scene3D Public Port",
  });
  const nodes = withProjectNodePortExposure({}, base, {
    nodeId: "camera",
    portId: "camera",
    publicPortId: "cameraOut",
    port: PerspectiveCamera3dNode.outlets.camera,
    direction: "outlet",
    exposed: true,
  });
  const definition = materializeProjectNodeFork(base, nodes.forks[0]);
  const graph = definition.parts.find((part) => part.kind === "graph");
  const program = compileScene3dProgram(definition, {
    registry: new NodeRegistry(Scene3dNodeDefinitions),
  });

  assert.equal(definition.outlets.cameraOut.type.type, "camera3d");
  assert.equal(graph.publicOutlets.cameraOut, "camera.camera");
  assert.equal(program.publicOutputs.some((output) =>
    output.publicId === "cameraOut" &&
    output.sourceNodeId === "camera" &&
    output.sourcePortId === "camera"), true);
});
