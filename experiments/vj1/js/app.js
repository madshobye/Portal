import { createAppState } from "./app-state.js";
import { createControlShell } from "./control/control-shell-controller.js?v=reset-surface-1";
import { getInitialView, getClientMode } from "./view-routing.js";
import { loadPersistedState, persistState } from "./services/state-persistence-service.js";
import { createMediaLibrary } from "./services/media-library-service.js";
import { createProjectFolderService } from "./services/project-folder-service.js";
import { createControlBridge } from "./services/output-bridge-service.js";
import { installOutputApp } from "./output/output-app.js?v=reset-surface-1";

const root = document.getElementById("app");
const mode = getClientMode();

if (mode === "output" || mode === "preview") {
  installOutputApp({ root, mode });
} else {
  const initial = loadPersistedState();
  const store = createAppState(initial);
  store.setView(getInitialView());
  const mediaLibrary = createMediaLibrary();
  const bridge = createControlBridge({ store, mediaLibrary });
  const projectService = createProjectFolderService({ mediaLibrary, store, bridge });
  createControlShell({ root, store, bridge, mediaLibrary, projectService }).mount();

  store.subscribe((state, reason) => {
    persistState(state);
    projectService.scheduleAutoSave(reason);
    if (!["init", "output-metrics", "mapping-state", "view", "project-autosave", "project-autosave-error"].includes(reason)) {
      bridge.sendState();
    }
  });
}
