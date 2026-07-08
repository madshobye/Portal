import { VJ1 } from "../constants.js";
import { sanitizeState } from "../domain/models.js";
import { createOutputBridge } from "../services/output-bridge-service.js";
import { OutputRenderer } from "./output-renderer.js?v=reset-surface-1";

export function installOutputApp({ root, mode }) {
  document.body.classList.add("output-client");
  root.innerHTML = `
    <div id="output-stage" class="output-stage"></div>
    <div id="output-hud" class="output-hud">starting ${mode}</div>
  `;

  let renderer = null;
  let pendingState = null;
  let bridge = null;

  window.setup = async function setup() {
    const canvas = createCanvas(windowWidth, windowHeight, WEBGL);
    canvas.parent("output-stage");
    pixelDensity(1);
    await loadClassicScript(VJ1.mapperScript);
    renderer = new OutputRenderer({
      mode,
      hud: document.getElementById("output-hud"),
      sendMetrics: (metrics) => bridge?.metrics(metrics),
      sendMapping: (id, mapping, status) => bridge?.mappingState(id, mapping, status),
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
    resizeCanvas(windowWidth, windowHeight);
    renderer?.resize();
  };

  bridge = createOutputBridge({
    mode,
    onState(state) {
      pendingState = state;
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
    },
  });

  loadClassicScript(VJ1.p5Script).catch((error) => {
    root.innerHTML = `<div class="empty-preview">${error.message}</div>`;
  });
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
