const FORBIDDEN_PATH_PARTS = new Set(["__proto__", "prototype", "constructor"]);
const EMPTY_BANK = Object.freeze({});

export function activeLiveTargetId(live = {}) {
  return String(live.selectedComponentId || live.selectedSceneId || "");
}

// Live parameter state has one authority: a sparse diff bank per mounted
// Overall target. The selected target merely chooses a bank; it never owns a
// copied "active" override model alongside the retained banks.
export function liveParameterDiffBank(live = {}, targetId = activeLiveTargetId(live)) {
  return live.parameterDiffs?.[String(targetId || "")] || EMPTY_BANK;
}

export function ensureLiveParameterDiffBank(state = {}, targetId = activeLiveTargetId(state.ui?.live)) {
  state.ui ||= {};
  state.ui.live ||= {};
  state.ui.live.parameterDiffs ||= {};
  const id = String(targetId || "");
  if (!id) return null;
  return state.ui.live.parameterDiffs[id] ||= {};
}

export function setLiveParameterDiff(state, componentId, path, value, targetId) {
  if (!componentId || !path) return false;
  const bank = ensureLiveParameterDiffBank(state, targetId);
  if (!bank) return false;
  const override = bank[componentId] ||= {};
  return setPathValue(override, path, value, { createMissing: true });
}

// Node configuration overrides use the same stable address as render patches:
// Component identity + node identity + configuration-relative path. They do
// not inherit authored array positions and therefore survive graph reordering.
export function setLiveNodeParameterDiff(
  state,
  componentId,
  nodeId,
  path,
  value,
  targetId,
) {
  if (!componentId || !nodeId || !path) return false;
  const bank = ensureLiveParameterDiffBank(state, targetId);
  if (!bank) return false;
  const override = bank[componentId] ||= {};
  override.nodes ||= {};
  const nodeOverride = override.nodes[nodeId] ||= {};
  return setPathValue(nodeOverride, path, value, { createMissing: true });
}

export function updateLiveParameterDiffIfPresent(state, componentId, path, value, targetId) {
  const bank = liveParameterDiffBank(state.ui?.live, targetId);
  const override = bank?.[componentId];
  if (!override || !pathValue(override, path).found) return false;
  return setPathValue(override, path, value);
}

export function updateLiveNodeParameterDiffIfPresent(
  state,
  componentId,
  nodeId,
  path,
  value,
  targetId,
) {
  const bank = liveParameterDiffBank(state.ui?.live, targetId);
  const nodeOverride = bank?.[componentId]?.nodes?.[nodeId];
  if (!nodeOverride || !pathValue(nodeOverride, path).found) return false;
  return setPathValue(nodeOverride, path, value);
}

export function liveNodeParameterDiff(
  live = {},
  componentId = "",
  nodeId = "",
  targetId = activeLiveTargetId(live),
) {
  return liveParameterDiffBank(live, targetId)?.[componentId]?.nodes?.[nodeId] || EMPTY_BANK;
}

export function clearLiveTargetParameterDiffs(state, targetId) {
  const id = String(targetId || "");
  if (!id || !state.ui?.live?.parameterDiffs) return false;
  const existed = Object.hasOwn(state.ui.live.parameterDiffs, id);
  delete state.ui.live.parameterDiffs[id];
  return existed;
}

export function pathValue(target, path) {
  const parts = pathParts(path);
  if (!parts.length) return { found: false, value: undefined };
  let cursor = target;
  for (const part of parts) {
    if (cursor == null || typeof cursor !== "object" || !(part in cursor)) {
      return { found: false, value: undefined };
    }
    cursor = cursor[part];
  }
  return { found: true, value: cursor };
}

function setPathValue(target, path, value, { createMissing = false } = {}) {
  const parts = pathParts(path);
  if (!parts.length) return false;
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index++) {
    const part = parts[index];
    let child = cursor?.[part];
    if ((!child || typeof child !== "object") && createMissing) {
      child = typeof parts[index + 1] === "number" ? [] : {};
      cursor[part] = child;
    }
    if (!child || typeof child !== "object") return false;
    cursor = child;
  }
  const leaf = parts.at(-1);
  if (!createMissing && !(leaf in cursor)) return false;
  cursor[leaf] = value;
  return true;
}

function pathParts(path) {
  const parts = String(path || "").split(".").filter(Boolean);
  if (!parts.length || parts.some((part) => FORBIDDEN_PATH_PARTS.has(part))) return [];
  return parts.map((part) => /^\d+$/.test(part) ? Number(part) : part);
}
