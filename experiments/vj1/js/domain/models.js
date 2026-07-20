import { VJ1, defaultCustomShaderCode, WORKSPACES } from "../constants.js";
import { createGeneratorSource } from "../graph/generator-registry.js?v=fog-banks-1";
import { normalizeComponentFrameShape, normalizeComponentResolutionScale } from "./component-frame.js";
import { createProjectActivity, normalizeProjectActivity } from "./component-activity.js?v=adaptive-component-demand-29";
import { normalizeCatalogMarker } from "./catalog-marker.js?v=catalog-marker-four-state-1";
import { CURRENT_PROJECT_VERSION, migrateProjectData } from "./project-migrations.js?v=catalog-marker-four-state-1";
import {
  createOutputDefinition,
  normalizeCameraSettings,
  normalizeCanvasSize,
  normalizeComponentPipelineSettings,
  normalizePreviewViewports,
  normalizeRenderSettings,
  normalizeSamplingSettings,
} from "./render-settings.js?v=canvas-global-resolution-1";
import {
  applySceneSourceNode,
  normalizeProjectionFit,
  resolveSceneSourceNode,
  sceneSourceNodeId,
  sceneSourceNodes,
} from "./scene-routing.js?v=scene-catalog-markers-1";

export {
  createOutputDefinition,
  normalizeCameraSettings,
  normalizeCanvasSize,
  normalizeComponentPipelineSettings,
  normalizePreviewViewport,
  normalizePreviewViewports,
  normalizeRenderSettings,
  normalizeSamplingSettings,
} from "./render-settings.js?v=canvas-global-resolution-1";
export {
  applySceneSourceNode,
  normalizeProjectionFit,
  resolveSceneSourceNode,
  sceneSourceNodeId,
  sceneSourceNodes,
} from "./scene-routing.js?v=scene-catalog-markers-1";

export function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createDefaultComponent(index = 0, { empty = false } = {}) {
  const initialSource = createDefaultSource();
  return {
    id: uid("component"),
    type: "chain",
    name: `Comp ${index + 1}`,
    opacity: 1,
    blend: "normal",
    speed: 1,
    syncInstances: true,
    frameShape: "landscape",
    resolutionScale: 1,
    thumbnail: "",
    chain: empty ? [] : [createComponentLayer(index, initialSource)],
    activity: createProjectActivity(),
    catalogMarker: 0,
  };
}

export function createCanvasComponent(index = 0, sourceComponentId = "") {
  const id = uid("component");
  return {
    id,
    type: "canvas",
    name: `Canv ${index + 1}`,
    opacity: 1,
    blend: "normal",
    speed: 1,
    syncInstances: true,
    frameShape: "landscape",
    resolutionScale: 1,
    thumbnail: "",
    chain: sourceComponentId ? [createComponentLayer(0, { type: "component", componentId: sourceComponentId })] : [],
    activity: createProjectActivity(),
    catalogMarker: 0,
    canvas: {
      previewQuality: "auto",
      frameThumbnails: {},
    },
  };
}

export function createCanvasFrame(index = 0, canvasWidth = VJ1.canvasWidth, canvasHeight = VJ1.canvasHeight) {
  const width = Math.max(64, Math.round(Number(canvasWidth) * 0.25));
  const height = Math.max(64, Math.round(Number(canvasHeight) * 0.25));
  return {
    id: uid("canvas-frame"),
    name: index === 0 ? "Frame 1" : `Frame ${index + 1}`,
    x: Math.round((Number(canvasWidth) - width) * 0.5),
    y: Math.round((Number(canvasHeight) - height) * 0.5),
    width,
    height,
    activity: createProjectActivity(),
  };
}

export function createComponentLayer(index = 0, source = { type: "generator", mediaId: "", generatorId: "testPattern" }) {
  const normalizedSource = normalizeSource(source);
  return {
    id: uid("chain"),
    kind: "source",
    componentId: sourceComponentId(normalizedSource),
    name: sourceLabel(normalizedSource),
    enabled: true,
    source: normalizedSource,
    opacity: 1,
    blend: "normal",
    transform: createDefaultTransform(),
  };
}

export function createComponentGroup(index = 0) {
  return normalizeComponentChainItem({
    id: uid("chain"),
    kind: "group",
    name: index === 0 ? "Group 1" : `Group ${index + 1}`,
    enabled: true,
    collapsed: false,
    chain: [],
  });
}

export function createDefaultSurface(index = 0) {
  const id = index === 0 ? "surface-main" : uid("surface");
  return {
    id,
    name: `Srf ${index + 1}`,
    enabled: true,
    opacity: 1,
    feather: 0,
    projectionFit: "cover",
    finalBlend: "normal",
    finalShaderChain: [],
    sourceNodeId: "",
    componentId: "",
    outputFrameId: "",
    mappingId: id,
    showLabel: true,
    calibrationLocked: false,
    destination: { type: "mapped" },
  };
}

export function directOutputSurfaceId(outputId = "") {
  return outputId === "all"
    ? "surface-direct-all"
    : `surface-direct-${encodeURIComponent(outputId)}`;
}

