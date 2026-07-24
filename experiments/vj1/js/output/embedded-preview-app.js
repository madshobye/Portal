import { VJ1 } from "../constants.js";
import { alignLiveTransitionRenderContext } from "./live-transition-render-context.js?v=live-transition-geometry-1";
import { OutputRenderer } from "./output-renderer.js?v=mesh-pattern-node-authority-1";
import { MAX_PIXEL_DENSITY, normalizePixelDensity, renderPresentationFrameRate } from "../domain/render-settings.js?v=surface-terminology-1";
import { oppositeRenderPhaseDelayMs, previewPhaseNeedsRealignment } from "../domain/render-phase-policy.js?v=preview-phase-shift-1";
import { applyFontToGlobal, loadVjRenderFont } from "./font-loader.js?v=adaptive-component-demand-29";
import { createPreviewViewportController, fitPreviewCanvasElement, previewCanvasLogicalSize, previewViewportForUi, resolveViewportForFit } from "./preview-viewport.js?v=cursor-anchored-zoom-1";
import { canvasPointerToLogicalPoint } from "./preview-interaction-geometry.js?v=transform-hit-contract-4";
import { createThumbnailUrlLease } from "../services/component-thumbnail-store.js?v=thumbnail-url-lifecycle-1";
import { assertP5RenderCapabilities } from "../libraries/diagnostics-engine/browser-compatibility.js?v=explicit-capability-policy-1";

