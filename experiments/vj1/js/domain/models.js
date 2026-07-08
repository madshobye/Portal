import { defaultCustomShaderCode } from "../constants.js";

export function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createDefaultLayer(index = 0) {
  const presets = [
    {
      name: "Loop A",
      source: { type: "generator", mediaId: "", generatorId: "waves" },
      opacity: 1,
      blend: "normal",
      shaderChain: [{ id: "ripple", enabled: true, amount: 0.22 }],
    },
    {
      name: "Texture B",
      source: { type: "generator", mediaId: "", generatorId: "plasma" },
      opacity: 0.58,
      blend: "add",
      shaderChain: [{ id: "rgbSplit", enabled: true, amount: 0.14 }],
    },
  ];
  const preset = presets[index % presets.length];
  return {
    id: uid("layer"),
    name: preset.name,
    enabled: true,
    source: { ...preset.source },
    opacity: preset.opacity,
    blend: preset.blend,
    speed: 1,
    shaderChain: preset.shaderChain.map((pass) => ({ ...pass })),
  };
}

export function createDefaultSurface(index = 0, layerId = "") {
  const presets = [
    {
      id: "surface-main",
      name: "Main",
      route: { type: "mainMix", layerId: "", generatorId: "waves" },
      opacity: 1,
      finalBlend: "normal",
      showLabel: true,
    },
    {
      id: "surface-accent",
      name: "Accent",
      route: { type: "layer", layerId, generatorId: "noise" },
      opacity: 0.82,
      finalBlend: "add",
      showLabel: true,
    },
  ];
  const preset = presets[index % presets.length];
  return {
    id: preset.id,
    name: preset.name,
    enabled: true,
    route: { ...preset.route },
    opacity: preset.opacity,
    finalBlend: preset.finalBlend,
    finalShaderChain: [],
    mappingId: preset.id,
    showLabel: preset.showLabel,
    calibrationLocked: false,
  };
}

export function createInitialState() {
  const layers = [createDefaultLayer(0), createDefaultLayer(1)];
  return {
    version: 3,
    project: {
      name: "Untitled VJ Set",
      folderName: "",
      savedAt: "",
      warnings: [],
    },
    ui: {
      view: "studio",
      selectedLayerId: layers[0].id,
      selectedSurfaceId: "surface-main",
      debugPreview: true,
      outputWindowOpen: false,
      shaderStatus: "Shader ready",
      shaderError: "",
      mappingStatus: "Mapping idle",
    },
    global: {
      blackout: false,
      bpm: 120,
      crossfade: 1,
      showHud: true,
      calibrating: false,
    },
    render: {
      width: 960,
      height: 540,
      surfaceWidth: 800,
      surfaceHeight: 450,
    },
    media: [],
    layers,
    surfaces: [createDefaultSurface(0, layers[0].id), createDefaultSurface(1, layers[1].id)],
    scenes: [],
    mappings: {},
    shaders: {
      customCode: defaultCustomShaderCode(),
      customName: "Custom Scan Tint",
    },
    metrics: {
      fps: 0,
      frameMs: 0,
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
    shaders: { ...base.shaders, ...(input.shaders || {}) },
    metrics: { ...base.metrics, ...(input.metrics || {}) },
  };

  next.layers = Array.isArray(input.layers) && input.layers.length
    ? input.layers.map(normalizeLayer)
    : base.layers;
  next.surfaces = Array.isArray(input.surfaces) && input.surfaces.length
    ? input.surfaces.map((surface, index) => normalizeSurface(surface, next.layers[index]?.id || ""))
    : [createDefaultSurface(0, next.layers[0]?.id), createDefaultSurface(1, next.layers[1]?.id)];
  next.media = Array.isArray(input.media) ? input.media.map(normalizeMediaMeta) : [];
  next.scenes = Array.isArray(input.scenes) ? input.scenes : [];
  next.mappings = input.mappings && typeof input.mappings === "object" ? input.mappings : {};
  next.ui.selectedLayerId = next.layers.some((layer) => layer.id === next.ui.selectedLayerId)
    ? next.ui.selectedLayerId
    : next.layers[0]?.id || "";
  next.ui.selectedSurfaceId = next.surfaces.some((surface) => surface.id === next.ui.selectedSurfaceId)
    ? next.ui.selectedSurfaceId
    : next.surfaces[0]?.id || "";
  return next;
}

export function normalizeLayer(layer = {}) {
  const fallback = createDefaultLayer(0);
  return {
    ...fallback,
    ...layer,
    id: layer.id || uid("layer"),
    name: layer.name || fallback.name,
    enabled: layer.enabled !== false,
    source: {
      type: layer.source?.type || fallback.source.type,
      mediaId: layer.source?.mediaId || "",
      generatorId: layer.source?.generatorId || fallback.source.generatorId,
    },
    opacity: clamp01(layer.opacity ?? fallback.opacity),
    speed: Math.max(0, Number(layer.speed ?? fallback.speed) || 0),
    blend: layer.blend || fallback.blend,
    shaderChain: Array.isArray(layer.shaderChain)
      ? layer.shaderChain.map(normalizeShaderPass)
      : [],
  };
}

export function normalizeSurface(surface = {}, layerId = "") {
  const fallback = createDefaultSurface(0, layerId);
  return {
    ...fallback,
    ...surface,
    id: surface.id || uid("surface"),
    name: surface.name || fallback.name,
    enabled: surface.enabled !== false,
    route: {
      type: surface.route?.type || fallback.route.type,
      layerId: surface.route?.layerId || layerId || "",
      generatorId: surface.route?.generatorId || fallback.route.generatorId,
    },
    opacity: clamp01(surface.opacity ?? fallback.opacity),
    finalBlend: surface.finalBlend || fallback.finalBlend,
    finalShaderChain: Array.isArray(surface.finalShaderChain)
      ? surface.finalShaderChain.map(normalizeShaderPass)
      : [],
    mappingId: surface.mappingId || surface.id || fallback.mappingId,
    showLabel: surface.showLabel !== false,
    calibrationLocked: !!surface.calibrationLocked,
  };
}

export function normalizeShaderPass(pass = {}) {
  return {
    id: pass.id || "ripple",
    enabled: pass.enabled !== false,
    amount: clamp01(pass.amount ?? 0.35),
  };
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

export function createSceneFromState(state, name) {
  return {
    id: uid("scene"),
    name,
    transitionMs: 500,
    notes: "",
    snapshot: {
      global: clone(state.global),
      layers: clone(state.layers),
      surfaces: clone(state.surfaces),
      shaders: clone(state.shaders),
    },
  };
}

export function applySceneSnapshot(state, scene) {
  if (!scene?.snapshot) return state;
  return sanitizeState({
    ...state,
    global: { ...state.global, ...(scene.snapshot.global || {}) },
    layers: scene.snapshot.layers || state.layers,
    surfaces: scene.snapshot.surfaces || state.surfaces,
    shaders: { ...state.shaders, ...(scene.snapshot.shaders || {}) },
  });
}
