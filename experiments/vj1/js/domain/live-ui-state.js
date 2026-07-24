export function resetSceneMappingSession(live = {}) {
  const next = { ...(live || {}) };
  delete next.sceneMappingVisible;
  return next;
}

export function firstEnabledLiveSurfaceId(mapping = null, live = {}) {
  const surface = (mapping?.surfaces || []).find((candidate) => {
    const surfaceId = String(candidate?.id || "");
    if (!surfaceId) return false;
    const visibility = live.surfaceVisibility?.[surfaceId];
    const patched = Boolean(live.surfacePatches?.[surfaceId]);
    const enabled = typeof visibility === "boolean"
      ? visibility
      : patched || candidate.enabled !== false;
    if (!enabled) return false;
    if (live.sceneMappingVisible !== false) return true;
    return candidate.destination?.type === "direct" || patched || visibility === true;
  });
  return String(surface?.id || "");
}