export function createEmbeddedPreviewApp({ store, mediaLibrary, projectService, onChainItemTarget }) {
  let host = null;
  let stage = null;
  let hud = null;
  let canvas = null;
  let renderer = null;
  let pendingState = null;
  let pendingMode = "preview";
  let started = false;
  let setupStarted = false;
  let resizeObserver = null;
  let observedResizeFrame = 0;
  let observedResizeSignature = "";
  let observedStage = null;
  let settleResizeFrame = 0;
  let settleResizeToken = 0;
  let layoutSettleActive = false;
  let revealCanvasAfterDraw = false;
  let canvasWidth = 0;
  let canvasHeight = 0;
  let pointerActive = false;
  let activePointerId = null;
  let unbindCanvasPointerEvents = null;
  let viewportController = null;
  let paused = false;
  let idleSuspended = false;
  let renderFont = null;
  let appliedFrameRate = 0;
  let outputPhaseOpen = false;
  let alignedFrameRate = 0;
  let phaseShiftTimer = 0;
  let mediaFilesSignature = "";
  let preparedLiveState = null;
  let preparedLiveErrorSignature = "";
  let activeRetimedTransition = null;
  let activeRetimedTransitionSceneId = "";
  let transformCommitFrame = 0;
  let pendingTransformCommit = null;
  let boundaryCommitFrame = 0;
  let pendingBoundaryCommit = null;
  let sceneSurfaceCommitRequest = 0;
  let pendingSurfaceCommit = null;
  let canvasFitSignature = "";
  const thumbnailObjectUrls = new Map();
  const thumbnailUrlLease = createThumbnailUrlLease();

  function mount({ host: nextHost, stage: nextStage, hud: nextHud, mode, state }) {
    const modeChanged = !!renderer && pendingMode !== mode;
    const stageChanged = !!canvas && stage !== nextStage;
    host = nextHost;
    stage = nextStage;
    hud = nextHud;
    pendingMode = mode;
    pendingState = preserveActiveRetimedTransition(state || pendingState || {});
    host?.classList.remove("is-paused");
    paused = false;
    idleSuspended = false;
    if (typeof loop === "function") loop();
    applyPreviewFrameRate();
    bindStageViewportEvents();
    observeCurrentStage();
    if (canvas && stage) canvas.parent(stage);
    if (renderer) {
      renderer.setInstalledNodePackages(projectService?.getInstalledNodePackages?.() || []);
      const needsSettledReveal = modeChanged || stageChanged || canvasElementIsHidden();
      renderer.mode = pendingMode;
      renderer.hud = hud;
      if (needsSettledReveal) hideCanvasUntilSettledDraw();
      const resized = resizeToStage({ forceFit: modeChanged || stageChanged });
      if (!resized) renderer.setState(previewSizedState(), { normalized: true });
      importMediaFilesIfChanged();
      renderer.setCalibrate(pendingMode === "preview" && pendingState.global.calibrating);
      scheduleSettledResize({ revealAfterDraw: needsSettledReveal });
    }
    if (!started) start();
  }

  function setState(state, mode = pendingMode) {
    wakePreviewPresentation();
    pendingMode = mode;
    pendingState = preserveActiveRetimedTransition(state || {});
    applyPreviewFrameRate();
    if (!renderer) return;
    renderer.setInstalledNodePackages(projectService?.getInstalledNodePackages?.() || []);
    renderer.mode = pendingMode;
    if (shouldPrepareEmbeddedLiveState(pendingState, renderer.state)) {
      preparedLiveState = previewSizedState();
      preparedLiveErrorSignature = "";
      importMediaFilesIfChanged();
      activatePreparedLiveStateIfReady();
      return;
    }
    clearPreparedLiveState();
    const resized = resizeToStage();
    if (!resized) renderer.setState(previewSizedState(), { normalized: true });
    importMediaFilesIfChanged();
  }

  function applyLivePatches(patches = []) {
    wakePreviewPresentation();
    return renderer?.applyLivePatches(patches);
  }

  function applyRenderPatches(patches = []) {
    wakePreviewPresentation();
    return renderer?.applyRenderPatches(patches);
  }

  function setViewport(ui = {}) {
    const currentUi = pendingState?.ui || {};
    pendingState = {
      ...(pendingState || {}),
      ui: {
        ...currentUi,
        previewViewports: ui.previewViewports || currentUi.previewViewports,
      },
    };
    const resolvedViewport = resolveViewportForFit({
      mode: pendingMode,
      workspace: pendingState.ui?.workspace,
      stageSize: stageSize(),
      viewport: previewViewportForUi(pendingState.ui),
      render: pendingState.render || {},
    });
    wakePreviewPresentation();
    return renderer?.setPreviewViewport(resolvedViewport) || false;
  }

  function setInstalledNodePackages(packages = []) {
    if (!renderer?.setInstalledNodePackages(packages)) return false;
    wakePreviewPresentation();
    return true;
  }

  function command(name, payload = {}) {
    wakePreviewPresentation();
    if (name === "set-calibrate") renderer?.setCalibrate(!!payload.calibrating);
    if (name === "reset-mapping") renderer?.resetMapping(payload.surfaceId);
    if (name === "export-mapping") renderer?.exportMapping();
    if (name === "schedule") renderer?.schedule(payload);
  }

  function pause() {
    host?.classList.add("is-paused");
    paused = true;
    idleSuspended = false;
    alignedFrameRate = 0;
    cancelPreviewPhaseShift();
    cancelSettledResize();
    if (typeof noLoop === "function") noLoop();
  }

  function cleanup() {
    if (transformCommitFrame) cancelAnimationFrame(transformCommitFrame);
    if (boundaryCommitFrame) cancelAnimationFrame(boundaryCommitFrame);
    if (sceneSurfaceCommitRequest) cancelAnimationFrame(sceneSurfaceCommitRequest);
    transformCommitFrame = 0;
    boundaryCommitFrame = 0;
    sceneSurfaceCommitRequest = 0;
    pendingTransformCommit = null;
    pendingBoundaryCommit = null;
    pendingSurfaceCommit = null;
    cancelPreviewPhaseShift();
    unbindCanvasPointerEvents?.();
    unbindCanvasPointerEvents = null;
    renderer?.dispose?.();
    renderer = null;
    idleSuspended = false;
    preparedLiveState = null;
    preparedLiveErrorSignature = "";
    activeRetimedTransition = null;
    activeRetimedTransitionSceneId = "";
    resizeObserver?.disconnect?.();
    resizeObserver = null;
    if (observedResizeFrame) cancelAnimationFrame(observedResizeFrame);
    observedResizeFrame = 0;
    observedResizeSignature = "";
    observedStage = null;
    cancelSettledResize();
    viewportController?.destroy?.();
    viewportController = null;
    thumbnailUrlLease.release();
    thumbnailObjectUrls.clear();
  }

  function start() {
    started = true;
    window.setup = setup;
    window.draw = draw;
    window.windowResized = resizeToStage;
    window.addEventListener("pagehide", cleanup, { once: true });
    loadClassicScript(VJ1.p5Script)
      .then(() => {
        setTimeout(() => {
          if (!setupStarted && typeof createCanvas === "function") setup();
        }, 0);
      })
      .catch((error) => {
        if (host) host.innerHTML = `<div class="empty-preview">${error.message}</div>`;
      });
  }

  async function setup() {
    if (setupStarted) return;
    setupStarted = true;
    const size = stageSize();
    canvas = createCanvas(size.width, size.height, WEBGL);
    assertP5RenderCapabilities();
    canvas.parent(stage);
    bindCanvasPointerEvents();
    applyLoadedFont();
    fitCanvasToStage(size);
    pixelDensity(1);
    applyPreviewFrameRate();
    if (window.p5) window.p5.disableFriendlyErrors = true;
    window.PORTAL_CANVAS_RESIZE_MODE = "none";
    await loadClassicScript(VJ1.portalScript);
    renderFont = await loadVjRenderFont();
    applyLoadedFont();
    renderer = new OutputRenderer({
      mode: pendingMode,
      hud,
      font: renderFont,
      sendMetrics: updateMetrics,
      sendMapping: updateMapping,
      sendThumbnail: updateThumbnail,
      sendChainTransform: updateChainTransform,
      sendChainBoundary: updateChainBoundary,
      onChainItemSelect: selectChainItem,
      onSceneSurfaceSelect: (surfaceId) => store.selectSurface?.(surfaceId),
      sendSurfaceRect: updateSceneSurface,
      sendMediaRendition: (mediaId, width, height, blob, sourceRevision) => projectService?.writeMediaRendition?.(mediaId, width, height, blob, sourceRevision),
      sendMediaMetadata: updateMediaMetadata,
      requestMediaFiles: () => importMediaFilesIfChanged(true),
      requestPresentationFrame: wakePreviewPresentation,
      onSurfaceSelect: selectSurface,
      installedNodePackages: projectService?.getInstalledNodePackages?.() || [],
    });
    await renderer.setup(previewSizedState(size), { normalized: true });
    importMediaFilesIfChanged(true);
    // ResizeObserver callbacks run inside layout delivery. Resizing a p5
    // canvas synchronously from that callback can produce another notification
    // in the same delivery cycle. Coalesce onto the next frame and ignore
    // duplicate integer sizes; the renderer still receives every visible size.
    resizeObserver = new ResizeObserver(scheduleObservedStageResize);
    observeCurrentStage();
  }

  function applyLoadedFont() {
    applyFontToGlobal(renderFont);
  }

  function draw() {
    if (paused) return;
    applyPreviewFrameRate();
    renderer?.draw();
    syncPreviewGeometryDiagnostics();
    activatePreparedLiveStateIfReady();
    if (revealCanvasAfterDraw) {
      revealCanvasAfterDraw = false;
      const element = canvas?.elt || canvas;
      if (element?.style) element.style.visibility = "visible";
    }
    suspendStablePreviewPresentation();
  }

  function wakePreviewPresentation() {
    if (paused || !idleSuspended) return;
    idleSuspended = false;
    if (typeof loop === "function") loop();
  }

  function suspendStablePreviewPresentation() {
    if (
      paused ||
      idleSuspended ||
      pointerActive ||
      layoutSettleActive ||
      revealCanvasAfterDraw ||
      preparedLiveState ||
      renderer?.presentationFrameMode?.() !== "on-change" ||
      typeof noLoop !== "function"
    ) return;
    idleSuspended = true;
    noLoop();
  }

  // Dormant geometry probe for future preview-layout investigations. Calling
  // this once per draw restores the CSS p5 boundary, internal framebuffer
  // boundary, and diagonal without changing the normal preview path.
  function drawPreviewGeometryDiagnostics() {
    if (!renderer || pendingMode === "output" || typeof push !== "function") return;
    push();
    resetMatrix();
    noFill();
    stroke("#54e4d4");
    strokeWeight(2);
    rectMode(CORNER);
    rect((-width / 2) + 1, (-height / 2) + 1, Math.max(0, width - 2), Math.max(0, height - 2));
    stroke("#35e65c");
    line((-width / 2) + 1, (-height / 2) + 1, (width / 2) - 1, (height / 2) - 1);
    pop();
  }

  function syncPreviewGeometryDiagnostics() {
    const enabled = pendingMode !== "output" && pendingState?.ui?.previewDiagnostics === true;
    const element = canvas?.elt || canvas;
    element?.classList?.toggle("is-geometry-diagnostic", enabled);
    if (enabled) drawPreviewGeometryDiagnostics();
  }

  function bindCanvasPointerEvents() {
    unbindCanvasPointerEvents?.();
    const element = canvas?.elt || canvas;
    if (!element?.addEventListener) return;
    const point = (event) => {
      const rect = element.getBoundingClientRect();
      // p5 logical coordinates own editor geometry. The DOM width/height are
      // backing-store pixels and may temporarily differ after density or
      // resize changes, so they must never scale pointer input.
      return canvasPointerToLogicalPoint(event.clientX, event.clientY, rect, {
        width: Number(canvasWidth) || Number(globalThis.width) || rect.width,
        height: Number(canvasHeight) || Number(globalThis.height) || rect.height,
      });
    };
    const onPointerDown = (event) => {
      // Shift/Alt drag belongs to the shared viewport navigation controller,
      // not to Scene frames, Components, or mapping handles.
      if (event.button !== 0 || event.shiftKey || event.altKey) return;
      wakePreviewPresentation();
      event.preventDefault();
      pointerActive = true;
      activePointerId = event.pointerId;
      renderer?.setThumbnailInteractionActive?.(true);
      element.setPointerCapture?.(event.pointerId);
      const position = point(event);
      renderer?.mousePressed?.(position.x, position.y);
    };
    const onPointerMove = (event) => {
      if (!pointerActive || event.pointerId !== activePointerId) return;
      wakePreviewPresentation();
      event.preventDefault();
      const position = point(event);
      renderer?.mouseDragged?.(position.x, position.y);
    };
    const finishPointer = (event) => {
      if (!pointerActive || event.pointerId !== activePointerId) return;
      wakePreviewPresentation();
      pointerActive = false;
      activePointerId = null;
      element.releasePointerCapture?.(event.pointerId);
      renderer?.mouseReleased?.();
      renderer?.setThumbnailInteractionActive?.(false);
    };
    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", finishPointer);
    element.addEventListener("pointercancel", finishPointer);
    unbindCanvasPointerEvents = () => {
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", finishPointer);
      element.removeEventListener("pointercancel", finishPointer);
      pointerActive = false;
      activePointerId = null;
      renderer?.setThumbnailInteractionActive?.(false);
    };
  }

  function resizeToStage({ forceFit = false } = {}) {
    if (!canvas || !stage) return false;
    wakePreviewPresentation();
    const size = stageSize();
    const logical = canvasLogicalSize();
    if (logical.width === canvasWidth && logical.height === canvasHeight) {
      fitCanvasToStageIfChanged(size, logical, forceFit);
      return false;
    }
    canvasWidth = logical.width;
    canvasHeight = logical.height;
    resizeCanvas(logical.width, logical.height);
    fitCanvasToStageIfChanged(size, logical, true);
    renderer?.setState(previewSizedState(size), { normalized: true });
    return true;
  }

  function fitCanvasToStageIfChanged(size, logical, force = false) {
    const nextSignature = previewFitSignature({
      mode: pendingMode,
      size,
      logical,
      viewport: previewViewportForUi(pendingState?.ui),
      render: pendingState?.render,
    });
    if (!force && nextSignature === canvasFitSignature) return false;
    canvasFitSignature = nextSignature;
    fitCanvasToStage(size, logical);
    return true;
  }

  function observeCurrentStage() {
    if (!resizeObserver || observedStage === stage) return;
    if (observedStage) resizeObserver.unobserve?.(observedStage);
    observedStage = stage;
    observedResizeSignature = "";
    if (observedStage) resizeObserver.observe(observedStage);
  }

  function scheduleObservedStageResize(entries = []) {
    const entry = entries.find((candidate) => candidate.target === observedStage) || entries.at(-1);
    const rect = entry?.contentRect;
    const signature = rect
      ? `${Math.floor(Number(rect.width) || 0)}:${Math.floor(Number(rect.height) || 0)}`
      : "";
    if (signature && signature === observedResizeSignature) return;
    observedResizeSignature = signature;
    if (layoutSettleActive || observedResizeFrame) return;
    observedResizeFrame = requestAnimationFrame(() => {
      observedResizeFrame = 0;
      if (!layoutSettleActive) resizeToStage();
    });
  }

  function scheduleSettledResize({ revealAfterDraw = false } = {}) {
    cancelSettledResize();
    const token = ++settleResizeToken;
    const targetStage = stage;
    let previousSize = null;
    let stableMeasurements = 0;
    let attempts = 0;
    layoutSettleActive = true;
    const measure = () => {
      if (token !== settleResizeToken || targetStage !== stage) return;
      attempts++;
      const size = stageSize();
      if (previousSize && size.width === previousSize.width && size.height === previousSize.height) {
        stableMeasurements++;
      } else {
        stableMeasurements = 0;
      }
      previousSize = size;
      if (stableMeasurements < 1 && attempts < 8) {
        settleResizeFrame = requestAnimationFrame(measure);
        return;
      }
      settleResizeFrame = 0;
      layoutSettleActive = false;
      if (revealAfterDraw) revealCanvasAfterDraw = true;
      resizeToStage({ forceFit: true });
    };
    settleResizeFrame = requestAnimationFrame(measure);
  }

  function cancelSettledResize() {
    if (settleResizeFrame) cancelAnimationFrame(settleResizeFrame);
    settleResizeFrame = 0;
    settleResizeToken++;
    layoutSettleActive = false;
    revealCanvasAfterDraw = false;
  }

  function hideCanvasUntilSettledDraw() {
    const element = canvas?.elt || canvas;
    if (element?.style) element.style.visibility = "hidden";
    revealCanvasAfterDraw = false;
  }

  function canvasElementIsHidden() {
    const element = canvas?.elt || canvas;
    return element?.style?.visibility === "hidden";
  }

  function stageSize() {
    const rect = stage?.getBoundingClientRect?.();
    return {
      width: Math.max(1, Math.floor(rect?.width || window.innerWidth || 960)),
      height: Math.max(1, Math.floor(rect?.height || window.innerHeight || 540)),
    };
  }

  function canvasLogicalSize() {
    const host = stageSize();
    const size = previewCanvasLogicalSize({
      mode: pendingMode,
      workspace: pendingState?.ui?.workspace,
      render: {
        ...(pendingState?.render || {}),
        hostViewport: { ...host, mode: "preview", outputId: "" },
      },
    });
    return {
      width: Math.max(1, Math.floor(size.width || VJ1.renderWidth)),
      height: Math.max(1, Math.floor(size.height || VJ1.renderHeight)),
    };
  }

  function fitCanvasToStage(size = stageSize(), logical = canvasLogicalSize()) {
    fitPreviewCanvasElement({
      canvas,
      mode: pendingMode,
      workspace: pendingState?.ui?.workspace,
      stageSize: size,
      logicalSize: logical,
      viewport: previewViewportForUi(pendingState?.ui),
      render: pendingState?.render || {},
    });
  }

  function previewSizedState(size = stageSize()) {
    const state = pendingState || {};
    const logical = canvasLogicalSize();
    const resolvedViewport = resolveViewportForFit({
      mode: pendingMode,
      workspace: state.ui?.workspace,
      stageSize: size,
      viewport: previewViewportForUi(state.ui),
      render: state.render || {},
    });
    const deviceScale = Math.max(1, Math.min(MAX_PIXEL_DENSITY, Number(window.devicePixelRatio) || 1));
    const displayScale = Math.min(size.width / logical.width, size.height / logical.height, 1);
    const configuredDensity = normalizePixelDensity(state.render?.pixelDensity);
    const previewQuality = ["auto", "good", "low"].includes(state.ui?.previewQuality)
      ? state.ui.previewQuality
      : "good";
    const previewDensity = previewRasterDensity({
      configuredDensity,
      displayScale,
      deviceScale,
      quality: previewQuality,
    });
    return alignLiveTransitionRenderContext({
      ...state,
      render: {
        ...state.render,
        // Transient demand hint: logical coordinates stay project-sized while
        // physical buffers follow the pixels the embedded preview can display.
        previewQuality,
        previewRasterScale: previewDensity / configuredDensity,
        // Transient presentation diagnostic. It is deliberately separate
        // from render demand: view zoom moves the preview canvas but does not
        // silently change the authored frame's Good-quality request.
        previewViewportZoom: Math.max(0.1, Math.min(6, Number(resolvedViewport?.zoom) || 1)),
        previewViewportX: Number(resolvedViewport?.x) || 0,
        previewViewportY: Number(resolvedViewport?.y) || 0,
        hostViewport: {
          width: Math.max(1, Math.floor(Number(size.width) || VJ1.renderWidth)),
          height: Math.max(1, Math.floor(Number(size.height) || VJ1.renderHeight)),
          mode: "preview",
          outputId: "",
        },
      },
    });
  }

  function applyPreviewFrameRate() {
    if (typeof frameRate !== "function") return;
    // A standalone output is presentation truth. Keep its frame budget stable
    // by throttling the duplicate embedded render regardless of workspace.
    const target = renderPresentationFrameRate(pendingState?.render, {
      mode: "preview",
      // Thumbnail/live rendering is a display strategy, not a clock mode.
      // Toggling it must not alter the speed of time-driven generators.
      thumbnailPreview: false,
      outputWindowOpen: pendingState?.ui?.outputWindowOpen === true,
    });
    if (appliedFrameRate !== target) {
      frameRate(target);
      appliedFrameRate = target;
    }
    const outputWindowOpen = !!pendingState?.ui?.outputWindowOpen;
    const shouldRealign = previewPhaseNeedsRealignment({
      outputWindowOpen,
      wasOutputWindowOpen: outputPhaseOpen,
      frameRate: target,
      alignedFrameRate,
    });
    outputPhaseOpen = outputWindowOpen;
    if (!outputWindowOpen) {
      alignedFrameRate = 0;
      cancelPreviewPhaseShift({ resume: true });
      return;
    }
    if (!shouldRealign) return;
    alignedFrameRate = target;
    schedulePreviewPhaseShift(target);
  }

  function schedulePreviewPhaseShift(targetFrameRate) {
    cancelPreviewPhaseShift();
    if (paused || typeof noLoop !== "function" || typeof loop !== "function") return;
    // Output owns presentation timing. Suspend only the duplicate embedded
    // preview, then resume it halfway through the output frame interval so the
    // two WebGL contexts do not normally submit their largest work together.
    noLoop();
    phaseShiftTimer = setTimeout(() => {
      phaseShiftTimer = 0;
      if (!paused && outputPhaseOpen) loop();
    }, oppositeRenderPhaseDelayMs(targetFrameRate));
  }

  function cancelPreviewPhaseShift({ resume = false } = {}) {
    if (!phaseShiftTimer) return;
    clearTimeout(phaseShiftTimer);
    phaseShiftTimer = 0;
    if (resume && !paused && typeof loop === "function") loop();
  }

  function importMediaFilesIfChanged(force = false) {
    if (!renderer) return;
    const files = mediaLibrary.getAllFiles();
    const signature = mediaFilesSignatureFor(files);
    if (!force && signature === mediaFilesSignature) return;
    wakePreviewPresentation();
    mediaFilesSignature = signature;
    renderer.importFiles(files);
    activatePreparedLiveStateIfReady();
  }

  function activatePreparedLiveStateIfReady() {
    if (!renderer || !preparedLiveState) return false;
    const status = renderer.prepareOutputState(preparedLiveState, { requireMedia: true });
    if (status.errorIds.size) {
      const signature = Array.from(status.errorIds).sort().join("|");
      if (signature !== preparedLiveErrorSignature) {
        preparedLiveErrorSignature = signature;
        console.error("[VJ1_LIVE_PREVIEW_PREPARE_FAILED]", {
          sceneId: previewSceneId(preparedLiveState),
          mediaIds: Array.from(status.errorIds),
          message: "Keeping the current Scene because requested media failed to load",
        });
      }
      return false;
    }
    if (status.blocked) return false;
    const state = retimeEmbeddedLiveTransition(preparedLiveState);
    activeRetimedTransition = state.liveTransition || null;
    activeRetimedTransitionSceneId = activeRetimedTransition ? previewSceneId(state) : "";
    preparedLiveState = null;
    preparedLiveErrorSignature = "";
    renderer.clearPreparedOutputState();
    renderer.setState(state, { normalized: true });
    return true;
  }

  function clearPreparedLiveState() {
    preparedLiveState = null;
    preparedLiveErrorSignature = "";
    renderer?.clearPreparedOutputState?.();
  }

  function preserveActiveRetimedTransition(state) {
    if (!activeRetimedTransition) return state;
    const sameScene = previewSceneId(state) === activeRetimedTransitionSceneId;
    const endsAt = Number(activeRetimedTransition.startedAtMs) + Number(activeRetimedTransition.durationMs);
    if (!sameScene || !Number.isFinite(endsAt) || Date.now() >= endsAt) {
      activeRetimedTransition = null;
      activeRetimedTransitionSceneId = "";
      return state;
    }
    return { ...state, liveTransition: activeRetimedTransition };
  }

  function bindStageViewportEvents() {
    if (!stage || viewportController?.stage === stage) return;
    viewportController?.destroy?.();
    viewportController = createPreviewViewportController({
      stage,
      store,
      getMode: () => pendingMode,
      getViewport: () => resolveViewportForFit({
        mode: pendingMode,
        workspace: pendingState?.ui?.workspace,
        stageSize: stageSize(),
        viewport: previewViewportForUi(pendingState?.ui),
        render: pendingState?.render || {},
      }),
      onPanStart: () => {
        pointerActive = false;
        activePointerId = null;
        renderer?.setThumbnailInteractionActive?.(false);
      },
    });
    viewportController.stage = stage;
  }

  function updateMetrics(metrics = {}) {
    // Metrics arrive twice a second. Keep them on the runtime-only path so a
    // large project is not deep-cloned merely to publish performance counters;
    // that allocation burst otherwise produces a small periodic GC hitch.
    store.updateRuntime((runtimeMetrics) => {
      runtimeMetrics.previewFps = metrics.fps || 0;
      runtimeMetrics.previewFrameMs = metrics.frameMs || 0;
      runtimeMetrics.previewGpuMs = metrics.gpuMs || 0;
      runtimeMetrics.previewGpuSupported = metrics.gpuSupported === true;
      runtimeMetrics.previewRenderCost = metrics.renderCost || 0;
      runtimeMetrics.previewProfile = metrics.profile || null;
    }, "preview-metrics");
  }

  function updateMapping(mappingId, mapping, status, meta = {}) {
    const reason = meta.live ? "scrub:mapping-state" : "mapping-state";
    if (typeof store.updateMapping === "function") {
      store.updateMapping(mappingId || "local", mapping, status, reason);
      return;
    }
    store.update((draft) => {
      draft.mappingCalibration = mapping;
      const selected = draft.mappings?.find((entry) => entry.id === draft.ui?.selectedMappingId);
      if (selected) selected.calibration = mapping;
      draft.ui.mappingStatus = status || "Mapping updated";
    }, reason);
  }

  function updateThumbnail(componentId, thumbnail, meta = {}) {
    if (!componentId || !thumbnail) return;
    // The store is the newest toggle authority. Reject an in-flight capture
    // from a frame that started before live preview rendering was disabled.
    const debugPreviewEnabled = typeof store.isDebugPreviewEnabled === "function"
      ? store.isDebugPreviewEnabled()
      : store.getState()?.ui?.debugPreview !== false;
    if (!debugPreviewEnabled) return false;
    const surfaceId = meta.surfaceId || "";
    const key = `${componentId}:${surfaceId}`;
    const isBlob = typeof Blob === "function" && thumbnail instanceof Blob;
    const publishedThumbnail = isBlob ? URL.createObjectURL(thumbnail) : thumbnail;
    const result = typeof store.setComponentThumbnail === "function"
      ? store.setComponentThumbnail(componentId, surfaceId, publishedThumbnail)
      : publishThumbnailThroughDerivedState(componentId, surfaceId, publishedThumbnail);
    if (result?.updated === false) {
      if (isBlob) URL.revokeObjectURL(publishedThumbnail);
      return false;
    }
    if (isBlob) {
      thumbnailObjectUrls.set(key, publishedThumbnail);
      thumbnailUrlLease.activate(thumbnailObjectUrls.values());
    }
    projectService.writeComponentThumbnail(componentId, surfaceId, thumbnail).catch((error) => {
      console.warn("[VJ1_THUMBNAIL_WRITE_FAILED]", {
        componentId,
        surfaceId,
        fallback: "retain the in-memory thumbnail until it can be regenerated",
        message: error?.message || String(error),
      });
    });
    return true;
  }

  function updateMediaMetadata(mediaId, metadata = {}) {
    const duration = Number(metadata.duration);
    if (!mediaId || !Number.isFinite(duration) || duration <= 0) {
      console.warn("[VJ1_MEDIA_METADATA_REJECTED]", {
        mediaId,
        metadata,
        message: "Ignoring media metadata without a finite positive duration",
      });
      return false;
    }
    let updated = false;
    store.updateDerived((draft) => {
      const media = draft.media?.find((item) => item.id === mediaId);
      if (!media || Math.abs(Number(media.duration || 0) - duration) < 0.001) return;
      media.duration = duration;
      updated = true;
    }, "media-metadata");
    return updated;
  }

  function publishThumbnailThroughDerivedState(componentId, surfaceId, thumbnail) {
    let updated = false;
    store.updateDerived((draft) => {
      const component = draft.components.find((item) => item.id === componentId);
      if (!component) return;
      if (surfaceId && component.type === "scene") {
        component.scene ||= {};
        component.scene.surfaceThumbnails ||= {};
        if (component.scene.surfaceThumbnails[surfaceId] !== thumbnail) {
          component.scene.surfaceThumbnails[surfaceId] = thumbnail;
          updated = true;
        }
      } else if (component.thumbnail !== thumbnail) {
        component.thumbnail = thumbnail;
        updated = true;
      }
    }, "component-thumbnail");
    return { updated };
  }

  function updateChainTransform(componentId, itemId, transform, meta = {}) {
    if (!meta.commit) {
      pendingTransformCommit = { componentId, itemId, transform };
      if (!transformCommitFrame) transformCommitFrame = requestAnimationFrame(flushPendingTransformCommit);
      return;
    }
    if (transformCommitFrame) cancelAnimationFrame(transformCommitFrame);
    transformCommitFrame = 0;
    pendingTransformCommit = null;
    commitChainTransform(componentId, itemId, transform, true);
  }

  function flushPendingTransformCommit() {
    transformCommitFrame = 0;
    const pending = pendingTransformCommit;
    pendingTransformCommit = null;
    if (pending) commitChainTransform(pending.componentId, pending.itemId, pending.transform, false);
  }

  function commitChainTransform(componentId, itemId, transform, commit) {
    const renderPatches = [];
    store.update((draft) => {
      const component = draft.components.find((item) => item.id === componentId);
      const itemPath = chainItemPath(component?.chain, itemId);
      const item = findChainItemById(component?.chain, itemId);
      if (!item) return;
      item.transform = { ...item.transform, ...transform };
      if (itemPath) renderPatches.push({
        componentId,
        path: `${itemPath}.transform`,
        value: item.transform,
      });
    }, {
      reason: commit ? "update:chain-transform" : "scrub:chain-transform",
      renderPatches,
    });
  }

  function updateChainBoundary(componentId, itemId, boundary, meta = {}) {
    if (!meta.commit) {
      pendingBoundaryCommit = { componentId, itemId, boundary };
      if (!boundaryCommitFrame) boundaryCommitFrame = requestAnimationFrame(flushPendingBoundaryCommit);
      return;
    }
    if (boundaryCommitFrame) cancelAnimationFrame(boundaryCommitFrame);
    boundaryCommitFrame = 0;
    pendingBoundaryCommit = null;
    commitChainBoundary(componentId, itemId, boundary, true);
  }

  function flushPendingBoundaryCommit() {
    boundaryCommitFrame = 0;
    const pending = pendingBoundaryCommit;
    pendingBoundaryCommit = null;
    if (pending) commitChainBoundary(pending.componentId, pending.itemId, pending.boundary, false);
  }

  function commitChainBoundary(componentId, itemId, boundary, commit) {
    const renderPatches = [];
    store.update((draft) => {
      const component = draft.components.find((item) => item.id === componentId);
      const itemPath = chainItemPath(component?.chain, itemId);
      const item = findChainItemById(component?.chain, itemId);
      if (!item) return;
      item.boundary = { ...item.boundary, ...boundary };
      if (itemPath) renderPatches.push({
        componentId,
        path: `${itemPath}.boundary`,
        value: item.boundary,
      });
    }, {
      reason: commit ? "update:chain-boundary" : "scrub:chain-boundary",
      renderPatches,
    });
  }

  function updateSceneSurface(componentId, surfaceId, rect, meta = {}) {
    if (!meta.commit) {
      pendingSurfaceCommit = { componentId, surfaceId, rect };
      if (!sceneSurfaceCommitRequest) sceneSurfaceCommitRequest = requestAnimationFrame(flushPendingSceneSurfaceCommit);
      return;
    }
    if (sceneSurfaceCommitRequest) cancelAnimationFrame(sceneSurfaceCommitRequest);
    sceneSurfaceCommitRequest = 0;
    pendingSurfaceCommit = null;
    commitSceneSurface(componentId, surfaceId, rect, true);
  }

  function flushPendingSceneSurfaceCommit() {
    sceneSurfaceCommitRequest = 0;
    const pending = pendingSurfaceCommit;
    pendingSurfaceCommit = null;
    if (pending) commitSceneSurface(pending.componentId, pending.surfaceId, pending.rect, false);
  }

  function commitSceneSurface(componentId, surfaceId, rect, commit) {
    store.update((draft) => {
      const mapping = draft.mappings?.find((item) => item.id === draft.ui?.selectedMappingId) || draft.mappings?.[0];
      const surface = mapping?.surfaces?.find((item) => item.id === surfaceId);
      if (surface) Object.assign(surface, rect);
    }, commit ? "update:scene-surface" : "scrub:scene-surface");
  }

  function selectSurface(surfaceId) {
    if (!surfaceId) return;
    const state = store.getState();
    if (state.ui.selectedSurfaceId === surfaceId
      && (state.ui.workspace !== "scene" || state.ui.sceneInspectorTarget === "surface")) return;
    store.selectSurface(surfaceId);
  }

  function selectChainItem(itemId) {
    if (!itemId) return;
    const state = store.getState();
    onChainItemTarget?.(state.ui.selectedComponentId, itemId);
    if (state.ui.selectedChainItemId === itemId
      && (state.ui.workspace !== "scene" || state.ui.sceneInspectorTarget === "element")) return;
    store.selectChainItem(itemId);
  }

  return {
    mount,
    setState,
    setInstalledNodePackages,
    applyLivePatches,
    applyRenderPatches,
    setViewport,
    command,
    pause,
  };
}

