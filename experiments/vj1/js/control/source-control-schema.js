import { RENDER_QUALITY_PARAM } from "../libraries/visual-nodes/shared/component-schema.js";

export const MODEL_RENDER_MODES = ["surface", "wireframe", "surfaceWire", "outline", "surfaceOutline", "xrayOutline", "points"];
export const MEDIA_FIT_MODES = ["contain", "cover"];
export const MODEL_SURFACE_COLOR_PARAM = { id: "surfaceColor", label: "Surface color", type: "color", defaultValue: "#dce1dcff" };
export const MODEL_WIRE_COLOR_PARAM = { id: "wireColor", label: "Wire color", type: "color", defaultValue: "#141414dd" };
export const MEDIA_FIT_PARAM = { id: "fit", label: "Fit", type: "enum", values: MEDIA_FIT_MODES, defaultValue: "contain" };
export const IMAGE_ALPHA_CUT_PARAM = { id: "alphaCut", label: "Cut edge", type: "number", min: 0, max: 32, step: 0.25, defaultValue: 0 };
export const IMAGE_ALPHA_FEATHER_PARAM = { id: "alphaFeather", label: "Feather", type: "number", min: 0, max: 32, step: 0.25, defaultValue: 0 };

export const MEDIA_SOURCE_PARAMS = Object.freeze([
  RENDER_QUALITY_PARAM,
  MEDIA_FIT_PARAM,
]);

export const IMAGE_SOURCE_PARAMS = Object.freeze([
  ...MEDIA_SOURCE_PARAMS,
  IMAGE_ALPHA_CUT_PARAM,
  IMAGE_ALPHA_FEATHER_PARAM,
]);

export const MODEL_SOURCE_PARAMS = [
  { ...RENDER_QUALITY_PARAM, label: "Geometry detail" },
  { id: "renderMode", label: "Draw mode", type: "enum", values: MODEL_RENDER_MODES, defaultValue: "surface" },
  MODEL_SURFACE_COLOR_PARAM,
  MODEL_WIRE_COLOR_PARAM,
  { id: "rotationX", label: "Rotate X", type: "number", min: -3.14, max: 3.14, step: 0.01, defaultValue: 0 },
  { id: "rotationY", label: "Rotate Y", type: "number", min: -3.14, max: 3.14, step: 0.01, defaultValue: 0 },
  { id: "rotationZ", label: "Rotate Z", type: "number", min: -3.14, max: 3.14, step: 0.01, defaultValue: 0 },
  { id: "modelScale", label: "Scale", type: "number", min: 0.1, max: 5, step: 0.01, defaultValue: 1 },
  { id: "spinX", label: "Spin X", type: "number", min: -3, max: 3, step: 0.01, defaultValue: 0 },
  { id: "spinY", label: "Spin Y", type: "number", min: -3, max: 3, step: 0.01, defaultValue: 0 },
  { id: "spinZ", label: "Spin Z", type: "number", min: -3, max: 3, step: 0.01, defaultValue: 0 },
  { id: "depth", label: "Depth scale", type: "number", min: 0.2, max: 3, step: 0.01, defaultValue: 1 },
  { id: "visibleDepth", label: "Visible depth", type: "number", min: 0.02, max: 1, step: 0.01, defaultValue: 1 },
  { id: "focalLength", label: "Focal length (mm)", type: "number", min: 8, max: 200, step: 0.1, defaultValue: 20.8 },
  { id: "wireThickness", label: "Wire thickness", type: "number", min: 0.5, max: 12, step: 0.1, defaultValue: 1 },
  { id: "wireDetail", label: "Wire detail", type: "number", min: 0, max: 1, step: 0.01, defaultValue: 0.25 },
  { id: "edgeAngle", label: "Edge angle", type: "number", min: 0, max: 180, step: 1, defaultValue: 35 },
  { id: "edgeBudget", label: "Edge budget", type: "number", min: 1000, max: 50000, step: 1000, defaultValue: 20000 },
  { id: "pointBudget", label: "Point budget", type: "number", min: 500, max: 50000, step: 500, defaultValue: 4000 },
];

export function mediaSourceParams(source = {}, media = null) {
  if (isModelMediaSource(source, media)) return MODEL_SOURCE_PARAMS;
  if (isImageMediaSource(source, media)) return IMAGE_SOURCE_PARAMS;
  return MEDIA_SOURCE_PARAMS;
}

export function isModelMediaSource(source = {}, media = null) {
  if (media?.type === "model") return true;
  return /\.(stl|obj)$/i.test(String(source.mediaId || ""));
}

export function isVideoMediaSource(source = {}, media = null) {
  if (media?.type === "video") return true;
  return /\.(mp4|m4v|mov|webm|ogv)$/i.test(String(source.mediaId || ""));
}

export function isImageMediaSource(source = {}, media = null) {
  if (media?.type === "image") return true;
  return /\.(avif|bmp|gif|jpe?g|png|webp)$/i.test(String(source.mediaId || ""));
}
