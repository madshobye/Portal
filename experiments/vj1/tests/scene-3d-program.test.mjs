import test from "node:test";
import assert from "node:assert/strict";

import { createProjectGroupDefinitionFromTemplate, defineNode, defineNodeGroup, NodeRegistry } from "../js/libraries/node-engine/index.js";
import {
  CombineObjects3dNode,
  CombineMaterialBindings3dNode,
  ComposableScene3dGroup,
  compileScene3dProgram,
  MaterialBinding3dNode,
  Material3dNode,
  MeshRenderNode,
  MeshCollectionObjects3dNode,
  PerspectiveCamera3dNode,
  Scene3dNode,
  Scene3dNodeDefinitions,
  SceneObject3dNode,
  SceneToImageNode,
  Transform3dNode,
} from "../js/libraries/mesh-engine/index.js";
import {
  AnatomyGeometryProviderNode,
  LitMeshMaterialProviderNode,
  ModelFitCameraNode,
  PlanarGridGeometryProviderNode,
  TerrainBiomeMaterialProviderNode,
  TerrainFlightCameraProviderNode,
  TerrainHeightFieldGeometryProviderNode,
} from "../js/libraries/visual-nodes/index.js";
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

test("one Planar Grid node feeds both specialized geometry and an ordinary Scene-to-image graph", () => {
  const group = defineNodeGroup({
    id: "test.scene-3d.planar-grid",
    name: "Planar Scene",
    description: "Uses the dual-output Terrain provider as an ordinary canonical mesh source.",
    executionModel: "compiled-graph",
    compiler: { id: "vj1.scene-3d.direct-program", target: "scene-3d" },
    capabilities: ["scene-3d-program"],
    inlets: { target: { type: "any", required: true } },
    outlets: { texture: { type: "texture" } },
    publicInlets: { target: "render.target" },
    publicOutlets: { texture: "render.texture" },
    nodes: [
      {
        id: "grid",
        type: PlanarGridGeometryProviderNode.id,
        parameters: { columns: 3, rows: 2, width: 4, depth: 2, axis: "xz" },
      },
      { id: "transform", type: Transform3dNode.id },
      {
        id: "material",
        type: LitMeshMaterialProviderNode.id,
        parameters: {
          surfaceColor: "#6688aaff",
          renderMode: "surfaceWire",
          wireColor: "#101820cc",
        },
      },
      { id: "object", type: SceneObject3dNode.id, parameters: { id: "grid" } },
      { id: "objects", type: CombineObjects3dNode.id },
      { id: "camera", type: PerspectiveCamera3dNode.id },
      { id: "scene", type: Scene3dNode.id },
      { id: "render", type: SceneToImageNode.id },
    ],
    connections: [
      { from: "grid.mesh", to: "object.mesh", type: "mesh" },
      { from: "transform.transform", to: "object.transform", type: "transform3d" },
      { from: "material.sceneMaterial", to: "object.material", type: "material3d" },
      { from: "object.object", to: "objects.a", type: "object3d" },
      { from: "objects.objects", to: "scene.objects", type: "list<object3d>" },
      { from: "camera.camera", to: "scene.camera", type: "camera3d" },
      { from: "scene.scene", to: "render.scene", type: "scene3d" },
    ],
  });
  const registry = new NodeRegistry([
    ...Scene3dNodeDefinitions,
    LitMeshMaterialProviderNode,
    PlanarGridGeometryProviderNode,
  ]);
  const program = compileScene3dProgram(group, { registry });
  const target = { clearCalls: 0, clear() { this.clearCalls += 1; } };
  const result = program.execute({ target });
  const gridOutput = program.outputs.get("grid");
  const materialOutput = program.outputs.get("material");
  const scene = program.outputs.get("scene").scene;

  assert.strictEqual(result.texture, target);
  assert.strictEqual(scene.objects[0].mesh, gridOutput.mesh);
  assert.strictEqual(scene.objects[0].material, materialOutput.sceneMaterial);
  assert.strictEqual(materialOutput.material.sceneMaterial, materialOutput.sceneMaterial);
  assert.equal(materialOutput.material.providerId, "lit-mesh");
  assert.equal(materialOutput.sceneMaterial.renderMode, "surfaceWire");
  assert.strictEqual(gridOutput.geometry.mesh, gridOutput.mesh);
  assert.equal(gridOutput.geometry.providerId, "planar-grid");
  assert.equal(gridOutput.mesh.triangleCount, 12);
  assert.equal(target.clearCalls, 1);
  program.dispose();
});

