const FORBIDDEN_PATH_PARTS = new Set(["__proto__", "prototype", "constructor"]);
const STRUCTURAL_LIVE_RENDER_ROOTS = new Set(["resolutionScale", "frameShape", "syncInstances"]);

export function createLiveRenderPatch(componentId, path, value) {
  return {
    componentId: String(componentId || ""),
    path: String(path || ""),
    value,
  };
}

export function applyLiveRenderPatches(state, patches = []) {
  const resolution = resolveLiveRenderPatches(state, patches);
  if (!resolution.applied) return resolution;
  for (const patch of resolution.destinations) patch.target[patch.leaf] = patch.value;
  return { applied: true, componentIds: resolution.componentIds, failedPatch: null };
}

export function resolveLiveRenderPatches(state, patches = []) {
  if (!state || !Array.isArray(state.components) || !Array.isArray(patches)) {
    return { applied: false, componentIds: [], destinations: [], failedPatch: null };
  }
  const components = new Map(state.components.map((component) => [String(component.id || ""), component]));
  const componentIds = new Set();
  const resolved = [];
  for (const patch of patches) {
    const componentId = String(patch?.componentId || "");
    const component = components.get(componentId);
    const parts = livePatchPathParts(patch?.path);
    const destination = component && parts.length ? resolvePatchPath(component, parts) : null;
    if (!destination) {
      return { applied: false, componentIds: [...componentIds], destinations: [], failedPatch: patch || null };
    }
    resolved.push({ ...destination, componentId, path: String(patch.path || ""), value: patch.value });
    componentIds.add(componentId);
  }
  return { applied: true, componentIds: [...componentIds], destinations: resolved, failedPatch: null };
}

export function interpolatedLiveRenderValue(from, to, startedAtMs, durationMs, nowMs) {
  const duration = Math.max(0, Number(durationMs) || 0);
  if (!duration) return Number(to);
  const progress = Math.max(0, Math.min(1, (Number(nowMs) - Number(startedAtMs)) / duration));
  return Number(from) + (Number(to) - Number(from)) * progress;
}

// Param fading is a render-time presentation feature. Structural settings
// select render topology or discrete resource sizes and must take effect as
// one atomic target value; interpolating them creates invalid transient state
// (for example 1x -> 0.5x resolution briefly produces unsupported 0.92x).
export function isInterpolableLiveRenderPath(path) {
  const parts = livePatchPathParts(path);
  if (!parts.length) return false;
  return !STRUCTURAL_LIVE_RENDER_ROOTS.has(String(parts[0]));
}

function livePatchPathParts(path) {
  const raw = String(path || "").split(".").filter(Boolean);
  if (!raw.length || raw.some((part) => FORBIDDEN_PATH_PARTS.has(part))) return [];
  return raw.map((part) => /^\d+$/.test(part) ? Number(part) : part);
}

function resolvePatchPath(target, parts) {
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index++) {
    const part = parts[index];
    if (cursor == null || typeof cursor !== "object" || !(part in cursor)) return null;
    cursor = cursor[part];
  }
  const leaf = parts.at(-1);
  if (cursor == null || typeof cursor !== "object") return null;
  // Params are deliberately extensible maps: persisted nodes may omit values
  // that currently equal their schema defaults. A Live slider must be able to
  // author that optional leaf without relaxing any structural path segment.
  if (!(leaf in cursor) && !isOptionalParamLeaf(parts)) return null;
  return { target: cursor, leaf };
}

function isOptionalParamLeaf(parts) {
  return parts.length >= 2 && parts.at(-2) === "params" && typeof parts.at(-1) === "string";
}
