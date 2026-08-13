import { createAppState } from "./app-state.js";
import { createControlShell } from "./control/control-shell-controller.js";
import {
  getInitialWorkspace,
  getClientMode,
  persistLiveSession,
  persistWorkspace,
  preferredLiveSession,
} from "./view-routing.js";
import { createMediaLibrary } from "./services/media-library-service.js";
import { createProjectFolderService } from "./services/project-folder-service.js";
import { createControlBridge } from "./services/output-bridge-service.js";
import { installOutputApp } from "./output/output-app.js";
import { outputRenderPatchesForChange } from "./domain/render-transport-patch.js";
import { createComponentRenderPatch, createRenderStatePatch } from "./domain/live-render-patch.js";
import { CONTROL_SIGNAL_COMMAND } from "./output/control-signal-command.js";
import { createDiagnosticsService } from "./libraries/diagnostics-engine/diagnostics-engine/index.js";
import {
  recordBrowserCapabilityDiagnostics,
  reportBrowserCompatibility,
} from "./libraries/diagnostics-engine/browser-compatibility.js";
import { createMidiInputService } from "./services/midi-input-service.js";
import { createDmxOutputService } from "./services/dmx-output-service.js";
import { screenCaptureService } from "./libraries/device-engine/index.js";
import {
  liveSignificantParameterAssignments,
  significantParameterValueFromUnit,
} from "./control/mapping-live-view.js";
import {
  setLiveAnimationOverride,
  setLiveOverride,
} from "./control/control-command-controller.js";
import { createStartupStatusUi } from "./libraries/ui-engine/index.js";

let startupUi = null;
let root = null;
let mode = "control";
let compatibility = null;

