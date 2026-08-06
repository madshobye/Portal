import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { chainItemToggleIcon, componentElementsUiModel, componentOverviewUiModel, componentSelectedChainSettingsModel, effectChainItemDisplayName, selectedChainParameterTabsModel, sourceChainItemDisplayName, videoTrimValues } from "../js/control/component-view.js";
import { createComponentEffect, createComponentLayer, createInitialState, normalizeComponentChainItem, normalizeMediaMeta } from "../js/domain/models.js";
import { createProjectVisualGroupDefinition, defineNode, NodeRegistry } from "../js/libraries/node-engine/index.js";
import { graphNodeFromDefinition } from "../js/control/node-graph-canvas.js";
import { withProjectNodeGraph, withProjectNodeParameterExposure } from "../js/control/node-editor-view.js";
import { listEffectNodeComponents, listGeneratorNodeComponents } from "../js/libraries/visual-nodes/catalog.js";
import { createVj1NodePackage } from "../js/app-node-package.js";

const appNodePackage = createVj1NodePackage();

test("selected element parameters fill their allocated inspector section", () => {
  const prepared = prepareComponentViewState(createInitialState());
  const component = prepared.components.find((candidate) => candidate.id === prepared.ui.selectedComponentId)
    || prepared.components[0];
  const model = componentSelectedChainSettingsModel(component, prepared);
  assert.deepEqual(model?.layout, {
    fill: true,
    grow: 1,
    shrink: 1,
    basis: 0,
    overflow: "hidden",
  });
});

function prepareComponentViewState(state) {
  return appNodePackage.prepareProjectState(state);
}

function preparedParameterTabsModel(component, state) {
  const prepared = prepareComponentViewState(state);
  const preparedComponent = prepared.components.find((candidate) => candidate.id === component.id);
  return selectedChainParameterTabsModel(preparedComponent, prepared);
}

function preparedSettingsTemplate(component, state) {
  const prepared = prepareComponentViewState(state);
  const preparedComponent = prepared.components.find((candidate) => candidate.id === component.id);
  const shell = componentSelectedChainSettingsModel(preparedComponent, prepared);
  const model = preparedParameterTabsModel(component, state);
  return `${JSON.stringify(shell)}<div class="chain-param-views">${(model?.views || []).map((view) => `<button>${view.label}</button>${JSON.stringify(view.models || [])}${JSON.stringify(view.parameterModel || null)}${view.html}`).join("")}</div>`;
}

function preparedParameterDescriptors(component, state) {
  return (preparedParameterTabsModel(component, state)?.views || [])
    .flatMap((view) => view.parameterModel?.params || []);
}

test("video trim uses decoded duration and never invents a silent timeline", () => {
  assert.deepEqual(videoTrimValues({}, { duration: 10 }), {
    start: 0,
    end: 10,
    max: 10,
    implicitEnd: true,
    available: true,
  });
  assert.deepEqual(videoTrimValues({ start: 2, end: 7 }, { duration: 10 }), {
    start: 2,
    end: 7,
    max: 10,
    implicitEnd: false,
    available: true,
  });
  assert.equal(videoTrimValues({}, {}).available, false);
  assert.equal(videoTrimValues({}, {}).max, 1, "pending metadata only gets an inert one-second markup range");
  assert.equal(normalizeMediaMeta({ id: "media/clip.mp4", duration: 10 }).duration, 10, "duration survives ordinary state normalization");
  assert.equal("duration" in normalizeMediaMeta({ id: "media/clip.mp4", duration: Infinity }), false, "invalid duration is never normalized into the catalog");
});

test("media element names follow the current file basename until explicitly renamed", () => {
  const source = { type: "media", mediaId: "media/sets/old-name.png" };
  const automatic = normalizeComponentChainItem({
    id: "media-layer",
    kind: "source",
    name: "media/sets/old-name.png",
    source,
  });

  assert.equal(automatic.name, "", "legacy copied repository paths migrate back to an automatic label");
  assert.equal(
    sourceChainItemDisplayName(automatic, { id: source.mediaId, name: "renamed-file.png" }),
    "renamed-file.png",
  );

  const custom = normalizeComponentChainItem({
    ...automatic,
    name: "Backdrop",
  });
  assert.equal(sourceChainItemDisplayName(custom, { id: source.mediaId, name: "renamed-again.png" }), "Backdrop");
});

