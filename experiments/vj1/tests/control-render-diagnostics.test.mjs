import test from "node:test";
import assert from "node:assert/strict";

import {
  createControlRenderDiagnostics,
  dominantRenderPhase,
  renderDurationBand,
} from "../js/control/control-render-diagnostics.js";

test("control long-render diagnostics identify the dominant UI phase and stay bounded", () => {
  let timestamp = 1000;
  const records = [];
  const reporter = createControlRenderDiagnostics({
    diagnostics: {
      record(level, values, source, occurrences) {
        records.push({ level, value: values[0], source, occurrences });
      },
    },
    now: () => timestamp,
    cooldownMs: 5000,
  });

  assert.equal(reporter.report({ durationMs: 49, phases: [{ name: "preview", durationMs: 48 }] }), false);
  assert.equal(reporter.report({
    durationMs: 57,
    phases: [
      { name: "inspector", durationMs: 8 },
      { name: "preview", durationMs: 44 },
    ],
    reason: "live:scene",
    topic: "live",
    workspace: "live",
  }), true);
  assert.equal(records[0].level, "warning");
  assert.equal(records[0].source, "control-ui");
  assert.equal(records[0].value.code, "VJ1_CONTROL_UI_LONG_RENDER");
  assert.equal(records[0].value.dominantPhase, "preview");
  assert.equal(records[0].value.cause, "live:scene");
  assert.equal(records[0].value.durationBand, "50–99 ms");

  timestamp += 100;
  assert.equal(reporter.report({
    durationMs: 65,
    phases: [{ name: "preview", durationMs: 55 }],
    reason: "live:scene",
    topic: "live",
    workspace: "live",
  }), false, "repeated transition warnings do not make the diagnostics UI perform more work");
  timestamp += 6000;
  assert.equal(reporter.report({
    durationMs: 68,
    phases: [{ name: "preview", durationMs: 56 }],
    reason: "live:scene",
    topic: "live",
    workspace: "live",
  }), true);
  assert.equal(records[1].occurrences, 2, "the next visible report carries the suppressed repetition count");
});

test("control render diagnostics use stable duration bands", () => {
  assert.deepEqual(dominantRenderPhase([
    { name: "rail", durationMs: 3 },
    { name: "studio", durationMs: 12 },
  ]), { name: "studio", durationMs: 12 });
  assert.equal(renderDurationBand(49.9), "<50 ms");
  assert.equal(renderDurationBand(50), "50–99 ms");
  assert.equal(renderDurationBand(100), "100–199 ms");
  assert.equal(renderDurationBand(500), "500+ ms");
});
