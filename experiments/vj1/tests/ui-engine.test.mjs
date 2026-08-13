import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AnalysisReportNode,
  ButtonNode,
  ColorPickerNode,
  ChoiceGroupNode,
  CatalogPickerNode,
  CollectionNode,
  compileUiModel,
  createParameterInspectorModel,
  createThumbnailCatalogGraphNode,
  createThumbnailCatalogModel,
  createUiCommand,
  createUiStateController,
  createUiStateStore,
  createRetainedScrollController,
  defineUiNode,
  defineUiGraph,
  filteredCollectionItems,
  HostRegionNode,
  isUiNodeDefinition,
  LayoutNode,
  ListNode,
  ModalNode,
  NumberInputNode,
  MarkdownInputNode,
  MetricsSummaryNode,
  NodeDefinitionEditorNode,
  nextCatalogItemIndex,
  nextListSelection,
  normalizeUiStateAddress,
  normalizeRgbaHex,
  orderedUiGraphNodes,
  parameterUiGraph,
  PanelNode,
  presentationClassNames,
  OutputSurfaceNode,
  PresentationHudNode,
  PopupNode,
  RangeUiNode,
  reconcileRetainedChildren,
  ResourceButtonNode,
  RetainedUiRuntime,
  renderListItemsHtml,
  rgbaHex,
  SelectUiNode,
  SectionHeaderNode,
  shouldRetainProjectedPanelMedia,
  SliderUiNode,
  StartupStatusNode,
  TabsNode,
  TextInputNode,
  TextNode,
  ThumbnailButtonNode,
  ToggleNode,
  normalizeThumbnailItem,
  UiNodeRegistry,
  UiNodeDefinitions,
  UI_COMMAND_PHASES,
} from "../js/libraries/ui-engine/index.js";
import { createListNodeInstance } from "../js/libraries/ui-engine/nodes/list-node.js";
import { sliderPosition } from "../js/libraries/ui-engine/nodes/control-nodes.js";
import { artifactInspectorUiGraph, chainContentParameterUiGraph, chainGeneralParameterUiGraph, chainVideoControlsUiGraph, componentCatalogUiGraph, contextMenuUiGraph, liveChainContentParameterUiGraph, liveRailUiGraph, liveTimingUiGraph, mappingRailUiGraph, mappingSurfaceControlDescriptors, mappingSurfaceInspectorUiGraph, parameterTabsUiGraph, previewToolsUiGraph, sceneRailUiGraph, sceneSurfaceInspectorUiGraph, settingsModalUiGraph, VJ1_CONTROL_UI_GRAPH } from "../js/control/control-ui-program.js";
import { UI_ICONS } from "../js/control/ui-icons.js";
import { createInitialState } from "../js/domain/models.js";
import { settingsUiModel } from "../js/control/settings-view.js";

test("UI definitions use the shared node engine while declaring a retained DOM contract", () => {
  assert.equal(isUiNodeDefinition(ListNode), true);
  assert.equal(ListNode.execution.domain, "ui");
  assert.equal(ListNode.metadata.uiNode.format, "ui-node@1");
  assert.equal(typeof ListNode.moduleExports.createUiInstance, "function");
  assert.ok(ListNode.capabilities.includes("retained-dom"));
});

test("a zero-valued slider mounts at zero instead of falling back to its minimum", () => {
  const inputs = { min: -2, max: 2, scale: "linear" };
  assert.equal(sliderPosition(0, inputs), 0);
  assert.equal(sliderPosition("0", inputs), 0);
  assert.equal(sliderPosition(undefined, inputs), -2);
});

test("a retained Toggle updates its own pressed state before an authoritative graph refresh", () => {
  class FakeElement {
    constructor(tagName) {
      this.tagName = tagName;
      this.children = [];
      this.dataset = {};
      this.attributes = new Map();
      this.listeners = new Map();
      this.hidden = false;
      const classes = new Set();
      this.classList = {
        add: (...values) => values.forEach((value) => classes.add(value)),
        remove: (...values) => values.forEach((value) => classes.delete(value)),
        toggle: (value, force) => force ? classes.add(value) : classes.delete(value),
        contains: (value) => classes.has(value),
      };
    }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = [...children]; }
    querySelector(selector) {
      if (selector === "[data-ui-control-label]") {
        return this.children.find((child) => Object.hasOwn(child.dataset, "uiControlLabel")) || null;
      }
      return null;
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name); }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    removeEventListener(type) { this.listeners.delete(type); }
    click() { this.listeners.get("click")?.({ currentTarget: this }); }
    remove() {}
  }
  const document = { createElement: (tagName) => new FakeElement(tagName) };
  const host = new FakeElement("host");
  const emitted = [];
  const instance = ToggleNode.moduleExports.createUiInstance({
    id: "opening",
    host,
    inputs: { label: "Opening", value: true, presentation: "parameter" },
    document,
    emit: (type, payload) => emitted.push({ type, payload }),
  });

  instance.mount();
  const button = instance.element().children[1];
  assert.equal(button.getAttribute("aria-pressed"), "true");
  assert.equal(button.classList.contains("is-enabled"), true);

  button.click();
  assert.equal(button.getAttribute("aria-pressed"), "false");
  assert.equal(button.classList.contains("is-enabled"), false);
  assert.deepEqual(emitted.at(-1), { type: "change", payload: { value: false } });

  button.click();
  assert.equal(button.getAttribute("aria-pressed"), "true");
  assert.equal(button.classList.contains("is-enabled"), true);
  assert.deepEqual(emitted.at(-1), { type: "change", payload: { value: true } });
  instance.dispose();
});

test("Thumbnail Catalog is one reusable Collection List and Thumbnail Button composition", () => {
  const model = createThumbnailCatalogModel({
    id: "visuals",
    stateAddress: "catalogs/visuals",
    title: "Visuals",
    items: [{ id: "a", label: "A", thumbnail: "a.png" }],
    selectedId: "a",
    commands: { select: "catalog.select" },
  });
  assert.equal(model.type, "collection");
  assert.equal(model.presentation, "rail-catalog");
  assert.equal(model.listPresentation, "thumbnail-grid");
  assert.equal(model.itemNode, "thumbnail-button");
  assert.equal(model.onSelect, "catalog.select");
  assert.deepEqual(model.items.map((item) => item.id), ["a"]);

  const graphNode = createThumbnailCatalogGraphNode({
    id: "visuals",
    parent: "rail",
    slot: "catalog",
    stateAddress: "catalogs/visuals",
    title: "Visuals",
    commands: { select: "catalog.select" },
  });
  assert.equal(graphNode.type, CollectionNode.id);
  assert.equal(graphNode.inputs.itemNode, "thumbnail-button");
  assert.equal(graphNode.commands.select, "catalog.select");
});

test("Parameter Inspector is one reusable Tabs composition over supplied parameter views", () => {
  const tabs = [{
    id: "primary",
    label: "Primary",
    children: [{ id: "parameters", type: "parameters", controls: [] }],
  }];
  const model = createParameterInspectorModel({
    id: "element-parameters",
    stateAddress: "components/a/elements/b/parameters",
    tabs,
  });
  assert.equal(model.type, "tabs");
  assert.equal(model.presentation, "parameter-tabs");
  assert.strictEqual(model.tabs, tabs);
});