export function directOutputSurfaceDefinitions(render = {}) {
  const outputs = Array.isArray(render.outputs) ? render.outputs : [];
  const definitions = [];
  if (outputs.length > 1) {
    definitions.push({
      id: directOutputSurfaceId("all"),
      name: "All outputs · Direct",
      outputIds: outputs.map((output) => output.id),
    });
  }
  for (const output of outputs) {
    definitions.push({
      id: directOutputSurfaceId(output.id),
      name: `${output.name} · Direct`,
      outputIds: [output.id],
    });
  }
  return definitions;
}

export function reconcileDirectOutputSurfaces(surfaces = [], render = {}) {
  const expected = directOutputSurfaceDefinitions(render);
  const expectedById = new Map(expected.map((definition) => [definition.id, definition]));
  const seen = new Set();
  const normalized = [];
  const addDirect = (definition, existing = null) => {
    seen.add(definition.id);
    normalized.push(normalizeSurface({
      ...createDefaultSurface(0),
      ...(existing || {}),
      id: definition.id,
      name: definition.name,
      enabled: existing ? existing.enabled !== false : false,
      feather: existing?.feather ?? 0,
      projectionFit: existing?.projectionFit || "contain",
      mappingId: "",
      showLabel: false,
      calibrationLocked: true,
      destination: { type: "direct", outputIds: definition.outputIds },
    }));
  };
  for (const surface of surfaces || []) {
    if (surface?.destination?.type !== "direct") {
      normalized.push(surface);
      continue;
    }
    const definition = expectedById.get(surface.id);
    if (definition) addDirect(definition, surface);
  }
  for (const definition of expected) {
    if (!seen.has(definition.id)) addDirect(definition);
  }
  return normalized;
}

export function createInitialState() {
  const components = [createDefaultComponent(0)];
  return {
    version: CURRENT_PROJECT_VERSION,
    project: {
      name: "Untitled VJ Set",
      folderName: "",
      savedAt: "",
      warnings: [],
    },
    ui: {
      workspace: "scene",
      selectedComponentId: components[0].id,
      selectedChainItemId: components[0].chain[0]?.id || "",
      workspaceSelectionIds: {
        component: components[0].id,
        canvas: "",
      },
      catalogSortModes: {
        component: "recent",
        canvas: "recent",
        scene: "recent",
        source: "recent",
        media: "recent",
      },
      previewQualities: {
        scene: "auto",
        live: "auto",
      },
      selectedSceneId: "",
      selectedSurfaceId: "surface-main",
      debugPreview: true,
      outputWindowOpen: false,
      live: {
        selectedSceneId: "",
        selectedComponentId: "",
        componentView: "controls",
        sceneSnapshot: null,
        componentOverrides: {},
        sceneOverrides: {},
        transitionDuration: 0,
        paramFadeDuration: 0,
        transition: null,
      },
      previewViewports: {
        component: { zoom: 1, x: 0, y: 0, fit: "frame" },
        canvas: { zoom: 1, x: 0, y: 0, fit: "frame" },
        scene: { zoom: 1, x: 0, y: 0, fit: "frame" },
        live: { zoom: 1, x: 0, y: 0, fit: "frame" },
      },
      shaderStatus: "Shader ready",
      shaderError: "",
      mappingStatus: "Mapping idle",
      canUndo: false,
      canRedo: false,
    },
    global: {
      playing: true,
      timeStretch: 0,
      blackout: false,
      bpm: 120,
      crossfade: 1,
      showHud: true,
      showLabels: true,
      calibrating: true,
      mappingHandleMode: "always",
    },
    render: {
      width: VJ1.renderWidth,
      height: VJ1.renderHeight,
      frameWidth: VJ1.renderWidth,
      frameHeight: VJ1.renderHeight,
      worldWidth: Math.round(VJ1.renderWidth * (1 + VJ1.outputWorldMarginRatio * 2)),
      worldHeight: Math.round(VJ1.renderHeight * (1 + VJ1.outputWorldMarginRatio * 2)),
      outputs: [createOutputDefinition(0)],
      canvasSize: {
        width: VJ1.canvasWidth,
        height: VJ1.canvasHeight,
      },
      componentTexture: {
        width: VJ1.renderWidth,
        height: VJ1.renderHeight,
      },
      surfaceTexture: {
        mode: "auto",
        maxWidth: VJ1.renderWidth,
        maxHeight: VJ1.renderHeight,
      },
      pixelDensity: 1,
      sampling: {
        surfaceOverscan: 1,
        recordingFrameScale: 1,
        limitCanvasToLogicalSize: true,
      },
      camera: {
        width: VJ1.renderWidth,
        height: VJ1.renderHeight,
        facingMode: "user",
        mirrored: false,
        maxResolution: false,
      },
      maxFrameRate: 120,
      upscaling: {
        enabled: false,
        amount: 0.67,
      },
      postProcessing: {
        noiseEnabled: false,
        noiseAmount: 0.035,
        grayscaleEnabled: false,
        grayscaleAmount: 1,
      },
    },
    scheduler: {
      mode: "hardconfigured",
      manualLane: true,
    },
    media: [],
    components,
    recordingFrames: [createCanvasFrame(0)],
    surfaces: [createDefaultSurface(0), createDefaultSurface(1)],
    scenes: [],
    mappings: {},
    shaders: {
      customCode: defaultCustomShaderCode(),
      customName: "Custom Scan Tint",
    },
    metrics: {
      fps: 0,
      frameMs: 0,
      gpuMs: 0,
      gpuSupported: false,
      renderCost: 0,
      profile: null,
      transport: null,
      previewFps: 0,
      previewFrameMs: 0,
      previewGpuMs: 0,
      previewGpuSupported: false,
      previewRenderCost: 0,
      previewProfile: null,
      clients: 0,
      outputs: {},
      message: "No output connected",
    },
  };
}

