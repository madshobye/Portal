const TERRAIN_CAMERA_CLIP_GLSL = `
float terrainSafeNearPlane() {
  // nearClip already contains the CPU-computed tessellated-footprint floor.
  // Both surface depth projection and expanded-wire clipping consume this
  // exact uniform rather than maintaining two hidden approximations.
  return max(nearClip, 0.01);
}

float terrainClipYFromWorldUp(float worldUpY) {
  return worldUpY;
}
`;

const TERRAIN_CONTENT_PLACEMENT_GLSL = `
uniform mat3 contentPlacementMatrix;
uniform vec4 renderUvRect;
vec4 placeTerrainInComposition(vec4 clip) {
  // Keep placement homogeneous. Dividing by abs(w) mirrored vertices behind
  // the camera before the near plane could clip their triangles, even when
  // contentPlacementMatrix was the identity matrix.
  vec3 screenUvH = vec3(
    clip.x * 0.5 + clip.w * 0.5,
    clip.w * 0.5 - clip.y * 0.5,
    clip.w
  );
  vec3 placedUvH = contentPlacementMatrix * screenUvH;
  vec3 roiUvH = vec3(
    (placedUvH.xy - renderUvRect.xy * placedUvH.z) / max(renderUvRect.zw, vec2(0.000001)),
    placedUvH.z
  );
  clip.xy = vec2(
    roiUvH.x * 2.0 - roiUvH.z,
    roiUvH.z - roiUvH.y * 2.0
  );
  clip.w = roiUvH.z;
  return clip;
}
`;

