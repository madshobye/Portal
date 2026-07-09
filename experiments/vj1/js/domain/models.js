import { VJ1, defaultCustomShaderCode, WORKSPACES } from "../constants.js";

export function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createDefaultComposition(index = 0) {
  const source = { type: "generator", mediaId: "", generatorId: "testPattern" };
  return {
    id: uid("composition"),
    name: index === 0 ? "Test Pattern" : `Composition ${index + 1}`,
    source,
    opacity: 1,
    blend: "normal",
    speed: 1,
    thumbnail: "",
    chain: [createCompositionLayer(index, source)],
    shaderChain: [],
  };
}

export function createCompositionLayer(index = 0, source = { type: "generator", mediaId: "", generatorId: "testPattern" }) {
  const normalizedSource = normalizeSource(source);
  return {
    id: uid("chain"),
    kind: "source",
    componentId: sourceComponentId(normalizedSource),
    name: index === 0 ? sourceLabel(normalizedSource) : `Layer ${index + 1}`,
    enabled: true,
    source: normalizedSource,
    opacity: 1,
    blend: "normal",
    transform: createDefaultTransform(),
    params: {},
  };
}

export function createDefaultSurface(index = 0) {
  const id = index === 0 ? "surface-main" : uid("surface");
  return {
    id,
    name: index === 0 ? "Main" : `Surface ${index + 1}`,
    enabled: true,
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
  next.ui.selectedChainItemId = selectedComposition?.chain?.some((item) => item.id === next.ui.selectedChainItemId)
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
  }));
  next.scenes = Array.isArray(input.scenes)
    ? input.scenes.map((scene) => normalizeScene(scene, next))
    : [];
  next.ui.selectedSceneId = next.scenes.some((scene) => scene.id === next.ui.selectedSceneId)
    ? next.ui.selectedSceneId
    : next.scenes[0]?.id || "";
  next.ui.live = normalizeLiveUi(next.ui.live);
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
  if (scene) applySceneSnapshotToState(next, scene);
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

function normalizeLiveUi(live = {}) {
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
  return {
    selectedSceneId: live.selectedSceneId ? String(live.selectedSceneId) : "",
    compositionOverrides,
  };
}

function normalizeLiveChainItemOverride(item = {}) {
  if (!item || typeof item !== "object") return {};
  const params = item.params && typeof item.params === "object" ? { ...item.params } : {};
  return {
    ...(item.enabled !== undefined ? { enabled: item.enabled !== false } : {}),
    ...(item.opacity !== undefined ? { opacity: clamp01(item.opacity) } : {}),
    ...(item.blend ? { blend: item.blend } : {}),
    ...(Object.keys(params).length ? { params } : {}),
    ...(item.amount !== undefined ? { amount: clamp01(item.amount) } : {}),
    ...(item.transform && typeof item.transform === "object" ? { transform: normalizeTransform(item.transform) } : {}),
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
  const source = normalizeSource({
    type: compositionData.source?.type || fallback.source.type,
    mediaId: compositionData.source?.mediaId || "",
    generatorId: compositionData.source?.generatorId || fallback.source.generatorId,
  });
  const shaderChain = Array.isArray(compositionData.shaderChain)
    ? compositionData.shaderChain.map(normalizeShaderPass)
    : [];
  const chain = Array.isArray(compositionData.chain) && compositionData.chain.length
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
  return {
    ...fallback,
    ...compositionData,
    id: compositionData.id || uid("composition"),
    name: compositionData.name || fallback.name,
    source,
    opacity: clamp01(compositionData.opacity ?? fallback.opacity),
    speed: Math.max(0, Number(compositionData.speed ?? fallback.speed) || 0),
    blend: compositionData.blend || fallback.blend,
    thumbnail: typeof compositionData.thumbnail === "string" ? compositionData.thumbnail : "",
    chain,
    shaderChain: [],
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
  const source = normalizeSource(item.source || { type: "generator", generatorId: item.componentId || "testPattern" });
  return {
    id: item.id || uid("chain"),
    kind: "source",
    componentId: sourceComponentId(source),
    name: item.name || sourceLabel(source),
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
  return {
    type: source.type || "generator",
    mediaId: source.mediaId || "",
    generatorId: source.generatorId || "testPattern",
  };
}

function sourceComponentId(source = {}) {
  if (source.type === "generator") return source.generatorId || "testPattern";
  return `source.${source.type || "black"}`;
}

function sourceLabel(source = {}) {
  if (source.type === "media") return source.mediaId || "Media";
  if (source.type === "camera") return "Camera";
  if (source.type === "black") return "Black";
  return source.generatorId || "Generator";
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
  return {
    ...item,
    ...(override.enabled !== undefined ? { enabled: override.enabled !== false } : {}),
    ...(override.opacity !== undefined ? { opacity: clamp01(override.opacity) } : {}),
    ...(override.blend ? { blend: override.blend } : {}),
    ...(override.transform && typeof override.transform === "object"
      ? { transform: normalizeTransform({ ...(item.transform || {}), ...override.transform }) }
      : {}),
  };
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
