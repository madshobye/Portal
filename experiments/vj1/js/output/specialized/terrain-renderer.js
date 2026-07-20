import { isSharedFramebufferTarget } from "../shared-framebuffer-target.js?v=render-diagnostics-1";
import { resolutionScaledStrokeWidth } from "../component-render-layout.js?v=canvas-global-resolution-1";
import { normalizedModelColor } from "./model-color.js?v=adaptive-component-demand-29";
import { compileRawShader, linkSpecializedProgram } from "../../libraries/render-engine/raw-webgl-utils.js";
import {
  beginRawWebGlState,
  bindRawWebGlVertexArray,
  captureRawWebGlAttributes,
  disposeRawWebGlVertexArray,
  restoreRawWebGlState,
} from "../../libraries/render-engine/raw-webgl-state.js";
import {
  normalizedTerrainIrregularity,
  terrainExpandedGridWireVertices,
  terrainGridSize,
  terrainRowMetrics,
  terrainSafeNearDistance,
  terrainSurfaceGridVertices,
  terrainSurfaceTriangleIndices,
  terrainTessellationSize,
} from "./terrain-mesh.js?v=terrain-near-contract-2";

// Terrain camera height is world-up: positive cameraY is above the camera and
// negative cameraY is below it. WebGL clip Y uses the same upward convention.
// The conversion to Composition's screen-down UV convention happens later,
// exactly once, inside placeTerrainInComposition().
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

// Chain transforms place the projected terrain inside the immutable
// Composition frame. They never resample an already rendered terrain texture.
const TERRAIN_CONTENT_PLACEMENT_GLSL = `
uniform mat3 contentPlacementMatrix;
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
  clip.xy = vec2(
    placedUvH.x * 2.0 - placedUvH.z,
    placedUvH.z - placedUvH.y * 2.0
  );
  clip.w = placedUvH.z;
  return clip;
}
`;

const TERRAIN_VERTEX_SHADER = `
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

const TERRAIN_FRAGMENT_SHADER = `
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

export function drawTerrainSurface(target, resourceCache, params, componentTime, planeWidth, planeDepth, style, sky) {
  const gl = target?.drawingContext;
  if (!gl) return false;
  const viewportSize = renderTargetPixelSize(target);
  const passState = beginRawWebGlState(gl, "terrain-surface");
  let attributeStates = [];
  let resources = null;
  let completed = false;
  try {
  resources = resourceCache.get(gl);
  if (resources && !terrainSurfaceResourcesValid(gl, resources)) {
    disposeTerrainSurfaceResources(gl, resources);
    resourceCache.delete(gl);
    resources = null;
  }
  if (!resources) {
    resources = createTerrainSurfaceResources(gl);
    if (!resources) return false;
    resourceCache.set(gl, resources);
  }

  const widthCells = terrainTessellationSize(terrainGridSize(params.gridWidth), params.gridDensity);
  const depthCells = terrainTessellationSize(terrainGridSize(params.gridDepth), params.gridDensity);
  const gridMetrics = terrainRowMetrics(componentTime, Math.max(0, Number(params.flightSpeed) || 0), params.gridDepth, params.gridDensity, params.gridScale);
  const baseRow = Math.floor(gridMetrics.travelRows) - 1;
  attributeStates = captureRawWebGlAttributes(gl, passState, [resources.gridCoord]);
  bindRawWebGlVertexArray(gl, passState, resources);
  updateTerrainSurfaceBuffers(gl, resources, widthCells, depthCells, baseRow);

  gl.useProgram(resources.program);
  gl.viewport(0, 0, viewportSize.width, viewportSize.height);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.CULL_FACE);
  if (style === 2) {
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 2);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, resources.vertexBuffer);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, resources.indexBuffer);
  gl.enableVertexAttribArray(resources.gridCoord);
  gl.vertexAttribPointer(resources.gridCoord, 2, gl.FLOAT, false, 0, 0);
  setTerrainRawUniforms(gl, resources, params, componentTime, planeWidth, planeDepth, normalizedModelColor(params.wireColor, [242, 245, 239, 255]));
  gl.uniform2f(resources.meshCells, widthCells, depthCells);
  gl.uniform1f(resources.gridBaseRow, baseRow);
  gl.uniform1f(resources.gridIrregularity, normalizedTerrainIrregularity(params.gridJitter));
  gl.uniform1f(resources.style, style);
  gl.uniform1f(resources.wireWidth, Math.max(0.05, Number(params.wireWidth) || 0.85));
  gl.uniform1f(resources.textureGrain, Math.max(0, Number(params.textureGrain) || 0));
  gl.uniform1f(resources.textureDepth, Math.max(0, Number(params.textureDepth) || 0));
  gl.uniform1f(resources.colorDirection, Math.max(-3.14, Math.min(3.14, Number(params.colorDirection) || 0)));
  gl.uniform4fv(resources.waterColor, normalizedModelColor(params.waterColor, [20, 123, 193, 255]));
  gl.uniform4fv(resources.grassColor, normalizedModelColor(params.grassColor, [35, 132, 59, 255]));
  gl.uniform4fv(resources.rockColor, normalizedModelColor(params.rockColor, [76, 64, 55, 255]));
  gl.uniform4fv(resources.snowColor, normalizedModelColor(params.snowColor, [232, 237, 241, 255]));
  gl.uniform4fv(resources.downSlopeColor, normalizedModelColor(params.downSlopeColor, [32, 42, 56, 170]));
  gl.uniform4fv(resources.directionColor, normalizedModelColor(params.directionColor, [216, 138, 66, 170]));
  gl.uniform4fv(resources.skyColor, sky);
  gl.drawElements(gl.TRIANGLES, resources.count, gl.UNSIGNED_SHORT, 0);
  completed = true;
  } finally {
    restoreRawWebGlState(gl, passState, attributeStates);
  }
  return completed;
}

