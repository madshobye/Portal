import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  generateMeshPatternTopology,
  MESH_PATTERN_FAMILIES,
  meshPatternTopologySignature,
} from "../js/output/specialized/mesh-pattern-algorithms.js";
import { MeshPatternRenderer, meshPatternNodeRuntimeModule, meshPatternNodeShaderSource, meshPatternPalette } from "../js/output/specialized/mesh-pattern-renderer.js";
import {
  compileSpecializedCompoundProgram,
  createGeneratorSource,
  evaluateSpecializedCompoundGraph,
  executeSpecializedCompoundProvider,
  getGeneratorNodeComponent,
  MeshPatternFillMaterialProviderNode,
  MeshPatternFillToImageNode,
  MeshPatternTopologyProviderNode,
  MeshPatternWireMaterialProviderNode,
  MeshPatternWireToImageNode,
  SpecializedCompoundStageNodeDefinitions,
} from "../js/libraries/visual-nodes/index.js";
import {
  createProjectNodeFork,
  defineNodeGroup,
  materializeProjectNodeFork,
  NODE_PART_KINDS,
} from "../js/libraries/node-engine/index.js";
import { createVj1NodePackage } from "../js/app-node-package.js";
import { compileComponentRenderPrograms } from "../js/libraries/composition-engine/index.js";
import { compileScene3dProgram } from "../js/libraries/mesh-engine/index.js";
import {
  NODE_GRAPH_AUTHORING_TARGETS,
  nodeDefinitionPlaceableInGraph,
} from "../js/control/node-graph-canvas.js";
import { MESH_PATTERN_FILL_FRAGMENT_SHADER } from "../js/libraries/visual-nodes/generators/mesh-patterns/shaders.js";

const representative = {
  scale: 8,
  density: 1,
  irregularity: 0.75,
  seed: 17,
};

test("every mesh family produces bounded deterministic vector topology", () => {
  assert.deepEqual(MESH_PATTERN_FAMILIES, [
    "cells", "veins", "mountains", "soap", "cracks",
    "coral", "fabric", "rivers", "magnetic fields", "bone",
  ]);
  for (const pattern of MESH_PATTERN_FAMILIES) {
    const first = generateMeshPatternTopology({ ...representative, pattern }, 1.5);
    const second = generateMeshPatternTopology({ ...representative, pattern }, 1.5);
    assert.equal(first.signature, second.signature, `${pattern} signature changed`);
    assert.deepEqual(first.fillVertices, second.fillVertices, `${pattern} fill is not deterministic`);
    assert.deepEqual(first.lineSegments, second.lineSegments, `${pattern} wire topology is not deterministic`);
    assert.ok(first.lineSegmentCount > 0, `${pattern} has no vector edges`);
    assert.ok(first.fillVertexCount > 0, `${pattern} has no fill geometry`);
    assert.ok(first.fillVertexCount < 20000, `${pattern} exceeded bounded fill budget`);
    assert.ok(first.lineSegmentCount < 15000, `${pattern} exceeded bounded line budget`);
  }
});

test("topology signatures ignore render styling and include structural controls", () => {
  const base = meshPatternTopologySignature({ ...representative, pattern: "cells" }, 1.5);
  const styled = meshPatternTopologySignature({
    ...representative,
    pattern: "cells",
    drawMode: "wire",
    wireWidth: 12,
    baseColor: "#ff0000ff",
    palette: "monochrome",
    fillOpacity: 0,
  }, 1.5);
  assert.equal(base, styled);
  assert.notEqual(base, meshPatternTopologySignature({ ...representative, pattern: "cells", seed: 18 }, 1.5));
  assert.notEqual(base, meshPatternTopologySignature({ ...representative, pattern: "cells", density: 2 }, 1.5));
  assert.notEqual(base, meshPatternTopologySignature({ ...representative, pattern: "fabric" }, 1.5));
});

test("legacy visual names map to their real topology families", () => {
  const legacy = generateMeshPatternTopology({ ...representative, pattern: "tectonic plates" }, 1);
  const current = generateMeshPatternTopology({ ...representative, pattern: "cells" }, 1);
  assert.equal(legacy.family, "cells");
  assert.deepEqual(legacy.fillVertices, current.fillVertices);
  assert.deepEqual(legacy.lineSegments, current.lineSegments);
  assert.equal(createGeneratorSource("meshPatterns", { pattern: "soap bubble foam" }).params.pattern, "soap");
  assert.equal(createGeneratorSource("meshPatterns", { pattern: "river delta" }).params.pattern, "rivers");
});

