import { createEmptyNodeProjectData } from "../libraries/node-engine/node-project.js?v=project-group-authoring-1";

export const CURRENT_PROJECT_VERSION = 30;
export const OLDEST_PROJECT_VERSION = 1;

export class ProjectVersionError extends Error {
  constructor(message, { code = "PROJECT_VERSION_ERROR", version = null } = {}) {
    super(message);
    this.name = "ProjectVersionError";
    this.code = code;
    this.version = version;
  }
}

export class UnsupportedProjectVersionError extends ProjectVersionError {
  constructor(version, currentVersion = CURRENT_PROJECT_VERSION) {
    super(`Project version ${version} is newer than supported version ${currentVersion}.`, {
      code: "PROJECT_VERSION_TOO_NEW",
      version,
    });
    this.name = "UnsupportedProjectVersionError";
  }
}

// Every persisted model change adds exactly one adjacent migration here.
// Never replace several steps with a direct jump: a v5 project opened by v17
// must run every adjacent step from 5→6 through 16→17 in order.
export const PROJECT_MIGRATIONS = Object.freeze({
  1: migrateProjectV1ToV2,
  2: migrateProjectV2ToV3,
  3: migrateProjectV3ToV4,
  4: migrateProjectV4ToV5,
  5: migrateProjectV5ToV6,
  6: migrateProjectV6ToV7,
  7: migrateProjectV7ToV8,
  8: migrateProjectV8ToV9,
  9: migrateProjectV9ToV10,
  10: migrateProjectV10ToV11,
  11: migrateProjectV11ToV12,
  12: migrateProjectV12ToV13,
  13: migrateProjectV13ToV14,
  14: migrateProjectV14ToV15,
  15: migrateProjectV15ToV16,
  16: migrateProjectV16ToV17,
  17: migrateProjectV17ToV18,
  18: migrateProjectV18ToV19,
  19: migrateProjectV19ToV20,
  20: migrateProjectV20ToV21,
  21: migrateProjectV21ToV22,
  22: migrateProjectV22ToV23,
  23: migrateProjectV23ToV24,
  24: migrateProjectV24ToV25,
  25: migrateProjectV25ToV26,
  26: migrateProjectV26ToV27,
  27: migrateProjectV27ToV28,
  28: migrateProjectV28ToV29,
  29: migrateProjectV29ToV30,
});

export function migrateProjectData(project = {}) {
  return runProjectMigrations(project, {
    currentVersion: CURRENT_PROJECT_VERSION,
    migrations: PROJECT_MIGRATIONS,
    defaultVersion: OLDEST_PROJECT_VERSION,
  });
}

export function runProjectMigrations(project = {}, {
  currentVersion,
  migrations,
  defaultVersion = OLDEST_PROJECT_VERSION,
} = {}) {
  if (!project || typeof project !== "object" || Array.isArray(project)) {
    throw new ProjectVersionError("Project data must be a JSON object.", { code: "PROJECT_DATA_INVALID" });
  }
  const target = parseProjectVersion(currentVersion, "current project version");
  const declared = project.version === undefined || project.version === null
    ? parseProjectVersion(defaultVersion, "default project version")
    : parseProjectVersion(project.version, "project version");
  if (declared > target) throw new UnsupportedProjectVersionError(declared, target);
  if (declared === target) return project;

  let migrated = cloneProjectData(project);
  let version = declared;
  while (version < target) {
    const migrate = migrationForVersion(migrations, version);
    if (typeof migrate !== "function") {
      throw new ProjectVersionError(`Missing project migration ${version}→${version + 1}.`, {
        code: "PROJECT_MIGRATION_MISSING",
        version,
      });
    }
    const next = migrate(migrated);
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      throw new ProjectVersionError(`Project migration ${version}→${version + 1} returned invalid data.`, {
        code: "PROJECT_MIGRATION_INVALID",
        version,
      });
    }
    version += 1;
    migrated = { ...next, version };
  }
  return migrated;
}

function migrationForVersion(migrations, version) {
  if (migrations instanceof Map) return migrations.get(version);
  return migrations?.[version];
}

function parseProjectVersion(value, label) {
  const version = Number(value);
  if (!Number.isInteger(version) || version < OLDEST_PROJECT_VERSION) {
    throw new ProjectVersionError(`Invalid ${label}: ${String(value)}.`, {
      code: "PROJECT_VERSION_INVALID",
      version: Number.isFinite(version) ? version : null,
    });
  }
  return version;
}

