import { liveComponentLayerProjection } from "../domain/component-layer-projection.js";

// Expensive semantic snapshots for the bounded performance capture only.
// Callers must gate this behind an active profiling session.
export function captureControlLiveProfileDiagnostic(state = {}, renderState = {}, context = {}) {
  const live = state.ui?.live || {};
  const liveTargetId = String(live.selectedComponentId || live.selectedSceneId || "");
  const relevantComponentIds = collectRelevantComponentIds(live, renderState);
  const componentIds = [...relevantComponentIds];
  const common = {
    schema: "vj1-live-profile-diagnostic@4",
    capturedAtMs: performance.now(),
    control: {
      workspace: String(state.ui?.workspace || ""),
      selectedComponentId: String(state.ui?.selectedComponentId || ""),
      selectedSceneId: String(live.selectedSceneId || ""),
      liveTargetId,
      previewSurfaceId: String(live.previewSurfaceId || ""),
      inspectedComponentId: String(live.inspectedComponentId || ""),
    },
    parameterDiffBank: {
      targetId: liveTargetId,
      values: boundedProfileValue(live.parameterDiffs?.[liveTargetId] || {}),
    },
    transitionCoordinator: boundedProfileValue(live.transitionCoordinator || {}),
  };
  if (context.kind === "event") return {
    ...common,
    event: snapshotStateEvent(context),
  };
  const componentById = new Map(
    (renderState.components || []).map((component) => [String(component?.id || ""), component]),
  );
  return {
    ...common,
    projection: {
      selectedComponentId: String(renderState.ui?.selectedComponentId || ""),
      surfaces: boundedProfileValue(renderState.surfaces || []),
      liveTransitions: (renderState.liveTransitions || (renderState.liveTransition ? [renderState.liveTransition] : []))
        .map(snapshotTransition),
      componentIds,
      components: componentIds
        .slice(0, 12)
        .map((id) => componentById.get(id))
        .filter(Boolean)
        .map((component) => snapshotComponent(renderState, component)),
    },
  };
}

function collectRelevantComponentIds(live = {}, renderState = {}) {
  const ids = new Set([
    live.selectedComponentId,
    live.selectedSceneId,
    live.inspectedComponentId,
    live.patchSourceId,
  ].map(String).filter(Boolean));
  const targetId = String(live.selectedComponentId || live.selectedSceneId || "");
  for (const componentId of Object.keys(live.parameterDiffs?.[targetId] || {})) {
    if (componentId) ids.add(String(componentId));
  }
  const visitSurface = (surface = {}) => {
    const componentId = String(surface.componentId || surface.source?.componentId || "");
    if (componentId) ids.add(componentId);
  };
  for (const surface of renderState.surfaces || []) visitSurface(surface);
  return ids;
}

function snapshotComponent(state = {}, component = {}) {
  return {
    id: String(component.id || ""),
    name: String(component.name || ""),
    type: String(component.type || ""),
    opacity: component.opacity,
    speed: component.speed,
    blend: component.blend,
    transform: boundedProfileValue(component.transform),
    nodes: liveComponentLayerProjection(state, component)
      .slice(0, 32)
      .map(snapshotLayer),
  };
}

function snapshotLayer(layer = {}) {
  return {
    nodeId: String(layer.nodeId || ""),
    configuration: snapshotChainItem(layer.item),
    nodes: (layer.children || []).slice(0, 32).map(snapshotLayer),
  };
}

function snapshotChainItem(item = {}) {
  return {
    id: String(item.id || ""),
    kind: String(item.kind || ""),
    componentId: String(item.componentId || item.source?.componentId || ""),
    enabled: item.enabled !== false,
    opacity: item.opacity,
    blend: item.blend,
    transform: boundedProfileValue(item.transform),
    boundary: boundedProfileValue(item.boundary),
    source: item.source ? {
      type: String(item.source.type || ""),
      generatorId: String(item.source.generatorId || ""),
      componentId: String(item.source.componentId || ""),
      mediaId: String(item.source.mediaId || ""),
      params: boundedProfileValue(item.source.params || {}),
    } : undefined,
    params: boundedProfileValue(item.params),
  };
}

function snapshotStateEvent(context = {}) {
  const change = context.change || {};
  return {
    reason: String(context.reason || change.reason || ""),
    command: boundedProfileValue(change.command || {}),
    changedPaths: (change.changedPaths || []).slice(0, 32).map(String),
    livePatches: (change.livePatches || []).slice(0, 16).map(snapshotPatch),
    previewMode: String(change.effects?.preview?.mode || ""),
    outputMode: String(change.effects?.output?.mode || ""),
  };
}

function snapshotPatch(patch = {}) {
  return {
    target: String(patch.target || "component"),
    targetId: String(patch.targetId || ""),
    componentId: String(patch.componentId || ""),
    nodeId: String(patch.nodeId || ""),
    path: String(patch.path || ""),
    value: boundedProfileValue(patch.value),
  };
}

function snapshotTransition(transition = {}) {
  return {
    id: String(transition.id || ""),
    destination: String(transition.destination || ""),
    surfaceId: String(transition.surfaceId || ""),
    transitionId: String(transition.transitionId || ""),
    startedAtMs: Number(transition.startedAtMs) || 0,
    durationMs: Math.max(0, Number(transition.durationMs) || 0),
    transitionParameters: boundedProfileValue(transition.transitionParameters || {}),
    fromTargetId: String(transition.fromTargetId || ""),
    toTargetId: String(transition.toTargetId || ""),
  };
}

export function boundedProfileValue(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > 8192 ? `${value.slice(0, 8192)}…[truncated ${value.length - 8192}]` : value;
  if (typeof value !== "object") return String(value);
  if (depth >= 16) return "[max-depth]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.slice(0, 128).map((item) => boundedProfileValue(item, depth + 1, seen));
    if (value.length > 128) result.push(`[truncated ${value.length - 128} items]`);
    seen.delete(value);
    return result;
  }
  const result = {};
  const entries = Object.entries(value).slice(0, 128);
  for (const [key, item] of entries) result[key] = boundedProfileValue(item, depth + 1, seen);
  if (Object.keys(value).length > entries.length) result.__truncatedKeys = Object.keys(value).length - entries.length;
  seen.delete(value);
  return result;
}
