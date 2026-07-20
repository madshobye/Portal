import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createRangePairParams } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, animatedSeedRuntime, noiseSeedParams } from "../../shared/shader-component-common.js";
import { defineEffectNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "heartbeatPulse",
    name: "Heartbeat Pulse",
    category: "warp",
    spatial: true,
    transformSource: false,
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 0.45 }),
      createNumberParam("rate", "Rate", { min: 0.2, max: 3, step: 0.01, defaultValue: 1 }),
      createNumberParam("ringWidth", "Ring width", { min: 0.04, max: 0.45, step: 0.01, defaultValue: 0.18 }),
      createNumberParam("spread", "Spread", { min: 0.4, max: 2.2, step: 0.01, defaultValue: 1 }),
    ],
    code: `
float beatImpulse(float beatTime, float center, float width, float strength) {
  float d = abs(beatTime - center);
  return exp(-(d * d) / max(width * width, 0.0001)) * strength;
}

vec4 runEffect(vec2 uv, vec4 color) {
  vec2 aspect = vec2(resolution.x / max(resolution.y, 1.0), 1.0);
  vec2 screenUv = effectScreenUv();
  vec2 center = vec2(0.5) + effectTransform.xy * 0.5;
  float fieldScale = max(effectTransform.z, 0.0001);
  vec2 p = (screenUv - center) * aspect / fieldScale;
  float radius = length(p);
  vec2 dir = radius > 0.0001 ? p / radius : vec2(0.0);

  float cycleDuration = 1.0 / max(rate, 0.001);
  float beatTime = mod(time, cycleDuration);
  float beat = beatImpulse(beatTime, 0.08, 0.035, 1.0) +
    beatImpulse(beatTime, 0.27, 0.050, 0.62);
  float after = exp(-beatTime * 3.2) * 0.18;
  float pulse = beat + after;

  float ringPhase = radius * mix(3.2, 1.05, clamp(spread, 0.0, 2.2) / 2.2) - beatTime * 1.75;
  float ring = exp(-(ringPhase * ringPhase) / max(ringWidth * ringWidth, 0.0001));
  if (renderQuality > 0.65) {
    float detailPhase = ringPhase * 1.8 + beatTime * 2.4;
    ring += exp(-(detailPhase * detailPhase) / max(ringWidth * ringWidth * 0.55, 0.0001))
      * mix(0.0, 0.28, (renderQuality - 0.65) / 0.35);
  }
  float falloff = smoothstep(1.35, 0.02, radius);
  float displacement = amount * pulse * ring * falloff * 0.055;
  vec2 warped = screenUv + (dir * displacement * fieldScale) / aspect;
  return sampleSource(textureUvFromEffectScreenUv(warped));
}`,
  });

export const VisualComponent = defineEffectNode(manifest);
export default VisualComponent;
