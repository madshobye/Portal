import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createTextParam } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "cherenkovVolume",
    name: "Cherenkov Volume",
    category: "shadertoy",
    runtime: timeParamRuntime("speed"),
    params: [
      createNumberParam("speed", "Speed", { min: 0, max: 3, step: 0.01, defaultValue: 1 }),
      createNumberParam("raySteps", "Ray steps", {
        min: 24, max: 199, step: 1, defaultValue: 96,
        renderQualityScaling: { minimum: 0.35, maximum: 1.5 },
      }),
      createNumberParam("zoom", "Zoom", { min: 0.1, max: 1.5, step: 0.01, defaultValue: 0.4, scale: "log" }),
      createNumberParam("rotationSpeed", "Rotation", { min: -0.5, max: 0.5, step: 0.001, defaultValue: 0.111 }),
      createNumberParam("verticalOffset", "Vertical offset", { min: -4, max: 6, step: 0.01, defaultValue: 2 }),
      createNumberParam("patternScale", "Pattern scale", { min: 0.2, max: 4, step: 0.01, defaultValue: 1, scale: "log" }),
      createNumberParam("emissionStrength", "Emission", { min: 0, max: 5, step: 0.01, defaultValue: 1 }),
      createNumberParam("absorption", "Absorption", { min: 0.1, max: 4, step: 0.01, defaultValue: 1, scale: "log" }),
      createNumberParam("brightness", "Brightness", { min: 0, max: 5, step: 0.01, defaultValue: 1 }),
      createColorParam("farColor", "Far color", "#3939ffff"),
      createColorParam("nearColor", "Near color", "#cca6ffff"),
      createColorParam("backgroundColor", "Background color", "#00000000"),
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 1 }),
    ],
  });