test("mesh palette returns four GPU-ready colors for every harmony", () => {
  for (const palette of ["custom", "analogous", "complementary", "triadic", "split complementary", "tetradic", "monochrome"]) {
    const colors = meshPatternPalette({
      palette,
      colorCount: 4,
      baseColor: "#8040c0cc",
      colorB: "#11223344",
      colorC: "#55667788",
      colorD: "#99aabbcc",
    });
    assert.equal(colors.length, 4);
    colors.forEach((color) => {
      assert.equal(color.length, 4);
      color.forEach((channel) => assert.ok(channel >= 0 && channel <= 1));
    });
  }
  const pair = meshPatternPalette({ palette: "triadic", colorCount: 2, baseColor: "#8040c0ff" });
  assert.deepEqual(pair[0], pair[2]);
  assert.deepEqual(pair[1], pair[3]);
});

test("Mesh Pattern providers are placeable in the Scene3D node editor", () => {
  for (const definition of [
    MeshPatternTopologyProviderNode,
    MeshPatternFillMaterialProviderNode,
    MeshPatternWireMaterialProviderNode,
  ]) {
    assert.equal(
      nodeDefinitionPlaceableInGraph(definition, NODE_GRAPH_AUTHORING_TARGETS.SCENE_3D),
      true,
      `${definition.id} must remain available to Scene3D authoring`,
    );
  }
});