test("visual placements use clean catalog names, identify ISF, and remain renameable", () => {
  const state = createInitialState();
  const kaleidoscope = listEffectNodeComponents().find((component) =>
    component.nodeDefinition?.metadata?.projectAssetPath ===
      "shaders/isf/effects/kaleidoscope.fs"
  );
  const brickPattern = listGeneratorNodeComponents().find((component) =>
    component.nodeDefinition?.metadata?.projectAssetPath ===
      "shaders/isf/generators/brick-pattern.fs"
  );
  const effect = createComponentEffect(kaleidoscope.id);
  const generator = createComponentLayer(0, {
    type: "generator",
    generatorId: brickPattern.id,
  });

  assert.equal(effectChainItemDisplayName(effect, state), "Kaleidoscope (ISF)");
  assert.equal(
    sourceChainItemDisplayName(generator, null, null, state),
    "Brick Pattern (ISF)",
  );

  effect.name = "Mirror Room";
  assert.equal(effectChainItemDisplayName(effect, state), "Mirror Room");

  const component = state.components.find((item) => item.type !== "scene");
  component.chain = [effect];
  state.ui.selectedComponentId = component.id;
  state.ui.selectedChainItemId = effect.id;
  const html = preparedSettingsTemplate(component, state);
  assert.match(
    html,
    /"value":"Mirror Room","address":"nodes\.groups\.[0-9]+\.nodes\.[0-9]+\.configuration\.name"/,
  );
});

test("ISF image inlets use persisted source-picker controls without exposing the automatic effect input", () => {
  const state = createInitialState();
  const layerMask = listEffectNodeComponents().find((component) =>
    component.nodeDefinition?.metadata?.projectAssetPath ===
      "shaders/isf/effects/layer-mask.fs"
  );
  const effect = normalizeComponentChainItem({
    ...createComponentEffect(layerMask.id),
    imageInputs: {
      maskImage: { type: "component", componentId: "mask-component" },
    },
  });
  const component = state.components.find((item) => item.type !== "scene");
  component.chain = [effect];
  state.components.push({
    id: "mask-component",
    name: "Mask Source",
    type: "component",
    chain: [],
  });
  state.ui.selectedComponentId = component.id;
  state.ui.selectedChainItemId = effect.id;

  const html = preparedSettingsTemplate(component, state);
  assert.equal(effect.imageInputs.maskImage.componentId, "mask-component");
  assert.match(html, /"label":"mask image"/i);
  assert.match(html, /"valueLabel":"Mask Source"/);
  assert.match(html, /"path":"nodes\.groups\.[0-9]+\.nodes\.[0-9]+\.configuration\.imageInputs\.maskImage"/);
  assert.match(html, /"allowComponents":true/);
  assert.match(html, /"action":"picker\.open-source"/);
  assert.doesNotMatch(html, /\.imageInputs\.inputImage/);
});

