import test from "node:test";
import assert from "node:assert/strict";

import { createControlPerformanceSession, summarizePerformanceHost } from "../js/control/control-performance-session.js";

test("control performance session owns sampling, host events, and report completion", () => {
  const state = { id: "state-a", fps: 60 };
  let completed = null;
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
    }),
    analyze: (value, samples) => ({ stateId: value.id, sampleCount: samples.length }),
    onComplete: (report, sampleCount) => { completed = { report, sampleCount }; },
  });

  assert.equal(session.start(), true);
  assert.equal(session.start(), false);
  assert.equal(session.isActive(), true);
  session.recordStateEvent("workspace");
  session.recordUiRender(3);
  assert.equal(session.captureSample(state, "output-metrics"), true);
  const report = session.finish();

  assert.equal(session.isActive(), false);
  assert.equal(report.runtimeSamples.length, 2);
  assert.deepEqual(report.analysis, { stateId: "state-a", sampleCount: 2 });
  assert.equal(report.host.uiRenderCount, 1);
  assert.deepEqual(report.host.topStateEvents, [{ reason: "workspace", count: 1 }]);
  assert.equal(completed.sampleCount, 2);
  assert.equal(completed.report, report);
});

test("performance host summary remains bounded and numeric", () => {
  const summary = summarizePerformanceHost({
    uiRenderMs: [1, 3, "bad"],
    eventLoopLagMs: [0, 5],
    longTasks: [{ durationMs: 12, name: "task" }],
    stateEvents: { update: 2 },
    memoryStartBytes: null,
  });
  assert.equal(summary.uiRenderCount, 2);
  assert.equal(summary.uiRenderMsAvg, 2);
  assert.equal(summary.eventLoopLagMsP95, 5);
  assert.equal(summary.longTaskTotalMs, 12);
  assert.equal(summary.stateEventCount, 2);
});
