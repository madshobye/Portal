import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildProjectPayload,
  projectHistorySignature,
  persistedRenderSettings,
} from "../js/services/project-folder-service.js";

test("project payload preserves the selected component chain item", () => {
  const state = {
    version: 5,
    project: {},
    recordingFrames: [{ id: "frame-a", x: 10, y: 20, width: 640, height: 360 }],
    ui: {
      selectedSceneId: "scene-a",
      selectedSurfaceId: "surface-a",
      selectedComponentId: "component-a",
      selectedChainItemId: "chain-effect-b",
      workspaceSelectionIds: { component: "component-a", canvas: "canvas-b" },
      catalogSortModes: { component: "name", scene: "created" },
      previewQualities: { scene: "low", live: "full" },
      live: {
        selectedSceneId: "scene-live",
        sceneSnapshot: { surfaces: [{ id: "surface-a", componentId: "component-a" }] },
        componentOverrides: { "component-a": { opacity: 0.5 } },
        transitionDuration: 2.5,
        paramFadeDuration: 0.75,
        transition: { id: "runtime-only" },
      },
    },
  };

  const payload = buildProjectPayload(state, "2026-07-12T00:00:00.000Z");
  assert.equal(payload.version, 19);
  assert.equal(payload.ui.selectedChainItemId, "chain-effect-b");
  assert.deepEqual(payload.ui.workspaceSelectionIds, state.ui.workspaceSelectionIds);
  assert.deepEqual(payload.ui.catalogSortModes, state.ui.catalogSortModes);
  assert.deepEqual(payload.ui.previewQualities, state.ui.previewQualities);
  assert.equal(payload.ui.live.selectedSceneId, "scene-live");
  assert.deepEqual(payload.ui.live.sceneSnapshot, state.ui.live.sceneSnapshot);
  assert.equal(payload.ui.live.transitionDuration, 2.5);
  assert.equal(payload.ui.live.paramFadeDuration, 0.75);
  assert.equal(payload.ui.live.transition, undefined);
  assert.equal(payload.ui.live.componentOverrides, undefined);
  assert.deepEqual(payload.recordingFrames, state.recordingFrames);
  const source = readFileSync(new URL("../js/services/project-folder-service.js", import.meta.url), "utf8");
  assert.ok(source.includes("selectedChainItemId: projectUi?.selectedChainItemId || currentUi.selectedChainItemId"));
  assert.ok(source.includes("workspaceSelectionIds: projectUi?.workspaceSelectionIds || currentUi.workspaceSelectionIds"));
  assert.ok(source.includes("catalogSortModes: projectUi?.catalogSortModes || currentUi.catalogSortModes"));
  assert.ok(source.includes("previewQualities: projectUi?.previewQualities || currentUi.previewQualities"));
  assert.ok(!source.includes("legacyRecordingFrames"));
  assert.ok(source.includes("data = migrateProjectData(data)"));
  assert.ok(source.includes("projectLoadBlocked = true"));
  assert.ok(source.includes("if (projectLoadBlocked) return false"));
});

test("Live scene selection is autosaved so reload restores user truth", () => {
  const source = readFileSync(new URL("../js/services/project-folder-service.js", import.meta.url), "utf8");
  const skipBlock = source.match(/const skipAutosaveReasons = new Set\(\[([\s\S]*?)\]\);/)?.[1] || "";

  assert.doesNotMatch(skipBlock, /"live:scene"/);
  assert.match(skipBlock, /"live:update"/);
  assert.match(source, /const delay = immediate \|\| reason === "live:scene" \|\| event\.history === "record" \? 0 : autosaveDelayMs;/);
});

test("project payload persists canonical render settings without derived geometry aliases", () => {
  const render = {
    outputs: [{ id: "main", width: 1920, height: 1080 }],
    componentTexture: { width: 1300, height: 1000 },
    surfaceTexture: { mode: "auto", maxWidth: 1920, maxHeight: 1080 },
    pixelDensity: 1.5,
    width: 1920,
    height: 1080,
    frameWidth: 1920,
    frameHeight: 1080,
    worldScale: 1.5,
    worldWidth: 2880,
    worldHeight: 1620,
    outputGap: 0,
  };
  const persisted = persistedRenderSettings(render);
  assert.deepEqual(persisted.outputs, render.outputs);
  assert.deepEqual(persisted.componentTexture, render.componentTexture);
  assert.equal(persisted.pixelDensity, 1.5);
  for (const key of ["width", "height", "frameWidth", "frameHeight", "worldScale", "worldWidth", "worldHeight", "outputGap"]) {
    assert.equal(Object.hasOwn(persisted, key), false);
  }
});

test("folder permission prompt does not discard a project recovered from output", () => {
  const source = readFileSync(new URL("../js/services/project-folder-service.js", import.meta.url), "utf8");

  assert.ok(source.includes("const recoveredFromOutput = !!draft.project.folderName"));
  assert.ok(source.includes("if (!recoveredFromOutput)"));
});

