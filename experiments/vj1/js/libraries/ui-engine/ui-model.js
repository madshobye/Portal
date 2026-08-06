import { defineUiGraph } from "./ui-node.js";
import { createUiStateController } from "./ui-state.js";
import { RetainedUiRuntime, UiNodeRegistry } from "./ui-runtime.js";
import { normalizeParameterControl } from "./parameter-graph.js";
import { ListNode } from "./nodes/list-node.js";
import {
  ButtonNode,
  ColorPickerNode,
  NumberInputNode,
  RangeUiNode,
  SelectUiNode,
  SliderUiNode,
  TextInputNode,
  ToggleNode,
} from "./nodes/control-nodes.js";
import { MarkdownInputNode } from "./nodes/markdown-node.js";
import { CatalogPickerNode } from "./nodes/catalog-picker-node.js";
import { CollectionNode } from "./nodes/collection-node.js";
import { HostRegionNode, LayoutNode, ModalNode, PanelNode, PopupNode, TabsNode } from "./nodes/container-nodes.js";
import { TextNode } from "./nodes/display-nodes.js";
import { SectionHeaderNode } from "./nodes/section-header-node.js";
import { ChoiceGroupNode } from "./nodes/choice-group-node.js";
import { ResourceButtonNode } from "./nodes/resource-button-node.js";
import { UiNodeDefinitions } from "./nodes/catalog.js";

export const UI_MODEL_FORMAT = "ui-model@1";

const CONTROL_TYPES = Object.freeze({
  button: ButtonNode.id,
  toggle: ToggleNode.id,
  boolean: ToggleNode.id,
  slider: SliderUiNode.id,
  number: NumberInputNode.id,
  range: RangeUiNode.id,
  select: SelectUiNode.id,
  enum: SelectUiNode.id,
  textInput: TextInputNode.id,
  input: TextInputNode.id,
  color: ColorPickerNode.id,
  markdown: MarkdownInputNode.id,
  choice: ChoiceGroupNode.id,
  resourceButton: ResourceButtonNode.id,
});

const MODEL_TYPES = new Set([
  "application", "view", "layout", "host-region", "columns", "panel", "tabs", "tab",
  "list", "collection", "parameters", "modal", "popup", "text",
  "catalogPicker", "sectionHeader", "node", ...Object.keys(CONTROL_TYPES),
]);

export function defineUiModel(model = {}) {
  const root = normalizeModelNode(model, "root");
  validateModelTree(root, []);
  return Object.freeze({ ...root, format: UI_MODEL_FORMAT });
}

export function compileUiModel(model = {}, {
  id = "",
  stateAddress = "",
} = {}) {
  const root = model?.format === UI_MODEL_FORMAT ? model : defineUiModel(model);
  const graphId = String(id || root.graphId || `ui.model.${safeSegment(root.id)}`);
  const rootAddress = String(stateAddress || root.stateAddress || `models/${safeSegment(root.id)}`);
  const nodes = [];
  compileNode(root, {
    nodes,
    path: [root.id],
    parent: "",
    slot: "default",
    stateAddress: rootAddress,
  });
  return defineUiGraph({ id: graphId, version: Number(root.version) || 1, nodes });
}

export function createUi({
  host,
  model,
  id = "",
  stateAddress = "",
  registry = new UiNodeRegistry(UiNodeDefinitions),
  state = createUiStateController(),
  document = globalThis.document,
  capabilities = {},
  onCommand = () => {},
  onChange = null,
} = {}) {
  if (!host) throw new Error("UI_MODEL_HOST_REQUIRED");
  let currentModel = null;
  let currentGraph = null;
  let scope = "";
  const runtime = new RetainedUiRuntime({
    registry,
    state,
    document,
    capabilities,
    dispatch(command) {
      onCommand?.(command);
      if (typeof onChange === "function" && Object.hasOwn(command.payload || {}, "value")) {
        onChange(Object.freeze({
          address: command.address,
          value: command.payload.value,
          phase: command.phase,
          action: command.action,
          target: command.target,
          command,
        }));
      }
    },
  });

  function update(nextModel) {
    currentModel = nextModel?.format === UI_MODEL_FORMAT ? nextModel : defineUiModel(nextModel);
    currentGraph = compileUiModel(currentModel, { id, stateAddress });
    const nextScope = currentGraph.id;
    if (scope && scope !== nextScope) runtime.deactivate(scope);
    scope = nextScope;
    runtime.activate(currentGraph, { host, scope });
    return currentGraph;
  }

  function dispose() {
    runtime.dispose();
    currentModel = null;
    currentGraph = null;
    scope = "";
  }

  const api = {
    update,
    dispose,
    runtime,
    state,
    graph: () => currentGraph,
    model: () => currentModel,
    getNode(pathOrIds) {
      if (!scope) return null;
      return runtime.getNode(uiModelNodeId(pathOrIds), { scope });
    },
    getElement(pathOrIds) {
      return api.getNode(pathOrIds)?.element?.() || null;
    },
  };
  if (model) update(model);
  return Object.freeze(api);
}

