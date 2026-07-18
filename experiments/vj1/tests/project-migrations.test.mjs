import test from "node:test";
import assert from "node:assert/strict";

import {
  CURRENT_PROJECT_VERSION,
  migrateProjectData,
  ProjectVersionError,
  runProjectMigrations,
  UnsupportedProjectVersionError,
  migrateProjectV5ToV6,
  migrateProjectV6ToV7,
  migrateProjectV8ToV9,
  migrateProjectV9ToV10,
  migrateProjectV10ToV11,
  migrateProjectV11ToV12,
  migrateProjectV12ToV13,
  migrateProjectV13ToV14,
  migrateProjectV14ToV15,
  migrateProjectV15ToV16,
  migrateProjectV16ToV17,
  migrateProjectV17ToV18,
  migrateProjectV18ToV19,
} from "../js/domain/project-migrations.js";
import { createInitialState, sanitizeState } from "../js/domain/models.js";

test("current state and sanitized legacy state always use the current project version", () => {
  assert.equal(CURRENT_PROJECT_VERSION, 19);
  assert.equal(createInitialState().version, CURRENT_PROJECT_VERSION);
  assert.equal(sanitizeState({ version: 5 }).version, CURRENT_PROJECT_VERSION);
});

test("v5 to v6 migrates shared recording frames and explicit mapped destinations", () => {
  const input = {
    version: 5,
    compositions: [{
      id: "canvas-a",
      type: "canvas",
      canvas: { width: 1920, height: 1080, frames: [{ id: "frame-a", x: 1, y: 2, width: 3, height: 4 }] },
    }],
    surfaces: [{ id: "surface-a", name: "Legacy mapped surface" }],
  };

  const migrated = migrateProjectV5ToV6(input);
  migrated.version = 6;
  assert.equal(migrated.version, 6);
  assert.deepEqual(migrated.recordingFrames, input.compositions[0].canvas.frames);
  assert.equal(Object.hasOwn(migrated.compositions[0].canvas, "frames"), false);
  assert.deepEqual(migrated.surfaces[0].destination, { type: "mapped" });
  assert.equal(Object.hasOwn(input.compositions[0].canvas, "frames"), true, "migration does not mutate source data");
});

test("v6 to v7 adds deterministic activity metadata", () => {
  const migrated = migrateProjectV6ToV7({
    version: 6,
    project: { savedAt: "2026-07-16T08:00:00.000Z" },
    compositions: [{ id: "comp-a" }, { id: "comp-b" }],
    recordingFrames: [{ id: "frame-a" }],
  });
  assert.deepEqual(migrated.compositions[0].activity, {
    createdAt: "2026-07-16T08:00:00.000Z",
    updatedAt: "2026-07-16T08:00:00.000Z",
    lastUsedAt: "",
  });
  assert.equal(migrated.compositions[1].activity.createdAt, "2026-07-16T08:00:00.001Z");
  assert.equal(migrated.recordingFrames[0].activity.createdAt, "2026-07-16T08:00:00.000Z");
});

test("v7 to v8 migrates the Component workspace and remembered selections", () => {
  const migrated = migrateProjectData({
    version: 7,
    ui: {
      workspace: "compose",
      workspaceCompositionIds: { compose: "comp-a", canvas: "canvas-a" },
    },
  });
  assert.equal(migrated.version, CURRENT_PROJECT_VERSION);
  assert.equal(migrated.ui.workspace, "component");
  assert.deepEqual(migrated.ui.workspaceSelectionIds, { component: "comp-a", canvas: "canvas-a" });
  assert.equal(Object.hasOwn(migrated.ui, "workspaceCompositionIds"), false);
  assert.deepEqual(migrated.ui.catalogSortModes, { component: "recent", scene: "recent" });
});

test("v8 to v9 persists independent normalized catalog sort modes", () => {
  const migrated = migrateProjectV8ToV9({
    version: 8,
    ui: { catalogSortModes: { component: "name", scene: "created" } },
  });
  assert.deepEqual(migrated.ui.catalogSortModes, { component: "name", scene: "created" });

  const repaired = migrateProjectV8ToV9({
    version: 8,
    ui: { catalogSortModes: { component: "invalid" } },
  });
  assert.deepEqual(repaired.ui.catalogSortModes, { component: "recent", scene: "recent" });
});

