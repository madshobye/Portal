import test from "node:test";
import assert from "node:assert/strict";

import {
  createUi,
  compileUiModel,
  defineUiModel,
  defineUiNode,
  LayoutNode,
  ListNode,
  SliderUiNode,
  TabsNode,
  ToggleNode,
  UiNodeDefinitions,
  UiNodeRegistry,
  uiModelNodeId,
} from "../js/libraries/ui-engine/index.js";
import {
  artifactInspectorUiModel,
  componentCatalogUiModel,
  sceneRailUiModel,
  sceneSurfaceInspectorUiModel,
} from "../js/control/control-ui-program.js";
import { getSelectedMapping } from "../js/control/control-selectors.js";
import { componentElementsUiModel, componentOverviewUiModel } from "../js/control/component-view.js";
import { createInitialState } from "../js/domain/models.js";

function synthModel(values = {}) {
  return {
    id: "synth",
    type: "tabs",
    stateAddress: "synth/views",
    tabs: ["oscillator", "filter", "amplifier", "envelope", "effects"].map((id) => ({
      id,
      label: id[0].toUpperCase() + id.slice(1),
      children: [{
        id: `${id}-amount`,
        type: "slider",
        label: "Amount",
        value: values[id] ?? 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        binding: {
          action: "synth.set-parameter",
          address: `${id}.amount`,
          target: { sectionId: id, parameterId: "amount" },
        },
      }],
    })),
  };
}

test("hierarchical UI models compile tabs and controls into stable retained topology", () => {
  const graph = compileUiModel(synthModel(), { id: "example.synth" });
  const tabs = graph.nodes.find((node) => node.id === "synth");
  const slider = graph.nodes.find((node) => node.id === "synth--filter--filter-amount");
  assert.equal(tabs.type, TabsNode.id);
  assert.deepEqual(tabs.inputs.items.map((item) => item.id), [
    "oscillator", "filter", "amplifier", "envelope", "effects",
  ]);
  assert.equal(slider.type, SliderUiNode.id);
  assert.equal(slider.parent, "synth--filter--_x24_content");
  assert.equal(slider.slot, "filter-amount");
  assert.equal(slider.stateAddress, "synth/views/filter/filter-amount");
  assert.equal(slider.commands.change.action, "synth.set-parameter");
  assert.equal(slider.commands.change.address, "filter.amount");
  assert.deepEqual(slider.commands.change.target, { sectionId: "filter", parameterId: "amount" });
});

test("hierarchical model identity is semantic and independent from sibling order", () => {
  const first = compileUiModel(synthModel(), { id: "example.synth" });
  const reorderedModel = synthModel();
  reorderedModel.tabs.reverse();
  const second = compileUiModel(reorderedModel, { id: "example.synth" });
  const firstIds = new Set(first.nodes.map((node) => node.id));
  const secondIds = new Set(second.nodes.map((node) => node.id));
  assert.deepEqual(secondIds, firstIds);
  assert.equal(uiModelNodeId(["synth", "filter", "filter-amount"]), "synth--filter--filter-amount");
  assert.notEqual(uiModelNodeId(["a b"]), uiModelNodeId(["a-b"]));
});

test("control presentation inputs survive model compilation", () => {
  const graph = compileUiModel({
    id: "toolbar",
    type: "layout",
    children: [{
      id: "sync",
      type: "toggle",
      label: "Sync instances",
      icon: "sync",
      iconOnly: true,
      value: true,
      onChange: { action: "project.set-value", address: "components.0.syncInstances" },
    }],
  });
  const toggle = graph.nodes.find((node) => node.id === "toolbar--sync");
  assert.equal(toggle.type, ToggleNode.id);
  assert.equal(toggle.inputs.icon, "sync");
  assert.equal(toggle.inputs.iconOnly, true);
});

