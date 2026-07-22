import { collectProjectAssetFiles, isMediaFile, isShaderFile } from "./media-library-service.js?v=model-cache-2";
import { RENDITION_ROOT } from "./media-rendition-service.js?v=madstodo-4";
import {
  applyThumbnailUrls,
  clearThumbnailUrls,
  createThumbnailUrlLease,
} from "./component-thumbnail-store.js?v=thumbnail-pipeline-1";
import {
  canPersistDirectoryHandles,
  clearProjectDirectoryHandle,
  loadProjectDirectoryHandle,
  saveProjectDirectoryHandle,
} from "./directory-handle-store.js";
import { createInitialState, projectSelectedMapping } from "../domain/models.js?v=transition-start-fit-1";
import { migrateProjectData, ProjectVersionError } from "../domain/project-migrations.js?v=surface-identity-2";
import { createChangeEvent } from "../libraries/state-engine/state-command/index.js";
import { isHistoryReason, projectHistorySignature } from "./project-history-policy.js?v=project-storage-1";
import { buildProjectPayload } from "./project-serializer.js?v=output-one-1";
import { COLD_BACKUP_ROOT, createProjectHistoryStore } from "./project-history-store.js?v=project-history-store-1";
import { ProjectDerivedAssetStore } from "./project-derived-asset-store.js?v=streamed-thumbnail-restore-1";
import { SerializedTaskQueue } from "../libraries/storage-engine/serialized-storage/index.js";
import { mergeProjectIsfDefinitions } from "../libraries/isf-engine/index.js?v=isf-coordinates-1";

export { projectHistorySignature } from "./project-history-policy.js?v=project-storage-1";
export { buildProjectPayload, persistedRenderSettings } from "./project-serializer.js?v=output-one-1";
export { COLD_BACKUP_INTERVAL, COLD_BACKUP_ROOT, nextColdBackupRevision } from "./project-history-store.js?v=project-history-store-1";

