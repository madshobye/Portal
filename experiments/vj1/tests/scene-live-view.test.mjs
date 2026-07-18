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
  assert.match(controller, /from "\.\/scene-live-view\.js\?v=live-published-controls-1"/);
  assert.doesNotMatch(controller, /function liveInspectorTemplate\(/);
  assert.doesNotMatch(controller, /function sceneSurfaceTemplate\(/);
});

test("Live Scene reset is absent until temporary parameters exist", () => {
  const { state, scene } = stateWithScene();
  assert.doesNotMatch(liveScenePillTemplate(scene, state), /data-reset-live-scene/);

  state.ui.live.componentOverrides = { [state.components[0].id]: { opacity: 0.5 } };
  state.ui.live.sceneOverrides[scene.id] = state.ui.live.componentOverrides;
  assert.match(liveScenePillTemplate(scene, state), /data-reset-live-scene/);
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
  assert.match(controls, />[^<]*Controls \(2\)<\/button>/);
  assert.match(controls, /data-live-component-view="elements"/);
  assert.match(controls, /data-live-update="opacity"/);
  assert.match(controls, /data-live-update="speed"/);
  assert.match(controls, /data-live-update="blend"/);
  assert.match(controls, /data-live-update="transform\.x"/);
  assert.match(controls, /data-live-update="transform\.y"/);
  assert.match(controls, /data-live-update="transform\.scale"/);
  assert.match(controls, /data-live-update="transform\.rotation"/);
  assert.match(controls, /data-live-update="chain\.0\.params\.renderQuality"/);
  assert.match(controls, /data-live-update="chain\.0\.transform\.scale"/);
  assert.ok(
    controls.indexOf("Published controls") < controls.indexOf("Transform"),
    "published controls stay visible above generic Component controls"
  );
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

test("source parameters marked at their persisted path are published in Live", () => {
  const { state, scene } = stateWithScene();
  const component = state.components[0];
  scene.snapshot.surfaces[0].sourceNodeId = `component:${encodeURIComponent(component.id)}`;
  scene.snapshot.surfaces[0].componentId = component.id;
  component.significantParams = ["chain.0.source.params.renderQuality"];
  state.ui.live.selectedComponentId = component.id;

  const live = liveInspectorTemplate(state);
  assert.match(live, /data-live-update="chain\.0\.params\.renderQuality"/);

  const sceneControls = sceneSignificantComponentTemplate(component, state);
  assert.match(sceneControls, /data-update="components\.0\.chain\.0\.source\.params\.renderQuality"/);
});

test("Live publishes significant source parameters nested inside Groups", () => {
  const { state, scene } = stateWithScene();
  const component = state.components[0];
  const source = component.chain[0];
  component.chain = [{
    id: "group-a",
    kind: "group",
    name: "Group A",
    enabled: true,
    opacity: 1,
    blend: "normal",
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    chain: [source],
  }];
  component.significantParams = [
    "chain.0.chain.0.source.params.renderQuality",
    "chain.0.chain.0.transform.scale",
  ];
  scene.snapshot.surfaces[0].sourceNodeId = `component:${encodeURIComponent(component.id)}`;
  scene.snapshot.surfaces[0].componentId = component.id;
  state.ui.live.selectedComponentId = component.id;
  state.ui.live.componentView = "controls";

  const live = liveInspectorTemplate(state);
  assert.match(live, /Controls \(2\)/);
  assert.match(live, /data-live-update="chain\.0\.chain\.0\.params\.renderQuality"/);
  assert.match(live, /data-live-update="chain\.0\.chain\.0\.transform\.scale"/);
});
