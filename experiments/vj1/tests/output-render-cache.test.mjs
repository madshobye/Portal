import test from "node:test";
import assert from "node:assert/strict";

import { OutputRenderCache } from "../js/output/output-render-cache.js";

test("render cache batches maintenance and disposes idle resources", () => {
  const cache = new OutputRenderCache();
  let removed = 0;
  cache.sources.set("source-a", { remove: () => removed++ });
  cache.touch("source", "source-a", 0);

  assert.equal(cache.prune(0), true);
  assert.equal(cache.prune(1), false);
  assert.equal(cache.sources.has("source-a"), true);
  assert.equal(cache.prune(901), true);
  assert.equal(cache.sources.has("source-a"), false);
  assert.equal(removed, 1);
});

test("render cache enforces hard GPU limits without evicting the current frame", () => {
  const cache = new OutputRenderCache();
  const removed = [];
  for (let index = 0; index < 65; index++) {
    const key = `gpu-${index}`;
    cache.gpuBuffers.set(key, { remove: () => removed.push(key) });
    cache.touch("gpu-buffer", key, index + 1);
  }

  assert.equal(cache.prune(65), true);
  assert.equal(cache.gpuBuffers.size, 64);
  assert.deepEqual(removed, ["gpu-0"]);
  assert.equal(cache.gpuBuffers.has("gpu-64"), true);
});
