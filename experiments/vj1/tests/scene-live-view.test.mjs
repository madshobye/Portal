import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { componentCatalogToolsTemplate } from "../js/control/catalog-view.js";
import { canvasComponents, ordinaryComponents } from "../js/control/control-selectors.js";
import { liveInspectorTemplate, liveScenePillTemplate, scenePillTemplate, sceneSurfaceTemplate } from "../js/control/scene-live-view.js";
import { createSceneFromState, createInitialState } from "../js/domain/models.js?v=render-coordinate-scope-3";

function stateWithScene() {
  const state = createInitialState();
  const scene = createSceneFromState(state, "Scene Test");
  state.scenes.push(scene);
  state.ui.selectedSceneId = scene.id;
  state.ui.live.selectedSceneId = scene.id;
  return { state, scene };
}

test("Scene and Live presentation lives outside the control orchestrator", () => {
  const { state, scene } = stateWithScene();
  const surface = state.surfaces[0];
  const controller = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");

  assert.match(scenePillTemplate(scene, state), /data-select-scene=/);
  assert.match(liveScenePillTemplate(scene, state), /data-live-scene=/);
  assert.match(liveInspectorTemplate(state), /live-component-card|No components/);
  const surfaceTemplate = sceneSurfaceTemplate(surface, state);
  assert.match(surfaceTemplate, /class="sculpt-card"/);
  assert.match(surfaceTemplate, /data-set-route-source-node=""/);
  assert.match(surfaceTemplate, />Empty</);
  assert.match(controller, /from "\.\/scene-live-view\.js\?v=terrain-mesh-near-1"/);
  assert.doesNotMatch(controller, /function liveInspectorTemplate\(/);
  assert.doesNotMatch(controller, /function sceneSurfaceTemplate\(/);
});

test("catalog presentation and component selectors have single owners", () => {
  const state = createInitialState();
  const catalog = componentCatalogToolsTemplate("component", "changed", "Filter components");

  assert.match(catalog, /data-catalog-sort-scope="component"/);
  assert.match(catalog, /data-component-filter/);
  assert.equal(ordinaryComponents(state).every((component) => component.type !== "canvas"), true);
  assert.equal(canvasComponents(state).every((component) => component.type === "canvas"), true);
  assert.equal(ordinaryComponents(state).length + canvasComponents(state).length, state.components.length);
});
