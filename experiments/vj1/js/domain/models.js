import { VJ1, defaultCustomShaderCode, WORKSPACES } from "../constants.js";
import { createGeneratorSource } from "../libraries/visual-nodes/index.js?v=node-catalog-14";
import { componentFrameMetrics, normalizeComponentFrameShape, normalizeComponentResolutionScale } from "./component-frame.js";
import { createProjectActivity, normalizeProjectActivity } from "./component-activity.js?v=adaptive-component-demand-29";
import { normalizeCatalogMarker } from "./catalog-marker.js?v=catalog-marker-four-state-1";
import { CURRENT_PROJECT_VERSION, migrateProjectData } from "./project-migrations.js?v=surface-identity-2";
import { createEmptyNodeProjectData, normalizeNodeProjectData } from "../libraries/node-engine/node-project.js";
import { normalizeRelativeRect, projectedQuadAspect, projectedRelativeQuadAspect } from "../libraries/render-engine/relative-geometry.js?v=surface-relative-aspect-1";
import { FULL_NODE_BOUNDARY, normalizeNodeBoundary } from "../libraries/render-engine/roi/index.js";
import {
  createOutputDefinition,
  normalizeCameraSettings,
  normalizeComponentPipelineSettings,
  normalizePreviewViewports,
  normalizeRenderSettings,
  normalizeOutputName,
  normalizeSamplingSettings,
} from "./render-settings.js?v=output-one-1";
import {
  applySceneSourceNode,
  authoredSurfaceFields,
  materializeLiveProgramSurfaceRoutes,
  materializeLiveSurfacePatchRoute,
  materializeLiveTargetSurfaceRoutes,
  materializeSceneSurfaceRoutes,
  normalizeProjectionFit,
  rebaseSurfaceRouteProgram,
  resolveSceneSourceNode,
  sceneSourceNodeId,
  sceneSourceNodes,
} from "./scene-routing.js?v=transition-start-fit-1";
import { compileLiveProjectionProgram } from "./live-projection-program.js?v=live-projection-program-1";

export {
  createOutputDefinition,
  normalizeCameraSettings,
  normalizeComponentPipelineSettings,
  normalizePreviewViewport,
  normalizePreviewViewports,
  normalizeRenderSettings,
  normalizeOutputName,
  normalizeSamplingSettings,
} from "./render-settings.js?v=output-one-1";
export {
  applySceneSourceNode,
  authoredSurfaceFields,
  materializeLiveProgramSurfaceRoutes,
  materializeLiveSurfacePatchRoute,
  materializeLiveTargetSurfaceRoutes,
  materializeSceneSurfaceRoutes,
  normalizeProjectionFit,
  rebaseSurfaceRouteProgram,
  resolveSceneSourceNode,
  sceneSourceNodeId,
  sceneSourceNodes,
} from "./scene-routing.js?v=transition-start-fit-1";

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
      surfaceThumbnails: {},
    },
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
    x: 0.375,
    y: 0.375,
    width: 0.25,
    height: 0.25,
    keepProportions: true,
    enabled: true,
    opacity: 1,
    feather: 0,
    projectionFit: "cover",
    finalBlend: "normal",
    finalShaderChain: [],
    mappingId: id,
    showLabel: true,
    calibrationLocked: false,
    destination: { type: "mapped" },
    activity: createProjectActivity(),
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