test("Component and Canvas chain presentation lives outside the control orchestrator", () => {
  const state = createInitialState();
  const component = state.components.find((item) => item.type !== "scene");
  const canvas = state.components.find((item) => item.type === "scene") || {
    ...component,
    id: "canvas-test",
    type: "scene",
    canvas: { width: 1920, height: 1080 },
  };
  const prepared = prepareComponentViewState({ ...state, components: [...state.components, canvas] });
  const preparedComponent = prepared.components.find((candidate) => candidate.id === component.id);
  const preparedCanvas = prepared.components.find((candidate) => candidate.id === canvas.id);
  const componentOverview = componentOverviewUiModel(preparedComponent, prepared);
  const componentElements = componentElementsUiModel(preparedComponent, prepared);
  const settingsHtml = preparedSettingsTemplate(component, state);
  const canvasOverview = componentOverviewUiModel(preparedCanvas, prepared);
  const canvasElements = componentElementsUiModel(preparedCanvas, prepared);
  const controller = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");

  assert.equal(componentOverview.type, "layout");
  assert.deepEqual(componentOverview.children.map((child) => child.id), ["sync-instances", "frame-shape", "resolution"]);
  assert.equal(componentOverview.children.find((child) => child.id === "frame-shape").type, "choice");
  assert.equal(componentElements.type, "list");
  assert.equal(componentElements.reorderable, true);
  assert.equal(componentElements.onSelect.action, "component.element-select");
  assert.equal(componentElements.onReorder.action, "component.element-reorder");
  assert.notEqual(componentElements.items[0].actions.find((action) => action.id === "toggle-enabled").icon, "visibility");
  assert.ok(componentElements.items.every((item) => item.actions.some((action) => action.id === "remove" && !action.disabled)));
  assert.match(settingsHtml, /"type":"panel"/);
  assert.match(settingsHtml, />Content<\/button>|>Primary<\/button>/);
  assert.match(settingsHtml, />General<\/button>/);
  assert.doesNotMatch(settingsHtml, /data-chain-general-parameter-ui/);
  assert.ok(settingsHtml.indexOf('"titleBinding"') < settingsHtml.indexOf("chain-param-views"));
  assert.doesNotMatch(settingsHtml, /data-update="[^"]+\.configuration\.(?:opacity|blend|transform\.)/);
  assert.doesNotMatch(settingsHtml, /<span>Render quality<\/span>/, "render quality is owned by the retained General graph");
  assert.deepEqual(canvasOverview.children.map((child) => child.id), ["resolution"]);
  assert.equal(canvasElements.type, "list");
  assert.match(controller, /from "\.\/component-view\.js"/);
  assert.doesNotMatch(controller, /function componentTemplate\(/);
  assert.doesNotMatch(controller, /function componentUnifiedChainTemplate\(/);
  assert.doesNotMatch(controller, /function sourcePickerTemplate\(/);
});

test("shared element rows use the semantic hidden visibility icon", () => {
  const state = createInitialState();
  const component = state.components.find((item) => item.type !== "scene");
  component.chain[0].enabled = false;
  const prepared = prepareComponentViewState(state);
  const preparedComponent = prepared.components.find((item) => item.id === component.id);
  const elements = componentElementsUiModel(preparedComponent, prepared);

  assert.equal(elements.items[0].actions.find((action) => action.id === "toggle-enabled").icon, "visibility_off");
});

test("active element toggles identify the element type", () => {
  assert.equal(chainItemToggleIcon({ kind: "source", source: { type: "generator", generatorId: "gradient" } }), "gradient");
  assert.equal(chainItemToggleIcon({ kind: "source", source: { type: "generator", generatorId: "mediaImage" } }), "perm_media");
  assert.equal(chainItemToggleIcon({ kind: "effect", componentId: "alphaVignette" }), "vignette");
  assert.equal(chainItemToggleIcon({ kind: "group" }), "account_tree");
  assert.equal(chainItemToggleIcon({ kind: "effect", componentId: "alphaVignette", enabled: false }), "visibility_off");
});

test("Canvas component placements render selected settings without a redundant source selector", () => {
  const state = createInitialState();
  const referenced = state.components.find((item) => item.type !== "scene");
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
    type: "scene",
    canvas: { width: 1920, height: 1080 },
    chain: [placement],
  };
  const canvasState = {
    ...state,
    components: [...state.components, canvas],
    ui: { ...state.ui, selectedChainItemId: placement.id },
  };

  const html = preparedSettingsTemplate(canvas, canvasState);
  assert.match(html, new RegExp(`"title":"${referenced.name}"`));
  assert.match(html, new RegExp(`"componentId":"${referenced.id}"`));
  assert.doesNotMatch(html, /<label class="field">Component /);
  assert.doesNotMatch(html, /data-chain-general-parameter-ui/);
});

test("effects separate shader strength from generic compositing controls", () => {
  const state = createInitialState();
  const component = state.components.find((item) => item.type !== "scene");
  const effect = createComponentEffect("invert", { amount: 0.4 });
  component.chain.push(effect);
  state.ui.selectedChainItemId = effect.id;

  const html = preparedSettingsTemplate(component, state);
  const prepared = prepareComponentViewState(state);
  const preparedComponent = prepared.components.find((candidate) => candidate.id === component.id);
  const tabsModel = selectedChainParameterTabsModel(preparedComponent, prepared);
  assert.ok(tabsModel.views.find((view) => view.id === "content")?.parameterModel?.params.some((param) => param.id === "amount"));
  assert.doesNotMatch(html, /data-chain-content-parameter-ui/);
  assert.match(html, />General<\/button>/);
  assert.doesNotMatch(html, /data-chain-general-parameter-ui/);
  assert.doesNotMatch(html, /data-update="[^"]+\.configuration\.(?:opacity|blend|transform\.)/);
  assert.doesNotMatch(html, /<span>Render quality<\/span>/, "render quality is owned by the retained General graph");
});

