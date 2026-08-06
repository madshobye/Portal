import { defineUiNode, UI_COMMAND_PHASES } from "../ui-node.js";
import { presentationClassNames } from "../presentation.js";

export const ButtonNode = controlDefinition({
  id: "core.ui.button",
  name: "Button",
  description: "Semantic action button with private DOM and one activate event.",
  kind: "button",
  events: ["activate", "context"],
});

export const ToggleNode = controlDefinition({
  id: "core.ui.toggle",
  name: "Toggle",
  description: "Boolean control with unified pressed state and change semantics.",
  kind: "toggle",
  valueType: "boolean",
});

export const SliderUiNode = controlDefinition({
  id: "core.ui.slider",
  name: "Slider UI",
  description: "Numeric DOM slider with change and commit phases.",
  kind: "slider",
  valueType: "number",
});

export const NumberInputNode = controlDefinition({
  id: "core.ui.number-input",
  name: "Number input",
  description: "Constrained numeric input with change and commit phases.",
  kind: "number",
  valueType: "number",
});

export const SelectUiNode = controlDefinition({
  id: "core.ui.select",
  name: "Select UI",
  description: "Option selector that emits semantic values rather than DOM events.",
  kind: "select",
  valueType: "any",
});

export const TextInputNode = controlDefinition({
  id: "core.ui.text-input",
  name: "Text input",
  description: "Single or multiline text editor with change and commit phases.",
  kind: "text",
  valueType: "string",
});

export const ColorPickerNode = controlDefinition({
  id: "core.ui.color-picker",
  name: "Color picker",
  description: "RGBA color control with one normalized hexadecimal value contract.",
  kind: "color",
  valueType: "string",
});

export const RangeUiNode = defineUiNode({
  id: "core.ui.range",
  name: "Range UI",
  version: "0.1.0",
  description: "Atomic two-ended numeric range with constrained crossing, formatted values, and change/commit phases.",
  inlets: {
    value: { type: "any", optional: true },
    label: { type: "string", optional: true },
    disabled: { type: "boolean", optional: true },
    min: { type: "number", optional: true },
    max: { type: "number", optional: true },
    step: { type: "number", optional: true },
    minStep: { type: "number", optional: true },
    maxStep: { type: "number", optional: true },
    display: { type: "string", optional: true },
    precision: { type: "number", optional: true },
    suffix: { type: "string", optional: true },
    valueVisible: { type: "boolean", optional: true },
    rangeKind: { type: "string", optional: true },
    presentation: { type: "string", optional: true },
    significant: { type: "boolean", optional: true },
  },
  outlets: {
    change: { type: "event", optional: true },
    context: { type: "event", optional: true },
  },
  events: ["change", "context"],
  control: "range",
  capabilities: ["ui-control", "ui-range", "atomic-paired-value"],
  factory: createRangeControlInstance,
});

export const UI_CONTROL_NODE_DEFINITIONS = Object.freeze([
  ButtonNode,
  ToggleNode,
  SliderUiNode,
  NumberInputNode,
  SelectUiNode,
  TextInputNode,
  ColorPickerNode,
  RangeUiNode,
]);

function controlDefinition({ id, name, description, kind, valueType = "any", events = ["change", "context"] }) {
  return defineUiNode({
    id,
    name,
    version: "0.1.0",
    description,
    inlets: {
      value: { type: valueType, optional: true },
      label: { type: "string", optional: true },
      disabled: { type: "boolean", optional: true },
      options: { type: "any", optional: true },
      min: { type: "number", optional: true },
      max: { type: "number", optional: true },
      step: { type: "number", optional: true },
      scale: { type: "string", optional: true },
      precision: { type: "number", optional: true },
      suffix: { type: "string", optional: true },
      format: { type: "any", optional: true },
      commandPayload: { type: "any", optional: true },
      labelHidden: { type: "boolean", optional: true },
      iconOnly: { type: "boolean", optional: true },
      hidden: { type: "boolean", optional: true },
      icon: { type: "string", optional: true },
      commitMode: { type: "string", optional: true },
      presentation: { type: "string", optional: true },
      significant: { type: "boolean", optional: true },
    },
    outlets: Object.fromEntries(events.map((event) => [event, { type: "event", optional: true }])),
    events,
    control: kind,
    capabilities: ["ui-control", `ui-${kind}`],
    factory: (context) => createControlInstance(context, kind),
  });
}