export function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(1, Math.max(0, number));
}

export function sanitizeState(input = {}) {
  input = migrateProjectData(input);
  const base = createInitialState();
  const next = {
    ...base,
    ...clone(input),
    version: CURRENT_PROJECT_VERSION,
    project: { ...base.project, ...(input.project || {}) },
    ui: { ...base.ui, ...(input.ui || {}) },
    global: { ...base.global, ...(input.global || {}) },
    render: { ...base.render, ...(input.render || {}) },
    scheduler: { ...base.scheduler, ...(input.scheduler || {}) },
    shaders: { ...base.shaders, ...(input.shaders || {}) },
    metrics: { ...base.metrics, ...(input.metrics || {}) },
  };
  next.global.timeStretch = clampNumber(input.global?.timeStretch, -4, 4, 0);

  next.render = normalizeRenderSettings(input.render || {});
  next.components = normalizeComponents(input, base);
  const canvasFrameBounds = next.render.canvasSize;
  const recordingFrames = Array.isArray(input.recordingFrames) ? input.recordingFrames : base.recordingFrames;
  const seenRecordingFrameIds = new Set();
  next.recordingFrames = recordingFrames
    .map((frame, index) => normalizeCanvasFrame(frame, index, canvasFrameBounds.width, canvasFrameBounds.height))
    .filter((frame) => {
      if (seenRecordingFrameIds.has(frame.id)) return false;
      seenRecordingFrameIds.add(frame.id);
      return true;
    });
  next.surfaces = Array.isArray(input.surfaces) && input.surfaces.length
    ? input.surfaces.map((surface) => normalizeSurface(surface))
    : [createDefaultSurface(0), createDefaultSurface(1)];
  next.surfaces = reconcileDirectOutputSurfaces(next.surfaces, next.render);
  next.ui.previewViewports = normalizePreviewViewports(input.ui?.previewViewports);
  next.media = Array.isArray(input.media) ? input.media.map(normalizeMediaMeta) : [];
  next.mappings = input.mappings && typeof input.mappings === "object" ? input.mappings : {};
  next.ui.selectedComponentId = next.components.some((component) => component.id === next.ui.selectedComponentId)
    ? next.ui.selectedComponentId
    : next.components[0]?.id || "";
  next.ui.workspaceSelectionIds = normalizeWorkspaceSelectionIds(
    next.ui.workspaceSelectionIds,
    next.components,
    next.ui.selectedComponentId
  );
  next.ui.catalogSortModes = normalizeCatalogSortModes(next.ui.catalogSortModes);
  next.ui.previewQualities = normalizePreviewQualities(next.ui.previewQualities);
  const selectedComponent = next.components.find((component) => component.id === next.ui.selectedComponentId) || next.components[0];
  next.ui.selectedChainItemId = chainContainsItemId(selectedComponent?.chain, next.ui.selectedChainItemId)
    ? next.ui.selectedChainItemId
    : selectedComponent?.chain?.[0]?.id || "";
  next.ui.selectedSurfaceId = next.surfaces.some((surface) => surface.id === next.ui.selectedSurfaceId)
    ? next.ui.selectedSurfaceId
    : next.surfaces[0]?.id || "";
  next.surfaces = next.surfaces.map((surface, index) => ({
    ...surface,
    componentId: !surface.componentId || next.components.some((component) => component.id === surface.componentId)
      ? surface.componentId || ""
      : next.components[0]?.id || "",
  })).map((surface) => applySceneSourceNode(surface, resolveSceneSourceNode(next, surface.sourceNodeId)));
  next.scenes = Array.isArray(input.scenes)
    ? input.scenes.map((scene) => normalizeScene(scene, next))
    : [];
  next.ui.selectedSceneId = next.scenes.some((scene) => scene.id === next.ui.selectedSceneId)
    ? next.ui.selectedSceneId
    : next.scenes[0]?.id || "";
  next.ui.live = normalizeLiveUi(next.ui.live, next);
  next.ui.workspace = WORKSPACES.includes(next.ui.workspace) ? next.ui.workspace : "scene";
  next.global.calibrating = next.ui.workspace === "scene";
  next.scheduler.mode = next.scheduler.mode || "hardconfigured";
  next.scheduler.manualLane = next.scheduler.manualLane !== false;
  return next;
}

function normalizePreviewQualities(value = {}) {
  const normalize = (quality) => ["auto", "low", "full"].includes(quality) ? quality : "auto";
  return {
    scene: normalize(value?.scene),
    live: normalize(value?.live),
  };
}

