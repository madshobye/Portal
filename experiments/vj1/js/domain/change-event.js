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
  return Object.freeze({
    ...parsed,
    ...supplied,
    reason,
    phase: supplied.phase || parsed.phase,
    topic: supplied.topic || parsed.topic,
    scope: supplied.scope || parsed.scope,
    projectRestore: supplied.projectRestore ?? parsed.projectRestore,
  });
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
