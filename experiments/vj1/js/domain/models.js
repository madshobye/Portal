import { VJ1, defaultCustomShaderCode, WORKSPACES } from "../constants.js";
import { createGeneratorSource } from "../libraries/visual-nodes/index.js";
import { componentFrameMetrics, normalizeComponentFrameShape, normalizeComponentResolutionScale } from "./component-frame.js";
import { createProjectActivity, normalizeProjectActivity } from "./component-activity.js";
import { normalizeCatalogMarker } from "./catalog-marker.js";
import { CURRENT_PROJECT_VERSION, migrateProjectData } from "./project-migrations.js";
import {
  canonicalizeAuthoredVisualChain,
  canonicalizeAuthoredVisualSource,
} from "./authored-visual-source.js";
import { createEmptyNodeProjectData, normalizeNodeProjectData } from "../libraries/node-engine/node-project.js";
import { normalizeRelativeRect, projectedQuadAspect, projectedRelativeQuadAspect } from "../libraries/render-engine/relative-geometry.js";
import { FULL_NODE_BOUNDARY, normalizeNodeBoundary } from "../libraries/render-engine/roi/index.js";
import {
  createOutputDefinition,
  normalizeCameraSettings,
  normalizeComponentPipelineSettings,
  normalizePreviewViewports,
  normalizeRenderSettings,
  normalizeOutputName,
  normalizeSamplingSettings,
} from "./render-settings.js";
import { normalizeMidiInputSettings } from "../libraries/control-engine/midi-input-profile/index.js";
import { normalizeDeviceSettings } from "../libraries/dmx-engine/index.js";
import { updateParameterAnimationTrack } from "../libraries/composition-engine/shared/parameter-animation-tracks.js";
import {
  applySceneSourceNode,
  authoredSurfaceFields,
  materializeLiveSurfacePatchRoute,
  materializeLiveTargetSurfaceRoutes,
  materializeSceneSurfaceRoutes,
  normalizeProjectionFit,
  rebaseSurfaceRouteProgram,
  resolveSceneSourceNode,
  sceneSourceNodeId,
  sceneSourceNodes,
} from "./scene-routing.js";
import { compileLiveProjectionProgram } from "./live-projection-program.js";
import {
  materializeStructuralTree,
  materializeStructuralValue,
} from "../libraries/data-store/data-store/structural-sharing.js";
import { firstEnabledLiveSurfaceId } from "./live-ui-state.js";
import { applyEditorSelection } from "./editor-selection.js";
import { createSessionTimeline, normalizeSessionTimeline } from "../libraries/timing-engine/session-timeline/index.js";
import {
  MAPPING_TEST_PATTERN_COMPONENT_ID,
  MAPPING_TEST_PATTERN_SOURCE_NODE_ID,
} from "./runtime-visual-sources.js";

export {
  createOutputDefinition,
  normalizeCameraSettings,
  normalizeComponentPipelineSettings,
  normalizePreviewViewport,
  normalizePreviewViewports,
  normalizeRenderSettings,
  normalizeOutputName,
  normalizeSamplingSettings,
} from "./render-settings.js";
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
} from "./scene-routing.js";

const LIVE_ANIMATION_NUMERIC_FIELDS = new Set([
  "duration",
  "envelopeInitial",
  "from",
  "noiseDetail",
  "noiseRate",
  "noiseRoughness",
  "noiseSeed",
  "pause",
  "phase",
  "randomRate",
  "smoothing",
  "to",
  "triggerInterval",
  "triggerThreshold",
]);

