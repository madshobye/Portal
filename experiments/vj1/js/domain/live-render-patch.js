const FORBIDDEN_PATH_PARTS = new Set(["__proto__", "prototype", "constructor"]);
const STRUCTURAL_COMPONENT_ROOTS = new Set(["resolutionScale", "frameShape", "syncInstances"]);
const RENDER_STATE_ROOTS = new Set(["mappingCalibration", "surfaces"]);
const COMPONENT_PROGRAM_GENERATOR = "vj1-component-compiler";

// One stable patch address for persistent editor edits and temporary Live
// commands. A node id addresses graph configuration; an empty node id
// addresses Component-level presentation metadata such as resolution scale.
export function createComponentRenderPatch(componentId, nodeId, path, value, {
  interpolation = "",
} = {}) {
  const patch = {
    target: "component",
    componentId: String(componentId || ""),
    nodeId: String(nodeId || ""),
    path: String(path || ""),
    value,
  };
  // Interpolation is execution metadata on the sparse value diff, not a
  // second parameter model. Direct manipulation uses the same patch address
  // as every other Live edit but asks renderers to present its newest sample
  // immediately instead of repeatedly restarting the configured Param fade.
  if (interpolation === "immediate") patch.interpolation = "immediate";
  return patch;
}

export function createRenderStatePatch(path, value) {
  return { target: "state", path: String(path || ""), value };
}

export function applyLiveRenderPatches(state, patches = []) {
  const resolution = resolveLiveRenderPatches(state, patches);
  if (!resolution.applied) return resolution;
  for (const patch of resolution.destinations) patch.target[patch.leaf] = patch.value;
  return patchResult(resolution);
}

export function applyLiveRenderPatchesImmutable(state, patches = []) {
  const resolution = resolveLiveRenderPatches(state, patches);
  if (!resolution.applied) return { ...resolution, state };
  let nextState = state;
  for (const patch of resolution.destinations) {
    if (patch.targetType === "state") {
      nextState = copyPatchPath(nextState, patchPathParts(patch.path), patch.value);
    } else if (patch.nodeId) {
      nextState = copyGraphNodeConfiguration(
        nextState,
        patch.componentId,
        patch.nodeId,
        patchPathParts(patch.path),
        patch.value,
      );
    } else {
      const componentIndex = nextState.components?.findIndex((component) =>
        String(component?.id || "") === patch.componentId
      ) ?? -1;
      if (componentIndex < 0) return { ...failedResolution(resolution, patch), state };
      const components = nextState.components.slice();
      components[componentIndex] = copyPatchPath(
        components[componentIndex],
        patchPathParts(patch.path),
        patch.value,
      );
      nextState = { ...nextState, components };
    }
    if (!nextState) return { ...failedResolution(resolution, patch), state };
  }
  return { ...patchResult(resolution), state: nextState };
}

export function resolveLiveRenderPatches(state, patches = []) {
  if (!state || !Array.isArray(state.components) || !Array.isArray(patches)) {
    return emptyResolution("invalid-patch-input");
  }
  const components = new Map(
    state.components.map((component) => [String(component.id || ""), component]),
  );
  const groups = new Map((state.nodes?.groups || [])
    .filter((group) => group.generatedBy === COMPONENT_PROGRAM_GENERATOR)
    .map((group) => [String(group.componentId || ""), group]));
  const componentIds = new Set();
  const configurationTargets = new Map();
  const statePaths = new Set();
  const destinations = [];

  for (const patch of patches) {
    const parts = patchPathParts(patch?.path);
    if (patch?.target === "state") {
      const path = String(patch?.path || "");
      const destination = parts.length === 1 && RENDER_STATE_ROOTS.has(String(parts[0]))
        ? resolvePatchPath(state, parts)
        : null;
      if (!destination) {
        return failedPatchResolution(
          componentIds,
          configurationTargets,
          statePaths,
          patch,
          "unsupported-state-path",
        );
      }
      destinations.push({
        ...destination,
        targetType: "state",
        componentId: "",
        nodeId: "",
        path,
        value: patch.value,
        interpolation: patch.interpolation === "immediate" ? "immediate" : "configured",
      });
      statePaths.add(path);
      continue;
    }

    const componentId = String(patch?.componentId || "");
    const nodeId = String(patch?.nodeId || "");
    if (!nodeId && String(parts[0] || "") === "chain") {
      return failedPatchResolution(
        componentIds,
        configurationTargets,
        statePaths,
        patch,
        "positional-component-path",
      );
    }
    const component = components.get(componentId);
    const node = nodeId ? findGraphNode(groups.get(componentId)?.nodes, nodeId) : null;
    const target = nodeId ? node?.configuration : component;
    const destination = target && parts.length ? resolvePatchPath(target, parts) : null;
    if (!destination) {
      const rejectionReason = !component
        ? "component-not-found"
        : nodeId && !node
          ? "node-not-found"
          : "path-not-found";
      return failedPatchResolution(
        componentIds,
        configurationTargets,
        statePaths,
        patch,
        rejectionReason,
      );
    }
    destinations.push({
      ...destination,
      targetType: nodeId ? "node" : "component",
      componentId,
      nodeId,
      path: parts.map(String).join("."),
      value: patch.value,
      interpolation: patch.interpolation === "immediate" ? "immediate" : "configured",
    });
    componentIds.add(componentId);
    if (nodeId) {
      const ids = configurationTargets.get(componentId) || new Set();
      ids.add(nodeId);
      configurationTargets.set(componentId, ids);
    }
  }

  return {
    applied: true,
    componentIds: [...componentIds],
    configurationTargets: freezeConfigurationTargets(configurationTargets),
    statePaths: [...statePaths],
    destinations,
    failedPatch: null,
    rejectionReason: "",
  };
}