function cloneProjectData(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

// Versions 1–4 predate strict schema enforcement. Their field-shape upgrades
// remain in the normalizers, but explicit adjacent steps keep the chain intact.
export function migrateProjectV1ToV2(project) {
  return { ...project };
}

export function migrateProjectV2ToV3(project) {
  return { ...project };
}

export function migrateProjectV3ToV4(project) {
  return { ...project };
}

export function migrateProjectV4ToV5(project) {
  return { ...project };
}

// v6 formalizes shared Canvas recording frames and explicit surface
// destinations. Direct-output surfaces remain derived during normalization.
export function migrateProjectV5ToV6(project) {
  const hasLegacyCompositions = Array.isArray(project.compositions);
  const compositions = hasLegacyCompositions ? project.compositions : [];
  const legacyFrames = compositions.flatMap((composition) =>
    composition?.type === "canvas" && Array.isArray(composition.canvas?.frames)
      ? composition.canvas.frames
      : []
  );
  const migrated = {
    ...project,
    ...(hasLegacyCompositions ? {
      compositions: compositions.map((composition) => {
        if (composition?.type !== "canvas" || !composition.canvas || typeof composition.canvas !== "object") return composition;
        const { frames: _legacyFrames, ...canvas } = composition.canvas;
        return { ...composition, canvas };
      }),
    } : {}),
    surfaces: Array.isArray(project.surfaces)
      ? project.surfaces.map((surface) => ({
          ...surface,
          destination: surface?.destination?.type === "direct"
            ? surface.destination
            : { type: "mapped" },
        }))
      : project.surfaces,
  };
  if (Array.isArray(project.recordingFrames)) migrated.recordingFrames = project.recordingFrames;
  else if (legacyFrames.length) migrated.recordingFrames = legacyFrames;
  return migrated;
}

// v7 adds persisted activity metadata used by stable list sorting. The
// migration is deterministic: old projects use their savedAt time (or epoch)
// rather than the time at which they happen to be opened.
export function migrateProjectV6ToV7(project) {
  const fallback = normalizedMigrationTimestamp(project.project?.savedAt);
  return {
    ...project,
    ...(Array.isArray(project.compositions) ? {
      compositions: project.compositions.map((composition, index) => ({
          ...composition,
          activity: migratedActivity(composition?.activity, fallback, index),
        })),
    } : {}),
    recordingFrames: Array.isArray(project.recordingFrames)
      ? project.recordingFrames.map((frame, index) => ({
          ...frame,
          activity: migratedActivity(frame?.activity, fallback, index),
        }))
      : project.recordingFrames,
  };
}

// v8 renames the persisted Composition workspace to Component and replaces
// its view-specific remembered-selection object with a neutral workspace key.
export function migrateProjectV7ToV8(project) {
  const ui = project.ui && typeof project.ui === "object" ? project.ui : {};
  const legacySelections = ui.workspaceSelectionIds || ui.workspaceCompositionIds || {};
  const { workspaceCompositionIds: _legacyWorkspaceCompositionIds, ...currentUi } = ui;
  return {
    ...project,
    ui: {
      ...currentUi,
      workspace: ui.workspace === "compose" ? "component" : ui.workspace,
      workspaceSelectionIds: {
        component: legacySelections.component || legacySelections.compose || "",
        canvas: legacySelections.canvas || "",
      },
    },
  };
}

// v9 persists each sortable catalog's mode independently. The visible item
// order remains a view-lifetime snapshot and is intentionally not persisted.
export function migrateProjectV8ToV9(project) {
  const ui = project.ui && typeof project.ui === "object" ? project.ui : {};
  const modes = ui.catalogSortModes && typeof ui.catalogSortModes === "object"
    ? ui.catalogSortModes
    : {};
  return {
    ...project,
    ui: {
      ...ui,
      catalogSortModes: {
        component: migratedCatalogSortMode(modes.component),
        canvas: migratedCatalogSortMode(modes.canvas),
        scene: migratedCatalogSortMode(modes.scene),
      },
    },
  };
}

function migratedCatalogSortMode(value) {
  return ["recent", "name", "created"].includes(value) ? value : "recent";
}

// v10 completes the product-language change from Composition to Component in
// the persisted domain model. This recursive migration covers nested scene
// routes, Canvas sources, Live overrides, render settings, metrics, and paths.
export function migrateProjectV9ToV10(project) {
  return migrateCompositionConcept(project);
}

function migrateCompositionConcept(value) {
  if (Array.isArray(value)) return value.map(migrateCompositionConcept);
  if (!value || typeof value !== "object") return migratedCompositionString(value);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    migratedCompositionKey(key),
    migrateCompositionConcept(entry),
  ]));
}

function migratedCompositionKey(key) {
  return String(key)
    .replace(/^selectedComposition/, "selectedComponent")
    .replace(/^composition/, "component")
    .replace(/^compositions$/, "components");
}

function migratedCompositionString(value) {
  if (typeof value !== "string") return value;
  if (/^Composition(?: \d+)?$/.test(value)) return value.replace(/^Composition/, "Component");
  return value
    .replace(/^compositions\./, "components.")
    .replace(/composition:/g, "component:")
    .replace(/composition-/g, "component-")
    .replace(/^composition$/, "component");
}

// v11 removes the obsolete per-surface sourceRect crop and stops persisting
// render dimensions that are deterministically derived from output windows.
export function migrateProjectV10ToV11(project) {
  const render = project.render && typeof project.render === "object" ? project.render : {};
  const outputs = Array.isArray(render.outputs) && render.outputs.length
    ? render.outputs
    : [{
        id: "output-main",
        name: "Main output",
        width: Number(render.frameWidth ?? render.width) || 960,
        height: Number(render.frameHeight ?? render.height) || 540,
      }];
  const primaryOutput = outputs[0];
  const componentTexture = render.componentTexture || {
    width: Number(render.surfaceWidth ?? render.surfaceTexture?.maxWidth) || Number(primaryOutput.width) || 960,
    height: Number(render.surfaceHeight ?? render.surfaceTexture?.maxHeight) || Number(primaryOutput.height) || 540,
  };
  const {
    width: _derivedWidth,
    height: _derivedHeight,
    frameWidth: _derivedFrameWidth,
    frameHeight: _derivedFrameHeight,
    worldScale: _derivedWorldScale,
    worldWidth: _derivedWorldWidth,
    worldHeight: _derivedWorldHeight,
    outputGap: _derivedOutputGap,
    surfaceWidth: _legacySurfaceWidth,
    surfaceHeight: _legacySurfaceHeight,
    surfaceTextureMode: _legacySurfaceTextureMode,
    ...canonicalRender
  } = render;
  return {
    ...project,
    render: { ...canonicalRender, outputs, componentTexture },
    surfaces: migrateSurfaceListWithoutSourceRect(project.surfaces),
    scenes: Array.isArray(project.scenes)
      ? project.scenes.map((scene) => ({
          ...scene,
          snapshot: scene?.snapshot && typeof scene.snapshot === "object"
            ? { ...scene.snapshot, surfaces: migrateSurfaceListWithoutSourceRect(scene.snapshot.surfaces) }
            : scene?.snapshot,
        }))
      : project.scenes,
    ui: migrateUiSnapshotsWithoutSourceRect(project.ui),
  };
}

// v12 freezes the intrinsic footprint of a Component when it is placed in a
// Canvas. Earlier versions derived that footprint from the mutable Component
// texture resolution on every frame, so changing render quality also changed
// the Canvas layout. The normalized footprint belongs to the reference source,
// not to the referenced Component or its user transform.
export function migrateProjectV11ToV12(project) {
  const components = Array.isArray(project.components) ? project.components : [];
  const componentById = new Map(components.map((component) => [component?.id, component]));
  const texture = migratedComponentTextureSize(project.render);
  return {
    ...project,
    components: components.map((component) => {
      if (component?.type !== "canvas") return component;
      const canvasWidth = migratedPositiveNumber(component.canvas?.width, 3840);
      const canvasHeight = migratedPositiveNumber(component.canvas?.height, 2160);
      const sourceChain = Array.isArray(component.chain) && component.chain.length
        ? component.chain
        : migratedLegacyCanvasLayers(component.canvas?.layers);
      return {
        ...component,
        chain: migrateCanvasComponentPlacements(
          sourceChain,
          componentById,
          texture,
          canvasWidth,
          canvasHeight
        ),
      };
    }),
  };
}

