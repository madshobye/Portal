import test from "node:test";
import assert from "node:assert/strict";

import { compileVisualRenderPlan } from "../js/libraries/composition-engine/index.js";
import {
  createProjectVisualGroupDefinition,
  materializeProjectNodeFork,
  NodeRegistry,
} from "../js/libraries/node-engine/index.js";
import { RenderDemandNode } from "../js/libraries/render-engine/index.js";
import { TerrainFlightControllerNode } from "../js/libraries/terrain-engine/index.js";
import {
  FeatureMorphToImageNode,
  MediaImageResourceNode,
  MeshPatternFillMaterialProviderNode,
  MeshPatternFillToImageNode,
  MeshPatternTopologyProviderNode,
  MeshPatternWireMaterialProviderNode,
  MeshPatternWireToImageNode,
  SuperPointMorphAnalysisNode,
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
  graphNodeFromDefinition,
  nodeDefinitionPlaceableInGraph,
} from "../js/control/node-graph-canvas.js";
import {
  withProjectNodeGraph,
  withProjectNodeParameterExposure,
} from "../js/control/node-editor-view.js";
import { TerrainRenderRuntime } from "../js/output/specialized/terrain-render-runtime.js";
import { ProjectMediaResourceNode } from "../js/libraries/visual-nodes/providers/project-media-resource/index.js";
import { MediaResourceToImageNode } from "../js/libraries/visual-nodes/renderers/media-resource-to-image/index.js";

function compileAuthoredVisualGroup({
  id,
  definitions,
  nodes,
  connections,
}) {
  const serialized = createProjectVisualGroupDefinition({
    id,
    name: id.split(".").at(-1),
  });
  const registry = new NodeRegistry([
    ...definitions,
    serialized,
  ]);
  const base = registry.get(serialized.id);
  const project = withProjectNodeGraph({}, base, {
    ...base.parts.find((part) => part.kind === "graph"),
    nodes,
    connections,
  });
  const group = materializeProjectNodeFork(base, project.forks[0]);
  const outer = graphNodeFromDefinition(group, {
    id: "compound",
    visualProgram: true,
  });
  const plan = compileVisualRenderPlan({
    id: `${id}.plan`,
    nodes: [outer],
    connections: [{
      from: "compound.texture",
      to: "$out.texture",
      type: "texture",
    }],
  }, {}, {
    resolveDefinition: (node) =>
      node.nodeId === group.id
        ? group
        : registry.get(node.nodeId),
  });
  return { plan, operation: plan.operations[0] };
}

test("an authored Text graph compiles retained demand and mask values into the native terminal kernel", () => {
  const demand = graphNodeFromDefinition(RenderDemandNode, {
    id: "demand",
    visualProgram: true,
  });
  const mask = graphNodeFromDefinition(TextMaskProviderNode, {
    id: "mask",
    visualProgram: true,
  });
  const render = graphNodeFromDefinition(TextMaskToImageNode, {
    id: "render",
    visualProgram: true,
  });
  const { plan, operation } = compileAuthoredVisualGroup({
    id: "org.vj1.test.authored-text",
    definitions: [
      RenderDemandNode,
      TextMaskProviderNode,
      TextMaskToImageNode,
    ],
    nodes: [demand, mask, render],
    connections: [
      { from: "demand.domainWidth", to: "mask.width", type: "number" },
      { from: "demand.domainHeight", to: "mask.height", type: "number" },
      { from: "mask.mask", to: "render.mask", type: "text-mask-provider" },
      { from: "render.texture", to: "$out.texture", type: "texture" },
    ],
  });

  assert.equal(operation.backend, "compiled-visual-group");
  assert.deepEqual(
    operation.valueProgram.steps.map((step) => step.instanceId),
    ["demand", "mask"],
  );
  assert.equal(operation.operations[0].renderer, "output/specialized:text");
  assert.equal(operation.valueProgram.inspect().bindings[0].targetOperationId, "render");
  plan.dispose();
});

