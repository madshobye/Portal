import test from "node:test";
import assert from "node:assert/strict";
import { analyzeVj1Project, compareVj1Metrics, summarizeRuntimeSamples } from "../js/metrics/component-metrics.js";
import {
  createComponentEffect,
  createComponentLayer,
  createDefaultComponent,
  createInitialState,
  createSceneFromState,
} from "../js/domain/models.js?v=world-frame-27";

test("analyzes component graph shape and missing media", () => {
  const state = createInitialState();
  const component = createDefaultComponent(0);
  component.name = "Stress";
  component.chain = [
    createComponentLayer(0, { type: "media", mediaId: "media/missing.mov" }),
    createComponentEffect("ripple"),
    createComponentEffect("rgbSplit"),
    createComponentEffect("kaleido"),
    createComponentEffect("pixelate"),
    createComponentEffect("custom"),
    createComponentEffect("blur"),
  ];
  state.components = [component];
  state.surfaces[0].componentId = component.id;
  state.surfaces[1].enabled = false;
  state.scenes = [createSceneFromState(state, "Scene 1")];

  const metrics = analyzeVj1Project(state);
  assert.equal(metrics.aggregate.componentCount, 1);
  assert.equal(metrics.aggregate.activeSurfaceCount, 1);
  assert.equal(metrics.components[0].effects.enabled, 6);
  assert.equal(metrics.components[0].sources.missingMedia, 1);
  assert.ok(metrics.costliestChainItems.length >= 1);
  assert.equal(metrics.aggregate.topCostContributor.componentName, "Stress");
  assert.ok(metrics.engineHotspots.some((item) => item.step === "Sequential shader passes"));
  assert.ok(metrics.engineHotspots.some((item) => item.step === "Heavy shader components"));
  assert.ok(metrics.bottlenecks.some((item) => item.severity === "critical" && item.message.includes("missing")));
  assert.ok(metrics.bottlenecks.some((item) => item.scope === "Stress" && item.message.includes("enabled effects")));
});

test("flags mapping problems against active surfaces", () => {
  const state = createInitialState();
  state.surfaces[0].componentId = state.components[0].id;
  state.mappings.local = {
    surfaces: [{
      id: state.surfaces[0].id,
      name: state.surfaces[0].id,
      corners: [
        { x: 10, y: 10 },
        { x: 10, y: 10 },
        { x: 10, y: 10 },
        { x: 10, y: 10 },
      ],
    }],
  };

  const metrics = analyzeVj1Project(state);
  assert.equal(metrics.mapping.degenerateSurfaceCount, 1);
  assert.ok(metrics.bottlenecks.some((item) => item.scope.startsWith("mapping:")));
});

test("summarizes runtime sample bottlenecks", () => {
  const runtime = summarizeRuntimeSamples([
    { fps: 38, frameMs: 31, renderCost: 1.3, profile: { shaderPasses: 5, shaderChains: 1, maxShaderChainLength: 5, shaderHandoffs: 0, shaderMs: 8, componentMs: 12, componentWallMs: 7, passSamples: [{ passName: "Blur", ms: 3.2, width: 800, height: 450, source: "webgl" }] } },
    { fps: 42, frameMs: 28, renderCost: 1.1, profile: { shaderPasses: 5, shaderChains: 1, maxShaderChainLength: 5, shaderHandoffs: 0, shaderMs: 7, componentMs: 11, componentWallMs: 6, passSamples: [{ passName: "Dilate", ms: 2.8, width: 800, height: 450, source: "webgl" }] } },
    { fps: 40, frameMs: 26, renderCost: 1.2, profile: { shaderPasses: 4, shaderChains: 1, maxShaderChainLength: 4, shaderHandoffs: 0, shaderMs: 6, componentMs: 10, componentWallMs: 5, passSamples: [{ passName: "Erode", ms: 2.4, width: 800, height: 450, source: "webgl" }] } },
  ]);
  assert.equal(runtime.sampleCount, 3);
  assert.ok(runtime.fpsAvg < 45);
  assert.equal(runtime.profile.maxShaderChainLengthMax, 5);
  assert.equal(runtime.profile.shaderHandoffsAvg, 0);
  assert.equal(runtime.profile.componentMsP95, 7);
  assert.equal(runtime.profile.slowPasses[0].passName, "Blur");
  assert.ok(runtime.bottlenecks.some((item) => item.scope === "runtime"));
});

test("compares current metrics against an older run", () => {
  const previous = analyzeVj1Project(createInitialState());
  const currentState = createInitialState();
  currentState.render.componentTexture = { width: 2048, height: 2048 };
  const current = analyzeVj1Project(currentState);
  const comparison = compareVj1Metrics(current, previous);
  assert.ok(comparison.deltas.estimatedWork.change > 0);
  assert.ok(comparison.addedBottlenecks.length >= 1);
});
