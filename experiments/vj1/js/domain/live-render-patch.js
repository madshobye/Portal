const FORBIDDEN_PATH_PARTS = new Set(["__proto__", "prototype", "constructor"]);
const STRUCTURAL_LIVE_RENDER_ROOTS = new Set(["resolutionScale", "frameShape", "syncInstances"]);
const RENDER_STATE_ROOTS = new Set(["mappingCalibration", "surfaces"]);

export function createLiveRenderPatch(componentId, path, value, itemId = "") {
  return {
    target: "component",
    componentId: String(componentId || ""),
    path: String(path || ""),
    value,
    ...(itemId ? { itemId: String(itemId) } : {}),
  };
}

// The patch transport is shared by every high-frequency render edit. State
// roots are deliberately allow-listed and root-level: project structure still
// travels as an ordered full-state snapshot, while continuous renderer-owned
// values such as mapping calibration and the derived Live Surface projection
// can use the same latest-wins protocol as Component parameters. `surfaces`
// here is the already-materialized render program, not the authored Mapping;
// the latter still travels through ordered project-state activation.
export function createRenderStatePatch(path, value) {
  return {
    target: "state",
    path: String(path || ""),
    value,
  };
}

export function applyLiveRenderPatches(state, patches = []) {
  const resolution = resolveLiveRenderPatches(state, patches);
  if (!resolution.applied) return resolution;
  for (const patch of resolution.destinations) patch.target[patch.leaf] = patch.value;
  return {
    applied: true,
    componentIds: resolution.componentIds,
    configurationTargets: resolution.configurationTargets,
    statePaths: resolution.statePaths,
    failedPatch: null,
  };
}

// Materialize the same compact patch stream without mutating the retained
// state tree. Embedded Preview owns both an active renderer state and a
// pending state used by later resize/layout reconciliation. Updating only the
// renderer lets that pending state restore stale parameters on the next
// reconciliation. Path-copying the affected Component/state branches keeps
// those two authorities coherent without cloning or rebuilding the project.
export function applyLiveRenderPatchesImmutable(state, patches = []) {
  const resolution = resolveLiveRenderPatches(state, patches);
  if (!resolution.applied) return { ...resolution, state };

  let nextState = state;
  for (const patch of resolution.destinations) {
    if (patch.targetType === "state") {
      nextState = copyPatchPath(
        nextState,
        livePatchPathParts(patch.path),
        patch.value,
      );
      continue;
    }
    const componentIndex = nextState.components.findIndex(
      (component) => String(component?.id || "") === patch.componentId,
    );
    if (componentIndex < 0) {
      return {
        applied: false,
        componentIds: resolution.componentIds,
        configurationTargets: resolution.configurationTargets,
        statePaths: resolution.statePaths,
        destinations: [],
        failedPatch: patch,
        state,
      };
    }
    const components = nextState.components.slice();
    components[componentIndex] = copyPatchPath(
      components[componentIndex],
      livePatchPathParts(patch.path),
      patch.value,
    );
    nextState = { ...nextState, components };
  }

  return {
    applied: true,
    componentIds: resolution.componentIds,
    configurationTargets: resolution.configurationTargets,
    statePaths: resolution.statePaths,
    failedPatch: null,
    state: nextState,
  };
}

export function resolveLiveRenderPatches(state, patches = []) {
  if (!state || !Array.isArray(state.components) || !Array.isArray(patches)) {
    return { applied: false, componentIds: [], statePaths: [], destinations: [], failedPatch: null };
  }
  const components = new Map(state.components.map((component) => [String(component.id || ""), component]));
  const componentIds = new Set();
  const configurationTargets = new Map();
  const statePaths = new Set();
  const resolved = [];
  for (const patch of patches) {
    const parts = livePatchPathParts(patch?.path);
    if (patch?.target === "state") {
      const path = String(patch?.path || "");
      const validRoot = parts.length === 1 && RENDER_STATE_ROOTS.has(String(parts[0]));
      const destination = validRoot ? resolvePatchPath(state, parts) : null;
      if (!destination) {
        return { applied: false, componentIds: [...componentIds], statePaths: [...statePaths], destinations: [], failedPatch: patch || null };
      }
      resolved.push({ ...destination, targetType: "state", componentId: "", path, value: patch.value });
      statePaths.add(path);
      continue;
    }
    const componentId = String(patch?.componentId || "");
    const component = components.get(componentId);
    const canonicalParts = component && patch?.itemId
      ? stableItemPatchParts(component, parts, patch.itemId)
      : parts;
    const destination = component && canonicalParts?.length
      ? resolvePatchPath(component, canonicalParts)
      : null;
    if (!destination) {
      return { applied: false, componentIds: [...componentIds], statePaths: [...statePaths], destinations: [], failedPatch: patch || null };
    }
    const canonicalPath = canonicalParts.map(String).join(".");
    resolved.push({ ...destination, targetType: "component", componentId, path: canonicalPath, value: patch.value });
    componentIds.add(componentId);
    const itemId = visualItemIdForPatchPath(component, canonicalParts);
    if (itemId) {
      const ids = configurationTargets.get(componentId) || new Set();
      ids.add(itemId);
      configurationTargets.set(componentId, ids);
    }
  }
  return {
    applied: true,
    componentIds: [...componentIds],
    configurationTargets: [...configurationTargets].map(
      ([componentId, itemIds]) => Object.freeze({
        componentId,
        itemIds: Object.freeze([...itemIds]),
      }),
    ),
    statePaths: [...statePaths],
    destinations: resolved,
    failedPatch: null,
  };
}

function stableItemPatchParts(component, requestedParts, itemId) {
  const relativeParts = itemRelativePatchParts(requestedParts);
  if (!relativeParts?.length) return null;
  const itemParts = findChainItemParts(component.chain, String(itemId || ""));
  return itemParts ? [...itemParts, ...relativeParts] : null;
}

function itemRelativePatchParts(parts) {
  if (parts[0] !== "chain" || !Number.isInteger(parts[1])) return null;
  let index = 2;
  while (parts[index] === "chain" && Number.isInteger(parts[index + 1])) {
    index += 2;
  }
  return parts.slice(index);
}

function findChainItemParts(chain = [], itemId = "", base = ["chain"]) {
  for (let index = 0; index < chain.length; index++) {
    const item = chain[index];
    const parts = [...base, index];
    if (String(item?.id || "") === itemId) return parts;
    if (item?.kind === "group") {
      const nested = findChainItemParts(item.chain || [], itemId, [...parts, "chain"]);
      if (nested) return nested;
    }
  }
  return null;
}

function visualItemIdForPatchPath(component = {}, parts = []) {
  let cursor = component;
  let itemId = "";
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (part === "chain" && Number.isInteger(parts[index + 1])) {
      const item = cursor?.chain?.[parts[index + 1]];
      if (!item) return "";
      itemId = String(item.id || itemId);
      cursor = item;
      index++;
      continue;
    }
    if (cursor == null || typeof cursor !== "object") break;
    cursor = cursor[part];
  }
  return itemId;
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

function copyPatchPath(target, parts, value) {
  if (!parts.length) return target;
  const [part, ...rest] = parts;
  const copy = Array.isArray(target) ? target.slice() : { ...target };
  copy[part] = rest.length
    ? copyPatchPath(target[part], rest, value)
    : value;
  return copy;
}