export const TERRAIN_SURFACE_VERTEX_SHADER = `
precision highp float;
attribute vec2 aGridCoord;
uniform float time;
uniform float flightSpeed;
uniform float flightMode;
uniform float turn;
uniform float altitude;
uniform float pitch;
uniform float fieldOfView;
uniform float nearClip;
uniform float farClip;
uniform float aspectRatio;
uniform float lookAhead;
uniform float noseFollow;
uniform float mountainHeight;
uniform float terrainScale;
uniform vec2 terrainPhase;
uniform float lakeLevel;
uniform float viewDistance;
uniform float rowSpacing;
uniform float globeRadius;
uniform float gridDensity;
uniform vec2 gridCells;
uniform vec2 meshCells;
uniform float gridBaseRow;
uniform float gridIrregularity;
uniform float cellScale;
uniform vec2 planeSize;
varying vec2 vTerrainUv;
varying vec2 vWorldCoord;
varying vec2 vTerrainGradient;
varying float vRawHeight;
varying float vSurfaceHeight;
varying float vSlope;
varying float vDepth;
${TERRAIN_CAMERA_CLIP_GLSL}
${TERRAIN_CONTENT_PLACEMENT_GLSL}

float terrainHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float terrainNoise(vec2 p) {
  const float skew = 0.36602540378;
  const float unskew = 0.2113248654;
  vec2 cell = floor(p + (p.x + p.y) * skew);
  vec2 local0 = p - cell + (cell.x + cell.y) * unskew;
  vec2 corner = local0.x > local0.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec2 local1 = local0 - corner + unskew;
  vec2 local2 = local0 - 1.0 + 2.0 * unskew;
  vec3 weight = max(0.5 - vec3(dot(local0, local0), dot(local1, local1), dot(local2, local2)), 0.0);
  weight *= weight;
  weight *= weight;
  vec3 value = vec3(terrainHash(cell), terrainHash(cell + corner), terrainHash(cell + 1.0));
  return dot(weight, value) / max(dot(weight, vec3(1.0)), 0.0001);
}

float terrainHeightAt(vec2 world) {
  vec2 p = (world * max(terrainScale, 0.02) + terrainPhase) * 0.055;
  float broad = terrainNoise(p * 0.55);
  float detail = terrainNoise(p * 1.42);
  float base = mix(broad, detail, 0.28);
  float ridge = 1.0 - abs(broad * 2.0 - 1.0);
  return (base * 0.92 + ridge * ridge * 0.52 - 0.68) * max(mountainHeight, 0.01);
}

float terrainGridHash(vec2 point, float salt) {
  return terrainHash(vec2(point.x + 101.0 + salt, point.y + 313.0 - salt));
}

vec2 terrainMeshUv(vec2 gridCoord) {
  float worldRow = gridBaseRow + gridCoord.y;
  float amount = clamp(gridIrregularity, 0.0, 1.0) * 0.44;
  float interior = step(0.5, gridCoord.x) * step(gridCoord.x, meshCells.x - 0.5);
  float offsetX = (terrainGridHash(vec2(gridCoord.x, worldRow), 17.0) * 2.0 - 1.0) * amount * interior;
  float offsetY = (terrainGridHash(vec2(0.0, worldRow), 43.0) * 2.0 - 1.0) * amount;
  return vec2((gridCoord.x + offsetX) / max(meshCells.x, 1.0), worldRow + offsetY);
}

void main() {
  vec2 meshUv = terrainMeshUv(aGridCoord);
  float yaw = clamp(turn, -1.0, 1.0) * 0.72;
  vec2 travel = vec2(sin(yaw), cos(yaw));
  float farDistance = mix(42.0, 86.0, clamp(viewDistance, 0.0, 3.0) / 1.5);
  float cameraTravel = time * max(flightSpeed, 0.0) * 7.0;
  float distance = meshUv.y * rowSpacing - cameraTravel;
  float nearAmount = 1.0 - clamp(distance / farDistance, 0.0, 1.0);
  vec2 right = vec2(travel.y, -travel.x);
  float worldLateral = (meshUv.x - 0.5) * gridCells.x * cellScale * 1.44;
  vec2 world = travel * (cameraTravel + distance) + right * worldLateral;
  float rawHeight = terrainHeightAt(world);
  float surfaceHeight = max(rawHeight, lakeLevel);
  vec2 cameraWorld = travel * cameraTravel;
  float cameraSurfaceHeight = max(terrainHeightAt(cameraWorld), lakeLevel);
  float aheadDistance = max(lookAhead, 0.1);
  float aheadSurfaceHeight = max(terrainHeightAt(cameraWorld + travel * aheadDistance), lakeLevel);
  float followAmount = step(0.5, flightMode);
  float slopePitch = atan((aheadSurfaceHeight - cameraSurfaceHeight) / aheadDistance) * noseFollow;
  float effectivePitch = pitch - slopePitch * followAmount;
  float relativeSurfaceHeight = surfaceHeight - cameraSurfaceHeight * followAmount;
  float sampleStep = mix(1.4, 0.18, nearAmount);
  float rightHeight = max(terrainHeightAt(world + vec2(sampleStep, 0.0)), lakeLevel);
  float frontHeight = max(terrainHeightAt(world + vec2(0.0, sampleStep)), lakeLevel);
  vec2 gradient = vec2(rightHeight - surfaceHeight, frontHeight - surfaceHeight);
  vTerrainUv = meshUv;
  vWorldCoord = world;
  vTerrainGradient = gradient;
  vRawHeight = rawHeight;
  vSurfaceHeight = surfaceHeight;
  vSlope = clamp(length(gradient) * 1.6, 0.0, 1.0);
  vDepth = clamp(distance / farDistance, 0.0, 1.0);
  float planetRadius = max(globeRadius, farDistance * 1.05);
  float radialDistance = min(length(vec2(worldLateral, distance)), planetRadius * 0.98);
  float globeDrop = planetRadius - sqrt(max(planetRadius * planetRadius - radialDistance * radialDistance, 0.0));
  float verticalWorld = relativeSurfaceHeight - globeDrop - max(altitude, 0.0);
  float pitchCos = cos(effectivePitch);
  float pitchSin = sin(effectivePitch);
  float cameraY = verticalWorld * pitchCos + distance * pitchSin;
  float cameraZ = distance * pitchCos - verticalWorld * pitchSin;
  float focalLength = 1.0 / tan(radians(clamp(fieldOfView, 20.0, 120.0)) * 0.5);
  float nearPlane = terrainSafeNearPlane();
  float farPlane = max(farClip, nearPlane + 1.0);
  float clipZ = ((farPlane + nearPlane) / (farPlane - nearPlane)) * cameraZ
    - (2.0 * farPlane * nearPlane) / (farPlane - nearPlane);
  gl_Position = placeTerrainInComposition(vec4(
    worldLateral * focalLength / max(aspectRatio, 0.01),
    terrainClipYFromWorldUp(cameraY) * focalLength,
    clipZ,
    cameraZ
  ));
}
`;