export function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export { MAPPING_TEST_PATTERN_COMPONENT_ID } from "./runtime-visual-sources.js";

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
    significantParams: [],
    significantAnimationParams: [],
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
    // Media labels follow the current catalog entry until the user gives the
    // element an explicit name. Do not copy a repository path into project
    // state as though it were an authored label.
    name: sourceBackedMediaId(normalizedSource) ? "" : sourceLabel(normalizedSource),
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
    speed: 0.65,
    direction: 0.65,
    frequency: 8,
    complexity: 0.7,
    distortion: 0.55,
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
  const groupSurfaceId = outputs.length > 1 ? directOutputSurfaceId("all") : "";
  if (outputs.length > 1) {
    definitions.push({
      id: groupSurfaceId,
      name: "Full surface · Direct",
      outputIds: outputs.map((output) => output.id),
      parentSurfaceId: "",
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
      parentSurfaceId: groupSurfaceId,
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
      destination: {
        type: "direct",
        outputIds: definition.outputIds,
        parentSurfaceId: definition.parentSurfaceId,
      },
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
      mappingTestPattern: startup ? false : true,
      debugPreview: true,
      previewDiagnostics: false,
      outputWindowOpen: false,
      live: {
        selectedSceneId: startup?.selectedSceneId || "",
        selectedComponentId: "",
        overallSourceCleared: false,
        sceneMappingInLive: true,
        sceneMappingVisible: true,
        showScenes: true,
        showComponents: true,
        inspectedComponentId: "",
        componentView: "controls",
        previewSurfaceId: "",
        patchSourceId: "",
        surfacePatches: {},
        surfaceVisibility: {},
        componentOverrides: {},
        sceneOverrides: {},
        transitionId: "vj1.transition.dissolve",
        transitionParameters: {},
        transitionDuration: startup ? 1.2 : 0,
        paramFadeDuration: startup ? 0.9 : 0,
        transition: null,
        transitionCoordinator: {},
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
    inputs: normalizeMidiInputSettings(),
    devices: normalizeDeviceSettings(),
    render: {
      outputs: [createOutputDefinition(0)],
      sceneAspectRatio: VJ1.sceneWidth / VJ1.sceneHeight,
      componentAspectRatio: VJ1.renderWidth / VJ1.renderHeight,
      resolutionCeiling: "auto",
      pixelDensity: 1,
      sampling: {
        surfaceOverscan: 1,
        surfaceDetailScale: 1,
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
      previewSignalLoad: null,
      signalLoad: null,
      clients: 0,
      outputs: {},
      message: "No output connected",
      sessionTimeline: createSessionTimeline(),
    },
  };
}

export function clone(value) {
  const cloneable = materializeStructuralValue(value);
  if (typeof structuredClone !== "function") return JSON.parse(JSON.stringify(cloneable));
  try {
    return structuredClone(cloneable);
  } catch (error) {
    // A transaction may have constructed a plain retained record containing
    // nested draft values. Materialize that requested subtree and retry. Real
    // non-cloneable authored values still fail on the second structuredClone.
    return structuredClone(materializeStructuralTree(cloneable));
  }
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
    inputs: normalizeMidiInputSettings(input.inputs),
    devices: normalizeDeviceSettings(input.devices),
    render: { ...base.render, ...(input.render || {}) },
    scheduler: { ...base.scheduler, ...(input.scheduler || {}) },
    shaders: { ...base.shaders, ...(input.shaders || {}) },
    metrics: { ...base.metrics, ...(input.metrics || {}) },
  };
  next.nodes = normalizeNodeProjectData(input.nodes);
  delete next.global.showLabels;
  next.global.timeStretch = clampNumber(input.global?.timeStretch, -4, 4, 0);
  next.metrics.sessionTimeline = normalizeSessionTimeline(
    input.metrics?.sessionTimeline,
    next.global,
  );

  next.render = normalizeRenderSettings(input.render || {});
  next.components = normalizeComponents(input, base);
  const importedSurfaces = Array.isArray(input.surfaces) && input.surfaces.length
    ? input.surfaces.map((surface) => normalizeSurfaceRoute(surface))
    : [createDefaultSurface(0), createDefaultSurface(1)];
  next.ui.previewViewports = normalizePreviewViewports(input.ui?.previewViewports);
  next.ui.previewDiagnostics = input.ui?.previewDiagnostics === true;
  next.media = Array.isArray(input.media) ? input.media.map(normalizeMediaMeta) : [];
  next.components = next.components.map((component) => ({
    ...component,
    chain: canonicalizeAuthoredVisualChain(component.chain || [], next.media),
  }));
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
  if (next.ui.workspace === "scene") {
    const selectionKind = next.ui.sceneInspectorTarget === "surface"
      ? "surface"
      : "element";
    applyEditorSelection(
      next.ui,
      selectionKind,
      selectionKind === "surface"
        ? next.ui.selectedSurfaceId
        : next.ui.selectedChainItemId,
    );
  }
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
  const program = compileLiveProjectionProgram(state);
  const { live, mapping } = program;
  const presentedOverrides = program.transitions.find((transition) => transition.scope === "overall")
    ?.currentComponentOverrides || live.componentOverrides;
  const next = createLiveEndpointState(state, presentedOverrides);
  if (mapping) {
    // The compiled Live program is the sole current-route authority. Only a
    // transition's previous endpoint is stored because it is historical state.
    next.surfaces = clone(program.currentRoutes.surfaces);
    next.mappingCalibration = clone(mapping.calibration || {});
  }
  next.ui.selectedMappingId = mapping?.id || "";
  next.global.calibrating = false;

  const liveTransitions = program.transitions.map((transition) => {
    const fromState = createLiveEndpointState(state, transition.previousComponentOverrides);
    fromState.surfaces = clone(transition.previousRoutes.surfaces);
    fromState.mappingCalibration = clone(mapping?.calibration || {});
    fromState.ui.selectedMappingId = mapping?.id || fromState.ui.selectedMappingId || "";
    fromState.global.calibrating = false;
    fromState.ui.live.transition = null;
    fromState.ui.live.transitionCoordinator = {};
    return {
      id: transition.id,
      destination: transition.surfaceId ? `surface:${transition.surfaceId}` : "overall",
      surfaceId: transition.surfaceId,
      transitionId: transition.transitionId,
      transitionParameters: clone(transition.transitionParameters),
      startedAtMs: transition.startedAtMs,
      durationMs: transition.durationMs,
      componentsShared: transition.componentsShared,
      componentConfigurationIds: transition.componentConfigurationIds,
      fromState,
    };
  });
  if (liveTransitions.length) {
    next.liveTransitions = liveTransitions;
    next.liveTransition = liveTransitions[0];
  }
  return next;
}

// The embedded Live monitor is the source x projection matrix preview. The
// Overall monitors the selected source directly. A Surface entry previews the
// complete, already-routed Live program and merely selects that Surface for its
// outline. Source substitution belongs to the explicit patch action in state.
export function createLiveScenePreviewState(state = createInitialState()) {
  const program = compileLiveProjectionProgram(state);
  const { live, target } = program;
  const presentedOverrides = program.transitions.find((transition) => transition.scope === "overall")
    ?.currentComponentOverrides || live.componentOverrides;
  const next = createLiveEndpointState(state, presentedOverrides);
  const previewsSceneMapping = String(live.previewSurfaceId || "__mapping__") === "__mapping__";
  if (!target && live.overallSourceCleared !== true) return next;
  if (previewsSceneMapping && live.sceneMappingVisible === false) {
    applyLiveMonitorTarget(next, null);
  } else if (!target && previewsSceneMapping) {
    applyLiveMonitorTarget(next, null);
  } else {
    applyLivePreviewProjection(next, target, live.previewSurfaceId, program.currentRoutes);
  }
  if (previewsSceneMapping) {
    // Scene Mapping presents one retained source-monitor route, but its yellow
    // guides describe the real compiled output matrix. Keep that derived guide
    // program beside the monitor instead of replacing the monitor route or
    // reconstructing routes inside the renderer.
    next.livePreviewGuideSurfaces = clone(program.currentRoutes.surfaces);
  }

  const liveTransitions = program.previewTransitions.map((transition) => {
    const fromState = createLiveEndpointState(state, transition.previousComponentOverrides);
    applyLivePreviewProjection(
      fromState,
      transition.previousTarget || target || null,
      live.previewSurfaceId,
      transition.previousRoutes
    );
    fromState.ui.live.transition = null;
    fromState.ui.live.transitionCoordinator = {};
    return {
      id: transition.id,
      destination: transition.surfaceId ? `surface:${transition.surfaceId}` : "overall",
      surfaceId: transition.surfaceId,
      transitionId: transition.transitionId,
      transitionParameters: clone(transition.transitionParameters),
      startedAtMs: transition.startedAtMs,
      durationMs: transition.durationMs,
      componentsShared: transition.componentsShared,
      componentConfigurationIds: transition.componentConfigurationIds,
      fromState,
    };
  });
  if (liveTransitions.length) {
    next.liveTransitions = liveTransitions;
    next.liveTransition = liveTransitions[0];
  }
  return next;
}

// Live render endpoints are immutable projections of the same authored
// project. Deep-cloning the complete project once for a cut and twice for a
// transition made Preview activation proportional to unrelated media,
// packages, Mappings, and editor data. Clone only branches that the renderer
// or its compact patch protocol may mutate; keep immutable authored
// collections structurally shared until browser transport performs its own
// serialization.
function createLiveEndpointState(state, overrides = {}) {
  return {
    ...state,
    ui: clone(state.ui || {}),
    global: { ...(state.global || {}) },
    render: {
      ...(state.render || {}),
      outputs: (state.render?.outputs || []).map((output) => ({ ...output })),
    },
    components: (state.components || []).map((component) =>
      createLiveEndpointComponent(component, overrides?.[component.id])
    ),
    nodes: materializeLiveAnimationOverrides(state.nodes, overrides),
    surfaces: clone(state.surfaces || []),
    mappingCalibration: clone(state.mappingCalibration || {}),
  };
}

function materializeLiveAnimationOverrides(nodes, overrides = {}) {
  let next = nodes;
  for (const [componentId, componentOverride] of Object.entries(overrides || {})) {
    for (const [trackId, trackOverride] of Object.entries(componentOverride?.animation || {})) {
      const fields = Object.fromEntries(Object.entries(trackOverride?.fields || {})
        .filter(([field, value]) =>
          LIVE_ANIMATION_NUMERIC_FIELDS.has(field) && Number.isFinite(Number(value))
        )
        .map(([field, value]) => [field, Number(value)]));
      if (!Object.keys(fields).length || !trackOverride?.targetNodeId) continue;
      try {
        next = updateParameterAnimationTrack(next, {
          componentId,
          targetNodeId: trackOverride.targetNodeId,
          trackId,
          patch: fields,
        });
      } catch {
        // Removed or retargeted animation tracks make an old Live override
        // unreachable; authored graph state remains the safe fallback.
      }
    }
  }
  return next;
}

function createLiveEndpointComponent(component = {}, override = {}) {
  return {
    ...component,
    opacity: override.opacity !== undefined ? clamp01(override.opacity) : component.opacity,
    speed: override.speed !== undefined ? Math.max(0, Number(override.speed) || 0) : component.speed,
    blend: override.blend || component.blend,
    transform: override.transform && typeof override.transform === "object"
      ? normalizeTransform({ ...(component.transform || {}), ...override.transform })
      : normalizeTransform(component.transform),
    chain: (component.chain || []).map((item, index) =>
      materializeLiveEndpointChainItem(
        mergeComponentChainItemOverride(item, override.chain?.[index] || {})
      )
    ),
  };
}

function materializeLiveEndpointChainItem(item = {}) {
  const next = {
    ...item,
    transform: normalizeTransform(item.transform),
    boundary: normalizeNodeBoundary(item.boundary),
  };
  if (item.kind === "effect") {
    next.params = { ...(item.params && typeof item.params === "object" ? item.params : {}) };
  } else if (item.kind === "source") {
    next.source = {
      ...(item.source || {}),
      ...(item.source && ["generator", "media"].includes(item.source.type)
        ? { params: { ...(item.source.params && typeof item.source.params === "object" ? item.source.params : {}) } }
        : {}),
    };
  } else if (item.kind === "group") {
    next.chain = (item.chain || []).map(materializeLiveEndpointChainItem);
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
  // Output and Surface rows inspect the compiled output matrix. The retained
  // Live renderer keeps owning its transition/resource clocks, while
  // presentation reuses the same projected frame and selection overlays as
  // Mapping. This is derived Preview state and never changes the authored
  // workspace or routed program.
  state.livePreviewPresentation = "mapping";
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
  // Scene Mapping is the sole flat source monitor. Its yellow rectangles are
  // Scene-space route guides supplied by livePreviewGuideSurfaces.
  state.livePreviewPresentation = "scene";
}

function liveComponentMonitorAspect(render = {}, component = {}) {
  const metrics = componentFrameMetrics(render, component);
  return Math.max(0.05, metrics.baseWidth / Math.max(1, metrics.baseHeight));
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
      ...(override.animation && typeof override.animation === "object"
        ? { animation: normalizeLiveAnimationOverrides(override.animation) }
        : {}),
    }];
  }));
  const performanceScenes = state.components?.filter((component) => component.type === "scene") || [];
  const overallSourceCleared = live.overallSourceCleared === true;
  const sceneMappingVisibilityIsSessionAuthored = typeof live.sceneMappingVisible === "boolean";
  const sceneMappingInLive = live.sceneMappingInLive !== false;
  const sceneMappingVisible = sceneMappingVisibilityIsSessionAuthored
    ? live.sceneMappingVisible
    : sceneMappingInLive;
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
  const firstPreviewSurfaceId = firstEnabledLiveSurfaceId(selectedMapping, {
    ...live,
    sceneMappingVisible,
  }) || String(selectedMapping?.surfaces?.[0]?.id || "");
  const defaultPreviewSurfaceId = sceneMappingInLive
    ? "__mapping__"
    : firstPreviewSurfaceId || "__mapping__";
  const previewSurfaceId = requestedPreviewSurfaceId === "__mapping__"
    ? (!sceneMappingVisibilityIsSessionAuthored && !sceneMappingInLive ? defaultPreviewSurfaceId : "__mapping__")
    : previewSurfaceIds.has(requestedPreviewSurfaceId)
      ? requestedPreviewSurfaceId
      : defaultPreviewSurfaceId;
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
  const transitionId = String(live.transitionId || "vj1.transition.dissolve");
  const transitionParameters = live.transitionParameters && typeof live.transitionParameters === "object"
    && !Array.isArray(live.transitionParameters)
    ? clone(live.transitionParameters)
    : {};
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
  const transitionCoordinator = normalizeLiveTransitionCoordinator(live.transitionCoordinator, state);
  return {
    selectedSceneId,
    selectedComponentId: explicitTargetId,
    overallSourceCleared,
    sceneMappingInLive,
    sceneMappingVisible,
    inspectedComponentId,
    ...normalizeLiveSourceFilters(live),
    componentView: live.componentView === "elements" ? "elements" : "controls",
    previewSurfaceId,
    patchSourceId,
    surfacePatches,
    surfaceVisibility,
    componentOverrides,
    sceneOverrides,
    transitionId,
    transitionParameters,
    transitionDuration,
    paramFadeDuration,
    transition,
    transitionCoordinator,
  };
}

