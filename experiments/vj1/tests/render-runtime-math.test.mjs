import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  componentInstanceTime,
  effectTransformUniforms,
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

test("output renderer imports runtime policy instead of defining it", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");

  assert.ok(rendererSource.includes('from "./render-runtime-math.js?v=render-coordinate-scope-3"'));
  assert.doesNotMatch(rendererSource, /function qualityScaledRenderRequest\(/);
  assert.doesNotMatch(rendererSource, /function eyeballFrameUniforms\(/);
  assert.doesNotMatch(rendererSource, /function globalVisualTimeScale\(/);
  assert.doesNotMatch(rendererSource, /function effectTransformUniforms\(/);
  assert.match(rendererSource, /globalVisualTimeScale, instanceTime, qualityAdjustedGeneratorParams/);
});