test("Terrain height-field topology and biome material compose through the ordinary Scene-to-image graph", () => {
  const group = defineNodeGroup({
    id: "test.scene-3d.terrain-values",
    name: "Terrain Values Scene",
    description: "Composes Terrain's reusable topology and material values without invoking its native renderer.",
    executionModel: "compiled-graph",
    compiler: { id: "vj1.scene-3d.direct-program", target: "scene-3d" },
    capabilities: ["scene-3d-program"],
    inlets: { target: { type: "any", required: true } },
    outlets: { texture: { type: "texture" } },
    publicInlets: { target: "render.target" },
    publicOutlets: { texture: "render.texture" },
    nodes: [
      {
        id: "terrain",
        type: TerrainHeightFieldGeometryProviderNode.id,
        parameters: { gridWidth: 12, gridDepth: 8, gridDensity: 1.5, mountainHeight: 3 },
      },
      {
        id: "material",
        type: TerrainBiomeMaterialProviderNode.id,
        parameters: {
          waterColor: "#123456ff",
          grassColor: "#228844ff",
          rockColor: "#554433ff",
          snowColor: "#eeeeffff",
          lakeLevel: -0.2,
        },
      },
      { id: "transform", type: Transform3dNode.id },
      { id: "object", type: SceneObject3dNode.id, parameters: { id: "terrain" } },
      { id: "objects", type: CombineObjects3dNode.id },
      {
        id: "camera",
        type: TerrainFlightCameraProviderNode.id,
        parameters: { pitch: 0.35, fieldOfView: 68, nearClip: 0.2, farClip: 5000, lookAhead: 18 },
      },
      { id: "scene", type: Scene3dNode.id },
      { id: "render", type: SceneToImageNode.id },
    ],
    connections: [
      { from: "terrain.mesh", to: "object.mesh", type: "mesh" },
      { from: "transform.transform", to: "object.transform", type: "transform3d" },
      { from: "material.sceneMaterial", to: "object.material", type: "material3d" },
      { from: "object.object", to: "objects.a", type: "object3d" },
      { from: "objects.objects", to: "scene.objects", type: "list<object3d>" },
      { from: "camera.sceneCamera", to: "scene.camera", type: "camera3d" },
      { from: "scene.scene", to: "render.scene", type: "scene3d" },
    ],
  });
  const registry = new NodeRegistry([
    ...Scene3dNodeDefinitions,
    TerrainHeightFieldGeometryProviderNode,
    TerrainBiomeMaterialProviderNode,
    TerrainFlightCameraProviderNode,
  ]);
  const program = compileScene3dProgram(group, { registry });
  const target = { clearCalls: 0, clear() { this.clearCalls += 1; } };
  const result = program.execute({ target });
  const terrain = program.outputs.get("terrain");
  const material = program.outputs.get("material");
  const camera = program.outputs.get("camera");
  const scene = program.outputs.get("scene").scene;

  assert.strictEqual(result.texture, target);
  assert.equal(terrain.mesh.kind, "mesh");
  assert.equal(terrain.heightField.kind, "terrain-height-field");
  assert.strictEqual(terrain.heightField.mesh, terrain.mesh);
  assert.strictEqual(scene.objects[0].mesh, terrain.mesh);
  assert.strictEqual(scene.objects[0].material, material.sceneMaterial);
  assert.strictEqual(scene.camera, camera.sceneCamera);
  assert.equal(material.sceneMaterial.kind, "material3d");
  assert.match(material.sceneMaterial.shader.source, /vj1Surface/);
  assert.equal(camera.camera.providerId, "terrain-flight-camera");
  assert.equal(camera.sceneCamera.fieldOfView, 68 * Math.PI / 180);
  assert.equal(target.clearCalls, 1);
  program.dispose();
});

