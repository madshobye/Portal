import test from "node:test";
import assert from "node:assert/strict";

import {
  previewViewportForUi,
  resolveViewportForFit,
  updatePreviewViewportForUi,
  zoomViewport,
} from "../js/output/preview-viewport.js";

test("automatic viewport fits are resolved per workspace mode", () => {
  const render = {
    outputs: [{ id: "main", name: "Main", width: 1920, height: 1080 }],
    worldWidth: 2880,
    worldHeight: 1620,
  };
  const stageSize = { width: 960, height: 540 };
  const storedFrameFit = { fit: "frame", zoom: 1.5, x: 42, y: -18 };

  assert.deepEqual(
    resolveViewportForFit({ mode: "component", stageSize, viewport: storedFrameFit, render }),
    { fit: "frame", zoom: 1, x: 0, y: 0 }
  );
  assert.equal(
    resolveViewportForFit({ mode: "preview", stageSize, viewport: storedFrameFit, render }).zoom,
    1.5
  );
});

test("manual viewport navigation is retained independently per workspace", () => {
  const ui = {
    workspace: "component",
    previewViewports: {
      component: { fit: "manual", zoom: 2.25, x: 80, y: -30 },
      canvas: { fit: "frame", zoom: 1, x: 0, y: 0 },
      scene: { fit: "frame", zoom: 1, x: 0, y: 0 },
      live: { fit: "manual", zoom: 0.75, x: -12, y: 20 },
    },
  };

  updatePreviewViewportForUi(ui, (viewport) => zoomViewport(viewport, 2));
  assert.equal(previewViewportForUi(ui).zoom, 4.5);
  ui.workspace = "live";
  assert.deepEqual(previewViewportForUi(ui), { fit: "manual", zoom: 0.75, x: -12, y: 20 });
  assert.equal(ui.previewViewports.component.zoom, 4.5);
});