test("persistent and Live source editors project the same semantic generator definitions", () => {
  const componentView = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const sceneLiveView = readFileSync(new URL("../js/control/mapping-live-view.js", import.meta.url), "utf8");

  assert.match(componentView, /componentParamViews\(definition\)/);
  assert.match(sceneLiveView, /componentParamViews\(definition\)/);
  assert.match(componentView, /visualGeneratorComponent\(state, item\.source\.generatorId\)/);
  assert.match(sceneLiveView, /visualGeneratorComponent\(state, selected\.item\.source\.generatorId\)/);
  assert.doesNotMatch(componentView, /source-control-schema/);
  assert.doesNotMatch(sceneLiveView, /source-control-schema/);
});

test("generator media parameters use reusable resource-button models", () => {
  for (const [generatorId, parameterIds] of [
    ["featureMorphV2", ["imageAId", "imageBId"]],
    ["tileTexture", ["imageId"]],
  ]) {
    const state = createInitialState();
    const component = state.components.find((item) => item.type !== "scene");
    const source = component.chain[0];
    source.source = { type: "generator", generatorId, params: {} };
    state.ui.selectedChainItemId = source.id;

    const primary = preparedParameterTabsModel(component, state)?.views.find((view) => view.id === "content");
    const resources = (primary?.models || []).filter((model) => model.type === "resourceButton");
    assert.deepEqual(resources.map((model) => model.id), parameterIds.map((id) => `resource-${id}`));
    for (const resource of resources) {
      assert.equal(resource.onActivate.action, "picker.open-media");
      assert.match(resource.commandPayload.path, /\.source\.params\./);
    }
  }
});

test("STL sources expose the same Primary Details and General views in Component editing", () => {
  const state = createInitialState();
  const component = state.components.find((item) => item.type !== "scene");
  const source = component.chain[0];
  source.source = {
    type: "generator",
    generatorId: "modelMedia",
    params: {
      mediaId: "media/sculpture.stl",
      renderMode: "surfaceWire",
      rotationX: 0.4,
      modelScale: 2,
      pointBudget: 12000,
      geometryDetail: 0.75,
      renderQuality: 0.75,
    },
  };
  state.media.push({ id: source.source.params.mediaId, name: "sculpture.stl", type: "model" });
  state.ui.selectedChainItemId = source.id;

  const html = preparedSettingsTemplate(component, state);
  const primary = preparedParameterTabsModel(component, state)?.views.find((view) => view.id === "content");
  const topLevelModelResources = (primary?.models || []).filter((model) => model.id === "resource-mediaId");

  assert.match(html, />Primary<\/button>/);
  assert.match(html, />Details<\/button>/);
  assert.match(html, />General<\/button>/);
  assert.match(html, /"id":"rotationX"/);
  assert.match(html, /"id":"modelScale"/);
  assert.match(html, /"id":"geometryDetail"/);
  assert.match(html, /"label":"Geometry detail"/);
  assert.equal(topLevelModelResources.length, 1);
  assert.ok((preparedParameterTabsModel(component, state)?.views || []).every((view) => !("parameterSections" in view)));
  assert.doesNotMatch(html, /data-chain-general-parameter-ui/);
  assert.doesNotMatch(html, /data-update="[^"]+\.configuration\.source\.params\.renderQuality"/);
});

