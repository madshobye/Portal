import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { sceneComponents, ordinaryComponents } from "../js/control/control-selectors.js";
import { liveProgramNavigableComponents, liveSignificantParameterAssignments, selectedLiveComponentViewModel, selectedLiveGeneralParameterModel, selectedLiveInspectorModel, selectedLiveParameterTabsModel, selectedLiveRetainedParameterModel, significantParameterValueFromUnit } from "../js/control/mapping-live-view.js";
import { componentCatalogUiModel, liveChainContentParameterUiGraph, liveChainGeneralParameterUiGraph, liveComponentControlsUiGraph, liveComponentViewUiGraph, liveProjectionRailUiGraph, liveRailUiGraph, liveSignificantUiGraph, mappingRailUiGraph, parameterTabsUiGraph } from "../js/control/control-ui-program.js";
import { mappingSurfaceControlDescriptors, mappingSurfaceInspectorUiGraph } from "../js/control/control-ui-program.js";
import { componentCatalogListItems, liveProjectionListModel, liveSourceListItems, mappingCatalogListItems, selectedLiveSourceId } from "../js/control/project-rail-view.js";
import { renderListItemsHtml } from "../js/libraries/ui-engine/index.js";
import { createLiveComponentView, createSceneComponent, createMappingFromState, createInitialState, sanitizeState } from "../js/domain/models.js";
import { createVj1NodePackage } from "../js/app-node-package.js";
import {
  componentLayerProjection,
  migrateLegacyComponentParameterAddress,
} from "../js/domain/component-layer-projection.js";

const nodePackage = createVj1NodePackage();

function liveInspectorProjection(state) {
  const model = selectedLiveInspectorModel(state);
  return JSON.stringify(model);
}

function prepare(state) {
  return nodePackage.prepareProjectState(state);
}

function markSignificant(state, component, paths) {
  component.significantParams = paths.map((path) =>
    migrateLegacyComponentParameterAddress(state, component, path)
  );
}

function rebuildFixtureGraphs(state) {
  state.nodes = {
    ...state.nodes,
    groups: (state.nodes?.groups || []).filter((group) =>
      group.generatedBy !== "vj1-component-compiler"
    ),
  };
  Object.assign(state, prepare(state));
  return state;
}

function stateWithScene() {
  const state = createInitialState();
  const liveScene = createSceneComponent(0, state.components[0].id);
  state.components.push(liveScene);
  const mapping = createMappingFromState(state, "Mapping Test");
  state.mappings.push(mapping);
  state.ui.selectedMappingId = mapping.id;
  state.ui.live.selectedSceneId = liveScene.id;
  const normalized = prepare(sanitizeState(state));
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

  const [mappingItem] = mappingCatalogListItems([mapping]);
  assert.equal(mappingItem.id, mapping.id);
  assert.equal(mappingItem.media.fallback, "select_all");
  const [liveSceneItem] = liveSourceListItems([liveScene], state);
  assert.equal(liveSceneItem.id, liveScene.id);
  assert.equal(liveSceneItem.actions[0].id, "marker");
  assert.ok(selectedLiveInspectorModel(state).targetId);
  const surfaceGraph = mappingSurfaceInspectorUiGraph(surface, state);
  assert.ok(surfaceGraph.nodes.some((node) => node.id === "mapping-surface-panel"));
  assert.ok(surfaceGraph.nodes.some((node) => node.id === "mapping-surface-controls"));
  assert.match(controller, /from "\.\/mapping-live-view\.js"/);
  assert.doesNotMatch(controller, /function liveInspectorTemplate\(/);
  assert.doesNotMatch(controller, /mappingSurfaceTemplate/);
  assert.doesNotMatch(controller, /sceneSignificantComponentTemplate/);
});

test("Live inspector uses the same compact semantic header as the other workspace sections", () => {
  const { state } = stateWithScene();
  const model = selectedLiveInspectorModel(state);

  assert.equal(model.title, "Parameters");
  assert.equal(model.icon, "tune");
  assert.equal(model.media, null);
});