test("v9 to v10 migrates the Composition concept throughout nested project data", () => {
  const migrated = migrateProjectV9ToV10({
    version: 9,
    compositions: [{
      id: "composition-a",
      name: "Composition 4",
      chain: [{ source: { type: "composition", compositionId: "composition-b" } }],
    }],
    ui: {
      selectedCompositionId: "composition-a",
      live: { compositionOverrides: { "composition-a": { opacity: 0.5 } } },
    },
    render: { compositionTexture: { width: 1280, height: 720 } },
    surfaces: [{ compositionId: "composition-a", sourceNodeId: "composition:composition-a" }],
    scenes: [{ snapshot: { surfaces: [{ compositionId: "composition-a" }] } }],
  });
  assert.equal(Object.hasOwn(migrated, "compositions"), false);
  assert.equal(migrated.components[0].id, "component-a");
  assert.equal(migrated.components[0].name, "Component 4");
  assert.deepEqual(migrated.components[0].chain[0].source, { type: "component", componentId: "component-b" });
  assert.equal(migrated.ui.selectedComponentId, "component-a");
  assert.deepEqual(migrated.ui.live.componentOverrides, { "component-a": { opacity: 0.5 } });
  assert.deepEqual(migrated.render.componentTexture, { width: 1280, height: 720 });
  assert.deepEqual(migrated.surfaces[0], { componentId: "component-a", sourceNodeId: "component:component-a" });
  assert.equal(migrated.scenes[0].snapshot.surfaces[0].componentId, "component-a");
});

test("v10 to v11 removes obsolete surface crops and derived render aliases", () => {
  const legacySurface = { id: "surface-a", sourceRect: { x: 1, y: 2, width: 3, height: 4 } };
  const migrated = migrateProjectV10ToV11({
    version: 10,
    render: {
      outputs: [{ id: "left", name: "Left", width: 1920, height: 1080 }],
      width: 1920,
      height: 1080,
      frameWidth: 1920,
      frameHeight: 1080,
      worldScale: 1.5,
      worldWidth: 2880,
      worldHeight: 1620,
      outputGap: 0,
      componentTexture: { width: 1300, height: 1000 },
      surfaceTexture: { mode: "auto", maxWidth: 1920, maxHeight: 1080 },
      pixelDensity: 1.5,
    },
    surfaces: [legacySurface],
    scenes: [{ snapshot: { surfaces: [legacySurface] } }],
    ui: { live: { sceneSnapshot: { surfaces: [legacySurface] } } },
  });

  assert.deepEqual(migrated.render.outputs, [{ id: "left", name: "Left", width: 1920, height: 1080 }]);
  assert.deepEqual(migrated.render.componentTexture, { width: 1300, height: 1000 });
  assert.equal(migrated.render.pixelDensity, 1.5);
  for (const key of ["width", "height", "frameWidth", "frameHeight", "worldScale", "worldWidth", "worldHeight", "outputGap"]) {
    assert.equal(Object.hasOwn(migrated.render, key), false);
  }
  assert.equal(Object.hasOwn(migrated.surfaces[0], "sourceRect"), false);
  assert.equal(Object.hasOwn(migrated.scenes[0].snapshot.surfaces[0], "sourceRect"), false);
  assert.equal(Object.hasOwn(migrated.ui.live.sceneSnapshot.surfaces[0], "sourceRect"), false);
  assert.equal(Object.hasOwn(legacySurface, "sourceRect"), true, "migration does not mutate source data");

  const legacySizing = migrateProjectV10ToV11({
    version: 10,
    render: { frameWidth: 1280, frameHeight: 720, surfaceWidth: 320, surfaceHeight: 180 },
  });
  assert.deepEqual(legacySizing.render.componentTexture, { width: 320, height: 180 });
  assert.equal(Object.hasOwn(legacySizing.render, "surfaceWidth"), false);
});

test("v11 to v12 freezes Canvas Component footprints as normalized placements", () => {
  const migrated = migrateProjectV11ToV12({
    version: 11,
    render: { componentTexture: { width: 1300, height: 1000 } },
    components: [
      { id: "landscape", type: "chain", frameShape: "landscape" },
      { id: "portrait", type: "chain", frameShape: "portrait" },
      {
        id: "canvas",
        type: "canvas",
        canvas: { width: 4000, height: 2000 },
        chain: [{
          id: "group",
          kind: "group",
          chain: [
            { id: "a", kind: "source", source: { type: "component", componentId: "landscape" } },
            { id: "b", kind: "source", source: { type: "component", componentId: "portrait" } },
          ],
        }],
      },
    ],
  });

  assert.deepEqual(migrated.components[2].chain[0].chain[0].source.placement, {
    width: 1300 / 4000,
    height: 1000 / 2000,
  });
  assert.deepEqual(migrated.components[2].chain[0].chain[1].source.placement, {
    width: 1000 / 4000,
    height: 1300 / 2000,
  });
});

test("v12 to v13 gives Component dimensions authority over one Canvas placement scale", () => {
  const migrated = migrateProjectV12ToV13({
    version: 12,
    components: [{
      id: "canvas",
      type: "canvas",
      chain: [{
        id: "group",
        kind: "group",
        chain: [{
          id: "source",
          kind: "source",
          source: {
            type: "component",
            componentId: "component-a",
            placement: { width: 0.325, height: 0.5 },
          },
        }],
      }],
    }],
  });
  assert.deepEqual(migrated.components[0].chain[0].chain[0].source.placement, { scale: 0.325 });
});

