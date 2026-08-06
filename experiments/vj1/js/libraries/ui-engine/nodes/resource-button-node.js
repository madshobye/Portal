import { defineUiNode } from "../ui-node.js";
import { presentationClassNames } from "../presentation.js";

export const ResourceButtonNode = defineUiNode({
  id: "core.ui.resource-button",
  name: "Resource Button",
  version: "0.1.0",
  description: "Labeled resource-value control with optional media, detail, and one semantic activation command.",
  inlets: {
    label: { type: "string", optional: true },
    valueLabel: { type: "string", optional: true },
    detail: { type: "string", optional: true },
    icon: { type: "string", optional: true },
    media: { type: "any", optional: true },
    accessibleLabel: { type: "string", optional: true },
    disabled: { type: "boolean", optional: true },
    hidden: { type: "boolean", optional: true },
    commandPayload: { type: "any", optional: true },
    presentation: { type: "string", optional: true },
  },
  outlets: { activate: { type: "event", optional: true } },
  events: ["activate"],
  capabilities: ["ui-control", "ui-resource-button"],
  factory: createResourceButtonInstance,
});

function createResourceButtonInstance({ host, inputs: initialInputs, document, emit }) {
  let inputs = initialInputs || {};
  let root = null;
  let caption = null;
  let button = null;
  let icon = null;
  let image = null;
  let value = null;
  let detail = null;
  let presentationClasses = [];

  function mount() {
    root = document.createElement("div");
    root.className = "ui-node-resource-button";
    root.dataset.uiNodeOwned = "resource-button";
    caption = document.createElement("span");
    caption.className = "ui-node-resource-caption";
    button = document.createElement("button");
    button.type = "button";
    icon = document.createElement("span");
    icon.className = "ui-node-resource-icon";
    icon.setAttribute("aria-hidden", "true");
    image = document.createElement("img");
    image.className = "ui-node-resource-media";
    image.alt = "";
    const copy = document.createElement("span");
    copy.className = "ui-node-resource-copy";
    value = document.createElement("strong");
    detail = document.createElement("small");
    copy.append(value, detail);
    const chevron = document.createElement("span");
    chevron.className = "ui-node-resource-chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "chevron_right";
    button.append(icon, image, copy, chevron);
    button.addEventListener("click", onActivate);
    root.append(caption, button);
    host.replaceChildren(root);
    update(inputs);
  }

  function update(nextInputs = {}) {
    inputs = nextInputs || {};
    root.hidden = inputs.hidden === true;
    caption.textContent = String(inputs.label || "");
    caption.hidden = !inputs.label;
    value.textContent = String(inputs.valueLabel || inputs.label || "Choose resource");
    detail.textContent = String(inputs.detail || "");
    detail.hidden = !inputs.detail;
    icon.textContent = String(inputs.icon || "");
    const src = String(inputs.media?.src || "");
    image.hidden = !src;
    icon.hidden = !!src || !inputs.icon;
    if (src && image.src !== src) image.src = src;
    if (!src) image.removeAttribute("src");
    button.disabled = inputs.disabled === true;
    button.setAttribute("aria-label", String(inputs.accessibleLabel || inputs.label || inputs.valueLabel || "Choose resource"));
    root.classList.remove(...presentationClasses);
    presentationClasses = presentationClassNames(inputs.presentation);
    root.classList.add(...presentationClasses);
    if (inputs.presentation) root.dataset.uiPresentation = String(inputs.presentation);
    else delete root.dataset.uiPresentation;
  }

  function onActivate() {
    if (button.disabled) return;
    emit("activate", inputs.commandPayload || {});
  }

  function dispose() {
    button?.removeEventListener("click", onActivate);
    root?.remove();
    root = null;
    caption = null;
    button = null;
    icon = null;
    image = null;
    value = null;
    detail = null;
    presentationClasses = [];
  }

  return Object.freeze({ mount, update, dispose, element: () => root });
}