function createTerrainSurfaceResources(gl) {
  const vertex = compileRawShader(gl, gl.VERTEX_SHADER, TERRAIN_VERTEX_SHADER);
  const fragment = compileRawShader(gl, gl.FRAGMENT_SHADER, TERRAIN_FRAGMENT_SHADER);
  const program = linkSpecializedProgram(gl, vertex, fragment);
  if (!program) return null;
  return {
    program,
    vertexBuffer: gl.createBuffer(),
    indexBuffer: gl.createBuffer(),
    count: 0,
    meshSizeKey: "",
    topologyKey: "",
    gridCoord: gl.getAttribLocation(program, "aGridCoord"),
    ...terrainRawUniformLocations(gl, program),
    meshCells: gl.getUniformLocation(program, "meshCells"),
    gridBaseRow: gl.getUniformLocation(program, "gridBaseRow"),
    gridIrregularity: gl.getUniformLocation(program, "gridIrregularity"),
    style: gl.getUniformLocation(program, "style"),
    wireWidth: gl.getUniformLocation(program, "wireWidth"),
    textureGrain: gl.getUniformLocation(program, "textureGrain"),
    textureDepth: gl.getUniformLocation(program, "textureDepth"),
    colorDirection: gl.getUniformLocation(program, "colorDirection"),
    waterColor: gl.getUniformLocation(program, "waterColor"),
    grassColor: gl.getUniformLocation(program, "grassColor"),
    rockColor: gl.getUniformLocation(program, "rockColor"),
    snowColor: gl.getUniformLocation(program, "snowColor"),
    downSlopeColor: gl.getUniformLocation(program, "downSlopeColor"),
    directionColor: gl.getUniformLocation(program, "directionColor"),
    skyColor: gl.getUniformLocation(program, "skyColor"),
  };
}

function terrainSurfaceResourcesValid(gl, resources) {
  if (!gl || !resources?.program || !resources?.vertexBuffer || !resources?.indexBuffer) return false;
  try {
    return gl.isProgram(resources.program) && gl.getProgramParameter(resources.program, gl.LINK_STATUS) &&
      gl.isBuffer(resources.vertexBuffer) && gl.isBuffer(resources.indexBuffer);
  } catch (error) {
    console.warn("[VJ1_TERRAIN_SURFACE_RESOURCE_CHECK_FAILED]", { fallback: "recreate terrain surface resources", message: error?.message || String(error) });
    return false;
  }
}

