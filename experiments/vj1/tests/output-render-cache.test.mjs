import test from "node:test";
import assert from "node:assert/strict";

import { BoundedRenderTargetPool, CacheEngineNode, cacheEngineNodeProcess, OutputRenderCache } from "../js/libraries/cache-engine/render-cache/index.js";
import { NodeInstance } from "../js/libraries/node-engine/index.js";

test("render cache batches maintenance and disposes idle resources", () => {
  const cache = new OutputRenderCache();
  let removed = 0;
  cache.sources.set("source-a", { remove: () => removed++ });
  cache.touch("source", "source-a", 0);

  assert.equal(cache.prune(0), true);
  assert.equal(cache.prune(1), false);
  assert.equal(cache.prune(120), false, "fixed frame-count maintenance must not interrupt rendering");
  assert.equal(cache.prune(900), false);
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

test("small render-target pools evict old resize variants and dispose their GPU resources", () => {
  const removed = [];
  const pool = new BoundedRenderTargetPool({ maxItems: 2, idleFrames: 100 });
  const create = (key) => () => ({ key, remove: () => removed.push(key) });

  pool.acquire("640x360", 1, create("640x360"));
  pool.acquire("800x450", 2, create("800x450"));
  pool.acquire("960x540", 3, create("960x540"));

  assert.deepEqual([...pool.resources.keys()], ["800x450", "960x540"]);
  assert.deepEqual(removed, ["640x360"]);
  pool.dispose();
  assert.deepEqual(removed, ["640x360", "800x450", "960x540"]);
});

test("cache engine node owns policy while the renderer retains its direct fast path", () => {
  const cache = new OutputRenderCache();
  cacheEngineNodeProcess({ engine: cache, command: "touch", kind: "source", key: "a", frameIndex: 4 });

  assert.equal(cache.sourceUse.get("a"), 4);
  assert.match(CacheEngineNode.parts[0].source, /class OutputRenderCache/);
  assert.match(CacheEngineNode.parts[0].source, /class BoundedRenderTargetPool/);
  assert.match(CacheEngineNode.parts[0].source, /function staleRenderCacheKeys/);
});

test("cache engine node owns its cache when no optimized host instance is supplied", async () => {
  const node = new NodeInstance(CacheEngineNode, { parameters: { command: "touch" } });
  await node.run({ kind: "source", key: "owned", frameIndex: 7 });
  assert.equal(node.state.engine.sourceUse.get("owned"), 7);
  let removed = 0;
  node.state.engine.sources.set("owned", { remove: () => removed++ });
  node.dispose();
  assert.equal(removed, 1);
});
