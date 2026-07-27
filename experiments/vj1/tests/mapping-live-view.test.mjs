import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { componentCatalogToolsTemplate } from "../js/control/catalog-view.js";
import { sceneComponents, ordinaryComponents } from "../js/control/control-selectors.js";
import { liveComponentPillTemplate, liveInspectorTemplate, liveProgramNavigableComponents, liveScenePillTemplate, liveTargetComponentPillTemplate, mappingPillTemplate, mappingSurfacePillTemplate, mappingSurfaceSectionTemplate, mappingSurfaceTemplate, sceneSignificantComponentTemplate } from "../js/control/mapping-live-view.js";
import { liveProjectionRailTemplate, projectRailTemplate } from "../js/control/project-rail-view.js";
import { createSceneComponent, createMappingFromState, createInitialState, sanitizeState } from "../js/domain/models.js";

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
  assert.match(mappingPillTemplate(mapping, state), />select_all</);
  assert.match(liveScenePillTemplate(liveScene, state), /data-live-scene=/);
  assert.match(liveScenePillTemplate(liveScene, state), /data-cycle-catalog-marker="scene"/);
  assert.match(liveInspectorTemplate(state), /live-component-card|No components/);
  const surfaceTemplate = mappingSurfaceTemplate(surface, state);
  assert.match(surfaceTemplate, /class="sculpt-card inspector-control-surface"/);
  assert.doesNotMatch(surfaceTemplate, /data-set-route-frame-id=/);
  assert.match(controller, /from "\.\/mapping-live-view\.js"/);
  assert.doesNotMatch(controller, /function liveInspectorTemplate\(/);
  assert.doesNotMatch(controller, /function mappingSurfaceTemplate\(/);
  assert.doesNotMatch(controller, /sceneSignificantComponentTemplate/);
});

test("Mapping Surface parameters use the shared inset control section", () => {
  const { state } = stateWithScene();
  const surface = state.surfaces[0];

  assert.match(mappingSurfaceTemplate(surface, state), /class="sculpt-card inspector-control-surface"/);
});

test("Mapping Surface rail membership comes from the selected Mapping, not the executable projection", () => {
  const state = createInitialState();
  const first = state.mappings[0];
  const second = createMappingFromState(state, "Second Mapping");
  second.surfaces = second.surfaces.map((surface, index) => ({
    ...surface,
    id: `second-surface-${index}`,
    name: `Second Surface ${index}`,
  }));
  state.mappings.push(second);
  state.ui.selectedMappingId = second.id;
  // Deliberately leave the compatibility projection pointing at Mapping one.
  state.surfaces = first.surfaces.map((surface) => ({ ...surface }));

  const html = mappingSurfaceSectionTemplate(state);

  assert.match(html, /Second Surface 0/);
  assert.doesNotMatch(html, new RegExp(`data-select-surface="${first.surfaces[0].id}"`));
});

