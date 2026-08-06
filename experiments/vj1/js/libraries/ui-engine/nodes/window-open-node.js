import { defineUiNode } from "../ui-node.js";

export const WindowOpenNode = defineUiNode({
  id: "core.ui.window-open",
  name: "Window open",
  version: "0.1.0",
  description: "Owns browser window creation behind semantic open requests.",
  inlets: { requests: { type: "array", optional: true } },
  outlets: { complete: { type: "event", optional: true }, blocked: { type: "event", optional: true } },
  events: ["complete", "blocked"],
  capabilities: ["window-open", "browser-resource-owner"],
  factory: createWindowOpenInstance,
});

export function createWindowOpenInstance({ inputs: initialInputs = {}, document, emit }) {
  let inputs = initialInputs;
  const handled = new Set();

  function mount() { processRequests(); }
  function update(nextInputs = {}) { inputs = nextInputs; processRequests(); }
  function processRequests() {
    for (const request of inputs.requests || []) {
      const id = String(request?.id || "");
      if (!id || handled.has(id)) continue;
      handled.add(id);
      const opened = document.defaultView?.open?.(String(request.url || ""), String(request.name || ""), String(request.features || ""));
      emit(opened ? "complete" : "blocked", { id, name: String(request.name || "") });
    }
  }
  return Object.freeze({ mount, update, dispose() { handled.clear(); } });
}
