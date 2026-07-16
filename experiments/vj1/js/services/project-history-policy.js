export function isHistoryReason(reason = "") {
  return ["history-checkpoint", "project-undo", "project-redo"].includes(reason);
}

export function projectHistorySignature(payload = {}) {
  const {
    ui: _ui,
    metrics: _metrics,
    ...rest
  } = payload || {};
  return JSON.stringify({
    ...rest,
    project: {
      ...(rest.project || {}),
      savedAt: "",
      warnings: [],
    },
  });
}

export function historyGroupForReason(reason = "") {
  const value = String(reason || "change");
  if (isHistoryReason(value)) return value;
  const separator = value.indexOf(":");
  if (separator === -1) return value;
  const kind = value.slice(0, separator);
  const path = value.slice(separator + 1);
  if (kind === "update" || kind === "color" || kind === "toggle" || kind === "live") return `${kind}:${path}`;
  return value;
}

export function shouldCoalesceHistoryRevision(lastGroup = {}, nextKey = "", now = Date.now(), windowMs = 6000) {
  if (!nextKey || isHistoryReason(nextKey)) return false;
  if (!lastGroup?.key || lastGroup.key !== nextKey) return false;
  return Math.max(0, Number(now) || 0) - Math.max(0, Number(lastGroup.at) || 0) <= windowMs;
}
