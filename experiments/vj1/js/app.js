import { createAppState } from "./app-state.js";
import { createControlShell } from "./control/control-shell-controller.js?v=scene-snapshots-89";
import { getInitialView, getInitialWorkspace, getClientMode, persistWorkspace } from "./view-routing.js";
import { loadPersistedState, persistState } from "./services/state-persistence-service.js";
import { createMediaLibrary } from "./services/media-library-service.js";
import { createProjectFolderService } from "./services/project-folder-service.js?v=scene-snapshots-89";
import { createControlBridge } from "./services/output-bridge-service.js";
import { installOutputApp } from "./output/output-app.js?v=scene-snapshots-89";

const root = document.getElementById("app");
const mode = getClientMode();
const urlParams = new URLSearchParams(window.location.search);

if (mode === "output" || mode === "preview" || mode === "composition") {
  installOutputApp({ root, mode });
} else {
  const initial = loadPersistedState();
  const store = createAppState(initial);
  store.setView(getInitialView());
  const initialWorkspace = getInitialWorkspace();
  store.setWorkspace(initialWorkspace);
  if (urlParams.get("orientationTest") === "1") seedOrientationTest(store);
  persistWorkspace(initialWorkspace);
  const mediaLibrary = createMediaLibrary();
  const bridge = createControlBridge({ store, mediaLibrary });
  const projectService = createProjectFolderService({ mediaLibrary, store, bridge });
  let bridgeScrubTimer = null;
  createControlShell({ root, store, bridge, mediaLibrary, projectService }).mount();

  store.subscribe((state, reason) => {
    persistState(state);
    if (reason === "workspace") persistWorkspace(state.ui.workspace);
    projectService.scheduleAutoSave(reason);
    if (String(reason).startsWith("edit:")) {
      return;
    }
    if (String(reason).startsWith("scrub:")) {
      clearTimeout(bridgeScrubTimer);
      bridgeScrubTimer = setTimeout(() => bridge.sendState(), 90);
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

function seedOrientationTest(store) {
  store.update((draft) => {
    draft.project.name = "Orientation Test";
    draft.project.folderName = "orientation-test";
    draft.project.warnings = [];
    draft.ui.workspace = "compose";
    draft.global.calibrating = false;
    const composition = draft.compositions[0];
    if (!composition) return;
    composition.name = "Orientation Test Pattern";
    composition.source = { type: "generator", mediaId: "", generatorId: "testPattern" };
    composition.opacity = 1;
    composition.blend = "normal";
    composition.shaderChain = orientationTestChain();
    draft.ui.selectedCompositionId = composition.id;
    for (const surface of draft.surfaces || []) {
      surface.compositionId = composition.id;
      surface.enabled = true;
      surface.opacity = 1;
      surface.finalShaderChain = [];
    }
  }, "orientation-test");
}

function orientationTestChain() {
  const ids = (urlParams.get("orientationEffects") || "rgbSplit,ripple")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const amount = Number(urlParams.get("orientationAmount"));
  const fallbackAmount = Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 0;
  return ids.map((id) => ({ id, enabled: true, amount: fallbackAmount }));
}
