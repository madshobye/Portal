import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildProjectPayload,
  COLD_BACKUP_INTERVAL,
  COLD_BACKUP_ROOT,
  createProjectFolderService,
  loadedProjectPersistenceSignature,
  nextColdBackupRevision,
  projectFileForSave,
  projectHistorySignature,
  readProjectFile,
  persistedRenderSettings,
  restoreProjectLiveUi,
} from "../js/services/project-folder-service.js";
import {
  createProjectSavePreparer,
  inspectProjectTextForSave,
  prepareProjectSave,
} from "../js/services/project-save-preparation.js";
import { CURRENT_PROJECT_VERSION } from "../js/domain/project-migrations.js";
import { createAppState } from "../js/app-state.js";
import { createVj1NodePackage } from "../js/app-node-package.js";
import { createDefaultComponent, createInitialState } from "../js/domain/models.js";
import { createMediaLibrary } from "../js/services/media-library-service.js";

test("project lookup distinguishes a missing project from an unreadable existing project", async () => {
  const existingHandle = {
    async getFile() {
      return { async text() { return '{"version":31,"project":{"name":"Existing"}}'; } };
    },
  };
  const existingDirectory = {
    async getFileHandle(name, options = {}) {
      assert.equal(name, "project.json");
      assert.equal(options.create, undefined);
      return existingHandle;
    },
  };
  assert.deepEqual(await readProjectFile(existingDirectory), {
    found: true,
    data: { version: 31, project: { name: "Existing" } },
  });

  let createCalls = 0;
  const missingDirectory = {
    async getFileHandle(_name, options = {}) {
      if (!options.create) throw domNamedError("NotFoundError", "missing");
      createCalls += 1;
      return existingHandle;
    },
  };
  assert.deepEqual(await readProjectFile(missingDirectory), { found: false, data: {} });
  const created = await projectFileForSave(missingDirectory);
  assert.equal(created.created, true);
  assert.equal(created.previousText, "");
  assert.equal(createCalls, 1);

  let unsafeCreateCalls = 0;
  const unreadableDirectory = {
    async getFileHandle(_name, options = {}) {
      if (options.create) unsafeCreateCalls += 1;
      throw domNamedError("NotAllowedError", "permission changed");
    },
  };
  await assert.rejects(() => readProjectFile(unreadableDirectory), /permission changed/);
  await assert.rejects(() => projectFileForSave(unreadableDirectory), /permission changed/);
  assert.equal(unsafeCreateCalls, 0, "an unreadable project must never enter the create-and-overwrite path");

  const invalidDirectory = {
    async getFileHandle() {
      return {
        async getFile() {
          return { async text() { return "{invalid"; } };
        },
      };
    },
  };
  await assert.rejects(() => readProjectFile(invalidDirectory), SyntaxError);
});

function domNamedError(name, message) {
  const error = new Error(message);
  error.name = name;
  return error;
}

