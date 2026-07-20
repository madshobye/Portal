import { VJ1 } from "../constants.js";
import { OutputRenderer } from "./output-renderer.js?v=thumbnail-pipeline-1";
import { renderMaxFrameRate } from "../domain/render-settings.js?v=screen-input-registry-1";
import { oppositeRenderPhaseDelayMs, previewPhaseNeedsRealignment } from "../domain/render-phase-policy.js?v=preview-phase-shift-1";
import { applyFontToGlobal, loadVjRenderFont } from "./font-loader.js?v=adaptive-component-demand-29";
import { createPreviewViewportController, fitPreviewCanvasElement, previewViewportForUi } from "./preview-viewport.js?v=render-coordinate-scope-3";
import { canvasPointerToLogicalPoint } from "./preview-interaction-geometry.js?v=transform-hit-contract-3";
import { canvasSizeForMode } from "./render-geometry.js?v=adaptive-component-demand-29";

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
  let canvasCommitFrame = 0;
  let pendingCanvasCommit = null;
  let canvasFitSignature = "";
  const thumbnailObjectUrls = new Map();

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
    if (typeof loop === "function") loop();
    applyPreviewFrameRate();
    bindStageViewportEvents();
    observeCurrentStage();
    if (canvas && stage) canvas.parent(stage);
    if (renderer) {
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
    pendingMode = mode;
    pendingState = preserveActiveRetimedTransition(state || {});
    applyPreviewFrameRate();
    if (!renderer) return;
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
    return renderer?.applyLivePatches(patches);
  }

  function command(name, payload = {}) {
    if (name === "set-calibrate") renderer?.setCalibrate(!!payload.calibrating);
    if (name === "reset-mapping") renderer?.resetMapping(payload.surfaceId);
    if (name === "export-mapping") renderer?.exportMapping();
    if (name === "schedule") renderer?.schedule(payload);
  }

  function pause() {
    host?.classList.add("is-paused");
    paused = true;
    alignedFrameRate = 0;
    cancelPreviewPhaseShift();
    cancelSettledResize();
    if (typeof noLoop === "function") noLoop();
  }

  function cleanup() {
    if (transformCommitFrame) cancelAnimationFrame(transformCommitFrame);
    if (canvasCommitFrame) cancelAnimationFrame(canvasCommitFrame);
    transformCommitFrame = 0;
    canvasCommitFrame = 0;
    pendingTransformCommit = null;
    pendingCanvasCommit = null;
    cancelPreviewPhaseShift();
    unbindCanvasPointerEvents?.();
    unbindCanvasPointerEvents = null;
    renderer?.dispose?.();
    renderer = null;
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
      onChainItemSelect: selectChainItem,
      sendCanvasFrame: updateCanvasFrame,
      sendMediaRendition: (mediaId, width, height, blob, sourceRevision) => projectService?.writeMediaRendition?.(mediaId, width, height, blob, sourceRevision),
      requestMediaFiles: () => importMediaFilesIfChanged(true),
      onSurfaceSelect: selectSurface,
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
    activatePreparedLiveStateIfReady();
    if (revealCanvasAfterDraw) {
      revealCanvasAfterDraw = false;
      const element = canvas?.elt || canvas;
      if (element?.style) element.style.visibility = "visible";
    }
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
      if (event.button !== 0 || event.altKey) return;
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
      event.preventDefault();
      const position = point(event);
      renderer?.mouseDragged?.(position.x, position.y);
    };
    const finishPointer = (event) => {
      if (!pointerActive || event.pointerId !== activePointerId) return;
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
      width: Math.max(320, Math.floor(rect?.width || window.innerWidth || 960)),
      height: Math.max(180, Math.floor(rect?.height || window.innerHeight || 540)),
    };
  }

  function canvasLogicalSize() {
    const size = canvasSizeForMode(pendingMode, pendingState?.render || {});
    return {
      width: Math.max(320, Math.floor(size.width || VJ1.renderWidth)),
      height: Math.max(180, Math.floor(size.height || VJ1.renderHeight)),
    };
  }

  function fitCanvasToStage(size = stageSize(), logical = canvasLogicalSize()) {
    fitPreviewCanvasElement({
      canvas,
      mode: pendingMode,
      stageSize: size,
      logicalSize: logical,
      viewport: previewViewportForUi(pendingState?.ui),
      render: pendingState?.render || {},
    });
  }

  function previewSizedState(size = stageSize()) {
    const state = pendingState || {};
    const logical = canvasLogicalSize();
    const deviceScale = Math.max(1, Math.min(2, Number(window.devicePixelRatio) || 1));
    const displayScale = Math.min(size.width / logical.width, size.height / logical.height, 1);
    const configuredDensity = Math.max(0.5, Math.min(2, Number(state.render?.pixelDensity) || 1));
    const workspace = state.ui?.workspace;
    const previewQuality = pendingMode === "preview" && (workspace === "scene" || workspace === "live")
      ? state.ui?.previewQualities?.[workspace]
      : "auto";
    const previewDensity = previewRasterDensity({
      configuredDensity,
      displayScale,
      deviceScale,
      quality: previewQuality,
    });
    return {
      ...state,
      render: {
        ...state.render,
        // Transient demand hint: logical coordinates stay project-sized while
        // physical buffers follow the pixels the embedded preview can display.
        previewRasterScale: previewDensity / configuredDensity,
      },
    };
  }

  function applyPreviewFrameRate() {
    if (typeof frameRate !== "function") return;
    // A standalone output is presentation truth. Keep its frame budget stable
    // by throttling the duplicate embedded render regardless of workspace.
    const previewTarget = pendingState?.ui?.debugPreview === false
      ? 60
      : pendingState?.ui?.outputWindowOpen
        ? 30
        : 60;
    const target = Math.min(previewTarget, renderMaxFrameRate(pendingState?.render));
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
      getViewport: () => previewViewportForUi(pendingState?.ui),
      onPanStart: () => {
        pointerActive = false;
        activePointerId = null;
        renderer?.setThumbnailInteractionActive?.(false);
      },
    });
    viewportController.stage = stage;
  }

  function updateMetrics(metrics = {}) {
    store.updateDerived((draft) => {
      draft.metrics.previewFps = metrics.fps || 0;
      draft.metrics.previewFrameMs = metrics.frameMs || 0;
      draft.metrics.previewGpuMs = metrics.gpuMs || 0;
      draft.metrics.previewGpuSupported = metrics.gpuSupported === true;
      draft.metrics.previewRenderCost = metrics.renderCost || 0;
      draft.metrics.previewProfile = metrics.profile || null;
    }, "preview-metrics");
  }

  function updateMapping(mappingId, mapping, status, meta = {}) {
    const reason = meta.live ? "scrub:mapping-state" : "mapping-state";
    if (typeof store.updateMapping === "function") {
      store.updateMapping(mappingId || "local", mapping, status, reason);
      return;
    }
    store.update((draft) => {
      draft.mappings[mappingId || "local"] = mapping;
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
    const key = `${componentId}:${meta.frameId || ""}`;
    const isBlob = typeof Blob === "function" && thumbnail instanceof Blob;
    const publishedThumbnail = isBlob ? URL.createObjectURL(thumbnail) : thumbnail;
    const result = typeof store.setComponentThumbnail === "function"
      ? store.setComponentThumbnail(componentId, meta.frameId || "", publishedThumbnail)
      : publishThumbnailThroughDerivedState(componentId, meta.frameId || "", publishedThumbnail);
    if (result?.updated === false) {
      if (isBlob) URL.revokeObjectURL(publishedThumbnail);
      return false;
    }
    if (isBlob) {
      const previousObjectUrl = thumbnailObjectUrls.get(key);
      thumbnailObjectUrls.set(key, publishedThumbnail);
      if (previousObjectUrl && previousObjectUrl !== publishedThumbnail) deferThumbnailUrlRevoke(previousObjectUrl);
    }
    projectService.writeComponentThumbnail(componentId, meta.frameId || "", thumbnail).catch((error) => {
      console.warn("[VJ1_THUMBNAIL_WRITE_FAILED]", {
        componentId,
        frameId: meta.frameId || "",
        fallback: "retain the in-memory thumbnail until it can be regenerated",
        message: error?.message || String(error),
      });
    });
    return true;
  }

  function publishThumbnailThroughDerivedState(componentId, frameId, thumbnail) {
    let updated = false;
    store.updateDerived((draft) => {
      const component = draft.components.find((item) => item.id === componentId);
      if (!component) return;
      if (frameId && component.type === "canvas") {
        component.canvas ||= {};
        component.canvas.frameThumbnails ||= {};
        if (component.canvas.frameThumbnails[frameId] !== thumbnail) {
          component.canvas.frameThumbnails[frameId] = thumbnail;
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

  function updateCanvasFrame(componentId, frameId, rect, meta = {}) {
    if (!meta.commit) {
      pendingCanvasCommit = { componentId, frameId, rect };
      if (!canvasCommitFrame) canvasCommitFrame = requestAnimationFrame(flushPendingCanvasCommit);
      return;
    }
    if (canvasCommitFrame) cancelAnimationFrame(canvasCommitFrame);
    canvasCommitFrame = 0;
    pendingCanvasCommit = null;
    commitCanvasFrame(componentId, frameId, rect, true);
  }

  function flushPendingCanvasCommit() {
    canvasCommitFrame = 0;
    const pending = pendingCanvasCommit;
    pendingCanvasCommit = null;
    if (pending) commitCanvasFrame(pending.componentId, pending.frameId, pending.rect, false);
  }

  function commitCanvasFrame(componentId, frameId, rect, commit) {
    store.update((draft) => {
      const frame = draft.recordingFrames?.find((item) => item.id === frameId);
      if (frame) Object.assign(frame, rect);
    }, commit ? "update:canvas-frame" : "scrub:canvas-frame");
  }

  function selectSurface(surfaceId) {
    if (!surfaceId) return;
    if (store.getState().ui.selectedSurfaceId === surfaceId) return;
    store.update((draft) => {
      if (draft.surfaces.some((surface) => surface.id === surfaceId)) {
        draft.ui.selectedSurfaceId = surfaceId;
      }
    }, "select-surface-from-preview");
  }

  function selectChainItem(itemId) {
    if (!itemId) return;
    const state = store.getState();
    onChainItemTarget?.(state.ui.selectedComponentId, itemId);
    if (state.ui.selectedChainItemId === itemId) return;
    store.selectChainItem(itemId);
  }

  return { mount, setState, applyLivePatches, command, pause };
}

export function shouldPrepareEmbeddedLiveState(nextState, currentState) {
  if (nextState?.ui?.workspace !== "live" || !currentState) return false;
  const nextSceneId = previewSceneId(nextState);
  const currentSceneId = previewSceneId(currentState);
  return !!nextSceneId && !!currentSceneId && nextSceneId !== currentSceneId;
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

function deferThumbnailUrlRevoke(url) {
  if (typeof requestAnimationFrame !== "function") {
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => URL.revokeObjectURL(url)));
}

function previewSceneId(state) {
  // A Live preview follows program state, never the Scene currently open in
  // another editor workspace. Non-Live callers use the editor Scene.
  return String(state?.ui?.workspace === "live"
    ? state?.ui?.live?.selectedSceneId || ""
    : state?.ui?.selectedSceneId || "");
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
  const configured = Math.max(0.5, Math.min(2, Number(configuredDensity) || 1));
  if (quality === "full") return configured;
  const automatic = Math.min(configured, Math.max(0.125, Number(displayScale) * Number(deviceScale) || 0.125));
  return quality === "low" ? Math.max(0.125, automatic * 0.5) : automatic;
}

export function previewFitSignature({ mode = "preview", size = {}, logical = {}, viewport = {}, render = {} } = {}) {
  const outputs = (render?.outputs || []).map((output) => `${output.id || ""}:${output.width || 0}x${output.height || 0}`).join("|");
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
