import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createTextParam } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "galaxy",
    name: "Galaxy",
    category: "shadertoy",
    runtime: timeParamRuntime("speed"),
    primaryParamIds: ["arms", "spiral", "compression", "dustTexture", "starDensity", "galaxyColor", "bulbColor"],
    detailParamIds: ["speed", "scale", "rotation", "armContrast", "galaxyRadius", "bulbRadius", "blackHoleRadius", "dustScale", "starSize", "brightness", "seed", "blackHoleColor", "backgroundColor", "amount"],
    params: [
      createNumberParam("speed", "Speed", { min: 0, max: 3, step: 0.01, defaultValue: 0.1 }),
      createNumberParam("scale", "Scale", { min: 0.2, max: 4, step: 0.01, defaultValue: 1, scale: "log" }),
      createNumberParam("rotation", "Rotation", { min: -3.14, max: 3.14, step: 0.01, defaultValue: 0 }),
      createNumberParam("arms", "Arms", { min: 1, max: 12, step: 1, defaultValue: 5 }),
      createNumberParam("spiral", "Spiral", { min: -6, max: 6, step: 0.01, defaultValue: 2 }),
      createNumberParam("compression", "Arm compression", { min: 0, max: 0.4, step: 0.001, defaultValue: 0.1 }),
      createNumberParam("armContrast", "Arm contrast", { min: 0, max: 3, step: 0.01, defaultValue: 0.7 }),
      createNumberParam("galaxyRadius", "Galaxy radius", { min: 0.1, max: 1.2, step: 0.01, defaultValue: 0.5 }),
      createNumberParam("bulbRadius", "Bulb radius", { min: 0.02, max: 0.8, step: 0.01, defaultValue: 0.4 }),
      createNumberParam("blackHoleRadius", "Black hole radius", { min: 0, max: 0.5, step: 0.01, defaultValue: 0.25 }),
      createNumberParam("dustTexture", "Dust texture", { min: 0.1, max: 8, step: 0.01, defaultValue: 3 }),
      createNumberParam("dustScale", "Dust scale", { min: 0.25, max: 20, step: 0.01, defaultValue: 4, scale: "log" }),
      createNumberParam("starDensity", "Star density", { min: 0, max: 1, step: 0.01, defaultValue: 0.45 }),
      createNumberParam("starSize", "Star size", { min: 0, max: 1, step: 0.01, defaultValue: 0.3 }),
      createNumberParam("brightness", "Brightness", { min: 0, max: 4, step: 0.01, defaultValue: 1 }),
      createNumberParam("seed", "Seed", { min: 0, max: 1000, step: 1, defaultValue: 0 }),
      createColorParam("galaxyColor", "Galaxy color", "#e6e6ffff"),
      createColorParam("bulbColor", "Bulb color", "#ffffffff"),
      createColorParam("blackHoleColor", "Black hole color", "#000000ff"),
      createColorParam("backgroundColor", "Sky color", "#0d2640ff"),
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 1 }),
    ],
  });

