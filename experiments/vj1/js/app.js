import { createAppState } from "./app-state.js?v=sun-rays-1";
import { createControlShell } from "./control/control-shell-controller.js?v=sun-rays-1";
import { getInitialWorkspace, getClientMode, persistLiveScenePreference, persistWorkspace, preferredLiveSceneId } from "./view-routing.js?v=live-scene-preference-1";
import { createMediaLibrary } from "./services/media-library-service.js?v=model-lod-1";
import { createProjectFolderService } from "./services/project-folder-service.js?v=cold-backups-1";
import { createControlBridge } from "./services/output-bridge-service.js?v=component-transport-patch-1";
import { installOutputApp } from "./output/output-app.js?v=sun-rays-1";
import { componentRenderPatchesForChange } from "./domain/render-transport-patch.js?v=component-transport-patch-1";

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

  store.subscribe((state, reason, change) => {
    if (reason === "workspace") persistWorkspace(state.ui.workspace);
    if (reason === "live:scene") persistLiveScenePreference(state);
    if (change.projectRestore) {
      const preferredSceneId = preferredLiveSceneId(state);
      if (preferredSceneId && preferredSceneId !== String(state.ui.live?.selectedSceneId || "")) {
        store.restoreLiveScene(preferredSceneId);
        return;
      }
    }
    // Live render truth and its revisioned param patches are owned by the
    // output bridge. Keeping that responsibility out of project/autosave
    // delivery avoids rebuilding a full output snapshot for every scrub.
    if (["live", "runtime", "derived"].includes(change.scope)) return;
    projectService.scheduleAutoSave(change);
    if (change.scope === "ui") return;
    if (state.ui.workspace === "scene" && change.topic === "mapping-state") {
      bridge.command("sync-mapping", { mappings: state.mappings });
      return;
    }
    if (state.ui.workspace === "scene" && ["blackout", "toggle-output-playback", "toggle-labels"].includes(reason)) {
      bridge.command("sync-global", { global: state.global });
      return;
    }
    const renderPatches = Array.isArray(change.renderPatches) && change.renderPatches.length
      ? change.renderPatches
      : componentRenderPatchesForChange(state, change);
    if (renderPatches.length) {
      bridge.sendRenderPatches(renderPatches, { coalesce: change.phase === "scrub" });
      return;
    }
    if (change.phase === "edit") {
      return;
    }
    if (change.phase === "scrub") {
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
