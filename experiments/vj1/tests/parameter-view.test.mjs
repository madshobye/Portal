import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { colorParamControlTemplate, paramControlTemplate, paramControlsTemplate } from "../js/control/parameter-view.js";

test("parameter view owns reusable inspector controls outside the controller", () => {
  const controller = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const componentView = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const sceneLiveView = readFileSync(new URL("../js/control/scene-live-view.js", import.meta.url), "utf8");
  const range = paramControlTemplate({ id: "gain", label: "Gain", type: "number", min: 0, max: 2, step: 0.1 }, "params.gain", 1);
  const controls = paramControlsTemplate([
    { id: "seed", label: "Seed", type: "number", min: 0, max: 1, defaultValue: 0 },
    { id: "enabled", label: "Enabled", type: "boolean", defaultValue: true },
  ]);

  assert.match(range, /class="field range-field chain-param"/);
  assert.match(range, /data-update="params\.gain"/);
  assert.doesNotMatch(controls, /Seed/);
  assert.match(controls, /Enabled/);
  assert.match(componentView, /from "\.\/parameter-view\.js\?v=render-coordinate-scope-3"/);
  assert.match(sceneLiveView, /from "\.\/parameter-view\.js\?v=render-coordinate-scope-3"/);
  assert.doesNotMatch(controller, /function paramControlTemplate\(/);
  assert.doesNotMatch(controller, /function paramControlsTemplate\(/);
});

test("color params place the shared slider label above an alpha track with the swatch on the right", () => {
  const control = colorParamControlTemplate({ id: "sky", label: "Sky", type: "color" }, "params.sky", "#12345680");
  const alphaIndex = control.indexOf("data-color-alpha");
  const swatchIndex = control.indexOf("data-color-rgb");

  assert.match(control, /<span>Sky<\/span>[\s\S]*?class="color-param-row"/);
  assert.ok(alphaIndex > 0);
  assert.ok(swatchIndex > alphaIndex);
});
