import { VJ1, defaultCustomShaderCode, WORKSPACES } from "../constants.js";
import { createGeneratorSource } from "../libraries/visual-nodes/index.js?v=node-catalog-14";
import { normalizeComponentFrameShape, normalizeComponentResolutionScale } from "./component-frame.js";
import { createProjectActivity, normalizeProjectActivity } from "./component-activity.js?v=adaptive-component-demand-29";
import { normalizeCatalogMarker } from "./catalog-marker.js?v=catalog-marker-four-state-1";
import { CURRENT_PROJECT_VERSION, migrateProjectData } from "./project-migrations.js?v=boundary-authority-1";
import { createEmptyNodeProjectData, normalizeNodeProjectData } from "../libraries/node-engine/node-project.js";
import { normalizeRelativeRect, projectedQuadAspect } from "../libraries/render-engine/relative-geometry.js?v=frame-projection-aspect-1";
import { FULL_NODE_BOUNDARY, normalizeNodeBoundary } from "../libraries/render-engine/roi/index.js";
import {
  createOutputDefinition,
  normalizeCameraSettings,
  normalizeComponentPipelineSettings,
  normalizePreviewViewports,
  normalizeRenderSettings,
  normalizeSamplingSettings,
} from "./render-settings.js?v=screen-input-registry-1";
import {
  applySceneSourceNode,
  materializeLiveTargetSurfaceRoutes,
  materializeSceneSurfaceRoutes,
  normalizeProjectionFit,
  resolveSceneSourceNode,
  sceneSourceNodeId,
  sceneSourceNodes,
} from "./scene-routing.js?v=live-source-target-1";

export {
  createOutputDefinition,
  normalizeCameraSettings,
  normalizeComponentPipelineSettings,
  normalizePreviewViewport,
  normalizePreviewViewports,
  normalizeRenderSettings,
  normalizeSamplingSettings,
} from "./render-settings.js?v=screen-input-registry-1";
export {
  applySceneSourceNode,
  materializeLiveTargetSurfaceRoutes,
  materializeSceneSurfaceRoutes,
  normalizeProjectionFit,
  resolveSceneSourceNode,
  sceneSourceNodeId,
  sceneSourceNodes,
} from "./scene-routing.js?v=live-source-target-1";

export function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export const MAPPING_TEST_PATTERN_COMPONENT_ID = "vj1-system-mapping-test-pattern";

