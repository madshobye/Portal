export const ORGANIC_GENERATOR_SHADER_COMPONENTS = Object.freeze({
  paintDrips: {
    id: "generator.paintDrips",
    name: "Paint Drips Generator",
    type: "shadertoy",
    code: `
/*
 * Adapted from the Simple Paint Drip shader:
 * https://www.shadertoy.com/view/WdBXD1
 * The texture-based random source is replaced with a deterministic hash so the
 * generator is self-contained, and the original unbounded scan is kept finite.
 */

uniform float variation;
uniform float dripSpacing;
uniform float dripDensity;
uniform float dripThickness;
uniform float bounceCurve;
uniform float cycleLength;
uniform float bounceRange;
uniform float fallSpeed;
uniform float ceilingDepth;
uniform float ceilingRoughness;
uniform float edgeSoftness;
uniform vec4 paintColor;
uniform vec4 backgroundColor;
uniform float amount;

float dripHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32 + variation);
  return fract(p.x * p.y);
}

float segmentDistance(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.00001), 0.0, 1.0);
  return length(pa - ba * h);
}

float paintMask(vec2 uv) {
  float spacing = max(dripSpacing, 0.002);
  float cycle = max(cycleLength, 0.05);
  float baseColumn = floor(uv.x / spacing);
  float nearestDrip = 999.0;
  float nearestFallingDrip = 999.0;

  // A bounded neighbourhood is much cheaper than the original 1,000-iteration
  // scan while still covering the widest available drip setting.
  for (int i = -24; i <= 24; i++) {
    float column = baseColumn + float(i);
    float x = (column + 0.5) * spacing;
    if (abs(x - uv.x) > dripThickness * 1.6 + spacing) continue;

    float active = step(1.0 - dripDensity, dripHash(vec2(column, variation + 1.7)));
    if (active < 0.5) continue;

    float randomHeight = dripHash(vec2(variation + 4.1, column)) * 0.68 + 0.10;
    float phase = mod(iTime + randomHeight * 10.0, cycle);
    float bounce = -(bounceCurve * phase) * exp(1.0 - bounceCurve * phase);
    float localCeiling = clamp(
      ceilingDepth + (dripHash(vec2(column, variation + 9.3)) - 0.5) * ceilingRoughness,
      0.01,
      0.94
    );
    float tipY = clamp(max(localCeiling, randomHeight + bounce * bounceRange), localCeiling, 0.98);
    float taper = mix(0.34, 1.0, clamp(tipY - uv.y + 0.12, 0.0, 1.0));
    float radius = max(dripThickness * taper, 0.002);

    float attached = segmentDistance(uv, vec2(x, localCeiling), vec2(x, tipY)) / radius;
    nearestDrip = min(nearestDrip, attached);

    float fallingY = tipY + phase * fallSpeed * bounceRange;
    float fallingRadius = radius * mix(0.82, 0.28, clamp(phase / cycle, 0.0, 1.0));
    nearestFallingDrip = min(
      nearestFallingDrip,
      distance(uv, vec2(x, fallingY)) / max(fallingRadius, 0.002)
    );
  }

  float ceilingNoise = dripHash(vec2(floor(uv.x / spacing), variation + 15.7)) - 0.5;
  float ceiling = clamp(ceilingDepth + ceilingNoise * ceilingRoughness, 0.01, 0.94);
  float softness = max(edgeSoftness, 0.0005);
  float ceilingShape = 1.0 - smoothstep(ceiling, ceiling + softness, uv.y);
  float dripShape = 1.0 - smoothstep(1.0, 1.0 + softness * 12.0, min(nearestDrip, nearestFallingDrip));
  return max(ceilingShape, dripShape);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  uv.x *= iResolution.x / max(iResolution.y, 1.0);
  float mask = paintMask(uv);
  vec3 color = mix(backgroundColor.rgb, paintColor.rgb, mask * paintColor.a);
  float alpha = mix(backgroundColor.a, paintColor.a, mask) * amount;
  fragColor = vec4(color, alpha);
}
`,
  },
  cloudyTunnel: {
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
  },
  cherenkovVolume: {
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
  },
  biomineLite: {
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
  },
  swayingTrees: {
    id: "generator.swayingTrees",
    name: "Swaying Trees Generator",
    type: "fragment",
    code: `
precision mediump float;
uniform vec2 resolution;
uniform float time;
varying vec2 vTexCoord;

float hash(float n) {
  vec3 p3 = fract(vec3(n, n + 19.19, n + 47.77) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float sdSegment2(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.00001), 0.0, 1.0);
  vec2 delta = pa - ba * h;
  return dot(delta, delta);
}

float softLine(vec2 p, vec2 a, vec2 b, float width) {
  float d2 = sdSegment2(p, a, b);
  float outer = width * 2.65;
  return 1.0 - smoothstep(width * width, outer * outer, d2);
}

float leafShape(vec2 p, vec2 center, vec2 scale, float angle, float seed) {
  float c = cos(angle);
  float s = sin(angle);
  vec2 q = p - center;
  q = vec2(c * q.x + s * q.y, -s * q.x + c * q.y);
  q /= scale;
  float body = 1.0 - smoothstep(0.5476, 1.0, dot(q, q));
  float taper = smoothstep(-0.98, -0.08, q.y) * (1.0 - smoothstep(0.16, 0.98, q.y));
  float vein = (1.0 - smoothstep(0.012, 0.055, abs(q.x))) * body * 0.14;
  float fleck = hash(floor((q.x + 2.0) * 13.0 + floor((q.y + 2.0) * 17.0) + seed));
  return clamp(body * taper * (0.86 + fleck * 0.18) + vein, 0.0, 1.0);
}

void main() {
  vec2 uv = vTexCoord;
  float aspect = resolution.x / max(resolution.y, 1.0);
  vec2 p = vec2(uv.x * aspect, uv.y);
  vec3 premul = vec3(0.0);
  float alpha = 0.0;

  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float seed = fi + 1.0;
    float slot = (fi + 0.5) / 7.0;
    float rootJitter = (hash(seed * 3.17) - 0.5) * 0.09;
    vec2 root = vec2(clamp(slot * aspect + rootJitter, 0.06, aspect - 0.06), 0.02);
    float height = mix(0.36, 0.86, hash(seed * 4.71));
    float bend = (hash(seed * 8.63) - 0.5) * 0.12;
    float swayPhase = time * mix(0.42, 0.74, hash(seed * 6.19)) + seed * 2.37;
    float sway = sin(swayPhase) * mix(0.018, 0.052, hash(seed * 5.41));
    vec2 top = root + vec2(bend + sway, height);
    float trunkWidth = mix(0.012, 0.026, hash(seed * 9.83));
    float trunk = softLine(p, root, top, trunkWidth);
    vec3 bark = mix(vec3(0.15, 0.08, 0.035), vec3(0.30, 0.18, 0.08), hash(seed * 2.0));
    premul += bark * trunk * 0.78;
    alpha = max(alpha, trunk * 0.9);

    for (int j = 0; j < 5; j++) {
      float fj = float(j);
      float k = 0.30 + fj * 0.13 + hash(seed * 11.0 + fj) * 0.055;
      vec2 branchRoot = mix(root, top, k);
      float side = mod(fi + fj, 2.0) < 1.0 ? -1.0 : 1.0;
      float branchLength = mix(0.10, 0.24, hash(seed * 13.0 + fj)) * aspect;
      float branchRise = mix(0.045, 0.16, hash(seed * 17.0 + fj));
      float branchSway = sin(swayPhase + fj * 0.9) * 0.030 * (0.5 + k);
      vec2 branchTip = branchRoot + vec2(side * branchLength + branchSway, branchRise);
      float branchMask = softLine(p, branchRoot, branchTip, trunkWidth * mix(0.36, 0.58, k));
      premul += bark * branchMask * 0.62;
      alpha = max(alpha, branchMask * 0.78);

      for (int l = 0; l < 3; l++) {
        float fl = float(l);
        float lk = 0.36 + fl * 0.25 + hash(seed * 23.0 + fj * 5.0 + fl) * 0.12;
        vec2 leafCenter = mix(branchRoot, branchTip, lk);
        leafCenter += vec2(
          sin(swayPhase * 1.24 + fj * 1.7 + fl) * 0.026,
          cos(swayPhase * 0.83 + fl * 2.0) * 0.015
        );
        float leafSize = mix(0.026, 0.064, hash(seed * 29.0 + fj * 3.0 + fl));
        float leafAngle = side * 0.68 + sin(time * 0.8 + seed + fj + fl) * 0.22;
        float leaf = leafShape(p, leafCenter, vec2(leafSize * 0.72, leafSize * 1.18), leafAngle, seed * 31.0 + fj * 7.0 + fl);
        vec3 leafColor = mix(
          vec3(0.10, 0.38, 0.13),
          vec3(0.55, 0.76, 0.22),
          hash(seed * 37.0 + fj * 11.0 + fl)
        );
        leafColor = mix(leafColor, vec3(0.84, 0.62, 0.20), smoothstep(0.62, 1.0, hash(seed * 43.0 + fj * 4.0 + fl)) * 0.35);
        premul += leafColor * leaf * 0.8;
        alpha = max(alpha, leaf * 0.82);
      }
    }
  }

  float ground = 1.0 - smoothstep(0.0, 0.03, uv.y);
  premul += vec3(0.08, 0.16, 0.07) * ground * 0.35;
  alpha = max(alpha, ground * 0.32);
  alpha = clamp(alpha, 0.0, 1.0);
  premul = clamp(premul, 0.0, 1.0) * alpha;
  gl_FragColor = vec4(premul, alpha);
}`,
  },
});
