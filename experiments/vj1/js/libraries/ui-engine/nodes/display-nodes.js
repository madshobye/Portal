import { defineUiNode } from "../ui-node.js";
import { presentationClassNames } from "../presentation.js";

export const TextNode = defineUiNode({
  id: "core.ui.text",
  name: "Text",
  version: "0.1.0",
  description: "Semantic retained text for labels, notes, empty states, and status presentation.",
  inlets: {
    text: { type: "string", optional: true },
    tone: { type: "string", optional: true },
    role: { type: "string", optional: true },
    presentation: { type: "string", optional: true },
  },
  outlets: {},
  capabilities: ["ui-display", "ui-text"],
  factory: createTextInstance,
});

export const UI_DISPLAY_NODE_DEFINITIONS = Object.freeze([TextNode]);

function createTextInstance({ host, inputs: initialInputs, document }) {
  let inputs = initialInputs || {};
  let root = null;

  function mount() {
    root = document.createElement("div");
    root.className = "ui-node-text-display";
    root.dataset.uiNodeOwned = "text";
    host.replaceChildren(root);
    update(inputs);
  }

  function update(nextInputs = {}) {
    inputs = nextInputs;
    root.textContent = String(inputs.text || "");
    root.className = ["ui-node-text-display", ...presentationClassNames(inputs.presentation)].join(" ");
    root.dataset.uiPresentation = String(inputs.presentation || "default");
    root.dataset.tone = ["normal", "muted", "warning", "error", "success"].includes(inputs.tone)
      ? inputs.tone
      : "normal";
    if (inputs.role) root.setAttribute("role", String(inputs.role));
    else root.removeAttribute("role");
  }

  function dispose() {
    root?.remove();
    root = null;
  }

  return Object.freeze({ mount, update, dispose, element: () => root });
}
