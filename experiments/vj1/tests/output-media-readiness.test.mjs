import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { collectOutputMediaReadiness } from "../js/output/output-media-readiness.js";

test("output readiness traverses nested components groups and generator media", () => {
  const child = {
    id: "child",
    chain: [{
      id: "morph",
      kind: "source",
      enabled: true,
      source: { type: "generator", generatorId: "featureMorph", params: { imageAId: "ready", imageBId: "missing" } },
    }],
  };
  const parent = {
    id: "parent",
    chain: [{
      id: "group",
      kind: "group",
      enabled: true,
      chain: [{ id: "child-ref", kind: "source", enabled: true, source: { type: "component", componentId: "child" } }],
    }],
  };
  const status = collectOutputMediaReadiness({
    mode: "output",
    state: { components: [parent, child], surfaces: [{ enabled: true, componentId: "parent" }] },
    media: new Map([["ready", { ready: true }]]),
  });

  assert.equal(status.total, 2);
  assert.deepEqual([...status.missingIds], ["missing"]);
  assert.equal(status.blocked, true);
});

test("an explicit empty chain does not preload a hidden legacy source", () => {
  const component = {
    id: "empty",
    chain: [],
    source: { type: "media", mediaId: "legacy-hidden.png" },
  };
  const status = collectOutputMediaReadiness({
    mode: "output",
    state: { components: [component], surfaces: [{ enabled: true, componentId: component.id }] },
    media: new Map(),
  });

  assert.equal(status.total, 0);
  assert.equal(status.blocked, false);
  assert.deepEqual([...status.missingIds], []);
});

test("output renderer delegates loading and blackout traversal", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");

  assert.match(rendererSource, /from "\.\/output-media-readiness\.js\?v=[^"]+"/);
  assert.doesNotMatch(rendererSource, /collectComponentMediaReadiness\(/);
  assert.doesNotMatch(rendererSource, /collectChainMediaReadiness\(/);
  assert.ok(rendererSource.includes("this.requestMissingMediaBatch(Array.from(status.missingIds))"));
});
