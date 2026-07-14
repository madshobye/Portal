import { collectFilesFromDirectory, isMediaFile, isShaderFile } from "./media-library-service.js?v=live-program-1";
import { RENDITION_DIR, RENDITION_ROOT, mediaRenditionPath } from "./media-rendition-service.js";
import {
  canPersistDirectoryHandles,
  clearProjectDirectoryHandle,
  loadProjectDirectoryHandle,
  saveProjectDirectoryHandle,
} from "./directory-handle-store.js";
import { applySceneSnapshotToState, createInitialState } from "../domain/models.js?v=live-program-1";

export function createProjectFolderService({ mediaLibrary, store, bridge }) {
  let dirHandle = null;
  let autosaveTimer = null;
  let saveInFlight = false;
  let saveQueued = false;
  let lastSavedSignature = "";
  let lastDirectorySignature = "";
  let refreshInFlight = false;
  let isOpening = false;
  let historyInFlight = false;
  let historyState = { canUndo: false, canRedo: false };
  let lastRevisionGroup = { key: "", at: 0 };
  const writtenRenditions = new Set();
  const autosaveDelayMs = 700;
  const revisionCoalesceMs = 6000;
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
    "project-history",
    "project-undo",
    "project-redo",
    "live:scene",
    "live:update",
    ]);

  async function openFolder() {
    if (!window.showDirectoryPicker) return { fallback: true };
    isOpening = true;
    let opened = false;
    try {
      const storedHandle = dirHandle ? null : await loadStoredHandle();
      if (storedHandle && await verifyPermission(storedHandle, "readwrite", true)) {
        dirHandle = storedHandle;
      } else {
        dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
      }
      opened = true;
      await saveStoredHandle(dirHandle);
      await ensureProjectScaffold(dirHandle);
      await loadDirectory("project-open-media");
      return { fallback: false };
    } finally {
      isOpening = false;
      if (opened) scheduleAutoSave("project-open", { immediate: true });
    }
  }

  async function restoreStoredFolder() {
    if (!canPersistDirectoryHandles()) return false;
    isOpening = true;
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
      await ensureProjectScaffold(dirHandle);
      await loadDirectory("project-restore-media");
      return true;
    } finally {
      isOpening = false;
    }
  }

  async function importExternalFiles(fileList) {
    const files = Array.from(fileList || []).filter((file) => file?.name);
    if (!files.length) return { imported: 0 };
    if (!dirHandle) {
      return { needsFolder: true };
    }

    let imported = 0;
    for (const file of files) {
      const path = file.relativePath || file.webkitRelativePath || file.name || "";
      const rootName = isShaderFile(path) ? "shaders" : isMediaFile(path) ? "media" : "";
      if (!rootName) continue;
      await writeFileIntoProject(dirHandle, file, rootName, path);
      imported++;
    }
    if (imported) await loadDirectory("project-import-files");
    return { imported };
  }

  async function closeProject() {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
    dirHandle = null;
    saveInFlight = false;
    saveQueued = false;
    lastSavedSignature = "";
    lastDirectorySignature = "";
    writtenRenditions.clear();
    mediaLibrary.clear();
    bridge.sendMediaFiles([]);
    await clearStoredHandle();
    setHistoryState(false, false);
    store.replace(createInitialState(), "project-close");
    bridge.sendState();
    return true;
  }

  async function refreshFolder({ force = false } = {}) {
    if (!dirHandle || isOpening || refreshInFlight) return false;
    refreshInFlight = true;
    try {
      const files = await collectFilesFromDirectory(dirHandle);
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
    const files = await collectFilesFromDirectory(dirHandle);
    const signature = directorySignature(files);
    const imported = await mediaLibrary.importFiles(files);
      await loadProject(reason, imported, signature);
      bridge.sendMediaFiles(mediaLibrary.getAllFiles());
      await refreshHistoryState();
  }

  async function loadProject(reason = "project-load", imported = { media: [], shaders: [] }, directorySig = "") {
    if (!dirHandle) return;
    let data = {};
    try {
      const handle = await dirHandle.getFileHandle("project.json");
      const text = await (await handle.getFile()).text();
      data = JSON.parse(text);
    } catch {
      data = {};
    }
    const { ui: projectUi, metrics: _projectMetrics, ...projectData } = data;
    const currentUi = store.getState().ui;
    const nextState = {
      ...store.getState(),
      ...projectData,
      ui: {
        ...currentUi,
        selectedSceneId: projectUi?.selectedSceneId || currentUi.selectedSceneId,
        selectedSurfaceId: projectUi?.selectedSurfaceId || currentUi.selectedSurfaceId,
        selectedCompositionId: projectUi?.selectedCompositionId || currentUi.selectedCompositionId,
        selectedChainItemId: projectUi?.selectedChainItemId || currentUi.selectedChainItemId,
        live: {
          ...currentUi.live,
          ...(projectUi?.live || {}),
          compositionOverrides: currentUi.live?.compositionOverrides || {},
        },
      },
      project: {
        ...store.getState().project,
        ...(projectData.project || {}),
        name: projectData.project?.name || dirHandle.name,
        folderName: dirHandle.name,
        warnings: projectData.version ? [] : [`No project.json found in ${dirHandle.name}`],
      },
      media: imported.media,
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
    lastDirectorySignature = directorySig;
    lastSavedSignature = payloadSignature(buildProjectPayload(store.getState(), projectData.project?.savedAt || ""));
  }

  function refreshProjectAssets(imported = { media: [], shaders: [] }, directorySig = "") {
    store.update((draft) => {
      draft.project.folderName = dirHandle?.name || draft.project.folderName;
      draft.media = imported.media;
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

  function scheduleAutoSave(reason = "change", { immediate = false } = {}) {
    if (String(reason).startsWith("edit:") || String(reason).startsWith("scrub:")) return;
    if (!dirHandle || isOpening || skipAutosaveReasons.has(reason)) return;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null;
      flushAutoSave(reason);
    }, immediate ? 0 : autosaveDelayMs);
  }

  async function flushAutoSave(reason = "change") {
    if (!dirHandle) return false;
    if (saveInFlight) {
      saveQueued = true;
      return false;
    }
    saveInFlight = true;
    try {
      return await saveProject({ reason });
    } catch (error) {
      store.update((draft) => {
        draft.project.warnings = [`Autosave error: ${error.message || error}`];
      }, "project-autosave-error");
      return false;
    } finally {
      saveInFlight = false;
      if (saveQueued) {
        saveQueued = false;
        scheduleAutoSave("queued-autosave");
      }
    }
  }

  async function saveProject({ reason = "manual" } = {}) {
    const state = store.getState();
    const savedAt = new Date().toISOString();
    const payload = buildProjectPayload(state, savedAt);
    const signature = payloadSignature(payload);
    if (signature === lastSavedSignature) return false;

    if (!dirHandle) {
      return false;
    }

    const json = JSON.stringify(payload, null, 2);
    let handle = null;
    let previousText = "";
    try {
      handle = await dirHandle.getFileHandle("project.json");
      previousText = await (await handle.getFile()).text();
    } catch {
      handle = await dirHandle.getFileHandle("project.json", { create: true });
    }

    if (shouldWriteHistoryRevision(previousText, payload, json, reason)) {
      const group = historyGroupForReason(reason);
      const now = Date.now();
      const coalesced = shouldCoalesceHistoryRevision(lastRevisionGroup, group, now, revisionCoalesceMs);
      if (!coalesced) await writeRevision(previousText, savedAt);
      lastRevisionGroup = { key: group, at: now };
      if (!isHistoryReason(reason) && !coalesced) await clearRedoRevisions();
    }

    const writable = await handle.createWritable();
    await writable.write(json);
    await writable.close();
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
      }
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
      lastRevisionGroup = { key: "", at: 0 };
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
      lastRevisionGroup = { key: "", at: 0 };
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
    const revisions = await dirHandle.getDirectoryHandle("revisions", { create: true });
    const suffix = Math.random().toString(36).slice(2, 7);
    const filename = `project-before-${safeTimestamp(savedAt)}-${suffix}.json`;
    const handle = await revisions.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
  }

  async function writeRedoRevision(text, savedAt) {
    const redos = await getRedoDirectory({ create: true });
    const suffix = Math.random().toString(36).slice(2, 7);
    const filename = `project-redo-${safeTimestamp(savedAt)}-${suffix}.json`;
    const handle = await redos.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
  }

  async function clearRedoRevisions() {
    const redos = await getRedoDirectory();
    if (!redos) return;
    for await (const entry of redos.values()) {
      if (entry.kind === "file" && entry.name.endsWith(".json")) {
        await redos.removeEntry(entry.name);
      }
    }
    await refreshHistoryState();
  }

  async function latestRevisionEntry(kind) {
    const entries = kind === "redo" ? await redoRevisionEntries() : await undoRevisionEntries();
    return entries[entries.length - 1] || null;
  }

  async function undoRevisionEntries() {
    const revisions = await getRevisionDirectory();
    if (!revisions) return [];
    const entries = [];
    for await (const entry of revisions.values()) {
      if (entry.kind === "file" && /^project-before-.+\.json$/.test(entry.name)) {
        entries.push({ parent: revisions, handle: entry, name: entry.name });
      }
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function redoRevisionEntries() {
    const redos = await getRedoDirectory();
    if (!redos) return [];
    const entries = [];
    for await (const entry of redos.values()) {
      if (entry.kind === "file" && /^project-redo-.+\.json$/.test(entry.name)) {
        entries.push({ parent: redos, handle: entry, name: entry.name });
      }
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function removeRevisionEntry(entry) {
    await entry.parent.removeEntry(entry.name);
  }

  async function getRevisionDirectory({ create = false } = {}) {
    if (!dirHandle) return null;
    try {
      return await dirHandle.getDirectoryHandle("revisions", { create });
    } catch {
      return null;
    }
  }

  async function getRedoDirectory({ create = false } = {}) {
    const revisions = await getRevisionDirectory({ create });
    if (!revisions) return null;
    try {
      return await revisions.getDirectoryHandle("redos", { create });
    } catch {
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
    mediaLibrary.clear();
    const files = await collectFilesFromDirectory(dirHandle);
    const signature = directorySignature(files);
    const imported = await mediaLibrary.importFiles(files);
    await loadProject(reason, imported, signature);
    bridge.sendMediaFiles(mediaLibrary.getAllFiles());
    await refreshHistoryState();
    bridge.sendState();
  }

  async function refreshHistoryState() {
    if (!dirHandle) {
      setHistoryState(false, false);
      return historyState;
    }
    const [undos, redos] = await Promise.all([undoRevisionEntries(), redoRevisionEntries()]);
    setHistoryState(undos.length > 0, redos.length > 0);
    return historyState;
  }

  function setHistoryState(canUndo, canRedo) {
    historyState = { canUndo: !!canUndo, canRedo: !!canRedo };
    store.update((draft) => {
      draft.ui.canUndo = historyState.canUndo;
      draft.ui.canRedo = historyState.canRedo;
    }, "project-history");
  }

  async function writeMediaRendition(mediaId, width, height, blob) {
    if (!dirHandle || !blob || !mediaId) return false;
    const path = mediaRenditionPath(mediaId, width, height);
    if (writtenRenditions.has(path)) return false;
    const directory = await renditionDirectory();
    const filename = path.split("/").pop();
    const handle = await directory.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    writtenRenditions.add(path);
    const file = await handle.getFile();
    Object.defineProperty(file, "relativePath", { value: path, configurable: true });
    await mediaLibrary.importFiles([file]);
    bridge.sendMediaFiles(mediaLibrary.getAllFiles());
    return true;
  }

  async function renditionDirectory() {
    const root = await dirHandle.getDirectoryHandle(RENDITION_ROOT, { create: true });
    return await root.getDirectoryHandle(RENDITION_DIR, { create: true });
  }

  return { openFolder, restoreStoredFolder, closeProject, saveProject, scheduleAutoSave, flushAutoSave, importExternalFiles, refreshFolder, undoProject, redoProject, getHistoryState, writeMediaRendition };
}

async function ensureProjectScaffold(handle) {
  if (!handle?.getDirectoryHandle) return;
  for (const name of ["media", "shaders", "scenes", "mappings", RENDITION_ROOT]) {
    await handle.getDirectoryHandle(name, { create: true });
  }
}

function isHistoryReason(reason) {
  return ["history-checkpoint", "project-undo", "project-redo"].includes(reason);
}

function shouldWriteHistoryRevision(previousText = "", nextPayload = {}, nextText = "", reason = "") {
  if (reason === "composition-thumbnail") return false;
  if (!previousText.trim() || previousText === nextText) return false;
  const previousPayload = parseProjectText(previousText);
  if (!previousPayload) return true;
  return projectHistorySignature(previousPayload) !== projectHistorySignature(nextPayload);
}

export function projectHistorySignature(payload = {}) {
  const {
    ui: _ui,
    metrics: _metrics,
    ...rest
  } = payload || {};
  return JSON.stringify({
    ...rest,
    project: {
      ...(rest.project || {}),
      savedAt: "",
      warnings: [],
    },
  });
}

export function historyGroupForReason(reason = "") {
  const value = String(reason || "change");
  if (isHistoryReason(value)) return value;
  const separator = value.indexOf(":");
  if (separator === -1) return value;
  const kind = value.slice(0, separator);
  const path = value.slice(separator + 1);
  if (kind === "update" || kind === "color" || kind === "toggle" || kind === "live") return `${kind}:${path}`;
  return value;
}

export function shouldCoalesceHistoryRevision(lastGroup = {}, nextKey = "", now = Date.now(), windowMs = 6000) {
  if (!nextKey || isHistoryReason(nextKey)) return false;
  if (!lastGroup?.key || lastGroup.key !== nextKey) return false;
  return Math.max(0, Number(now) || 0) - Math.max(0, Number(lastGroup.at) || 0) <= windowMs;
}

function parseProjectText(text = "") {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function loadStoredHandle() {
  if (!canPersistDirectoryHandles()) return null;
  try {
    return await loadProjectDirectoryHandle();
  } catch {
    return null;
  }
}

async function saveStoredHandle(handle) {
  if (!handle || !canPersistDirectoryHandles()) return;
  try {
    await saveProjectDirectoryHandle(handle);
  } catch {
    // The app can still run with the active handle; only refresh restore is lost.
  }
}

async function clearStoredHandle() {
  if (!canPersistDirectoryHandles()) return;
  try {
    await clearProjectDirectoryHandle();
  } catch {
    // Closing the in-memory project is still valid if handle persistence cleanup fails.
  }
}

async function queryPermission(handle, mode) {
  if (!handle?.queryPermission) return "granted";
  try {
    return await handle.queryPermission({ mode });
  } catch {
    return "prompt";
  }
}

async function verifyPermission(handle, mode, requestIfNeeded) {
  const permission = await queryPermission(handle, mode);
  if (permission === "granted") return true;
  if (!requestIfNeeded || !handle?.requestPermission) return false;
  try {
    return await handle.requestPermission({ mode }) === "granted";
  } catch {
    return false;
  }
}

export function buildProjectPayload(state, savedAt = new Date().toISOString()) {
  return {
    version: state.version,
    project: { ...state.project, warnings: [], savedAt },
    ui: {
      selectedSceneId: state.ui.selectedSceneId,
      selectedSurfaceId: state.ui.selectedSurfaceId,
      selectedCompositionId: state.ui.selectedCompositionId,
      selectedChainItemId: state.ui.selectedChainItemId,
      live: {
        selectedSceneId: state.ui.live?.selectedSceneId || "",
        sceneSnapshot: state.ui.live?.sceneSnapshot || null,
      },
    },
    global: state.global,
    render: state.render,
    scheduler: state.scheduler,
    media: state.media,
    compositions: state.compositions,
    surfaces: state.surfaces,
    scenes: state.scenes,
    mappings: state.mappings,
    shaders: state.shaders,
  };
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

async function writeFileIntoProject(projectDirHandle, file, rootName, sourcePath) {
  let directory = await currentDirectoryForPath(projectDirHandle, rootName, sourcePath);
  const originalName = safeFilename((sourcePath || file.name).split("/").pop() || file.name || "file");
  const filename = await uniqueFilename(directory, originalName);
  const handle = await directory.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  await writable.write(file);
  await writable.close();
}

async function currentDirectoryForPath(projectDirHandle, rootName, sourcePath) {
  let directory = await projectDirHandle.getDirectoryHandle(rootName, { create: true });
  const parts = String(sourcePath || "").split("/").filter(Boolean).slice(0, -1);
  for (const part of parts) {
    directory = await directory.getDirectoryHandle(safeFilename(part), { create: true });
  }
  return directory;
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
  } catch {
    return false;
  }
}

function safeFilename(value) {
  return String(value || "file")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/^\.+$/, "file")
    .trim() || "file";
}
