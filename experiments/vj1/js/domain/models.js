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

export function createDefaultComposition(index = 0) {
  const presets = [
    {
      name: "Live Camera Ripple",
      source: { type: "camera", mediaId: "", generatorId: "waves" },
      opacity: 1,
      blend: "normal",
      speed: 1,
      shaderChain: [{ id: "ripple", enabled: true, amount: 0.28 }],
    },
    {
      name: "Noise Kaleido",
      source: { type: "generator", mediaId: "", generatorId: "noise" },
      opacity: 1,
      blend: "normal",
      speed: 1,
      shaderChain: [{ id: "kaleido", enabled: true, amount: 0.35 }],
    },
  ];
  const preset = presets[index % presets.length];
  return {
    id: uid("composition"),
    name: preset.name,
    enabled: true,
    source: { ...preset.source },
    opacity: preset.opacity,
    blend: preset.blend,
    speed: preset.speed,
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
    compositionId: "",
    mappingId: preset.id,
    showLabel: preset.showLabel,
    calibrationLocked: false,
  };
}

export function createInitialState() {
  const layers = [createDefaultLayer(0), createDefaultLayer(1)];
  const compositions = [createDefaultComposition(0), createDefaultComposition(1)];
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
      workspace: "setup",
      selectedLayerId: layers[0].id,
      selectedCompositionId: compositions[0].id,
      selectedSceneId: "",
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
      calibrating: true,
    },
    render: {
      width: 960,
      height: 540,
      surfaceWidth: 800,
      surfaceHeight: 450,
    },
    media: [],
    layers,
    compositions,
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
  next.compositions = normalizeCompositions(input, base);
  next.surfaces = Array.isArray(input.surfaces) && input.surfaces.length
    ? input.surfaces.map((surface, index) => normalizeSurface(surface, next.layers[index]?.id || ""))
    : [createDefaultSurface(0, next.layers[0]?.id), createDefaultSurface(1, next.layers[1]?.id)];
  next.media = Array.isArray(input.media) ? input.media.map(normalizeMediaMeta) : [];
  next.mappings = input.mappings && typeof input.mappings === "object" ? input.mappings : {};
  next.ui.selectedLayerId = next.layers.some((layer) => layer.id === next.ui.selectedLayerId)
    ? next.ui.selectedLayerId
    : next.layers[0]?.id || "";
  next.ui.selectedCompositionId = next.compositions.some((composition) => composition.id === next.ui.selectedCompositionId)
    ? next.ui.selectedCompositionId
    : next.compositions[0]?.id || "";
  next.ui.selectedSurfaceId = next.surfaces.some((surface) => surface.id === next.ui.selectedSurfaceId)
    ? next.ui.selectedSurfaceId
    : next.surfaces[0]?.id || "";
  next.surfaces = next.surfaces.map((surface, index) => ({
    ...surface,
    compositionId: next.compositions.some((composition) => composition.id === surface.compositionId)
      ? surface.compositionId
      : next.compositions[index % Math.max(1, next.compositions.length)]?.id || "",
  }));
  next.scenes = Array.isArray(input.scenes)
    ? input.scenes.map((scene) => normalizeScene(scene, next))
    : [];
  next.ui.selectedSceneId = next.scenes.some((scene) => scene.id === next.ui.selectedSceneId)
    ? next.ui.selectedSceneId
    : next.scenes[0]?.id || "";
  next.ui.workspace = ["setup", "compose", "scene"].includes(next.ui.workspace) ? next.ui.workspace : "setup";
  next.global.calibrating = next.ui.workspace === "setup" || next.ui.workspace === "scene";
  return next;
}

function normalizeCompositions(input, base) {
  if (Array.isArray(input.compositions) && input.compositions.length) {
    return input.compositions.map(normalizeComposition);
  }
  if (Array.isArray(input.layers) && input.layers.length) {
    return input.layers.map((layer) => {
      const normalized = normalizeLayer(layer);
      return normalizeComposition({
        id: normalized.id.replace(/^layer/, "composition"),
        name: normalized.name,
        enabled: normalized.enabled,
        source: normalized.source,
        opacity: normalized.opacity,
        blend: normalized.blend,
        speed: normalized.speed,
        shaderChain: normalized.shaderChain,
      });
    });
  }
  return base.compositions;
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

export function normalizeComposition(composition = {}) {
  const fallback = createDefaultComposition(0);
  return {
    ...fallback,
    ...composition,
    id: composition.id || uid("composition"),
    name: composition.name || fallback.name,
    enabled: composition.enabled !== false,
    source: {
      type: composition.source?.type || fallback.source.type,
      mediaId: composition.source?.mediaId || "",
      generatorId: composition.source?.generatorId || fallback.source.generatorId,
    },
    opacity: clamp01(composition.opacity ?? fallback.opacity),
    speed: Math.max(0, Number(composition.speed ?? fallback.speed) || 0),
    blend: composition.blend || fallback.blend,
    shaderChain: Array.isArray(composition.shaderChain)
      ? composition.shaderChain.map(normalizeShaderPass)
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
    compositionId: surface.compositionId || "",
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

export function normalizeScene(scene = {}, state = createInitialState()) {
  return {
    id: String(scene.id || uid("scene")),
    name: scene.name || "Scene",
    transitionMs: Math.max(0, Number(scene.transitionMs) || 0),
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
    opacity: clamp01(surface.opacity ?? 1),
    finalBlend: surface.finalBlend || "normal",
    finalShaderChain: Array.isArray(surface.finalShaderChain)
      ? surface.finalShaderChain.map(normalizeShaderPass)
      : [],
    showLabel: surface.showLabel !== false,
  };
}

export function normalizeSceneSurfaceSnapshot(surface = {}, state = createInitialState()) {
  const fallbackCompositionId = state.compositions[0]?.id || "";
  return {
    id: surface.id || "",
    enabled: surface.enabled !== false,
    compositionId: state.compositions.some((composition) => composition.id === surface.compositionId)
      ? surface.compositionId
      : fallbackCompositionId,
    opacity: clamp01(surface.opacity ?? 1),
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
    transitionMs: 0,
    notes: "",
    snapshot: createSceneSnapshot(state),
  };
}

export function createSceneSnapshot(state) {
  return {
    surfaces: clone(state.surfaces.map(createSceneSurfaceSnapshot)),
  };
}

export function applySceneSnapshot(state, scene) {
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