test("project payload preserves the selected component chain item", () => {
  const state = {
    version: CURRENT_PROJECT_VERSION,
    project: {},
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
        sceneMappingInLive: false,
        sceneMappingVisible: false,
        showScenes: false,
        showComponents: true,
        surfaceRoutes: { surfaces: [{ id: "surface-a", componentId: "component-a" }] },
        componentOverrides: { "component-a": { opacity: 0.5 } },
        transitionId: "org.vj1.transition.soft-wipe",
        transitionParameters: { softness: 0.25 },
        transitionDuration: 2.5,
        paramFadeDuration: 0.75,
        transition: { id: "runtime-only" },
      },
    },
  };

  const payload = buildProjectPayload(state, "2026-07-12T00:00:00.000Z");
  assert.equal(payload.version, CURRENT_PROJECT_VERSION);
  assert.deepEqual(payload.nodes, {
    formatVersion: 1,
    authority: "component-import",
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
  assert.equal(payload.ui.selectedChainItemId, "chain-effect-b");
  assert.deepEqual(payload.ui.workspaceSelectionIds, state.ui.workspaceSelectionIds);
  assert.deepEqual(payload.ui.catalogSortModes, state.ui.catalogSortModes);
  assert.equal(payload.ui.previewQuality, state.ui.previewQuality);
  assert.equal(payload.ui.previewDiagnostics, true);
  assert.deepEqual(payload.ui.previewViewports, state.ui.previewViewports);
  assert.equal(payload.ui.live.selectedSceneId, "scene-live");
  assert.equal(payload.ui.live.sceneMappingInLive, false);
  assert.equal(payload.ui.live.sceneMappingVisible, undefined, "on-air visibility remains transient Live state");
  assert.equal(payload.ui.live.showScenes, false);
  assert.equal(payload.ui.live.showComponents, true);
  assert.equal(payload.ui.live.transitionId, "org.vj1.transition.soft-wipe");
  assert.deepEqual(payload.ui.live.transitionParameters, { softness: 0.25 });
  assert.equal(payload.ui.live.surfaceRoutes, undefined);
  assert.equal(payload.ui.live.transitionDuration, 2.5);
  assert.equal(payload.ui.live.paramFadeDuration, 0.75);
  assert.equal(payload.ui.live.transition, undefined);
  assert.equal(payload.ui.live.componentOverrides, undefined);
  assert.equal(payload.frames, undefined);
  assert.equal(payload.surfaces, undefined);
  assert.equal(payload.mappingCalibration, undefined);
  const source = readFileSync(new URL("../js/services/project-folder-service.js", import.meta.url), "utf8");
  assert.ok(source.includes("selectedChainItemId: restoredProjectUi?.selectedChainItemId || currentUi.selectedChainItemId"));
  assert.ok(source.includes("workspaceSelectionIds: restoredProjectUi?.workspaceSelectionIds || currentUi.workspaceSelectionIds"));
  assert.ok(source.includes("catalogSortModes: restoredProjectUi?.catalogSortModes || currentUi.catalogSortModes"));
  assert.ok(source.includes("preserveMediaCatalog && Array.isArray(projectData.media)"));
  assert.ok(source.includes(": mergeMediaCatalogMarkers(imported.media, projectData.media)"));
  assert.ok(source.includes("draft.media = mergeMediaCatalogMarkers(imported.media, draft.media)"));
  assert.match(source, /reason: "project-refresh-assets",[\s\S]*?scope: "assets",[\s\S]*?projection: \{ kind: "asset-catalog" \}/);
  assert.ok(source.includes("previewQuality: restoredProjectUi?.previewQuality || currentUi.previewQuality"));
  assert.ok(source.includes("previewViewports: restoredProjectUi?.previewViewports || currentUi.previewViewports"));
  assert.ok(source.includes("previewDiagnostics: restoredProjectUi?.previewDiagnostics ?? currentUi.previewDiagnostics"));
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

test("project restore resets transient Scene Mapping visibility to Mapping's persisted default", () => {
  const disabled = restoreProjectLiveUi(
    { sceneMappingInLive: true, sceneMappingVisible: true },
    { sceneMappingInLive: false },
  );
  const enabled = restoreProjectLiveUi(
    { sceneMappingInLive: false, sceneMappingVisible: false },
    { sceneMappingInLive: true, sceneMappingVisible: false },
  );

  assert.equal(Object.hasOwn(disabled, "sceneMappingVisible"), false);
  assert.equal(Object.hasOwn(enabled, "sceneMappingVisible"), false);
  assert.equal(disabled.sceneMappingInLive, false);
  assert.equal(enabled.sceneMappingInLive, true);
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
  assert.deepEqual(persisted.outputs, [{ id: "main", name: "Output 1", aspectRatio: 16 / 9 }]);
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
  assert.match(loadDirectory, /collectProjectAssetFiles\(dirHandle,\s*\{[\s\S]*onBatch:/);
  assert.ok(loadDirectory.indexOf("mediaLibrary.importFiles(batch)") < loadDirectory.indexOf("refreshProjectAssets"));
  assert.ok(
    loadDirectory.indexOf("bridge.sendMediaFiles(mediaLibrary.getAllFiles())") <
      loadDirectory.indexOf("derivedAssets.loadIndexedRenditions"),
    "primary media is published before derived rendition cache loading",
  );
  assert.match(
    loadDirectory,
    /bridge\.sendMediaFiles\(mediaLibrary\.getAllFiles\(\)\)[\s\S]*refreshProjectAssets/,
    "complete cumulative media snapshots publish while discovery is still in progress",
  );
  assert.match(
    loadDirectory,
    /preserveRecoveredResources[\s\S]*recoveredFolderName === String\(dirHandle\?\.name \|\| ""\)/,
    "same-project resources recovered from Output survive until folder discovery reconciles them",
  );
  assert.match(
    loadDirectory,
    /mediaLibrary\.replaceFiles\(\[\.\.\.files, \.\.\.renditionFiles\]\)/,
    "completed discovery atomically reconciles the authoritative folder snapshot",
  );

  const loadProject = source.slice(
    source.indexOf("  async function loadProject"),
    source.indexOf("\n  function blockProjectLoad", source.indexOf("  async function loadProject"))
  );
  assert.ok(loadProject.indexOf("store.replace(nextState, reason)") < loadProject.indexOf("derivedAssets.loadComponentThumbnails"));
  assert.match(loadProject, /void derivedAssets\.loadComponentThumbnails/);
  assert.match(loadProject, /project-thumbnail-cache-batch/);
  assert.match(loadProject, /kind: "component-thumbnails"/);
  assert.match(loadProject, /entries: entries\.map/);

  const refreshFolder = source.slice(
    source.indexOf("  async function refreshFolder"),
    source.indexOf("\n  async function loadDirectory", source.indexOf("  async function refreshFolder")),
  );
  assert.match(refreshFolder, /mediaLibrary\.replaceFiles/);
  assert.doesNotMatch(
    refreshFolder,
    /mediaLibrary\.clear/,
    "refresh never publishes an empty resource set between two valid folder snapshots",
  );
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

test("project load restores the Mapping test-pattern preference and selected Surface", () => {
  const source = readFileSync(new URL("../js/services/project-folder-service.js", import.meta.url), "utf8");
  assert.match(source, /selectedSurfaceId: restoredProjectUi\?\.selectedSurfaceId \|\| currentUi\.selectedSurfaceId/);
  assert.match(source, /mappingTestPattern: restoredProjectUi\?\.mappingTestPattern \?\? currentUi\.mappingTestPattern/);
  assert.match(source, /const restoredProjectUi = preserveEditorUi \? \{\} : projectUi/);
});

test("project payload and undo signature exclude derived thumbnails and activity", () => {
  const state = {
    version: CURRENT_PROJECT_VERSION,
    project: {}, ui: {}, global: { calibrating: true }, render: {}, scheduler: {}, media: [], mappings: [], shaders: {},
    components: [{
      id: "scene-a",
      type: "scene",
      thumbnail: "data:image/webp;base64,AAA=",
      activity: { updatedAt: "later" },
      scene: { width: 100, height: 50, surfaceThumbnails: { surface: "blob:surface" } },
    }],
  };
  const payload = buildProjectPayload(state, "2026-07-18T00:00:00.000Z");
  assert.equal(Object.hasOwn(payload.components[0], "thumbnail"), false);
  assert.equal(Object.hasOwn(payload.components[0].scene, "surfaceThumbnails"), false);
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
  const application = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  assert.match(source, /event\.history === "record" \? 0 : autosaveDelayMs/);
  assert.match(source, /const prepared = savePreparer\.prepareState\(state, new Date\(\)\.toISOString\(\)\)/);
  assert.match(source, /saveQueue\.enqueue\(\{ reason: saveReason, recordHistory, prepared \}\)/);
  assert.match(application, /scheduleAutoSave\(change, \{ state \}\)/);
  assert.doesNotMatch(source, /VJ1_AUTOSAVE_PREPARE_SLOW/);
  assert.match(engine, /while \(this\.pending\.length\)/);
  assert.match(engine, /this\.pending\.unshift\(task\)/);
});

test("project save preparation produces exact JSON and stable save/history identities", () => {
  const state = {
    project: { name: "Worker test", warnings: ["runtime warning"] },
    ui: { selectedComponentId: "a", live: {} },
    global: {},
    render: { outputs: [] },
    scheduler: {},
    nodes: {},
    media: [],
    components: [],
    mappings: [],
    shaders: {},
  };
  const first = prepareProjectSave(state, "2026-07-23T10:00:00.000Z");
  const later = prepareProjectSave({
    ...state,
    ui: { ...state.ui, selectedComponentId: "b" },
  }, "2026-07-23T10:01:00.000Z");
  assert.deepEqual(
    JSON.parse(first.json),
    JSON.parse(JSON.stringify(buildProjectPayload(state, first.savedAt))),
  );
  assert.equal(first.savedAt, "2026-07-23T10:00:00.000Z");
  assert.notEqual(first.signature, later.signature, "ordinary persisted UI changes remain save-relevant");
  assert.equal(first.historySignature, later.historySignature, "UI-only changes do not create undo revisions");
  assert.equal(inspectProjectTextForSave(first.json).historySignature, first.historySignature);
  assert.equal(inspectProjectTextForSave("{invalid").valid, false);
});

test("project save preparer delegates projection and signatures to its worker", async () => {
  const requests = [];
  class FakeWorker {
    constructor(url, options) {
      this.url = String(url);
      this.options = options;
      queueMicrotask(() => this.onmessage?.({
        currentTarget: this,
        data: { type: "ready" },
      }));
    }

    postMessage(request) {
      requests.push(request.kind);
      queueMicrotask(() => {
        let result;
        if (request.kind === "prepare-state") result = prepareProjectSave(request.state, request.savedAt);
        else if (request.kind === "inspect-text") result = inspectProjectTextForSave(request.text);
        this.onmessage?.({ data: { id: request.id, ok: true, result } });
      });
    }

    terminate() {}
  }
  const warnings = [];
  const preparer = createProjectSavePreparer({
    WorkerClass: FakeWorker,
    workerUrl: new URL("https://example.test/project-save-worker.js"),
    onFallback: (error) => warnings.push(error),
  });
  const state = {
    project: {},
    ui: { live: {} },
    global: {},
    render: { outputs: [] },
    scheduler: {},
    nodes: {},
    media: [],
    components: [],
    mappings: [],
    shaders: {},
  };
  const prepared = await preparer.prepareState(state, "2026-07-23T12:00:00.000Z");
  const inspected = await preparer.inspectText(prepared.json);
  assert.deepEqual(requests, ["prepare-state", "inspect-text"]);
  assert.equal(inspected.historySignature, prepared.historySignature);
  assert.deepEqual(warnings, []);
  preparer.dispose();
});

test("project save work waits for the module worker readiness handshake", async () => {
  let instance = null;
  const requests = [];
  class DeferredWorker {
    constructor() {
      instance = this;
    }

    postMessage(request) {
      requests.push(request.kind);
      queueMicrotask(() => this.onmessage?.({
        currentTarget: this,
        data: {
          id: request.id,
          ok: true,
          result: prepareProjectSave(request.state, request.savedAt),
        },
      }));
    }

    terminate() {}
  }
  const preparer = createProjectSavePreparer({
    WorkerClass: DeferredWorker,
    workerUrl: new URL("https://example.test/deferred-project-save-worker.js"),
  });
  const state = {
    project: {},
    ui: { live: {} },
    global: {},
    render: { outputs: [] },
    scheduler: {},
    nodes: {},
    media: [],
    components: [],
    mappings: [],
    shaders: {},
  };

  const prepared = preparer.prepareState(state, "2026-07-23T12:00:00.000Z");
  assert.deepEqual(requests, [], "the first save message cannot race module-worker startup");
  instance.onmessage?.({ currentTarget: instance, data: { type: "ready" } });
  assert.equal(JSON.parse((await prepared).json).version, CURRENT_PROJECT_VERSION);
  assert.deepEqual(requests, ["prepare-state"]);
  preparer.dispose();
});

test("project save worker can prewarm before the first authored transaction", async () => {
  let instance = null;
  const requests = [];
  class WarmWorker {
    constructor() {
      instance = this;
    }

    postMessage(request) {
      requests.push(request.kind);
      queueMicrotask(() => this.onmessage?.({
        currentTarget: this,
        data: {
          id: request.id,
          ok: true,
          result: prepareProjectSave(request.state, request.savedAt),
        },
      }));
    }

    terminate() {}
  }
  const preparer = createProjectSavePreparer({
    WorkerClass: WarmWorker,
    workerUrl: new URL("https://example.test/prewarmed-project-save-worker.js"),
  });
  assert.equal(preparer.prewarm(), true);
  assert.deepEqual(requests, [], "prewarming loads code but does not serialize project state");
  instance.onmessage?.({ currentTarget: instance, data: { type: "ready" } });
  const prepared = await preparer.prepareState({
    project: {},
    ui: { live: {} },
    global: {},
    render: { outputs: [] },
    scheduler: {},
    nodes: {},
    media: [],
    components: [],
    mappings: [],
    shaders: {},
  }, "2026-07-23T12:00:00.000Z");
  assert.equal(JSON.parse(prepared.json).version, CURRENT_PROJECT_VERSION);
  assert.deepEqual(requests, ["prepare-state"]);
  preparer.dispose();
});

test("a silent save worker cannot hold every later project transaction forever", async () => {
  let terminated = false;
  class SilentWorker {
    postMessage() {}
    terminate() { terminated = true; }
  }
  const warnings = [];
  const preparer = createProjectSavePreparer({
    WorkerClass: SilentWorker,
    workerUrl: new URL("https://example.test/silent-project-save-worker.js"),
    requestTimeoutMs: 5,
    onFallback: (error) => warnings.push(error.message),
  });
  const state = {
    project: {},
    ui: { live: {} },
    global: {},
    render: { outputs: [] },
    scheduler: {},
    nodes: {},
    media: [],
    components: [],
    mappings: [],
    shaders: {},
  };

  const prepared = await preparer.prepareState(state, "2026-07-23T12:00:00.000Z");
  assert.equal(JSON.parse(prepared.json).version, CURRENT_PROJECT_VERSION);
  assert.equal(terminated, true);
  assert.deepEqual(warnings, ["VJ1_PROJECT_SAVE_PREPARATION_TIMEOUT:5"]);
  preparer.dispose();
});

test("undo and redo reload project state without rescanning assets", () => {
  const source = readFileSync(new URL("../js/services/project-folder-service.js", import.meta.url), "utf8");
  const reload = source.slice(source.indexOf("  async function reloadProjectFromDisk"), source.indexOf("\n  async function refreshHistoryState", source.indexOf("  async function reloadProjectFromDisk")));
  assert.doesNotMatch(reload, /collectProjectAssetFiles|mediaLibrary\.clear|sendMediaFiles/);
  assert.match(reload, /store\.getState\(\)\.media/);
});

test("an authored edit is saved as one undoable transaction and redo restores it", async () => {
  const project = new ProjectMemoryDirectory("undo-project");
  const nodePackage = createVj1NodePackage();
  const initialDraft = createInitialState();
  initialDraft.components.push(createDefaultComponent(1));
  const initial = nodePackage.prepareProjectState(initialDraft);
  initial.project.name = "Before";
  const projectFile = await project.getFileHandle("project.json", { create: true });
  projectFile.value = JSON.stringify(buildProjectPayload(initial, "2026-07-25T00:00:00.000Z"));

  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = {
    showDirectoryPicker: async () => project,
    addEventListener() {},
  };
  globalThis.document = {
    visibilityState: "visible",
    addEventListener() {},
  };

  const store = createAppState(createInitialState(), {
    prepareState: nodePackage.prepareProjectState,
    prepareChange: nodePackage.prepareProjectChange,
  });
  const mediaLibrary = createMediaLibrary();
  const bridge = {
    sendMediaFiles() {},
    sendNodePackages() {},
    sendState() {},
  };
  const service = createProjectFolderService({ mediaLibrary, store, bridge });
  const unsubscribe = store.subscribe((state, _reason, change) => {
    service.scheduleAutoSave(change, { state });
  });

  try {
    const opened = await service.openFolder();
    assert.equal(opened.loaded, true);
    assert.equal(store.getState().project.name, "Before");

    store.update((draft) => {
      draft.project.name = "After";
    }, "update:project-name");
    await service.flushAutoSave();

    assert.equal(JSON.parse(projectFile.value).project.name, "After");
    assert.deepEqual(service.getHistoryState(), { canUndo: true, canRedo: false });

    const editorSelection = store.getState().components[1];
    store.selectComponent(editorSelection.id);
    assert.equal(store.getState().ui.selectedComponentId, editorSelection.id);

    assert.equal(await service.undoProject(), true);
    assert.equal(store.getState().project.name, "Before");
    assert.equal(store.getState().ui.selectedComponentId, editorSelection.id, "undo retains the current editor projection");
    assert.equal(JSON.parse(projectFile.value).project.name, "Before");
    assert.deepEqual(service.getHistoryState(), { canUndo: false, canRedo: true });

    assert.equal(await service.redoProject(), true);
    assert.equal(store.getState().project.name, "After");
    assert.equal(store.getState().ui.selectedComponentId, editorSelection.id, "redo retains the current editor projection");
    assert.equal(JSON.parse(projectFile.value).project.name, "After");
    assert.deepEqual(service.getHistoryState(), { canUndo: true, canRedo: false });
  } finally {
    unsubscribe();
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});

test("an invalid history revision cannot truncate project.json or consume the recovery entry", async () => {
  const project = new ProjectMemoryDirectory("invalid-undo-project");
  const initial = createInitialState();
  initial.project.name = "Still valid";
  initial.components = [];
  const originalText = JSON.stringify(buildProjectPayload(initial, "2026-07-25T00:00:00.000Z"));
  const projectFile = await project.getFileHandle("project.json", { create: true });
  projectFile.value = originalText;
  const revisions = await project.getDirectoryHandle("revisions", { create: true });
  const invalidRevision = await revisions.getFileHandle(
    "project-before-9999-12-31T23-59-59-999Z-invalid.json",
    { create: true },
  );
  invalidRevision.value = "";

  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = {
    showDirectoryPicker: async () => project,
    addEventListener() {},
  };
  globalThis.document = {
    visibilityState: "visible",
    addEventListener() {},
  };

  const nodePackage = createVj1NodePackage();
  const store = createAppState(createInitialState(), {
    prepareState: nodePackage.prepareProjectState,
  });
  const service = createProjectFolderService({
    mediaLibrary: createMediaLibrary(),
    store,
    bridge: {
      sendMediaFiles() {},
      sendNodePackages() {},
      sendState() {},
    },
  });

  try {
    assert.equal((await service.openFolder()).loaded, true);
    await assert.rejects(
      service.undoProject(),
      /VJ1_PROJECT_UNDO_REVISION_INVALID:EMPTY/,
    );
    assert.equal(projectFile.value, originalText);
    assert.equal(JSON.parse(projectFile.value).project.name, "Still valid");
    assert.deepEqual(service.getHistoryState(), { canUndo: true, canRedo: false });
    assert.equal(revisions.files.has(invalidRevision.name), true);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});

test("a newer complete project snapshot supersedes an obsolete failed autosave", async () => {
  const project = new ProjectMemoryDirectory("autosave-recovery-project");
  const nodePackage = createVj1NodePackage();
  const initial = nodePackage.prepareProjectState(createInitialState());
  initial.project.name = "Before";
  const projectFile = await project.getFileHandle("project.json", { create: true });
  projectFile.value = JSON.stringify(buildProjectPayload(initial, "2026-07-25T00:00:00.000Z"));

  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = {
    showDirectoryPicker: async () => project,
    addEventListener() {},
  };
  globalThis.document = {
    visibilityState: "visible",
    addEventListener() {},
  };

  const store = createAppState(createInitialState(), {
    prepareState: nodePackage.prepareProjectState,
  });
  const service = createProjectFolderService({
    mediaLibrary: createMediaLibrary(),
    store,
    bridge: {
      sendMediaFiles() {},
      sendNodePackages() {},
      sendState() {},
    },
  });

  try {
    assert.equal((await service.openFolder()).loaded, true);

    const obsolete = store.snapshotState();
    obsolete.nodes = { ...obsolete.nodes, authority: "node-graph", groups: [] };
    service.scheduleAutoSave("update:obsolete-invalid-graph", { state: obsolete });
    assert.equal(await service.flushAutoSave(), false);
    assert.match(store.getState().project.warnings[0], /VJ1_PROJECT_COMPONENT_GRAPH_MISSING/);

    store.update((draft) => {
      draft.project.name = "After";
    }, "update:project-name");
    const current = store.getState();
    service.scheduleAutoSave("update:project-name", { state: current });
    assert.equal(await service.flushAutoSave(), true);
    assert.equal(JSON.parse(projectFile.value).project.name, "After");
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});

test("a graph-authoritative v34 project migrates, saves, edits, undoes, and redoes as v37", async () => {
  const project = new ProjectMemoryDirectory("v34-migration-project");
  const nodePackage = createVj1NodePackage();
  const current = nodePackage.prepareProjectState(createInitialState());
  const component = current.components.find((entry) => entry.chain?.length);
  const chainItem = component.chain[0];
  const payload = buildProjectPayload(current, "2026-07-25T00:00:00.000Z");
  payload.version = 34;
  payload.media = [{ id: "media/photo.png", name: "photo.png", path: "media/photo.png", type: "image", size: 1 }];
  const group = payload.nodes.groups.find((entry) => entry.id === `vj1.component.${component.id}`);
  const sourceNode = group.nodes.find((node) => node.id === chainItem.id);
  Object.assign(sourceNode, {
    nodeId: "core.composition.visual-source",
    nodeVersion: "0.1.0",
    role: "source",
    compilerHook: { id: "vj1.visual.source", renderer: "output/source:media" },
    configuration: {
      id: chainItem.id,
      kind: "source",
      enabled: true,
      source: {
        type: "media",
        mediaId: "media/photo.png",
        params: { fit: "cover" },
      },
    },
  });

  const projectFile = await project.getFileHandle("project.json", { create: true });
  projectFile.value = JSON.stringify(payload);
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = {
    showDirectoryPicker: async () => project,
    addEventListener() {},
  };
  globalThis.document = {
    visibilityState: "visible",
    addEventListener() {},
  };

  const store = createAppState(createInitialState(), {
    prepareState: nodePackage.prepareProjectState,
    prepareChange: nodePackage.prepareProjectChange,
  });
  const service = createProjectFolderService({
    mediaLibrary: createMediaLibrary(),
    store,
    bridge: {
      sendMediaFiles() {},
      sendNodePackages() {},
      sendState() {},
    },
  });
  const unsubscribe = store.subscribe((state, _reason, change) => {
    service.scheduleAutoSave(change, { state });
  });

  try {
    assert.equal((await service.openFolder()).loaded, true);
    assert.equal(await service.flushAutoSave(), true);
    const migrated = JSON.parse(projectFile.value);
    assert.equal(migrated.version, CURRENT_PROJECT_VERSION);
    const migratedNode = migrated.nodes.groups
      .find((entry) => entry.id === `vj1.component.${component.id}`)
      .nodes.find((node) => node.id === chainItem.id);
    assert.equal(migratedNode.nodeId, "vj1.visual.generator.mediaImage");
    assert.equal(migratedNode.configuration.source.generatorId, "mediaImage");
    assert.equal(migratedNode.configuration.source.params.mediaId, "media/photo.png");

    store.update((draft) => {
      draft.components.find((entry) => entry.id === component.id)
        .chain.find((item) => item.id === chainItem.id).enabled = false;
    }, "toggle:component-element");
    assert.equal(await service.flushAutoSave(), true);
    assert.equal(JSON.parse(projectFile.value).nodes.groups
      .find((entry) => entry.id === `vj1.component.${component.id}`)
      .nodes.find((node) => node.id === chainItem.id).configuration.enabled, false);

    assert.equal(await service.undoProject(), true);
    assert.equal(store.getState().components.find((entry) => entry.id === component.id)
      .chain.find((item) => item.id === chainItem.id).enabled, true);
    assert.equal(await service.redoProject(), true);
    assert.equal(store.getState().components.find((entry) => entry.id === component.id)
      .chain.find((item) => item.id === chainItem.id).enabled, false);
  } finally {
    unsubscribe();
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});

test("opening an old project persists its migration even when asset discovery changes nothing", async () => {
  const project = new ProjectMemoryDirectory("migration-with-stable-assets");
  const nodePackage = createVj1NodePackage();
  const current = nodePackage.prepareProjectState(createInitialState());
  const payload = buildProjectPayload(current, "2026-07-25T00:00:00.000Z");
  payload.version = 34;
  payload.media = [];

  const projectFile = await project.getFileHandle("project.json", { create: true });
  projectFile.value = JSON.stringify(payload);
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = {
    showDirectoryPicker: async () => project,
    addEventListener() {},
  };
  globalThis.document = {
    visibilityState: "visible",
    addEventListener() {},
  };

  const store = createAppState(createInitialState(), {
    prepareState: nodePackage.prepareProjectState,
  });
  const service = createProjectFolderService({
    mediaLibrary: createMediaLibrary(),
    store,
    bridge: {
      sendMediaFiles() {},
      sendNodePackages() {},
      sendState() {},
    },
  });

  try {
    assert.equal((await service.openFolder()).loaded, true);
    assert.equal(
      await service.flushAutoSave(),
      true,
      "the migrated in-memory representation has not yet been saved",
    );
    assert.equal(JSON.parse(projectFile.value).version, CURRENT_PROJECT_VERSION);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});

test("a migrated in-memory project is not marked persisted before its write closes", () => {
  const state = createVj1NodePackage().prepareProjectState(createInitialState());
  assert.equal(loadedProjectPersistenceSignature(state, "2026-07-25T00:00:00.000Z", {
    requiresSave: true,
  }), "");
  assert.notEqual(loadedProjectPersistenceSignature(state, "2026-07-25T00:00:00.000Z"), "");
});

test("graph-authoritative visibility and placement edits survive a fresh project load", async () => {
  const project = new ProjectMemoryDirectory("component-persistence-project");
  const nodePackage = createVj1NodePackage();
  const initial = nodePackage.prepareProjectState(createInitialState());
  const componentId = initial.components[0].id;
  const chainItemId = initial.components[0].chain[0].id;
  const projectFile = await project.getFileHandle("project.json", { create: true });
  projectFile.value = JSON.stringify(buildProjectPayload(initial, "2026-07-25T00:00:00.000Z"));

  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = {
    showDirectoryPicker: async () => project,
    addEventListener() {},
  };
  globalThis.document = {
    visibilityState: "visible",
    addEventListener() {},
  };

  const createSession = () => {
    const store = createAppState(createInitialState(), {
      prepareState: nodePackage.prepareProjectState,
      prepareChange: nodePackage.prepareProjectChange,
    });
    const service = createProjectFolderService({
      mediaLibrary: createMediaLibrary(),
      store,
      bridge: {
        sendMediaFiles() {},
        sendNodePackages() {},
        sendState() {},
      },
    });
    const unsubscribe = store.subscribe((state, _reason, change) => {
      service.scheduleAutoSave(change, { state });
    });
    return { service, store, unsubscribe };
  };

  const first = createSession();
  let second = null;
  try {
    assert.equal((await first.service.openFolder()).loaded, true);
    first.store.update((draft) => {
      const component = draft.components.find((entry) => entry.id === componentId);
      const item = component.chain.find((entry) => entry.id === chainItemId);
      item.enabled = false;
      item.boundary = { ...item.boundary, x: 0.2, y: -0.15, width: 0.55, height: 0.7 };
    }, "update:chain-boundary");
    await first.service.flushAutoSave();

    second = createSession();
    assert.equal((await second.service.openFolder()).loaded, true);
    const component = second.store.getState().components.find((entry) => entry.id === componentId);
    const item = component.chain.find((entry) => entry.id === chainItemId);
    assert.equal(item.enabled, false);
    assert.deepEqual(item.boundary, {
      x: 0.2,
      y: -0.15,
      width: 0.55,
      height: 0.7,
      rotation: 0,
    });
  } finally {
    first.unsubscribe();
    second?.unsubscribe();
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});

test("rendition cache uses a bounded manifest instead of directory enumeration", () => {
  const source = readFileSync(new URL("../js/services/project-derived-asset-store.js", import.meta.url), "utf8");
  const loadIndex = source.slice(source.indexOf("  async loadIndexedRenditions"), source.indexOf("\n  async indexRendition", source.indexOf("  async loadIndexedRenditions")));
  assert.match(source, /maxIndexedRenditions = 1000/);
  assert.match(loadIndex, /getFileHandle\(this\.renditionIndexFilename\)/);
  assert.doesNotMatch(loadIndex, /\.entries\(\)|\.values\(\)/);
});

class ProjectMemoryDirectory {
  constructor(name) {
    this.kind = "directory";
    this.name = name;
    this.directories = new Map();
    this.files = new Map();
  }

  async getDirectoryHandle(name, { create = false } = {}) {
    if (!this.directories.has(name)) {
      if (!create) throw projectNotFound();
      this.directories.set(name, new ProjectMemoryDirectory(name));
    }
    return this.directories.get(name);
  }

  async getFileHandle(name, { create = false } = {}) {
    if (!this.files.has(name)) {
      if (!create) throw projectNotFound();
      this.files.set(name, new ProjectMemoryFile(name));
    }
    return this.files.get(name);
  }

  async removeEntry(name) {
    if (!this.files.delete(name) && !this.directories.delete(name)) throw projectNotFound();
  }

  async *entries() {
    for (const [name, file] of this.files) yield [name, file];
    for (const [name, directory] of this.directories) yield [name, directory];
  }

  async *values() {
    for await (const [, handle] of this.entries()) yield handle;
  }
}

class ProjectMemoryFile {
  constructor(name) {
    this.kind = "file";
    this.name = name;
    this.value = "";
  }

  async createWritable({ keepExistingData = false } = {}) {
    let pendingValue = keepExistingData ? this.value : "";
    return {
      write: async (value) => {
        if (value?.type === "write") {
          const position = Math.max(0, Number(value.position) || 0);
          const data = String(value.data ?? "");
          pendingValue = String(pendingValue).slice(0, position) +
            data +
            String(pendingValue).slice(position + data.length);
        } else {
          pendingValue = value;
        }
      },
      truncate: async (size) => {
        const bytes = new TextEncoder().encode(String(pendingValue));
        pendingValue = new TextDecoder().decode(
          bytes.slice(0, Math.max(0, Number(size) || 0)),
        );
      },
      close: async () => {
        this.value = pendingValue;
      },
      abort: async () => {},
    };
  }

  async getFile() {
    const value = this.value;
    return {
      name: this.name,
      size: typeof value === "string" ? value.length : value?.size || 0,
      lastModified: 1,
      async text() {
        return typeof value === "string" ? value : await value.text();
      },
    };
  }
}

function projectNotFound() {
  return Object.assign(new Error("Not found"), { name: "NotFoundError" });
}
