import { VJ1 } from "../constants.js";

export const SURFACE_TEXTURE_MODES = ["auto", "manual"];

export function normalizeSurfaceTextureMode(value) {
  return value === "manual" ? "manual" : "auto";
}

export function normalizeSurfaceTextureSettings(surfaceTexture = {}, fallbackSize = {}) {
  const fallbackWidth = positiveInt(fallbackSize.width, VJ1.renderWidth);
  const fallbackHeight = positiveInt(fallbackSize.height, VJ1.renderHeight);
  return {
    mode: normalizeSurfaceTextureMode(surfaceTexture?.mode),
    maxWidth: clampedInt(surfaceTexture?.maxWidth, fallbackWidth, 64, 8192),
    maxHeight: clampedInt(surfaceTexture?.maxHeight, fallbackHeight, 64, 8192),
  };
}

export function normalizeComponentTextureSettings(componentTexture = {}, fallbackSize = {}) {
  return {
    width: clampedInt(componentTexture?.width, positiveInt(fallbackSize.width, VJ1.renderWidth), 64, 8192),
    height: clampedInt(componentTexture?.height, positiveInt(fallbackSize.height, VJ1.renderHeight), 64, 8192),
  };
}

// Component design resolution is independent from the adaptive surface
// raster policy. It defines frame geometry and available native detail.
export function componentTextureSize(render = {}) {
  const primary = Array.isArray(render.outputs) && render.outputs.length ? render.outputs[0] : null;
  const fallback = {
    width: positiveInt(primary?.width ?? render.frameWidth ?? render.width, VJ1.renderWidth),
    height: positiveInt(primary?.height ?? render.frameHeight ?? render.height, VJ1.renderHeight),
  };
  return normalizeComponentTextureSettings(render.componentTexture, fallback);
}

export function manualSurfaceTextureLimit(render = {}, pixelScale = 1) {
  const settings = normalizeSurfaceTextureSettings(render.surfaceTexture, componentTextureSize(render));
  if (settings.mode !== "manual") return null;
  const density = Math.max(0.05, Number(pixelScale) || 1);
  return {
    width: Math.max(1, Math.round(settings.maxWidth * density)),
    height: Math.max(1, Math.round(settings.maxHeight * density)),
  };
}

function positiveInt(value, fallback) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function clampedInt(value, fallback, min, max) {
  return Math.min(max, Math.max(min, positiveInt(value, fallback)));
}
