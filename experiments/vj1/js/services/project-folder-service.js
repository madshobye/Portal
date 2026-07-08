import { collectFilesFromDirectory } from "./media-library-service.js";

export function createProjectFolderService({ mediaLibrary, store, bridge }) {
  let dirHandle = null;

  async function openFolder() {
    if (!window.showDirectoryPicker) return { fallback: true };
    dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
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
  }

  async function loadProject() {
    if (!dirHandle) return;
    try {
      const handle = await dirHandle.getFileHandle("project.json");
      const data = JSON.parse(await (await handle.getFile()).text());
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
    } catch {
      store.update((draft) => {
        draft.project.warnings = [`No project.json found in ${dirHandle.name}`];
      }, "project-load-missing");
    }
  }

  async function saveProject() {
    const state = store.getState();
    const payload = {
      version: state.version,
      project: { ...state.project, savedAt: new Date().toISOString() },
      global: state.global,
      render: state.render,
      media: state.media,
      layers: state.layers,
      surfaces: state.surfaces,
      scenes: state.scenes,
      mappings: state.mappings,
      shaders: state.shaders,
    };

    if (!dirHandle) {
      downloadJson("project.json", payload);
      return;
    }

    const handle = await dirHandle.getFileHandle("project.json", { create: true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(payload, null, 2));
    await writable.close();
    store.update((draft) => {
      draft.project.savedAt = payload.project.savedAt;
    }, "project-save");
  }

  return { openFolder, saveProject };
}

function mergeMedia(current, incoming) {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}
