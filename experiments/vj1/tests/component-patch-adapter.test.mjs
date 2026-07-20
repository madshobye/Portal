import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  isSimpleLayer,
  mediaSourceAlphaEdge,
  mediaSourceFit,
  patchLayerForNode,
  shaderPassFromNode,
  sourceFromPatchNode,
  sourceWithNodeParams,
} from "../js/output/component-patch-adapter.js";

test("component patch adapter translates graph nodes into renderer contracts", () => {
  assert.deepEqual(sourceFromPatchNode({
    id: "generator-node",
    kind: "generator",
    componentId: "noise",
    params: { scale: 2 },
    state: { source: { type: "generator", generatorId: "noise" } },
  }), {
    type: "generator",
    generatorId: "noise",
    params: { scale: 2 },
    instanceId: "generator-node",
  });
  assert.throws(
    () => sourceFromPatchNode({ id: "invalid-source-node", kind: "generator" }),
    /VJ1_INVALID_RENDER_NODE/
  );
  assert.deepEqual(sourceWithNodeParams(
    { type: "media", mediaId: "image-a", params: { fit: "contain" } },
    { speed: 2, fit: "cover" },
    "media-node"
  ), {
    type: "media",
    mediaId: "image-a",
    speed: 2,
    params: { fit: "cover" },
    instanceId: "media-node",
  });
  assert.equal(mediaSourceFit({ params: { fit: "cover" } }), "cover");
  assert.deepEqual(mediaSourceAlphaEdge({ params: { alphaCut: 2.5, alphaFeather: 7 } }), {
    cut: 2.5,
    feather: 7,
  });
  assert.deepEqual(mediaSourceAlphaEdge({ params: { alphaCut: -2, alphaFeather: 99 } }), {
    cut: 0,
    feather: 32,
  });
  assert.equal(isSimpleLayer(patchLayerForNode({ id: "node-a" })), true);
  assert.equal(shaderPassFromNode({ id: "fx-a", componentId: "invert" }).instanceId, "fx-a");
});

test("output renderer delegates graph adaptation to one module", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");

  assert.ok(rendererSource.includes('from "./component-patch-adapter.js?v=alpha-feather-1"'));
  assert.doesNotMatch(rendererSource, /function sourceFromPatchNode\(/);
  assert.doesNotMatch(rendererSource, /function nodesInComponentChainOrder\(/);
  assert.doesNotMatch(rendererSource, /function sourceWithNodeParams\(/);
});
