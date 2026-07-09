import { VJ1 } from "../constants.js";
import { sanitizeState } from "../domain/models.js";
import { OutputRenderer } from "./output-renderer.js?v=scene-snapshots-93";

export function createEmbeddedPreviewApp({ store, mediaLibrary }) {
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
  let paused = false;

  function mount({ host: nextHost, stage: nextStage, hud: nextHud, mode, state }) {
    host = nextHost;
    stage = nextStage;
    hud = nextHud;
    pendingMode = mode;
    pendingState = sanitizeState(state || pendingState || {});
    host?.classList.remove("is-paused");
    paused = false;
    if (typeof loop === "function") loop();
    if (canvas && stage) canvas.parent(stage);
    if (renderer) {
      renderer.mode = pendingMode;
      renderer.hud = hud;
      resizeToStage();
      renderer.setState(previewSizedState());
      renderer.importFiles(mediaLibrary.getAllFiles());
      renderer.setCalibrate(pendingMode === "preview" && pendingState.global.calibrating);
    }
    if (!started) start();
  }

  function setState(state, mode = pendingMode) {
    pendingMode = mode;
    pendingState = sanitizeState(state || {});
    if (!renderer) return;
    renderer.mode = pendingMode;
    resizeToStage();
    renderer.setState(previewSizedState());
    renderer.importFiles(mediaLibrary.getAllFiles());
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

  function start() {
    started = true;
    window.setup = setup;
    window.draw = draw;
    window.mouseDragged = mouseDragged;
    window.mouseReleased = mouseReleased;
    window.windowResized = resizeToStage;
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
    fitCanvasToStage(size);
    canvas.mousePressed(() => {
      if (pendingMode !== "composition") {
        pointerActive = true;
        renderer?.mousePressed?.(mouseX, mouseY);
      }
      return false;
    });
    pixelDensity(1);
    frameRate(120);
    if (window.p5) window.p5.disableFriendlyErrors = true;
    window.PORTAL_CANVAS_RESIZE_MODE = "none";
    await loadClassicScript(VJ1.portalScript);
    await loadClassicScript(VJ1.mapperScript);
    renderer = new OutputRenderer({
      mode: pendingMode,
      hud,
      sendMetrics: updateMetrics,
      sendMapping: updateMapping,
      sendThumbnail: updateThumbnail,
      requestMediaFiles: () => renderer?.importFiles(mediaLibrary.getAllFiles()),
      onSurfaceSelect: selectSurface,
    });
    await renderer.setup(previewSizedState(size));
    renderer.importFiles(mediaLibrary.getAllFiles());
    resizeObserver = new ResizeObserver(resizeToStage);
    if (stage) resizeObserver.observe(stage);
  }

  function draw() {
    if (paused) return;
    renderer?.draw();
  }

  function mouseDragged() {
    if (!pointerActive || pendingMode === "composition") return;
    renderer?.mouseDragged?.(mouseX, mouseY);
    return false;
  }

  function mouseReleased() {
    if (!pointerActive || pendingMode === "composition") return;
    pointerActive = false;
    renderer?.mouseReleased?.();
    return false;
  }

  function resizeToStage() {
    if (!canvas || !stage) return;
    const size = stageSize();
    if (size.width === canvasWidth && size.height === canvasHeight) return;
    canvasWidth = size.width;
    canvasHeight = size.height;
    resizeCanvas(size.width, size.height);
    fitCanvasToStage(size);
    renderer?.setState(previewSizedState(size));
  }

  function stageSize() {
    const rect = stage?.getBoundingClientRect?.();
    return {
      width: Math.max(320, Math.floor(rect?.width || window.innerWidth || 960)),
      height: Math.max(180, Math.floor(rect?.height || window.innerHeight || 540)),
    };
  }

  function fitCanvasToStage(size = stageSize()) {
    const elt = canvas?.elt;
    if (!elt) return;
    elt.style.width = `${size.width}px`;
    elt.style.height = `${size.height}px`;
    elt.width = size.width;
    elt.height = size.height;
  }

  function previewSizedState(size = stageSize()) {
    const state = sanitizeState(pendingState || {});
    const renderScale = state.ui?.outputWindowOpen ? 0.5 : 1;
    state.render = {
      ...state.render,
      width: Math.max(1, Math.floor(size.width * renderScale)),
      height: Math.max(1, Math.floor(size.height * renderScale)),
      surfaceWidth: Math.max(1, Math.floor((state.render.surfaceWidth || size.width) * renderScale)),
      surfaceHeight: Math.max(1, Math.floor((state.render.surfaceHeight || size.height) * renderScale)),
    };
    return state;
  }

  function updateMetrics(metrics = {}) {
    store.update((draft) => {
      draft.metrics.previewFps = metrics.fps || 0;
      draft.metrics.previewFrameMs = metrics.frameMs || 0;
      draft.metrics.previewRenderCost = metrics.renderCost || 0;
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
