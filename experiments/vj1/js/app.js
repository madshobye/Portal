import { createAppState } from "./app-state.js?v=scene-live-audit-1";
import { createControlShell } from "./control/control-shell-controller.js?v=multi-output-preview-world-1";
import { getInitialWorkspace, getClientMode, persistLiveScenePreference, persistWorkspace, preferredLiveSceneId } from "./view-routing.js?v=scene-mapping-1";
import { createMediaLibrary } from "./services/media-library-service.js?v=model-cache-2";
import { createProjectFolderService } from "./services/project-folder-service.js?v=preview-debug-1";
import { createControlBridge } from "./services/output-bridge-service.js?v=queued-recovery-1";
import { installOutputApp } from "./output/output-app.js?v=multi-output-preview-world-1";
import { componentRenderPatchesForChange } from "./domain/render-transport-patch.js?v=component-transport-patch-1";
import { createDiagnosticsService } from "./libraries/diagnostics-engine/diagnostics-engine/index.js";
import { reportBrowserCompatibility } from "./libraries/diagnostics-engine/browser-compatibility.js?v=runtime-diagnostics-1";

const root = document.getElementById("app");
const mode = getClientMode();

if (mode === "output" || mode === "preview" || mode === "component") {
  const diagnostics = createDiagnosticsService();
  diagnostics.install();
  reportBrowserCompatibility({ mode });
  installOutputApp({ root, mode, diagnostics });
} else {
  installControlApp();
}

async function installControlApp() {
  // Control-only composition keeps node catalog/editor metadata completely out
  // of output and preview render processes; no live-frame work is introduced.
  const { createVj1NodePackage } = await import("./app-node-package.js?v=isf-nodes-1");
  const { applicationProgramFromProjectData, loadStoredApplicationProgram } = await import("./services/application-program-loader.js?v=application-bootstrap-10");
  const nodePackage = createVj1NodePackage();
  const fixtureUrl = fixtureStateUrl();
  let fixtureState = null;
  let applicationBootstrap;
  if (fixtureUrl) {
    try {
      fixtureState = await loadFixtureState(fixtureUrl);
      applicationBootstrap = {
        group: applicationProgramFromProjectData(fixtureState, nodePackage),
        source: "fixture",
        warning: "",
      };
    } catch (error) {
      applicationBootstrap = {
        group: nodePackage.applicationProgram,
        source: "rejected",
        warning: error?.message || String(error),
      };
    }
  } else {
    applicationBootstrap = await loadStoredApplicationProgram(nodePackage);
  }
  const application = await nodePackage.createApplicationRuntime({
    group: applicationBootstrap.group,
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
        reportBrowserCompatibility({ mode: "control" });
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
        // The stored project is authoritative for persistent thumbnail URLs.
        // Announce this controller only after that restore attempt completes,
        // so an already-open Output cannot race it with transport-only state.
        deferAnnouncement: true,
        // Application dataflow owns state delivery. The bridge retains its
        // direct patch transport but does not create a hidden parallel store
        // subscription when instantiated by the node program.
        subscribeStore: false,
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
  store.setWorkspace(initialWorkspace);
  if (applicationBootstrap.warning) {
    store.updateDerived((draft) => {
      draft.project.warnings = [
        ...(draft.project.warnings || []),
        `Application graph was rejected; built-in setup is active: ${applicationBootstrap.warning}`,
      ];
    }, "application-program-rejected");
  }
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

  application.bindInput("storage", "value", ({ change }) => {
    if (["live", "runtime", "derived"].includes(change.scope)) return;
    projectService.scheduleAutoSave(change);
  });

  application.bindInput("live-synchronization", "state", ({ state, reason, change }) => {
    if (change.scope === "live") {
      bridge.acceptStateChange(state, reason, change);
      return;
    }
    if (["runtime", "derived", "ui"].includes(change.scope)) return;
    if (state.ui.workspace === "mapping" && change.topic === "mapping-state") {
      bridge.command("sync-mapping", { mappingCalibration: state.mappingCalibration });
      return;
    }
    if (state.ui.workspace === "mapping" && ["blackout", "toggle-output-playback", "toggle-output-hud"].includes(reason)) {
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
    if (change.phase === "edit") return;
    if (change.phase === "scrub") {
      sendScrubState();
      return;
    }
    if (!["init", "output-metrics", "preview-metrics", "view", "project-history", "project-undo", "project-redo", "project-autosave", "project-autosave-error"].includes(reason)) {
      bridge.sendState();
    }
  });

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
    // The compiled state.snapshot edges decide whether Live transport and
    // storage receive this emission. Dispatch is event-driven and happens
    // only on store changes; it never enters the visual frame loop.
    application.emit("data-store", "snapshot", { state, reason, change });
  });
  if (fixtureState) {
    fixtureState.ui = { ...fixtureState.ui, workspace: initialWorkspace };
    store.replace(fixtureState, "fixture");
    bridge.announceControl();
  } else if (fixtureUrl) {
    console.warn(`[vj1] Could not load fixture state: ${applicationBootstrap.warning || "unknown error"}`);
    bridge.announceControl();
  } else {
    // Output state may make the editor useful while the local folder loads,
    // but its media snapshot must not compete with the authoritative import.
    bridge.beginProjectRestore();
    bridge.announceControl();
    let restored = false;
    try {
      restored = await projectService.restoreStoredFolder();
    } finally {
      bridge.finishProjectRestore(restored);
    }
    // The URL is the navigation authority. A restored project may contain the
    // workspace that was active when it was saved, but it must not replace the
    // view explicitly requested by this browser tab (for example Scene on a
    // direct refresh).
    if (restored && store.getState().ui.workspace !== initialWorkspace) {
      store.setWorkspace(initialWorkspace);
    }
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
