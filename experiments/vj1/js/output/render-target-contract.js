export const RENDER_TEXTURE_ORIENTATION = Object.freeze({
  topLeft: "top-left",
  bottomLeft: "bottom-left",
});

export const RENDER_TARGET_KIND = Object.freeze({
  composition: "composition",
  sharedFramebuffer: "shared-framebuffer",
  p5Graphics2d: "p5-graphics-2d",
  p5GraphicsWebgl: "p5-graphics-webgl",
  rawWebgl: "raw-webgl",
  media: "media",
});

const descriptors = new WeakMap();

export function registerRenderTarget(target, descriptor = {}) {
  if (!target || (typeof target !== "object" && typeof target !== "function")) return target;
  const previous = descriptors.get(target) || {};
  const width = positiveDimension(descriptor.width ?? target.width ?? previous.width);
  const height = positiveDimension(descriptor.height ?? target.height ?? previous.height);
  const next = Object.freeze({
    kind: descriptor.kind || previous.kind || inferRenderTargetKind(target),
    orientation: normalizeRenderTextureOrientation(
      descriptor.orientation || previous.orientation || inferredRenderTargetOrientation(target)
    ),
    logicalWidth: positiveDimension(descriptor.logicalWidth ?? previous.logicalWidth ?? width),
    logicalHeight: positiveDimension(descriptor.logicalHeight ?? previous.logicalHeight ?? height),
    width,
    height,
    directP5ImageSafe: descriptor.directP5ImageSafe ?? previous.directP5ImageSafe ?? inferDirectP5ImageSafety(target),
  });
  descriptors.set(target, next);
  return target;
}

export function renderTargetDescriptor(target, fallback = {}) {
  if (!target || (typeof target !== "object" && typeof target !== "function")) {
    return normalizedDescriptor(fallback);
  }
  const stored = descriptors.get(target);
  if (stored) {
    const width = positiveDimension(target.width ?? stored.width);
    const height = positiveDimension(target.height ?? stored.height);
    if (width === stored.width && height === stored.height) return stored;
    return normalizedDescriptor({ ...stored, width, height });
  }
  return normalizedDescriptor({
    kind: inferRenderTargetKind(target),
    orientation: inferredRenderTargetOrientation(target),
    width: target.width,
    height: target.height,
    logicalWidth: target.width,
    logicalHeight: target.height,
    directP5ImageSafe: inferDirectP5ImageSafety(target),
    ...fallback,
  });
}

export function markRenderTargetOrientation(target, orientation = RENDER_TEXTURE_ORIENTATION.topLeft) {
  return registerRenderTarget(target, { orientation });
}

export function renderTargetNeedsPresentationFlip(target, destinationOrientation = RENDER_TEXTURE_ORIENTATION.topLeft) {
  return renderTargetDescriptor(target).orientation !== normalizeRenderTextureOrientation(destinationOrientation);
}

export function isDirectP5ImageSourceSafe(target) {
  return renderTargetDescriptor(target).directP5ImageSafe === true;
}

/**
 * Own a target for one immediate-mode 2D draw.
 *
 * Rendering dependencies and intermediate targets must happen before entering
 * this scope. This keeps the active framebuffer and viewport aligned with the
 * target receiving the actual draw, regardless of whether the target is a
 * shared framebuffer or a p5.Graphics instance.
 */
export function withRenderTarget2D(target, draw) {
  if (!target || typeof draw !== "function") return undefined;
  target.push();
  try {
    return draw();
  } finally {
    target.pop();
  }
}

export function normalizeRenderTextureOrientation(value) {
  return value === RENDER_TEXTURE_ORIENTATION.bottomLeft
    ? RENDER_TEXTURE_ORIENTATION.bottomLeft
    : RENDER_TEXTURE_ORIENTATION.topLeft;
}

function normalizedDescriptor(value = {}) {
  const width = positiveDimension(value.width);
  const height = positiveDimension(value.height);
  return Object.freeze({
    kind: value.kind || RENDER_TARGET_KIND.composition,
    orientation: normalizeRenderTextureOrientation(value.orientation),
    logicalWidth: positiveDimension(value.logicalWidth ?? width),
    logicalHeight: positiveDimension(value.logicalHeight ?? height),
    width,
    height,
    directP5ImageSafe: value.directP5ImageSafe === true,
  });
}

function inferRenderTargetKind(target) {
  if (target?.__vj1SharedFramebuffer) return RENDER_TARGET_KIND.sharedFramebuffer;
  const webgl1 = globalThis.WebGLRenderingContext;
  const webgl2 = globalThis.WebGL2RenderingContext;
  if (target?._renderer?.isP3D ||
      (typeof webgl1 === "function" && target?.drawingContext instanceof webgl1) ||
      (typeof webgl2 === "function" && target?.drawingContext instanceof webgl2)) {
    return RENDER_TARGET_KIND.p5GraphicsWebgl;
  }
  if (target?.canvas || target?.elt || target?.pixels) return RENDER_TARGET_KIND.media;
  return RENDER_TARGET_KIND.p5Graphics2d;
}

function inferredRenderTargetOrientation(target) {
  if (target?.__vj1RenderTargetOrientation === RENDER_TEXTURE_ORIENTATION.bottomLeft) {
    return RENDER_TEXTURE_ORIENTATION.bottomLeft;
  }
  return RENDER_TEXTURE_ORIENTATION.topLeft;
}

function inferDirectP5ImageSafety(target) {
  if (!target || target?.__vj1SharedFramebuffer) return false;
  if (target?.framebuffer || target?.__vj1ShaderBuffer) return false;
  return !!(target?.canvas || target?.elt || target?.pixels || target?.videoWidth || target?.naturalWidth);
}

function positiveDimension(value) {
  return Math.max(1, Math.round(Number(value) || 1));
}
