import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { applySceneSourceNode, resolveSceneSourceNode, sceneSourceNodes } from "../js/domain/scene-routing.js";

test("scene routing exposes Components and Canvas recording frames without normalization state", () => {
  const state = {
    components: [
      { id: "component-a", type: "chain", name: "A", activity: {} },
      { id: "canvas-a", type: "canvas", name: "Canvas", activity: {}, canvas: { frameThumbnails: { "frame-a": "thumb" } } },
    ],
    recordingFrames: [{ id: "frame-a", name: "Crop", activity: {} }],
  };
  const nodes = sceneSourceNodes(state);
  const frameNode = nodes.find((node) => node.outputFrameId === "frame-a");

  assert.equal(nodes.length, 3);
  assert.equal(frameNode.thumbnail, "thumb");
  assert.equal(resolveSceneSourceNode(state, "", {}), null);
  assert.equal(resolveSceneSourceNode(state, "missing-node", {}), null);
  assert.deepEqual(resolveSceneSourceNode(state, frameNode.id), frameNode);
  assert.deepEqual(applySceneSourceNode({}, frameNode), {
    sourceNodeId: frameNode.id,
    componentId: "canvas-a",
    outputFrameId: "frame-a",
  });
});

test("models remains a compatibility facade for scene routing", () => {
  const source = readFileSync(new URL("../js/domain/models.js", import.meta.url), "utf8");
  assert.ok(source.includes('from "./scene-routing.js?v=surface-media-contract-4"'));
  assert.doesNotMatch(source, /export function sceneSourceNodes\(/);
});
