import test from "node:test";
import assert from "node:assert/strict";

import { createOutputTransportProfiler } from "../js/services/output-transport-profiler.js";

test("output transport profiler separates delivery apply and first-render latency", () => {
  let clock = 1010;
  const profiler = createOutputTransportProfiler({ now: () => clock });
  const meta = profiler.receive({ kind: "patch", revision: 3, patchCount: 2, sentAtMs: 1000 });
  clock = 1013;
  profiler.applied(meta);
  clock = 1020;
  profiler.rendered(3);

  const sample = profiler.snapshot({ reset: false });
  assert.equal(sample.patchMessages, 1);
  assert.equal(sample.patches, 2);
  assert.equal(sample.deliveryMsAvg, 10);
  assert.equal(sample.applyMsAvg, 3);
  assert.equal(sample.renderMsAvg, 7);
  assert.equal(sample.endToEndMsAvg, 20);
  assert.equal(sample.lastRevision, 3);
});

test("output transport profiler reports interval traffic and cumulative resync totals", () => {
  let clock = 2005;
  const profiler = createOutputTransportProfiler({ now: () => clock });
  profiler.receive({ kind: "state", revision: 7, sentAtMs: 2000 });
  profiler.resync("revision");
  const first = profiler.snapshot();
  const second = profiler.snapshot();

  assert.equal(first.stateMessages, 1);
  assert.equal(first.resyncs.revision, 1);
  assert.equal(second.stateMessages, 0);
  assert.equal(second.resyncs.revision, 0);
  assert.equal(second.totals.stateMessages, 1);
  assert.equal(second.totals.resyncs.revision, 1);
});