// v13 keeps only one Canvas-relative placement scale. Component dimensions
// and aspect remain authoritative on the referenced Component, preventing an
// old two-axis footprint from stretching it after texture dimensions change.
export function migrateProjectV12ToV13(project) {
  return {
    ...project,
    components: Array.isArray(project.components)
      ? project.components.map((component) => component?.type === "canvas"
        ? { ...component, chain: migrateCanvasPlacementScale(component.chain) }
        : component)
      : project.components,
  };
}

// v14 exposes the two independent adaptive-sampling multipliers as persisted
// render settings while preserving the render contract's previous defaults.
export function migrateProjectV13ToV14(project) {
  const render = project.render && typeof project.render === "object" ? project.render : {};
  const sampling = render.sampling && typeof render.sampling === "object" ? render.sampling : {};
  return {
    ...project,
    render: {
      ...render,
      sampling: {
        surfaceOverscan: sampling.surfaceOverscan ?? 1,
        recordingFrameScale: sampling.recordingFrameScale ?? 1,
      },
    },
  };
}

// v15 limits adaptive Canvas rasters to their logical design dimensions by
// default. Projects may explicitly disable the limit to restore supersampling.
export function migrateProjectV14ToV15(project) {
  const render = project.render && typeof project.render === "object" ? project.render : {};
  const sampling = render.sampling && typeof render.sampling === "object" ? render.sampling : {};
  return {
    ...project,
    render: {
      ...render,
      sampling: {
        ...sampling,
        limitCanvasToLogicalSize: sampling.limitCanvasToLogicalSize !== false,
      },
    },
  };
}

// v16 removes the obsolete global projection-edge softness control. Physical
// per-surface feather remains the supported projection-edge treatment.
export function migrateProjectV15ToV16(project) {
  const render = project.render && typeof project.render === "object" ? project.render : {};
  const { edgeSoftness: _removedEdgeSoftness, ...currentRender } = render;
  return { ...project, render: currentRender };
}

// v17 persists independent embedded-preview resolution choices for Scene and
// Live without changing projector output resolution.
export function migrateProjectV16ToV17(project) {
  const ui = project.ui && typeof project.ui === "object" ? project.ui : {};
  const qualities = ui.previewQualities && typeof ui.previewQualities === "object"
    ? ui.previewQualities
    : {};
  return {
    ...project,
    ui: {
      ...ui,
      previewQualities: {
        scene: migratedPreviewQuality(qualities.scene),
        live: migratedPreviewQuality(qualities.live),
      },
    },
  };
}

// v18 makes migration the only compatibility boundary. The active domain no
// longer needs to rediscover old source/shader chains, Canvas layers/frames,
// timeScale, or single-workspace viewport aliases during every state update.
export function migrateProjectV17ToV18(project) {
  const global = project.global && typeof project.global === "object" ? project.global : {};
  const legacyScale = Number(global.timeScale);
  const { timeScale: _timeScale, ...currentGlobal } = global;
  const ui = project.ui && typeof project.ui === "object" ? project.ui : {};
  const { previewViewport, ...currentUi } = ui;
  const workspace = ["component", "canvas", "scene", "live"].includes(ui.workspace) ? ui.workspace : "component";
  const previewViewports = ui.previewViewports && typeof ui.previewViewports === "object"
    ? ui.previewViewports
    : { [workspace]: previewViewport || {} };
  const components = Array.isArray(project.components)
    ? project.components.map(migrateCanonicalComponent)
    : project.components;
  const embeddedFrames = Array.isArray(project.components)
    ? project.components.flatMap((component) => component?.type === "canvas" && Array.isArray(component.canvas?.frames) ? component.canvas.frames : [])
    : [];
  return {
    ...project,
    global: {
      ...currentGlobal,
      timeStretch: Number.isFinite(Number(global.timeStretch))
        ? Number(global.timeStretch)
        : Number.isFinite(legacyScale) ? Math.log2(Math.max(1 / 16, legacyScale)) : 0,
    },
    ui: { ...currentUi, previewViewports },
    components,
    recordingFrames: Array.isArray(project.recordingFrames) ? project.recordingFrames : embeddedFrames,
    surfaces: migrateCanonicalRoutes(project.surfaces),
    scenes: Array.isArray(project.scenes) ? project.scenes.map((scene) => ({
      ...scene,
      snapshot: scene?.snapshot ? { ...scene.snapshot, surfaces: migrateCanonicalRoutes(scene.snapshot.surfaces) } : scene?.snapshot,
    })) : project.scenes,
  };
}

// v19 moves rendered thumbnails out of canonical project state. They are a
// regenerable cache, not user-authored data and not part of undo history.
export function migrateProjectV18ToV19(project) {
  return {
    ...project,
    components: Array.isArray(project.components)
      ? project.components.map((component) => {
          const { thumbnail: _thumbnail, ...current } = component || {};
          if (current.type !== "canvas" || !current.canvas) return current;
          const { frameThumbnails: _frameThumbnails, ...canvas } = current.canvas;
          return { ...current, canvas };
        })
      : project.components,
  };
}

// v20 makes the logical Canvas frame a project render setting. All Canvases
// share one coordinate space; per-Canvas width and height are removed so the
// active model cannot retain a second, conflicting resolution authority.
export function migrateProjectV19ToV20(project) {
  const components = Array.isArray(project.components) ? project.components : [];
  const firstCanvas = components.find((component) => component?.type === "canvas")?.canvas || {};
  const render = project.render && typeof project.render === "object" ? project.render : {};
  const configuredSize = render.canvasSize && typeof render.canvasSize === "object" ? render.canvasSize : {};
  const canvasSize = {
    width: migratedPositiveNumber(configuredSize.width ?? firstCanvas.width, 3840),
    height: migratedPositiveNumber(configuredSize.height ?? firstCanvas.height, 2160),
  };
  return {
    ...project,
    render: { ...render, canvasSize },
    components: components.map((component) => {
      if (component?.type !== "canvas" || !component.canvas) return component;
      const { width: _width, height: _height, ...canvas } = component.canvas;
      return { ...component, canvas };
    }),
  };
}

