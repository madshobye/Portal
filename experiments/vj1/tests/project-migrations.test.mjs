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
  migrateProjectV19ToV20,
  migrateProjectV20ToV21,
  migrateProjectV21ToV22,
  migrateProjectV22ToV23,
  migrateProjectV23ToV24,
  migrateProjectV24ToV25,
  migrateProjectV25ToV26,
  migrateProjectV26ToV27,
  migrateProjectV27ToV28,
  migrateProjectV28ToV29,
  migrateProjectV29ToV30,
  migrateProjectV30ToV31,
  migrateProjectV31ToV32,
  migrateProjectV32ToV33,
  migrateProjectV33ToV34,
} from "../js/domain/project-migrations.js";
import { createInitialState, sanitizeState } from "../js/domain/models.js";

test("current state and sanitized legacy state always use the current project version", () => {
  assert.equal(CURRENT_PROJECT_VERSION, 34);
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
  assert.deepEqual(migrated.ui.workspaceSelectionIds, { component: "comp-a", scene: "canvas-a" });
  assert.equal(Object.hasOwn(migrated.ui, "workspaceCompositionIds"), false);
  assert.deepEqual(migrated.ui.catalogSortModes, { component: "recent", scene: "recent", mapping: "recent", media: "recent", source: "recent" });
});

