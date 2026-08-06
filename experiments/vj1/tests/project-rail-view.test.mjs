import test from "node:test";
import assert from "node:assert/strict";

import { componentCatalogListItems, liveProjectionListModel, liveSourceListItems, mappingCatalogListItems, selectedLiveSourceId } from "../js/control/project-rail-view.js";
import { createInitialState } from "../js/domain/models.js";
import { defineTransitionKernel } from "../js/libraries/transition-engine/index.js";
import { DefaultBuiltInTransition } from "../js/libraries/visual-nodes/catalog.js";
import { componentCatalogUiGraph, liveProjectionRailUiGraph, liveRailUiGraph, liveTimingUiGraph, mappingRailUiGraph, sceneRailUiGraph } from "../js/control/control-ui-program.js";
import { UI_ICONS } from "../js/control/ui-icons.js";
import { renderListItemsHtml } from "../js/libraries/ui-engine/index.js";

test("project rail renders each workspace through one view boundary", () => {
  const state = createInitialState();
  const catalogScopes = [];
  const sortScopes = [];
  const options = {
    catalogItems(scope, items) {
      catalogScopes.push(scope);
      return items;
    },
    catalogSortMode(scope) {
      sortScopes.push(scope);
      return "recent";
    },
  };

  const componentItems = options.catalogItems("component", state.components.filter((item) => item.type !== "scene"));
  const component = componentCatalogUiGraph({
    items: componentCatalogListItems(componentItems, state),
    selectedId: state.ui.selectedComponentId,
    sortMode: options.catalogSortMode("component"),
    projectId: "test",
  });
  const sceneItems = options.catalogItems("scene", state.components.filter((item) => item.type === "scene"));
  const scene = sceneRailUiGraph(state, {
    items: componentCatalogListItems(sceneItems, state),
    sortMode: options.catalogSortMode("scene"),
    projectId: "test",
  });
  const liveItems = options.catalogItems("live", state.components.filter((item) => !item.systemRole));
  const live = liveRailUiGraph(state, {
    items: liveSourceListItems(liveItems, state),
    selectedId: selectedLiveSourceId(state),
    sortMode: options.catalogSortMode("live"),
    projectId: "test",
  });
  const mappingItems = options.catalogItems("mapping", state.mappings);
  const mapping = mappingRailUiGraph(state, {
    items: mappingCatalogListItems(mappingItems),
    sortMode: options.catalogSortMode("mapping"),
    projectId: "test",
  });

  const componentCollection = component.nodes.find((node) => node.id === "component-rail--catalog");
  assert.equal(componentCollection.inputs.headerActions[0].id, "add");
  assert.equal(componentCollection.inputs.itemNode, "thumbnail-button");
  assert.equal(componentCollection.inputs.listPresentation, "thumbnail-grid");
  assert.match(componentCollection.stateAddress, /component-catalog$/);
  const sceneCollection = scene.nodes.find((node) => node.id === "scene-rail--scenes");
  const surfaceCollection = scene.nodes.find((node) => node.id === "scene-rail--surfaces");
  assert.equal(sceneCollection.inputs.headerActions[0].id, "add");
  assert.equal(sceneCollection.inputs.itemNode, componentCollection.inputs.itemNode);
  assert.equal(sceneCollection.inputs.presentation, componentCollection.inputs.presentation);
  assert.equal(sceneCollection.inputs.listPresentation, componentCollection.inputs.listPresentation);
  assert.equal(sceneCollection.inputs.pasteScope, "scene-list");
  assert.equal(surfaceCollection.inputs.headerActions[0].id, "add");
  assert.equal(surfaceCollection.inputs.reorderable, true);
  assert.equal(surfaceCollection.inputs.pasteScope, "surface-list");
  const liveCollection = live.nodes.find((node) => node.id === "live-source-collection");
  assert.match(liveCollection.stateAddress, /live-sources$/);
  assert.equal(liveCollection.inputs.items.length, liveItems.length);
  assert.equal(live.nodes.find((node) => node.id === "live-source-scenes").inputs.value, true);
  assert.equal(live.nodes.find((node) => node.id === "live-source-components").inputs.value, true);
  assert.equal(live.nodes.find((node) => node.id === "live-timing-panel").inputs.title, "Live");
  const liveLayout = live.nodes.find((node) => node.id === "live-rail-layout");
  const liveTimingSlot = liveLayout.inputs.slots.find((slot) => slot.id === "timing");
  assert.deepEqual(liveTimingSlot, {
    id: "timing",
    fill: true,
    grow: 0,
    shrink: 0,
    basis: "30%",
    overflow: "hidden",
  });
  const liveReset = live.nodes.find((node) => node.id === "live-reset-session");
  assert.equal(liveReset.inputs.label, "Reset Live parameters");
  assert.equal(liveReset.inputs.icon, UI_ICONS.reset);
  const mappingCollection = mapping.nodes.find((node) => node.id === "mapping-collection");
  const mappingSurfaces = mapping.nodes.find((node) => node.id === "mapping-surface-collection");
  assert.equal(mappingCollection.inputs.pasteScope, "mapping-list");
  assert.equal(mappingCollection.inputs.listPresentation, "mapping-list");
  const mappingRows = renderListItemsHtml(mappingCollection.inputs.items, {
    selectedId: mappingCollection.inputs.selectedId,
  });
  assert.match(mappingRows, /ui-node-list-item text-list-item mapping-text-row compact-list-row has-remove/);
  assert.match(mappingRows, /ui-node-list-select text-list-main list-select/);
  assert.match(mappingRows, /ui-node-list-action text-list-remove list-remove material-symbols-rounded/);
  assert.equal(mappingSurfaces.inputs.pasteScope, "surface-list");
  assert.equal(mappingSurfaces.inputs.items[0].id, "__scene_mapping__");
  assert.equal(mapping.nodes.find((node) => node.id === "mapping-name").stateAddress, "mappings.0.name");
  assert.equal(mapping.nodes.find((node) => node.id === "mapping-test-pattern").stateAddress, "ui.mappingTestPattern");
  assert.deepEqual(catalogScopes, ["component", "scene", "live", "mapping"]);
  assert.deepEqual(sortScopes, ["component", "scene", "live", "mapping"]);
});

