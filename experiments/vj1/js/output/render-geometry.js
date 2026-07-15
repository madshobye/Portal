import { VJ1 } from "../constants.js";

export function outputDefinitions(render = {}) {
  if (Array.isArray(render.outputs) && render.outputs.length) {
    return render.outputs.map((output, index) => ({
      id: String(output.id || (index === 0 ? "output-main" : `output-${index + 1}`)),
      name: output.name || (index === 0 ? "Main output" : `Output ${index + 1}`),
      width: positiveInt(output.width, VJ1.renderWidth, 1),
      height: positiveInt(output.height, VJ1.renderHeight, 1),
    }));
  }
  return [{
    id: "output-main",
    name: "Main output",
    width: positiveInt(render.frameWidth ?? render.width, VJ1.renderWidth, 1),
    height: positiveInt(render.frameHeight ?? render.height, VJ1.renderHeight, 1),
  }];
}

export function frameSize(render = {}, outputId = "") {
  const outputs = outputDefinitions(render);
  const output = outputs.find((item) => item.id === outputId) || outputs[0];
  return {
    width: output.width,
    height: output.height,
  };
}

export function worldSize(render = {}) {
  const frame = frameSize(render);
  const outputs = outputDefinitions(render);
  const gap = 0;
  const contentWidth = outputs.reduce((sum, output) => sum + output.width, 0) + gap * Math.max(0, outputs.length - 1);
  const contentHeight = Math.max(...outputs.map((output) => output.height));
  const fallbackWidth = contentWidth + Math.round(Math.max(...outputs.map((output) => output.width)) * 0.5);
  const fallbackHeight = Math.round(contentHeight * 1.5);
  return {
    width: Math.max(frame.width, positiveInt(render.worldWidth, fallbackWidth, 1)),
    height: Math.max(frame.height, positiveInt(render.worldHeight, fallbackHeight, 1)),
  };
}

export function surfaceTextureSize(render = {}) {
  return {
    width: positiveInt(render.surfaceWidth, VJ1.surfaceWidth, 1),
    height: positiveInt(render.surfaceHeight, VJ1.surfaceHeight, 1),
  };
}

export function surfaceTextureSizeForCorners(render = {}, corners = []) {
  const maxTexture = surfaceTextureSize(render);
  const mapped = mappedSurfaceSize(corners);
  if (!mapped) return maxTexture;
  return {
    width: quantizedInt(mapped.width, 64, maxTexture.width),
    height: quantizedInt(mapped.height, 64, maxTexture.height),
  };
}

export function frameRenderRequest(render = {}, meta = {}) {
  return createRenderRequest("frame", frameSize(render), meta);
}

export function surfaceRenderRequest(render = {}, corners = [], meta = {}) {
  return createRenderRequest("surface", surfaceTextureSizeForCorners(render, corners), meta);
}

export function createRenderRequest(role = "texture", size = {}, meta = {}) {
  return {
    ...meta,
    role,
    width: positiveInt(size.width, VJ1.renderWidth, 1),
    height: positiveInt(size.height, VJ1.renderHeight, 1),
  };
}

export function renderRequestKey(request = {}) {
  const role = request.role || "texture";
  const width = positiveInt(request.width, VJ1.renderWidth, 1);
  const height = positiveInt(request.height, VJ1.renderHeight, 1);
  // Rendering identity is intentionally separate from presentation/timing
  // identity. Two surfaces can map the same composition texture without
  // forcing the composition chain to render twice.
  const requestInstance = request.renderIdentity ?? request.instanceId ?? "";
  const instance = requestInstance ? `:${requestInstance}` : "";
  return `${role}:${width}x${height}${instance}`;
}

export function mappedSurfaceSize(corners = []) {
  if (!Array.isArray(corners) || corners.length !== 4) return null;
  const [tl, tr, br, bl] = corners;
  if (![tl, tr, br, bl].every((point) => point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)))) {
    return null;
  }
  const top = pointDistance(tl, tr);
  const bottom = pointDistance(bl, br);
  const left = pointDistance(tl, bl);
  const right = pointDistance(tr, br);
  return {
    width: Math.max(1, (top + bottom) * 0.5),
    height: Math.max(1, (left + right) * 0.5),
  };
}

