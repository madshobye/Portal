import { VJ1, defaultCustomShaderCode, WORKSPACES } from "../constants.js";
import { createGeneratorSource } from "../graph/generator-registry.js?v=node-dirty-runtime-1";
import { normalizeCompositionFrameShape, normalizeCompositionResolutionScale } from "./composition-frame.js";

export function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createDefaultComposition(index = 0) {
  const source = createDefaultSource();
  return {
    id: uid("composition"),
    type: "chain",
    name: index === 0 ? "Test Pattern" : `Composition ${index + 1}`,
    source,
    opacity: 1,
    blend: "normal",
    speed: 1,
    frameShape: "landscape",
    resolutionScale: 1,
    thumbnail: "",
    chain: [createCompositionLayer(index, source)],
    shaderChain: [],
  };
}

export function createCanvasComposition(index = 0, sourceCompositionId = "") {
  const id = uid("composition");
  const width = 3840;
  const height = 2160;
  return {
    id,
    type: "canvas",
    name: index === 0 ? "Canvas" : `Canvas ${index + 1}`,
    source: { type: "generator", mediaId: "", generatorId: "black" },
    opacity: 1,
    blend: "normal",
    speed: 1,
    frameShape: "landscape",
    resolutionScale: 1,
    thumbnail: "",
    chain: sourceCompositionId ? [createCanvasLayer(0, sourceCompositionId)] : [],
    shaderChain: [],
    canvas: {
      width,
      height,
      frames: [createCanvasFrame(0, width, height)],
    },
  };
}

export function createCanvasLayer(index = 0, compositionId = "") {
  return normalizeCompositionChainItem({
    id: uid("chain"),
    kind: "group",
    role: "canvas-layer",
    name: index === 0 ? "Layer 1" : `Layer ${index + 1}`,
    enabled: true,
    opacity: 1,
    blend: "normal",
    layout: {
      x: index * 120,
      y: index * 80,
      width: 960,
      height: 540,
    },
    chain: compositionId ? [createCompositionLayer(0, { type: "composition", compositionId })] : [],
  });
}

export function createCanvasFrame(index = 0, canvasWidth = 3840, canvasHeight = 2160) {
  const width = Math.max(64, Math.round(Number(canvasWidth) * 0.25));
  const height = Math.max(64, Math.round(Number(canvasHeight) * 0.25));
  return {
    id: uid("canvas-frame"),
    name: index === 0 ? "Frame 1" : `Frame ${index + 1}`,
    x: 0,
    y: 0,
    width,
    height,
  };
}

export function createCompositionLayer(index = 0, source = { type: "generator", mediaId: "", generatorId: "testPattern" }) {
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
    params: {},
  };
}

