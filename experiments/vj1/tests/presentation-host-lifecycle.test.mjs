import test from "node:test";
import assert from "node:assert/strict";

import { createPresentationHostLifecycle } from "../js/output/presentation-host-lifecycle.js";

test("presentation hosts claim setup once and coalesce observed integer sizes", () => {
  let observerCallback = null;
  const observed = [];
  const unobserved = [];
  const frames = new Map();
  let nextFrame = 1;
  let resized = 0;
  class Observer {
    constructor(callback) { observerCallback = callback; }
    observe(target) { observed.push(target); }
    unobserve(target) { unobserved.push(target); }
    disconnect() {}
  }
  const lifecycle = createPresentationHostLifecycle({
    ResizeObserverClass: Observer,
    requestFrame(callback) {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    },
    cancelFrame(id) { frames.delete(id); },
    onResize() { resized++; },
  });
  const first = {};
  const second = {};

  assert.equal(lifecycle.claimSetup(), true);
  assert.equal(lifecycle.claimSetup(), false);
  lifecycle.observe(first);
  observerCallback([{ target: first, contentRect: { width: 640.9, height: 360.2 } }]);
  observerCallback([{ target: first, contentRect: { width: 640.1, height: 360.8 } }]);
  assert.equal(frames.size, 1);
  frames.get(1)();
  assert.equal(resized, 1);
  lifecycle.observe(second);
  assert.deepEqual(observed, [first, second]);
  assert.deepEqual(unobserved, [first]);
});

test("presentation host disposal cancels pending resize delivery", () => {
  let observerCallback = null;
  const frames = new Map();
  let cancelled = 0;
  class Observer {
    constructor(callback) { observerCallback = callback; }
    observe() {}
    disconnect() {}
  }
  const lifecycle = createPresentationHostLifecycle({
    ResizeObserverClass: Observer,
    requestFrame(callback) { frames.set(7, callback); return 7; },
    cancelFrame(id) { if (frames.delete(id)) cancelled++; },
  });
  lifecycle.observe({});
  observerCallback([{ contentRect: { width: 1, height: 1 } }]);
  lifecycle.dispose();
  assert.equal(cancelled, 1);
  assert.equal(frames.size, 0);
});
