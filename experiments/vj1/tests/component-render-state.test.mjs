import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  effectParamState,
  chainLayerState,
  collectMediaIdsFromSource,
  componentRuntimeTimeKey,
  createMediaReadinessStatus,
  renderBufferKey,
  runtimeMediaStateForSource,
  staticComponentGraphMediaState,
  staticComponentGraphState,
} from "../js/output/component-render-state.js";

test("canonical effect params override the legacy top-level amount", () => {
  assert.deepEqual(effectParamState({ amount: 0.2, params: { amount: 0.8, radius: 4 } }), {
    amount: 0.8,
    radius: 4,
  });
  assert.deepEqual(effectParamState({ amount: 0.2 }), { amount: 0.2 });
});

test("component render signatures include nested dependencies without recursing through cycles", () => {
  const child = { id: "child", chain: [{ id: "child-source", kind: "source", source: { type: "media", mediaId: "image-b" } }] };
  const parent = { id: "parent", chain: [{ id: "child-ref", kind: "source", source: { type: "component", componentId: "child" } }] };
  child.chain.push({ id: "parent-ref", kind: "source", source: { type: "component", componentId: "parent" } });
  const graph = staticComponentGraphState(parent, [parent, child]);

  assert.equal(graph.id, "parent");
  assert.equal(graph.dependencies[0].id, "child");
  assert.deepEqual(graph.dependencies[0].dependencies[0], { id: "parent", cycle: true });
  assert.deepEqual(staticComponentGraphMediaState([
    { id: "image-b", path: "media/b.png", type: "image/png", size: 42 },
  ], parent, [parent, child]), [
    { id: "image-b", path: "media/b.png", type: "image/png", size: 42 },
  ]);
});

test("intrinsic component render state excludes only its root placement transform", () => {
  const child = { id: "child", transform: { x: 0.25, scale: 1.5 }, chain: [] };
  const parent = {
    id: "parent",
    transform: { y: -0.4 },
    chain: [{ id: "child-ref", kind: "source", source: { type: "component", componentId: "child" } }],
  };
  const graph = staticComponentGraphState(parent, [parent, child], new Set(), false);

  assert.equal("transform" in graph, false);
  assert.deepEqual(graph.dependencies[0].transform, { x: 0.25, y: 0, scale: 1.5, rotation: 0 });
});

test("canonical empty chains exclude legacy source state and media", () => {
  const component = {
    id: "empty",
    chain: [],
    source: { type: "media", mediaId: "legacy-hidden.png" },
    shaderChain: [{ id: "blur", params: { amount: 1 } }],
  };
  const graph = staticComponentGraphState(component, [component]);

  assert.equal("source" in graph, false);
  assert.equal("shaderChain" in graph, false);
  assert.deepEqual(staticComponentGraphMediaState([], component, [component]), []);
});

test("media signature helpers cover media-backed generators and runtime readiness", () => {
  const ids = collectMediaIdsFromSource({
    type: "generator",
    generatorId: "featureMorph",
    params: { imageAId: "a", imageBId: "b" },
  });
  collectMediaIdsFromSource({ type: "generator", generatorId: "tileTexture", params: { imageId: "tile" } }, ids);

  assert.deepEqual(Array.from(ids), ["a", "b", "tile"]);
  assert.deepEqual(runtimeMediaStateForSource(new Map([["tile", { ready: true }]]), {
    type: "generator",
    generatorId: "tileTexture",
    params: { imageId: "tile" },
  }), [{ id: "tile", present: true, ready: true, revision: 0, fileKey: "", error: "", kind: "loading" }]);
  assert.deepEqual(createMediaReadinessStatus(), {
    blocked: false,
    total: 0,
    mediaIds: new Set(),
    loadingIds: new Set(),
    missingIds: new Set(),
    errorIds: new Set(),
  });
});

test("runtime cache policy has one owner outside the output orchestrator", () => {
  const renderer = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const runtime = { cacheable: true, timeDependent: () => true, timeKey: (_params, context) => Math.floor(context.time) };

  assert.equal(renderBufferKey("component", 3, "source"), "component:3:source");
  assert.deepEqual(chainLayerState({ enabled: false, opacity: 0.5, blend: "screen" }), {
    enabled: false,
    transform: {},
    opacity: 0.5,
    blend: "screen",
  });
  assert.equal(componentRuntimeTimeKey({ runtime }, {}, { frame: 8, time: 2.75 }), 2);
  assert.equal(componentRuntimeTimeKey({ runtime: { cacheable: false } }, {}, { frame: 8, time: 2.75 }), 8);
  assert.match(renderer, /from "\.\/component-render-state\.js\?v=video-load-hold-1"/);
  assert.doesNotMatch(renderer, /function staticComponentGraphState\(/);
  assert.doesNotMatch(renderer, /function collectMediaIdsFromSource\(/);
});