// A new project begins as a small, working tour of the composition model.
// It deliberately uses only built-in procedural nodes so opening an empty
// folder never depends on media files or project-owned node definitions.
// Direct output surfaces remain derived from render.outputs; the template owns
// only the user projection surface that can be positioned in Scene/Mapping.
export function createStartupProjectTemplate() {
  const testPattern = createDefaultComponent(0);

  const plasma = createDefaultComponent(1, { empty: true });
  plasma.chain = [createComponentLayer(0, createGeneratorSource("plasma", {
    renderQuality: 0.5,
    motionMode: "drift",
    speed: 0.65,
    direction: 0.65,
    frequency: 8,
    complexity: 0.7,
    distortion: 0.55,
    colorSpeed: 0.22,
    hueShift: 0,
  }))];

  const liveText = createDefaultComponent(2, { empty: true });
  liveText.chain = [
    createComponentLayer(0, createGeneratorSource("text", {
      renderQuality: 0.5,
      text: "# VJ1\nLIVE TEXT",
      bold: true,
      layout: "fit lines",
      fontFamily: "sans",
      fontSize: 96,
      align: "center",
      verticalAlign: "center",
      lineHeight: 0.92,
      padding: 0.06,
      fillColor: "#ffffffff",
      backgroundColor: "#00000000",
    })),
    createComponentEffect("heartbeatPulse", { amount: 0.35 }),
  ];

  const sceneOne = createSceneComponent(0);
  const plasmaLayer = createComponentLayer(0, { type: "component", componentId: plasma.id });
  plasmaLayer.boundary = { x: -0.14, y: 0.12, width: 0.59, height: 0.59, rotation: 0 };
  const textLayer = createComponentLayer(1, { type: "component", componentId: liveText.id });
  textLayer.boundary = { x: -0.15, y: 0.12, width: 0.55, height: 0.55, rotation: 0 };
  sceneOne.chain = [plasmaLayer, textLayer];

  const sceneTwo = createSceneComponent(1);
  const fullPlasmaLayer = createComponentLayer(0, { type: "component", componentId: plasma.id });
  fullPlasmaLayer.boundary = { x: -0.02, y: -0.02, width: 1.04, height: 1.04, rotation: 0 };
  sceneTwo.chain = [fullPlasmaLayer];

  const projectionSurface = {
    ...createDefaultSurface(0),
    x: 0.423,
    y: 0.297,
    width: 0.154,
    height: 0.407,
  };
  const mapping = createDefaultMapping(0, [projectionSurface]);
  const ordinaryComponents = [testPattern, plasma, liveText];
  const scenes = [sceneOne, sceneTwo];
  return {
    components: [...ordinaryComponents, ...scenes],
    mapping,
    selectedComponentId: ordinaryComponents[0].id,
    selectedSceneId: scenes[0].id,
  };
}

export function directOutputSurfaceId(outputId = "") {
  return outputId === "all"
    ? "surface-direct-all"
    : `surface-direct-${encodeURIComponent(outputId)}`;
}