export function createProjectFolderService({ mediaLibrary, store, bridge, classifyChange = createChangeEvent }) {
  let dirHandle = null;
  let autosaveTimer = null;
  let lastSavedSignature = "";
  let lastDirectorySignature = "";
  let refreshInFlight = false;
  let isOpening = false;
  let historyInFlight = false;
  let projectLoadBlocked = false;
  let pendingHistory = false;
  let pendingSaveReason = "";
  let directoryPickerUnavailableReported = false;
  const thumbnailUrlLease = createThumbnailUrlLease();
  let fileObserver = null;
  let observedChangeQueue = Promise.resolve();
  let projectGeneration = 0;
  let loadedProjectHandle = null;
  let thumbnailLoadRevision = 0;
  // Non-transactional state is a checkpoint, not a render-loop concern. Give
  // repeated UI/background changes a long quiet period and force the pending
  // checkpoint when Chrome begins hiding or leaving the page.
  const autosaveDelayMs = 5000;
  const skipAutosaveReasons = new Set([
    "init",
    "view",
    "output-metrics",
    "preview-metrics",
    "project-load",
    "project-refresh",
    "project-refresh-assets",
    "project-autosave",
    "project-autosave-status",
    "project-autosave-error",
    "project-version-error",
    "project-history",
    "project-undo",
    "project-redo",
    "live:update",
  ]);
  const historyStore = createProjectHistoryStore({
    getProjectDirectory: () => dirHandle,
    onStateChange: ({ canUndo, canRedo }) => {
      store.update((draft) => {
        draft.ui.canUndo = canUndo;
        draft.ui.canRedo = canRedo;
      }, "project-history");
    },
  });
  const saveQueue = new SerializedTaskQueue({
    worker: (job) => saveProject(job),
    onError(error) {
      store.update((draft) => {
        draft.project.warnings = [`Autosave error: ${error.message || error}`];
      }, "project-autosave-error");
      return false;
    },
  });
  const lifecycleDocument = globalThis.document;
  const lifecycleTarget = globalThis.window || globalThis;
  lifecycleDocument?.addEventListener?.("visibilitychange", () => {
    if (lifecycleDocument.visibilityState === "hidden") flushPendingAutoSave("browser-hidden");
  });
  lifecycleTarget?.addEventListener?.("pagehide", () => flushPendingAutoSave("browser-pagehide"));
  lifecycleTarget?.addEventListener?.("beforeunload", () => flushPendingAutoSave("browser-beforeunload"));
  const derivedAssets = new ProjectDerivedAssetStore({
    getProjectDirectory: () => dirHandle,
    isCurrentProject: (handle) => handle === dirHandle,
    mediaLibrary,
    onMediaFilesChanged: () => bridge.sendMediaFiles(mediaLibrary.getAllFiles()),
  });

  async function openFolder() {
    if (!window.showDirectoryPicker) {
      if (!directoryPickerUnavailableReported) {
        directoryPickerUnavailableReported = true;
        console.warn("[VJ1_DIRECTORY_PICKER_UNAVAILABLE]", {
          fallback: "legacy file input without a persistent project folder",
          message: "window.showDirectoryPicker is unavailable",
        });
      }
      return { fallback: true };
    }
    isOpening = true;
    let opened = false;
    try {
      const storedHandle = dirHandle ? null : await loadStoredHandle();
      let selectedHandle = null;
      if (storedHandle && await verifyPermission(storedHandle, "readwrite", true)) {
        selectedHandle = storedHandle;
      } else {
        selectedHandle = await window.showDirectoryPicker({ mode: "readwrite" });
      }
      if (selectedHandle !== dirHandle) {
        stopFileObserver();
        historyStore.reset();
        derivedAssets.reset();
        lastSavedSignature = "";
        lastDirectorySignature = "";
        projectGeneration++;
      }
      dirHandle = selectedHandle;
      clearFileObserverAbort(selectedHandle);
      opened = true;
      await saveStoredHandle(dirHandle);
      await ensureProjectScaffold(dirHandle);
      await loadDirectory("project-open-media");
      startFileObserver();
      return { fallback: false };
    } finally {
      isOpening = false;
      if (opened && !projectLoadBlocked) scheduleAutoSave("project-open", { immediate: true });
    }
  }

  async function restoreStoredFolder() {
    if (!canPersistDirectoryHandles()) return false;
    isOpening = true;
    let restored = false;
    try {
      const storedHandle = await loadStoredHandle();
      if (!storedHandle) return false;
      const permission = await queryPermission(storedHandle, "readwrite");
      if (permission !== "granted") {
        store.update((draft) => {
          const recoveredFromOutput = !!draft.project.folderName;
          if (!recoveredFromOutput) {
            draft.project.folderName = "";
            draft.media = [];
          }
          draft.project.warnings = [`Click the folder button to restore access to ${storedHandle.name}.`];
        }, "project-folder-needs-permission");
        return false;
      }
      dirHandle = storedHandle;
      derivedAssets.reset();
      projectGeneration++;
      await ensureProjectScaffold(dirHandle);
      await loadDirectory("project-restore-media");
      startFileObserver();
      restored = true;
      return true;
    } finally {
      isOpening = false;
      if (restored && !projectLoadBlocked) scheduleAutoSave({ reason: "project-restore-migration", history: "none" }, { immediate: true });
    }
  }

  async function importExternalFiles(fileList) {
    const files = Array.from(fileList || []).filter((file) => file?.name);
    if (!files.length) return { imported: 0 };
    if (!dirHandle) {
      return { needsFolder: true };
    }

    let imported = 0;
    const storedFiles = [];
    for (const file of files) {
      const path = file.relativePath || file.webkitRelativePath || file.name || "";
      const rootName = isShaderFile(path) ? "shaders" : isMediaFile(path) ? "media" : "";
      if (!rootName) continue;
      storedFiles.push(await writeFileIntoProject(dirHandle, file, rootName, path));
      imported++;
    }
    // The imported handles are already known. Publishing them directly avoids
    // turning one drop into a complete project-folder traversal.
    if (storedFiles.length) {
      const result = await mediaLibrary.importFiles(storedFiles);
      mergeObservedAssets(result);
      bridge.sendMediaFiles(mediaLibrary.getAllFiles());
    }
    return { imported };
  }

  async function closeProject() {
    if (hasPendingAutoSave()) {
      await flushAutoSave("project-close-checkpoint");
    }
    await saveQueue.wait();
    if (saveQueue.size) return false;
    stopFileObserver();
    projectGeneration++;
    thumbnailLoadRevision++;
    dirHandle = null;
    loadedProjectHandle = null;
    saveQueue.clear();
    lastSavedSignature = "";
    lastDirectorySignature = "";
    projectLoadBlocked = false;
    derivedAssets.reset();
    historyStore.reset();
    mediaLibrary.clear();
    bridge.sendMediaFiles([]);
    await clearStoredHandle();
    store.replace(createInitialState(), "project-close");
    thumbnailUrlLease.activate([]);
    bridge.sendState();
    return true;
  }

  async function refreshFolder({ force = false } = {}) {
    if (!dirHandle || isOpening || refreshInFlight) return false;
    refreshInFlight = true;
    try {
      const files = [...await collectProjectAssetFiles(dirHandle), ...await derivedAssets.loadIndexedRenditions()];
      const signature = directorySignature(files);
      if (!force && signature === lastDirectorySignature) return false;
      mediaLibrary.clear();
      const imported = await mediaLibrary.importFiles(files);
      refreshProjectAssets(imported, signature);
      bridge.sendMediaFiles(mediaLibrary.getAllFiles());
      await refreshHistoryState();
      return true;
    } finally {
      refreshInFlight = false;
    }
  }

  async function loadDirectory(reason) {
    mediaLibrary.clear();
    // Project structure and persisted thumbnails are lightweight and define
    // the first useful UI. Publish them before traversing and importing the
    // potentially large media library so startup never waits behind assets.
    const loaded = await loadProject(reason, { media: [], shaders: [] }, "", { preserveMediaCatalog: true });
    if (!loaded) return false;
    const files = [...await collectProjectAssetFiles(dirHandle), ...await derivedAssets.loadIndexedRenditions()];
    const signature = directorySignature(files);
    const imported = await mediaLibrary.importFiles(files);
    refreshProjectAssets(imported, signature);
    bridge.sendMediaFiles(mediaLibrary.getAllFiles());
    await refreshHistoryState();
    return true;
  }

  async function loadProject(reason = "project-load", imported = { media: [], shaders: [] }, directorySig = "", { preserveMediaCatalog = false } = {}) {
    if (!dirHandle) return;
    let data = {};
    let embeddedThumbnails = [];
    let projectFileFound = false;
    try {
      const handle = await dirHandle.getFileHandle("project.json");
      projectFileFound = true;
      const text = await (await handle.getFile()).text();
      data = JSON.parse(text);
      embeddedThumbnails = embeddedThumbnailEntries(data.components);
    } catch (error) {
      if (projectFileFound) {
        blockProjectLoad(`Cannot open project.json: ${error.message || error}`);
        return false;
      }
      data = {};
    }
    if (projectFileFound) {
      try {
        data = migrateProjectData(data);
      } catch (error) {
        const message = error instanceof ProjectVersionError
          ? error.message
          : `Project migration failed: ${error.message || error}`;
        blockProjectLoad(message);
        return false;
      }
    }
    projectLoadBlocked = false;
    const { ui: projectUi, metrics: _projectMetrics, ...projectData } = data;
    // A folder without project.json is a genuinely new project. Seed it from
    // the startup template instead of leaking components or mappings from the
    // project that happened to be open before the folder picker was used.
    const currentState = projectFileFound
      ? store.getState()
      : createInitialState({ startupTemplate: true });
    const currentUi = currentState.ui;
    const loadHandle = dirHandle;
    const loadGeneration = projectGeneration;
    const sameProject = loadedProjectHandle === loadHandle;
    const components = clearThumbnailUrls(Array.isArray(projectData.components) ? projectData.components : currentState.components);
    const thumbnailEntries = new Map();
    if (sameProject) {
      for (const entry of componentThumbnailEntries(currentState.components)) thumbnailEntries.set(componentThumbnailKey(entry), entry);
      applyThumbnailUrls(components, [...thumbnailEntries.values()]);
    }
    for (const entry of embeddedThumbnails) thumbnailEntries.delete(componentThumbnailKey(entry));
    applyThumbnailUrls(components, embeddedThumbnails);
    const nextState = {
      ...currentState,
      ...projectData,
      components,
      ui: {
        ...currentUi,
        selectedMappingId: projectUi?.selectedMappingId || currentUi.selectedMappingId,
        selectedSurfaceId: projectUi?.selectedSurfaceId || currentUi.selectedSurfaceId,
        selectedComponentId: projectUi?.selectedComponentId || currentUi.selectedComponentId,
        selectedChainItemId: projectUi?.selectedChainItemId || currentUi.selectedChainItemId,
        workspaceSelectionIds: projectUi?.workspaceSelectionIds || currentUi.workspaceSelectionIds,
        catalogSortModes: projectUi?.catalogSortModes || currentUi.catalogSortModes,
        previewQuality: projectUi?.previewQuality || currentUi.previewQuality,
        previewViewports: projectUi?.previewViewports || currentUi.previewViewports,
        previewDiagnostics: projectUi?.previewDiagnostics ?? currentUi.previewDiagnostics,
        mappingTestPattern: projectUi?.mappingTestPattern ?? currentUi.mappingTestPattern,
        live: {
          ...currentUi.live,
          ...(projectUi?.live || {}),
          componentOverrides: currentUi.live?.componentOverrides || {},
        },
      },
      project: {
        ...currentState.project,
        ...(projectData.project || {}),
        name: projectData.project?.name || dirHandle.name,
        folderName: dirHandle.name,
        warnings: projectFileFound ? [] : [`No project.json found in ${dirHandle.name}`],
      },
      media: preserveMediaCatalog && Array.isArray(projectData.media)
        ? projectData.media.map((item) => ({ ...item }))
        : mergeMediaCatalogMarkers(imported.media, projectData.media),
      nodes: mergeProjectIsfDefinitions(projectData.nodes || currentState.nodes, imported.shaders),
      shaders: imported.shaders[0]
        ? {
            ...(projectData.shaders || store.getState().shaders),
            customName: imported.shaders[0].name,
            customCode: imported.shaders[0].code,
          }
        : (projectData.shaders || currentState.shaders),
    };
    const selectedScene = nextState.mappings?.find((scene) => scene.id === nextState.ui.selectedMappingId) || nextState.mappings?.[0];
    if (selectedScene) projectSelectedMapping(nextState, selectedScene);
    store.replace(nextState, reason);
    loadedProjectHandle = loadHandle;
    if (!sameProject) thumbnailUrlLease.activate([]);
    // Cached thumbnails are derived assets, not a prerequisite for opening a
    // project. Publish the parsed graph first, then stream thumbnail batches.
    // This prevents a busy standalone Output from starving editor recovery and
    // keeps the previous image until a replacement for that exact key exists.
    const thumbnailRevision = ++thumbnailLoadRevision;
    void derivedAssets.loadComponentThumbnails(components, {
      onBatch(entries) {
        if (loadHandle !== dirHandle || loadGeneration !== projectGeneration || thumbnailRevision !== thumbnailLoadRevision) {
          for (const entry of entries) if (String(entry.url || "").startsWith("blob:")) URL.revokeObjectURL(entry.url);
          return;
        }
        for (const entry of entries) thumbnailEntries.set(componentThumbnailKey(entry), entry);
        store.updateDerived((draft) => {
          applyThumbnailUrls(draft.components, entries);
        }, "project-thumbnail-cache-batch");
        thumbnailUrlLease.activate(componentThumbnailObjectUrls(thumbnailEntries.values()));
      },
    }).catch((error) => console.warn("[VJ1_THUMBNAIL_CACHE_LOAD_FAILED]", {
      fallback: "retain existing thumbnails and regenerate missing entries on demand",
      message: error?.message || String(error),
    }));
    if (embeddedThumbnails.length) derivedAssets.migrateEmbeddedThumbnails(embeddedThumbnails);
    lastDirectorySignature = directorySig;
    lastSavedSignature = payloadSignature(buildProjectPayload(store.getState(), projectData.project?.savedAt || ""));
    return true;
  }

  function blockProjectLoad(message) {
    projectLoadBlocked = true;
    store.update((draft) => {
      draft.project.folderName = dirHandle?.name || draft.project.folderName;
      draft.project.warnings = [message];
    }, "project-version-error");
  }

  function refreshProjectAssets(imported = { media: [], shaders: [] }, directorySig = "") {
    store.update((draft) => {
      draft.project.folderName = dirHandle?.name || draft.project.folderName;
      draft.project.warnings = (draft.project.warnings || []).filter((warning) => !String(warning).startsWith("Folder change ("));
      draft.media = mergeMediaCatalogMarkers(imported.media, draft.media);
      draft.nodes = mergeProjectIsfDefinitions(draft.nodes, imported.shaders, { authoritative: true });
      if (imported.shaders[0]) {
        draft.shaders = {
          ...draft.shaders,
          customName: imported.shaders[0].name,
          customCode: imported.shaders[0].code,
        };
      }
    }, "project-refresh-assets");
    lastDirectorySignature = directorySig;
  }

  function scheduleAutoSave(change = "change", { immediate = false } = {}) {
    const event = classifyChange(change);
    const reason = event.reason;
    if (event.phase === "edit" || event.phase === "scrub") return;
    if (!dirHandle || isOpening || projectLoadBlocked || skipAutosaveReasons.has(reason)) return;
    if (event.history === "record") {
      pendingHistory = true;
      pendingSaveReason = reason;
    } else if (!pendingSaveReason) {
      pendingSaveReason = reason;
    }
    // Selection and other editor-only state must not serialize the complete
    // project after every click. It remains in the current state and is folded
    // into the next authored save or the browser lifecycle checkpoint.
    const previewViewportCheckpoint = event.scope === "ui" && reason.startsWith("preview-");
    if (event.scope === "ui" && !immediate && !previewViewportCheckpoint) return;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    const delay = immediate || reason === "live:scene" || event.history === "record" ? 0 : autosaveDelayMs;
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null;
      const startedAt = monotonicNow();
      const save = flushAutoSave();
      const elapsedMs = monotonicNow() - startedAt;
      if (elapsedMs >= 40) {
        console.warn("[VJ1_AUTOSAVE_PREPARE_SLOW]", {
          reason: pendingSaveReason || reason || "change",
          elapsedMs: Math.round(elapsedMs * 10) / 10,
          message: "building and serializing project.json blocked the main thread before storage began",
        });
      }
      void save;
    }, delay);
  }

  async function flushAutoSave(reason = "") {
    if (!dirHandle) return false;
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
    const saveReason = reason || pendingSaveReason || "change";
    const recordHistory = pendingHistory || classifyChange(saveReason).history === "record";
    pendingHistory = false;
    pendingSaveReason = "";
    const payload = buildProjectPayload(store.getState(), new Date().toISOString());
    const json = JSON.stringify(payload, null, 2);
    // buildProjectPayload already returns a detached persistable snapshot.
    // Re-parsing the just-created JSON doubled the synchronous autosave cost
    // for effect-heavy projects and is unnecessary for queue ownership.
    return saveQueue.enqueue({ reason: saveReason, recordHistory, payload, json });
  }

  function hasPendingAutoSave() {
    return Boolean(autosaveTimer || pendingHistory || pendingSaveReason);
  }

  function flushPendingAutoSave(reason) {
    if (!hasPendingAutoSave() || !dirHandle || isOpening || projectLoadBlocked) return false;
    // flushAutoSave performs project snapshot creation synchronously before it
    // returns its write promise. Starting at visibility loss gives the native
    // file write more time than relying on beforeunload alone.
    void flushAutoSave(reason);
    return true;
  }

  async function saveProject({ reason = "manual", recordHistory = true, payload: suppliedPayload = null, json: suppliedJson = "" } = {}) {
    if (projectLoadBlocked) return false;
    const savedAt = suppliedPayload?.project?.savedAt || new Date().toISOString();
    const payload = suppliedPayload || buildProjectPayload(store.getState(), savedAt);
    const signature = payloadSignature(payload);
    if (signature === lastSavedSignature) return false;

    if (!dirHandle) {
      return false;
    }

    const json = suppliedJson || JSON.stringify(payload, null, 2);
    let handle = null;
    let previousText = "";
    try {
      handle = await dirHandle.getFileHandle("project.json");
      previousText = await (await handle.getFile()).text();
    } catch (error) {
      if (!isNotFoundError(error)) console.warn("[VJ1_PROJECT_FILE_LOOKUP_FAILED]", { fallback: "attempt writable project handle", message: error?.message || String(error) });
      handle = await dirHandle.getFileHandle("project.json", { create: true });
    }

    const recordsProjectRevision = shouldWriteHistoryRevision(previousText, payload, json, reason, recordHistory);
    if (recordsProjectRevision) {
      await historyStore.writeRevision(previousText, savedAt);
      if (!isHistoryReason(reason)) await historyStore.clearRedoRevisions();
    }

    const writable = await handle.createWritable();
    await writable.write(json);
    await writable.close();
    if (recordsProjectRevision) {
      try {
        await historyStore.recordColdBackup(json, savedAt);
      } catch (error) {
        console.warn("[VJ1_COLD_BACKUP_FAILED]", {
          directory: COLD_BACKUP_ROOT,
          fallback: "project saved; retry milestone backup on the next committed revision",
          message: error?.message || String(error),
        });
      }
    }
    lastSavedSignature = signature;
    await refreshHistoryState();
    store.update((draft) => {
      draft.project.savedAt = payload.project.savedAt;
      draft.project.warnings = [];
      draft.ui.mappingStatus = reason === "mapping-state" ? "Mapping autosaved" : draft.ui.mappingStatus;
    }, "project-autosave");
    return true;
  }

  async function undoProject() {
    if (!dirHandle || historyInFlight) return false;
    historyInFlight = true;
    try {
      if (autosaveTimer) {
        clearTimeout(autosaveTimer);
        autosaveTimer = null;
        await flushAutoSave("history-checkpoint");
      } else await saveQueue.wait();
      if (saveQueue.size) return false;
      const entry = await historyStore.latestRevisionEntry("undo");
      if (!entry) {
        await refreshHistoryState();
        return false;
      }
      const currentText = await readProjectText();
      const undoText = await (await entry.handle.getFile()).text();
      if (currentText.trim()) await historyStore.writeRedoRevision(currentText, new Date().toISOString());
      await writeProjectText(undoText);
      await historyStore.removeRevisionEntry(entry);
      await reloadProjectFromDisk("project-undo");
      return true;
    } finally {
      historyInFlight = false;
    }
  }

  async function redoProject() {
    if (!dirHandle || historyInFlight) return false;
    historyInFlight = true;
    try {
      await saveQueue.wait();
      if (saveQueue.size) return false;
      const entry = await historyStore.latestRevisionEntry("redo");
      if (!entry) {
        await refreshHistoryState();
        return false;
      }
      const currentText = await readProjectText();
      const redoText = await (await entry.handle.getFile()).text();
      if (currentText.trim()) await historyStore.writeRevision(currentText, new Date().toISOString());
      await writeProjectText(redoText);
      await historyStore.removeRevisionEntry(entry);
      await reloadProjectFromDisk("project-redo");
      return true;
    } finally {
      historyInFlight = false;
    }
  }

  function getHistoryState() {
    return historyStore.getState();
  }

  async function readProjectText() {
    const handle = await dirHandle.getFileHandle("project.json");
    return await (await handle.getFile()).text();
  }

  async function writeProjectText(text) {
    const handle = await dirHandle.getFileHandle("project.json", { create: true });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
  }

  async function reloadProjectFromDisk(reason) {
    // Undo/redo changes project.json only. The current media-library snapshot
    // remains authoritative and must not trigger another filesystem traversal.
    const imported = { media: store.getState().media || [], shaders: [] };
    await loadProject(reason, imported, lastDirectorySignature);
    await refreshHistoryState();
    bridge.sendState();
  }

  async function refreshHistoryState() {
    return historyStore.refreshState();
  }

  function startFileObserver() {
    stopFileObserver();
    const Observer = globalThis.FileSystemObserver;
    if (!Observer || !dirHandle) {
      console.info("[VJ1_FILE_OBSERVER_UNAVAILABLE]", { fallback: "use the Media refresh button for external folder changes" });
      return;
    }
    if (fileObserverAbortedForSession(dirHandle)) return;
    try {
      const observerGeneration = projectGeneration;
      const observedHandle = dirHandle;
      fileObserver = new Observer((records) => {
        observedChangeQueue = observedChangeQueue
          .then(() => observerGeneration === projectGeneration ? applyObservedChanges(records, observerGeneration) : undefined)
          .catch((error) => console.warn("[VJ1_FILE_OBSERVER_UPDATE_FAILED]", { fallback: "use the Media refresh button", message: error?.message || String(error) }));
      });
      Promise.resolve(fileObserver.observe(dirHandle, { recursive: true }))
        .then(() => clearFileObserverAbort(observedHandle))
        .catch((error) => handleFileObserverStartFailure(error, observedHandle));
    } catch (error) {
      handleFileObserverStartFailure(error, dirHandle);
    }
  }

  function handleFileObserverStartFailure(error, handle) {
    stopFileObserver();
    if (isFileObserverAbort(error)) {
      rememberFileObserverAbort(handle);
      return;
    }
    console.warn("[VJ1_FILE_OBSERVER_START_FAILED]", { fallback: "use the Media refresh button", message: error?.message || String(error) });
  }

  function stopFileObserver() {
    try { fileObserver?.disconnect?.(); } catch (error) {
      console.warn("[VJ1_FILE_OBSERVER_STOP_FAILED]", { fallback: "discard observer reference", message: error?.message || String(error) });
    }
    fileObserver = null;
  }

  async function applyObservedChanges(records = [], generation = projectGeneration) {
    for (const record of records || []) {
      if (generation !== projectGeneration) return;
      const path = observedRecordPath(record);
      if (!path || isIgnoredObservedPath(path)) continue;
      const insideAssetRoot = path === "media" || path === "shaders" || path.startsWith("media/") || path.startsWith("shaders/");
      const relevantPath = insideAssetRoot || isObservedAssetPath(path);
      if ((record.type === "unknown" || record.type === "errored") && relevantPath) {
        markManualRefreshNeeded(path, record.type);
        continue;
      }
      if (record.changedHandle?.kind === "directory" && insideAssetRoot) {
        markManualRefreshNeeded(path, record.type || "directory");
        continue;
      }
      if (record.changedHandle?.kind === "directory") continue;
      if (!isObservedAssetPath(path)) continue;
      if (record.type === "moved") {
        const previousPath = observedMovedFromPath(record);
        if (previousPath && isMediaFile(previousPath)) {
          mediaLibrary.remove(previousPath);
          store.updateDerived((draft) => {
            draft.media = (draft.media || []).filter((item) => item.id !== previousPath);
          }, "project-observed-asset-move");
        } else if (previousPath && isShaderFile(previousPath)) {
          markManualRefreshNeeded(previousPath, "shader moved");
        }
      }
      if (record.type === "disappeared") {
        if (isShaderFile(path)) {
          markManualRefreshNeeded(path, "shader removed");
          continue;
        }
        mediaLibrary.remove(path);
        store.updateDerived((draft) => {
          draft.media = (draft.media || []).filter((item) => item.id !== path);
        }, "project-observed-asset-remove");
        bridge.sendMediaFiles(mediaLibrary.getAllFiles());
        continue;
      }
      let handle = record.changedHandle;
      if (!handle || handle.kind !== "file") handle = await fileHandleAtPath(dirHandle, path);
      if (!handle) {
        markManualRefreshNeeded(path, "unresolved");
        continue;
      }
      try {
        const file = await handle.getFile();
        Object.defineProperty(file, "relativePath", { value: path, configurable: true });
        const imported = await mediaLibrary.importFiles([file]);
        mergeObservedAssets(imported);
        bridge.sendMediaFiles(mediaLibrary.getAllFiles());
      } catch (error) {
        console.warn("[VJ1_OBSERVED_ASSET_READ_FAILED]", { path, fallback: "use the Media refresh button", message: error?.message || String(error) });
        markManualRefreshNeeded(path, "unreadable");
      }
    }
  }

  function mergeObservedAssets(imported) {
    const hasProjectIsf = imported.shaders?.some((shader) => /\/\*\s*\{/.test(shader.code || ""));
    const merge = (draft) => {
      const byId = new Map((draft.media || []).map((item) => [item.id, item]));
      for (const item of imported.media || []) {
        const previous = byId.get(item.id);
        byId.set(item.id, {
          ...item,
          catalogMarker: previous?.catalogMarker ?? item.catalogMarker ?? 0,
        });
      }
      draft.media = Array.from(byId.values());
      // Imported ISF is project-authored node code and must use the persistent
      // update path. Ordinary shader/media observation remains derived state.
      if (hasProjectIsf) draft.nodes = mergeProjectIsfDefinitions(draft.nodes, imported.shaders);
      if (imported.shaders?.[0]) {
        draft.shaders = { ...draft.shaders, customName: imported.shaders[0].name, customCode: imported.shaders[0].code };
      }
    };
    if (hasProjectIsf) store.update(merge, "project-observed-isf-update");
    else store.updateDerived(merge, "project-observed-asset-update");
    if (imported.shaders?.length) bridge.sendState();
  }

  function markManualRefreshNeeded(path, eventType) {
    store.updateDerived((draft) => {
      draft.project.warnings = [`Folder change (${eventType}) at ${path} needs a manual Media refresh.`];
    }, "project-observer-refresh-needed");
  }

  return {
    openFolder,
    restoreStoredFolder,
    closeProject,
    saveProject,
    scheduleAutoSave,
    flushAutoSave,
    importExternalFiles,
    refreshFolder,
    undoProject,
    redoProject,
    getHistoryState,
    writeMediaRendition: (...args) => derivedAssets.writeMediaRendition(...args),
    writeComponentThumbnail: (...args) => derivedAssets.writeComponentThumbnail(...args),
  };
}

