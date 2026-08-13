import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  createOutputDefinition,
  normalizePreviewViewport,
  normalizePreviewViewports,
  normalizeRenderSettings,
  normalizeScreenCaptureSettings,
  resolutionCeilingLongEdge,
  renderMaxFrameRate,
} from "../js/domain/render-settings.js";
import { oppositeRenderPhaseDelayMs, previewPhaseNeedsRealignment } from "../js/domain/render-phase-policy.js";

test("render settings normalize independently from the aggregate domain model", () => {
  const render = normalizeRenderSettings({
    outputs: [{ id: "left", aspectRatio: 4 / 3 }, { id: "right", aspectRatio: 4 / 3 }],
    pixelDensity: 4,
  });

  assert.deepEqual(createOutputDefinition(1, 4 / 3), { id: "output-2", name: "Output 2", aspectRatio: 4 / 3 });
  assert.deepEqual(createOutputDefinition(0), { id: "output-main", name: "Output 1", aspectRatio: 16 / 9 });
  assert.equal(normalizeRenderSettings({ outputs: [{ id: "output-main", name: "Main output" }] }).outputs[0].name, "Output 1");
  assert.equal(render.outputs[0].aspectRatio, 4 / 3);
  assert.equal(Object.hasOwn(render, "width"), false);
  assert.equal(Object.hasOwn(render, "worldWidth"), false);
  assert.equal(render.pixelDensity, 4);
  assert.equal(render.maxFrameRate, 120);
  assert.equal(render.sceneAspectRatio, 16 / 9);
  assert.equal(render.componentAspectRatio, 4 / 3);
  assert.equal(normalizeRenderSettings({ sceneAspectRatio: 2 }).sceneAspectRatio, 2);
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

test("resolution ceilings include standard projector classes", () => {
  assert.equal(normalizeRenderSettings({ resolutionCeiling: "vga" }).resolutionCeiling, "vga");
  assert.equal(normalizeRenderSettings({ resolutionCeiling: "xga" }).resolutionCeiling, "xga");
  assert.equal(normalizeRenderSettings({ resolutionCeiling: "uxga" }).resolutionCeiling, "uxga");
  assert.equal(normalizeRenderSettings({ resolutionCeiling: "wuxga" }).resolutionCeiling, "wuxga");
  assert.equal(resolutionCeilingLongEdge("vga"), 640);
  assert.equal(resolutionCeilingLongEdge("xga"), 1024);
  assert.equal(resolutionCeilingLongEdge("uxga"), 1600);
  assert.equal(resolutionCeilingLongEdge("wuxga"), 1920);
});

test("preview viewport normalization accepts only the canonical per-workspace map", () => {
  const viewports = normalizePreviewViewports({
    canvas: { fit: "manual", zoom: 3, x: 99, y: 99 },
    mapping: { fit: "manual", zoom: 2, x: 30, y: -10 },
  });
  assert.equal(viewports.canvas, undefined);
  assert.deepEqual(viewports.component, { fit: "frame", zoom: 1, x: 0, y: 0 });
  assert.deepEqual(viewports.scene, { fit: "frame", zoom: 1, x: 0, y: 0 });
  assert.deepEqual(viewports.mapping, { fit: "manual", zoom: 2, x: 30, y: -10 });
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
  assert.ok(source.includes('from "./render-settings.js"'));
  assert.doesNotMatch(source, /export function normalizeRenderSettings\(/);
  assert.doesNotMatch(source, /export function normalizeCameraSettings\(/);
});
