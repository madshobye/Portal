import { isDrawableMedia } from "./media-utils.js?v=runtime-diagnostics-1";
import { mediaRenderInvalidation } from "../libraries/render-engine/invalidation/index.js?v=gapless-video-loop-1";
import { visitVisualParameterReferences } from "../libraries/visual-nodes/shared/parameter-references.js";

export function renderBufferKey(...parts) {
  return parts.map((part) => String(part)).join(":");
}

export function staticComponentGraphState(component = {}, components = [], seen = new Set(), includeRootTransform = true) {
  if (!component?.id || seen.has(component.id)) return { id: component?.id || "", cycle: true };
  const nextSeen = new Set(seen);
  nextSeen.add(component.id);
  const dependencies = Array.from(componentDependencyIds(component))
    .sort()
    .map((id) => staticComponentGraphState(
      components.find((item) => item.id === id) || { id, missing: true },
      components,
      nextSeen,
      true
    ));
  return { ...staticComponentState(component, includeRootTransform), dependencies };
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

export function staticCompiledComponentGraphState(
  component = {},
  programs = new Map(),
  components = [],
  seen = new Set(),
  includeRootTransform = true,
) {
  if (!component?.id || seen.has(component.id)) return { id: component?.id || "", cycle: true };
  const program = programs.get(component.id);
  if (!program) return { id: component.id, missingProgram: true };
  const nextSeen = new Set(seen);
  nextSeen.add(component.id);
  const inspection = program.inspect();
  const dependencies = inspection.dependencies.components.map((id) => staticCompiledComponentGraphState(
    components.find((item) => item.id === id) || { id, missing: true },
    programs,
    components,
    nextSeen,
    true,
  ));
  const operations = [];
  program.forEachOperation((operation) => operations.push(staticCompiledOperationState(operation)));
  return {
    id: component.id || "",
    type: component.type || "component",
    frameShape: component.frameShape || "landscape",
    resolutionScale: Number(component.resolutionScale) || 1,
    ...(includeRootTransform ? { transform: normalizedStaticTransform(component.transform) } : {}),
    scene: component.type === "scene" ? {} : null,
    program: {
      executionModel: inspection.executionModel,
      operations,
    },
    dependencies,
  };
}

export function staticCompiledComponentGraphMediaState(
  media = [],
  component = {},
  programs = new Map(),
  components = [],
  seen = new Set(),
) {
  return staticMediaStateForIds(media, collectCompiledGraphMediaIds(component, programs, components, new Set(), seen));
}

export function runtimeCompiledComponentGraphMediaState(
  media = new Map(),
  component = {},
  programs = new Map(),
  components = [],
  seen = new Set(),
) {
  return runtimeMediaStateForIds(media, collectCompiledGraphMediaIds(component, programs, components, new Set(), seen));
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
    const invalidation = mediaRenderInvalidation(item);
    return {
      id,
      present: true,
      ready: isReadyMediaItem(item),
      revision: Math.max(0, Number(item.revision) || 0),
      invalidationKey: invalidation.key,
      ...(item.videoFrameDriven === true
        ? { videoFrameRevision: Math.max(0, Number(item.videoFrameRevision) || 0) }
        : {}),
      fileKey: item.fileKey || "",
      error: item.loadError || item.imageError || item.modelError || "",
      kind: item.video ? "video" : item.image ? "image" : (item.model || item.modelData) ? "model" : "loading",
    };
  });
}

export function runtimeMediaInvalidation(item = null, metadata = null, context = {}) {
  return mediaRenderInvalidation(item, metadata, context);
}

export function chainLayerState(item = {}) {
  return {
    enabled: item.enabled !== false,
    transform: item.transform || {},
    opacity: item.opacity ?? 1,
    blend: item.blend || "normal",
  };
}

// `amount` predates the generic parameter map and remains on persisted effect
// items for compatibility. The parameter map is the canonical runtime value:
// Live controls patch it directly, so it must win when both representations
// are present.
export function effectParamState(item = {}) {
  return {
    ...(item.amount !== undefined ? { amount: item.amount } : {}),
    ...(item.params && typeof item.params === "object" ? item.params : {}),
  };
}