function monotonicNow() {
  return typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();
}

function mergeMediaCatalogMarkers(imported = [], authored = []) {
  const markers = new Map((Array.isArray(authored) ? authored : []).map((item) => [item.id, item.catalogMarker ?? 0]));
  return (Array.isArray(imported) ? imported : []).map((item) => ({
    ...item,
    catalogMarker: markers.get(item.id) ?? item.catalogMarker ?? 0,
  }));
}

function componentThumbnailEntries(components = []) {
  const entries = [];
  for (const component of components || []) {
    if (component?.thumbnail) entries.push({ componentId: component.id, frameId: "", url: component.thumbnail });
    if (component?.type !== "scene") continue;
    for (const [surfaceId, url] of Object.entries(component.scene?.surfaceThumbnails || {})) {
      if (url) entries.push({ componentId: component.id, frameId: surfaceId, url });
    }
  }
  return entries;
}

function componentThumbnailKey(entry = {}) {
  return `${String(entry.componentId || "")}:${String(entry.frameId || "")}`;
}

function componentThumbnailObjectUrls(entries = []) {
  return new Set([...entries]
    .map((entry) => String(entry?.url || ""))
    .filter((url) => url.startsWith("blob:")));
}

function isFileObserverAbort(error) {
  return error?.name === "AbortError" || /user aborted/i.test(String(error?.message || ""));
}

