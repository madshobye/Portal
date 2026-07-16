import { VJ1 } from "../constants.js";
import { componentTextureSize } from "./render-resolution.js?v=adaptive-component-demand-26";

export const COMPONENT_FRAME_SHAPES = ["landscape", "portrait", "square"];
export const COMPONENT_RESOLUTION_SCALES = [0.5, 1, 2];

export function normalizeComponentFrameShape(value) {
  return COMPONENT_FRAME_SHAPES.includes(value) ? value : "landscape";
}

export function normalizeComponentResolutionScale(value) {
  const number = Number(value);
  return COMPONENT_RESOLUTION_SCALES.includes(number) ? number : 1;
}

export function componentFrameMetrics(render = {}, component = {}) {
  const texture = componentTextureSize(render);
  const textureWidth = positiveInt(texture.width, VJ1.renderWidth);
  const textureHeight = positiveInt(texture.height, VJ1.renderHeight);
  const longEdge = Math.max(textureWidth, textureHeight);
  const shortEdge = Math.min(textureWidth, textureHeight);
  const frameShape = normalizeComponentFrameShape(component.frameShape);
  const resolutionScale = normalizeComponentResolutionScale(component.resolutionScale);
  const globalDensity = clamp(Number(render.pixelDensity) || 1, 0.5, 2);
  const effectiveScale = globalDensity * resolutionScale;
  const base = frameShape === "portrait"
    ? { width: shortEdge, height: longEdge }
    : frameShape === "square"
      ? { width: shortEdge, height: shortEdge }
      : { width: longEdge, height: shortEdge };

  return {
    frameShape,
    resolutionScale,
    globalDensity,
    effectiveScale,
    baseWidth: base.width,
    baseHeight: base.height,
    width: Math.max(1, Math.round(base.width * effectiveScale)),
    height: Math.max(1, Math.round(base.height * effectiveScale)),
  };
}

function positiveInt(value, fallback) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
