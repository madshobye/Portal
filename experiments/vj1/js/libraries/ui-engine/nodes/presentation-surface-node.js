import { defineUiNode } from "../ui-node.js";
import { RetainedUiRuntime, UiNodeRegistry } from "../ui-runtime.js";
import { FileDownloadNode } from "./file-download-node.js";

export const PresentationHudNode = defineUiNode({
  id: "core.ui.presentation-hud",
  name: "Presentation HUD",
  version: "0.1.0",
  description: "Renderer status and resolution diagnostics presented from structured data.",
  inlets: {
    model: { type: "record", optional: true },
    presentation: { type: "string", optional: true },
  },
  capabilities: ["ui-display", "ui-presentation-hud"],
  factory: createPresentationHudInstance,
});

export const OutputSurfaceNode = defineUiNode({
  id: "core.ui.output-surface",
  name: "Output surface",
  version: "0.1.0",
  description: "Standalone output shell with a stable renderer host, HUD slot, and failure state.",
  inlets: {
    errorText: { type: "string", optional: true },
  },
  capabilities: ["ui-container", "ui-output-surface", "retained-child-host"],
  factory: createOutputSurfaceInstance,
});

function createPresentationHudInstance({ host, inputs: initialInputs, document }) {
  let inputs = initialInputs || {};
  let root = null;

  function mount() {
    root = document.createElement("div");
    root.className = inputs.presentation === "preview" ? "preview-fps" : "output-fps";
    host.replaceChildren(root);
    update(inputs);
  }

  function update(nextInputs = {}) {
    inputs = nextInputs;
    if (root) root.className = inputs.presentation === "preview" ? "preview-fps" : "output-fps";
    render(inputs.model || {});
  }

  function present(model = {}) {
    inputs = { ...inputs, model };
    render(model);
  }

  function render(model = {}) {
    if (!root) return;
    root.classList.toggle("is-hidden", model.hidden === true);
    root.classList.toggle("is-loading", model.loading === true);
    root.classList.toggle("is-diagnostic", model.diagnostic === true);
    root.classList.toggle("is-chain-diagnostic", model.chainDiagnostic === true);
    const content = [];
    if (model.loading === true) content.push(element("span", "output-loading-dot", "", { hidden: true }));
    const summary = Array.isArray(model.summary) ? model.summary : [];
    if (model.chainDiagnostic === true) {
      const summaryElement = element("span", "output-hud-summary");
      appendTextItems(summaryElement, summary);
      content.push(summaryElement);
    } else if (summary.length) {
      for (const item of summary) content.push(textItem(item));
    }
    for (const line of Array.isArray(model.lines) ? model.lines : []) {
      const lineElement = element("span", "preview-debug-line");
      appendTextItems(lineElement, Array.isArray(line) ? line : [line]);
      content.push(lineElement);
    }
    const chains = Array.isArray(model.chains) ? model.chains : [];
    if (chains.length) {
      const list = element("span", "output-chain-list");
      for (const chain of chains) {
        const row = element("span", "output-chain-row");
        row.style.setProperty("--output-chain-depth", String(Math.max(0, Math.min(8, Number(chain.depth) || 0))));
        row.append(
          element("span", "output-chain-kind", chain.kind),
          element("span", "output-chain-name", chain.name),
          element("span", "output-chain-resolution", chain.resolution),
        );
        list.append(row);
      }
      content.push(list);
    }
    root.replaceChildren(...content);
  }

  function textItem(item = {}) {
    return element("span", String(item.presentation || ""), item.text);
  }

  function appendTextItems(parent, items = []) {
    for (const item of items) parent.append(textItem(item));
  }

  function element(tag, className = "", text = "", attributes = {}) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = String(text || "");
    if (attributes.hidden === true) node.setAttribute("aria-hidden", "true");
    return node;
  }

  function dispose() {
    root?.remove();
    root = null;
  }

  return Object.freeze({ mount, update, present, dispose, element: () => root });
}

function createOutputSurfaceInstance({ host, inputs: initialInputs, document }) {
  let inputs = initialInputs || {};
  let root = null;
  let hud = null;
  let error = null;
  let metrics = null;
  let system = null;

  function mount() {
    root = document.createElement("section");
    root.id = "output-stage";
    root.className = "output-stage";
    hud = document.createElement("div");
    hud.className = "ui-node-output-hud";
    error = document.createElement("div");
    error.className = "empty-preview";
    metrics = document.createElement("script");
    metrics.id = "vj1-runtime-metrics";
    metrics.type = "application/json";
    metrics.textContent = "[]";
    system = document.createElement("div");
    system.hidden = true;
    root.append(hud, error, metrics, system);
    host.replaceChildren(root);
    document.body?.classList?.add("output-client");
    update(inputs);
  }

  function update(nextInputs = {}) {
    inputs = nextInputs;
    const errorText = String(inputs.errorText || "");
    error.textContent = errorText;
    error.hidden = !errorText;
  }

  function setError(errorText = "") {
    update({ ...inputs, errorText });
  }

  function setMetrics(samples = []) {
    metrics.textContent = JSON.stringify(Array.isArray(samples) ? samples : []);
  }

  function slot(name) {
    return { stage: root, hud, error, system }[name] || null;
  }

  function dispose() {
    document.body?.classList?.remove("output-client");
    root?.remove();
    root = null;
    hud = null;
    error = null;
    metrics = null;
    system = null;
  }

  return Object.freeze({ mount, update, setError, setMetrics, dispose, slot, element: () => root });
}

export function createOutputSurfaceUi({ host, document = globalThis.document } = {}) {
  if (!host) throw new Error("UI_OUTPUT_SURFACE_HOST_REQUIRED");
  const scope = "core.ui.output-presentation";
  const runtime = new RetainedUiRuntime({
    registry: new UiNodeRegistry([OutputSurfaceNode, PresentationHudNode, FileDownloadNode]),
    document,
  });
  const surface = runtime.mountNode({
    id: "output-surface",
    type: OutputSurfaceNode.id,
    host,
    scope,
  });
  const hud = runtime.mountNode({
    id: "presentation-hud",
    type: PresentationHudNode.id,
    host: surface.slot("hud"),
    scope,
    inputs: { presentation: "output" },
  });
  runtime.mountNode({
    id: "file-download",
    type: FileDownloadNode.id,
    host: surface.slot("system"),
    scope,
  });
  let downloadSequence = 0;
  return Object.freeze({
    surface,
    stage: surface.slot("stage"),
    hud,
    setError(message = "") {
      surface.setError(message);
    },
    setMetrics(samples = []) {
      surface.setMetrics(samples);
    },
    download(request = {}) {
      runtime.updateNode("file-download", {
        request: { ...request, id: String(request.id || `output-download:${++downloadSequence}`) },
      }, { scope });
    },
    dispose() {
      runtime.dispose();
    },
  });
}
