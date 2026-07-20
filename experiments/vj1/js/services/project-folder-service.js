import { collectProjectAssetFiles, isMediaFile, isShaderFile } from "./media-library-service.js?v=model-cache-2";
import { RENDITION_DIR, RENDITION_ROOT, isMediaRenditionPath, mediaRenditionPath } from "./media-rendition-service.js?v=madstodo-4";
import {
  THUMBNAIL_DIR,
  THUMBNAIL_ROOT,
  applyThumbnailUrls,
  clearThumbnailUrls,
  componentThumbnailFilename,
  createThumbnailUrlLease,
  parseComponentThumbnailFilename,
  thumbnailDataUrlToBlob,
  thumbnailExtension,
} from "./component-thumbnail-store.js?v=thumbnail-url-lease-1";
import {
  canPersistDirectoryHandles,
  clearProjectDirectoryHandle,
  loadProjectDirectoryHandle,
  saveProjectDirectoryHandle,
} from "./directory-handle-store.js";
import { applySceneSnapshotToState, createInitialState } from "../domain/models.js?v=volumetric-clouds-1";
import { migrateProjectData, ProjectVersionError } from "../domain/project-migrations.js?v=catalog-marker-four-state-1";
import { createChangeEvent } from "../domain/change-event.js?v=chain-only-authority-1";
import { isHistoryReason, projectHistorySignature } from "./project-history-policy.js?v=project-storage-1";
import { buildProjectPayload } from "./project-serializer.js?v=catalog-marker-four-state-1";

export { projectHistorySignature } from "./project-history-policy.js?v=project-storage-1";
export { buildProjectPayload, persistedRenderSettings } from "./project-serializer.js?v=catalog-marker-four-state-1";

export const COLD_BACKUP_ROOT = "backups";
export const COLD_BACKUP_INTERVAL = 500;

export function nextColdBackupRevision(currentRevision = 0, interval = COLD_BACKUP_INTERVAL) {
  const revision = Math.max(0, Math.floor(Number(currentRevision) || 0)) + 1;
  const cadence = Math.max(1, Math.floor(Number(interval) || COLD_BACKUP_INTERVAL));
  return { revision, shouldBackup: revision % cadence === 0 };
}