test("Live element inspection allocates a visible bounded parameter region", () => {
  const { state } = stateWithScene();
  state.ui.live.componentView = "elements";
  const model = selectedLiveInspectorModel(state);

  assert.ok(model.secondaryChildren.length > 0);
  assert.deepEqual(model.secondaryChildren[0].layout, {
    fill: true,
    grow: 1,
    shrink: 1,
    basis: 0,
    overflow: "hidden",
  });
  assert.deepEqual(model.secondaryLayout, {
    fill: true,
    grow: 0,
    shrink: 0,
    basis: "40%",
    overflow: "hidden",
  });
});

test("Mapping Surface parameters use the shared inset control section", () => {
  const { state } = stateWithScene();
  const surface = state.surfaces[0];

  const controlsLayout = mappingSurfaceInspectorUiGraph(surface, state).nodes
    .find((node) => node.id === "mapping-surface-controls");
  assert.equal(controlsLayout.inputs.presentation, "inspector-controls");
  assert.equal(controlsLayout.inputs.sizing, "content");
  assert.deepEqual(controlsLayout.inputs.slots.map((slot) => slot.id), ["reset", "parameters"]);
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

  const collection = mappingRailUiGraph(state).nodes.find((node) => node.id === "mapping-surface-collection");
  assert.ok(collection.inputs.items.some((item) => item.label === "Second Surface 0"));
  assert.ok(!collection.inputs.items.some((item) => item.id === first.surfaces[0].id));
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
  state.surfaces = [routedSurface];
  let surfaceItem = mappingRailUiGraph(state).nodes
    .find((node) => node.id === "mapping-surface-collection").inputs.items
    .find((item) => item.id === authoredSurface.id);
  assert.equal(surfaceItem.actions[0].icon, "crop_free");
  assert.equal(surfaceItem.actions[0].presentation, "enabled-toggle");

  authoredSurface.enabled = false;
  const staleEnabledRoute = {
    ...authoredSurface,
    enabled: true,
  };
  state.surfaces = [staleEnabledRoute];
  surfaceItem = mappingRailUiGraph(state).nodes
    .find((node) => node.id === "mapping-surface-collection").inputs.items
    .find((item) => item.id === authoredSurface.id);
  assert.equal(surfaceItem.actions[0].icon, "hide_source");
  assert.equal(surfaceItem.actions[0].presentation, "disabled-toggle");
});

test("Live combines independently enabled Scene and Part filters while keeping one on", () => {
  const { state, liveScene } = stateWithScene();
  const component = state.components.find((candidate) => candidate.type !== "scene" && !candidate.systemRole);
  let graph = liveRailUiGraph(state, { items: liveSourceListItems([...sceneComponents(state), ...ordinaryComponents(state)], state) });
  assert.equal(graph.nodes.find((node) => node.id === "live-source-collection").inputs.hasToolSlot, true);
  assert.equal(graph.nodes.find((node) => node.id === "live-source-scenes").inputs.value, true);
  assert.equal(graph.nodes.find((node) => node.id === "live-source-components").inputs.value, true);
  assert.ok(graph.nodes.find((node) => node.id === "live-source-collection").inputs.items.some((item) => item.id === liveScene.id));
  assert.ok(graph.nodes.find((node) => node.id === "live-source-collection").inputs.items.some((item) => item.id === component.id));

  state.ui.live.showComponents = true;
  graph = liveRailUiGraph(state, { items: liveSourceListItems([...sceneComponents(state), ...ordinaryComponents(state)], state) });
  assert.equal(graph.nodes.find((node) => node.id === "live-source-components").inputs.value, true);

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

  assert.equal(selectedLiveSourceId(state), "");

  state.ui.live.patchSourceId = component.id;
  assert.equal(selectedLiveSourceId(state), component.id);

  state.ui.live.previewSurfaceId = "__mapping__";
  state.ui.live.patchSourceId = "";
  assert.equal(selectedLiveSourceId(state), liveScene.id);
});

