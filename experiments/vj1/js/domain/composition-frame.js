import { VJ1 } from "../constants.js";

export const COMPOSITION_FRAME_SHAPES = ["landscape", "portrait", "square"];
export const COMPOSITION_RESOLUTION_SCALES = [0.5, 1, 2];

export function normalizeCompositionFrameShape(value) {
  return COMPOSITION_FRAME_SHAPES.includes(value) ? value : "landscape";
}

export function normalizeCompositionResolutionScale(value) {
  const number = Number(value);
  return COMPOSITION_RESOLUTION_SCALES.includes(number) ? number : 1;
}

export function compositionFrameMetrics(render = {}, composition = {}) {
  const textureWidth = positiveInt(render.surfaceWidth, VJ1.surfaceWidth);
  const textureHeight = positiveInt(render.surfaceHeight, VJ1.surfaceHeight);
  const longEdge = Math.max(textureWidth, textureHeight);
  const shortEdge = Math.min(textureWidth, textureHeight);
  const frameShape = normalizeCompositionFrameShape(composition.frameShape);
  const resolutionScale = normalizeCompositionResolutionScale(composition.resolutionScale);
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