const shader = Object.freeze({
    id: "generator.cherenkovVolume",
    name: "Cherenkov Volume Generator",
    type: "shadertoy",
    code: `
/*
 * Created by carandiru / supersinfulsilicon
 * Creative Commons Attribution-ShareAlike 4.0 International License.
 * Original shader: https://www.shadertoy.com/view/l3yBzV
 * Based on: https://www.shadertoy.com/view/tsdfDf
 * Permissions beyond the license: http://bit.ly/supersinfulsilicon
 */

uniform float raySteps;
uniform float zoom;
uniform float rotationSpeed;
uniform float verticalOffset;
uniform float patternScale;
uniform float emissionStrength;
uniform float absorption;
uniform float brightness;
uniform vec4 farColor;
uniform vec4 nearColor;
uniform vec4 backgroundColor;
uniform float amount;

const float CHERENKOV_PI = 3.141592653589793;
const float CHERENKOV_EPSILON = 0.0000001;
const float CHERENKOV_MIN_STEP = 0.00005;

float cherenkovTime;
vec3 cherenkovEye;

vec2 cherenkovIntersectBox(vec3 origin, vec3 direction) {
  vec3 inverseDirection = 1.0 / direction;
  vec3 nearPlane = (vec3(-1.0) - origin) * inverseDirection;
  vec3 farPlane = (vec3(1.0) - origin) * inverseDirection;
  vec3 tmin = min(nearPlane, farPlane);
  vec3 tmax = max(nearPlane, farPlane);
  return vec2(max(tmin.x, max(tmin.y, tmin.z)), min(tmax.x, min(tmax.y, tmax.z)));
}

vec3 cherenkovRotate(vec3 p, float angle) {
  vec2 orientation = vec2(cos(angle), sin(angle));
  return vec3(
    p.x * orientation.x - p.y * orientation.y,
    p.x * orientation.y + p.y * orientation.x,
    p.z
  );
}

float cherenkovDistance(vec3 uv) {
  float safeZ = uv.z >= 0.0 ? max(uv.z, 0.0001) : min(uv.z, -0.0001);
  vec2 x0 = uv.xy * (0.25 * CHERENKOV_PI * patternScale) / safeZ;
  vec2 c = fract(x0 - cherenkovTime);
  vec4 y0;
  y0.xy = abs(c * 2.0 - 1.0);
  y0.zw = y0.xy / (0.5 + pow((2.0 * CHERENKOV_PI) - uv.x, 2.0));
  vec2 j = abs(vec2(sin(cherenkovTime), cos(cherenkovTime)));
  vec4 a = vec4(j.y + y0.xy * j.x, -j.x + y0.xy * j.y) * uv.z;
  vec4 b = vec4(j.y + y0.zw * j.x, -j.x + y0.zw * j.y) * uv.z;
  vec2 y1 = (b.xy - a.zw) + (b.zw - a.xy);
  return length(y1 - y0.xy) - length(y1 - y0.zw);
}

vec3 cherenkovNormal(vec3 p, float dt, float centerDistance) {
  // Forward differences reuse the center sample: four field evaluations per
  // ray step instead of the original seven central-difference evaluations.
  vec3 gradient = vec3(
    cherenkovDistance(p + vec3(dt, 0.0, 0.0)) - centerDistance,
    cherenkovDistance(p + vec3(0.0, dt, 0.0)) - centerDistance,
    cherenkovDistance(p + vec3(0.0, 0.0, dt)) - centerDistance
  );
  return -normalize(gradient + CHERENKOV_EPSILON);
}

vec3 cherenkovCamera(vec3 v) {
  v.y -= verticalOffset;
  vec3 iso = vec3(v.x - v.y - v.z, -v.x - v.y - v.z, v.y - v.z);
  float angle = cherenkovTime * rotationSpeed;
  vec3 eyePosition = vec3(-120.0, -120.0, -84.851589) * 0.1 * zoom;
  cherenkovEye = cherenkovRotate(eyePosition, angle);
  return cherenkovRotate(iso, angle) * eyePosition;
}

float cherenkovRadiation(out float blueEmission, float height, float dt) {
  const float lightSpeed = 299792458.0;
  const float refractiveIndex = 1.33;
  const float totalEnergy = 1000000.0;
  const float particleEnergy = 24000.0;
  float velocity = lightSpeed / refractiveIndex;
  velocity = min(velocity + height * velocity * dt, lightSpeed);
  blueEmission = 1.0 / (refractiveIndex * (velocity / lightSpeed));
  float numerator = particleEnergy * particleEnergy
    * (refractiveIndex * refractiveIndex * velocity * velocity - lightSpeed * lightSpeed);
  float denominator = 4.0 * totalEnergy * CHERENKOV_PI
    * refractiveIndex * refractiveIndex * velocity * velocity;
  return numerator / max(denominator, CHERENKOV_EPSILON);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  cherenkovTime = iTime;
  vec2 uv = fragCoord / iResolution.xy;
  vec2 view = uv * 2.0 - 1.0;
  vec3 rayOrigin = cherenkovCamera(vec3(view, 1.0));
  vec3 rayDirection = normalize(-rayOrigin);
  vec2 hit = cherenkovIntersectBox(rayOrigin, rayDirection);
  if (hit.x > hit.y) {
    fragColor = vec4(backgroundColor.rgb, backgroundColor.a * amount);
    return;
  }

  hit.x = max(hit.x, 0.0);
  float intervalLength = hit.y - hit.x;
  float stepCount = max(raySteps, 1.0);
  float inverseSteps = 1.0 / length(stepCount * abs(rayDirection));
  float dt = max(CHERENKOV_MIN_STEP, intervalLength * inverseSteps);
  vec3 p = cherenkovEye + hit.x * rayDirection + 0.25 * rayDirection * dt;
  vec3 accumulatedLight = vec3(0.0);
  float transmittance = 1.0;
  float intervalRemaining = intervalLength;

  for (int i = 0; i < 199; i++) {
    if (float(i) >= raySteps || intervalRemaining < 0.0 || transmittance < 0.1) break;
    float distanceField = cherenkovDistance(p);
    vec3 normal = cherenkovNormal(p, dt, distanceField);
    float wave = distanceField + 0.5;
    float emitted = 0.0;
    float radiation = cherenkovRadiation(emitted, -distanceField, dt);
    float fresnel = pow(1.0 - max(0.0, dot(rayDirection, normal)), 5.0);
    vec3 radiationColor = mix(farColor.rgb, nearColor.rgb, fresnel);
    vec3 lightColor = radiationColor * emitted * radiation * emissionStrength;
    float scattering = wave;
    float extinction = max(CHERENKOV_EPSILON, scattering * absorption);
    float sigmaDt = exp2(extinction * sqrt(stepCount) * dt * -2.0);
    vec3 incoming = lightColor * scattering;
    vec3 integrated = (incoming - incoming * sigmaDt) / extinction;
    accumulatedLight += transmittance * integrated;
    transmittance *= sigmaDt;
    p += dt * rayDirection;
    intervalRemaining -= dt;
  }

  float volumeAlpha = pow(clamp(1.0 - transmittance, 0.0, 1.0), 2.0);
  vec3 volumeColor = accumulatedLight * (1.0 - transmittance) * brightness;
  vec3 color = mix(backgroundColor.rgb, volumeColor, volumeAlpha);
  float alpha = mix(backgroundColor.a, 1.0, volumeAlpha) * amount;
  fragColor = vec4(max(color, vec3(0.0)), alpha);
}
`,
  });

export const VisualComponent = defineGeneratorNode(manifest, shader);
export default VisualComponent;
