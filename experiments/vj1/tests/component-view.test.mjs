import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { sceneInspectorTemplate, componentSelectedChainSettingsTemplate, componentTemplate, effectChainItemDisplayName, sourceChainItemDisplayName, videoTrimValues } from "../js/control/component-view.js";
import { createComponentEffect, createComponentLayer, createInitialState, normalizeComponentChainItem, normalizeMediaMeta } from "../js/domain/models.js";
import { createProjectVisualGroupDefinition, defineNode, NodeRegistry } from "../js/libraries/node-engine/index.js";
import { graphNodeFromDefinition } from "../js/control/node-graph-canvas.js";
import { withProjectNodeGraph, withProjectNodeParameterExposure } from "../js/control/node-editor-view.js";
import { listEffectNodeComponents, listGeneratorNodeComponents } from "../js/libraries/visual-nodes/catalog.js";

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
  const html = componentSelectedChainSettingsTemplate(component, state);
  assert.match(
    html,
    /class="section-title-input"[^>]*data-update="components\.[0-9]+\.chain\.0\.name"[^>]*value="Mirror Room"/,
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

  const html = componentSelectedChainSettingsTemplate(component, state);
  assert.equal(effect.imageInputs.maskImage.componentId, "mask-component");
  assert.match(html, />mask image</i);
  assert.match(html, />Mask Source</);
  assert.match(html, /data-open-source-choice="components\.[0-9]+\.chain\.0\.imageInputs\.maskImage"/);
  assert.match(html, /data-source-choice-components="true"/);
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
  const componentHtml = componentTemplate(component, state);
  const settingsHtml = componentSelectedChainSettingsTemplate(component, state);
  const canvasHtml = sceneInspectorTemplate(canvas, { ...state, components: [...state.components, canvas] });
  const controller = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");

  assert.match(componentHtml, /class="component-frame-controls"/);
  assert.match(componentHtml, /data-chain-reorder-list/);
  assert.doesNotMatch(componentHtml, /chain-item-remove[^>]*disabled/);
  assert.match(settingsHtml, /class="ui-section focus-panel chain-settings-panel"/);
  assert.match(settingsHtml, />Content<\/label>|>Primary<\/label>/);
  assert.match(settingsHtml, />General<\/label>/);
  assert.ok(settingsHtml.indexOf("ui-section-header rail-title") < settingsHtml.indexOf("chain-param-views"));
  assert.match(settingsHtml, /data-update="components\.[0-9]+\.chain\.0\.transform\.x"/);
  assert.match(settingsHtml, /data-update="components\.[0-9]+\.chain\.0\.opacity"/);
  assert.match(settingsHtml, /data-update="components\.[0-9]+\.chain\.0\.blend"/);
  assert.match(settingsHtml, /data-param-context-path="components\.[0-9]+\.chain\.0\.transform\.scale"/);
  assert.equal((settingsHtml.match(/<span>Render quality<\/span>/g) || []).length, 1);
  assert.ok(settingsHtml.indexOf("chain-param-view-general") < settingsHtml.indexOf("<span>Render quality</span>"), "source render quality is owned by General");
  assert.doesNotMatch(canvasHtml, /\.canvas\.(?:width|height)"/);
  assert.match(controller, /from "\.\/component-view\.js"/);
  assert.doesNotMatch(controller, /function componentTemplate\(/);
  assert.doesNotMatch(controller, /function componentUnifiedChainTemplate\(/);
  assert.doesNotMatch(controller, /function sourcePickerTemplate\(/);
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

  const html = componentSelectedChainSettingsTemplate(canvas, canvasState);
  assert.match(html, new RegExp(`>${referenced.name}<\\/span>`));
  assert.match(html, new RegExp(`data-edit-component="${referenced.id}"`));
  assert.doesNotMatch(html, /<label class="field">Component /);
  assert.match(html, /data-update="components\.[0-9]+\.chain\.0\.opacity"/);
});

test("effects separate shader strength from generic compositing controls", () => {
  const state = createInitialState();
  const component = state.components.find((item) => item.type !== "scene");
  const effect = createComponentEffect("invert", { amount: 0.4 });
  component.chain.push(effect);
  state.ui.selectedChainItemId = effect.id;

  const html = componentSelectedChainSettingsTemplate(component, state);
  assert.match(html, /<span>Effect strength<\/span>/);
  assert.match(html, />General<\/label>/);
  assert.match(html, new RegExp(`data-update="components\\.0\\.chain\\.1\\.opacity"`));
  assert.match(html, new RegExp(`data-update="components\\.0\\.chain\\.1\\.blend"`));
  assert.match(html, new RegExp(`data-update="components\\.0\\.chain\\.1\\.transform\\.x"`));
  assert.equal((html.match(/<span>Render quality<\/span>/g) || []).length, 1);
  assert.ok(html.indexOf("chain-param-view-general") < html.indexOf("<span>Render quality</span>"), "effect render quality is owned by General");
});

test("persistent and Live source editors project the same semantic generator definitions", () => {
  const componentView = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const sceneLiveView = readFileSync(new URL("../js/control/mapping-live-view.js", import.meta.url), "utf8");

  assert.match(componentView, /componentParamViews\(component\)/);
  assert.match(sceneLiveView, /componentParamViews\(\{ params \}\)/);
  assert.match(componentView, /visualGeneratorComponent\(state, source\.generatorId\)/);
  assert.match(sceneLiveView, /visualGeneratorComponent\(state, source\.generatorId\)\?\.params/);
  assert.doesNotMatch(componentView, /source-control-schema/);
  assert.doesNotMatch(sceneLiveView, /source-control-schema/);
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

  const html = componentSelectedChainSettingsTemplate(component, state);

  assert.match(html, />Primary<\/label>/);
  assert.match(html, />Details<\/label>/);
  assert.match(html, />General<\/label>/);
  assert.match(html, /data-update="components\.0\.chain\.0\.source\.params\.rotationX"/);
  assert.match(html, /data-update="components\.0\.chain\.0\.source\.params\.modelScale"/);
  assert.match(html, /data-update="components\.0\.chain\.0\.source\.params\.geometryDetail"/);
  assert.match(html, />Geometry detail</);
  assert.match(html, /data-update="components\.0\.chain\.0\.source\.params\.renderQuality"/);
  assert.match(html, /data-update="components\.0\.chain\.0\.transform\.scale"/);
});

test("compound generators project child-node controls into the shared Component inspector", () => {
  const state = createInitialState();
  const component = state.components.find((item) => item.type !== "scene");
  const source = component.chain[0];
  source.source = {
    type: "generator",
    generatorId: "terrainFlyover",
    params: {},
  };
  state.ui.selectedChainItemId = source.id;

  const html = componentSelectedChainSettingsTemplate(component, state);

  for (const section of ["Flight", "Geometry", "Camera", "Surface material", "Wire material", "Render"]) {
    assert.match(html, new RegExp(`<span>${section}<\\/span>`));
  }
  assert.match(html, /data-control-section="geometry"/);
  assert.match(html, /data-update="components\.0\.chain\.0\.source\.params\.mountainHeight"/);
  assert.match(html, /data-color-path="components\.0\.chain\.0\.source\.params\.wireColor"/);
  assert.equal(
    (html.match(/data-update="components\.0\.chain\.0\.source\.params\.style"/g) || []).length,
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
  const html = componentSelectedChainSettingsTemplate(component, state);

  assert.match(html, /data-control-section="child"/);
  assert.match(html, /<span>Project controls<\/span>/);
  assert.match(html, /data-update="components\.0\.chain\.0\.source\.params\.gain"/);
});

test("all specialized visual Groups use the same declarative inspector projection", () => {
  const cases = [
    {
      generatorId: "anatomy",
      sections: ["Geometry", "Transform", "Material"],
      parameterPath: "modelScale",
    },
    {
      generatorId: "meshPatterns",
      sections: ["Topology", "Fill material", "Wire material", "Render"],
      parameterPath: "drawMode",
    },
  ];
  for (const example of cases) {
    const state = createInitialState();
    const component = state.components.find((item) => item.type !== "scene");
    const source = component.chain[0];
    source.source = { type: "generator", generatorId: example.generatorId, params: {} };
    state.ui.selectedChainItemId = source.id;

    const html = componentSelectedChainSettingsTemplate(component, state);
    for (const section of example.sections) {
      assert.match(html, new RegExp(`<span>${section}<\\/span>`), `${example.generatorId} contributes ${section}`);
    }
    assert.match(
      html,
      new RegExp(`data-update="components\\.0\\.chain\\.0\\.source\\.params\\.${example.parameterPath}"`),
    );
  }
});
