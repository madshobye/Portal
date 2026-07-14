import { VJ1 } from "../constants.js";
import { sanitizeState } from "../domain/models.js?v=output-playback-1";
import { OutputRenderer } from "./output-renderer.js?v=render-quality-2";
import { applyFontToGlobal, loadVjRenderFont } from "./font-loader.js?v=world-frame-27";
import { createPreviewViewportController, fitPreviewCanvasElement } from "./preview-viewport.js";
import { canvasSizeForMode } from "./render-geometry.js";

export function createEmbeddedPreviewApp({ store, mediaLibrary, projectService }) {
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
  let canvasWidth = 0;
  let canvasHeight = 0;
  let pointerActive = false;
  let viewportController = null;
  let paused = false;
  let renderFont = null;
  let appliedFrameRate = 0;
  let mediaFilesSignature = "";

  function mount({ host: nextHost, stage: nextStage, hud: nextHud, mode, state }) {
    host = nextHost;
    stage = nextStage;
    hud = nextHud;
    pendingMode = mode;
    pendingState = sanitizeState(state || pendingState || {});
    host?.classList.remove("is-paused");
    paused = false;
    if (typeof loop === "function") loop();
    applyPreviewFrameRate();
    bindStageViewportEvents();
    if (canvas && stage) canvas.parent(stage);
    if (renderer) {
      renderer.mode = pendingMode;
      renderer.hud = hud;
      resizeToStage(true);
      renderer.setState(previewSizedState());
      importMediaFilesIfChanged();
      renderer.setCalibrate(pendingMode === "preview" && pendingState.global.calibrating);
    }
    if (!started) start();
  }

  function setState(state, mode = pendingMode) {
    pendingMode = mode;
    pendingState = sanitizeState(state || {});
    applyPreviewFrameRate();
    if (!renderer) return;
    renderer.mode = pendingMode;
    resizeToStage(true);
    renderer.setState(previewSizedState());
    importMediaFilesIfChanged();
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
    if (typeof noLoop === "function") noLoop();
  }

  function cleanup() {
    renderer?.dispose?.();
    renderer = null;
    resizeObserver?.disconnect?.();
    resizeObserver = null;
    viewportController?.destroy?.();
    viewportController = null;
  }

  function start() {
    started = true;
    window.setup = setup;
    window.draw = draw;
    window.mouseDragged = mouseDragged;
    window.mouseReleased = mouseReleased;
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
    applyLoadedFont();
    fitCanvasToStage(size);
    canvas.mousePressed(() => {
      pointerActive = true;
      renderer?.mousePressed?.(mouseX, mouseY);
      return false;
    });
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
      sendMediaRendition: (mediaId, width, height, blob) => projectService?.writeMediaRendition?.(mediaId, width, height, blob),
      requestMediaFiles: () => importMediaFilesIfChanged(true),
      onSurfaceSelect: selectSurface,
    });
    await renderer.setup(previewSizedState(size));
    importMediaFilesIfChanged(true);
    resizeObserver = new ResizeObserver(resizeToStage);
    if (stage) resizeObserver.observe(stage);
  }

  function applyLoadedFont() {
    applyFontToGlobal(renderFont);
  }

  function draw() {
    if (paused) return;
    applyPreviewFrameRate();
    renderer?.draw();
  }

  function mouseDragged() {
    if (!pointerActive) return;
    renderer?.mouseDragged?.(mouseX, mouseY);
    return false;
  }

  function mouseReleased() {
    if (!pointerActive) return;
    pointerActive = false;
    renderer?.mouseReleased?.();
    return false;
  }

  function resizeToStage(force = false) {
    if (!canvas || !stage) return;
    const size = stageSize();
    const logical = canvasLogicalSize();
    if (!force && logical.width === canvasWidth && logical.height === canvasHeight) {
      fitCanvasToStage(size);
      return;
    }
    canvasWidth = logical.width;
    canvasHeight = logical.height;
    resizeCanvas(logical.width, logical.height);
    fitCanvasToStage(size, logical);
    renderer?.setState(previewSizedState(size));
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
      viewport: pendingState?.ui?.previewViewport || {},
      render: pendingState?.render || {},
    });
  }

  function previewSizedState(size = stageSize()) {
    const state = sanitizeState(pendingState || {});
    return state;
  }

  function applyPreviewFrameRate() {
    if (typeof frameRate !== "function") return;
    const target = pendingState?.ui?.debugPreview === false
      ? 60
      : pendingState?.ui?.outputWindowOpen
        ? 30
        : 60;
    if (appliedFrameRate === target) return;
    frameRate(target);
    appliedFrameRate = target;
  }

  function importMediaFilesIfChanged(force = false) {
    if (!renderer) return;
    const files = mediaLibrary.getAllFiles();
    const signature = mediaFilesSignatureFor(files);
    if (!force && signature === mediaFilesSignature) return;
    mediaFilesSignature = signature;
    renderer.importFiles(files);
  }

  function mediaFilesSignatureFor(files = []) {
    return (files || [])
      .map((file) => `${file.name || ""}:${file.size || 0}:${file.lastModified || 0}`)
      .join("|");
  }

  function bindStageViewportEvents() {
    if (!stage || viewportController?.stage === stage) return;
    viewportController?.destroy?.();
    viewportController = createPreviewViewportController({
      stage,
      store,
      getMode: () => pendingMode,
      getViewport: () => pendingState?.ui?.previewViewport || {},
      onPanStart: () => {
        pointerActive = false;
      },
    });
    viewportController.stage = stage;
  }

  function updateMetrics(metrics = {}) {
    store.update((draft) => {
      draft.metrics.previewFps = metrics.fps || 0;
      draft.metrics.previewFrameMs = metrics.frameMs || 0;
      draft.metrics.previewGpuMs = metrics.gpuMs || 0;
      draft.metrics.previewGpuSupported = metrics.gpuSupported === true;
      draft.metrics.previewRenderCost = metrics.renderCost || 0;
      draft.metrics.previewProfile = metrics.profile || null;
    }, "preview-metrics");
  }

  function updateMapping(mappingId, mapping, status) {
    store.update((draft) => {
      draft.mappings[mappingId || "local"] = mapping;
      draft.ui.mappingStatus = status || "Mapping updated";
    }, "mapping-state");
  }

  function updateThumbnail(compositionId, thumbnail) {
    if (!compositionId || !thumbnail) return;
    store.update((draft) => {
      const composition = draft.compositions.find((item) => item.id === compositionId);
      if (composition && composition.thumbnail !== thumbnail) {
        composition.thumbnail = thumbnail;
      }
    }, "composition-thumbnail");
  }

  function updateChainTransform(compositionId, itemId, transform) {
    store.update((draft) => {
      const composition = draft.compositions.find((item) => item.id === compositionId);
      const item = findChainItemById(composition?.chain, itemId);
      if (item) item.transform = { ...item.transform, ...transform };
    }, "scrub:chain-transform");
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

  return { mount, setState, command, pause };
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
