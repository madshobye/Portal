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
  const { x: sx, y: sy, width: sw, height: sh } = boundedSampleRect(source, sampleRect, width, height);
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

export function boundedSampleRect(source, sampleRect = {}, fallbackWidth = 1, fallbackHeight = 1) {
  const unwrapped = unwrapRenderTarget(source) || source;
  const drawable = unwrapped?.canvas || unwrapped?.elt || unwrapped;
  const sourceWidth = Math.max(1, Number(source?.width ?? drawable?.width ?? drawable?.videoWidth ?? drawable?.naturalWidth) || Number(fallbackWidth) || 1);
  const sourceHeight = Math.max(1, Number(source?.height ?? drawable?.height ?? drawable?.videoHeight ?? drawable?.naturalHeight) || Number(fallbackHeight) || 1);
  const requested = {
    x: Number(sampleRect?.x) || 0,
    y: Number(sampleRect?.y) || 0,
    width: Math.max(1, Number(sampleRect?.width) || sourceWidth),
    height: Math.max(1, Number(sampleRect?.height) || sourceHeight),
  };
  const x = Math.min(sourceWidth - 1, Math.max(0, requested.x));
  const y = Math.min(sourceHeight - 1, Math.max(0, requested.y));
  const bounded = {
    x,
    y,
    width: Math.max(1, Math.min(requested.width, sourceWidth - x)),
    height: Math.max(1, Math.min(requested.height, sourceHeight - y)),
  };
  if (rectChanged(requested, bounded)) reportSampleRectClamp(source, requested, bounded, { width: sourceWidth, height: sourceHeight });
  return bounded;
}

const reportedSampleDrawFailures = new WeakMap();
const reportedSampleRectClamps = new WeakSet();

function rectChanged(a, b) {
  return Math.abs(a.x - b.x) > 0.001 || Math.abs(a.y - b.y) > 0.001 ||
    Math.abs(a.width - b.width) > 0.001 || Math.abs(a.height - b.height) > 0.001;
}

function reportSampleRectClamp(source, requested, bounded, sourceSize) {
  if (source && (typeof source === "object" || typeof source === "function")) {
    if (reportedSampleRectClamps.has(source)) return;
    reportedSampleRectClamps.add(source);
  }
  console.warn("[VJ1_SAMPLE_RECT_OUT_OF_BOUNDS]", {
    requested,
    bounded,
    sourceSize,
    message: "the sample rectangle was clipped before texture upload to prevent an invalid GPU copy",
  });
}

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