export function uiModelNodeId(pathOrIds) {
  const parts = Array.isArray(pathOrIds)
    ? pathOrIds
    : String(pathOrIds || "").split("/").filter(Boolean);
  if (!parts.length) throw new Error("UI_MODEL_PATH_REQUIRED");
  return parts.map(safeSegment).join("--");
}

function compileNode(model, context) {
  if (model.type === "tab") throw new Error(`UI_MODEL_TAB_PARENT_REQUIRED:${model.id}`);
  const nodeId = uiModelNodeId(context.path);
  const stateAddress = String(model.stateAddress || context.stateAddress);
  const common = {
    id: nodeId,
    type: nodeType(model),
    parent: context.parent,
    slot: context.slot,
    stateAddress,
    inputs: nodeInputs(model),
    commands: commandBindings(model),
  };

  if (isLayoutModel(model)) {
    const children = model.children || [];
    common.inputs = {
      ...common.inputs,
      orientation: layoutOrientation(model),
      slots: children.map((child) => slotDescriptor(child)),
    };
    context.nodes.push(common);
    compileChildren(children, { ...context, parent: nodeId, path: context.path, stateAddress });
    return;
  }

  if (model.type === "tabs") {
    const tabs = normalizedTabs(model);
    common.inputs = {
      ...common.inputs,
      items: tabs.map((tab) => ({
        id: tab.id,
        label: tab.label,
        disabled: tab.disabled === true,
        presentation: String(tab.presentation || "default"),
        tabPresentation: String(tab.tabPresentation || "default"),
        panelPresentation: String(tab.panelPresentation || "default"),
        scrollKey: String(tab.scrollKey || `${stateAddress}/${safeSegment(tab.id)}/scroll`),
      })),
    };
    context.nodes.push(common);
    for (const tab of tabs) {
      const tabPath = [...context.path, tab.id];
      const layoutId = uiModelNodeId([...tabPath, "$content"]);
      const tabAddress = String(tab.stateAddress || `${stateAddress}/${safeSegment(tab.id)}`);
      const children = tab.children || [];
      context.nodes.push({
        id: layoutId,
        type: LayoutNode.id,
        parent: nodeId,
        slot: tab.id,
        stateAddress: `${tabAddress}/content`,
        inputs: {
          orientation: String(tab.orientation || "column"),
          presentation: String(tab.contentPresentation || "tab-content"),
          slots: children.map((child) => slotDescriptor(child)),
        },
        commands: {},
      });
      compileChildren(children, {
        ...context,
        parent: layoutId,
        path: tabPath,
        stateAddress: tabAddress,
      });
    }
    return;
  }

  if (["panel", "modal", "popup"].includes(model.type)) {
    context.nodes.push(common);
    if (model.type === "panel") compilePanelHeader(model, { ...context, parent: nodeId, path: context.path, stateAddress });
    compileContainerContent(model, { ...context, parent: nodeId, path: context.path, stateAddress });
    return;
  }

  if (model.type === "parameters") {
    const controls = model.controls || model.children || [];
    common.inputs = {
      ...common.inputs,
      orientation: String(model.orientation || "column"),
      slots: controls.map((control) => slotDescriptor(control)),
    };
    context.nodes.push(common);
    for (let index = 0; index < controls.length; index++) {
      const control = normalizeParameterModel(controls[index], index, model);
      compileNode(control, {
        ...context,
        parent: nodeId,
        slot: control.id,
        path: [...context.path, control.id],
        stateAddress: control.stateAddress || `${stateAddress}/${safeSegment(control.id)}`,
      });
    }
    return;
  }

  context.nodes.push(common);
  compileSlottedChildren(model, { ...context, parent: nodeId, path: context.path, stateAddress });
}