export function startVj1App({ startupUi: suppliedStartupUi = null } = {}) {
  startupUi = suppliedStartupUi || createStartupStatusUi({
    inputs: { state: "loading", title: "VJ1", message: "Starting…" },
  });
  root = startupUi.host;
  mode = getClientMode();
  compatibility = reportBrowserCompatibility({ mode: mode === "control" ? "control" : mode });

  if (!compatibility?.supported) {
    startupUi.update({
      state: "unsupported",
      title: "Unsupported browser or GPU",
      message: "VJ1 requires current Google Chrome, WebGL2, and its modern media, worker, and file APIs.",
      detail: (compatibility?.missing || []).join(", ") || compatibility?.browser?.label || "Unsupported host",
    });
    return;
  }
  if (mode === "output" || mode === "preview" || mode === "component") {
    const diagnostics = createDiagnosticsService();
    diagnostics.install();
    recordBrowserCapabilityDiagnostics(diagnostics, compatibility);
    startupUi.dispose();
    installOutputApp({ root, mode, diagnostics });
    return;
  } else {
    return installControlApp().catch(showStartupFailure);
  }
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
  let controlShell = null;
  let dmxOutputService = null;
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
        onDmxFixture(payload) {
          if (payload?.releaseSources) {
            dmxOutputService?.releaseProbeSources(payload.source);
          } else {
            dmxOutputService?.receiveProbe(payload);
          }
        },
      }),
      "session-devices": (dependencies) => {
        const store = dependencies["data-store"];
        const bridge = dependencies["live-synchronization"];
        const dmxOutput = createDmxOutputService({
          onStatus: () => controlShell?.refreshDeviceStatus(),
        });
        dmxOutputService = dmxOutput;
        const midiInput = createMidiInputService({
          onSignal(payload) {
            controlShell?.deliverControlSignal(payload);
            bridge.command(CONTROL_SIGNAL_COMMAND, payload);
          },
          onSelectScene: (id) => store.selectLiveScene(id),
          onSelectComponent: (id) => store.selectLiveComponent(id),
          resolveSignificantParameters: (state) => liveSignificantParameterAssignments(state),
          onAdjustSignificantParameter({ assignment, unitValue }) {
            const value = significantParameterValueFromUnit(assignment, unitValue);
            if (assignment.kind === "animation") {
              store.updateLive((draft) => {
                setLiveAnimationOverride(
                  draft,
                  assignment.componentId,
                  assignment.targetNodeId,
                  assignment.trackId,
                  assignment.field,
                  value,
                );
              }, { reason: "live:animation-update", input: "midi" });
              return;
            }
            store.updateLive((draft) => {
              setLiveOverride(draft, assignment.componentId, assignment.path, value, assignment.nodeId);
            }, {
              reason: "live:update",
              input: "midi",
              livePatches: [createComponentRenderPatch(
                assignment.componentId,
                assignment.nodeId,
                assignment.path,
                value,
              )],
            });
          },
          onStatus: () => controlShell?.refreshDeviceStatus(),
        });
        return Object.freeze({
          midiInput,
          dmxOutput,
          screenCapture: screenCaptureService(),
          syncState(state) {
            midiInput.syncState(state);
            dmxOutput.syncState(state);
          },
          dispose() {
            midiInput.disconnect();
            dmxOutput.dispose();
          },
        });
      },
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
  recordBrowserCapabilityDiagnostics(diagnostics, compatibility);
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
  const devices = application.get("session-devices");
  const { midiInput, dmxOutput } = devices;
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
    if (change.effects?.persistence?.mode === "none") return;
    projectService.scheduleAutoSave(change, { state });
  });

  application.bindInput("live-synchronization", "state", ({ state, reason, change }) => {
    const outputEffect = change.effects?.output || { mode: "state" };
    if (change.command.domain === "live" && ["live-patches", "state"].includes(outputEffect.mode)) {
      bridge.acceptStateChange(state, reason, change);
      return;
    }
    if (outputEffect.mode === "assets") {
      bridge.sendState(null, { activation: "assets" });
      return;
    }
    if (outputEffect.mode === "none") return;
    if (state.ui.workspace === "mapping" && outputEffect.mode === "mapping-patch") {
      bridge.sendRenderPatches([
        createRenderStatePatch("mappingCalibration", state.mappingCalibration),
      ], { coalesce: outputEffect.coalesce === true });
      return;
    }
    if (state.ui.workspace === "mapping" && outputEffect.mode === "global-command") {
      bridge.command("sync-global", {
        global: state.global,
        sessionTimeline: state.metrics?.sessionTimeline,
      });
      return;
    }
    const renderPatches = outputRenderPatchesForChange(state, change);
    if (outputEffect.mode === "render-patches") {
      if (renderPatches.length) {
        bridge.sendRenderPatches(renderPatches, { coalesce: outputEffect.coalesce === true });
      }
      return;
    }
    if (outputEffect.mode === "state" && outputEffect.coalesce === true) {
      sendScrubState();
      return;
    }
    bridge.sendState();
  });

  application.bindInput("session-devices", "state", ({ state }) => devices.syncState(state));

  controlShell = createControlShell({
    root,
    store,
    bridge,
    mediaLibrary,
    projectService,
    midiInput,
    dmxOutput,
    screenCapture: devices.screenCapture,
    diagnostics,
    nodePackage,
    onLifecycle({ kind }) {
      if (kind !== "pagehide") return;
      controlShell?.dispose();
      devices.dispose();
    },
  });

  store.subscribe((state, reason, change) => {
    if (change.effects.session.workspace === "persist") persistWorkspace(state.ui.workspace);
    if (change.effects.session.live === "restore") {
      const session = preferredLiveSession(state);
      if (session) {
        store.restoreLiveSession(session);
        return;
      }
    }
    if (change.effects.session.live === "persist") persistLiveSession(state);
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
  // The startup node remains the only visible surface until project restore
  // has reached an authoritative outcome. Mount the complete shell once with
  // the final startup state instead of briefly exposing an empty black frame.
  startupUi.dispose();
  controlShell.mount();
}

function showStartupStage(message) {
  startupUi.update({ state: "loading", title: "VJ1", message: String(message || "Starting…") });
}

function showStartupFailure(error) {
  console.error("[VJ1_CONTROL_STARTUP_FAILED]", error);
  startupUi.update({
    state: "error",
    title: "VJ1 could not start",
    message: error?.message || String(error || "Unknown startup error"),
  });
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
