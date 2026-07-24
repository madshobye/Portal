import { renderQualityScale, renderQualityValue } from "../libraries/visual-nodes/shared/component-schema.js";
import { contentTransformUvMatrices } from "./content-coordinate-space.js?v=render-coordinate-scope-3";
import { gazeBlinkUniforms } from "../libraries/visual-nodes/providers/gaze-blink-controller/index.js";
export { advanceRateClock, componentInstanceTime, globalVisualTimeScale, instanceTime } from "../libraries/timing-engine/index.js";
export { advanceSpatialScale } from "../libraries/timing-engine/index.js";
export { gazeBlinkUniforms as eyeballFrameUniforms };

export function qualityScaledRenderRequest(request = {}, params = {}, minimum = 0.35) {
  const scale = renderQualityScale(params, { minimum });
  if (scale >= 0.999) return request;
  const logicalWidth = Math.max(1, Number(request.logicalWidth) || Number(request.width) || 1);
  const logicalHeight = Math.max(1, Number(request.logicalHeight) || Number(request.height) || 1);
  const physicalWidth = Math.max(1, Number(request.width) || logicalWidth);
  const physicalHeight = Math.max(1, Number(request.height) || logicalHeight);
  return {
    ...request,
    width: Math.max(32, Math.round(physicalWidth * scale)),
    height: Math.max(32, Math.round(physicalHeight * scale)),
    logicalWidth,
    logicalHeight,
    qualityScale: scale,
  };
}

export function qualityAdjustedGeneratorParams(component = {}, params = {}) {
  const qualityParameters = (component?.params || [])
    .filter((parameter) => parameter?.renderQualityScaling);
  if (!qualityParameters.length) return params;
  const adjusted = { ...params };
  for (const parameter of qualityParameters) {
    const policy = parameter.renderQualityScaling;
    const authored = Number(params[parameter.id]);
    const fallback = Number(parameter.defaultValue);
    const base = Number.isFinite(authored)
      ? authored
      : Number.isFinite(fallback) ? fallback : 0;
    const multiplier = qualityComputeMultiplier(params, {
      minimum: policy.minimum,
      maximum: policy.maximum,
    });
    const scaled = Number(parameter.step) >= 1
      ? Math.round(base * multiplier)
      : base * multiplier;
    adjusted[parameter.id] = Math.min(
      Number.isFinite(Number(parameter.max)) ? Number(parameter.max) : Number.POSITIVE_INFINITY,
      Math.max(
        Number.isFinite(Number(parameter.min)) ? Number(parameter.min) : Number.NEGATIVE_INFINITY,
        scaled,
      ),
    );
  }
  return adjusted;
}

export function generatorRateParam(component = {}) {
  return String(
    component?.runtime?.rateParam
    || component?.nodeDefinition?.metadata?.runtimePolicy?.rateParam
    || "",
  );
}

export function usesShadertoyInterface(component = {}) {
  if (component.type === "shadertoy") return true;
  const code = String(component.code || "");
  return /\bvoid\s+mainImage\s*\(/.test(code) && !/\bvoid\s+main\s*\(/.test(code);
}

export function effectTransformUniforms(transform = {}) {
  const matrices = contentTransformUvMatrices(transform);
  return {
    transform: [matrices.value.x, matrices.value.y, matrices.value.scale, matrices.value.rotation],
    forward: matrices.sampling,
    inverse: matrices.placement,
  };
}

export function qualityComputeMultiplier(params = {}, { minimum = 0.35, maximum = 1.5 } = {}) {
  const quality = renderQualityValue(params);
  if (quality <= 0.5) return minimum + (1 - minimum) * (quality / 0.5);
  return 1 + (maximum - 1) * ((quality - 0.5) / 0.5);
}
