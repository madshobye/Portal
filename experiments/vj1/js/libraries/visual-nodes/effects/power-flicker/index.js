import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createRangePairParams } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, animatedSeedRuntime, noiseSeedParams } from "../../shared/shader-component-common.js";
import { defineEffectNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "powerFlicker",
    name: "Power Flicker",
    category: "motion",
    runtime: animatedSeedRuntime({
      active: (params = {}) => (
        (Number(params.amount) || 0) > 0.0001 &&
        Math.abs(Number(params.speed) || 0) > 0.0001
      ),
    }),
    primaryParamIds: ["amount", "speed", "threshold", "offLevel", "brightness", "coldWash"],
    detailParamIds: ["chatter", "lightColor", "seedMode", "renderQuality"],
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 1 }),
      createNumberParam("speed", "Flicker speed", { min: 0.05, max: 16, step: 0.01, defaultValue: 4.2, scale: "log" }),
      createNumberParam("threshold", "Flicker threshold", { min: 0.05, max: 0.95, step: 0.01, defaultValue: 0.38 }),
      createNumberParam("offLevel", "Off light", { min: 0, max: 0.5, step: 0.01, defaultValue: 0.025 }),
      createNumberParam("brightness", "On brightness", { min: 0.5, max: 4, step: 0.01, defaultValue: 1.85, scale: "log" }),
      createNumberParam("coldWash", "White wash", { min: 0, max: 1, step: 0.01, defaultValue: 0.72 }),
      createNumberParam("chatter", "Electrical chatter", { min: 0, max: 1, step: 0.01, defaultValue: 0.68 }),
      createColorParam("lightColor", "Light color", "#e8f4ffff"),
      ...noiseSeedParams(97),
    ],
    code: `
float powerFlickerNoise(float coordinate, float seedValue) {
  float cell = floor(coordinate);
  float local = fract(coordinate);
  float blend = local * local * (3.0 - 2.0 * local);
  float a = hash(vec2(cell, seedValue));
  float b = hash(vec2(cell + 1.0, seedValue));
  return mix(a, b, blend);
}

vec4 runEffect(vec2 uv, vec4 color) {
  if (amount <= 0.0001) return color;

  float seedValue = seed * 0.071 + 11.3;
  float clock = seedMode < 0.5 ? time * speed : seed * 0.173;
  float slowSupply = powerFlickerNoise(clock * 0.23 + seedValue, seedValue);
  float badBallast = powerFlickerNoise(clock * 0.79 - seedValue, seedValue + 29.1);
  float supply = mix(slowSupply, badBallast, 0.42);
  float powered = step(threshold, supply);

  float nearFailure = 1.0 - step(0.18, abs(supply - threshold));
  float chatterClock = floor(clock * mix(4.0, 18.0, chatter));
  float chatterBit = step(0.5, hash(vec2(chatterClock, seedValue + 73.7)));
  float chatterGate = nearFailure * chatter;
  powered = mix(powered, chatterBit, chatterGate);

  float alpha = color.a;
  vec3 straight = alpha > 0.0001 ? color.rgb / alpha : vec3(0.0);
  float luma = dot(max(straight, vec3(0.0)), vec3(0.2126, 0.7152, 0.0722));
  vec3 washed = mix(straight, lightColor.rgb * max(luma, 0.08), coldWash);
  vec3 onColor = washed * brightness;
  vec3 offColor = straight * offLevel;
  vec3 flickered = mix(offColor, onColor, powered) * alpha;
  return mix(color, vec4(flickered, alpha), amount);
}`,
  });

export const VisualComponent = defineEffectNode(manifest);
export default VisualComponent;
