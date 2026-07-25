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
  runtimeMediaStateForIds,
  staticCompiledComponentGraphMediaState,
  staticCompiledComponentGraphState,
} from "../js/output/component-render-state.js";
import { compileComponentRenderPrograms } from "../js/libraries/composition-engine/index.js";

test("effect state has one canonical params authority", () => {
  assert.deepEqual(effectParamState({ amount: 0.2, params: { amount: 0.8, radius: 4 } }), {
    amount: 0.8,
    radius: 4,
  });
  assert.deepEqual(effectParamState({ amount: 0.2 }), {});
});

test("component render signatures include nested dependencies without recursing through cycles", () => {
  const child = {
    id: "child",
    chain: [{
      id: "child-source",
      kind: "source",
      source: {
        type: "generator",
        generatorId: "mediaImage",
        params: { mediaId: "image-b" },
      },
    }],
  };
  const parent = { id: "parent", chain: [{ id: "child-ref", kind: "source", source: { type: "component", componentId: "child" } }] };
  child.chain.push({ id: "parent-ref", kind: "source", source: { type: "component", componentId: "parent" } });
  const components = [parent, child];
  const programs = compileComponentRenderPrograms(components, []);
  const graph = staticCompiledComponentGraphState(parent, programs, components);

  assert.equal(graph.id, "parent");
  assert.equal(graph.dependencies[0].id, "child");
  assert.deepEqual(graph.dependencies[0].dependencies[0], { id: "parent", cycle: true });
  assert.deepEqual(staticCompiledComponentGraphMediaState([
    { id: "image-b", path: "media/b.png", type: "image/png", size: 42 },
  ], parent, programs, components), [
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
  const components = [parent, child];
  const programs = compileComponentRenderPrograms(components, []);
  const graph = staticCompiledComponentGraphState(parent, programs, components, new Set(), false);

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
  const programs = compileComponentRenderPrograms([component], []);
  const graph = staticCompiledComponentGraphState(component, programs, [component]);

  assert.deepEqual(graph.program.operations, []);
  assert.deepEqual(staticCompiledComponentGraphMediaState([], component, programs, [component]), []);
});

test("media signature helpers discover typed media parameters without generator-name policy", () => {
  const ids = collectMediaIdsFromSource({
    type: "generator",
    generatorId: "featureMorph",
    params: { imageAId: "a", imageBId: "b" },
  });
  collectMediaIdsFromSource({ type: "generator", generatorId: "tileTexture", params: { imageId: "tile" } }, ids);
  collectMediaIdsFromSource({
    type: "generator",
    generatorId: "project.visual.any",
    params: { nested: { textureMaskId: "mask" }, unrelatedId: "ignore" },
  }, ids);

  assert.deepEqual(Array.from(ids), ["a", "b", "tile", "mask"]);
  assert.deepEqual(
    runtimeMediaStateForIds(new Map([["tile", { ready: true }]]), new Set(["tile"])),
    [{ id: "tile", present: true, ready: true, revision: 0, invalidationKey: 0, fileKey: "", error: "", kind: "loading" }],
  );
  const videoElement = { tagName: "VIDEO", videoWidth: 640, videoHeight: 360, readyState: 4, currentTime: 9 };
  assert.deepEqual(runtimeMediaStateForIds(new Map([["clip", {
    ready: true,
    video: { elt: videoElement },
    videoFrameDriven: true,
    videoFrameRevision: 7,
    videoFrameMediaTime: 1.25,
  }]]), new Set(["clip"])), [{
    id: "clip",
    present: true,
    ready: true,
    revision: 0,
    invalidationKey: { asset: 0, frame: 7, timeMs: 1250 },
    videoFrameRevision: 7,
    fileKey: "",
    error: "",
    kind: "video",
  }]);
  assert.deepEqual(createMediaReadinessStatus(), {
    blocked: false,
    total: 0,
    mediaIds: new Set(),
    loadingIds: new Set(),
    missingIds: new Set(),
    errorIds: new Set(),
    resources: new Map(),
    pendingResourceIds: new Set(),
    errorResourceIds: new Set(),
    controlSignals: new Map(),
    pendingControlSignalIds: new Set(),
    errorControlSignalIds: new Set(),
    unsupportedControlSignalIds: new Set(),
    requiredControlSignalIds: new Set(),
  });
});

test("runtime cache policy has one owner outside the output orchestrator", () => {
  const renderer = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const componentRuntime = readFileSync(new URL("../js/output/component-render-runtime.js", import.meta.url), "utf8");
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
  assert.match(componentRuntime, /from "\.\/component-render-state\.js\?v=[^"]+"/);
  assert.doesNotMatch(renderer, /from "\.\/component-render-state\.js/);
  assert.doesNotMatch(renderer, /function staticComponentGraphState\(/);
  assert.doesNotMatch(renderer, /function collectMediaIdsFromSource\(/);
  assert.doesNotMatch(componentRuntime, /\bcomponent\.chain\b/);
});
