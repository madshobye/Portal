import { VJ1 } from "../constants.js";
import { sanitizeState } from "../domain/models.js";
import { OutputRenderer } from "./output-renderer.js?v=scene-snapshots-25";

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

  function mount({ host: nextHost, stage: nextStage, hud: nextHud, mode, state }) {
    host = nextHost;
    stage = nextStage;
    hud = nextHud;
    pendingMode = mode;
    pendingState = sanitizeState(state || pendingState || {});
    host?.classList.remove("is-paused");
    if (canvas && stage) canvas.parent(stage);
    if (renderer) {
      renderer.mode = pendingMode;
      renderer.hud = hud;
      renderer.setState(pendingState);
      renderer.importFiles(mediaLibrary.getAllFiles());
      renderer.setCalibrate(pendingMode === "preview" && pendingState.global.calibrating);
      resizeToStage();
    }
    if (!started) start();
  }

  function setState(state, mode = pendingMode) {
    pendingMode = mode;
    pendingState = sanitizeState(state || {});
    if (!renderer) return;
    renderer.mode = pendingMode;
    renderer.setState(pendingState);
    renderer.importFiles(mediaLibrary.getAllFiles());
  }

  function command(name, payload = {}) {
    if (name === "set-calibrate") renderer?.setCalibrate(!!payload.calibrating);
    if (name === "reset-mapping") renderer?.resetMapping(payload.surfaceId);
    if (name === "export-mapping") renderer?.exportMapping();
  }

  function pause() {
    host?.classList.add("is-paused");
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
    canvas.mousePressed(() => {
      if (pendingMode !== "composition") {
        pointerActive = true;
        renderer?.mousePressed?.(mouseX, mouseY);
      }
      return false;
    });
    pixelDensity(1);
    frameRate(120);
    await loadClassicScript(VJ1.portalScript);
    await loadClassicScript(VJ1.mapperScript);
    renderer = new OutputRenderer({
      mode: pendingMode,
      hud,
      sendMetrics: updateMetrics,
      sendMapping: updateMapping,
      requestMediaFiles: () => renderer?.importFiles(mediaLibrary.getAllFiles()),
      onSurfaceSelect: selectSurface,
    });
    await renderer.setup(pendingState);
    renderer.importFiles(mediaLibrary.getAllFiles());
    resizeObserver = new ResizeObserver(resizeToStage);
    if (stage) resizeObserver.observe(stage);
  }

  function draw() {
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
    renderer?.resize();
  }

  function stageSize() {
    const rect = stage?.getBoundingClientRect?.();
    return {
      width: Math.max(320, Math.floor(rect?.width || window.innerWidth || 960)),
      height: Math.max(180, Math.floor(rect?.height || window.innerHeight || 540)),
    };
  }

  function updateMetrics() {}

  function updateMapping(mappingId, mapping, status) {
    store.update((draft) => {
      draft.mappings[mappingId || "local"] = mapping;
      draft.ui.mappingStatus = status || "Mapping updated";
    }, "mapping-state");
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
