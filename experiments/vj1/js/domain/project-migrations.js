export const CURRENT_PROJECT_VERSION = 19;
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