test("v13 to v14 persists independent adaptive sampling defaults", () => {
  const migrated = migrateProjectV13ToV14({
    version: 13,
    render: { pixelDensity: 1 },
  });
  assert.deepEqual(migrated.render.sampling, {
    surfaceOverscan: 1,
    recordingFrameScale: 1,
  });

  const preserved = migrateProjectV13ToV14({
    version: 13,
    render: { sampling: { surfaceOverscan: 0.75, recordingFrameScale: 0.5 } },
  });
  assert.deepEqual(preserved.render.sampling, {
    surfaceOverscan: 0.75,
    recordingFrameScale: 0.5,
  });
});

test("v14 to v15 enables the logical Canvas raster limit", () => {
  const migrated = migrateProjectV14ToV15({
    version: 14,
    render: { sampling: { surfaceOverscan: 0.75, recordingFrameScale: 0.5 } },
  });
  assert.deepEqual(migrated.render.sampling, {
    surfaceOverscan: 0.75,
    recordingFrameScale: 0.5,
    limitCanvasToLogicalSize: true,
  });

  const disabled = migrateProjectV14ToV15({
    version: 14,
    render: { sampling: { limitCanvasToLogicalSize: false } },
  });
  assert.equal(disabled.render.sampling.limitCanvasToLogicalSize, false);
});

test("v15 to v16 removes global projection edge softness", () => {
  const migrated = migrateProjectV15ToV16({
    version: 15,
    render: { pixelDensity: 1, edgeSoftness: 4 },
  });
  assert.deepEqual(migrated.render, { pixelDensity: 1 });
});

test("v16 to v17 adds independent Scene and Live preview resolution defaults", () => {
  const migrated = migrateProjectV16ToV17({
    version: 16,
    ui: { previewQualities: { scene: "low", live: "invalid" } },
  });
  assert.deepEqual(migrated.ui.previewQualities, { scene: "low", live: "auto" });
});

test("v17 to v18 canonicalizes runtime aliases before normalization", () => {
  const migrated = migrateProjectV17ToV18({
    version: 17,
    global: { timeScale: 2 },
    ui: { workspace: "canvas", previewViewport: { zoom: 2 } },
    components: [{
      id: "component-a",
      source: { type: "media", mediaId: "media-a", startTime: 1, endTime: 3 },
      shaderChain: [{ id: "invert", amount: 0.5 }],
    }],
    surfaces: [{ componentId: "component-a" }],
  });
  assert.equal(migrated.global.timeStretch, 1);
  assert.equal(Object.hasOwn(migrated.global, "timeScale"), false);
  assert.equal(migrated.ui.previewViewports.canvas.zoom, 2);
  assert.equal(Object.hasOwn(migrated.ui, "previewViewport"), false);
  assert.deepEqual(migrated.components[0].chain.map((item) => item.kind), ["source", "effect"]);
  assert.equal(migrated.components[0].chain[0].source.start, 1);
  assert.equal(migrated.surfaces[0].sourceNodeId, "component:component-a");
});

test("v18 to v19 removes derived thumbnails from persisted project data", () => {
  const migrated = migrateProjectV18ToV19({
    version: 18,
    components: [
      { id: "component-a", type: "chain", thumbnail: "data:image/webp;base64,AAA=" },
      { id: "canvas-a", type: "canvas", thumbnail: "blob:canvas", canvas: { width: 100, frameThumbnails: { "frame-a": "blob:frame" } } },
    ],
  });
  assert.equal(Object.hasOwn(migrated.components[0], "thumbnail"), false);
  assert.equal(Object.hasOwn(migrated.components[1], "thumbnail"), false);
  assert.equal(Object.hasOwn(migrated.components[1].canvas, "frameThumbnails"), false);
  assert.equal(migrated.components[1].canvas.width, 100);
});

test("migration runner applies every adjacent step in order", () => {
  const calls = [];
  const migrations = new Map();
  for (let version = 5; version < 10; version++) {
    migrations.set(version, (project) => {
      calls.push(`${version}->${version + 1}`);
      return { ...project, steps: [...(project.steps || []), version + 1] };
    });
  }

  const migrated = runProjectMigrations({ version: 5 }, {
    currentVersion: 10,
    migrations,
    defaultVersion: 5,
  });
  assert.deepEqual(calls, ["5->6", "6->7", "7->8", "8->9", "9->10"]);
  assert.deepEqual(migrated.steps, [6, 7, 8, 9, 10]);
  assert.equal(migrated.version, 10);
});

test("migration runner refuses missing steps and projects from the future", () => {
  assert.throws(
    () => runProjectMigrations({ version: 5 }, { currentVersion: 7, migrations: { 5: (project) => project } }),
    (error) => error instanceof ProjectVersionError && error.code === "PROJECT_MIGRATION_MISSING" && error.version === 6
  );
  assert.throws(
    () => migrateProjectData({ version: CURRENT_PROJECT_VERSION + 1 }),
    (error) => error instanceof UnsupportedProjectVersionError && error.code === "PROJECT_VERSION_TOO_NEW"
  );
});
