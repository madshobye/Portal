import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  createOutputDefinition,
  normalizePreviewViewport,
  normalizePreviewViewports,
  normalizeRenderSettings,
} from "../js/domain/render-settings.js";

test("render settings normalize independently from the aggregate domain model", () => {
  const render = normalizeRenderSettings({
    outputs: [{ id: "left", width: 640, height: 480 }, { id: "right", width: 800, height: 600 }],
    pixelDensity: 4,
  });

  assert.deepEqual(createOutputDefinition(1, 320, 240), { id: "output-2", name: "Output 2", width: 320, height: 240 });
  assert.equal(render.width, 640);
  assert.equal(render.worldWidth > 1440, true);
  assert.equal(render.pixelDensity, 2);
  assert.deepEqual(normalizePreviewViewport({ fit: "invalid", zoom: 20 }), { fit: "frame", zoom: 6, x: 0, y: 0 });
});

test("preview viewport normalization accepts only the canonical per-workspace map", () => {
  const viewports = normalizePreviewViewports({ canvas: { fit: "manual", zoom: 2, x: 30, y: -10 } });
  assert.deepEqual(viewports.canvas, { fit: "manual", zoom: 2, x: 30, y: -10 });
  assert.deepEqual(viewports.component, { fit: "frame", zoom: 1, x: 0, y: 0 });
  assert.deepEqual(viewports.scene, { fit: "frame", zoom: 1, x: 0, y: 0 });
  assert.deepEqual(viewports.live, { fit: "frame", zoom: 1, x: 0, y: 0 });
});

test("models remains a compatibility facade for render settings", () => {
  const source = readFileSync(new URL("../js/domain/models.js", import.meta.url), "utf8");
  assert.ok(source.includes('from "./render-settings.js?v=render-coordinate-scope-3"'));
  assert.doesNotMatch(source, /export function normalizeRenderSettings\(/);
  assert.doesNotMatch(source, /export function normalizeCameraSettings\(/);
});
