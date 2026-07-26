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
import {
  advanceRateClock as nodeAdvanceRateClock,
  InstanceTimeNode,
  RateClockNode,
  VisualTimeScaleNode,
} from "../js/libraries/timing-engine/index.js";
import { getGeneratorNodeComponent } from "../js/libraries/visual-nodes/index.js";

test("render runtime math owns quality timing and transform policy", () => {
  assert.deepEqual(
    qualityScaledRenderRequest({ width: 200, height: 100 }, { renderQuality: 0 }),
    { width: 70, height: 35, logicalWidth: 200, logicalHeight: 100, qualityScale: 0.35 }
  );
  const cellularCircles = getGeneratorNodeComponent("cellularCircles");
  assert.equal(qualityAdjustedGeneratorParams(cellularCircles, { renderQuality: 1, searchRadius: 4 }).searchRadius, 5);
  assert.equal(componentInstanceTime({ id: "shared", syncInstances: true }, 12, "a"), 12);
  assert.notEqual(instanceTime("chain-item-a", 12), instanceTime("chain-item-b", 12));
  assert.equal(globalVisualTimeScale({ timeStretch: -4 }), 0);
  assert.equal(globalVisualTimeScale({ timeStretch: 2 }), 4);
  assert.equal(effectTransformUniforms({}).forward.length, 9);
  assert.equal(qualityComputeMultiplier({ renderQuality: 0.5 }), 1);
});

test("unchanged generator params and eyeball animation can remain allocation-stable", () => {
  const params = { renderQuality: 0.5, gazeRange: 1 };
  assert.equal(qualityAdjustedGeneratorParams(getGeneratorNodeComponent("eyeball"), params), params);

  const frame = eyeballFrameUniforms(1, params);
  const vectorReferences = [frame.gazeDir, frame.irisRight, frame.irisUp];
  assert.equal(eyeballFrameUniforms(2, params, frame), frame);
  assert.equal(frame.gazeDir, vectorReferences[0]);
  assert.equal(frame.irisRight, vectorReferences[1]);
  assert.equal(frame.irisUp, vectorReferences[2]);
});

test("generator definitions own phase-rate and quality-derived work budgets", () => {
  const expectedRateOwners = [
    "fireflies",
    "bezierStrokes",
    "shadertoyBaseWarp",
    "cellularCircles",
    "galaxy",
    "lightning",
    "fog",
    "volumetricClouds",
    "sunRays",
    "seascape",
    "paintDrips",
    "cloudyTunnel",
    "cherenkovVolume",
    "biomineLite",
  ];
  for (const id of expectedRateOwners) {
    assert.equal(getGeneratorNodeComponent(id).runtime.rateParam, "speed", `${id} must declare its own rate parameter`);
  }

  const cloudy = getGeneratorNodeComponent("cloudyTunnel");
  assert.deepEqual(
    [0, 0.5, 1].map((renderQuality) =>
      qualityAdjustedGeneratorParams(cloudy, { renderQuality, raySteps: 72, cloudDetail: 2 })
    ),
    [
      { renderQuality: 0, raySteps: 25, cloudDetail: 1 },
      { renderQuality: 0.5, raySteps: 72, cloudDetail: 2 },
      { renderQuality: 1, raySteps: 108, cloudDetail: 3 },
    ],
  );
});

test("output renderer imports runtime policy instead of defining it", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const frameRuntimeSource = readFileSync(new URL("../js/output/output-frame-runtime.js", import.meta.url), "utf8");
  const sourceRuntime = readFileSync(new URL("../js/output/source-render-runtime.js", import.meta.url), "utf8");
  const generatorRuntime = readFileSync(new URL("../js/output/shader-generator-runtime.js", import.meta.url), "utf8");
  const runtimeMathSource = readFileSync(new URL("../js/output/render-runtime-math.js", import.meta.url), "utf8");

  assert.match(rendererSource, /from "\.\/render-runtime-math\.js"/);
  assert.doesNotMatch(rendererSource, /function qualityScaledRenderRequest\(/);
  assert.doesNotMatch(rendererSource, /function eyeballFrameUniforms\(/);
  assert.doesNotMatch(rendererSource, /function globalVisualTimeScale\(/);
  assert.doesNotMatch(rendererSource, /function effectTransformUniforms\(/);
  assert.match(frameRuntimeSource, /globalVisualTimeScale/);
  assert.match(generatorRuntime, /qualityAdjustedGeneratorParams/);
  assert.doesNotMatch(runtimeMathSource, /QUALITY_ADJUSTED_GENERATORS|generatorId ===/);
  assert.match(sourceRuntime, /\bcomponentInstanceTime\b/);
  assert.match(sourceRuntime, /\binstanceTime\b/);
  assert.match(sourceRuntime, /\bqualityScaledRenderRequest\b/);
  assert.doesNotMatch(sourceRuntime, /function instanceTime\(/);
});

test("timing nodes own phase continuity without changing direct render calls", () => {
  const runtimeSource = readFileSync(new URL("../js/output/render-runtime-math.js", import.meta.url), "utf8");
  const generatorSource = readFileSync(new URL("../js/output/shader-generator-runtime.js", import.meta.url), "utf8");
  const first = nodeAdvanceRateClock(null, 10, 1);

  assert.deepEqual(nodeAdvanceRateClock(first, 11, 2), { baseTime: 11, time: 12 });
  assert.match(RateClockNode.parts[0].source, /function advanceRateClock/);
  assert.equal(VisualTimeScaleNode.capabilities.includes("timing"), true);
  assert.equal(InstanceTimeNode.capabilities.includes("live-fast-path"), true);
  assert.match(runtimeSource, /export \{ advanceRateClock, componentInstanceTime, globalVisualTimeScale, instanceTime \} from "\.\.\/libraries\/timing-engine\/index\.js"/);
  assert.doesNotMatch(runtimeSource, /function advanceRateClock|function instanceTimeOffset/);
  assert.match(generatorSource, /from "\.\.\/libraries\/timing-engine\/index\.js"/);
  assert.match(generatorSource, /this\.rateClocks = new Map\(\)/);
  assert.doesNotMatch(generatorSource, /new NodeInstance\(/);
});