test("Live projection column exposes the overall Mapping and every Surface", () => {
  const { state, mapping, liveScene } = stateWithScene();
  state.ui.live.previewSurfaceId = "__mapping__";
  state.ui.live.selectedComponentId = liveScene.id;
  let model = liveProjectionListModel(state);
  const graph = liveProjectionRailUiGraph(model);
  assert.equal(model.selectedOutputId, "__mapping__");
  assert.equal(graph.nodes.find((node) => node.id === "live-output-collection").inputs.title, "Output");
  assert.equal(model.outputItems[0].label, "Scene Mapping");
  assert.equal(model.outputItems[0].actions[0].id, "toggle-visibility");
  for (const surface of mapping.surfaces) {
    assert.equal(model.outputItems.find((item) => item.id === surface.id)?.label, surface.name);
  }
  const nestedComponent = state.components.find((component) => component.type !== "scene" && !component.systemRole);
  assert.ok(model.componentItems.some((item) => item.id === nestedComponent.id));
  assert.ok(!model.outputItems.slice(1).some((item) => item.actions.some((action) => action.id === "clear-patch")));
  assert.ok(model.outputItems[0].actions.some((action) => action.id === "clear-overall"));
  assert.ok(model.outputItems.every((item) => !item.meta), "projection rows do not reserve space for secondary Frame metadata");

  state.ui.live.surfacePatches = { [mapping.surfaces[0].id]: nestedComponent.id };
  model = liveProjectionListModel(state);
  const patchedItem = model.outputItems.find((item) => item.id === mapping.surfaces[0].id);
  const clearPatchAction = patchedItem.actions.find((action) => action.id === "clear-patch");
  assert.equal(clearPatchAction.variant, "remove");
  assert.match(renderListItemsHtml([patchedItem]), /class="ui-node-list-item[^\"]*has-remove/);
  assert.match(renderListItemsHtml([patchedItem]), /aria-label="Clear custom source/);

  const directSurface = mapping.surfaces.find((surface) => surface.destination?.type === "direct");
  state.ui.live.surfacePatches = { [directSurface.id]: nestedComponent.id };
  const directItem = liveProjectionListModel(state).outputItems.find((item) => item.id === directSurface.id);
  assert.match(renderListItemsHtml([directItem]), /class="ui-node-list-item[^\"]*has-remove/);
  assert.match(renderListItemsHtml([directItem]), />close<\/span>/);

  state.ui.live.selectedComponentId = nestedComponent.id;
  assert.ok(liveProjectionListModel(state).outputItems[0].actions.some((action) => action.id === "clear-overall"));
});

test("Scene and Component cards share their workspace type icons across Live and authored catalogs", () => {
  const { state, liveScene } = stateWithScene();
  const component = state.components.find((candidate) => candidate.type !== "scene" && !candidate.systemRole);

  assert.equal(liveSourceListItems([liveScene], state)[0].labelIcon, "landscape");
  assert.equal(liveSourceListItems([component], state)[0].labelIcon, "extension");
  assert.match(renderListItemsHtml(componentCatalogListItems([liveScene], state)), /ui-node-list-label-icon[^>]*>landscape</);
  assert.match(renderListItemsHtml(componentCatalogListItems([component], state)), /ui-node-list-label-icon[^>]*>extension</);
});

test("Mapping membership and Live visibility are independent Scene Mapping controls", () => {
  const { state, mapping } = stateWithScene();
  const mappingSurfaceCollection = mappingRailUiGraph(state).nodes.find((node) => node.id === "mapping-surface-collection");
  const sceneMappingItem = mappingSurfaceCollection.inputs.items.find((item) => item.id === "__scene_mapping__");
  assert.equal(sceneMappingItem.label, "Scene Mapping");
  assert.equal(sceneMappingItem.actions[0].icon, "crop_free");

  state.ui.live.sceneMappingVisible = false;
  state.ui.live.previewSurfaceId = "__mapping__";
  let liveMappingItem = liveProjectionListModel(state).outputItems[0];
  assert.equal(liveMappingItem.id, "__mapping__");
  assert.equal(liveMappingItem.label, "Scene Mapping");
  assert.equal(liveMappingItem.actions[0].icon, "hide_source");
  assert.ok(!liveMappingItem.actions.some((action) => action.id === "clear-overall"));

  state.ui.live.sceneMappingInLive = false;
  state.ui.live.previewSurfaceId = "__mapping__";
  liveMappingItem = liveProjectionListModel(state).outputItems[0];
  assert.equal(liveMappingItem.id, "__mapping__");
  assert.equal(liveMappingItem.actions[0].label, "Show Scene Mapping");
});

test("Live internal Component focus is separate from the on-air source", () => {
  const { state, liveScene } = stateWithScene();
  const nestedComponent = state.components.find((component) => component.type !== "scene" && !component.systemRole);
  state.ui.live.selectedComponentId = liveScene.id;
  state.ui.live.inspectedComponentId = nestedComponent.id;

  assert.equal(liveProjectionListModel(state).selectedComponentId, nestedComponent.id);
  assert.match(liveInspectorProjection(state), new RegExp(nestedComponent.name));
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

  const componentIds = liveProjectionListModel(state).componentItems.map((item) => item.id);
  assert.ok(componentIds.includes(overallComponent.id));
  assert.ok(componentIds.includes(patchedComponent.id));
});

test("Live Component navigation follows the current graph while the renderer owns the outgoing branch", () => {
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
  state.ui.live.transitionCoordinator = { overall: { active: {
    id: "scene-to-component",
    destination: "overall",
    fromTargetId: previous.id,
    startedAtMs: 1000,
    durationMs: 100,
  } } };

  assert.equal(
    liveProgramNavigableComponents(state, 1050).some((component) => component.id === previous.id),
    false,
    "a renderer-owned branch is not duplicated into control navigation state",
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

  assert.match(liveInspectorProjection(state), new RegExp(liveScene.name));
  assert.doesNotMatch(liveInspectorProjection(state), /No sources/);
});

test("Live Component navigation is the enabled final render graph including its root Scene", () => {
  const { state, liveScene, mapping } = stateWithScene();
  const nested = state.components.find((component) => component.type !== "scene" && !component.systemRole);
  state.ui.live.selectedComponentId = liveScene.id;

  assert.deepEqual(liveProgramNavigableComponents(state).map((component) => component.id), [
    liveScene.id,
    nested.id,
  ]);

  componentLayerProjection(state, liveScene)[0].item.enabled = false;
  assert.deepEqual(liveProgramNavigableComponents(state).map((component) => component.id), [liveScene.id]);
});

test("Live projection visibility reflects the routed program rather than changing Mapping state", () => {
  const { state, mapping } = stateWithScene();
  const surface = mapping.surfaces[0];
  state.ui.live.surfaceVisibility = { [surface.id]: false };

  const outputItem = liveProjectionListModel(state).outputItems.find((item) => item.id === surface.id);
  assert.equal(outputItem.actions[0].icon, "hide_source");
  assert.match(outputItem.actions[0].label, /^Show /);
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

  const [item] = mappingCatalogListItems([mapping]);
  assert.equal(item.media.src || "", "");
  assert.equal(item.media.fallback, "select_all");
});

test("Live target reset is shown on Scene and Part thumbnails with temporary parameters", () => {
  const { state, liveScene } = stateWithScene();
  const component = state.components.find((item) => item.kind !== "scene");
  assert.ok(!liveSourceListItems([liveScene], state)[0].actions.some((action) => action.id === "reset"));
  assert.ok(!liveSourceListItems([component], state)[0].actions.some((action) => action.id === "reset"));

  state.ui.live.parameterDiffs[liveScene.id] = {
    [component.id]: { opacity: 0.5 },
  };
  assert.ok(liveSourceListItems([liveScene], state)[0].actions.some((action) => action.id === "reset"));
  assert.ok(
    liveSourceListItems([component], state)[0].actions.some((action) => action.id === "reset"),
    "a nested Component override is resettable without first selecting that Component",
  );

  state.ui.live.selectedComponentId = component.id;
  state.ui.live.parameterDiffs[component.id] = {
    [component.id]: { opacity: 0.25 },
  };
  assert.ok(liveSourceListItems([component], state)[0].actions.some((action) => action.id === "reset"));
});

test("Mapping Surface inspectors expose calibration only; source routing belongs to the Live program", () => {
  const { state } = stateWithScene();
  const controls = mappingSurfaceControlDescriptors(state.surfaces[0], state);
  const graph = mappingSurfaceInspectorUiGraph(state.surfaces[0], state);
  const mappingIndex = state.mappings.findIndex((mapping) => mapping.id === state.ui.selectedMappingId);

  assert.equal(graph.nodes.find((node) => node.id === "mapping-surface-reset")?.inputs.commandPayload.surfaceId, state.surfaces[0].id);
  assert.deepEqual(controls.map((control) => control.address), [
    `mappings.${mappingIndex}.surfaces.0.feather`,
    `mappings.${mappingIndex}.surfaces.0.opacity`,
    `mappings.${mappingIndex}.surfaces.0.projectionFit`,
  ]);
  for (const control of controls) {
    const node = graph.nodes.find((candidate) => candidate.id === control.id);
    assert.equal(node?.stateAddress, control.address);
    assert.equal(node?.type, control.type);
  }
  assert.equal(JSON.stringify(graph).includes("data-set-route-frame-id"), false);
});

test("catalog presentation and component selectors have single owners", () => {
  const state = createInitialState();
  const model = componentCatalogUiModel({ items: ordinaryComponents(state), projectId: "test" });
  const catalog = model.children[0];

  assert.equal(catalog.title, "Components");
  assert.equal(catalog.searchPlaceholder, "Filter components");
  assert.equal(catalog.itemNode, "thumbnail-button");
  assert.equal(ordinaryComponents(state).every((component) => component.type !== "scene"), true);
  assert.equal(sceneComponents(state).every((component) => component.type === "scene"), true);
  assert.equal(ordinaryComponents(state).length + sceneComponents(state).length, state.components.length);
});

test("Live navigates components by thumbnail and exposes marked significant params as retained controls", () => {
  const { state } = stateWithScene();
  let component = state.components[0];
  markSignificant(state, component, ["chain.0.source.params.renderQuality"]);
  state.ui.live.selectedComponentId = component.id;
  const picker = liveProjectionListModel(state).componentItems.find((item) => item.id === component.id);
  const significant = liveSignificantUiGraph(state).nodes.find((node) =>
    node.commands.change?.target.path === "source.params.renderQuality"
  );
  assert.equal(picker.id, component.id);
  assert.equal(picker.thumbnail.key, `${component.id}:`);
  assert.equal(picker.thumbnail.fallback, picker.labelIcon);
  assert.equal(significant.commands.change.action, "live.set-value");
  assert.equal(significant.commands.change.target.componentId, component.id);
});

test("the MIDImix bottom knob row follows ordered significant params through subcomponents", () => {
  const { state, liveScene } = stateWithScene();
  const child = state.components.find((component) => component.id === liveScene.chain[0].source.componentId);
  markSignificant(state, liveScene, ["chain.0.transform.scale"]);
  markSignificant(state, child, ["chain.0.source.params.renderQuality"]);
  state.ui.live.selectedComponentId = liveScene.id;

  const assignments = liveSignificantParameterAssignments(state);
  assert.deepEqual(assignments.map(({ componentId, path }) => ({ componentId, path })), [{
    componentId: liveScene.id,
    path: "transform.scale",
  }, {
    componentId: child.id,
    path: "source.params.renderQuality",
  }]);
  assert.equal(significantParameterValueFromUnit(assignments[0], 0), 0.05);
  assert.equal(significantParameterValueFromUnit(assignments[0], 1), 8);
});

test("Live and MIDImix resolve significant boundary controls from the shared General schema", () => {
  const { state, mapping } = stateWithScene();
  const component = state.components[0];
  const item = componentLayerProjection(state, component)[0].item;
  item.boundary = {
    ...item.boundary,
    x: -0.125,
    y: 0.25,
    rotation: 0.5,
  };
  markSignificant(state, component, [
    "chain.0.boundary.x",
    "chain.0.boundary.y",
    "chain.0.boundary.rotation",
  ]);
  mapping.surfaces[0].sourceNodeId = `component:${encodeURIComponent(component.id)}`;
  mapping.surfaces[0].componentId = component.id;

  const assignments = liveSignificantParameterAssignments(state);
  assert.deepEqual(assignments.map(({ path, name }) => ({ path, name })), [{
    path: "boundary.x",
    name: `${component.name} · Boundary X`,
  }, {
    path: "boundary.y",
    name: `${component.name} · Boundary Y`,
  }, {
    path: "boundary.rotation",
    name: `${component.name} · Boundary rotation`,
  }]);

  const controls = liveSignificantUiGraph(state).nodes.filter((node) => node.commands.change);
  assert.deepEqual(controls.map((node) => node.commands.change.target.path), [
    "boundary.x",
    "boundary.y",
    "boundary.rotation",
  ]);
  assert.equal(controls[0].inputs.value, -0.125);
});

test("Significant controls and MIDImix share every source in the active output mapping", () => {
  const { state, mapping, liveScene } = stateWithScene();
  const child = state.components.find((component) =>
    component.id === liveScene.chain[0].source.componentId
  );
  markSignificant(state, child, ["chain.0.source.params.renderQuality"]);
  const patched = {
    ...structuredClone(child),
    id: "patched-output-component",
    name: "Patched output",
    significantParams: ["chain.0.transform.scale"],
  };
  state.components.push(patched);
  mapping.surfaces.push({
    ...structuredClone(mapping.surfaces[0]),
    id: "second-output-surface",
    name: "Second output",
  });
  state.ui.live.surfacePatches = {
    [mapping.surfaces[0].id]: patched.id,
  };
  state.ui.live.selectedComponentId = liveScene.id;
  rebuildFixtureGraphs(state);

  const assignments = liveSignificantParameterAssignments(state);
  assert.deepEqual(new Set(assignments.map((assignment) => assignment.componentId)), new Set([
    patched.id,
    child.id,
  ]));
  const controls = liveSignificantUiGraph(state).nodes.filter((node) => node.commands.change);
  assert.ok(controls.some((node) => node.inputs.label === "Patched output · Content scale"));
  assert.ok(controls.some((node) => node.inputs.label === `${child.name} · Render quality`));
});

test("Live separates a Component's public controls from its element inspector", () => {
  const { state, mapping } = stateWithScene();
  const component = state.components[0];
  mapping.surfaces[0].sourceNodeId = `component:${encodeURIComponent(component.id)}`;
  mapping.surfaces[0].componentId = component.id;
  markSignificant(state, component, ["chain.0.source.params.renderQuality", "chain.0.transform.scale"]);
  state.ui.live.selectedComponentId = component.id;

  const inspector = selectedLiveInspectorModel(state);
  let viewModel = selectedLiveComponentViewModel(state);
  let viewGraph = liveComponentViewUiGraph(viewModel);
  assert.equal(inspector.contentChildren[0].id, "live-component-views");
  assert.deepEqual(viewGraph.nodes.find((node) => node.id === "live-component-view-tabs").inputs.items.map((item) => item.id), ["controls", "elements"]);
  assert.equal(viewModel.selectedId, "controls");
  assert.ok(viewGraph.nodes.some((node) => node.parent === "live-component-view-tabs" && node.slot === "controls"));
  const publicGraph = liveComponentControlsUiGraph(component, createLiveComponentView(component, state), state);
  const publicPaths = publicGraph.nodes.filter((node) => node.commands.change).map((node) => node.commands.change.target.path);
  assert.deepEqual(publicPaths, ["transform.x", "transform.y", "transform.scale", "opacity", "speed", "blend"]);
  assert.ok(publicGraph.nodes.filter((node) => node.commands.change).every((node) => node.commands.change.action === "live.set-value"));
  const significant = liveSignificantUiGraph(state).nodes.filter((node) => node.commands.change);
  assert.ok(significant.some((node) => node.commands.change.target.path === "source.params.renderQuality"));
  assert.ok(significant.some((node) => node.commands.change.target.path === "transform.scale"));
  assert.ok(significant.some((node) => node.commands.change.target.nodeId === component.chain[0].id));

  state.ui.live.componentView = "elements";
  const elements = liveInspectorProjection(state);
  viewModel = selectedLiveComponentViewModel(state);
  viewGraph = liveComponentViewUiGraph(viewModel);
  const elementList = viewGraph.nodes.find((node) => node.id === "live-component-elements");
  const element = elementList.inputs.items.find((item) => item.id === component.chain[0].id);
  assert.equal(viewModel.selectedId, "elements");
  assert.equal(elementList.inputs.presentation, "element-list");
  assert.equal(element.presentation, "element-row");
  assert.equal(element.selectPresentation, "element-select");
  assert.equal(element.actions.some((action) => action.id === "remove"), false);
  assert.equal(Object.hasOwn(element, "meta"), false);
  assert.equal(element.actions[0].id, "toggle-enabled");
  assert.notEqual(element.actions[0].icon, "visibility");
  assert.equal(element.actions[0].payload.nodeId, component.chain[0].id);
  assert.match(elements, /Selected live element parameters/);
});

test("Live Scene controls expose element Content scale instead of a Scene-root transform", () => {
  const { state, mapping, liveScene } = stateWithScene();
  mapping.surfaces[0].sourceNodeId = `component:${encodeURIComponent(liveScene.id)}`;
  mapping.surfaces[0].componentId = liveScene.id;
  state.ui.live.selectedComponentId = liveScene.id;
  state.ui.live.componentView = "controls";

  const controls = liveInspectorProjection(state);
  assert.doesNotMatch(controls, /class="live-component-transform-controls"/);
  assert.doesNotMatch(controls, /data-live-update="transform\.scale"/);

  state.ui.live.componentView = "elements";
  const elements = liveInspectorProjection(state);
  assert.match(elements, /live-chain-parameter-tabs/);
  const tabsModel = selectedLiveParameterTabsModel(state);
  assert.ok(tabsModel.views.some((view) => view.id === "general"));
  assert.ok(tabsModel.views.every((view) => !("html" in view)));
  const tabsGraph = parameterTabsUiGraph(tabsModel, { live: true });
  assert.ok(tabsGraph.nodes.some((node) =>
    node.commands.change?.target.path === "transform.scale"
    && node.inputs.label === "Content scale"
  ));
  const generalGraph = liveChainGeneralParameterUiGraph(selectedLiveGeneralParameterModel(state));
  assert.ok(generalGraph.nodes.some((node) =>
    node.commands.change?.target.path === "transform.scale"
    && node.inputs.label === "Content scale"
  ));
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
  rebuildFixtureGraphs(state);
  state.ui.live.selectedComponentId = owner.id;
  state.ui.live.componentView = "elements";

  const html = liveInspectorProjection(state);
  assert.match(html, new RegExp(`"title":"${referenced.name}"`));
  assert.doesNotMatch(html, new RegExp(`"title":"${referenced.id}"`));
});

test("retained significant controls include generic chain transforms", () => {
  const { state } = stateWithScene();
  const component = state.components[0];
  componentLayerProjection(state, component)[0].item.transform = { x: 0.4, y: 0, scale: 1, rotation: 0 };
  markSignificant(state, component, ["chain.0.transform.x"]);

  const significant = liveSignificantUiGraph(state).nodes.find((node) =>
    node.commands.change?.target.path === "transform.x"
  );
  assert.equal(significant.inputs.value, 0.4);
});

test("source parameters marked at their persisted path are published in Live", () => {
  const { state, mapping } = stateWithScene();
  const component = state.components[0];
  mapping.surfaces[0].sourceNodeId = `component:${encodeURIComponent(component.id)}`;
  mapping.surfaces[0].componentId = component.id;
  markSignificant(state, component, ["chain.0.source.params.renderQuality"]);
  state.ui.live.selectedComponentId = component.id;

  const live = liveSignificantUiGraph(state);
  assert.ok(live.nodes.some((node) => node.commands.change?.target.path === "source.params.renderQuality"));

  assert.ok(!live.nodes.some((node) => JSON.stringify(node).includes("data-update")));
});

test("image source schema automatically exposes cut and feather in Live and published controls", () => {
  const { state, mapping } = stateWithScene();
  const component = state.components[0];
  const sourceLayer = componentLayerProjection(state, component)[0];
  const source = sourceLayer.item;
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
  state.ui.live.selectedChainItemId = sourceLayer.nodeId;
  state.ui.live.componentView = "elements";

  const elements = liveInspectorProjection(state);
  assert.match(elements, /live-chain-parameter-tabs/);
  assert.ok(selectedLiveParameterTabsModel(state).views.some((view) =>
    view.id === "content" && view.liveParameterModel?.params.some((param) => param.id === "alphaCut")
  ));
  const primaryGraph = liveChainContentParameterUiGraph(
    selectedLiveRetainedParameterModel(state, "primary"),
  );
  const primaryControls = primaryGraph.nodes.filter((node) => node.commands.change);
  assert.ok(primaryControls.some((node) =>
    node.commands.change.target.path === "source.params.alphaCut"
    && node.inputs.label === "Cut edge"
  ));
  assert.ok(primaryControls.some((node) =>
    node.commands.change.target.path === "source.params.alphaFeather"
    && node.inputs.label === "Feather"
  ));

  markSignificant(state, component, ["chain.0.source.params.alphaFeather"]);
  assert.ok(liveSignificantUiGraph(state).nodes.some((node) => node.commands.change?.target.path === "source.params.alphaFeather"));
});

test("Live publishes significant source parameters nested inside Groups", () => {
  const { state, mapping } = stateWithScene();
  let component = state.components[0];
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
  rebuildFixtureGraphs(state);
  component = state.components.find((candidate) => candidate.id === component.id);
  markSignificant(state, component, [
    "chain.0.chain.0.source.params.renderQuality",
    "chain.0.chain.0.transform.scale",
  ]);
  const currentMapping = state.mappings.find((candidate) => candidate.id === mapping.id);
  currentMapping.surfaces[0].sourceNodeId = `component:${encodeURIComponent(component.id)}`;
  currentMapping.surfaces[0].componentId = component.id;
  state.ui.live.selectedComponentId = component.id;
  state.ui.live.componentView = "controls";

  const live = liveSignificantUiGraph(state).nodes.filter((node) => node.commands.change);
  assert.ok(live.some((node) => node.commands.change.target.path === "source.params.renderQuality"));
  assert.ok(live.some((node) => node.commands.change.target.path === "transform.scale"));
  assert.ok(live.some((node) => node.commands.change.target.nodeId === source.id));
});
