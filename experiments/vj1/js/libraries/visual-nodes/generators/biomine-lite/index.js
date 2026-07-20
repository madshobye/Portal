import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createTextParam } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "biomineLite",
    name: "Biomine Lite",
    category: "shadertoy",
    runtime: timeParamRuntime("speed"),
    params: [
      createNumberParam("speed", "Speed", { min: 0, max: 3, step: 0.01, defaultValue: 1 }),
      createNumberParam("raySteps", "Ray steps", { min: 12, max: 72, step: 1, defaultValue: 36 }),
      createNumberParam("viewDistance", "View distance", { min: 12, max: 60, step: 0.5, defaultValue: 40 }),
      createNumberParam("fieldOfView", "Field of view", { min: 0.5, max: 3, step: 0.01, defaultValue: 1.57 }),
      createNumberParam("pathAmount", "Path bend", { min: 0, max: 2.5, step: 0.01, defaultValue: 1 }),
      createNumberParam("organicMotion", "Organic motion", { min: 0, max: 2, step: 0.01, defaultValue: 1 }),
      createNumberParam("gyroidScale", "Gyroid scale", { min: 0.5, max: 3, step: 0.01, defaultValue: 1, scale: "log" }),
      createNumberParam("tubeThickness", "Tube thickness", { min: -0.5, max: 1.5, step: 0.01, defaultValue: 0.25 }),
      createNumberParam("tunnelRadius", "Tunnel radius", { min: 1.5, max: 6, step: 0.01, defaultValue: 3.25 }),
      createNumberParam("surfaceDetail", "Surface detail", { min: 0, max: 2, step: 1, defaultValue: 1 }),
      createNumberParam("specularStrength", "Highlights", { min: 0, max: 3, step: 0.01, defaultValue: 1 }),
      createNumberParam("fogStrength", "Fog", { min: 0, max: 3, step: 0.01, defaultValue: 1 }),
      createColorParam("tubeColor", "Tube color", "#5a4033ff"),
      createColorParam("wallColor", "Wall color", "#3d3d3dff"),
      createColorParam("glowColor", "Glow color", "#b3e6ffff"),
      createColorParam("skyColor", "Background color", "#ffe6ccff"),
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 1 }),
    ],
  });

