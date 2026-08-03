import test from "node:test";
import assert from "node:assert/strict";

import { createPresentationIdleLifecycle } from "../js/output/presentation-idle-lifecycle.js";

test("presentation lifecycle owns stable suspension and one-shot wake", () => {
  let stable = false;
  let starts = 0;
  let stops = 0;
  const lifecycle = createPresentationIdleLifecycle({
    canSuspend: () => stable,
    start: () => { starts += 1; },
    stop: () => { stops += 1; },
  });

  assert.equal(lifecycle.suspendIfStable(), false);
  stable = true;
  assert.equal(lifecycle.suspendIfStable(), true);
  assert.equal(lifecycle.suspended, true);
  assert.equal(lifecycle.suspendIfStable(), false);
  assert.equal(stops, 1);
  assert.equal(lifecycle.wake(), true);
  assert.equal(lifecycle.wake(), false);
  assert.equal(starts, 1);
});
