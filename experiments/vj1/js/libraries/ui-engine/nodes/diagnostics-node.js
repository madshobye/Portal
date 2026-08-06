import { defineUiNode } from "../ui-node.js";

export const DiagnosticsNode = defineUiNode({
  id: "core.ui.diagnostics",
  name: "Diagnostics",
  version: "0.1.0",
  description: "Retained diagnostic summary and entry list with clear and copy commands.",
  inlets: {
    title: { type: "string", optional: true },
    level: { type: "string", optional: true },
    counts: { type: "record", optional: true },
    entries: { type: "array", optional: true },
  },
  outlets: {
    clear: { type: "event", optional: true },
    copy: { type: "event", optional: true },
  },
  capabilities: ["ui-display", "ui-diagnostics", "ui-list"],
  factory: createDiagnosticsInstance,
});

function createDiagnosticsInstance({ host, inputs: initialInputs, document, emit }) {
  let inputs = initialInputs || {};
  let root = null;
  let copy = null;
  let state = null;
  let list = null;
  let clear = null;
  let copyButton = null;

  function mount() {
    root = document.createElement("section");
    root.className = "ui-node-diagnostics";
    const header = document.createElement("header");
    copy = document.createElement("span");
    const title = document.createElement("strong");
    title.className = "ui-node-diagnostics-title";
    const detail = document.createElement("small");
    detail.className = "ui-node-diagnostics-detail";
    copy.append(title, detail);
    state = document.createElement("span");
    state.className = "ui-node-diagnostics-state";
    header.append(copy, state);
    list = document.createElement("ol");
    list.className = "ui-node-diagnostics-list";
    const actions = document.createElement("div");
    actions.className = "ui-node-diagnostics-actions";
    clear = commandButton("delete_sweep", "Clear", () => emit("clear"));
    copyButton = commandButton("content_copy", "Copy", () => emit("copy"));
    actions.append(clear, copyButton);
    root.append(header, list, actions);
    host.replaceChildren(root);
    update(inputs);
  }

  function commandButton(iconName, label, command) {
    const button = document.createElement("button");
    button.type = "button";
    const glyph = document.createElement("span");
    glyph.className = "material-symbols-rounded";
    glyph.textContent = iconName;
    const text = document.createElement("span");
    text.textContent = label;
    button.append(glyph, text);
    button.addEventListener("click", command);
    return button;
  }

  function update(nextInputs = {}) {
    inputs = nextInputs;
    const entries = Array.isArray(inputs.entries) ? inputs.entries : [];
    const counts = inputs.counts || {};
    const count = Math.max(0, Number(counts.info) || 0) + Math.max(0, Number(counts.warning) || 0) + Math.max(0, Number(counts.error) || 0);
    const level = ["ok", "info", "warning", "error"].includes(inputs.level) ? inputs.level : "ok";
    copy.querySelector("strong").textContent = String(inputs.title || "Diagnostics");
    copy.querySelector("small").textContent = entries.length
      ? `${count} captured entr${count === 1 ? "y" : "ies"}`
      : "No relevant console entries";
    state.dataset.level = level;
    state.replaceChildren(icon(diagnosticIcon(level)), document.createTextNode(` ${level === "ok" ? "OK" : level}`));
    const rows = entries.length
      ? entries.slice().reverse().map(entryRow)
      : [emptyRow()];
    list.replaceChildren(...rows);
    clear.disabled = !entries.length;
    copyButton.disabled = !entries.length;
  }

  function entryRow(entry) {
    const row = document.createElement("li");
    row.dataset.level = String(entry.level || "info");
    const header = document.createElement("header");
    const identity = document.createElement("span");
    identity.append(icon(diagnosticIcon(entry.level)));
    const level = document.createElement("strong");
    level.textContent = String(entry.level || "info");
    identity.append(level);
    if (entry.source) {
      const source = document.createElement("span");
      source.className = "ui-node-diagnostics-source";
      source.textContent = String(entry.source);
      identity.append(source);
    }
    const occurrence = document.createElement("span");
    const time = new Date(entry.lastAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    occurrence.textContent = `${time}${Number(entry.count) > 1 ? ` ×${entry.count}` : ""}`;
    header.append(identity, occurrence);
    const message = document.createElement("pre");
    message.textContent = String(entry.message || "");
    row.append(header, message);
    return row;
  }

  function emptyRow() {
    const row = document.createElement("li");
    row.className = "ui-node-diagnostics-empty";
    row.append(icon("check_circle"), document.createTextNode(" Everything looks OK."));
    return row;
  }

  function icon(name) {
    const glyph = document.createElement("span");
    glyph.className = "material-symbols-rounded";
    glyph.textContent = String(name || "info");
    return glyph;
  }

  function dispose() {
    root?.remove();
    root = null;
    copy = null;
    state = null;
    list = null;
    clear = null;
    copyButton = null;
  }

  return Object.freeze({ mount, update, dispose, element: () => root });
}

function diagnosticIcon(level) {
  if (level === "error") return "error";
  if (level === "warning") return "warning";
  if (level === "ok") return "check_circle";
  return "info";
}