export function mappedSurfaceBounds(corners = []) {
  if (!Array.isArray(corners) || corners.length !== 4) return null;
  const points = corners.map((point) => ({ x: Number(point?.x), y: Number(point?.y) }));
  if (!points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return { left, top, right, bottom, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

export function visibleMappedSurfaceSize(corners = [], viewport = {}) {
  const mapped = mappedSurfaceSize(corners);
  const bounds = mappedSurfaceBounds(corners);
  if (!mapped || !bounds) return null;
  const viewportWidth = Math.max(1, Number(viewport.width) || 1);
  const viewportHeight = Math.max(1, Number(viewport.height) || 1);
  const visibleWidth = Math.min(bounds.right, viewportWidth) - Math.max(bounds.left, 0);
  const visibleHeight = Math.min(bounds.bottom, viewportHeight) - Math.max(bounds.top, 0);
  if (visibleWidth <= 0 || visibleHeight <= 0) return null;
  return {
    width: Math.max(1, mapped.width * Math.min(1, visibleWidth / bounds.width)),
    height: Math.max(1, mapped.height * Math.min(1, visibleHeight / bounds.height)),
    bounds,
  };
}

export function sourceRenderDemand({
  logicalSize = {},
  sampleRect = {},
  maxRasterSize = {},
  maxSurfaceSize = {},
  corners = [],
  viewport = {},
  pixelScale = 1,
  overscan = 1.08,
} = {}) {
  const footprint = visibleMappedSurfaceSize(corners, viewport);
  if (!footprint) return null;
  const logicalWidth = Math.max(1, Number(logicalSize.width) || 1);
  const logicalHeight = Math.max(1, Number(logicalSize.height) || 1);
  const rect = clampLogicalRect(sampleRect, logicalWidth, logicalHeight);
  const scaleToPixels = Math.max(0.05, Number(pixelScale) || 1) * Math.max(1, Number(overscan) || 1);
  const desiredScale = Math.max(
    footprint.width * scaleToPixels / rect.width,
    footprint.height * scaleToPixels / rect.height
  );
  const rasterLimit = Math.min(
    Math.max(1, Number(maxRasterSize.width) || logicalWidth) / logicalWidth,
    Math.max(1, Number(maxRasterSize.height) || logicalHeight) / logicalHeight
  );
  const rasterScale = Math.max(1 / Math.max(logicalWidth, logicalHeight), Math.min(rasterLimit, desiredScale));
  const rasterSize = {
    width: quantizedDemandInt(logicalWidth * rasterScale, Math.max(1, Number(maxRasterSize.width) || logicalWidth)),
    height: quantizedDemandInt(logicalHeight * rasterScale, Math.max(1, Number(maxRasterSize.height) || logicalHeight)),
  };
  const effectiveScale = Math.min(rasterSize.width / logicalWidth, rasterSize.height / logicalHeight);
  const maxSurfaceWidth = Math.max(1, Number(maxSurfaceSize.width) || rect.width);
  const maxSurfaceHeight = Math.max(1, Number(maxSurfaceSize.height) || rect.height);
  const surfaceSize = {
    width: quantizedDemandInt(rect.width * effectiveScale, maxSurfaceWidth),
    height: quantizedDemandInt(rect.height * effectiveScale, maxSurfaceHeight),
  };
  return { footprint, logicalSize: { width: logicalWidth, height: logicalHeight }, sampleRect: rect, rasterScale: effectiveScale, rasterSize, surfaceSize };
}

export function canvasSizeForMode(mode, render = {}) {
  if (mode === "preview") return worldSize(render);
  return frameSize(render);
}

export function outputFrameOffset(render = {}) {
  const frame = outputFrames(render)[0];
  return { x: frame?.x || 0, y: frame?.y || 0 };
}

export function outputFrames(render = {}) {
  const outputs = outputDefinitions(render);
  const world = worldSize(render);
  const gap = 0;
  const contentWidth = outputs.reduce((sum, output) => sum + output.width, 0) + gap * Math.max(0, outputs.length - 1);
  let x = Math.max(0, (world.width - contentWidth) * 0.5);
  return outputs.map((output) => {
    const frame = {
      ...output,
      x,
      y: Math.max(0, (world.height - output.height) * 0.5),
    };
    x += output.width + gap;
    return frame;
  });
}

export function outputFrameForId(render = {}, outputId = "") {
  const frames = outputFrames(render);
  return frames.find((frame) => frame.id === outputId) || frames[0];
}

export function defaultProjectSurfaceMapping(render = {}, surfaces = []) {
  const frame = frameSize(render);
  const offset = outputFrameOffset(render);
  const texture = surfaceTextureSize(render);
  const surfaceList = Array.isArray(surfaces) ? surfaces : [];
  const cols = Math.max(1, Math.ceil(Math.sqrt(surfaceList.length || 1)));
  const rows = Math.max(1, Math.ceil((surfaceList.length || 1) / cols));
  const gap = Math.max(24, Math.round(Math.min(frame.width, frame.height) * 0.035));
  const cellW = Math.max(1, (frame.width - gap * (cols + 1)) / cols);
  const idealCellH = cellW * (texture.height / texture.width);
  const maxCellH = Math.max(1, (frame.height - gap * (rows + 1)) / rows);
  const cellH = Math.min(idealCellH, maxCellH);

  return surfaceList.map((surface, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = offset.x + gap + col * (cellW + gap);
    const y = offset.y + gap + row * (cellH + gap);
    const id = surface.id || surface.name || `surface-${index + 1}`;
    return {
      id,
      name: id,
      w: texture.width,
      h: texture.height,
      corners: [
        { x, y },
        { x: x + cellW, y },
        { x: x + cellW, y: y + cellH },
        { x, y: y + cellH },
      ],
    };
  });
}

export function fittedCssRect(container, content, zoom = 1, pan = {}) {
  const cw = Math.max(1, Number(container?.width) || 1);
  const ch = Math.max(1, Number(container?.height) || 1);
  const iw = Math.max(1, Number(content?.width) || 1);
  const ih = Math.max(1, Number(content?.height) || 1);
  const scale = Math.min(cw / iw, ch / ih) * Math.max(0.01, Number(zoom) || 1);
  return {
    width: Math.max(1, iw * scale),
    height: Math.max(1, ih * scale),
    x: Number(pan?.x) || 0,
    y: Number(pan?.y) || 0,
    scale,
  };
}

function positiveInt(value, fallback, min = 1) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, number);
}

function quantizedInt(value, min, max) {
  const number = Math.round(Number(value));
  const upper = Math.max(min, Number(max) || min);
  const clamped = Math.min(Math.max(min, number || min), upper);
  return Math.min(upper, Math.max(min, Math.round(clamped / 16) * 16));
}

function quantizedDemandInt(value, max) {
  const upper = Math.max(1, Math.round(Number(max) || 1));
  const clamped = Math.min(upper, Math.max(1, Math.round(Number(value) || 1)));
  if (clamped < 16) return clamped;
  return Math.min(upper, Math.max(16, Math.round(clamped / 16) * 16));
}

function clampLogicalRect(rect = {}, logicalWidth = 1, logicalHeight = 1) {
  const x = Math.max(0, Math.min(logicalWidth - 1, Number(rect.x) || 0));
  const y = Math.max(0, Math.min(logicalHeight - 1, Number(rect.y) || 0));
  const width = Math.max(1, Math.min(logicalWidth - x, Number(rect.width) || logicalWidth));
  const height = Math.max(1, Math.min(logicalHeight - y, Number(rect.height) || logicalHeight));
  return { x, y, width, height };
}

function pointDistance(a, b) {
  const dx = Number(a.x) - Number(b.x);
  const dy = Number(a.y) - Number(b.y);
  return Math.sqrt(dx * dx + dy * dy);
}