function compileChildren(children, context) {
  for (const child of children) {
    compileNode(child, {
      ...context,
      slot: child.slot || child.id,
      path: [...context.path, child.id],
      stateAddress: child.stateAddress || `${context.stateAddress}/${safeSegment(child.id)}`,
    });
  }
}

function compileContainerContent(model, context) {
  const children = model.children || [];
  if (!children.length) return;
  const contentId = uiModelNodeId([...context.path, "$content"]);
  context.nodes.push({
    id: contentId,
    type: LayoutNode.id,
    parent: context.parent,
    slot: "content",
    stateAddress: `${context.stateAddress}/content`,
    inputs: {
      orientation: String(model.contentOrientation || "column"),
      presentation: String(model.contentPresentation || "container-content"),
      slots: children.map((child) => slotDescriptor(child)),
    },
    commands: {},
  });
  compileChildren(children, {
    ...context,
    parent: contentId,
    stateAddress: `${context.stateAddress}/content`,
  });
}

function compilePanelHeader(model, context) {
  const titleBinding = model.titleBinding && typeof model.titleBinding === "object"
    ? model.titleBinding
    : null;
  const actions = Array.isArray(model.headerActions) ? model.headerActions : [];
  if (!titleBinding && !actions.length) return;
  if (titleBinding) {
    context.nodes.push({
      id: uiModelNodeId([...context.path, "$title"]),
      type: TextInputNode.id,
      parent: context.parent,
      slot: "header-title",
      stateAddress: String(titleBinding.stateAddress || `${context.stateAddress}/title`),
      inputs: {
        label: String(titleBinding.label || `${model.title || "Panel"} name`),
        labelHidden: titleBinding.labelHidden !== false,
        value: titleBinding.value ?? model.title ?? "",
        commitMode: String(titleBinding.commitMode || "commit"),
        presentation: String(titleBinding.presentation || "default"),
      },
      commands: {
        change: semanticBinding(titleBinding, "value.change"),
      },
    });
  }
  for (const action of actions) {
    context.nodes.push({
      id: uiModelNodeId([...context.path, `$action-${action.id}`]),
      type: ButtonNode.id,
      parent: context.parent,
      slot: `header-action:${action.id}`,
      stateAddress: `${context.stateAddress}/actions/${safeSegment(action.id)}`,
      inputs: {
        label: String(action.label || action.id),
        icon: String(action.icon || ""),
        iconOnly: action.iconOnly !== false,
        presentation: String(action.presentation || "default"),
        disabled: action.disabled === true,
        hidden: action.hidden === true,
        commandPayload: action.payload || {},
      },
      commands: { activate: semanticBinding(action, "panel.action") },
    });
  }
}

function compileSlottedChildren(model, context) {
  const children = model.children || [];
  for (const child of children) {
    compileNode(child, {
      ...context,
      slot: child.slot || "content",
      path: [...context.path, child.id],
      stateAddress: child.stateAddress || `${context.stateAddress}/${safeSegment(child.id)}`,
    });
  }
}

function normalizeModelNode(source, fallbackId) {
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error(`UI_MODEL_NODE_REQUIRED:${fallbackId}`);
  const type = String(source.type || "layout");
  const id = requiredText(source.id || fallbackId, "UI_MODEL_NODE_ID_REQUIRED");
  const children = Array.isArray(source.children)
    ? source.children.map((child, index) => normalizeModelNode(child, `child-${index}`))
    : [];
  const tabs = Array.isArray(source.tabs)
    ? source.tabs.map((tab, index) => normalizeTab(tab, index))
    : undefined;
  const controls = Array.isArray(source.controls)
    ? source.controls.map((control, index) => normalizeModelNode(control, `parameter-${index}`))
    : undefined;
  return {
    ...source,
    id,
    type,
    children,
    ...(tabs ? { tabs } : {}),
    ...(controls ? { controls } : {}),
  };
}