export function shouldPrepareEmbeddedLiveState(nextState, currentState) {
  // The editor monitor must follow the pressed Scene immediately. Standalone
  // outputs retain their media-preparation queue, but holding the embedded
  // preview behind readiness made a click flash and then appear to do nothing
  // whenever one optional asset was pending.
  return false;
}

export function retimeEmbeddedLiveTransition(state, startedAtMs = Date.now() + 50) {
  if (!state?.liveTransition) return state;
  return {
    ...state,
    liveTransition: {
      ...state.liveTransition,
      startedAtMs,
    },
  };
}

function previewSceneId(state) {
  // A Live preview follows program state, never the Scene currently open in
  // another editor workspace. Non-Live callers use the editor Scene.
  return String(state?.ui?.workspace === "live"
    ? state?.ui?.live?.selectedSceneId || ""
    : state?.ui?.selectedMappingId || "");
}

export function mediaFilesSignatureFor(entries = []) {
  return (entries || [])
    .map((entry) => {
      const file = entry?.file || entry || {};
      const id = entry?.id || file.relativePath || file.webkitRelativePath || file.name || "";
      const renditions = (entry?.renditions || [])
        .map((rendition) => `${rendition.key || ""}:${rendition.file?.size || 0}:${rendition.file?.lastModified || 0}`)
        .sort()
        .join(",");
      return `${id}:${file.size || 0}:${file.lastModified || 0}:${file.type || ""}:${renditions}`;
    })
    .sort()
    .join("|");
}

