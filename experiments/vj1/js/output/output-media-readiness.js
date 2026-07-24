import { createMediaReadinessStatus, isReadyMediaItem } from "./component-render-state.js?v=canonical-effect-params-1";

export function collectOutputMediaReadiness({
  mode = "output",
  state = null,
  media = new Map(),
  programs = null,
  acquireMedia = null,
} = {}) {
  const status = createMediaReadinessStatus();
  if (mode !== "output" || !state) return status;
  const componentsById = new Map((state.components || []).map((component) => [component.id, component]));
  for (const surface of state.surfaces || []) {
    if (surface.enabled === false || !surface.componentId) continue;
    collectComponentMediaReadiness(
      componentsById.get(surface.componentId),
      status,
      componentsById,
      media,
      programs,
      new Set(),
      acquireMedia,
    );
  }
  status.blocked = status.loadingIds.size > 0 || status.missingIds.size > 0 || status.errorIds.size > 0;
  return status;
}

function collectComponentMediaReadiness(component, status, componentsById, media, programs, visited, acquireMedia) {
  if (!component || !status || visited.has(component.id)) return;
  visited.add(component.id);
  const inspection = programs?.get?.(component.id)?.inspect?.();
  if (!inspection) {
    visited.delete(component.id);
    throw new Error(`VJ1_COMPONENT_PROGRAM_MISSING:${component.id}`);
  }
  for (const mediaId of inspection.mediaDemand.ids) collectMediaIdReadiness(mediaId, status, media, acquireMedia);
  for (const dependencyId of inspection.dependencies.components) {
    collectComponentMediaReadiness(
      componentsById.get(dependencyId),
      status,
      componentsById,
      media,
      programs,
      visited,
      acquireMedia,
    );
  }
  visited.delete(component.id);
}

function collectMediaIdReadiness(mediaId, status, media, acquireMedia) {
  if (status.mediaIds.has(mediaId)) return;
  status.total++;
  status.mediaIds.add(mediaId);
  const item = acquireMedia?.(mediaId) || media.get(mediaId);
  if (!item) {
    status.missingIds.add(mediaId);
    return;
  }
  if (item.loadError || item.imageError || item.modelError) {
    status.errorIds.add(mediaId);
    return;
  }
  if (!isReadyMediaItem(item)) status.loadingIds.add(mediaId);
}
