export function isHistoryReason(reason = "") {
  return ["history-checkpoint", "project-undo", "project-redo"].includes(reason);
}

export function projectHistorySignature(payload = {}) {
  const {
    ui: _ui,
    metrics: _metrics,
    ...rest
  } = payload || {};
  return canonicalJson(stripDerivedHistoryState({
    ...rest,
    project: {
      ...(rest.project || {}),
      savedAt: "",
      warnings: [],
    },
  }));
}

function stripDerivedHistoryState(value, key = "") {
  if (Array.isArray(value)) return value.map((item) => stripDerivedHistoryState(item));
  if (!value || typeof value !== "object") return value;
  const ignored = new Set(["thumbnail", "surfaceThumbnails", "frameThumbnails", "activity"]);
  return Object.fromEntries(Object.entries(value)
    .filter(([childKey]) => !ignored.has(childKey) && !(key === "global" && childKey === "calibrating"))
    .map(([childKey, child]) => [childKey, stripDerivedHistoryState(child, childKey)]));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