// v21 adds one shared three-level catalog marker to authored catalog items.
// UI sort preferences remain separate from project content.
export function migrateProjectV20ToV21(project) {
  const normalizeMarker = (value) => value === 1 || value === 2 ? value : 0;
  const ui = project.ui && typeof project.ui === "object" ? project.ui : {};
  const sortModes = ui.catalogSortModes && typeof ui.catalogSortModes === "object" ? ui.catalogSortModes : {};
  return {
    ...project,
    ui: {
      ...ui,
      catalogSortModes: {
        ...sortModes,
        media: ["recent", "marker", "name", "created"].includes(sortModes.media) ? sortModes.media : "recent",
      },
    },
    components: (project.components || []).map((item) => ({ ...item, catalogMarker: normalizeMarker(item?.catalogMarker) })),
    scenes: (project.scenes || []).map((item) => ({ ...item, catalogMarker: normalizeMarker(item?.catalogMarker) })),
    media: (project.media || []).map((item) => ({ ...item, catalogMarker: normalizeMarker(item?.catalogMarker) })),
  };
}

// v22 expands the catalog marker to four states: none, star, heart, and pin.
// Marker 2 meant pin in v21, so preserve that authored intent as marker 3.
export function migrateProjectV21ToV22(project) {
  const migrateMarker = (value) => value === 2 ? 3 : value === 1 ? 1 : 0;
  const ui = project.ui && typeof project.ui === "object" ? project.ui : {};
  const sortModes = ui.catalogSortModes && typeof ui.catalogSortModes === "object" ? ui.catalogSortModes : {};
  return {
    ...project,
    ui: {
      ...ui,
      catalogSortModes: {
        ...sortModes,
        source: ["recent", "marker", "name", "created"].includes(sortModes.source) ? sortModes.source : "recent",
      },
    },
    components: (project.components || []).map((item) => ({ ...item, catalogMarker: migrateMarker(item?.catalogMarker) })),
    scenes: (project.scenes || []).map((item) => ({ ...item, catalogMarker: migrateMarker(item?.catalogMarker) })),
    media: (project.media || []).map((item) => ({ ...item, catalogMarker: migrateMarker(item?.catalogMarker) })),
  };
}

// v23 introduces project-owned node definitions and graph state. Existing
// projects keep their exact authored behavior and begin with no local nodes.
export function migrateProjectV22ToV23(project) {
  const { authority: _v24Authority, ...v23NodeData } = createEmptyNodeProjectData();
  return {
    ...project,
    nodes: v23NodeData,
  };
}

// v24 makes persisted Component node groups authoritative. The application
// compiler imports v23 chains into groups once; subsequent saves omit the
// redundant chain projection.
export function migrateProjectV23ToV24(project) {
  return {
    ...project,
    nodes: {
      ...createEmptyNodeProjectData(),
      ...(project.nodes && typeof project.nodes === "object" ? project.nodes : {}),
      authority: "node-graph",
    },
  };
}

// v25 makes authored geometry independent from physical displays. Outputs,
// Canvas, and Components retain proportions; recording frames and projection
// corners become relative. Runtime hosts compile those values to pixels.
export function migrateProjectV24ToV25(project) {
  const migrated = migrateRelativeProjectState(project);
  const live = migrated.ui?.live;
  return live?.sceneSnapshot
    ? { ...migrated, ui: { ...migrated.ui, live: { ...live, sceneSnapshot: migrateRelativeProjectState(live.sceneSnapshot) } } }
    : migrated;
}

// v26 makes the visible element transform an oriented render boundary.
// Existing handle-authored rotations therefore move from the content field to
// the boundary while content keeps its independent X/Y/Scale controls.
export function migrateProjectV25ToV26(project) {
  const migrateState = (state = {}) => ({
    ...state,
    components: (state.components || []).map((component) => Array.isArray(component.chain)
      ? {
          ...component,
          chain: migrateChainBoundaryRotation(component.chain),
          nodeProjectionSignature: "",
        }
      : component),
    nodes: state.nodes && typeof state.nodes === "object"
      ? {
          ...state.nodes,
          // Since v24, generated Component groups are the persisted visual
          // authority and `component.chain` is normally omitted on disk. Move
          // rotation inside that authority instead of clearing its projection
          // marker and rebuilding from a non-existent compatibility chain.
          groups: (state.nodes.groups || []).map(migrateComponentGroupBoundaryRotation),
        }
      : state.nodes,
  });
  const migrated = migrateState(project);
  const live = migrated.ui?.live;
  return live?.sceneSnapshot
    ? { ...migrated, ui: { ...migrated.ui, live: { ...live, sceneSnapshot: migrateState(live.sceneSnapshot) } } }
    : migrated;
}

function migrateChainBoundaryRotation(chain = []) {
  return chain.map(migrateChainItemBoundaryRotation);
}

function migrateChainItemBoundaryRotation(item) {
  if (!item || typeof item !== "object") return item;
  const transform = item.transform && typeof item.transform === "object" ? item.transform : {};
  const boundary = item.boundary && typeof item.boundary === "object" ? item.boundary : {};
  const rotation = Number.isFinite(Number(boundary.rotation))
    ? Number(boundary.rotation)
    : Number(transform.rotation) || 0;
  return {
    ...item,
    boundary: { ...boundary, rotation },
    transform: { ...transform, rotation: 0 },
    ...(item.kind === "group" && Array.isArray(item.chain)
      ? { chain: migrateChainBoundaryRotation(item.chain) }
      : {}),
  };
}

function migrateComponentGroupBoundaryRotation(group = {}) {
  if (group?.generatedBy !== "vj1-component-compiler") return group;
  return {
    ...group,
    nodes: migrateComponentGraphNodes(group.nodes || []),
  };
}

function migrateComponentGraphNodes(nodes = []) {
  return nodes.map((node) => {
    const configuration = node?.configuration && typeof node.configuration === "object"
      ? migrateChainItemBoundaryRotation(node.configuration)
      : node?.configuration;
    const parameterTransform = node?.parameters?.transform && typeof node.parameters.transform === "object"
      ? { ...node.parameters.transform, rotation: 0 }
      : null;
    return {
      ...node,
      ...(configuration ? { configuration } : {}),
      ...(parameterTransform ? { parameters: { ...node.parameters, transform: parameterTransform } } : {}),
      ...(Array.isArray(node?.nodes) ? { nodes: migrateComponentGraphNodes(node.nodes) } : {}),
    };
  });
}

