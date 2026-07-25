import test from "node:test";
import assert from "node:assert/strict";

import { OutputRenderProfile } from "../js/output/output-render-profile.js";
import { OutputPresentationMetrics } from "../js/output/output-presentation-metrics.js";

test("render profiling samples at its configured cadence", () => {
  const profile = new OutputRenderProfile({ sampleInterval: 2 });
  profile.beginFrame(1);
  assert.equal(profile.collectDetailed, false);
  assert.equal(profile.measure("sourceMs", { type: "source" }, () => 42), 42);
  assert.equal(profile.frameProfile.passSamples.length, 0);

  profile.beginFrame(2);
  assert.equal(profile.collectDetailed, true);
  profile.measure("sourceMs", { type: "source" }, () => 42);
  assert.equal(profile.frameProfile.passSamples.length, 1);
  assert.equal(profile.frameProfile.passSamples[0].type, "source");
});

test("nested component profiling preserves ownership and counts wall time once", () => {
  const profile = new OutputRenderProfile({ sampleInterval: 1 });
  profile.beginFrame(1);
  profile.measureComponent({ type: "component", componentId: "parent", componentName: "Parent" }, () => {
    assert.deepEqual(profile.activeComponentIdentity(), { componentId: "parent", componentName: "Parent" });
    profile.measureComponent({ type: "component", componentId: "child", componentName: "Child" }, () => {
      assert.deepEqual(profile.activeComponentIdentity(), { componentId: "child", componentName: "Child" });
    });
  });

  assert.equal(profile.frameProfile.componentRenders, 2);
  assert.ok(profile.frameProfile.componentMs >= profile.frameProfile.componentWallMs);
  const finished = profile.finishFrame(performance.now());
  assert.equal(finished.passSamples.length, 2);
  assert.deepEqual(profile.activeComponentIdentity(), {});
});

test("aggregate CPU and Overall metrics use the explicit frame-runtime start", () => {
  const previousFrameRate = globalThis.frameRate;
  const previousMillis = globalThis.millis;
  globalThis.frameRate = () => 60;
  globalThis.millis = () => 1000;
  const published = [];
  const host = {
    mode: "component",
    state: {
      global: { showHud: false },
      render: { maxFrameRate: 60 },
      ui: {},
    },
    presentationRuntime: {
      gpuTimer: {
        latestMs: 4.2,
        sampleId: 1,
        supported: true,
      },
      shouldUseThumbnailPreview: () => false,
    },
    presentationGeometry: {
      viewport: { x: 0, y: 0 },
      pixelDensity: () => 1,
      displayCanvasSize: () => ({ width: 640, height: 360 }),
      viewportLabel: () => "",
    },
    resourceRuntime: { lastPixelDensity: 1 },
    profileRuntime: { lastFrameProfile: { componentWallMs: 1.6 } },
    sendMetrics: (metrics) => published.push(metrics),
    hud: null,
  };
  try {
    const metrics = new OutputPresentationMetrics(host);
    const frameStart = performance.now() - 5;
    metrics.update({ frameStart });
    assert.equal(published.length, 1);
    assert.ok(published[0].frameMs >= 4);
    assert.ok(published[0].renderCost > 0);
    assert.equal(published[0].gpuMs, 4.2);
    assert.throws(
      () => metrics.update(),
      /VJ1_PRESENTATION_FRAME_START_REQUIRED/,
      "missing frame ownership cannot silently publish CPU 0 and Overall 0",
    );
  } finally {
    globalThis.frameRate = previousFrameRate;
    globalThis.millis = previousMillis;
  }
});
