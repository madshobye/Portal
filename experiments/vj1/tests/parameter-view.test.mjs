import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { colorParamControlTemplate, componentParamViews, paramControlTemplate, paramControlsTemplate, screenInputParamControlTemplate } from "../js/control/parameter-view.js";
import { paramRangePairTemplate, rangeTemplate } from "../js/control/template-utils.js";

test("shared standalone sliders expose the declared-parameter reset contract", () => {
  const html = rangeTemplate("Movie speed", "components.0.chain.0.source.speed", 1.5, 0, 4, 0.01, 1);
  assert.match(html, /data-param-context-path="components\.0\.chain\.0\.source\.speed"/);
  assert.match(html, /data-param-default="1"/);
});

test("parameter views tolerate a file-backed node while its definition is pending", () => {
  assert.deepEqual(componentParamViews(null), { primary: [], details: [] });
});

test("parameter view owns reusable inspector controls outside the controller", () => {
  const controller = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const componentView = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const sceneLiveView = readFileSync(new URL("../js/control/mapping-live-view.js", import.meta.url), "utf8");
  const range = paramControlTemplate({ id: "gain", label: "Gain", type: "number", min: 0, max: 2, step: 0.1 }, "params.gain", 1);
  const controls = paramControlsTemplate([
    { id: "seed", label: "Seed", type: "number", min: 0, max: 1, defaultValue: 0 },
    { id: "enabled", label: "Enabled", type: "boolean", defaultValue: true },
  ]);

  assert.match(range, /class="field range-field chain-param param-context-target"/);
  assert.match(range, /data-param-context-path="params\.gain"/);
  assert.match(range, /data-update="params\.gain"/);
  assert.doesNotMatch(controls, /Seed/);
  assert.match(controls, /Enabled/);
  assert.match(componentView, /from "\.\/parameter-view\.js"/);
  assert.match(sceneLiveView, /from "\.\/parameter-view\.js"/);
  assert.doesNotMatch(controller, /function paramControlTemplate\(/);
  assert.doesNotMatch(controller, /function paramControlsTemplate\(/);
});

test("color params place the shared slider label above an alpha track with the swatch on the right", () => {
  const control = colorParamControlTemplate({ id: "sky", label: "Sky", type: "color" }, "params.sky", "#12345680");
  const alphaIndex = control.indexOf("data-color-alpha");
  const swatchIndex = control.indexOf("data-color-rgb");

  assert.match(control, /class="field range-field color-param chain-param/);
  assert.match(control, /<span>Sky<\/span>[\s\S]*?class="param-control-track color-param-row"/);
  assert.ok(alphaIndex > 0);
  assert.ok(swatchIndex > alphaIndex);
});

test("persistent and Live params expose reset metadata with explicit ownership modes", () => {
  const persistent = paramControlTemplate({ id: "gain", label: "Gain", type: "number", min: 0, max: 2, defaultValue: 0.75 }, "components.0.chain.0.params.gain", 1, "data-update", { significant: true });
  const live = paramControlTemplate({ id: "gain", label: "Gain", type: "number", min: 0, max: 2, defaultValue: 0.75 }, "chain.0.params.gain", 1, 'data-live-component-id="component-7" data-live-update');
  assert.match(persistent, /is-significant/);
  assert.match(persistent, /data-param-default="0\.75"/);
  assert.match(persistent, /data-param-context-mode="state"/);
  assert.match(live, /data-param-context-path="chain\.0\.params\.gain"/);
  assert.match(live, /data-param-default="0\.75"/);
  assert.match(live, /data-param-context-mode="live"/);
  assert.match(live, /data-param-context-component-id="component-7"/);
});

test("parameter controls retain an explicit context opt-out", () => {
  const html = paramControlTemplate(
    { id: "local", label: "Local", type: "number", min: 0, max: 1, defaultValue: 0.5 },
    "local",
    0.5,
    "data-update",
    { context: false }
  );
  assert.doesNotMatch(html, /data-param-context-path/);
});

test("parameter dropdowns use the shared compact select component", () => {
  const html = paramControlTemplate(
    { id: "mode", label: "Mode", type: "enum", values: ["one", "two"], defaultValue: "one" },
    "params.mode",
    "two"
  );
  assert.match(html, /<select class="param-select" data-update="params\.mode">/);
});

test("screen input params keep stable IDs while presenting session names and dimensions", () => {
  const param = { id: "inputId", label: "Input", type: "text", ui: "screen-input", defaultValue: "" };
  const inputs = [
    { id: "screen-one", name: "Slides", width: 1920, height: 1080 },
    { id: "screen-two", name: "Browser", width: 1280, height: 720 },
  ];
  const html = screenInputParamControlTemplate(param, "source.params.inputId", "screen-two", "data-update", { inputs });
  assert.match(html, /value="screen-one"[^>]*>Slides · 1920 × 1080/);
  assert.match(html, /value="screen-two" selected>Browser · 1280 × 720/);
  assert.match(html, /data-update="source\.params\.inputId"/);
});

test("paired persistent range handles retain independent parameter context metadata", () => {
  const html = paramRangePairTemplate({
    minParam: { id: "low", label: "Range", min: 0, max: 1, step: 0.01, defaultValue: 0.2 },
    maxParam: { id: "high", min: 0, max: 1, step: 0.01, defaultValue: 0.8 },
    minPath: "components.0.chain.0.params.low",
    maxPath: "components.0.chain.0.params.high",
    minValue: 0.25,
    maxValue: 0.75,
  });
  assert.match(html, /data-param-context-path="components\.0\.chain\.0\.params\.low" data-param-default="0\.2"/);
  assert.match(html, /data-param-context-path="components\.0\.chain\.0\.params\.high" data-param-default="0\.8"/);
});