test("catalog projection can exclude editor selection without changing catalog content", () => {
  const state = createInitialState();
  state.ui.selectedComponentId = state.components[0].id;
  const items = componentCatalogListItems(state.components.filter((item) => item.type !== "scene"), state);
  const selected = componentCatalogUiGraph({ items, selectedId: state.ui.selectedComponentId });
  const catalogOnly = componentCatalogUiGraph({ items, selectedId: "" });
  const selectedCollection = selected.nodes.find((node) => node.id === "component-rail--catalog");
  const catalogOnlyCollection = catalogOnly.nodes.find((node) => node.id === "component-rail--catalog");

  assert.equal(selectedCollection.inputs.selectedId, state.ui.selectedComponentId);
  assert.equal(catalogOnlyCollection.inputs.selectedId, "");
  assert.deepEqual(selectedCollection.inputs.items, catalogOnlyCollection.inputs.items);
});

test("Live output navigation is one retained graph over the routed projection model", () => {
  const state = createInitialState();
  const model = liveProjectionListModel(state);
  const graph = liveProjectionRailUiGraph(model);
  const outputs = graph.nodes.find((node) => node.id === "live-output-collection");
  const significant = graph.nodes.find((node) => node.id === "live-significant-panel");
  const components = graph.nodes.find((node) => node.id === "live-component-collection");

  assert.strictEqual(outputs.inputs.items, model.outputItems);
  assert.equal(outputs.commands.select.action, "live.output-select");
  assert.equal(outputs.commands.itemAction.action, "live.output-action");
  assert.equal(significant.parent, "live-projection-layout");
  assert.strictEqual(components.inputs.items, model.componentItems);
  assert.equal(components.commands.select.action, "live.inspect-component");
});

test("Live timing graph renders installed transition entries supplied by the shared resolver", () => {
  const packageTransition = {
    id: "org.example.transition.package-wipe",
    version: "1.0.0",
    name: "Package Wipe",
    parameters: [],
    origin: { kind: "installed", id: "org.example.transition-library" },
    kernel: defineTransitionKernel({
      id: "org.example.transition.package-wipe",
      version: "1.0.0",
      source: `
vec4 vj1Transition(vec4 startColor, vec4 endColor, vec2 uv, float progress) {
  return mix(startColor, endColor, step(uv.x, progress));
}`,
    }),
  };
  const graph = liveTimingUiGraph(createInitialState(), [DefaultBuiltInTransition, packageTransition]);
  const selector = graph.nodes.find((node) => node.id === "live-transition-style");
  assert.deepEqual(selector.inputs.options.map((option) => option.value), [
    DefaultBuiltInTransition.id,
    packageTransition.id,
  ]);
  assert.equal(selector.inputs.options[1].label, "Package Wipe");
});
