import { createAppState } from "./app-state.js?v=output-playback-1";
import { createControlShell } from "./control/control-shell-controller.js?v=shadertoy-generator-14";
import { getInitialWorkspace, getClientMode, persistWorkspace } from "./view-routing.js";
import { createMediaLibrary } from "./services/media-library-service.js?v=world-frame-27";
import { createProjectFolderService } from "./services/project-folder-service.js?v=output-recovery-1";
import { createControlBridge } from "./services/output-bridge-service.js?v=output-playback-1";
import { installOutputApp } from "./output/output-app.js?v=shadertoy-generator-14";

const root = document.getElementById("app");
const mode = getClientMode();

if (mode === "output" || mode === "preview" || mode === "composition") {
  installOutputApp({ root, mode });
} else {
  const store = createAppState();
  const initialWorkspace = getInitialWorkspace();
  store.setWorkspace(initialWorkspace);
  persistWorkspace(initialWorkspace);
  const mediaLibrary = createMediaLibrary();
  const bridge = createControlBridge({ store, mediaLibrary });
  const projectService = createProjectFolderService({ mediaLibrary, store, bridge });
  let bridgeScrubFrame = 0;

  function sendScrubState() {
    if (bridgeScrubFrame) return;
    const scheduleFrame = typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (callback) => setTimeout(callback, 0);
    bridgeScrubFrame = scheduleFrame(() => {
      bridgeScrubFrame = 0;
      bridge.sendState();
    });
  }

  createControlShell({ root, store, bridge, mediaLibrary, projectService }).mount();

  store.subscribe((state, reason) => {
    if (reason === "workspace") persistWorkspace(state.ui.workspace);
    projectService.scheduleAutoSave(reason);
    if (String(reason).startsWith("edit:")) {
      return;
    }
    if (String(reason).startsWith("scrub:")) {
      sendScrubState();
      return;
    }
    if (!["init", "output-metrics", "preview-metrics", "view", "project-history", "project-undo", "project-redo", "project-autosave", "project-autosave-error"].includes(reason)) {
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
