import { VJ1 } from "../constants.js";
import { sanitizeState } from "../domain/models.js";
import { applyLiveRenderPatches } from "../domain/live-render-patch.js";
import { renderMaxFrameRate } from "../domain/render-settings.js";
import {
  createOutputBridge,
  OUTPUT_BRIDGE_PROTOCOL_VERSION,
} from "../services/output-bridge-service.js";
import { OutputRenderer } from "./output-renderer.js";
import { applyFontToGlobal, loadVjRenderFont } from "./font-loader.js";
import { frameSize } from "./render-geometry.js";
import { alignLiveTransitionRenderContext } from "./live-transition-render-context.js";
import {
  assertNodePackageTransportLock,
  importNodePackage,
} from "../libraries/node-engine/node-package.js";
import { assertP5RenderCapabilities } from "../libraries/diagnostics-engine/browser-compatibility.js";
import { CONTROL_SIGNAL_COMMAND, publishRendererControlSignal } from "./control-signal-command.js";
import { pointerSignalValues, rendererUsesPointerSignals } from "./pointer-control-signals.js";

let outputFitSignature = "";

export function createOutputInitialStateGate() {
  let resolveReady = null;
  let settled = false;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  return Object.freeze({
    ready,
    accept(state) {
      if (settled) return false;
      settled = true;
      resolveReady(state);
      return true;
    },
    fail() {
      if (settled) return false;
      settled = true;
      resolveReady(null);
      return true;
    },
    get settled() {
      return settled;
    },
  });
}

export function shouldSuspendStableOutputPresentation({
  idleSuspended = false,
  preparing = false,
  presentationMode = "continuous",
  hasPresentedCompleteFrame = false,
} = {}) {
  return !idleSuspended &&
    !preparing &&
    presentationMode === "on-change" &&
    hasPresentedCompleteFrame;
}

