import test from "node:test";
import assert from "node:assert/strict";

import { nodeRoiRequest } from "../js/libraries/render-engine/roi/index.js";
import { renderSourceDetail } from "../js/libraries/render-engine/render-view/index.js";

test("visible ROI allocation stays bounded while source detail retains the physical boundary", () => {
  const parent = { width: 1600, height: 900, logicalWidth: 800, logicalHeight: 450 };
  const request = nodeRoiRequest(parent, { x: 0.75, y: 0, width: 1, height: 1 });

  assert.ok(request.width < parent.width);
  assert.equal(request.height, parent.height);
  const allocation = { width: request.width, height: request.height };
  const normal = renderSourceDetail(allocation, request);
  const zoomed = renderSourceDetail(allocation, request, { contentScale: 3 });

  assert.equal(normal.physicalWidth, 1600);
  assert.equal(normal.physicalHeight, 900);
  assert.equal(zoomed.width, 4800);
  assert.equal(zoomed.height, 2700);
  // Source zoom changes detail demand only. It cannot inflate the ROI target.
  assert.deepEqual(allocation, { width: request.width, height: request.height });
});

test("content zoom below one reduces source detail without changing allocation", () => {
  const request = { width: 1200, height: 800, uvRect: [0, 0, 1, 1] };
  const detail = renderSourceDetail(request, request, { contentScale: 0.25 });

  assert.equal(detail.width, 300);
  assert.equal(detail.height, 200);
  assert.equal(detail.physicalWidth, 1200);
  assert.equal(detail.physicalHeight, 800);
  assert.equal(detail.contentScale, 0.25);
});

test("fully offscreen boundaries have no source-detail demand", () => {
  const request = nodeRoiRequest(
    { width: 1600, height: 900 },
    { x: 2, y: 0, width: 0.25, height: 0.25 },
  );
  assert.equal(request.empty, true);
  assert.deepEqual(renderSourceDetail(request, request, { contentScale: 20 }), {
    width: 0,
    height: 0,
    physicalWidth: 0,
    physicalHeight: 0,
    contentScale: 20,
  });
});
