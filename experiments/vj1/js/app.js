import { createAppState } from "./app-state.js?v=screen-input-registry-1";
import { createControlShell } from "./control/control-shell-controller.js?v=screen-input-registry-1";
import { getInitialWorkspace, getClientMode, persistLiveScenePreference, persistWorkspace, preferredLiveSceneId } from "./view-routing.js?v=live-scene-preference-1";
import { createMediaLibrary } from "./services/media-library-service.js?v=model-cache-2";
import { createProjectFolderService } from "./services/project-folder-service.js?v=screen-input-registry-1";
import { createControlBridge } from "./services/output-bridge-service.js?v=remote-diagnostics-1";
import { installOutputApp } from "./output/output-app.js?v=screen-input-registry-1";
import { componentRenderPatchesForChange } from "./domain/render-transport-patch.js?v=component-transport-patch-1";
import { createDiagnosticsService } from "./libraries/diagnostics-engine/diagnostics-engine/index.js";

const root = document.getElementById("app");
const mode = getClientMode();

if (mode === "output" || mode === "preview" || mode === "component") {
  const diagnostics = createDiagnosticsService();
  diagnostics.install();
  installOutputApp({ root, mode, diagnostics });
} else {
  installControlApp();
}

async function installControlApp() {
  // Control-only composition keeps node catalog/editor metadata completely out
  // of output and preview render processes; no live-frame work is introduced.
  const { createVj1NodePackage } = await import("./app-node-package.js");
  const nodePackage = createVj1NodePackage();
  const application = await nodePackage.createApplicationRuntime({
    factories: {
      timing: (_dependencies, { definition }) => ({
        scale: (timeStretch) => definition.process({ timeStretch }).scale,
      }),
      "state-command": (_dependencies, { definition }) => ({
        classify: (command) => definition.process({ command }).event,
      }),
      diagnostics: () => {
        const service = createDiagnosticsService();
        service.install();
        return service;
      },
      "data-store": (dependencies) => createAppState(null, {
        prepareState: nodePackage.prepareProjectState,
        classifyChange: dependencies["state-command"].classify,
      }),
      "media-lifecycle": () => createMediaLibrary(),
      "live-synchronization": (dependencies) => createControlBridge({
        store: dependencies["data-store"],
        mediaLibrary: dependencies["media-lifecycle"],
        diagnostics: dependencies.diagnostics,
      }),
      storage: (dependencies) => createProjectFolderService({
        mediaLibrary: dependencies["media-lifecycle"],
        store: dependencies["data-store"],
        bridge: dependencies["live-synchronization"],
        classifyChange: dependencies["state-command"].classify,
      }),
      // The output renderer lives in its own browser process. This endpoint is
      // the real transport connection declared by live -> output in the node
      // program; no output/cache machinery is duplicated in the control UI.
      output: (dependencies) => Object.freeze({
        bridge: dependencies["live-synchronization"],
        executionDomain: "output",
      }),
    },
  }).initialize();
  const diagnostics = application.get("diagnostics");
  const store = application.get("data-store");
  const initialWorkspace = getInitialWorkspace();
  const fixtureUrl = fixtureStateUrl();
  store.setWorkspace(initialWorkspace);
  persistWorkspace(initialWorkspace);
  const mediaLibrary = application.get("media-lifecycle");
  const bridge = application.get("live-synchronization");
  const projectService = application.get("storage");
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

  createControlShell({ root, store, bridge, mediaLibrary, projectService, diagnostics, nodePackage }).mount();

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