export function installOutputApp({ root, mode, diagnostics = null }) {
  const outputId = mode === "output" ? new URL(window.location.href).searchParams.get("outputId") || "" : "";
  document.body.classList.add("output-client");
  root.innerHTML = `
    <div id="output-stage" class="output-stage">
      <div class="output-fps" data-output-fps>0 fps</div>
      <script id="vj1-runtime-metrics" type="application/json">[]</script>
    </div>
  `;

  let renderer = null;
  let outputIdleSuspended = false;
  let pendingState = null;
  let acceptedState = null;
  let acceptedRevision = 0;
  let receivedRevision = 0;
  let receivedSessionId = "";
  let preparedState = null;
  let preparedFromState = null;
  let preparedRevision = 0;
  let preparedTransportMeta = null;
  let prepareErrorSignature = "";
  let acceptedFiles = [];
  let installedNodePackages = [];
  let bridge = null;
  let renderFont = null;
  let resizeObserver = null;
  let observedResizeFrame = 0;
  let observedResizeSignature = "";
  let diagnosticForwarder = null;
  let pointerSignalSequence = 0;
  const fixtureUrl = fixtureStateUrl();
  const initialStateGate = createOutputInitialStateGate();

  window.addEventListener("pagehide", () => {
    renderer?.dispose?.();
    renderer = null;
    outputIdleSuspended = false;
    resizeObserver?.disconnect?.();
    resizeObserver = null;
    if (observedResizeFrame) cancelAnimationFrame(observedResizeFrame);
    observedResizeFrame = 0;
    diagnosticForwarder?.destroy?.();
    diagnosticForwarder = null;
    diagnostics?.destroy?.();
    bridge?.close?.();
    bridge = null;
  }, { once: true });

  window.setup = async function setup() {
    // p5 can finish loading before either the fixture or Control's registration
    // baseline. Compiling null is never a valid fallback: keep setup pending
    // until the first authoritative state arrives. The bridge heartbeat can
    // still complete this gate if Control starts later.
    const initialBaseline = await initialStateGate.ready;
    if (!initialBaseline) return;
    const size = outputSize(pendingState, mode);
    const canvas = createCanvas(size.width, size.height, WEBGL);
    assertP5RenderCapabilities();
    canvas.parent("output-stage");
    applyLoadedFont();
    fitOutputCanvas(size);
    const stage = document.querySelector("#output-stage");
    resizeObserver = typeof ResizeObserver === "function"
      ? new ResizeObserver((entries = []) => {
          const rect = entries.at(-1)?.contentRect;
          const signature = rect
            ? `${Math.floor(Number(rect.width) || 0)}:${Math.floor(Number(rect.height) || 0)}`
            : "";
          if (signature && signature === observedResizeSignature) return;
          observedResizeSignature = signature;
          if (observedResizeFrame) return;
          // Leave ResizeObserver's layout-delivery cycle before resizeCanvas
          // mutates the output canvas. This prevents undelivered notification
          // loops while retaining one resize per displayed browser frame.
          observedResizeFrame = requestAnimationFrame(() => {
            observedResizeFrame = 0;
            wakeOutputPresentation();
            resizeOutputIfNeeded(pendingState, mode, renderer);
          });
        })
      : null;
    if (resizeObserver && stage) resizeObserver.observe(stage);
    pixelDensity(1);
    frameRate(renderMaxFrameRate(pendingState?.render));
    if (window.p5) window.p5.disableFriendlyErrors = true;
    window.PORTAL_CANVAS_RESIZE_MODE = "none";
    await loadClassicScript(VJ1.portalScript);
    renderFont = await loadVjRenderFont();
    applyLoadedFont(renderFont);
    renderer = new OutputRenderer({
      mode,
      outputId,
      hud: root.querySelector("[data-output-fps]"),
      font: renderFont,
      sendMetrics: (metrics) => {
        recordRuntimeMetric(metrics);
        bridge?.metrics(metrics);
      },
      sendMapping: (id, mapping, status, meta) => bridge?.mappingState(id, mapping, status, meta),
      requestMediaFiles: (ids) => bridge?.requestMediaFiles(ids),
      requestPresentationFrame: wakeOutputPresentation,
      installedNodePackages,
    });
    // Both startup sources already provide a prepared render state: Control
    // materializes Live route bindings before transport, while fixture
    // preparation does the equivalent locally. Output must not sanitize that
    // state again. Sanitization reconstructs authored mappings and therefore
    // strips the derived route bindings that tell the first frame what to
    // render. Later state packets already compile the prepared state directly;
    // startup must have exactly the same ownership boundary.
    const initialState = pendingState;
    // The controller sends packages and media before state; install the
    // buffered media before state compilation as well. State is the startup
    // activation barrier, not a request to compile an incomplete graph that
    // must later be rescued by another state publication.
    renderer.importFiles(acceptedFiles);
    await renderer.setup(initialState ? outputSizedState(initialState, outputSize(initialState, mode), mode, outputId) : null, { normalized: true });
    if (acceptedState) {
      acceptedState = renderer.state;
      pendingState = renderer.state;
    }
    // The bridge starts before p5 and its registration handshake pushes one
    // authoritative dependency/state baseline. Messages received during setup are
    // buffered above, then installed here. Do not request the same snapshots
    // again: media packets are complete ownership snapshots, so a duplicate
    // pull needlessly reconciles every resource in a large project. The
    // bridge heartbeat repeats registration if Control was not ready yet.
  };

  window.draw = function draw() {
    renderer?.draw();
    bridge?.markTransportRendered(acceptedRevision);
    activatePreparedStateIfReady();
    suspendStableOutputPresentation();
  };

  window.keyPressed = function keyPressed() {
    wakeOutputPresentation();
    if (key === "c" || key === "C") renderer?.mappingRuntime.setCalibrate(!renderer.mappingRuntime.isCalibrating());
    if (key === "s" || key === "S") renderer?.mappingRuntime.save();
    if (key === "l" || key === "L") renderer?.mappingRuntime.load();
  };

  window.mousePressed = function mousePressed() {
    wakeOutputPresentation();
    publishOutputPointer({ down: true, event: "pressed" });
    renderer?.mousePressed?.(mouseX, mouseY);
    return false;
  };

  window.mouseDragged = function mouseDragged() {
    wakeOutputPresentation();
    publishOutputPointer({ down: true, event: "moved" });
    renderer?.mouseDragged?.(mouseX, mouseY);
    return false;
  };

  window.mouseReleased = function mouseReleased() {
    wakeOutputPresentation();
    publishOutputPointer({ down: false, event: "released" });
    renderer?.mouseReleased?.();
    return false;
  };

  window.mouseMoved = function mouseMoved() {
    publishOutputPointer({ down: false, event: "moved" });
  };

  window.touchStarted = function touchStarted() {
    wakeOutputPresentation();
    publishOutputPointer({ down: true, event: "pressed" });
    renderer?.mousePressed?.(mouseX, mouseY);
    return false;
  };

  window.touchMoved = function touchMoved() {
    wakeOutputPresentation();
    publishOutputPointer({ down: true, event: "moved" });
    renderer?.mouseDragged?.(mouseX, mouseY);
    return false;
  };

  function publishOutputPointer({ down = false, inside = true, event = "" } = {}) {
    if (!rendererUsesPointerSignals(renderer)) return false;
    return publishRendererControlSignal(renderer, {
      kind: "pointer",
      values: pointerSignalValues({
        x: mouseX,
        y: mouseY,
        width,
        height,
        down,
        inside,
        event,
      }),
      sequence: ++pointerSignalSequence,
      timestamp: Date.now(),
    });
  }

  window.touchEnded = function touchEnded() {
    wakeOutputPresentation();
    publishOutputPointer({ down: false, event: "released" });
    renderer?.mouseReleased?.();
    return false;
  };

  window.windowResized = function windowResized() {
    wakeOutputPresentation();
    resizeOutputIfNeeded(pendingState, mode, renderer);
  };

  function wakeOutputPresentation() {
    if (!outputIdleSuspended) return;
    outputIdleSuspended = false;
    if (typeof loop === "function") loop();
  }

  function suspendStableOutputPresentation() {
    if (!shouldSuspendStableOutputPresentation({
      idleSuspended: outputIdleSuspended,
      preparing: !!preparedState,
      presentationMode: renderer?.frameRuntime.presentationMode(),
      hasPresentedCompleteFrame:
        renderer?.presentationRuntime.hasPresentedCompleteFrame === true,
    }) || typeof noLoop !== "function") return;
    outputIdleSuspended = true;
    noLoop();
  }

  bridge = createOutputBridge({
    mode,
    outputId,
    onState(state, meta = {}) {
      if (fixtureUrl) return;
      const sessionId = String(meta.sessionId || "");
      if (sessionId && sessionId !== receivedSessionId) {
        receivedSessionId = sessionId;
        receivedRevision = 0;
        acceptedRevision = 0;
        clearPreparedState();
      }
      const revision = Math.max(0, Number(meta.revision) || 0);
      if (revision < receivedRevision) return;
      if (shouldHoldCurrentOutputState(state, acceptedState)) return;
      receivedRevision = revision;
      if (renderer && ["assets", "projection"].includes(meta.activation)) {
        clearPreparedState();
        acceptOutputState(state, revision, meta.transport, meta.activation);
        return;
      }
      if (renderer && shouldPrepareLiveSceneState(state, acceptedState, mode)) {
        preparedState = state;
        preparedFromState = transitionTerminalState(acceptedState);
        preparedRevision = revision;
        preparedTransportMeta = meta.transport || null;
        prepareErrorSignature = "";
        activatePreparedStateIfReady();
        return;
      }
      clearPreparedState();
      acceptOutputState(state, revision, meta.transport);
    },
    onLivePatch(patches, meta = {}) {
      if (fixtureUrl) return;
      const sessionId = String(meta.sessionId || "");
      if (sessionId && receivedSessionId && sessionId !== receivedSessionId) {
        requestLivePatchResync("session", { sessionId, receivedSessionId });
        return;
      }
      const baseRevision = Math.max(0, Number(meta.baseRevision) || 0);
      const revision = Math.max(0, Number(meta.revision) || 0);
      // A packet may span several consecutive transport revisions after the
      // receiver coalesces redundant pointer samples. Its base must still be
      // exactly the accepted revision and its terminal revision must advance.
      if (!acceptedState || baseRevision !== receivedRevision || revision <= baseRevision) {
        requestLivePatchResync("revision", { baseRevision, revision, acceptedRevision, receivedRevision });
        return;
      }
      const replacesSurfaceProjection = patches.some((patch) =>
        patch?.target === "state" && patch?.path === "surfaces"
      );
      // A route projection is current matrix truth rather than a parameter
      // update for a queued Scene. Match projection-state activation: cancel
      // any older prepared endpoint and apply the complete route program to
      // the active renderer atomically.
      if (replacesSurfaceProjection) clearPreparedState();
      const result = preparedState
        ? applyLiveRenderPatches(preparedState, patches)
        : renderer
          ? renderer.livePatchRuntime.applyLive(patches)
          : applyLiveRenderPatches(acceptedState, patches);
      if (!result.applied) {
        requestLivePatchResync("path", { failedPatch: result.failedPatch });
        return;
      }
      receivedRevision = revision;
      bridge?.markTransportApplied(meta.transport);
      if (preparedState) {
        preparedRevision = revision;
        preparedTransportMeta = meta.transport || preparedTransportMeta;
        activatePreparedStateIfReady();
        return;
      }
      acceptedState = renderer?.state || acceptedState;
      pendingState = acceptedState;
      acceptedRevision = revision;
    },
    onMediaFiles(files) {
      acceptedFiles = files || [];
      renderer?.importFiles(files);
      activatePreparedStateIfReady();
    },
    onNodePackages(packages, packageLock) {
      try {
        const importedPackages = (packages || []).map((nodePackage) => importNodePackage(nodePackage));
        assertNodePackageTransportLock(importedPackages, packageLock);
        installedNodePackages = importedPackages;
        renderer?.visualNodeRuntime.setInstalledPackages(installedNodePackages);
      } catch (error) {
        console.error("[VJ1_NODE_PACKAGE_TRANSPORT_INVALID]", {
          fallback: "retain the previously validated package set",
          message: error?.message || String(error),
        });
      }
    },
    onControlHello(meta = {}) {
      clearOutputProtocolReloadGuard();
      if (meta.changed && meta.sessionId) {
        receivedSessionId = meta.sessionId;
        receivedRevision = 0;
        acceptedRevision = 0;
        clearPreparedState();
      }
      bridge?.recoveryState(acceptedState, acceptedFiles);
      if (meta.changed) diagnosticForwarder?.resend?.();
    },
    onProtocolMismatch(meta = {}) {
      const received = meta.received ?? null;
      const detail = {
        expected: OUTPUT_BRIDGE_PROTOCOL_VERSION,
        received,
        action: meta.action || "reject",
      };
      if (requestOutputProtocolReload()) return;
      console.error("[VJ1_OUTPUT_PROTOCOL_MISMATCH]", {
        ...detail,
        message: "Output transport rejected after one reload attempt; refresh Control and Output together.",
      });
    },
    onCommand(command, payload) {
      if (command === "sync-global" && acceptedState) {
        const nextState = {
          ...acceptedState,
          global: payload.global || acceptedState.global,
          metrics: {
            ...(acceptedState.metrics || {}),
            sessionTimeline: payload.sessionTimeline || acceptedState.metrics?.sessionTimeline,
          },
        };
        pendingState = nextState;
        acceptedState = nextState;
        renderer?.setState(outputSizedState(nextState, outputSize(nextState, mode), mode, outputId), { normalized: true });
      }
      if (command === "set-calibrate") renderer?.mappingRuntime.setCalibrate(!!payload.calibrating);
      if (command === "save-mapping") renderer?.mappingRuntime.save();
      if (command === "reset-mapping") renderer?.mappingRuntime.reset(payload.surfaceId);
      if (command === "export-mapping") renderer?.mappingRuntime.export();
      if (command === "schedule") renderer?.frameRuntime.schedule(payload);
      if (command === CONTROL_SIGNAL_COMMAND) publishRendererControlSignal(renderer, payload);
    },
  });
  diagnosticForwarder = forwardDiagnosticsToBridge(diagnostics, bridge);

  function requestLivePatchResync(reason, detail = {}) {
    console.warn("[VJ1_LIVE_PATCH_RESYNC]", { reason, ...detail });
    bridge?.recordTransportResync(reason);
    bridge?.requestState();
  }

  function activatePreparedStateIfReady() {
    if (!renderer || !preparedState) return false;
    const status = renderer.readinessRuntime.prepare(preparedState);
    if (status.errorIds.size) {
      const signature = Array.from(status.errorIds).sort().join("|");
      if (signature !== prepareErrorSignature) {
        prepareErrorSignature = signature;
        console.error("[VJ1_SCENE_PREPARE_FAILED]", {
          sceneId: outputSceneId(preparedState),
          resourceIds: Array.from(status.errorIds),
          message: "Activating the requested Scene without a transition so its resource failure remains visible",
        });
      }
      // The requested Live Scene is user truth. The previous Scene must not
      // impersonate it forever when preparation fails. Activate the target
      // without a transition; the renderer's explicit failed-media state
      // remains visible and diagnosable.
      const state = transitionTerminalState(preparedState);
      const revision = preparedRevision;
      const transportMeta = preparedTransportMeta;
      clearPreparedState();
      acceptOutputState(state, revision, transportMeta);
      return true;
    }
    if (status.blocked) return false;
    if (hasActiveLiveTransition(acceptedState)) return false;
    const state = queuedSceneTransitionState(preparedState, preparedFromState);
    const revision = preparedRevision;
    const transportMeta = preparedTransportMeta;
    clearPreparedState();
    acceptOutputState(state, revision, transportMeta);
    return true;
  }

  function acceptOutputState(
    state,
    revision,
    transportMeta = null,
    activation = "full",
  ) {
    initialStateGate.accept(state);
    pendingState = state;
    acceptedState = state;
    acceptedRevision = revision;
    receivedRevision = Math.max(receivedRevision, revision);
    if (typeof frameRate === "function") frameRate(renderMaxFrameRate(state?.render));
    if (renderer) resizeOutputIfNeeded(state, mode, renderer);
    const runtimeState = outputSizedState(state, outputSize(state, mode), mode, outputId);
    pendingState = runtimeState;
    acceptedState = runtimeState;
    if (activation === "assets") {
      renderer?.setAssetState(runtimeState, { normalized: true });
    } else if (activation === "projection") {
      // A Live Surface eye replaces only the compiled route projection. Keep
      // visual programs, media, GPU resources, and the output canvas intact.
      renderer?.setProjectionState(runtimeState, { normalized: true });
    } else {
      renderer?.setState(runtimeState, { normalized: true });
    }
    bridge?.markTransportApplied(transportMeta);
  }

  function clearPreparedState() {
    preparedState = null;
    preparedFromState = null;
    preparedRevision = 0;
    preparedTransportMeta = null;
    prepareErrorSignature = "";
    renderer?.readinessRuntime?.clearPrepared?.();
  }

  if (fixtureUrl) {
    loadFixtureState(fixtureUrl)
      .then(async (fixtureState) => {
        const state = await prepareFixtureRuntimeState(fixtureState);
        initialStateGate.accept(state);
        pendingState = state;
        if (renderer) resizeOutputIfNeeded(state, mode, renderer);
        renderer?.setState(outputSizedState(state, outputSize(state, mode), mode, outputId), { normalized: true });
      })
      .catch((error) => {
        initialStateGate.fail(error);
        root.innerHTML = `<div class="empty-preview">${error.message}</div>`;
        console.warn(`[vj1] Could not load fixture state: ${error.message}`);
      });
  }

  loadClassicScript(VJ1.p5Script).catch((error) => {
    root.innerHTML = `<div class="empty-preview">${error.message}</div>`;
  });
}