test("compiled Scene graphs expand canonical multipart meshes through material slots", () => {
  const group = defineNodeGroup({
    id: "test.scene-3d.mesh-collection",
    name: "Multipart Scene",
    description: "Expands a canonical mesh collection without a collection-specific renderer.",
    executionModel: "compiled-graph",
    compiler: { id: "vj1.scene-3d.direct-program", target: "scene-3d" },
    capabilities: ["scene-3d-program"],
    inlets: {
      target: { type: "any", required: true },
    },
    outlets: { texture: { type: "texture" } },
    publicInlets: {
      target: "render.target",
    },
    publicOutlets: { texture: "render.texture" },
    nodes: [
      {
        id: "geometry",
        type: AnatomyGeometryProviderNode.id,
        parameters: { part: "heart", detail: 6, depth: 1 },
      },
      {
        id: "material",
        type: LitMeshMaterialProviderNode.id,
        parameters: { surfaceColor: "#c07050ff" },
      },
      {
        id: "binding",
        type: MaterialBinding3dNode.id,
        parameters: { slot: "surface" },
      },
      { id: "bindings", type: CombineMaterialBindings3dNode.id },
      { id: "objects", type: MeshCollectionObjects3dNode.id },
      { id: "camera", type: PerspectiveCamera3dNode.id },
      { id: "scene", type: Scene3dNode.id },
      { id: "render", type: SceneToImageNode.id },
    ],
    connections: [
      { from: "geometry.collection", to: "objects.collection", type: "mesh-collection" },
      { from: "material.sceneMaterial", to: "binding.material", type: "material3d" },
      { from: "binding.binding", to: "bindings.a", type: "material-binding3d" },
      { from: "bindings.bindings", to: "objects.materialBindings", type: "list<material-binding3d>" },
      { from: "objects.objects", to: "scene.objects", type: "list<object3d>" },
      { from: "camera.camera", to: "scene.camera", type: "camera3d" },
      { from: "scene.scene", to: "render.scene", type: "scene3d" },
    ],
  });
  const registry = new NodeRegistry([
    ...Scene3dNodeDefinitions,
    AnatomyGeometryProviderNode,
    LitMeshMaterialProviderNode,
  ]);
  const program = compileScene3dProgram(group, { registry });
  const target = { clearCalls: 0, clear() { this.clearCalls += 1; } };
  const result = program.execute({ target });
  const objects = program.outputs.get("objects").objects;
  const material = program.outputs.get("material").sceneMaterial;
  const collection = program.outputs.get("geometry").collection;

  assert.strictEqual(result.texture, target);
  assert.equal(collection.id, "anatomy-heart");
  assert.equal(objects.length, collection.parts.length);
  assert.strictEqual(objects.find((object) =>
    object.metadata.materialSlot === "surface"
  ).material, material);
  assert.equal(program.outputs.get("scene").scene.objects.length, collection.parts.length);
  assert.equal(target.clearCalls, 1);
  program.dispose();
});