export function interpolatedLiveRenderValue(from, to, startedAtMs, durationMs, nowMs) {
  const duration = Math.max(0, Number(durationMs) || 0);
  if (!duration) return Number(to);
  const progress = Math.max(0, Math.min(1, (Number(nowMs) - Number(startedAtMs)) / duration));
  return Number(from) + (Number(to) - Number(from)) * progress;
}

export function isInterpolableLiveRenderPath(path, nodeId = "") {
  const parts = patchPathParts(path);
  if (!parts.length) return false;
  return !!nodeId || !STRUCTURAL_COMPONENT_ROOTS.has(String(parts[0]));
}

function patchResult(resolution) {
  return {
    applied: true,
    componentIds: resolution.componentIds,
    configurationTargets: resolution.configurationTargets,
    statePaths: resolution.statePaths,
    failedPatch: null,
    rejectionReason: "",
  };
}

function emptyResolution(rejectionReason = "invalid-patch") {
  return {
    applied: false,
    componentIds: [],
    configurationTargets: [],
    statePaths: [],
    destinations: [],
    failedPatch: null,
    rejectionReason,
  };
}

function failedPatchResolution(
  componentIds,
  configurationTargets,
  statePaths,
  failedPatch,
  rejectionReason = "invalid-patch",
) {
  return {
    applied: false,
    componentIds: [...componentIds],
    configurationTargets: freezeConfigurationTargets(configurationTargets),
    statePaths: [...statePaths],
    destinations: [],
    failedPatch: failedPatch || null,
    rejectionReason,
  };
}

function failedResolution(resolution, failedPatch, rejectionReason = "patch-application-failed") {
  return { ...resolution, applied: false, destinations: [], failedPatch, rejectionReason };
}

function freezeConfigurationTargets(targets) {
  return [...targets].map(([componentId, nodeIds]) => Object.freeze({
    componentId,
    nodeIds: Object.freeze([...nodeIds]),
  }));
}

function findGraphNode(nodes = [], nodeId = "") {
  for (const node of nodes || []) {
    if (String(node?.id || "") === nodeId) return node;
    const nested = findGraphNode(node?.nodes || [], nodeId);
    if (nested) return nested;
  }
  return null;
}

function copyGraphNodeConfiguration(state, componentId, nodeId, parts, value) {
  const groupIndex = state.nodes?.groups?.findIndex((group) =>
    group.generatedBy === COMPONENT_PROGRAM_GENERATOR &&
    String(group.componentId || "") === componentId
  ) ?? -1;
  if (groupIndex < 0) return null;
  const groups = state.nodes.groups.slice();
  const group = copyGraphScopeConfiguration(groups[groupIndex], nodeId, parts, value);
  if (!group) return null;
  groups[groupIndex] = group;
  return { ...state, nodes: { ...state.nodes, groups } };
}

function copyGraphScopeConfiguration(scope, nodeId, parts, value) {
  let found = false;
  const nodes = (scope.nodes || []).map((node) => {
    if (String(node.id || "") === nodeId) {
      found = true;
      return { ...node, configuration: copyPatchPath(node.configuration, parts, value) };
    }
    const nested = copyGraphScopeConfiguration(node, nodeId, parts, value);
    if (!nested) return node;
    found = true;
    return nested;
  });
  return found ? { ...scope, nodes } : null;
}

function patchPathParts(path) {
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
  if (!(leaf in cursor) && !isOptionalParamLeaf(parts)) return null;
  return { target: cursor, leaf };
}

function isOptionalParamLeaf(parts) {
  return parts.length >= 2 && parts.at(-2) === "params" && typeof parts.at(-1) === "string";
}

function copyPatchPath(target, parts, value) {
  if (!parts.length || target == null || typeof target !== "object") return target;
  const [part, ...rest] = parts;
  const copy = Array.isArray(target) ? target.slice() : { ...target };
  copy[part] = rest.length ? copyPatchPath(target[part], rest, value) : value;
  return copy;
}
