import { latestProjectActivity } from "./component-activity.js?v=adaptive-component-demand-29";

// These fields belong to a compiled Surface route, not to the authored
// Mapping Surface. Keeping the list beside the route materializer gives model
// normalization and project serialization one shared ownership contract.
export const SURFACE_ROUTE_DERIVED_KEYS = Object.freeze([
  "sourceNodeId",
  "componentId",
  "sceneCrop",
  "sourceFit",
  "sourceFitActive",
  "sourceAspect",
]);

export function authoredSurfaceFields(surface = {}) {
  const authored = { ...(surface || {}) };
  for (const key of SURFACE_ROUTE_DERIVED_KEYS) delete authored[key];
  return authored;
}

// A transition snapshot owns its previous route bindings, but never owns the
// physical Surface geometry. Rebase only compiled route fields onto the
// current authored rectangles so both compositor endpoints use one placement
// contract even while Mapping is edited during a transition.
export function rebaseSurfaceRouteProgram(previousRoutes = [], currentRoutes = []) {
  const previousById = new Map((previousRoutes || []).map((surface) => [String(surface?.id || ""), surface]));
  // A transition snapshot owns the presentation contract which was visible
  // immediately before the transition as well as its compiled source binding.
  // `projectionFit` is normally authored by the physical Surface, but a Live
  // matrix patch deliberately replaces it with `cover`. Rebasing the previous
  // route onto that target route without retaining its fit makes a `contain`
  // source jump to `cover` on the first transition frame (progress zero).
  const routeKeys = ["enabled", "projectionFit", ...SURFACE_ROUTE_DERIVED_KEYS];
  return (currentRoutes || []).map((current) => {
    const route = { ...(current || {}) };
    const previous = previousById.get(String(current?.id || ""));
    if (!previous) return route;
    for (const key of routeKeys) {
      if (Object.prototype.hasOwnProperty.call(previous, key)) route[key] = previous[key];
      else delete route[key];
    }
    return route;
  });
}

export function normalizeProjectionFit(value) {
  return value === "contain" || value === "stretch" ? value : "cover";
}

export function sceneSourceNodeId(componentId = "") {
  return `component:${encodeURIComponent(componentId)}`;
}

export function sceneSourceNodes(state = {}, { includeSystem = false } = {}) {
  return (state.components || []).filter((component) => includeSystem || !component.systemRole).map((component) => ({
      id: sceneSourceNodeId(component.id),
      type: "component",
      name: component.name,
      thumbnail: component.thumbnail || "",
      componentId: component.id,
      catalogMarker: component.catalogMarker || 0,
      createdAt: component.activity?.createdAt || "",
      updatedAt: component.activity?.updatedAt || component.activity?.createdAt || "",
      recentAt: latestProjectActivity(component.activity),
    }));
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
    sceneCrop: false,
  };
}

// Surface visibility is owned by the routes which actually consume a Surface.
export function visibleSceneSurfaceIds(surfaces = []) {
  return new Set((surfaces || []).flatMap((surface) => {
    if (surface?.enabled === false) return [];
    const surfaceId = String(surface?.id || "");
    return surfaceId ? [surfaceId] : [];
  }));
}

// A Surface is both the Scene-space crop and the physical projection route.
// Materialization adds only the current Scene source; it never looks through a
// second crop inventory or per-Scene routing table.
export function resolveSceneSurfaceRoute(state = {}, sceneComponent = null, route = {}) {
  if (!sceneComponent || sceneComponent.type !== "scene") return applySceneSourceNode(route, null);
  const surfaceId = String(route.id || "");
  if (!surfaceId) return applySceneSourceNode(route, null);
  return {
    ...applySceneSourceNode(route, {
      id: sceneSourceNodeId(sceneComponent.id),
      componentId: sceneComponent.id,
    }),
    sceneCrop: true,
    sourceFit: route.projectionFit || "cover",
    sourceFitActive: false,
    sourceAspect: Math.max(0.0001,
      (Number(state.render?.sceneAspectRatio) || 16 / 9) *
      (Math.max(0.0001, Number(route.width) || 1) / Math.max(0.0001, Number(route.height) || 1))
    ),
  };
}

export function materializeSceneSurfaceRoutes(state = {}, sceneComponent = null, mapping = null) {
  return {
    surfaces: (mapping?.surfaces || state.surfaces || []).map((surface) =>
      resolveSceneSurfaceRoute(state, sceneComponent, surface)
    ),
  };
}

// Live can put either a Scene or an ordinary Component on air. An ordinary
// Component selected at Overall is treated as one virtual Scene: it covers the
// Scene coordinate space once, then every Surface samples its own rectangle
// from that shared space. It must not be independently fitted into every
// Surface, because that repeats the whole Component instead of preserving the
// authored Surface relationship.
export function materializeLiveTargetSurfaceRoutes(state = {}, target = null, mapping = null) {
  if (!target) return { surfaces: [] };
  if (target.type === "scene") return materializeSceneSurfaceRoutes(state, target, mapping);
  const surfaces = mapping?.surfaces || state.surfaces || [];
  return {
    surfaces: surfaces.map((surface) => ({
        ...applySceneSourceNode(surface, {
          id: sceneSourceNodeId(target.id),
          componentId: target.id,
        }),
        sceneCrop: true,
        sourceFit: "cover",
        sourceFitActive: false,
        sourceAspect: Math.max(0.0001,
          (Number(state.render?.sceneAspectRatio) || 16 / 9) *
          (Math.max(0.0001, Number(surface.width) || 1) / Math.max(0.0001, Number(surface.height) || 1))
        ),
      })),
  };
}

