import test from "node:test";
import assert from "node:assert/strict";

import { MediaInputLifecycle, MediaInputLifecycleNode } from "../js/libraries/media-engine/media-input-lifecycle/index.js";
import { compileJavaScriptNodeModule, NodeInstance } from "../js/libraries/node-engine/index.js";

test("media lifecycle class remains the allocation-stable renderer fast path", async () => {
  let ready = 0;
  const lifecycle = new MediaInputLifecycle({ idleGraceMs: 0, onReady: () => ready++ });
  lifecycle.beginFrame();
  assert.equal(lifecycle.acquire("camera-a", () => Promise.resolve({ remove() {} })), null);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(ready, 1);
  assert.equal(lifecycle.resource != null, true);
  lifecycle.release();
});

test("media lifecycle node executes the same owned acquire retry and release implementation", async () => {
  let removed = 0;
  const node = new NodeInstance(MediaInputLifecycleNode, { parameters: { idleGraceMs: 0 } });
  const first = await node.run({
    demand: true,
    signature: "camera-a",
    setup: () => Promise.resolve({ remove: () => removed++ }),
  });
  assert.match(first.status, /^requested:/);
  await Promise.resolve();
  await Promise.resolve();
  const ready = await node.run({ demand: true, signature: "camera-a", setup: () => null });
  assert.equal(ready.status, "ready");
  assert.equal(ready.resource, node.state.lifecycle.resource);
  node.dispose();
  assert.equal(removed, 1);
});

test("cache media and diagnostics style modules compile from editable multi-part node code", () => {
  const compiled = compileJavaScriptNodeModule(MediaInputLifecycleNode.parts, MediaInputLifecycleNode);
  assert.equal(typeof compiled.exports.MediaInputLifecycle, "function");
  assert.equal(typeof compiled.process, "function");
  assert.deepEqual(MediaInputLifecycleNode.parts.at(-1).dependsOn, ["media-input-lifecycle"]);
});
