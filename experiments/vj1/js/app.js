import { createAppState } from "./app-state.js?v=adaptive-component-demand-29";
import { createControlShell } from "./control/control-shell-controller.js?v=adaptive-component-demand-29";
import { getInitialWorkspace, getClientMode, persistWorkspace } from "./view-routing.js?v=adaptive-component-demand-29";
import { createMediaLibrary } from "./services/media-library-service.js?v=adaptive-component-demand-29";
import { createProjectFolderService } from "./services/project-folder-service.js?v=adaptive-component-demand-29";
import { createControlBridge } from "./services/output-bridge-service.js?v=adaptive-component-demand-29";
import { installOutputApp } from "./output/output-app.js?v=adaptive-component-demand-29";

const root = document.getElementById("app");
const mode = getClientMode();

if (mode === "output" || mode === "preview" || mode === "component") {
  installOutputApp({ root, mode });
} else {
  const store = createAppState();
  const initialWorkspace = getInitialWorkspace();
  const fixtureUrl = fixtureStateUrl();
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
    if (state.ui.workspace === "scene" && (reason === "mapping-state" || String(reason).startsWith("scrub:mapping-state"))) {
      bridge.command("sync-mapping", { mappings: state.mappings });
      return;
    }
    if (state.ui.workspace === "scene" && ["blackout", "toggle-output-playback", "toggle-labels"].includes(reason)) {
      bridge.command("sync-global", { global: state.global });
      return;
    }
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
  if (fixtureUrl) {
    loadFixtureState(fixtureUrl)
      .then((state) => {
        state.ui = { ...state.ui, workspace: initialWorkspace };
        store.replace(state, "fixture");
      })
      .catch((error) => {
        console.warn(`[vj1] Could not load fixture state: ${error.message}`);
      });
  } else {
    projectService.restoreStoredFolder();
    window.addEventListener("focus", () => projectService.refreshFolder());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") projectService.refreshFolder();
    });
    setInterval(() => projectService.refreshFolder(), 5000);
  }
}

function fixtureStateUrl() {
  const value = new URLSearchParams(window.location.search).get("fixture");
  if (!value) return "";
  return new URL(value, window.location.href).toString();
}

async function loadFixtureState(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}