function normalizeWorkspaceSelectionIds(value = {}, components = [], selectedComponentId = "") {
  const selected = components.find((component) => component.id === selectedComponentId);
  const ordinary = components.filter((component) => component.type !== "canvas");
  const canvases = components.filter((component) => component.type === "canvas");
  const componentId = ordinary.some((component) => component.id === value?.component)
    ? value.component
    : selected?.type !== "canvas" ? selected?.id || ordinary[0]?.id || "" : ordinary[0]?.id || "";
  const canvasId = canvases.some((component) => component.id === value?.canvas)
    ? value.canvas
    : selected?.type === "canvas" ? selected.id : canvases[0]?.id || "";
  return { component: componentId, canvas: canvasId };
}

function normalizeCatalogSortModes(value = {}) {
  const normalize = (mode) => ["recent", "marker", "name", "created"].includes(mode) ? mode : "recent";
  return {
    component: normalize(value?.component),
    canvas: normalize(value?.canvas),
    scene: normalize(value?.scene),
    source: normalize(value?.source),
    media: normalize(value?.media),
  };
}

function positiveInt(value, fallback, min = 1, max = 8192) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function createLiveRenderState(state = createInitialState()) {
  const next = clone(state);
  const live = next.ui?.live || {};
  const sceneId = String(live.selectedSceneId || "");
  const scene = next.scenes?.find((item) => item.id === sceneId);
  const programScene = scene && live.sceneSnapshot
    ? { id: sceneId, snapshot: live.sceneSnapshot }
    : scene;
  if (programScene) applySceneSnapshotToState(next, programScene);
  // selectedSceneId is retained for old rendering code that reads the
  // materialized Scene, but it is derived only from explicit Live truth.
  // Never copy the editor Scene into a render snapshot as a fallback.
  next.ui.selectedSceneId = scene?.id || "";
  next.global.calibrating = false;
  applyLiveComponentOverrides(next, live.componentOverrides);

  const transition = live.transition;
  const durationMs = Math.max(0, Number(transition?.durationMs) || 0);
  const startedAtMs = Number(transition?.startedAtMs) || 0;
  if (durationMs > 0 && startedAtMs + durationMs > Date.now() && transition?.fromSnapshot) {
    const fromState = clone(state);
    applySceneSnapshotToState(fromState, {
      id: transition.fromSceneId || "",
      snapshot: transition.fromSnapshot,
    });
    fromState.ui.selectedSceneId = transition.fromSceneId || fromState.ui.selectedSceneId || "";
    fromState.global.calibrating = false;
    applyLiveComponentOverrides(fromState, transition.fromComponentOverrides);
    fromState.ui.live.transition = null;
    next.liveTransition = {
      id: transition.id || `${transition.fromSceneId || "scene"}:${sceneId}:${startedAtMs}`,
      startedAtMs,
      durationMs,
      componentsShared: JSON.stringify(transition.fromComponentOverrides || {}) === JSON.stringify(live.componentOverrides || {}),
      fromState,
    };
  }
  return next;
}

function applyLiveComponentOverrides(state, overrides = {}) {
  for (const component of state.components || []) {
    const override = overrides?.[component.id];
    if (!override) continue;
    if (override.opacity !== undefined) component.opacity = clamp01(override.opacity);
    if (override.speed !== undefined) component.speed = Math.max(0, Number(override.speed) || 0);
    if (override.blend) component.blend = override.blend;
    if (override.transform && typeof override.transform === "object") {
      component.transform = normalizeTransform({ ...(component.transform || {}), ...override.transform });
    }
    if (Array.isArray(override.chain)) {
      component.chain = component.chain.map((item, index) =>
        mergeComponentChainItemOverride(item, override.chain[index] || {})
      );
    }
  }
}

export function createLiveComponentView(component = {}, state = createInitialState()) {
  const override = state.ui?.live?.componentOverrides?.[component.id] || {};
  return {
    ...component,
    opacity: override.opacity !== undefined ? clamp01(override.opacity) : component.opacity,
    speed: override.speed !== undefined ? Math.max(0, Number(override.speed) || 0) : component.speed,
    blend: override.blend || component.blend,
    transform: override.transform && typeof override.transform === "object"
      ? normalizeTransform({ ...(component.transform || {}), ...override.transform })
      : normalizeTransform(component.transform),
    chain: component.chain.map((item, index) =>
      mergeComponentChainItemOverride(item, override.chain?.[index] || {})
    ),
  };
}