function normalizeLiveAnimationOverrides(animation = {}) {
  return Object.fromEntries(Object.entries(animation || {}).flatMap(([trackId, override]) => {
    const targetNodeId = String(override?.targetNodeId || "");
    const fields = Object.fromEntries(Object.entries(override?.fields || {})
      .filter(([field, value]) =>
        LIVE_ANIMATION_NUMERIC_FIELDS.has(field) && Number.isFinite(Number(value))
      )
      .map(([field, value]) => [field, Number(value)]));
    return trackId && targetNodeId && Object.keys(fields).length
      ? [[String(trackId), { targetNodeId, fields }]]
      : [];
  }));
}

function normalizeLiveTransitionCoordinator(value = {}, state = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const coordinator = {};
  for (const [destination, lane] of Object.entries(value)) {
    if (!lane || typeof lane !== "object") continue;
    const active = normalizeCoordinatedTransition(lane.active, state);
    const pending = normalizeCoordinatedTransition(lane.pending, state, true);
    if (active || pending) coordinator[String(destination)] = {
      ...(active ? { active } : {}),
      ...(pending ? { pending } : {}),
    };
  }
  return coordinator;
}

function normalizeCoordinatedTransition(value, state, pending = false) {
  const durationMs = Math.min(30000, Math.max(0, Number(value?.durationMs) || 0));
  if (!value?.fromSurfaceRoutes || !value?.toSurfaceRoutes || durationMs <= 0) return null;
  const startedAtMs = Number(value.startedAtMs) || 0;
  if (!pending && startedAtMs <= 0) return null;
  return {
    id: String(value.id || ""),
    destination: String(value.destination || ""),
    surfaceId: String(value.surfaceId || ""),
    fromSceneId: String(value.fromSceneId || ""),
    fromTargetId: String(value.fromTargetId || value.fromSceneId || ""),
    toTargetId: String(value.toTargetId || ""),
    fromSurfaceRoutes: normalizeSurfaceRoutes(value.fromSurfaceRoutes, state),
    toSurfaceRoutes: normalizeSurfaceRoutes(value.toSurfaceRoutes, state),
    fromComponentOverrides: normalizeComponentOverrides(value.fromComponentOverrides || {}),
    toComponentOverrides: normalizeComponentOverrides(value.toComponentOverrides || {}),
    transitionId: String(value.transitionId || "vj1.transition.dissolve"),
    transitionParameters: value.transitionParameters && typeof value.transitionParameters === "object"
      ? clone(value.transitionParameters)
      : {},
    startedAtMs,
    durationMs,
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
    ...(item.transform && typeof item.transform === "object" ? { transform: normalizeTransform(item.transform) } : {}),
    ...(Array.isArray(item.chain) ? { chain: item.chain.map((child, index) => normalizeLiveChainItemOverride(child, authoredItem?.chain?.[index])) } : {}),
  };
}