function migrateRelativeProjectState(project = {}) {
  const render = project.render && typeof project.render === "object" ? project.render : {};
  const ui = project.ui && typeof project.ui === "object" ? project.ui : {};
  const legacyPreviewQuality = ui.previewQuality
    ?? ui.previewQualities?.scene
    ?? ui.previewQualities?.live
    ?? project.components?.find((component) => component?.previewQuality || component?.canvas?.previewQuality)?.previewQuality
    ?? project.components?.find((component) => component?.canvas?.previewQuality)?.canvas?.previewQuality;
  const { previewQualities: _previewQualities, ...uiWithoutLegacyQualities } = ui;
  const legacyOutputs = Array.isArray(render.outputs) && render.outputs.length
    ? render.outputs
    : [{ id: "output-main", name: "Main output", width: render.frameWidth ?? render.width, height: render.frameHeight ?? render.height }];
  const outputs = legacyOutputs.map((output, index) => ({
    id: String(output?.id || (index === 0 ? "output-main" : `output-${index + 1}`)),
    name: output?.name || (index === 0 ? "Main output" : `Output ${index + 1}`),
    aspectRatio: migratedAspectRatio(output?.aspectRatio, output?.width, output?.height, 16 / 9),
  }));
  const canvasWidth = migratedPositiveNumber(render.canvasSize?.width, 3840);
  const canvasHeight = migratedPositiveNumber(render.canvasSize?.height, 2160);
  const componentWidth = migratedPositiveNumber(render.componentTexture?.width, 960);
  const componentHeight = migratedPositiveNumber(render.componentTexture?.height, 540);
  const world = migratedLegacyWorldSize(render, legacyOutputs);
  const {
    width: _width,
    height: _height,
    frameWidth: _frameWidth,
    frameHeight: _frameHeight,
    worldWidth: _worldWidth,
    worldHeight: _worldHeight,
    canvasSize: _canvasSize,
    componentTexture: _componentTexture,
    surfaceTexture: _surfaceTexture,
    camera: legacyCamera = {},
    ...renderWithoutPixels
  } = render;
  const { width: _cameraWidth, height: _cameraHeight, ...camera } = legacyCamera;
  return {
    ...project,
    ui: {
      ...uiWithoutLegacyQualities,
      previewQuality: migratedSharedPreviewQuality(legacyPreviewQuality),
    },
    render: {
      ...renderWithoutPixels,
      outputs,
      canvasAspectRatio: migratedAspectRatio(render.canvasAspectRatio, canvasWidth, canvasHeight, 16 / 9),
      componentAspectRatio: migratedAspectRatio(render.componentAspectRatio, componentWidth, componentHeight, outputs[0]?.aspectRatio || 16 / 9),
      resolutionCeiling: ["auto", "2k", "4k", "8k"].includes(render.resolutionCeiling) ? render.resolutionCeiling : "auto",
      camera,
    },
    recordingFrames: migrateRelativeRecordingFrames(project.recordingFrames, canvasWidth, canvasHeight),
    mappings: migrateRelativeMappings(project.mappings, world.width, world.height),
    components: Array.isArray(project.components) ? project.components.map(migrateComponentBoundaries) : project.components,
    nodes: migrateNodeProjectBoundaries(project.nodes),
  };
}

// v27 makes the product model explicit: Canvas Components become Scenes and
// the former Scene route presets become Mappings. The old `mappings` object
// held low-level surface calibration, so it moves to `surfaceMappings` before
// the preset collection takes the canonical `mappings` name. Live's
// selectedSceneId already referred to the authored visual Scene and is kept.
export function migrateProjectV26ToV27(project) {
  const ui = project.ui && typeof project.ui === "object" ? project.ui : {};
  const selections = ui.workspaceSelectionIds && typeof ui.workspaceSelectionIds === "object"
    ? ui.workspaceSelectionIds
    : {};
  const sortModes = ui.catalogSortModes && typeof ui.catalogSortModes === "object"
    ? ui.catalogSortModes
    : {};
  const {
    canvas: legacySceneSortMode,
    scene: legacyMappingSortMode,
    ...canonicalSortModes
  } = sortModes;
  const workspace = ui.workspace === "canvas"
    ? "scene"
    : ui.workspace === "scene"
      ? "mapping"
      : ui.workspace === "mapping"
        ? "nodes"
        : ui.workspace;
  const components = Array.isArray(project.components)
    ? project.components.map((component) => {
        if (component?.type !== "canvas") return component;
        const { canvas, ...rest } = component;
        return { ...rest, type: "scene", scene: canvas && typeof canvas === "object" ? canvas : {} };
      })
    : project.components;
  const render = project.render && typeof project.render === "object" ? project.render : {};
  const sampling = render.sampling && typeof render.sampling === "object" ? render.sampling : {};
  const {
    canvasAspectRatio,
    sampling: _sampling,
    ...renderRest
  } = render;
  const {
    limitCanvasToLogicalSize,
    ...samplingRest
  } = sampling;
  const {
    scenes: legacyMappings,
    mappings: legacySurfaceMappings,
    recordingFrames,
    ...projectRest
  } = project;
  return {
    ...projectRest,
    components,
    frames: Array.isArray(recordingFrames) ? recordingFrames : [],
    mappings: Array.isArray(legacyMappings) ? legacyMappings : [],
    surfaceMappings: legacySurfaceMappings && typeof legacySurfaceMappings === "object"
      ? legacySurfaceMappings
      : {},
    render: {
      ...renderRest,
      sceneAspectRatio: canvasAspectRatio,
      sampling: {
        ...samplingRest,
        limitSceneToLogicalSize: limitCanvasToLogicalSize,
      },
    },
    ui: {
      ...ui,
      workspace,
      selectedMappingId: ui.selectedSceneId || "",
      workspaceSelectionIds: {
        component: selections.component || "",
        scene: selections.canvas || "",
      },
      catalogSortModes: {
        ...canonicalSortModes,
        scene: legacySceneSortMode || "recent",
        mapping: legacyMappingSortMode || "recent",
      },
      selectedSceneId: undefined,
    },
  };
}

