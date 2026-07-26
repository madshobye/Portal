import { createAppState } from "./app-state.js";
import { createControlShell } from "./control/control-shell-controller.js";
import { getInitialWorkspace, getClientMode, persistLivePreference, persistWorkspace, preferredLivePreference } from "./view-routing.js";
import { createMediaLibrary } from "./services/media-library-service.js";
import { createProjectFolderService } from "./services/project-folder-service.js";
import { createControlBridge } from "./services/output-bridge-service.js";
import { installOutputApp } from "./output/output-app.js";
import { componentRenderPatchesForChange } from "./domain/render-transport-patch.js";
import { createRenderStatePatch } from "./domain/live-render-patch.js";
import { createDiagnosticsService } from "./libraries/diagnostics-engine/diagnostics-engine/index.js";
import { reportBrowserCompatibility } from "./libraries/diagnostics-engine/browser-compatibility.js";

const root = document.getElementById("app");
const mode = getClientMode();
const compatibility = reportBrowserCompatibility({ mode: mode === "control" ? "control" : mode });

if (!compatibility?.supported) {
  root.innerHTML = `
    <section class="empty-state">
      <h1>Unsupported browser or GPU</h1>
      <p>VJ1 requires current Google Chrome, WebGL2, and its modern media, worker, and file APIs.</p>
      <p>${(compatibility?.missing || []).join(", ") || compatibility?.browser?.label || "Unsupported host"}</p>
    </section>
  `;
} else if (mode === "output" || mode === "preview" || mode === "component") {
  const diagnostics = createDiagnosticsService();
  diagnostics.install();
  installOutputApp({ root, mode, diagnostics });
} else {
  installControlApp().catch(showStartupFailure);
}

async function installControlApp() {
  showStartupStage("Loading node library…");
  // Control-only composition keeps node catalog/editor metadata completely out
  // of output and preview render processes; no live-frame work is introduced.
  const { createVj1NodePackage } = await import("./app-node-package.js");
  const { applicationProgramFromProjectData, loadStoredApplicationProgram } = await import("./services/application-program-loader.js");
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
    showStartupStage("Loading application program…");
    applicationBootstrap = await loadStoredApplicationProgram(nodePackage);
  }
  showStartupStage("Initializing application services…");
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
        return service;
      },
      "data-store": (dependencies) => createAppState(null, {
        prepareState: nodePackage.prepareProjectState,
        prepareChange: nodePackage.prepareProjectChange,
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

  application.bindInput("storage", "value", ({ state, change }) => {
    if (["live", "runtime", "derived"].includes(change.scope)) return;
    projectService.scheduleAutoSave(change, { state });
  });

  application.bindInput("live-synchronization", "state", ({ state, reason, change }) => {
    if (change.scope === "live") {
      bridge.acceptStateChange(state, reason, change);
      return;
    }
    if (change.scope === "derived" &&
        change.projection?.kind === "asset-catalog") {
      bridge.sendState(null, { activation: "assets" });
      return;
    }
    if (["runtime", "derived", "ui"].includes(change.scope)) return;
    if (change.scope === "assets") {
      bridge.sendState(null, { activation: "assets" });
      return;
    }
    if (state.ui.workspace === "mapping" && change.topic === "mapping-state") {
      bridge.sendRenderPatches([
        createRenderStatePatch("mappingCalibration", state.mappingCalibration),
      ], { coalesce: change.phase === "scrub" });
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
    if (reason === "live:scene" || reason === "live:preview-surface") {
      persistLivePreference(state);
    }
    if (change.projectRestore) {
      const preferred = preferredLivePreference(state);
      if (
        (preferred.sceneId &&
          preferred.sceneId !== String(state.ui.live?.selectedSceneId || "")) ||
        (preferred.previewSurfaceId &&
          preferred.previewSurfaceId !==
            String(state.ui.live?.previewSurfaceId || "__mapping__"))
      ) {
        store.restoreLivePreference(preferred);
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
    showStartupStage("Restoring project folder…");
    // The local folder is the startup authority. Do not announce an empty
    // controller while it is still restoring: an already-running Output
    // would otherwise receive an intentionally rejected empty baseline
    // followed by valid Live patches, producing revision gaps and resync
    // storms. If local restore fails, announcement still happens afterward
    // and Output recovery remains available as the read-only fallback.
    bridge.beginProjectRestore();
    let restored = false;
    try {
      restored = await projectService.restoreStoredFolder();
    } finally {
      bridge.finishProjectRestore(restored);
    }
    bridge.announceControl();
    // The URL is the navigation authority. A restored project may contain the
    // workspace that was active when it was saved, but it must not replace the
    // view explicitly requested by this browser tab (for example Scene on a
    // direct refresh).
    if (restored && store.getState().ui.workspace !== initialWorkspace) {
      store.setWorkspace(initialWorkspace);
    }
  }
}

function showStartupStage(message) {
  const status = root.querySelector("[data-vj1-startup-status]");
  if (status) status.textContent = String(message || "Starting…");
}

function showStartupFailure(error) {
  console.error("[VJ1_CONTROL_STARTUP_FAILED]", error);
  root.innerHTML = `
    <section class="app-startup-status" role="alert">
      <strong>VJ1 could not start</strong>
      <span data-vj1-startup-status></span>
    </section>
  `;
  root.querySelector("[data-vj1-startup-status]").textContent =
    error?.message || String(error || "Unknown startup error");
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
