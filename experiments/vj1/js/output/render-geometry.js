import { VJ1 } from "../constants.js";

export function frameSize(render = {}) {
  return {
    width: positiveInt(render.frameWidth ?? render.width, VJ1.renderWidth, 1),
    height: positiveInt(render.frameHeight ?? render.height, VJ1.renderHeight, 1),
  };
}

export function worldSize(render = {}) {
  const frame = frameSize(render);
  return {
    width: Math.max(frame.width, positiveInt(render.worldWidth, Math.round(frame.width * 1.5), 1)),
    height: Math.max(frame.height, positiveInt(render.worldHeight, Math.round(frame.height * 1.5), 1)),
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
  return `${role}:${width}x${height}`;
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

export function canvasSizeForMode(mode, render = {}) {
  if (mode === "preview") return worldSize(render);
  return frameSize(render);
}

export function outputFrameOffset(render = {}) {
  const frame = frameSize(render);
  const world = worldSize(render);
  return {
    x: Math.max(0, (world.width - frame.width) * 0.5),
    y: Math.max(0, (world.height - frame.height) * 0.5),
  };
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

function pointDistance(a, b) {
  const dx = Number(a.x) - Number(b.x);
  const dy = Number(a.y) - Number(b.y);
  return Math.sqrt(dx * dx + dy * dy);
}
