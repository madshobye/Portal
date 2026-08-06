import { defineUiNode, UI_COMMAND_PHASES } from "../ui-node.js";

export const NodeDefinitionEditorNode = defineUiNode({
  id: "core.ui.node-definition-editor",
  name: "Node Definition Editor",
  version: "0.1.0",
  description: "Reusable semantic node-definition inspector and source editor.",
  inlets: { model: { type: "any", optional: true } },
  outlets: {
    save: { type: "event", optional: true },
    reset: { type: "event", optional: true },
  },
  events: ["save", "reset"],
  capabilities: ["ui-editor", "ui-node-definition-editor"],
  factory: createNodeDefinitionEditorInstance,
});

function createNodeDefinitionEditorInstance({ host, inputs: initialInputs, document, emit }) {
  let inputs = initialInputs || {};
  let root = null;

  function mount() {
    root = document.createElement("div");
    root.className = "node-editor-projection ui-node-definition-editor";
    root.dataset.uiNodeOwned = "node-definition-editor";
    root.addEventListener("click", onClick);
    host.replaceChildren(root);
    update(inputs);
  }

  function update(nextInputs = {}) {
    inputs = nextInputs;
    const model = inputs.model;
    if (!model) {
      root.innerHTML = '<p class="soft-note">Select a node</p>';
      return;
    }
    root.innerHTML = `
      <div class="node-editor-identity">
        ${icon(model.icon)}
        <span><strong>${esc(model.name)}</strong><small>${esc(model.id)} · v${esc(model.version)}${model.forked ? " · project version" : ""}</small></span>
      </div>
      <p class="node-editor-description">${esc(model.description)}</p>
      <p class="soft-note">${esc(model.activation)}</p>
      ${(model.sections || []).map(sectionTemplate).join("")}
      ${(model.sources || []).map(sourceTemplate).join("")}
      <details class="node-editor-section">
        <summary>Version and capabilities</summary>
        <div class="node-editor-tags">${(model.capabilities || []).map((value) => `<span>${esc(value)}</span>`).join("") || "<span>none</span>"}</div>
      </details>
      ${model.editable ? `
        <div class="node-editor-actions">
          <button type="button" data-ui-node-editor-action="save">${esc(model.saveLabel)}</button>
          ${model.resetLabel ? `<button type="button" class="secondary" data-ui-node-editor-action="reset">${esc(model.resetLabel)}</button>` : ""}
        </div>
        <p class="soft-note">${esc(model.note)}</p>` : ""}`;
  }

  function onClick(event) {
    const button = event.target.closest?.("[data-ui-node-editor-action]");
    if (!button || !root.contains(button)) return;
    const model = inputs.model || {};
    const common = { baseId: String(model.baseId || ""), baseVersion: String(model.baseVersion || "") };
    if (button.dataset.uiNodeEditorAction === "reset") {
      emit("reset", common, UI_COMMAND_PHASES.COMMIT);
      return;
    }
    const sources = {};
    for (const input of root.querySelectorAll("[data-ui-node-part-source]")) {
      if (!input.readOnly) sources[String(input.dataset.uiNodePartSource || "")] = input.value;
    }
    emit("save", { ...common, sources }, UI_COMMAND_PHASES.COMMIT);
  }

  function dispose() {
    root?.removeEventListener("click", onClick);
    root?.remove();
    root = null;
  }

  return Object.freeze({ mount, update, dispose, element: () => root });
}

function sectionTemplate(section = {}) {
  return `<details class="node-editor-section">
    <summary>${esc(section.label)}</summary>
    <div class="node-editor-port-list">${(section.rows || []).map((row) => `<div><strong>${esc(row.label)}</strong><span>${esc(row.value)}</span></div>`).join("") || `<div><span>${esc(section.emptyText || "None")}</span></div>`}</div>
    ${(section.connections || []).map((connection) => `<code>${esc(connection)}</code>`).join("")}
  </details>`;
}

function sourceTemplate(source = {}) {
  return `<details class="node-editor-section node-editor-source"${source.open ? " open" : ""}>
    <summary>${esc(source.label)}</summary>
    <textarea spellcheck="false" data-ui-node-part-source="${esc(source.id)}"${source.readOnly ? " readonly" : ""}>${esc(source.value)}</textarea>
  </details>`;
}

function icon(name) {
  return `<span class="material-symbols-rounded" aria-hidden="true">${esc(name)}</span>`;
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
