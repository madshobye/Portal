import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { componentCatalogToolsTemplate } from "../js/control/catalog-view.js";
import { sceneComponents, ordinaryComponents } from "../js/control/control-selectors.js";
import { liveComponentPillTemplate, liveInspectorTemplate, liveProgramNavigableComponents, liveScenePillTemplate, liveTargetComponentPillTemplate, mappingPillTemplate, mappingSurfaceTemplate, sceneSignificantComponentTemplate } from "../js/control/mapping-live-view.js";
import { liveProjectionRailTemplate, projectRailTemplate } from "../js/control/project-rail-view.js";
import { createSceneComponent, createMappingFromState, createInitialState, sanitizeState } from "../js/domain/models.js?v=render-coordinate-scope-3";

function stateWithScene() {
  const state = createInitialState();
  const liveScene = createSceneComponent(0, state.components[0].id);
  state.components.push(liveScene);
  const mapping = createMappingFromState(state, "Mapping Test");
  state.mappings.push(mapping);
  state.ui.selectedMappingId = mapping.id;
  state.ui.live.selectedSceneId = liveScene.id;
  const normalized = sanitizeState(state);
  return {
    state: normalized,
    mapping: normalized.mappings.find((item) => item.id === mapping.id),
    liveScene: normalized.components.find((item) => item.id === liveScene.id),
  };
}

