import test from "node:test";
import assert from "node:assert/strict";

import {
  previewCanvasLogicalSize,
  previewViewportForUi,
  isPreviewPanGesture,
  resolveViewportForFit,
  updatePreviewViewportForUi,
  zoomViewport,
} from "../js/output/preview-viewport.js";

test("preview panning accepts Shift-drag without removing existing navigation gestures", () => {
  assert.equal(isPreviewPanGesture({ button: 0, shiftKey: true }), true);
  assert.equal(isPreviewPanGesture({ button: 0, altKey: true }), true);
  assert.equal(isPreviewPanGesture({ button: 1 }), true);
  assert.equal(isPreviewPanGesture({ button: 0 }), false);
});

test("every embedded workspace uses one full-stage preview canvas contract", () => {
  const render = {
    sceneAspectRatio: 16 / 9,
    outputs: [{ id: "main", name: "Main", aspectRatio: 16 / 9 }],
    hostViewport: { width: 1000, height: 700, mode: "preview", outputId: "" },
  };
  const component = previewCanvasLogicalSize({ mode: "component", workspace: "component", render });
  const scene = previewCanvasLogicalSize({ mode: "component", workspace: "scene", render });
  const mapping = previewCanvasLogicalSize({ mode: "preview", workspace: "mapping", render });
  const live = previewCanvasLogicalSize({ mode: "live", workspace: "live", render });
  assert.deepEqual(component, { width: 1000, height: 700 });
  assert.deepEqual(scene, component);
  assert.deepEqual(mapping, component);
  assert.deepEqual(live, component);
});

test("automatic viewport fits use the same rule in Component, Scene, Mapping, and Live", () => {
  const render = {
    outputs: [{ id: "main", name: "Main", aspectRatio: 16 / 9 }],
    hostViewport: { width: 960, height: 540, mode: "preview", outputId: "" },
  };
  const stageSize = { width: 960, height: 540 };
  const storedFrameFit = { fit: "frame", zoom: 1.5, x: 42, y: -18 };

  assert.deepEqual(
    resolveViewportForFit({ mode: "component", workspace: "component", stageSize, viewport: storedFrameFit, render }),
    { fit: "frame", zoom: 1, x: 0, y: 0 }
  );
  for (const [mode, workspace] of [["component", "scene"], ["preview", "mapping"], ["live", "live"]]) {
    assert.deepEqual(
      resolveViewportForFit({ mode, workspace, stageSize, viewport: storedFrameFit, render }),
      { fit: "frame", zoom: 2, x: 0, y: 0 }
    );
  }
  assert.deepEqual(
    resolveViewportForFit({ mode: "live", stageSize, viewport: { fit: "world", zoom: 5, x: 3, y: 4 }, render }),
    { fit: "world", zoom: 1, x: 0, y: 0 }
  );
});

test("manual viewport navigation is retained independently per workspace", () => {
  const ui = {
    workspace: "component",
    previewViewports: {
      component: { fit: "manual", zoom: 2.25, x: 80, y: -30 },
      scene: { fit: "frame", zoom: 1, x: 0, y: 0 },
      mapping: { fit: "manual", zoom: 1.25, x: 0, y: 0 },
      live: { fit: "manual", zoom: 0.75, x: -12, y: 20 },
    },
  };

  updatePreviewViewportForUi(ui, (viewport) => zoomViewport(viewport, 2));
  assert.equal(previewViewportForUi(ui).zoom, 4.5);
  ui.workspace = "live";
  assert.deepEqual(previewViewportForUi(ui), { fit: "manual", zoom: 0.75, x: -12, y: 20 });
  assert.equal(ui.previewViewports.component.zoom, 4.5);
});

test("wheel zoom keeps the world point beneath the cursor stationary", () => {
  const viewport = { fit: "manual", zoom: 2, x: 30, y: -20 };
  const anchor = { x: 700, y: 180, centerX: 500, centerY: 300 };
  const before = {
    x: (anchor.x - anchor.centerX - viewport.x) / viewport.zoom,
    y: (anchor.y - anchor.centerY - viewport.y) / viewport.zoom,
  };
  const zoomed = zoomViewport(viewport, 1.5, anchor);
  const after = {
    x: (anchor.x - anchor.centerX - zoomed.x) / zoomed.zoom,
    y: (anchor.y - anchor.centerY - zoomed.y) / zoomed.zoom,
  };

  assert.deepEqual(after, before);
  assert.deepEqual(zoomed, { fit: "manual", zoom: 3, x: -55, y: 30 });
});

test("cursor anchored zoom uses the clamped zoom ratio", () => {
  const zoomed = zoomViewport(
    { fit: "manual", zoom: 5, x: 0, y: 0 },
    2,
    { x: 750, y: 500, centerX: 500, centerY: 500 }
  );
  assert.equal(zoomed.zoom, 6);
  assert.ok(Math.abs(zoomed.x + 50) < 1e-9);
  assert.equal(zoomed.y, 0);
});

test("Mapping viewport survives render-state normalization", async () => {
  const { normalizePreviewViewports } = await import("../js/domain/render-settings.js");
  const normalized = normalizePreviewViewports({
    mapping: { fit: "manual", zoom: 2.4, x: 18, y: -9 },
    canvas: { fit: "manual", zoom: 5, x: 0, y: 0 },
  });
  assert.deepEqual(normalized.mapping, { fit: "manual", zoom: 2.4, x: 18, y: -9 });
  assert.equal(Object.hasOwn(normalized, "canvas"), false);
});

test("Live full-frame demand remains independent from its inset World presentation", async () => {
  const { outputSpanFitScale } = await import("../js/output/render-geometry.js");
  const render = {
    outputs: [{ id: "main", aspectRatio: 2 }],
    hostViewport: { width: 1000, height: 1000, mode: "preview", outputId: "" },
  };
  assert.equal(outputSpanFitScale(render), 2);
});
