import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  componentInstanceTime,
  effectTransformUniforms,
  eyeballFrameUniforms,
  globalVisualTimeScale,
  instanceTime,
  qualityComputeMultiplier,
  qualityAdjustedGeneratorParams,
  qualityScaledRenderRequest,
} from "../js/output/render-runtime-math.js";

test("render runtime math owns quality timing and transform policy", () => {
  assert.deepEqual(
    qualityScaledRenderRequest({ width: 200, height: 100 }, { renderQuality: 0 }),
    { width: 70, height: 35, logicalWidth: 200, logicalHeight: 100, qualityScale: 0.35 }
  );
  assert.equal(qualityAdjustedGeneratorParams("cellularCircles", { renderQuality: 1, searchRadius: 4 }).searchRadius, 5);
  assert.equal(componentInstanceTime({ id: "shared", syncInstances: true }, 12, "a"), 12);
  assert.notEqual(instanceTime("chain-item-a", 12), instanceTime("chain-item-b", 12));
  assert.equal(globalVisualTimeScale({ timeStretch: -4 }), 0);
  assert.equal(globalVisualTimeScale({ timeStretch: 2 }), 4);
  assert.equal(effectTransformUniforms({}).forward.length, 9);
  assert.equal(qualityComputeMultiplier({ renderQuality: 0.5 }), 1);
});

test("unchanged generator params and eyeball animation can remain allocation-stable", () => {
  const params = { renderQuality: 0.5, gazeRange: 1 };
  assert.equal(qualityAdjustedGeneratorParams("eyeball", params), params);

  const frame = eyeballFrameUniforms(1, params);
  const vectorReferences = [frame.gazeDir, frame.irisRight, frame.irisUp];
  assert.equal(eyeballFrameUniforms(2, params, frame), frame);
  assert.equal(frame.gazeDir, vectorReferences[0]);
  assert.equal(frame.irisRight, vectorReferences[1]);
  assert.equal(frame.irisUp, vectorReferences[2]);
});

test("output renderer imports runtime policy instead of defining it", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");

  assert.match(rendererSource, /from "\.\/render-runtime-math\.js\?v=[^"]+"/);
  assert.doesNotMatch(rendererSource, /function qualityScaledRenderRequest\(/);
  assert.doesNotMatch(rendererSource, /function eyeballFrameUniforms\(/);
  assert.doesNotMatch(rendererSource, /function globalVisualTimeScale\(/);
  assert.doesNotMatch(rendererSource, /function effectTransformUniforms\(/);
  assert.match(rendererSource, /globalVisualTimeScale, instanceTime, qualityAdjustedGeneratorParams/);
});
