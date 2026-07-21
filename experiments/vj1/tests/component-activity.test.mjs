import test from "node:test";
import assert from "node:assert/strict";

import {
  latestProjectActivity,
  stampChangedProjectItems,
  touchComponentUsed,
  touchRecordingFrameUsed,
} from "../js/domain/component-activity.js";

const earlier = "2026-07-16T08:00:00.000Z";
const later = "2026-07-16T09:00:00.000Z";

function activity() {
  return { createdAt: earlier, updatedAt: earlier, lastUsedAt: "" };
}

test("direct component and frame edits update only their own activity", () => {
  const previous = {
    components: [
      { id: "comp", name: "Comp", chain: [{ id: "source", params: { amount: 0 } }], activity: activity() },
      { id: "canvas", type: "scene", name: "Canvas", chain: [{ source: { type: "component", componentId: "comp" } }], canvas: { width: 100, height: 100, frameThumbnails: {} }, activity: activity() },
    ],
    frames: [{ id: "frame", x: 0, y: 0, width: 10, height: 10, activity: activity() }],
  };
  const next = structuredClone(previous);
  next.components[0].chain[0].params.amount = 1;
  next.frames[0].x = 5;
  stampChangedProjectItems(previous, next, later);

  assert.equal(next.components[0].activity.updatedAt, later);
  assert.equal(next.frames[0].activity.updatedAt, later);
  assert.equal(next.components[1].activity.updatedAt, earlier, "referenced component edits do not propagate to Canvas activity");
});

test("direct Canvas edits update the Canvas marker without touching its components", () => {
  const previous = {
    components: [
      { id: "comp", name: "Comp", activity: activity() },
      { id: "canvas", type: "scene", canvas: { previewQuality: "auto", frameThumbnails: {} }, activity: activity() },
    ],
    frames: [],
  };
  const next = structuredClone(previous);
  next.components[1].canvas.previewQuality = "low";
  stampChangedProjectItems(previous, next, later);

  assert.equal(next.components[1].activity.updatedAt, later);
  assert.equal(next.components[0].activity.updatedAt, earlier);
});

test("using a Scene source updates component and frame use markers", () => {
  const state = {
    components: [{ id: "canvas", activity: activity() }],
    frames: [{ id: "frame", activity: activity() }],
  };
  assert.equal(touchComponentUsed(state, "canvas", later), true);
  assert.equal(touchRecordingFrameUsed(state, "frame", later), true);
  assert.equal(latestProjectActivity(state.components[0].activity), new Date(later).getTime());
  assert.equal(state.frames[0].activity.lastUsedAt, later);
});