function normalizeComponents(input, base) {
  const authored = (input.components || []).filter((component) =>
    component?.systemRole !== "mapping-test-pattern" &&
    String(component?.id || "") !== MAPPING_TEST_PATTERN_COMPONENT_ID
  );
  return Array.isArray(input.components) && authored.length
    ? authored.map(normalizeComponent)
    : [createDefaultComponent(0)];
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
    significantAnimationParams: normalizeSignificantAnimationParams(
      componentData.significantAnimationParams,
    ),
    activity: normalizeProjectActivity(componentData.activity, fallback.activity.createdAt),
    catalogMarker: normalizeCatalogMarker(componentData.catalogMarker),
    chain,
    ...(type === "scene" ? { scene } : {}),
  };
}

function normalizeSignificantAnimationParams(value = []) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).flatMap((entry) => {
    const trackId = String(entry?.trackId || "");
    const targetNodeId = String(entry?.targetNodeId || "");
    const field = String(entry?.field || "");
    const min = Number(entry?.min);
    const max = Number(entry?.max);
    const key = `${targetNodeId}:${trackId}:${field}`;
    if (
      !trackId ||
      !targetNodeId ||
      !LIVE_ANIMATION_NUMERIC_FIELDS.has(field) ||
      !Number.isFinite(min) ||
      !Number.isFinite(max) ||
      max <= min ||
      seen.has(key)
    ) {
      return [];
    }
    seen.add(key);
    return [{
      trackId,
      targetNodeId,
      field,
      label: String(entry?.label || field),
      min,
      max,
      step: Math.max(0, Number(entry?.step) || 0),
      scale: entry?.scale === "log" ? "log" : "linear",
    }];
  });
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
    });
    return {
      id: item.id || uid("chain"),
      kind: "effect",
      componentId: pass.id,
      name: item.name || pass.id,
      enabled: pass.enabled,
      params: pass.params,
      imageInputs: normalizeImageInputs(item.imageInputs),
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
  const name = sourceBackedMediaId(source) && isAutomaticMediaSourceName(item.name, source)
    ? ""
    : isGenericLayerName(item.name) ? fallbackName : item.name || fallbackName;
  return {
    id: item.id || uid("chain"),
    kind: "source",
    componentId: sourceComponentId(source),
    name,
    enabled: item.enabled !== false,
    source,
    imageInputs: normalizeImageInputs(item.imageInputs),
    opacity: clamp01(item.opacity ?? 1),
    blend: item.blend || "normal",
    transform: normalizeTransform(item.transform),
    boundary: normalizeNodeBoundary(item.boundary),
  };
}