function fileObserverAbortStorageKey(handle) {
  return `vj1:file-observer-aborted:${String(handle?.name || "project")}`;
}

function fileObserverAbortedForSession(handle) {
  try {
    return globalThis.sessionStorage?.getItem(fileObserverAbortStorageKey(handle)) === "1";
  } catch {
    return false;
  }
}

function rememberFileObserverAbort(handle) {
  try {
    globalThis.sessionStorage?.setItem(fileObserverAbortStorageKey(handle), "1");
  } catch {}
}

function clearFileObserverAbort(handle) {
  try {
    globalThis.sessionStorage?.removeItem(fileObserverAbortStorageKey(handle));
  } catch {}
}

async function ensureProjectScaffold(handle) {
  if (!handle?.getDirectoryHandle) return;
  for (const name of ["media", "shaders", RENDITION_ROOT]) {
    await handle.getDirectoryHandle(name, { create: true });
  }
  for (const name of ["scenes", "mappings"]) await removeObsoleteEmptyScaffold(handle, name);
}

async function removeObsoleteEmptyScaffold(root, name) {
  try {
    const directory = await root.getDirectoryHandle(name);
    for await (const _entry of directory.values()) {
      console.info("[VJ1_OBSOLETE_SCAFFOLD_RETAINED]", { directory: name, reason: "contains user files that VJ1 will not delete" });
      return false;
    }
    await root.removeEntry(name);
    console.info("[VJ1_OBSOLETE_SCAFFOLD_REMOVED]", { directory: name });
    return true;
  } catch (error) {
    if (!isNotFoundError(error)) console.warn("[VJ1_OBSOLETE_SCAFFOLD_CLEANUP_FAILED]", { directory: name, fallback: "leave directory untouched", message: error?.message || String(error) });
    return false;
  }
}