// An individual Live Surface patch is an explicit source assignment. A Scene
// selected here means the complete Scene component, not the Scene-space crop
// represented by this Surface. Overall Live selection continues to use
// materializeLiveTargetSurfaceRoutes() and retains the Scene's Surface routing.
export function materializeLiveSurfacePatchRoute(state = {}, target = null, mapping = null, surfaceId = "") {
  if (!target || !surfaceId) return null;
  const surface = (mapping?.surfaces || state.surfaces || [])
    .find((candidate) => String(candidate.id) === String(surfaceId));
  if (!surface) return null;
  // A matrix-cell patch replaces the source at this Surface. It is not an
  // Overall Scene substitution, so it must never inherit the Scene crop
  // represented by the Surface rectangle. The Surface's projectionFit remains the
  // single cover/contain/stretch stage for this direct Component or Scene.
  return {
    ...applySceneSourceNode(surface, {
      id: sceneSourceNodeId(target.id),
      componentId: target.id,
    }),
    sceneCrop: false,
    sourceFit: "cover",
    // A cell patch feeds the complete source directly to this projection.
    // projectionFit is the sole fit stage; enabling sourceFit here derived a
    // second crop from the Surface rectangle and disagreed with the settled
    // route after a transition.
    sourceFitActive: false,
    sourceAspect: 1,
    // A matrix patch replaces the complete destination rather than adopting
    // the authored fit of the previous Overall route. Keep exactly one fit
    // stage and make that physical projection stage cover the destination.
    projectionFit: "cover",
  };
}

// Build the complete Live projection program from authored authorities. The
// Mapping owns Surface geometry, Overall owns the base source, and the Live
// matrix owns only explicit per-Surface patches and visibility. Keeping this
// derivation here prevents a Mapping/output reconciliation from replacing the
// routed program with bare Surfaces that have no source assignment.
export function materializeLiveProgramSurfaceRoutes(state = {}, target = null, mapping = null) {
  if (!mapping) return { surfaces: [] };
  const routeState = target
    ? materializeLiveTargetSurfaceRoutes(state, target, mapping)
    : materializeSceneSurfaceRoutes(state, null, mapping);
  const live = state.ui?.live || {};
  const patchedSurfaceIds = new Set();
  for (const [surfaceId, targetId] of Object.entries(live.surfacePatches || {})) {
    const patchTarget = state.components?.find((component) =>
      !component.systemRole && String(component.id) === String(targetId)
    );
    if (!patchTarget) continue;
    const patchRoute = materializeLiveSurfacePatchRoute(state, patchTarget, mapping, surfaceId);
    if (!patchRoute) continue;
    const index = routeState.surfaces.findIndex((surface) => String(surface.id) === String(surfaceId));
    if (index >= 0) {
      routeState.surfaces[index] = { ...patchRoute, enabled: true };
      patchedSurfaceIds.add(String(surfaceId));
    }
  }
  for (const [surfaceId, visible] of Object.entries(live.surfaceVisibility || {})) {
    const index = routeState.surfaces.findIndex((surface) => String(surface.id) === String(surfaceId));
    if (index >= 0) routeState.surfaces[index] = { ...routeState.surfaces[index], enabled: visible !== false };
  }
  // Scene Mapping supplies the default Overall route, but it is not a master
  // switch for the projection matrix. A patched Surface or an explicitly
  // visible Surface remains independently routable while Overall is hidden.
  // This route-level rule is shared by the embedded monitor and Output windows.
  if (live.sceneMappingVisible === false) {
    routeState.surfaces = routeState.surfaces.map((surface) => {
      const surfaceId = String(surface.id || "");
      const independentlyVisible = patchedSurfaceIds.has(surfaceId) ||
        live.surfaceVisibility?.[surfaceId] === true;
      return independentlyVisible ? surface : { ...surface, enabled: false };
    });
  }
  applyDirectOutputPatchPrecedence(routeState.surfaces, live.surfacePatches || {});
  return routeState;
}

// Direct-output Surfaces are a hierarchy: the spanning "Full surface" route
// is the group destination and each single-output route is a more specific
// override. When the group has an explicit Live patch, unpatched children
// must become transparent or their automatically materialized Overall source
// would cover the group after the transition texture is released. A child
// with its own explicit patch remains enabled and wins only on that output.
function applyDirectOutputPatchPrecedence(surfaces = [], patches = {}) {
  const direct = (surfaces || []).filter((surface) => surface?.destination?.type === "direct");
  const group = direct.find((surface) => (surface.destination?.outputIds?.length || 0) > 1);
  if (!group || !patches[String(group.id || "")]) return;
  for (const surface of direct) {
    if (surface === group || (surface.destination?.outputIds?.length || 0) !== 1) continue;
    if (patches[String(surface.id || "")]) continue;
    surface.enabled = false;
  }
}

export function liveProgramComponentIds(state = {}, nowMs = Date.now()) {
  const ids = new Set();
  const live = state.ui?.live || {};
  const mapping = state.mappings?.find((item) => String(item.id) === String(state.ui?.selectedMappingId || ""))
    || state.mappings?.[0]
    || null;
  const targetId = String(live.selectedComponentId || live.selectedSceneId || "");
  const target = state.components?.find((component) =>
    !component.systemRole && String(component.id) === targetId
  );
  // This is the same route authority used by createLiveRenderState: an
  // explicitly mixed Live program wins; otherwise materialize the current
  // Overall source through the selected Mapping.
  const currentRoutes = mapping
    ? materializeLiveProgramSurfaceRoutes(state, target || null, mapping)
    : null;
  const routeStates = [currentRoutes].filter(Boolean);
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