// v28 makes Mapping ownership direct. A Mapping is no longer a saved snapshot
// over one global Surface list: it owns complete Surface definitions and its
// calibration. The root Surface/calibration fields become runtime projections
// and are therefore not part of canonical project data after this migration.
// Alpha projects may contain incomplete route snapshots; preserving what can be
// matched by Surface id is sufficient and unresolved data is intentionally
// discarded instead of retaining a second authority.
export function migrateProjectV27ToV28(project) {
  const physicalById = new Map((Array.isArray(project.surfaces) ? project.surfaces : [])
    .filter((surface) => surface?.id)
    .map((surface) => [String(surface.id), surface]));
  const calibration = project.surfaceMappings?.local && typeof project.surfaceMappings.local === "object"
    ? project.surfaceMappings.local
    : {};
  const mappings = (Array.isArray(project.mappings) ? project.mappings : []).map((mapping) => {
    const routes = Array.isArray(mapping?.surfaces)
      ? mapping.surfaces
      : Array.isArray(mapping?.snapshot?.surfaces)
        ? mapping.snapshot.surfaces
        : [];
    const { snapshot: _snapshot, ...mappingData } = mapping || {};
    return {
      ...mappingData,
      surfaces: routes.map((route) => ({
        ...(physicalById.get(String(route?.id || "")) || {}),
        ...(route || {}),
      })),
      calibration: mapping?.calibration && typeof mapping.calibration === "object"
        ? mapping.calibration
        : calibration,
    };
  });
  const {
    surfaces: _runtimeSurfaces,
    surfaceMappings: _runtimeCalibration,
    ...projectData
  } = project;
  const live = project.ui?.live && typeof project.ui.live === "object" ? project.ui.live : {};
  const { mappingSnapshot: _mappingSnapshot, ...liveData } = live;
  return {
    ...projectData,
    mappings,
    ui: project.ui && typeof project.ui === "object"
      ? { ...project.ui, live: liveData }
      : project.ui,
  };
}

// v29 makes a Mapping Surface the single identity for both Scene-space
// placement and physical projection. The former global Frame collection is
// folded into each Surface. Scenes remain visual compositions without a
// second routing table; only derived thumbnails are keyed by Surface id.
// Rendering may still call a cropped
// Scene texture a recording frame internally, but no persisted Frame model
// remains after this migration.
export function migrateProjectV28ToV29(project) {
  const framesById = new Map((Array.isArray(project.frames) ? project.frames : [])
    .filter((frame) => frame?.id)
    .map((frame) => [String(frame.id), frame]));
  const surfaceLegacyFrame = new Map();
  const mappings = (Array.isArray(project.mappings) ? project.mappings : []).map((mapping) => ({
    ...mapping,
    surfaces: (Array.isArray(mapping?.surfaces) ? mapping.surfaces : []).map((surface) => {
      const frameId = String(surface?.frameSlotId || surface?.outputFrameId || "");
      const frame = framesById.get(frameId) || {};
      const surfaceId = String(surface?.id || "");
      if (surfaceId) surfaceLegacyFrame.set(surfaceId, frameId);
      const {
        frameSlotId: _frameSlotId,
        outputFrameId: _outputFrameId,
        sourceNodeId: _sourceNodeId,
        componentId: _componentId,
        ...surfaceData
      } = surface || {};
      return {
        ...surfaceData,
        x: finiteMigrationNumber(surface?.x, frame.x, 0.375),
        y: finiteMigrationNumber(surface?.y, frame.y, 0.375),
        width: positiveMigrationNumber(surface?.width, frame.width, 0.25),
        height: positiveMigrationNumber(surface?.height, frame.height, 0.25),
        keepProportions: surface?.keepProportions ?? frame.keepProportions ?? true,
      };
    }),
  }));
  const surfaceIds = [...new Set(mappings.flatMap((mapping) =>
    (mapping.surfaces || []).map((surface) => String(surface?.id || "")).filter(Boolean)
  ))];
  const components = (Array.isArray(project.components) ? project.components : []).map((component) => {
    if (component?.type !== "scene") return component;
    const scene = component.scene && typeof component.scene === "object" ? component.scene : {};
    const oldThumbnails = scene.frameThumbnails && typeof scene.frameThumbnails === "object"
      ? scene.frameThumbnails
      : {};
    const surfaceThumbnails = Object.fromEntries(surfaceIds.flatMap((surfaceId) => {
      const thumbnail = oldThumbnails[surfaceLegacyFrame.get(surfaceId) || ""];
      return typeof thumbnail === "string" && thumbnail ? [[surfaceId, thumbnail]] : [];
    }));
    const { frames: _frames, frameThumbnails: _frameThumbnails, ...sceneData } = scene;
    return { ...component, scene: { ...sceneData, surfaceThumbnails } };
  });
  const { frames: _frames, ...projectData } = project;
  return { ...projectData, components, mappings };
}

// v30 seals the Surface-only contract after the Frame-to-Surface migration.
// All compatibility interpretation ends here: normalized runtime code never
// reads Frame fields or persisted render-route materializations.
export function migrateProjectV29ToV30(project) {
  const mappings = (Array.isArray(project.mappings) ? project.mappings : []).map((mapping) => ({
    ...mapping,
    surfaces: (Array.isArray(mapping?.surfaces) ? mapping.surfaces : []).map(stripMigratedSurfaceRoute),
  }));
  const components = (Array.isArray(project.components) ? project.components : []).map((component) => {
    if (component?.type !== "scene") return component;
    const scene = component.scene && typeof component.scene === "object" ? component.scene : {};
    const { frames: _frames, frameThumbnails: _frameThumbnails, ...sceneData } = scene;
    return { ...component, scene: { ...sceneData, surfaceThumbnails: sceneData.surfaceThumbnails || {} } };
  });
  const ui = project.ui && typeof project.ui === "object" ? { ...project.ui } : project.ui;
  if (ui && typeof ui === "object") {
    delete ui.selectedFrameId;
    const live = ui.live && typeof ui.live === "object" ? { ...ui.live } : {};
    if (typeof live.showScenes !== "boolean" && typeof live.showComponents !== "boolean") {
      live.showScenes = live.sourceKind !== "component";
      live.showComponents = live.sourceKind !== "scene";
    }
    delete live.sourceKind;
    delete live.surfaceRoutes;
    delete live.transition;
    ui.live = live;
  }
  const { frames: _frames, surfaces: _runtimeSurfaces, ...projectData } = project;
  return { ...projectData, components, mappings, ui };
}

function stripMigratedSurfaceRoute(surface = {}) {
  const {
    sourceNodeId: _sourceNodeId,
    componentId: _componentId,
    outputFrameId: _outputFrameId,
    frameSlotId: _frameSlotId,
    frameFit: _frameFit,
    frameFitActive: _frameFitActive,
    frameAspect: _frameAspect,
    sceneCrop: _sceneCrop,
    sourceFit: _sourceFit,
    sourceFitActive: _sourceFitActive,
    sourceAspect: _sourceAspect,
    ...authored
  } = surface || {};
  return authored;
}

