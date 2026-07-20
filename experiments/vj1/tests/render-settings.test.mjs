import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  createOutputDefinition,
  normalizePreviewViewport,
  normalizePreviewViewports,
  normalizeRenderSettings,
  normalizeScreenCaptureSettings,
  renderMaxFrameRate,
  scaleRecordingFramesToCanvasSize,
} from "../js/domain/render-settings.js";
import { oppositeRenderPhaseDelayMs, previewPhaseNeedsRealignment } from "../js/domain/render-phase-policy.js";

test("render settings normalize independently from the aggregate domain model", () => {
  const render = normalizeRenderSettings({
    outputs: [{ id: "left", width: 640, height: 480 }, { id: "right", width: 800, height: 600 }],
    pixelDensity: 4,
  });

  assert.deepEqual(createOutputDefinition(1, 320, 240), { id: "output-2", name: "Output 2", width: 320, height: 240 });
  assert.equal(render.width, 640);
  assert.equal(render.worldWidth > 1440, true);
  assert.equal(render.pixelDensity, 2);
  assert.equal(render.maxFrameRate, 120);
  assert.deepEqual(render.canvasSize, { width: 3840, height: 2160 });
  assert.deepEqual(normalizeRenderSettings({ canvasSize: { width: 2048, height: 1024 } }).canvasSize, { width: 2048, height: 1024 });
  assert.equal(renderMaxFrameRate({ maxFrameRate: 48 }), 48);
  assert.equal(renderMaxFrameRate({ maxFrameRate: 500 }), 120);
  assert.deepEqual(normalizePreviewViewport({ fit: "invalid", zoom: 20 }), { fit: "frame", zoom: 6, x: 0, y: 0 });
});

test("screen capture settings preserve native dimensions and normalize browser hints", () => {
  assert.deepEqual(normalizeScreenCaptureSettings({}), {
    frameRate: 30,
    cursor: "always",
    preferCurrentTab: false,
    includeCurrentTab: true,
    surfaceSwitching: true,
  });
  assert.deepEqual(normalizeScreenCaptureSettings({
    frameRate: 120,
    cursor: "invalid",
    preferCurrentTab: true,
    includeCurrentTab: false,
    surfaceSwitching: false,
    width: 640,
    height: 360,
  }), {
    frameRate: 60,
    cursor: "always",
    preferCurrentTab: true,
    includeCurrentTab: false,
    surfaceSwitching: false,
  });
});

test("preview viewport normalization accepts only the canonical per-workspace map", () => {
  const viewports = normalizePreviewViewports({ canvas: { fit: "manual", zoom: 2, x: 30, y: -10 } });
  assert.deepEqual(viewports.canvas, { fit: "manual", zoom: 2, x: 30, y: -10 });
  assert.deepEqual(viewports.component, { fit: "frame", zoom: 1, x: 0, y: 0 });
  assert.deepEqual(viewports.scene, { fit: "frame", zoom: 1, x: 0, y: 0 });
  assert.deepEqual(viewports.live, { fit: "frame", zoom: 1, x: 0, y: 0 });
});

test("the duplicate embedded preview can occupy the opposite output render phase", () => {
  assert.equal(oppositeRenderPhaseDelayMs(30), 1000 / 60);
  assert.equal(oppositeRenderPhaseDelayMs(60), 1000 / 120);
  assert.equal(previewPhaseNeedsRealignment({ outputWindowOpen: false }), false);
  assert.equal(previewPhaseNeedsRealignment({ outputWindowOpen: true, wasOutputWindowOpen: false, frameRate: 30 }), true);
  assert.equal(previewPhaseNeedsRealignment({ outputWindowOpen: true, wasOutputWindowOpen: true, frameRate: 30, alignedFrameRate: 30 }), false);
  assert.equal(previewPhaseNeedsRealignment({ outputWindowOpen: true, wasOutputWindowOpen: true, frameRate: 60, alignedFrameRate: 30 }), true);
});

test("models remains a compatibility facade for render settings", () => {
  const source = readFileSync(new URL("../js/domain/models.js", import.meta.url), "utf8");
  assert.ok(source.includes('from "./render-settings.js?v=screen-share-1"'));
  assert.doesNotMatch(source, /export function normalizeRenderSettings\(/);
  assert.doesNotMatch(source, /export function normalizeCameraSettings\(/);
});

test("changing the global Canvas size preserves recording-frame proportions", () => {
  assert.deepEqual(
    scaleRecordingFramesToCanvasSize(
      [{ id: "frame", x: 100, y: 50, width: 400, height: 200 }],
      { width: 1000, height: 500 },
      { width: 2000, height: 1000 },
    ),
    [{ id: "frame", x: 200, y: 100, width: 800, height: 400 }],
  );
});