test("model validation rejects ambiguous identities and imperative event handlers", () => {
  assert.throws(() => defineUiModel({
    id: "broken",
    type: "layout",
    children: [{ id: "same", type: "text" }, { id: "same", type: "text" }],
  }), /UI_MODEL_SIBLING_ID_DUPLICATE/);
  assert.throws(() => defineUiModel({
    id: "broken",
    type: "button",
    onActivate() {},
  }), /UI_MODEL_DOM_FREE_COMMAND_REQUIRED/);
  assert.throws(() => defineUiModel({ id: "broken", type: "unknown-widget" }), /UI_MODEL_TYPE_UNSUPPORTED/);
});

test("model validation rejects HTML and styling escape fields at every depth", () => {
  for (const [key, value] of [
    ["className", "special"],
    ["tagName", "article"],
    ["elementId", "special-host"],
    ["slotRole", "presentation"],
  ]) {
    assert.throws(() => defineUiModel({
      id: "broken",
      type: "layout",
      children: [{ id: "child", type: "text", inputs: { [key]: value } }],
    }), new RegExp(`UI_MODEL_PRESENTATION_ESCAPE_FORBIDDEN:children/0/inputs/${key}`));
  }
});

test("parameters and explicit registered nodes remain ordinary children in one hierarchy", () => {
  const graph = compileUiModel({
    id: "component-view",
    type: "columns",
    children: [{
      id: "components",
      type: "collection",
      items: [],
      onSelect: "component.select",
    }, {
      id: "detail",
      type: "panel",
      title: "Component",
      children: [{
        id: "preview",
        type: "node",
        nodeType: LayoutNode.id,
        inputs: { orientation: "column" },
      }, {
        id: "parameters",
        type: "parameters",
        changeAction: "project.set-value",
        controls: [{
          id: "opacity",
          type: "number",
          value: 0.8,
          min: 0,
          max: 1,
          address: "component/node/opacity",
          target: { componentId: "component-1", nodeId: "node-1", path: "opacity" },
        }],
      }],
    }],
  });
  assert.equal(graph.nodes.find((node) => node.id === "component-view--detail--preview")?.type, LayoutNode.id);
  assert.equal(graph.nodes.find((node) => node.id === "component-view--detail--parameters")?.type, LayoutNode.id);
  assert.equal(graph.nodes.find((node) => node.id.endsWith("--opacity"))?.commands.change.action, "project.set-value");
});

test("createUi retains compatible instances across model updates and exposes one facade", () => {
  const calls = [];
  const ProbeNode = defineUiNode({
    id: "test.ui-model-probe",
    name: "UI model probe",
    description: "Records hierarchical facade lifecycle calls.",
    factory: ({ inputs, emit }) => ({
      mount() {
        calls.push(["mount", inputs.value]);
        emit("change", { value: inputs.value });
      },
      update(nextInputs) { calls.push(["update", nextInputs.value]); },
      dispose() { calls.push(["dispose"]); },
      element() { return null; },
    }),
  });
  const registry = new UiNodeRegistry(UiNodeDefinitions);
  registry.register(ProbeNode);
  const commands = [];
  const changes = [];
  const model = (value) => ({
    id: "probe",
    type: "node",
    nodeType: ProbeNode.id,
    inputs: { value },
    commands: { change: { action: "probe.change", address: "probe/value" } },
  });
  const ui = createUi({
    host: {},
    model: model(1),
    registry,
    document: {},
    onCommand: (command) => commands.push(command),
    onChange: (change) => changes.push(change),
  });
  ui.update(model(2));
  assert.deepEqual(calls, [["mount", 1], ["update", 2]]);
  assert.equal(commands[0].action, "probe.change");
  assert.equal(changes[0].address, "probe/value");
  assert.equal(changes[0].value, 1);
  assert.equal(ui.graph().id, "ui.model.probe");
  assert.equal(ui.model().id, "probe");
  ui.dispose();
  assert.deepEqual(calls.at(-1), ["dispose"]);
});

