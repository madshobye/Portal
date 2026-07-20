const PROJECT_RESTORE_PREFIXES = [
  "project-load",
  "project-open",
  "project-restore",
  "project-undo",
  "project-redo",
  "project-close",
];

export function createChangeEvent(change = "change") {
  const supplied = change && typeof change === "object" ? change : {};
  const reason = String(supplied.reason ?? change ?? "change");
  const parsed = parseReason(reason);
  const scope = supplied.scope || parsed.scope;
  const phase = supplied.phase || parsed.phase;
  const structural = supplied.structural ?? isStructuralChange(reason);
  return Object.freeze({
    ...parsed,
    ...supplied,
    reason,
    phase,
    topic: supplied.topic || parsed.topic,
    scope,
    history: supplied.history || historyPolicy(reason, scope, phase),
    ...(structural ? { structural: true } : {}),
    projectRestore: supplied.projectRestore ?? parsed.projectRestore,
  });
}

const STRUCTURAL_CHANGE_PREFIXES = [
  "add-component",
  "remove-component",
  "add-canvas-component",
  "convert-component-to-canvas",
  "add-chain-",
  "remove-chain-",
  "reorder-chain",
  "paste",
  "cut",
  "select-",
];

function isStructuralChange(reason) {
  return STRUCTURAL_CHANGE_PREFIXES.some((prefix) => reason === prefix || reason.startsWith(prefix));
}

function historyPolicy(reason, scope, phase) {
  if (scope !== "project" || phase !== "commit") return "none";
  if (PROJECT_RESTORE_PREFIXES.some((prefix) => reason.startsWith(prefix))) return "none";
  if (["workspace", "component-thumbnail", "select-component"].includes(reason)) return "none";
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
