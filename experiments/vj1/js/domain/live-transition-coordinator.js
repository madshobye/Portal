const OVERALL_DESTINATION = "overall";

export function liveTransitionDestination(surfaceId = "") {
  const id = String(surfaceId || "");
  return id ? `surface:${id}` : OVERALL_DESTINATION;
}

export function activeLiveTransitions(live = {}, nowMs = Date.now()) {
  const coordinator = live.transitionCoordinator || {};
  const active = Object.entries(coordinator)
    .map(([destination, lane]) => ({ destination, ...lane?.active }))
    .filter((transition) => liveTransitionIsActive(transition, nowMs))
    .sort((a, b) => String(a.destination).localeCompare(String(b.destination)));
  if (active.length) return active;
  const legacy = live.transition;
  const startedAtMs = Number(legacy?.startedAtMs) || 0;
  const durationMs = Math.max(0, Number(legacy?.durationMs) || 0);
  return legacy?.fromSurfaceRoutes && startedAtMs > 0 && Number(nowMs) < startedAtMs + durationMs
    ? [{ destination: liveTransitionDestination(legacy.surfaceId), ...legacy }]
    : [];
}

export function nextLiveTransitionDeadline(live = {}, nowMs = Date.now()) {
  let deadline = 0;
  for (const transition of activeLiveTransitions(live, nowMs)) {
    const candidate = Number(transition.startedAtMs) + Number(transition.durationMs);
    if (!deadline || candidate < deadline) deadline = candidate;
  }
  return deadline;
}

export function advanceLiveTransitionCoordinator(live = {}, nowMs = Date.now()) {
  const coordinator = live.transitionCoordinator ||= {};
  let changed = false;
  for (const [destination, lane] of Object.entries(coordinator)) {
    if (lane?.active && !liveTransitionIsActive(lane.active, nowMs)) {
      delete lane.active;
      changed = true;
    }
    if (!lane?.active && !lane?.pending) {
      delete coordinator[destination];
      changed = true;
    }
  }

  const overall = coordinator[OVERALL_DESTINATION];
  const hasActiveSurface = Object.entries(coordinator).some(
    ([destination, lane]) => destination !== OVERALL_DESTINATION && liveTransitionIsActive(lane?.active, nowMs),
  );
  if (overall?.pending && !overall.active && !hasActiveSurface) {
    overall.active = startTransition(overall.pending, nowMs);
    delete overall.pending;
    changed = true;
  }

  const overallActive = liveTransitionIsActive(coordinator[OVERALL_DESTINATION]?.active, nowMs);
  if (!overallActive) {
    for (const [destination, lane] of Object.entries(coordinator)) {
      if (destination === OVERALL_DESTINATION || lane?.active || !lane?.pending) continue;
      lane.active = startTransition(lane.pending, nowMs);
      delete lane.pending;
      changed = true;
    }
  }
  syncLegacyTransition(live, nowMs);
  return changed;
}

export function scheduleLiveTransition(live = {}, transition = {}, nowMs = Date.now()) {
  advanceLiveTransitionCoordinator(live, nowMs);
  const destination = liveTransitionDestination(transition.surfaceId);
  const coordinator = live.transitionCoordinator ||= {};
  const lane = coordinator[destination] ||= {};
  const descriptor = {
    ...transition,
    destination,
    surfaceId: String(transition.surfaceId || ""),
    startedAtMs: 0,
  };
  const overallActive = liveTransitionIsActive(coordinator[OVERALL_DESTINATION]?.active, nowMs);
  const anotherDestinationActive = destination === OVERALL_DESTINATION && Object.entries(coordinator).some(
    ([key, candidate]) => key !== OVERALL_DESTINATION && liveTransitionIsActive(candidate?.active, nowMs),
  );
  if (liveTransitionIsActive(lane.active, nowMs) || overallActive || anotherDestinationActive) {
    // The lane has room for one armed command, not an invisible chain. A
    // later press replaces the armed target but keeps the endpoint that will
    // actually be visible when this next transition starts.
    const previousEndpoint = lane.active?.toSurfaceRoutes
      || lane.pending?.fromSurfaceRoutes;
    lane.pending = {
      ...descriptor,
      fromSurfaceRoutes: previousEndpoint || descriptor.fromSurfaceRoutes,
      fromComponentOverrides: lane.active?.toComponentOverrides
        || lane.pending?.fromComponentOverrides
        || descriptor.fromComponentOverrides,
    };
  } else {
    lane.active = startTransition(descriptor, nowMs);
    delete lane.pending;
  }
  syncLegacyTransition(live, nowMs);
  return lane;
}

export function clearLiveTransitionCoordinator(live = {}) {
  live.transitionCoordinator = {};
  live.transition = null;
}

export function liveTransitionIsActive(transition = null, nowMs = Date.now()) {
  const startedAtMs = Number(transition?.startedAtMs) || 0;
  const durationMs = Math.max(0, Number(transition?.durationMs) || 0);
  return !!transition?.fromSurfaceRoutes
    && startedAtMs > 0
    && durationMs > 0
    && Number(nowMs) < startedAtMs + durationMs;
}

function startTransition(transition, nowMs) {
  return {
    ...transition,
    startedAtMs: Number(nowMs) + 50,
  };
}

function syncLegacyTransition(live, nowMs) {
  // Retain the singular field as a compatibility/readability projection while
  // all scheduling authority lives in the destination coordinator.
  live.transition = activeLiveTransitions(live, nowMs)[0] || null;
}
