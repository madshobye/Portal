import { drawWebGLBuffer } from "./component-render-layout.js?v=canvas-global-resolution-1";
import { isSharedFramebufferTarget, unwrapRenderTarget } from "./shared-framebuffer-target.js?v=render-diagnostics-1";
import { renderTargetNeedsPresentationFlip } from "./render-target-contract.js?v=render-core-contract-1";

export function withShaderInstancePrefix(chain = [], prefix = "") {
  return (chain || []).map((pass, index) => ({
    ...pass,
    instanceId: pass.instanceId || `${prefix || "shader"}:${index}:${pass.componentId || pass.id || "pass"}`,
  }));
}

export function drawBuffer(pg, source, x, y, width, height, sourceIsWebGL = false) {
  const flipRawTarget = renderTargetNeedsPresentationFlip(source);
  const drawY = flipRawTarget ? y + height : y;
  const drawHeight = flipRawTarget ? -height : height;
  if (isSharedFramebufferTarget(source)) {
    pg.push();
    pg.imageMode(CORNER);
    pg.image(unwrapRenderTarget(source), x, drawY, width, drawHeight);
    pg.pop();
    return;
  }
  if (!sourceIsWebGL) {
    pg.image(source, x, drawY, width, drawHeight);
    return;
  }
  drawWebGLBuffer(pg, source, x, drawY, width, drawHeight);
}

export function drawSampleRect(pg, source, sampleRect = {}, x = 0, y = 0, width = pg.width, height = pg.height) {
  const sx = Math.max(0, Number(sampleRect.x) || 0);
  const sy = Math.max(0, Number(sampleRect.y) || 0);
  const sw = Math.max(1, Number(sampleRect.width) || source?.width || width);
  const sh = Math.max(1, Number(sampleRect.height) || source?.height || height);
  try {
    pg.image(source, x, y, width, height, sx, sy, sw, sh);
  } catch (error) {
    const drawable = source?.canvas || source?.elt || source;
    const context = pg?.drawingContext;
    if (typeof context?.drawImage !== "function") {
      reportSampleDrawFailure(source, pg, error, false);
      throw error;
    }
    reportSampleDrawFailure(source, pg, error, true);
    context.drawImage(drawable, sx, sy, sw, sh, x, y, width, height);
  }
}

const reportedSampleDrawFailures = new WeakMap();

function reportSampleDrawFailure(source, target, error, recovered) {
  if (source && (typeof source === "object" || typeof source === "function")) {
    let targets = reportedSampleDrawFailures.get(source);
    if (!targets) {
      targets = new WeakSet();
      reportedSampleDrawFailures.set(source, targets);
    }
    if (target && (typeof target === "object" || typeof target === "function")) {
      if (targets.has(target)) return;
      targets.add(target);
    }
  }
  const detail = {
    source: source?.constructor?.name || typeof source,
    target: target?.constructor?.name || typeof target,
    message: error?.message || String(error || "sample draw failed"),
  };
  if (recovered) console.warn("[VJ1_SAMPLE_DRAW_FALLBACK]", { ...detail, fallback: "CanvasRenderingContext2D.drawImage" });
  else console.error("[VJ1_SAMPLE_DRAW_FAILED]", detail);
}