function normalizeLiveUi(live = {}, state = createInitialState()) {
  const normalizeComponentOverrides = (overrides = {}) => Object.fromEntries(Object.entries(overrides || {}).map(([id, override]) => {
    const component = state.components?.find((entry) => String(entry.id) === String(id));
    return [id, {
      ...(override.opacity !== undefined ? { opacity: clamp01(override.opacity) } : {}),
      ...(override.speed !== undefined ? { speed: Math.max(0, Number(override.speed) || 0) } : {}),
      ...(override.blend ? { blend: override.blend } : {}),
      ...(override.transform && typeof override.transform === "object"
        ? { transform: normalizeTransform(override.transform) }
        : {}),
      ...(Array.isArray(override.chain)
        ? { chain: override.chain.map((item, index) => normalizeLiveChainItemOverride(item, component?.chain?.[index])) }
        : {}),
    }];
  }));
  const selectedSceneId = live.selectedSceneId && state.scenes?.some((scene) => String(scene.id) === String(live.selectedSceneId))
    ? String(live.selectedSceneId)
    : state.scenes?.[0]?.id || "";
  const selectedScene = state.scenes?.find((scene) => String(scene.id) === selectedSceneId);
  const sceneOverrides = Object.fromEntries(Object.entries(live.sceneOverrides || {}).map(([sceneId, overrides]) => [
    String(sceneId),
    normalizeComponentOverrides(overrides),
  ]));
  const componentOverrides = normalizeComponentOverrides(
    sceneOverrides[selectedSceneId] || live.componentOverrides || {}
  );
  if (selectedSceneId && Object.keys(componentOverrides).length) sceneOverrides[selectedSceneId] = clone(componentOverrides);
  const transitionDuration = clampNumber(live.transitionDuration, 0, 30, 0);
  const paramFadeDuration = clampNumber(live.paramFadeDuration, 0, 30, 0);
  const transitionDurationMs = Math.max(0, Number(live.transition?.durationMs) || 0);
  const transitionStartedAtMs = Number(live.transition?.startedAtMs) || 0;
  const transition = transitionDurationMs > 0 && transitionStartedAtMs > 0 && live.transition?.fromSnapshot
    ? {
        id: String(live.transition.id || ""),
        fromSceneId: String(live.transition.fromSceneId || ""),
        fromSnapshot: normalizeSceneSnapshot(live.transition.fromSnapshot, state),
        fromComponentOverrides: normalizeComponentOverrides(live.transition.fromComponentOverrides || {}),
        startedAtMs: transitionStartedAtMs,
        durationMs: Math.min(30000, transitionDurationMs),
      }
    : null;
  return {
    selectedSceneId,
    selectedComponentId: state.components?.some((component) => component.id === live.selectedComponentId)
      ? live.selectedComponentId
      : "",
    componentView: live.componentView === "elements" ? "elements" : "controls",
    sceneSnapshot: live.sceneSnapshot
      ? normalizeSceneSnapshot(live.sceneSnapshot, state)
      : selectedScene?.snapshot ? clone(selectedScene.snapshot) : null,
    componentOverrides,
    sceneOverrides,
    transitionDuration,
    paramFadeDuration,
    transition,
  };
}

function normalizeLiveChainItemOverride(item = {}, authoredItem = {}) {
  if (!item || typeof item !== "object") return {};
  const params = item.params && typeof item.params === "object" ? { ...item.params } : {};
  const sourceParams = item.source?.params && typeof item.source.params === "object" ? { ...item.source.params } : {};
  const isSource = authoredItem?.kind === "source" || !!item.source;
  return {
    ...(item.enabled !== undefined ? { enabled: item.enabled !== false } : {}),
    ...(item.collapsed !== undefined ? { collapsed: !!item.collapsed } : {}),
    ...(item.opacity !== undefined ? { opacity: clamp01(item.opacity) } : {}),
    ...(item.blend ? { blend: item.blend } : {}),
    ...(!isSource && Object.keys(params).length ? { params } : {}),
    ...(isSource && Object.keys(sourceParams).length ? { source: { params: sourceParams } } : {}),
    ...(item.amount !== undefined ? { amount: clamp01(item.amount) } : {}),
    ...(item.transform && typeof item.transform === "object" ? { transform: normalizeTransform(item.transform) } : {}),
    ...(Array.isArray(item.chain) ? { chain: item.chain.map((child, index) => normalizeLiveChainItemOverride(child, authoredItem?.chain?.[index])) } : {}),
  };
}

function normalizeComponents(input, base) {
  if (Array.isArray(input.components) && input.components.length) {
    return input.components.map(normalizeComponent);
  }
  return [createDefaultComponent(0)];
}

export function normalizeComponent(component = {}) {
  const fallback = createDefaultComponent(0);
  const {
    enabled,
    source: _legacySource,
    shaderChain: _legacyShaderChain,
    ...componentData
  } = component;
  const type = componentData.type === "canvas" ? "canvas" : "chain";
  const chain = Array.isArray(componentData.chain) ? componentData.chain.map(normalizeComponentChainItem) : [];
  const canvas = type === "canvas" ? normalizeCanvasComponentData(componentData.canvas, componentData.id) : null;
  const canvasChain = chain;
  return {
    ...fallback,
    ...componentData,
    type,
    id: componentData.id || uid("component"),
    name: componentData.name || fallback.name,
    opacity: clamp01(componentData.opacity ?? fallback.opacity),
    speed: Math.max(0, Number(componentData.speed ?? fallback.speed) || 0),
    syncInstances: componentData.syncInstances !== false,
    blend: componentData.blend || fallback.blend,
    frameShape: normalizeComponentFrameShape(componentData.frameShape),
    resolutionScale: normalizeComponentResolutionScale(componentData.resolutionScale),
    thumbnail: typeof componentData.thumbnail === "string" ? componentData.thumbnail : "",
    significantParams: Array.from(new Set((componentData.significantParams || []).filter((path) => typeof path === "string" && path))),
    activity: normalizeProjectActivity(componentData.activity, fallback.activity.createdAt),
    catalogMarker: normalizeCatalogMarker(componentData.catalogMarker),
    chain: canvasChain,
    ...(type === "canvas" ? { canvas } : {}),
  };
}