test("Mapping and Live Scene presentation lives outside the control orchestrator", () => {
  const { state, mapping, liveScene } = stateWithScene();
  const surface = state.surfaces[0];
  const controller = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");

  assert.match(mappingPillTemplate(mapping, state), /data-select-mapping=/);
  assert.match(liveScenePillTemplate(liveScene, state), /data-live-scene=/);
  assert.match(liveScenePillTemplate(liveScene, state), /data-cycle-catalog-marker="scene"/);
  assert.match(liveInspectorTemplate(state), /live-component-card|No components/);
  const surfaceTemplate = mappingSurfaceTemplate(surface, state);
  assert.match(surfaceTemplate, /class="sculpt-card inspector-control-surface"/);
  assert.match(surfaceTemplate, /data-set-route-frame-id=""/);
  assert.match(surfaceTemplate, />Empty</);
  assert.match(controller, /from "\.\/mapping-live-view\.js\?v=[^"]+"/);
  assert.doesNotMatch(controller, /function liveInspectorTemplate\(/);
  assert.doesNotMatch(controller, /function mappingSurfaceTemplate\(/);
  assert.doesNotMatch(controller, /sceneSignificantComponentTemplate/);
});

test("Mapping Surface parameters use the shared inset control section", () => {
  const { state } = stateWithScene();
  const surface = state.surfaces[0];

  assert.match(mappingSurfaceTemplate(surface, state), /class="sculpt-card inspector-control-surface"/);
});

test("Live combines independently enabled Scene and Part filters while keeping one on", () => {
  const { state, liveScene } = stateWithScene();
  const component = state.components.find((candidate) => candidate.type !== "scene" && !candidate.systemRole);
  const scenesHtml = projectRailTemplate(state, { workspace: "live" });
  assert.match(scenesHtml, /data-live-source-filter="scenes" aria-pressed="true"/);
  assert.match(scenesHtml, /data-live-source-filter="components" aria-pressed="true"/);
  assert.match(scenesHtml, new RegExp(`data-live-scene="${liveScene.id}"`));
  assert.match(scenesHtml, /data-live-target-component=/);

  state.ui.live.showComponents = true;
  const componentsHtml = projectRailTemplate(state, { workspace: "live" });
  assert.match(componentsHtml, /data-live-source-filter="scenes" aria-pressed="true"/);
  assert.match(componentsHtml, /data-live-source-filter="components" aria-pressed="true"/);
  assert.match(componentsHtml, new RegExp(`data-live-target-component="${component.id}"`));
  assert.match(componentsHtml, /data-live-scene=/);

  const legacy = sanitizeState({ ...state, ui: { ...state.ui, live: { sourceKind: "component" } } });
  assert.equal(legacy.ui.live.showScenes, false);
  assert.equal(legacy.ui.live.showComponents, true);
  assert.equal("sourceKind" in legacy.ui.live, false);

  const defaults = sanitizeState({ ...state, ui: { ...state.ui, live: {} } });
  assert.equal(defaults.ui.live.showScenes, true);
  assert.equal(defaults.ui.live.showComponents, true);
});

test("Live source cards distinguish Overall selection from a deliberate Surface patch", () => {
  const { state, liveScene } = stateWithScene();
  const component = state.components.find((candidate) => candidate.type !== "scene" && !candidate.systemRole);
  const surface = state.mappings[0].surfaces[0];
  state.ui.live.selectedSceneId = liveScene.id;
  state.ui.live.selectedComponentId = liveScene.id;
  state.ui.live.previewSurfaceId = surface.id;
  state.ui.live.patchSourceId = "";

  assert.doesNotMatch(liveScenePillTemplate(liveScene, state), /is-selected/);
  assert.doesNotMatch(liveTargetComponentPillTemplate(component, state), /is-selected/);

  state.ui.live.patchSourceId = component.id;
  assert.match(liveTargetComponentPillTemplate(component, state), /is-selected/);
  assert.doesNotMatch(liveScenePillTemplate(liveScene, state), /is-selected/);

  state.ui.live.previewSurfaceId = "__mapping__";
  state.ui.live.patchSourceId = "";
  assert.match(liveScenePillTemplate(liveScene, state), /is-selected/);
});

test("Live projection column exposes the overall Mapping and every Surface", () => {
  const { state, mapping, liveScene } = stateWithScene();
  state.ui.live.previewSurfaceId = "__mapping__";
  state.ui.live.selectedComponentId = liveScene.id;
  const html = liveProjectionRailTemplate(state);

  assert.match(html, /data-live-preview-surface="__mapping__"/);
  assert.match(html, /data-live-surface-visibility="__mapping__"/);
  assert.match(html, />Scene Mapping</);
  assert.match(html, />Output</);
  for (const surface of mapping.surfaces) {
    assert.match(html, new RegExp(`data-live-preview-surface="${surface.id}"`));
    assert.match(html, new RegExp(`data-live-surface-visibility="${surface.id}"`));
    assert.match(html, new RegExp(surface.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  const nestedComponent = state.components.find((component) => component.type !== "scene" && !component.systemRole);
  assert.match(html, />Components</);
  assert.match(html, new RegExp(`data-live-component="${nestedComponent.id}"`));
  assert.doesNotMatch(html, /data-clear-live-surface-patch=/);
  assert.match(html, /data-clear-live-overall-component="__mapping__"/);
  assert.doesNotMatch(html, /<small>/, "projection rows do not reserve space for secondary Frame metadata");

  state.ui.live.surfacePatches = { [mapping.surfaces[0].id]: nestedComponent.id };
  const patchedHtml = liveProjectionRailTemplate(state);
  assert.match(patchedHtml, new RegExp(`data-clear-live-surface-patch="${mapping.surfaces[0].id}"`));

  state.ui.live.selectedComponentId = nestedComponent.id;
  const overallPatchedHtml = liveProjectionRailTemplate(state);
  assert.match(overallPatchedHtml, /data-clear-live-overall-component="__mapping__"/);
});

test("Live internal Component focus is separate from the on-air source", () => {
  const { state, liveScene } = stateWithScene();
  const nestedComponent = state.components.find((component) => component.type !== "scene" && !component.systemRole);
  state.ui.live.selectedComponentId = liveScene.id;
  state.ui.live.inspectedComponentId = nestedComponent.id;

  assert.match(liveComponentPillTemplate(nestedComponent, state), /is-selected/);
  assert.match(liveInspectorTemplate(state), new RegExp(nestedComponent.name));
  assert.equal(state.ui.live.selectedComponentId, liveScene.id);
});

test("Live Component navigation includes roots and sources across all Surface routes", () => {
  const { state, liveScene, mapping } = stateWithScene();
  const overallComponent = state.components.find((component) => component.type !== "scene" && !component.systemRole);
  const patchedComponent = {
    ...structuredClone(overallComponent),
    id: "component-surface-patch",
    name: "Surface Patch",
    chain: [],
  };
  state.components.push(patchedComponent);
  state.ui.live.selectedComponentId = liveScene.id;
  state.ui.live.surfaceRoutes = {
    surfaces: mapping.surfaces.map((surface, index) => ({
      ...surface,
      componentId: index === 0 ? patchedComponent.id : overallComponent.id,
    })),
  };
  state.ui.live.surfacePatches = { [mapping.surfaces[0].id]: patchedComponent.id };

  const components = liveProgramNavigableComponents(state);
  assert.deepEqual(new Set(components.map((component) => component.id)), new Set([
    overallComponent.id,
    patchedComponent.id,
  ]));

  const html = liveProjectionRailTemplate(state);
  assert.match(html, new RegExp(`data-live-component="${overallComponent.id}"`));
  assert.match(html, new RegExp(`data-live-component="${patchedComponent.id}"`));
});

test("Live inspector resolves an indirect Overall route when a Surface has no explicit patch", () => {
  const { state, liveScene, mapping } = stateWithScene();
  const nestedComponent = state.components.find((component) => component.type !== "scene" && !component.systemRole);
  const surface = mapping.surfaces[0];
  state.ui.live.selectedComponentId = liveScene.id;
  state.ui.live.previewSurfaceId = surface.id;
  state.ui.live.patchSourceId = "";
  state.ui.live.surfaceRoutes = {
    surfaces: mapping.surfaces.map((candidate) => ({
      ...candidate,
      componentId: candidate.id === surface.id ? nestedComponent.id : liveScene.id,
    })),
  };

  assert.match(liveInspectorTemplate(state), new RegExp(nestedComponent.name));
  assert.doesNotMatch(liveInspectorTemplate(state), /No sources/);
});

test("Live Component navigation is the enabled final render graph including its root Scene", () => {
  const { state, liveScene, mapping } = stateWithScene();
  const nested = state.components.find((component) => component.type !== "scene" && !component.systemRole);
  state.ui.live.selectedComponentId = liveScene.id;
  state.ui.live.surfaceRoutes = {
    surfaces: mapping.surfaces.map((surface) => ({ ...surface, componentId: liveScene.id })),
  };

  assert.deepEqual(liveProgramNavigableComponents(state).map((component) => component.id), [
    liveScene.id,
    nested.id,
  ]);

  liveScene.chain[0].enabled = false;
  assert.deepEqual(liveProgramNavigableComponents(state).map((component) => component.id), [liveScene.id]);
});

test("Live projection visibility reflects the routed program rather than changing Mapping state", () => {
  const { state, mapping } = stateWithScene();
  const surface = mapping.surfaces[0];
  state.ui.live.surfaceRoutes = { surfaces: mapping.surfaces.map((candidate) => ({ ...candidate })) };
  state.ui.live.surfaceRoutes.surfaces[0].enabled = false;

  const html = liveProjectionRailTemplate(state);
  assert.match(html, new RegExp(`data-live-surface-visibility="${surface.id}"`));
  assert.match(html, new RegExp(`data-live-surface-visibility="${surface.id}"[^>]*title="Show`));
  assert.notEqual(surface.enabled, false);
});

test("Mapping cards intentionally avoid render thumbnails", () => {
  const { state, mapping } = stateWithScene();
  const scene = { ...state.components[0], id: "scene-a", type: "scene", thumbnail: "scene-thumb", scene: { frameThumbnails: { "frame-a": "frame-thumb" } } };
  state.components = [scene];
  state.frames = [{ id: "frame-a", name: "Frame A", x: 0, y: 0, width: 0.5, height: 0.5 }];
  mapping.surfaces[0] = {
    ...mapping.surfaces[0],
    sourceNodeId: "recording-frame:scene-a:frame-a",
    componentId: scene.id,
    outputFrameId: "frame-a",
  };

  const html = mappingPillTemplate(mapping, state);
  assert.doesNotMatch(html, /src="frame-thumb"/);
  assert.doesNotMatch(html, /src="scene-thumb"/);
  assert.match(html, /display_settings/);
});

test("Live Scene reset is absent until temporary parameters exist", () => {
  const { state, liveScene } = stateWithScene();
  assert.doesNotMatch(liveScenePillTemplate(liveScene, state), /data-reset-live-scene/);

  state.ui.live.componentOverrides = { [state.components[0].id]: { opacity: 0.5 } };
  state.ui.live.sceneOverrides[liveScene.id] = state.ui.live.componentOverrides;
  assert.match(liveScenePillTemplate(liveScene, state), /data-reset-live-scene/);
});

test("Mapping surface source catalogs contain only Frame slots", () => {
  const { state, mapping, liveScene } = stateWithScene();
  const mappingSurface = mapping.surfaces[0];
  const frame = state.frames[0];
  mappingSurface.frameSlotId = frame.id;
  mappingSurface.outputFrameId = frame.id;
  const html = mappingSurfaceTemplate(state.surfaces[0], state);
  const list = html.slice(html.indexOf('<div class="component-card-list assignment-card-list"'));
  const styles = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.match(html, /class="component-card assignment-selected-card is-selected"/);
  assert.match(html, /data-catalog-sort-scope="source"/);
  assert.ok(html.indexOf("assignment-selected-card") < html.indexOf("component-catalog-tools"), "current component appears before search and sorting");
  assert.ok(html.indexOf("component-catalog-tools") < html.indexOf("assignment-card-list"), "search and sorting appear before the component list");
  assert.equal((html.match(/data-set-route-frame-id=/g) || []).length, state.frames.length + 1);
  assert.match(html, /Filter frames/);
  assert.match(html, />Main output<\/span>/);
  assert.doesNotMatch(html, new RegExp(`${liveScene.name} · Main output`));
  assert.doesNotMatch(list, /component:a|component:b|component:c/);
  assert.match(styles, /\.assignment-selected-card \{[\s\S]*?width: 100%;/);
  assert.match(styles, /\.assignment-card-list \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
});

test("catalog presentation and component selectors have single owners", () => {
  const state = createInitialState();
  const catalog = componentCatalogToolsTemplate("component", "changed", "Filter components");

  assert.match(catalog, /data-catalog-sort-scope="component"/);
  assert.match(catalog, /data-component-filter/);
  assert.doesNotMatch(catalog, /<span>Changed<\/span>/);
  assert.equal(ordinaryComponents(state).every((component) => component.type !== "scene"), true);
  assert.equal(sceneComponents(state).every((component) => component.type === "scene"), true);
  assert.equal(ordinaryComponents(state).length + sceneComponents(state).length, state.components.length);
});

test("Live navigates components by thumbnail and Scene exposes marked significant params", () => {
  const { state } = stateWithScene();
  const component = state.components[0];
  component.significantParams = ["chain.0.source.params.renderQuality"];
  state.ui.live.selectedComponentId = component.id;
  const picker = liveComponentPillTemplate(component, state);
  const significant = sceneSignificantComponentTemplate(component, state);
  assert.match(picker, /data-live-component=/);
  assert.match(picker, /component-thumbnail/);
  assert.match(significant, /Significant/);
  assert.match(significant, new RegExp(`data-edit-component="${component.id}"`));
  assert.match(significant, /components\.0\.chain\.0\.source\.params\.renderQuality/);
});

test("Live separates a Component's public controls from its element inspector", () => {
  const { state, mapping } = stateWithScene();
  const component = state.components[0];
  mapping.surfaces[0].sourceNodeId = `component:${encodeURIComponent(component.id)}`;
  mapping.surfaces[0].componentId = component.id;
  component.significantParams = ["chain.0.source.params.renderQuality", "chain.0.transform.scale"];
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
  assert.doesNotMatch(controls, /data-live-update="transform\.rotation"/);
  assert.match(controls, /data-live-update="chain\.0\.source\.params\.renderQuality"/);
  assert.match(controls, /data-live-update="chain\.0\.transform\.scale"/);
  assert.ok(
    controls.indexOf("Published controls") < controls.indexOf("Component placement"),
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
  const { state, mapping } = stateWithScene();
  const owner = state.components[0];
  const referenced = {
    ...owner,
    id: "component-internal-id",
    name: "User facing component",
    chain: [],
  };
  state.components.push(referenced);
  mapping.surfaces[0].sourceNodeId = `component:${encodeURIComponent(owner.id)}`;
  mapping.surfaces[0].componentId = owner.id;
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
  const { state, mapping } = stateWithScene();
  const component = state.components[0];
  mapping.surfaces[0].sourceNodeId = `component:${encodeURIComponent(component.id)}`;
  mapping.surfaces[0].componentId = component.id;
  component.significantParams = ["chain.0.source.params.renderQuality"];
  state.ui.live.selectedComponentId = component.id;

  const live = liveInspectorTemplate(state);
  assert.match(live, /data-live-update="chain\.0\.source\.params\.renderQuality"/);

  const sceneControls = sceneSignificantComponentTemplate(component, state);
  assert.match(sceneControls, /data-update="components\.0\.chain\.0\.source\.params\.renderQuality"/);
});

test("image source schema automatically exposes cut and feather in Live and published controls", () => {
  const { state, mapping } = stateWithScene();
  const component = state.components[0];
  const source = component.chain[0];
  source.source = {
    type: "media",
    mediaId: "media/cutout.png",
    params: { renderQuality: 0.5, fit: "contain", alphaCut: 2, alphaFeather: 4 },
  };
  state.media.push({ id: source.source.mediaId, name: "cutout.png", type: "image" });
  mapping.surfaces[0].sourceNodeId = `component:${encodeURIComponent(component.id)}`;
  mapping.surfaces[0].componentId = component.id;
  state.ui.live.selectedComponentId = component.id;
  state.ui.live.selectedChainItemId = source.id;
  state.ui.live.componentView = "elements";

  const elements = liveInspectorTemplate(state);
  assert.match(elements, /data-live-update="chain\.0\.source\.params\.alphaCut"/);
  assert.match(elements, /data-live-update="chain\.0\.source\.params\.alphaFeather"/);
  assert.match(elements, /<span>Cut edge<\/span>/);
  assert.match(elements, /<span>Feather<\/span>/);

  component.significantParams = ["chain.0.source.params.alphaFeather"];
  state.ui.live.componentView = "controls";
  assert.match(liveInspectorTemplate(state), /data-live-update="chain\.0\.source\.params\.alphaFeather"/);
});

test("Live publishes significant source parameters nested inside Groups", () => {
  const { state, mapping } = stateWithScene();
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
  mapping.surfaces[0].sourceNodeId = `component:${encodeURIComponent(component.id)}`;
  mapping.surfaces[0].componentId = component.id;
  state.ui.live.selectedComponentId = component.id;
  state.ui.live.componentView = "controls";

  const live = liveInspectorTemplate(state);
  assert.match(live, /Controls \(2\)/);
  assert.match(live, /data-live-update="chain\.0\.chain\.0\.source\.params\.renderQuality"/);
  assert.match(live, /data-live-update="chain\.0\.chain\.0\.transform\.scale"/);
});
