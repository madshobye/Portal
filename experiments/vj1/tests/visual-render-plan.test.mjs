import test from "node:test";
import assert from "node:assert/strict";

import {
  compileVisualRenderPlan,
  visualRenderPlanConfiguration,
} from "../js/libraries/composition-engine/index.js";

function renderNode(id, role) {
  return {
    id,
    nodeId: role === "effect" ? `vj1.visual.effect.${id}` : `vj1.visual.generator.${id}`,
    nodeVersion: "0.1.0",
    role,
    compilerHook: { id: role === "effect" ? "vj1.visual.shader-effect" : "vj1.visual.shader-generator", fusible: role === "effect" },
    configuration: role === "effect"
      ? { id, kind: "effect", componentId: id, params: {} }
      : { id, kind: "source", source: { type: "generator", generatorId: id, params: {} } },
  };
}

test("visual render plans follow authored texture connections and omit disconnected editor nodes", () => {
  const group = {
    id: "vj1.component.plan",
    componentId: "plan",
    nodes: [renderNode("unused", "effect"), renderNode("source", "source"), renderNode("active", "effect")],
    connections: [
      { from: "$in.texture", to: "source.image", type: "texture" },
      { from: "source.texture", to: "active.texture", type: "texture" },
      { from: "active.texture", to: "$out.texture", type: "texture" },
    ],
  };
  const plan = compileVisualRenderPlan(group, { id: "plan", chain: [] });

  assert.deepEqual(plan.operations.map((operation) => operation.id), ["source", "active"]);
  assert.deepEqual(plan.operations.map((operation) => operation.opcode), ["source", "effect"]);
  assert.equal(plan.operations[1].transformDomain, null, "legacy graph metadata remains explicit for definition fallback");
  assert.equal(plan.diagnostics.some((diagnostic) => diagnostic.code === "VISUAL_PLAN_UNUSED_NODE" && diagnostic.path.endsWith("/unused")), true);
  assert.deepEqual(visualRenderPlanConfiguration(plan).map((item) => item.id), ["source", "active"]);
});

test("visual render operations bind to runtime Component configuration by identity", () => {
  const sourceNode = renderNode("source", "source");
  const effectNode = renderNode("active", "effect");
  const runtimeSource = {
    id: "source",
    kind: "source",
    source: { type: "generator", generatorId: "source", params: { scale: 1 } },
  };
  const runtimeEffect = {
    id: "active",
    kind: "effect",
    componentId: "active",
    params: { amount: 0.25 },
  };
  const plan = compileVisualRenderPlan({
    id: "vj1.component.runtime-identity",
    componentId: "runtime-identity",
    nodes: [sourceNode, effectNode],
    connections: [
      { from: "$in.texture", to: "source.image", type: "texture" },
      { from: "source.texture", to: "active.texture", type: "texture" },
      { from: "active.texture", to: "$out.texture", type: "texture" },
    ],
  }, { id: "runtime-identity", chain: [runtimeSource, runtimeEffect] });

  assert.strictEqual(plan.operations[0].configuration, runtimeSource);
  assert.strictEqual(plan.operations[1].configuration, runtimeEffect);
  runtimeEffect.params.amount = 0.8;
  assert.equal(plan.operations[1].configuration.params.amount, 0.8);
});

test("native node processes compile into the direct visual operation", () => {
  const node = renderNode("calibration", "source");
  node.compilerHook = {
    id: "vj1.visual.native-source",
    renderer: "output/specialized:testPattern",
    allocationStable: true,
  };
  const process = () => "target";
  const plan = compileVisualRenderPlan({
    id: "vj1.component.native-process",
    nodes: [node],
    connections: [
      { from: "$in.texture", to: "calibration.image", type: "texture" },
      { from: "calibration.texture", to: "$out.texture", type: "texture" },
    ],
  }, {}, {
    resolveDefinition: () => ({
      id: "vj1.visual.generator.testPattern",
      version: "0.1.0",
      metadata: { nodeOwnedNativeProcess: true },
      process,
    }),
  });

  assert.strictEqual(plan.operations[0].nodeProcess, process);
  assert.equal(plan.operations[0].nodeProcessId, "vj1.visual.generator.testPattern@0.1.0");
  assert.match(plan.operations[0].nodeProcessRevision, /^[a-z0-9]+$/);
  assert.equal(plan.operations[0].allocationStable, true);
});

test("a disconnected Component output compiles to a transparent plan instead of falling back to node order", () => {
  const plan = compileVisualRenderPlan({
    id: "vj1.component.disconnected",
    nodes: [renderNode("source", "source")],
    connections: [{ from: "$in.texture", to: "source.image", type: "texture" }],
  });

  assert.deepEqual(plan.operations, []);
  assert.equal(plan.diagnostics[0].code, "VISUAL_PLAN_OUTPUT_DISCONNECTED");
});

test("visual compilation rejects ambiguous texture inputs before the render frame", () => {
  assert.throws(() => compileVisualRenderPlan({
    id: "vj1.component.ambiguous",
    nodes: [renderNode("source-a", "source"), renderNode("source-b", "source"), renderNode("effect", "effect")],
    connections: [
      { from: "$in.texture", to: "source-a.image", type: "texture" },
      { from: "$in.texture", to: "source-b.image", type: "texture" },
      { from: "source-a.texture", to: "effect.texture", type: "texture" },
      { from: "source-b.texture", to: "effect.texture", type: "texture" },
      { from: "effect.texture", to: "$out.texture", type: "texture" },
    ],
  }), /VISUAL_RENDER_MULTIPLE_TEXTURE_INPUTS/);
});
