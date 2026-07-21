import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { applySceneSourceNode, materializeLiveTargetSurfaceRoutes, resolveSceneSourceNode, sceneSourceNodes } from "../js/domain/scene-routing.js";

test("scene routing exposes Components and Scene Frames without normalization state", () => {
  const state = {
    components: [
      { id: "component-a", type: "chain", name: "A", activity: {} },
      { id: "scene-a", type: "scene", name: "Scene", activity: {}, scene: { frameThumbnails: { "frame-a": "thumb" } } },
    ],
    frames: [{ id: "frame-a", name: "Crop", activity: {} }],
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
    componentId: "scene-a",
    outputFrameId: "frame-a",
  });
});

test("models remains a compatibility facade for scene routing", () => {
  const source = readFileSync(new URL("../js/domain/models.js", import.meta.url), "utf8");
  assert.match(source, /from "\.\/scene-routing\.js\?v=[^"]+"/);
  assert.doesNotMatch(source, /export function sceneSourceNodes\(/);
});

test("a standalone Live Component covers each Mapping Frame without changing projection geometry", () => {
  const surface = {
    id: "surface-a",
    frameSlotId: "frame-a",
    projectionFit: "contain",
    destination: { type: "surface" },
  };
  const state = {
    render: { sceneAspectRatio: 16 / 9 },
    frames: [{ id: "frame-a", width: 0.5, height: 1 }],
    surfaces: [surface],
  };
  const target = { id: "component-a", type: "chain" };
  const routes = materializeLiveTargetSurfaceRoutes(state, target);

  assert.equal(routes.surfaces[0].componentId, target.id);
  assert.equal(routes.surfaces[0].outputFrameId, "");
  assert.equal(routes.surfaces[0].frameSlotId, "frame-a");
  assert.equal(routes.surfaces[0].frameFit, "cover");
  assert.equal(routes.surfaces[0].frameFitActive, true);
  assert.equal(routes.surfaces[0].projectionFit, "contain");
  assert.equal(routes.surfaces[0].destination.type, "surface");
  assert.deepEqual(state.surfaces, [surface]);
});