export function componentRuntimeTimeKey(component, params = {}, context = {}) {
  if (component?.runtime?.cacheable === false) return context.frame;
  if (!component?.runtime?.timeDependent?.(params)) return null;
  return component.runtime.timeKey?.(params, context) ?? context.time;
}

export function collectMediaIdsFromSource(source = {}, ids = new Set()) {
  if (source?.type === "media" && source.mediaId) ids.add(source.mediaId);
  collectMediaParameterIds(source?.params, ids);
  return ids;
}

export function createMediaReadinessStatus() {
  return {
    blocked: false,
    total: 0,
    mediaIds: new Set(),
    loadingIds: new Set(),
    missingIds: new Set(),
    errorIds: new Set(),
  };
}

export function isReadyMediaItem(item = {}) {
  if (!item || item.loadError) return false;
  if (item.video) {
    const element = item.video.elt || item.video;
    // loadeddata/canplay is a one-way readiness transition. A playing video
    // can temporarily fall below HAVE_CURRENT_DATA while seeking or filling
    // its decode queue; treating that fluctuation as a fresh project-loading
    // state makes Output alternate between play and pause forever.
    if (item.ready === true && element.videoWidth > 1 && element.videoHeight > 1) return true;
    return isDrawableMedia(item.video);
  }
  if (item.image) return isDrawableMedia(item.image);
  if (item.model || item.modelData) return true;
  return item.ready === true;
}

function staticComponentState(component = {}, includeTransform = true) {
  return {
    id: component.id || "",
    type: component.type || "component",
    frameShape: component.frameShape || "landscape",
    resolutionScale: Number(component.resolutionScale) || 1,
    ...(includeTransform ? { transform: normalizedStaticTransform(component.transform) } : {}),
    scene: component.type === "scene" ? {} : null,
    chain: staticChainState(component.chain || []),
  };
}

function staticCompiledOperationState(operation = {}) {
  const configuration = operation.configuration || {};
  return {
    id: operation.id || "",
    nodeId: operation.nodeId || "",
    opcode: operation.opcode || "",
    backend: operation.backend || "",
    enabled: configuration.enabled !== false,
    textureInputs: operation.textureInputs || {},
    configuration: configuration.kind === "source"
      ? {
          ...configuration,
          source: staticSourceState(configuration.source),
        }
      : configuration,
  };
}

function normalizedStaticTransform(transform = {}) {
  return {
    x: Number(transform.x) || 0,
    y: Number(transform.y) || 0,
    scale: Math.max(0.01, Number(transform.scale) || 1),
    rotation: Number(transform.rotation) || 0,
  };
}

function collectComponentGraphMediaIds(component = {}, components = [], ids = new Set(), seen = new Set()) {
  if (!component?.id || seen.has(component.id)) return ids;
  seen.add(component.id);
  collectMediaIdsFromChain(component.chain || [], ids);
  for (const dependencyId of componentDependencyIds(component)) {
    const dependency = components.find((item) => item.id === dependencyId);
    if (dependency) collectComponentGraphMediaIds(dependency, components, ids, seen);
  }
  return ids;
}

function collectCompiledGraphMediaIds(component, programs, components, ids, seen) {
  if (!component?.id || seen.has(component.id)) return ids;
  seen.add(component.id);
  const inspection = programs.get(component.id)?.inspect();
  for (const id of inspection?.mediaDemand?.ids || []) ids.add(id);
  for (const dependencyId of inspection?.dependencies?.components || []) {
    const dependency = components.find((item) => item.id === dependencyId);
    if (dependency) collectCompiledGraphMediaIds(dependency, programs, components, ids, seen);
  }
  return ids;
}

function componentDependencyIds(component = {}) {
  const ids = new Set();
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
        boundary: item.boundary || {},
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
        boundary: item.boundary || {},
        opacity: item.opacity ?? 1,
        blend: item.blend || "normal",
      };
    }
    return {
      id: item.id || "",
      kind: item.kind || "source",
      enabled: item.enabled !== false,
      source: staticSourceState(item.source),
      transform: item.transform || {},
      boundary: item.boundary || {},
      opacity: item.opacity ?? 1,
      blend: item.blend || "normal",
    };
  });
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

function collectMediaParameterIds(params, ids) {
  visitVisualParameterReferences(params, ({ kind, id }) => {
    if (kind === "media") ids.add(id);
  });
  return ids;
}