export const TERRAIN_SURFACE_FRAGMENT_SHADER = `
precision highp float;
uniform float style;
uniform float lakeLevel;
uniform float viewDistance;
uniform float gridDensity;
uniform float wireWidth;
uniform float textureGrain;
uniform float textureDepth;
uniform float colorDirection;
uniform vec4 waterColor;
uniform vec4 grassColor;
uniform vec4 rockColor;
uniform vec4 snowColor;
uniform vec4 downSlopeColor;
uniform vec4 directionColor;
uniform vec4 wireColor;
uniform vec4 skyColor;
varying vec2 vTerrainUv;
varying vec2 vWorldCoord;
varying vec2 vTerrainGradient;
varying float vRawHeight;
varying float vSurfaceHeight;
varying float vSlope;
varying float vDepth;

float terrainTextureHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float terrainTextureNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 local = fract(p);
  vec2 blend = local * local * (3.0 - 2.0 * local);
  float a = terrainTextureHash(cell);
  float b = terrainTextureHash(cell + vec2(1.0, 0.0));
  float c = terrainTextureHash(cell + vec2(0.0, 1.0));
  float d = terrainTextureHash(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
}

void main() {
  bool water = vRawHeight < lakeLevel + 0.018;
  float aboveWater = vRawHeight - lakeLevel;
  vec3 shoreColor = mix(rockColor.rgb, snowColor.rgb, 0.58);
  float shoreAlpha = mix(rockColor.a, snowColor.a, 0.58);
  float grassBand = smoothstep(0.015, 0.20, aboveWater);
  vec3 terrainColor = mix(shoreColor, grassColor.rgb, grassBand);
  float terrainAlpha = mix(shoreAlpha, grassColor.a, grassBand);
  float rockBand = clamp(smoothstep(0.46, 1.10, aboveWater) + vSlope * 0.42, 0.0, 1.0);
  terrainColor = mix(terrainColor, rockColor.rgb, rockBand);
  terrainAlpha = mix(terrainAlpha, rockColor.a, rockBand);
  float snowBand = smoothstep(0.76, 1.16, aboveWater) * (1.0 - vSlope * 0.72);
  terrainColor = mix(terrainColor, snowColor.rgb, snowBand);
  terrainAlpha = mix(terrainAlpha, snowColor.a, snowBand);
  float downSlopeBlend = smoothstep(0.10, 0.82, vSlope) * downSlopeColor.a;
  terrainColor = mix(terrainColor, downSlopeColor.rgb, downSlopeBlend);
  vec2 surfaceAspect = length(vTerrainGradient) > 0.0001 ? normalize(-vTerrainGradient) : vec2(0.0);
  vec2 colorHeading = vec2(cos(colorDirection), sin(colorDirection));
  float directionFacing = smoothstep(-0.15, 0.85, dot(surfaceAspect, colorHeading));
  float directionBlend = directionFacing * smoothstep(0.04, 0.64, vSlope) * directionColor.a;
  terrainColor = mix(terrainColor, directionColor.rgb, directionBlend);
  float lighting = mix(1.02, 0.55, vSlope);
  vec3 color = water ? waterColor.rgb * mix(1.05, 0.66, vDepth) : terrainColor * lighting;
  float alpha = water ? waterColor.a : terrainAlpha;
  float textureMask = water ? 0.18 : 1.0;
  float textureLight = 1.0;
  if (textureDepth > 0.001) {
    float coarseTexture = terrainTextureNoise(vWorldCoord * 0.42) - 0.5;
    textureLight += textureMask * coarseTexture * textureDepth * 0.55;
  }
  if (textureGrain > 0.001) {
    float fineTexture = terrainTextureNoise(vWorldCoord * 3.2 + vec2(31.7, 19.3)) - 0.5;
    textureLight += textureMask * fineTexture * textureGrain * 0.32;
  }
  color *= max(textureLight, 0.05);
  float fogStart = mix(0.94, 0.58, clamp(viewDistance, 0.0, 3.0) / 1.5);
  float fog = smoothstep(fogStart, 1.0, vDepth);
  color = mix(color, skyColor.rgb * 0.76, fog);
  alpha *= 1.0 - fog;
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), clamp(alpha, 0.0, 1.0));
}
`;