test("compiled media renderer operations retain immutable media dependencies for cache invalidation", () => {
  const media = graphNodeFromDefinition(ProjectMediaResourceNode, {
    id: "media",
    visualProgram: true,
  });
  const render = graphNodeFromDefinition(MediaResourceToImageNode, {
    id: "render",
    visualProgram: true,
  });
  const serialized = createProjectVisualGroupDefinition({
    id: "org.vj1.test.authored-project-media",
    name: "Authored Project Media",
  });
  const registry = new NodeRegistry([
    ProjectMediaResourceNode,
    MediaResourceToImageNode,
    serialized,
  ]);
  const base = registry.get(serialized.id);
  let nodes = withProjectNodeGraph({}, base, {
    ...base.parts.find((part) => part.kind === "graph"),
    nodes: [media, render],
    connections: [
      {
        from: "media.resource",
        to: "render.resource",
        type: "drawable-media-resource",
      },
      { from: "render.texture", to: "$out.texture", type: "texture" },
    ],
  });
  nodes = withProjectNodeParameterExposure(nodes, base, {
    nodeId: "media",
    parameterId: "mediaId",
    publicParameterId: "mediaId",
    parameter: {
      ...ProjectMediaResourceNode.parameters.mediaId,
      defaultValue: "media/texture.png",
    },
    sectionLabel: "Project media",
    exposed: true,
  });
  const group = materializeProjectNodeFork(base, nodes.forks[0]);
  const outer = graphNodeFromDefinition(group, {
    id: "compound",
    visualProgram: true,
  });
  const plan = compileVisualRenderPlan({
    id: "org.vj1.test.authored-project-media.plan",
    nodes: [outer],
    connections: [{
      from: "compound.texture",
      to: "$out.texture",
      type: "texture",
    }],
  }, {}, {
    resolveDefinition: (node) =>
      node.nodeId === group.id
        ? group
        : registry.get(node.nodeId),
  });
  const operation = plan.operations[0];

  assert.deepEqual(operation.operations[0].mediaDependencies, [
    "media/texture.png",
  ]);
  assert.deepEqual(plan.inspect().mediaDemand.ids, [
    "media/texture.png",
  ]);
  plan.dispose();
});

test("an authored Feature Morph graph compiles reusable image and analysis values into its retained kernel", () => {
  const imageA = graphNodeFromDefinition(MediaImageResourceNode, {
    id: "image-a",
    visualProgram: true,
  });
  const imageB = graphNodeFromDefinition(MediaImageResourceNode, {
    id: "image-b",
    visualProgram: true,
  });
  const analysis = graphNodeFromDefinition(SuperPointMorphAnalysisNode, {
    id: "analysis",
    visualProgram: true,
  });
  const render = graphNodeFromDefinition(FeatureMorphToImageNode, {
    id: "render",
    visualProgram: true,
  });
  const { plan, operation } = compileAuthoredVisualGroup({
    id: "org.vj1.test.authored-feature-morph",
    definitions: [
      MediaImageResourceNode,
      SuperPointMorphAnalysisNode,
      FeatureMorphToImageNode,
    ],
    nodes: [imageA, imageB, analysis, render],
    connections: [
      { from: "image-a.image", to: "analysis.imageA", type: "media-image-resource" },
      { from: "image-b.image", to: "analysis.imageB", type: "media-image-resource" },
      { from: "image-a.image", to: "render.imageA", type: "media-image-resource" },
      { from: "image-b.image", to: "render.imageB", type: "media-image-resource" },
      { from: "analysis.analysis", to: "render.analysis", type: "feature-morph-analysis" },
      { from: "render.texture", to: "$out.texture", type: "texture" },
    ],
  });

  assert.equal(operation.backend, "compiled-visual-group");
  assert.deepEqual(
    operation.valueProgram.steps.map((step) => step.instanceId),
    ["image-a", "image-b", "analysis"],
  );
  assert.equal(
    operation.operations[0].renderer,
    "output/specialized:featureMorph",
  );
  assert.deepEqual(
    operation.valueProgram.inspect().bindings.map((binding) => binding.targetOperationId),
    ["render", "render", "render"],
  );
  plan.dispose();
});