export function createControlInstance({ id, host, inputs: initialInputs, stateAddress, document, emit }, kind) {
  // Keep construction inputs raw until the first update. Normalizing here and
  // again in mount turned nullable options such as precision into concrete
  // values (`Number(null) === 0`) and made fractional sliders display as
  // integers even though their semantic values remained correct.
  let inputs = initialInputs || {};
  let root = null;
  let control = null;
  let alpha = null;
  let output = null;
  let buttonIcon = null;
  let buttonText = null;
  let editing = false;
  let lastCommittedValue;

  function mount() {
    root = document.createElement("label");
    root.className = `ui-node-control ui-node-${kind}`;
    root.dataset.uiNodeOwned = kind;
    if (stateAddress) root.dataset.uiStateAddress = stateAddress;
    root.addEventListener("contextmenu", onContextMenu);
    const label = document.createElement("span");
    label.className = "ui-node-control-label";
    label.dataset.uiControlLabel = "";
    root.append(label);
    if (kind === "button" || kind === "toggle") {
      control = document.createElement("button");
      control.type = "button";
      buttonIcon = document.createElement("span");
      buttonIcon.className = "ui-node-button-icon";
      buttonIcon.setAttribute("aria-hidden", "true");
      buttonText = document.createElement("span");
      buttonText.className = "ui-node-button-text";
      control.append(buttonIcon, buttonText);
      control.addEventListener("click", onButtonClick);
    } else if (kind === "select") {
      control = document.createElement("select");
      control.addEventListener("change", onCommit);
    } else if (kind === "text" || kind === "number") {
      control = inputs.multiline ? document.createElement("textarea") : document.createElement("input");
      if (!inputs.multiline) control.type = kind === "number" ? "number" : "text";
      control.addEventListener("input", onInput);
      control.addEventListener("change", onCommit);
      control.addEventListener("keydown", onTextKeyDown);
    } else if (kind === "color") {
      const row = document.createElement("span");
      row.className = "ui-node-color-inputs";
      control = document.createElement("input");
      control.type = "color";
      alpha = document.createElement("input");
      alpha.type = "range";
      alpha.min = "0";
      alpha.max = "1";
      alpha.step = "0.01";
      control.addEventListener("input", onInput);
      control.addEventListener("change", onCommit);
      alpha.addEventListener("input", onInput);
      alpha.addEventListener("change", onCommit);
      row.append(alpha, control);
      root.append(row);
    } else {
      control = document.createElement("input");
      control.type = "range";
      output = document.createElement("output");
      output.className = "ui-node-control-value";
      output.dataset.uiControlValue = "";
      root.append(output);
      control.addEventListener("input", onInput);
      control.addEventListener("change", onCommit);
    }
    control.id = `ui-control-${id}`;
    if (kind !== "color") root.append(control);
    host.replaceChildren(root);
    update(inputs);
  }

  function update(nextInputs = {}) {
    inputs = normalizeControlInputs(nextInputs);
    root.querySelector("[data-ui-control-label]").textContent = inputs.label;
    root.classList.toggle("is-disabled", inputs.disabled);
    root.classList.toggle("is-label-hidden", inputs.labelHidden || kind === "button" || kind === "toggle");
    root.classList.toggle("is-significant", inputs.significant);
    if (inputs.presentation) root.dataset.uiPresentation = inputs.presentation;
    else delete root.dataset.uiPresentation;
    root.hidden = inputs.hidden;
    reconcileControlClassNames(root, inputs.presentation);
    control.disabled = inputs.disabled;
    control.setAttribute("aria-label", inputs.label);
    if (alpha) alpha.disabled = inputs.disabled;
    if (alpha) alpha.setAttribute("aria-label", `${inputs.label} alpha`);
    if (kind === "button") {
      updateButtonContent();
    } else if (kind === "toggle") {
      const enabled = inputs.value === true;
      updateButtonContent();
      control.setAttribute("aria-pressed", String(enabled));
      control.classList.toggle("is-enabled", enabled);
    } else if (kind === "select") {
      reconcileOptions(control, inputs.options, inputs.value, document);
    } else if (kind === "slider") {
      control.min = String(inputs.scale === "log" ? 0 : inputs.min);
      control.max = String(inputs.scale === "log" ? 1 : inputs.max);
      control.step = String(inputs.scale === "log" ? 0.001 : inputs.step);
      const position = sliderPosition(inputs.value, inputs);
      if (!valuesEqual(control.value, position)) control.value = String(position);
      output.textContent = formatControlValue(inputs.value, inputs);
    } else if (kind === "number") {
      control.min = String(inputs.min);
      control.max = String(inputs.max);
      control.step = String(inputs.step);
      if (!editing && !valuesEqual(control.value, inputs.value)) control.value = String(inputs.value ?? "");
    } else if (kind === "color") {
      const color = normalizeRgbaHex(inputs.value);
      control.value = color.slice(0, 7);
      alpha.value = String(parseInt(color.slice(7, 9), 16) / 255);
    } else if (!(kind === "text" && editing) && !valuesEqual(control.value, inputs.value)) {
      control.value = String(inputs.value ?? "");
    }
    if ((kind === "text" || kind === "number") && !editing) lastCommittedValue = inputs.value;
  }

  function updateButtonContent() {
    buttonIcon.textContent = inputs.icon;
    buttonIcon.hidden = !inputs.icon;
    buttonText.textContent = inputs.buttonLabel || inputs.label;
    buttonText.hidden = inputs.iconOnly;
  }

  function onButtonClick() {
    if (kind === "toggle") emit("change", { value: inputs.value !== true });
    else emit("activate", inputs.commandPayload);
  }

  function onContextMenu(event) {
    event.preventDefault();
    emit("context", { x: event.clientX, y: event.clientY });
  }

  function onInput() {
    if (kind === "text" || kind === "number") editing = true;
    if ((kind === "text" || kind === "number") && inputs.commitMode === "commit") return;
    const value = readValue();
    if (kind === "slider") output.textContent = formatControlValue(value, inputs);
    emit("change", { value }, UI_COMMAND_PHASES.CHANGE);
  }

  function onCommit() {
    editing = false;
    const value = readValue();
    if (kind === "slider") output.textContent = formatControlValue(value, inputs);
    if ((kind === "text" || kind === "number") && valuesEqual(lastCommittedValue, value)) return;
    if (kind === "text" || kind === "number") lastCommittedValue = value;
    emit("change", { value }, UI_COMMAND_PHASES.COMMIT);
  }

  function onTextKeyDown(event) {
    if ((kind === "text" && inputs.multiline) || event.key !== "Enter") return;
    event.preventDefault();
    onCommit();
    control.blur();
  }

  function readValue() {
    if (kind === "slider") return sliderValue(Number(control.value), inputs);
    if (kind === "number") {
      const numeric = Number(control.value);
      return Number.isFinite(numeric) ? Math.max(inputs.min, Math.min(inputs.max, numeric)) : inputs.value;
    }
    if (kind === "color") return rgbaHex(control.value, Number(alpha.value));
    return control.value;
  }

  function dispose() {
    control?.removeEventListener("click", onButtonClick);
    control?.removeEventListener("input", onInput);
    control?.removeEventListener("change", onCommit);
    control?.removeEventListener("keydown", onTextKeyDown);
    alpha?.removeEventListener("input", onInput);
    alpha?.removeEventListener("change", onCommit);
    root?.removeEventListener("contextmenu", onContextMenu);
    root?.remove();
    root = null;
    control = null;
    alpha = null;
    output = null;
    buttonIcon = null;
    buttonText = null;
    editing = false;
    lastCommittedValue = undefined;
  }

  return Object.freeze({ mount, update, dispose, element: () => root });
}