const shader = Object.freeze({
    id: "generator.galaxy",
    name: "Galaxy Generator",
    type: "shadertoy",
    code: `
/*
 * Adapted from "Galaxy3" by FabriceNeyret2 and "Galaxy" by Fabrice NEYRET.
 * Original shader: https://www.shadertoy.com/view/MdBSDc
 * The Shadertoy noise, stars, and keyboard channels are replaced with seeded
 * procedural functions so the generator is self-contained and deterministic.
 */

uniform float speed;
uniform float scale;
uniform float rotation;
uniform float arms;
uniform float spiral;
uniform float compression;
uniform float armContrast;
uniform float galaxyRadius;
uniform float bulbRadius;
uniform float blackHoleRadius;
uniform float dustTexture;
uniform float dustScale;
uniform float starDensity;
uniform float starSize;
uniform float brightness;
uniform float seed;
uniform vec4 galaxyColor;
uniform vec4 bulbColor;
uniform vec4 blackHoleColor;
uniform vec4 backgroundColor;
uniform float amount;

const float GALAXY_PI = 3.1415927;

float galaxyHash12(vec2 point) {
  vec3 value = fract(vec3(point.xyx) * 0.1031 + seed * 0.0137);
  value += dot(value, value.yzx + 33.33);
  return fract((value.x + value.y) * value.z);
}

vec2 galaxyHash22(vec2 point) {
  float first = galaxyHash12(point);
  return vec2(first, galaxyHash12(point + vec2(31.17, 17.53)));
}

float galaxyValueNoise(vec2 point) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  vec2 blend = local * local * (3.0 - 2.0 * local);
  float a = galaxyHash12(cell);
  float b = galaxyHash12(cell + vec2(1.0, 0.0));
  float c = galaxyHash12(cell + vec2(0.0, 1.0));
  float d = galaxyHash12(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
}

float galaxyDustNoise(vec2 point) {
  float coarse = 1.0 - abs(2.0 * galaxyValueNoise(point) - 1.0);
  float coarseSquared = coarse * coarse;
  float coarseFourth = coarseSquared * coarseSquared;
  float textureMix = clamp((dustTexture - 1.0) * 0.5, 0.0, 1.0);
  coarse = mix(coarse, coarseSquared, min(textureMix * 2.0, 1.0));
  coarse = mix(coarse, coarseFourth, max(textureMix * 2.0 - 1.0, 0.0));

  // The second sample is a uniform quality branch. The original seven-octave
  // texture loop performed up to 28 hashes per pixel; this path performs four
  // at Low and eight at normal/high quality, with no loop or transcendental pow.
  if (renderQuality < 0.34) return coarse;
  float fine = 1.0 - abs(2.0 * galaxyValueNoise(point * 2.03 + vec2(13.7, 7.9)) - 1.0);
  float fineSquared = fine * fine;
  float fineFourth = fineSquared * fineSquared;
  fine = mix(fine, fineSquared, min(textureMix * 2.0, 1.0));
  fine = mix(fine, fineFourth, max(textureMix * 2.0 - 1.0, 0.0));
  return coarse * 0.72 + fine * 0.28;
}

float galaxyStars(vec2 point) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  vec2 randomValue = galaxyHash22(cell + 3.1);
  vec2 starPoint = fract(randomValue * vec2(1.0, 1.618) + vec2(0.17, 0.43));
  float enabled = step(1.0 - clamp(starDensity, 0.0, 1.0), fract(randomValue.x + randomValue.y * 1.73));
  float size = mix(0.006, 0.055, clamp(starSize, 0.0, 1.0));
  vec2 starDelta = local - starPoint;
  float core = smoothstep(size * size, 0.0, dot(starDelta, starDelta));
  float rayX = smoothstep(size * 2.8, 0.0, abs(local.x - starPoint.x));
  float rayY = smoothstep(size * 2.8, 0.0, abs(local.y - starPoint.y));
  return enabled * max(core, rayX * rayY * 0.18);
}

float galaxyFastProfile(float radiusSquared, float profileRadius) {
  float safeRadius = max(profileRadius, 0.001);
  float normalized = radiusSquared / (safeRadius * safeRadius);
  return 1.0 / (1.0 + normalized * (1.0 + normalized));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (fragCoord - 0.5 * iResolution.xy) / max(min(iResolution.x, iResolution.y), 1.0);
  float localScale = max(scale, 0.001);
  float rotationAngle = rotation;
  uv = mat2(cos(rotationAngle), -sin(rotationAngle), sin(rotationAngle), cos(rotationAngle)) * uv;
  uv /= localScale;

  float radiusSquared = max(dot(uv, uv), 0.00000025);
  float angle = atan(uv.y, uv.x);
  float shear = 0.5 * spiral * log(radiusSquared);

  float density = galaxyFastProfile(radiusSquared, galaxyRadius);
  float bulb = galaxyFastProfile(radiusSquared, bulbRadius);
  float blackHole = blackHoleRadius <= 0.0001
    ? 0.0
    : galaxyFastProfile(radiusSquared, blackHoleRadius);

  float armCount = max(floor(arms + 0.5), 1.0);
  float phase = armCount * (angle - shear);
  float phaseCosine = cos(phase);
  float armWave = 0.5 + 0.5 * phaseCosine;
  float armShape = armWave * armWave;
  density *= mix(1.0, 0.2 + 1.8 * armShape, clamp(armContrast, 0.0, 1.0));

  // Compose shear, arm compression, and animation into one rotation. This
  // replaces two independent polar reconstructions from the original port.
  float spiralTurn = shear - compression * phaseCosine + iTime * speed * 0.1;
  float spiralCosine = cos(spiralTurn);
  float spiralSine = sin(spiralTurn);
  vec2 spiralUv = mat2(spiralCosine, -spiralSine, spiralSine, spiralCosine) * uv;

  float dust = galaxyDustNoise(spiralUv * max(dustScale, 0.001));
  float gasTransmission = max(1.0 - dust * density, 0.0);
  gasTransmission *= gasTransmission;
  float stars = galaxyStars(spiralUv * 74.0 + vec2(0.5));

  vec3 galaxyLight = gasTransmission * 1.7 * galaxyColor.rgb + 1.2 * stars;
  vec3 color = mix(backgroundColor.rgb, galaxyLight, clamp(density, 0.0, 1.0));
  color = mix(color, 2.0 * bulbColor.rgb, clamp(1.2 * bulb, 0.0, 1.0));
  color = mix(color, blackHoleColor.rgb, clamp(2.0 * blackHole, 0.0, 1.0));
  color = max(color * brightness, 0.0);

  float featureAlpha = max(
    clamp(density * galaxyColor.a, 0.0, 1.0),
    max(clamp(bulb * bulbColor.a, 0.0, 1.0), clamp(stars, 0.0, 1.0))
  );
  featureAlpha = max(featureAlpha, clamp(blackHole * blackHoleColor.a, 0.0, 1.0));
  float alpha = clamp(mix(featureAlpha, 1.0, backgroundColor.a) * amount, 0.0, 1.0);
  fragColor = vec4(clamp(color, 0.0, 1.0) * alpha, alpha);
}
`,
  });

export const VisualComponent = defineGeneratorNode(manifest, shader);
export default VisualComponent;
