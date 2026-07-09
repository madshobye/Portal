import { VJ1 } from "../constants.js";
import { sanitizeState } from "../domain/models.js";
import { createOutputBridge } from "../services/output-bridge-service.js";
import { OutputRenderer } from "./output-renderer.js?v=scene-snapshots-99";

export function installOutputApp({ root, mode }) {
  document.body.classList.add("output-client");
  root.innerHTML = `
    <div id="output-stage" class="output-stage">
      <div class="output-fps" data-output-fps>0 fps</div>
    </div>
  `;

  let renderer = null;
  let pendingState = null;
  let bridge = null;

  window.setup = async function setup() {
    const size = outputSize();
    const canvas = createCanvas(size.width, size.height, WEBGL);
    canvas.parent("output-stage");
    fitOutputCanvas();
    pixelDensity(1);
    frameRate(120);
    if (window.p5) window.p5.disableFriendlyErrors = true;
    window.PORTAL_CANVAS_RESIZE_MODE = "none";
    await loadClassicScript(VJ1.portalScript);
    await loadClassicScript(VJ1.mapperScript);
    renderer = new OutputRenderer({
      mode,
      hud: root.querySelector("[data-output-fps]"),
      sendMetrics: (metrics) => bridge?.metrics(metrics),
      sendMapping: (id, mapping, status) => bridge?.mappingState(id, mapping, status),
      requestMediaFiles: (ids) => bridge?.requestMediaFiles(ids),
    });
    await renderer.setup(pendingState ? sanitizeState(pendingState) : null);
  };

  window.draw = function draw() {
    renderer?.draw();
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
    fitOutputCanvas();
  };

  bridge = createOutputBridge({
    mode,
    onState(state) {
      pendingState = state;
      if (renderer) resizeOutputIfNeeded(state);
      renderer?.setState(state);
    },
    onMediaFiles(files) {
      renderer?.importFiles(files);
    },
    onCommand(command, payload) {
      if (command === "set-calibrate") renderer?.setCalibrate(!!payload.calibrating);
      if (command === "save-mapping") renderer?.saveMapping();
      if (command === "reset-mapping") renderer?.resetMapping(payload.surfaceId);
      if (command === "export-mapping") renderer?.exportMapping();
      if (command === "schedule") renderer?.schedule(payload);
    },
  });

  loadClassicScript(VJ1.p5Script).catch((error) => {
    root.innerHTML = `<div class="empty-preview">${error.message}</div>`;
  });
}

function outputSize(state = null) {
  return {
    width: Math.max(320, Math.floor(state?.render?.width || VJ1.renderWidth)),
    height: Math.max(180, Math.floor(state?.render?.height || VJ1.renderHeight)),
  };
}

function resizeOutputIfNeeded(state) {
  const size = outputSize(state);
  if (width === size.width && height === size.height) return;
  resizeCanvas(size.width, size.height);
}

function fitOutputCanvas() {
  const canvas = document.querySelector("#output-stage canvas");
  if (!canvas) return;
  canvas.style.width = "100vw";
  canvas.style.height = "100vh";
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
