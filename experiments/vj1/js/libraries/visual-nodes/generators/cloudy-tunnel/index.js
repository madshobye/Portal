import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createTextParam } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "cloudyTunnel",
    name: "Cloudy Tunnel",
    category: "shadertoy",
    runtime: timeParamRuntime("speed"),
    params: [
      createNumberParam("speed", "Speed", { min: 0, max: 3, step: 0.01, defaultValue: 1 }),
      createNumberParam("raySteps", "Ray steps", {
        min: 24, max: 160, step: 1, defaultValue: 72,
        renderQualityScaling: { minimum: 0.35, maximum: 1.5 },
      }),
      createNumberParam("cloudDensity", "Cloud density", { min: 0.2, max: 2.5, step: 0.01, defaultValue: 0.8 }),
      createNumberParam("cloudScale", "Cloud scale", { min: 0.2, max: 3, step: 0.01, defaultValue: 1, scale: "log" }),
      createNumberParam("cloudDetail", "Cloud detail", {
        min: 1, max: 3, step: 1, defaultValue: 2,
        renderQualityScaling: { minimum: 0.5, maximum: 1.25 },
      }),
      createNumberParam("tunnelRadius", "Tunnel radius", { min: 1.5, max: 10, step: 0.01, defaultValue: 4.4 }),
      createNumberParam("tunnelSpread", "Tunnel spread", { min: 0.5, max: 6, step: 0.01, defaultValue: 3.7 }),
      createNumberParam("pathBend", "Path bend", { min: 0, max: 14, step: 0.01, defaultValue: 6.2 }),
      createNumberParam("pathFrequency", "Path frequency", { min: 0.02, max: 1.2, step: 0.01, defaultValue: 0.33, scale: "log" }),
      createNumberParam("cameraSway", "Camera sway", { min: 0, max: 2, step: 0.01, defaultValue: 1 }),
      createNumberParam("fieldOfView", "Field of view", { min: 0.5, max: 5, step: 0.01, defaultValue: 3 }),
      createNumberParam("fogStrength", "Fog", { min: 0, max: 0.01, step: 0.0001, defaultValue: 0.001, scale: "log" }),
      createNumberParam("vignette", "Vignette", { min: 0, max: 1, step: 0.01, defaultValue: 1 }),
      createColorParam("tunnelColor", "Tunnel color", "#002652ff"),
      createColorParam("fogColor", "Fog color", "#002685ff"),
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 1 }),
    ],
  });

