import test from "node:test";
import assert from "node:assert/strict";

import { resolveViewportForFit } from "../js/output/preview-viewport.js";

test("automatic viewport fits are resolved per workspace mode", () => {
  const render = {
    outputs: [{ id: "main", name: "Main", width: 1920, height: 1080 }],
    worldWidth: 2880,
    worldHeight: 1620,
  };
  const stageSize = { width: 960, height: 540 };
  const storedFrameFit = { fit: "frame", zoom: 1.5, x: 42, y: -18 };

  assert.deepEqual(
    resolveViewportForFit({ mode: "composition", stageSize, viewport: storedFrameFit, render }),
    { fit: "frame", zoom: 1, x: 0, y: 0 }
  );
  assert.equal(
    resolveViewportForFit({ mode: "preview", stageSize, viewport: storedFrameFit, render }).zoom,
    1.5
  );
});

test("manual viewport navigation remains shared intentionally", () => {
  const manual = { fit: "manual", zoom: 2.25, x: 80, y: -30 };
  assert.equal(resolveViewportForFit({ mode: "composition", viewport: manual }), manual);
  assert.equal(resolveViewportForFit({ mode: "preview", viewport: manual }), manual);
});
