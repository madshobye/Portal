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

// A source can own its own Overall diff bank and can also appear as a nested
// Component inside one or more Scene banks. Project-rail reset affordances
// must account for both forms.
export function liveSourceHasParameterDiffs(live = {}, sourceId = "") {
  const id = String(sourceId || "");
  if (!id) return false;
  const banks = live.parameterDiffs || EMPTY_BANK;
  if (Object.keys(banks[id] || EMPTY_BANK).length > 0) return true;
  return Object.values(banks).some((bank) =>
    bank && typeof bank === "object" && Object.hasOwn(bank, id));
}

export function liveParameterDiffSourceIds(live = {}) {
  const ids = new Set();
  for (const [targetId, bank] of Object.entries(live.parameterDiffs || EMPTY_BANK)) {
    if (!bank || typeof bank !== "object" || !Object.keys(bank).length) continue;
    ids.add(String(targetId));
    for (const componentId of Object.keys(bank)) ids.add(String(componentId));
  }
  return [...ids].sort();
}

export function clearLiveSourceParameterDiffs(state, sourceId = "") {
  const id = String(sourceId || "");
  const banks = state.ui?.live?.parameterDiffs;
  if (!id || !banks) return false;
  let changed = false;
  if (Object.hasOwn(banks, id)) {
    delete banks[id];
    changed = true;
  }
  for (const [targetId, bank] of Object.entries(banks)) {
    if (!bank || typeof bank !== "object" || !Object.hasOwn(bank, id)) continue;
    delete bank[id];
    changed = true;
    if (!Object.keys(bank).length) delete banks[targetId];
  }
  return changed;
}

export function clearAllLiveParameterDiffs(state) {
  if (!state.ui?.live) return false;
  const changed = Object.keys(state.ui.live.parameterDiffs || EMPTY_BANK).length > 0;
  state.ui.live.parameterDiffs = {};
  return changed;
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
