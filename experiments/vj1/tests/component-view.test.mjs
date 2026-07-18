import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { canvasInspectorTemplate, componentSelectedChainSettingsTemplate, componentTemplate } from "../js/control/component-view.js";
import { createInitialState } from "../js/domain/models.js?v=render-coordinate-scope-3";

test("Component and Canvas chain presentation lives outside the control orchestrator", () => {
  const state = createInitialState();
  const component = state.components.find((item) => item.type !== "canvas");
  const canvas = state.components.find((item) => item.type === "canvas") || {
    ...component,
    id: "canvas-test",
    type: "canvas",
    canvas: { width: 1920, height: 1080 },
  };
  const componentHtml = componentTemplate(component, state);
  const settingsHtml = componentSelectedChainSettingsTemplate(component, state);
  const canvasHtml = canvasInspectorTemplate(canvas, { ...state, components: [...state.components, canvas] });
  const controller = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");

  assert.match(componentHtml, /class="component-frame-controls"/);
  assert.match(componentHtml, /data-chain-reorder-list/);
  assert.doesNotMatch(componentHtml, /chain-item-remove[^>]*disabled/);
  assert.match(settingsHtml, /class="ui-section focus-panel chain-settings-panel"/);
  assert.match(settingsHtml, />Content<\/label>|>Primary<\/label>/);
  assert.match(settingsHtml, />Transform<\/label>/);
  assert.ok(settingsHtml.indexOf("ui-section-header rail-title") < settingsHtml.indexOf("chain-param-views"));
  assert.match(settingsHtml, /data-update="components\.[0-9]+\.chain\.0\.transform\.x"/);
  assert.match(settingsHtml, /data-param-context-path="components\.[0-9]+\.chain\.0\.transform\.scale"/);
  assert.match(canvasHtml, /data-update="components\.[0-9]+\.canvas\.width"/);
  assert.match(controller, /from "\.\/component-view\.js\?v=[^"]+"/);
  assert.doesNotMatch(controller, /function componentTemplate\(/);
  assert.doesNotMatch(controller, /function componentUnifiedChainTemplate\(/);
  assert.doesNotMatch(controller, /function sourcePickerTemplate\(/);
});

test("Canvas component placements render selected settings without a redundant source selector", () => {
  const state = createInitialState();
  const referenced = state.components.find((item) => item.type !== "canvas");
  const placement = {
    id: "canvas-placement",
    kind: "source",
    name: "Placed component",
    enabled: true,
    source: { type: "component", componentId: referenced.id },
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    blend: "normal",
    opacity: 1,
  };
  const canvas = {
    id: "canvas-settings-test",
    name: "Canvas settings test",
    type: "canvas",
    canvas: { width: 1920, height: 1080 },
    chain: [placement],
  };
  const canvasState = {
    ...state,
    components: [...state.components, canvas],
    ui: { ...state.ui, selectedChainItemId: placement.id },
  };

  const html = componentSelectedChainSettingsTemplate(canvas, canvasState);
  assert.match(html, new RegExp(`>${referenced.name}<\\/span>`));
  assert.doesNotMatch(html, /<label class="field">Component /);
  assert.match(html, /data-update="components\.[0-9]+\.chain\.0\.opacity"/);
});

test("persistent and Live source editors share one media-model control schema", () => {
  const componentView = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const sceneLiveView = readFileSync(new URL("../js/control/scene-live-view.js", import.meta.url), "utf8");
  const schema = readFileSync(new URL("../js/control/source-control-schema.js", import.meta.url), "utf8");

  assert.match(componentView, /from "\.\/source-control-schema\.js\?v=xray-outline-1"/);
  assert.match(sceneLiveView, /from "\.\/source-control-schema\.js\?v=xray-outline-1"/);
  assert.match(schema, /export const MODEL_SOURCE_PARAMS/);
  assert.doesNotMatch(sceneLiveView, /const MODEL_SOURCE_PARAMS =/);
  assert.match(componentView, /chainParamViewDefinitions\(content, details,/);
  assert.match(sceneLiveView, /chainParamViewDefinitions\(/);
});

test("STL sources expose the same Primary Details and Transform views in Component editing", () => {
  const state = createInitialState();
  const component = state.components.find((item) => item.type !== "canvas");
  const source = component.chain[0];
  source.source = {
    type: "media",
    mediaId: "media/sculpture.stl",
    params: {
      renderMode: "surfaceWire",
      rotationX: 0.4,
      modelScale: 2,
      pointBudget: 12000,
      renderQuality: 0.75,
    },
  };
  state.media.push({ id: source.source.mediaId, name: "sculpture.stl", type: "model" });
  state.ui.selectedChainItemId = source.id;

  const html = componentSelectedChainSettingsTemplate(component, state);

  assert.match(html, />Primary<\/label>/);
  assert.match(html, />Details<\/label>/);
  assert.match(html, />Transform<\/label>/);
  assert.match(html, /data-update="components\.0\.chain\.0\.source\.params\.rotationX"/);
  assert.match(html, /data-update="components\.0\.chain\.0\.source\.params\.modelScale"/);
  assert.match(html, /data-update="components\.0\.chain\.0\.source\.params\.renderQuality"/);
  assert.match(html, /data-update="components\.0\.chain\.0\.transform\.scale"/);
});
