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

test("live semantic diagnostics traverse renderer state only while explicitly enabled", () => {
  const profile = new OutputRenderProfile();
  let configurationReads = 0;
  const program = {
    id: "group-fire",
    configurationState() {
      configurationReads++;
      return [{ id: "draw", params: { detail: 12 } }];
    },
    forEachOperation(visitor) {
      visitor({ id: "draw", nodeId: "stl", configurationRevision: 4, configuration: { params: { detail: 12 } } });
    },
  };
  const host = {
    mode: "preview",
    outputId: "preview-main",
    state: { ui: { live: { selectedComponentId: "fire", parameterDiffs: { fire: { draw: { params: { detail: 12 } } } } } } },
    frameRuntime: { frameIndex: 20 },
    componentProgramRuntime: { programs: new Map([["fire", program]]) },
    surfaceRuntime: { transitionBranches: new Map() },
    livePatchRuntime: { fades: new Map() },
    resourceRuntime: { componentOutput: new Map() },
    componentRenderRuntime: { stableSignatures: new Map() },
    sourceRuntime: { nodeRuntimes: new Map() },
    readinessRuntime: { status: { blocked: false } },
  };

  assert.equal(profile.captureDiagnostic(host), null);
  assert.equal(configurationReads, 0);
  profile.setDiagnosticsEnabled(true);
  const diagnostic = profile.captureDiagnostic(host);
  assert.equal(configurationReads, 1);
  assert.equal(diagnostic.programs[0].operations[0].configurationRevision, 4);
  profile.setDiagnosticsEnabled(false);
  assert.equal(profile.captureDiagnostic(host), null);
  assert.equal(configurationReads, 1);
});

test("transition boundary diagnostics are filtered and consumed once per metrics packet", () => {
  const profile = new OutputRenderProfile();
  let unrelatedReads = 0;
  const relevantProgram = {
    id: "group-fire",
    configurationState: () => [{ id: "draw", params: { detail: 12 } }],
    forEachOperation: () => {},
  };
  const unrelatedProgram = {
    id: "group-other",
    configurationState() {
      unrelatedReads++;
      return [];
    },
    forEachOperation: () => {},
  };
  const programs = new Map([["fire", relevantProgram], ["other", unrelatedProgram]]);
  const transition = {
    id: "transition-fire",
    fromTargetId: "fire",
    toTargetId: "other",
  };
  const host = {
    mode: "preview",
    state: { surfaces: [{ id: "surface-a", componentId: "fire" }], liveTransition: transition, ui: { live: {} } },
    frameRuntime: { frameIndex: 20 },
    componentProgramRuntime: { programs },
    surfaceRuntime: { transitionBranches: new Map([["transition-fire", {
      state: { surfaces: [{ id: "surface-a", componentId: "fire" }] },
      programs: new Map([["fire", relevantProgram]]),
    }]]) },
    livePatchRuntime: { fades: new Map() },
    resourceRuntime: { componentOutput: new Map() },
    componentRenderRuntime: { stableSignatures: new Map() },
    sourceRuntime: { nodeRuntimes: new Map() },
    readinessRuntime: { status: {} },
  };

  profile.setDiagnosticsEnabled(true);
  profile.recordTransitionBoundary(host, transition, { programs });
  const first = profile.captureDiagnostic(host);
  const second = profile.captureDiagnostic(host);
  assert.equal(unrelatedReads, 0);
  assert.equal(first.programs.length, 1);
  assert.equal(first.live.transitions[0].fromTargetId, "fire");
  assert.equal(first.retainedTransitionBranches[0].programs.length, 1);
  assert.equal(first.transitionBoundaries[0].outgoingPrograms.length, 1);
  assert.equal(first.transitionBoundaries.length, 1);
  assert.equal(second.transitionBoundaries.length, 0);
});

test("live patch diagnostics retain bounded path resolution and compiled acknowledgement", () => {
  const profile = new OutputRenderProfile();
  const materialStep = {
    id: "group-stl/material",
    instanceId: "material",
    nodeId: "core.visual.lit-mesh-material-provider",
    parameters: {
      renderMode: "surface",
      surfaceColor: "#eb000080",
    },
  };
  const valueProgram = {
    steps: [materialStep],
    evaluationRevision: 7,
    ready: true,
    stepDependencyRevisions: new Map([[materialStep.id, 4]]),
    outputIdentities: new Map([["material.sceneMaterial", "material3d:lit-mesh@dependency-4"]]),
  };
  const program = {
    id: "group-stl",
    configurationState: () => [{ id: "stl-item", source: { params: { geometryDetail: 0.75 } } }],
    forEachOperation(visitor) {
      visitor({
        id: "stl-item",
        nodeId: "modelMedia",
        configurationRevision: 3,
        configuration: { source: { params: { geometryDetail: 0.75 } } },
        valueProgram,
      });
    },
  };
  const host = {
    state: { ui: { live: { selectedComponentId: "stl-component" } } },
    componentProgramRuntime: { programs: new Map([["stl-component", program]]) },
    surfaceRuntime: { transitionBranches: new Map() },
    livePatchRuntime: { fades: new Map() },
    resourceRuntime: { componentOutput: new Map() },
    componentRenderRuntime: { stableSignatures: new Map() },
    sourceRuntime: { nodeRuntimes: new Map([["stl-component:render", {
      outputVersion: 9,
      lastUsedFrame: 42,
      lastDirtyReason: "source",
      signature: "material3d:lit-mesh@dependency-4",
    }]]) },
    readinessRuntime: { status: {} },
  };
  const patch = {
    componentId: "stl-component",
    nodeId: "stl-item",
    path: "source.params.geometryDetail",
    value: 0.75,
  };

  profile.setDiagnosticsEnabled(true);
  profile.recordLivePatch(host, [patch], {
    applied: true,
    componentIds: ["stl-component"],
    configurationTargets: [{ componentId: "stl-component", nodeIds: ["stl-item"] }],
  }, { applied: true, configurationApplied: true });
  const diagnostic = profile.captureDiagnostic(host);

  assert.equal(diagnostic.livePatchTransactions[0].patches[0].path, patch.path);
  assert.equal(diagnostic.livePatchTransactions[0].programs[0].operations[0].configurationRevision, 3);
  assert.equal(
    diagnostic.livePatchTransactions[0].programs[0].operations[0]
      .retainedValues.steps[0].parameters.surfaceColor,
    "#eb000080",
  );
  assert.equal(diagnostic.cacheIdentity.sourceRuntimes[0].outputVersion, 9);
  assert.match(diagnostic.cacheIdentity.sourceRuntimes[0].signatureDigest, /^\d+:[0-9a-f]{8}$/);
  assert.equal(diagnostic.livePatchTransactions[0].result.applied, true);
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
