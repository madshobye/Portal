export const FULL_RENDER_UV_RECT = Object.freeze([0, 0, 1, 1]);

// A render target can be only the visible allocation for a much larger node
// boundary. Render algorithms must keep using the complete boundary as their
// coordinate space; the ROI is merely the window through which it is viewed.
// Keeping this conversion in one low-level render library prevents fit,
// procedural math, and model projection from each inventing crop semantics.
export function renderView(target = {}, request = {}) {
  const allocationWidth = Math.max(1, Number(target?.width) || Number(request?.width) || 1);
  const allocationHeight = Math.max(1, Number(target?.height) || Number(request?.height) || 1);
  const uvRect = normalizeRenderUvRect(request?.uvRect);
  const width = allocationWidth / uvRect[2];
  const height = allocationHeight / uvRect[3];
  return {
    x: uvRect[0] * width,
    y: uvRect[1] * height,
    width,
    height,
    allocationWidth,
    allocationHeight,
    logicalWidth: Math.max(1, Number(request?.logicalWidth) || width),
    logicalHeight: Math.max(1, Number(request?.logicalHeight) || height),
    uvRect,
    cropped: Math.abs(uvRect[0]) > 1e-9 || Math.abs(uvRect[1]) > 1e-9 ||
      Math.abs(uvRect[2] - 1) > 1e-9 || Math.abs(uvRect[3] - 1) > 1e-9,
  };
}

// Source detail and framebuffer allocation are deliberately different
// contracts. `target` is only the visible ROI allocation; dividing by the ROI
// extent recovers the physical backing size of the complete node boundary.
// Content scale adjusts the detail requested from a source, but never the
// allocation owned by the node. Consumers such as SVG rasterization may apply
// their own global safety cap after this value is calculated.
export function renderSourceDetail(target = {}, request = {}, {
  contentScale = 1,
} = {}) {
  const scale = Math.max(0.01, Math.abs(Number(contentScale) || 1));
  if (request?.empty === true) {
    return {
      width: 0,
      height: 0,
      physicalWidth: 0,
      physicalHeight: 0,
      contentScale: scale,
    };
  }
  const view = renderView(target, request);
  return {
    width: view.width * scale,
    height: view.height * scale,
    physicalWidth: view.width,
    physicalHeight: view.height,
    contentScale: scale,
  };
}

export function withRenderView(target, request, draw) {
  if (typeof draw !== "function") return undefined;
  const view = renderView(target, request);
  if (!view.cropped) return draw(view);
  target.push();
  try {
    target.translate(-view.x, -view.y);
    return draw(view);
  } finally {
    target.pop();
  }
}

export function normalizeRenderUvRect(value) {
  if (!Array.isArray(value) || value.length < 4) return [...FULL_RENDER_UV_RECT];
  const width = finiteClamp(value[2], 1e-9, 1, 1);
  const height = finiteClamp(value[3], 1e-9, 1, 1);
  return [
    finiteClamp(value[0], 0, 1 - width, 0),
    finiteClamp(value[1], 0, 1 - height, 0),
    width,
    height,
  ];
}

function finiteClamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Math.max(minimum, Math.min(maximum, Number.isFinite(number) ? number : fallback));
}