test("Mapping Surface eye reflects authored Surface visibility, never Scene Mapping routing", () => {
  const { state, mapping } = stateWithScene();
  const authoredSurface = mapping.surfaces.find((surface) => surface.destination?.type !== "direct")
    || mapping.surfaces[0];
  authoredSurface.enabled = true;
  state.ui.live.sceneMappingInLive = false;
  state.ui.live.sceneMappingVisible = false;

  // `state.surfaces` is an executable projection. It may be disabled when
  // Scene Mapping has no active route, but it is not the eye's authority.
  const routedSurface = {
    ...authoredSurface,
    enabled: false,
  };
  const enabledHtml = mappingSurfacePillTemplate(routedSurface, state);
  assert.match(enabledHtml, /data-toggle-value="true"/);
  assert.match(enabledHtml, /data-toggle-enabled-icon="crop_free"/);
  assert.match(enabledHtml, />crop_free</);
  assert.doesNotMatch(enabledHtml, />hide_source</);

  authoredSurface.enabled = false;
  const staleEnabledRoute = {
    ...authoredSurface,
    enabled: true,
  };
  const disabledHtml = mappingSurfacePillTemplate(staleEnabledRoute, state);
  assert.match(disabledHtml, /data-toggle-value="false"/);
  assert.match(disabledHtml, /data-toggle-enabled-icon="crop_free"/);
  assert.match(disabledHtml, /data-toggle-disabled-icon="hide_source"/);
  assert.match(disabledHtml, />hide_source</);
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
  assert.equal(legacy.ui.live.showScenes, true);
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

test("Scene and Component cards share their workspace type icons across Live and authored catalogs", () => {
  const { state, liveScene } = stateWithScene();
  const component = state.components.find((candidate) => candidate.type !== "scene" && !candidate.systemRole);

  assert.match(liveScenePillTemplate(liveScene, state), /component-card-type-icon[^>]*>landscape</);
  assert.match(liveTargetComponentPillTemplate(component, state), /component-card-type-icon[^>]*>extension</);
  assert.match(projectRailTemplate(state, { workspace: "scene" }), /component-card-type-icon[^>]*>landscape</);
  assert.match(projectRailTemplate(state, { workspace: "component" }), /component-card-type-icon[^>]*>extension</);
});

test("Mapping membership and Live visibility are independent Scene Mapping controls", () => {
  const { state, mapping } = stateWithScene();
  const mappingHtml = projectRailTemplate(state, { workspace: "mapping" });
  assert.match(mappingHtml, /data-scene-mapping-in-live="true"/);
  assert.match(mappingHtml, />Scene Mapping</);

  state.ui.live.sceneMappingVisible = false;
  state.ui.live.previewSurfaceId = "__mapping__";
  const hiddenRouteHtml = liveProjectionRailTemplate(state);
  assert.match(hiddenRouteHtml, /data-live-surface-visibility="__mapping__"[^>]*title="Show Scene Mapping"/);
  assert.match(hiddenRouteHtml, /data-live-preview-surface="__mapping__"/);
  assert.match(hiddenRouteHtml, />Scene Mapping</);
  assert.doesNotMatch(hiddenRouteHtml, /data-clear-live-overall-component="__mapping__"/);

  state.ui.live.sceneMappingInLive = false;
  state.ui.live.previewSurfaceId = "__mapping__";
  const disabledHtml = liveProjectionRailTemplate(state);
  assert.match(disabledHtml, />Scene Mapping</);
  assert.match(disabledHtml, /data-live-surface-visibility="__mapping__"[^>]*title="Show Scene Mapping"/);
  assert.match(disabledHtml, /data-live-preview-surface="__mapping__"/);
  assert.doesNotMatch(disabledHtml, /Scene Mapping is disabled in Mapping/);
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
  state.ui.live.surfacePatches = { [mapping.surfaces[0].id]: patchedComponent.id };

  const components = liveProgramNavigableComponents(state);
  assert.deepEqual(new Set(components.map((component) => component.id)), new Set([
    liveScene.id,
    overallComponent.id,
    patchedComponent.id,
  ]));

  const html = liveProjectionRailTemplate(state);
  assert.match(html, new RegExp(`data-live-component="${overallComponent.id}"`));
  assert.match(html, new RegExp(`data-live-component="${patchedComponent.id}"`));
});

test("Live Component navigation retains the previous endpoint only until transition expiry", () => {
  const { state, liveScene, mapping } = stateWithScene();
  const currentNested = state.components.find((component) => component.type !== "scene" && !component.systemRole);
  const previous = {
    ...structuredClone(currentNested),
    id: "previous-transition-component",
    name: "Previous transition Component",
    chain: [],
  };
  state.components.push(previous);
  state.ui.live.selectedComponentId = liveScene.id;
  state.ui.live.transition = {
    id: "scene-to-component",
    fromTargetId: previous.id,
    fromSurfaceRoutes: {
      surfaces: mapping.surfaces.map((surface) => ({
        ...surface,
        enabled: true,
        componentId: previous.id,
      })),
    },
    startedAtMs: 1000,
    durationMs: 100,
  };

  assert.equal(
    liveProgramNavigableComponents(state, 1050).some((component) => component.id === previous.id),
    true,
    "the from endpoint remains inspectable while it is visibly transitioning",
  );
  assert.equal(
    liveProgramNavigableComponents(state, 1100).some((component) => component.id === previous.id),
    false,
    "the from endpoint leaves the Components panel at its exact deadline",
  );
});

test("Live inspector resolves the Overall Scene root when a Surface has no explicit patch", () => {
  const { state, liveScene, mapping } = stateWithScene();
  const surface = mapping.surfaces[0];
  state.ui.live.selectedComponentId = liveScene.id;
  state.ui.live.previewSurfaceId = surface.id;
  state.ui.live.patchSourceId = "";

  assert.match(liveInspectorTemplate(state), new RegExp(liveScene.name));
  assert.doesNotMatch(liveInspectorTemplate(state), /No sources/);
});

test("Live Component navigation is the enabled final render graph including its root Scene", () => {
  const { state, liveScene, mapping } = stateWithScene();
  const nested = state.components.find((component) => component.type !== "scene" && !component.systemRole);
  state.ui.live.selectedComponentId = liveScene.id;

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
  state.ui.live.surfaceVisibility = { [surface.id]: false };

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
  assert.match(html, /select_all/);
});

test("Live target reset is shown on Scene and Part thumbnails with temporary parameters", () => {
  const { state, liveScene } = stateWithScene();
  const component = state.components.find((item) => item.kind !== "scene");
  assert.doesNotMatch(liveScenePillTemplate(liveScene, state), /data-reset-live-target/);
  assert.doesNotMatch(liveTargetComponentPillTemplate(component, state), /data-reset-live-target/);

  state.ui.live.componentOverrides = { [state.components[0].id]: { opacity: 0.5 } };
  state.ui.live.sceneOverrides[liveScene.id] = state.ui.live.componentOverrides;
  assert.match(liveScenePillTemplate(liveScene, state), /data-reset-live-target/);

  state.ui.live.selectedComponentId = component.id;
  state.ui.live.componentOverrides = { [component.id]: { opacity: 0.25 } };
  state.ui.live.sceneOverrides[component.id] = state.ui.live.componentOverrides;
  assert.match(liveTargetComponentPillTemplate(component, state), /data-reset-live-target/);
});

test("Mapping Surface inspectors expose calibration only; source routing belongs to the Live program", () => {
  const { state } = stateWithScene();
  const html = mappingSurfaceTemplate(state.surfaces[0], state);

  assert.match(html, /data-reset-surface-mapping=/);
  assert.match(html, /data-update="mappings\.[^.]+\.surfaces\.[^.]+\.feather"/);
  assert.match(html, /data-update="mappings\.[^.]+\.surfaces\.[^.]+\.opacity"/);
  assert.match(html, /data-update="mappings\.[^.]+\.surfaces\.[^.]+\.projectionFit"/);
  assert.doesNotMatch(html, /data-set-route-frame-id=|data-catalog-sort-scope="source"|Filter frames/);
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
  assert.match(controls, new RegExp(`data-live-item-id="${component.chain[0].id}"`));
  assert.ok(
    controls.indexOf("Published controls") < controls.indexOf("Component placement"),
    "published controls stay visible above generic Component controls"
  );
  assert.doesNotMatch(controls, /class="live-chain-outline"/);

  state.ui.live.componentView = "elements";
  const elements = liveInspectorTemplate(state);
  assert.match(elements, /class="element-list-surface live-element-list-surface"[\s\S]*?class="live-chain-outline"/);
  assert.match(elements, /class="text-list-item live-chain-outline-row compact-list-row has-leading is-selected"/);
  assert.match(elements, /data-live-toggle="chain\.0\.enabled"/);
  assert.match(elements, new RegExp(`data-live-item-id="${component.chain[0].id}"`));
  assert.match(elements, /data-live-chain-item="[^"]+" data-live-component-id="[^"]+"/);
  assert.doesNotMatch(elements, />visibility(?:_off)?<\/span>/);
  assert.match(elements, /aria-label="Selected live element parameters"/);
  assert.doesNotMatch(elements, /class="live-component-controls"/);
});

test("Live Scene controls expose element Content scale instead of a Scene-root transform", () => {
  const { state, mapping, liveScene } = stateWithScene();
  mapping.surfaces[0].sourceNodeId = `component:${encodeURIComponent(liveScene.id)}`;
  mapping.surfaces[0].componentId = liveScene.id;
  state.ui.live.selectedComponentId = liveScene.id;
  state.ui.live.componentView = "controls";

  const controls = liveInspectorTemplate(state);
  assert.doesNotMatch(controls, /class="live-component-transform-controls"/);
  assert.doesNotMatch(controls, /data-live-update="transform\.scale"/);

  state.ui.live.componentView = "elements";
  const elements = liveInspectorTemplate(state);
  assert.match(elements, /data-live-update="chain\.0\.transform\.scale"/);
  assert.match(elements, /<span>Content scale<\/span>/);
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
    type: "generator",
    generatorId: "mediaImage",
    params: {
      mediaId: "media/cutout.png",
      renderQuality: 0.5,
      fit: "contain",
      alphaCut: 2,
      alphaFeather: 4,
    },
  };
  state.media.push({ id: source.source.params.mediaId, name: "cutout.png", type: "image" });
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
  assert.match(live, new RegExp(`data-live-item-id="${source.id}"`));
});
