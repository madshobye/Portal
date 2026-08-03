import assert from "node:assert/strict";
import test from "node:test";
import { OutputFrameRuntime } from "../js/output/output-frame-runtime.js";
import { OutputStateRuntime } from "../js/output/output-state-runtime.js";

test("frame identity does not depend on presentation-owned GPU timing", () => {
  const frames = [];
  const runtime = new OutputFrameRuntime({
    profileRuntime: {
      beginFrame: (frameIndex) => frames.push(frameIndex),
    },
    state: null,
  });

  assert.doesNotThrow(() => runtime.begin(100));
  assert.equal(runtime.frameIndex, 1);
  assert.deepEqual(frames, [1]);
});

function stateRuntimeFixture(
  initialState = null,
  { visualDefinitionsChanged = false } = {},
) {
  const calls = [];
  const host = {
    invalidatePresentation: (reason) => calls.push(`invalidate:${reason}`),
    visualNodeRuntime: {
      rebuild: (state) => {
        calls.push(["visual", state]);
        return visualDefinitionsChanged;
      },
    },
    transitionRuntime: {
      rebuild: () => calls.push("transition"),
    },
    componentProgramRuntime: {
      rebuild: (state) => calls.push(["components", state]),
      ensureStateRoots: (state) => calls.push(["ensure-components", state]),
      rebuildLookups: (state) => calls.push(["lookups", state]),
    },
    mappingProgramRuntime: {
      rebuild: (state) => calls.push(["mapping-programs", state]),
    },
    presentationRuntime: {
      shouldUseThumbnailPreview: () =>
        host.state?.ui?.thumbnailPreview === true,
    },
    thumbnailRuntime: {
      transformBaselines: new Map([["old", {}]]),
      captureEditTransformBaselines: () => calls.push("capture-baselines"),
      invalidateSelectedComponent: () => calls.push("invalidate-thumbnail"),
    },
    resourceRuntime: {
      applyPixelDensity: () => calls.push("density"),
      applyGlobalFont: () => calls.push("font"),
      createBuffers: () => calls.push("buffers"),
    },
    mappingRuntime: {
      create: () => calls.push("mapping-create"),
      captureState: () => {
        calls.push("mapping-capture");
        return { marker: "previous" };
      },
      reconcileState: (previous) =>
        calls.push(["mapping-reconcile", previous]),
    },
    livePatchRuntime: {
      clear: () => calls.push("live-clear"),
    },
    surfaceRuntime: {
      retainPresentedBranchForTransitions: (previous, next) =>
        calls.push(["retain-transition-branch", previous, next]),
    },
    previewInteraction: {
      reconcileIncomingState: (state) => {
        calls.push(["interaction-reconcile", state]);
        return state;
      },
    },
    presentationGeometry: {
      assignViewport: (render) => calls.push(["viewport", render]),
    },
    sourceRuntime: {
      invalidateStructure: () => calls.push("source-structure"),
    },
    frameRuntime: {
      pruneComponentTimes: () => calls.push("component-times"),
    },
    componentRenderRuntime: {
      clear: () => calls.push("component-render-clear"),
    },
    mediaRuntime: {
      releaseCameraInput: () => calls.push("camera-release"),
    },
  };
  const runtime = new OutputStateRuntime(host);
  runtime.current = initialState;
  Object.defineProperty(host, "state", {
    get: () => runtime.current,
    set: (state) => runtime.replace(state),
  });
  return { host, runtime, calls };
}

test("state initialization compiles once before creating presentation resources", () => {
  const { runtime, calls } = stateRuntimeFixture();
  const state = {
    render: { width: 640, height: 360 },
    ui: { thumbnailPreview: true },
  };

  assert.strictEqual(runtime.initialize(state, { normalized: true }), state);
  assert.deepEqual(calls, [
    ["visual", state],
    "transition",
    ["components", state],
    ["mapping-programs", state],
    ["lookups", state],
    "capture-baselines",
    "density",
    "font",
    "buffers",
    "mapping-create",
  ]);
});

test("state activation publishes one reconciled snapshot before rebuilding retained programs", () => {
  const previous = {
    render: { hostViewport: { width: 640, height: 360 } },
    ui: { thumbnailPreview: false },
  };
  const next = {
    render: { hostViewport: { width: 1280, height: 720 } },
    ui: { thumbnailPreview: true },
  };
  const { runtime, calls } = stateRuntimeFixture(previous);

  assert.strictEqual(runtime.activate(next, { normalized: true }), next);
  assert.strictEqual(runtime.current, next);
  assert.deepEqual(calls, [
    "invalidate:state",
    "mapping-capture",
    ["retain-transition-branch", previous, next],
    "live-clear",
    ["interaction-reconcile", next],
    ["viewport", next.render],
    "source-structure",
    "component-times",
    ["visual", next],
    "transition",
    ["components", next],
    ["mapping-programs", next],
    ["lookups", next],
    "camera-release",
    "capture-baselines",
    ["mapping-reconcile", { marker: "previous" }],
    "invalidate-thumbnail",
  ]);
});

