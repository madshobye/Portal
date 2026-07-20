import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createTextParam } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "lightning",
    name: "Lightning",
    category: "shadertoy",
    runtime: timeParamRuntime("speed"),
    primaryParamIds: ["frequency", "duration", "boltWidth", "glow", "brightness", "strikeColor"],
    detailParamIds: ["speed", "jaggedness", "positionSpread", "boltLength", "glare", "seed", "amount"],
    params: [
      createNumberParam("speed", "Speed", { min: 0, max: 4, step: 0.01, defaultValue: 1 }),
      createNumberParam("frequency", "Strike frequency", { min: 0, max: 1, step: 0.01, defaultValue: 0.6 }),
      createNumberParam("duration", "Strike duration", { min: 0.04, max: 1.5, step: 0.01, defaultValue: 0.25, scale: "log" }),
      createNumberParam("boltWidth", "Bolt width", { min: 0.001, max: 0.08, step: 0.001, defaultValue: 0.01, scale: "log" }),
      createNumberParam("jaggedness", "Jaggedness", { min: 0, max: 1.5, step: 0.01, defaultValue: 0.4 }),
      createNumberParam("positionSpread", "Position spread", { min: 0, max: 1.5, step: 0.01, defaultValue: 1 }),
      createNumberParam("boltLength", "Bolt length", { min: 0.1, max: 1, step: 0.01, defaultValue: 0.82 }),
      createNumberParam("glow", "Glow", { min: 0, max: 3, step: 0.01, defaultValue: 1 }),
      createNumberParam("glare", "Flash glare", { min: 0, max: 2, step: 0.01, defaultValue: 1 }),
      createNumberParam("brightness", "Brightness", { min: 0, max: 6, step: 0.01, defaultValue: 2 }),
      createNumberParam("seed", "Seed", { min: 0, max: 1000, step: 1, defaultValue: 0 }),
      createColorParam("strikeColor", "Strike color", "#dceaffff"),
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 1 }),
    ],
  });

const shader = Object.freeze({
    id: "generator.lightning",
    name: "Lightning Generator",
    type: "shadertoy",
    code: `
/*
 * Adapted from https://www.shadertoy.com/view/fsdGWf
 * The landscape, clouds, and opaque background have been removed. The strike,
 * glow, and brief illumination remain as a premultiplied transparent layer.
 */

uniform float frequency;
uniform float duration;
uniform float boltWidth;
uniform float jaggedness;
uniform float positionSpread;
uniform float boltLength;
uniform float glow;
uniform float glare;
uniform float brightness;
uniform float seed;
uniform vec4 strikeColor;
uniform float amount;

float lightningRand(float x) {
  return fract(sin(x + seed * 17.173) * 75154.32912);
}

float lightningNoise(float x) {
  float index = floor(x);
  float phase = fract(x);
  return mix(lightningRand(index), lightningRand(index + 1.0), phase);
}

float lightningPerlin(float x) {
  float result = 0.0;
  float scale = 1.0;
  float weight = 1.0;
  for (int octave = 0; octave < 6; octave++) {
    scale *= 2.0;
    weight *= 0.5;
    result += weight * lightningNoise(scale * x);
  }
  return result;
}

float lightningPath(float y) {
  return jaggedness * (lightningPerlin(2.0 * y) - 0.5);
}

float lightningPlot(vec2 point, float width, bool thickenTurns) {
  float adjustedWidth = width;
  if (thickenTurns) {
    adjustedWidth += 5.0 * abs(lightningPath(point.y + 0.001) - lightningPath(point.y));
  }
  return smoothstep(adjustedWidth, 0.0, abs(lightningPath(point.y) - point.x));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  uv.x = (uv.x * 2.0 - 1.0) * iResolution.x / max(iResolution.y, 1.0);

  float cycleLength = max(duration, 0.001);
  float cycle = iTime / cycleLength + 0.1;
  float strikeIndex = floor(cycle);
  float phase = fract(cycle);
  float eventNoise = lightningNoise(strikeIndex);
  float threshold = 1.0 - clamp(frequency, 0.0, 1.0);
  float occurrence = step(threshold, eventNoise);
  float activeDuration = max(0.0, eventNoise - threshold) / max(frequency, 0.0001);
  float active = occurrence * (1.0 - step(activeDuration, phase));
  float flashActive = occurrence * (1.0 - step(0.1, phase));
  float position = (lightningNoise(strikeIndex + 10.0) - 0.5) * 2.0 * positionSpread;

  float strike = 0.0;
  float localGlow = 0.0;
  float wideGlow = 0.0;
  float flash = 0.0;
  if (active > 0.5) {
    vec2 boltUv = uv;
    boltUv.y += strikeIndex * 2.0;
    boltUv.x -= position;

    float width = max(boltWidth, 0.0001);
    strike = lightningPlot(boltUv, width, true);
    localGlow = lightningPlot(boltUv, width * 4.0, false) * glow;
    wideGlow = lightningPlot(boltUv, width * 150.0, false) * glow;

    float bottom = (1.0 - boltLength) * lightningNoise(strikeIndex + 5.0);
    float lengthMask = smoothstep(
      bottom,
      bottom + 0.05,
      uv.y + lightningPerlin(1.2 * uv.x + 4.0 * bottom) * 0.03
    );
    strike *= lengthMask;
    localGlow *= lengthMask;
    wideGlow *= lengthMask;

  }
  float horizontalLight = smoothstep(5.0, 0.0, abs(uv.x - position));
  flash = flashActive * horizontalLight * glare;

  float boltEnergy = strike * 0.4 + localGlow * 0.15 + wideGlow * 0.3;
  float energy = max(0.0, boltEnergy + flash) * brightness;
  float alpha = clamp(energy * strikeColor.a * amount, 0.0, 1.0);
  vec3 color = mix(strikeColor.rgb, vec3(1.0), clamp(strike * brightness * 0.35, 0.0, 1.0));
  fragColor = vec4(color * alpha, alpha);
}
`,
  });

export const VisualComponent = defineGeneratorNode(manifest, shader);
export default VisualComponent;
