import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createTextParam } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "eyeball",
    name: "3D Eyeball",
    category: "character",
    runtime: {
      timeDependent: (params = {}) =>
        (Number(params.gazeRange) || 0) > 0.0001 ||
        (Number(params.blinkRate) || 0) > 0.0001,
    },
    params: [
      createNumberParam("irisSize", "Iris size", { min: 0.5, max: 1.6, step: 0.01, defaultValue: 1 }),
      createNumberParam("pupilSize", "Pupil size", { min: 0.5, max: 1.8, step: 0.01, defaultValue: 1 }),
      createNumberParam("gazeRange", "Gaze range", { min: 0, max: 1.5, step: 0.01, defaultValue: 1 }),
      createNumberParam("motionSpeed", "Motion speed", { min: 0, max: 3, step: 0.01, defaultValue: 1 }),
      createNumberParam("pauseAmount", "Pause", { min: 0, max: 1, step: 0.01, defaultValue: 0.82 }),
      createNumberParam("jitter", "Jitter", { min: 0, max: 1, step: 0.01, defaultValue: 0.35 }),
      createNumberParam("blinkRate", "Blink rate", { min: 0, max: 3, step: 0.01, defaultValue: 1 }),
      createNumberParam("lidAmount", "Lid amount", { min: 0, max: 1.5, step: 0.01, defaultValue: 1 }),
      createNumberParam("veinAmount", "Veins", { min: 0, max: 1, step: 0.01, defaultValue: 0.6 }),
    ],
  });

const shader = Object.freeze({
    id: "generator.eyeball",
    name: "3D Eyeball Generator",
    type: "fragment",
    code: `
precision mediump float;
uniform vec2 resolution;
uniform float irisSize;
uniform float pupilSize;
uniform float lidAmount;
uniform float veinAmount;
uniform vec3 eyeGazeDir;
uniform vec3 eyeIrisRight;
uniform vec3 eyeIrisUp;
uniform float eyeBlink;
varying vec2 vTexCoord;

void main() {
  vec2 uv = vTexCoord;
  vec2 aspect = vec2(resolution.x / max(resolution.y, 1.0), 1.0);
  vec2 p = (uv - 0.5) * vec2(aspect.x, 1.0) * 2.2;
  float r = length(p);
  float sphere = smoothstep(1.02, 0.98, r);
  if (sphere <= 0.001) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec2 sphereP = p / max(1.0, r);
  float z = sqrt(max(0.0, 1.0 - dot(sphereP, sphereP)));
  vec3 normal = vec3(sphereP, z);
  const vec3 light = vec3(-0.413594, -0.570912, 0.708902);
  float diffuse = clamp(dot(normal, light) * 0.5 + 0.5, 0.0, 1.0);
  float limbShade = smoothstep(0.02, 0.82, z);
  vec3 sclera = mix(vec3(0.44, 0.42, 0.39), vec3(1.0, 0.96, 0.86), diffuse);
  sclera *= mix(0.50, 1.08, limbShade);
  float facing = max(0.001, dot(normal, eyeGazeDir));
  vec2 surfaceUv = vec2(dot(normal, eyeIrisRight), dot(normal, eyeIrisUp));
  if (veinAmount > 0.001) {
    float veinWave = sin((surfaceUv.x * 5.4 + sin(surfaceUv.y * 8.0) * 0.18) * 8.5);
    float veins = smoothstep(0.985, 1.0, veinWave) * smoothstep(0.18, 0.92, r) * smoothstep(0.92, 0.42, r);
    sclera = mix(sclera, vec3(0.55, 0.16, 0.13), veins * 0.13 * veinAmount);
  }
  vec2 irisUv = surfaceUv / facing;
  irisUv.y *= 1.08;
  float irisR = length(irisUv);
  float onCornea = smoothstep(0.80, 0.90, facing);
  float irisScale = max(0.05, irisSize);
  float pupilScale = max(0.05, pupilSize);
  float irisMask = smoothstep(0.850 * irisScale, 0.756 * irisScale, irisR) * onCornea * sphere;
  float pupilMask = smoothstep(0.252 * pupilScale, 0.190 * pupilScale, irisR) * onCornea * sphere;
  vec3 color = sclera;
  if (irisMask > 0.001) {
    float irisUnit = irisR / irisScale;
    float angleWave = sin((irisUv.x * 0.87 + irisUv.y * 1.13) * 48.0 + floor(irisUnit * 22.0) * 1.73);
    float fibers = angleWave * 0.5 + 0.5;
    float radial = smoothstep(0.806, 0.101, irisUnit);
    float limbus = smoothstep(0.850, 0.720, irisUnit) - smoothstep(0.655, 0.569, irisUnit);
    float innerRing = smoothstep(0.418, 0.310, irisUnit) - smoothstep(0.238, 0.170, irisUnit);
    vec3 iris = mix(vec3(0.045, 0.12, 0.14), vec3(0.12, 0.66, 0.58), radial);
    iris += vec3(0.75, 0.54, 0.28) * innerRing * 0.35;
    iris += vec3(0.95, 0.85, 0.48) * fibers * radial * 0.10;
    iris = mix(iris, vec3(0.01, 0.025, 0.025), limbus * 0.78);
    iris *= mix(0.62, 1.12, diffuse);
    color = mix(color, iris, irisMask);
  }
  color = mix(color, vec3(0.005, 0.003, 0.002), pupilMask);
  float wetBase = max(-light.z + 2.0 * dot(normal, light) * normal.z, 0.0);
  float wet2 = wetBase * wetBase;
  float wet4 = wet2 * wet2;
  float wet8 = wet4 * wet4;
  float wet16 = wet8 * wet8;
  float wet = wet16 * wet16 * wet2;
  vec2 glintDelta = p - vec2(-0.32, -0.30);
  float corneaGlint = 1.0 - smoothstep(0.0, 0.0049, dot(glintDelta, glintDelta));
  color += vec3(1.0) * (wet * 0.42 + corneaGlint * 0.55);

  if (eyeBlink > 0.02) {
    float blinkMask = smoothstep(0.02, 0.16, eyeBlink);
    float lidCurve = (1.0 - p.x * p.x) * 0.12;
    float lidSoftness = mix(0.024, 0.052, clamp(lidAmount / 1.5, 0.0, 1.0));
    float openHalf = mix(1.08, -0.12, clamp(eyeBlink, 0.0, 1.0));
    float upperLid = -openHalf - lidCurve;
    float lowerLid = openHalf + lidCurve * 0.72;
    float lidTop = 1.0 - smoothstep(upperLid - lidSoftness, upperLid + lidSoftness, p.y);
    float lidBottom = smoothstep(lowerLid - lidSoftness, lowerLid + lidSoftness, p.y);
    float lid = max(lidTop, lidBottom) * sphere * blinkMask;
    vec3 lidColor = mix(vec3(0.18, 0.08, 0.065), vec3(0.48, 0.21, 0.18), diffuse);
    color = mix(color, lidColor, lid);
  }

  float edge = smoothstep(1.0, 0.985, r);
  float alpha = sphere * edge;
  gl_FragColor = vec4(clamp(color, 0.0, 1.0) * alpha, alpha);
}`,
  });

export const VisualComponent = defineGeneratorNode(manifest, shader);
export default VisualComponent;