function finiteMigrationNumber(primary, secondary, fallback) {
  const value = Number.isFinite(Number(primary)) ? Number(primary)
    : Number.isFinite(Number(secondary)) ? Number(secondary)
      : fallback;
  return value;
}

function positiveMigrationNumber(primary, secondary, fallback) {
  const value = finiteMigrationNumber(primary, secondary, fallback);
  return value > 0 ? value : fallback;
}

function migrateComponentBoundaries(component = {}) {
  const { previewQuality: _previewQuality, ...componentWithoutLegacyQuality } = component;
  const canvas = component.canvas && typeof component.canvas === "object"
    ? Object.fromEntries(Object.entries(component.canvas).filter(([key]) => key !== "previewQuality"))
    : component.canvas;
  return {
    ...componentWithoutLegacyQuality,
    ...(component.type === "canvas" ? { canvas } : {}),
    ...(Array.isArray(component.chain) ? { chain: migrateChainBoundaries(component.chain) } : {}),
  };
}

function migratedSharedPreviewQuality(value) {
  if (value === "full") return "good";
  if (value === "high") return "good";
  return ["auto", "good", "low"].includes(value) ? value : "good";
}

function migrateChainBoundaries(chain) {
  return (chain || []).map((item) => ({
    ...item,
    boundary: item?.boundary || { x: 0, y: 0, width: 1, height: 1 },
    ...(item?.kind === "group" && Array.isArray(item.chain) ? { chain: migrateChainBoundaries(item.chain) } : {}),
  }));
}

function migrateNodeProjectBoundaries(nodes) {
  if (!nodes || typeof nodes !== "object") return nodes;
  const migrateNodes = (items) => (items || []).map((node) => ({
    ...node,
    ...(node?.configuration ? {
      configuration: { ...node.configuration, boundary: node.configuration.boundary || { x: 0, y: 0, width: 1, height: 1 } },
    } : {}),
    ...(Array.isArray(node?.nodes) ? { nodes: migrateNodes(node.nodes) } : {}),
  }));
  return {
    ...nodes,
    groups: Array.isArray(nodes.groups) ? nodes.groups.map((group) => ({
      ...group,
      ...(Array.isArray(group.nodes) ? { nodes: migrateNodes(group.nodes) } : {}),
    })) : nodes.groups,
  };
}

function migrateRelativeRecordingFrames(frames, canvasWidth, canvasHeight) {
  if (!Array.isArray(frames)) return frames;
  return frames.map((frame) => {
    if (!frame || typeof frame !== "object") return frame;
    const alreadyRelative = Number(frame.width) <= 1 && Number(frame.height) <= 1 && Number(frame.x) <= 1 && Number(frame.y) <= 1;
    if (alreadyRelative) return frame;
    return {
      ...frame,
      x: (Number(frame.x) || 0) / canvasWidth,
      y: (Number(frame.y) || 0) / canvasHeight,
      width: migratedPositiveNumber(frame.width, canvasWidth * 0.25) / canvasWidth,
      height: migratedPositiveNumber(frame.height, canvasHeight * 0.25) / canvasHeight,
    };
  });
}

function migrateRelativeMappings(mappings, worldWidth, worldHeight) {
  if (!mappings || typeof mappings !== "object") return mappings;
  return Object.fromEntries(Object.entries(mappings).map(([key, mapping]) => {
    if (!mapping || typeof mapping !== "object") return [key, mapping];
    if (mapping.coordinateSpace === "relative") return [key, mapping];
    return [key, {
      ...mapping,
      coordinateSpace: "relative",
      surfaces: Array.isArray(mapping.surfaces) ? mapping.surfaces.map((surface) => {
        const { w: _w, h: _h, ...current } = surface || {};
        return {
          ...current,
          corners: Array.isArray(surface?.corners) ? surface.corners.map((point) => ({
            x: (Number(point?.x) || 0) / worldWidth,
            y: (Number(point?.y) || 0) / worldHeight,
          })) : surface?.corners,
        };
      }) : mapping.surfaces,
    }];
  }));
}

function migratedLegacyWorldSize(render, outputs) {
  const widths = outputs.map((output) => migratedPositiveNumber(output?.width, 960));
  const heights = outputs.map((output) => migratedPositiveNumber(output?.height, 540));
  const contentWidth = widths.reduce((sum, width) => sum + width, 0);
  const contentHeight = Math.max(...heights, 540);
  const margin = Math.max(...widths, 960) * 0.08;
  return {
    width: migratedPositiveNumber(render.worldWidth, contentWidth + margin * 2),
    height: migratedPositiveNumber(render.worldHeight, contentHeight * 1.16),
  };
}

function migratedAspectRatio(value, width, height, fallback) {
  const direct = Number(value);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const w = Number(width);
  const h = Number(height);
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? w / h : fallback;
}

function migrateCanonicalComponent(component = {}, componentIndex = 0) {
  const id = component.id || `component-${componentIndex + 1}`;
  const shaderChain = Array.isArray(component.shaderChain) ? component.shaderChain : [];
  const hadChain = Array.isArray(component.chain);
  let chain = hadChain ? component.chain : null;
  if (!hadChain && component.type === "canvas" && Array.isArray(component.canvas?.layers)) {
    chain = migratedLegacyCanvasLayers(component.canvas.layers);
  }
  if (!hadChain && component.type !== "canvas") {
    chain = [migratedSourceChainItem(component.source, `${id}:source`)];
  }
  if (shaderChain.length) {
    chain = [...(chain || []), ...shaderChain.map((pass, index) => ({
      id: pass.id && pass.id !== pass.componentId ? pass.id : `${id}:effect:${index + 1}`,
      kind: "effect",
      componentId: pass.componentId || pass.id || "ripple",
      name: pass.name || pass.componentId || pass.id || "Effect",
      enabled: pass.enabled !== false,
      params: pass.params || (pass.amount !== undefined ? { amount: pass.amount } : {}),
      transform: pass.transform || { x: 0, y: 0, scale: 1, rotation: 0 },
    }))];
  }
  const canvas = component.canvas && typeof component.canvas === "object"
    ? Object.fromEntries(Object.entries(component.canvas).filter(([key]) => key !== "layers" && key !== "frames"))
    : component.canvas;
  const { source: _legacySource, shaderChain: _shaderChain, ...current } = component;
  return {
    ...current,
    ...(component.type === "canvas" ? { canvas } : {}),
    chain: (chain || []).map(migrateCanonicalChainItem),
    significantParams: Array.isArray(component.significantParams) ? component.significantParams : [],
  };
}

