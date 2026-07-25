import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  generateMeshPatternTopology,
  MESH_PATTERN_FAMILIES,
  meshPatternTopologySignature,
} from "../js/output/specialized/mesh-pattern-algorithms.js";
import {
  MeshPatternRenderer,
  meshPatternNodeShaderSource,
  meshPatternPalette,
  meshPatternPassPalette,
} from "../js/output/specialized/mesh-pattern-renderer.js";
import { MeshPatternRuntime } from "../js/output/specialized/mesh-pattern-runtime.js";
import {
  createGeneratorSource,
  getGeneratorNodeComponent,
  MeshPatternFillMaterialProviderNode,
  MeshPatternFillToImageNode,
  MeshPatternTopologyProviderNode,
  MeshPatternWireMaterialProviderNode,
  MeshPatternWireToImageNode,
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
  createVisualRenderProcessContext,
  updateVisualRenderProcessContext,
} from "../js/libraries/render-engine/index.js";
import {
  NODE_GRAPH_AUTHORING_TARGETS,
  nodeDefinitionPlaceableInGraph,
} from "../js/control/node-graph-canvas.js";

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

test("Mesh Pattern providers and render passes are placeable in their compatible node editors", () => {
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
  for (const definition of [
    MeshPatternTopologyProviderNode,
    MeshPatternFillMaterialProviderNode,
    MeshPatternWireMaterialProviderNode,
    MeshPatternFillToImageNode,
    MeshPatternWireToImageNode,
  ]) {
    assert.equal(
      nodeDefinitionPlaceableInGraph(
        definition,
        NODE_GRAPH_AUTHORING_TARGETS.VISUAL,
      ),
      true,
      `${definition.id} must be available to visual Group authoring`,
    );
  }
});