test("compiled Scene graphs consume the canonical Anatomy Hand collection without a hand renderer", () => {
  const group = defineNodeGroup({
    id: "test.scene-3d.anatomy-hand-collection",
    name: "Hand Scene",
    description: "Compiles reusable Hand parts through ordinary collection and Scene nodes.",
    executionModel: "compiled-graph",
    compiler: { id: "vj1.scene-3d.direct-program", target: "scene-3d" },
    capabilities: ["scene-3d-program"],
    inlets: { target: { type: "any", required: true } },
    outlets: { texture: { type: "texture" } },
    publicInlets: { target: "render.target" },
    publicOutlets: { texture: "render.texture" },
    nodes: [
      {
        id: "geometry",
        type: AnatomyGeometryProviderNode.id,
        parameters: { part: "hand", detail: 7, depth: 1.2, fingerBend: 0.6 },
      },
      { id: "objects", type: MeshCollectionObjects3dNode.id },
      { id: "camera", type: PerspectiveCamera3dNode.id },
      { id: "scene", type: Scene3dNode.id },
      { id: "render", type: SceneToImageNode.id },
    ],
    connections: [
      { from: "geometry.collection", to: "objects.collection", type: "mesh-collection" },
      { from: "objects.objects", to: "scene.objects", type: "list<object3d>" },
      { from: "camera.camera", to: "scene.camera", type: "camera3d" },
      { from: "scene.scene", to: "render.scene", type: "scene3d" },
    ],
  });
  const registry = new NodeRegistry([
    ...Scene3dNodeDefinitions,
    AnatomyGeometryProviderNode,
  ]);
  const program = compileScene3dProgram(group, { registry });
  const target = { clearCalls: 0, clear() { this.clearCalls += 1; } };
  const result = program.execute({ target });
  const collection = program.outputs.get("geometry").collection;
  const objects = program.outputs.get("objects").objects;

  assert.strictEqual(result.texture, target);
  assert.equal(collection.id, "anatomy-hand");
  assert.equal(collection.metadata.fingerBend, 0.6);
  assert.equal(objects.length, 7);
  assert.deepEqual(
    objects.map((object) => object.id),
    collection.parts.map((part) => `${collection.id}/${part.id}`),
  );
  assert.equal(target.clearCalls, 1, "the existing Scene renderer clears once for every Hand part");
  program.dispose();
});

test("compiled Scene graphs compose canonical Anatomy Body parts through one existing renderer", () => {
  const group = defineNodeGroup({
    id: "test.scene-3d.anatomy-body-collection",
    name: "Body Scene",
    description: "Compiles head torso and limb meshes as ordinary Scene objects.",
    executionModel: "compiled-graph",
    compiler: { id: "vj1.scene-3d.direct-program", target: "scene-3d" },
    capabilities: ["scene-3d-program"],
    inlets: { target: { type: "any", required: true } },
    outlets: { texture: { type: "texture" } },
    publicInlets: { target: "render.target" },
    publicOutlets: { texture: "render.texture" },
    nodes: [
      {
        id: "geometry",
        type: AnatomyGeometryProviderNode.id,
        parameters: { part: "body", detail: 6, depth: 1.1, limbBend: -0.3 },
      },
      { id: "objects", type: MeshCollectionObjects3dNode.id },
      { id: "camera", type: ModelFitCameraNode.id, parameters: { fieldOfView: 0.9 } },
      { id: "scene", type: Scene3dNode.id },
      { id: "render", type: SceneToImageNode.id },
    ],
    connections: [
      { from: "geometry.collection", to: "objects.collection", type: "mesh-collection" },
      { from: "objects.objects", to: "scene.objects", type: "list<object3d>" },
      { from: "camera.camera", to: "scene.camera", type: "camera3d" },
      { from: "scene.scene", to: "render.scene", type: "scene3d" },
    ],
  });
  const program = compileScene3dProgram(group, {
    registry: new NodeRegistry([...Scene3dNodeDefinitions, AnatomyGeometryProviderNode, ModelFitCameraNode]),
  });
  const target = { clearCalls: 0, clear() { this.clearCalls += 1; } };
  const result = program.execute({ target });
  const collection = program.outputs.get("geometry").collection;
  const objects = program.outputs.get("objects").objects;

  assert.strictEqual(result.texture, target);
  assert.equal(collection.id, "anatomy-body");
  assert.equal(collection.metadata.limbBend, -0.3);
  assert.deepEqual(collection.parts.map((part) => part.id), [
    "head", "neck", "torso", "left-arm", "right-arm", "left-leg", "right-leg",
  ]);
  assert.equal(objects.length, 7);
  assert.equal(program.outputs.get("camera").camera.fieldOfView, 0.9);
  assert.equal(target.clearCalls, 1,
    "all independently reusable Body parts share the existing retained Scene target");
  program.dispose();
});