test("leaving thumbnail mode clears retained edit baselines", () => {
  const previous = {
    render: { width: 640, height: 360 },
    ui: { thumbnailPreview: true },
  };
  const next = {
    render: { width: 640, height: 360 },
    ui: { thumbnailPreview: false },
  };
  const { runtime, host } = stateRuntimeFixture(previous);

  runtime.activate(next, { normalized: true });

  assert.equal(host.thumbnailRuntime.transformBaselines.size, 0);
});

test("UI activation retains compiled project programs and only ensures the selected Component root", () => {
  const previous = {
    render: { width: 640, height: 360 },
    ui: { selectedComponentId: "component-a" },
  };
  const next = {
    ...previous,
    render: { ...previous.render, previewViewportZoom: 1 },
    ui: { selectedComponentId: "component-b" },
  };
  const { runtime, calls } = stateRuntimeFixture(previous);

  assert.strictEqual(runtime.activateUi(next, { normalized: true }), next);
  assert.strictEqual(runtime.current, next);
  assert.deepEqual(calls, [
    "invalidate:ui-state",
    ["interaction-reconcile", next],
    ["viewport", next.render],
    ["ensure-components", next],
    ["lookups", next],
    "invalidate-thumbnail",
  ]);
});

test("Mapping activation retains visual and Component programs while rebuilding route geometry", () => {
  const previous = {
    mappings: [{ id: "mapping-a", surfaces: [{ id: "surface-a", x: 0 }] }],
    ui: { selectedMappingId: "mapping-a" },
  };
  const next = {
    ...previous,
    mappings: [{ id: "mapping-a", surfaces: [{ id: "surface-a", x: 0.25 }] }],
  };
  const { runtime, calls } = stateRuntimeFixture(previous);

  assert.strictEqual(runtime.activateMapping(next, { normalized: true }), next);
  assert.strictEqual(runtime.current, next);
  assert.deepEqual(calls, [
    "invalidate:mapping-state",
    "mapping-capture",
    ["interaction-reconcile", next],
    ["mapping-programs", next],
    ["mapping-reconcile", { marker: "previous" }],
    "invalidate-thumbnail",
  ]);
});

test("Live projection activation atomically adds reachable roots and replaces Mapping geometry", () => {
  const previous = {
    surfaces: [{ id: "live-monitor" }],
    render: { width: 640, height: 360 },
    ui: { workspace: "live", live: { previewSurfaceId: "__mapping__" } },
  };
  const next = {
    ...previous,
    surfaces: [{ id: "surface-a" }, { id: "surface-direct-output-main" }],
    ui: { workspace: "live", live: { previewSurfaceId: "surface-a" } },
  };
  const { runtime, calls } = stateRuntimeFixture(previous);

  assert.strictEqual(runtime.activateProjection(next, { normalized: true }), next);
  assert.strictEqual(runtime.current, next);
  assert.deepEqual(calls, [
    "invalidate:projection-state",
    "mapping-capture",
    ["interaction-reconcile", next],
    ["viewport", next.render],
    ["ensure-components", next],
    ["mapping-programs", next],
    ["lookups", next],
    ["mapping-reconcile", { marker: "previous" }],
    "invalidate-thumbnail",
  ]);
});

test("media catalog activation retains every compiled program", () => {
  const previous = {
    media: [{ id: "media/old.png", size: 10 }],
    nodes: { definitions: [] },
  };
  const next = {
    ...previous,
    media: [
      { id: "media/old.png", size: 10 },
      { id: "media/new.png", size: 20 },
    ],
  };
  const { runtime, calls } = stateRuntimeFixture(previous);

  assert.strictEqual(runtime.activateAssets(next, { normalized: true }), next);
  assert.strictEqual(runtime.current, next);
  assert.deepEqual(calls, [
    "invalidate:asset-catalog-state",
    ["interaction-reconcile", next],
    ["visual", next],
  ]);
});

test("project shader activation rebuilds only executable visual closures and invalidates stable frames", () => {
  const previous = {
    media: [],
    nodes: { definitions: [{ id: "project.old", version: "1.0.0" }] },
  };
  const next = {
    ...previous,
    nodes: { definitions: [{ id: "project.new", version: "1.0.0" }] },
  };
  const { runtime, calls } = stateRuntimeFixture(previous, {
    visualDefinitionsChanged: true,
  });

  assert.strictEqual(runtime.activateAssets(next, { normalized: true }), next);
  assert.strictEqual(runtime.current, next);
  assert.deepEqual(calls, [
    "invalidate:asset-catalog-state",
    ["interaction-reconcile", next],
    ["visual", next],
    "transition",
    ["components", next],
    ["lookups", next],
    "component-render-clear",
    "invalidate-thumbnail",
  ]);
});
