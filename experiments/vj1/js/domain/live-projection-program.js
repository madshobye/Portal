import {
  materializeLiveProgramSurfaceRoutes,
  rebaseSurfaceRouteProgram,
} from "./scene-routing.js";

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
  const currentRoutes = mapping
    ? materializeLiveProgramSurfaceRoutes(state, target, mapping)
    : EMPTY_ROUTES;
  const transition = compileTransition(state, live, target, mapping, currentRoutes, now);
  const previewSurfaceId = String(live.previewSurfaceId || "__mapping__");

  return Object.freeze({
    live,
    mapping,
    scene,
    target,
    currentRoutes,
    previewSurfaceId,
    sceneMappingVisible: live.sceneMappingVisible !== false,
    transition,
    previewTransition: transition && transitionAppliesToPreview(
      transition,
      previewSurfaceId,
      live.sceneMappingVisible !== false
    ) ? transition : null,
  });
}

function compileTransition(state, live, target, mapping, currentRoutes, now) {
  const authored = live.transition;
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

  return Object.freeze({
    id: String(authored.id || `${previousTargetId || "empty"}:${target?.id || "empty"}:${startedAtMs}`),
    scope: authored.surfaceId ? "surface" : "overall",
    surfaceId: String(authored.surfaceId || ""),
    previousTarget,
    previousRoutes,
    previousComponentOverrides: authored.fromComponentOverrides || {},
    currentComponentOverrides: live.componentOverrides || {},
    componentsShared: JSON.stringify(authored.fromComponentOverrides || {}) === JSON.stringify(live.componentOverrides || {}),
    transitionId: String(live.transitionId || "vj1.transition.dissolve"),
    transitionParameters: live.transitionParameters && typeof live.transitionParameters === "object"
      ? Object.freeze({ ...live.transitionParameters })
      : Object.freeze({}),
    startedAtMs,
    durationMs,
  });
}

function transitionAppliesToPreview(transition, previewSurfaceId, sceneMappingVisible) {
  if (previewSurfaceId === "__mapping__") {
    return sceneMappingVisible && transition.scope === "overall";
  }
  return true;
}