function shouldWriteHistoryRevision(previousText = "", nextPayload = {}, nextText = "", reason = "", recordHistory = true) {
  if (!recordHistory) return false;
  if (reason === "component-thumbnail") return false;
  if (!previousText.trim() || previousText === nextText) return false;
  const previousPayload = parseProjectText(previousText);
  if (!previousPayload) return true;
  return projectHistorySignature(previousPayload) !== projectHistorySignature(nextPayload);
}

function parseProjectText(text = "") {
  try {
    return JSON.parse(text);
  } catch (error) {
    console.warn("[VJ1_PROJECT_HISTORY_PARSE_FAILED]", { fallback: "preserve a conservative history revision", message: error?.message || String(error) });
    return null;
  }
}

async function loadStoredHandle() {
  if (!canPersistDirectoryHandles()) return null;
  try {
    return await loadProjectDirectoryHandle();
  } catch (error) {
    console.warn("[VJ1_PROJECT_HANDLE_RESTORE_FAILED]", { fallback: "manual folder selection", message: error?.message || String(error) });
    return null;
  }
}

async function saveStoredHandle(handle) {
  if (!handle || !canPersistDirectoryHandles()) return;
  try {
    await saveProjectDirectoryHandle(handle);
  } catch (error) {
    console.warn("[VJ1_PROJECT_HANDLE_SAVE_FAILED]", { fallback: "current-session handle only", message: error?.message || String(error) });
    // The app can still run with the active handle; only refresh restore is lost.
  }
}

