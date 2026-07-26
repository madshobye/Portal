import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";

const PROJECT_RESTORE_PREFIXES = Object.freeze([
  "project-load", "project-open", "project-restore", "project-undo", "project-redo", "project-close",
]);

const STRUCTURAL_CHANGE_PREFIXES = Object.freeze([
  "add-component", "remove-component", "add-scene", "convert-component-to-scene",
  "add-chain-", "remove-chain-", "reorder-chain", "paste", "cut", "select-",
]);

export function createChangeEvent(change = "change") {
  const supplied = change && typeof change === "object" ? change : {};
  const reason = String(supplied.reason ?? change ?? "change");
  const parsed = parseReason(reason);
  const scope = supplied.scope || parsed.scope;
  const phase = supplied.phase || parsed.phase;
  const structural = supplied.structural ?? isStructuralChange(reason);
  const controlInvalidation = supplied.controlInvalidation ??
    controlInvalidationForPaths(supplied.changedPaths);
  return Object.freeze({
    ...parsed,
    ...supplied,
    reason,
    phase,
    topic: supplied.topic || parsed.topic,
    scope,
    history: supplied.history || historyPolicy(reason, scope, phase),
    ...(structural ? { structural: true } : {}),
    ...(controlInvalidation ? { controlInvalidation } : {}),
    projectRestore: supplied.projectRestore ?? parsed.projectRestore,
  });
}

export function controlInvalidationForPaths(paths = []) {
  const regions = new Set();
  let preview = "";
  let requiresRenderPatch = false;
  for (const rawPath of paths || []) {
    const path = String(rawPath || "");
    if (!path) continue;
    if (/^ui\.selectedChainItemId$/.test(path)) {
      regions.add("inspector");
      preview ||= "ui";
      continue;
    }
    if (/^ui\.selectedComponentId$/.test(path)) {
      regions.add("project-rail");
      regions.add("inspector");
      preview ||= "render";
      continue;
    }
    if (/^ui\.selectedSurfaceId$/.test(path)) {
      regions.add("project-selection");
      regions.add("inspector");
      preview ||= "ui";
      continue;
    }
    if (/^(components|media|mappings)\.\d+\.catalogMarker$/.test(path)) {
      regions.add("project-rail");
      continue;
    }
    if (/^components\.\d+\.name$/.test(path)) {
      regions.add("project-rail");
      regions.add("inspector");
      continue;
    }
    if (/^components\.\d+\./.test(path)) {
      regions.add("inspector");
      requiresRenderPatch = true;
      continue;
    }
    if (/^mappings\.\d+\.surfaces\.\d+\.enabled$/.test(path)) {
      regions.add("project-selection");
      regions.add("inspector");
      preview = "mapping";
    }
  }
  if (!regions.size && !preview) return null;
  return Object.freeze({
    regions: Object.freeze([...regions]),
    ...(preview ? { preview } : {}),
    ...(requiresRenderPatch ? { requiresRenderPatch: true } : {}),
  });
}

export class StateCommandEngine {
  constructor(commands = {}) {
    this.commands = new Map(Object.entries(commands));
  }

  register(name, execute) {
    const id = String(name || "").trim();
    if (!id || typeof execute !== "function") throw new Error("STATE_COMMAND_INVALID");
    this.commands.set(id, execute);
    return this;
  }

  has(name) {
    return this.commands.has(String(name || ""));
  }

  execute(name, payload, context = {}) {
    const id = String(name || "");
    const command = this.commands.get(id);
    if (!command) throw new Error(`STATE_COMMAND_UNKNOWN:${id}`);
    return command(payload, context);
  }
}

export const StateCommandNode = defineNode({
  id: "core.state.command-engine",
  name: "State Command Engine",
  version: "0.1.0",
  description: "Classifies and dispatches named state-changing commands without imposing a scheduler.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: { command: { type: "any", required: true } },
  outlets: { event: { type: "any" } },
  execution: { trigger: "input-change", domain: "main", pure: true },
  moduleBindings: { PROJECT_RESTORE_PREFIXES, STRUCTURAL_CHANGE_PREFIXES },
  parts: [
    {
      id: "change-command-policy",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      name: "Change command policy",
      exports: ["createChangeEvent", "StateCommandEngine"],
      source: [createChangeEvent, controlInvalidationForPaths, StateCommandEngine, isStructuralChange, historyPolicy, parseReason]
        .map((value) => value.toString()).join("\n\n"),
    },
    {
      id: "state-command-process",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      name: "State command process entry",
      export: "stateCommandNodeProcess",
      entry: "process",
      dependsOn: ["change-command-policy"],
      source: stateCommandNodeProcess.toString(),
    },
  ],
  capabilities: ["state-commands", "change-classification"],
  process: stateCommandNodeProcess,
});

export function stateCommandNodeProcess({ command } = {}) {
  return { event: createChangeEvent(command) };
}

function isStructuralChange(reason) {
  return STRUCTURAL_CHANGE_PREFIXES.some((prefix) => reason === prefix || reason.startsWith(prefix));
}

function historyPolicy(reason, scope, phase) {
  if (scope !== "project" || phase !== "commit") return "none";
  if (PROJECT_RESTORE_PREFIXES.some((prefix) => reason.startsWith(prefix))) return "none";
  // Selection chooses an editor projection; it never changes authored
  // project truth. Keep the prefix rule here as a final boundary even when a
  // caller has not yet been migrated to emit an explicit UI-scoped event.
  if (reason.startsWith("select-") || ["workspace", "component-thumbnail"].includes(reason)) return "none";
  return "record";
}

function parseReason(reason) {
  const separator = reason.indexOf(":");
  const prefix = separator >= 0 ? reason.slice(0, separator) : "";
  const topic = separator >= 0 ? reason.slice(separator + 1) : reason;
  const phase = ["edit", "scrub", "color"].includes(prefix) ? prefix : "commit";
  const scope = prefix === "live" || (phase === "scrub" && topic === "live") ? "live" : "project";
  return {
    phase,
    topic,
    scope,
    projectRestore: PROJECT_RESTORE_PREFIXES.some((candidate) => reason.startsWith(candidate)),
  };
}