test("Mesh Patterns compiles reusable providers and retained GPU passes without a parent renderer", () => {
  const component = getGeneratorNodeComponent("meshPatterns");
  const sourceRuntime = readFileSync(new URL("../js/output/source-render-runtime.js", import.meta.url), "utf8");
  const runtime = readFileSync(new URL("../js/output/specialized/specialized-source-runtime.js", import.meta.url), "utf8");
  const passRuntime = readFileSync(new URL("../js/output/specialized/mesh-pattern-runtime.js", import.meta.url), "utf8");
  const meshRenderer = readFileSync(new URL("../js/output/specialized/mesh-pattern-renderer.js", import.meta.url), "utf8");
  const algorithms = readFileSync(new URL("../js/libraries/visual-nodes/generators/mesh-patterns/runtime.js", import.meta.url), "utf8");

  assert.equal(component.nodeDefinition.metadata.nativeRenderer, "");
  assert.equal(component.nodeDefinition.metadata.renderAuthority, "compiled-graph");
  assert.equal(
    component.nodeDefinition.parts.some((part) => part.kind === "javascript"),
    false,
    "the Group cannot retain a hidden parent process beside its executable child graph",
  );
  const operation = compiledMeshPatternOperation();
  assert.equal(operation.backend, "compiled-visual-group");
  assert.equal(operation.executionModel, "texture-dag");
  assert.equal(operation.placementLowering, "compound-output");
  assert.deepEqual(operation.valueProgram.steps.map(({ nodeId }) => nodeId), [
    MeshPatternTopologyProviderNode.id,
    MeshPatternFillMaterialProviderNode.id,
    MeshPatternWireMaterialProviderNode.id,
  ]);
  assert.deepEqual(operation.operations.map(({ id, nodeId, renderer }) => ({ id, nodeId, renderer })), [
    {
      id: "fill-render",
      nodeId: MeshPatternFillToImageNode.id,
      renderer: "output/specialized:meshPatternFill",
    },
    {
      id: "wire-render",
      nodeId: MeshPatternWireToImageNode.id,
      renderer: "output/specialized:meshPatternWire",
    },
  ]);
  assert.deepEqual(operation.operations[1].textureInputs, { target: "fill-render" });
  assert.equal(
    operation.operations[0].framebufferSequence.sequenceId,
    operation.operations[1].framebufferSequence.sequenceId,
  );
  assert.deepEqual(operation.operations[0].framebufferSequence, {
    sequenceId: operation.operations[1].framebufferSequence.sequenceId,
    phase: "begin",
    preserve: ["color"],
  });
  assert.deepEqual(operation.operations[1].framebufferSequence, {
    sequenceId: operation.operations[0].framebufferSequence.sequenceId,
    phase: "continue",
    inputPort: "target",
    preserve: ["color"],
  });
  assert.equal(Object.keys(operation.operations[0].nodeShaders).includes("mesh-pattern-fill-fragment"), true);
  assert.equal(Object.keys(operation.operations[1].nodeShaders).includes("mesh-pattern-wire-fragment"), true);
  assert.doesNotMatch(sourceRuntime, /NATIVE_SOURCE_HOST_METHODS/);
  assert.doesNotMatch(runtime, /registerNativeRenderer\(\s*"output\/specialized:meshPatterns"/);
  assert.match(runtime, /registerNativeRenderer\(\s*"output\/specialized:meshPatternFill"/);
  assert.match(runtime, /registerNativeRenderer\(\s*"output\/specialized:meshPatternWire"/);
  assert.match(passRuntime, /this\.renderer\.drawPass\(/);
  assert.match(passRuntime, /input && input !== output/);
  assert.match(passRuntime, /continuesFramebuffer \|\| !!input/);
  assert.match(meshRenderer, /this\.contexts = new Map\(\)/);
  assert.match(meshRenderer, /gl\.bufferData\(gl\.ARRAY_BUFFER, topology\.fillVertices, gl\.STATIC_DRAW\)/);
  assert.match(meshRenderer, /gl\.drawArrays\(gl\.TRIANGLES/);
  assert.match(meshRenderer, /createTopologyResources\(gl, topology, currentFrame\);\s*context\.topologies\.set\(signature, resources\);\s*pruneGpuTopologies\(gl, context\.topologies, signature\)/);
  assert.match(meshRenderer, /\.filter\(\(\[key\]\) => key !== protectedKey\)/);
  assert.match(meshRenderer, /topologyResourcesValid\(gl, resources\)/);
  assert.match(meshRenderer, /operation\?\.runtimeValueInputs\?\.get\?\.\("topology"\)/);
  assert.match(meshRenderer, /operation\?\.runtimeValueInputs\?\.get\?\.\("material"\)/);
  assert.match(meshRenderer, /MESH_PATTERN_VALUE_INPUT_MISSING/);
  assert.match(meshRenderer, /MESH_PATTERN_TOPOLOGY_VALUE_MISSING/);
  assert.match(meshRenderer, /MESH_PATTERN_MATERIAL_PALETTE_MISSING/);
  assert.doesNotMatch(meshRenderer, /generateMeshPatternTopology/);
  assert.doesNotMatch(meshRenderer, /meshPatternPalette\(materialParams\)/);
  assert.match(algorithms, /function voronoiCells/);
  assert.match(algorithms, /function marchingSquares/);
  assert.match(algorithms, /function rk4Step/);
  assert.match(algorithms, /function solveTruss/);
});

test("retained Mesh Pattern passes reject missing typed provider values", () => {
  const renderer = new MeshPatternRenderer();
  assert.throws(
    () => renderer.drawPass(
      { drawingContext: {} },
      "fill",
      { generatorId: "meshPatterns", params: {} },
      0,
      { width: 640, height: 360 },
      { id: "fill", runtimeValueInputs: new Map() },
    ),
    /MESH_PATTERN_VALUE_INPUT_MISSING:fill:topology,material/,
  );
});

test("Mesh Pattern wire continues on the shared framebuffer without copying its own target", () => {
  const runtime = new MeshPatternRuntime();
  const calls = [];
  runtime.renderer = {
    drawPass(...args) {
      calls.push(args);
      return true;
    },
    dispose() {},
  };
  const output = {
    width: 640,
    height: 360,
    push() {},
    pop() {},
    image() {
      throw new Error("shared framebuffer continuation must not copy itself");
    },
  };
  runtime.draw(
    output,
    "wire",
    {},
    0,
    { width: 640, height: 360 },
    {
      runtimeInputStates: new Map([["target", { buffer: output }]]),
      framebufferSequence: {
        sequenceId: "mesh-pattern/shared",
        phase: "continue",
        inputPort: "target",
        preserve: ["color"],
      },
    },
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][6], { preserveTarget: true });
});

test("Mesh Pattern pass requirements follow the connected material type", () => {
  assert.deepEqual(
    meshPatternPassPalette("wire", {
      providerId: "mesh-pattern-wire",
      settings: { wireColor: "#ffffffff" },
    }, { id: "wire-render" }),
    [],
    "wire rendering does not invent a fill-palette requirement",
  );
  assert.throws(
    () => meshPatternPassPalette("fill", {
      providerId: "mesh-pattern-fill",
      settings: {},
    }, { id: "fill-render" }),
    /MESH_PATTERN_MATERIAL_PALETTE_MISSING:fill-render/,
  );
});

test("Mesh Patterns topology and materials execute as isolated typed value nodes", () => {
  const operation = compiledMeshPatternOperation({
    pattern: "veins",
    density: 1.4,
    palette: "triadic",
    fillOpacity: 0.6,
    wireColor: "#abcdefcc",
    wireWidth: 2.5,
  });
  operation.valueProgram.evaluate({ renderRequest: { width: 1500, height: 1000 } });
  const [fillRender, wireRender] = operation.operations;
  const topology = fillRender.runtimeValueInputs.get("topology");
  const fill = fillRender.runtimeValueInputs.get("material");
  const wire = wireRender.runtimeValueInputs.get("material");

  assert.equal(topology.providerId, "mesh-pattern-topology");
  assert.equal(topology.geometry.family, "veins");
  assert.strictEqual(wireRender.runtimeValueInputs.get("topology"), topology);
  assert.equal(fill.providerId, "mesh-pattern-fill");
  assert.equal(fill.palette.length, 4);
  assert.equal(wire.providerId, "mesh-pattern-wire");
  assert.equal(wire.sceneMaterial.wireThickness, 2.5);
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
      aspect: "topology.aspect",
    },
    publicOutlets: { texture: "render.texture" },
  });
  const program = compileScene3dProgram(definition, { registry: packageRoot.registry });
  const target = { clearCalls: 0, clear() { this.clearCalls += 1; } };
  const result = program.execute({ aspect: 1.4 }, {
    renderProcess: updateVisualRenderProcessContext(
      createVisualRenderProcessContext(),
      { target, time: 0 },
    ),
  });

  assert.equal(program.format, "vj1.scene-3d-program@1");
  assert.deepEqual(
    program.steps.map((step) => step.id),
    ["topology", "fill", "camera", "objects", "scene", "render"],
  );
  assert.strictEqual(result.texture, target);
  assert.equal(target.clearCalls, 1);
  program.dispose();
});

test("Mesh Patterns retained passes receive values through the displayed typed connections", () => {
  const operation = compiledMeshPatternOperation({
    pattern: "coral",
    density: 1.75,
    palette: "analogous",
    fillOpacity: 0.55,
    wireColor: "#123456ee",
    wireWidth: 3,
    drawMode: "fill + wire",
    renderQuality: 0.8,
    hiddenRendererCorrection: 99,
  });
  operation.valueProgram.evaluate({ renderRequest: { width: 1600, height: 1000 } });
  const [fillRender, wireRender] = operation.operations;
  const fillTopology = fillRender.runtimeValueInputs.get("topology");
  const wireTopology = wireRender.runtimeValueInputs.get("topology");
  assert.equal(fillTopology.providerId, "mesh-pattern-topology");
  assert.strictEqual(wireTopology, fillTopology, "one executed topology value fans out through both authored graph wires");
  assert.equal(fillTopology.geometry.signature.includes(":1.6"), true);
  assert.equal(fillTopology.collection.kind, "mesh-collection");
  assert.equal(fillRender.runtimeValueInputs.get("material").providerId, "mesh-pattern-fill");
  assert.equal(wireRender.runtimeValueInputs.get("material").providerId, "mesh-pattern-wire");
  assert.deepEqual(wireRender.textureInputs, { target: "fill-render" });
  assert.equal(fillRender.configuration.source.params.drawMode, "fill + wire");
  assert.equal(fillRender.configuration.source.params.renderQuality, 0.8);
  assert.equal(
    fillRender.configuration.source.params.hiddenRendererCorrection,
    undefined,
    "undeclared host corrections cannot enter the compiled kernel input",
  );
});

test("Mesh Patterns palette and render-shader forks reach their real execution owners", () => {
  const materialBase = MeshPatternFillMaterialProviderNode;
  const materialFork = createProjectNodeFork(materialBase, {
    forkId: "mesh-pattern-style-project",
    overrides: {
      parts: materialBase.parts.map((part) => {
        if (part.id === "mesh-pattern-palette-module") {
          return { ...part, source: "function meshPatternPalette() { return [[1, 0, 0, 1], [1, 0, 0, 1], [1, 0, 0, 1], [1, 0, 0, 1]]; }" };
        }
        return part;
      }),
    },
  });
  const materialResolved = materializeProjectNodeFork(materialBase, materialFork);
  const materialOutput = materialResolved.process({}, { state: {} });
  assert.deepEqual(materialOutput.material.palette[0], [1, 0, 0, 1]);
  assert.equal(
    materialResolved.parts.some((part) => part.kind === NODE_PART_KINDS.SHADER),
    false,
    "material providers do not advertise shader ownership they do not execute",
  );

  const renderBase = MeshPatternFillToImageNode;
  const renderFork = createProjectNodeFork(renderBase, {
    forkId: "mesh-pattern-fill-render-project",
    overrides: {
      parts: renderBase.parts.map((part) => part.id === "mesh-pattern-fill-fragment"
        ? { ...part, source: "precision highp float; void main() { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); }" }
        : part),
    },
  });
  const renderResolved = materializeProjectNodeFork(renderBase, renderFork);
  const operation = {
    renderer: "output/specialized:meshPatternFill",
    nodeShaders: Object.fromEntries(renderResolved.parts
      .filter((part) => part.kind === NODE_PART_KINDS.SHADER)
      .map((part) => [part.id, part.source])),
  };

  assert.match(meshPatternNodeShaderSource(operation, "mesh-pattern-fill-fragment"), /gl_FragColor = vec4\(1\.0, 0\.0, 0\.0, 1\.0\)/);
  assert.throws(
    () => meshPatternNodeShaderSource({}, "mesh-pattern-fill-fragment"),
    /MESH_PATTERN_COMPILED_SHADER_MISSING:mesh-pattern-fill-fragment/,
  );
});

test("Mesh Patterns project forks supply topology directly through the provider value", () => {
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
  const module = resolved.moduleExports;

  assert.equal(module.meshPatternTopologySignature(), "forked-signature");
  assert.equal(module.generateMeshPatternTopology().family, "forked");
  const output = resolved.process({ settings: {}, aspect: 1 }, { state: {} });
  assert.equal(output.topology.geometry.family, "forked");
  assert.equal(output.collection.kind, "mesh-collection");
  assert.equal(output.collection.parts[0].mesh.triangleCount, 1);
});

function compiledMeshPatternOperation(params = {}) {
  const packageRoot = createVj1NodePackage();
  const component = {
    id: "mesh-pattern-component",
    name: "Mesh Pattern",
    type: "component",
    chain: [{
      id: "mesh-pattern-source",
      kind: "source",
      source: { type: "generator", generatorId: "meshPatterns", params },
    }],
  };
  const state = packageRoot.prepareProjectState({ components: [component], nodes: {} });
  return compileComponentRenderPrograms(state.components, state.nodes.groups, {
    resolveNodeDefinition: (node) => packageRoot.registry.get(node.nodeId, node.nodeVersion),
  }).get(component.id).plan.operations[0];
}
