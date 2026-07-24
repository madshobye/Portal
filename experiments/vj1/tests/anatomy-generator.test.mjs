import test from "node:test";
import assert from "node:assert/strict";

import {
  createProjectNodeFork,
  materializeProjectNodeFork,
} from "../js/libraries/node-engine/index.js";
import {
  AnatomyMaterialPaletteNode,
  AnatomyMotionTransform3dNode,
  getGeneratorNodeComponent,
} from "../js/libraries/visual-nodes/index.js";

test("Low Poly Anatomy is an editable Scene3D compound rather than a parent-owned renderer", () => {
  const definition = getGeneratorNodeComponent("anatomy").nodeDefinition;
  const graph = definition.parts.find((part) => part.kind === "graph");

  assert.equal(definition.metadata.visualCompilerHook.id, "vj1.visual.scene-3d-program");
  assert.equal(definition.metadata.nativeCompound, undefined);
  assert.deepEqual(definition.parts.map((part) => part.id), ["graph"]);
  assert.equal(graph.editable, true);
  assert.deepEqual(graph.nodes.map((node) => node.id), [
    "geometry",
    "motion",
    "materials",
    "objects",
    "camera",
    "scene",
    "render",
  ]);
  assert.equal(
    graph.connections.some((edge) =>
      edge.from === "geometry.collection" && edge.to === "objects.collection"
    ),
    true,
  );
  assert.equal(
    graph.connections.some((edge) =>
      edge.from === "scene.scene" && edge.to === "render.scene"
    ),
    true,
  );
  assert.equal(graph.nodes.find((node) => node.id === "motion").type, AnatomyMotionTransform3dNode.id);
  assert.equal(graph.nodes.find((node) => node.id === "materials").type, AnatomyMaterialPaletteNode.id);
});

test("Anatomy motion is an independently forkable child node used by the compiled Scene", () => {
  const base = AnatomyMotionTransform3dNode;
  const fork = createProjectNodeFork(base, {
    forkId: "anatomy-motion-project",
    overrides: {
      parts: base.parts.map((part) => ({
        ...part,
        source: [
          "function anatomyMotionTransform3dProcess() {",
          "  return { transform: createRetainedTransform3d({ scale: [2.5, 2.5, 2.5] }) };",
          "}",
        ].join("\n"),
      })),
    },
  });
  const definition = materializeProjectNodeFork(base, fork);
  const result = definition.process({});

  assert.deepEqual(result.transform.scale, [2.5, 2.5, 2.5]);
  assert.equal(definition.id, `${base.id}/fork/anatomy-motion-project`);
});
