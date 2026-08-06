import { defineUiNode, UI_COMMAND_PHASES } from "../ui-node.js";
import { presentationClassNames } from "../presentation.js";

export const ChoiceGroupNode = defineUiNode({
  id: "core.ui.choice-group",
  name: "Choice Group",
  version: "0.1.0",
  description: "Exclusive finite choice control with one selected value and semantic selection events.",
  inlets: {
    label: { type: "string", optional: true },
    items: { type: "array", required: true },
    selectedId: { type: "string", optional: true },
    disabled: { type: "boolean", optional: true },
    presentation: { type: "string", optional: true },
  },
  outlets: { select: { type: "event", optional: true } },
  events: ["select"],
  capabilities: ["ui-control", "ui-choice-group", "keyboard-navigation"],
  factory: createChoiceGroupInstance,
});

function createChoiceGroupInstance({ host, inputs: initialInputs, document, emit }) {
  let inputs = initialInputs || {};
  let root = null;
  const buttons = new Map();
  let presentationClasses = [];

  function mount() {
    root = document.createElement("div");
    root.className = "ui-node-choice-group";
    root.setAttribute("role", "group");
    root.addEventListener("click", onClick);
    root.addEventListener("keydown", onKeyDown);
    host.replaceChildren(root);
    update(inputs);
  }

  function update(nextInputs = {}) {
    inputs = nextInputs || {};
    root.setAttribute("aria-label", String(inputs.label || "Options"));
    root.classList.remove(...presentationClasses);
    presentationClasses = presentationClassNames(inputs.presentation);
    root.classList.add(...presentationClasses);
    if (inputs.presentation) root.dataset.uiPresentation = String(inputs.presentation);
    else delete root.dataset.uiPresentation;
    const items = normalizedItems(inputs.items);
    const retained = new Set(items.map((item) => item.id));
    for (const [id, button] of buttons) {
      if (retained.has(id)) continue;
      button.remove();
      buttons.delete(id);
    }
    for (const item of items) {
      let button = buttons.get(item.id);
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.dataset.uiChoiceId = item.id;
        const icon = document.createElement("span");
        icon.className = "ui-node-choice-icon";
        icon.setAttribute("aria-hidden", "true");
        const label = document.createElement("span");
        label.className = "ui-node-choice-label";
        button.append(icon, label);
        buttons.set(item.id, button);
      }
      button.querySelector(".ui-node-choice-icon").textContent = item.icon;
      button.querySelector(".ui-node-choice-icon").hidden = !item.icon;
      button.querySelector(".ui-node-choice-label").textContent = item.label;
      button.querySelector(".ui-node-choice-label").hidden = item.iconOnly;
      button.title = item.title || item.label;
      button.setAttribute("aria-label", item.label);
      button.setAttribute("aria-pressed", String(item.id === String(inputs.selectedId || "")));
      button.disabled = inputs.disabled === true || item.disabled;
      button.dataset.uiChoiceValue = JSON.stringify(item.value);
      root.append(button);
    }
  }

  function onClick(event) {
    const button = event.target.closest?.("button[data-ui-choice-id]");
    if (!button || !root.contains(button) || button.disabled) return;
    selectButton(button);
  }

  function onKeyDown(event) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    const enabled = [...buttons.values()].filter((button) => !button.disabled);
    if (!enabled.length) return;
    const current = enabled.indexOf(event.target.closest?.("button[data-ui-choice-id]"));
    const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
    const next = enabled[(Math.max(0, current) + direction + enabled.length) % enabled.length];
    event.preventDefault();
    next.focus();
    selectButton(next);
  }

  function selectButton(button) {
    const id = String(button.dataset.uiChoiceId || "");
    let value = id;
    try { value = JSON.parse(button.dataset.uiChoiceValue); } catch {}
    emit("select", { id, value }, UI_COMMAND_PHASES.COMMIT);
  }

  function dispose() {
    root?.removeEventListener("click", onClick);
    root?.removeEventListener("keydown", onKeyDown);
    root?.remove();
    root = null;
    buttons.clear();
  }

  return Object.freeze({ mount, update, dispose, element: () => root });
}

function normalizedItems(items = []) {
  return (Array.isArray(items) ? items : []).map((item, index) => {
    const source = typeof item === "object" && item !== null ? item : { id: item, label: item };
    const value = source.value ?? source.id ?? index;
    return Object.freeze({
      id: String(source.id ?? value),
      value,
      label: String(source.label ?? value),
      title: String(source.title || ""),
      icon: String(source.icon || ""),
      iconOnly: source.iconOnly === true,
      disabled: source.disabled === true,
    });
  });
}
