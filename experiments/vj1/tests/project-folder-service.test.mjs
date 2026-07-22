import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildProjectPayload,
  COLD_BACKUP_INTERVAL,
  COLD_BACKUP_ROOT,
  nextColdBackupRevision,
  projectHistorySignature,
  persistedRenderSettings,
} from "../js/services/project-folder-service.js";

test("project payload preserves the selected component chain item", () => {
  const state = {
    version: 28,
    project: {},
    frames: [{ id: "frame-a", x: 10, y: 20, width: 640, height: 360 }],
    ui: {
      selectedMappingId: "mapping-a",
      selectedSurfaceId: "surface-a",
      selectedComponentId: "component-a",
      selectedChainItemId: "chain-effect-b",
      workspaceSelectionIds: { component: "component-a", scene: "scene-b" },
      catalogSortModes: { component: "name", scene: "created", mapping: "recent" },
      previewQuality: "good",
      previewDiagnostics: true,
      previewViewports: {
        component: { fit: "manual", zoom: 1.5, x: 20, y: -10 },
        live: { fit: "world", zoom: 1, x: 0, y: 0 },
      },
      live: {
        selectedSceneId: "scene-live",
        showScenes: false,
        showComponents: true,
        surfaceRoutes: { surfaces: [{ id: "surface-a", componentId: "component-a" }] },
        componentOverrides: { "component-a": { opacity: 0.5 } },
        transitionDuration: 2.5,
        paramFadeDuration: 0.75,
        transition: { id: "runtime-only" },
      },
    },
  };

  const payload = buildProjectPayload(state, "2026-07-12T00:00:00.000Z");
  assert.equal(payload.version, 28);
  assert.deepEqual(payload.nodes, {
    formatVersion: 1,
    authority: "component-import",
    definitions: [],
    pins: [],
    instances: [],
    groups: [],
    artifacts: [],
    forks: [],
    migrations: [],
  });
  assert.equal(payload.ui.selectedChainItemId, "chain-effect-b");
  assert.deepEqual(payload.ui.workspaceSelectionIds, state.ui.workspaceSelectionIds);
  assert.deepEqual(payload.ui.catalogSortModes, state.ui.catalogSortModes);
  assert.equal(payload.ui.previewQuality, state.ui.previewQuality);
  assert.equal(payload.ui.previewDiagnostics, true);
  assert.deepEqual(payload.ui.previewViewports, state.ui.previewViewports);
  assert.equal(payload.ui.live.selectedSceneId, "scene-live");
  assert.equal(payload.ui.live.showScenes, false);
  assert.equal(payload.ui.live.showComponents, true);
  assert.equal(payload.ui.live.surfaceRoutes, undefined);
  assert.equal(payload.ui.live.transitionDuration, 2.5);
  assert.equal(payload.ui.live.paramFadeDuration, 0.75);
  assert.equal(payload.ui.live.transition, undefined);
  assert.equal(payload.ui.live.componentOverrides, undefined);
  assert.deepEqual(payload.frames, state.frames);
  assert.equal(payload.surfaces, undefined);
  assert.equal(payload.mappingCalibration, undefined);
  const source = readFileSync(new URL("../js/services/project-folder-service.js", import.meta.url), "utf8");
  assert.ok(source.includes("selectedChainItemId: projectUi?.selectedChainItemId || currentUi.selectedChainItemId"));
  assert.ok(source.includes("workspaceSelectionIds: projectUi?.workspaceSelectionIds || currentUi.workspaceSelectionIds"));
  assert.ok(source.includes("catalogSortModes: projectUi?.catalogSortModes || currentUi.catalogSortModes"));
  assert.ok(source.includes("preserveMediaCatalog && Array.isArray(projectData.media)"));
  assert.ok(source.includes(": mergeMediaCatalogMarkers(imported.media, projectData.media)"));
  assert.ok(source.includes("draft.media = mergeMediaCatalogMarkers(imported.media, draft.media)"));
  assert.ok(source.includes("previewQuality: projectUi?.previewQuality || currentUi.previewQuality"));
  assert.ok(source.includes("previewViewports: projectUi?.previewViewports || currentUi.previewViewports"));
  assert.ok(source.includes("previewDiagnostics: projectUi?.previewDiagnostics ?? currentUi.previewDiagnostics"));
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

test("UI-only selection waits for an authored save or browser lifecycle checkpoint", () => {
  const source = readFileSync(new URL("../js/services/project-folder-service.js", import.meta.url), "utf8");

  assert.match(source, /const autosaveDelayMs = 5000;/);
  assert.match(source, /event\.scope === "ui" && !immediate && !previewViewportCheckpoint/);
  assert.match(source, /addEventListener\?\.\("visibilitychange"/);
  assert.match(source, /visibilityState === "hidden"/);
  assert.match(source, /addEventListener\?\.\("pagehide"/);
  assert.match(source, /addEventListener\?\.\("beforeunload"/);
  assert.match(source, /function flushPendingAutoSave\(reason\)[\s\S]*?void flushAutoSave\(reason\)/);
});

test("preview viewport navigation receives one quiet checkpoint instead of relying on unload", () => {
  const source = readFileSync(new URL("../js/services/project-folder-service.js", import.meta.url), "utf8");
  assert.match(source, /const previewViewportCheckpoint = event\.scope === "ui" && reason\.startsWith\("preview-"\);/);
  assert.match(source, /event\.scope === "ui" && !immediate && !previewViewportCheckpoint/);
});

test("project payload persists canonical render settings without derived geometry aliases", () => {
  const render = {
    outputs: [{ id: "main", width: 1920, height: 1080 }],
    canvasSize: { width: 3840, height: 2160 },
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
    previewRasterScale: 2,
    previewViewportZoom: 1.25,
  };
  const persisted = persistedRenderSettings(render);
  assert.deepEqual(persisted.outputs, [{ id: "main", name: "Main output", aspectRatio: 16 / 9 }]);
  assert.equal(Object.hasOwn(persisted, "componentTexture"), false);
  assert.equal(Object.hasOwn(persisted, "canvasSize"), false);
  assert.equal(Object.hasOwn(persisted, "previewRasterScale"), false);
  assert.equal(Object.hasOwn(persisted, "previewViewportZoom"), false);
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

test("an aborted experimental file observer falls back silently for the tab session", () => {
  const source = readFileSync(new URL("../js/services/project-folder-service.js", import.meta.url), "utf8");

  assert.match(source, /if \(fileObserverAbortedForSession\(dirHandle\)\) return;/);
  assert.match(source, /if \(isFileObserverAbort\(error\)\) \{[\s\S]*rememberFileObserverAbort\(handle\);[\s\S]*return;/);
  assert.match(source, /clearFileObserverAbort\(selectedHandle\)/);
});

test("project structure and cached thumbnails load before the media-library traversal", () => {
  const source = readFileSync(new URL("../js/services/project-folder-service.js", import.meta.url), "utf8");
  const loadDirectory = source.slice(
    source.indexOf("  async function loadDirectory"),
    source.indexOf("\n  async function loadProject", source.indexOf("  async function loadDirectory"))
  );

  assert.ok(loadDirectory.indexOf("await loadProject") < loadDirectory.indexOf("collectProjectAssetFiles"));
  assert.ok(loadDirectory.includes("preserveMediaCatalog: true"));
  assert.ok(loadDirectory.indexOf("collectProjectAssetFiles") < loadDirectory.indexOf("mediaLibrary.importFiles"));
  assert.ok(loadDirectory.indexOf("mediaLibrary.importFiles") < loadDirectory.indexOf("refreshProjectAssets"));

  const loadProject = source.slice(
    source.indexOf("  async function loadProject"),
    source.indexOf("\n  function blockProjectLoad", source.indexOf("  async function loadProject"))
  );
  assert.ok(loadProject.indexOf("store.replace(nextState, reason)") < loadProject.indexOf("derivedAssets.loadComponentThumbnails"));
  assert.match(loadProject, /void derivedAssets\.loadComponentThumbnails/);
  assert.match(loadProject, /project-thumbnail-cache-batch/);
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

test("project load restores the Mapping test-pattern preference and selected Frame", () => {
  const source = readFileSync(new URL("../js/services/project-folder-service.js", import.meta.url), "utf8");
  assert.match(source, /selectedFrameId: projectUi\?\.selectedFrameId \|\| currentUi\.selectedFrameId/);
  assert.match(source, /mappingTestPattern: projectUi\?\.mappingTestPattern \?\? currentUi\.mappingTestPattern/);
});

test("project payload and undo signature exclude derived thumbnails and activity", () => {
  const state = {
    version: 28,
    project: {}, ui: {}, global: { calibrating: true }, render: {}, scheduler: {}, media: [], frames: [], mappings: [], shaders: {},
    components: [{
      id: "scene-a",
      type: "scene",
      thumbnail: "data:image/webp;base64,AAA=",
      activity: { updatedAt: "later" },
      scene: { width: 100, height: 50, frameThumbnails: { frame: "blob:frame" } },
    }],
  };
  const payload = buildProjectPayload(state, "2026-07-18T00:00:00.000Z");
  assert.equal(Object.hasOwn(payload.components[0], "thumbnail"), false);
  assert.equal(Object.hasOwn(payload.components[0].scene, "frameThumbnails"), false);
  assert.equal(Object.hasOwn(payload.components[0].scene, "width"), false);
  assert.equal(Object.hasOwn(payload.components[0].scene, "height"), false);
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
  const source = readFileSync(new URL("../js/services/project-history-store.js", import.meta.url), "utf8");
  const refresh = source.slice(source.indexOf("  async function refreshState"), source.indexOf("\n  async function writeRevision", source.indexOf("  async function refreshState")));
  assert.match(source, /DEFAULT_MAX_REVISION_ENTRIES = 500;/);
  assert.match(source, /DEFAULT_MAX_REVISION_BYTES = 512 \* 1024 \* 1024;/);
  assert.match(source, /revisionIndex\.undo\.push/);
  assert.match(source, /revisionIndex\.redo\.push/);
  assert.doesNotMatch(refresh, /\.values\(\)|getFile\(/);
  assert.ok(!source.includes("[VJ1_HISTORY_PRUNED]"), "routine rolling-cap pruning stays out of the runtime console");
});

test("every 500 committed revisions creates a scan-excluded cold project backup", () => {
  const source = readFileSync(new URL("../js/services/project-folder-service.js", import.meta.url), "utf8");
  const historySource = readFileSync(new URL("../js/services/project-history-store.js", import.meta.url), "utf8");
  const mediaLibrarySource = readFileSync(new URL("../js/services/media-library-service.js", import.meta.url), "utf8");

  assert.equal(COLD_BACKUP_ROOT, "backups");
  assert.equal(COLD_BACKUP_INTERVAL, 500);
  assert.deepEqual(nextColdBackupRevision(498), { revision: 499, shouldBackup: false });
  assert.deepEqual(nextColdBackupRevision(499), { revision: 500, shouldBackup: true });
  assert.deepEqual(nextColdBackupRevision(999), { revision: 1000, shouldBackup: true });
  assert.match(historySource, /project-backup-\$\{String\(checkpoint\.revision\)\.padStart\(9, "0"\)\}/);
  assert.match(source, /root === "revisions" \|\| root === COLD_BACKUP_ROOT \|\| root === RENDITION_ROOT/);
  assert.match(mediaLibrarySource, /if \(root && !\["media", "shaders"\]\.includes\(name\)\) continue;/);
});

test("completed project transactions enter a serialized immutable save queue", () => {
  const source = readFileSync(new URL("../js/services/project-folder-service.js", import.meta.url), "utf8");
  const engine = readFileSync(new URL("../js/libraries/storage-engine/serialized-storage/index.js", import.meta.url), "utf8");
  assert.match(source, /event\.history === "record" \? 0 : autosaveDelayMs/);
  assert.match(source, /saveQueue\.enqueue\(\{ reason: saveReason, recordHistory, payload, json \}\)/);
  assert.doesNotMatch(source, /payload: JSON\.parse\(json\)/);
  assert.match(engine, /while \(this\.pending\.length\)/);
  assert.match(engine, /this\.pending\.unshift\(task\)/);
});

test("undo and redo reload project state without rescanning assets", () => {
  const source = readFileSync(new URL("../js/services/project-folder-service.js", import.meta.url), "utf8");
  const reload = source.slice(source.indexOf("  async function reloadProjectFromDisk"), source.indexOf("\n  async function refreshHistoryState", source.indexOf("  async function reloadProjectFromDisk")));
  assert.doesNotMatch(reload, /collectProjectAssetFiles|mediaLibrary\.clear|sendMediaFiles/);
  assert.match(reload, /store\.getState\(\)\.media/);
});

test("rendition cache uses a bounded manifest instead of directory enumeration", () => {
  const source = readFileSync(new URL("../js/services/project-derived-asset-store.js", import.meta.url), "utf8");
  const loadIndex = source.slice(source.indexOf("  async loadIndexedRenditions"), source.indexOf("\n  async indexRendition", source.indexOf("  async loadIndexedRenditions")));
  assert.match(source, /maxIndexedRenditions = 1000/);
  assert.match(loadIndex, /getFileHandle\(this\.renditionIndexFilename\)/);
  assert.doesNotMatch(loadIndex, /\.entries\(\)|\.values\(\)/);
});