test("v8 to v9 persists independent normalized catalog sort modes", () => {
  const migrated = migrateProjectV8ToV9({
    version: 8,
    ui: { catalogSortModes: { component: "name", canvas: "created", scene: "created" } },
  });
  assert.deepEqual(migrated.ui.catalogSortModes, { component: "name", canvas: "created", scene: "created" });

  const repaired = migrateProjectV8ToV9({
    version: 8,
    ui: { catalogSortModes: { component: "invalid" } },
  });
  assert.deepEqual(repaired.ui.catalogSortModes, { component: "recent", canvas: "recent", scene: "recent" });
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
  assert.equal(Object.hasOwn(migrated.components[0], "source"), false);
  assert.equal(Object.hasOwn(migrated.components[0], "shaderChain"), false);
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

test("v19 to v20 moves Canvas dimensions to one global render setting", () => {
  const migrated = migrateProjectV19ToV20({
    version: 19,
    render: { pixelDensity: 1 },
    components: [
      { id: "component-a", type: "chain" },
      { id: "canvas-a", type: "canvas", canvas: { width: 2560, height: 1440, previewQuality: "low" } },
      { id: "canvas-b", type: "canvas", canvas: { width: 800, height: 800, previewQuality: "full" } },
    ],
  });
  assert.deepEqual(migrated.render.canvasSize, { width: 2560, height: 1440 });
  assert.deepEqual(migrated.components[1].canvas, { previewQuality: "low" });
  assert.deepEqual(migrated.components[2].canvas, { previewQuality: "full" });
});

test("v20 to v21 adds normalized catalog markers", () => {
  const migrated = migrateProjectV20ToV21({
    version: 20,
    components: [{ id: "component-a", catalogMarker: 1 }, { id: "component-b", catalogMarker: 99 }],
    scenes: [{ id: "scene-a", catalogMarker: 2 }],
    media: [{ id: "media-a" }],
  });
  assert.deepEqual(migrated.components.map((item) => item.catalogMarker), [1, 0]);
  assert.deepEqual(migrated.scenes.map((item) => item.catalogMarker), [2]);
  assert.deepEqual(migrated.media.map((item) => item.catalogMarker), [0]);
});

test("v21 to v22 separates hearts from pins while preserving old pins", () => {
  const migrated = migrateProjectV21ToV22({
    version: 21,
    ui: { catalogSortModes: { source: "marker" } },
    components: [{ id: "star", catalogMarker: 1 }, { id: "pin", catalogMarker: 2 }],
    scenes: [{ id: "none", catalogMarker: 0 }],
    media: [{ id: "invalid", catalogMarker: 99 }],
  });
  assert.deepEqual(migrated.components.map((item) => item.catalogMarker), [1, 3]);
  assert.deepEqual(migrated.scenes.map((item) => item.catalogMarker), [0]);
  assert.deepEqual(migrated.media.map((item) => item.catalogMarker), [0]);
  assert.equal(migrated.ui.catalogSortModes.source, "marker");
});

test("v22 to v23 adds empty project-owned node data without changing authored content", () => {
  const input = { version: 22, project: { name: "Legacy show" }, components: [{ id: "component-a" }] };
  const migrated = migrateProjectV22ToV23(input);
  assert.deepEqual(migrated.nodes, {
    formatVersion: 1,
    definitions: [],
    pins: [],
    instances: [],
    groups: [],
    artifacts: [],
    forks: [],
    packages: [],
    packageLock: [],
    migrations: [],
  });
  assert.deepEqual(migrated.project, input.project);
  assert.deepEqual(migrated.components, input.components);
});

test("v23 to v24 makes the persisted node graph authoritative", () => {
  const input = {
    version: 23,
    components: [{ id: "component-a", chain: [{ id: "source-a", kind: "source" }] }],
    nodes: { formatVersion: 1, groups: [{ id: "component-a" }] },
  };
  const migrated = migrateProjectV23ToV24(input);
  assert.equal(migrated.nodes.authority, "node-graph");
  assert.deepEqual(migrated.nodes.groups, input.nodes.groups);
  assert.deepEqual(migrated.components, input.components, "the application compiler performs the one-time chain import");
});

test("v24 to v25 consolidates preview quality and removes persisted pixel geometry", () => {
  const migrated = migrateProjectV24ToV25({
    version: 24,
    ui: { previewQualities: { scene: "full", live: "low" } },
    render: {
      outputs: [{ id: "output-main", name: "Main", width: 1920, height: 1080 }],
      canvasSize: { width: 3840, height: 2160 },
      componentTexture: { width: 960, height: 540 },
    },
    components: [{
      id: "canvas-a",
      type: "canvas",
      previewQuality: "low",
      canvas: { previewQuality: "full" },
      chain: [],
    }],
  });
  assert.equal(migrated.ui.previewQuality, "good");
  assert.equal(Object.hasOwn(migrated.ui, "previewQualities"), false);
  assert.equal(Object.hasOwn(migrated.components[0], "previewQuality"), false);
  assert.equal(Object.hasOwn(migrated.components[0].canvas, "previewQuality"), false);
  assert.deepEqual(migrated.render.outputs[0], { id: "output-main", name: "Main", aspectRatio: 16 / 9 });
  assert.equal(Object.hasOwn(migrated.render, "canvasSize"), false);
  assert.equal(Object.hasOwn(migrated.render, "componentTexture"), false);
});

test("v25 to v26 moves handle-authored rotation onto the oriented boundary", () => {
  const migrated = migrateProjectV25ToV26({
    version: 25,
    components: [
      {
        id: "component-a",
        nodeProjectionSignature: "old",
        chain: [{
          id: "group-a",
          kind: "group",
          transform: { x: 0.1, y: 0.2, scale: 1.5, rotation: 0.4 },
          boundary: { x: 0, y: 0, width: 0.8, height: 0.8 },
          chain: [{ id: "source-a", kind: "source", transform: { rotation: -0.2 } }],
        }],
      },
      // This is the normal v24+ persisted shape: the compatibility chain is
      // omitted because the generated node group is authoritative.
      { id: "component-b", nodeProjectionSignature: "graph-signature" },
    ],
    nodes: { groups: [{
      id: "vj1.component.component-b",
      componentId: "component-b",
      generatedBy: "vj1-component-compiler",
      projectionSignature: "graph-signature",
      nodes: [{
        id: "source-b",
        role: "source",
        configuration: {
          id: "source-b",
          kind: "source",
          transform: { x: 0.2, y: 0.1, scale: 0.75, rotation: -0.3 },
          source: { type: "generator", generatorId: "plasma" },
        },
      }],
      connections: [
        { from: "$in.texture", to: "source-b.texture", type: "texture" },
        { from: "source-b.texture", to: "$out.texture", type: "texture" },
      ],
    }] },
  });
  const group = migrated.components[0].chain[0];
  assert.equal(group.boundary.rotation, 0.4);
  assert.equal(group.transform.rotation, 0);
  assert.equal(group.transform.scale, 1.5);
  assert.equal(group.chain[0].boundary.rotation, -0.2);
  assert.equal(group.chain[0].transform.rotation, 0);
  assert.equal(migrated.components[0].nodeProjectionSignature, "");
  assert.equal(Object.hasOwn(migrated.components[1], "chain"), false);
  assert.equal(migrated.components[1].nodeProjectionSignature, "graph-signature");
  assert.equal(migrated.nodes.groups[0].projectionSignature, "graph-signature");
  assert.equal(migrated.nodes.groups[0].nodes[0].configuration.boundary.rotation, -0.3);
  assert.equal(migrated.nodes.groups[0].nodes[0].configuration.transform.rotation, 0);
  assert.equal(migrated.nodes.groups[0].nodes[0].configuration.source.generatorId, "plasma");
});

test("v26 to v27 canonically separates Scenes, Mappings, and surface calibration", () => {
  const migrated = migrateProjectV26ToV27({
    version: 26,
    components: [{ id: "canvas-a", type: "canvas", canvas: { frames: [] } }],
    recordingFrames: [{ id: "frame-a" }],
    scenes: [{ id: "mapping-a", snapshot: { surfaces: [] } }],
    mappings: { local: { surfaces: [] } },
    render: { canvasAspectRatio: 16 / 9, sampling: { limitCanvasToLogicalSize: false } },
    ui: {
      workspace: "scene",
      selectedSceneId: "mapping-a",
      workspaceSelectionIds: { component: "component-a", canvas: "canvas-a" },
      catalogSortModes: { component: "recent", canvas: "name", scene: "marker" },
      live: { selectedSceneId: "canvas-a" },
    },
  });

  assert.equal(migrated.components[0].type, "scene");
  assert.deepEqual(migrated.components[0].scene, { frames: [] });
  assert.equal(Object.hasOwn(migrated.components[0], "canvas"), false);
  assert.deepEqual(migrated.frames, [{ id: "frame-a" }]);
  assert.equal(migrated.mappings[0].id, "mapping-a");
  assert.deepEqual(migrated.surfaceMappings, { local: { surfaces: [] } });
  assert.equal(migrated.render.sceneAspectRatio, 16 / 9);
  assert.equal(migrated.render.sampling.limitSceneToLogicalSize, false);
  assert.equal(migrated.ui.workspace, "mapping");
  assert.equal(migrated.ui.selectedMappingId, "mapping-a");
  assert.deepEqual(migrated.ui.workspaceSelectionIds, { component: "component-a", scene: "canvas-a" });
  assert.equal(migrated.ui.live.selectedSceneId, "canvas-a");
});

test("v27 to v28 gives each Mapping complete Surface and calibration ownership", () => {
  const migrated = migrateProjectV27ToV28({
    version: 27,
    surfaces: [{ id: "surface-a", name: "Surface A", feather: 0.2, destination: { type: "mapped" } }],
    mappings: [{
      id: "mapping-a",
      name: "Mapping A",
      snapshot: { surfaces: [{ id: "surface-a", frameSlotId: "frame-a", opacity: 0.7 }] },
    }],
    surfaceMappings: { local: { coordinateSpace: "relative", surfaces: [{ id: "surface-a", corners: [] }] } },
    ui: { live: { selectedSceneId: "scene-a", mappingSnapshot: { surfaces: [] } } },
  });

  assert.equal(Object.hasOwn(migrated, "surfaces"), false);
  assert.equal(Object.hasOwn(migrated, "surfaceMappings"), false);
  assert.equal(Object.hasOwn(migrated.mappings[0], "snapshot"), false);
  assert.equal(migrated.mappings[0].surfaces[0].name, "Surface A");
  assert.equal(migrated.mappings[0].surfaces[0].frameSlotId, "frame-a");
  assert.deepEqual(migrated.mappings[0].calibration, {
    coordinateSpace: "relative",
    surfaces: [{ id: "surface-a", corners: [] }],
  });
  assert.equal(Object.hasOwn(migrated.ui.live, "mappingSnapshot"), false);
});

test("v28 to v29 folds Frame placement into Mapping Surfaces", () => {
  const migrated = migrateProjectV28ToV29({
    version: 28,
    frames: [{ id: "frame-a", x: 0.1, y: 0.2, width: 0.3, height: 0.4, keepProportions: false }],
    mappings: [{ id: "mapping-a", surfaces: [{ id: "surface-a", frameSlotId: "frame-a" }] }],
    components: [{ id: "scene-a", type: "scene", scene: {
      frames: [{ frameId: "frame-a", componentId: "component-a" }],
      frameThumbnails: { "frame-a": "thumb-a" },
    } }],
  });
  const surface = migrated.mappings[0].surfaces[0];
  assert.deepEqual(
    { x: surface.x, y: surface.y, width: surface.width, height: surface.height, keepProportions: surface.keepProportions },
    { x: 0.1, y: 0.2, width: 0.3, height: 0.4, keepProportions: false }
  );
  assert.equal(Object.hasOwn(migrated, "frames"), false);
  assert.equal(Object.hasOwn(surface, "frameSlotId"), false);
  assert.deepEqual(migrated.components[0].scene, { surfaceThumbnails: { "surface-a": "thumb-a" } });
});

test("v29 to v30 seals authored Surfaces and discards intermediate runtime routes", () => {
  const migrated = migrateProjectV29ToV30({
    version: 29,
    frames: [{ id: "stale-frame" }],
    surfaces: [{ id: "stale-runtime-surface" }],
    mappings: [{ id: "mapping-a", surfaces: [{
      id: "surface-a", x: 0.2, y: 0.3, width: 0.4, height: 0.5,
      sourceNodeId: "component:scene-a", componentId: "scene-a",
      outputFrameId: "stale-frame", frameSlotId: "stale-frame",
      sceneCrop: true, sourceFit: "cover", sourceFitActive: true, sourceAspect: 2,
    }] }],
    components: [{ id: "scene-a", type: "scene", scene: { frames: [], surfaceThumbnails: {} } }],
    ui: { selectedFrameId: "stale-frame", live: {
      sourceKind: "scene", surfaceRoutes: { surfaces: [] }, transition: { progress: 0.5 },
    } },
  });
  const surface = migrated.mappings[0].surfaces[0];
  assert.deepEqual(
    { id: surface.id, x: surface.x, y: surface.y, width: surface.width, height: surface.height },
    { id: "surface-a", x: 0.2, y: 0.3, width: 0.4, height: 0.5 }
  );
  for (const key of ["sourceNodeId", "componentId", "outputFrameId", "frameSlotId", "sceneCrop", "sourceFitActive"]) {
    assert.equal(Object.hasOwn(surface, key), false, `${key} must not persist`);
  }
  assert.equal(Object.hasOwn(migrated, "frames"), false);
  assert.equal(Object.hasOwn(migrated, "surfaces"), false);
  assert.equal(Object.hasOwn(migrated.ui, "selectedFrameId"), false);
  assert.deepEqual(migrated.ui.live, { showScenes: true, showComponents: false });
});

test("v30 to v31 migrates model media into an editable Scene3d visual Group", () => {
  const migrated = migrateProjectV30ToV31({
    version: 30,
    components: [{
      id: "component-a",
      chain: [{
        id: "model",
        kind: "source",
        name: "",
        source: {
          type: "media",
          mediaId: "media/models/skull.stl",
          speed: 1,
          params: {
            renderMode: "surfaceOutline",
            rotationY: 0.4,
            renderQuality: 0.8,
          },
        },
      }, {
        id: "image",
        kind: "source",
        source: { type: "media", mediaId: "media/still.png" },
      }, {
        id: "nested",
        kind: "group",
        chain: [{
          id: "obj",
          kind: "source",
          source: { type: "media", mediaId: "media/models/shape.obj", params: { wireDetail: 0.7 } },
        }],
      }],
    }],
  });
  const [model, image, nested] = migrated.components[0].chain;
  assert.deepEqual(model.source, {
    type: "generator",
    generatorId: "modelMedia",
    params: {
      renderMode: "surfaceOutline",
      rotationY: 0.4,
      renderQuality: 0.8,
      mediaId: "media/models/skull.stl",
    },
  });
  assert.deepEqual(image.source, { type: "media", mediaId: "media/still.png" });
  assert.equal(nested.chain[0].source.generatorId, "modelMedia");
  assert.equal(nested.chain[0].source.params.mediaId, "media/models/shape.obj");
});

test("v31 to v32 moves every authored effect strength into params exactly once", () => {
  const input = {
    version: 31,
    components: [{
      id: "component-a",
      chain: [{
        id: "effect-a",
        kind: "effect",
        componentId: "ripple",
        amount: 0.2,
        params: { speed: 1.5 },
      }, {
        id: "group-a",
        kind: "group",
        chain: [{
          id: "effect-b",
          kind: "effect",
          componentId: "blur",
          amount: 0.1,
          params: { amount: 0.8 },
        }],
      }],
    }],
    mappings: [{
      id: "mapping-a",
      surfaces: [{
        id: "surface-a",
        finalShaderChain: [{ id: "invert", amount: 0.6 }],
      }],
    }],
    nodes: {
      groups: [{
        id: "vj1.component.component-a",
        nodes: [{
          id: "effect-a",
          role: "effect",
          configuration: {
            id: "effect-a",
            kind: "effect",
            componentId: "ripple",
            amount: 0.2,
            params: { speed: 1.5 },
          },
        }],
      }],
    },
  };

  const migrated = migrateProjectV31ToV32(input);
  const first = migrated.components[0].chain[0];
  const nested = migrated.components[0].chain[1].chain[0];
  const surfacePass = migrated.mappings[0].surfaces[0].finalShaderChain[0];
  const graphConfiguration = migrated.nodes.groups[0].nodes[0].configuration;

  assert.deepEqual(first.params, { speed: 1.5, amount: 0.2 });
  assert.equal(Object.hasOwn(first, "amount"), false);
  assert.equal(nested.params.amount, 0.8, "canonical params win over the mirrored legacy field");
  assert.equal(Object.hasOwn(nested, "amount"), false);
  assert.deepEqual(surfacePass, { id: "invert", params: { amount: 0.6 } });
  assert.deepEqual(graphConfiguration.params, { speed: 1.5, amount: 0.2 });
  assert.equal(Object.hasOwn(graphConfiguration, "amount"), false);
  assert.equal(input.components[0].chain[0].amount, 0.2, "migration does not mutate its input");
});

test("current-schema effect normalization never revives the removed top-level amount", () => {
  const state = sanitizeState({
    version: CURRENT_PROJECT_VERSION,
    components: [{
      id: "component-a",
      type: "chain",
      chain: [{
        id: "effect-a",
        kind: "effect",
        componentId: "ripple",
        amount: 0.9,
        params: {},
      }],
    }],
  });
  const effect = state.components[0].chain[0];
  assert.equal(effect.params.amount, 0.35);
  assert.equal(Object.hasOwn(effect, "amount"), false);
});

test("v32 to v33 persists explicit direct Surface parent edges once", () => {
  const input = {
    version: 32,
    mappings: [{
      id: "mapping-a",
      surfaces: [
        {
          id: "direct-child",
          destination: { type: "direct", outputIds: ["main"] },
        },
        {
          id: "mapped",
          destination: { type: "mapped", mappingId: "mapped" },
        },
        {
          id: "direct-parent",
          destination: { type: "direct", outputIds: ["main", "side"] },
        },
      ],
    }],
  };
  const migrated = migrateProjectV32ToV33(input);
  const [child, mapped, parent] = migrated.mappings[0].surfaces;

  assert.equal(child.destination.parentSurfaceId, "direct-parent");
  assert.equal(parent.destination.parentSurfaceId, "");
  assert.equal(Object.hasOwn(mapped.destination, "parentSurfaceId"), false);
  assert.equal(
    Object.hasOwn(input.mappings[0].surfaces[0].destination, "parentSurfaceId"),
    false,
    "migration does not mutate its input",
  );
});

test("v33 to v34 replaces persisted Frame terminology without aliases", () => {
  const input = {
    version: 33,
    render: {
      sampling: {
        surfaceOverscan: 0.75,
        recordingFrameScale: 1.5,
      },
    },
    nodes: {
      pins: [{ nodeId: "core.composition.scene-frame-guides", version: "0.1.0" }],
      groups: [{
        id: "presentation",
        nodes: [{
          id: "guides",
          nodeId: "core.composition.scene-frame-guides",
        }],
      }],
    },
  };
  const migrated = migrateProjectV33ToV34(input);

  assert.equal(migrated.render.sampling.surfaceDetailScale, 1.5);
  assert.equal(Object.hasOwn(migrated.render.sampling, "recordingFrameScale"), false);
  assert.equal(migrated.nodes.pins[0].nodeId, "core.composition.scene-surface-guides");
  assert.equal(migrated.nodes.groups[0].nodes[0].nodeId, "core.composition.scene-surface-guides");
  assert.equal(input.nodes.pins[0].nodeId, "core.composition.scene-frame-guides");
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
