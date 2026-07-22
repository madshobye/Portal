import { VJ1 } from "../constants.js";
import {
  compositionLogicalSize,
  normalizeAspectRatio,
} from "../libraries/render-engine/relative-geometry.js";

export const DEFAULT_MAX_FRAME_RATE = 120;
export const RESOLUTION_CEILING_CLASSES = ["auto", "2k", "4k", "8k"];

export function renderMaxFrameRate(render = {}) {
  return positiveInt(render?.maxFrameRate, DEFAULT_MAX_FRAME_RATE, 1, 120);
}

export function renderPresentationFrameRate(render = {}, {
  mode = "output",
  thumbnailPreview = false,
  outputWindowOpen = false,
} = {}) {
  const ceiling = renderMaxFrameRate(render);
  if (mode === "output") return ceiling;
  const previewTarget = thumbnailPreview ? 60 : outputWindowOpen ? 30 : 60;
  return Math.min(previewTarget, ceiling);
}

export function createOutputDefinition(index = 0, aspectRatio = VJ1.renderWidth / VJ1.renderHeight) {
  // Accept the old (index, width, height) call during the v24->v25 transition.
  const legacyHeight = arguments.length > 2 ? Number(arguments[2]) : 0;
  const ratio = legacyHeight > 0 ? Number(aspectRatio) / legacyHeight : aspectRatio;
  return {
    id: index === 0 ? "output-main" : `output-${index + 1}`,
    name: `Output ${index + 1}`,
    aspectRatio: normalizeAspectRatio(ratio),
  };
}

export function normalizeOutputName(name, index = 0) {
  const value = String(name || "").trim();
  // output-main remains a stable technical id for existing routes and URLs;
  // it no longer has a special user-facing identity.
  if (index === 0 && /^(main|main output)$/i.test(value)) return "Output 1";
  return value || `Output ${index + 1}`;
}

export function normalizeRenderSettings(render = {}) {
  const outputs = Array.isArray(render.outputs) && render.outputs.length
    ? render.outputs.map((output, index) => normalizeOutputDefinition(output, index))
    : [createOutputDefinition()];
  const primaryAspect = outputs[0].aspectRatio;
  return {
    ...stripLegacyPixelGeometry(render),
    outputs,
    sceneAspectRatio: normalizeAspectRatio(
      render.sceneAspectRatio,
      VJ1.sceneWidth / VJ1.sceneHeight
    ),
    componentAspectRatio: normalizeAspectRatio(
      render.componentAspectRatio,
      primaryAspect
    ),
    resolutionCeiling: normalizeResolutionCeiling(render.resolutionCeiling),
    maxFrameRate: renderMaxFrameRate(render),
    pixelDensity: clampNumber(render.pixelDensity, 0.5, 2, 1),
    sampling: normalizeSamplingSettings(render.sampling),
    camera: normalizeCameraSettings(render.camera),
    screenCapture: normalizeScreenCaptureSettings(render.screenCapture),
    hostViewport: normalizeHostViewport(render.hostViewport),
    ...normalizeComponentPipelineSettings(render),
  };
}

// This is an aspect-based mathematical space used by interactions and shader
// coordinates. It is not a requested backing-buffer resolution.
export function sceneFrameSize(render = {}) {
  return compositionLogicalSize(render.sceneAspectRatio ?? (VJ1.sceneWidth / VJ1.sceneHeight));
}

export function componentFrameSize(render = {}) {
  return compositionLogicalSize(render.componentAspectRatio ?? (VJ1.renderWidth / VJ1.renderHeight));
}

// Frames are relative and therefore never scale when a host resizes.
export function scaleFramesToSceneSize(frames = []) {
  return frames;
}

export function normalizeResolutionCeiling(value) {
  return RESOLUTION_CEILING_CLASSES.includes(value) ? value : "auto";
}

export function resolutionCeilingLongEdge(value = "auto") {
  if (value === "2k") return 2048;
  if (value === "4k") return 4096;
  if (value === "8k") return 8192;
  return Infinity;
}

export function normalizeHostViewport(viewport = {}) {
  if (!viewport || typeof viewport !== "object") return null;
  const width = Math.round(Number(viewport.width));
  const height = Math.round(Number(viewport.height));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;
  return {
    width: Math.min(16384, width),
    height: Math.min(16384, height),
    mode: viewport.mode === "preview" ? "preview" : "output",
    outputId: String(viewport.outputId || ""),
  };
}

export function normalizeSamplingSettings(sampling = {}) {
  return {
    surfaceOverscan: clampNumber(sampling?.surfaceOverscan, 0.5, 2, 1),
    recordingFrameScale: clampNumber(sampling?.recordingFrameScale, 0.5, 2, 1),
    limitSceneToLogicalSize: sampling?.limitSceneToLogicalSize !== false,
  };
}

export function normalizeCameraSettings(camera = {}) {
  return {
    facingMode: camera?.facingMode === "environment" ? "environment" : "user",
    mirrored: camera?.mirrored === true,
    maxResolution: camera?.maxResolution === true,
  };
}

export function normalizeScreenCaptureSettings(screen = {}) {
  return {
    frameRate: positiveInt(screen?.frameRate, 30, 1, 60),
    cursor: ["always", "motion", "never"].includes(screen?.cursor) ? screen.cursor : "always",
    preferCurrentTab: screen?.preferCurrentTab === true,
    includeCurrentTab: screen?.includeCurrentTab !== false,
    surfaceSwitching: screen?.surfaceSwitching !== false,
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
  const fit = ["frame", "world", "manual"].includes(viewport.fit) ? viewport.fit : "world";
  return {
    zoom: clampNumber(viewport.zoom, 0.1, 6, 1),
    x: clampNumber(viewport.x, -100000, 100000, 0),
    y: clampNumber(viewport.y, -100000, 100000, 0),
    fit,
  };
}

export function normalizePreviewViewports(viewports = {}) {
  const keys = ["component", "scene", "mapping", "live"];
  return Object.fromEntries(keys.map((key) => [key, normalizePreviewViewport(viewports?.[key] || {})]));
}

function normalizeOutputDefinition(output = {}, index = 0, fallbackAspect = VJ1.renderWidth / VJ1.renderHeight) {
  const fallback = createOutputDefinition(index, fallbackAspect);
  return {
    id: String(output.id || fallback.id),
    name: normalizeOutputName(output.name, index),
    aspectRatio: normalizeAspectRatio(
      output.aspectRatio,
      fallback.aspectRatio
    ),
  };
}

function stripLegacyPixelGeometry(render = {}) {
  const {
    width: _width,
    height: _height,
    frameWidth: _frameWidth,
    frameHeight: _frameHeight,
    worldWidth: _worldWidth,
    worldHeight: _worldHeight,
    canvasSize: _canvasSize,
    componentTexture: _componentTexture,
    surfaceTexture: _surfaceTexture,
    ...current
  } = render;
  return current;
}

function positiveRatio(width, height, fallback) {
  const w = Number(width);
  const h = Number(height);
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? w / h : fallback;
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