export function createCompositionGroup(index = 0) {
  return normalizeCompositionChainItem({
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
    name: index === 0 ? "Main" : `Surface ${index + 1}`,
    enabled: true,
    opacity: 1,
    projectionFit: "cover",
    finalBlend: "normal",
    finalShaderChain: [],
    compositionId: "",
    outputFrameId: "",
    sourceRect: createDefaultSourceRect(),
    mappingId: id,
    showLabel: true,
    calibrationLocked: false,
  };
}

export function createDefaultSourceRect() {
  return { x: 0, y: 0, width: 960, height: 540 };
}

export function createInitialState() {
  const compositions = [createDefaultComposition(0)];
  return {
    version: 5,
    project: {
      name: "Untitled VJ Set",
      folderName: "",
      savedAt: "",
      warnings: [],
    },
    ui: {
      workspace: "scene",
      selectedCompositionId: compositions[0].id,
      selectedChainItemId: compositions[0].chain[0]?.id || "",
      selectedSceneId: "",
      selectedSurfaceId: "surface-main",
      debugPreview: true,
      outputWindowOpen: false,
      live: {
        selectedSceneId: "",
        sceneSnapshot: null,
        compositionOverrides: {},
      },
      previewViewport: {
        zoom: 1,
        x: 0,
        y: 0,
        fit: "frame",
      },
      shaderStatus: "Shader ready",
      shaderError: "",
      mappingStatus: "Mapping idle",
      canUndo: false,
      canRedo: false,
    },
    global: {
      playing: true,
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
      worldScale: 1.5,
      worldWidth: Math.round(VJ1.renderWidth * 1.5),
      worldHeight: Math.round(VJ1.renderHeight * 1.5),
      surfaceWidth: VJ1.surfaceWidth,
      surfaceHeight: VJ1.surfaceHeight,
      pixelDensity: 1,
      edgeSoftness: 0,
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
    compositions,
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
      previewFps: 0,
      previewFrameMs: 0,
      previewGpuMs: 0,
      previewGpuSupported: false,
      previewRenderCost: 0,
      previewProfile: null,
      clients: 0,
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
  const base = createInitialState();
  const next = {
    ...base,
    ...clone(input),
    project: { ...base.project, ...(input.project || {}) },
    ui: { ...base.ui, ...(input.ui || {}) },
    global: { ...base.global, ...(input.global || {}) },
    render: { ...base.render, ...(input.render || {}) },
    scheduler: { ...base.scheduler, ...(input.scheduler || {}) },
    shaders: { ...base.shaders, ...(input.shaders || {}) },
    metrics: { ...base.metrics, ...(input.metrics || {}) },
  };

  next.compositions = normalizeCompositions(input, base);
  next.surfaces = Array.isArray(input.surfaces) && input.surfaces.length
    ? input.surfaces.map((surface) => normalizeSurface(surface))
    : [createDefaultSurface(0), createDefaultSurface(1)];
  next.render = normalizeRenderSettings(next.render);
  next.ui.previewViewport = normalizePreviewViewport(next.ui.previewViewport);
  next.media = Array.isArray(input.media) ? input.media.map(normalizeMediaMeta) : [];
  next.mappings = input.mappings && typeof input.mappings === "object" ? input.mappings : {};
  next.ui.selectedCompositionId = next.compositions.some((composition) => composition.id === next.ui.selectedCompositionId)
    ? next.ui.selectedCompositionId
    : next.compositions[0]?.id || "";
  const selectedComposition = next.compositions.find((composition) => composition.id === next.ui.selectedCompositionId) || next.compositions[0];
  next.ui.selectedChainItemId = chainContainsItemId(selectedComposition?.chain, next.ui.selectedChainItemId)
    ? next.ui.selectedChainItemId
    : selectedComposition?.chain?.[0]?.id || "";
  next.ui.selectedSurfaceId = next.surfaces.some((surface) => surface.id === next.ui.selectedSurfaceId)
    ? next.ui.selectedSurfaceId
    : next.surfaces[0]?.id || "";
  next.surfaces = next.surfaces.map((surface, index) => ({
    ...surface,
    compositionId: next.compositions.some((composition) => composition.id === surface.compositionId)
      ? surface.compositionId
      : next.compositions[0]?.id || "",
  })).map((surface) => {
    const canvas = next.compositions.find((composition) => composition.id === surface.compositionId && composition.type === "canvas");
    return {
      ...surface,
      outputFrameId: canvas?.canvas?.frames?.some((frame) => frame.id === surface.outputFrameId) ? surface.outputFrameId : "",
    };
  });
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

export function normalizeRenderSettings(render = {}) {
  const frameWidth = positiveInt(render.frameWidth ?? render.width, VJ1.renderWidth, 128, 8192);
  const frameHeight = positiveInt(render.frameHeight ?? render.height, VJ1.renderHeight, 128, 8192);
  const worldScale = 1.5;
  const worldWidth = Math.round(frameWidth * worldScale);
  const worldHeight = Math.round(frameHeight * worldScale);
  return {
    ...render,
    width: frameWidth,
    height: frameHeight,
    frameWidth,
    frameHeight,
    worldScale,
    worldWidth,
    worldHeight,
    surfaceWidth: positiveInt(render.surfaceWidth, VJ1.surfaceWidth, 64, 8192),
    surfaceHeight: positiveInt(render.surfaceHeight, VJ1.surfaceHeight, 64, 8192),
    pixelDensity: clampNumber(render.pixelDensity, 0.5, 2, 1),
    edgeSoftness: clampNumber(render.edgeSoftness, 0, 8, 0),
    ...normalizeCompositionPipelineSettings(render),
  };
}

export function normalizeCompositionPipelineSettings(render = {}) {
  const upscaling = render.upscaling && typeof render.upscaling === "object" ? render.upscaling : {};
  const postProcessing = render.postProcessing && typeof render.postProcessing === "object" ? render.postProcessing : {};
  return {
    upscaling: {
      enabled: upscaling.enabled === true,
      amount: clampNumber(upscaling.amount, 0.35, 1, 0.67),
    },
    postProcessing: {
      noiseEnabled: postProcessing.noiseEnabled === true,
      noiseAmount: clampNumber(postProcessing.noiseAmount, 0, 0.2, 0.035),
      grayscaleEnabled: postProcessing.grayscaleEnabled === true,
      grayscaleAmount: clampNumber(postProcessing.grayscaleAmount, 0, 1, 1),
    },
  };
}

export function normalizePreviewViewport(viewport = {}) {
  const fit = ["frame", "world", "manual"].includes(viewport.fit) ? viewport.fit : "frame";
  return {
    zoom: clampNumber(viewport.zoom, 0.1, 6, 1),
    x: clampNumber(viewport.x, -100000, 100000, 0),
    y: clampNumber(viewport.y, -100000, 100000, 0),
    fit,
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
  const sceneId = live.selectedSceneId || next.scenes?.[0]?.id || "";
  const scene = next.scenes?.find((item) => item.id === sceneId);
  const programScene = live.sceneSnapshot
    ? { id: sceneId, snapshot: live.sceneSnapshot }
    : scene;
  if (programScene) applySceneSnapshotToState(next, programScene);
  next.ui.selectedSceneId = scene?.id || next.ui.selectedSceneId || "";
  next.global.calibrating = false;
  for (const composition of next.compositions || []) {
    const override = live.compositionOverrides?.[composition.id];
    if (!override) continue;
    if (override.opacity !== undefined) composition.opacity = clamp01(override.opacity);
    if (override.speed !== undefined) composition.speed = Math.max(0, Number(override.speed) || 0);
    if (override.blend) composition.blend = override.blend;
    if (Array.isArray(override.chain)) {
      composition.chain = composition.chain.map((item, index) =>
        mergeCompositionChainItemOverride(item, override.chain[index] || {})
      );
    }
    if (Array.isArray(override.shaderChain)) {
      composition.shaderChain = composition.shaderChain.map((pass, index) =>
        mergeShaderPassOverride(pass, override.shaderChain[index] || {})
      );
    }
  }
  return next;
}

export function createLiveCompositionView(composition = {}, state = createInitialState()) {
  const override = state.ui?.live?.compositionOverrides?.[composition.id] || {};
  return {
    ...composition,
    opacity: override.opacity !== undefined ? clamp01(override.opacity) : composition.opacity,
    speed: override.speed !== undefined ? Math.max(0, Number(override.speed) || 0) : composition.speed,
    blend: override.blend || composition.blend,
    chain: Array.isArray(composition.chain)
      ? composition.chain.map((item, index) =>
          mergeCompositionChainItemOverride(item, override.chain?.[index] || {})
        )
      : [],
    shaderChain: Array.isArray(composition.shaderChain)
      ? composition.shaderChain.map((pass, index) =>
          mergeShaderPassOverride(pass, override.shaderChain?.[index] || {})
        )
      : [],
  };
}

function normalizeLiveUi(live = {}, state = createInitialState()) {
  const compositionOverrides = {};
  for (const [id, override] of Object.entries(live.compositionOverrides || {})) {
    compositionOverrides[id] = {
      ...(override.opacity !== undefined ? { opacity: clamp01(override.opacity) } : {}),
      ...(override.speed !== undefined ? { speed: Math.max(0, Number(override.speed) || 0) } : {}),
      ...(override.blend ? { blend: override.blend } : {}),
      ...(Array.isArray(override.chain)
        ? { chain: override.chain.map(normalizeLiveChainItemOverride) }
        : {}),
      ...(Array.isArray(override.shaderChain)
        ? { shaderChain: override.shaderChain.map(normalizeLiveShaderPassOverride) }
        : {}),
    };
  }
  const selectedSceneId = live.selectedSceneId && state.scenes?.some((scene) => String(scene.id) === String(live.selectedSceneId))
    ? String(live.selectedSceneId)
    : state.scenes?.[0]?.id || "";
  const selectedScene = state.scenes?.find((scene) => String(scene.id) === selectedSceneId);
  return {
    selectedSceneId,
    sceneSnapshot: live.sceneSnapshot
      ? normalizeSceneSnapshot(live.sceneSnapshot, state)
      : selectedScene?.snapshot ? clone(selectedScene.snapshot) : null,
    compositionOverrides,
  };
}

function normalizeLiveChainItemOverride(item = {}) {
  if (!item || typeof item !== "object") return {};
  const params = item.params && typeof item.params === "object" ? { ...item.params } : {};
  return {
    ...(item.enabled !== undefined ? { enabled: item.enabled !== false } : {}),
    ...(item.collapsed !== undefined ? { collapsed: !!item.collapsed } : {}),
    ...(item.opacity !== undefined ? { opacity: clamp01(item.opacity) } : {}),
    ...(item.blend ? { blend: item.blend } : {}),
    ...(Object.keys(params).length ? { params } : {}),
    ...(item.amount !== undefined ? { amount: clamp01(item.amount) } : {}),
    ...(item.transform && typeof item.transform === "object" ? { transform: normalizeTransform(item.transform) } : {}),
    ...(Array.isArray(item.chain) ? { chain: item.chain.map(normalizeLiveChainItemOverride) } : {}),
  };
}

function normalizeLiveShaderPassOverride(pass = {}) {
  const params = normalizeShaderPassParams(pass);
  const hasParams = pass.params && typeof pass.params === "object";
  return {
    ...(pass.enabled !== undefined ? { enabled: pass.enabled !== false } : {}),
    ...(hasParams || pass.amount !== undefined ? { params } : {}),
    ...(pass.amount !== undefined ? { amount: params.amount } : {}),
  };
}

function normalizeCompositions(input, base) {
  if (Array.isArray(input.compositions) && input.compositions.length) {
    return input.compositions.map(normalizeComposition);
  }
  return [createDefaultComposition(0)];
}

export function normalizeComposition(composition = {}) {
  const fallback = createDefaultComposition(0);
  const { enabled, ...compositionData } = composition;
  const type = compositionData.type === "canvas" ? "canvas" : "chain";
  const source = normalizeSource({
    ...compositionData.source,
    type: compositionData.source?.type || fallback.source.type,
    mediaId: compositionData.source?.mediaId || "",
    generatorId: compositionData.source?.generatorId || fallback.source.generatorId,
  });
  const shaderChain = Array.isArray(compositionData.shaderChain)
    ? compositionData.shaderChain.map(normalizeShaderPass)
    : [];
  const legacyChain = Array.isArray(compositionData.chain) && compositionData.chain.length
    ? [
        ...compositionData.chain.map(normalizeCompositionChainItem),
        ...shaderChain.map((pass) => normalizeCompositionChainItem({
          kind: "effect",
          componentId: pass.id,
          enabled: pass.enabled,
          params: pass.params,
          amount: pass.amount,
        })),
      ]
    : legacyCompositionChain(source, shaderChain);
  const canvas = type === "canvas" ? normalizeCanvasCompositionData(compositionData.canvas, compositionData.id) : null;
  const canvasChain = type === "canvas"
    ? (Array.isArray(compositionData.chain) && compositionData.chain.length
      ? [
          ...compositionData.chain.map(normalizeCompositionChainItem),
          ...shaderChain.map((pass) => normalizeCompositionChainItem({
            kind: "effect",
            componentId: pass.id,
            enabled: pass.enabled,
            params: pass.params,
            amount: pass.amount,
          })),
        ]
      : (compositionData.canvas?.layers || []).map((layer, index) => canvasLayerGroupFromLegacy(layer, index, compositionData.id)))
    : legacyChain;
  return {
    ...fallback,
    ...compositionData,
    type,
    id: compositionData.id || uid("composition"),
    name: compositionData.name || fallback.name,
    source,
    opacity: clamp01(compositionData.opacity ?? fallback.opacity),
    speed: Math.max(0, Number(compositionData.speed ?? fallback.speed) || 0),
    blend: compositionData.blend || fallback.blend,
    frameShape: normalizeCompositionFrameShape(compositionData.frameShape),
    resolutionScale: normalizeCompositionResolutionScale(compositionData.resolutionScale),
    thumbnail: typeof compositionData.thumbnail === "string" ? compositionData.thumbnail : "",
    chain: canvasChain,
    shaderChain: [],
    ...(type === "canvas" ? { canvas } : {}),
  };
}

function normalizeCanvasCompositionData(canvas = {}, selfId = "") {
  const width = positiveInt(canvas.width, 3840, 128, 8192);
  const height = positiveInt(canvas.height, 2160, 128, 8192);
  const frames = Array.isArray(canvas.frames)
    ? canvas.frames.map((frame, index) => normalizeCanvasFrame(frame, index, width, height))
    : [];
  return { width, height, frames };
}

function canvasLayerGroupFromLegacy(layer = {}, index = 0, selfId = "") {
  const fallback = createCanvasLayer(index, "");
  const compositionId = layer.compositionId && layer.compositionId !== selfId ? String(layer.compositionId) : "";
  return normalizeCompositionChainItem({
    ...fallback,
    id: layer.id || uid("chain"),
    kind: "group",
    role: "canvas-layer",
    name: layer.name || fallback.name,
    enabled: layer.enabled !== false,
    opacity: clamp01(layer.opacity ?? fallback.opacity),
    blend: layer.blend || fallback.blend,
    layout: {
      x: Number.isFinite(Number(layer.x)) ? Number(layer.x) : fallback.layout.x,
      y: Number.isFinite(Number(layer.y)) ? Number(layer.y) : fallback.layout.y,
      width: positiveInt(layer.width, fallback.layout.width, 1, 8192),
      height: positiveInt(layer.height, fallback.layout.height, 1, 8192),
    },
    chain: compositionId ? [createCompositionLayer(0, { type: "composition", compositionId })] : [],
  });
}

function normalizeCanvasFrame(frame = {}, index = 0, canvasWidth = 3840, canvasHeight = 2160) {
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
  };
}

export function normalizeCompositionChainItem(item = {}) {
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
    };
  }
  if (item.kind === "group") {
    return {
      id: item.id || uid("chain"),
      kind: "group",
      name: item.name || "Group",
      role: item.role === "canvas-layer" ? "canvas-layer" : "group",
      enabled: item.enabled !== false,
      collapsed: !!item.collapsed,
      transform: normalizeTransform(item.transform),
      opacity: clamp01(item.opacity ?? 1),
      blend: item.blend || "normal",
      ...(item.role === "canvas-layer" ? { layout: normalizeCanvasLayerLayout(item.layout) } : {}),
      chain: Array.isArray(item.chain) ? item.chain.map(normalizeCompositionChainItem) : [],
    };
  }
  const source = normalizeSource(item.source || { type: "generator", generatorId: item.componentId || "testPattern" });
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
    params: item.params && typeof item.params === "object" ? { ...item.params } : {},
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
    projectionFit: normalizeProjectionFit(surface.projectionFit),
    finalBlend: surface.finalBlend || fallback.finalBlend,
    finalShaderChain: Array.isArray(surface.finalShaderChain)
      ? surface.finalShaderChain.map(normalizeShaderPass)
      : [],
    compositionId: surface.compositionId || "",
    outputFrameId: surface.outputFrameId || "",
    sourceRect: normalizeSourceRect(surface.sourceRect),
    mappingId: surface.mappingId || surface.id || fallback.mappingId,
    showLabel: surface.showLabel !== false,
    calibrationLocked: !!surface.calibrationLocked,
  };
}

export function normalizeProjectionFit(value) {
  return value === "contain" || value === "stretch" ? value : "cover";
}

function normalizeSourceRect(rect = {}) {
  const fallback = createDefaultSourceRect();
  return {
    x: Math.max(0, Number(rect.x) || fallback.x),
    y: Math.max(0, Number(rect.y) || fallback.y),
    width: positiveInt(rect.width, fallback.width, 1, 8192),
    height: positiveInt(rect.height, fallback.height, 1, 8192),
  };
}

function normalizeCanvasLayerLayout(layout = {}) {
  return {
    x: Number(layout.x) || 0,
    y: Number(layout.y) || 0,
    width: positiveInt(layout.width, 960, 1, 8192),
    height: positiveInt(layout.height, 540, 1, 8192),
  };
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

export function createCompositionEffect(id = "ripple", params = {}) {
  const pass = createShaderPass(id, params);
  return normalizeCompositionChainItem({
    id: uid("chain"),
    kind: "effect",
    componentId: pass.id,
    enabled: pass.enabled,
    params: pass.params,
    amount: pass.amount,
  });
}

function legacyCompositionChain(source, shaderChain) {
  return [
    createCompositionLayer(0, source),
    ...shaderChain.map((pass) => normalizeCompositionChainItem({
      kind: "effect",
      componentId: pass.id,
      enabled: pass.enabled,
      params: pass.params,
      amount: pass.amount,
    })),
  ];
}

function normalizeSource(source = {}) {
  const speed = clampNumber(source.speed, 0, 8, 1);
  const start = Math.max(0, Number(source.start ?? source.startTime) || 0);
  const end = Math.max(0, Number(source.end ?? source.endTime) || 0);
  const params = source.params && typeof source.params === "object" ? { ...source.params } : {};
  const generatorSource = source.type === "generator" || !source.type
    ? createGeneratorSource(source.generatorId, params)
    : null;
  return {
    type: source.type || "generator",
    mediaId: source.mediaId || "",
    compositionId: source.compositionId || "",
    generatorId: generatorSource?.generatorId || source.generatorId || "testPattern",
    start,
    end: end > start ? end : 0,
    speed,
    ...(generatorSource ? { params: generatorSource.params } : Object.keys(params).length ? { params } : {}),
  };
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
  if (source.type === "generator") return source.generatorId || "testPattern";
  if (source.type === "composition") return "source.composition";
  return `source.${source.type || "black"}`;
}

function sourceLabel(source = {}) {
  if (source.type === "composition") return source.compositionId || "Composition";
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

function mergeCompositionChainItemOverride(item = {}, override = {}) {
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
        ? item.chain.map((child, index) => mergeCompositionChainItemOverride(child, override.chain?.[index] || {}))
        : [],
    };
  }
  return {
    ...item,
    ...(override.enabled !== undefined ? { enabled: override.enabled !== false } : {}),
    ...(override.opacity !== undefined ? { opacity: clamp01(override.opacity) } : {}),
    ...(override.blend ? { blend: override.blend } : {}),
    ...(override.params && typeof override.params === "object"
      ? { params: { ...(item.params && typeof item.params === "object" ? item.params : {}), ...override.params } }
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
  };
}

export function normalizeScene(scene = {}, state = createInitialState()) {
  return {
    id: String(scene.id || uid("scene")),
    name: scene.name || "Scene",
    notes: scene.notes || "",
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
    compositionId: surface.compositionId || "",
    outputFrameId: surface.outputFrameId || "",
    sourceRect: normalizeSourceRect(surface.sourceRect),
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
  const fallbackCompositionId = state.compositions[0]?.id || "";
  const compositionId = state.compositions.some((composition) => composition.id === surface.compositionId)
    ? surface.compositionId
    : fallbackCompositionId;
  const canvas = state.compositions.find((composition) => composition.id === compositionId && composition.type === "canvas");
  return {
    id: surface.id || "",
    enabled: surface.enabled !== false,
    compositionId,
    outputFrameId: canvas?.canvas?.frames?.some((frame) => frame.id === surface.outputFrameId) ? surface.outputFrameId : "",
    sourceRect: normalizeSourceRect(surface.sourceRect),
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
    snapshot: createSceneSnapshot(state),
  };
}

export function createSceneSnapshot(state) {
  return {
    surfaces: clone(state.surfaces.map(createSceneSurfaceSnapshot)),
  };
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