test("every Anatomy geometry choice is a canonical collection consumable by the ordinary Scene compiler", () => {
  const fixtures = [
    ["face", { expression: 0.2, mouthOpen: 0.4, brow: -0.3, eyeSquint: 0.6 }],
    ["body", { limbBend: 0.2 }],
    ["hand", { fingerBend: 0.5 }],
    ["arm", { limbBend: -0.2 }],
    ["leg", { limbBend: 0.4 }],
    ["heart", {}],
  ];
  for (const [part, parameters] of fixtures) {
    const group = defineNodeGroup({
      id: `test.scene-3d.anatomy-${part}-complete`,
      name: `${part} Scene`,
      description: "Proves every Anatomy selection through the same canonical Scene contract.",
      executionModel: "compiled-graph",
      compiler: { id: "vj1.scene-3d.direct-program", target: "scene-3d" },
      capabilities: ["scene-3d-program"],
      inlets: { target: { type: "any", required: true } },
      outlets: { texture: { type: "texture" } },
      publicInlets: { target: "render.target" },
      publicOutlets: { texture: "render.texture" },
      nodes: [
        {
          id: "geometry",
          type: AnatomyGeometryProviderNode.id,
          parameters: { part, detail: 5, depth: 1, ...parameters },
        },
        { id: "objects", type: MeshCollectionObjects3dNode.id },
        { id: "camera", type: PerspectiveCamera3dNode.id },
        { id: "scene", type: Scene3dNode.id },
        { id: "render", type: SceneToImageNode.id },
      ],
      connections: [
        { from: "geometry.collection", to: "objects.collection", type: "mesh-collection" },
        { from: "objects.objects", to: "scene.objects", type: "list<object3d>" },
        { from: "camera.camera", to: "scene.camera", type: "camera3d" },
        { from: "scene.scene", to: "render.scene", type: "scene3d" },
      ],
    });
    const program = compileScene3dProgram(group, {
      registry: new NodeRegistry([...Scene3dNodeDefinitions, AnatomyGeometryProviderNode]),
    });
    const target = { clearCalls: 0, clear() { this.clearCalls += 1; } };
    const result = program.execute({ target });
    const collection = program.outputs.get("geometry").collection;

    assert.strictEqual(result.texture, target, part);
    assert.equal(collection.id, `anatomy-${part}`, part);
    assert.equal(program.outputs.get("objects").objects.length, collection.parts.length, part);
    assert.equal(target.clearCalls, 1, part);
    program.dispose();
  }
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

test("project 3D public controls can expose authored material inlets", () => {
  const base = createProjectGroupDefinitionFromTemplate(ComposableScene3dGroup, {
    id: "org.vj1.project.scene3d-public-material-color",
    name: "Project Scene3D Public Material Color",
  });
  const nodes = withProjectNodeParameterExposure({}, base, {
    nodeId: "material-a",
    parameterId: "surfaceColor",
    publicParameterId: "surface-color",
    parameter: Material3dNode.inlets.surfaceColor,
    sectionLabel: Material3dNode.name,
    exposed: true,
  });
  const definition = materializeProjectNodeFork(base, nodes.forks[0]);
  const program = compileScene3dProgram(definition, {
    registry: new NodeRegistry(Scene3dNodeDefinitions),
  });
  const material = program.steps.find((step) => step.id === "material-a");

  assert.equal(program.publicInputs.some((input) =>
    input.id === "surface-color" && input.type === "color"), true);
  assert.equal(material.inputs.some((input) =>
    input.sourceNodeId === "$in" &&
    input.sourcePortId === "surface-color" &&
    input.targetPortId === "surfaceColor"), true);

  const mesh = triangleMesh();
  const target = { clear() {} };
  program.execute({
    meshAId: "media/a.stl",
    meshBId: "media/b.stl",
    target,
  }, {
    resolveMesh: () => mesh,
  });
  assert.deepEqual(
    program.outputs.get("material-a").material.surfaceColor,
    [220, 225, 220, 255],
    "an omitted public value resolves through the compiled Group default",
  );

  program.execute({
    meshAId: "media/a.stl",
    meshBId: "media/b.stl",
    target,
    "surface-color": "#123456cc",
  }, {
    resolveMesh: () => mesh,
  });
  assert.deepEqual(
    program.outputs.get("material-a").material.surfaceColor,
    [18, 52, 86, 204],
    "a supplied public value overrides the child inlet literal without changing graph topology",
  );
  program.dispose();
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