export function createRangeControlInstance({ id, host, inputs: initialInputs, stateAddress, document, emit }) {
  let inputs = normalizeRangeInputs(initialInputs);
  let root = null;
  let label = null;
  let minOutput = null;
  let maxOutput = null;
  let minInput = null;
  let maxInput = null;

  function mount() {
    root = document.createElement("div");
    root.className = "ui-node-control ui-node-range";
    root.dataset.uiNodeOwned = "range";
    if (stateAddress) root.dataset.uiStateAddress = stateAddress;
    const labels = document.createElement("div");
    labels.className = "ui-node-range-labels";
    label = document.createElement("span");
    const values = document.createElement("span");
    minOutput = document.createElement("strong");
    minOutput.dataset.uiRangeValue = "min";
    const separator = document.createElement("span");
    separator.textContent = "–";
    separator.setAttribute("aria-hidden", "true");
    maxOutput = document.createElement("strong");
    maxOutput.dataset.uiRangeValue = "max";
    values.append(minOutput, separator, maxOutput);
    labels.append(label, values);
    const slider = document.createElement("div");
    slider.className = "ui-node-range-slider";
    const track = document.createElement("div");
    track.className = "ui-node-range-track";
    track.setAttribute("aria-hidden", "true");
    minInput = rangeInput("min");
    maxInput = rangeInput("max");
    slider.append(track, minInput, maxInput);
    root.append(labels, slider);
    host.replaceChildren(root);
    update(inputs);
  }

  function rangeInput(role) {
    const element = document.createElement("input");
    element.type = "range";
    element.id = `ui-control-${id}-${role}`;
    element.dataset.uiRangeInput = role;
    element.addEventListener("input", onInput);
    element.addEventListener("change", onCommit);
    element.addEventListener("contextmenu", onContextMenu);
    return element;
  }

  function update(nextInputs = {}) {
    inputs = normalizeRangeInputs(nextInputs);
    reconcileControlClassNames(root, inputs.presentation);
    root.dataset.uiRangeKind = inputs.rangeKind;
    root.classList.toggle("is-disabled", inputs.disabled);
    root.classList.toggle("is-significant", inputs.significant);
    if (inputs.presentation) root.dataset.uiPresentation = inputs.presentation;
    else delete root.dataset.uiPresentation;
    label.textContent = inputs.label;
    for (const [role, element] of [["min", minInput], ["max", maxInput]]) {
      element.min = String(inputs.min);
      element.max = String(inputs.max);
      element.step = String(role === "min" ? inputs.minStep : inputs.maxStep);
      element.disabled = inputs.disabled;
      element.setAttribute("aria-label", `${inputs.label} ${role === "min" ? "minimum" : "maximum"}`);
    }
    sync(inputs.value);
  }

  function onInput(event) {
    change(event.currentTarget.dataset.uiRangeInput, UI_COMMAND_PHASES.CHANGE);
  }

  function onCommit(event) {
    change(event.currentTarget.dataset.uiRangeInput, UI_COMMAND_PHASES.COMMIT);
  }

  function change(active, phase) {
    let min = clampRangeNumber(Number(minInput.value), inputs.min, inputs.max);
    let max = clampRangeNumber(Number(maxInput.value), inputs.min, inputs.max);
    if (min > max) {
      if (active === "min") max = min;
      else min = max;
    }
    const value = { min, max };
    inputs = { ...inputs, value };
    sync(value);
    emit("change", { value, active }, phase);
  }

  function onContextMenu(event) {
    event.preventDefault();
    emit("context", {
      role: event.currentTarget.dataset.uiRangeInput,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function sync(value) {
    const min = clampRangeNumber(Number(value?.min), inputs.min, inputs.max);
    const max = clampRangeNumber(Number(value?.max), min, inputs.max);
    if (!valuesEqual(minInput.value, min)) minInput.value = String(min);
    if (!valuesEqual(maxInput.value, max)) maxInput.value = String(max);
    const span = Math.max(Number.EPSILON, inputs.max - inputs.min);
    root.style.setProperty("--ui-range-start", `${(((min - inputs.min) / span) * 100).toFixed(3)}%`);
    root.style.setProperty("--ui-range-end", `${(((max - inputs.min) / span) * 100).toFixed(3)}%`);
    minOutput.textContent = inputs.valueVisible ? formatRangeEndpoint(min, inputs, "min") : "—";
    maxOutput.textContent = inputs.valueVisible ? formatRangeEndpoint(max, inputs, "max") : "—";
  }

  function dispose() {
    for (const element of [minInput, maxInput]) {
      element?.removeEventListener("input", onInput);
      element?.removeEventListener("change", onCommit);
      element?.removeEventListener("contextmenu", onContextMenu);
    }
    root?.remove();
    root = null;
    label = null;
    minOutput = null;
    maxOutput = null;
    minInput = null;
    maxInput = null;
  }

  return Object.freeze({ mount, update, dispose, element: () => root });
}

function normalizeRangeInputs(source = {}) {
  const min = Number.isFinite(Number(source.min)) ? Number(source.min) : 0;
  const requestedMax = Number.isFinite(Number(source.max)) ? Number(source.max) : 1;
  const max = requestedMax > min ? requestedMax : min + 1;
  const step = positiveRangeStep(source.step, 0.01);
  const rawMin = clampRangeNumber(Number(source.value?.min), min, max);
  const rawMax = clampRangeNumber(Number(source.value?.max), min, max);
  return {
    value: Object.freeze({ min: Math.min(rawMin, rawMax), max: Math.max(rawMin, rawMax) }),
    label: String(source.label || "Range"),
    disabled: source.disabled === true,
    min,
    max,
    minStep: positiveRangeStep(source.minStep, step),
    maxStep: positiveRangeStep(source.maxStep, step),
    display: ["number", "degrees", "percent", "time"].includes(source.display) ? source.display : "number",
    precision: Number.isInteger(Number(source.precision))
      ? Math.max(0, Math.min(8, Number(source.precision)))
      : null,
    suffix: String(source.suffix || ""),
    valueVisible: source.valueVisible !== false,
    rangeKind: String(source.rangeKind || "plain"),
    presentation: String(source.presentation || ""),
    significant: source.significant === true,
  };
}

function formatRangeEndpoint(value, inputs, role) {
  if (inputs.display === "degrees") return `${Math.round(value)}°`;
  if (inputs.display === "percent") return `${Math.round(value * 100)}%`;
  if (inputs.display === "time") {
    const safe = Math.max(0, Number(value) || 0);
    const minutes = Math.floor(safe / 60);
    const seconds = Math.floor(safe % 60);
    const centiseconds = Math.floor((safe - Math.floor(safe)) * 100);
    return `${minutes}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
  }
  const step = role === "min" ? inputs.minStep : inputs.maxStep;
  return `${Number(value).toFixed(inputs.precision ?? stepPrecision(step))}${inputs.suffix}`;
}

function positiveRangeStep(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function clampRangeNumber(value, min, max) {
  const numeric = Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, numeric));
}

export function normalizeRgbaHex(value = "#000000ff") {
  const normalized = String(value || "").trim().toLowerCase();
  if (/^#[0-9a-f]{8}$/.test(normalized)) return normalized;
  if (/^#[0-9a-f]{6}$/.test(normalized)) return `${normalized}ff`;
  if (/^#[0-9a-f]{4}$/.test(normalized)) {
    return `#${[...normalized.slice(1)].map((part) => part.repeat(2)).join("")}`;
  }
  if (/^#[0-9a-f]{3}$/.test(normalized)) {
    return `#${[...normalized.slice(1)].map((part) => part.repeat(2)).join("")}ff`;
  }
  return "#000000ff";
}

export function rgbaHex(rgb = "#000000", alpha = 1) {
  const normalized = normalizeRgbaHex(rgb).slice(0, 7);
  const alphaByte = Math.round(Math.max(0, Math.min(1, Number(alpha) || 0)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${normalized}${alphaByte}`;
}

function normalizeControlInputs(inputs = {}) {
  return {
    value: inputs.value,
    label: String(inputs.label || "Control"),
    buttonLabel: String(inputs.buttonLabel || ""),
    disabled: inputs.disabled === true,
    multiline: inputs.multiline === true,
    options: normalizeOptions(inputs.options),
    min: Number.isFinite(Number(inputs.min)) ? Number(inputs.min) : 0,
    max: Number.isFinite(Number(inputs.max)) ? Number(inputs.max) : 1,
    step: Number.isFinite(Number(inputs.step)) && Number(inputs.step) > 0 ? Number(inputs.step) : 0.01,
    scale: inputs.scale === "log" && Number(inputs.min) > 0 && Number(inputs.max) > Number(inputs.min) ? "log" : "linear",
    precision: Number.isInteger(Number(inputs.precision))
      ? Math.max(0, Math.min(8, Number(inputs.precision)))
      : null,
    suffix: String(inputs.suffix || ""),
    format: normalizeNumberFormat(inputs.format),
    commandPayload: Object.freeze({
      ...(inputs.commandPayload && typeof inputs.commandPayload === "object" && !Array.isArray(inputs.commandPayload)
        ? inputs.commandPayload
        : {}),
    }),
    labelHidden: inputs.labelHidden === true,
    iconOnly: inputs.iconOnly === true,
    hidden: inputs.hidden === true,
    icon: String(inputs.icon || ""),
    commitMode: inputs.commitMode === "commit" ? "commit" : "change",
    presentation: String(inputs.presentation || ""),
    significant: inputs.significant === true,
  };
}

function reconcileControlClassNames(root, presentation = "") {
  const previous = String(root.dataset.uiControlClasses || "").split(/\s+/).filter(Boolean);
  if (previous.length) root.classList.remove(...previous);
  const next = presentationClassNames(presentation);
  if (next.length) root.classList.add(...next);
  root.dataset.uiControlClasses = next.join(" ");
}

function formatControlValue(value, inputs) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value ?? "");
  if (inputs.format.kind === "power") {
    const mapped = inputs.format.zeroAtMin && numeric <= inputs.min
      ? 0
      : inputs.format.base ** numeric;
    const mappedPrecision = Math.abs(mapped) < inputs.format.smallThreshold
      ? inputs.format.smallPrecision
      : inputs.format.precision;
    return `${numeric.toFixed(inputs.precision ?? stepPrecision(inputs.step))}${inputs.format.separator}${mapped.toFixed(mappedPrecision)}${inputs.format.suffix}`;
  }
  const scaled = inputs.format.kind === "percent" ? numeric * 100 : numeric;
  const precision = inputs.precision ?? stepPrecision(inputs.step);
  const suffix = inputs.suffix || (inputs.format.kind === "percent" ? "%" : "");
  return `${scaled.toFixed(precision)}${suffix}`;
}

function normalizeNumberFormat(format) {
  if (!format || typeof format !== "object" || Array.isArray(format)) {
    return Object.freeze({ kind: String(format || "number") === "percent" ? "percent" : "number" });
  }
  const kind = format.kind === "power" ? "power" : format.kind === "percent" ? "percent" : "number";
  if (kind !== "power") return Object.freeze({ kind });
  return Object.freeze({
    kind,
    base: Number.isFinite(Number(format.base)) && Number(format.base) > 0 ? Number(format.base) : 2,
    zeroAtMin: format.zeroAtMin === true,
    precision: Math.max(0, Math.min(8, Number.isInteger(Number(format.precision)) ? Number(format.precision) : 2)),
    smallPrecision: Math.max(0, Math.min(8, Number.isInteger(Number(format.smallPrecision)) ? Number(format.smallPrecision) : 3)),
    smallThreshold: Math.max(0, Number(format.smallThreshold) || 0.1),
    separator: String(format.separator ?? " · "),
    suffix: String(format.suffix ?? "×"),
  });
}

function stepPrecision(step) {
  const text = String(step || 1);
  return text.includes(".") ? Math.min(8, text.split(".")[1].length) : 0;
}

function sliderPosition(value, inputs) {
  const numeric = Math.max(inputs.min, Math.min(inputs.max, Number(value) || inputs.min));
  if (inputs.scale !== "log") return numeric;
  return Math.log(numeric / inputs.min) / Math.log(inputs.max / inputs.min);
}

function sliderValue(position, inputs) {
  if (inputs.scale !== "log") return position;
  const normalized = Math.max(0, Math.min(1, Number(position) || 0));
  const value = inputs.min * ((inputs.max / inputs.min) ** normalized);
  return Number(value.toFixed(12));
}

function normalizeOptions(options = []) {
  return (options || []).map((option) => {
    const source = typeof option === "object" ? option : { value: option, label: option };
    return Object.freeze({
      value: String(source.value ?? ""),
      label: String(source.label ?? source.value ?? ""),
      disabled: source.disabled === true,
    });
  });
}

function reconcileOptions(select, options, value, document) {
  const signature = JSON.stringify(options);
  if (select.dataset.optionsSignature !== signature) {
    select.replaceChildren(...options.map((option) => {
      const node = document.createElement("option");
      node.value = option.value;
      node.textContent = option.label;
      node.disabled = option.disabled;
      return node;
    }));
    select.dataset.optionsSignature = signature;
  }
  if (!valuesEqual(select.value, value)) select.value = String(value ?? "");
}

function valuesEqual(left, right) {
  return String(left ?? "") === String(right ?? "");
}
