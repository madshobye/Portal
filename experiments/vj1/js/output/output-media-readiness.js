import { collectMediaIdsFromSource, createMediaReadinessStatus, isReadyMediaItem } from "./component-render-state.js?v=canvas-global-resolution-1";

export function collectOutputMediaReadiness({ mode = "output", state = null, media = new Map(), acquireMedia = null } = {}) {
  const status = createMediaReadinessStatus();
  if (mode !== "output" || !state) return status;
  const componentsById = new Map((state.components || []).map((component) => [component.id, component]));
  for (const surface of state.surfaces || []) {
    if (surface.enabled === false || !surface.componentId) continue;
    collectComponentMediaReadiness(componentsById.get(surface.componentId), status, componentsById, media, new Set(), acquireMedia);
  }
  status.blocked = status.loadingIds.size > 0 || status.missingIds.size > 0 || status.errorIds.size > 0;
  return status;
}

function collectComponentMediaReadiness(component, status, componentsById, media, visited, acquireMedia) {
  if (!component || !status || visited.has(component.id)) return;
  visited.add(component.id);
  collectChainMediaReadiness(component.chain || [], status, componentsById, media, visited, acquireMedia);
  visited.delete(component.id);
}

function collectChainMediaReadiness(chain, status, componentsById, media, visited, acquireMedia) {
  for (const item of chain || []) {
    if (item.enabled === false) continue;
    if (item.kind === "group") {
      collectChainMediaReadiness(item.chain || [], status, componentsById, media, visited, acquireMedia);
      continue;
    }
    if (item.kind === "source" && item.source?.type === "component") {
      collectComponentMediaReadiness(componentsById.get(item.source.componentId), status, componentsById, media, visited, acquireMedia);
    } else if (item.kind === "source") {
      collectSourceMediaReadiness(item.source, status, media, acquireMedia);
    }
  }
}

function collectSourceMediaReadiness(source, status, media, acquireMedia) {
  const mediaIds = new Set();
  collectMediaIdsFromSource(source, mediaIds);
  for (const mediaId of mediaIds) {
    status.total++;
    status.mediaIds.add(mediaId);
    const item = acquireMedia?.(mediaId) || media.get(mediaId);
    if (!item) {
      status.missingIds.add(mediaId);
      continue;
    }
    if (item.loadError || item.imageError || item.modelError) {
      status.errorIds.add(mediaId);
      continue;
    }
    if (!isReadyMediaItem(item)) status.loadingIds.add(mediaId);
  }
}
