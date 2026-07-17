import { VJ1 } from "../constants.js";
import { isDrawableMedia } from "./media-utils.js?v=render-diagnostics-1";

export function renderBufferKey(...parts) {
  return parts.map((part) => String(part)).join(":");
}

export function staticComponentGraphState(component = {}, components = [], seen = new Set()) {
  if (!component?.id || seen.has(component.id)) return { id: component?.id || "", cycle: true };
  const nextSeen = new Set(seen);
  nextSeen.add(component.id);
  const dependencies = Array.from(componentDependencyIds(component))
    .sort()
    .map((id) => staticComponentGraphState(
      components.find((item) => item.id === id) || { id, missing: true },
      components,
      nextSeen
    ));
  return { ...staticComponentState(component), dependencies };
}

export function staticComponentGraphMediaState(media = [], component = {}, components = [], seen = new Set()) {
  const ids = new Set();
  collectComponentGraphMediaIds(component, components, ids, seen);
  return staticMediaStateForIds(media, ids);
}

export function runtimeComponentGraphMediaState(media = new Map(), component = {}, components = [], seen = new Set()) {
  const ids = new Set();
  collectComponentGraphMediaIds(component, components, ids, seen);
  return runtimeMediaStateForIds(media, ids);
}

export function staticMediaStateForSource(media = [], source = {}) {
  const ids = new Set();
  collectMediaIdsFromSource(source, ids);
  return staticMediaStateForIds(media, ids);
}

export function runtimeMediaStateForSource(media = new Map(), source = {}) {
  const ids = new Set();
  collectMediaIdsFromSource(source, ids);
  if (!ids.size) return null;
  return runtimeMediaStateForIds(media, ids);
}

function runtimeMediaStateForIds(media = new Map(), ids = new Set()) {
  return Array.from(ids).sort().map((id) => {
    const item = media?.get?.(id);
    if (!item) return { id, present: false, ready: false, revision: 0, error: "" };
    return {
      id,
      present: true,
      ready: isReadyMediaItem(item),
      revision: Math.max(0, Number(item.revision) || 0),
      fileKey: item.fileKey || "",
      error: item.loadError || item.imageError || item.modelError || "",
      kind: item.video ? "video" : item.image ? "image" : (item.model || item.modelData) ? "model" : "loading",
    };
  });
}

export function chainLayerState(item = {}) {
  return {
    enabled: item.enabled !== false,
    transform: item.transform || {},
    opacity: item.opacity ?? 1,
    blend: item.blend || "normal",
  };
}

export function componentRuntimeTimeKey(component, params = {}, context = {}) {
  if (component?.runtime?.cacheable === false) return context.frame;
  if (!component?.runtime?.timeDependent?.(params)) return null;
  return component.runtime.timeKey?.(params, context) ?? context.time;
}

export function collectMediaIdsFromSource(source = {}, ids = new Set()) {
  if (source?.type === "media" && source.mediaId) ids.add(source.mediaId);
  if (source?.type === "generator" && (source.generatorId === "featureMorph" || source.generatorId === "featureMorphV2")) {
    if (source.params?.imageAId) ids.add(source.params.imageAId);
    if (source.params?.imageBId) ids.add(source.params.imageBId);
  }
  if (source?.type === "generator" && source.generatorId === "tileTexture" && source.params?.imageId) {
    ids.add(source.params.imageId);
  }
  return ids;
}

export function createMediaReadinessStatus() {
  return {
    blocked: false,
    total: 0,
    loadingIds: new Set(),
    missingIds: new Set(),
    errorIds: new Set(),
  };
}

export function isReadyMediaItem(item = {}) {
  if (!item || item.loadError) return false;
  if (item.video) return isDrawableMedia(item.video);
  if (item.image) return isDrawableMedia(item.image);
  if (item.model || item.modelData) return true;
  return item.ready === true;
}