function normalizeTab(source, index) {
  const tab = normalizeModelNode({ ...source, type: "tab" }, `tab-${index}`);
  return { ...tab, label: String(source?.label || source?.id || `Tab ${index + 1}`) };
}

function validateModelTree(model, path) {
  validateNoPresentationEscapes(model, path);
  if (!MODEL_TYPES.has(model.type)) throw new Error(`UI_MODEL_TYPE_UNSUPPORTED:${model.type}:${model.id}`);
  if (model.type === "node" && !model.nodeType) throw new Error(`UI_MODEL_CUSTOM_NODE_TYPE_REQUIRED:${model.id}`);
  const here = [...path, model.id];
  const branches = model.type === "tabs" ? normalizedTabs(model) : model.type === "parameters" ? model.controls || model.children : model.children;
  const ids = new Set();
  for (const child of branches || []) {
    if (ids.has(child.id)) throw new Error(`UI_MODEL_SIBLING_ID_DUPLICATE:${here.join("/")}:${child.id}`);
    ids.add(child.id);
    validateModelTree(child, here);
  }
  for (const binding of Object.values(commandBindings(model))) {
    if (typeof binding?.action !== "string" || !binding.action) throw new Error(`UI_MODEL_COMMAND_ACTION_REQUIRED:${here.join("/")}`);
  }
}

function nodeType(model) {
  if (model.type === "node") return String(model.nodeType);
  if (model.type === "host-region") return HostRegionNode.id;
  if (isLayoutModel(model) || model.type === "parameters") return LayoutNode.id;
  if (model.type === "panel") return PanelNode.id;
  if (model.type === "tabs") return TabsNode.id;
  if (model.type === "list") return ListNode.id;
  if (model.type === "collection") return CollectionNode.id;
  if (model.type === "modal") return ModalNode.id;
  if (model.type === "popup") return PopupNode.id;
  if (model.type === "text") return TextNode.id;
  if (model.type === "catalogPicker") return CatalogPickerNode.id;
  if (model.type === "sectionHeader") return SectionHeaderNode.id;
  return CONTROL_TYPES[model.type];
}

function nodeInputs(model) {
  const inputs = { ...(model.inputs || {}) };
  const keys = [
    "title", "label", "icon", "media", "presentation", "headerPresentation", "listPresentation", "itemNode", "selectedId",
    "items", "emptyText", "noResultsText", "searchPlaceholder", "headerActions", "toolActions",
    "tabListPresentation", "panelsPresentation",
    "searchable", "reorderable", "pasteScope", "hasTitleSlot", "hasToolSlot", "disabled",
    "hidden", "description", "contentPresentation", "position",
    "labelHidden", "iconOnly", "commandPayload", "commitMode", "valueLabel", "detail", "accessibleLabel",
    "headerHidden", "closeOnOutside", "open", "titleHidden", "tone", "text", "sizing", "gap",
  ];
  for (const key of keys) if (model[key] !== undefined) inputs[key] = model[key];
  if (model.type === "panel" && model.titleBinding) {
    inputs.titleHidden = true;
    inputs.hasTitleSlot = true;
  }
  if (model.type === "choice") return inputs;
  if (CONTROL_TYPES[model.type]) {
    const control = normalizeParameterControl({ ...model, kind: controlKind(model.type) });
    return { ...control.inputs, ...inputs };
  }
  return inputs;
}

function commandBindings(model) {
  const commands = { ...(model.commands || model.on || {}) };
  const add = (event, value) => {
    if (value === undefined || value === null || value === "") return;
    if (typeof value === "function") throw new Error(`UI_MODEL_DOM_FREE_COMMAND_REQUIRED:${model.id}:${event}`);
    commands[event] = typeof value === "string" ? { action: value } : value;
  };
  add("select", model.onSelect);
  add("change", model.onChange);
  add("activate", model.onActivate);
  add("action", model.onAction);
  add("itemAction", model.onItemAction);
  add("itemContext", model.onItemContext);
  add("search", model.onSearch);
  add("reorder", model.onReorder);
  add("close", model.onClose);
  const binding = model.binding;
  if (binding) {
    const event = model.type === "button" ? "activate" : "change";
    commands[event] ||= {
      action: String(binding.action || "value.change"),
      address: String(binding.address || model.address || ""),
      target: binding.target || model.target || null,
    };
  }
  return commands;
}