export function directOutputSurfaceDefinitions(render = {}) {
  const outputs = Array.isArray(render.outputs) && render.outputs.length
    ? render.outputs
    : [{ id: "output-main", name: "Output 1", aspectRatio: 16 / 9 }];
  const sceneAspect = Math.max(0.05, Number(render.sceneAspectRatio) || 16 / 9);
  const aspectSum = outputs.reduce((sum, output) => sum + Math.max(0.05, Number(output.aspectRatio) || 16 / 9), 0);
  const span = relativeAspectRect(aspectSum, sceneAspect);
  const definitions = [];
  if (outputs.length > 1) {
    definitions.push({
      id: directOutputSurfaceId("all"),
      name: "Full surface · Direct",
      outputIds: outputs.map((output) => output.id),
      ...span,
    });
  }
  let cursor = span.x;
  for (const output of outputs) {
    const aspect = Math.max(0.05, Number(output.aspectRatio) || 16 / 9);
    const width = span.width * aspect / aspectSum;
    definitions.push({
      id: directOutputSurfaceId(output.id),
      name: `${output.name} · Direct`,
      outputIds: [output.id],
      x: cursor,
      y: span.y,
      width,
      height: span.height,
    });
    cursor += width;
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
    const keepProportions = existing?.keepProportions !== false;
    const authoredRect = normalizeRelativeRect(existing || definition, definition);
    const rect = keepProportions
      ? relativeRectWithAspect(authoredRect, definition.width / definition.height)
      : authoredRect;
    normalized.push(normalizeMappingSurface({
      ...createDefaultSurface(0),
      ...(existing || {}),
      id: definition.id,
      name: definition.name,
      ...rect,
      keepProportions,
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

export function createInitialState({ startupTemplate = false } = {}) {
  const startup = startupTemplate ? createStartupProjectTemplate() : null;
  const components = startup?.components || [createDefaultComponent(0)];
  const mapping = startup?.mapping || createDefaultMapping(0);
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
        component: startup?.selectedComponentId || components[0].id,
        scene: startup?.selectedSceneId || "",
      },
      catalogSortModes: {
        component: "recent",
        scene: "recent",
        mapping: "recent",
        live: "recent",
        source: "recent",
        media: "recent",
      },
      previewQuality: "good",
      selectedMappingId: mapping.id,
      selectedSurfaceId: mapping.surfaces[0]?.id || "",
      sceneInspectorTarget: "element",
      mappingTestPattern: true,
      debugPreview: true,
      previewDiagnostics: false,
      outputWindowOpen: false,
      live: {
        selectedSceneId: "",
        selectedComponentId: "",
        overallSourceCleared: false,
        sceneMappingVisible: true,
        showScenes: true,
        showComponents: true,
        inspectedComponentId: "",
        componentView: "controls",
        previewSurfaceId: "",
        patchSourceId: "",
        surfacePatches: {},
        surfaceVisibility: {},
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
  const importedSurfaces = Array.isArray(input.surfaces) && input.surfaces.length
    ? input.surfaces.map((surface) => normalizeSurfaceRoute(surface))
    : [createDefaultSurface(0), createDefaultSurface(1)];
  next.ui.previewViewports = normalizePreviewViewports(input.ui?.previewViewports);
  next.ui.previewDiagnostics = input.ui?.previewDiagnostics === true;
  next.media = Array.isArray(input.media) ? input.media.map(normalizeMediaMeta) : [];
  next.ui.workspace = WORKSPACES.includes(next.ui.workspace) ? next.ui.workspace : "mapping";
  next.ui.selectedComponentId = next.components.some((component) => component.id === next.ui.selectedComponentId)
    ? next.ui.selectedComponentId
    : next.components[0]?.id || "";
  next.ui.workspaceSelectionIds = normalizeWorkspaceSelectionIds(
    next.ui.workspaceSelectionIds,
    next.components,
    next.ui.selectedComponentId
  );
  // Component and Scene editors have independent selections. Restore the
  // selection for the URL-selected workspace during project normalization,
  // before the preview receives the restored state. Previously setWorkspace()
  // ran only against the temporary boot state, so a saved Component selection
  // could leak into a freshly restored Scene workspace until the user switched
  // workspaces manually.
  if (next.ui.workspace === "component" || next.ui.workspace === "scene") {
    next.ui.selectedComponentId = next.ui.workspaceSelectionIds[next.ui.workspace]
      || next.ui.selectedComponentId;
  }
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
  next.ui.sceneInspectorTarget = next.ui.sceneInspectorTarget === "surface" ? "surface" : "element";
  next.mappings = Array.isArray(input.mappings)
    ? input.mappings.map((mapping) => normalizeMapping(mapping, next, importedSurfaces))
    : [];
  if (!next.mappings.length) next.mappings = [normalizeMapping(createDefaultMapping(0, importedSurfaces), next, importedSurfaces)];
  next.ui.selectedMappingId = next.mappings.some((scene) => scene.id === next.ui.selectedMappingId)
    ? next.ui.selectedMappingId
    : next.mappings[0]?.id || "";
  syncSurfaceProportionsFromMapping(next);
  projectSelectedMapping(next);
  next.ui.selectedSurfaceId = next.surfaces.some((surface) => surface.id === next.ui.selectedSurfaceId)
    ? next.ui.selectedSurfaceId
    : next.surfaces[0]?.id || "";
  delete next.frames;
  next.ui.mappingTestPattern = next.ui.mappingTestPattern !== false;
  next.ui.live = normalizeLiveUi(next.ui.live, next);
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
    live: normalize(value?.live),
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
  const program = compileLiveProjectionProgram(next);
  const { live, target, mapping } = program;
  if (mapping && (target || live.surfaceRoutes || live.overallSourceCleared === true)) {
    // Always derive the on-air program from the same route authority as the
    // Live monitor. ui.live.surfaceRoutes is a transition snapshot/cache; it
    // must not bypass newer visibility or patch state in an Output window.
    next.surfaces = clone(program.currentRoutes.surfaces);
    next.mappingCalibration = clone(mapping.calibration || {});
  }
  next.ui.selectedMappingId = mapping?.id || "";
  next.global.calibrating = false;
  applyLiveComponentOverrides(next, live.componentOverrides);
  materializeLivePatchTargets(next);

  const transition = program.transition;
  if (transition) {
    const fromState = clone(state);
    fromState.surfaces = clone(transition.previousRoutes.surfaces);
    fromState.mappingCalibration = clone(mapping?.calibration || {});
    fromState.ui.selectedMappingId = mapping?.id || fromState.ui.selectedMappingId || "";
    fromState.global.calibrating = false;
    applyLiveComponentOverrides(fromState, transition.previousComponentOverrides);
    materializeLivePatchTargets(fromState);
    fromState.ui.live.transition = null;
    next.liveTransition = {
      id: transition.id,
      startedAtMs: transition.startedAtMs,
      durationMs: transition.durationMs,
      componentsShared: transition.componentsShared,
      fromState,
    };
  }
  return next;
}

// The embedded Live monitor is the source x projection matrix preview. The
// Overall monitors the selected source directly. A Surface entry previews the
// complete, already-routed Live program and merely selects that Surface for its
// outline. Source substitution belongs to the explicit patch action in state.
export function createLiveScenePreviewState(state = createInitialState()) {
  const next = clone(state);
  const program = compileLiveProjectionProgram(next);
  const { live, target } = program;
  if (!target && live.overallSourceCleared !== true) return next;
  if (String(live.previewSurfaceId || "__mapping__") === "__mapping__" && live.sceneMappingVisible === false) {
    applyLiveMonitorTarget(next, null);
  } else if (!target && String(live.previewSurfaceId || "__mapping__") === "__mapping__") {
    applyLiveMonitorTarget(next, null);
  } else {
    applyLivePreviewProjection(next, target, live.previewSurfaceId, program.currentRoutes);
  }
  applyLiveComponentOverrides(next, live.componentOverrides);
  materializeLivePatchTargets(next);

  const transition = program.previewTransition;
  if (transition) {
    const fromState = clone(state);
    applyLivePreviewProjection(
      fromState,
      transition.previousTarget || target || null,
      live.previewSurfaceId,
      transition.previousRoutes
    );
    applyLiveComponentOverrides(fromState, transition.previousComponentOverrides);
    materializeLivePatchTargets(fromState);
    fromState.ui.live.transition = null;
    next.liveTransition = {
      id: transition.id,
      startedAtMs: transition.startedAtMs,
      durationMs: transition.durationMs,
      componentsShared: transition.componentsShared,
      fromState,
    };
  }
  return next;
}

function applyLivePreviewProjection(
  state,
  target,
  previewSurfaceId = "__mapping__",
  routeState = null
) {
  const mapping = state.mappings?.find((item) => item.id === state.ui?.selectedMappingId) || state.mappings?.[0] || null;
  if (!mapping) return;
  const requestedId = String(previewSurfaceId || "__mapping__");
  if (requestedId === "__mapping__") {
    applyLiveMonitorTarget(state, target);
    return;
  }
  const routes = routeState?.surfaces
    ? clone(routeState.surfaces)
    : materializeLiveTargetSurfaceRoutes(state, target, mapping).surfaces;
  if (!routes.some((surface) => String(surface.id) === requestedId)) {
    applyLiveMonitorTarget(state, target);
    return;
  }
  state.surfaces = clone(routes);
  state.mappingCalibration = clone(mapping.calibration || {});
  state.ui.selectedMappingId = mapping.id;
  state.ui.selectedSurfaceId = requestedId;
  state.global.calibrating = false;
}

function applyLiveMonitorTarget(state, target) {
  const existingOutput = state.render?.outputs?.[0] || createOutputDefinition(0);
  const targetAspect = Math.max(0.05, Number(state.render?.sceneAspectRatio) || 16 / 9);
  const sourceAspect = target && target.type !== "scene"
    ? liveComponentMonitorAspect(state.render, target)
    : targetAspect;
  const output = {
    ...existingOutput,
    id: String(existingOutput.id || "output-main"),
    name: "Live preview",
    aspectRatio: targetAspect,
  };

  // Overall is a source monitor, not an output-layout preview. Keep this cloned
  // render state to one ordinary direct output so state normalization cannot
  // expand it back into the project's configured multi-screen arrangement.
  state.render = { ...(state.render || {}), outputs: [output] };
  const surface = normalizeSurfaceRoute({
    ...createDefaultSurface(0),
    id: directOutputSurfaceId(output.id),
    name: "Live target monitor",
    enabled: true,
    opacity: 1,
    feather: 0,
    projectionFit: "cover",
    sourceNodeId: target ? sceneSourceNodeId(target.id) : "",
    componentId: target?.id || "",
    sceneCrop: false,
    sourceFit: "cover",
    sourceFitActive: !!target && target.type !== "scene",
    sourceAspect,
    showLabel: false,
    calibrationLocked: true,
    destination: { type: "direct", outputIds: [String(output.id || "output-main")] },
  });
  state.surfaces = [surface];
  state.mappingCalibration = {};
  state.ui.selectedSurfaceId = "";
  state.global.calibrating = false;
}

function liveComponentMonitorAspect(render = {}, component = {}) {
  const metrics = componentFrameMetrics(render, component);
  return Math.max(0.05, metrics.baseWidth / Math.max(1, metrics.baseHeight));
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
  const overallSourceCleared = live.overallSourceCleared === true;
  const sceneMappingVisible = live.sceneMappingVisible !== false;
  const selectedSceneId = !overallSourceCleared && live.selectedSceneId && performanceScenes.some((scene) => String(scene.id) === String(live.selectedSceneId))
    ? String(live.selectedSceneId)
    : !overallSourceCleared ? performanceScenes[0]?.id || "" : "";
  const explicitTargetId = !overallSourceCleared && state.components?.some((component) => !component.systemRole && String(component.id) === String(live.selectedComponentId || ""))
    ? String(live.selectedComponentId)
    : "";
  const selectedTargetId = explicitTargetId || selectedSceneId;
  const inspectedComponentId = state.components?.some((component) =>
    !component.systemRole && String(component.id) === String(live.inspectedComponentId || "")
  ) ? String(live.inspectedComponentId) : "";
  const selectedScene = performanceScenes.find((scene) => String(scene.id) === selectedSceneId);
  const selectedMapping = state.mappings?.find((mapping) => String(mapping.id) === String(state.ui?.selectedMappingId || "")) || state.mappings?.[0];
  const previewSurfaceIds = new Set((selectedMapping?.surfaces || []).map((surface) => String(surface.id || "")));
  const requestedPreviewSurfaceId = String(live.previewSurfaceId || "");
  const previewSurfaceId = requestedPreviewSurfaceId === "__mapping__" || previewSurfaceIds.has(requestedPreviewSurfaceId)
    ? requestedPreviewSurfaceId
    : "__mapping__";
  const patchSourceId = previewSurfaceId !== "__mapping__" && state.components?.some((component) =>
    !component.systemRole && String(component.id) === String(live.patchSourceId || "")
  ) ? String(live.patchSourceId) : "";
  const surfacePatches = Object.fromEntries(Object.entries(live.surfacePatches || {}).filter(([surfaceId, targetId]) =>
    previewSurfaceIds.has(String(surfaceId)) && state.components?.some((component) =>
      !component.systemRole && String(component.id) === String(targetId)
    )
  ).map(([surfaceId, targetId]) => [String(surfaceId), String(targetId)]));
  const surfaceVisibility = Object.fromEntries(Object.entries(live.surfaceVisibility || {}).filter(([surfaceId, visible]) =>
    previewSurfaceIds.has(String(surfaceId)) && typeof visible === "boolean"
  ).map(([surfaceId, visible]) => [String(surfaceId), visible]));
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
        surfaceId: String(live.transition.surfaceId || ""),
        fromSurfaceRoutes: normalizeSurfaceRoutes(live.transition.fromSurfaceRoutes, state),
        fromComponentOverrides: normalizeComponentOverrides(live.transition.fromComponentOverrides || {}),
        startedAtMs: transitionStartedAtMs,
        durationMs: Math.min(30000, transitionDurationMs),
      }
    : null;
  return {
    selectedSceneId,
    selectedComponentId: explicitTargetId,
    overallSourceCleared,
    sceneMappingVisible,
    inspectedComponentId,
    ...normalizeLiveSourceFilters(live),
    componentView: live.componentView === "elements" ? "elements" : "controls",
    previewSurfaceId,
    patchSourceId,
    surfacePatches,
    surfaceVisibility,
    surfaceRoutes: live.surfaceRoutes
      ? normalizeSurfaceRoutes(live.surfaceRoutes, state)
      : selectedScene
        ? materializeSceneSurfaceRoutes(state, selectedScene, selectedMapping)
        : overallSourceCleared && selectedMapping
          ? materializeSceneSurfaceRoutes(state, null, selectedMapping)
          : null,
    componentOverrides,
    sceneOverrides,
    transitionDuration,
    paramFadeDuration,
    transition,
  };
}

function normalizeLiveSourceFilters(live = {}) {
  const hasExplicitFilters = typeof live.showScenes === "boolean" || typeof live.showComponents === "boolean";
  let showScenes = hasExplicitFilters
    ? live.showScenes !== false
    : true;
  let showComponents = hasExplicitFilters
    ? live.showComponents === true
    : true;
  if (!showScenes && !showComponents) showScenes = true;
  return { showScenes, showComponents };
}

function normalizeSurfaceRoutes(routeState = {}, state = {}) {
  return {
    // Live routes are runtime materializations and intentionally retain their
    // source fields. Persisted Mapping Surfaces use normalizeMappingSurface,
    // which strips those fields so the Surface remains the authored authority.
    surfaces: (routeState?.surfaces || []).map((surface) => normalizeSurfaceRoute(surface, state)),
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
  const surfaceThumbnails = Object.fromEntries(Object.entries(scene.surfaceThumbnails || {})
    .filter(([surfaceId, thumbnail]) => surfaceId && typeof thumbnail === "string" && thumbnail));
  return {
    surfaceThumbnails,
  };
}

export function syncSurfaceProportionsFromMapping(state = {}, mapping = null) {
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
  for (const surface of mapping.surfaces || []) {
    if (surface.destination?.type === "direct" || surface.keepProportions === false) continue;
    const projected = calibrationById.get(String(surface.id || ""))
      || calibrationById.get(String(surface.name || ""));
    if (!projected?.corners) continue;
    const fallback = Number(projected.w) > 0 && Number(projected.h) > 0
      ? Number(projected.w) / Number(projected.h)
      : sceneAspect * surface.width / surface.height;
    const naturalAspect = mapping.calibration?.coordinateSpace === "relative"
      ? projectedRelativeQuadAspect(projected.corners, sceneAspect, fallback)
      : projectedQuadAspect(projected.corners, fallback);
    Object.assign(surface, relativeRectWithAspect(surface, naturalAspect / sceneAspect));
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

export function normalizeSurfaceRoute(surface = {}) {
  const fallback = createDefaultSurface(0);
  const rect = normalizeRelativeRect(surface, fallback);
  return {
    ...fallback,
    ...surface,
    id: surface.id || uid("surface"),
    name: surface.name || fallback.name,
    ...rect,
    keepProportions: surface.keepProportions !== false,
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
    sceneCrop: surface.sceneCrop === true,
    sourceFit: normalizeProjectionFit(surface.sourceFit),
    sourceFitActive: surface.sourceFitActive === true,
    sourceAspect: Math.max(0.0001, Number(surface.sourceAspect) || 1),
    mappingId: surface.mappingId || surface.id || fallback.mappingId,
    showLabel: surface.showLabel !== false,
    calibrationLocked: !!surface.calibrationLocked,
    destination: normalizeSurfaceDestination(surface.destination, surface.mappingId || surface.id || fallback.mappingId),
    activity: normalizeProjectActivity(surface.activity, fallback.activity.createdAt),
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
  return clone(normalizeMappingSurface(surface));
}

export function normalizeMappingSurface(surface = {}, state = {}) {
  return authoredSurfaceFields(normalizeSurfaceRoute(surface));
}

export function createMappingFromState(state, name) {
  return {
    id: uid("mapping"),
    name,
    notes: "",
    catalogMarker: 0,
    surfaces: (state.surfaces || []).map((surface) => normalizeMappingSurface(surface, state)),
    calibration: clone(state.mappingCalibration || {}),
  };
}

export function createEmptyMappingFromState(state, name) {
  return {
    id: uid("mapping"),
    name,
    notes: "",
    catalogMarker: 0,
    // Physical projection Surfaces belong to one Mapping. A new Mapping gets
    // only the system-owned direct routes required by its configured outputs;
    // Save Mapping is the explicit operation for copying an authored layout.
    surfaces: reconcileDirectOutputSurfaces([], state.render || {}),
    calibration: {},
  };
}

export function syncLiveRoutesFromMapping(state, mapping) {
  if (!mapping?.surfaces || String(state.ui?.selectedMappingId || "") !== String(mapping.id || "")) return state;
  const targetId = String(state.ui?.live?.selectedComponentId || state.ui?.live?.selectedSceneId || "");
  const target = state.components?.find((component) =>
    !component.systemRole && String(component.id) === targetId
  ) || null;
  state.ui.live.surfaceRoutes = materializeLiveProgramSurfaceRoutes(state, target, mapping);
  return state;
}

function mappingPreviewScene(state) {
  const components = state.components || [];
  const live = state.ui?.live || {};
  const liveTargetId = String(live.selectedComponentId || "");
  const liveTarget = components.find((component) =>
    !component.systemRole && String(component.id) === liveTargetId
  ) || null;
  const liveScene = live.overallSourceCleared !== true && (!liveTargetId || liveTarget?.type === "scene")
    ? components.find((component) =>
      component.type === "scene" && String(component.id) === String(live.selectedSceneId || "")
    ) || null
    : null;
  if (liveScene) return liveScene;

  const sceneEditorId = String(state.ui?.workspaceSelectionIds?.scene || "");
  return components.find((component) =>
    component.type === "scene" && String(component.id) === sceneEditorId
  ) || components.find((component) => component.type === "scene") || null;
}

export function applyMappingForEditing(state, mapping) {
  if (!mapping?.surfaces) return state;
  const next = sanitizeState({ ...clone(state), ui: { ...clone(state.ui), selectedMappingId: mapping.id } });
  const selectedMapping = next.mappings?.find((item) => String(item.id) === String(mapping.id)) || null;
  if (!selectedMapping) return next;
  if (next.ui?.mappingTestPattern !== false) {
    const component = next.components.find((item) => item.systemRole === "mapping-test-pattern");
    next.surfaces = selectedMapping.surfaces.map((surface) => ({
      ...surface,
      sourceNodeId: component ? sceneSourceNodeId(component.id) : "",
      componentId: component?.id || "",
      sceneCrop: false,
      sourceFitActive: false,
    }));
    return next;
  }
  const scene = mappingPreviewScene(next);
  if (scene) {
    next.surfaces = materializeSceneSurfaceRoutes(next, scene, selectedMapping).surfaces;
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