export function disposeTerrainSurfaceResources(gl, resources) {
  if (!gl || !resources) return;
  try {
    disposeRawWebGlVertexArray(gl, resources);
    if (resources.vertexBuffer && gl.isBuffer(resources.vertexBuffer)) gl.deleteBuffer(resources.vertexBuffer);
    if (resources.indexBuffer && gl.isBuffer(resources.indexBuffer)) gl.deleteBuffer(resources.indexBuffer);
    if (resources.program && gl.isProgram(resources.program)) gl.deleteProgram(resources.program);
  } catch {}
}

function terrainRawUniformLocations(gl, program) {
  return {
    time: gl.getUniformLocation(program, "time"),
    flightSpeed: gl.getUniformLocation(program, "flightSpeed"),
    flightMode: gl.getUniformLocation(program, "flightMode"),
    turn: gl.getUniformLocation(program, "turn"),
    altitude: gl.getUniformLocation(program, "altitude"),
    pitch: gl.getUniformLocation(program, "pitch"),
    fieldOfView: gl.getUniformLocation(program, "fieldOfView"),
    nearClip: gl.getUniformLocation(program, "nearClip"),
    farClip: gl.getUniformLocation(program, "farClip"),
    aspectRatio: gl.getUniformLocation(program, "aspectRatio"),
    lookAhead: gl.getUniformLocation(program, "lookAhead"),
    noseFollow: gl.getUniformLocation(program, "noseFollow"),
    mountainHeight: gl.getUniformLocation(program, "mountainHeight"),
    terrainScale: gl.getUniformLocation(program, "terrainScale"),
    terrainPhase: gl.getUniformLocation(program, "terrainPhase"),
    lakeLevel: gl.getUniformLocation(program, "lakeLevel"),
    viewDistance: gl.getUniformLocation(program, "viewDistance"),
    rowSpacing: gl.getUniformLocation(program, "rowSpacing"),
    globeRadius: gl.getUniformLocation(program, "globeRadius"),
    gridDensity: gl.getUniformLocation(program, "gridDensity"),
    gridCells: gl.getUniformLocation(program, "gridCells"),
    cellScale: gl.getUniformLocation(program, "cellScale"),
    planeSize: gl.getUniformLocation(program, "planeSize"),
    wireColor: gl.getUniformLocation(program, "wireColor"),
    contentPlacementMatrix: gl.getUniformLocation(program, "contentPlacementMatrix"),
  };
}

function updateTerrainSurfaceBuffers(gl, resources, widthCells, depthCells, baseRow) {
  const sizeKey = `${widthCells}:${depthCells}`;
  if (resources.meshSizeKey !== sizeKey) {
    gl.bindBuffer(gl.ARRAY_BUFFER, resources.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, terrainSurfaceGridVertices(widthCells, depthCells), gl.STATIC_DRAW);
    resources.meshSizeKey = sizeKey;
    resources.topologyKey = "";
  }
  const topologyKey = `${sizeKey}:${baseRow}`;
  if (resources.topologyKey !== topologyKey) {
    const indices = terrainSurfaceTriangleIndices(widthCells, depthCells, baseRow);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, resources.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.DYNAMIC_DRAW);
    resources.count = indices.length;
    resources.topologyKey = topologyKey;
  }
}

