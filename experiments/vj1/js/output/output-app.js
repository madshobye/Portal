import { VJ1 } from "../constants.js";
import { sanitizeState } from "../domain/models.js?v=chain-general-controls-1";
import { applyLiveRenderPatches } from "../domain/live-render-patch.js?v=param-fade-1";
import { renderMaxFrameRate } from "../domain/render-settings.js?v=canvas-global-resolution-1";
import { createOutputBridge } from "../services/output-bridge-service.js?v=reconnect-media-ownership-1";
import { OutputRenderer } from "./output-renderer.js?v=chain-general-controls-1";
import { applyFontToGlobal, loadVjRenderFont } from "./font-loader.js?v=adaptive-component-demand-29";
import { frameSize } from "./render-geometry.js?v=adaptive-component-demand-29";

let outputFitSignature = "";

export function installOutputApp({ root, mode }) {
  const outputId = mode === "output" ? new URL(window.location.href).searchParams.get("outputId") || "" : "";
  document.body.classList.add("output-client");
  root.innerHTML = `
    <div id="output-stage" class="output-stage">
      <div class="output-fps" data-output-fps>0 fps</div>
      <script id="vj1-runtime-metrics" type="application/json">[]</script>
    </div>
  `;

  let renderer = null;
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
  let bridge = null;
  let renderFont = null;
  let resizeObserver = null;
  const fixtureUrl = fixtureStateUrl();

  window.addEventListener("pagehide", () => {
    renderer?.dispose?.();
    renderer = null;
    resizeObserver?.disconnect?.();
    resizeObserver = null;
  }, { once: true });

  window.setup = async function setup() {
    const size = outputSize(pendingState, mode);
    const canvas = createCanvas(size.width, size.height, WEBGL);
    canvas.parent("output-stage");
    applyLoadedFont();
    fitOutputCanvas(size);
    const stage = document.querySelector("#output-stage");
    resizeObserver = typeof ResizeObserver === "function"
      ? new ResizeObserver(() => resizeOutputIfNeeded(pendingState, mode, renderer))
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
    });
    await renderer.setup(pendingState ? sanitizeState(pendingState) : null);
    if (acceptedState) {
      acceptedState = renderer.state;
      pendingState = renderer.state;
    }
    renderer.importFiles(acceptedFiles);
  };

  window.draw = function draw() {
    renderer?.draw();
    bridge?.markTransportRendered(acceptedRevision);
    activatePreparedStateIfReady();
  };

  window.keyPressed = function keyPressed() {
    if (key === "c" || key === "C") renderer?.setCalibrate(!renderer.isCalibrating());
    if (key === "s" || key === "S") renderer?.saveMapping();
    if (key === "l" || key === "L") renderer?.loadMapping();
  };

  window.mousePressed = function mousePressed() {
    renderer?.mousePressed?.(mouseX, mouseY);
    return false;
  };

  window.mouseDragged = function mouseDragged() {
    renderer?.mouseDragged?.(mouseX, mouseY);
    return false;
  };

  window.mouseReleased = function mouseReleased() {
    renderer?.mouseReleased?.();
    return false;
  };

  window.touchStarted = function touchStarted() {
    renderer?.mousePressed?.(mouseX, mouseY);
    return false;
  };

  window.touchMoved = function touchMoved() {
    renderer?.mouseDragged?.(mouseX, mouseY);
    return false;
  };

  window.touchEnded = function touchEnded() {
    renderer?.mouseReleased?.();
    return false;
  };

  window.windowResized = function windowResized() {
    resizeOutputIfNeeded(pendingState, mode, renderer);
  };

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
      if (!acceptedState || baseRevision !== receivedRevision || revision !== baseRevision + 1) {
        requestLivePatchResync("revision", { baseRevision, revision, acceptedRevision, receivedRevision });
        return;
      }
      const result = preparedState
        ? applyLiveRenderPatches(preparedState, patches)
        : renderer
          ? renderer.applyLivePatches(patches)
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
    onControlHello(meta = {}) {
      if (meta.changed && meta.sessionId) {
        receivedSessionId = meta.sessionId;
        receivedRevision = 0;
        acceptedRevision = 0;
        clearPreparedState();
      }
      bridge?.recoveryState(acceptedState, acceptedFiles);
    },
    onCommand(command, payload) {
      if (command === "sync-mapping" && acceptedState) {
        const nextState = {
          ...acceptedState,
          mappings: payload.mappings || acceptedState.mappings,
        };
        pendingState = nextState;
        acceptedState = nextState;
        renderer?.setState(nextState);
      }
      if (command === "sync-global" && acceptedState) {
        const nextState = {
          ...acceptedState,
          global: payload.global || acceptedState.global,
        };
        pendingState = nextState;
        acceptedState = nextState;
        renderer?.setState(nextState);
      }
      if (command === "set-calibrate") renderer?.setCalibrate(!!payload.calibrating);
      if (command === "save-mapping") renderer?.saveMapping();
      if (command === "reset-mapping") renderer?.resetMapping(payload.surfaceId);
      if (command === "export-mapping") renderer?.exportMapping();
      if (command === "schedule") renderer?.schedule(payload);
    },
  });

  function requestLivePatchResync(reason, detail = {}) {
    console.warn("[VJ1_LIVE_PATCH_RESYNC]", { reason, ...detail });
    bridge?.recordTransportResync(reason);
    bridge?.requestState();
  }

  function activatePreparedStateIfReady() {
    if (!renderer || !preparedState) return false;
    const status = renderer.prepareOutputState(preparedState);
    if (status.errorIds.size) {
      const signature = Array.from(status.errorIds).sort().join("|");
      if (signature !== prepareErrorSignature) {
        prepareErrorSignature = signature;
        console.error("[VJ1_SCENE_PREPARE_FAILED]", {
          sceneId: outputSceneId(preparedState),
          mediaIds: Array.from(status.errorIds),
          message: "Activating the requested Scene without a transition so its media failure remains visible",
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

  function acceptOutputState(state, revision, transportMeta = null) {
    pendingState = state;
    acceptedState = state;
    acceptedRevision = revision;
    receivedRevision = Math.max(receivedRevision, revision);
    if (typeof frameRate === "function") frameRate(renderMaxFrameRate(state?.render));
    if (renderer) resizeOutputIfNeeded(state, mode, renderer);
    renderer?.setState(state, { normalized: true });
    bridge?.markTransportApplied(transportMeta);
  }

  function clearPreparedState() {
    preparedState = null;
    preparedFromState = null;
    preparedRevision = 0;
    preparedTransportMeta = null;
    prepareErrorSignature = "";
    renderer?.clearPreparedOutputState?.();
  }

  if (fixtureUrl) {
    loadFixtureState(fixtureUrl)
      .then((state) => {
        pendingState = state;
        if (renderer) resizeOutputIfNeeded(state, mode, renderer);
        renderer?.setState(state);
      })
      .catch((error) => {
        console.warn(`[vj1] Could not load fixture state: ${error.message}`);
      });
  }

  loadClassicScript(VJ1.p5Script).catch((error) => {
    root.innerHTML = `<div class="empty-preview">${error.message}</div>`;
  });
}

export function shouldHoldCurrentOutputState(nextState, currentState) {
  if (!currentState || hasLoadedProjectState(nextState)) return false;
  return hasLoadedProjectState(currentState) && isEmptyStartupState(nextState);
}

export function outputSceneId(state) {
  // Live is the only program-scene authority. ui.selectedSceneId belongs to
  // the editor and must never become an output fallback during patch resync.
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
  return {
    ...state,
    liveTransition: {
      ...state.liveTransition,
      startedAtMs,
    },
  };
}

export function hasActiveLiveTransition(state, nowMs = Date.now()) {
  const durationMs = Math.max(0, Number(state?.liveTransition?.durationMs) || 0);
  const startedAtMs = Number(state?.liveTransition?.startedAtMs) || 0;
  return !!state?.liveTransition?.fromState && durationMs > 0 && startedAtMs > 0 && nowMs < startedAtMs + durationMs;
}

export function transitionTerminalState(state) {
  if (!state?.liveTransition) return state;
  const terminal = { ...state };
  delete terminal.liveTransition;
  return terminal;
}

export function queuedSceneTransitionState(state, fromState, startedAtMs = Date.now() + 50) {
  if (!state) return state;
  const configuredDurationMs = Math.round(Math.max(0, Number(state.ui?.live?.transitionDuration) || 0) * 1000);
  const durationMs = Math.max(0, Number(state.liveTransition?.durationMs) || configuredDurationMs);
  if (!fromState || durationMs <= 0) return transitionTerminalState(state);
  const stableFromState = transitionTerminalState(fromState);
  return {
    ...state,
    liveTransition: {
      id: state.liveTransition?.id || `${outputSceneId(stableFromState)}:${outputSceneId(state)}:${startedAtMs}`,
      startedAtMs,
      durationMs,
      // A superseded queued Scene may have different temporary overrides from
      // the actual completed source. Conservative identities avoid sharing a
      // render cache across two semantically different transition sides.
      componentsShared: false,
      fromState: stableFromState,
    },
  };
}

export function hasLoadedProjectState(state) {
  if (!state || typeof state !== "object") return false;
  return !!state.project?.folderName ||
    (Array.isArray(state.media) && state.media.length > 0) ||
    (Array.isArray(state.scenes) && state.scenes.length > 0);
}

export function isEmptyStartupState(state) {
  if (!state || typeof state !== "object") return false;
  return !state.project?.folderName &&
    (!Array.isArray(state.media) || state.media.length === 0) &&
    (!Array.isArray(state.scenes) || state.scenes.length === 0) &&
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

function resizeOutputIfNeeded(state, mode = "output", renderer = null) {
  const size = outputSize(state, mode);
  if (width === size.width && height === size.height) return;
  resizeCanvas(size.width, size.height);
  fitOutputCanvas(size);
  renderer?.resize?.();
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