async function clearStoredHandle() {
  if (!canPersistDirectoryHandles()) return;
  try {
    await clearProjectDirectoryHandle();
  } catch (error) {
    console.warn("[VJ1_PROJECT_HANDLE_CLEAR_FAILED]", { fallback: "in-memory project close", message: error?.message || String(error) });
    // Closing the in-memory project is still valid if handle persistence cleanup fails.
  }
}

async function queryPermission(handle, mode) {
  if (!handle?.queryPermission) return "granted";
  try {
    return await handle.queryPermission({ mode });
  } catch (error) {
    console.warn("[VJ1_PROJECT_PERMISSION_QUERY_FAILED]", { fallback: "request permission interactively", message: error?.message || String(error) });
    return "prompt";
  }
}

async function verifyPermission(handle, mode, requestIfNeeded) {
  const permission = await queryPermission(handle, mode);
  if (permission === "granted") return true;
  if (!requestIfNeeded || !handle?.requestPermission) return false;
  try {
    return await handle.requestPermission({ mode }) === "granted";
  } catch (error) {
    console.warn("[VJ1_PROJECT_PERMISSION_REQUEST_FAILED]", { fallback: "leave project folder closed", message: error?.message || String(error) });
    return false;
  }
}

function payloadSignature(payload) {
  return JSON.stringify({
    ...payload,
    project: { ...payload.project, savedAt: "" },
  });
}

