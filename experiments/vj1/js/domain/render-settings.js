import { VJ1 } from "../constants.js";
import { normalizeComponentTextureSettings, normalizeSurfaceTextureSettings } from "./render-resolution.js?v=adaptive-component-demand-29";

export function createOutputDefinition(index = 0, width = VJ1.renderWidth, height = VJ1.renderHeight) {
  return {
    id: index === 0 ? "output-main" : `output-${index + 1}`,
    name: index === 0 ? "Main output" : `Output ${index + 1}`,
    width: positiveInt(width, VJ1.renderWidth, 128, 8192),
    height: positiveInt(height, VJ1.renderHeight, 128, 8192),
  };
}

export function normalizeRenderSettings(render = {}) {
  const frameWidth = positiveInt(render.width, VJ1.renderWidth, 128, 8192);
  const frameHeight = positiveInt(render.height, VJ1.renderHeight, 128, 8192);
  const outputs = Array.isArray(render.outputs) && render.outputs.length
    ? render.outputs.map((output, index) => normalizeOutputDefinition(output, index, frameWidth, frameHeight))
    : [createOutputDefinition(0, frameWidth, frameHeight)];
  const primary = outputs[0];
  const contentWidth = outputs.reduce((sum, output) => sum + output.width, 0);
  const contentHeight = Math.max(...outputs.map((output) => output.height));
  const marginX = Math.round(Math.max(...outputs.map((output) => output.width)) * VJ1.outputWorldMarginRatio);
  const marginY = Math.round(contentHeight * VJ1.outputWorldMarginRatio);
  const worldWidth = contentWidth + marginX * 2;
  const worldHeight = contentHeight + marginY * 2;
  return {
    ...render,
    width: primary.width,
    height: primary.height,
    frameWidth: primary.width,
    frameHeight: primary.height,
    outputs,
    worldWidth,
    worldHeight,
    componentTexture: normalizeComponentTextureSettings(render.componentTexture, primary),
    surfaceTexture: normalizeSurfaceTextureSettings(render.surfaceTexture, primary),
    pixelDensity: clampNumber(render.pixelDensity, 0.5, 2, 1),
    sampling: normalizeSamplingSettings(render.sampling),
    camera: normalizeCameraSettings(render.camera, primary.width, primary.height),
    ...normalizeComponentPipelineSettings(render),
  };
}

export function normalizeSamplingSettings(sampling = {}) {
  return {
    surfaceOverscan: clampNumber(sampling?.surfaceOverscan, 0.5, 2, 1),
    recordingFrameScale: clampNumber(sampling?.recordingFrameScale, 0.5, 2, 1),
    limitCanvasToLogicalSize: sampling?.limitCanvasToLogicalSize !== false,
  };
}

export function normalizeCameraSettings(camera = {}, fallbackWidth = VJ1.renderWidth, fallbackHeight = VJ1.renderHeight) {
  return {
    width: positiveInt(camera?.width, fallbackWidth, 160, 7680),
    height: positiveInt(camera?.height, fallbackHeight, 120, 4320),
    facingMode: camera?.facingMode === "environment" ? "environment" : "user",
    mirrored: camera?.mirrored === true,
    maxResolution: camera?.maxResolution === true,
  };
}

export function normalizeComponentPipelineSettings(render = {}) {
  const upscaling = render.upscaling && typeof render.upscaling === "object" ? render.upscaling : {};
  const postProcessing = render.postProcessing && typeof render.postProcessing === "object" ? render.postProcessing : {};
  return {
    upscaling: {
      enabled: upscaling.enabled === true,
      amount: clampNumber(upscaling.amount, 0.35, 1, 0.67),
    },
    postProcessing: {
      noiseEnabled: postProcessing.noiseEnabled === true,
      noiseAmount: clampNumber(postProcessing.noiseAmount, 0, 0.2, 0.035),
      grayscaleEnabled: postProcessing.grayscaleEnabled === true,
      grayscaleAmount: clampNumber(postProcessing.grayscaleAmount, 0, 1, 1),
    },
  };
}

export function normalizePreviewViewport(viewport = {}) {
  const fit = ["frame", "world", "manual"].includes(viewport.fit) ? viewport.fit : "frame";
  return {
    zoom: clampNumber(viewport.zoom, 0.1, 6, 1),
    x: clampNumber(viewport.x, -100000, 100000, 0),
    y: clampNumber(viewport.y, -100000, 100000, 0),
    fit,
  };
}

export function normalizePreviewViewports(viewports = {}) {
  const keys = ["component", "canvas", "scene", "live"];
  return Object.fromEntries(keys.map((key) => [key, normalizePreviewViewport(viewports?.[key] || {})]));
}

function normalizeOutputDefinition(output = {}, index = 0, fallbackWidth = VJ1.renderWidth, fallbackHeight = VJ1.renderHeight) {
  const fallback = createOutputDefinition(index, fallbackWidth, fallbackHeight);
  return {
    id: String(output.id || fallback.id),
    name: output.name || fallback.name,
    width: positiveInt(output.width, fallback.width, 128, 8192),
    height: positiveInt(output.height, fallback.height, 128, 8192),
  };
}

function positiveInt(value, fallback, min = 1, max = 8192) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