test("an authored Mesh Pattern graph compiles topology and materials into chained retained passes", () => {
  const topology = graphNodeFromDefinition(MeshPatternTopologyProviderNode, {
    id: "topology",
    visualProgram: true,
  });
  const fillMaterial = graphNodeFromDefinition(MeshPatternFillMaterialProviderNode, {
    id: "fill-material",
    visualProgram: true,
  });
  const wireMaterial = graphNodeFromDefinition(MeshPatternWireMaterialProviderNode, {
    id: "wire-material",
    visualProgram: true,
  });
  const fill = graphNodeFromDefinition(MeshPatternFillToImageNode, {
    id: "fill",
    visualProgram: true,
  });
  const wire = graphNodeFromDefinition(MeshPatternWireToImageNode, {
    id: "wire",
    visualProgram: true,
  });
  const { plan, operation } = compileAuthoredVisualGroup({
    id: "org.vj1.test.authored-mesh-pattern",
    definitions: [
      MeshPatternTopologyProviderNode,
      MeshPatternFillMaterialProviderNode,
      MeshPatternWireMaterialProviderNode,
      MeshPatternFillToImageNode,
      MeshPatternWireToImageNode,
    ],
    nodes: [
      topology,
      fillMaterial,
      wireMaterial,
      fill,
      wire,
    ],
    connections: [
      { from: "topology.topology", to: "fill.topology", type: "topology-provider" },
      { from: "fill-material.material", to: "fill.material", type: "visual-material-provider" },
      { from: "topology.topology", to: "wire.topology", type: "topology-provider" },
      { from: "wire-material.material", to: "wire.material", type: "visual-material-provider" },
      { from: "fill.texture", to: "wire.target", type: "texture" },
      { from: "wire.texture", to: "$out.texture", type: "texture" },
    ],
  });

  assert.equal(operation.backend, "compiled-visual-group");
  assert.deepEqual(
    operation.operations.map((item) => item.renderer),
    [
      "output/specialized:meshPatternFill",
      "output/specialized:meshPatternWire",
    ],
  );
  assert.deepEqual(
    operation.valueProgram.steps.map((step) => step.instanceId),
    ["topology", "fill-material", "wire-material"],
  );
  assert.equal(operation.executionModel, "texture-dag");
  plan.dispose();
});