export const TERRAIN_WIRE_VERTEX_SHADER = `
precision highp float;
attribute vec2 aStart;
attribute vec2 aEnd;
attribute float aSide;
attribute float aAlong;
uniform float time;
uniform float flightSpeed;
uniform float flightMode;
uniform float turn;
uniform float altitude;
uniform float pitch;
uniform float fieldOfView;
uniform float nearClip;
uniform float farClip;
uniform float aspectRatio;
uniform float lookAhead;
uniform float noseFollow;
uniform float mountainHeight;
uniform float terrainScale;
uniform vec2 terrainPhase;
uniform float lakeLevel;
uniform float viewDistance;
uniform float rowSpacing;
uniform float globeRadius;
uniform float gridDensity;
uniform vec2 gridCells;
uniform vec2 meshCells;
uniform float gridBaseRow;
uniform float gridIrregularity;
uniform float cellScale;
uniform vec2 resolution;
uniform float thickness;
varying float vDepth;

float terrainHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float terrainNoise(vec2 p) {
  const float skew = 0.36602540378;
  const float unskew = 0.2113248654;
  vec2 cell = floor(p + (p.x + p.y) * skew);
  vec2 local0 = p - cell + (cell.x + cell.y) * unskew;
  vec2 corner = local0.x > local0.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec2 local1 = local0 - corner + unskew;
  vec2 local2 = local0 - 1.0 + 2.0 * unskew;
  vec3 weight = max(0.5 - vec3(dot(local0, local0), dot(local1, local1), dot(local2, local2)), 0.0);
  weight *= weight;
  weight *= weight;
  vec3 value = vec3(terrainHash(cell), terrainHash(cell + corner), terrainHash(cell + 1.0));
  return dot(weight, value) / max(dot(weight, vec3(1.0)), 0.0001);
}

float terrainHeightAt(vec2 world) {
  vec2 p = (world * max(terrainScale, 0.02) + terrainPhase) * 0.055;
  float broad = terrainNoise(p * 0.55);
  float detail = terrainNoise(p * 1.42);
  float base = mix(broad, detail, 0.28);
  float ridge = 1.0 - abs(broad * 2.0 - 1.0);
  return (base * 0.92 + ridge * ridge * 0.52 - 0.68) * max(mountainHeight, 0.01);
}

float terrainGridHash(vec2 point, float salt) {
  return terrainHash(vec2(point.x + 101.0 + salt, point.y + 313.0 - salt));
}

vec2 terrainMeshUv(vec2 gridCoord) {
  float worldRow = gridBaseRow + gridCoord.y;
  float amount = clamp(gridIrregularity, 0.0, 1.0) * 0.44;
  float interior = step(0.5, gridCoord.x) * step(gridCoord.x, meshCells.x - 0.5);
  float offsetX = (terrainGridHash(vec2(gridCoord.x, worldRow), 17.0) * 2.0 - 1.0) * amount * interior;
  float offsetY = (terrainGridHash(vec2(0.0, worldRow), 43.0) * 2.0 - 1.0) * amount;
  return vec2((gridCoord.x + offsetX) / max(meshCells.x, 1.0), worldRow + offsetY);
}

float terrainEdgeEnabled(vec2 startGrid, vec2 endGrid) {
  vec2 delta = endGrid - startGrid;
  if (abs(delta.x) < 0.5 || abs(delta.y) < 0.5) return 1.0;
  float cellX = min(startGrid.x, endGrid.x);
  float worldRow = gridBaseRow + min(startGrid.y, endGrid.y);
  float forwardDiagonal = step(0.0, delta.x * delta.y);
  float selector = mod(cellX * 17.0 + worldRow * 31.0 + cellX * worldRow * 13.0 + 79.0, 11.0);
  float selectedDiagonal = step(5.0, selector);
  return 1.0 - abs(forwardDiagonal - selectedDiagonal);
}

${TERRAIN_CAMERA_CLIP_GLSL}
${TERRAIN_CONTENT_PLACEMENT_GLSL}

vec4 terrainClip(vec2 gridCoord) {
  vec2 uv = terrainMeshUv(gridCoord);
  float yaw = clamp(turn, -1.0, 1.0) * 0.72;
  vec2 travel = vec2(sin(yaw), cos(yaw));
  float farDistance = mix(42.0, 86.0, clamp(viewDistance, 0.0, 3.0) / 1.5);
  float cameraTravel = time * max(flightSpeed, 0.0) * 7.0;
  float distance = uv.y * rowSpacing - cameraTravel;
  vec2 right = vec2(travel.y, -travel.x);
  float worldLateral = (uv.x - 0.5) * gridCells.x * cellScale * 1.44;
  vec2 world = travel * (cameraTravel + distance) + right * worldLateral;
  float surfaceHeight = max(terrainHeightAt(world), lakeLevel);
  vec2 cameraWorld = travel * cameraTravel;
  float cameraSurfaceHeight = max(terrainHeightAt(cameraWorld), lakeLevel);
  float aheadDistance = max(lookAhead, 0.1);
  float aheadSurfaceHeight = max(terrainHeightAt(cameraWorld + travel * aheadDistance), lakeLevel);
  float followAmount = step(0.5, flightMode);
  float slopePitch = atan((aheadSurfaceHeight - cameraSurfaceHeight) / aheadDistance) * noseFollow;
  float effectivePitch = pitch - slopePitch * followAmount;
  float relativeSurfaceHeight = surfaceHeight - cameraSurfaceHeight * followAmount;
  float planetRadius = max(globeRadius, farDistance * 1.05);
  float radialDistance = min(length(vec2(worldLateral, distance)), planetRadius * 0.98);
  float globeDrop = planetRadius - sqrt(max(planetRadius * planetRadius - radialDistance * radialDistance, 0.0));
  float verticalWorld = relativeSurfaceHeight - globeDrop - max(altitude, 0.0);
  float pitchCos = cos(effectivePitch);
  float pitchSin = sin(effectivePitch);
  float cameraY = verticalWorld * pitchCos + distance * pitchSin;
  float cameraZ = distance * pitchCos - verticalWorld * pitchSin;
  float focalLength = 1.0 / tan(radians(clamp(fieldOfView, 20.0, 120.0)) * 0.5);
  float nearPlane = terrainSafeNearPlane();
  float farPlane = max(farClip, nearPlane + 1.0);
  float clipZ = ((farPlane + nearPlane) / (farPlane - nearPlane)) * cameraZ
    - (2.0 * farPlane * nearPlane) / (farPlane - nearPlane);
  return placeTerrainInComposition(vec4(
    worldLateral * focalLength / max(aspectRatio, 0.01),
    terrainClipYFromWorldUp(cameraY) * focalLength,
    clipZ,
    cameraZ
  ));
}

void main() {
  vec4 startClip = terrainClip(aStart);
  vec4 endClip = terrainClip(aEnd);
  if (terrainEdgeEnabled(aStart, aEnd) < 0.5) {
    vDepth = 1.0;
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float clipNear = terrainSafeNearPlane();
  if (startClip.w < clipNear && endClip.w < clipNear) {
    vDepth = 1.0;
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  if (startClip.w < clipNear) {
    float amount = clamp((clipNear - startClip.w) / max(endClip.w - startClip.w, 0.000001), 0.0, 1.0);
    startClip = mix(startClip, endClip, amount);
  } else if (endClip.w < clipNear) {
    float amount = clamp((clipNear - endClip.w) / max(startClip.w - endClip.w, 0.000001), 0.0, 1.0);
    endClip = mix(endClip, startClip, amount);
  }
  vec2 startNdc = startClip.xy / startClip.w;
  vec2 endNdc = endClip.xy / endClip.w;
  vec2 direction = endNdc - startNdc;
  float lineLength = length(direction);
  vec2 normal = lineLength > 0.000001 ? vec2(-direction.y, direction.x) / lineLength : vec2(0.0, 1.0);
  vec4 clip = mix(startClip, endClip, aAlong);
  clip.xy += normal * vec2(2.0 / max(resolution.x, 1.0), 2.0 / max(resolution.y, 1.0)) * thickness * 0.5 * aSide * clip.w;
  float farDistance = mix(42.0, 86.0, clamp(viewDistance, 0.0, 3.0) / 1.5);
  float cameraTravel = time * max(flightSpeed, 0.0) * 7.0;
  float startDepth = clamp((terrainMeshUv(aStart).y * rowSpacing - cameraTravel) / farDistance, 0.0, 1.0);
  float endDepth = clamp((terrainMeshUv(aEnd).y * rowSpacing - cameraTravel) / farDistance, 0.0, 1.0);
  vDepth = mix(startDepth, endDepth, aAlong);
  gl_Position = clip;
}
`;

export const TERRAIN_WIRE_FRAGMENT_SHADER = `
precision highp float;
uniform vec4 wireColor;
uniform float viewDistance;
varying float vDepth;
void main() {
  float fogStart = mix(0.94, 0.58, clamp(viewDistance, 0.0, 3.0) / 1.5);
  float alpha = wireColor.a * (1.0 - smoothstep(fogStart, 1.0, vDepth));
  gl_FragColor = vec4(wireColor.rgb * alpha, alpha);
}
`;