const OUTPUT_PROTOCOL_RELOAD_KEY = `vj1-output-protocol-reload-${OUTPUT_BRIDGE_PROTOCOL_VERSION}`;

function requestOutputProtocolReload() {
  try {
    if (sessionStorage.getItem(OUTPUT_PROTOCOL_RELOAD_KEY) === "1") return false;
    sessionStorage.setItem(OUTPUT_PROTOCOL_RELOAD_KEY, "1");
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}

function clearOutputProtocolReloadGuard() {
  try {
    sessionStorage.removeItem(OUTPUT_PROTOCOL_RELOAD_KEY);
  } catch {
    // A matching handshake is already sufficient when storage is unavailable.
  }
}

function forwardDiagnosticsToBridge(diagnostics, bridge) {
  if (!diagnostics?.subscribe || !bridge?.diagnostic) return null;
  const sentCounts = new Map();
  const forward = (summary, reset = false) => {
    if (reset) sentCounts.clear();
    for (const entry of summary?.entries || []) {
      const previousCount = sentCounts.get(entry.id) || 0;
      const count = Math.max(0, Number(entry.count) - previousCount);
      if (count > 0) bridge.diagnostic({ ...entry, count });
      sentCounts.set(entry.id, Number(entry.count) || 0);
    }
    const currentIds = new Set((summary?.entries || []).map((entry) => entry.id));
    for (const id of sentCounts.keys()) {
      if (!currentIds.has(id)) sentCounts.delete(id);
    }
  };
  const unsubscribe = diagnostics.subscribe((summary) => forward(summary));
  return {
    resend: () => forward(diagnostics.summary?.(), true),
    destroy: unsubscribe,
  };
}

export function shouldHoldCurrentOutputState(nextState, currentState) {
  if (!currentState || hasLoadedProjectState(nextState)) return false;
  return hasLoadedProjectState(currentState) && isEmptyStartupState(nextState);
}

export function outputSceneId(state) {
  // Live is the only authored-Scene authority. ui.selectedMappingId belongs
  // to Mapping editing and must never become an output Scene fallback.
  return String(state?.ui?.live?.selectedSceneId || "");
}

export function shouldPrepareLiveSceneState(nextState, currentState, mode = "output") {
  if (mode !== "output" || !nextState || !currentState) return false;
  const nextSceneId = outputSceneId(nextState);
  const currentSceneId = outputSceneId(currentState);
  const transitionDurationMs = Math.max(0, Number(nextState.liveTransition?.durationMs) || 0);
  // A cut is immediate user truth. Media readiness may make the target render
  // black/loading, but it must not leave a different Scene on air. Only a
  // genuine timed transition retains the previous Scene while preparing.
  return transitionDurationMs > 0 && !!nextSceneId && !!currentSceneId && nextSceneId !== currentSceneId;
}

export function retimePreparedSceneTransition(state, startedAtMs = Date.now() + 50) {
  if (!state?.liveTransition) return state;
  const liveTransitions = (state.liveTransitions || [state.liveTransition]).map((transition) => ({
    ...transition,
    startedAtMs,
  }));
  return {
    ...state,
    liveTransitions,
    liveTransition: liveTransitions[0],
  };
}

export function hasActiveLiveTransition(state, nowMs = Date.now()) {
  return (state?.liveTransitions || (state?.liveTransition ? [state.liveTransition] : [])).some((transition) => {
    const durationMs = Math.max(0, Number(transition?.durationMs) || 0);
    const startedAtMs = Number(transition?.startedAtMs) || 0;
    return !!transition?.fromState && durationMs > 0 && startedAtMs > 0 && nowMs < startedAtMs + durationMs;
  });
}

export function transitionTerminalState(state) {
  if (!state?.liveTransition && !state?.liveTransitions?.length) return state;
  const terminal = { ...state };
  delete terminal.liveTransition;
  delete terminal.liveTransitions;
  return terminal;
}

export function queuedSceneTransitionState(state, fromState, startedAtMs = Date.now() + 50) {
  if (!state) return state;
  const configuredDurationMs = Math.round(Math.max(0, Number(state.ui?.live?.transitionDuration) || 0) * 1000);
  const durationMs = Math.max(0, Number(state.liveTransition?.durationMs) || configuredDurationMs);
  if (!fromState || durationMs <= 0) return transitionTerminalState(state);
  const stableFromState = transitionTerminalState(fromState);
  const liveTransition = {
    id: state.liveTransition?.id || `${outputSceneId(stableFromState)}:${outputSceneId(state)}:${startedAtMs}`,
    destination: "overall",
    surfaceId: "",
    transitionId: String(state.liveTransition?.transitionId || state.ui?.live?.transitionId || "vj1.transition.dissolve"),
    transitionParameters: state.liveTransition?.transitionParameters || state.ui?.live?.transitionParameters || {},
    startedAtMs,
    durationMs,
    // A superseded queued Scene may have different temporary overrides from
    // the actual completed source. Conservative identities avoid sharing a
    // render cache across two semantically different transition sides.
    componentsShared: false,
    fromState: stableFromState,
  };
  return {
    ...state,
    liveTransitions: [liveTransition],
    liveTransition,
  };
}

export function hasLoadedProjectState(state) {
  if (!state || typeof state !== "object") return false;
  return !!state.project?.folderName ||
    (Array.isArray(state.media) && state.media.length > 0);
}

export function isEmptyStartupState(state) {
  if (!state || typeof state !== "object") return false;
  return !state.project?.folderName &&
    (!Array.isArray(state.media) || state.media.length === 0) &&
    (state.project?.name === "Untitled VJ Set" || !state.project?.name);
}

function applyLoadedFont(font) {
  applyFontToGlobal(font);
}

function outputSize(state = null, mode = "output") {
  if (mode === "output") {
    return {
      width: Math.max(1, Math.floor(window.innerWidth || document.documentElement?.clientWidth || VJ1.renderWidth)),
      height: Math.max(1, Math.floor(window.innerHeight || document.documentElement?.clientHeight || VJ1.renderHeight)),
    };
  }
  const size = frameSize(state?.render || {});
  return {
    width: Math.max(320, Math.floor(size.width || VJ1.renderWidth)),
    height: Math.max(180, Math.floor(size.height || VJ1.renderHeight)),
  };
}

function outputSizedState(state, size, mode, outputId = "") {
  if (!state) return state;
  return alignLiveTransitionRenderContext({
    ...state,
    render: {
      ...state.render,
      hostViewport: {
        width: Math.max(1, Math.floor(Number(size?.width) || VJ1.renderWidth)),
        height: Math.max(1, Math.floor(Number(size?.height) || VJ1.renderHeight)),
        mode: mode === "preview" ? "preview" : "output",
        outputId,
      },
    },
  });
}

function resizeOutputIfNeeded(state, mode = "output", renderer = null) {
  const size = outputSize(state, mode);
  if (width === size.width && height === size.height) return;
  resizeCanvas(size.width, size.height);
  fitOutputCanvas(size);
  // setState owns buffer and Surface rebuilding when hostViewport changes.
  // Calling resize() first rebuilt once against stale host state and again
  // against the new state, causing a transient wrong projection and needless
  // allocations during window dragging.
  if (renderer?.state) {
    renderer.setState(outputSizedState(renderer.state, size, mode, renderer.outputId || ""), { normalized: true });
  } else {
    renderer?.resize?.();
  }
}

function fitOutputCanvas(size = outputSize()) {
  const canvases = Array.from(document.querySelectorAll("#output-stage canvas"));
  if (!canvases.length) return;
  const desiredWidth = "100vw";
  const desiredHeight = "100vh";
  const desiredTransform = "none";
  const signature = `${size.width}:${size.height}:${canvases.length}:${desiredWidth}:${desiredHeight}:${desiredTransform}`;
  if (signature === outputFitSignature) return;
  outputFitSignature = signature;
  for (const canvas of canvases) {
    canvas.style.position = "fixed";
    canvas.style.left = "0";
    canvas.style.top = "0";
    canvas.style.inset = "0";
    canvas.style.width = desiredWidth;
    canvas.style.height = desiredHeight;
    canvas.style.transform = desiredTransform;
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

async function prepareFixtureRuntimeState(fixtureState = {}) {
  const normalized = sanitizeState(fixtureState);
  const legacyBindings = fixtureSurfaceSourceBindings(fixtureState);
  const withBindings = legacyBindings.size
    ? {
        ...normalized,
        surfaces: applyFixtureSourceBindings(normalized.surfaces, legacyBindings),
        mappings: (normalized.mappings || []).map((mapping) => ({
          ...mapping,
          surfaces: applyFixtureSourceBindings(mapping.surfaces, legacyBindings),
        })),
      }
    : normalized;
  // The production bridge sends state prepared by the control process. A
  // standalone fixture has no control process, so perform that one-time graph
  // materialization here. This dynamic import stays outside normal output
  // startup and cannot add node-catalog work to the render frame.
  const { createVj1NodePackage } = await import("../app-node-package.js");
  return createVj1NodePackage().prepareProjectState(withBindings);
}

function fixtureSurfaceSourceBindings(fixtureState = {}) {
  const bindings = new Map();
  const collect = (routes = []) => {
    for (const route of routes || []) {
      const surfaceId = String(route?.id || "");
      const legacyComponentId = String(route?.componentId || route?.compositionId || "");
      const sourceNodeId = String(route?.sourceNodeId || "");
      if (!surfaceId || (!legacyComponentId && !sourceNodeId)) continue;
      const componentId = legacyComponentId
        .replace(/composition:/g, "component:")
        .replace(/composition-/g, "component-")
        .replace(/^composition$/, "component");
      bindings.set(surfaceId, {
        componentId,
        sourceNodeId: sourceNodeId || `component:${encodeURIComponent(componentId)}`,
      });
    }
  };
  collect(fixtureState.surfaces);
  for (const scene of fixtureState.scenes || []) collect(scene?.snapshot?.surfaces);
  for (const mapping of Array.isArray(fixtureState.mappings) ? fixtureState.mappings : []) {
    collect(mapping?.surfaces);
  }
  return bindings;
}

function applyFixtureSourceBindings(surfaces = [], bindings = new Map()) {
  return (surfaces || []).map((surface) => {
    const binding = bindings.get(String(surface?.id || ""));
    return binding ? { ...surface, ...binding } : surface;
  });
}

function recordRuntimeMetric(metrics) {
  const samples = globalThis.__vj1RuntimeMetrics || [];
  samples.push({
    ...metrics,
    sampledAt: new Date().toISOString(),
  });
  if (samples.length > 240) samples.splice(0, samples.length - 240);
  globalThis.__vj1RuntimeMetrics = samples;
  const metricsNode = document.getElementById("vj1-runtime-metrics");
  if (metricsNode) metricsNode.textContent = JSON.stringify(samples);
}

function loadClassicScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-vj1-script="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.dataset.vj1Script = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(script);
  });
}