function normalizeCanvasComponentData(canvas = {}, selfId = "") {
  const previewQuality = ["auto", "low", "full"].includes(canvas.previewQuality) ? canvas.previewQuality : "auto";
  const frameThumbnails = Object.fromEntries(Object.entries(canvas.frameThumbnails || {})
    .filter(([frameId, thumbnail]) => frameId && typeof thumbnail === "string" && thumbnail));
  return { previewQuality, frameThumbnails };
}

function normalizeCanvasFrame(frame = {}, index = 0, canvasWidth = VJ1.canvasWidth, canvasHeight = VJ1.canvasHeight) {
  const fallback = createCanvasFrame(index, canvasWidth, canvasHeight);
  const width = positiveInt(frame.width, fallback.width, 16, canvasWidth);
  const height = positiveInt(frame.height, fallback.height, 16, canvasHeight);
  return {
    id: frame.id || uid("canvas-frame"),
    name: frame.name || fallback.name,
    x: Math.max(0, Math.min(canvasWidth - width, Number(frame.x) || 0)),
    y: Math.max(0, Math.min(canvasHeight - height, Number(frame.y) || 0)),
    width,
    height,
    activity: normalizeProjectActivity(frame.activity, fallback.activity.createdAt),
  };
}

export function normalizeComponentChainItem(item = {}) {
  if (item.kind === "effect") {
    const pass = normalizeShaderPass({
      id: item.componentId || item.id || "ripple",
      enabled: item.enabled,
      params: item.params,
      amount: item.amount,
    });
    return {
      id: item.id || uid("chain"),
      kind: "effect",
      componentId: pass.id,
      name: item.name || pass.id,
      enabled: pass.enabled,
      params: pass.params,
      amount: pass.amount,
      transform: normalizeTransform(item.transform),
      opacity: clamp01(item.opacity ?? 1),
      blend: item.blend || "normal",
    };
  }
  if (item.kind === "group") {
    return {
      id: item.id || uid("chain"),
      kind: "group",
      name: item.name || "Group",
      role: "group",
      enabled: item.enabled !== false,
      collapsed: !!item.collapsed,
      transform: normalizeTransform(item.transform),
      opacity: clamp01(item.opacity ?? 1),
      blend: item.blend || "normal",
      chain: Array.isArray(item.chain) ? item.chain.map(normalizeComponentChainItem) : [],
    };
  }
  if (item.kind !== "source" || !item.source) {
    throw new TypeError(`[VJ1_INVALID_CHAIN_ITEM] Expected source, effect, or group; received ${String(item.kind || "missing kind")}`);
  }
  const source = normalizeSource(item.source);
  const fallbackName = sourceLabel(source);
  return {
    id: item.id || uid("chain"),
    kind: "source",
    componentId: sourceComponentId(source),
    name: isGenericLayerName(item.name) ? fallbackName : item.name || fallbackName,
    enabled: item.enabled !== false,
    source,
    opacity: clamp01(item.opacity ?? 1),
    blend: item.blend || "normal",
    transform: normalizeTransform(item.transform),
  };
}

export function normalizeSurface(surface = {}) {
  const fallback = createDefaultSurface(0);
  return {
    ...fallback,
    ...surface,
    id: surface.id || uid("surface"),
    name: surface.name || fallback.name,
    enabled: surface.enabled !== false,
    opacity: clamp01(surface.opacity ?? fallback.opacity),
    feather: clampNumber(surface.feather, 0, 0.5, fallback.feather),
    projectionFit: normalizeProjectionFit(surface.projectionFit),
    finalBlend: surface.finalBlend || fallback.finalBlend,
    finalShaderChain: Array.isArray(surface.finalShaderChain)
      ? surface.finalShaderChain.map(normalizeShaderPass)
      : [],
    sourceNodeId: surface.sourceNodeId || "",
    componentId: surface.componentId || "",
    outputFrameId: surface.outputFrameId || "",
    mappingId: surface.mappingId || surface.id || fallback.mappingId,
    showLabel: surface.showLabel !== false,
    calibrationLocked: !!surface.calibrationLocked,
    destination: normalizeSurfaceDestination(surface.destination, surface.mappingId || surface.id || fallback.mappingId),
  };
}

function normalizeSurfaceDestination(destination = {}, mappingId = "") {
  if (destination?.type === "direct") {
    return {
      type: "direct",
      outputIds: [...new Set((destination.outputIds || []).map(String).filter(Boolean))],
    };
  }
  return { type: "mapped", mappingId: destination?.mappingId || mappingId || "" };
}

export function normalizeShaderPass(pass = {}) {
  const params = normalizeShaderPassParams(pass);
  return {
    id: pass.id || "ripple",
    enabled: pass.enabled !== false,
    params,
    amount: params.amount,
  };
}

export function createShaderPass(id = "ripple", params = {}) {
  return normalizeShaderPass({ id, enabled: true, params });
}

export function createComponentEffect(id = "ripple", params = {}) {
  const pass = createShaderPass(id, params);
  return normalizeComponentChainItem({
    id: uid("chain"),
    kind: "effect",
    componentId: pass.id,
    enabled: pass.enabled,
    params: pass.params,
    amount: pass.amount,
  });
}

