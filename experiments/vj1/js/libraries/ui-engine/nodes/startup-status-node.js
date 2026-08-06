import { defineUiNode } from "../ui-node.js";
import { RetainedUiRuntime, UiNodeRegistry } from "../ui-runtime.js";

export const StartupStatusNode = defineUiNode({
  id: "core.ui.startup-status",
  name: "Startup Status",
  version: "0.1.0",
  description: "Application startup, compatibility, and failure status presentation.",
  inlets: {
    state: { type: "string", optional: true },
    title: { type: "string", optional: true },
    message: { type: "string", optional: true },
    detail: { type: "string", optional: true },
  },
  capabilities: ["ui-display", "ui-status"],
  factory: createStartupStatusInstance,
});

function createStartupStatusInstance({ host, inputs: initialInputs, document }) {
  let inputs = initialInputs || {};
  let root = null;
  let title = null;
  let message = null;
  let detail = null;
  let progress = null;

  function mount() {
    root = document.createElement("section");
    root.className = "app-startup-status";
    title = document.createElement("strong");
    message = document.createElement("span");
    detail = document.createElement("span");
    detail.className = "app-startup-detail";
    progress = document.createElement("span");
    progress.className = "app-startup-progress";
    progress.setAttribute("aria-hidden", "true");
    root.append(title, message, detail, progress);
    host.replaceChildren(root);
    update(inputs);
  }

  function update(nextInputs = {}) {
    inputs = nextInputs;
    const state = normalizeState(inputs.state);
    root.dataset.state = state;
    root.setAttribute("role", state === "error" || state === "unsupported" ? "alert" : "status");
    root.setAttribute("aria-live", state === "error" || state === "unsupported" ? "assertive" : "polite");
    title.textContent = String(inputs.title || "VJ1");
    message.textContent = String(inputs.message || "Starting…");
    detail.textContent = String(inputs.detail || "");
    detail.hidden = !inputs.detail;
    progress.hidden = state !== "loading";
  }

  function dispose() {
    root?.remove();
    root = null;
    title = null;
    message = null;
    detail = null;
    progress = null;
  }

  return Object.freeze({ mount, update, dispose, element: () => root });
}

function normalizeState(value) {
  return ["loading", "unsupported", "error"].includes(value) ? value : "loading";
}

export function createStartupStatusUi({
  hostId = "app",
  document = globalThis.document,
  inputs = {},
} = {}) {
  const host = document?.getElementById?.(String(hostId || "app"));
  if (!host) throw new Error(`UI_STARTUP_HOST_REQUIRED:${hostId}`);
  const scope = "core.ui.startup";
  const runtime = new RetainedUiRuntime({
    registry: new UiNodeRegistry([StartupStatusNode]),
    document,
  });
  runtime.mountNode({
    id: "startup-status",
    type: StartupStatusNode.id,
    version: StartupStatusNode.version,
    host,
    scope,
    inputs,
  });
  return Object.freeze({
    host,
    update(nextInputs = {}) {
      runtime.updateNode("startup-status", nextInputs, { scope });
    },
    dispose() {
      runtime.dispose();
    },
  });
}
