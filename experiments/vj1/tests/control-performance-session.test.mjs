import test from "node:test";
import assert from "node:assert/strict";

import { createControlPerformanceSession, summarizePerformanceHost } from "../js/control/control-performance-session.js";

test("control performance session owns sampling, host events, and report completion", () => {
  const state = { id: "state-a", fps: 60 };
  let completed = null;
  const activeChanges = [];
  const session = createControlPerformanceSession({
    getState: () => state,
    metricForState: (value, reason) => ({
      source: reason === "output-metrics" ? "output" : "preview",
      fps: value.fps,
      cpuMs: 4,
      gpuMs: 2,
      gpuSupported: true,
      renderCost: 0.25,
      profile: { componentRenders: 1 },
      diagnostic: { host: "preview" },
    }),
    diagnosticForState: (value) => ({ stateId: value.id }),
    onActiveChange: (active) => activeChanges.push(active),
    analyze: (value, samples) => ({ stateId: value.id, sampleCount: samples.length }),
    onComplete: (report, sampleCount) => { completed = { report, sampleCount }; },
  });

  assert.equal(session.start(), true);
  assert.equal(session.start(), false);
  assert.equal(session.isActive(), true);
  session.recordStateEvent("workspace");
  session.recordInteraction("live-input", { path: "chain.0.source.params.geometryDetail", value: 0.75 });
  session.recordUiRender(3);
  assert.equal(session.captureSample(state, "output-metrics"), true);
  const report = session.finish();

  assert.equal(session.isActive(), false);
  assert.equal(report.runtimeSamples.length, 2);
  assert.deepEqual(report.runtimeSamples[0].control, { stateId: "state-a" });
  assert.deepEqual(report.runtimeSamples[0].renderer, { host: "preview" });
  assert.deepEqual(report.runtimeSamples[1].control, { schema: "", unchangedSinceSample: 0 });
  assert.deepEqual(report.runtimeSamples[1].renderer, { schema: "", unchangedSinceSample: 0 });
  assert.deepEqual(report.timeline[0].control, { stateId: "state-a" });
  assert.deepEqual(report.timeline[1].interaction, {
    kind: "live-input",
    payload: { path: "chain.0.source.params.geometryDetail", value: 0.75 },
  });
  assert.deepEqual(report.analysis, { stateId: "state-a", sampleCount: 2 });
  assert.equal(report.host.uiRenderCount, 1);
  assert.deepEqual(report.host.topStateEvents, [{ reason: "workspace", count: 1 }]);
  assert.equal(completed.sampleCount, 2);
  assert.equal(completed.report, report);
  assert.deepEqual(activeChanges, [true, false]);
});

test("semantic diagnostics are never evaluated outside the bounded capture window", async () => {
  const state = { fps: 60 };
  let diagnosticCalls = 0;
  const activeChanges = [];
  const session = createControlPerformanceSession({
    getState: () => state,
    durationMs: 5,
    metricForState: () => ({ source: "preview", fps: 60, cpuMs: 1 }),
    diagnosticForState: () => {
      diagnosticCalls++;
      return { captured: true };
    },
    onActiveChange: (active) => activeChanges.push(active),
  });

  assert.equal(session.captureSample(state), false);
  assert.equal(diagnosticCalls, 0);
  session.start();
  assert.equal(diagnosticCalls, 1);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(session.captureSample(state), false);
  session.recordStateEvent("late");
  assert.equal(diagnosticCalls, 1);
  session.finish();
  assert.deepEqual(activeChanges, [true, false]);
});

test("performance host summary remains bounded and numeric", () => {
  const summary = summarizePerformanceHost({
    uiRenderMs: [1, 3, "bad"],
    eventLoopLagMs: [0, 5],
    longTasks: [{ durationMs: 12, name: "task" }],
    stateEvents: { update: 2 },
    signalSamples: [
      {
        categories: { compiles: 1, invalidations: 5 },
        reasons: { "compiles:component-a": 1, "invalidations:drag": 5 },
        totalPerSecond: 6,
        pressurePerSecond: 17,
      },
      {
        categories: { compiles: 1, transactions: 1 },
        reasons: { "compiles:component-a": 1, "transactions:update": 1 },
        totalPerSecond: 2,
        pressurePerSecond: 16,
      },
    ],
    memoryStartBytes: null,
  });
  assert.equal(summary.uiRenderCount, 2);
  assert.equal(summary.uiRenderMsAvg, 2);
  assert.equal(summary.eventLoopLagMsP95, 5);
  assert.equal(summary.longTaskTotalMs, 12);
  assert.equal(summary.stateEventCount, 2);
  assert.equal(summary.signalCategoriesPerSecondAvg.compiles, 1);
  assert.equal(summary.signalReasonsPerSecondAvg["invalidations:drag"], 2.5);
  assert.deepEqual(summary.signalTopPressureReasonsPerSecondAvg[0], {
    reason: "invalidations:drag",
    count: 2.5,
  });
});
