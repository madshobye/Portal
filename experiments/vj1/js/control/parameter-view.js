import { BLEND_MODES } from "../constants.js";
import {
  RENDER_QUALITY_PARAM,
  createEnumParam,
  createNumberParam,
  normalizeParamValue,
} from "../libraries/visual-nodes/shared/component-schema.js";
import { nodeBoundaryUniformScale, normalizeNodeBoundary } from "../libraries/render-engine/roi/index.js";
import {
  CHAIN_GENERAL_CONTROL_PATHS,
  chainGeneralControlParameterId,
} from "../libraries/composition-engine/shared/chain-general-control-parameters.js";

// VJ parameter presentation is a semantic projection only. DOM, styling, input
// events, scroll retention, and value formatting belong to ui-engine nodes.
export function componentParamViews(component = {}) {
  const visible = (component?.params || []).filter((param) =>
    param?.id !== "seed" && param?.id !== RENDER_QUALITY_PARAM.id);
  const explicitPrimary = new Set(component?.primaryParamIds || []);
  const explicitDetails = new Set(component?.detailParamIds || []);
  if (explicitPrimary.size || explicitDetails.size) {
    return {
      primary: visible.filter((param) => explicitPrimary.has(param.id) || !explicitDetails.has(param.id)),
      details: visible.filter((param) => explicitDetails.has(param.id)),
    };
  }
  if (visible.length <= 6) return { primary: visible, details: [] };
  return { primary: visible.slice(0, 6), details: visible.slice(6) };
}

export const CHAIN_TRANSFORM_PARAMS = Object.freeze([
  Object.freeze(createNumberParam("x", "Content X", { min: 0, max: 1, step: 0.001, defaultValue: 0.5 })),
  Object.freeze(createNumberParam("y", "Content Y", { min: 0, max: 1, step: 0.001, defaultValue: 0.5 })),
  Object.freeze(createNumberParam("scale", "Content scale", { min: 0.05, max: 8, step: 0.001, defaultValue: 1, scale: "log" })),
]);

export const CHAIN_BOUNDARY_PARAMS = Object.freeze([
  Object.freeze(createNumberParam("x", "Boundary X", { min: 0, max: 1, step: 0.001, defaultValue: 0.5 })),
  Object.freeze(createNumberParam("y", "Boundary Y", { min: 0, max: 1, step: 0.001, defaultValue: 0.5 })),
  Object.freeze(createNumberParam("rotation", "Boundary rotation", { min: -3.1416, max: 3.1416, step: 0.001, defaultValue: 0 })),
]);

export const CHAIN_BOUNDARY_SCALE_PARAM = Object.freeze(
  createNumberParam("scale", "Boundary scale", { min: 0.005, max: 4, step: 0.001, defaultValue: 1, scale: "log" }),
);

export const CHAIN_COMPOSITE_PARAMS = Object.freeze([
  Object.freeze(createNumberParam("opacity", "Opacity", { min: 0, max: 1, step: 0.01, defaultValue: 1 })),
  Object.freeze(createEnumParam("blend", "Blend", BLEND_MODES, "normal")),
]);

export const CHAIN_GENERAL_PARAMS = Object.freeze([
  ...CHAIN_COMPOSITE_PARAMS,
  ...CHAIN_TRANSFORM_PARAMS,
]);

export function chainTransformParams(_transform = {}) {
  return CHAIN_TRANSFORM_PARAMS;
}

export function chainBoundaryPositionParams(_boundary = {}) {
  return CHAIN_BOUNDARY_PARAMS;
}

export function chainGeneralAnimationParameters(item = {}) {
  const transformParams = chainTransformParams(item?.transform);
  const normalizedBoundary = normalizeNodeBoundary(item?.boundary);
  const boundaryParams = chainBoundaryPositionParams(normalizedBoundary);
  const byPath = [{
    param: CHAIN_COMPOSITE_PARAMS.find((param) => param.id === "opacity"),
    path: CHAIN_GENERAL_CONTROL_PATHS.OPACITY,
    value: normalizeParamValue(
      CHAIN_COMPOSITE_PARAMS.find((param) => param.id === "opacity"),
      item?.opacity,
    ),
  }, ...transformParams.map((param) => ({
    param,
    path: `transform.${param.id}`,
    value: normalizeParamValue(param, item?.transform?.[param.id]),
  })), ...boundaryParams.map((param) => ({
    param,
    path: `boundary.${param.id}`,
    value: normalizeParamValue(param, normalizedBoundary[param.id]),
  })), {
    param: CHAIN_BOUNDARY_SCALE_PARAM,
    path: CHAIN_GENERAL_CONTROL_PATHS.BOUNDARY_SCALE,
    value: nodeBoundaryUniformScale(normalizedBoundary),
  }];
  return byPath.filter(({ param }) => param?.type === "number").map(({ param, path, value }) => ({
    ...param,
    id: chainGeneralControlParameterId(path),
    value,
  }));
}

export function chainRenderQualityTarget(item = {}, basePath = "") {
  if (item?.kind === "effect") {
    return {
      path: joinControlPath(basePath, `params.${RENDER_QUALITY_PARAM.id}`),
      value: item?.params?.[RENDER_QUALITY_PARAM.id],
    };
  }
  if (item?.kind === "source" && ["generator", "media"].includes(item?.source?.type)) {
    return {
      path: joinControlPath(basePath, `source.params.${RENDER_QUALITY_PARAM.id}`),
      value: item?.source?.params?.[RENDER_QUALITY_PARAM.id],
    };
  }
  return null;
}

export function paramCurrentValue(_component, pass = {}, param = {}) {
  const values = pass.params && typeof pass.params === "object" ? pass.params : {};
  return normalizeParamValue(param, values[param.id]);
}

export function retainedParameterControlEligible(param = {}) {
  if (!param?.id || param.id === "seed" || param.id === RENDER_QUALITY_PARAM.id) return false;
  if (param.ui === "media" || param.ui === "text-style-toggle") return false;
  if (param.ui === "markdown") return param.type === "text";
  if (param.ui === "range-pair") {
    return param.type === "number" && !!param.rangePair && ["min", "max"].includes(param.rangeRole);
  }
  return ["number", "boolean", "enum", "color", "text", "event"].includes(param.type);
}

function joinControlPath(base, relative) {
  return [String(base || "").replace(/\.$/, ""), String(relative || "").replace(/^\./, "")]
    .filter(Boolean)
    .join(".");
}