test("shared section and list nodes default growing content to the top edge", () => {
  const css = readFileSync(new URL("../js/libraries/ui-engine/base.css", import.meta.url), "utf8");
  const theme = readFileSync(new URL("../js/libraries/ui-engine/themes/vj.css", import.meta.url), "utf8");
  assert.match(css, /\.ui-node-list \{[\s\S]*?align-content: start;/);
  assert.match(css, /\.ui-node-collection \{[\s\S]*?align-content: start;/);
  assert.match(css, /\.ui-node-panel \{[\s\S]*?align-content: start;/);
  assert.match(css, /\.ui-node-layout-content \{[\s\S]*?width: 100%;[\s\S]*?height: 100%;/);
  assert.match(css, /\.ui-node-layout\[data-orientation="column"\] > \.ui-node-layout-content \{[\s\S]*?justify-content: flex-start;/);
  assert.match(css, /\.ui-node-layout\[data-orientation="grid"\] > \.ui-node-layout-content \{[\s\S]*?align-content: start;/);
  assert.doesNotMatch(theme, /\.studio-inspector \.ui-node-layout-content\s*\{[^}]*display:\s*grid;/s);
});

test("parameter layouts stretch every generated control across their content width", () => {
  const theme = readFileSync(new URL("../js/libraries/ui-engine/themes/vj.css", import.meta.url), "utf8");
  assert.match(
    theme,
    /\.ui-parameter-layout > \.ui-node-layout-content \{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*grid-auto-rows:\s*max-content;[^}]*justify-content:\s*stretch;/s,
  );
});

test("parameter inspector tabs fill their host without an inset wrapper", () => {
  const theme = readFileSync(new URL("../js/libraries/ui-engine/themes/vj.css", import.meta.url), "utf8");
  assert.match(theme, /\.chain-param-views \{[^}]*height:\s*100%;[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\);[^}]*padding:\s*0;/s);
  assert.match(theme, /\.chain-param-view-tabs \{[^}]*padding:\s*0;[^}]*border:\s*0;/s);
  assert.match(theme, /\.chain-param-view-panels \{[^}]*padding:\s*0 0 4px;/s);
});

test("workspace LayoutNode owns one full-height row with equally stretched columns", () => {
  const css = readFileSync(new URL("../js/libraries/ui-engine/base.css", import.meta.url), "utf8");
  const theme = readFileSync(new URL("../js/libraries/ui-engine/themes/vj.css", import.meta.url), "utf8");
  assert.match(css, /\.ui-node-layout\[data-ui-presentation="workspace"\] \{[\s\S]*?height: 100%;[\s\S]*?max-height: 100%;[\s\S]*?grid-template-rows: minmax\(0, 1fr\);[\s\S]*?align-items: stretch;/);
  assert.match(css, /\.ui-node-layout\[data-ui-presentation="workspace"\] > \.ui-node-layout-slot,[\s\S]*?height: 100%;[\s\S]*?max-height: 100%;[\s\S]*?align-self: stretch;/);

  const workspace = VJ1_CONTROL_UI_GRAPH.nodes.find((node) => node.id === "workspace-layout");
  assert.equal(workspace.type, HostRegionNode.id);
  assert.equal(workspace.inputs.presentation, "workspace");
  assert.equal(workspace.inputs.orientation, "grid");
  assert.deepEqual(workspace.inputs.slots.map((slot) => slot.id), ["project-rail", "live-projection-rail", "inspector", "studio"]);
  assert.match(theme, /\.studio-layout\[data-workspace="live"\] > :is\(\.project-rail, \.live-projection-rail, \.studio-inspector, \.studio-main\) \{[^}]*height:\s*100%;[^}]*max-height:\s*100%;[^}]*align-self:\s*stretch;/s);
  assert.match(theme, /\.studio-layout\[data-workspace="live"\] > \.studio-inspector \{[^}]*padding-right:\s*0;[^}]*scrollbar-gutter:\s*auto;/s);
});

test("Live source filters fill a dedicated toolbar row above search", () => {
  const css = readFileSync(new URL("../js/libraries/ui-engine/base.css", import.meta.url), "utf8");
  const theme = readFileSync(new URL("../js/libraries/ui-engine/themes/vj.css", import.meta.url), "utf8");
  const graph = liveRailUiGraph(createInitialState(), { items: [], projectId: "layout-test" });
  const filters = graph.nodes.find((node) => node.id === "live-source-filter-layout");
  const collection = graph.nodes.find((node) => node.id === "live-source-collection");

  assert.ok(LayoutNode.inlets.sizing);
  assert.ok(LayoutNode.inlets.gap);
  assert.equal(collection.inputs.hasToolSlot, true);
  assert.equal(filters.inputs.sizing, "fill");
  assert.equal(filters.inputs.gap, 6);
  assert.deepEqual(filters.inputs.slots.map((slot) => slot.grow), [1, 1]);
  assert.deepEqual(filters.inputs.slots.map((slot) => slot.basis), [0, 0]);
  assert.match(css, /\.ui-node-layout\[data-ui-layout-sizing="content"\] \{[\s\S]*?width: max-content;[\s\S]*?height: auto;/);
  assert.match(theme, /:has\(\.live-source-kind-tabs\) \.ui-node-collection-tools \{[\s\S]*?grid-template-rows:\s*30px 30px;/);
  assert.match(theme, /:has\(\.live-source-kind-tabs\) \.ui-node-collection-tools-slot \{[\s\S]*?grid-column:\s*1 \/ -1;[\s\S]*?grid-row:\s*1;/);
});

test("List selection belongs to the whole item and never draws an inner edge marker", () => {
  const css = readFileSync(new URL("../js/libraries/ui-engine/base.css", import.meta.url), "utf8");
  assert.match(css, /\.ui-node-list-item\.is-selected \{[\s\S]*?background:/);
  assert.doesNotMatch(css, /\.ui-node-list-select\.is-selected \{[\s\S]*?box-shadow:/);
});

test("ordinary panels tabs and resource controls use borderless surface separation", () => {
  const css = readFileSync(new URL("../js/libraries/ui-engine/base.css", import.meta.url), "utf8");
  const theme = readFileSync(new URL("../js/libraries/ui-engine/themes/vj.css", import.meta.url), "utf8");
  assert.match(css, /\.ui-node-panel,\s*\n\.ui-node-tabs \{[\s\S]*?border: 0;/);
  assert.match(css, /\.ui-node-resource-button > button \{[\s\S]*?border: 0;/);
  assert.match(css, /\.ui-node-overlay-surface \{[\s\S]*?border: 1px solid var\(--ui-border\);/);
  assert.match(theme, /\.ui-node-catalog-panel \{[\s\S]*?border: 0;[\s\S]*?box-shadow:/);
  assert.match(theme, /\.ui-node-catalog-panel > header \{[\s\S]*?border-bottom: 0;/);
  assert.match(theme, /\.ui-node-catalog-search input,[\s\S]*?\.ui-node-catalog-section-actions > button \{[\s\S]*?border: 0;/);
  assert.match(theme, /\.ui-node-catalog-card :is\(img, video\) \{[\s\S]*?border: 0;[\s\S]*?outline: 0;/);
  assert.match(theme, /\.studio-inspector \.ui-inspector-action-slot \.ui-node-button button \{[\s\S]*?border: 0;/);
});

test("the base UI library owns its icon font and bounds unresolved ligature names", () => {
  const css = readFileSync(new URL("../js/libraries/ui-engine/base.css", import.meta.url), "utf8");
  assert.match(css, /@font-face \{[\s\S]*?font-family: "Material Symbols Rounded";[\s\S]*?material-symbols-rounded-v365\.ttf/);
  assert.match(css, /\.ui-node-button-icon,[\s\S]*?\.ui-node-resource-chevron \{[\s\S]*?max-width: 1em;[\s\S]*?overflow: hidden;[\s\S]*?white-space: nowrap;/);
});

test("modal backdrop interaction states cannot inherit ordinary button presentation", () => {
  const css = readFileSync(new URL("../js/libraries/ui-engine/base.css", import.meta.url), "utf8");
  assert.match(css, /\.ui-node-modal-backdrop,\s*\.ui-node-modal-backdrop:hover:not\(:disabled\),\s*\.ui-node-modal-backdrop:focus,\s*\.ui-node-modal-backdrop:active \{[\s\S]*?background: rgba\(0, 0, 0, 0\.64\);[\s\S]*?box-shadow: none;/);
});

test("modals stay top-aligned with equal viewport clearance at maximum height", () => {
  const css = readFileSync(new URL("../js/libraries/ui-engine/base.css", import.meta.url), "utf8");
  assert.match(css, /\.ui-node-modal \{[\s\S]*?place-items:\s*start center;[\s\S]*?padding-block:\s*16px;/);
  assert.match(css, /\.ui-node-overlay-surface \{[\s\S]*?max-height:\s*calc\(100vh - 32px\);[\s\S]*?overflow:\s*auto;/);
});

test("Startup presentation is an explicit registered UI node", () => {
  assert.equal(isUiNodeDefinition(StartupStatusNode), true);
  assert.equal(UiNodeDefinitions.includes(StartupStatusNode), true);
  assert.deepEqual(Object.keys(StartupStatusNode.inlets), ["state", "title", "message", "detail"]);
});

test("Preview and standalone Output share explicit presentation surface nodes", () => {
  assert.equal(UiNodeDefinitions.includes(OutputSurfaceNode), true);
  assert.equal(UiNodeDefinitions.includes(PresentationHudNode), true);
  assert.ok(OutputSurfaceNode.capabilities.includes("ui-output-surface"));
  assert.ok(PresentationHudNode.capabilities.includes("ui-presentation-hud"));
  const theme = readFileSync(new URL("../js/libraries/ui-engine/themes/vj.css", import.meta.url), "utf8");
  assert.match(theme, /\.empty-preview:not\(\[hidden\]\)\s*\{[\s\S]*?display:\s*grid;/);
});

test("Choice Group is the reusable exclusive finite-choice control", () => {
  assert.equal(isUiNodeDefinition(ChoiceGroupNode), true);
  assert.equal(UiNodeDefinitions.includes(ChoiceGroupNode), true);
  assert.ok(ChoiceGroupNode.capabilities.includes("ui-choice-group"));
});

test("Section Header is the single registered section identity component", () => {
  assert.equal(isUiNodeDefinition(SectionHeaderNode), true);
  assert.equal(UiNodeDefinitions.filter((definition) => definition.id === SectionHeaderNode.id).length, 1);
  assert.deepEqual(Object.keys(SectionHeaderNode.outlets), ["action"]);
  assert.equal(Object.hasOwn(SectionHeaderNode.inlets, "className"), false);
  assert.ok(presentationClassNames("component-inspector-panel").includes("ui-section"));
  assert.ok(presentationClassNames("live-inspector-panel").includes("ui-section"));
  const theme = readFileSync(new URL("../js/libraries/ui-engine/themes/vj.css", import.meta.url), "utf8");
  assert.match(theme, /\.ui-node-section-header-actions > \.ui-node-control,[\s\S]*?\.ui-node-section-header-actions > \.ui-node-control > button \{[\s\S]*?min-height:\s*22px;[\s\S]*?padding:\s*0;/);
});

test("UI graphs validate stable instance identity and parent topology", () => {
  const graph = defineUiGraph({
    id: "example.ui",
    nodes: [
      { id: "catalog", type: ListNode.id, stateAddress: "catalog/components" },
    ],
  });
  assert.equal(graph.format, "ui-graph@1");
  assert.equal(graph.nodes[0].stateAddress, "catalog/components");
  assert.throws(() => defineUiGraph({
    id: "broken.ui",
    nodes: [{ id: "child", type: ListNode.id, parent: "missing" }],
  }), /UI_GRAPH_PARENT_UNKNOWN/);
  const reordered = defineUiGraph({
    id: "reordered.ui",
    nodes: [
      { id: "child", type: ListNode.id, parent: "layout" },
      { id: "layout", type: LayoutNode.id },
    ],
  });
  assert.deepEqual(orderedUiGraphNodes(reordered).map((node) => node.id), ["layout", "child"]);
  assert.throws(() => defineUiGraph({
    id: "cycle.ui",
    nodes: [
      { id: "a", type: LayoutNode.id, parent: "b" },
      { id: "b", type: LayoutNode.id, parent: "a" },
    ],
  }), /UI_GRAPH_CYCLE/);
});

test("UI graphs reject callback authority inside node inputs and command bindings", () => {
  assert.throws(() => defineUiGraph({
    id: "callback-graph",
    nodes: [{
      id: "callback-node",
      type: ButtonNode.id,
      inputs: { nested: { resolve() {} } },
    }],
  }), /UI_GRAPH_FUNCTION_FORBIDDEN:callback-graph:callback-node:inputs\/nested\/resolve/);
});

test("retained graph teardown disposes children before their parent", () => {
  const disposed = [];
  const LifecycleProbeNode = defineUiNode({
    id: "test-ui-lifecycle-probe",
    name: "Lifecycle probe",
    description: "Records retained lifecycle disposal order.",
    factory: ({ id }) => ({
      mount() {},
      slot() { return {}; },
      dispose() { disposed.push(id); },
    }),
  });
  const registry = new UiNodeRegistry();
  registry.register(LifecycleProbeNode);
  const runtime = new RetainedUiRuntime({ registry, document: {}, dispatch() {} });
  runtime.activate(defineUiGraph({
    id: "lifecycle.graph",
    nodes: [
      { id: "parent", type: LifecycleProbeNode.id },
      { id: "child", type: LifecycleProbeNode.id, parent: "parent" },
    ],
  }), { host: {} });
  runtime.deactivate("lifecycle.graph");
  assert.deepEqual(disposed, ["child", "parent"]);
});

test("directly mounted nodes normalize shorthand semantic command bindings", () => {
  const commands = [];
  const EmitProbeNode = defineUiNode({
    id: "test-ui-command-probe",
    name: "Command probe",
    description: "Emits one event to verify runtime command binding normalization.",
    factory: ({ emit }) => ({
      mount() { emit("select", { id: "preset-a" }); },
      dispose() {},
    }),
  });
  const registry = new UiNodeRegistry();
  registry.register(EmitProbeNode);
  const runtime = new RetainedUiRuntime({
    registry,
    document: {},
    dispatch(command) { commands.push(command); },
  });
  runtime.mountNode({
    id: "presets",
    type: EmitProbeNode.id,
    host: {},
    commands: { select: "preset.select" },
  });
  assert.equal(commands[0]?.action, "preset.select");
  assert.deepEqual(commands[0]?.payload, { id: "preset-a" });
});

test("semantic UI commands contain no DOM event or element authority", () => {
  const command = createUiCommand({
    nodeId: "component-list",
    type: "select",
    phase: UI_COMMAND_PHASES.COMMIT,
    address: "project/components",
    payload: { id: "component-a" },
  });
  assert.deepEqual(command, {
    domain: "ui",
    nodeId: "component-list",
    type: "select",
    phase: "commit",
    address: "project/components",
    action: "",
    target: null,
    payload: { id: "component-a" },
    timestamp: command.timestamp,
  });
  assert.equal(Object.isFrozen(command), true);
});

test("session UI state restores by semantic address across runtime construction", () => {
  const records = new Map();
  const storage = {
    getItem: (key) => records.get(key) || null,
    setItem: (key, value) => records.set(key, value),
  };
  const first = createUiStateStore({ namespace: "synth", storage });
  first.set("browser/preset-list/scroll", { top: 284, left: 0 });
  first.set("browser/preset-list/active", "preset-12");
  first.set("browser/preset-list/selected", "preset-12");

  const restored = createUiStateStore({ namespace: "synth", storage });
  assert.deepEqual(restored.get("browser/preset-list/scroll"), { top: 284, left: 0 });
  assert.equal(restored.get("browser/preset-list/active"), "preset-12");
  assert.equal(restored.get("browser/preset-list/selected"), "preset-12");
  assert.equal(normalizeUiStateAddress("browser/preset-list/active"), "browser/preset-list/active");
  assert.throws(() => normalizeUiStateAddress("../unsafe"), /UI_STATE_ADDRESS_INVALID/);
});

test("List owns escaped markup, selected state, actions, and empty presentation", () => {
  const html = renderListItemsHtml([
    {
      id: "oscillator-a",
      label: "Bass <Lead>",
      meta: "Polyphonic",
      media: { fallback: "wave" },
      actions: [{ id: "remove", label: "Remove", icon: "close" }],
    },
  ], { selectedId: "oscillator-a" });
  assert.match(html, /data-ui-list-select="oscillator-a"/);
  assert.match(html, /aria-selected="true"/);
  assert.match(html, /Bass &lt;Lead&gt;/);
  assert.match(html, /data-ui-list-action="remove"/);
  assert.doesNotMatch(html, /data-select-component|data-update/);
  assert.match(renderListItemsHtml([], { emptyText: "No presets" }), /No presets/);
});

test("List rich item presentation uses semantic variants without styling escape hatches", () => {
  const html = renderListItemsHtml([{
    id: "preset-a",
    label: "Preset A",
    presentation: "surface-row",
    selectPresentation: "list-select",
    labelIcon: "graphic_eq",
    media: { src: "/preset.png", key: "preset-a:preview", presentation: "component-thumbnail" },
    actions: [{ id: "favorite", label: "Favorite", icon: "star", presentation: "list-remove" }],
  }]);
  assert.match(html, /class="ui-node-list-item text-list-item list-row compact-list-row has-action/);
  assert.match(html, /data-ui-media-key="preset-a:preview"/);
  assert.match(html, /class="ui-node-list-media component-thumbnail component-card-empty material-symbols-rounded"/);
  assert.match(html, /class="ui-node-list-action text-list-remove list-remove material-symbols-rounded"/);
  assert.match(html, /data-ui-list-action="favorite"/);
  assert.doesNotMatch(html, /preset-card|preset-preview|preset-favorite/);
  assert.doesNotMatch(html, /data-select-component|data-remove-component/);
});

test("List owns generic leading actions and reorderable item markup", () => {
  const html = renderListItemsHtml([{
    id: "output-a",
    label: "Output A",
    actions: [
      { id: "visibility", label: "Hide", icon: "visibility", position: "leading" },
      { id: "remove", label: "Remove", icon: "close" },
    ],
  }], { reorderable: true });
  assert.match(html, /draggable="true"/);
  assert.ok(html.indexOf('data-ui-list-action="visibility"') < html.indexOf('data-ui-list-select="output-a"'));
  assert.ok(html.indexOf('data-ui-list-action="remove"') > html.indexOf('data-ui-list-select="output-a"'));
  assert.ok(ListNode.capabilities.includes("item-reordering"));
});

test("retained List toggle actions update their own DOM before graph reconciliation", () => {
  const listeners = new Map();
  const classes = new Set(["ui-node-list-action", "enable-toggle", "is-enabled"]);
  const attributes = new Map();
  const icon = { textContent: "gradient" };
  const action = {
    dataset: {
      uiListAction: "toggle-enabled",
      uiListItem: "gradient",
      uiPresentation: "enabled-toggle",
    },
    classList: {
      add: (...values) => values.forEach((value) => classes.add(value)),
      remove: (...values) => values.forEach((value) => classes.delete(value)),
    },
    setAttribute: (name, value) => attributes.set(name, String(value)),
    querySelector: (selector) => selector === ".ui-node-list-action-icon" ? icon : null,
  };
  const target = {
    closest(selector) {
      return selector === "[data-ui-list-action]" ? action : null;
    },
  };
  const root = {
    dataset: {},
    classList: { add() {}, remove() {} },
    scrollTop: 0,
    scrollLeft: 0,
    innerHTML: "",
    matches: () => true,
    contains: () => true,
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: () => {},
    setAttribute: () => {},
    removeAttribute: () => {},
    querySelectorAll: () => [],
  };
  const emitted = [];
  const list = createListNodeInstance({
    id: "live-elements",
    host: root,
    inputs: {
      items: [{
        id: "gradient",
        label: "Gradient",
        actions: [{
          id: "toggle-enabled",
          label: "Disable Gradient",
          icon: "gradient",
          presentation: "enabled-toggle",
          position: "leading",
          payload: { path: "enabled" },
          toggle: {
            value: true,
            on: { label: "Disable Gradient", icon: "gradient", presentation: "enabled-toggle" },
            off: { label: "Enable Gradient", icon: "visibility_off", presentation: "disabled-toggle" },
          },
        }],
      }],
    },
    stateAddress: "live/elements",
    state: createUiStateController(),
    emit: (event, payload) => emitted.push({ event, payload }),
  });

  list.mount();
  listeners.get("click")({ target });
  assert.equal(attributes.get("aria-pressed"), "false");
  assert.equal(icon.textContent, "visibility_off");
  assert.equal(classes.has("is-enabled"), false);
  assert.deepEqual(emitted.at(-1), {
    event: "action",
    payload: { id: "gradient", action: "toggle-enabled", path: "enabled", value: false },
  });

  listeners.get("click")({ target });
  assert.equal(attributes.get("aria-pressed"), "true");
  assert.equal(icon.textContent, "gradient");
  assert.equal(classes.has("is-enabled"), true);
  assert.equal(emitted.at(-1).payload.value, true);
  list.dispose();
});

test("List reserves one row for leading edit and remove actions", () => {
  const html = renderListItemsHtml([{
    id: "component-a",
    label: "Component A",
    presentation: "element-row",
    actions: [
      { id: "visibility", label: "Disable", position: "leading" },
      { id: "edit-component", label: "Edit" },
      { id: "remove", label: "Remove" },
    ],
  }]);
  assert.match(html, /ui-node-list-item text-list-item chain-item-row compact-list-row has-leading has-action has-remove/);
  assert.ok(html.indexOf('data-ui-list-action="edit-component"') < html.indexOf('data-ui-list-action="remove"'));
});

test("shared retained scroll commits before reconciliation and user input cancels stale restoration", () => {
  const listeners = new Map();
  const listenerOptions = new Map();
  const frames = new Map();
  let nextFrame = 1;
  const view = {
    requestAnimationFrame(callback) {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
  };
  const element = {
    scrollTop: 0,
    scrollLeft: 0,
    addEventListener(type, listener, options) {
      listeners.set(type, listener);
      listenerOptions.set(type, options);
    },
    removeEventListener(type) { listeners.delete(type); },
  };
  const state = createUiStateController({
    session: createUiStateStore({
      namespace: "scroll-test",
      initial: { "components/a/elements/scroll": { top: 120, left: 0 } },
    }),
  });
  const scroll = createRetainedScrollController({
    state,
    address: "components/a/elements/scroll",
    window: view,
  });

  scroll.attach(element);
  assert.equal(element.scrollTop, 120);
  assert.ok(frames.size > 0);
  assert.equal(listenerOptions.get("pointerdown").capture, true);

  element.scrollTop = 170;
  listeners.get("pointerdown")({});
  assert.equal(frames.size, 0);
  assert.deepEqual(state.get("components/a/elements/scroll"), { top: 170, left: 0 });
  element.scrollTop = 185;
  listeners.get("scroll")({});
  assert.deepEqual(state.get("components/a/elements/scroll"), { top: 185, left: 0 });

  // A parent may detach the list before the child lifecycle is disposed. The
  // detached element can report zero and must not erase the captured viewport.
  element.scrollTop = 0;
  scroll.dispose();
  assert.deepEqual(state.get("components/a/elements/scroll"), { top: 185, left: 0 });

  const replacement = {
    scrollTop: 0,
    scrollLeft: 0,
    addEventListener() {},
    removeEventListener() {},
  };
  const remounted = createRetainedScrollController({
    state,
    address: "components/a/elements/scroll",
    window: view,
  });
  remounted.attach(replacement);
  assert.equal(replacement.scrollTop, 185);
  remounted.dispose();
});

test("retained list ordering does not detach children when semantic order is unchanged", () => {
  const operations = [];
  const container = {
    children: [],
    insertBefore(child, current) {
      const previousIndex = this.children.indexOf(child);
      if (previousIndex >= 0) this.children.splice(previousIndex, 1);
      const currentIndex = current ? this.children.indexOf(current) : -1;
      this.children.splice(currentIndex >= 0 ? currentIndex : this.children.length, 0, child);
      operations.push(["insert", child.id, current?.id || null]);
    },
  };
  const child = (id) => ({
    id,
    remove() {
      const index = container.children.indexOf(this);
      if (index >= 0) container.children.splice(index, 1);
      operations.push(["remove", id]);
    },
  });
  const a = child("a");
  const b = child("b");
  const c = child("c");
  container.children.push(a, b, c);

  reconcileRetainedChildren(container, [a, b, c]);
  assert.deepEqual(operations, []);
  assert.deepEqual(container.children, [a, b, c]);

  reconcileRetainedChildren(container, [c, a, b]);
  assert.deepEqual(container.children, [c, a, b]);
  assert.deepEqual(operations, [["insert", "c", "a"]]);
});

test("Metrics Summary retains sampled rows and scroll position while values and rank change", () => {
  class FakeElement {
    constructor(tagName, ownerDocument) {
      this.tagName = tagName;
      this.ownerDocument = ownerDocument;
      this.children = [];
      this.dataset = {};
      this.attributes = new Map();
      this.hidden = false;
      this.scrollTop = 0;
      const classes = new Set();
      this.classList = {
        add: (...values) => values.forEach((value) => classes.add(value)),
        toggle: (value, force) => force ? classes.add(value) : classes.delete(value),
        contains: (value) => classes.has(value),
      };
    }
    append(...children) { children.forEach((child) => this.insertBefore(child, null)); }
    replaceChildren(...children) {
      this.children.forEach((child) => { child.parentNode = null; });
      this.children = [];
      this.append(...children);
    }
    insertBefore(child, current) {
      child.remove?.();
      const index = current ? this.children.indexOf(current) : -1;
      this.children.splice(index >= 0 ? index : this.children.length, 0, child);
      child.parentNode = this;
    }
    remove() {
      if (!this.parentNode) return;
      const index = this.parentNode.children.indexOf(this);
      if (index >= 0) this.parentNode.children.splice(index, 1);
      this.parentNode = null;
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    addEventListener() {}
    removeEventListener() {}
  }
  const document = {
    createElement(tagName) { return new FakeElement(tagName, document); },
  };
  const host = new FakeElement("host", document);
  const model = (hotspots) => ({
    readouts: [{ id: "cpu", icon: "timer", label: "CPU", value: "3.0 ms" }],
    categoryTitle: "Signal flow per second",
    categories: [{ id: "renders", label: "Renders", value: "8.0/s" }],
    hotspots,
  });
  const first = { id: "first", label: "First", detail: "preview", value: "2.0 ms", share: "60%", action: { id: "edit", label: "Edit First", icon: "edit" } };
  const second = { id: "second", label: "Second", detail: "preview", value: "1.0 ms", share: "30%", action: { id: "edit", label: "Edit Second", icon: "edit" } };
  const instance = MetricsSummaryNode.moduleExports.createUiInstance({
    host,
    inputs: model([first, second]),
    document,
    emit() {},
  });
  instance.mount();
  const root = host.children[0];
  const readout = root.children[0].children[0];
  const hotspotList = root.children[2];
  const firstRow = hotspotList.children[0];
  const secondRow = hotspotList.children[1];
  hotspotList.scrollTop = 47;

  instance.update(model([
    { ...second, value: "2.1 ms", share: "55%" },
    { ...first, value: "1.8 ms", share: "45%" },
  ]));

  assert.equal(root.children[0].children[0], readout);
  assert.equal(hotspotList.children[0], secondRow);
  assert.equal(hotspotList.children[1], firstRow);
  assert.equal(hotspotList.scrollTop, 47);
  const compactAction = firstRow.children.at(-1);
  assert.equal(compactAction.children.length, 1);
  assert.equal(compactAction.attributes.get("aria-label"), "Edit First");
  instance.dispose();
});

test("Analysis Report owns a bounded modal, ordered report sections, and structured tables", () => {
  const css = readFileSync(new URL("../js/libraries/ui-engine/base.css", import.meta.url), "utf8");
  const theme = readFileSync(new URL("../js/libraries/ui-engine/themes/vj.css", import.meta.url), "utf8");
  const source = readFileSync(new URL("../js/libraries/ui-engine/nodes/report-nodes.js", import.meta.url), "utf8");

  assert.equal(UiNodeDefinitions.includes(AnalysisReportNode), true);
  assert.match(css, /\.ui-node-analysis-report \{[^}]*position: fixed;[^}]*inset: 0;[^}]*place-items: center;/s);
  assert.match(css, /\.ui-node-analysis-report-panel \{[^}]*width: min\(900px, calc\(100vw - 32px\)\);[^}]*grid-template-rows: auto minmax\(0, 1fr\) auto;[^}]*overflow: hidden;/s);
  assert.match(css, /\.ui-node-analysis-report-body \{[^}]*grid-auto-rows: max-content;[^}]*align-content: start;[^}]*overflow: auto;[^}]*scrollbar-gutter: stable;/s);
  assert.match(theme, /\.ui-node-analysis-report-cards \{[^}]*gap: 8px;/s);
  assert.match(theme, /\.ui-node-analysis-report-section > ul\.is-metrics \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/s);
  assert.match(theme, /data-ui-report-action="download"/);
  assert.ok(source.includes("reportTable(document, section.table)"));
  assert.ok(source.includes("ui-node-analysis-report-table-cell"));
});

test("List descriptors preserve hierarchical depth, semantic action payloads, and nested reorder targets", () => {
  const html = renderListItemsHtml([{
    id: "group-a",
    label: "Group A",
    depth: 0,
    acceptsChildren: true,
    dropAfter: true,
    actions: [{
      id: "toggle",
      label: "Toggle",
      payload: { path: "component/group-a/enabled", value: false },
    }],
  }, {
    id: "child-a",
    label: "Child A",
    depth: 1,
  }, {
    id: "group-b",
    label: "Group B",
    depth: 1,
    acceptsChildren: true,
    dropAfter: true,
  }, {
    id: "child-b",
    label: "Child B",
    depth: 2,
  }, {
    id: "root-b",
    label: "Root B",
  }], { reorderable: true });
  assert.match(html, /data-ui-list-depth="2"/);
  assert.match(html, /--ui-list-depth:2/);
  assert.match(html, /data-ui-list-action="toggle"/);
  const groupA = html.indexOf('data-ui-list-select="group-a"');
  const insideA = html.indexOf('data-ui-list-drop-position="inside" data-ui-list-drop-item="group-a"');
  const childA = html.indexOf('data-ui-list-select="child-a"');
  const groupB = html.indexOf('data-ui-list-select="group-b"');
  const insideB = html.indexOf('data-ui-list-drop-position="inside" data-ui-list-drop-item="group-b"');
  const childB = html.indexOf('data-ui-list-select="child-b"');
  const afterB = html.indexOf('data-ui-list-drop-position="after" data-ui-list-drop-item="group-b"');
  const afterA = html.indexOf('data-ui-list-drop-position="after" data-ui-list-drop-item="group-a"');
  const rootB = html.indexOf('data-ui-list-select="root-b"');
  assert.ok(groupA < insideA && insideA < childA);
  assert.ok(groupB < insideB && insideB < childB);
  assert.ok(childB < afterB && afterB < afterA && afterA < rootB);
});

test("List structural drop rows emit their declared nested reorder position", () => {
  const listeners = new Map();
  const root = {
    dataset: {},
    classList: { add() {}, remove() {} },
    scrollTop: 0,
    scrollLeft: 0,
    innerHTML: "",
    matches: () => true,
    contains: () => true,
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: () => {},
    setAttribute: () => {},
    removeAttribute: () => {},
    querySelectorAll: () => [],
  };
  const dropTarget = {
    dataset: { uiListDropPosition: "after", uiListDropItem: "group-a" },
    classList: { add() {}, remove() {} },
  };
  const target = {
    closest(selector) {
      if (selector === "[data-ui-list-drop-position]") return dropTarget;
      return null;
    },
  };
  const emitted = [];
  const list = createListNodeInstance({
    id: "elements",
    host: root,
    inputs: {
      reorderable: true,
      items: [
        { id: "group-a", acceptsChildren: true, dropAfter: true },
        { id: "child-a", depth: 1 },
      ],
    },
    stateAddress: "components/a/elements",
    state: createUiStateController(),
    emit: (event, payload) => emitted.push({ event, payload }),
  });
  list.mount();
  root.dataset.uiListDragging = "child-a";
  listeners.get("drop")({ target, preventDefault() {} });
  assert.deepEqual(emitted, [{
    event: "reorder",
    payload: { fromId: "child-a", toId: "group-a", position: "after" },
  }]);
  list.dispose();
});

test("List emits one semantic selection for a draggable pointer press followed by click", () => {
  const listeners = new Map();
  const root = {
    dataset: {},
    classList: { add() {}, remove() {} },
    scrollTop: 0,
    scrollLeft: 0,
    matches: () => true,
    contains: () => true,
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: () => {},
    setAttribute: () => {},
    removeAttribute: () => {},
    querySelectorAll: () => [],
  };
  const selected = {
    dataset: { uiListSelect: "element-a" },
    getAttribute: () => "false",
  };
  const target = {
    closest(selector) {
      if (selector === "[data-ui-list-action]") return null;
      if (selector === "[data-ui-list-select]") return selected;
      return null;
    },
  };
  const emitted = [];
  const list = createListNodeInstance({
    id: "elements",
    host: root,
    inputs: { items: [{ id: "element-a", label: "Element A" }], selectedId: "" },
    stateAddress: "components/a/elements",
    state: createUiStateController(),
    emit: (event, payload) => emitted.push({ event, payload }),
  });
  list.mount();
  listeners.get("pointerdown")({ button: 0, target });
  listeners.get("click")({ target });
  assert.deepEqual(emitted, [{ event: "select", payload: { id: "element-a" } }]);
  list.dispose();
});

test("List keyboard navigation skips disabled items and clamps at its boundaries", () => {
  const items = [
    { id: "a", label: "A" },
    { id: "b", label: "B", disabled: true },
    { id: "c", label: "C" },
  ];
  assert.equal(nextListSelection(items, "a", "ArrowDown"), "c");
  assert.equal(nextListSelection(items, "c", "ArrowDown"), "c");
  assert.equal(nextListSelection(items, "c", "ArrowUp"), "a");
  assert.equal(nextListSelection(items, "c", "Home"), "a");
  assert.equal(nextListSelection(items, "a", "End"), "c");
});

test("Catalog picker uses the same bounded active-item keyboard contract without app handlers", () => {
  assert.equal(nextCatalogItemIndex(3, -1, "ArrowDown"), 0);
  assert.equal(nextCatalogItemIndex(3, 0, "ArrowRight"), 1);
  assert.equal(nextCatalogItemIndex(3, 2, "ArrowDown"), 2);
  assert.equal(nextCatalogItemIndex(3, 2, "ArrowUp"), 1);
  assert.equal(nextCatalogItemIndex(3, 1, "Home"), 0);
  assert.equal(nextCatalogItemIndex(3, 1, "End"), 2);
  assert.ok(CatalogPickerNode.capabilities.includes("keyboard-navigation"));
  assert.ok(CatalogPickerNode.metadata.uiNode.state.some((entry) => entry.id === "activeItem"));
  assert.equal(Object.hasOwn(CatalogPickerNode.inlets, "resolveMedia"), false);
  assert.equal(Object.hasOwn(CatalogPickerNode.inlets, "releaseMedia"), false);
});

test("Catalog picker renders semantic item icons through the shared Material Symbols font", () => {
  const source = readFileSync(new URL("../js/libraries/ui-engine/nodes/catalog-picker-node.js", import.meta.url), "utf8");
  const theme = readFileSync(new URL("../js/libraries/ui-engine/themes/vj.css", import.meta.url), "utf8");

  assert.ok(source.includes('icon.className = "ui-node-catalog-icon material-symbols-rounded"'));
  assert.ok(source.includes('icon.setAttribute("aria-hidden", "true")'));
  assert.ok(source.includes('setActionButtonContent(close, { icon: "close", label: "Close" }, document)'));
  assert.match(theme, /data-ui-action-variant="marker-0"[\s\S]*?opacity:\s*0\.38/);
  assert.match(theme, /data-ui-action-variant\]:not\(\[data-ui-action-variant="marker-0"\]\)[\s\S]*?font-variation-settings:\s*"FILL" 1/);
  assert.doesNotMatch(source, /close\.textContent\s*=\s*["']×["']/);
});

test("Collection composes List behavior with generic local search and semantic rail actions", () => {
  assert.deepEqual(filteredCollectionItems([
    { id: "bass", label: "Bass", searchText: "bass mono synth" },
    { id: "pad", label: "Pad", searchText: "wide pad synth" },
  ], "mono").map((item) => item.id), ["bass"]);
  assert.ok(CollectionNode.capabilities.includes("selectable-list"));
  assert.ok(CollectionNode.capabilities.includes("scroll-restoration"));

  const graph = componentCatalogUiGraph({
    items: [{ id: "component-a", label: "Component A" }],
    selectedId: "component-a",
    sortMode: "name",
    projectId: "show-a",
  });
  const collection = graph.nodes.find((node) => node.id === "component-rail--catalog");
  assert.equal(collection.type, CollectionNode.id);
  assert.equal(collection.stateAddress, "projects/show-a/component-catalog");
  assert.equal(collection.inputs.toolActions[0].id, "sort:created");
  assert.equal(collection.commands.select.action, "component.select");
  assert.equal(collection.commands.itemAction.action, "component.item-action");
});

test("Scene rail is configuration over Collections and keeps Surface authority as descriptors", () => {
  const state = createInitialState();
  const graph = sceneRailUiGraph(state, { projectId: "show-a", items: [] });
  const scenes = graph.nodes.find((node) => node.id === "scene-rail--scenes");
  const surfaces = graph.nodes.find((node) => node.id === "scene-rail--surfaces");
  assert.equal(scenes.type, CollectionNode.id);
  assert.equal(scenes.inputs.pasteScope, "scene-list");
  assert.equal(surfaces.type, CollectionNode.id);
  assert.equal(surfaces.inputs.reorderable, true);
  assert.equal(surfaces.inputs.pasteScope, "surface-list");
  assert.equal(surfaces.commands.reorder.action, "surface.reorder");
  assert.deepEqual(surfaces.inputs.items.map((item) => item.id), state.surfaces.map((surface) => surface.id));
});

test("Mapping rail composes editable title and test-pattern controls into one retained graph", () => {
  const state = createInitialState();
  const graph = mappingRailUiGraph(state, { projectId: "show-a", items: [] });
  const mappings = graph.nodes.find((node) => node.id === "mapping-collection");
  const surfaces = graph.nodes.find((node) => node.id === "mapping-surface-collection");
  const name = graph.nodes.find((node) => node.id === "mapping-name");
  const testPattern = graph.nodes.find((node) => node.id === "mapping-test-pattern");
  assert.equal(mappings.type, CollectionNode.id);
  assert.equal(surfaces.type, CollectionNode.id);
  assert.equal(surfaces.inputs.items[0].id, "__scene_mapping__");
  assert.equal(name.parent, "mapping-surface-collection");
  assert.equal(name.slot, "title");
  assert.equal(testPattern.parent, "mapping-surface-collection");
  assert.equal(testPattern.slot, "tools");
  assert.equal(testPattern.inputs.icon, UI_ICONS.testPattern);
  assert.equal(testPattern.inputs.icon, "grid_view");
  assert.equal(name.commands.change.action, "project.set-value");
  assert.equal(testPattern.commands.change.action, "project.set-value");
});

test("generic UI control and container library covers application-neutral composition", () => {
  for (const definition of [
    ButtonNode,
    ToggleNode,
    SliderUiNode,
    SelectUiNode,
    TextInputNode,
    ColorPickerNode,
    CatalogPickerNode,
    CollectionNode,
    ThumbnailButtonNode,
    RangeUiNode,
    MarkdownInputNode,
    PanelNode,
    LayoutNode,
    TabsNode,
    ModalNode,
    PopupNode,
    TextNode,
  ]) {
    assert.equal(isUiNodeDefinition(definition), true, definition.id);
    assert.ok(definition.presentation.catalogs.includes("ui"), definition.id);
    assert.ok(definition.presentation.placeableOn.includes("ui-graph"), definition.id);
  }
});

test("Thumbnail Button is a reusable semantic item node without application styling hooks", () => {
  const source = readFileSync(new URL("../js/libraries/ui-engine/nodes/thumbnail-button-node.js", import.meta.url), "utf8");
  const theme = readFileSync(new URL("../js/libraries/ui-engine/themes/vj.css", import.meta.url), "utf8");
  const item = normalizeThumbnailItem({
    id: "scene-a",
    label: "Scene A",
    thumbnail: { src: "/scene-a.png", key: "scene-a:" },
    actions: [{ id: "marker", label: "Mark", icon: "keep", variant: "marker-1" }],
  });
  const destructive = normalizeThumbnailItem({
    id: "scene-b",
    actions: [{ id: "remove", label: "Remove", variant: "remove" }],
  });
  assert.equal(isUiNodeDefinition(ThumbnailButtonNode), true);
  assert.equal(item.thumbnail.key, "scene-a:");
  assert.equal(item.actions[0].variant, "marker-1");
  assert.equal(item.actions[0].revealDelayMs, 0);
  assert.equal(destructive.actions[0].revealDelayMs, 3000);
  assert.equal(Object.hasOwn(item, "className"), false);
  assert.ok(ThumbnailButtonNode.capabilities.includes("thumbnail-presentation"));
  assert.match(source, /root\.addEventListener\("pointerenter", onPointerEnter\)/);
  assert.match(source, /function revealDestructiveActionsIfSafe\(\) \{[\s\S]*?pointerOverDelayedAction/);
  assert.match(source, /x >= bounds\.left && x <= bounds\.right && y >= bounds\.top && y <= bounds\.bottom/);
  assert.match(source, /function onPointerLeave\(\) \{[\s\S]*?resetDestructiveActionReveal\(\)/);
  assert.match(source, /Number\(action\.dataset\.uiRevealDelayMs\) > 0 && !destructiveActionsRevealed/);
  assert.match(theme, /\.ui-node-thumbnail-item\.has-revealed-destructive-actions[\s\S]*?data-ui-action-variant="remove"/);
});

test("Resource Button is the reusable labeled resource-selection control", () => {
  assert.equal(isUiNodeDefinition(ResourceButtonNode), true);
  assert.equal(UiNodeDefinitions.includes(ResourceButtonNode), true);
  assert.deepEqual(Object.keys(ResourceButtonNode.outlets), ["activate"]);
  assert.ok(ResourceButtonNode.capabilities.includes("ui-resource-button"));
  assert.ok(ResourceButtonNode.inlets.valueLabel);
  assert.ok(ResourceButtonNode.inlets.media);
  assert.ok(ResourceButtonNode.inlets.commandPayload);
});

test("positioned context menus compose generic Popup and Button nodes", () => {
  const theme = readFileSync(new URL("../js/libraries/ui-engine/themes/vj.css", import.meta.url), "utf8");
  const graph = contextMenuUiGraph({
    x: 320,
    y: 180,
    actions: [
      { id: "reset", label: "Reset" },
      { id: "remove", label: "Remove", danger: true },
    ],
  });
  const popup = graph.nodes.find((node) => node.id === "context-popup");
  const buttons = graph.nodes.filter((node) => node.type === ButtonNode.id);
  assert.equal(popup.type, PopupNode.id);
  assert.deepEqual(popup.inputs.position, { x: 320, y: 180, padding: 8 });
  assert.equal(popup.inputs.headerHidden, true);
  assert.equal(popup.inputs.role, "menu");
  assert.equal(popup.commands.close.action, "context-menu.close");
  assert.deepEqual(buttons.map((node) => node.inputs.commandPayload.id), ["reset", "remove"]);
  assert.ok(buttons.every((node) => node.commands.activate.action === "context-menu.action"));
  assert.ok(Object.hasOwn(PopupNode.inlets, "position"));
  assert.ok(Object.hasOwn(PopupNode.inlets, "closeOnOutside"));
  assert.match(theme, /\.context-popup \{[^}]*border: 0;[^}]*background: #000;/s);
});

test("artifact inspectors compose generic layout, panel, input, and action nodes", () => {
  const graph = artifactInspectorUiGraph({
    targetId: "component-1",
    title: "Aurora",
    titleAddress: "components/byId/component-1/name",
    kind: "Component",
    icon: "component",
    media: { src: "/aurora.png", key: "component-1:", fallbackIcon: "component" },
    headerAction: { action: "inspector.add-element", label: "Add element", icon: "add" },
    secondaryLayout: { fill: true, grow: 0, shrink: 0, basis: "40%", overflow: "hidden" },
  });
  const layout = graph.nodes.find((node) => node.id === "artifact-inspector");
  const panel = graph.nodes.find((node) => node.id === "artifact-inspector--primary");
  const title = graph.nodes.find((node) => node.id === "artifact-inspector--primary--_x24_title");
  const action = graph.nodes.find((node) => node.id === "artifact-inspector--primary--_x24_action-action");
  assert.equal(layout.type, "core.ui.host-region");
  assert.equal("adoptHost" in layout.inputs, false);
  assert.equal(layout.inputs.presentation, "artifact-inspector");
  assert.deepEqual(layout.inputs.slots.find((slot) => slot.id === "primary"), {
    id: "primary",
    presentation: "default",
    scrollKey: undefined,
    fill: true,
    grow: 1,
    shrink: 1,
    basis: 0,
    overflow: "hidden",
  });
  assert.deepEqual(layout.inputs.slots.find((slot) => slot.id === "secondary"), {
    id: "secondary",
    presentation: "default",
    scrollKey: undefined,
    fill: true,
    grow: 0,
    shrink: 0,
    basis: "40%",
    overflow: "hidden",
  });
  assert.equal(panel.type, PanelNode.id);
  assert.equal(panel.inputs.media.key, "component-1:");
  assert.equal(title.type, TextInputNode.id);
  assert.equal(title.stateAddress, "components/byId/component-1/name");
  assert.equal(action.type, ButtonNode.id);
  assert.equal(action.commands.activate.action, "inspector.add-element");
  assert.deepEqual(action.inputs.commandPayload, { targetId: "component-1" });
});

test("Panel retains asynchronously projected media only while semantic identity is unchanged", () => {
  assert.equal(shouldRetainProjectedPanelMedia({
    hasImage: true,
    previousKey: "component-1:",
    nextKey: "component-1:",
  }), true);
  assert.equal(shouldRetainProjectedPanelMedia({
    hasImage: true,
    previousKey: "component-1:",
    nextKey: "component-2:",
  }), false);
  assert.equal(shouldRetainProjectedPanelMedia({
    hasImage: true,
    previousKey: "component-1:",
    nextKey: "component-1:",
    src: "/authoritative.png",
  }), false);
});

test("VJ1 Markdown parameters compile to one retained editor with semantic style controls", () => {
  const state = createInitialState();
  const component = state.components.find((item) => item.type !== "scene");
  const params = [
    { id: "text", type: "text", label: "Text", defaultValue: "", ui: "markdown", styleControls: ["bold", "italic"] },
    { id: "bold", type: "boolean", label: "Bold", defaultValue: false, ui: "text-style-toggle" },
    { id: "italic", type: "boolean", label: "Italic", defaultValue: false, ui: "text-style-toggle" },
  ];
  const graph = chainContentParameterUiGraph({
    state,
    component,
    basePath: "nodes.groups.0.nodes.1.configuration.source",
    paramView: "primary",
    params: [params[0]],
    allParams: params,
    values: { text: "# Portal", bold: true, italic: false },
  });
  const editor = graph.nodes.find((node) => node.type === MarkdownInputNode.id);
  assert.ok(editor);
  assert.deepEqual(editor.inputs.styleControls.map(({ id, value }) => ({ id, value })), [
    { id: "bold", value: true },
    { id: "italic", value: false },
  ]);
  assert.equal(editor.commands.change.action, "project.set-value");
  assert.equal(editor.commands.style.action, "project.set-related-value");
  assert.deepEqual(editor.commands.style.target.controls, {
    bold: { path: "nodes.groups.0.nodes.1.configuration.source.params.bold" },
    italic: { path: "nodes.groups.0.nodes.1.configuration.source.params.italic" },
  });
  const liveGraph = liveChainContentParameterUiGraph({
    state,
    component,
    nodeId: "text-node",
    pathPrefix: "source.params",
    paramView: "primary",
    params: [params[0]],
    allParams: params,
    values: { text: "# Portal", bold: false, italic: true },
  });
  const liveEditor = liveGraph.nodes.find((node) => node.type === MarkdownInputNode.id);
  assert.equal(liveEditor.commands.style.action, "live.set-related-value");
  assert.deepEqual(liveEditor.commands.style.target, {
    componentId: component.id,
    nodeId: "text-node",
    controls: {
      bold: { path: "source.params.bold" },
      italic: { path: "source.params.italic" },
    },
  });
});

test("Color picker normalizes one reusable RGBA value contract", () => {
  assert.equal(normalizeRgbaHex("#abc"), "#aabbccff");
  assert.equal(normalizeRgbaHex("#abcd"), "#aabbccdd");
  assert.equal(normalizeRgbaHex("invalid"), "#000000ff");
  assert.equal(rgbaHex("#336699", 0.5), "#33669980");
});

test("parameter models preserve descriptor kinds when compiling controls", () => {
  const graph = compileUiModel({
    id: "typed-parameters",
    type: "parameters",
    controls: [{
      id: "accent",
      kind: "color",
      label: "Accent",
      value: "#ff4f92ff",
      address: "source.params.accent",
    }],
  });
  assert.equal(graph.nodes.find((node) => node.id.endsWith("--accent"))?.type, ColorPickerNode.id);
});

test("generic parameter graphs translate descriptors into controls and DOM-free commands", () => {
  const graph = parameterUiGraph({
    id: "synth.oscillator.parameters",
    changeAction: "synth.set-parameter",
    contextAction: "synth.open-parameter-menu",
    controls: [
      { id: "frequency", kind: "number", address: "oscillators.0.frequency", label: "Frequency", value: 440, min: 20, max: 20000, step: 1, scale: "log", defaultValue: 440 },
      { id: "enabled", kind: "boolean", address: "oscillators.0.enabled", label: "Enabled", value: true, defaultValue: true },
      { id: "wave", kind: "enum", address: "oscillators.0.wave", label: "Wave", value: "sine", options: ["sine", "square"], defaultValue: "sine" },
      { id: "tint", kind: "color", address: "oscillators.0.tint", label: "Tint", value: "#ff0000ff", defaultValue: "#ffffffff" },
      { id: "band", kind: "range", address: "oscillators.0.band", label: "Band", value: { min: 120, max: 1200 }, min: 20, max: 20000, step: 1 },
    ],
  });
  const controls = graph.nodes.slice(1);
  assert.deepEqual(controls.map((node) => node.type), [
    SliderUiNode.id,
    ToggleNode.id,
    SelectUiNode.id,
    ColorPickerNode.id,
    RangeUiNode.id,
  ]);
  assert.ok(controls.every((node) => node.commands.change.action === "synth.set-parameter"));
  assert.ok(controls.every((node) => node.commands.context.action === "synth.open-parameter-menu"));
  assert.ok(controls.every((node) => node.inputs.presentation === "parameter"));
  assert.equal(controls[0].commands.context.target.defaultValue, 440);
  assert.ok(graph.nodes[0].inputs.slots.every((slot) =>
    slot.fill === false &&
    slot.grow === 0 &&
    slot.shrink === 0 &&
    slot.basis === "auto" &&
    slot.overflow === "visible"
  ));
});

test("generic and Live parameter lists own the shared dark parameter surface", () => {
  assert.deepEqual(presentationClassNames("parameter-list"), [
    "ui-parameter-layout",
    "parameter-surface",
  ]);
  assert.deepEqual(presentationClassNames("live-component-view-panel-controls"), [
    "live-component-view-panel",
    "live-component-view-controls",
  ]);
  const theme = readFileSync(new URL("../js/libraries/ui-engine/themes/vj.css", import.meta.url), "utf8");
  assert.match(theme, /\.live-component-view-controls \.ui-parameter-layout\.parameter-surface \{[^}]*padding:\s*var\(--param-section-inset\);[^}]*padding-bottom:\s*var\(--param-section-bottom-inset\);[^}]*border-radius:\s*var\(--radius-section-inner\);[^}]*background:\s*var\(--panel-2\);/s);
});

test("VJ1 paired parameters compile into one atomic reusable Range node", () => {
  const state = createInitialState();
  const component = state.components.find((item) => item.type !== "scene");
  const graph = chainContentParameterUiGraph({
    state,
    component,
    item: { id: "effect-a" },
    nodeId: "effect-a",
    basePath: "nodes.groups.0.nodes.1.configuration",
    paramView: "primary",
    values: { hueMin: 200, hueMax: 260 },
    params: [
      { id: "hueMin", type: "number", label: "Hue", min: 0, max: 360, step: 1, defaultValue: 0, ui: "range-pair", rangePair: "hue", rangeRole: "min", rangeKind: "hue", rangeDisplay: "degrees" },
      { id: "hueMax", type: "number", label: "Hue", min: 0, max: 360, step: 1, defaultValue: 360, ui: "range-pair", rangePair: "hue", rangeRole: "max", rangeKind: "hue", rangeDisplay: "degrees" },
    ],
  });
  const range = graph.nodes.find((node) => node.type === RangeUiNode.id);
  assert.ok(range);
  assert.deepEqual(range.inputs.value, { min: 200, max: 260 });
  assert.equal(range.inputs.display, "degrees");
  assert.equal(range.commands.change.action, "project.set-range");
  assert.deepEqual(range.commands.change.target, {
    minPath: "nodes.groups.0.nodes.1.configuration.params.hueMin",
    maxPath: "nodes.groups.0.nodes.1.configuration.params.hueMax",
  });
  assert.equal(graph.nodes.filter((node) => node.type === RangeUiNode.id).length, 1);
});

test("movie trim and speed configure generic retained controls without exposing input DOM", () => {
  const graph = chainVideoControlsUiGraph({
    component: { id: "component-a" },
    basePath: "nodes.groups.0.nodes.1.configuration.source.params",
    trim: { start: 1.25, end: 8.5, max: 12, implicitEnd: false, available: true },
    speed: 1.2,
  });
  const trim = graph.nodes.find((node) => node.type === RangeUiNode.id);
  const speed = graph.nodes.find((node) => node.type === SliderUiNode.id);
  const layout = graph.nodes.find((node) => node.type === LayoutNode.id);
  assert.equal(layout.inputs.presentation, "parameter-list");
  assert.equal(trim.inputs.presentation, "parameter");
  assert.equal(trim.inputs.label, "Movie segment");
  assert.deepEqual(trim.inputs.value, { min: 1.25, max: 8.5 });
  assert.equal(trim.inputs.display, "time");
  assert.equal(trim.commands.change.action, "project.set-video-trim");
  assert.deepEqual(trim.commands.change.target, {
    startPath: "nodes.groups.0.nodes.1.configuration.source.params.start",
    endPath: "nodes.groups.0.nodes.1.configuration.source.params.end",
    implicitEnd: false,
  });
  assert.equal(speed.commands.change.action, "project.set-value");
});

test("VJ1 General inspector is a retained parameter graph over canonical authored paths", () => {
  const state = createInitialState();
  const component = state.components.find((item) => item.type !== "scene");
  const item = {
    id: "source-a",
    kind: "source",
    source: { type: "generator", params: { renderQuality: 0.75 } },
    opacity: 0.8,
    blend: "normal",
    transform: { x: 0.1, y: -0.2, scale: 1.5 },
    boundary: { x: 0, y: 0, width: 0.8, height: 0.4, rotation: 0 },
  };
  const base = "nodes.groups.0.nodes.0.configuration";
  const graph = chainGeneralParameterUiGraph({ item, basePath: base, component, state });
  const byAddress = new Map(graph.nodes.filter((node) => node.stateAddress).map((node) => [node.stateAddress, node]));
  for (const path of [
    `${base}.source.params.renderQuality`,
    `${base}.opacity`,
    `${base}.blend`,
    `${base}.transform.x`,
    `${base}.transform.y`,
    `${base}.transform.scale`,
    `${base}.boundary.x`,
    `${base}.boundary.y`,
    `${base}.boundary.rotation`,
    `${base}.boundary.scale`,
  ]) assert.ok(byAddress.has(path), path);
  assert.equal(byAddress.get(`${base}.boundary.scale`)?.commands.change.action, "project.set-boundary-scale");
  assert.deepEqual(byAddress.get(`${base}.boundary.scale`)?.commands.change.target, {
    path: `${base}.boundary.scale`,
    width: 0.8,
    height: 0.4,
  });
});

test("VJ1 workspace columns are configuration in a reusable UI graph", () => {
  const layout = VJ1_CONTROL_UI_GRAPH.nodes.find((node) => node.id === "workspace-layout");
  assert.equal(layout.type, "core.ui.host-region");
  assert.equal("adoptHost" in layout.inputs, false);
  assert.deepEqual(layout.inputs.slots.map((slot) => slot.id), [
    "project-rail",
    "live-projection-rail",
    "inspector",
    "studio",
  ]);
});

test("Preview tools are retained semantic controls with an explicit presentation HUD node", () => {
  const state = createInitialState();
  state.ui.previewQuality = "low";
  state.ui.previewDiagnostics = true;
  state.global.mappingHandleMode = "always";
  const graph = previewToolsUiGraph(state, { workspace: "mapping", kind: "preview" });
  const layout = graph.nodes.find((node) => node.id === "preview-tools-layout");
  const buttons = graph.nodes.filter((node) => node.type === ButtonNode.id);

  assert.equal(layout.type, "core.ui.host-region");
  assert.equal("adoptHost" in layout.inputs, false);
  assert.equal(layout.inputs.slots.some((slot) => slot.id === "hud" && slot.presentation === "preview-hud-slot"), true);
  assert.equal(layout.inputs.slots.every((slot) => slot.grow === 0 && slot.shrink === 0 && slot.basis === "auto"), true);
  assert.deepEqual(buttons.map((node) => node.commands.activate.action).sort(), [
    "preview.cycle-quality",
    "preview.fit-frame",
    "preview.fit-world",
    "preview.toggle-diagnostics",
    "preview.toggle-mapping-handles",
    "preview.zoom",
    "preview.zoom",
  ].sort());
  assert.equal(graph.nodes.find((node) => node.id === "preview-diagnostics").inputs.presentation, "preview-tool-active");
  assert.equal(graph.nodes.find((node) => node.id === "preview-quality").inputs.buttonLabel, "Low");
  assert.equal(graph.nodes.find((node) => node.id === "preview-handles").inputs.hidden, false);
  assert.equal(graph.nodes.find((node) => node.id === "preview-hud")?.type, "core.ui.presentation-hud");
});

test("VJ1 Mapping inspector describes generic controls with semantic state addresses", () => {
  const state = createInitialState();
  const surface = state.mappings[0].surfaces[0];
  state.ui.selectedMappingId = state.mappings[0].id;
  state.ui.selectedSurfaceId = surface.id;
  const controls = mappingSurfaceControlDescriptors(surface, state);
  assert.deepEqual(controls.map(({ type }) => type), [
    SliderUiNode.id,
    SliderUiNode.id,
    SelectUiNode.id,
  ]);
  assert.deepEqual(controls.map(({ address }) => address), [
    "mappings.0.surfaces.0.feather",
    "mappings.0.surfaces.0.opacity",
    "mappings.0.surfaces.0.projectionFit",
  ]);
  const graph = mappingSurfaceInspectorUiGraph(surface, state);
  assert.equal(graph.nodes.find((node) => node.id === "mapping-surface-panel")?.type, PanelNode.id);
  assert.equal(graph.nodes.find((node) => node.id === "mapping-surface-title")?.type, TextInputNode.id);
  assert.ok(graph.nodes
    .filter((node) => node.stateAddress?.includes(".surfaces.0."))
    .filter((node) => node.id !== "mapping-surface-title")
    .every((node) => node.inputs.presentation === "parameter"));
});

test("VJ1 Scene Surface inspector reuses generic controls over canonical Mapping addresses", () => {
  const state = createInitialState();
  const surface = state.mappings[0].surfaces[0];
  state.ui.selectedMappingId = state.mappings[0].id;
  state.ui.selectedSurfaceId = surface.id;
  const graph = sceneSurfaceInspectorUiGraph(surface, state);
  assert.equal(graph.nodes.find((node) => node.id === "scene-surface-panel")?.type, PanelNode.id);
  assert.equal(graph.nodes.find((node) => node.stateAddress === "mappings.0.surfaces.0.name")?.type, TextInputNode.id);
  assert.deepEqual(graph.nodes
    .filter((node) => node.commands.change?.action === "project.set-value")
    .map((node) => node.stateAddress), [
      "mappings.0.surfaces.0.name",
      "mappings.0.surfaces.0.x",
      "mappings.0.surfaces.0.y",
      "mappings.0.surfaces.0.width",
      "mappings.0.surfaces.0.height",
      "mappings.0.surfaces.0.keepProportions",
      "mappings.0.surfaces.0.projectionFit",
    ]);
  assert.ok(graph.nodes
    .filter((node) => node.stateAddress?.startsWith("mappings.0.surfaces.0."))
    .filter((node) => node.stateAddress !== "mappings.0.surfaces.0.name")
    .every((node) => node.inputs.presentation === "parameter"));

  surface.destination = { type: "direct", outputId: "output-main" };
  const directGraph = sceneSurfaceInspectorUiGraph(surface, state);
  assert.equal(directGraph.nodes.some((node) => node.stateAddress === "mappings.0.surfaces.0.name"), false);
  assert.equal(directGraph.nodes.some((node) => node.stateAddress === "mappings.0.surfaces.0.x"), true);
});

test("VJ1 Live timing is a generic control graph over canonical session addresses", () => {
  const state = createInitialState();
  state.ui.live.transitionId = "test.transition";
  const graph = liveTimingUiGraph(state, [{
    id: "test.transition",
    name: "Test transition",
    kernel: {},
    parameters: [
      { id: "softness", label: "Softness", type: "number", min: 0, max: 1, step: 0.01, defaultValue: 0.2 },
      { id: "invert", label: "Invert", type: "boolean", defaultValue: false },
      { id: "mode", label: "Mode", type: "enum", values: ["a", "b"], defaultValue: "a" },
      { id: "color", label: "Color", type: "color", defaultValue: "#ff0000ff" },
    ],
  }]);
  const byAddress = new Map(graph.nodes.filter((node) => node.stateAddress).map((node) => [node.stateAddress, node]));
  assert.equal(byAddress.get("ui.live.transitionId")?.type, SelectUiNode.id);
  assert.equal(byAddress.get("global.timeStretch")?.type, SliderUiNode.id);
  assert.equal(byAddress.get("ui.live.transitionDuration")?.type, SliderUiNode.id);
  assert.equal(byAddress.get("ui.live.paramFadeDuration")?.type, SliderUiNode.id);
  assert.equal(byAddress.get("ui.live.transitionParameters.softness")?.type, SliderUiNode.id);
  assert.equal(byAddress.get("ui.live.transitionParameters.invert")?.type, ToggleNode.id);
  const theme = readFileSync(new URL("../js/libraries/ui-engine/themes/vj.css", import.meta.url), "utf8");
  assert.match(theme, /\.live-timing-panel \{\s*margin:\s*0;\s*\}/);
  assert.equal(byAddress.get("ui.live.transitionParameters.mode")?.type, SelectUiNode.id);
  assert.equal(byAddress.get("ui.live.transitionParameters.color")?.type, ColorPickerNode.id);
  assert.equal([...byAddress.values()].every((node) => node.commands.change.action === "project.set-value"), true);
  assert.equal([...byAddress.values()].every((node) => node.inputs.presentation === "parameter"), true);
});

test("VJ1 Settings delegates modal and tab DOM ownership to generic UI nodes", () => {
  const graph = settingsModalUiGraph(settingsUiModel(createInitialState(), { projectId: "show-a" }));
  const modal = graph.nodes.find((node) => node.id === "settings-modal");
  const tabs = graph.nodes.find((node) => node.id === "settings-modal--tabs");
  assert.equal(modal.type, ModalNode.id);
  assert.equal(modal.commands.close.action, "settings.close");
  assert.equal(tabs.type, TabsNode.id);
  assert.equal(tabs.commands.select.action, "settings.select-tab");
  assert.equal(graph.nodes.find((node) => node.id === tabs.parent)?.parent, modal.id);
  assert.equal(tabs.stateAddress, "projects/show-a/settings-tabs");
  assert.equal(modal.inputs.presentation, "settings-modal");
  assert.equal(modal.inputs.contentPresentation, "settings-modal-content");
  assert.equal(tabs.inputs.presentation, "settings-tabs");
  assert.equal(tabs.inputs.tabListPresentation, "settings-tab-list");
  assert.equal(tabs.inputs.panelsPresentation, "settings-tab-panels");
  const byCommandAddress = (address) => graph.nodes.find((node) => node.commands.change?.address === address);
  const density = byCommandAddress("render.pixelDensity");
  assert.equal(density.type, NumberInputNode.id);
  assert.equal(density.inputs.value, 1);
  assert.equal(density.inputs.min, 0.5);
  assert.equal(density.inputs.step, 0.25);
  assert.equal(density.inputs.commitMode, "commit");
  assert.equal(byCommandAddress("render.maxFrameRate")?.type, NumberInputNode.id);
  assert.equal(byCommandAddress("render.postProcessing.grayscaleAmount")?.type, NumberInputNode.id);
  assert.equal(graph.nodes.some((node) => node.type === SliderUiNode.id), false);
  assert.equal(tabs.slot, "tabs");
  assert.deepEqual(graph.nodes.find((node) => node.id === tabs.parent)?.inputs.slots[0], {
    id: "tabs",
    presentation: "default",
    scrollKey: undefined,
    fill: true,
    grow: 1,
    shrink: 1,
    basis: 0,
    overflow: "hidden",
  });
  assert.deepEqual(tabs.inputs.items.map((item) => item.id), [
    "outputs",
    "inputs",
    "devices",
    "rendering",
  ]);
  assert.ok(tabs.inputs.items.every((item) => item.panelPresentation === "settings-tab-panel"));
  const outputContent = graph.nodes.find((node) => node.id === "settings-modal--tabs--outputs--_x24_content");
  assert.ok(outputContent.inputs.slots.length > 0);
  assert.ok(outputContent.inputs.slots.every((slot) =>
    slot.grow === 0 && slot.shrink === 0 && slot.basis === "auto"
  ));
  const renderingGrid = graph.nodes.find((node) => node.id === "settings-modal--tabs--rendering--rendering-sections");
  const sceneSection = graph.nodes.find((node) => node.id === `${renderingGrid.id}--scene-proportion`);
  const samplingContent = graph.nodes.find((node) => node.id === `${renderingGrid.id}--sampling--_x24_content`);
  const postSlot = renderingGrid.inputs.slots.find((slot) => slot.id === "post");
  const addOutput = graph.nodes.find((node) => node.id === "settings-modal--tabs--outputs--add-output");
  assert.equal(renderingGrid.type, LayoutNode.id);
  assert.equal(renderingGrid.inputs.orientation, "grid");
  assert.equal(renderingGrid.inputs.presentation, "settings-section-grid");
  assert.equal(sceneSection.type, PanelNode.id);
  assert.equal(sceneSection.inputs.presentation, "settings-section");
  assert.equal(samplingContent.inputs.orientation, "grid");
  assert.equal(samplingContent.inputs.presentation, "settings-control-grid");
  assert.equal(samplingContent.inputs.slots.find((slot) => slot.id === "limit-scene")?.presentation, "settings-wide-slot");
  assert.equal(postSlot.presentation, "settings-wide-slot");
  assert.equal(addOutput.inputs.presentation, "settings-footer-action");
  const spacedProject = settingsModalUiGraph(settingsUiModel(createInitialState(), { projectId: "Untitled VJ Set" }));
  assert.equal(
    spacedProject.nodes.find((node) => node.id === "settings-modal--tabs").stateAddress,
    "projects/Untitled_20VJ_20Set/settings-tabs",
  );
});

test("parameter inspectors configure generic retained tabs with semantic state and scroll addresses", () => {
  const graph = parameterTabsUiGraph({
    component: { id: "synth-a" },
    nodeId: "oscillator-a",
    stateAddress: "projects/demo/components/synth-a/elements/oscillator-a/parameter-tabs",
    views: [
      { id: "primary", label: "Primary", html: "" },
      { id: "general", label: "General", html: "" },
    ],
  });
  const tabs = graph.nodes.find((node) => node.id === "parameter-tabs");
  assert.equal(tabs.type, TabsNode.id);
  assert.equal(tabs.stateAddress, "projects/demo/components/synth-a/elements/oscillator-a/parameter-tabs");
  assert.deepEqual(tabs.inputs.items.map((item) => item.id), ["primary", "general"]);
  assert.equal(tabs.inputs.items[0].tabPresentation, "parameter-view-option");
  assert.equal(tabs.inputs.items[0].scrollKey, "chain-params:synth-a:oscillator-a:primary");
  assert.ok(TabsNode.capabilities.includes("scroll-restoration"));

  const parameterGraph = parameterTabsUiGraph({
    component: { id: "synth-a" },
    nodeId: "oscillator-a",
    views: [{
      id: "primary",
      label: "Primary",
      models: [{ id: "resource", type: "resourceButton", label: "Media" }],
      parameterModel: {
        paramView: "primary",
        params: [{ id: "gain", type: "number", label: "Gain", min: 0, max: 1, defaultValue: 1 }],
        allParams: [{ id: "gain", type: "number", label: "Gain", min: 0, max: 1, defaultValue: 1 }],
        values: { gain: 1 },
        basePath: "components.0.source",
      },
    }],
  });
  const primaryContent = parameterGraph.nodes.find((node) =>
    node.inputs?.presentation === "parameter-tab-content"
  );
  assert.equal(parameterGraph.nodes.some((node) => node.inputs?.presentation === "parameter-specialized"), false);
  assert.deepEqual(primaryContent.inputs.slots.map(({ grow, shrink, basis }) => ({ grow, shrink, basis })), [
    { grow: 0, shrink: 0, basis: "auto" },
    { grow: 1, shrink: 1, basis: 0 },
  ]);

  const editorGraph = parameterTabsUiGraph({
    component: { id: "synth-a" },
    nodeId: "node-a",
    stateAddress: "projects/demo/components/synth-a/elements/node-a/parameter-tabs",
    views: [{
      id: "node",
      label: "Node",
      nodeEditorModel: { definition: { id: "test.node", version: "0.1.0" } },
    }],
  });
  const editor = editorGraph.nodes.find((node) => node.type === NodeDefinitionEditorNode.id);
  assert.equal(editor.commands.save.action, "nodes.editor-save");
  assert.equal(editor.commands.reset.action, "nodes.editor-reset");
});