export function drawTerrainWireframe(target, resourceCache, params, componentTime, planeWidth, planeDepth, renderRequest = {}) {
  const gl = target?.drawingContext;
  if (!gl) return false;
  const viewportSize = renderTargetPixelSize(target);
  const passState = beginRawWebGlState(gl, "terrain-wire");
  let attributeStates = [];
  let resources = null;
  let completed = false;
  try {
  resources = resourceCache.get(gl);
  if (resources && !terrainWireResourcesValid(gl, resources)) {
    disposeTerrainWireResources(gl, resources);
    resourceCache.delete(gl);
    resources = null;
  }
  if (!resources) {
    resources = createTerrainWireResources(gl);
    if (!resources) return false;
    resourceCache.set(gl, resources);
  }
  const flightSpeed = Math.max(0, Number(params.flightSpeed) || 0);
  const widthCells = terrainGridSize(params.gridWidth);
  const depthCells = terrainGridSize(params.gridDepth);
  const tessellatedWidth = terrainTessellationSize(widthCells, params.gridDensity);
  const tessellatedDepth = terrainTessellationSize(depthCells, params.gridDensity);
  const { travelRows } = terrainRowMetrics(componentTime, flightSpeed, depthCells, params.gridDensity, params.gridScale);
  const baseRow = Math.floor(travelRows) - 1;
  attributeStates = captureRawWebGlAttributes(gl, passState, [resources.start, resources.end, resources.side, resources.along]);
  bindRawWebGlVertexArray(gl, passState, resources);
  updateTerrainWireBuffer(gl, resources, tessellatedWidth, tessellatedDepth);
  const wireColor = normalizedModelColor(params.wireColor, [242, 245, 239, 255]);
  gl.useProgram(resources.program);
  gl.viewport(0, 0, viewportSize.width, viewportSize.height);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.CULL_FACE);
  const stride = 6 * 4;
  gl.bindBuffer(gl.ARRAY_BUFFER, resources.vertexBuffer);
  gl.enableVertexAttribArray(resources.start);
  gl.vertexAttribPointer(resources.start, 2, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(resources.end);
  gl.vertexAttribPointer(resources.end, 2, gl.FLOAT, false, stride, 2 * 4);
  gl.enableVertexAttribArray(resources.side);
  gl.vertexAttribPointer(resources.side, 1, gl.FLOAT, false, stride, 4 * 4);
  gl.enableVertexAttribArray(resources.along);
  gl.vertexAttribPointer(resources.along, 1, gl.FLOAT, false, stride, 5 * 4);
  setTerrainRawUniforms(gl, resources, params, componentTime, planeWidth, planeDepth, wireColor);
  gl.uniform2f(resources.meshCells, tessellatedWidth, tessellatedDepth);
  gl.uniform1f(resources.gridBaseRow, baseRow);
  gl.uniform1f(resources.gridIrregularity, normalizedTerrainIrregularity(params.gridJitter));
  gl.uniform2f(resources.resolution, viewportSize.width, viewportSize.height);
  gl.uniform1f(resources.thickness, resolutionScaledStrokeWidth(
    Math.max(0.5, Number(params.wireWidth) || 0.85),
    renderRequest,
    viewportSize
  ));
  gl.drawArrays(gl.TRIANGLES, 0, resources.count);
  completed = true;
  } finally {
    restoreRawWebGlState(gl, passState, attributeStates);
  }
  return completed;
}

function renderTargetPixelSize(target) {
  const shared = isSharedFramebufferTarget(target);
  const density = shared
    ? 1
    : Math.max(0.25, Number(target?.pixelDensity?.()) || Number(target?.__vj1PixelDensity) || 1);
  return {
    width: Math.max(1, Math.round((Number(target?.width) || 1) * density)),
    height: Math.max(1, Math.round((Number(target?.height) || 1) * density)),
  };
}

function terrainWireResourcesValid(gl, resources) {
  if (!gl || !resources?.program || !resources?.vertexBuffer) return false;
  try {
    return gl.isProgram(resources.program) &&
      gl.getProgramParameter(resources.program, gl.LINK_STATUS) &&
      gl.isBuffer(resources.vertexBuffer);
  } catch (error) {
    console.warn("[VJ1_TERRAIN_WIRE_RESOURCE_CHECK_FAILED]", { fallback: "recreate terrain wire resources", message: error?.message || String(error) });
    return false;
  }
}

export function disposeTerrainWireResources(gl, resources) {
  if (!gl || !resources) return;
  try {
    disposeRawWebGlVertexArray(gl, resources);
    if (resources.vertexBuffer && gl.isBuffer(resources.vertexBuffer)) gl.deleteBuffer(resources.vertexBuffer);
    if (resources.program && gl.isProgram(resources.program)) gl.deleteProgram(resources.program);
  } catch {}
}

