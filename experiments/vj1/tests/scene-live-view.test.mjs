import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { componentCatalogToolsTemplate } from "../js/control/catalog-view.js";
import { canvasComponents, ordinaryComponents } from "../js/control/control-selectors.js";
import { liveComponentPillTemplate, liveInspectorTemplate, liveScenePillTemplate, prioritizeSelectedSource, scenePillTemplate, sceneSignificantComponentTemplate, sceneSurfaceTemplate } from "../js/control/scene-live-view.js";
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
  assert.match(controller, /from "\.\/scene-live-view\.js\?v=live-component-controls-1"/);
  assert.doesNotMatch(controller, /function liveInspectorTemplate\(/);
  assert.doesNotMatch(controller, /function sceneSurfaceTemplate\(/);
});

test("Scene surface source catalogs put the assigned source first without disturbing the remainder", () => {
  const sources = [
    { id: "", name: "Empty" },
    { id: "component:a", name: "A" },
    { id: "component:b", name: "B" },
    { id: "component:c", name: "C" },
  ];

  assert.deepEqual(
    prioritizeSelectedSource(sources, "component:b").map((item) => item.id),
    ["component:b", "", "component:a", "component:c"]
  );
  assert.deepEqual(sources.map((item) => item.id), ["", "component:a", "component:b", "component:c"]);
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

test("Live navigates components by thumbnail and Scene exposes marked significant params", () => {
  const { state } = stateWithScene();
  const component = state.components[0];
  component.significantParams = ["chain.0.params.renderQuality"];
  state.ui.live.selectedComponentId = component.id;
  const picker = liveComponentPillTemplate(component, state);
  const significant = sceneSignificantComponentTemplate(component, state);
  assert.match(picker, /data-live-component=/);
  assert.match(picker, /component-thumbnail/);
  assert.match(significant, /Significant/);
  assert.match(significant, /components\.0\.chain\.0\.params\.renderQuality/);
});

test("Live separates a Component's public controls from its element inspector", () => {
  const { state, scene } = stateWithScene();
  const component = state.components[0];
  scene.snapshot.surfaces[0].sourceNodeId = `component:${encodeURIComponent(component.id)}`;
  scene.snapshot.surfaces[0].componentId = component.id;
  component.significantParams = ["chain.0.params.renderQuality", "chain.0.transform.scale"];
  state.ui.live.selectedComponentId = component.id;

  const controls = liveInspectorTemplate(state);
  assert.match(controls, /data-live-component-view="controls"/);
  assert.match(controls, /data-live-component-view="elements"/);
  assert.match(controls, /data-live-update="opacity"/);
  assert.match(controls, /data-live-update="speed"/);
  assert.match(controls, /data-live-update="blend"/);
  assert.match(controls, /data-live-update="chain\.0\.params\.renderQuality"/);
  assert.match(controls, /data-live-update="chain\.0\.transform\.scale"/);
  assert.doesNotMatch(controls, /class="live-chain-outline"/);

  state.ui.live.componentView = "elements";
  const elements = liveInspectorTemplate(state);
  assert.match(elements, /class="live-chain-outline"/);
  assert.match(elements, /aria-label="Selected live element parameters"/);
  assert.doesNotMatch(elements, /class="live-component-controls"/);
});

test("Live component-source rows resolve user-facing component names", () => {
  const { state, scene } = stateWithScene();
  const owner = state.components[0];
  const referenced = {
    ...owner,
    id: "component-internal-id",
    name: "User facing component",
    chain: [],
  };
  state.components.push(referenced);
  scene.snapshot.surfaces[0].sourceNodeId = `component:${encodeURIComponent(owner.id)}`;
  scene.snapshot.surfaces[0].componentId = owner.id;
  owner.chain.unshift({
    id: "nested-component",
    kind: "source",
    name: referenced.id,
    enabled: true,
    source: { type: "component", componentId: referenced.id },
    transform: {},
    blend: "normal",
    opacity: 1,
  });
  state.ui.live.selectedComponentId = owner.id;
  state.ui.live.componentView = "elements";

  const html = liveInspectorTemplate(state);
  assert.match(html, new RegExp(`>${referenced.name}<\\/span>`));
  assert.doesNotMatch(html, new RegExp(`>${referenced.id}<\\/span>`));
});

test("Scene significant controls include generic chain transforms", () => {
  const { state } = stateWithScene();
  const component = state.components[0];
  component.chain[0].transform = { x: 0.4, y: 0, scale: 1, rotation: 0 };
  component.significantParams = ["chain.0.transform.x"];

  const significant = sceneSignificantComponentTemplate(component, state);
  assert.match(significant, /components\.0\.chain\.0\.transform\.x/);
  assert.match(significant, /value="0\.4"/);
});
