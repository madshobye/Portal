export const FULL_NODE_BOUNDARY = Object.freeze({ x: 0, y: 0, width: 1, height: 1, rotation: 0 });

export function normalizeNodeBoundary(boundary = {}) {
  return {
    x: finiteClamp(boundary?.x, -2, 2, 0),
    y: finiteClamp(boundary?.y, -2, 2, 0),
    width: finiteClamp(boundary?.width, 0.005, 4, 1),
    height: finiteClamp(boundary?.height, 0.005, 4, 1),
    rotation: finiteNumber(boundary?.rotation, 0),
  };
}

export function isFullNodeBoundary(boundary = {}) {
  const value = normalizeNodeBoundary(boundary);
  return Math.abs(value.x) < 0.000001 && Math.abs(value.y) < 0.000001 &&
    Math.abs(value.width - 1) < 0.000001 && Math.abs(value.height - 1) < 0.000001 &&
    Math.abs(value.rotation) < 0.000001;
}

export function nodeBoundaryPixelRect(boundary = {}, target = {}, halo = 0) {
  const value = normalizeNodeBoundary(boundary);
  const targetWidth = Math.max(1, Math.round(Number(target.width) || 1));
  const targetHeight = Math.max(1, Math.round(Number(target.height) || 1));
  const targetUv = normalizeUvRect(target.uvRect);
  // A nested/partly visible target may represent only a view into its full
  // logical boundary. Recover that full raster domain before positioning the
  // next boundary; otherwise every crop silently becomes a new 0..1 canvas
  // and procedural content is squeezed as it moves off-screen.
  const domainWidth = targetWidth / targetUv[2];
  const domainHeight = targetHeight / targetUv[3];
  const viewportLeft = targetUv[0] * domainWidth;
  const viewportTop = targetUv[1] * domainHeight;
  const width = value.width * domainWidth;
  const height = value.height * domainHeight;
  const centerX = domainWidth * (0.5 + value.x * 0.5);
  const centerY = domainHeight * (0.5 + value.y * 0.5);
  const padding = Math.max(0, Number(halo) || 0);
  // Transform the visible parent viewport into boundary-local coordinates.
  // Its local AABB is a conservative crop for a rotated rectangle: it may
  // overdraw corner pixels, but never allocates a parent-sized framebuffer.
  const cosine = Math.cos(-value.rotation);
  const sine = Math.sin(-value.rotation);
  const localViewport = [
    [viewportLeft, viewportTop],
    [viewportLeft + targetWidth, viewportTop],
    [viewportLeft + targetWidth, viewportTop + targetHeight],
    [viewportLeft, viewportTop + targetHeight],
  ].map(([x, y]) => {
    const dx = x - centerX;
    const dy = y - centerY;
    return {
      x: dx * cosine - dy * sine + width * 0.5,
      y: dx * sine + dy * cosine + height * 0.5,
    };
  });
  const sampleLeft = Math.max(0, Math.floor(Math.min(...localViewport.map((point) => point.x)) - padding));
  const sampleTop = Math.max(0, Math.floor(Math.min(...localViewport.map((point) => point.y)) - padding));
  const sampleRight = Math.min(width, Math.ceil(Math.max(...localViewport.map((point) => point.x)) + padding));
  const sampleBottom = Math.min(height, Math.ceil(Math.max(...localViewport.map((point) => point.y)) + padding));
  const visibleWidth = Math.max(0, sampleRight - sampleLeft);
  const visibleHeight = Math.max(0, sampleBottom - sampleTop);
  return {
    x: centerX - viewportLeft - width * 0.5 + sampleLeft,
    y: centerY - viewportTop - height * 0.5 + sampleTop,
    width: visibleWidth,
    height: visibleHeight,
    empty: visibleWidth <= 0 || visibleHeight <= 0,
    fullWidth: targetWidth,
    fullHeight: targetHeight,
    boundaryX: centerX - width * 0.5,
    boundaryY: centerY - height * 0.5,
    boundaryWidth: width,
    boundaryHeight: height,
    centerX: centerX - viewportLeft,
    centerY: centerY - viewportTop,
    sampleX: sampleLeft,
    sampleY: sampleTop,
    rotation: value.rotation,
    uvRect: [
      clamp01(sampleLeft / Math.max(1e-9, width)),
      clamp01(sampleTop / Math.max(1e-9, height)),
      clamp01(visibleWidth / Math.max(1e-9, width)),
      clamp01(visibleHeight / Math.max(1e-9, height)),
    ],
    halo: padding,
  };
}