function directorySignature(files) {
  return JSON.stringify(Array.from(files || [])
    .map((file) => {
      const path = file.relativePath || file.webkitRelativePath || file.name || "";
      return {
        path,
        size: file.size || 0,
        modified: file.lastModified || 0,
      };
    })
    .filter((file) => isMediaFile(file.path) || isShaderFile(file.path))
    .sort((a, b) => a.path.localeCompare(b.path)));
}

function embeddedThumbnailEntries(components = []) {
  const entries = [];
  for (const component of components || []) {
    if (typeof component?.thumbnail === "string" && component.thumbnail.startsWith("data:image/")) {
      entries.push({ componentId: component.id, frameId: "", url: component.thumbnail });
    }
    for (const [surfaceId, url] of Object.entries(component?.scene?.surfaceThumbnails || {})) {
      if (typeof url === "string" && url.startsWith("data:image/")) entries.push({ componentId: component.id, frameId: surfaceId, url });
    }
  }
  return entries;
}

function cooperativeYield() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function observedRecordPath(record = {}) {
  const parts = record.relativePathComponents || record.relativePath || [];
  if (Array.isArray(parts)) return parts.map(String).filter(Boolean).join("/");
  return String(parts || "").replace(/^\/+/, "");
}

function observedMovedFromPath(record = {}) {
  const parts = record.relativePathMovedFrom || record.formerRelativePathComponents || [];
  if (Array.isArray(parts)) return parts.map(String).filter(Boolean).join("/");
  return String(parts || "").replace(/^\/+/, "");
}

