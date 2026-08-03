import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";

const PROJECT_RESTORE_PREFIXES = Object.freeze([
  "project-load", "project-open", "project-restore", "project-undo", "project-redo", "project-close",
]);

const STRUCTURAL_CHANGE_PREFIXES = Object.freeze([
  "add-component", "remove-component", "add-scene", "convert-component-to-scene",
  "add-chain-", "remove-chain-", "reorder-chain", "paste", "cut", "select-",
]);

const METRIC_REASONS = Object.freeze([
  "output-metrics", "preview-metrics", "project-history", "project-autosave", "project-autosave-error",
]);

const OUTPUT_SILENT_REASONS = Object.freeze([
  "init", "view", "project-undo", "project-redo", ...METRIC_REASONS,
]);

const LIVE_PROGRAM_PREVIEW_REASONS = Object.freeze([
  "live:scene",
  "live:target",
  "live:surface-patch-clear",
  "live:overall-component-clear",
  "live:surface-visibility",
  "live:transition-advance",
]);

export function createChangeEvent(change = "change") {
  const supplied = change && typeof change === "object" ? change : {};
  for (const field of ["scope", "phase", "topic", "history", "projectRestore", "controlInvalidation", "structural"]) {
    if (Object.hasOwn(supplied, field)) throw new Error(`STATE_CHANGE_LEGACY_FIELD:${field}`);
  }
  const reason = String(supplied.reason ?? change ?? "change");
  const parsed = parseReason(reason);
  const command = Object.freeze({
    domain: supplied.command?.domain || parsed.domain,
    phase: supplied.command?.phase || parsed.phase,
    topic: supplied.command?.topic || parsed.topic,
  });
  const structural = supplied.effects?.graph?.mode
    ? supplied.effects.graph.mode === "recompile"
    : isStructuralChange(reason);
  const control = supplied.effects?.control ??
    (command.domain === "assets"
      ? assetCatalogControlInvalidation()
      : controlInvalidationForPaths(supplied.changedPaths));
  const restoresProject = supplied.effects?.lifecycle?.project
    ? supplied.effects.lifecycle.project === "restore"
    : parsed.restoresProject;
  const history = supplied.effects?.persistence?.history ??
    historyPolicy(reason, command.domain, command.phase) === "record";
  const {
    scope: _scope,
    phase: _phase,
    topic: _topic,
    history: _history,
    projectRestore: _projectRestore,
    controlInvalidation: _controlInvalidation,
    structural: _structural,
    effects: effectOverrides,
    command: _command,
    ...metadata
  } = supplied;
  const event = {
    ...metadata,
    reason,
    command,
  };
  event.effects = changeEffectPlan(event, effectOverrides, {
    control,
    history,
    restoresProject,
    structural,
  });
  return Object.freeze(event);
}

