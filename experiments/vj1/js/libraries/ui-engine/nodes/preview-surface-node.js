import { defineUiNode } from "../ui-node.js";

export const PreviewSurfaceNode = defineUiNode({
  id: "core.ui.preview-surface",
  name: "Preview surface",
  version: "0.1.0",
  description: "Retained presentation surface with stable renderer, tools, HUD, and empty-state slots.",
  inlets: {
    empty: { type: "boolean", optional: true },
    emptyText: { type: "string", optional: true },
    errorText: { type: "string", optional: true },
  },
  outlets: {},
  capabilities: ["ui-container", "ui-preview-surface", "retained-child-host"],
  factory: createPreviewSurfaceInstance,
});

function createPreviewSurfaceInstance({ host, inputs: initialInputs, document }) {
  let inputs = initialInputs || {};
  let root = null;
  let frame = null;
  let stage = null;
  let tools = null;
  let empty = null;

  function mount() {
    root = document.createElement("section");
    root.className = "ui-node-preview-surface studio-stage";
    frame = document.createElement("div");
    frame.className = "ui-node-preview-frame visual-frame";
    stage = document.createElement("div");
    stage.className = "ui-node-preview-stage embedded-preview-stage";
    tools = document.createElement("div");
    tools.className = "ui-node-preview-tools";
    empty = document.createElement("div");
    empty.className = "ui-node-preview-empty";
    frame.append(stage, tools, empty);
    root.append(frame);
    host.replaceChildren(root);
    update(inputs);
  }

  function update(nextInputs = {}) {
    inputs = nextInputs;
    if (!frame || !stage || !tools || !empty) return;
    const isEmpty = inputs.empty === true || !!inputs.errorText;
    frame.classList.toggle("is-empty", isEmpty);
    stage.hidden = isEmpty;
    tools.hidden = isEmpty;
    empty.hidden = !isEmpty;
    empty.textContent = String(inputs.errorText || inputs.emptyText || "Open a project to begin");
  }

  function setPaused(paused = false) {
    frame?.classList?.toggle("is-paused", paused === true);
  }

  function setError(errorText = "") {
    update({ ...inputs, errorText });
  }

  function slot(name) {
    return { frame, stage, tools, empty }[name] || null;
  }

  function dispose() {
    root?.remove();
    root = null;
    frame = null;
    stage = null;
    tools = null;
    empty = null;
  }

  return Object.freeze({ mount, update, setPaused, setError, dispose, slot, element: () => root });
}