test("mesh topology uses a cached specialized raw-WebGL render path", () => {
  const component = getGeneratorNodeComponent("meshPatterns");
  const renderer = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const sourceRuntime = readFileSync(new URL("../js/output/source-render-runtime.js", import.meta.url), "utf8");
  const runtime = readFileSync(new URL("../js/output/specialized/specialized-source-runtime.js", import.meta.url), "utf8");
  const meshRenderer = readFileSync(new URL("../js/output/specialized/mesh-pattern-renderer.js", import.meta.url), "utf8");
  const algorithms = readFileSync(new URL("../js/libraries/visual-nodes/generators/mesh-patterns/runtime.js", import.meta.url), "utf8");

  assert.equal(component.nodeDefinition.metadata.nativeRenderer, "output/specialized:meshPatterns");
  assert.equal(component.nodeDefinition.metadata.nodeOwnedNativeModule, undefined);
  assert.equal(
    component.nodeDefinition.parts.some((part) => part.kind === "javascript"),
    false,
    "the compiled Group cannot retain an unused parent process beside its executable child graph",
  );
  const operation = compiledMeshPatternOperation();
  assert.equal(typeof operation.nodeModule.meshPatternTopologySignature, "function");
  assert.equal(typeof operation.nodeModule.generateMeshPatternTopology, "function");
  assert.equal(typeof operation.nodeModule.meshPatternPalette, "function");
  assert.deepEqual(Object.keys(operation.nodeShaders).filter((id) => id.startsWith("mesh-pattern-") && !["vertex", "fragment"].includes(id)), [
    "mesh-pattern-fill-vertex",
    "mesh-pattern-fill-fragment",
    "mesh-pattern-wire-vertex",
    "mesh-pattern-wire-fragment",
  ]);
  assert.equal(operation.nativeCompoundProgram.stages.find((stage) => stage.id === "topology")?.nodeId, MeshPatternTopologyProviderNode.id);
  assert.equal(operation.nativeCompoundProgram.stages.find((stage) => stage.id === "fill-material")?.nodeId, MeshPatternFillMaterialProviderNode.id);
  assert.equal(operation.nativeCompoundProgram.stages.find((stage) => stage.id === "wire-material")?.nodeId, MeshPatternWireMaterialProviderNode.id);
  assert.equal(operation.nativeCompoundProgram.stages.find((stage) => stage.id === "fill-render")?.nativeKernel, "mesh-pattern-fill");
  assert.equal(operation.nativeCompoundProgram.stages.find((stage) => stage.id === "wire-render")?.nativeKernel, "mesh-pattern-wire");
  assert.doesNotMatch(sourceRuntime, /NATIVE_SOURCE_HOST_METHODS/);
  assert.match(runtime, /registerNativeRenderer\(\s*"output\/specialized:meshPatterns"/);
  assert.match(runtime, /this\.meshPatterns\.draw\(target, source, componentTime, renderRequest, operation\)/);
  assert.match(meshRenderer, /this\.cpuTopologies = new Map\(\)/);
  assert.match(meshRenderer, /gl\.bufferData\(gl\.ARRAY_BUFFER, topology\.fillVertices, gl\.STATIC_DRAW\)/);
  assert.match(meshRenderer, /gl\.drawArrays\(gl\.TRIANGLES/);
  assert.match(meshRenderer, /createTopologyResources\(gl, topology, currentFrame\);\s*context\.topologies\.set\(signature, resources\);\s*pruneGpuTopologies\(gl, context\.topologies, signature\)/);
  assert.match(meshRenderer, /\.filter\(\(\[key\]\) => key !== protectedKey\)/);
  assert.match(meshRenderer, /topologyResourcesValid\(gl, resources\)/);
  assert.match(meshRenderer, /createContext\(gl, shaderConfiguration, context\?\.topologies\)/);
  assert.match(meshRenderer, /if \(context\) disposePrograms\(gl, context\)/);
  assert.doesNotMatch(meshRenderer, /specializedCompoundRuntimeParameters/);
  assert.match(meshRenderer, /evaluateSpecializedCompoundGraph\(/);
  assert.match(meshRenderer, /specializedCompoundNativeKernel\(operation, "mesh-pattern-fill"\)/);
  assert.match(meshRenderer, /specializedCompoundNativeKernel\(operation, "mesh-pattern-wire"\)/);
  assert.match(meshRenderer, /graph\?\.stageInput\(fillStageId, "topology"\)/);
  assert.match(meshRenderer, /graph\?\.stageInput\(fillStageId, "material"\)/);
  assert.match(meshRenderer, /graph\?\.stageInput\(wireStageId, "material"\)/);
  assert.match(meshRenderer, /MESH_PATTERN_GRAPH_INPUT_MISSING/);
  assert.match(meshRenderer, /let topology = topologyValue\?\.geometry \|\| null/);
  assert.match(meshRenderer, /MESH_PATTERN_TOPOLOGY_VALUE_MISSING/);
  assert.match(meshRenderer, /if \(!topology\) \{\s*const legacySignature = nodeModule\.meshPatternTopologySignature/);
  assert.match(meshRenderer, /fillMaterialValue\?\.palette \|\| nodeModule\.meshPatternPalette\(fillMaterialParams\)/);
  assert.match(algorithms, /function voronoiCells/);
  assert.match(algorithms, /function marchingSquares/);
  assert.match(algorithms, /function rk4Step/);
  assert.match(algorithms, /function solveTruss/);
});

test("compiled Mesh Patterns never reconstruct missing graph providers in the retained host", () => {
  const stages = [
    { id: "topology", parameters: {} },
    { id: "fill-material", parameters: {} },
    { id: "wire-material", parameters: {} },
    { id: "fill-render", parameters: {} },
    { id: "wire-render", parameters: {} },
  ];
  const operation = {
    nativeCompoundProgram: {
      stages,
      nativeKernel(kernel) {
        if (kernel === "mesh-pattern-fill") {
          return {
            id: "fill-render",
            inputBindings: {
              topology: { stageId: "topology", portId: "topology" },
              material: { stageId: "fill-material", portId: "material" },
            },
          };
        }
        return {
          id: "wire-render",
          inputBindings: {
            material: { stageId: "wire-material", portId: "material" },
          },
        };
      },
      evaluateGraph() {
        return {
          stageInput() {
            return null;
          },
          stageInputs() {
            return { settings: {} };
          },
        };
      },
    },
  };
  const renderer = new MeshPatternRenderer();

  assert.throws(
    () => renderer.draw(
      { drawingContext: {} },
      { generatorId: "meshPatterns", params: {} },
      0,
      { width: 640, height: 360 },
      operation,
    ),
    /MESH_PATTERN_GRAPH_INPUT_MISSING:fill-render\.topology,fill-render\.material,wire-render\.material/,
  );
});

test("Mesh Patterns topology and materials execute as isolated typed provider stages", () => {
  const definition = getGeneratorNodeComponent("meshPatterns").nodeDefinition;
  const definitions = new Map(SpecializedCompoundStageNodeDefinitions.map((item) => [item.id, item]));
  const program = compileSpecializedCompoundProgram(definition, {
    resolveDefinition: (node) => definitions.get(node.nodeId),
  });
  const operation = { nativeCompoundProgram: program };

  assert.deepEqual(program.executableStages, ["topology", "fill-material", "wire-material"]);
  const topology = executeSpecializedCompoundProvider(operation, "topology", {
    pattern: "veins",
    density: 1.4,
    wireColor: "#ffffffff",
    hiddenRendererCorrection: 99,
  }, { instanceId: "mesh-a" });
  assert.equal(topology.kind, "topology");
  assert.equal(topology.providerId, "mesh-pattern-topology");
  assert.deepEqual(topology.settings, {
    pattern: "veins",
    density: 1.4,
  });

  const fill = executeSpecializedCompoundProvider(operation, "fill-material", {
    palette: "triadic",
    fillOpacity: 0.6,
    speed: 2,
    hiddenRendererCorrection: 99,
  }, { instanceId: "mesh-a" });
  assert.equal(fill.kind, "material");
  assert.equal(fill.providerId, "mesh-pattern-fill");
  assert.deepEqual(fill.settings, {
    palette: "triadic",
    fillOpacity: 0.6,
  });

  const wire = executeSpecializedCompoundProvider(operation, "wire-material", {
    wireColor: "#abcdefcc",
    wireWidth: 2.5,
    motion: 1,
    hiddenRendererCorrection: 99,
  }, { instanceId: "mesh-a" });
  assert.equal(wire.kind, "material");
  assert.equal(wire.providerId, "mesh-pattern-wire");
  assert.deepEqual(wire.settings, {
    wireColor: "#abcdefcc",
    wireWidth: 2.5,
  });
  program.dispose();
});

test("Mesh Pattern providers publish canonical mesh and Material3D values", () => {
  const topology = MeshPatternTopologyProviderNode.process({
    pattern: "cells",
    density: 0.5,
    aspect: 1.5,
  }, { state: {} });
  const expectedTopology = generateMeshPatternTopology({
    pattern: "cells",
    density: 0.5,
  }, 1.5);
  const sharedTopology = MeshPatternTopologyProviderNode.process({
    pattern: "cells",
    density: 0.5,
    aspect: 1.5,
  }, { state: {} });
  const fill = MeshPatternFillMaterialProviderNode.process({
    palette: "custom",
    colorCount: 4,
    baseColor: "#ff0000ff",
    colorB: "#00ff00ff",
    colorC: "#0000ffff",
    colorD: "#ffffffff",
    fillOpacity: 0.5,
  }, { state: {} });
  const wire = MeshPatternWireMaterialProviderNode.process({
    wireColor: "#abcdefcc",
    wireOpacity: 0.5,
    wireWidth: 3,
  }, { state: {} });

  assert.equal(topology.collection.kind, "mesh-collection");
  assert.deepEqual(topology.topology.geometry.fillVertices, expectedTopology.fillVertices);
  assert.deepEqual(topology.topology.geometry.lineSegments, expectedTopology.lineSegments);
  assert.strictEqual(sharedTopology.topology.geometry, topology.topology.geometry);
  assert.strictEqual(
    sharedTopology.collection,
    topology.collection,
    "equivalent node instances share canonical CPU geometry and downstream GPU identity",
  );
  assert.ok(topology.collection.parts.length > 0);
  assert.equal(topology.collection.parts.every((part) => part.mesh.triangleCount > 0), true);
  assert.strictEqual(topology.topology.collection, topology.collection);
  assert.strictEqual(topology.topology.geometry.signature, topology.collection.metadata.topologySignature);
  assert.equal(fill.materialBindings.length, 4);
  assert.equal(fill.materialBindings.every((binding) =>
    binding.kind === "material-binding3d" &&
    binding.material.kind === "material3d"
  ), true);
  assert.strictEqual(fill.material.materialBindings, fill.materialBindings);
  assert.equal(wire.sceneMaterial.kind, "material3d");
  assert.equal(wire.sceneMaterial.renderMode, "wireframe");
  assert.strictEqual(wire.material.sceneMaterial, wire.sceneMaterial);

});

test("Mesh Pattern canonical outputs compile through the ordinary Scene3D graph", () => {
  const packageRoot = createVj1NodePackage();
  const definition = defineNodeGroup({
    id: "project.mesh-pattern-scene",
    name: "Mesh Pattern Scene",
    version: "1.0.0",
    description: "Composes Mesh Pattern providers through ordinary Scene3D nodes.",
    executionModel: "compiled-graph",
    compiler: { id: "vj1.scene-3d.direct-program", target: "scene-3d" },
    graphEditable: true,
    inlets: {
      target: { type: "any", required: true },
      componentTime: { type: "number", defaultValue: 0 },
      aspect: { type: "number", defaultValue: 1 },
    },
    outlets: { texture: { type: "texture" } },
    nodes: [
      { id: "topology", type: MeshPatternTopologyProviderNode.id },
      { id: "fill", type: MeshPatternFillMaterialProviderNode.id },
      { id: "objects", type: "core.scene3d.mesh-collection-objects" },
      { id: "camera", type: "core.scene3d.perspective-camera" },
      { id: "scene", type: "core.scene3d.scene" },
      { id: "render", type: "core.scene3d.render" },
    ],
    connections: [
      { from: "topology.collection", to: "objects.collection", type: "mesh-collection" },
      { from: "fill.materialBindings", to: "objects.materialBindings", type: "list<material-binding3d>" },
      { from: "objects.objects", to: "scene.objects", type: "list<object3d>" },
      { from: "camera.camera", to: "scene.camera", type: "camera3d" },
      { from: "scene.scene", to: "render.scene", type: "scene3d" },
    ],
    publicInlets: {
      target: "render.target",
      componentTime: "render.componentTime",
      aspect: "topology.aspect",
    },
    publicOutlets: { texture: "render.texture" },
  });
  const program = compileScene3dProgram(definition, { registry: packageRoot.registry });
  const target = { clearCalls: 0, clear() { this.clearCalls += 1; } };
  const result = program.execute({ target, componentTime: 0, aspect: 1.4 });

  assert.equal(program.format, "vj1.scene-3d-program@1");
  assert.deepEqual(
    program.steps.map((step) => step.id),
    ["topology", "fill", "camera", "objects", "scene", "render"],
  );
  assert.strictEqual(result.texture, target);
  assert.equal(target.clearCalls, 1);
  program.dispose();
});

test("Mesh Patterns retained kernels receive values through the displayed typed connections", () => {
  const definition = getGeneratorNodeComponent("meshPatterns").nodeDefinition;
  const definitions = new Map(SpecializedCompoundStageNodeDefinitions.map((item) => [item.id, item]));
  const program = compileSpecializedCompoundProgram(definition, {
    resolveDefinition: (node) => definitions.get(node.nodeId),
  });
  const operation = { nativeCompoundProgram: program };
  assert.deepEqual(program.nativeKernels.map(({ id, kernel }) => ({ id, kernel })), [
    { id: "fill-render", kernel: "mesh-pattern-fill" },
    { id: "wire-render", kernel: "mesh-pattern-wire" },
  ]);
  assert.deepEqual(program.nativeKernel("mesh-pattern-fill").inputBindings, {
    topology: { stageId: "topology", portId: "topology" },
    material: { stageId: "fill-material", portId: "material" },
  });
  assert.deepEqual(program.nativeKernel("mesh-pattern-wire").inputBindings, {
    topology: { stageId: "topology", portId: "topology" },
    material: { stageId: "wire-material", portId: "material" },
    target: { stageId: "fill-render", portId: "texture" },
  });
  const evaluation = evaluateSpecializedCompoundGraph(operation, {
    pattern: "coral",
    density: 1.75,
    palette: "analogous",
    fillOpacity: 0.55,
    wireColor: "#123456ee",
    wireWidth: 3,
    drawMode: "fill + wire",
    renderQuality: 0.8,
    hiddenRendererCorrection: 99,
  }, { instanceId: "mesh-connected" }, {
    topology: { aspect: 1.6 },
  });

  assert.equal(evaluation.format, "vj1.specialized-compound-evaluation@1");
  const fillTopology = evaluation.stageInput("fill-render", "topology");
  const wireTopology = evaluation.stageInput("wire-render", "topology");
  assert.equal(fillTopology.providerId, "mesh-pattern-topology");
  assert.strictEqual(wireTopology, fillTopology, "one executed topology value fans out through both authored graph wires");
  assert.deepEqual(fillTopology.settings, { pattern: "coral", density: 1.75 });
  assert.equal(fillTopology.geometry.signature.includes(":1.6"), true);
  assert.equal(fillTopology.collection.kind, "mesh-collection");
  assert.equal(evaluation.stageInput("fill-render", "material").providerId, "mesh-pattern-fill");
  assert.equal(evaluation.stageInput("wire-render", "material").providerId, "mesh-pattern-wire");
  assert.deepEqual(evaluation.stageInputs("fill-render").settings, {
    drawMode: "fill + wire",
    renderQuality: 0.8,
  });
  assert.equal(
    evaluation.stageInputs("fill-render").hiddenRendererCorrection,
    undefined,
    "undeclared host corrections cannot enter the compiled kernel input",
  );
  program.dispose();

  const graph = definition.parts.find((part) => part.kind === "graph");
  const editedGraph = {
    ...graph,
    nodes: graph.nodes.map((node) => node.id === "fill-render"
      ? { ...node, parameters: { ...node.parameters, amount: 0.35 } }
      : node),
  };
  const editedProgram = compileSpecializedCompoundProgram({
    ...definition,
    parts: definition.parts.map((part) => part.kind === "graph" ? editedGraph : part),
  }, {
    resolveDefinition: (node) => definitions.get(node.nodeId),
  });
  const editedEvaluation = evaluateSpecializedCompoundGraph(
    { nativeCompoundProgram: editedProgram },
    {},
    { instanceId: "mesh-connected-edited" },
  );
  assert.equal(
    editedEvaluation.stageInputs("fill-render").settings.amount,
    0.35,
    "a child-owned native-kernel parameter reaches the retained host without a public outer binding",
  );
  editedProgram.dispose();
});

test("Mesh Patterns palette and shader forks reach the retained raw-WebGL host", () => {
  const base = MeshPatternFillMaterialProviderNode;
  const fork = createProjectNodeFork(base, {
    forkId: "mesh-pattern-style-project",
    overrides: {
      parts: base.parts.map((part) => {
        if (part.id === "mesh-pattern-palette-module") {
          return { ...part, source: "function meshPatternPalette() { return [[1, 0, 0, 1], [1, 0, 0, 1], [1, 0, 0, 1], [1, 0, 0, 1]]; }" };
        }
        if (part.id === "mesh-pattern-fill-fragment") {
          return { ...part, source: "precision highp float; void main() { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); }" };
        }
        return part;
      }),
    },
  });
  const resolved = materializeProjectNodeFork(base, fork);
  const operation = {
    nodeModule: resolved.moduleExports,
    nodeShaders: Object.fromEntries(resolved.parts.filter((part) => part.kind === NODE_PART_KINDS.SHADER).map((part) => [part.id, part.source])),
  };

  assert.deepEqual(meshPatternNodeRuntimeModule(operation).meshPatternPalette()[0], [1, 0, 0, 1]);
  assert.match(meshPatternNodeShaderSource(operation, "mesh-pattern-fill-fragment"), /gl_FragColor = vec4\(1\.0, 0\.0, 0\.0, 1\.0\)/);
  assert.equal(meshPatternNodeShaderSource({}, "mesh-pattern-fill-fragment"), MESH_PATTERN_FILL_FRAGMENT_SHADER);
});

test("Mesh Patterns project forks supply topology directly to the retained cache host", () => {
  const base = MeshPatternTopologyProviderNode;
  const fork = createProjectNodeFork(base, {
    forkId: "mesh-pattern-project",
    overrides: {
      parts: base.parts.map((part) => part.id === "mesh-pattern-topology-module" ? {
        ...part,
        source: [
          "const MESH_PATTERN_FAMILIES = Object.freeze(['forked']);",
          "function meshPatternTopologySignature() { return 'forked-signature'; }",
          "function generateMeshPatternTopology() { return { family: 'forked', signature: 'forked-signature', fillVertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), lineSegments: new Float32Array(), fillVertexCount: 3, lineSegmentCount: 0 }; }",
        ].join("\n"),
      } : part),
    },
  });
  const resolved = materializeProjectNodeFork(base, fork);
  const module = meshPatternNodeRuntimeModule({ nodeModule: resolved.moduleExports });

  assert.equal(module.meshPatternTopologySignature(), "forked-signature");
  assert.equal(module.generateMeshPatternTopology().family, "forked");
  const output = resolved.process({ settings: {}, aspect: 1 }, { state: {} });
  assert.equal(output.topology.geometry.family, "forked");
  assert.equal(output.collection.kind, "mesh-collection");
  assert.equal(output.collection.parts[0].mesh.triangleCount, 1);
});

function compiledMeshPatternOperation() {
  const packageRoot = createVj1NodePackage();
  const component = {
    id: "mesh-pattern-component",
    name: "Mesh Pattern",
    type: "component",
    chain: [{
      id: "mesh-pattern-source",
      kind: "source",
      source: { type: "generator", generatorId: "meshPatterns", params: {} },
    }],
  };
  const state = packageRoot.prepareProjectState({ components: [component], nodes: {} });
  return compileComponentRenderPrograms(state.components, state.nodes.groups, {
    resolveNodeDefinition: (node) => packageRoot.registry.get(node.nodeId, node.nodeVersion),
  }).get(component.id).plan.operations[0];
}
