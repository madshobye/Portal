import assert from "node:assert/strict";
import test from "node:test";

import {
  createSignalLoadMeter,
  mergeSignalLoadSnapshots,
} from "../js/metrics/signal-load-meter.js";

test("signal load is a rolling one-second architectural meter", () => {
  let now = 0;
  const meter = createSignalLoadMeter({ now: () => now });
  meter.record("transactions", 2, "chain-transform");
  meter.record("previewPresentations", 60, "component");
  meter.record("cacheHits", 8, "component-stable");

  const active = meter.snapshot();
  assert.equal(active.totalPerSecond, 70);
  assert.equal(active.categories.transactions, 2);
  assert.equal(active.categories.previewPresentations, 60);
  assert.equal(active.pressurePerSecond, 8, "expected presentation and reuse throughput does not create signal pressure");
  assert.deepEqual(active.topReasons[0], {
    reason: "previewPresentations:component",
    count: 60,
  });

  now = 1100;
  assert.equal(meter.snapshot().totalPerSecond, 0, "events age out without a rendered-frame reset");
});

test("signal snapshots merge control, preview, and output scopes", () => {
  const merged = mergeSignalLoadSnapshots(
    { categories: { transactions: 3 }, reasons: { "transactions:move": 3 } },
    { categories: { invalidations: 7, previewPresentations: 60 } },
    { categories: { compiles: 2, outputPresentations: 30 } },
  );
  assert.equal(merged.categories.transactions, 3);
  assert.equal(merged.categories.invalidations, 7);
  assert.equal(merged.categories.compiles, 2);
  assert.equal(merged.totalPerSecond, 102);
  assert.equal(merged.pressurePerSecond, 43);
});
