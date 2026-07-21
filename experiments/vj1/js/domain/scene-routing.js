import { latestProjectActivity } from "./component-activity.js?v=adaptive-component-demand-29";

export function normalizeProjectionFit(value) {
  return value === "contain" || value === "stretch" ? value : "cover";
}

export function sceneSourceNodeId(componentId = "", frameId = "") {
  return frameId
    ? `recording-frame:${encodeURIComponent(componentId)}:${encodeURIComponent(frameId)}`
    : `component:${encodeURIComponent(componentId)}`;
}

export function sceneSourceNodes(state = {}, { includeSystem = false } = {}) {
  const frames = Array.isArray(state.frames) ? state.frames : [];
  return (state.components || []).filter((component) => includeSystem || !component.systemRole).flatMap((component) => {
    const componentNode = {
      id: sceneSourceNodeId(component.id),
      type: "component",
      name: component.name,
      thumbnail: component.thumbnail || "",
      componentId: component.id,
      outputFrameId: "",
      catalogMarker: component.catalogMarker || 0,
      createdAt: component.activity?.createdAt || "",
      updatedAt: component.activity?.updatedAt || component.activity?.createdAt || "",
      recentAt: latestProjectActivity(component.activity),
    };
    if (component.type !== "scene") return [componentNode];
    return [
      componentNode,
      ...frames.map((frame) => ({
        id: sceneSourceNodeId(component.id, frame.id),
        type: "recording-frame",
        name: `${component.name} · ${frame.name}`,
        thumbnail: component.scene?.frameThumbnails?.[frame.id] || component.thumbnail || "",
        componentId: component.id,
        outputFrameId: frame.id,
        catalogMarker: component.catalogMarker || 0,
        frameId: frame.id,
        createdAt: latestTimestamp(component.activity?.createdAt, frame.activity?.createdAt),
        updatedAt: latestTimestamp(component.activity?.updatedAt, frame.activity?.updatedAt),
        recentAt: Math.max(latestProjectActivity(component.activity), latestProjectActivity(frame.activity)),
      })),
    ];
  });
}

export function resolveSceneSourceNode(state = {}, sourceNodeId = "") {
  // System sources (currently the Mapping test pattern) are runtime nodes but
  // stay out of every user-facing source catalog.
  const nodes = sceneSourceNodes(state, { includeSystem: true });
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

// A Mapping stores a frame slot, not a concrete Scene component. Resolving the
// slot at the Live boundary lets one Mapping drive any Scene without mutating
// the Mapping or recompiling its physical projection geometry.
export function resolveSceneFrameRoute(state = {}, sceneComponent = null, route = {}) {
  if (!sceneComponent || sceneComponent.type !== "scene") return applySceneSourceNode(route, null);
  const frameId = String(route.frameSlotId || route.outputFrameId || state.frames?.[0]?.id || "");
  const frame = state.frames?.find((candidate) => String(candidate.id) === frameId);
  if (!frameId || !frame) {
    return applySceneSourceNode(route, null);
  }
  const frameConfig = sceneComponent.scene?.frames?.find((candidate) => String(candidate.frameId) === frameId) || {};
  const componentId = state.components?.some((component) => String(component.id) === String(frameConfig.componentId || ""))
    ? String(frameConfig.componentId)
    : sceneComponent.id;
  return {
    ...applySceneSourceNode(route, {
    id: sceneSourceNodeId(componentId, componentId === sceneComponent.id ? frameId : ""),
    componentId,
    outputFrameId: componentId === sceneComponent.id ? frameId : "",
    }),
    frameSlotId: frameId,
    frameFit: frameConfig.fit || frame.fit || "cover",
    frameFitActive: componentId !== sceneComponent.id,
    frameAspect: Math.max(0.0001,
      (Number(state.render?.sceneAspectRatio) || 16 / 9) *
      (Math.max(0.0001, Number(frame.width) || 1) / Math.max(0.0001, Number(frame.height) || 1))
    ),
  };
}

export function materializeSceneSurfaceRoutes(state = {}, sceneComponent = null, mapping = null) {
  return {
    surfaces: (mapping?.surfaces || state.surfaces || []).map((surface) =>
      resolveSceneFrameRoute(state, sceneComponent, surface)
    ),
  };
}

// Live can put either a Scene or an ordinary Component on air. Scenes retain
// their authored per-Frame routing. A standalone Component is sampled through
// each Mapping Frame with one explicit cover crop; the physical Surface fit
// remains a later, independent projection stage.
export function materializeLiveTargetSurfaceRoutes(state = {}, target = null, mapping = null) {
  if (!target) return { surfaces: [] };
  if (target.type === "scene") return materializeSceneSurfaceRoutes(state, target, mapping);
  const surfaces = mapping?.surfaces || state.surfaces || [];
  return {
    surfaces: surfaces.map((surface) => {
      const frameId = String(surface.frameSlotId || surface.outputFrameId || state.frames?.[0]?.id || "");
      const frame = state.frames?.find((candidate) => String(candidate.id) === frameId);
      if (!frame) return applySceneSourceNode(surface, null);
      return {
        ...applySceneSourceNode(surface, {
          id: sceneSourceNodeId(target.id),
          componentId: target.id,
          outputFrameId: "",
        }),
        frameSlotId: frameId,
        frameFit: "cover",
        frameFitActive: true,
        frameAspect: Math.max(0.0001,
          (Number(state.render?.sceneAspectRatio) || 16 / 9) *
          (Math.max(0.0001, Number(frame.width) || 1) / Math.max(0.0001, Number(frame.height) || 1))
        ),
      };
    }),
  };
}

export function liveProgramComponentIds(state = {}, nowMs = Date.now()) {
  const ids = new Set();
  const live = state.ui?.live || {};
  const routeStates = [live.surfaceRoutes].filter(Boolean);
  const transition = live.transition;
  const transitionStartedAt = Number(transition?.startedAtMs) || 0;
  const transitionDuration = Math.max(0, Number(transition?.durationMs) || 0);
  if (
    transition?.fromSurfaceRoutes &&
    transitionStartedAt > 0 &&
    Number(nowMs) < transitionStartedAt + transitionDuration
  ) {
    routeStates.push(transition.fromSurfaceRoutes);
  }
  for (const routeState of routeStates) {
    for (const surface of routeState?.surfaces || []) {
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
  collectLiveComponentChain(state, component.chain || [], ids);
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