export function createMappingTestPatternComponent() {
  const component = createDefaultComponent(0);
  component.id = MAPPING_TEST_PATTERN_COMPONENT_ID;
  component.name = "Mapping test pattern";
  component.systemRole = "mapping-test-pattern";
  component.activity = { createdAt: "2000-01-01T00:00:00.000Z", updatedAt: "2000-01-01T00:00:00.000Z", lastUsedAt: "" };
  component.chain = [
    {
      ...createComponentLayer(0, createGeneratorSource("testPattern")),
      id: "vj1-system-mapping-test-pattern-source",
      name: "Mapping test pattern",
    },
  ];
  return component;
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

export function createSceneComponent(index = 0, sourceComponentId = "") {
  const id = uid("component");
  return {
    id,
    type: "scene",
    name: `Scene ${index + 1}`,
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
    scene: {
      frameThumbnails: {},
      frames: [],
    },
  };
}

export function createFrameSlot(index = 0) {
  return {
    id: uid("frame"),
    name: index === 0 ? "Frame 1" : `Frame ${index + 1}`,
    x: 0.375,
    y: 0.375,
    width: 0.25,
    height: 0.25,
    fit: "cover",
    kind: "user",
    keepProportions: true,
    activity: createProjectActivity(),
  };
}

export function outputFrameSlotId(outputId = "") {
  return outputId === "all"
    ? "frame-output-all"
    : `frame-output-${encodeURIComponent(outputId)}`;
}

// Output Frames are derived slots whose default aspect follows the Output
// projection. Their position and scale remain authored like every other Frame.
// With multiple Outputs the combined span is also exposed, so two windows
// yield three slots: All outputs, Output 1, and Output 2.
export function outputFrameSlotDefinitions(render = {}) {
  const outputs = Array.isArray(render.outputs) && render.outputs.length
    ? render.outputs
    : [{ id: "output-main", name: "Main output", aspectRatio: 16 / 9 }];
  const sceneAspect = Math.max(0.05, Number(render.sceneAspectRatio) || 16 / 9);
  const aspectSum = outputs.reduce((sum, output) => sum + Math.max(0.05, Number(output.aspectRatio) || 16 / 9), 0);
  const span = relativeAspectRect(aspectSum, sceneAspect);
  const definitions = [];
  if (outputs.length > 1) {
    definitions.push({
      id: outputFrameSlotId("all"),
      name: "All outputs",
      outputIds: outputs.map((output) => String(output.id || "")),
      ...span,
    });
  }
  let cursor = span.x;
  for (let index = 0; index < outputs.length; index++) {
    const output = outputs[index] || {};
    const aspect = Math.max(0.05, Number(output.aspectRatio) || 16 / 9);
    const width = span.width * aspect / aspectSum;
    definitions.push({
      id: outputFrameSlotId(String(output.id || (index === 0 ? "output-main" : `output-${index + 1}`))),
      name: output.name || (index === 0 ? "Main output" : `Output ${index + 1}`),
      outputIds: [String(output.id || (index === 0 ? "output-main" : `output-${index + 1}`))],
      x: cursor,
      y: span.y,
      width,
      height: span.height,
    });
    cursor += width;
  }
  return definitions.map((definition) => ({
    ...definition,
    kind: "output",
    locked: false,
    keepProportions: true,
    fit: "cover",
    feather: 0,
    activity: { createdAt: "2000-01-01T00:00:00.000Z", updatedAt: "2000-01-01T00:00:00.000Z", lastUsedAt: "" },
  }));
}

export function reconcileOutputFrameSlots(frames = [], render = {}) {
  const existingById = new Map((frames || []).map((frame) => [String(frame?.id || ""), frame]));
  const outputFrames = outputFrameSlotDefinitions(render).map((definition, index) => {
    const existing = existingById.get(String(definition.id));
    if (!existing) return definition;
    const keepProportions = existing.keepProportions !== false;
    const authoredRect = normalizeRelativeRect(existing, definition);
    const rect = keepProportions
      ? relativeRectWithAspect(authoredRect, definition.width / definition.height)
      : authoredRect;
    return normalizeFrameSlot({
      ...existing,
      ...definition,
      ...rect,
      keepProportions,
      locked: false,
    }, index);
  });
  const userFrames = (frames || [])
    .filter((frame) => frame?.kind !== "output" && !String(frame?.id || "").startsWith("frame-output-"))
    .map((frame, index) => normalizeFrameSlot({ ...frame, kind: "user", locked: false }, index));
  return [...outputFrames, ...userFrames];
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
    boundary: { ...FULL_NODE_BOUNDARY },
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

export function createDefaultMapping(index = 0, surfaces = null) {
  const ownedSurfaces = Array.isArray(surfaces)
    ? surfaces
    : [createDefaultSurface(0), createDefaultSurface(1)];
  return {
    id: uid("mapping"),
    name: `Mapping ${index + 1}`,
    notes: "",
    catalogMarker: 0,
    surfaces: clone(ownedSurfaces),
    calibration: {},
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
  const mapping = createDefaultMapping(0);
  return {
    version: CURRENT_PROJECT_VERSION,
    project: {
      name: "Untitled VJ Set",
      folderName: "",
      savedAt: "",
      warnings: [],
    },
    ui: {
      workspace: "mapping",
      selectedComponentId: components[0].id,
      selectedChainItemId: components[0].chain[0]?.id || "",
      selectedNodeDefinitionId: "",
      selectedNodeGroupId: "",
      workspaceSelectionIds: {
        component: components[0].id,
        scene: "",
      },
      catalogSortModes: {
        component: "recent",
        scene: "recent",
        mapping: "recent",
        source: "recent",
        media: "recent",
      },
      previewQuality: "good",
      selectedMappingId: mapping.id,
      selectedSurfaceId: mapping.surfaces[0]?.id || "",
      selectedFrameId: "",
      mappingTestPattern: true,
      debugPreview: true,
      outputWindowOpen: false,
      live: {
        selectedSceneId: "",
        selectedComponentId: "",
        sourceKind: "scene",
        componentView: "controls",
        surfaceRoutes: null,
        componentOverrides: {},
        sceneOverrides: {},
        transitionDuration: 0,
        paramFadeDuration: 0,
        transition: null,
      },
      previewViewports: {
        component: { zoom: 1, x: 0, y: 0, fit: "world" },
        scene: { zoom: 1, x: 0, y: 0, fit: "world" },
        mapping: { zoom: 1, x: 0, y: 0, fit: "world" },
        live: { zoom: 1, x: 0, y: 0, fit: "world" },
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
      calibrating: true,
      mappingHandleMode: "always",
    },
    render: {
      outputs: [createOutputDefinition(0)],
      sceneAspectRatio: VJ1.sceneWidth / VJ1.sceneHeight,
      componentAspectRatio: VJ1.renderWidth / VJ1.renderHeight,
      resolutionCeiling: "auto",
      pixelDensity: 1,
      sampling: {
        surfaceOverscan: 1,
        recordingFrameScale: 1,
        limitSceneToLogicalSize: true,
      },
      camera: {
        facingMode: "user",
        mirrored: false,
        maxResolution: false,
      },
      screenCapture: {
        frameRate: 30,
        cursor: "always",
        preferCurrentTab: false,
        includeCurrentTab: true,
        surfaceSwitching: true,
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
    nodes: createEmptyNodeProjectData(),
    media: [],
    components,
    frames: [createFrameSlot(0)],
    // Renderer-facing projections of the selected Mapping. These are derived
    // by sanitizeState() and deliberately excluded from project persistence.
    surfaces: clone(mapping.surfaces),
    mappingCalibration: {},
    mappings: [mapping],
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
  next.nodes = normalizeNodeProjectData(input.nodes);
  delete next.global.showLabels;
  next.global.timeStretch = clampNumber(input.global?.timeStretch, -4, 4, 0);

  next.render = normalizeRenderSettings(input.render || {});
  next.components = normalizeComponents(input, base);
  const frames = reconcileOutputFrameSlots(Array.isArray(input.frames) ? input.frames : base.frames, next.render);
  const seenRecordingFrameIds = new Set();
  next.frames = frames
    .map((frame, index) => normalizeFrameSlot(frame, index))
    .filter((frame) => {
      if (seenRecordingFrameIds.has(frame.id)) return false;
      seenRecordingFrameIds.add(frame.id);
      return true;
    });
  for (const component of next.components) {
    if (component.type !== "scene") continue;
    const configured = new Map((component.scene?.frames || []).map((frame) => [String(frame.frameId || ""), frame]));
    component.scene.frames = next.frames.map((frame) => normalizeSceneFrameConfig({
      frameId: frame.id,
      ...(configured.get(String(frame.id)) || {}),
    }));
  }
  const importedSurfaces = Array.isArray(input.surfaces) && input.surfaces.length
    ? input.surfaces.map((surface) => normalizeSurface(surface))
    : [createDefaultSurface(0), createDefaultSurface(1)];
  next.ui.previewViewports = normalizePreviewViewports(input.ui?.previewViewports);
  next.media = Array.isArray(input.media) ? input.media.map(normalizeMediaMeta) : [];
  next.ui.selectedComponentId = next.components.some((component) => component.id === next.ui.selectedComponentId)
    ? next.ui.selectedComponentId
    : next.components[0]?.id || "";
  next.ui.workspaceSelectionIds = normalizeWorkspaceSelectionIds(
    next.ui.workspaceSelectionIds,
    next.components,
    next.ui.selectedComponentId
  );
  next.ui.catalogSortModes = normalizeCatalogSortModes(next.ui.catalogSortModes);
  next.ui.previewQuality = normalizePreviewQuality(
    next.ui.previewQuality
      ?? next.ui.previewQualities?.scene
      ?? next.ui.previewQualities?.live
  );
  delete next.ui.previewQualities;
  const selectedComponent = next.components.find((component) => component.id === next.ui.selectedComponentId) || next.components[0];
  next.ui.selectedChainItemId = chainContainsItemId(selectedComponent?.chain, next.ui.selectedChainItemId)
    ? next.ui.selectedChainItemId
    : selectedComponent?.chain?.[0]?.id || "";
  next.mappings = Array.isArray(input.mappings)
    ? input.mappings.map((mapping) => normalizeMapping(mapping, next, importedSurfaces))
    : [];
  if (!next.mappings.length) next.mappings = [normalizeMapping(createDefaultMapping(0, importedSurfaces), next, importedSurfaces)];
  next.ui.selectedMappingId = next.mappings.some((scene) => scene.id === next.ui.selectedMappingId)
    ? next.ui.selectedMappingId
    : next.mappings[0]?.id || "";
  projectSelectedMapping(next);
  syncFrameProportionsFromMapping(next);
  next.ui.selectedSurfaceId = next.surfaces.some((surface) => surface.id === next.ui.selectedSurfaceId)
    ? next.ui.selectedSurfaceId
    : next.surfaces[0]?.id || "";
  next.ui.selectedFrameId = next.frames.some((frame) => frame.id === next.ui.selectedFrameId)
    ? next.ui.selectedFrameId
    : "";
  next.ui.mappingTestPattern = next.ui.mappingTestPattern !== false;
  next.ui.live = normalizeLiveUi(next.ui.live, next);
  next.ui.workspace = WORKSPACES.includes(next.ui.workspace) ? next.ui.workspace : "mapping";
  next.global.calibrating = next.ui.workspace === "mapping";
  next.scheduler.mode = next.scheduler.mode || "hardconfigured";
  next.scheduler.manualLane = next.scheduler.manualLane !== false;
  return next;
}

function normalizePreviewQuality(value) {
  if (value === "full") return "good";
  if (value === "high") return "good";
  return ["auto", "good", "low"].includes(value) ? value : "good";
}

function normalizeWorkspaceSelectionIds(value = {}, components = [], selectedComponentId = "") {
  const selected = components.find((component) => component.id === selectedComponentId);
  const ordinary = components.filter((component) => component.type !== "scene" && !component.systemRole);
  const scenes = components.filter((component) => component.type === "scene");
  const componentId = ordinary.some((component) => component.id === value?.component)
    ? value.component
    : selected?.type !== "scene" ? selected?.id || ordinary[0]?.id || "" : ordinary[0]?.id || "";
  const sceneId = scenes.some((component) => component.id === value?.scene)
    ? value.scene
    : selected?.type === "scene" ? selected.id : scenes[0]?.id || "";
  return { component: componentId, scene: sceneId };
}

function normalizeCatalogSortModes(value = {}) {
  const normalize = (mode) => ["recent", "marker", "name", "created"].includes(mode) ? mode : "recent";
  return {
    component: normalize(value?.component),
    scene: normalize(value?.scene),
    mapping: normalize(value?.mapping),
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
  const scene = next.components?.find((item) => item.type === "scene" && item.id === sceneId);
  const target = liveTargetComponent(next, scene);
  const mapping = next.mappings?.find((item) => item.id === next.ui?.selectedMappingId) || next.mappings?.[0] || null;
  if (target && mapping) {
    const routeState = materializeLiveTargetSurfaceRoutes(next, target, live.surfaceRoutes || mapping);
    next.surfaces = clone(routeState.surfaces);
    const selectedMapping = next.mappings?.find((item) => item.id === mapping.id);
    if (selectedMapping) selectedMapping.surfaces = clone(routeState.surfaces);
    next.mappingCalibration = clone(mapping.calibration || {});
  }
  next.ui.selectedMappingId = mapping?.id || "";
  next.global.calibrating = false;
  applyLiveComponentOverrides(next, live.componentOverrides);
  materializeLivePatchTargets(next);

  const transition = live.transition;
  const durationMs = Math.max(0, Number(transition?.durationMs) || 0);
  const startedAtMs = Number(transition?.startedAtMs) || 0;
  if (durationMs > 0 && startedAtMs + durationMs > Date.now() && transition?.fromSurfaceRoutes) {
    const fromState = clone(state);
    fromState.surfaces = clone(transition.fromSurfaceRoutes.surfaces || []);
    const fromMapping = fromState.mappings?.find((item) => item.id === mapping?.id);
    if (fromMapping) fromMapping.surfaces = clone(fromState.surfaces);
    fromState.mappingCalibration = clone(mapping?.calibration || {});
    fromState.ui.selectedMappingId = mapping?.id || fromState.ui.selectedMappingId || "";
    fromState.global.calibrating = false;
    applyLiveComponentOverrides(fromState, transition.fromComponentOverrides);
    materializeLivePatchTargets(fromState);
    fromState.ui.live.transition = null;
    next.liveTransition = {
      id: transition.id || `${transition.fromTargetId || transition.fromSceneId || "target"}:${target?.id || sceneId}:${startedAtMs}`,
      startedAtMs,
      durationMs,
      componentsShared: JSON.stringify(transition.fromComponentOverrides || {}) === JSON.stringify(live.componentOverrides || {}),
      fromState,
    };
  }
  return next;
}

// The embedded Live monitor previews the selected Scene or Component target.
// It uses the same surface renderer as Mapping/Output, but projects the target onto one
// transient direct route so the reusable preview host can also use the
// established transition compositor. Nothing here is persisted or adds a
// second preview implementation.
export function createLiveScenePreviewState(state = createInitialState()) {
  const next = clone(state);
  const live = next.ui?.live || {};
  const sceneId = String(live.selectedSceneId || "");
  const scene = next.components?.find((item) => item.type === "scene" && String(item.id) === sceneId)
    || next.components?.find((item) => item.type === "scene")
    || null;
  const target = liveTargetComponent(next, scene);
  if (!target) return next;
  applyLiveMonitorTarget(next, target);
  applyLiveComponentOverrides(next, live.componentOverrides);
  materializeLivePatchTargets(next);

  const transition = live.transition;
  const durationMs = Math.max(0, Number(transition?.durationMs) || 0);
  const startedAtMs = Number(transition?.startedAtMs) || 0;
  const previousTarget = next.components?.find((item) =>
    String(item.id) === String(transition?.fromTargetId || transition?.fromSceneId || "")
  );
  if (previousTarget && durationMs > 0 && startedAtMs + durationMs > Date.now()) {
    const fromState = clone(state);
    applyLiveMonitorTarget(fromState, previousTarget);
    applyLiveComponentOverrides(fromState, transition.fromComponentOverrides);
    materializeLivePatchTargets(fromState);
    fromState.ui.live.transition = null;
    next.liveTransition = {
      id: transition.id || `${previousTarget.id}:${target.id}:${startedAtMs}`,
      startedAtMs,
      durationMs,
      componentsShared: false,
      fromState,
    };
  }
  return next;
}

function liveTargetComponent(state = {}, fallbackScene = null) {
  const targetId = String(state.ui?.live?.selectedComponentId || "");
  return state.components?.find((item) => !item.systemRole && String(item.id) === targetId)
    || fallbackScene
    || null;
}

function applyLiveMonitorTarget(state, target) {
  const output = state.render?.outputs?.[0] || { id: "output-main" };
  const surface = normalizeSurface({
    ...createDefaultSurface(0),
    id: "surface-live-scene-monitor",
    name: "Live target monitor",
    enabled: true,
    opacity: 1,
    feather: 0,
    // Live is a presentation monitor for the primary Output frame. It should
    // fill that frame using the same cover policy users expect on-air; this
    // transient route is not a Mapping Surface preference and is not saved.
    projectionFit: "cover",
    sourceNodeId: sceneSourceNodeId(target.id),
    componentId: target.id,
    outputFrameId: "",
    frameSlotId: "",
    frameFitActive: false,
    showLabel: false,
    calibrationLocked: true,
    destination: { type: "direct", outputIds: [String(output.id || "output-main")] },
  });
  state.surfaces = [surface];
  const mapping = state.mappings?.find((item) => item.id === state.ui?.selectedMappingId) || state.mappings?.[0];
  if (mapping) mapping.surfaces = [clone(surface)];
  state.mappingCalibration = {};
  state.global.calibrating = false;
}

// Live controls edit a normalized view of optional model values. Materialize
// only the containers/structural transform that those controls address before
// this cloned state crosses the render transport boundary. This is not render
// traversal work and it does not expand the persisted project model.
function materializeLivePatchTargets(state) {
  for (const component of state.components || []) {
    component.transform = normalizeTransform(component.transform);
    materializeLiveChainPatchTargets(component.chain);
  }
}

function materializeLiveChainPatchTargets(chain = []) {
  for (const item of chain || []) {
    if (!item || typeof item !== "object") continue;
    item.transform = normalizeTransform(item.transform);
    if (item.kind === "effect") {
      if (!item.params || typeof item.params !== "object") item.params = {};
      continue;
    }
    if (item.kind === "source") {
      if (
        item.source &&
        ["generator", "media"].includes(item.source.type) &&
        (!item.source.params || typeof item.source.params !== "object")
      ) item.source.params = {};
      continue;
    }
    if (item.kind === "group") materializeLiveChainPatchTargets(item.chain);
  }
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
  const performanceScenes = state.components?.filter((component) => component.type === "scene") || [];
  const selectedSceneId = live.selectedSceneId && performanceScenes.some((scene) => String(scene.id) === String(live.selectedSceneId))
    ? String(live.selectedSceneId)
    : performanceScenes[0]?.id || "";
  const explicitTargetId = state.components?.some((component) => !component.systemRole && String(component.id) === String(live.selectedComponentId || ""))
    ? String(live.selectedComponentId)
    : "";
  const selectedTargetId = explicitTargetId || selectedSceneId;
  const selectedScene = performanceScenes.find((scene) => String(scene.id) === selectedSceneId);
  const selectedMapping = state.mappings?.find((mapping) => String(mapping.id) === String(state.ui?.selectedMappingId || "")) || state.mappings?.[0];
  const sceneOverrides = Object.fromEntries(Object.entries(live.sceneOverrides || {}).map(([sceneId, overrides]) => [
    String(sceneId),
    normalizeComponentOverrides(overrides),
  ]));
  const componentOverrides = normalizeComponentOverrides(
    sceneOverrides[selectedTargetId] || live.componentOverrides || {}
  );
  if (selectedTargetId && Object.keys(componentOverrides).length) sceneOverrides[selectedTargetId] = clone(componentOverrides);
  const transitionDuration = clampNumber(live.transitionDuration, 0, 30, 0);
  const paramFadeDuration = clampNumber(live.paramFadeDuration, 0, 30, 0);
  const transitionDurationMs = Math.max(0, Number(live.transition?.durationMs) || 0);
  const transitionStartedAtMs = Number(live.transition?.startedAtMs) || 0;
  const transition = transitionDurationMs > 0 && transitionStartedAtMs > 0 && live.transition?.fromSurfaceRoutes
      ? {
        id: String(live.transition.id || ""),
        fromSceneId: String(live.transition.fromSceneId || ""),
        fromTargetId: String(live.transition.fromTargetId || live.transition.fromSceneId || ""),
        fromSurfaceRoutes: normalizeSurfaceRoutes(live.transition.fromSurfaceRoutes, state),
        fromComponentOverrides: normalizeComponentOverrides(live.transition.fromComponentOverrides || {}),
        startedAtMs: transitionStartedAtMs,
        durationMs: Math.min(30000, transitionDurationMs),
      }
    : null;
  return {
    selectedSceneId,
    selectedComponentId: explicitTargetId,
    sourceKind: live.sourceKind === "component" ? "component" : "scene",
    componentView: live.componentView === "elements" ? "elements" : "controls",
    surfaceRoutes: live.surfaceRoutes
      ? normalizeSurfaceRoutes(live.surfaceRoutes, state)
      : selectedScene ? materializeSceneSurfaceRoutes(state, selectedScene, selectedMapping) : null,
    componentOverrides,
    sceneOverrides,
    transitionDuration,
    paramFadeDuration,
    transition,
  };
}

function normalizeSurfaceRoutes(routeState = {}, state = {}) {
  return {
    surfaces: (routeState?.surfaces || []).map((surface) => normalizeMappingSurface(surface, state)),
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
  const components = Array.isArray(input.components) && input.components.length
    ? input.components.map(normalizeComponent)
    : [createDefaultComponent(0)];
  if (!components.some((component) => component.systemRole === "mapping-test-pattern")) {
    components.push(normalizeComponent(createMappingTestPatternComponent()));
  }
  return components;
}

export function normalizeComponent(component = {}) {
  const fallback = createDefaultComponent(0);
  const {
    enabled,
    source: _legacySource,
    shaderChain: _legacyShaderChain,
    ...componentData
  } = component;
  const type = componentData.type === "scene" ? "scene" : "chain";
  const chain = Array.isArray(componentData.chain) ? componentData.chain.map(normalizeComponentChainItem) : [];
  const scene = type === "scene" ? normalizeSceneComponentData(componentData.scene, componentData.id) : null;
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
    chain,
    ...(type === "scene" ? { scene } : {}),
  };
}

function normalizeSceneComponentData(scene = {}, selfId = "") {
  const frameThumbnails = Object.fromEntries(Object.entries(scene.frameThumbnails || {})
    .filter(([frameId, thumbnail]) => frameId && typeof thumbnail === "string" && thumbnail));
  return {
    frameThumbnails,
    frames: Array.isArray(scene.frames) ? scene.frames.map(normalizeSceneFrameConfig) : [],
  };
}

function normalizeSceneFrameConfig(frame = {}) {
  return {
    frameId: String(frame.frameId || ""),
    componentId: String(frame.componentId || ""),
    fit: normalizeProjectionFit(frame.fit),
  };
}


function normalizeFrameSlot(frame = {}, index = 0) {
  const fallback = createFrameSlot(index);
  const rect = normalizeRelativeRect(frame, fallback);
  return {
    id: frame.id || uid("frame"),
    name: frame.name || fallback.name,
    ...rect,
    fit: normalizeProjectionFit(frame.fit),
    kind: frame.kind === "output" ? "output" : "user",
    locked: false,
    keepProportions: frame.keepProportions !== false,
    outputIds: frame.kind === "output" ? (frame.outputIds || []).map(String) : [],
    activity: normalizeProjectActivity(frame.activity, fallback.activity.createdAt),
  };
}

export function syncFrameProportionsFromMapping(state = {}, mapping = null) {
  mapping ||= state.mappings?.find((item) => String(item.id) === String(state.ui?.selectedMappingId || ""))
    || state.mappings?.[0]
    || null;
  if (!mapping) return state;
  const calibration = Array.isArray(mapping.calibration?.surfaces) ? mapping.calibration.surfaces : [];
  const calibrationById = new Map(calibration.flatMap((surface) => {
    const keys = [surface?.id, surface?.name].filter(Boolean).map(String);
    return keys.map((key) => [key, surface]);
  }));
  const sceneAspect = Math.max(0.05, Number(state.render?.sceneAspectRatio) || 16 / 9);
  for (const frame of state.frames || []) {
    if (frame.kind === "output" || frame.keepProportions === false) continue;
    const route = (mapping.surfaces || []).find((surface) =>
      surface.enabled !== false &&
      surface.destination?.type !== "direct" &&
      String(surface.frameSlotId || surface.outputFrameId || "") === String(frame.id || "")
    );
    if (!route) continue;
    const projected = calibrationById.get(String(route.id || ""))
      || calibrationById.get(String(route.name || ""));
    if (!projected?.corners) continue;
    const fallback = Number(projected.w) > 0 && Number(projected.h) > 0
      ? Number(projected.w) / Number(projected.h)
      : sceneAspect * frame.width / frame.height;
    const naturalAspect = projectedQuadAspect(projected.corners, fallback);
    Object.assign(frame, relativeRectWithAspect(frame, naturalAspect / sceneAspect));
  }
  return state;
}

function relativeRectWithAspect(rect = {}, relativeAspect = 1) {
  const normalized = normalizeRelativeRect(rect);
  const ratio = Math.max(0.005, Number(relativeAspect) || 1);
  if (Math.abs(normalized.width / normalized.height - ratio) < 1e-9) return normalized;
  const centerX = normalized.x + normalized.width * 0.5;
  const centerY = normalized.y + normalized.height * 0.5;
  const area = normalized.width * normalized.height;
  let width = Math.sqrt(area * ratio);
  let height = width / ratio;
  const shrink = Math.min(1, 1 / width, 1 / height);
  width *= shrink;
  height *= shrink;
  return normalizeRelativeRect({
    x: centerX - width * 0.5,
    y: centerY - height * 0.5,
    width,
    height,
  });
}

function relativeAspectRect(contentAspect, parentAspect) {
  const content = Math.max(0.05, Number(contentAspect) || 1);
  const parent = Math.max(0.05, Number(parentAspect) || 1);
  if (content >= parent) {
    const height = parent / content;
    return { x: 0, y: (1 - height) * 0.5, width: 1, height };
  }
  const width = content / parent;
  return { x: (1 - width) * 0.5, y: 0, width, height: 1 };
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
      boundary: normalizeNodeBoundary(item.boundary),
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
      boundary: normalizeNodeBoundary(item.boundary),
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
    boundary: normalizeNodeBoundary(item.boundary),
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
    frameSlotId: surface.frameSlotId || surface.outputFrameId || "",
    frameFit: normalizeProjectionFit(surface.frameFit),
    frameFitActive: surface.frameFitActive === true,
    frameAspect: Math.max(0.0001, Number(surface.frameAspect) || 1),
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
    ? String(source.generatorId).startsWith("isf-")
      ? { type: "generator", generatorId: source.generatorId, params }
      : createGeneratorSource(source.generatorId, params)
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

export function normalizeMapping(mapping = {}, state = {}, fallbackSurfaces = []) {
  const physicalById = new Map((fallbackSurfaces || []).map((surface) => [String(surface.id || ""), surface]));
  const authoredSurfaces = Array.isArray(mapping.surfaces) ? mapping.surfaces : fallbackSurfaces;
  const surfaces = authoredSurfaces.map((surface) => normalizeMappingSurface({
    ...(physicalById.get(String(surface?.id || "")) || {}),
    ...(surface || {}),
  }, state));
  return {
    id: String(mapping.id || uid("mapping")),
    name: mapping.name || "Mapping",
    notes: mapping.notes || "",
    catalogMarker: normalizeCatalogMarker(mapping.catalogMarker),
    surfaces: reconcileDirectOutputSurfaces(surfaces, state.render || {}),
    calibration: normalizeMappingCalibration(mapping.calibration),
  };
}

function normalizeMappingCalibration(calibration = {}) {
  if (!calibration || typeof calibration !== "object" || Array.isArray(calibration)) return {};
  return clone(calibration);
}

export function createMappingSurface(surface = {}) {
  return clone(normalizeSurface(surface));
}

export function normalizeMappingSurface(surface = {}, state = {}) {
  const route = applySceneSourceNode(surface, resolveSceneSourceNode(state, surface.sourceNodeId));
  return normalizeSurface({
    ...surface,
    sourceNodeId: route.sourceNodeId,
    componentId: route.componentId,
    outputFrameId: route.outputFrameId,
  });
}

export function createMappingFromState(state, name) {
  return {
    id: uid("mapping"),
    name,
    notes: "",
    catalogMarker: 0,
    surfaces: clone(state.surfaces || []),
    calibration: clone(state.mappingCalibration || {}),
  };
}

export function createEmptyMappingFromState(state, name) {
  return {
    id: uid("mapping"),
    name,
    notes: "",
    catalogMarker: 0,
    surfaces: clone((state.surfaces || []).map((surface) => ({
      ...surface,
      enabled: surface.destination?.type === "direct" ? surface.enabled !== false : false,
      sourceNodeId: "",
      componentId: "",
      outputFrameId: "",
      frameSlotId: "",
    }))),
    calibration: clone(state.mappingCalibration || {}),
  };
}

export function syncLiveRoutesFromMapping(state, mapping) {
  if (!mapping?.surfaces || String(state.ui?.selectedMappingId || "") !== String(mapping.id || "")) return state;
  state.ui.live.surfaceRoutes = { surfaces: clone(mapping.surfaces) };
  return state;
}

export function applyMappingForEditing(state, mapping) {
  if (!mapping?.surfaces) return state;
  const next = sanitizeState({ ...clone(state), ui: { ...clone(state.ui), selectedMappingId: mapping.id } });
  const selectedMapping = next.mappings?.find((item) => String(item.id) === String(mapping.id)) || null;
  if (!selectedMapping) return next;
  if (next.ui?.mappingTestPattern !== false) {
    const component = next.components.find((item) => item.systemRole === "mapping-test-pattern");
    selectedMapping.surfaces = selectedMapping.surfaces.map((surface) => ({
      ...surface,
      sourceNodeId: component ? sceneSourceNodeId(component.id) : "",
      componentId: component?.id || "",
      outputFrameId: "",
      frameFitActive: false,
    }));
    next.surfaces = clone(selectedMapping.surfaces);
    return next;
  }
  const sceneId = String(next.ui?.live?.selectedSceneId || "");
  const scene = next.components?.find((component) => component.type === "scene" && String(component.id) === sceneId)
    || next.components?.find((component) => component.type === "scene")
    || null;
  if (scene) {
    selectedMapping.surfaces = materializeSceneSurfaceRoutes(next, scene, selectedMapping).surfaces;
    next.surfaces = clone(selectedMapping.surfaces);
  }
  next.ui.selectedMappingId = mapping.id;
  return next;
}

export function projectSelectedMapping(state, mapping = null) {
  mapping ||= state.mappings?.find((item) => String(item.id) === String(state.ui?.selectedMappingId || ""))
    || state.mappings?.[0]
    || null;
  if (!mapping) {
    state.surfaces = [];
    state.mappingCalibration = {};
    return state;
  }
  state.surfaces = clone(mapping.surfaces || []);
  state.mappingCalibration = clone(mapping.calibration || {});
  state.ui.selectedMappingId = mapping.id;
  return state;
}
