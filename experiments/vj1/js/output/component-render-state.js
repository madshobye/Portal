import { isDrawableMedia } from "./media-utils.js?v=runtime-diagnostics-1";
import { mediaRenderInvalidation } from "../libraries/render-engine/invalidation/index.js?v=gapless-video-loop-1";
import { visitVisualParameterReferences } from "../libraries/visual-nodes/shared/parameter-references.js";

export function renderBufferKey(...parts) {
  return parts.map((part) => String(part)).join(":");
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

export function runtimeMediaStateForIds(media = new Map(), ids = new Set()) {
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

export function effectParamState(item = {}) {
  return item.params && typeof item.params === "object" ? item.params : {};
}

export function componentRuntimeTimeKey(component, params = {}, context = {}) {
  if (component?.runtime?.cacheable === false) return context.frame;
  if (!component?.runtime?.timeDependent?.(params)) return null;
  return component.runtime.timeKey?.(params, context) ?? context.time;
}

export function collectMediaIdsFromSource(source = {}, ids = new Set()) {
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
    resources: new Map(),
    pendingResourceIds: new Set(),
    errorResourceIds: new Set(),
    controlSignals: new Map(),
    pendingControlSignalIds: new Set(),
    errorControlSignalIds: new Set(),
    unsupportedControlSignalIds: new Set(),
    requiredControlSignalIds: new Set(),
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

export function staticSourceState(source = {}) {
  return {
    type: source.type || "",
    componentId: source.componentId || "",
    generatorId: source.generatorId || "",
    params: source.params || {},
    placement: source.placement || null,
    contentTransform: source.contentTransform || {},
  };
}

export function staticMediaStateForIds(media = [], ids = new Set()) {
  return (media || [])
    .filter((item) => ids.has(item.id))
    .map((item) => ({ id: item.id || "", path: item.path || "", type: item.type || "", size: item.size || 0 }));
}

function collectMediaParameterIds(params, ids) {
  visitVisualParameterReferences(params, ({ kind, id }) => {
    if (kind === "media") ids.add(id);
  });
  return ids;
}