test("media import publishes known files without rescanning or replacing live project state", () => {
  const source = readFileSync(new URL("../js/services/project-folder-service.js", import.meta.url), "utf8");
  const importExternalFiles = source.slice(
    source.indexOf("  async function importExternalFiles"),
    source.indexOf("\n  async function closeProject", source.indexOf("  async function importExternalFiles"))
  );

  assert.ok(importExternalFiles.includes("mediaLibrary.importFiles(storedFiles)"));
  assert.ok(importExternalFiles.includes("mergeObservedAssets(result)"));
  assert.doesNotMatch(importExternalFiles, /refreshFolder\(/);
  assert.doesNotMatch(importExternalFiles, /loadDirectory\(/);
});

test("project history signature ignores UI-only save noise", () => {
  const base = {
    version: 5,
    project: { name: "Show", savedAt: "2026-07-11T10:00:00.000Z", warnings: ["temporary"] },
    ui: {
      selectedSceneId: "scene-a",
      selectedSurfaceId: "surface-a",
      selectedComponentId: "component-a",
    },
    global: { showLabels: true },
    render: { frameWidth: 1280, frameHeight: 720 },
    scheduler: {},
    media: [],
    components: [{ id: "component-a", name: "A" }],
    surfaces: [],
    scenes: [],
    mappings: {},
    shaders: {},
  };
  const selectedOnly = {
    ...base,
    project: { ...base.project, savedAt: "2026-07-11T10:05:00.000Z", warnings: [] },
    ui: {
      selectedSceneId: "scene-b",
      selectedSurfaceId: "surface-b",
      selectedComponentId: "component-b",
    },
  };
  const material = {
    ...selectedOnly,
    components: [{ id: "component-a", name: "Renamed" }],
  };

  assert.equal(projectHistorySignature(base), projectHistorySignature(selectedOnly));
  assert.notEqual(projectHistorySignature(base), projectHistorySignature(material));
});

test("project payload and undo signature exclude derived thumbnails and activity", () => {
  const state = {
    version: 19,
    project: {}, ui: {}, global: { calibrating: true }, render: {}, scheduler: {}, media: [], recordingFrames: [], surfaces: [], scenes: [], mappings: {}, shaders: {},
    components: [{
      id: "canvas-a",
      type: "canvas",
      thumbnail: "data:image/webp;base64,AAA=",
      activity: { updatedAt: "later" },
      canvas: { width: 100, frameThumbnails: { frame: "blob:frame" } },
    }],
  };
  const payload = buildProjectPayload(state, "2026-07-18T00:00:00.000Z");
  assert.equal(Object.hasOwn(payload.components[0], "thumbnail"), false);
  assert.equal(Object.hasOwn(payload.components[0].canvas, "frameThumbnails"), false);
  const changedDerived = structuredClone(payload);
  changedDerived.components[0].activity.updatedAt = "newest";
  changedDerived.global.calibrating = false;
  assert.equal(projectHistorySignature(payload), projectHistorySignature(changedDerived));
});

test("project folder service creates only functional asset/cache folders and can close the active project", () => {
  const source = readFileSync(new URL("../js/services/project-folder-service.js", import.meta.url), "utf8");

  assert.ok(source.includes("ensureProjectScaffold(dirHandle)"));
  for (const folder of ['"media"', '"shaders"', 'RENDITION_ROOT']) {
    assert.ok(source.includes(folder), `missing scaffold folder ${folder}`);
  }
  assert.doesNotMatch(source, /\["media", "shaders", "scenes", "mappings"/);
  assert.ok(source.includes("async function closeProject()"));
  assert.ok(source.includes("store.replace(createInitialState(), \"project-close\")"));
  assert.ok(source.includes("clearProjectDirectoryHandle"));
});

test("undo history is bounded and ordinary saves use the session index", () => {
  const source = readFileSync(new URL("../js/services/project-folder-service.js", import.meta.url), "utf8");
  const refresh = source.slice(source.indexOf("  async function refreshHistoryState"), source.indexOf("\n  function setHistoryState", source.indexOf("  async function refreshHistoryState")));
  assert.match(source, /const maxRevisionEntries = 500;/);
  assert.match(source, /const maxRevisionBytes = 512 \* 1024 \* 1024;/);
  assert.match(source, /revisionIndex\.undo\.push/);
  assert.match(source, /revisionIndex\.redo\.push/);
  assert.doesNotMatch(refresh, /\.values\(\)|getFile\(/);
  assert.ok(!source.includes("[VJ1_HISTORY_PRUNED]"), "routine rolling-cap pruning stays out of the runtime console");
});

test("completed project transactions enter a serialized immutable save queue", () => {
  const source = readFileSync(new URL("../js/services/project-folder-service.js", import.meta.url), "utf8");
  assert.match(source, /event\.history === "record" \? 0 : autosaveDelayMs/);
  assert.match(source, /saveQueue\.push\(\{ reason: saveReason, recordHistory, payload: JSON\.parse\(json\), json \}\)/);
  assert.match(source, /while \(saveQueue\.length\)/);
  assert.match(source, /if \(saveInFlight\) return saveDrainPromise/);
});

test("undo and redo reload project state without rescanning assets", () => {
  const source = readFileSync(new URL("../js/services/project-folder-service.js", import.meta.url), "utf8");
  const reload = source.slice(source.indexOf("  async function reloadProjectFromDisk"), source.indexOf("\n  async function refreshHistoryState", source.indexOf("  async function reloadProjectFromDisk")));
  assert.doesNotMatch(reload, /collectProjectAssetFiles|mediaLibrary\.clear|sendMediaFiles/);
  assert.match(reload, /store\.getState\(\)\.media/);
});

test("rendition cache uses a bounded manifest instead of directory enumeration", () => {
  const source = readFileSync(new URL("../js/services/project-folder-service.js", import.meta.url), "utf8");
  const loadIndex = source.slice(source.indexOf("  async function loadIndexedRenditions"), source.indexOf("\n  async function indexRendition", source.indexOf("  async function loadIndexedRenditions")));
  assert.match(source, /const maxIndexedRenditions = 1000;/);
  assert.match(loadIndex, /getFileHandle\(renditionIndexFilename\)/);
  assert.doesNotMatch(loadIndex, /\.entries\(\)|\.values\(\)/);
});
