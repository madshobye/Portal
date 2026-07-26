import { createNumberParam } from "../../shared/component-schema.js";
import { defineEffectNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "alphaFeather",
    name: "Alpha Feather",
    category: "key",
    runtime: {
      isNeutral: (params = {}) =>
        Math.max(0, Number(params.cut ?? 1) || 0) <= 0.001 &&
        Math.max(0, Number(params.feather ?? 3) || 0) <= 0.001,
      roi: {
        mode: "neighborhood",
        halo: 64,
        coordinateSpace: "boundary",
        pixelEquivalentToFullFrame: true,
      },
    },
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 1 }),
      createNumberParam("cut", "Cut edge", { min: 0, max: 32, step: 0.25, defaultValue: 1 }),
      createNumberParam("feather", "Feather", { min: 0, max: 32, step: 0.25, defaultValue: 3 }),
    ],
    code: `
const float VJ1_ALPHA_FEATHER_PI = 3.141592653589793;

float erodedAlpha8(vec2 uv, float radiusPixels) {
  vec2 px = radiusPixels / max(resolution, vec2(1.0));
  float alpha = sampleSource(uv).a;
  alpha = min(alpha, sampleSource(uv + px * vec2( 1.0,  0.0)).a);
  alpha = min(alpha, sampleSource(uv + px * vec2(-1.0,  0.0)).a);
  alpha = min(alpha, sampleSource(uv + px * vec2( 0.0,  1.0)).a);
  alpha = min(alpha, sampleSource(uv + px * vec2( 0.0, -1.0)).a);
  alpha = min(alpha, sampleSource(uv + px * vec2( 0.70710678,  0.70710678)).a);
  alpha = min(alpha, sampleSource(uv + px * vec2(-0.70710678,  0.70710678)).a);
  alpha = min(alpha, sampleSource(uv + px * vec2( 0.70710678, -0.70710678)).a);
  alpha = min(alpha, sampleSource(uv + px * vec2(-0.70710678, -0.70710678)).a);
  return alpha;
}

float alphaPairAtRadius(vec2 uv, vec2 px, vec2 direction) {
  return sampleSource(uv + px * direction).a +
    sampleSource(uv - px * direction).a;
}

// Projection surfaces can use an analytic rectangle distance. Arbitrary visual
// alpha cannot, so estimate its inward edge distance from the coverage of one
// circular sample ring. Thirty-two evenly spaced taps cost roughly the same as
// the old three 8-direction erosions, but produce one continuous smoothstep
// instead of three visible opacity bands.
float alphaEdgeDistance(vec2 uv, float radiusPixels) {
  vec2 px = radiusPixels / max(resolution, vec2(1.0));
  float alphaSum = 0.0;
  alphaSum += alphaPairAtRadius(uv, px, vec2(1.00000000, 0.00000000));
  alphaSum += alphaPairAtRadius(uv, px, vec2(0.98078528, 0.19509032));
  alphaSum += alphaPairAtRadius(uv, px, vec2(0.92387953, 0.38268343));
  alphaSum += alphaPairAtRadius(uv, px, vec2(0.83146961, 0.55557023));
  alphaSum += alphaPairAtRadius(uv, px, vec2(0.70710678, 0.70710678));
  alphaSum += alphaPairAtRadius(uv, px, vec2(0.55557023, 0.83146961));
  alphaSum += alphaPairAtRadius(uv, px, vec2(0.38268343, 0.92387953));
  alphaSum += alphaPairAtRadius(uv, px, vec2(0.19509032, 0.98078528));
  alphaSum += alphaPairAtRadius(uv, px, vec2(0.00000000, 1.00000000));
  alphaSum += alphaPairAtRadius(uv, px, vec2(-0.19509032, 0.98078528));
  alphaSum += alphaPairAtRadius(uv, px, vec2(-0.38268343, 0.92387953));
  alphaSum += alphaPairAtRadius(uv, px, vec2(-0.55557023, 0.83146961));
  alphaSum += alphaPairAtRadius(uv, px, vec2(-0.70710678, 0.70710678));
  alphaSum += alphaPairAtRadius(uv, px, vec2(-0.83146961, 0.55557023));
  alphaSum += alphaPairAtRadius(uv, px, vec2(-0.92387953, 0.38268343));
  alphaSum += alphaPairAtRadius(uv, px, vec2(-0.98078528, 0.19509032));
  float ringCoverage = clamp(alphaSum / 32.0, 0.5, 1.0);
  return radiusPixels * cos(
    VJ1_ALPHA_FEATHER_PI * (1.0 - ringCoverage)
  );
}

vec4 runEffect(vec2 uv, vec4 color) {
  float cutRadius = max(0.0, cut);
  float featherRadius = max(0.0, feather);
  if (cutRadius <= 0.001 && featherRadius <= 0.001) return color;

  float featheredAlpha;
  if (featherRadius > 0.001) {
    float outerRadius = cutRadius + featherRadius;
    float edgeDistance = alphaEdgeDistance(uv, outerRadius);
    float edgeMask = smoothstep(cutRadius, outerRadius, edgeDistance);
    featheredAlpha = color.a * edgeMask;
  } else {
    featheredAlpha = erodedAlpha8(uv, cutRadius);
  }
  float outputAlpha = mix(color.a, featheredAlpha, amount);
  float alphaScale = color.a > 0.00001 ? outputAlpha / color.a : 0.0;
  return vec4(color.rgb * alphaScale, outputAlpha);
}`,
  });

export const VisualComponent = defineEffectNode(manifest);
export default VisualComponent;
