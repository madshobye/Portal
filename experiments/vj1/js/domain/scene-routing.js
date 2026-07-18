import { latestProjectActivity } from "./component-activity.js?v=adaptive-component-demand-29";

export function normalizeProjectionFit(value) {
  return value === "contain" || value === "stretch" ? value : "cover";
}

export function sceneSourceNodeId(componentId = "", frameId = "") {
  return frameId
    ? `recording-frame:${encodeURIComponent(componentId)}:${encodeURIComponent(frameId)}`
    : `component:${encodeURIComponent(componentId)}`;
}

export function sceneSourceNodes(state = {}) {
  const frames = Array.isArray(state.recordingFrames) ? state.recordingFrames : [];
  return (state.components || []).flatMap((component) => {
    const componentNode = {
      id: sceneSourceNodeId(component.id),
      type: "component",
      name: component.name,
      thumbnail: component.thumbnail || "",
      componentId: component.id,
      outputFrameId: "",
      createdAt: component.activity?.createdAt || "",
      recentAt: latestProjectActivity(component.activity),
    };
    if (component.type !== "canvas") return [componentNode];
    return [
      componentNode,
      ...frames.map((frame) => ({
        id: sceneSourceNodeId(component.id, frame.id),
        type: "recording-frame",
        name: `${component.name} · ${frame.name}`,
        thumbnail: component.canvas?.frameThumbnails?.[frame.id] || component.thumbnail || "",
        componentId: component.id,
        outputFrameId: frame.id,
        frameId: frame.id,
        createdAt: latestTimestamp(component.activity?.createdAt, frame.activity?.createdAt),
        recentAt: Math.max(latestProjectActivity(component.activity), latestProjectActivity(frame.activity)),
      })),
    ];
  });
}

export function resolveSceneSourceNode(state = {}, sourceNodeId = "") {
  const nodes = sceneSourceNodes(state);
  if (!sourceNodeId) return null;
  // An unresolved route is empty. Never substitute an unrelated first
  // component: that makes stale/blank assignments sample whichever texture
  // happened to be rendered first and violates the explicit Empty route.
  return nodes.find((node) => node.id === sourceNodeId) || null;
}

export function applySceneSourceNode(route = {}, node = null) {
  return {
    ...route,
    sourceNodeId: node?.id || "",
    componentId: node?.componentId || "",
    outputFrameId: node?.outputFrameId || "",
  };
}

export function liveProgramComponentIds(state = {}, nowMs = Date.now()) {
  const ids = new Set();
  const live = state.ui?.live || {};
  const sceneId = String(live.selectedSceneId || state.scenes?.[0]?.id || "");
  const selectedScene = state.scenes?.find((scene) => String(scene.id) === sceneId);
  const snapshots = [live.sceneSnapshot || selectedScene?.snapshot].filter(Boolean);
  const transition = live.transition;
  const transitionStartedAt = Number(transition?.startedAtMs) || 0;
  const transitionDuration = Math.max(0, Number(transition?.durationMs) || 0);
  if (
    transition?.fromSnapshot &&
    transitionStartedAt > 0 &&
    Number(nowMs) < transitionStartedAt + transitionDuration
  ) {
    snapshots.push(transition.fromSnapshot);
  }
  for (const snapshot of snapshots) {
    for (const surface of snapshot?.surfaces || []) {
      if (surface.enabled === false || !surface.componentId) continue;
      collectLiveComponentGraph(state, surface.componentId, ids);
    }
  }
  return ids;
}

export function initializeLiveChainInsertion(state, componentId, item, nowMs = Date.now()) {
  const hasConnectedOutput = Math.max(0, Number(state?.metrics?.clients) || 0) > 0;
  if (item && hasConnectedOutput && liveProgramComponentIds(state, nowMs).has(String(componentId || ""))) {
    item.enabled = false;
  }
  return item;
}

function collectLiveComponentGraph(state, componentId, ids) {
  const id = String(componentId || "");
  if (!id || ids.has(id)) return;
  const component = state.components?.find((candidate) => String(candidate.id) === id);
  if (!component) return;
  ids.add(id);
  collectLiveComponentSource(state, component.source, ids);
  collectLiveComponentChain(state, component.chain, ids);
}

function collectLiveComponentChain(state, chain, ids) {
  for (const item of chain || []) {
    if (item.enabled === false) continue;
    if (item.kind === "group") collectLiveComponentChain(state, item.chain, ids);
    else collectLiveComponentSource(state, item.source, ids);
  }
}

function collectLiveComponentSource(state, source, ids) {
  if (source?.type === "component" && source.componentId) {
    collectLiveComponentGraph(state, source.componentId, ids);
  }
}

function latestTimestamp(...values) {
  return values.filter(Boolean).sort().at(-1) || "";
}
