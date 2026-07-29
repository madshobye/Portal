import {
  materializeLiveProgramSurfaceRoutes,
  rebaseSurfaceRouteProgram,
} from "./scene-routing.js";
import { activeLiveTransitions } from "./live-transition-coordinator.js";

const EMPTY_ROUTES = Object.freeze({ surfaces: Object.freeze([]) });

// LiveProjectionProgram is the runtime route contract shared by the Output
// renderer and the embedded Live monitor. It resolves selection, Mapping
// authority, current routes, and the previous transition endpoint once. The
// two clients may present that program differently, but may not independently
// reconstruct its routing or transition semantics.
export function compileLiveProjectionProgram(state = {}, now = Date.now()) {
  const live = state.ui?.live || {};
  const mapping = state.mappings?.find((item) => String(item.id) === String(state.ui?.selectedMappingId || ""))
    || state.mappings?.[0]
    || null;
  const scene = live.overallSourceCleared === true
    ? null
    : state.components?.find((item) => item.type === "scene" && String(item.id) === String(live.selectedSceneId || ""))
      || null;
  const explicitTarget = live.overallSourceCleared === true
    ? null
    : state.components?.find((item) => !item.systemRole && String(item.id) === String(live.selectedComponentId || ""))
      || null;
  const target = explicitTarget || scene;
  const logicalRoutes = mapping
    ? materializeLiveProgramSurfaceRoutes(state, target, mapping)
    : EMPTY_ROUTES;
  const authoredTransitions = activeLiveTransitions(live, now).filter(
    (transition) => live.sceneMappingVisible !== false || !!transition.surfaceId
  );
  const currentRoutes = presentedRoutes(logicalRoutes, authoredTransitions);
  const transitions = authoredTransitions
    .map((authored) => compileTransition(state, live, target, mapping, currentRoutes, authored, now))
    .filter(Boolean);
  const previewSurfaceId = String(live.previewSurfaceId || "__mapping__");
  const previewTransitions = transitions.filter((transition) => transitionAppliesToPreview(
    transition,
    previewSurfaceId,
    live.sceneMappingVisible !== false
  ));

  return Object.freeze({
    live,
    mapping,
    scene,
    target,
    logicalRoutes,
    currentRoutes,
    previewSurfaceId,
    sceneMappingVisible: live.sceneMappingVisible !== false,
    transitions: Object.freeze(transitions),
    transition: transitions[0] || null,
    previewTransitions: Object.freeze(previewTransitions),
    previewTransition: previewTransitions[0] || null,
  });
}

function compileTransition(state, live, target, mapping, currentRoutes, authored, now) {
  const durationMs = Math.max(0, Number(authored?.durationMs) || 0);
  const startedAtMs = Number(authored?.startedAtMs) || 0;
  if (!mapping
    || !authored?.fromSurfaceRoutes
    || (live.sceneMappingVisible === false && !authored?.surfaceId)
    || durationMs <= 0
    || startedAtMs <= 0
    || startedAtMs + durationMs <= now) return null;

  const previousTargetId = String(authored.fromTargetId || authored.fromSceneId || "");
  const previousTarget = state.components?.find((item) =>
    !item.systemRole && String(item.id) === previousTargetId
  ) || null;
  const previousRoutes = {
    surfaces: rebaseSurfaceRouteProgram(
      authored.fromSurfaceRoutes.surfaces,
      currentRoutes.surfaces
    ),
  };
  const currentComponentOverrides =
    authored.toComponentOverrides || live.componentOverrides || {};
  const componentConfigurationIds = changedComponentOverrideIds(
    authored.fromComponentOverrides || {},
    currentComponentOverrides,
  );

  return Object.freeze({
    id: String(authored.id || `${previousTargetId || "empty"}:${target?.id || "empty"}:${startedAtMs}`),
    scope: authored.surfaceId ? "surface" : "overall",
    surfaceId: String(authored.surfaceId || ""),
    previousTarget,
    previousRoutes,
    previousComponentOverrides: authored.fromComponentOverrides || {},
    currentComponentOverrides,
    componentConfigurationIds,
    componentsShared: componentConfigurationIds.length === 0,
    transitionId: String(authored.transitionId || live.transitionId || "vj1.transition.dissolve"),
    transitionParameters: authored.transitionParameters && typeof authored.transitionParameters === "object"
      ? Object.freeze({ ...authored.transitionParameters })
      : Object.freeze({}),
    startedAtMs,
    durationMs,
  });
}

function changedComponentOverrideIds(previous = {}, current = {}) {
  const ids = new Set([
    ...Object.keys(previous || {}),
    ...Object.keys(current || {}),
  ]);
  return Object.freeze([...ids].filter((id) =>
    JSON.stringify(previous?.[id] || {}) !== JSON.stringify(current?.[id] || {})
  ));
}

function transitionAppliesToPreview(transition, previewSurfaceId, sceneMappingVisible) {
  if (previewSurfaceId === "__mapping__") {
    return sceneMappingVisible && transition.scope === "overall";
  }
  return transition.scope === "overall" || transition.surfaceId === previewSurfaceId;
}

function presentedRoutes(logicalRoutes, transitions) {
  const overall = transitions.find((transition) => !transition.surfaceId);
  if (overall?.toSurfaceRoutes?.surfaces) return overall.toSurfaceRoutes;
  if (!transitions.length) return logicalRoutes;
  const replacementById = new Map();
  for (const transition of transitions) {
    const surfaceId = String(transition.surfaceId || "");
    if (!surfaceId) continue;
    const route = transition.toSurfaceRoutes?.surfaces?.find(
      (candidate) => String(candidate.id) === surfaceId
    );
    if (route) replacementById.set(surfaceId, route);
  }
  return {
    surfaces: logicalRoutes.surfaces.map((route) =>
      replacementById.get(String(route.id)) || route
    ),
  };
}
