export function resetSceneMappingSession(live = {}) {
  const next = { ...(live || {}) };
  delete next.sceneMappingVisible;
  return next;
}

// A matrix row's eye is authored independently from its resolved route. The
// route may be transparent because Scene Mapping fallback is disabled; that
// must not make the row itself look disabled or invert its next toggle.
export function liveSurfaceVisible(surface = null, live = {}) {
  if (!surface) return false;
  const surfaceId = String(surface.id || "");
  const visibility = live.surfaceVisibility?.[surfaceId];
  if (typeof visibility === "boolean") return visibility;
  return Boolean(live.surfacePatches?.[surfaceId]) || surface.enabled !== false;
}

export function firstEnabledLiveSurfaceId(mapping = null, live = {}) {
  const surface = (mapping?.surfaces || []).find((candidate) => {
    const surfaceId = String(candidate?.id || "");
    if (!surfaceId) return false;
    const visibility = live.surfaceVisibility?.[surfaceId];
    const patched = Boolean(live.surfacePatches?.[surfaceId]);
    const enabled = liveSurfaceVisible(candidate, live);
    if (!enabled) return false;
    if (live.sceneMappingVisible !== false) return true;
    return candidate.destination?.type === "direct" || patched || visibility === true;
  });
  return String(surface?.id || "");
}