const shader = Object.freeze({
    id: "generator.biomineLite",
    name: "Biomine Lite Generator",
    type: "shadertoy",
    code: `
/*
 * Biomine by Shane, adapted as a reduced-cost version for Portal.
 * Original shader and full description: https://www.shadertoy.com/view/4lyGzR
 * Related cellular work: https://www.shadertoy.com/view/4scXz2
 * The original is texture-free. This version retains the gyroid geometry while
 * replacing its costly bump, AO, thickness and environment passes with a
 * compact material approximation.
 */

uniform float raySteps;
uniform float viewDistance;
uniform float fieldOfView;
uniform float pathAmount;
uniform float organicMotion;
uniform float gyroidScale;
uniform float tubeThickness;
uniform float tunnelRadius;
uniform float surfaceDetail;
uniform float specularStrength;
uniform float fogStrength;
uniform vec4 tubeColor;
uniform vec4 wallColor;
uniform vec4 glowColor;
uniform vec4 skyColor;
uniform float amount;

float biomineObjectId = 0.0;

mat2 biomineRotation(float angle) {
  vec2 v = sin(vec2(1.570796, 0.0) + angle);
  return mat2(v, -v.y, v.x);
}

vec2 biominePath(float z) {
  float a = sin(z * 0.11);
  float b = cos(z * 0.14);
  return vec2(a * 4.0 - b * 1.5, b * 1.7 + a * 1.5) * pathAmount;
}

float biomineSmoothMaximum(float a, float b, float softness) {
  float h = clamp(0.5 + 0.5 * (a - b) / softness, 0.0, 1.0);
  return mix(b, a, h) + h * (1.0 - h) * softness;
}

float biomineSphereTile(vec3 p) {
  p = fract(p) - 0.5;
  return dot(p, p);
}

float biomineCellTile(vec3 p) {
  vec4 d;
  d.x = biomineSphereTile(p - vec3(0.81, 0.62, 0.53));
  p.xy = vec2(p.y - p.x, p.y + p.x) * 0.7071;
  d.y = biomineSphereTile(p - vec3(0.39, 0.20, 0.11));
  p.yz = vec2(p.z - p.y, p.z + p.y) * 0.7071;
  d.z = biomineSphereTile(p - vec3(0.62, 0.24, 0.06));
  p.xz = vec2(p.z - p.x, p.z + p.x) * 0.7071;
  d.w = biomineSphereTile(p - vec3(0.20, 0.82, 0.64));
  vec4 v;
  v.xy = min(d.xz, d.yw);
  v.z = min(max(d.x, d.y), max(d.z, d.w));
  v.w = max(v.x, v.y);
  return (min(v.z, v.w) - min(v.x, v.y)) * 2.66;
}

float biomineMap(vec3 p) {
  p.xy -= biominePath(p.z);
  p += cos(p.zxy * 1.5707963) * 0.2 * organicMotion;
  vec3 q = p * gyroidScale;
  float gyroid = dot(cos(q * 1.5707963), sin(q.yzx * 1.5707963)) + 1.0;
  float pulse = dot(
    sin(q + iTime * 6.283 * organicMotion + sin(q.yzx * 0.5)),
    vec3(0.033)
  );
  float tubes = gyroid + tubeThickness + pulse;
  float tunnel = biomineSmoothMaximum(
    tunnelRadius - length(p.xy - vec2(0.0, 1.0)) + 0.5 * cos(p.z * 3.14159 / 32.0),
    0.75 - gyroid,
    1.0
  ) - abs(1.5 - gyroid) * 0.375;
  biomineObjectId = step(tunnel, tubes);
  return min(tunnel, tubes);
}

float biomineTrace(vec3 origin, vec3 ray) {
  float travel = 0.0;
  for (int i = 0; i < 72; i++) {
    if (float(i) >= raySteps) break;
    float distanceField = biomineMap(origin + ray * travel);
    if (abs(distanceField) < 0.002 * (travel * 0.125 + 1.0) || travel > viewDistance) break;
    travel += max(abs(distanceField) * 0.55, 0.02);
  }
  return min(travel, viewDistance);
}

vec3 biomineNormal(vec3 p) {
  // Tetrahedral normal: four scene evaluations versus the original six.
  const float e = 0.0025;
  vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * biomineMap(p + k.xyy * e)
    + k.yyx * biomineMap(p + k.yyx * e)
    + k.yxy * biomineMap(p + k.yxy * e)
    + k.xxx * biomineMap(p + k.xxx * e)
  );
}

vec3 biomineMaterial(vec3 p, float objectId) {
  vec3 baseColor = objectId > 0.5 ? wallColor.rgb : tubeColor.rgb;
  if (surfaceDetail < 0.5) return baseColor;
  float scale = objectId > 0.5 ? 1.5 : 2.0;
  float cells = biomineCellTile(p * scale);
  if (surfaceDetail > 1.5) {
    cells = cells * 0.7 + biomineCellTile(p * scale * 3.0) * 0.3;
  }
  float pattern = smoothstep(-0.12, 0.42, cells);
  return baseColor * mix(0.28, 1.1, pattern);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (fragCoord - iResolution.xy * 0.5) / iResolution.y;
  vec3 cameraPosition = vec3(0.0, 1.0, iTime * 2.0);
  vec3 lookAt = cameraPosition + vec3(0.0, 0.0, 0.1);
  vec3 lightPosition = cameraPosition + vec3(0.0, 0.5, 5.0);
  lookAt.xy += biominePath(lookAt.z);
  cameraPosition.xy += biominePath(cameraPosition.z);
  lightPosition.xy += biominePath(lightPosition.z);
  vec3 forward = normalize(lookAt - cameraPosition);
  vec3 right = normalize(vec3(forward.z, 0.0, -forward.x));
  vec3 up = cross(forward, right);
  vec3 ray = normalize(forward + fieldOfView * uv.x * right + fieldOfView * uv.y * up);
  ray.xy = biomineRotation(biominePath(lookAt.z).x / 16.0) * ray.xy;

  float travel = biomineTrace(cameraPosition, ray);
  float savedObjectId = biomineObjectId;
  bool hit = travel < viewDistance;
  vec3 sceneColor = skyColor.rgb;
  float surfaceAlpha = skyColor.a;

  if (hit) {
    vec3 surfacePosition = cameraPosition + ray * travel;
    vec3 normal = biomineNormal(surfacePosition);
    vec3 lightVector = lightPosition - surfacePosition;
    float lightDistance = max(length(lightVector), 0.001);
    vec3 lightDirection = lightVector / lightDistance;
    float attenuation = 1.0 / (1.0 + lightDistance * 0.25);
    float diffuse = max(dot(normal, lightDirection), 0.0);
    float specular = pow(max(dot(reflect(-lightDirection, normal), -ray), 0.0), 32.0);
    float fresnel = pow(clamp(dot(normal, ray) + 1.0, 0.0, 1.0), 4.0);
    float backLight = pow(max(dot(ray, lightDirection), 0.0), 4.0);
    vec3 material = biomineMaterial(surfacePosition, savedObjectId);
    sceneColor = material * (0.5 + diffuse) * attenuation;
    sceneColor += glowColor.rgb * specular * specularStrength;
    sceneColor += material * glowColor.rgb * fresnel * 1.4;
    if (savedObjectId < 0.5) {
      vec3 environment = mix(skyColor.rgb, glowColor.rgb, 0.5 + 0.5 * reflect(ray, normal).y);
      sceneColor += environment * 0.35 + glowColor.rgb * backLight * 0.3;
    }
    surfaceAlpha = mix(savedObjectId < 0.5 ? tubeColor.a : wallColor.a, 1.0, specular * 0.2);
  }

  float distanceRatio = clamp(travel / max(viewDistance, 0.001), 0.0, 1.0);
  float fog = 1.0 - exp(-fogStrength * distanceRatio * distanceRatio * 2.0);
  sceneColor = mix(sceneColor, skyColor.rgb, fog);
  float alpha = mix(surfaceAlpha, skyColor.a, fog) * amount;
  fragColor = vec4(sqrt(clamp(sceneColor, 0.0, 1.0)), alpha);
}
`,
  });

export const VisualComponent = defineGeneratorNode(manifest, shader);
export default VisualComponent;
