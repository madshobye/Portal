import { createAppState } from "./app-state.js";
import { createControlShell } from "./control/control-shell-controller.js?v=scene-snapshots-48";
import { getInitialView, getClientMode } from "./view-routing.js";
import { loadPersistedState, persistState } from "./services/state-persistence-service.js";
import { createMediaLibrary } from "./services/media-library-service.js";
import { createProjectFolderService } from "./services/project-folder-service.js?v=scene-snapshots-48";
import { createControlBridge } from "./services/output-bridge-service.js";
import { installOutputApp } from "./output/output-app.js?v=scene-snapshots-48";

const root = document.getElementById("app");
const mode = getClientMode();

if (mode === "output" || mode === "preview" || mode === "composition") {
  installOutputApp({ root, mode });
} else {
  const initial = loadPersistedState();
  const store = createAppState(initial);
  store.setView(getInitialView());
  const mediaLibrary = createMediaLibrary();
  const bridge = createControlBridge({ store, mediaLibrary });
  const projectService = createProjectFolderService({ mediaLibrary, store, bridge });
  let bridgeScrubTimer = null;
  createControlShell({ root, store, bridge, mediaLibrary, projectService }).mount();

  store.subscribe((state, reason) => {
    persistState(state);
    projectService.scheduleAutoSave(reason);
    if (String(reason).startsWith("edit:")) {
      return;
    }
    if (String(reason).startsWith("scrub:")) {
      clearTimeout(bridgeScrubTimer);
      bridgeScrubTimer = setTimeout(() => bridge.sendState(), 90);
      return;
    }
    if (!["init", "output-metrics", "view", "project-autosave", "project-autosave-error"].includes(reason)) {
      bridge.sendState();
    }
  });
  projectService.restoreStoredFolder();
  window.addEventListener("focus", () => projectService.refreshFolder());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") projectService.refreshFolder();
  });
  setInterval(() => projectService.refreshFolder(), 5000);
}