export function createProjectFolderService({ mediaLibrary, store, bridge }) {
  let dirHandle = null;
  let autosaveTimer = null;
  let saveInFlight = false;
  let saveDrainPromise = null;
  const saveQueue = [];
  let lastSavedSignature = "";
  let lastDirectorySignature = "";
  let refreshInFlight = false;
  let isOpening = false;
  let historyInFlight = false;
  let projectLoadBlocked = false;
  let historyState = { canUndo: false, canRedo: false };
  let pendingHistory = false;
  let pendingSaveReason = "";
  let historyIndexReady = false;
  const revisionIndex = { undo: [], redo: [] };
  let coldBackupIndexReady = false;
  let coldBackupIndex = emptyColdBackupIndex();
  const thumbnailUrlLease = createThumbnailUrlLease();
  let fileObserver = null;
  let observedChangeQueue = Promise.resolve();
  let projectGeneration = 0;
  const writtenRenditions = new Set();
  const autosaveDelayMs = 700;
  const maxRevisionEntries = 500;
  const maxRevisionBytes = 512 * 1024 * 1024;
  const maxIndexedRenditions = 1000;
  const renditionIndexFilename = "index.json";
  let renditionIndexPaths = [];
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

  async function openFolder() {
    if (!window.showDirectoryPicker) return { fallback: true };
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
        resetHistoryIndex();
        resetColdBackupIndex();
        lastSavedSignature = "";
        lastDirectorySignature = "";
        projectGeneration++;
      }
      dirHandle = selectedHandle;
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
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
      await flushAutoSave("project-close-checkpoint");
    }
    if (saveDrainPromise) await saveDrainPromise;
    if (saveQueue.length) return false;
    stopFileObserver();
    projectGeneration++;
    dirHandle = null;
    saveInFlight = false;
    saveDrainPromise = null;
    saveQueue.length = 0;
    lastSavedSignature = "";
    lastDirectorySignature = "";
    projectLoadBlocked = false;
    writtenRenditions.clear();
    renditionIndexPaths = [];
    resetHistoryIndex();
    resetColdBackupIndex();
    mediaLibrary.clear();
    bridge.sendMediaFiles([]);
    await clearStoredHandle();
    setHistoryState(false, false);
    store.replace(createInitialState(), "project-close");
    thumbnailUrlLease.activate([]);
    bridge.sendState();
    return true;
  }

  async function refreshFolder({ force = false } = {}) {
    if (!dirHandle || isOpening || refreshInFlight) return false;
    refreshInFlight = true;
    try {
      const files = [...await collectProjectAssetFiles(dirHandle), ...await loadIndexedRenditions()];
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
    const files = [...await collectProjectAssetFiles(dirHandle), ...await loadIndexedRenditions()];
    const signature = directorySignature(files);
    const imported = await mediaLibrary.importFiles(files);
    const loaded = await loadProject(reason, imported, signature);
    if (!loaded) return false;
    bridge.sendMediaFiles(mediaLibrary.getAllFiles());
    await refreshHistoryState();
    return true;
  }

  async function loadProject(reason = "project-load", imported = { media: [], shaders: [] }, directorySig = "") {
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
    const currentUi = store.getState().ui;
    const recordingFrames = Array.isArray(projectData.recordingFrames)
      ? projectData.recordingFrames
      : store.getState().recordingFrames;
    const components = clearThumbnailUrls(Array.isArray(projectData.components) ? projectData.components : store.getState().components);
    applyThumbnailUrls(components, embeddedThumbnails);
    const loadedThumbnails = await loadComponentThumbnails(components);
    applyThumbnailUrls(components, loadedThumbnails.entries);
    const nextState = {
      ...store.getState(),
      ...projectData,
      components,
      recordingFrames,
      ui: {
        ...currentUi,
        selectedSceneId: projectUi?.selectedSceneId || currentUi.selectedSceneId,
        selectedSurfaceId: projectUi?.selectedSurfaceId || currentUi.selectedSurfaceId,
        selectedComponentId: projectUi?.selectedComponentId || currentUi.selectedComponentId,
        selectedChainItemId: projectUi?.selectedChainItemId || currentUi.selectedChainItemId,
        workspaceSelectionIds: projectUi?.workspaceSelectionIds || currentUi.workspaceSelectionIds,
        catalogSortModes: projectUi?.catalogSortModes || currentUi.catalogSortModes,
        previewQualities: projectUi?.previewQualities || currentUi.previewQualities,
        live: {
          ...currentUi.live,
          ...(projectUi?.live || {}),
          componentOverrides: currentUi.live?.componentOverrides || {},
        },
      },
      project: {
        ...store.getState().project,
        ...(projectData.project || {}),
        name: projectData.project?.name || dirHandle.name,
        folderName: dirHandle.name,
        warnings: projectFileFound ? [] : [`No project.json found in ${dirHandle.name}`],
      },
      media: mergeMediaCatalogMarkers(imported.media, projectData.media),
      shaders: imported.shaders[0]
        ? {
            ...(projectData.shaders || store.getState().shaders),
            customName: imported.shaders[0].name,
            customCode: imported.shaders[0].code,
          }
        : (projectData.shaders || store.getState().shaders),
    };
    const selectedScene = nextState.scenes?.find((scene) => scene.id === nextState.ui.selectedSceneId) || nextState.scenes?.[0];
    if (selectedScene) applySceneSnapshotToState(nextState, selectedScene);
    store.replace(nextState, reason);
    thumbnailUrlLease.activate(loadedThumbnails.urls);
    if (embeddedThumbnails.length) migrateEmbeddedThumbnailsToCache(embeddedThumbnails);
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
    const event = createChangeEvent(change);
    const reason = event.reason;
    if (event.phase === "edit" || event.phase === "scrub") return;
    if (!dirHandle || isOpening || projectLoadBlocked || skipAutosaveReasons.has(reason)) return;
    if (event.history === "record") {
      pendingHistory = true;
      pendingSaveReason = reason;
    } else if (!pendingSaveReason) {
      pendingSaveReason = reason;
    }
    if (autosaveTimer) clearTimeout(autosaveTimer);
    const delay = immediate || reason === "live:scene" || event.history === "record" ? 0 : autosaveDelayMs;
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null;
      flushAutoSave();
    }, delay);
  }

  async function flushAutoSave(reason = "") {
    if (!dirHandle) return false;
    const saveReason = reason || pendingSaveReason || "change";
    const recordHistory = pendingHistory || createChangeEvent(saveReason).history === "record";
    pendingHistory = false;
    pendingSaveReason = "";
    const payload = buildProjectPayload(store.getState(), new Date().toISOString());
    const json = JSON.stringify(payload, null, 2);
    saveQueue.push({ reason: saveReason, recordHistory, payload: JSON.parse(json), json });
    if (saveInFlight) return saveDrainPromise;
    saveInFlight = true;
    saveDrainPromise = (async () => {
      let saved = false;
      try {
        while (saveQueue.length) {
          const job = saveQueue.shift();
          try { saved = await saveProject(job) || saved; }
          catch (error) {
            saveQueue.unshift(job);
            throw error;
          }
        }
        return saved;
      } catch (error) {
        store.update((draft) => {
          draft.project.warnings = [`Autosave error: ${error.message || error}`];
        }, "project-autosave-error");
        return false;
      } finally {
        saveInFlight = false;
        saveDrainPromise = null;
      }
    })();
    return saveDrainPromise;
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
      await writeRevision(previousText, savedAt);
      if (!isHistoryReason(reason)) await clearRedoRevisions();
    }

    const writable = await handle.createWritable();
    await writable.write(json);
    await writable.close();
    if (recordsProjectRevision) {
      try {
        await recordColdBackup(json, savedAt);
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
      } else if (saveDrainPromise) await saveDrainPromise;
      if (saveQueue.length) return false;
      const entry = await latestRevisionEntry("undo");
      if (!entry) {
        await refreshHistoryState();
        return false;
      }
      const currentText = await readProjectText();
      const undoText = await (await entry.handle.getFile()).text();
      if (currentText.trim()) await writeRedoRevision(currentText, new Date().toISOString());
      await writeProjectText(undoText);
      await removeRevisionEntry(entry);
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
      if (saveDrainPromise) await saveDrainPromise;
      if (saveQueue.length) return false;
      const entry = await latestRevisionEntry("redo");
      if (!entry) {
        await refreshHistoryState();
        return false;
      }
      const currentText = await readProjectText();
      const redoText = await (await entry.handle.getFile()).text();
      if (currentText.trim()) await writeRevision(currentText, new Date().toISOString());
      await writeProjectText(redoText);
      await removeRevisionEntry(entry);
      await reloadProjectFromDisk("project-redo");
      return true;
    } finally {
      historyInFlight = false;
    }
  }

  function getHistoryState() {
    return { ...historyState };
  }

  async function writeRevision(text, savedAt) {
    await ensureHistoryIndex();
    const revisions = await dirHandle.getDirectoryHandle("revisions", { create: true });
    const suffix = Math.random().toString(36).slice(2, 7);
    const filename = `project-before-${safeTimestamp(savedAt)}-${suffix}.json`;
    const handle = await revisions.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    revisionIndex.undo.push({ parent: revisions, handle, name: filename, size: textByteLength(text) });
    revisionIndex.undo.sort(compareRevisionEntries);
    await pruneRevisionIndex("undo");
    setHistoryFromIndex();
  }

  async function writeRedoRevision(text, savedAt) {
    await ensureHistoryIndex();
    const redos = await getRedoDirectory({ create: true });
    const suffix = Math.random().toString(36).slice(2, 7);
    const filename = `project-redo-${safeTimestamp(savedAt)}-${suffix}.json`;
    const handle = await redos.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    revisionIndex.redo.push({ parent: redos, handle, name: filename, size: textByteLength(text) });
    revisionIndex.redo.sort(compareRevisionEntries);
    await pruneRevisionIndex("redo");
    setHistoryFromIndex();
  }

  async function recordColdBackup(projectJson, savedAt) {
    const projectHandle = dirHandle;
    if (!projectHandle) return false;
    await ensureColdBackupIndex(projectHandle);
    if (projectHandle !== dirHandle) return false;
    const checkpoint = nextColdBackupRevision(coldBackupIndex.revisionCount);
    let backupFilename = coldBackupIndex.lastBackupFilename || "";
    let lastBackupRevision = coldBackupIndex.lastBackupRevision || 0;
    const backupDirectory = await projectHandle.getDirectoryHandle(COLD_BACKUP_ROOT, { create: true });
    if (checkpoint.shouldBackup) {
      const suffix = Math.random().toString(36).slice(2, 7);
      backupFilename = `project-backup-${String(checkpoint.revision).padStart(9, "0")}-${safeTimestamp(savedAt)}-${suffix}.json`;
      await writeDirectoryTextFile(backupDirectory, backupFilename, projectJson);
      lastBackupRevision = checkpoint.revision;
    }
    const nextIndex = {
      version: 1,
      interval: COLD_BACKUP_INTERVAL,
      revisionCount: checkpoint.revision,
      lastBackupRevision,
      lastBackupFilename: backupFilename,
    };
    await writeDirectoryTextFile(backupDirectory, "index.json", JSON.stringify(nextIndex, null, 2));
    if (projectHandle !== dirHandle) return false;
    coldBackupIndex = nextIndex;
    return checkpoint.shouldBackup;
  }

  async function ensureColdBackupIndex(projectHandle = dirHandle) {
    if (coldBackupIndexReady || !projectHandle) return;
    let parsed = null;
    try {
      const directory = await projectHandle.getDirectoryHandle(COLD_BACKUP_ROOT);
      const handle = await directory.getFileHandle("index.json");
      parsed = JSON.parse(await (await handle.getFile()).text());
    } catch (error) {
      if (!isNotFoundError(error)) {
        console.warn("[VJ1_COLD_BACKUP_INDEX_INVALID]", {
          directory: COLD_BACKUP_ROOT,
          fallback: "restart milestone count and preserve all existing backup files",
          message: error?.message || String(error),
        });
      }
    }
    if (projectHandle !== dirHandle) return;
    coldBackupIndex = normalizeColdBackupIndex(parsed);
    coldBackupIndexReady = true;
  }

  function resetColdBackupIndex() {
    coldBackupIndexReady = false;
    coldBackupIndex = emptyColdBackupIndex();
  }

  async function clearRedoRevisions() {
    await ensureHistoryIndex();
    for (const entry of revisionIndex.redo.splice(0)) {
      await entry.parent.removeEntry(entry.name);
      await cooperativeYield();
    }
    setHistoryFromIndex();
  }

  async function latestRevisionEntry(kind) {
    await ensureHistoryIndex();
    const entries = revisionIndex[kind === "redo" ? "redo" : "undo"];
    return entries[entries.length - 1] || null;
  }

  async function removeRevisionEntry(entry) {
    await entry.parent.removeEntry(entry.name);
    for (const entries of [revisionIndex.undo, revisionIndex.redo]) {
      const index = entries.findIndex((candidate) => candidate.name === entry.name && candidate.parent === entry.parent);
      if (index >= 0) entries.splice(index, 1);
    }
    setHistoryFromIndex();
  }

  async function ensureHistoryIndex() {
    if (historyIndexReady || !dirHandle) return;
    resetHistoryIndex();
    const revisions = await getRevisionDirectory();
    if (revisions) await indexRevisionDirectory(revisions, revisionIndex.undo, /^project-before-.+\.json$/);
    const redos = await getRedoDirectory();
    if (redos) await indexRevisionDirectory(redos, revisionIndex.redo, /^project-redo-.+\.json$/);
    historyIndexReady = true;
    await pruneRevisionIndex("undo");
    await pruneRevisionIndex("redo");
    setHistoryFromIndex();
  }

  async function indexRevisionDirectory(directory, target, pattern) {
    let count = 0;
    for await (const entry of directory.values()) {
      if (entry.kind === "file" && pattern.test(entry.name)) target.push({ parent: directory, handle: entry, name: entry.name, size: -1 });
      if (++count % 100 === 0) await cooperativeYield();
    }
    target.sort(compareRevisionEntries);
  }

  async function pruneRevisionIndex(kind) {
    const entries = revisionIndex[kind];
    while (entries.length > maxRevisionEntries) {
      const entry = entries.shift();
      await entry.parent.removeEntry(entry.name);
      if (entries.length % 100 === 0) await cooperativeYield();
    }
    let totalBytes = 0;
    for (const entry of entries) {
      if (entry.size < 0) {
        try { entry.size = (await entry.handle.getFile()).size || 0; }
        catch (error) {
          console.warn("[VJ1_HISTORY_ENTRY_UNREADABLE]", { name: entry.name, fallback: "remove unreadable revision", message: error?.message || String(error) });
          entry.size = 0;
        }
      }
      totalBytes += entry.size;
      if (totalBytes % (32 * 1024 * 1024) < entry.size) await cooperativeYield();
    }
    while (entries.length && totalBytes > maxRevisionBytes) {
      const entry = entries.shift();
      totalBytes -= entry.size;
      await entry.parent.removeEntry(entry.name);
    }
    // Reaching the configured rolling-history limit is routine maintenance.
    // The observable history state is updated by the caller; console output
    // here would repeat after every edit once the rolling cap is full.
  }

  function resetHistoryIndex() {
    revisionIndex.undo.length = 0;
    revisionIndex.redo.length = 0;
    historyIndexReady = false;
  }

  function setHistoryFromIndex() {
    setHistoryState(revisionIndex.undo.length > 0, revisionIndex.redo.length > 0);
  }

  async function getRevisionDirectory({ create = false } = {}) {
    if (!dirHandle) return null;
    try {
      return await dirHandle.getDirectoryHandle("revisions", { create });
    } catch (error) {
      if (!isNotFoundError(error)) console.warn("[VJ1_HISTORY_DIRECTORY_UNAVAILABLE]", { directory: "revisions", fallback: "history disabled", message: error?.message || String(error) });
      return null;
    }
  }

  async function getRedoDirectory({ create = false } = {}) {
    const revisions = await getRevisionDirectory({ create });
    if (!revisions) return null;
    try {
      return await revisions.getDirectoryHandle("redos", { create });
    } catch (error) {
      if (!isNotFoundError(error)) console.warn("[VJ1_HISTORY_DIRECTORY_UNAVAILABLE]", { directory: "redos", fallback: "redo disabled", message: error?.message || String(error) });
      return null;
    }
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
    if (!dirHandle) {
      setHistoryState(false, false);
      return historyState;
    }
    await ensureHistoryIndex();
    setHistoryFromIndex();
    return historyState;
  }

  function setHistoryState(canUndo, canRedo) {
    historyState = { canUndo: !!canUndo, canRedo: !!canRedo };
    store.update((draft) => {
      draft.ui.canUndo = historyState.canUndo;
      draft.ui.canRedo = historyState.canRedo;
    }, "project-history");
  }

  async function writeMediaRendition(mediaId, width, height, blob, sourceRevision = "") {
    if (!dirHandle || !blob || !mediaId) return false;
    const projectHandle = dirHandle;
    const path = mediaRenditionPath(mediaId, width, height, sourceRevision);
    if (writtenRenditions.has(path)) return false;
    const directory = await renditionDirectory(projectHandle);
    const filename = path.split("/").pop();
    const handle = await directory.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    if (projectHandle !== dirHandle) return false;
    writtenRenditions.add(path);
    await indexRendition(path, projectHandle);
    if (projectHandle !== dirHandle) return false;
    const file = await handle.getFile();
    Object.defineProperty(file, "relativePath", { value: path, configurable: true });
    await mediaLibrary.importFiles([file]);
    bridge.sendMediaFiles(mediaLibrary.getAllFiles());
    return true;
  }

  async function renditionDirectory(projectHandle = dirHandle) {
    const root = await projectHandle.getDirectoryHandle(RENDITION_ROOT, { create: true });
    return await root.getDirectoryHandle(RENDITION_DIR, { create: true });
  }

  async function loadIndexedRenditions() {
    const projectHandle = dirHandle;
    renditionIndexPaths = [];
    let directory = null;
    try {
      const root = await projectHandle.getDirectoryHandle(RENDITION_ROOT);
      directory = await root.getDirectoryHandle(RENDITION_DIR);
      const indexHandle = await directory.getFileHandle(renditionIndexFilename);
      const parsed = JSON.parse(await (await indexHandle.getFile()).text());
      const indexedPaths = Array.isArray(parsed?.paths)
        ? parsed.paths.filter(isValidRenditionIndexPath).slice(-maxIndexedRenditions)
        : [];
      if (projectHandle !== dirHandle) return [];
      renditionIndexPaths = indexedPaths;
    } catch (error) {
      if (!isNotFoundError(error) && !(error instanceof SyntaxError)) {
        console.warn("[VJ1_RENDITION_INDEX_READ_FAILED]", { fallback: "regenerate renditions on demand", message: error?.message || String(error) });
      } else if (error instanceof SyntaxError) {
        console.warn("[VJ1_RENDITION_INDEX_INVALID]", { fallback: "regenerate renditions on demand", message: error.message });
      }
      return [];
    }
    const files = [];
    let missing = 0;
    let count = 0;
    for (const path of renditionIndexPaths) {
      if (projectHandle !== dirHandle) return [];
      try {
        const handle = await directory.getFileHandle(path.split("/").pop());
        const file = await handle.getFile();
        Object.defineProperty(file, "relativePath", { value: path, configurable: true });
        files.push(file);
        writtenRenditions.add(path);
      } catch (error) {
        if (isNotFoundError(error)) missing++;
        else console.warn("[VJ1_RENDITION_INDEX_ENTRY_FAILED]", { path, fallback: "regenerate rendition on demand", message: error?.message || String(error) });
      }
      if (++count % 64 === 0) await cooperativeYield();
    }
    if (missing) console.info("[VJ1_RENDITION_INDEX_STALE]", { missing, fallback: "regenerate missing renditions on demand" });
    return files;
  }

  async function indexRendition(path, projectHandle = dirHandle) {
    const nextPaths = renditionIndexPaths.filter((entry) => entry !== path);
    nextPaths.push(path);
    const evicted = nextPaths.splice(0, Math.max(0, nextPaths.length - maxIndexedRenditions));
    const directory = await renditionDirectory(projectHandle);
    const handle = await directory.getFileHandle(renditionIndexFilename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify({ version: 1, paths: nextPaths }, null, 2));
    await writable.close();
    for (const oldPath of evicted) {
      try { await directory.removeEntry(oldPath.split("/").pop()); }
      catch (error) { if (!isNotFoundError(error)) console.warn("[VJ1_RENDITION_CACHE_EVICT_FAILED]", { path: oldPath, message: error?.message || String(error) }); }
      if (projectHandle === dirHandle) writtenRenditions.delete(oldPath);
    }
    if (projectHandle === dirHandle) renditionIndexPaths = nextPaths;
  }

  async function writeComponentThumbnail(componentId, frameId, dataUrl) {
    if (!dirHandle || !componentId || !dataUrl) return false;
    const projectHandle = dirHandle;
    const blob = thumbnailDataUrlToBlob(dataUrl);
    const extension = thumbnailExtension(blob);
    const directory = await thumbnailDirectory({ create: true, projectHandle });
    const filename = componentThumbnailFilename(componentId, frameId, extension);
    const handle = await directory.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    const alternate = componentThumbnailFilename(componentId, frameId, extension === "png" ? "webp" : "png");
    try { await directory.removeEntry(alternate); } catch (error) {
      if (!isNotFoundError(error)) console.warn("[VJ1_STALE_THUMBNAIL_REMOVE_FAILED]", { filename: alternate, message: error?.message || String(error) });
    }
    return true;
  }

  async function migrateEmbeddedThumbnailsToCache(entries) {
    for (const entry of entries || []) {
      try { await writeComponentThumbnail(entry.componentId, entry.frameId, entry.url); }
      catch (error) {
        console.warn("[VJ1_EMBEDDED_THUMBNAIL_MIGRATION_FAILED]", {
          componentId: entry.componentId,
          frameId: entry.frameId,
          fallback: "regenerate this thumbnail on demand",
          message: error?.message || String(error),
        });
      }
      await cooperativeYield();
    }
  }

  async function loadComponentThumbnails(components = []) {
    const componentIds = new Set((components || []).map((component) => String(component.id)));
    const directory = await thumbnailDirectory();
    if (!directory) return { entries: [], urls: new Set() };
    const entries = [];
    const urls = new Set();
    let count = 0;
    for await (const handle of directory.values()) {
      const parsed = handle.kind === "file" ? parseComponentThumbnailFilename(handle.name) : null;
      if (parsed && componentIds.has(String(parsed.componentId))) {
        try {
          const url = URL.createObjectURL(await handle.getFile());
          urls.add(url);
          entries.push({ ...parsed, url });
        } catch (error) {
          console.warn("[VJ1_THUMBNAIL_READ_FAILED]", { filename: handle.name, fallback: "regenerate thumbnail on demand", message: error?.message || String(error) });
        }
      }
      if (++count % 64 === 0) await cooperativeYield();
    }
    return { entries, urls };
  }

  async function thumbnailDirectory({ create = false, projectHandle = dirHandle } = {}) {
    if (!projectHandle) return null;
    try {
      const root = await projectHandle.getDirectoryHandle(THUMBNAIL_ROOT, { create });
      return await root.getDirectoryHandle(THUMBNAIL_DIR, { create });
    } catch (error) {
      if (!isNotFoundError(error)) console.warn("[VJ1_THUMBNAIL_DIRECTORY_UNAVAILABLE]", { fallback: "regenerate thumbnails in memory", message: error?.message || String(error) });
      return null;
    }
  }

  function startFileObserver() {
    stopFileObserver();
    const Observer = globalThis.FileSystemObserver;
    if (!Observer || !dirHandle) {
      console.info("[VJ1_FILE_OBSERVER_UNAVAILABLE]", { fallback: "use the Media refresh button for external folder changes" });
      return;
    }
    try {
      const observerGeneration = projectGeneration;
      fileObserver = new Observer((records) => {
        observedChangeQueue = observedChangeQueue
          .then(() => observerGeneration === projectGeneration ? applyObservedChanges(records, observerGeneration) : undefined)
          .catch((error) => console.warn("[VJ1_FILE_OBSERVER_UPDATE_FAILED]", { fallback: "use the Media refresh button", message: error?.message || String(error) }));
      });
      Promise.resolve(fileObserver.observe(dirHandle, { recursive: true })).catch((error) => {
        console.warn("[VJ1_FILE_OBSERVER_START_FAILED]", { fallback: "use the Media refresh button", message: error?.message || String(error) });
        stopFileObserver();
      });
    } catch (error) {
      console.warn("[VJ1_FILE_OBSERVER_START_FAILED]", { fallback: "use the Media refresh button", message: error?.message || String(error) });
      stopFileObserver();
    }
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
    store.updateDerived((draft) => {
      const byId = new Map((draft.media || []).map((item) => [item.id, item]));
      for (const item of imported.media || []) {
        const previous = byId.get(item.id);
        byId.set(item.id, {
          ...item,
          catalogMarker: previous?.catalogMarker ?? item.catalogMarker ?? 0,
        });
      }
      draft.media = Array.from(byId.values());
      if (imported.shaders?.[0]) {
        draft.shaders = { ...draft.shaders, customName: imported.shaders[0].name, customCode: imported.shaders[0].code };
      }
    }, "project-observed-asset-update");
    if (imported.shaders?.length) bridge.sendState();
  }

  function markManualRefreshNeeded(path, eventType) {
    store.updateDerived((draft) => {
      draft.project.warnings = [`Folder change (${eventType}) at ${path} needs a manual Media refresh.`];
    }, "project-observer-refresh-needed");
  }

  return { openFolder, restoreStoredFolder, closeProject, saveProject, scheduleAutoSave, flushAutoSave, importExternalFiles, refreshFolder, undoProject, redoProject, getHistoryState, writeMediaRendition, writeComponentThumbnail };
}