const shader = Object.freeze({
    id: "generator.cloudyTunnel",
    name: "Cloudy Tunnel Generator",
    type: "shadertoy",
    code: `
/*
 * Created by Stephane Cuillerdier - Aiekick/2015
 * Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported License.
 * Original shader: https://www.shadertoy.com/view/XlSSzV
 * Cloud technique derived from Duke: https://www.shadertoy.com/view/MljXDw
 * The iChannel0 noise texture is replaced by procedural value noise so this
 * generator remains self-contained in Portal.
 */

uniform float raySteps;
uniform float cloudDensity;
uniform float cloudScale;
uniform float cloudDetail;
uniform float tunnelRadius;
uniform float tunnelSpread;
uniform float pathBend;
uniform float pathFrequency;
uniform float cameraSway;
uniform float fieldOfView;
uniform float fogStrength;
uniform float vignette;
uniform vec4 tunnelColor;
uniform vec4 fogColor;
uniform float amount;

float tunnelTime;

float tunnelHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float tunnelNoise(vec3 x) {
  vec3 cell = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = tunnelHash(cell + vec3(0.0, 0.0, 0.0));
  float n100 = tunnelHash(cell + vec3(1.0, 0.0, 0.0));
  float n010 = tunnelHash(cell + vec3(0.0, 1.0, 0.0));
  float n110 = tunnelHash(cell + vec3(1.0, 1.0, 0.0));
  float n001 = tunnelHash(cell + vec3(0.0, 0.0, 1.0));
  float n101 = tunnelHash(cell + vec3(1.0, 0.0, 1.0));
  float n011 = tunnelHash(cell + vec3(0.0, 1.0, 1.0));
  float n111 = tunnelHash(cell + vec3(1.0, 1.0, 1.0));
  return -1.0 + 2.4 * mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z
  );
}

float tunnelFbm(vec3 p) {
  p += tunnelTime * 5.0;
  float n = tunnelNoise(p * 0.02 * cloudScale) * 1.98;
  if (cloudDetail > 1.5) n += tunnelNoise(p * 0.045 * cloudScale) * 0.62;
  if (cloudDetail > 2.5) n += tunnelNoise(p * 0.09 * cloudScale) * 0.39;
  return n;
}

vec2 tunnelCylinder(vec3 p, vec2 position, float radius, vec3 cosinePath, vec3 sinePath) {
  float cx = cosinePath.x * cos(p.z * cosinePath.y + cosinePath.z);
  float sy = sinePath.x * sin(p.z * sinePath.y + sinePath.z);
  return p.xy - position - vec2(cx, sy);
}

float tunnelMap(vec3 p) {
  float cloud = tunnelFbm(p * 13.0) * cloudDensity;
  float path = pathBend * sin(p.z * pathFrequency);
  float field = 0.0;
  vec2 previousCylinder = vec2(0.0);
  for (int i = 0; i < 6; i++) {
    float index = float(i);
    float x = index;
    float y = 0.88 + 0.0102 * index;
    float z = -0.02 - 0.16 * index;
    float radius = tunnelRadius + 2.45 * index;
    vec2 cylinder = tunnelCylinder(
      p,
      vec2(path, tunnelSpread * index),
      radius,
      vec3(x, y, z),
      vec3(z, x, y)
    );
    if (i > 0) {
      // The source shader builds each section from the current and previous
      // cylinder, with the final pair defining the tunnel field. Treating all
      // six as one union creates the hard four-quadrant pattern.
      field = radius - min(length(cylinder), length(previousCylinder));
    }
    previousCylinder = cylinder;
  }
  return min(field + cloud, p.y + cloud);
}

vec3 tunnelCamera(vec2 uv, vec3 origin, vec3 target) {
  vec3 forward = normalize(target - origin);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), forward));
  vec3 up = normalize(cross(forward, right));
  return normalize(forward + fieldOfView * right * uv.x + fieldOfView * up * uv.y);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  tunnelTime = iTime * 2.5;
  vec2 size = iResolution.xy;
  vec2 uv = (2.0 * fragCoord - size) / min(size.x, size.y);
  vec3 origin = vec3(
    sin(tunnelTime * 0.5) * 5.0 * cameraSway,
    sin(tunnelTime * 0.2) * 15.0 * cameraSway + 15.0,
    tunnelTime * 5.0
  );
  vec3 ray = tunnelCamera(uv, origin, origin + vec3(0.0, 0.0, 1.0));
  vec3 p = origin;
  vec3 color = tunnelColor.rgb;
  float stepSize = 1.0;
  float opticalDepth = 0.0;
  float distanceTravelled = 1.0;
  float divisor = 0.0;

  for (int i = 0; i < 160; i++) {
    if (float(i) >= raySteps || stepSize < 0.01 || distanceTravelled > 500.0 || opticalDepth > 0.95) break;
    stepSize = tunnelMap(p) * (stepSize > 0.001 ? 0.03 : 0.2);
    if (stepSize < 0.15) {
      float weight = (1.0 - opticalDepth) * (0.15 - stepSize) * float(i) / max(raySteps, 1.0);
      color += vec3(weight);
      opticalDepth += weight;
    }
    divisor += 0.012;
    opticalDepth += 0.005;
    stepSize = max(stepSize, 0.05);
    distanceTravelled += stepSize;
    p = origin + ray * distanceTravelled;
  }

  float fogMix = 1.0 - exp(-fogStrength * distanceTravelled * distanceTravelled);
  color = mix(color, fogColor.rgb, fogMix) / max(divisor, 0.15);
  vec2 q = fragCoord / size;
  float edge = pow(max(16.0 * q.x * q.y * (1.0 - q.x) * (1.0 - q.y), 0.0), 0.25);
  color *= mix(1.0, 0.5 + 0.5 * edge, vignette);
  float alpha = mix(tunnelColor.a, fogColor.a, fogMix) * amount;
  fragColor = vec4(max(color, vec3(0.0)), alpha);
}
`,
  });

export const VisualComponent = defineGeneratorNode(manifest, shader);
export default VisualComponent;