test("compound generators expose public parameters through the one shared Component parameter list", () => {
  const state = createInitialState();
  const component = state.components.find((item) => item.type !== "scene");
  const source = component.chain[0];
  source.source = {
    type: "generator",
    generatorId: "terrainFlyover",
    params: {},
  };
  state.ui.selectedChainItemId = source.id;

  const tabsModel = preparedParameterTabsModel(component, state);
  const descriptors = preparedParameterDescriptors(component, state);
  assert.ok(descriptors.some((param) => param.id === "mountainHeight"));
  assert.ok(descriptors.some((param) => param.id === "wireColor"));
  assert.ok((tabsModel?.views || []).every((view) => !("parameterSections" in view)));
  const projectedStyleControls = descriptors.filter((param) => param.id === "style");
  assert.equal(
    projectedStyleControls.length,
    1,
    "a public parameter bound to multiple child nodes is still one shared UI control",
  );
});

test("project-authored Group controls use the same shared Component inspector", () => {
  const Child = defineNode({
    id: "test.component-view.project-child",
    name: "Project Child",
    description: "A visual child with one project-published control.",
    implementation: "shader",
    parameters: {
      gain: {
        type: "number",
        label: "Public gain",
        defaultValue: 0.4,
        allowedRange: [0, 1],
      },
    },
    outlets: { texture: "texture" },
    metadata: {
      visualId: "project-child",
      visualKind: "generator",
      shaderInterface: "generator",
    },
  });
  const base = createProjectVisualGroupDefinition({
    id: "org.vj1.project.component-view-group",
    name: "Project UI Group",
  });
  const registry = new NodeRegistry([Child, base]);
  const sourceNode = graphNodeFromDefinition(Child, { id: "child", visualProgram: true });
  let nodes = withProjectNodeGraph({}, registry.get(base.id), {
    ...base.parts.find((part) => part.kind === "graph"),
    nodes: [sourceNode],
    connections: [{ from: "child.texture", to: "$out.texture", type: "texture" }],
  });
  nodes = withProjectNodeParameterExposure(nodes, registry.get(base.id), {
    nodeId: "child",
    parameterId: "gain",
    publicParameterId: "gain",
    parameter: Child.parameters.gain,
    sectionLabel: "Project controls",
    exposed: true,
  });

  const state = createInitialState();
  const component = state.components.find((item) => item.type !== "scene");
  const source = component.chain[0];
  source.source = {
    type: "generator",
    generatorId: base.id,
    params: { gain: 0.7 },
  };
  state.nodes = {
    ...state.nodes,
    definitions: [base],
    forks: nodes.forks,
  };
  state.ui.selectedChainItemId = source.id;
  const tabsModel = preparedParameterTabsModel(component, state);
  const descriptors = preparedParameterDescriptors(component, state);
  assert.equal(descriptors.filter((param) => param.id === "gain").length, 1);
  assert.ok((tabsModel?.views || []).every((view) => !("parameterSections" in view)));
});

test("all specialized visual Groups use the same global descriptor-driven parameter list", () => {
  const cases = [
    {
      generatorId: "anatomy",
      parameterPath: "modelScale",
    },
    {
      generatorId: "meshPatterns",
      parameterPath: "drawMode",
    },
  ];
  for (const example of cases) {
    const state = createInitialState();
    const component = state.components.find((item) => item.type !== "scene");
    const source = component.chain[0];
    source.source = { type: "generator", generatorId: example.generatorId, params: {} };
    state.ui.selectedChainItemId = source.id;

    const tabsModel = preparedParameterTabsModel(component, state);
    const descriptors = preparedParameterDescriptors(component, state);
    assert.ok(descriptors.some((param) => param.id === example.parameterPath));
    assert.ok((tabsModel?.views || []).every((view) => !("parameterSections" in view)));
  }
});
