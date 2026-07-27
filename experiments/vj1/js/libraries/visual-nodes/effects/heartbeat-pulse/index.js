import { createNumberParam } from "../../shared/component-schema.js";
import { defineEffectNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "heartbeatPulse",
    name: "Heartbeat Pulse",
    category: "warp",
    spatial: true,
    transformSource: false,
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 0.45 }),
      createNumberParam("pulse", "Pulse", {
        min: 0,
        max: 1,
        step: 0.01,
        defaultValue: 0,
        defaultAnimation: {
          id: "heartbeat-double-beat",
          version: 1,
          label: "Double heartbeat",
          transportKind: "envelope",
          from: 0,
          to: 1,
          combination: "replace",
          triggerKind: "periodic",
          triggerInterval: 1,
          envelopeInitial: 0,
          envelopeSegments: [
            { duration: 0.08, value: 1, curve: "quad-out" },
            { duration: 0.11, value: 0, curve: "quad-in" },
            { duration: 0.08, value: 0.62, curve: "quad-out" },
            { duration: 0.18, value: 0, curve: "quad-in" },
            { duration: 0.55, value: 0, curve: "linear" },
          ],
        },
      }),
      createNumberParam("ringWidth", "Ring width", { min: 0.04, max: 0.45, step: 0.01, defaultValue: 0.18 }),
      createNumberParam("spread", "Spread", { min: 0.4, max: 2.2, step: 0.01, defaultValue: 1 }),
    ],
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  vec2 aspect = vec2(resolution.x / max(resolution.y, 1.0), 1.0);
  vec2 screenUv = effectScreenUv();
  vec2 center = vec2(0.5) + effectTransform.xy * 0.5;
  float fieldScale = max(effectTransform.z, 0.0001);
  vec2 p = (screenUv - center) * aspect / fieldScale;
  float radius = length(p);
  vec2 dir = radius > 0.0001 ? p / radius : vec2(0.0);

  float beat = clamp(pulse, 0.0, 1.0);
  float ringPhase = radius * mix(3.2, 1.05, clamp(spread, 0.0, 2.2) / 2.2) - beat * 0.24;
  float ring = exp(-(ringPhase * ringPhase) / max(ringWidth * ringWidth, 0.0001));
  if (renderQuality > 0.65) {
    float detailPhase = ringPhase * 1.8 + beat * 0.32;
    ring += exp(-(detailPhase * detailPhase) / max(ringWidth * ringWidth * 0.55, 0.0001))
      * mix(0.0, 0.28, (renderQuality - 0.65) / 0.35);
  }
  float falloff = smoothstep(1.35, 0.02, radius);
  float displacement = amount * beat * ring * falloff * 0.055;
  vec2 warped = screenUv + (dir * displacement * fieldScale) / aspect;
  return sampleSource(textureUvFromEffectScreenUv(warped));
}`,
  });

export const VisualComponent = defineEffectNode(manifest);
export default VisualComponent;