export function nodeRoiRequest(renderRequest = {}, boundary = {}, additions = {}) {
  const roi = nodeBoundaryPixelRect(boundary, renderRequest, additions.halo);
  const coordinateSpace = additions.coordinateSpace === "full-frame" ? "full-frame" : "boundary";
  const logicalWidth = Math.max(1, Number(renderRequest.logicalWidth) || Number(renderRequest.width) || 1);
  const logicalHeight = Math.max(1, Number(renderRequest.logicalHeight) || Number(renderRequest.height) || 1);
  return {
    ...renderRequest,
    ...additions,
    // Keep allocation limited to visible pixels, but retain the full logical
    // boundary as the node's resolution/coordinate domain.
    width: Math.max(1, roi.width),
    height: Math.max(1, roi.height),
    logicalWidth: logicalWidth * normalizeNodeBoundary(boundary).width,
    logicalHeight: logicalHeight * normalizeNodeBoundary(boundary).height,
    uvRect: coordinateSpace === "full-frame"
      ? renderRequest.uvRect
      : roi.uvRect,
    coordinateSpace,
    role: `${renderRequest.role || "texture"}:roi`,
    empty: roi.empty,
    roi,
  };
}

export function sameNodeBoundary(left = {}, right = {}) {
  const a = normalizeNodeBoundary(left);
  const b = normalizeNodeBoundary(right);
  return Math.abs(a.x - b.x) < 0.000001 && Math.abs(a.y - b.y) < 0.000001 &&
    Math.abs(a.width - b.width) < 0.000001 && Math.abs(a.height - b.height) < 0.000001 &&
    Math.abs(a.rotation - b.rotation) < 0.000001;
}

export function nodeBoundaryUniformScale(boundary = {}) {
  const value = normalizeNodeBoundary(boundary);
  return Math.sqrt(value.width * value.height);
}

export function nodeBoundaryWithUniformScale(boundary = {}, scale = 1) {
  const value = normalizeNodeBoundary(boundary);
  const currentScale = nodeBoundaryUniformScale(value);
  const requestedFactor = Math.max(0.000001, Number(scale) || 1) / currentScale;
  // Clamp one shared factor so even unusual legacy rectangles keep their
  // authored aspect ratio at the ROI size limits.
  const minimumFactor = Math.max(0.005 / value.width, 0.005 / value.height);
  const maximumFactor = Math.min(4 / value.width, 4 / value.height);
  const factor = Math.max(minimumFactor, Math.min(maximumFactor, requestedFactor));
  return {
    ...value,
    width: value.width * factor,
    height: value.height * factor,
  };
}

function finiteClamp(value, min, max, fallback) {
  const number = Number(value);
  return Math.min(max, Math.max(min, Number.isFinite(number) ? number : fallback));
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeUvRect(value) {
  if (!Array.isArray(value) || value.length < 4) return [0, 0, 1, 1];
  const width = Math.max(1e-9, Math.min(1, Number(value[2]) || 1));
  const height = Math.max(1e-9, Math.min(1, Number(value[3]) || 1));
  return [
    Math.max(0, Math.min(1 - width, Number(value[0]) || 0)),
    Math.max(0, Math.min(1 - height, Number(value[1]) || 0)),
    width,
    height,
  ];
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}