function migrateCanonicalChainItem(item = {}) {
  if (item.kind === "group") {
    const { layout: _legacyLayout, ...group } = item;
    return { ...group, role: "group", chain: (item.chain || []).map(migrateCanonicalChainItem) };
  }
  if (item.kind === "source") return { ...item, source: migrateCanonicalSource(item.source) };
  return item;
}

function migratedSourceChainItem(source = {}, id = "source") {
  return {
    id,
    kind: "source",
    name: source.mediaId || source.generatorId || source.componentId || source.type || "Source",
    enabled: true,
    opacity: 1,
    blend: "normal",
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    source: migrateCanonicalSource(source),
  };
}

function migrateCanonicalSource(source = {}) {
  const { startTime, endTime, ...current } = source || {};
  return {
    ...current,
    start: current.start ?? startTime ?? 0,
    end: current.end ?? endTime ?? 0,
  };
}

function migrateCanonicalRoutes(routes) {
  if (!Array.isArray(routes)) return routes;
  return routes.map((route) => {
    if (!route || route.sourceNodeId || !route.componentId) return route;
    const component = encodeURIComponent(route.componentId);
    const frame = route.outputFrameId ? `:${encodeURIComponent(route.outputFrameId)}` : "";
    return { ...route, sourceNodeId: `${route.outputFrameId ? "recording-frame" : "component"}:${component}${frame}` };
  });
}

function migratedPreviewQuality(value) {
  return ["auto", "low", "full"].includes(value) ? value : "auto";
}

function migrateCanvasPlacementScale(chain) {
  if (!Array.isArray(chain)) return chain;
  return chain.map((item) => {
    if (!item || typeof item !== "object") return item;
    if (item.kind === "group") return { ...item, chain: migrateCanvasPlacementScale(item.chain) };
    const source = item.source;
    if (item.kind !== "source" || source?.type !== "component" || !source.placement) return item;
    const scale = migratedPositiveNumber(source.placement.scale, migratedPositiveNumber(source.placement.width, 1));
    return { ...item, source: { ...source, placement: { scale } } };
  });
}

function migratedLegacyCanvasLayers(layers) {
  if (!Array.isArray(layers)) return layers;
  return layers.map((layer, index) => {
    const id = layer?.id || `legacy-canvas-layer-${index + 1}`;
    return {
      id,
      kind: "group",
      role: "group",
      name: layer?.name || `Group ${index + 1}`,
      enabled: layer?.enabled !== false,
      opacity: layer?.opacity ?? 1,
      blend: layer?.blend || "normal",
      transform: layer?.transform || { x: 0, y: 0, scale: 1, rotation: 0 },
      chain: layer?.componentId ? [{
        id: `${id}:source`,
        kind: "source",
        enabled: true,
        opacity: 1,
        blend: "normal",
        transform: { x: 0, y: 0, scale: 1, rotation: 0 },
        source: { type: "component", componentId: layer.componentId },
      }] : [],
    };
  });
}

function migrateCanvasComponentPlacements(chain, componentById, texture, canvasWidth, canvasHeight) {
  if (!Array.isArray(chain)) return chain;
  return chain.map((item) => {
    if (!item || typeof item !== "object") return item;
    if (item.kind === "group") {
      return {
        ...item,
        chain: migrateCanvasComponentPlacements(item.chain, componentById, texture, canvasWidth, canvasHeight),
      };
    }
    const source = item.source;
    if (item.kind !== "source" || source?.type !== "component" || source.placement) return item;
    const referenced = componentById.get(source.componentId) || {};
    const frame = migratedComponentFrameSize(texture, referenced.frameShape);
    return {
      ...item,
      source: {
        ...source,
        placement: {
          width: frame.width / canvasWidth,
          height: frame.height / canvasHeight,
        },
      },
    };
  });
}

function migratedComponentTextureSize(render = {}) {
  const primary = Array.isArray(render?.outputs) && render.outputs.length ? render.outputs[0] : {};
  return {
    width: migratedPositiveNumber(render?.componentTexture?.width, migratedPositiveNumber(primary.width, 960)),
    height: migratedPositiveNumber(render?.componentTexture?.height, migratedPositiveNumber(primary.height, 540)),
  };
}

function migratedComponentFrameSize(texture, frameShape = "landscape") {
  const longEdge = Math.max(texture.width, texture.height);
  const shortEdge = Math.min(texture.width, texture.height);
  if (frameShape === "portrait") return { width: shortEdge, height: longEdge };
  if (frameShape === "square") return { width: shortEdge, height: shortEdge };
  return { width: longEdge, height: shortEdge };
}

function migratedPositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function migrateSurfaceListWithoutSourceRect(surfaces) {
  if (!Array.isArray(surfaces)) return surfaces;
  return surfaces.map((surface) => {
    if (!surface || typeof surface !== "object") return surface;
    const { sourceRect: _legacySourceRect, ...current } = surface;
    return current;
  });
}

function migrateUiSnapshotsWithoutSourceRect(ui) {
  if (!ui || typeof ui !== "object") return ui;
  const live = ui.live && typeof ui.live === "object" ? ui.live : null;
  const sceneSnapshot = live?.sceneSnapshot && typeof live.sceneSnapshot === "object"
    ? { ...live.sceneSnapshot, surfaces: migrateSurfaceListWithoutSourceRect(live.sceneSnapshot.surfaces) }
    : live?.sceneSnapshot;
  return live ? { ...ui, live: { ...live, sceneSnapshot } } : ui;
}

function migratedActivity(activity = {}, fallback = "1970-01-01T00:00:00.000Z", index = 0) {
  const baseTime = new Date(fallback).getTime() + Math.max(0, index);
  const createdAt = normalizedMigrationTimestamp(activity?.createdAt, new Date(baseTime).toISOString());
  return {
    createdAt,
    updatedAt: normalizedMigrationTimestamp(activity?.updatedAt, createdAt),
    lastUsedAt: normalizedMigrationTimestamp(activity?.lastUsedAt, ""),
  };
}

function normalizedMigrationTimestamp(value, fallback = "1970-01-01T00:00:00.000Z") {
  if (!value) return fallback;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : fallback;
}