function semanticBinding(source, fallbackAction) {
  return {
    action: String(source.action || fallbackAction),
    address: String(source.address || ""),
    target: source.target || null,
    payload: source.payload || {},
  };
}

function normalizeParameterModel(source, index, group) {
  // Parameter descriptors use `kind`. Model normalization supplies the generic
  // fallback type `layout`, so the semantic kind must win when both exist.
  // Numeric parameter descriptors remain sliders; a model-authored `number`
  // is the distinct constrained number-field control.
  const type = source.kind === "number" ? "slider" : parameterModelType(source.kind || source.type);
  return {
    ...source,
    id: String(source.id || `parameter-${index}`),
    type,
    binding: source.binding || {
      action: source.action || group.changeAction || "parameter.change",
      address: source.address || "",
      target: source.target || null,
    },
    commands: source.commands || {
      [type === "button" ? "activate" : "change"]: {
        action: source.action || group.changeAction || "parameter.change",
        address: source.address || "",
        target: source.target || null,
      },
      ...(source.context === false || !group.contextAction ? {} : {
        context: {
          action: source.contextAction || group.contextAction,
          target: source.contextTarget || { address: source.address, defaultValue: source.defaultValue },
        },
      }),
    },
  };
}

function parameterModelType(value) {
  const kind = String(value || "number");
  if (kind === "boolean") return "toggle";
  if (kind === "enum") return "select";
  if (kind === "text") return "textInput";
  if (kind === "event") return "button";
  return ["number", "range", "color", "markdown"].includes(kind) ? kind : "number";
}

function controlKind(type) {
  if (type === "toggle") return "boolean";
  if (type === "select") return "enum";
  if (["textInput", "input"].includes(type)) return "text";
  if (type === "button") return "event";
  if (type === "slider") return "number";
  return type;
}

function normalizedTabs(model) {
  if (model.tabs?.length) return model.tabs;
  return (model.children || []).filter((child) => child.type === "tab");
}

function isLayoutModel(model) {
  return ["application", "view", "layout", "columns", "host-region"].includes(model.type);
}

function layoutOrientation(model) {
  if (model.type === "columns") return "row";
  return String(model.orientation || model.inputs?.orientation || "column");
}

function slotDescriptor(model) {
  const layout = model.layout && typeof model.layout === "object" ? model.layout : {};
  return {
    id: String(model.slot || model.id),
    presentation: String(model.slotPresentation || "default"),
    scrollKey: model.scrollKey,
    fill: layout.fill === true,
    grow: layout.grow,
    shrink: layout.shrink,
    basis: layout.basis,
    overflow: layout.overflow,
  };
}

const PRESENTATION_ESCAPE_KEYS = new Set([
  "className", "listClassName", "slotClassName", "tabClassName", "panelClassName",
  "tabListClassName", "panelsClassName", "surfaceClassName", "contentClassName",
  "selectClassName", "copyClassName", "labelClassName", "labelIconClassName",
  "tagName", "elementId", "slotRole",
]);

function validateNoPresentationEscapes(value, path, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (PRESENTATION_ESCAPE_KEYS.has(key)) {
      throw new Error(`UI_MODEL_PRESENTATION_ESCAPE_FORBIDDEN:${[...path, key].join("/")}`);
    }
    validateNoPresentationEscapes(child, [...path, key], seen);
  }
}

function safeSegment(value) {
  return [...String(value || "node")].map((character) =>
    /[a-zA-Z0-9_-]/.test(character)
      ? character
      : `_x${character.codePointAt(0).toString(16)}_`
  ).join("");
}

function requiredText(value, error) {
  const text = String(value || "").trim();
  if (!text) throw new Error(error);
  return text;
}
