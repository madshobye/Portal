import { defaultCustomShaderCode } from "../constants.js";

export function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createDefaultLayer(index = 0) {
  return {
    id: uid("layer"),
    name: index === 0 ? "Layer 1" : `Layer ${index + 1}`,
    enabled: true,
    source: { type: "generator", mediaId: "", generatorId: "testPattern" },
    opacity: 1,
    blend: "normal",
    speed: 1,
    shaderChain: [],
  };
}

export function createDefaultComposition(index = 0) {
  return {
    id: uid("composition"),
    name: index === 0 ? "Test Pattern" : `Composition ${index + 1}`,
    source: { type: "generator", mediaId: "", generatorId: "testPattern" },
    opacity: 1,
    blend: "normal",
    speed: 1,
    thumbnail: "",
    shaderChain: [],
  };
}

export function createDefaultSurface(index = 0, layerId = "") {
  const id = index === 0 ? "surface-main" : uid("surface");
  return {
    id,
    name: index === 0 ? "Main" : `Surface ${index + 1}`,
    enabled: true,
    route: { type: "mainMix", layerId: "", generatorId: "testPattern" },
    opacity: 1,
    finalBlend: "normal",
    finalShaderChain: [],
    compositionId: "",
    mappingId: id,
    showLabel: true,
    calibrationLocked: false,
  };
}

export function createInitialState() {
  const layers = [createDefaultLayer(0), createDefaultLayer(1)];
  const compositions = [createDefaultComposition(0)];
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
      live: {
        selectedSceneId: "",
        compositionOverrides: {},
      },
      shaderStatus: "Shader ready",
      shaderError: "",
      mappingStatus: "Mapping idle",
      canUndo: false,
      canRedo: false,
    },
    global: {
      blackout: false,
      bpm: 120,
      crossfade: 1,
      showHud: true,
      showLabels: true,
      calibrating: true,
      mappingHandleMode: "always",
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
      renderCost: 0,
      previewFps: 0,
      previewFrameMs: 0,
      previewRenderCost: 0,
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
      : next.compositions[0]?.id || "",
  }));
  next.scenes = Array.isArray(input.scenes)
    ? input.scenes.map((scene) => normalizeScene(scene, next))
    : [];
  next.ui.selectedSceneId = next.scenes.some((scene) => scene.id === next.ui.selectedSceneId)
    ? next.ui.selectedSceneId
    : next.scenes[0]?.id || "";
  next.ui.live = normalizeLiveUi(next.ui.live);
  next.ui.workspace = ["compose", "scene", "live"].includes(next.ui.workspace) ? next.ui.workspace : "scene";
  next.global.calibrating = next.ui.workspace === "scene";
  return next;
}

export function createLiveRenderState(state = createInitialState()) {
  const next = clone(state);
  const live = next.ui?.live || {};
  const sceneId = live.selectedSceneId || next.ui?.selectedSceneId || "";
  const scene = next.scenes?.find((item) => item.id === sceneId);
  if (scene) applySceneSnapshotToState(next, scene);
  next.ui.selectedSceneId = scene?.id || next.ui.selectedSceneId || "";
  next.global.calibrating = false;
  for (const composition of next.compositions || []) {
    const override = live.compositionOverrides?.[composition.id];
    if (!override) continue;
    if (override.opacity !== undefined) composition.opacity = clamp01(override.opacity);
    if (override.speed !== undefined) composition.speed = Math.max(0, Number(override.speed) || 0);
    if (override.blend) composition.blend = override.blend;
    if (Array.isArray(override.shaderChain)) {
      composition.shaderChain = composition.shaderChain.map((pass, index) => ({
        ...pass,
        ...(override.shaderChain[index] || {}),
        amount: clamp01(override.shaderChain[index]?.amount ?? pass.amount),
        enabled: override.shaderChain[index]?.enabled ?? pass.enabled,
      }));
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
    shaderChain: Array.isArray(composition.shaderChain)
      ? composition.shaderChain.map((pass, index) => ({
          ...pass,
          ...(override.shaderChain?.[index] || {}),
          amount: clamp01(override.shaderChain?.[index]?.amount ?? pass.amount),
          enabled: override.shaderChain?.[index]?.enabled ?? pass.enabled,
        }))
      : [],
  };
}

function normalizeLiveUi(live = {}) {
  const compositionOverrides = {};
  for (const [id, override] of Object.entries(live.compositionOverrides || {})) {
    compositionOverrides[id] = {
      ...(override.opacity !== undefined ? { opacity: clamp01(override.opacity) } : {}),
      ...(override.speed !== undefined ? { speed: Math.max(0, Number(override.speed) || 0) } : {}),
      ...(override.blend ? { blend: override.blend } : {}),
      ...(Array.isArray(override.shaderChain)
        ? { shaderChain: override.shaderChain.map(normalizeLiveShaderPassOverride) }
        : {}),
    };
  }
  return {
    selectedSceneId: live.selectedSceneId ? String(live.selectedSceneId) : "",
    compositionOverrides,
  };
}

function normalizeLiveShaderPassOverride(pass = {}) {
  return {
    ...(pass.enabled !== undefined ? { enabled: pass.enabled !== false } : {}),
    ...(pass.amount !== undefined ? { amount: clamp01(pass.amount) } : {}),
  };
}

function normalizeCompositions(input, base) {
  if (Array.isArray(input.compositions) && input.compositions.length) {
    return input.compositions.map(normalizeComposition);
  }
  return [createDefaultComposition(0)];
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
  const { enabled, ...compositionData } = composition;
  return {
    ...fallback,
    ...compositionData,
    id: compositionData.id || uid("composition"),
    name: compositionData.name || fallback.name,
    source: {
      type: compositionData.source?.type || fallback.source.type,
      mediaId: compositionData.source?.mediaId || "",
      generatorId: compositionData.source?.generatorId || fallback.source.generatorId,
    },
    opacity: clamp01(compositionData.opacity ?? fallback.opacity),
    speed: Math.max(0, Number(compositionData.speed ?? fallback.speed) || 0),
    blend: compositionData.blend || fallback.blend,
    thumbnail: typeof compositionData.thumbnail === "string" ? compositionData.thumbnail : "",
    shaderChain: Array.isArray(compositionData.shaderChain)
      ? compositionData.shaderChain.map(normalizeShaderPass)
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