export function previewRasterDensity({ configuredDensity = 1, displayScale = 1, deviceScale = 1, quality = "auto" } = {}) {
  const configured = normalizePixelDensity(configuredDensity);
  const nativeDisplay = Math.max(1, Math.min(MAX_PIXEL_DENSITY, Number(deviceScale) || 1));
  const good = Math.max(configured, nativeDisplay);
  if (quality === "good" || quality === "full") return good;
  const automatic = Math.min(configured, Math.max(0.125, Number(displayScale) * Number(deviceScale) || 0.125));
  return quality === "low" ? Math.max(0.125, automatic * 0.5) : automatic;
}

export function previewFitSignature({ mode = "preview", size = {}, logical = {}, viewport = {}, render = {} } = {}) {
  const outputs = (render?.outputs || []).map((output) => `${output.id || ""}:${output.aspectRatio || 0}`).join("|");
  return [
    mode,
    Number(size.width) || 0,
    Number(size.height) || 0,
    Number(logical.width) || 0,
    Number(logical.height) || 0,
    viewport.fit || "world",
    Number(viewport.zoom) || 1,
    Number(viewport.x) || 0,
    Number(viewport.y) || 0,
    outputs,
  ].join(":");
}

function findChainItemById(chain = [], id = "") {
  if (!Array.isArray(chain) || !id) return null;
  for (const item of chain) {
    if (item.id === id) return item;
    const nested = item.kind === "group" ? findChainItemById(item.chain, id) : null;
    if (nested) return nested;
  }
  return null;
}

function chainItemPath(chain = [], id = "", prefix = "chain") {
  for (let index = 0; index < (chain || []).length; index++) {
    const item = chain[index];
    const path = `${prefix}.${index}`;
    if (item?.id === id) return path;
    if (item?.kind === "group") {
      const nested = chainItemPath(item.chain, id, `${path}.chain`);
      if (nested) return nested;
    }
  }
  return "";
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