function normalizeSource(source) {
  if (!source || typeof source !== "object" || !source.type) {
    throw new TypeError("[VJ1_INVALID_SOURCE] A source node requires an explicit source.type");
  }
  if (source.type === "generator" && !source.generatorId) {
    throw new TypeError("[VJ1_INVALID_SOURCE] A generator source requires generatorId");
  }
  if (!["generator", "media", "camera", "component", "black"].includes(source.type)) {
    throw new TypeError(`[VJ1_INVALID_SOURCE] Unsupported source.type ${String(source.type)}`);
  }
  const speed = clampNumber(source.speed, 0, 8, 1);
  const start = Math.max(0, Number(source.start) || 0);
  const end = Math.max(0, Number(source.end) || 0);
  const params = source.params && typeof source.params === "object" ? { ...source.params } : {};
  const generatorSource = source.type === "generator"
    ? createGeneratorSource(source.generatorId, params)
    : null;
  const placement = normalizeRelativePlacement(source.placement);
  return {
    type: source.type,
    mediaId: source.mediaId || "",
    componentId: source.componentId || "",
    generatorId: generatorSource?.generatorId || source.generatorId || "",
    start,
    end: end > start ? end : 0,
    speed,
    ...(source.type === "component" && placement ? { placement } : {}),
    ...(generatorSource ? { params: generatorSource.params } : Object.keys(params).length ? { params } : {}),
  };
}

function normalizeRelativePlacement(placement) {
  if (!placement || typeof placement !== "object") return null;
  const scale = Number(placement.scale ?? placement.width);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  return { scale: Math.min(64, scale) };
}

function createDefaultSource() {
  return {
    type: "generator",
    mediaId: "",
    generatorId: "testPattern",
    start: 0,
    end: 0,
    speed: 1,
  };
}

function sourceComponentId(source = {}) {
  if (source.type === "generator") return source.generatorId;
  if (source.type === "component") return "source.component";
  return `source.${source.type || "black"}`;
}

function sourceLabel(source = {}) {
  if (source.type === "component") return source.componentId || "Component";
  if (source.type === "media") return source.mediaId || "Media";
  if (source.type === "camera") return "Camera";
  if (source.type === "black") return "Black";
  return formatSourceLabel(source.generatorId || "Generator");
}

function isGenericLayerName(value) {
  return /^Layer(?:\s+\d+)?$/i.test(String(value || "").trim());
}

