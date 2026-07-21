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
  scaleFramesToSceneSize,
} from "../js/domain/render-settings.js";
import { oppositeRenderPhaseDelayMs, previewPhaseNeedsRealignment } from "../js/domain/render-phase-policy.js";

test("render settings normalize independently from the aggregate domain model", () => {
  const render = normalizeRenderSettings({
    outputs: [{ id: "left", aspectRatio: 4 / 3 }, { id: "right", aspectRatio: 4 / 3 }],
    pixelDensity: 4,
  });

  assert.deepEqual(createOutputDefinition(1, 320, 240), { id: "output-2", name: "Output 2", aspectRatio: 4 / 3 });
  assert.equal(render.outputs[0].aspectRatio, 4 / 3);
  assert.equal(Object.hasOwn(render, "width"), false);
  assert.equal(Object.hasOwn(render, "worldWidth"), false);
  assert.equal(render.pixelDensity, 2);
  assert.equal(render.maxFrameRate, 120);
  assert.equal(render.sceneAspectRatio, 16 / 9);
  assert.equal(render.componentAspectRatio, 4 / 3);
  assert.equal(normalizeRenderSettings({ sceneAspectRatio: 2 }).sceneAspectRatio, 2);
  assert.equal(renderMaxFrameRate({ maxFrameRate: 48 }), 48);
  assert.equal(renderMaxFrameRate({ maxFrameRate: 500 }), 120);
  assert.deepEqual(normalizePreviewViewport({ fit: "invalid", zoom: 20 }), { fit: "world", zoom: 6, x: 0, y: 0 });
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
  const viewports = normalizePreviewViewports({
    canvas: { fit: "manual", zoom: 3, x: 99, y: 99 },
    mapping: { fit: "manual", zoom: 2, x: 30, y: -10 },
  });
  assert.equal(viewports.canvas, undefined);
  assert.deepEqual(viewports.component, { fit: "world", zoom: 1, x: 0, y: 0 });
  assert.deepEqual(viewports.scene, { fit: "world", zoom: 1, x: 0, y: 0 });
  assert.deepEqual(viewports.mapping, { fit: "manual", zoom: 2, x: 30, y: -10 });
  assert.deepEqual(viewports.live, { fit: "world", zoom: 1, x: 0, y: 0 });
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
  assert.ok(source.includes('from "./render-settings.js?v=screen-input-registry-1"'));
  assert.doesNotMatch(source, /export function normalizeRenderSettings\(/);
  assert.doesNotMatch(source, /export function normalizeCameraSettings\(/);
});

test("relative recording frames need no rewrite when the Canvas proportion changes", () => {
  const frames = [{ id: "frame", x: 0.1, y: 0.1, width: 0.4, height: 0.4 }];
  assert.deepEqual(
    scaleFramesToSceneSize(frames, { aspectRatio: 2 }, { aspectRatio: 1 }),
    frames,
  );
});