// One runtime event contract. Legacy project shapes are handled by project
// migrations; they are never retained as a second operational model here.
export function changeEffectPlan(event = {}, overrides = null, policy = {}) {
  const reason = String(event.reason || "change");
  const parsed = parseReason(reason);
  const domain = String(event.command?.domain || parsed.domain);
  const phase = String(event.command?.phase || parsed.phase);
  const topic = String(event.command?.topic || parsed.topic);
  const semanticEvent = { ...event, command: { domain, phase, topic } };
  const persistence = persistenceEffect(semanticEvent, reason, domain, phase, policy.history === true);
  const output = outputEffect(semanticEvent, reason, domain, phase, topic, policy.control);
  const preview = previewEffect(semanticEvent, reason, domain, phase, topic);
  const session = sessionEffect(semanticEvent, reason, domain, phase, policy.restoresProject === true);
  const supplied = overrides && typeof overrides === "object" ? overrides : {};
  return Object.freeze({
    persistence: Object.freeze({ ...persistence, ...(supplied.persistence || {}) }),
    output: Object.freeze({ ...output, ...(supplied.output || {}) }),
    preview: Object.freeze({ ...preview, ...(supplied.preview || {}) }),
    session: Object.freeze({ ...session, ...(supplied.session || {}) }),
    graph: Object.freeze({
      mode: policy.structural === true ? "recompile" : "configuration",
      ...(supplied.graph || {}),
    }),
    lifecycle: Object.freeze({
      project: policy.restoresProject === true ? "restore" : "unchanged",
      ...(supplied.lifecycle || {}),
    }),
    control: supplied.control === null
      ? null
      : freezeOptionalPlan(policy.control && supplied.control
        ? { ...policy.control, ...supplied.control }
        : policy.control || supplied.control),
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
    if (/^nodes\.groups\.\d+\.nodes\./.test(path)) {
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

function assetCatalogControlInvalidation() {
  return Object.freeze({
    regions: Object.freeze([
      "project-rail",
      "live-projection-rail",
      "studio",
      "inspector",
    ]),
    preview: "assets",
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
  moduleBindings: {
    PROJECT_RESTORE_PREFIXES,
    STRUCTURAL_CHANGE_PREFIXES,
    METRIC_REASONS,
    OUTPUT_SILENT_REASONS,
    LIVE_PROGRAM_PREVIEW_REASONS,
  },
  parts: [
    {
      id: "change-command-policy",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      name: "Change command policy",
      exports: ["createChangeEvent", "changeEffectPlan", "StateCommandEngine"],
      source: [
        createChangeEvent,
        changeEffectPlan,
        controlInvalidationForPaths,
        assetCatalogControlInvalidation,
        StateCommandEngine,
        isStructuralChange,
        historyPolicy,
        parseReason,
        persistenceEffect,
        outputEffect,
        previewEffect,
        sessionEffect,
        freezeOptionalPlan,
        isMappingSurfaceVisibilityReason,
      ]
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
  const domain = prefix === "live" || (phase === "scrub" && topic === "live") ? "live" : "project";
  return {
    phase,
    topic,
    domain,
    restoresProject: PROJECT_RESTORE_PREFIXES.some((candidate) => reason.startsWith(candidate)),
  };
}

function persistenceEffect(_event, reason, domain, phase, history) {
  if (phase === "edit" || phase === "scrub") return { mode: "none" };
  if (domain === "project" || domain === "assets") {
    return { mode: "autosave", history };
  }
  if (domain === "ui") {
    return reason.startsWith("preview-")
      ? { mode: "checkpoint", history: false }
      : { mode: "defer", history: false };
  }
  return { mode: "none" };
}

function outputEffect(event, reason, domain, phase, topic, control) {
  if (event.outputState === "unchanged") return { mode: "none" };
  if (OUTPUT_SILENT_REASONS.includes(reason)) return { mode: "none" };
  if (domain === "live") {
    return {
      mode: Array.isArray(event.livePatches) && event.livePatches.length ? "live-patches" : "state",
      coalesce: phase === "scrub",
    };
  }
  if (domain === "assets" || (domain === "derived" && event.projection?.kind === "asset-catalog")) {
    return { mode: "assets" };
  }
  if (["runtime", "derived", "ui"].includes(domain)) return { mode: "none" };
  if (topic === "mapping-state") return { mode: "mapping-patch", coalesce: phase === "scrub" };
  if (["blackout", "toggle-output-playback", "toggle-output-hud"].includes(reason)) {
    return { mode: "global-command" };
  }
  if (Array.isArray(event.renderPatches) && event.renderPatches.length) {
    return { mode: "render-patches", coalesce: phase === "scrub" };
  }
  if (control?.requiresRenderPatch) {
    return { mode: "render-patches", coalesce: phase === "scrub" };
  }
  if (phase === "edit") return { mode: "none" };
  return { mode: "state", coalesce: phase === "scrub" };
}

function previewEffect(event, reason, domain, phase, topic) {
  if (METRIC_REASONS.includes(reason)) {
    return { mode: "metrics" };
  }
  if (topic === "mapping-state") return { mode: "mapping", coalesce: phase === "scrub" };
  if (topic === "scene-surface" || reason === "select-mapping" || isMappingSurfaceVisibilityReason(reason)) {
    return { mode: "mapping" };
  }
  if (reason === "live:preview-surface") return { mode: "projection" };
  if (domain === "derived" && event.projection?.kind === "component-thumbnails") return { mode: "thumbnails" };
  if (domain === "assets" || event.projection?.kind === "asset-catalog") return { mode: "assets" };
  if (domain === "ui") return { mode: reason.startsWith("preview-") ? "viewport" : "ui" };
  if (domain === "live" && Array.isArray(event.livePatches) && event.livePatches.length) {
    return { mode: "live-patches" };
  }
  if (LIVE_PROGRAM_PREVIEW_REASONS.includes(reason)) return { mode: "live-program" };
  if (Array.isArray(event.renderPatches) && event.renderPatches.length) return { mode: "render-patches" };
  if (phase === "edit") return { mode: "controls-only" };
  return { mode: "refresh" };
}

function sessionEffect(_event, reason, domain, phase, restoresProject) {
  const live = restoresProject
    ? "restore"
    : phase === "commit" && (
      domain === "live" ||
      domain === "project" ||
      reason === "select-mapping" ||
      reason === "live:preview-surface"
    )
      ? "persist"
      : "unchanged";
  return {
    workspace: reason === "workspace" ? "persist" : "unchanged",
    live,
  };
}

function freezeOptionalPlan(value) {
  return value && typeof value === "object" ? Object.freeze({ ...value }) : null;
}

function isMappingSurfaceVisibilityReason(reason) {
  return /^toggle:mappings\.\d+\.surfaces\.\d+\.enabled$/.test(String(reason || ""));
}
