export const DEFAULT_ASPECT_RATIO = 16 / 9;
export const COMPOSITION_SHORT_EDGE = 1000;

export function normalizeAspectRatio(value, fallback = DEFAULT_ASPECT_RATIO) {
  const number = Number(value);
  const safeFallback = Number.isFinite(Number(fallback)) && Number(fallback) > 0
    ? Number(fallback)
    : DEFAULT_ASPECT_RATIO;
  return Number.isFinite(number) && number > 0
    ? Math.max(0.05, Math.min(20, number))
    : safeFallback;
}

// A projected quadrilateral has no single exact aspect once it becomes a
// trapezoid. Averaging opposing edges gives Frames one stable, natural
// proportion without letting the longest perspective edge dominate.
export function projectedQuadAspect(corners = [], fallback = 1) {
  const safeFallback = Math.max(0.0001, Number(fallback) || 1);
  if (!Array.isArray(corners) || corners.length !== 4) return safeFallback;
  const valid = (point) => point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y));
  if (!corners.every(valid)) return safeFallback;
  const distance = (a, b) => Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y));
  const [tl, tr, br, bl] = corners;
  const width = (distance(tl, tr) + distance(bl, br)) * 0.5;
  const height = (distance(tl, bl) + distance(tr, br)) * 0.5;
  return width > 0 && height > 0 ? Math.max(0.0001, width / height) : safeFallback;
}

// Relative X and Y coordinates only share a unit on a square parent. Convert
// them into an aspect-correct space before measuring edge lengths so a Surface
// keeps the same physical proportion in Mapping and Scene views.
export function projectedRelativeQuadAspect(corners = [], parentAspect = 1, fallback = 1) {
  const aspect = normalizeAspectRatio(parentAspect, 1);
  if (!Array.isArray(corners)) return Math.max(0.0001, Number(fallback) || 1);
  return projectedQuadAspect(corners.map((point) => ({
    x: Number(point?.x) * aspect,
    y: Number(point?.y),
  })), fallback);
}

// Authored geometry is resolution-independent. This aspect-aware composition
// space is only an internal mathematical basis: it is never a requested GPU
// resolution and is never exposed as project width/height settings.
export function compositionLogicalSize(aspectRatio = DEFAULT_ASPECT_RATIO, shortEdge = COMPOSITION_SHORT_EDGE) {
  const aspect = normalizeAspectRatio(aspectRatio);
  const edge = Math.max(1, Number(shortEdge) || COMPOSITION_SHORT_EDGE);
  return aspect >= 1
    ? { width: edge * aspect, height: edge }
    : { width: edge, height: edge / aspect };
}

export function normalizeRelativeRect(rect = {}, fallback = {}) {
  const fallbackWidth = positiveRelative(fallback.width, 0.25);
  const fallbackHeight = positiveRelative(fallback.height, 0.25);
  const width = Math.min(1, positiveRelative(rect.width, fallbackWidth));
  const height = Math.min(1, positiveRelative(rect.height, fallbackHeight));
  return {
    x: clampRelative(rect.x, clampRelative(fallback.x, (1 - width) * 0.5), 0, Math.max(0, 1 - width)),
    y: clampRelative(rect.y, clampRelative(fallback.y, (1 - height) * 0.5), 0, Math.max(0, 1 - height)),
    width,
    height,
  };
}

export function relativeRectToLogical(rect = {}, logicalSize = {}) {
  const normalized = normalizeRelativeRect(rect);
  const width = Math.max(1, Number(logicalSize.width) || 1);
  const height = Math.max(1, Number(logicalSize.height) || 1);
  return {
    x: normalized.x * width,
    y: normalized.y * height,
    width: normalized.width * width,
    height: normalized.height * height,
  };
}

export function logicalRectToRelative(rect = {}, logicalSize = {}) {
  const width = Math.max(1, Number(logicalSize.width) || 1);
  const height = Math.max(1, Number(logicalSize.height) || 1);
  return normalizeRelativeRect({
    x: (Number(rect.x) || 0) / width,
    y: (Number(rect.y) || 0) / height,
    width: Math.max(1, Number(rect.width) || 1) / width,
    height: Math.max(1, Number(rect.height) || 1) / height,
  });
}

export function normalizeRelativePoint(point = {}) {
  return {
    x: clampRelative(point.x, 0),
    y: clampRelative(point.y, 0),
  };
}

export function relativePointToSize(point = {}, size = {}) {
  const normalized = normalizeRelativePoint(point);
  return {
    x: normalized.x * Math.max(1, Number(size.width) || 1),
    y: normalized.y * Math.max(1, Number(size.height) || 1),
  };
}

export function pointToRelativeSize(point = {}, size = {}) {
  return normalizeRelativePoint({
    x: (Number(point.x) || 0) / Math.max(1, Number(size.width) || 1),
    y: (Number(point.y) || 0) / Math.max(1, Number(size.height) || 1),
  });
}

function positiveRelative(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function clampRelative(value, fallback, min = 0, max = 1) {
  const number = Number(value);
  return Math.min(max, Math.max(min, Number.isFinite(number) ? number : fallback));
}