test("an authored Terrain graph compiles typed providers into two retained native kernels", () => {
  const flight = graphNodeFromDefinition(TerrainFlightControllerNode, {
    id: "flight",
    visualProgram: true,
  });
  const geometry = graphNodeFromDefinition(TerrainHeightFieldGeometryProviderNode, {
    id: "geometry",
    visualProgram: true,
  });
  const surfaceMaterial = graphNodeFromDefinition(TerrainBiomeMaterialProviderNode, {
    id: "surface-material",
    visualProgram: true,
  });
  const wireMaterial = graphNodeFromDefinition(TerrainWireMaterialProviderNode, {
    id: "wire-material",
    visualProgram: true,
  });
  const camera = graphNodeFromDefinition(TerrainFlightCameraProviderNode, {
    id: "camera",
    visualProgram: true,
  });
  const surface = graphNodeFromDefinition(TerrainSurfaceToImageNode, {
    id: "surface",
    visualProgram: true,
  });
  const wire = graphNodeFromDefinition(TerrainWireToImageNode, {
    id: "wire",
    visualProgram: true,
  });
  const { plan, operation } = compileAuthoredVisualGroup({
    id: "org.vj1.test.authored-terrain",
    definitions: [
      TerrainFlightControllerNode,
      TerrainHeightFieldGeometryProviderNode,
      TerrainBiomeMaterialProviderNode,
      TerrainWireMaterialProviderNode,
      TerrainFlightCameraProviderNode,
      TerrainSurfaceToImageNode,
      TerrainWireToImageNode,
    ],
    nodes: [
      flight,
      geometry,
      surfaceMaterial,
      wireMaterial,
      camera,
      surface,
      wire,
    ],
    connections: [
      { from: "flight.flight", to: "camera.flight", type: "terrain-flight-state" },
      { from: "flight.flight", to: "surface.controller", type: "terrain-flight-state" },
      { from: "flight.flight", to: "wire.controller", type: "terrain-flight-state" },
      { from: "geometry.geometry", to: "surface.geometry", type: "geometry-provider" },
      { from: "geometry.geometry", to: "wire.geometry", type: "geometry-provider" },
      { from: "surface-material.material", to: "surface.material", type: "visual-material-provider" },
      { from: "wire-material.material", to: "wire.material", type: "visual-material-provider" },
      { from: "camera.camera", to: "surface.camera", type: "visual-camera-provider" },
      { from: "camera.camera", to: "wire.camera", type: "visual-camera-provider" },
      { from: "surface.texture", to: "wire.target", type: "texture" },
      { from: "wire.texture", to: "$out.texture", type: "texture" },
    ],
  });

  assert.equal(
    nodeDefinitionPlaceableInGraph(TerrainSurfaceToImageNode, "visual-graph"),
    true,
  );
  assert.equal(
    nodeDefinitionPlaceableInGraph(TerrainWireToImageNode, "visual-graph"),
    true,
  );
  assert.deepEqual(
    operation.operations.map((item) => item.nativeKernel),
    ["terrain-surface", "terrain-wire"],
  );
  assert.deepEqual(
    operation.valueProgram.steps.map((step) => step.instanceId),
    ["flight", "geometry", "surface-material", "wire-material", "camera"],
  );
  assert.equal(typeof operation.operations[0].nodeModule.terrainSurfaceGridVertices, "function");
  assert.match(operation.operations[0].nodeShaders["terrain-surface-fragment"], /waterColor/);
  assert.match(operation.operations[1].nodeShaders["terrain-wire-fragment"], /wireColor/);
  operation.valueProgram.evaluate({ componentTime: 1 });
  assert.equal(operation.operations[0].runtimeValueInputs.get("geometry").kind, "geometry");
  assert.equal(operation.operations[1].runtimeValueInputs.get("controller").kind, "terrain-flight-state");
  const draws = [];
  let copiedTarget = null;
  const runtime = new TerrainRenderRuntime({
    drawSurface: (_target, _cache, params, time) => {
      draws.push({ kernel: "surface", params, time });
    },
    drawWire: (_target, _cache, params, time) => {
      draws.push({ kernel: "wire", params, time });
    },
    drawBufferToTarget: (_target, input) => {
      copiedTarget = input;
    },
  });
  const output = {
    width: 640,
    height: 360,
    push() {},
    pop() {},
    clear() {},
    background() {},
  };
  const request = {
    width: 640,
    height: 360,
    pixelDensity: 1,
    uvRect: [0, 0, 1, 1],
  };
  const [surfaceOperation, wireOperation] = operation.operations;
  assert.equal(
    runtime.drawTypedKernel(
      output,
      surfaceOperation.configuration.source,
      request,
      surfaceOperation,
    ),
    true,
  );
  const retainedSurface = { width: 640, height: 360 };
  wireOperation.runtimeInputStates.set("target", { buffer: retainedSurface });
  assert.equal(
    runtime.drawTypedKernel(
      output,
      wireOperation.configuration.source,
      request,
      wireOperation,
    ),
    true,
  );
  assert.deepEqual(draws.map((draw) => draw.kernel), ["surface", "wire"]);
  assert.equal(draws[0].time, 0.65);
  assert.strictEqual(copiedTarget, retainedSurface);
  runtime.dispose();
  plan.dispose();
});
