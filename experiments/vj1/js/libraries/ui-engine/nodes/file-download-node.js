import { defineUiNode } from "../ui-node.js";

export const FileDownloadNode = defineUiNode({
  id: "core.ui.file-download",
  name: "File download",
  version: "0.1.0",
  description: "Owns browser file-download mechanics behind a semantic request inlet.",
  inlets: { request: { type: "record", optional: true } },
  outlets: { complete: { type: "event", optional: true }, error: { type: "event", optional: true } },
  events: ["complete", "error"],
  capabilities: ["file-download", "browser-resource-owner"],
  factory: createFileDownloadInstance,
});

export function createFileDownloadInstance({ inputs: initialInputs = {}, document, emit }) {
  let inputs = initialInputs;
  let completedId = "";

  function mount() {
    processRequest();
  }

  function update(nextInputs = {}) {
    inputs = nextInputs;
    processRequest();
  }

  function processRequest() {
    const request = inputs.request || null;
    const id = String(request?.id || "");
    if (!id || id === completedId) return;
    completedId = id;
    try {
      const blob = new Blob([String(request.text || "")], { type: String(request.mime || "application/octet-stream") });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = String(request.filename || "download");
      link.click();
      globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
      emit("complete", { id, filename: link.download });
    } catch (error) {
      emit("error", { id, message: error?.message || String(error) });
    }
  }

  return Object.freeze({ mount, update, dispose() {} });
}
