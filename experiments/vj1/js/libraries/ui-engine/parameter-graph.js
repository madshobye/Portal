import { defineUiGraph } from "./ui-node.js";
import {
  ButtonNode,
  ColorPickerNode,
  RangeUiNode,
  SelectUiNode,
  SliderUiNode,
  TextInputNode,
  ToggleNode,
} from "./nodes/control-nodes.js";
import { MarkdownInputNode } from "./nodes/markdown-node.js";
import { HostRegionNode, LayoutNode } from "./nodes/container-nodes.js";

// Parameter descriptors are deliberately app-neutral. A synth, DJ program, or
// visual editor can translate its domain schema once and then reuse the same
// retained controls, lifecycle, keyboard behavior, and semantic command path.
export function parameterUiGraph({
  id,
  controls = [],
  changeAction = "parameter.change",
  contextAction = "parameter.context",
} = {}) {
  const graphId = requiredText(id, "UI_PARAMETER_GRAPH_ID_REQUIRED");
  return defineUiGraph({
    id: graphId,
    nodes: parameterUiNodes({
      id: graphId,
      controls,
      changeAction,
      contextAction,
    }),
  });
}

// Parameter lists are also composable inside Panels and other retained graphs.
// The same projection is used whether the list is a complete graph or one
// branch of a larger inspector, so callers cannot accidentally create a second
// parameter DOM/presentation contract.
export function parameterUiNodes({
  id,
  controls = [],
  changeAction = "parameter.change",
  contextAction = "parameter.context",
  parent = "",
  slot = "",
} = {}) {
  const graphId = requiredText(id, "UI_PARAMETER_GRAPH_ID_REQUIRED");
  const normalized = controls.map((control, index) => normalizeParameterControl(control, index));
  const rootId = `${safeId(graphId)}-layout`;
  const nodes = [{
    id: rootId,
    type: parent ? LayoutNode.id : HostRegionNode.id,
    ...(parent ? { parent } : {}),
    ...(slot ? { slot } : {}),
    inputs: {
      orientation: "column",
      presentation: "parameter-list",
      slots: normalized.map((control) => ({
        id: control.id,
        presentation: "parameter-slot",
        fill: false,
        grow: 0,
        shrink: 0,
        basis: "auto",
        overflow: "visible",
      })),
    },
  }];
  for (const control of normalized) {
    const activationEvent = control.kind === "event" ? "activate" : "change";
    const commands = {
      [activationEvent]: {
        action: control.action || changeAction,
        target: control.target,
      },
    };
    if (control.context !== false && contextAction) commands.context = {
      action: contextAction,
      target: control.contextTarget || {
        address: control.address,
        defaultValue: control.defaultValue,
      },
    };
    if (control.kind === "markdown" && control.styleAction) commands.style = {
      action: control.styleAction,
      target: control.styleTarget,
    };
    nodes.push({
      id: control.id,
      type: nodeTypeForParameterKind(control.kind),
      parent: rootId,
      slot: control.id,
      stateAddress: control.address,
      inputs: control.inputs,
      commands,
    });
  }
  return nodes;
}

export function normalizeParameterControl(control = {}, index = 0) {
  const kind = normalizeKind(control.kind || control.type);
  const id = safeId(control.id || `parameter-${index}`);
  const inputs = {
    label: String(control.label || control.id || "Parameter"),
    value: control.value,
    disabled: control.disabled === true,
    labelHidden: control.labelHidden === true,
    presentation: "parameter",
    significant: control.significant === true,
  };
  if (kind === "number") Object.assign(inputs, {
    min: finite(control.min, 0),
    max: finite(control.max, 1),
    step: positive(control.step, 0.01),
    scale: control.scale === "log" ? "log" : "linear",
    precision: Number.isInteger(Number(control.precision)) ? Number(control.precision) : undefined,
    suffix: String(control.suffix || ""),
    valueVisible: control.valueVisible !== false,
    format: control.format,
  });
  if (kind === "range") Object.assign(inputs, {
    value: {
      min: finite(control.value?.min, finite(control.min, 0)),
      max: finite(control.value?.max, finite(control.max, 1)),
    },
    min: finite(control.min, 0),
    max: finite(control.max, 1),
    step: positive(control.step, 0.01),
    minStep: positive(control.minStep, positive(control.step, 0.01)),
    maxStep: positive(control.maxStep, positive(control.step, 0.01)),
    display: String(control.display || "number"),
    precision: Number.isInteger(Number(control.precision)) ? Number(control.precision) : undefined,
    suffix: String(control.suffix || ""),
    rangeKind: String(control.rangeKind || "plain"),
  });
  if (kind === "enum") inputs.options = control.options || [];
  if (kind === "text") Object.assign(inputs, {
    multiline: control.multiline === true,
    commitMode: control.commitMode,
  });
  if (kind === "markdown") inputs.styleControls = control.styleControls || [];
  if (kind === "event") Object.assign(inputs, {
    buttonLabel: String(control.buttonLabel || control.label || control.id || "Trigger"),
    icon: String(control.icon || ""),
    commandPayload: control.commandPayload,
  });
  return Object.freeze({
    id,
    kind,
    address: String(control.address || ""),
    action: String(control.action || ""),
    target: control.target && typeof control.target === "object" ? control.target : null,
    context: control.context !== false,
    contextTarget: control.contextTarget && typeof control.contextTarget === "object" ? control.contextTarget : null,
    styleAction: String(control.styleAction || ""),
    styleTarget: control.styleTarget && typeof control.styleTarget === "object" ? control.styleTarget : null,
    defaultValue: control.defaultValue,
    inputs: Object.freeze(inputs),
  });
}

function nodeTypeForParameterKind(kind) {
  if (kind === "boolean") return ToggleNode.id;
  if (kind === "enum") return SelectUiNode.id;
  if (kind === "color") return ColorPickerNode.id;
  if (kind === "range") return RangeUiNode.id;
  if (kind === "markdown") return MarkdownInputNode.id;
  if (kind === "text") return TextInputNode.id;
  if (kind === "event") return ButtonNode.id;
  return SliderUiNode.id;
}

function normalizeKind(value) {
  const kind = String(value || "number");
  return ["number", "boolean", "enum", "color", "text", "event", "range", "markdown"].includes(kind) ? kind : "number";
}

function safeId(value) {
  return String(value || "parameter").replace(/[^a-zA-Z0-9_-]+/g, "-");
}

function finite(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function positive(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function requiredText(value, error) {
  const text = String(value || "").trim();
  if (!text) throw new Error(error);
  return text;
}