function normalizeImageInputs(imageInputs = {}) {
  if (!imageInputs || typeof imageInputs !== "object" || Array.isArray(imageInputs)) return {};
  return Object.fromEntries(Object.entries(imageInputs).flatMap(([port, source]) => {
    if (!/^[A-Za-z_]\w*$/.test(port) || !source) return [];
    return [[port, normalizeSource(source)]];
  }));
}

export function isAutomaticMediaSourceName(name = "", source = {}) {
  const identity = sourceBackedMediaId(source);
  if (!identity) return false;
  const candidate = String(name || "").trim();
  if (!candidate) return true;
  const basename = identity.split(/[\\/]/).filter(Boolean).at(-1) || identity;
  return candidate === identity || candidate === basename;
}

export function sourceBackedMediaId(source = {}) {
  if (
    source?.type === "generator" &&
    (source.generatorId === "modelMedia" || source.generatorId === "mediaImage")
  ) {
    return String(source.params?.mediaId || "").trim();
  }
  return "";
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
      parentSurfaceId: String(destination.parentSurfaceId || ""),
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
  });
}

function normalizeSource(input) {
  if (!input || typeof input !== "object" || !input.type) {
    throw new TypeError("[VJ1_INVALID_SOURCE] A source node requires an explicit source.type");
  }
  const source = canonicalizeAuthoredVisualSource(input);
  if (source.type === "generator" && !source.generatorId) {
    throw new TypeError("[VJ1_INVALID_SOURCE] A generator source requires generatorId");
  }
  if (!["generator", "component"].includes(source.type)) {
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
  throw new TypeError(`[VJ1_INVALID_SOURCE] Unsupported source.type ${String(source.type || "missing")}`);
}

function sourceLabel(source = {}) {
  if (source.type === "component") return source.componentId || "Component";
  if (source.type === "generator" && source.generatorId === "modelMedia") {
    return source.params?.mediaId || "Model Media";
  }
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
  params.amount = clamp01(params.amount ?? 0.35);
  return params;
}

function mergeComponentChainItemOverride(item = {}, override = {}) {
  if (!override || typeof override !== "object") return item;
  if (item.kind === "effect") {
    const pass = mergeShaderPassOverride({
      id: item.componentId || item.id,
      enabled: item.enabled,
      params: item.params,
    }, override);
    return {
      ...item,
      enabled: pass.enabled,
      params: pass.params,
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
  return normalizeShaderPass({
    ...pass,
    ...(override.id ? { id: override.id } : {}),
    enabled: override.enabled ?? pass.enabled,
    params,
  });
}

export function normalizeMediaMeta(item = {}) {
  const duration = Number(item.duration);
  return {
    id: item.id || uid("media"),
    name: item.name || item.id || "Media",
    path: item.path || item.name || "",
    type: item.type || "unknown",
    size: Number(item.size) || 0,
    catalogMarker: normalizeCatalogMarker(item.catalogMarker),
    ...(Number.isFinite(duration) && duration > 0 ? { duration } : {}),
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
  next.surfaces = mappingPreviewSurfaceRoutes(next, selectedMapping);
  next.ui.selectedMappingId = mapping.id;
  return next;
}

// Materialize only the executable Surface program for Mapping Preview. Keep
// this separate from applyMappingForEditing so small authored Mapping commands
// can update Output without cloning and normalizing the complete project.
export function mappingPreviewSurfaceRoutes(state, mapping) {
  if (!mapping?.surfaces) return [];
  if (state.ui?.mappingTestPattern !== false) {
    return mapping.surfaces.map((surface) => ({
      ...surface,
      sourceNodeId: MAPPING_TEST_PATTERN_SOURCE_NODE_ID,
      componentId: MAPPING_TEST_PATTERN_COMPONENT_ID,
      sceneCrop: false,
      sourceFitActive: false,
    }));
  }
  const scene = mappingPreviewScene(state);
  if (scene) {
    return materializeSceneSurfaceRoutes(state, scene, mapping).surfaces;
  }
  return clone(mapping.surfaces);
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
