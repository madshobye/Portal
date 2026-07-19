import test from "node:test";
import assert from "node:assert/strict";
import { analyzeVj1Project, compareVj1Metrics, createRuntimeHotspotSmoother, summarizeRuntimeHotPasses, summarizeRuntimeSamples } from "../js/metrics/component-metrics.js";
import {
  createComponentEffect,
  createComponentLayer,
  createDefaultComponent,
  createInitialState,
  createSceneFromState,
  sceneSourceNodeId,
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
  state.surfaces[0].sourceNodeId = sceneSourceNodeId(component.id);
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
  assert.equal(runtime.profile.stageCacheHitsAvg, 0);
  assert.equal(runtime.profile.slowPasses[0].passName, "Blur");
  assert.ok(runtime.bottlenecks.some((item) => item.scope === "runtime"));
});

test("groups bounded runtime pass samples into stable component and effect hotspots", () => {
  const hotspots = summarizeRuntimeHotPasses([
    { passSamples: [
      { type: "component", componentId: "comp-a", componentName: "Portrait", ms: 6 },
      { type: "shader-pass", componentId: "comp-a", componentName: "Portrait", chainItemId: "effect-instance-a", passId: "blur", passName: "Blur", ms: 2 },
    ] },
    { passSamples: [
      { type: "component", componentId: "comp-a", componentName: "Portrait", ms: 8 },
      { type: "shader-pass", componentId: "comp-a", componentName: "Portrait", chainItemId: "effect-instance-a", passId: "blur", passName: "Blur", ms: 4 },
    ] },
  ]);

  assert.equal(hotspots[0].name, "Portrait");
  assert.equal(hotspots[0].kind, "component");
  assert.equal(hotspots[0].msAvg, 7);
  assert.equal(hotspots[0].sampleCount, 2);
  assert.equal(hotspots[1].name, "Blur");
  assert.equal(hotspots[1].kind, "effect");
  assert.equal(hotspots[1].componentId, "comp-a");
  assert.equal(hotspots[1].chainItemId, "effect-instance-a");
});

test("keeps persistent instances of the same effect separately attributable", () => {
  const hotspots = summarizeRuntimeHotPasses([{ passSamples: [
    { type: "shader-pass", componentId: "comp-a", chainItemId: "blur-a", passId: "blur", passName: "Blur", ms: 3 },
    { type: "shader-pass", componentId: "comp-a", chainItemId: "blur-b", passId: "blur", passName: "Blur", ms: 1 },
  ] }]);
  assert.deepEqual(hotspots.map((item) => item.chainItemId), ["blur-a", "blur-b"]);
});

test("keeps preview and output hotspot rows separate", () => {
  const hotspots = summarizeRuntimeHotPasses([
    { runtimeSource: "preview", passSamples: [{ type: "component", componentId: "comp-a", componentName: "Portrait", ms: 2 }] },
    { runtimeSource: "output", passSamples: [{ type: "component", componentId: "comp-a", componentName: "Portrait", ms: 5 }] },
  ]);
  assert.equal(hotspots.length, 2);
  assert.equal(hotspots[0].runtimeSource, "output");
  assert.equal(hotspots[1].runtimeSource, "preview");
});

test("runtime hotspot smoother stabilizes close rankings and expires absent rows", () => {
  const smoother = createRuntimeHotspotSmoother({ alpha: 0.5, retentionUpdates: 2, reorderThreshold: 0.2 });
  const first = smoother.update([
    { key: "a", name: "A", msAvg: 4 },
    { key: "b", name: "B", msAvg: 3.8 },
  ], { scope: "preview:component-1", totalMs: 10, totalsBySource: { preview: 10 }, limit: 8 });
  assert.deepEqual(first.hotspots.map((item) => item.name), ["A", "B"]);
  assert.equal(first.totalsBySource.preview, 10);

  const second = smoother.update([
    { key: "a", name: "A", msAvg: 3.7 },
    { key: "b", name: "B", msAvg: 4.1 },
  ], { scope: "preview:component-1", totalMs: 12, totalsBySource: { preview: 12 }, limit: 8 });
  assert.deepEqual(second.hotspots.map((item) => item.name), ["A", "B"]);
  assert.equal(second.totalMs, 11);
  assert.equal(second.totalsBySource.preview, 11);

  smoother.update([], { scope: "preview:component-1", totalMs: 10, limit: 8 });
  const retained = smoother.update([], { scope: "preview:component-1", totalMs: 10, limit: 8 });
  assert.equal(retained.hotspots.length, 2);
  const expired = smoother.update([], { scope: "preview:component-1", totalMs: 10, limit: 8 });
  assert.equal(expired.hotspots.length, 0);
});

test("runtime summaries retain aggregate GPU timer statistics without per-pass claims", () => {
  const runtime = summarizeRuntimeSamples([
    { fps: 60, frameMs: 4, gpuMs: 3, gpuSupported: true, renderCost: 0.2 },
    { fps: 60, frameMs: 5, gpuMs: 5, gpuSupported: true, renderCost: 0.25 },
  ]);
  assert.equal(runtime.gpuSampleCount, 2);
  assert.equal(runtime.gpuMsAvg, 4);
  assert.equal(runtime.gpuMsP95, 5);
});

test("summarizes output transport latency and resyncs independently from rendering", () => {
  const runtime = summarizeRuntimeSamples([
    { fps: 60, frameMs: 2, renderCost: 0.12, transport: { stateMessages: 1, patchMessages: 2, patches: 3, lastRevision: 4, deliveryMsAvg: 4, deliveryMsMax: 22, applyMsAvg: 1, applyMsMax: 2, renderMsAvg: 8, renderMsMax: 12, endToEndMsAvg: 13, endToEndMsMax: 38, resyncs: { revision: 1, path: 0, other: 0 } } },
    { fps: 60, frameMs: 2, renderCost: 0.12, transport: { stateMessages: 0, patchMessages: 1, patches: 1, lastRevision: 5, deliveryMsAvg: 2, deliveryMsMax: 3, applyMsAvg: 1, applyMsMax: 1, renderMsAvg: 6, renderMsMax: 8, endToEndMsAvg: 9, endToEndMsMax: 12, resyncs: { revision: 0, path: 0, other: 0 } } },
  ]);

  assert.equal(runtime.transport.stateMessages, 1);
  assert.equal(runtime.transport.patchMessages, 3);
  assert.equal(runtime.transport.patches, 4);
  assert.equal(runtime.transport.lastRevision, 5);
  assert.equal(runtime.transport.deliveryMsMax, 22);
  assert.equal(runtime.transport.endToEndMsMax, 38);
  assert.equal(runtime.transport.resyncCount, 1);
  assert.ok(runtime.bottlenecks.some((item) => item.scope === "transport"));
});

test("compares current metrics against an older run", () => {
  const previous = analyzeVj1Project(createInitialState());
  const currentState = createInitialState();
  currentState.components[0].resolutionScale = 2;
  currentState.render.pixelDensity = 2;
  const current = analyzeVj1Project(currentState);
  const comparison = compareVj1Metrics(current, previous);
  assert.ok(comparison.deltas.estimatedWork.change > 0);
  assert.ok(comparison.addedBottlenecks.length >= 1);
});