function createTerrainWireResources(gl) {
  const vertex = compileRawShader(gl, gl.VERTEX_SHADER, `
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
  `);
  const fragment = compileRawShader(gl, gl.FRAGMENT_SHADER, `
    precision highp float;
    uniform vec4 wireColor;
    uniform float viewDistance;
    varying float vDepth;
    void main() {
      float fogStart = mix(0.94, 0.58, clamp(viewDistance, 0.0, 3.0) / 1.5);
      float alpha = wireColor.a * (1.0 - smoothstep(fogStart, 1.0, vDepth));
      gl_FragColor = vec4(wireColor.rgb * alpha, alpha);
    }
  `);
  const program = linkSpecializedProgram(gl, vertex, fragment);
  if (!program) return null;
  const vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, 0, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  return {
    program,
    vertexBuffer,
    count: 0,
    meshKey: "",
    start: gl.getAttribLocation(program, "aStart"),
    end: gl.getAttribLocation(program, "aEnd"),
    side: gl.getAttribLocation(program, "aSide"),
    along: gl.getAttribLocation(program, "aAlong"),
    ...terrainRawUniformLocations(gl, program),
    meshCells: gl.getUniformLocation(program, "meshCells"),
    gridBaseRow: gl.getUniformLocation(program, "gridBaseRow"),
    gridIrregularity: gl.getUniformLocation(program, "gridIrregularity"),
    resolution: gl.getUniformLocation(program, "resolution"),
    thickness: gl.getUniformLocation(program, "thickness"),
  };
}

function updateTerrainWireBuffer(gl, resources, widthCells, depthCells) {
  const meshKey = `${widthCells}:${depthCells}`;
  if (resources.meshKey === meshKey) return;
  const vertices = terrainExpandedGridWireVertices(widthCells, depthCells);
  gl.bindBuffer(gl.ARRAY_BUFFER, resources.vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  resources.count = vertices.length / 6;
  resources.meshKey = meshKey;
}

function setTerrainRawUniforms(gl, resources, params, componentTime, planeWidth, planeDepth, wireColor) {
  gl.uniform1f(resources.time, componentTime);
  gl.uniform1f(resources.flightSpeed, Math.max(0, Number(params.flightSpeed) || 0));
  gl.uniform1f(resources.flightMode, params.flightMode === "terrainFollow" ? 1 : 0);
  gl.uniform1f(resources.turn, Math.max(-1, Math.min(1, Number(params.turn) || 0)));
  gl.uniform1f(resources.altitude, Math.max(0.2, Number(params.altitude) || 2.5));
  gl.uniform1f(resources.pitch, Math.max(-1.4, Number(params.pitch) || 0.28));
  gl.uniform1f(resources.fieldOfView, Math.max(20, Math.min(120, Number(params.fieldOfView) || 60)));
  gl.uniform1f(resources.nearClip, terrainSafeNearDistance(params));
  gl.uniform1f(resources.farClip, Math.max(100, Number(params.farClip) || 20000));
  gl.uniform1f(resources.aspectRatio, planeWidth / Math.max(1, planeDepth));
  gl.uniform1f(resources.lookAhead, Math.max(0.1, Number(params.lookAhead) || 14));
  gl.uniform1f(resources.noseFollow, Number.isFinite(Number(params.noseFollow)) ? Math.max(0, Number(params.noseFollow)) : 1);
  gl.uniform1f(resources.mountainHeight, Math.max(0.05, Number(params.mountainHeight) || 2.4));
  gl.uniform1f(resources.terrainScale, Math.max(0.02, Number(params.terrainScale) || 0.62));
  gl.uniform2fv(resources.terrainPhase, params.terrainPhase || [0, 0]);
  gl.uniform1f(resources.lakeLevel, Number.isFinite(Number(params.lakeLevel)) ? Number(params.lakeLevel) : -0.12);
  gl.uniform1f(resources.viewDistance, Math.max(0, Number(params.viewDistance) || 0));
  const gridMetrics = terrainRowMetrics(componentTime, Math.max(0, Number(params.flightSpeed) || 0), params.gridDepth, params.gridDensity, params.gridScale);
  gl.uniform1f(resources.rowSpacing, gridMetrics.rowSpacing);
  gl.uniform1f(resources.cellScale, gridMetrics.cellScale);
  gl.uniform1f(resources.globeRadius, Math.max(60, Number(params.globeRadius) || 280));
  gl.uniform1f(resources.gridDensity, Math.max(0.25, Number(params.gridDensity) || 1));
  gl.uniform2f(resources.gridCells, terrainGridSize(params.gridWidth), terrainGridSize(params.gridDepth));
  gl.uniform2f(resources.planeSize, planeWidth, planeDepth);
  gl.uniform4fv(resources.wireColor, wireColor);
  gl.uniformMatrix3fv(resources.contentPlacementMatrix, false, params.contentPlacementMatrix || [
    1, 0, 0,
    0, 1, 0,
    0, 0, 1,
  ]);
}