function staticComponentState(component = {}) {
  return {
    id: component.id || "",
    type: component.type || "component",
    frameShape: component.frameShape || "landscape",
    resolutionScale: Number(component.resolutionScale) || 1,
    canvas: component.type === "canvas" ? {
      width: Math.max(1, Number(component.canvas?.width) || VJ1.canvasWidth),
      height: Math.max(1, Number(component.canvas?.height) || VJ1.canvasHeight),
    } : null,
    source: staticSourceState(component.source),
    shaderChain: staticEffectChainState(component.shaderChain || []),
    chain: staticChainState(component.chain || []),
  };
}

function collectComponentGraphMediaIds(component = {}, components = [], ids = new Set(), seen = new Set()) {
  if (!component?.id || seen.has(component.id)) return ids;
  seen.add(component.id);
  collectMediaIdsFromSource(component.source, ids);
  collectMediaIdsFromChain(component.chain || [], ids);
  for (const dependencyId of componentDependencyIds(component)) {
    const dependency = components.find((item) => item.id === dependencyId);
    if (dependency) collectComponentGraphMediaIds(dependency, components, ids, seen);
  }
  return ids;
}

function componentDependencyIds(component = {}) {
  const ids = new Set();
  collectComponentIdsFromSource(component.source, ids);
  collectComponentIdsFromChain(component.chain || [], ids);
  return ids;
}

function staticChainState(chain = []) {
  return (chain || []).map((item) => {
    if (item.kind === "group") {
      return {
        id: item.id || "",
        kind: "group",
        enabled: item.enabled !== false,
        transform: item.transform || {},
        opacity: item.opacity ?? 1,
        blend: item.blend || "normal",
        role: item.role || "group",
        layout: item.layout || {},
        chain: staticChainState(item.chain || []),
      };
    }
    if (item.kind === "effect") {
      return {
        id: item.id || "",
        kind: "effect",
        enabled: item.enabled !== false,
        componentId: item.componentId || "",
        amount: item.amount,
        params: item.params || {},
        transform: item.transform || {},
      };
    }
    return {
      id: item.id || "",
      kind: item.kind || "source",
      enabled: item.enabled !== false,
      source: staticSourceState(item.source),
      params: item.params || {},
      transform: item.transform || {},
      opacity: item.opacity ?? 1,
      blend: item.blend || "normal",
    };
  });
}

function staticEffectChainState(chain = []) {
  return (chain || []).map((pass) => ({
    id: pass.id || pass.componentId || "",
    enabled: pass.enabled !== false,
    amount: pass.amount,
    params: pass.params || {},
    transform: pass.transform || {},
  }));
}

export function staticSourceState(source = {}) {
  return {
    type: source.type || "black",
    mediaId: source.mediaId || "",
    componentId: source.componentId || "",
    generatorId: source.generatorId || "",
    start: source.start,
    end: source.end,
    speed: source.speed,
    params: source.params || {},
    placement: source.placement || null,
    contentTransform: source.contentTransform || {},
  };
}

function staticMediaStateForIds(media = [], ids = new Set()) {
  return (media || [])
    .filter((item) => ids.has(item.id))
    .map((item) => ({ id: item.id || "", path: item.path || "", type: item.type || "", size: item.size || 0 }));
}

function collectMediaIdsFromChain(chain = [], ids = new Set()) {
  for (const item of chain || []) {
    if (item.kind === "group") collectMediaIdsFromChain(item.chain || [], ids);
    else collectMediaIdsFromSource(item.source, ids);
  }
  return ids;
}

function collectComponentIdsFromChain(chain = [], ids = new Set()) {
  for (const item of chain || []) {
    if (item.kind === "group") collectComponentIdsFromChain(item.chain || [], ids);
    else collectComponentIdsFromSource(item.source, ids);
  }
  return ids;
}

function collectComponentIdsFromSource(source = {}, ids = new Set()) {
  if (source?.type === "component" && source.componentId) ids.add(source.componentId);
  return ids;
}
