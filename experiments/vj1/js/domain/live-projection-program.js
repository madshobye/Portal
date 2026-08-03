import {
  materializeLiveProgramSurfaceRoutes,
} from "./scene-routing.js";
import { activeLiveTransitions } from "./live-transition-coordinator.js";
import { liveParameterDiffBank } from "./live-parameter-diffs.js";

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
    .map((authored) => compileTransition(live, target, mapping, authored, now))
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

function compileTransition(live, target, mapping, authored, now) {
  const durationMs = Math.max(0, Number(authored?.durationMs) || 0);
  const startedAtMs = Number(authored?.startedAtMs) || 0;
  if (!mapping
    || (live.sceneMappingVisible === false && !authored?.surfaceId)
    || durationMs <= 0
    || startedAtMs <= 0
    || startedAtMs + durationMs <= now) return null;

  // The renderer owns the retained outgoing branch. This projection resolves
  // only the incoming target so parameter changes made after scheduling remain
  // visible instead of being replaced by scheduling-time values. `toTargetId`
  // also keeps a queued target isolated from a later selection.
  const currentTargetId = String(authored.toTargetId || target?.id || "");
  const currentComponentOverrides = currentTargetId
    ? liveParameterDiffBank(live, currentTargetId)
    : liveParameterDiffBank(live);
  return Object.freeze({
    id: String(authored.id || `${authored.fromTargetId || "empty"}:${target?.id || "empty"}:${startedAtMs}`),
    scope: authored.surfaceId ? "surface" : "overall",
    surfaceId: String(authored.surfaceId || ""),
    fromTargetId: String(authored.fromTargetId || ""),
    toTargetId: currentTargetId,
    currentComponentOverrides,
    transitionId: String(authored.transitionId || live.transitionId || "vj1.transition.dissolve"),
    transitionParameters: authored.transitionParameters && typeof authored.transitionParameters === "object"
      ? Object.freeze({ ...authored.transitionParameters })
      : Object.freeze({}),
    startedAtMs,
    durationMs,
  });
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