test("explicit registered renderer nodes retain their owned children across unrelated model updates", () => {
  class FakeElement {
    constructor() {
      this.children = [];
      this.dataset = {};
      this.attributes = new Map();
      this.hidden = false;
      const classes = new Set();
      this.classList = {
        add: (...values) => values.forEach((value) => classes.add(value)),
        remove: (...values) => values.forEach((value) => classes.delete(value)),
        contains: (value) => classes.has(value),
      };
    }
    replaceChildren(...children) {
      this.children = children;
      for (const child of children) if (child && typeof child === "object") child.parentNode = this;
    }
    setAttribute(name, value) { this.attributes.set(name, value); }
    removeAttribute(name) { this.attributes.delete(name); }
    remove() {
      if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
      this.parentNode = null;
    }
  }
  const document = { createElement: () => new FakeElement() };
  const host = new FakeElement();
  const RendererSurfaceNode = defineUiNode({
    id: "test.renderer-surface",
    name: "Renderer surface",
    description: "Explicit retained renderer surface used by the hierarchy test.",
    factory: ({ host: nodeHost, inputs, document: nodeDocument }) => {
      let root = null;
      return {
        mount() {
          root = nodeDocument.createElement("div");
          root.dataset.mode = String(inputs.mode || "");
          nodeHost.replaceChildren(root);
        },
        update(nextInputs) { root.dataset.mode = String(nextInputs.mode || ""); },
        dispose() { root?.remove(); root = null; },
        element() { return root; },
      };
    },
  });
  const registry = new UiNodeRegistry(UiNodeDefinitions);
  registry.register(RendererSurfaceNode);
  const model = (mode) => ({
    id: "preview",
    type: "node",
    nodeType: RendererSurfaceNode.id,
    inputs: { mode },
  });
  const ui = createUi({ host, model: model("first"), document, registry });
  const rendererHost = ui.getElement("preview");
  const rendererCanvas = { id: "renderer-canvas" };
  rendererHost.replaceChildren(rendererCanvas);
  ui.update(model("second"));
  assert.equal(ui.getElement("preview"), rendererHost);
  assert.equal(rendererHost.children[0], rendererCanvas);
  assert.equal(rendererHost.dataset.mode, "second");
  ui.dispose();
  assert.equal(host.children.length, 0);
});

test("Component workspace projections express list, elements, and parameters as one semantic hierarchy", () => {
  const state = createInitialState();
  const component = state.components.find((item) => item.type !== "scene");
  const list = componentCatalogUiModel({
    items: [{ id: component.id, label: component.name }],
    selectedId: component.id,
    projectId: "show-a",
  });
  const inspector = artifactInspectorUiModel({
    targetId: component.id,
    title: component.name,
    titleAddress: "components/selected/name",
    kind: "Component",
    contentId: "component-overview",
    contentChildren: [
      componentOverviewUiModel(component, state),
      componentElementsUiModel(component, state),
    ],
    secondaryId: "component-parameters",
  });
  assert.equal(list.type, "host-region");
  assert.equal(list.children[0].type, "collection");
  assert.equal(list.children[0].onSelect, "component.select");
  assert.equal(list.children[0].itemNode, "thumbnail-button");
  assert.equal(inspector.children[0].children[0].id, "component-overview");
  assert.equal(inspector.children[0].children[0].type, "layout");
  assert.equal(inspector.children[0].children[1].id, "elements");
  assert.equal(inspector.children[0].children[1].type, "list");
  assert.deepEqual(componentOverviewUiModel(component, state).layout, {
    grow: 0, shrink: 0, basis: "auto",
  });
  assert.deepEqual(componentElementsUiModel(component, state).layout, {
    fill: true, grow: 1, shrink: 1, basis: 0, overflow: "hidden",
  });
  assert.equal(inspector.children[1].id, "component-parameters");
  const firstGraph = compileUiModel(inspector, { id: "vj1.component-inspector" });
  const nextGraph = compileUiModel(artifactInspectorUiModel({
    targetId: "another-component",
    title: "Another",
    titleAddress: "components/another/name",
    kind: "Component",
    contentId: "component-overview",
    contentChildren: [
      componentOverviewUiModel(component, state),
      componentElementsUiModel(component, state),
    ],
    secondaryId: "component-parameters",
  }), { id: "vj1.component-inspector" });
  assert.ok(firstGraph.nodes.some((node) => node.id === "artifact-inspector--primary--component-overview"));
  assert.equal(firstGraph.nodes.find((node) => node.id === "artifact-inspector--primary--elements")?.type, ListNode.id);
  assert.deepEqual(
    firstGraph.nodes.find((node) => node.id === "artifact-inspector--primary--_x24_content")?.inputs.slots,
    [{
      id: "component-overview",
      presentation: "default",
      scrollKey: undefined,
      fill: false,
      grow: 0,
      shrink: 0,
      basis: "auto",
      overflow: undefined,
    }, {
      id: "elements",
      presentation: "default",
      scrollKey: undefined,
      fill: true,
      grow: 1,
      shrink: 1,
      basis: 0,
      overflow: "hidden",
    }],
  );
  assert.ok(firstGraph.nodes.some((node) => node.id === "artifact-inspector--component-parameters"));
  assert.deepEqual(new Set(nextGraph.nodes.map((node) => node.id)), new Set(firstGraph.nodes.map((node) => node.id)));
});

