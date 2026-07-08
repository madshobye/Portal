import { collectFilesFromDirectory } from "./media-library-service.js";

export function createProjectFolderService({ mediaLibrary, store, bridge }) {
  let dirHandle = null;
  let autosaveTimer = null;
  let saveInFlight = false;
  let saveQueued = false;
  let lastSavedSignature = "";
  let isOpening = false;
  const autosaveDelayMs = 700;
  const skipAutosaveReasons = new Set([
    "init",
    "view",
    "output-metrics",
    "project-load",
    "project-autosave",
    "project-autosave-status",
    "project-autosave-error",
  ]);

  async function openFolder() {
    if (!window.showDirectoryPicker) return { fallback: true };
    isOpening = true;
    let opened = false;
    try {
      dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
      opened = true;
      const files = await collectFilesFromDirectory(dirHandle);
      const imported = await mediaLibrary.importFiles(files);
      store.update((draft) => {
        draft.project.name = dirHandle.name;
        draft.project.folderName = dirHandle.name;
        draft.media = mergeMedia(draft.media, imported.media);
        if (imported.shaders[0]) {
          draft.shaders.customName = imported.shaders[0].name;
          draft.shaders.customCode = imported.shaders[0].code;
        }
      }, "project-open-media");
      await loadProject();
      bridge.sendMediaFiles(mediaLibrary.getAllFiles());
      return { fallback: false };
    } finally {
      isOpening = false;
      if (opened) scheduleAutoSave("project-open", { immediate: true });
    }
  }

  async function loadProject() {
    if (!dirHandle) return;
    try {
      const handle = await dirHandle.getFileHandle("project.json");
      const text = await (await handle.getFile()).text();
      const data = JSON.parse(text);
      store.replace(
        {
          ...store.getState(),
          ...data,
          project: {
            ...store.getState().project,
            ...(data.project || {}),
            name: data.project?.name || dirHandle.name,
            folderName: dirHandle.name,
          },
        },
        "project-load"
      );
      lastSavedSignature = payloadSignature(buildPayload(store.getState(), data.project?.savedAt || ""));
    } catch {
      store.update((draft) => {
        draft.project.warnings = [`No project.json found in ${dirHandle.name}`];
      }, "project-load-missing");
    }
  }

  function scheduleAutoSave(reason = "change", { immediate = false } = {}) {
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
    const payload = buildPayload(state, savedAt);
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

    if (previousText.trim() && previousText !== json) {
      await writeRevision(previousText, savedAt);
    }

    const writable = await handle.createWritable();
    await writable.write(json);
    await writable.close();
    lastSavedSignature = signature;
    store.update((draft) => {
      draft.project.savedAt = payload.project.savedAt;
      draft.project.warnings = [];
      draft.ui.mappingStatus = reason === "mapping-state" ? "Mapping autosaved" : draft.ui.mappingStatus;
    }, "project-autosave");
    return true;
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

  return { openFolder, saveProject, scheduleAutoSave, flushAutoSave };
}

function buildPayload(state, savedAt = new Date().toISOString()) {
  return {
    version: state.version,
    project: { ...state.project, warnings: [], savedAt },
    global: state.global,
    render: state.render,
    media: state.media,
    layers: state.layers,
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

function safeTimestamp(value) {
  return String(value || new Date().toISOString()).replace(/[:.]/g, "-");
}

function mergeMedia(current, incoming) {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}
