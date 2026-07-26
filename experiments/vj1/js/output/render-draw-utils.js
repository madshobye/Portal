import { drawWebGLBuffer } from "./component-render-layout.js";
import { isSharedFramebufferTarget, unwrapRenderTarget } from "./shared-framebuffer-target.js";
import { renderTargetNeedsPresentationFlip } from "./render-target-contract.js";

export function withShaderInstancePrefix(chain = [], prefix = "") {
  return (chain || []).map((pass, index) => ({
    ...pass,
    instanceId: pass.instanceId || `${prefix || "shader"}:${index}:${pass.componentId || pass.id || "pass"}`,
  }));
}

export function drawBuffer(pg, source, x, y, width, height, sourceIsWebGL = false) {
  const geometry = renderTargetImageGeometry(
    source,
    { x, y, width, height },
  );
  if (isSharedFramebufferTarget(source)) {
    pg.push();
    pg.imageMode(CORNER);
    pg.image(
      unwrapRenderTarget(source),
      geometry.destination.x,
      geometry.destination.y,
      geometry.destination.width,
      geometry.destination.height,
    );
    pg.pop();
    return;
  }
  if (!sourceIsWebGL) {
    pg.image(
      source,
      geometry.destination.x,
      geometry.destination.y,
      geometry.destination.width,
      geometry.destination.height,
    );
    return;
  }
  drawWebGLBuffer(
    pg,
    source,
    geometry.destination.x,
    geometry.destination.y,
    geometry.destination.width,
    geometry.destination.height,
  );
}

export function drawSampleRect(pg, source, sampleRect = {}, x = 0, y = 0, width = pg.width, height = pg.height) {
  const sample = boundedSampleRect(source, sampleRect, width, height);
  const geometry = renderTargetImageGeometry(
    source,
    { x, y, width, height },
    sample,
  );
  try {
    pg.image(
      source,
      geometry.destination.x,
      geometry.destination.y,
      geometry.destination.width,
      geometry.destination.height,
      geometry.sample.x,
      geometry.sample.y,
      geometry.sample.width,
      geometry.sample.height,
    );
  } catch (error) {
    reportSampleDrawFailure(source, pg, error);
    throw error;
  }
}

export function renderTargetImageGeometry(
  source,
  destination = {},
  sampleRect = null,
) {
  const width = Number(destination.width) || 0;
  const height = Number(destination.height) || 0;
  const sourceWidth = Math.max(1, Number(source?.width) || Math.abs(width) || 1);
  const sourceHeight = Math.max(1, Number(source?.height) || Math.abs(height) || 1);
  const sample = sampleRect
    ? {
        x: Number(sampleRect.x) || 0,
        y: Number(sampleRect.y) || 0,
        width: Math.max(0, Number(sampleRect.width) || 0),
        height: Math.max(0, Number(sampleRect.height) || 0),
      }
    : {
        x: 0,
        y: 0,
        width: sourceWidth,
        height: sourceHeight,
      };
  if (!renderTargetNeedsPresentationFlip(source)) {
    return {
      flipped: false,
      destination: {
        x: Number(destination.x) || 0,
        y: Number(destination.y) || 0,
        width,
        height,
      },
      sample,
    };
  }
  return {
    flipped: true,
    destination: {
      x: Number(destination.x) || 0,
      y: (Number(destination.y) || 0) + height,
      width,
      height: -height,
    },
    sample: {
      ...sample,
      y: sourceHeight - sample.y - sample.height,
    },
  };
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

function reportSampleDrawFailure(source, target, error) {
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
  console.error("[VJ1_SAMPLE_DRAW_FAILED]", detail);
}