function formatSourceLabel(value = "") {
  const text = String(value || "Generator")
    .replace(/([a-z])([A-Z0-9])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim();
  return text
    .split(/\s+/)
    .map((word) => (/^\d+d$/i.test(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

function createDefaultTransform() {
  return { x: 0, y: 0, scale: 1, rotation: 0 };
}

function normalizeTransform(transform = {}) {
  return {
    x: Number(transform.x) || 0,
    y: Number(transform.y) || 0,
    scale: Math.max(0.01, Number(transform.scale) || 1),
    rotation: Number(transform.rotation) || 0,
  };
}

function normalizeShaderPassParams(pass = {}) {
  const params = pass.params && typeof pass.params === "object" ? { ...pass.params } : {};
  params.amount = clamp01(params.amount ?? pass.amount ?? 0.35);
  return params;
}

function mergeComponentChainItemOverride(item = {}, override = {}) {
  if (!override || typeof override !== "object") return item;
  if (item.kind === "effect") {
    const pass = mergeShaderPassOverride({
      id: item.componentId || item.id,
      enabled: item.enabled,
      params: item.params,
      amount: item.amount,
    }, override);
    return {
      ...item,
      enabled: pass.enabled,
      params: pass.params,
      amount: pass.amount,
      ...(override.opacity !== undefined ? { opacity: clamp01(override.opacity) } : {}),
      ...(override.blend ? { blend: override.blend } : {}),
      ...(override.transform && typeof override.transform === "object"
        ? { transform: normalizeTransform({ ...(item.transform || {}), ...override.transform }) }
      : {}),
    };
  }
  if (item.kind === "group") {
    return {
      ...item,
      ...(override.enabled !== undefined ? { enabled: override.enabled !== false } : {}),
      ...(override.collapsed !== undefined ? { collapsed: !!override.collapsed } : {}),
      ...(override.transform && typeof override.transform === "object"
        ? { transform: normalizeTransform({ ...(item.transform || {}), ...override.transform }) }
        : {}),
      chain: Array.isArray(item.chain)
        ? item.chain.map((child, index) => mergeComponentChainItemOverride(child, override.chain?.[index] || {}))
        : [],
    };
  }
  return {
    ...item,
    ...(override.enabled !== undefined ? { enabled: override.enabled !== false } : {}),
    ...(override.opacity !== undefined ? { opacity: clamp01(override.opacity) } : {}),
    ...(override.blend ? { blend: override.blend } : {}),
    ...(override.source?.params && typeof override.source.params === "object"
      ? { source: {
          ...(item.source || {}),
          params: {
            ...(item.source?.params && typeof item.source.params === "object" ? item.source.params : {}),
            ...(override.source?.params && typeof override.source.params === "object" ? override.source.params : {}),
          },
        } }
      : {}),
    ...(override.transform && typeof override.transform === "object"
      ? { transform: normalizeTransform({ ...(item.transform || {}), ...override.transform }) }
      : {}),
  };
}

function chainContainsItemId(chain = [], id = "") {
  if (!Array.isArray(chain) || !id) return false;
  for (const item of chain) {
    if (item.id === id) return true;
    if (item.kind === "group" && chainContainsItemId(item.chain, id)) return true;
  }
  return false;
}

function mergeShaderPassOverride(pass = {}, override = {}) {
  const params = {
    ...(pass.params && typeof pass.params === "object" ? pass.params : {}),
    ...(override.params && typeof override.params === "object" ? override.params : {}),
  };
  if (override.amount !== undefined) params.amount = override.amount;
  return normalizeShaderPass({
    ...pass,
    ...(override.id ? { id: override.id } : {}),
    enabled: override.enabled ?? pass.enabled,
    params,
    amount: params.amount ?? pass.amount,
  });
}

export function normalizeMediaMeta(item = {}) {
  return {
    id: item.id || uid("media"),
    name: item.name || item.id || "Media",
    path: item.path || item.name || "",
    type: item.type || "unknown",
    size: Number(item.size) || 0,
    catalogMarker: normalizeCatalogMarker(item.catalogMarker),
  };
}

export function normalizeScene(scene = {}, state = createInitialState()) {
  return {
    id: String(scene.id || uid("scene")),
    name: scene.name || "Scene",
    notes: scene.notes || "",
    catalogMarker: normalizeCatalogMarker(scene.catalogMarker),
    snapshot: normalizeSceneSnapshot(scene.snapshot, state),
  };
}

export function normalizeSceneSnapshot(snapshot = {}, state = createInitialState()) {
  const assignments = new Map((snapshot.surfaces || []).map((surface) => [surface.id, surface]));
  return {
    surfaces: state.surfaces.map((surface) => normalizeSceneSurfaceSnapshot({
      ...createSceneSurfaceSnapshot(surface),
      ...(assignments.get(surface.id) || {}),
    }, state)),
  };
}

export function createSceneSurfaceSnapshot(surface = {}) {
  return {
    id: surface.id,
    enabled: surface.enabled !== false,
    sourceNodeId: surface.sourceNodeId || "",
    componentId: surface.componentId || "",
    outputFrameId: surface.outputFrameId || "",
    opacity: clamp01(surface.opacity ?? 1),
    projectionFit: normalizeProjectionFit(surface.projectionFit),
    finalBlend: surface.finalBlend || "normal",
    finalShaderChain: Array.isArray(surface.finalShaderChain)
      ? surface.finalShaderChain.map(normalizeShaderPass)
      : [],
    showLabel: surface.showLabel !== false,
  };
}

export function normalizeSceneSurfaceSnapshot(surface = {}, state = createInitialState()) {
  const route = applySceneSourceNode(surface, resolveSceneSourceNode(state, surface.sourceNodeId));
  return {
    id: surface.id || "",
    enabled: surface.enabled !== false,
    sourceNodeId: route.sourceNodeId,
    componentId: route.componentId,
    outputFrameId: route.outputFrameId,
    opacity: clamp01(surface.opacity ?? 1),
    projectionFit: normalizeProjectionFit(surface.projectionFit),
    finalBlend: surface.finalBlend || "normal",
    finalShaderChain: Array.isArray(surface.finalShaderChain)
      ? surface.finalShaderChain.map(normalizeShaderPass)
      : [],
    showLabel: surface.showLabel !== false,
  };
}

export function createSceneFromState(state, name) {
  return {
    id: uid("scene"),
    name,
    notes: "",
    catalogMarker: 0,
    snapshot: createSceneSnapshot(state),
  };
}

export function createEmptySceneFromState(state, name) {
  return {
    id: uid("scene"),
    name,
    notes: "",
    catalogMarker: 0,
    snapshot: {
      surfaces: clone((state.surfaces || []).map((surface) => ({
        ...createSceneSurfaceSnapshot(surface),
        enabled: false,
        sourceNodeId: "",
        componentId: "",
        outputFrameId: "",
      }))),
    },
  };
}

export function createSceneSnapshot(state) {
  return {
    surfaces: clone(state.surfaces.map(createSceneSurfaceSnapshot)),
  };
}

export function syncLiveSnapshotFromScene(state, scene) {
  if (!scene?.snapshot || String(state.ui?.live?.selectedSceneId || "") !== String(scene.id || "")) return state;
  state.ui.live.sceneSnapshot = clone(scene.snapshot);
  return state;
}

export function applySceneForEditing(state, scene) {
  if (!scene?.snapshot) return state;
  const next = sanitizeState(applySceneSnapshotToState(clone(state), scene));
  next.ui.selectedSceneId = scene.id;
  return next;
}

export function applySceneSnapshotToState(state, scene) {
  if (!scene?.snapshot) return state;
  const normalizedSnapshot = normalizeSceneSnapshot(scene.snapshot, state);
  const assignments = new Map(normalizedSnapshot.surfaces.map((surface) => [surface.id, surface]));
  state.surfaces = state.surfaces.map((surface) => ({
    ...surface,
    ...(assignments.get(surface.id) || {}),
  }));
  state.ui.selectedSceneId = scene.id;
  return state;
}
