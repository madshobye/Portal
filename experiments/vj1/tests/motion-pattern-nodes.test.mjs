import test from "node:test";
import assert from "node:assert/strict";

import { createVj1NodePackage } from "../js/app-node-package.js";
import {
  getGeneratorNodeComponent,
  listGeneratorNodeComponents,
} from "../js/libraries/visual-nodes/index.js";
import {
  nestedNoiseMotionNodeProcess,
  orbitMotionNodeProcess,
} from "../js/libraries/motion-engine/index.js";

const GENERATOR_IDS = [
  "animatedDazzleStripes",
  "gestureReticle",
  "additiveLightOrbs",
  "chainFollowerTrails",
  "nestedOrbitMotion",
  "expressiveRibbonBrush",
];

test("motion-pattern generators are separate shader nodes in the visual catalog", () => {
  const catalogIds = new Set(listGeneratorNodeComponents().map((component) => component.id));

  for (const id of GENERATOR_IDS) {
    assert.equal(catalogIds.has(id), true, `${id} should be catalogued`);
    const component = getGeneratorNodeComponent(id);
    assert.equal(component.nodeDefinition.implementation.kind, "shader");
    assert.ok(component.code.includes("precision highp float;"));
  }
});

test("trail and ribbon nodes use analytic history without feedback buffers", () => {
  for (const id of ["chainFollowerTrails", "expressiveRibbonBrush"]) {
    const source = getGeneratorNodeComponent(id).code;
    assert.equal(source.includes("sampler2D"), false);
    assert.equal(source.includes("framebuffer"), false);
  }

  const ribbon = getGeneratorNodeComponent("expressiveRibbonBrush").code;
  assert.equal((ribbon.match(/for \(int/g) || []).length, 1);
});

test("motion-pattern shader parameters do not shadow GLSL built-ins", () => {
  const reservedFunctionNames = new Set([
    "abs", "acos", "asin", "atan", "ceil", "clamp", "cos", "cross", "distance",
    "dot", "exp", "exp2", "floor", "fract", "length", "log", "log2", "max", "min",
    "mix", "mod", "normalize", "pow", "reflect", "refract", "sign", "sin", "smoothstep",
    "sqrt", "step", "tan",
  ]);

  for (const id of GENERATOR_IDS) {
    const component = getGeneratorNodeComponent(id);
    for (const parameter of component.params || []) {
      assert.equal(
        reservedFunctionNames.has(parameter.id),
        false,
        `${component.id} parameter ${parameter.id} shadows a GLSL built-in`,
      );
    }
  }
});

test("motion coordinate nodes are registered and return matching scalar/vector outlets", () => {
  const packageRoot = createVj1NodePackage();
  assert.equal(packageRoot.registry.has("core.motion.orbit"), true);
  assert.equal(packageRoot.registry.has("core.motion.nested-noise"), true);

  for (const result of [
    orbitMotionNodeProcess({ time: 1.25, radius: 0.2 }),
    nestedNoiseMotionNodeProcess({ time: 1.25, amount: 0.2 }),
  ]) {
    assert.equal(Number.isFinite(result.x), true);
    assert.equal(Number.isFinite(result.y), true);
    assert.deepEqual(result.position, [result.x, result.y]);
  }
});
