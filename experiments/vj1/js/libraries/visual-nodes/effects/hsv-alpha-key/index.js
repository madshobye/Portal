import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createRangePairParams } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, animatedSeedRuntime, noiseSeedParams } from "../../shared/shader-component-common.js";
import { defineEffectNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "hsvAlphaKey",
    name: "HSV Alpha Key",
    category: "key",
    params: [
      ...createRangePairParams("hue", "Hue", {
        min: 0,
        max: 360,
        step: 1,
        defaultMin: 200,
        defaultMax: 260,
        kind: "hue",
        display: "degrees",
      }),
      ...createRangePairParams("saturation", "Saturation", {
        defaultMin: 0.4,
        defaultMax: 1,
        kind: "saturation",
        display: "percent",
      }),
      ...createRangePairParams("value", "Value", {
        defaultMin: 0,
        defaultMax: 0.45,
        kind: "value",
        display: "percent",
      }),
      createNumberParam("feather", "Feather", { min: 0, max: 0.5, step: 0.001, defaultValue: 0.08 }),
    ],
    code: `
vec3 rgbToHsv(vec3 rgb) {
  float high = max(max(rgb.r, rgb.g), rgb.b);
  float low = min(min(rgb.r, rgb.g), rgb.b);
  float delta = high - low;
  float hue = 0.0;
  if (delta > 0.00001) {
    if (high == rgb.r) hue = mod((rgb.g - rgb.b) / delta, 6.0);
    else if (high == rgb.g) hue = (rgb.b - rgb.r) / delta + 2.0;
    else hue = (rgb.r - rgb.g) / delta + 4.0;
    hue = fract(hue / 6.0);
  }
  float saturation = high > 0.00001 ? delta / high : 0.0;
  return vec3(hue, saturation, high);
}

float distanceOutsideRange(float value, float low, float high) {
  return max(max(low - value, value - high), 0.0);
}

vec4 runEffect(vec2 uv, vec4 color) {
  if (color.a <= 0.00001) return color;
  vec3 straight = clamp(color.rgb / color.a, 0.0, 1.0);
  vec3 hsv = rgbToHsv(straight);
  float hueDistance = distanceOutsideRange(hsv.x, hueMin / 360.0, hueMax / 360.0);
  float saturationDistance = distanceOutsideRange(hsv.y, saturationMin, saturationMax);
  float valueDistance = distanceOutsideRange(hsv.z, valueMin, valueMax);
  float keyDistance = max(hueDistance, max(saturationDistance, valueDistance));
  float keep = feather <= 0.00001
    ? step(0.000001, keyDistance)
    : smoothstep(0.0, feather, keyDistance);
  return vec4(color.rgb * keep, color.a * keep);
}`,
  });

export const VisualComponent = defineEffectNode(manifest);
export default VisualComponent;