function isIgnoredObservedPath(path = "") {
  const root = String(path).split("/")[0];
  return root === "revisions" || root === COLD_BACKUP_ROOT || root === RENDITION_ROOT;
}

function isObservedAssetPath(path = "") {
  const parts = String(path).split("/").filter(Boolean);
  if (!parts.length) return false;
  if (parts.length === 1) return isMediaFile(path) || isShaderFile(path);
  if (!["media", "shaders"].includes(parts[0])) return false;
  return isMediaFile(path) || isShaderFile(path);
}

async function fileHandleAtPath(root, path = "") {
  const parts = String(path).split("/").filter(Boolean);
  if (!parts.length) return null;
  try {
    let directory = root;
    for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
    return await directory.getFileHandle(parts.at(-1));
  } catch (error) {
    if (!isNotFoundError(error)) console.warn("[VJ1_OBSERVED_PATH_RESOLVE_FAILED]", { path, fallback: "use the Media refresh button", message: error?.message || String(error) });
    return null;
  }
}

async function writeFileIntoProject(projectDirHandle, file, rootName, sourcePath) {
  const sourceParts = String(sourcePath || "").split("/").filter(Boolean);
  if (sourceParts[0] === rootName) sourceParts.shift();
  let directory = await projectDirHandle.getDirectoryHandle(rootName, { create: true });
  const storedParts = [];
  for (const part of sourceParts.slice(0, -1)) {
    const safePart = safeFilename(part);
    directory = await directory.getDirectoryHandle(safePart, { create: true });
    storedParts.push(safePart);
  }
  const originalName = safeFilename((sourcePath || file.name).split("/").pop() || file.name || "file");
  const filename = await uniqueFilename(directory, originalName);
  const handle = await directory.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  await writable.write(file);
  await writable.close();
  const stored = await handle.getFile();
  Object.defineProperty(stored, "relativePath", { value: [rootName, ...storedParts, filename].join("/"), configurable: true });
  return stored;
}

async function uniqueFilename(directory, filename) {
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : "";
  let candidate = filename;
  let index = 1;
  while (await fileExists(directory, candidate)) {
    candidate = `${base}-${index}${ext}`;
    index++;
  }
  return candidate;
}

async function fileExists(directory, filename) {
  try {
    await directory.getFileHandle(filename);
    return true;
  } catch (error) {
    if (!isNotFoundError(error)) {
      console.error("[VJ1_FILE_EXISTENCE_CHECK_FAILED]", { filename, fallback: "abort collision check", message: error?.message || String(error) });
      throw error;
    }
    return false;
  }
}

function isNotFoundError(error) {
  return error?.name === "NotFoundError";
}

function safeFilename(value) {
  return String(value || "file")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/^\.+$/, "file")
    .trim() || "file";
}