test("Scene hierarchy presents Mapping-owned Surfaces without creating Scene-owned copies", () => {
  const state = createInitialState();
  const mapping = getSelectedMapping(state);
  const model = sceneRailUiModel(state, { projectId: "show-a", items: [] });
  const scenes = model.children.find((child) => child.id === "scenes");
  const surfaces = model.children.find((child) => child.id === "surfaces");
  assert.equal(scenes.onSelect, "component.select");
  assert.equal(surfaces.onSelect, "surface.select");
  assert.equal(surfaces.onReorder, "surface.reorder");
  assert.match(surfaces.stateAddress, new RegExp(`/mappings/${mapping.id}/surfaces$`));
  assert.deepEqual(surfaces.items.map((item) => item.id), state.surfaces.map((surface) => surface.id));
  assert.ok(state.components.filter((component) => component.type === "scene").every((scene) => !Object.hasOwn(scene, "surfaces")));
});

test("Scene Surface inspection gives the shared secondary region a natural-height presentation", () => {
  const state = createInitialState();
  const surface = state.surfaces[0];
  const surfaceModel = sceneSurfaceInspectorUiModel(surface, state);
  const model = artifactInspectorUiModel({
    targetId: "scene-a",
    title: "Scene A",
    kind: "Scene",
    secondaryId: "scene-surface-or-parameters",
    secondaryPresentation: "scene-surface-secondary",
    secondaryLayout: {
      fill: false,
      grow: 0,
      shrink: 0,
      basis: "auto",
      overflow: "visible",
    },
    secondaryChildren: [surfaceModel],
  });
  const secondary = model.children.find((child) => child.id === "scene-surface-or-parameters");
  const graph = compileUiModel(model, { id: "vj1.scene-surface-inspector" });
  assert.equal(secondary.presentation, "scene-surface-secondary");
  assert.deepEqual(secondary.layout, {
    fill: false,
    grow: 0,
    shrink: 0,
    basis: "auto",
    overflow: "visible",
  });
  assert.equal(
    graph.nodes.find((node) => node.id === "artifact-inspector--scene-surface-or-parameters")?.inputs.presentation,
    "scene-surface-secondary",
  );
  assert.deepEqual(
    graph.nodes.find((node) => node.id === "artifact-inspector--scene-surface-or-parameters")?.inputs.slots[0],
    {
      id: "scene-surface-panel",
      presentation: "default",
      scrollKey: undefined,
      fill: false,
      grow: 0,
      shrink: 0,
      basis: "auto",
      overflow: "visible",
    },
  );
});