function mergeMediaCatalogMarkers(imported = [], authored = []) {
  const markers = new Map((Array.isArray(authored) ? authored : []).map((item) => [item.id, item.catalogMarker ?? 0]));
  return (Array.isArray(imported) ? imported : []).map((item) => ({
    ...item,
    catalogMarker: markers.get(item.id) ?? item.catalogMarker ?? 0,
  }));
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

function safeTimestamp(value) {
  return String(value || new Date().toISOString()).replace(/[:.]/g, "-");
}

function embeddedThumbnailEntries(components = []) {
  const entries = [];
  for (const component of components || []) {
    if (typeof component?.thumbnail === "string" && component.thumbnail.startsWith("data:image/")) {
      entries.push({ componentId: component.id, frameId: "", url: component.thumbnail });
    }
    for (const [frameId, url] of Object.entries(component?.canvas?.frameThumbnails || {})) {
      if (typeof url === "string" && url.startsWith("data:image/")) entries.push({ componentId: component.id, frameId, url });
    }
  }
  return entries;
}

function compareRevisionEntries(a, b) {
  return a.name.localeCompare(b.name);
}

function textByteLength(text = "") {
  return new Blob([text]).size;
}

function emptyColdBackupIndex() {
  return { version: 1, interval: COLD_BACKUP_INTERVAL, revisionCount: 0, lastBackupRevision: 0, lastBackupFilename: "" };
}

function normalizeColdBackupIndex(value) {
  if (!value || typeof value !== "object") return emptyColdBackupIndex();
  return {
    version: 1,
    interval: COLD_BACKUP_INTERVAL,
    revisionCount: Math.max(0, Math.floor(Number(value.revisionCount) || 0)),
    lastBackupRevision: Math.max(0, Math.floor(Number(value.lastBackupRevision) || 0)),
    lastBackupFilename: typeof value.lastBackupFilename === "string" ? value.lastBackupFilename : "",
  };
}

async function writeDirectoryTextFile(directory, filename, text) {
  const handle = await directory.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
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

function isValidRenditionIndexPath(path = "") {
  return isMediaRenditionPath(path) && !String(path).slice(`${RENDITION_ROOT}/${RENDITION_DIR}/`.length).includes("/");
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
