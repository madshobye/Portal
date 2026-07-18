import test from "node:test";
import assert from "node:assert/strict";

import { mergeSourceChoice } from "../js/domain/source-choice.js";

test("replacing media preserves STL image and video source tuning", () => {
  const previous = {
    type: "media",
    mediaId: "media/old-model.stl",
    start: 2.5,
    end: 18,
    speed: 0.75,
    params: {
      renderQuality: 0.8,
      fit: "cover",
      renderMode: "wire",
      surfaceColor: "#112233ff",
      wireColor: "#ffeeddff",
      rotationX: 0.4,
      rotationY: -0.2,
      rotationZ: 1.1,
      modelScale: 2.4,
      spinX: 0.1,
      spinY: 0.2,
      spinZ: 0.3,
      depth: 1.7,
      visibleDepth: 0.6,
      wireThickness: 4,
      pointBudget: 12000,
    },
  };

  const next = mergeSourceChoice(previous, { type: "media", mediaId: "media/new-model.stl" });

  assert.equal(next.mediaId, "media/new-model.stl");
  assert.equal(next.start, previous.start);
  assert.equal(next.end, previous.end);
  assert.equal(next.speed, previous.speed);
  assert.deepEqual(next.params, previous.params);
  assert.notEqual(next.params, previous.params);
  assert.equal(previous.mediaId, "media/old-model.stl");
});

test("source replacement does not leak parameters across different source kinds", () => {
  const previous = {
    type: "generator",
    generatorId: "terrainFlyover",
    params: { altitude: 4 },
  };

  assert.deepEqual(
    mergeSourceChoice(previous, { type: "generator", generatorId: "terrainFlyover" }),
    previous
  );
  assert.deepEqual(
    mergeSourceChoice(previous, { type: "generator", generatorId: "seascape" }),
    { type: "generator", generatorId: "seascape" }
  );
  assert.deepEqual(
    mergeSourceChoice(previous, { type: "media", mediaId: "media/image.png" }),
    { type: "media", mediaId: "media/image.png" }
  );
});
