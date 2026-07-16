import { VJ1 } from "../constants.js";
import { componentFrameMetrics } from "../domain/component-frame.js";
import { componentTextureSize, manualSurfaceTextureLimit } from "../domain/render-resolution.js?v=direct-surface-view-17";
import { clamp01, normalizeComponentPipelineSettings, resolveSceneSourceNode, sanitizeState } from "../domain/models.js?v=direct-surface-view-17";
import { normalizeParamValue, normalizeParamValues, renderQualityScale, renderQualityValue } from "../graph/component-schema.js?v=direct-surface-view-17";
import { createManualScheduler } from "../graph/manual-scheduler.js";
import { RenderNodeRuntime, textureStateKey } from "../graph/render-node-runtime.js?v=direct-surface-view-17";
import { createPlacedRenderResult, directPlacementKind, transformedPlacementDemandRect } from "../graph/placed-render-result.js?v=direct-surface-view-17";
import { compileComponentPatch, compileShaderSchedule, flattenComponentChain, fuseLocalShaderSchedule, isFusibleShaderJob } from "../graph/render-scheduler.js?v=direct-surface-view-17";
import { getGeneratorComponent } from "../graph/generator-registry.js?v=direct-surface-view-17";
import { createShaderBuilder, fusedUniformName } from "../shaders/shader-builder.js?v=direct-surface-view-17";
import { getGeneratorShaderComponent } from "../shaders/generator-shaders.js?v=direct-surface-view-17";
import { getShaderComponent } from "../shaders/shader-registry.js?v=direct-surface-view-17";
import { applyBlend } from "./blend-utils.js";
import {
  createSharedFramebufferTarget,
  isSharedFramebufferTarget,
  unwrapRenderTarget,
} from "./shared-framebuffer-target.js?v=direct-surface-view-17";
import { applyFontToGlobal, applyFontToTarget } from "./font-loader.js?v=direct-surface-view-17";
import { drawGenerator, drawStandby } from "./generators.js?v=direct-surface-view-17";
import { drawCover, drawMediaFit, isDrawableMedia, syncVideoPlayback } from "./media-utils.js";
import {
  createRenderRequest,
  frameRenderRequest,
  frameSize,
  outputFrameForId,
  outputFrames,
  outputFrameOffset,
  renderRequestKey,
  RECORDING_FRAME_DEMAND_SCALE,
  sourceRenderDemand,
  outputSpanRect,
  worldSize,
} from "./render-geometry.js?v=direct-surface-view-17";
import { VjMapper } from "./vj-mapper.js?v=direct-surface-view-17";
import { mediaRenditionKey } from "../services/media-rendition-service.js";

const TERRAIN_GRID_CELLS = 48;

const OVERLAY_BLEND_VERTEX_SHADER = `
precision mediump float;
attribute vec3 aPosition;
attribute vec2 aTexCoord;
uniform mat4 uModelViewMatrix;
uniform mat4 uProjectionMatrix;
varying vec2 vTexCoord;
void main() {
  vTexCoord = aTexCoord;
  gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aPosition, 1.0);
}`;

const OVERLAY_BLEND_FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D baseTex;
uniform sampler2D layerTex;
uniform bool baseFlipY;
uniform bool layerFlipY;
uniform mat3 layerUvMatrix;
uniform float layerOpacity;
varying vec2 vTexCoord;

vec2 sourceUv(vec2 uv, bool flipY) {
  return flipY ? vec2(uv.x, 1.0 - uv.y) : uv;
}

vec3 overlayColor(vec3 base, vec3 layer) {
  vec3 low = 2.0 * base * layer;
  vec3 high = 1.0 - 2.0 * (1.0 - base) * (1.0 - layer);
  return mix(low, high, step(vec3(0.5), base));
}

void main() {
  vec4 base = texture2D(baseTex, sourceUv(vTexCoord, baseFlipY));
  vec2 layerUv = (layerUvMatrix * vec3(vTexCoord, 1.0)).xy;
  float inside = step(0.0, layerUv.x) * step(layerUv.x, 1.0) *
    step(0.0, layerUv.y) * step(layerUv.y, 1.0);
  vec4 layer = texture2D(layerTex, sourceUv(clamp(layerUv, 0.0, 1.0), layerFlipY));
  layer *= layerOpacity * inside;
  float baseAlpha = base.a;
  float layerAlpha = layer.a;
  vec3 baseStraight = baseAlpha > 0.0001 ? base.rgb / baseAlpha : vec3(0.0);
  vec3 layerStraight = layerAlpha > 0.0001 ? layer.rgb / layerAlpha : vec3(0.0);
  vec3 blended = overlayColor(baseStraight, layerStraight);
  float outAlpha = baseAlpha + layerAlpha - baseAlpha * layerAlpha;
  vec3 outRgb = base.rgb * (1.0 - layerAlpha) +
    layer.rgb * (1.0 - baseAlpha) + blended * baseAlpha * layerAlpha;
  gl_FragColor = vec4(outRgb, outAlpha);
}`;

const LAYER_TRANSFORM_VERTEX_SHADER = OVERLAY_BLEND_VERTEX_SHADER;

const LAYER_TRANSFORM_FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D sourceTex;
uniform bool sourceFlipY;
uniform mat3 sourceUvMatrix;
varying vec2 vTexCoord;

vec2 sourceUv(vec2 uv) {
  return sourceFlipY ? vec2(uv.x, 1.0 - uv.y) : uv;
}

void main() {
  vec2 uv = (sourceUvMatrix * vec3(vTexCoord, 1.0)).xy;
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) *
    step(0.0, uv.y) * step(uv.y, 1.0);
  vec4 color = texture2D(sourceTex, sourceUv(clamp(uv, 0.0, 1.0)));
  gl_FragColor = color * inside;
}`;

const COMPONENT_UPSCALE_FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D sourceTex;
uniform vec2 sourceResolution;
uniform bool sourceFlipY;
varying vec2 vTexCoord;

vec2 sourceUv(vec2 uv) {
  return sourceFlipY ? vec2(uv.x, 1.0 - uv.y) : uv;
}

float luma(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec2 texel = 1.0 / max(sourceResolution, vec2(1.0));
  vec2 uv = sourceUv(vTexCoord);
  vec4 center = texture2D(sourceTex, uv);
  vec4 left = texture2D(sourceTex, uv - vec2(texel.x, 0.0));
  vec4 right = texture2D(sourceTex, uv + vec2(texel.x, 0.0));
  vec4 up = texture2D(sourceTex, uv - vec2(0.0, texel.y));
  vec4 down = texture2D(sourceTex, uv + vec2(0.0, texel.y));
  vec4 neighborhood = (left + right + up + down) * 0.25;
  float edge = clamp(
    abs(luma(left.rgb) - luma(right.rgb)) +
    abs(luma(up.rgb) - luma(down.rgb)),
    0.0,
    1.0
  );
  float sharpen = mix(0.06, 0.18, edge);
  vec4 color = center + (center - neighborhood) * sharpen;
  color.a = clamp(color.a, 0.0, 1.0);
  color.rgb = clamp(color.rgb, vec3(0.0), vec3(color.a));
  gl_FragColor = color;
}`;

const COMPONENT_POST_FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D sourceTex;
uniform bool sourceFlipY;
uniform float time;
uniform float noiseAmount;
uniform float grayscaleAmount;
varying vec2 vTexCoord;

vec2 sourceUv(vec2 uv) {
  return sourceFlipY ? vec2(uv.x, 1.0 - uv.y) : uv;
}

float hash(vec2 point) {
  vec3 p3 = fract(vec3(point.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec4 color = texture2D(sourceTex, sourceUv(vTexCoord));
  if (color.a <= 0.0001) {
    gl_FragColor = vec4(0.0);
    return;
  }
  vec3 straight = color.rgb / color.a;
  float gray = dot(straight, vec3(0.2126, 0.7152, 0.0722));
  straight = mix(straight, vec3(gray), clamp(grayscaleAmount, 0.0, 1.0));
  vec2 noiseSeed = gl_FragCoord.xy + floor(time * 60.0) * vec2(37.0, 17.0);
  float grain = hash(noiseSeed) * 2.0 - 1.0;
  straight = clamp(straight + grain * noiseAmount, 0.0, 1.0);
  gl_FragColor = vec4(straight * color.a, color.a);
}`;

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
  float nearPlane = max(nearClip, 0.01);
  float farPlane = max(farClip, nearPlane + 1.0);
  float clipZ = ((farPlane + nearPlane) / (farPlane - nearPlane)) * cameraZ
    - (2.0 * farPlane * nearPlane) / (farPlane - nearPlane);
  gl_Position = vec4(
    worldLateral * focalLength / max(aspectRatio, 0.01),
    -cameraY * focalLength,
    clipZ,
    cameraZ
  );
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

export class OutputRenderer {
  constructor({ mode, outputId = "", hud, font, sendMetrics, sendMapping, sendThumbnail, sendChainTransform, sendCanvasFrame, sendMediaRendition, requestMediaFiles, onSurfaceSelect }) {
    this.mode = mode;
    this.outputId = outputId;
    this.hud = hud;
    this.font = font || null;
    this.sendMetrics = sendMetrics;
    this.sendMapping = sendMapping;
    this.sendThumbnail = sendThumbnail;
    this.sendChainTransform = sendChainTransform;
    this.sendCanvasFrame = sendCanvasFrame;
    this.sendMediaRendition = sendMediaRendition;
    this.requestMediaFiles = requestMediaFiles;
    this.onSurfaceSelect = onSurfaceSelect;
    this.state = null;
    this.mapper = null;
    this.componentSource = new Map();
    this.componentOutput = new Map();
    this.componentBuffer = new Map();
    this.componentGpuBuffer = new Map();
    this.stableComponentSignatures = new Map();
    this.chainNodeRuntimes = new Map();
    this.sourceNodeRuntimes = new Map();
    this.componentSourceUse = new Map();
    this.componentBufferUse = new Map();
    this.componentGpuBufferUse = new Map();
    this.componentPatches = new Map();
    this.thumbnailImages = new Map();
    this.thumbnailEditTransformBaselines = new Map();
    this.media = new Map();
    // Specialized 3D sources render sequentially and are copied into the
    // component target immediately. Terrain uses a framebuffer in the main
    // WebGL context so resizing its scratch target cannot invalidate p5's
    // cross-context canvas texture cache. Model rendering still falls back to
    // its dedicated p5.Graphics context because it uses p5's 3D drawing API.
    this.specializedWebglTargets = new Map();
    this.terrainSurfaceResources = new Map();
    this.terrainWireResources = new Map();
    this.pendingRenditionSaves = new Set();
    this.sourcePg = null;
    this.fxTargets = [null, null];
    this.fxTargetKey = "";
    this.fxTargetGroups = new Map();
    this.mainMix = null;
    this.surfaceTextures = new Map();
    this.transitionSurfaceTextures = new Map();
    this.activeTransitionTextureId = "";
    this.surfaceRenderIdentityPrefix = "";
    this.transitionSurfaceEffectPrefix = "";
    this.cameraCapture = null;
    this.cameraRequested = false;
    this.cameraError = "";
    this.cameraCaptureSignature = "";
    this.cameraRequestToken = 0;
    this.chainTransformDrag = null;
    this.canvasFrameDrag = null;
    this.mapperSurfaces = new Map();
    this.mappingSignature = "";
    this.localMappingSignature = "";
    this.localMappingProtectedUntil = 0;
    this.lastMetricsAt = 0;
    this.lastMediaRequestAt = 0;
    this.lastThumbnailAt = 0;
    this.thumbnailSignatures = new Map();
    this.smoothedFrameMs = 0;
    this.smoothedFps = 0;
    this.smoothedRenderCost = 0;
    this.smoothedGpuMs = 0;
    this.lastGpuSampleId = -1;
    this.gpuTimer = new GpuTimerTracker();
    this.lastPixelDensity = 0;
    this.frameStart = 0;
    this.frameProfile = createEmptyFrameProfile();
    this.lastFrameProfile = createEmptyFrameProfile();
    this.componentProfileDepth = 0;
    this.lastTickMs = 0;
    this.frameDeltaSeconds = 0;
    this.visualTime = 0;
    this.frameIndex = 0;
    this.outputMediaStatus = createMediaReadinessStatus();
    this.scheduledEvents = [];
    this.manualScheduler = createManualScheduler();
    this.componentTimes = new Map();
    this.rateClocks = new Map();
    this.terrainScalePhases = new Map();
    this.cachedNoiseTexture = null;
    this.overlayBlendShader = null;
    this.layerTransformShader = null;
    this.componentPipelineShaders = new Map();
    this.shaderBuilder = createShaderBuilder({
      getCustomCode: () => this.state?.shaders?.customCode || "",
      onStatus: (status, error) => {
        this.state.ui.shaderStatus = status;
        this.state.ui.shaderError = error || "";
      },
    });
  }

  async setup(initialState) {
    this.state = sanitizeState(initialState || {});
    if (this.shouldUseThumbnailPreview()) this.captureThumbnailEditTransformBaselines();
    this.applyPixelDensity();
    this.applyGlobalFont();
    this.createBuffers();
    this.createMapper();
    this.setCalibrate(this.shouldCalibrateFromState());
  }

  dispose() {
    this.gpuTimer?.dispose?.();
    this.disposeBuffers();
    this.mapperSurfaces?.clear?.();
    this.mapper?.surfaces?.splice?.(0);
    this.releaseCameraCapture();
    for (const item of this.media?.values?.() || []) {
      if (item?.url) URL.revokeObjectURL(item.url);
      for (const url of item?.renditionUrls?.values?.() || []) URL.revokeObjectURL(url);
    }
    this.media?.clear?.();
  }

  applyGlobalFont() {
    applyFontToGlobal(this.font);
    this.applyFontToAllGraphics();
  }

  applyGraphicsFont(pg) {
    applyFontToTarget(pg, this.font);
  }

  applyFontToAllGraphics() {
    this.applyGraphicsFont(this.sourcePg);
    this.applyGraphicsFont(this.mainMix);
    for (const pg of this.surfaceTextures?.values?.() || []) this.applyGraphicsFont(pg);
    for (const pg of this.transitionSurfaceTextures?.values?.() || []) this.applyGraphicsFont(pg);
    for (const group of this.fxTargetGroups?.values?.() || []) {
      for (const target of group.targets || []) this.applyGraphicsFont(target);
    }
    for (const pg of this.componentSource?.values?.() || []) this.applyGraphicsFont(pg);
    for (const pg of this.componentOutput?.values?.() || []) this.applyGraphicsFont(pg);
    for (const pg of this.componentBuffer?.values?.() || []) this.applyGraphicsFont(pg);
  }

  createBuffers() {
    this.disposeBuffers();
    this.applyPixelDensity();
    const { width: rw, height: rh } = this.outputFrameSize(this.state.render);
    this.sourcePg = createGraphics(rw, rh);
    this.mainMix = createSharedFramebufferTarget(rw, rh) || createGraphics(rw, rh);
    this.applyGraphicsPixelDensity(this.sourcePg);
    this.applyGraphicsPixelDensity(this.mainMix);
    this.applyGraphicsFont(this.sourcePg);
    this.applyGraphicsFont(this.mainMix);
  }

  buffersMatchRenderSize() {
    if (!this.state) return false;
    const { width: rw, height: rh } = this.outputFrameSize(this.state.render);
    return this.sourcePg?.width === rw &&
      this.sourcePg?.height === rh &&
      this.mainMix?.width === rw &&
      this.mainMix?.height === rh;
  }

  disposeBuffers() {
    this.resetModelResources();
    this.resetTerrainResources();
    disposeGraphics(this.sourcePg);
    disposeGraphics(this.mainMix);
    disposeGraphicsMap(this.surfaceTextures);
    disposeGraphicsMap(this.transitionSurfaceTextures);
    this.disposeFxTargetGroups();
    disposeGraphicsMap(this.specializedWebglTargets);
    disposeGraphicsMap(this.componentSource);
    // Frame-local aliases; componentGpuBuffer owns these targets.
    this.componentOutput.clear();
    disposeGraphicsMap(this.componentBuffer);
    disposeGraphicsMap(this.componentGpuBuffer);
    this.stableComponentSignatures?.clear?.();
    this.chainNodeRuntimes?.clear?.();
    this.sourceNodeRuntimes?.clear?.();
    this.componentSourceUse?.clear?.();
    this.componentBufferUse?.clear?.();
    this.componentGpuBufferUse?.clear?.();
    this.sourcePg = null;
    this.mainMix = null;
    this.surfaceTextures?.clear?.();
    this.transitionSurfaceTextures?.clear?.();
    this.activeTransitionTextureId = "";
    this.fxTargets = [null, null];
    this.fxTargetKey = "";
    this.specializedWebglTargets?.clear?.();
    this.shaderBuilder.clear?.();
    this.cachedNoiseTexture = null;
    this.overlayBlendShader = null;
    this.layerTransformShader = null;
    this.componentPipelineShaders?.clear?.();
  }

  getCachedNoiseTexture() {
    if (this.cachedNoiseTexture) return this.cachedNoiseTexture;
    if (typeof createImage !== "function") return null;
    const size = 256;
    const noiseImage = createImage(size, size);
    noiseImage.loadPixels();
    let state = 0x9e3779b9;
    for (let index = 0; index < size * size; index++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      const value = state >>> 24;
      const offset = index * 4;
      noiseImage.pixels[offset] = value;
      noiseImage.pixels[offset + 1] = value;
      noiseImage.pixels[offset + 2] = value;
      noiseImage.pixels[offset + 3] = 255;
    }
    noiseImage.updatePixels();
    this.cachedNoiseTexture = noiseImage;
    return noiseImage;
  }

  setEffectInfrastructureUniforms(shaderProgram, transform = {}) {
    const uniforms = effectTransformUniforms(transform);
    shaderProgram.setUniform("effectTransform", uniforms.transform);
    shaderProgram.setUniform("effectUvMatrix", uniforms.forward);
    shaderProgram.setUniform("inverseEffectUvMatrix", uniforms.inverse);
    const noiseTexture = this.getCachedNoiseTexture();
    if (noiseTexture) {
      setShaderUniformIfPresent(shaderProgram, "noiseTex", noiseTexture);
      setShaderUniformIfPresent(shaderProgram, "noiseTextureSize", [noiseTexture.width, noiseTexture.height]);
    }
  }

  resetTerrainResources() {
    for (const [gl, resources] of this.terrainSurfaceResources?.entries?.() || []) {
      disposeTerrainSurfaceResources(gl, resources);
    }
    for (const [gl, resources] of this.terrainWireResources?.entries?.() || []) {
      disposeTerrainWireResources(gl, resources);
    }
    this.terrainSurfaceResources?.clear?.();
    this.terrainWireResources?.clear?.();
  }

  resetModelResources(gl = null) {
    for (const item of this.media?.values?.() || []) {
      const renderers = item?.modelRawRenderers;
      if (!(renderers instanceof Map)) continue;
      for (const [context, resources] of renderers) {
        if (gl && context !== gl) continue;
        disposeRawModelContextResources(context, resources);
        renderers.delete(context);
      }
    }
  }

  disposeFxTargetGroups() {
    const seen = new Set();
    for (const group of this.fxTargetGroups?.values?.() || []) {
      for (const target of group.targets || []) {
        if (!target || seen.has(target)) continue;
        seen.add(target);
        disposeGraphics(target);
      }
    }
    this.fxTargetGroups?.clear?.();
  }

  createMapper() {
    this.mapper = new VjMapper({
      onConfigChange: (mapping, meta = {}) => {
        this.emitMapping(mapping, mappingStatusForReason(meta.reason), {
          live: meta.reason === "drag",
        });
      },
    });
    this.syncMapperOverlayMode();
    this.syncMapperEdgeSoftness();
    this.rebuildSurfaces();
    this.applyProjectMapping();
  }

  rebuildSurfaces() {
    if (!this.mapper) return;
    const existingCorners = new Map((this.mapper.surfaces || []).map((surface) => [
      surface.id || surface.name,
      Array.isArray(surface.corners)
        ? surface.corners.map((corner) => ({ x: corner.x, y: corner.y }))
        : null,
    ]));
    this.mapper.clearSurfaces();
    this.mapperSurfaces.clear();
    const frame = this.outputFrameSize(this.state.render);
    const offset = this.mode === "output" ? { x: 0, y: 0 } : this.outputFrameOffset();
    const mappedSurfaces = this.state.surfaces.filter((surface) => surface.destination?.type !== "direct");
    const cols = Math.max(1, Math.ceil(Math.sqrt(mappedSurfaces.length || 1)));
    const rows = Math.max(1, Math.ceil((mappedSurfaces.length || 1) / cols));
    const gap = Math.max(24, Math.round(Math.min(frame.width, frame.height) * 0.035));
    const cellW = Math.max(1, (frame.width - gap * (cols + 1)) / cols);
    const texture = componentTextureSize(this.state.render);
    const idealCellH = cellW * (texture.height / texture.width);
    const maxCellH = Math.max(1, (frame.height - gap * (rows + 1)) / rows);
    const cellH = Math.min(idealCellH, maxCellH);
    const frameX = offset.x;
    const frameY = offset.y;
    for (const surface of this.state.surfaces) {
      if (surface.destination?.type !== "direct") continue;
      const corners = this.directSurfaceCorners(surface);
      if (!corners) continue;
      const rect = cornersRect(corners);
      this.mapperSurfaces.set(surface.id, {
        direct: true,
        directRect: rect,
        mapperSurface: { id: surface.id, name: surface.id, w: rect.width, h: rect.height, corners, renderCache: null },
        renderRequest: stableSurfaceRenderRequest(this.state.render, { surfaceId: surface.id }),
      });
    }
    mappedSurfaces.forEach((surface, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = frameX + gap + col * (cellW + gap);
      const y = frameY + gap + row * (cellH + gap);
      const preserved = existingCorners.get(surface.id);
      const corners = preserved?.length === 4
        ? preserved
        : [
            { x, y },
            { x: x + cellW, y },
            { x: x + cellW, y: y + cellH },
            { x, y: y + cellH },
          ];
      const mapperSurface = this.mapper.addSurface({
        id: surface.id,
        name: surface.id,
        width: texture.width,
        height: texture.height,
        corners,
      });
      this.mapperSurfaces.set(surface.id, { mapperSurface, renderRequest: stableSurfaceRenderRequest(this.state.render, { surfaceId: surface.id }) });
    });
  }

  directSurfaceCorners(surface) {
    const rect = outputSpanRect(this.state?.render || {}, surface.destination?.outputIds || []);
    if (!rect) return null;
    let x = rect.x;
    let y = rect.y;
    let widthPx = rect.width;
    let heightPx = rect.height;
    if (this.mode === "output") {
      const offset = this.outputFrameOffset();
      const transform = this.outputFrameTransform();
      x = (x - offset.x) * transform.scale + transform.x;
      y = (y - offset.y) * transform.scale + transform.y;
      widthPx *= transform.scale;
      heightPx *= transform.scale;
    }
    return rectToCorners({ x, y, width: widthPx, height: heightPx });
  }

  setState(nextState) {
    const wasThumbnailPreview = this.shouldUseThumbnailPreview();
    const previousCameraSignature = cameraSettingsSignature(this.state?.render);
    const previousSurfaceIds = (this.state?.surfaces || []).map((surface) => surface.id).join(",");
    const previousSize = this.state ? this.renderSizeSignature(this.state.render) : "";
    const previousMappingSignature = this.mappingSignature;
    this.state = sanitizeState(nextState);
    const nextCameraSignature = cameraSettingsSignature(this.state.render);
    if (previousCameraSignature && previousCameraSignature !== nextCameraSignature) this.releaseCameraCapture();
    const isThumbnailPreview = this.shouldUseThumbnailPreview();
    if (isThumbnailPreview && !wasThumbnailPreview) this.captureThumbnailEditTransformBaselines();
    if (!isThumbnailPreview && wasThumbnailPreview) this.thumbnailEditTransformBaselines.clear();
    const nextSurfaceIds = this.state.surfaces.map((surface) => surface.id).join(",");
    const nextSize = this.renderSizeSignature(this.state.render);
    const nextMappingSignature = this.currentMappingSignature();
    if (previousSize && previousSize !== nextSize) {
      this.createBuffers();
    }
    const surfacesChanged = previousSurfaceIds !== nextSurfaceIds || previousSize !== nextSize;
    if (surfacesChanged) {
      this.rebuildSurfaces();
    }
    if (
      (surfacesChanged || previousMappingSignature !== nextMappingSignature) &&
      !this.mapper?.isActive?.() &&
      !this.shouldIgnoreIncomingMapping(nextMappingSignature)
    ) {
      this.applyProjectMapping(nextMappingSignature);
    }
    this.setCalibrate(this.shouldCalibrateFromState());
    this.syncMapperOverlayMode();
    this.syncMapperEdgeSoftness();
  }

  renderSizeSignature(render = {}) {
    const frame = this.outputFrameSize(render);
    const world = worldSize(render);
    const texture = componentTextureSize(render);
    const surfacePolicy = render.surfaceTexture || {};
    const density = this.renderPixelDensity(render);
    const outputs = outputFrames(render).map((output) => `${output.id}:${output.width}x${output.height}@${output.x},${output.y}`).join("|");
    return `${this.outputId}:${frame.width}x${frame.height}:${outputs}:${world.width}x${world.height}:ct${texture.width}x${texture.height}:st${surfacePolicy.mode || "auto"}:${surfacePolicy.maxWidth || 0}x${surfacePolicy.maxHeight || 0}:pd${density}`;
  }

  outputFrameSize(render = this.state?.render || {}) {
    return frameSize(render, this.mode === "output" ? this.outputId : "");
  }

  displayCanvasSize(render = this.state?.render || {}) {
    const fallback = frameSize(render);
    return {
      width: Math.max(1, Math.floor(Number(typeof width === "number" ? width : fallback.width) || fallback.width)),
      height: Math.max(1, Math.floor(Number(typeof height === "number" ? height : fallback.height) || fallback.height)),
    };
  }

  renderPixelDensity(render = this.state?.render || {}) {
    const configured = Math.max(0.5, Math.min(2, Number(render.pixelDensity) || 1));
    const demandScale = Math.max(0.125, Math.min(1, Number(render.previewRasterScale) || 1));
    return Math.max(0.125, configured * demandScale);
  }

  renderResolutionSize(render = this.state?.render || {}) {
    const frame = this.outputFrameSize(render);
    const density = this.renderPixelDensity(render);
    return {
      width: Math.max(1, Math.round(frame.width * density)),
      height: Math.max(1, Math.round(frame.height * density)),
      density,
    };
  }

  renderResolutionLabel(render = this.state?.render || {}) {
    const size = this.renderResolutionSize(render);
    const densityLabel = size.density === 1 ? "" : ` @${formatDensity(size.density)}x`;
    return `${size.width}x${size.height}${densityLabel}`;
  }

  syncMapperOverlayMode() {
    this.mapper?.setOverlayMode?.(this.state?.global?.mappingHandleMode || "always");
  }

  syncMapperEdgeSoftness() {
    this.mapper?.setEdgeSoftness?.(this.state?.render?.edgeSoftness || 0);
  }

  applyPixelDensity() {
    const density = this.renderPixelDensity(this.state?.render || {});
    if (this.lastPixelDensity === density) return;
    if (typeof pixelDensity === "function") pixelDensity(density);
    this.lastPixelDensity = density;
  }

  applyGraphicsPixelDensity(pg, density = this.renderPixelDensity(this.state?.render || {})) {
    if (!pg?.pixelDensity) return;
    pg.pixelDensity(Math.max(0.25, Math.min(4, Number(density) || 1)));
  }

  requestPixelDensity(request = {}) {
    return request.pixelDensityApplied ? 1 : this.renderPixelDensity(this.state?.render || {});
  }

  shouldCalibrateFromState() {
    if (this.mode === "output") return false;
    return this.mode === "preview" && !!this.state.global.calibrating;
  }

  currentMappingSignature() {
    try {
      return JSON.stringify(this.state?.mappings?.local || null);
    } catch {
      return "";
    }
  }

  applyProjectMapping(signature = this.currentMappingSignature()) {
    const mapping = this.state?.mappings?.local;
    if (mapping?.surfaces?.length) {
      this.mapper?.importConfig?.(this.mappingForRenderMode(mapping), { replace: false, silent: true });
    }
    this.mappingSignature = signature;
  }

  mappingForRenderMode(mapping) {
    if (this.mode !== "output") return mapping;
    const offset = this.outputFrameOffset();
    const frameMapping = offset.x || offset.y
      ? offsetMapping(mapping, -offset.x, -offset.y)
      : mapping;
    const transform = this.outputFrameTransform();
    if (transform.scale === 1 && !transform.x && !transform.y) return frameMapping;
    return transformMapping(frameMapping, transform.scale, transform.scale, transform.x, transform.y);
  }

  outputFrameTransform() {
    const projectFrame = this.outputFrameSize(this.state?.render || {});
    const outputFrame = this.displayCanvasSize(this.state?.render || {});
    const scale = Math.max(
      outputFrame.width / Math.max(1, projectFrame.width),
      outputFrame.height / Math.max(1, projectFrame.height)
    );
    return {
      scale,
      x: (outputFrame.width - projectFrame.width * scale) * 0.5,
      y: (outputFrame.height - projectFrame.height * scale) * 0.5,
    };
  }

  mappingFromRenderMode(mapping) {
    if (this.mode !== "output") return mapping;
    const transform = this.outputFrameTransform();
    const projectFrameMapping = transform.scale === 1 && !transform.x && !transform.y
      ? mapping
      : transformMapping(mapping, 1 / transform.scale, 1 / transform.scale, -transform.x / transform.scale, -transform.y / transform.scale);
    const offset = this.outputFrameOffset();
    if (!offset.x && !offset.y) return projectFrameMapping;
    return offsetMapping(projectFrameMapping, offset.x, offset.y);
  }

  outputFrameOffset() {
    if (this.mode === "output") {
      const frame = outputFrameForId(this.state?.render || {}, this.outputId);
      return { x: frame?.x || 0, y: frame?.y || 0 };
    }
    return outputFrameOffset(this.state?.render || {});
  }

  markLocalMapping(mapping = this.mappingFromRenderMode(this.mapper?.exportData?.())) {
    this.localMappingSignature = mappingSignature(mapping);
    this.localMappingProtectedUntil = performance.now() + 1200;
    this.mappingSignature = this.localMappingSignature;
  }

  shouldIgnoreIncomingMapping(signature) {
    return performance.now() < this.localMappingProtectedUntil &&
      this.localMappingSignature &&
      signature &&
      signature !== this.localMappingSignature;
  }

  importFiles(files) {
    for (const entry of files || []) {
      const file = entry?.file || entry;
      const id = entry?.id || file?.relativePath || file?.webkitRelativePath || file?.name;
      if (!id) continue;
      let item = this.media.get(id);
      if (!item) {
        const url = URL.createObjectURL(file);
        item = { id, file, url, video: null, image: null, imageError: "", model: null, modelData: null, modelGeometry: null, modelGeometryFailed: false, modelPointCloud: null, modelPointCloudKey: "", modelRawRenderers: null, modelError: "", imageRenditions: new Map(), imageRenditionOrder: [], ready: false };
        this.media.set(id, item);
        if (/\.(mp4|m4v|mov|webm|ogv)$/i.test(id)) {
          item.video = createVideo(url, () => {
            item.video.hide();
            item.video.volume?.(0);
            item.video.loop();
            item.ready = true;
          });
          item.video.hide();
        } else if (/\.svg$/i.test(id)) {
          loadSvgImage(url, item);
        } else if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(id)) {
          loadImage(url, (img) => {
            item.image = img;
            item.ready = true;
            item.imageError = "";
          }, (error) => {
            item.imageError = error?.message || String(error || "image load failed");
          });
        } else if (/\.stl$/i.test(id)) {
          file.arrayBuffer()
            .then((buffer) => {
              item.modelData = parseStlMesh(buffer);
              item.ready = true;
              item.modelError = "";
            })
            .catch((error) => {
              item.modelError = error?.message || String(error || "model load failed");
            });
        } else if (/\.obj$/i.test(id)) {
          file.text()
            .then((text) => {
              item.modelData = parseObjMesh(text);
              item.ready = true;
              item.modelError = "";
            })
            .catch((error) => {
              item.modelError = error?.message || String(error || "model load failed");
            });
        }
      }
      this.importMediaRenditions(item, entry?.renditions || []);
    }
  }
  emitMapping(mapping = this.mapper?.exportData?.(), status = "Mapping updated", meta = {}) {
    const projectMapping = this.mappingFromRenderMode(mapping || {});
    this.markLocalMapping(projectMapping);
    this.sendMapping?.("local", projectMapping, status, meta);
  }

  importMediaRenditions(item, renditions) {
    if (!item || !Array.isArray(renditions)) return;
    item.imageRenditions ||= new Map();
    item.imageRenditionOrder ||= [];
    item.renditionUrls ||= new Map();
    for (const rendition of renditions) {
      if (!rendition?.key || !rendition?.file || item.imageRenditions.has(rendition.key)) continue;
      const url = URL.createObjectURL(rendition.file);
      item.renditionUrls.set(rendition.key, url);
      loadImage(
        url,
        (img) => {
          item.imageRenditions.set(rendition.key, img);
          if (!item.imageRenditionOrder.includes(rendition.key)) item.imageRenditionOrder.push(rendition.key);
        },
        () => {
          URL.revokeObjectURL(url);
          item.renditionUrls.delete(rendition.key);
        }
      );
    }
  }

  ensureCameraCapture() {
    const settings = cameraCaptureSettings(this.state?.render);
    const signature = cameraSettingsSignature(this.state?.render);
    if (this.cameraCapture && this.cameraCaptureSignature === signature) return this.cameraCapture;
    if (this.cameraRequested && this.cameraCaptureSignature === signature) return null;
    if (this.cameraCapture || this.cameraRequested) this.releaseCameraCapture();
    this.cameraRequested = true;
    this.cameraError = "";
    this.cameraCaptureSignature = signature;
    const requestToken = ++this.cameraRequestToken;
    const setupWebcamera = getPortalWebcameraSetup();
    if (!setupWebcamera) {
      this.cameraError = "camera unavailable";
      this.cameraRequested = false;
      return null;
    }
    setupWebcamera(settings.front, settings.width, settings.height, settings.mirrored, settings.maxResolution)
      .then((camera) => {
        if (requestToken !== this.cameraRequestToken) {
          camera?.remove?.();
          return;
        }
        this.cameraCapture = camera;
        this.cameraRequested = false;
        this.cameraError = "";
      })
      .catch(() => {
        if (requestToken !== this.cameraRequestToken) return;
        this.cameraError = "camera blocked";
        this.cameraRequested = false;
      });
    return null;
  }

  releaseCameraCapture() {
    this.cameraRequestToken++;
    this.cameraCapture?.remove?.();
    this.cameraCapture = null;
    this.cameraRequested = false;
    this.cameraCaptureSignature = "";
  }

  draw() {
    if (!this.state) return;
    this.gpuTimer.poll(this.frameIndex);
    this.frameStart = performance.now();
    this.frameProfile = createEmptyFrameProfile();
    this.componentProfileDepth = 0;
    this.frameIndex++;
    this.tickClock(this.frameStart);
    this.outputMediaStatus = this.outputMediaReadiness();
    this.scheduledEvents = this.state.scheduler?.manualLane === false
      ? []
      : this.manualScheduler.drain({ frame: this.frameIndex, time: this.visualTime });
    background(0);
    if (this.shouldUseThumbnailPreview()) this.renderThumbnailComponents();
    else this.renderComponents();
    if (this.mode === "component") {
      this.measureGpu(drawingContext, () => this.renderComponentPreview());
      if (!this.shouldUseThumbnailPreview()) this.captureSelectedComponentThumbnail();
      this.pruneRenderCaches();
      this.gpuTimer.sealFrame(this.frameIndex);
      this.finishFrameProfile();
      this.updateHudAndMetrics();
      return;
    }
    this.renderSurfaces();
    this.measureGpu(drawingContext, () => {
      const outputBlackout = this.isOutputBlackout();
      const restoreCalibrate = outputBlackout && this.mapper?.isCalibrating?.();
      if (restoreCalibrate) this.mapper.setCalibrate(false);
      this.mapper.drawOverlays();
      this.renderOutputFrameOverlay();
      this.renderSelectedSurfaceOverlay();
      if (restoreCalibrate) this.mapper.setCalibrate(true);
    });
    this.pruneRenderCaches();
    this.gpuTimer.sealFrame(this.frameIndex);
    this.finishFrameProfile();
    this.updateHudAndMetrics();
  }

  measureGpu(target, draw) {
    const token = this.gpuTimer.begin(target, this.frameIndex);
    try {
      return draw();
    } finally {
      this.gpuTimer.end(token);
    }
  }

  tickClock(nowMs) {
    if (!this.lastTickMs) {
      this.lastTickMs = nowMs;
      return;
    }
    const dt = Math.min(0.1, Math.max(0, (nowMs - this.lastTickMs) / 1000));
    this.frameDeltaSeconds = dt;
    this.lastTickMs = nowMs;
    if (this.state?.global?.playing === false) return;
    this.visualTime += dt;
    const liveComponentIds = new Set((this.state.components || []).map((component) => component.id));
    for (const id of this.componentTimes.keys()) {
      if (!liveComponentIds.has(id)) this.componentTimes.delete(id);
    }
    for (const component of this.state.components || []) {
      const speed = Math.max(0, Number(component.speed) || 0);
      this.componentTimes.set(component.id, (this.componentTimes.get(component.id) || 0) + dt * speed);
    }
  }

  renderSelectedSurfaceOverlay() {
    if (this.mode === "output") return;
    if (this.state?.ui?.workspace !== "scene") return;
    const surfaceId = this.state?.ui?.selectedSurfaceId;
    if (!surfaceId) return;
    const calibrating = !!this.mapper?.isCalibrating?.();
    const revealHandles = calibrating && (
      this.state?.global?.mappingHandleMode !== "near" || this.shouldRevealSurfaceOverlay(surfaceId)
    );
    const mapped = this.mapperSurfaces.get(surfaceId);
    if (mapped?.direct) return;
    const corners = mapped?.mapperSurface?.corners;
    if (!Array.isArray(corners) || corners.length !== 4) return;

    const gl = drawingContext;
    if (gl?.disable) gl.disable(gl.DEPTH_TEST);
    push();
    const w2 = width * 0.5;
    const h2 = height * 0.5;
    noFill();
    stroke(255, 232, 92);
    strokeWeight(revealHandles ? 5 : 3);
    beginShape();
    for (const corner of corners) vertex(corner.x - w2, corner.y - h2, 1);
    endShape(CLOSE);
    if (!revealHandles) {
      pop();
      if (gl?.enable) gl.enable(gl.DEPTH_TEST);
      return;
    }
    noStroke();
    for (const corner of corners) {
      fill(255, 232, 92, 170);
      circle(corner.x - w2, corner.y - h2, 34);
      fill(255);
      circle(corner.x - w2, corner.y - h2, 14);
    }
    pop();
    if (gl?.enable) gl.enable(gl.DEPTH_TEST);
  }

  renderOutputFrameOverlay() {
    if (this.mode === "output" || !this.mapper?.isCalibrating?.()) return;
    const frames = outputFrames(this.state?.render || {});
    if (!frames.length) return;
    const showLabels = this.state?.global?.showLabels !== false;
    const gl = drawingContext;
    if (gl?.disable) gl.disable(gl.DEPTH_TEST);
    resetShader();
    push();
    noFill();
    stroke(255, 255, 255, 135);
    strokeWeight(2);
    rectMode(CORNER);
    for (const frame of frames) {
      noFill();
      stroke(255, 255, 255, 135);
      rect(-width * 0.5 + frame.x, -height * 0.5 + frame.y, frame.width, frame.height);
      if (showLabels) {
        noStroke();
        fill(255, 255, 255, 150);
        textSize(12);
        textAlign(LEFT, TOP);
        text(`${frame.name} · ${frame.width}×${frame.height}`, -width * 0.5 + frame.x + 10, -height * 0.5 + frame.y + 8);
      }
    }
    pop();
    if (gl?.enable) gl.enable(gl.DEPTH_TEST);
  }

  shouldRevealSurfaceOverlay(surfaceId) {
    const mapped = this.mapperSurfaces.get(surfaceId);
    const corners = mapped?.mapperSurface?.corners;
    if (!Array.isArray(corners)) return false;
    if (mapped?.mapperSurface?.dragging !== -1) return true;
    const px = typeof mouseX === "number" ? mouseX : -99999;
    const py = typeof mouseY === "number" ? mouseY : -99999;
    const radius = this.mapper?.pickRadius || 60;
    return corners.some((corner) => {
      const dx = px - corner.x;
      const dy = py - corner.y;
      return dx * dx + dy * dy <= radius * radius;
    });
  }

  renderComponents() {
    this.componentOutput.clear();
    this.mainMix.push();
    this.mainMix.clear();
    if (this.isOutputBlackout()) {
      this.mainMix.pop();
      return;
    }
    if (this.mode !== "component") {
      this.mainMix.pop();
      return;
    }

    const neededComponentIds = this.neededComponentIds();
    for (const component of this.state.components || []) {
      if (neededComponentIds.size && !neededComponentIds.has(component.id)) continue;
      const componentTime = this.componentTimes.get(component.id) || 0;
      const request = component.type === "canvas"
        ? canvasPreviewRenderRequest(component, width, height, { reason: "component-preview", renderIdentity: component.id })
        : componentRenderRequest(this.state.render, component, "texture", { reason: "component-preview", renderIdentity: component.id });
      const output = this.renderComponentForRequest(
        component,
        componentTime,
        request
      );
      this.componentOutput.set(component.id, output);
      const rect = containedRect(this.mainMix.width, this.mainMix.height, output.width, output.height);
      this.mainMix.push();
      applyBlend(this.mainMix, component.blend);
      this.mainMix.tint(255, 255 * clamp01(component.opacity));
      this.mainMix.image(output, rect.x, rect.y, rect.width, rect.height);
      this.mainMix.noTint();
      this.mainMix.blendMode(BLEND);
      this.mainMix.pop();
    }
    this.mainMix.pop();
  }

  renderComponentAtSize(component, componentTime, rw, rh) {
    return this.renderComponentForRequest(component, componentTime, createRenderRequest("texture", { width: rw, height: rh }));
  }

  renderComponentForRequest(component, componentTime, request = frameRenderRequest(this.state.render)) {
    const outputRequest = this.normalizeRenderRequest(request, "component");
    const pipeline = normalizeComponentPipelineSettings(this.state?.render || {});
    const renderRequest = component?.type === "canvas"
      ? outputRequest
      : componentPipelineSourceRequest(outputRequest, pipeline);
    const outputKey = renderBufferKey(component.id, renderRequestKey(outputRequest));
    const cached = this.componentOutput.get(outputKey);
    if (cached) {
      this.frameProfile.componentCacheHits++;
      return cached;
    }
    const stableSignature = this.stableComponentSignature(component, outputRequest);
    const stableKey = renderBufferKey("stable", outputKey);
    const stableGpuKey = renderBufferKey(stableKey, renderRequestKey(outputRequest));
    const stableGpuCached = stableSignature ? this.componentGpuBuffer.get(stableGpuKey) : null;
    const stableCpuCached = stableSignature ? this.componentBuffer.get(stableGpuKey) : null;
    const stableCached = stableGpuCached || stableCpuCached;
    if (stableCached &&
        stableCached.width === outputRequest.width &&
        stableCached.height === outputRequest.height &&
        this.stableComponentSignatures.get(stableKey) === stableSignature) {
      if (stableGpuCached) this.touchRenderCache(this.componentGpuBufferUse, stableGpuKey);
      else this.touchRenderCache(this.componentBufferUse, stableGpuKey);
      this.frameProfile.componentCacheHits++;
      this.cacheComponentOutput(component, outputKey, stableCached, outputRequest);
      return stableCached;
    }
    if (component.type === "canvas") {
      const output = this.measureComponentProfile({
        type: "component",
        componentId: component.id,
        componentName: component.name || component.id || "Canvas",
        width: outputRequest.width,
        height: outputRequest.height,
      }, () => this.renderCanvasComponent(component, componentTime, renderRequest));
      this.cacheComponentOutput(component, outputKey, output, outputRequest);
      if (stableSignature) this.storeStableComponentOutput(stableKey, stableSignature, output, outputRequest);
      return output;
    }
    const patch = compileComponentPatch(component, renderRequest);
    this.componentPatches.set(component.id, patch);
    const output = this.measureComponentProfile({
      type: "component",
      componentId: component.id,
      componentName: component.name || component.id || "Component",
      width: renderRequest.width,
      height: renderRequest.height,
      outputWidth: outputRequest.width,
      outputHeight: outputRequest.height,
    }, () => {
      const source = this.renderComponentPatch(component, patch, componentTime, renderRequest);
      return this.renderComponentOutputPipeline(
        component,
        source,
        renderRequest,
        outputRequest,
        componentTime,
        pipeline
      );
    });
    this.cacheComponentOutput(component, outputKey, output, outputRequest);
    if (stableSignature) this.storeStableComponentOutput(stableKey, stableSignature, output, outputRequest);
    return output;
  }

  renderComponentOutputPipeline(component, source, sourceRequest, outputRequest, componentTime, pipeline) {
    const upscalingEnabled = pipeline.upscaling.enabled && pipeline.upscaling.amount < 0.999;
    const post = pipeline.postProcessing;
    const postEnabled = (post.noiseEnabled && post.noiseAmount > 0.0001) ||
      (post.grayscaleEnabled && post.grayscaleAmount > 0.0001);
    if (!upscalingEnabled && !postEnabled) return source;

    let current = source;
    if (upscalingEnabled) {
      const target = this.getComponentPipelineTarget(`${component.id}:upscale`, outputRequest);
      const shaderProgram = this.getComponentPipelineShader("upscale", target);
      if (shaderProgram) {
        current = this.drawComponentPipelinePass({
          target,
          shaderProgram,
          source: current,
          request: outputRequest,
          passName: "Component upscale",
          uniforms: () => {
            shaderProgram.setUniform("sourceResolution", [sourceRequest.width, sourceRequest.height]);
          },
        });
      }
    }

    if (postEnabled) {
      const target = this.getComponentPipelineTarget(`${component.id}:post`, outputRequest);
      const shaderProgram = this.getComponentPipelineShader("post", target);
      if (shaderProgram) {
        current = this.drawComponentPipelinePass({
          target,
          shaderProgram,
          source: current,
          request: outputRequest,
          passName: "Component post",
          uniforms: () => {
            shaderProgram.setUniform("time", componentTime);
            shaderProgram.setUniform("noiseAmount", post.noiseEnabled ? post.noiseAmount : 0);
            shaderProgram.setUniform("grayscaleAmount", post.grayscaleEnabled ? post.grayscaleAmount : 0);
          },
        });
      }
    }
    return current;
  }

  getComponentPipelineTarget(id, request) {
    const renderRequest = this.normalizeRenderRequest(request, "component-pipeline");
    const key = renderBufferKey("component-pipeline", id, renderRequestKey(renderRequest));
    let target = this.componentGpuBuffer.get(key);
    if (!target || target.width !== renderRequest.width || target.height !== renderRequest.height) {
      disposeGraphics(target);
      target = createSharedFramebufferTarget(renderRequest.width, renderRequest.height) || createGraphics(renderRequest.width, renderRequest.height, WEBGL);
      if (!isSharedFramebufferTarget(target)) {
        target.__vj1ShaderBuffer = true;
        this.applyGraphicsPixelDensity(target, this.requestPixelDensity(renderRequest));
        this.applyGraphicsFont(target);
        target.noStroke();
      }
      this.componentGpuBuffer.set(key, target);
    }
    this.touchRenderCache(this.componentGpuBufferUse, key);
    return target;
  }

  getComponentPipelineShader(kind, target) {
    const contextKey = target?.__vj1ShaderContextId || target?._renderer || "global";
    let shaders = this.componentPipelineShaders.get(contextKey);
    if (!shaders) {
      shaders = {};
      this.componentPipelineShaders.set(contextKey, shaders);
    }
    if (shaders[kind]) return shaders[kind];
    try {
      const fragment = kind === "upscale" ? COMPONENT_UPSCALE_FRAGMENT_SHADER : COMPONENT_POST_FRAGMENT_SHADER;
      shaders[kind] = target.createShader(OVERLAY_BLEND_VERTEX_SHADER, fragment);
      return shaders[kind];
    } catch (error) {
      console.error("[VJ1_COMPONENT_PIPELINE_SHADER_FAILED]", { kind, message: error?.message || String(error) });
      return null;
    }
  }

  drawComponentPipelinePass({ target, shaderProgram, source, request, passName, uniforms }) {
    this.frameProfile.shaderPasses++;
    this.frameProfile.shaderChains++;
    return this.measureProfile("shaderMs", {
      type: "component-pipeline",
      passName,
      width: request.width,
      height: request.height,
    }, () => this.measureGpu(target, () => {
      drawShaderTarget(target, () => {
        clearShaderTarget(target);
        applyShaderTarget(target, shaderProgram);
        shaderProgram.setUniform("sourceTex", unwrapRenderTarget(source));
        shaderProgram.setUniform("sourceFlipY", !this.isShaderBuffer(source));
        uniforms?.();
        drawShaderTargetRect(target, request.width, request.height);
        resetShaderTarget(target);
      });
      return target;
    }));
  }

  cacheComponentOutput(component, outputKey, output, renderRequest) {
    this.componentOutput.set(outputKey, output);
    if (this.mainMix && renderRequest.width === this.mainMix.width && renderRequest.height === this.mainMix.height) {
      this.componentOutput.set(component.id, output);
    }
  }

  storeStableComponentOutput(stableKey, signature, source, renderRequest) {
    const stable = this.getComponentGpuBuffer(stableKey, renderRequest);
    stable.push();
    stable.clear();
    drawBuffer(stable, source, 0, 0, stable.width, stable.height, this.isShaderBuffer(source));
    stable.pop();
    this.stableComponentSignatures.set(stableKey, signature);
  }

  renderCanvasComponent(component, componentTime, request = frameRenderRequest(this.state.render)) {
    const renderRequest = this.normalizeRenderRequest(request, "component");
    return this.renderComponentChainState(
      component,
      component.chain || [],
      componentTime,
      renderRequest,
      renderBufferKey(component.id, "canvas")
    ).buffer;
  }

  renderComponentPatch(component, patch, componentTime, request = frameRenderRequest(this.state.render)) {
    const renderRequest = this.normalizeRenderRequest(patch?.renderRequest || request, "component");
    if (Array.isArray(component.chain) && component.chain.length) {
      return this.renderComponentChainState(
        component,
        component.chain,
        componentTime,
        renderRequest
      ).buffer;
    }

    const output = this.getComponentGpuBuffer(component.id, renderRequest);
    output.push();
    output.clear();
    output.pop();

    const orderedNodes = nodesInComponentChainOrder(component, patch);
    for (let index = 0; index < orderedNodes.length; index++) {
      const node = orderedNodes[index];
      if (node.enabled === false || node.role === "output") continue;
      if (isSourceNode(node)) {
        const layer = patchLayerForNode(node);
        const source = this.renderPatchSourceTexture(component, node, layer, componentTime, renderRequest);
        this.drawChainLayer(output, source, layer);
        continue;
      }
      if (isEffectNode(node)) {
        const effectRun = [node];
        let nextIndex = index;
        while (isEffectNode(orderedNodes[nextIndex + 1])) {
          nextIndex++;
          if (orderedNodes[nextIndex].enabled !== false) effectRun.push(orderedNodes[nextIndex]);
        }
        const effected = this.renderShaderNodes(output, effectRun, renderRequest, componentTime);
        output.push();
        output.clear();
        drawBuffer(output, effected, 0, 0, output.width, output.height, this.isShaderBuffer(effected));
        output.pop();
        index = nextIndex;
      }
    }
    return output;
  }

  renderPatchSourceTexture(component, node, layer, componentTime, renderRequest) {
    const sourceState = sourceFromPatchNode(node);
    if (isSimpleLayer(layer) && sourceState.type === "generator" && sourceState.generatorId !== "terrainFlyover" && getGeneratorShaderComponent(getGeneratorComponent(sourceState.generatorId).id)) {
      return this.measureProfile("sourceMs", {
        type: "source",
        componentId: component.id,
        componentName: component.name || component.id || "Component",
        passId: node.componentId || node.id,
        passName: layer.name || node.componentId || node.id,
        width: renderRequest.width,
        height: renderRequest.height,
      }, () => this.renderShaderGeneratorSource(
        sourceState.generatorId,
        instanceTime(sourceState.instanceId || node.id, componentTime),
        renderRequest,
        sourceState.params || {},
        sourceState.instanceId || node.id
      ));
    }
    const source = this.measureProfile("sourceMs", {
      type: "source",
      componentId: component.id,
      componentName: component.name || component.id || "Component",
      passId: node.componentId || node.id,
      passName: layer.name || node.componentId || node.id,
      width: renderRequest.width,
      height: renderRequest.height,
    }, () => this.renderPatchSourceNode(component, node, componentTime, renderRequest));
    return source;
  }

  renderLegacyComponent(component, componentTime, request = frameRenderRequest(this.state.render)) {
    const renderRequest = this.normalizeRenderRequest(request, "component");
    const source = this.renderComponentSource(component, componentTime, renderRequest);
    const effected = this.renderShaderChain(source, withShaderInstancePrefix(component.shaderChain, component.id), renderRequest, componentTime);
    const output = this.getComponentGpuBuffer(component.id, renderRequest);
    output.push();
    output.clear();
    drawBuffer(output, effected, 0, 0, output.width, output.height, this.isShaderBuffer(effected));
    output.pop();
    return output;
  }

  renderComponentChain(component, componentTime, request = frameRenderRequest(this.state.render)) {
    const renderRequest = this.normalizeRenderRequest(request, "component");
    return this.renderComponentChainState(
      component,
      component.chain || [],
      componentTime,
      renderRequest
    ).buffer;
  }

  renderComponentChainItems(component, chain, output, componentTime, renderRequest, scopeId = component.id) {
    const state = this.renderComponentChainState(component, chain, componentTime, renderRequest, scopeId);
    if (state.buffer === output) return state;
    output.push();
    output.clear();
    drawBuffer(output, state.buffer, 0, 0, output.width, output.height, this.isShaderBuffer(state.buffer));
    output.pop();
    return state;
  }

  renderComponentChainState(component, chain, componentTime, renderRequest, scopeId = component.id) {
    let state = this.transparentChainState(component, renderRequest);
    for (let index = 0; index < (chain || []).length; index++) {
      const item = chain[index];
      if (item.enabled === false) continue;
      const nodeId = renderBufferKey(component.id, scopeId, index, item.id || item.componentId || item.kind);
      if (item.kind === "source") {
        if (this.canDirectCompositeSource(item)) {
          state = this.renderDirectSourceNodeState(nodeId, state, component, item, componentTime, renderRequest);
          continue;
        }
        const sourceState = this.renderComponentSourceItemState(component, item, componentTime, renderRequest, nodeId);
        // Source transforms are evaluated inside the source coordinate system.
        // The source framebuffer itself always remains the component size.
        state = this.renderLayerNodeState(nodeId, state, sourceState, { ...item, transform: {} }, renderRequest);
        continue;
      }
      if (item.kind === "effect") {
        const firstPass = chainItemToShaderPass(item);
        const firstJob = compileShaderSchedule([firstPass])[0];
        if (isFusibleShaderJob(firstJob)) {
          const run = [item];
          let nextIndex = index + 1;
          while (nextIndex < (chain || []).length) {
            const nextItem = chain[nextIndex];
            if (nextItem?.enabled === false) {
              nextIndex++;
              continue;
            }
            if (nextItem?.kind !== "effect") break;
            const nextJob = compileShaderSchedule([chainItemToShaderPass(nextItem)])[0];
            if (!isFusibleShaderJob(nextJob)) break;
            run.push(nextItem);
            nextIndex++;
          }
          if (run.length > 1) {
            const runNodeId = renderBufferKey(nodeId, "fused", run.length);
            state = this.renderEffectRunNodeState(runNodeId, state, run, componentTime, renderRequest);
            index = nextIndex - 1;
            continue;
          }
        }
        state = this.renderEffectNodeState(nodeId, state, item, componentTime, renderRequest);
        continue;
      }
      if (item.kind === "group") {
        const groupState = this.renderComponentChainState(
          component,
          item.chain || [],
          componentTime,
          renderRequest,
          renderBufferKey(scopeId, item.id || index)
        );
        state = this.renderLayerNodeState(nodeId, state, groupState, item, renderRequest);
      }
    }
    return state;
  }

  canDirectCompositeSource(item = {}) {
    const source = item.source || {};
    const dependency = source.type === "component"
      ? this.state?.components?.find((component) => component.id === source.componentId)
      : null;
    const media = this.media.get(source.mediaId);
    return !!directPlacementKind({
      source,
      blend: item.blend || "normal",
      dependency,
      mediaDrawable: !!media && (
        (media.video && isDrawableMedia(media.video)) ||
        (media.image && isDrawableMedia(media.image))
      ),
      mediaIsModel: !!(media?.model || media?.modelData),
      cameraDrawable: !!this.cameraCapture && isDrawableMedia(this.cameraCapture),
    });
  }

  renderDirectSourceNodeState(nodeId, inputState, component, item, componentTime, renderRequest) {
    const source = {
      ...sourceWithNodeParams(item.source || component.source, item.params || {}, item.id),
      contentTransform: item.transform || {},
    };
    const runtimeContext = this.nodeRuntimeContext(componentTime);
    const signature = stableStringify({
      input: textureStateKey(inputState),
      source: staticSourceState(source),
      media: staticMediaStateForSource(this.state?.media || [], source),
      runtimeMedia: runtimeMediaStateForSource(this.media, source),
      time: this.sourceRuntimeTimeKey(source, item, runtimeContext),
      external: this.sourceRuntimeExternalKey(source, item, runtimeContext),
      layer: chainLayerState(item),
      request: renderRequestKey(renderRequest),
    });
    return this.evaluateChainNode(nodeId, signature, renderRequest, (output) => {
      output.push();
      output.clear();
      drawBuffer(output, inputState.buffer, 0, 0, output.width, output.height, this.isShaderBuffer(inputState.buffer));
      output.pop();
      const placed = this.resolvePlacedSourceResult(output, source, component, componentTime, renderRequest);
      if (placed) this.drawPlacedSourceResult(output, placed, item);
      this.frameProfile.directSourceComposites++;
      this.frameProfile.avoidedSourceRasterPixels += renderRequest.width * renderRequest.height;
    }, "direct-source");
  }

  resolvePlacedSourceResult(output, source, component, componentTime, renderRequest) {
    const target = { width: output.width, height: output.height };
    if (source.type === "component") {
      const dependency = this.state.components.find((item) => item.id === source.componentId);
      if (!dependency || dependency.id === component.id || dependency.type === "canvas") return null;
      const placement = componentReferencePlacement(component, dependency, this.state.render, target, source.placement);
      const demandRect = transformedPlacementDemandRect(placement, source.contentTransform);
      const dependencyTime = this.componentTimes.get(dependency.id) || componentTime;
      const texture = this.renderComponentForRequest(
        dependency,
        dependencyTime,
        componentReferenceRenderRequest(this.state.render, dependency, demandRect, {
          reason: "direct-component-reference",
          renderIdentity: dependency.id,
        })
      );
      return createPlacedRenderResult(texture, {
        destinationRect: placement,
        transform: source.contentTransform,
        sourceIsWebGL: this.isShaderBuffer(texture),
      });
    }
    if (source.type === "media") {
      const media = this.media.get(source.mediaId);
      if (media?.video && isDrawableMedia(media.video)) {
        syncVideoPlayback(media.video, {
          start: source.start,
          end: source.end,
          speed: (this.state?.global?.playing === false ? 0 : 1) * (Number(source.speed) || 1) * Math.max(0, Number(component.speed) || 0),
        });
        return createPlacedRenderResult(media.video, {
          destinationRect: fullTargetRect(target),
          fit: mediaSourceFit(source),
          transform: source.contentTransform,
        });
      }
      if (media?.image && isDrawableMedia(media.image)) {
        const fit = mediaSourceFit(source);
        const qualityRequest = qualityScaledRenderRequest(renderRequest, source.params || {});
        const texture = fit === "cover"
          ? this.getImageRendition(media, qualityRequest.width, qualityRequest.height) || media.image
          : media.image;
        return createPlacedRenderResult(texture, {
          destinationRect: fullTargetRect(target),
          fit,
          transform: source.contentTransform,
        });
      }
      return null;
    }
    if (source.type === "camera" && this.cameraCapture && isDrawableMedia(this.cameraCapture)) {
      return createPlacedRenderResult(this.cameraCapture, {
        destinationRect: fullTargetRect(target),
        fit: "cover",
        transform: source.contentTransform,
      });
    }
    return null;
  }

  drawPlacedSourceResult(output, placed, layer = {}) {
    output.push();
    applyBlend(output, layer.blend);
    output.tint(255, 255 * clamp01(layer.opacity ?? 1));
    this.drawPlacedResultGeometry(output, placed);
    output.noTint();
    output.blendMode(BLEND);
    output.pop();
  }

  drawPlacedResultGeometry(output, placed) {
    const rect = placed.destinationRect;
    const transform = normalizedContentTransform(placed.transform);
    output.push();
    output.translate(
      output.width * (0.5 + transform.x * 0.5),
      output.height * (0.5 + transform.y * 0.5)
    );
    output.rotate(transform.rotation);
    output.scale(transform.scale);
    const x = rect.x - output.width * 0.5;
    const y = rect.y - output.height * 0.5;
    if (placed.fit === "stretch") {
      drawBuffer(output, placed.texture, x, y, rect.width, rect.height, placed.sourceIsWebGL);
    } else {
      drawMediaFit(output, placed.texture, x, y, rect.width, rect.height, placed.fit);
    }
    output.pop();
  }

  transparentChainState(component, renderRequest) {
    const nodeId = renderBufferKey(component.id, "transparent");
    const signature = stableStringify({
      transparent: true,
      request: renderRequestKey(renderRequest),
    });
    return this.evaluateChainNode(nodeId, signature, renderRequest, (output) => {
      output.push();
      output.clear();
      output.pop();
    }, "initial");
  }

  renderLayerNodeState(nodeId, inputState, layerState, layer, renderRequest) {
    const contentState = this.renderLayerContentTransformState(
      renderBufferKey(nodeId, "content-transform"),
      layerState,
      layer.transform || {},
      renderRequest
    );
    const compositeLayer = { ...layer, transform: {} };
    const signature = stableStringify({
      input: textureStateKey(inputState),
      layer: textureStateKey(contentState),
      state: chainLayerState(layer),
      request: renderRequestKey(renderRequest),
    });
    return this.evaluateChainNode(nodeId, signature, renderRequest, (output) => {
      if (layer.blend === "overlay" && isSharedFramebufferTarget(output)) {
        this.renderOverlayLayerToTarget(output, inputState.buffer, contentState.buffer, compositeLayer);
        return;
      }
      output.push();
      output.clear();
      drawBuffer(output, inputState.buffer, 0, 0, output.width, output.height, this.isShaderBuffer(inputState.buffer));
      output.pop();
      this.drawChainLayer(output, contentState.buffer, compositeLayer);
    }, "layer");
  }

  renderLayerContentTransformState(nodeId, inputState, transform, renderRequest) {
    if (isIdentityTransform(transform)) return inputState;
    const signature = stableStringify({
      input: textureStateKey(inputState),
      transform,
      request: renderRequestKey(renderRequest),
    });
    return this.evaluateChainNode(nodeId, signature, renderRequest, (output) => {
      if (!isSharedFramebufferTarget(output)) {
        output.push();
        output.clear();
        this.drawTransformedLayerFallback(output, inputState.buffer, transform);
        output.pop();
        return;
      }
      const shaderProgram = this.getLayerTransformShader(output);
      if (!shaderProgram) return;
      const matrix = effectTransformUniforms(transform).forward;
      drawShaderTarget(output, () => {
        clearShaderTarget(output);
        applyShaderTarget(output, shaderProgram);
        shaderProgram.setUniform("sourceTex", unwrapRenderTarget(inputState.buffer));
        shaderProgram.setUniform("sourceFlipY", !this.isShaderBuffer(inputState.buffer));
        shaderProgram.setUniform("sourceUvMatrix", matrix);
        drawShaderTargetRect(output, output.width, output.height);
        resetShaderTarget(output);
      });
    }, "content-transform");
  }

  getLayerTransformShader(target) {
    if (this.layerTransformShader) return this.layerTransformShader;
    try {
      this.layerTransformShader = target.createShader(LAYER_TRANSFORM_VERTEX_SHADER, LAYER_TRANSFORM_FRAGMENT_SHADER);
    } catch (error) {
      console.error("[VJ1_LAYER_TRANSFORM_SHADER_FAILED]", error?.message || error);
      return null;
    }
    return this.layerTransformShader;
  }

  renderOverlayLayerToTarget(target, base, layerSource, layer = {}) {
    const shaderProgram = this.getOverlayBlendShader(target);
    if (!shaderProgram) return;
    const matrix = effectTransformUniforms(layer.transform || {}).forward;
    drawShaderTarget(target, () => {
      clearShaderTarget(target);
      applyShaderTarget(target, shaderProgram);
      shaderProgram.setUniform("baseTex", unwrapRenderTarget(base));
      shaderProgram.setUniform("layerTex", unwrapRenderTarget(layerSource));
      shaderProgram.setUniform("baseFlipY", !this.isShaderBuffer(base));
      shaderProgram.setUniform("layerFlipY", !this.isShaderBuffer(layerSource));
      shaderProgram.setUniform("layerUvMatrix", matrix);
      shaderProgram.setUniform("layerOpacity", clamp01(layer.opacity ?? 1));
      drawShaderTargetRect(target, target.width, target.height);
      resetShaderTarget(target);
    });
  }

  getOverlayBlendShader(target) {
    if (this.overlayBlendShader) return this.overlayBlendShader;
    try {
      this.overlayBlendShader = target.createShader(OVERLAY_BLEND_VERTEX_SHADER, OVERLAY_BLEND_FRAGMENT_SHADER);
    } catch (error) {
      console.error("[VJ1_OVERLAY_SHADER_FAILED]", error?.message || error);
      return null;
    }
    return this.overlayBlendShader;
  }

  renderEffectNodeState(nodeId, inputState, item, componentTime, renderRequest) {
    const component = getShaderComponent(item.componentId);
    if (!component) return inputState;
    const params = normalizeParamValues(component, {
      ...(item.params || {}),
      ...(item.amount !== undefined ? { amount: item.amount } : {}),
    });
    const amount = effectParamNumber(component, params, "amount", item.amount ?? 0.35);
    if (amount <= 0.0001) return inputState;
    const runtimeContext = this.nodeRuntimeContext(componentTime);
    const signature = stableStringify({
      input: textureStateKey(inputState),
      params,
      transform: item.transform || {},
      time: componentRuntimeTimeKey(component, params, runtimeContext),
      external: component.runtime?.externalKey?.(params, runtimeContext) ?? null,
      customShader: item.componentId === "custom" ? this.state?.shaders?.customCode || "" : "",
      request: renderRequestKey(renderRequest),
    });
    return this.evaluateChainNode(nodeId, signature, renderRequest, (output) => {
      const pass = chainItemToShaderPass({ ...item, params, amount });
      const qualityRequest = qualityScaledRenderRequest(renderRequest, params);
      if (isSharedFramebufferTarget(output) &&
          output.width === qualityRequest.width &&
          output.height === qualityRequest.height) {
        this.renderShaderPassToTarget(inputState.buffer, pass, output, qualityRequest, componentTime);
        return;
      }
      const effected = this.renderShaderChain(inputState.buffer, [pass], qualityRequest, componentTime);
      output.push();
      output.clear();
      drawBuffer(output, effected, 0, 0, output.width, output.height, this.isShaderBuffer(effected));
      output.pop();
    }, "effect");
  }

  renderEffectRunNodeState(nodeId, inputState, items, componentTime, renderRequest) {
    const passes = items.map((item) => chainItemToShaderPass(item));
    const signature = stableStringify({
      input: textureStateKey(inputState),
      passes,
      time: passes.map((pass) => {
        const component = getShaderComponent(pass.id);
        return componentRuntimeTimeKey(component, pass.params, this.nodeRuntimeContext(componentTime));
      }),
      request: renderRequestKey(renderRequest),
    });
    return this.evaluateChainNode(nodeId, signature, renderRequest, (output) => {
      const effected = this.renderShaderChain(inputState.buffer, passes, renderRequest, componentTime);
      output.push();
      output.clear();
      drawBuffer(output, effected, 0, 0, output.width, output.height, this.isShaderBuffer(effected));
      output.pop();
    }, "fused-effect-run");
  }

  evaluateChainNode(nodeId, signature, renderRequest, render, dirtyReason) {
    const bufferId = renderBufferKey("node", nodeId);
    const runtimeKey = renderBufferKey(bufferId, renderRequestKey(renderRequest));
    const output = this.getComponentGpuBuffer(bufferId, renderRequest);
    let runtime = this.chainNodeRuntimes.get(runtimeKey);
    if (!runtime) {
      runtime = new RenderNodeRuntime(runtimeKey);
      this.chainNodeRuntimes.set(runtimeKey, runtime);
    }
    runtime.bindOutput(output);
    const result = runtime.evaluate(signature, () => {
      render(output);
      return output;
    }, { frame: this.frameIndex, dirtyReason });
    if (!result.rendered) this.frameProfile.stageCacheHits++;
    else this.frameProfile.stageRenders++;
    return {
      buffer: result.output,
      outputVersion: result.outputVersion,
      nodeKey: runtimeKey,
      dirtyReason: result.dirtyReason,
    };
  }

  nodeRuntimeContext(time) {
    return {
      time: Number(time) || 0,
      frame: this.frameIndex,
      playing: this.state?.global?.playing !== false,
    };
  }

  renderThumbnailComponents() {
    this.componentOutput.clear();
    this.mainMix.push();
    this.mainMix.clear();
    this.mainMix.pop();
  }

  neededComponentIds() {
    const ids = new Set();
    if (this.mode === "component") {
      const selected = this.state.ui.selectedComponentId || this.state.components[0]?.id || "";
      if (selected) ids.add(selected);
      return ids;
    }
    for (const surface of this.state.surfaces || []) {
      if (surface.enabled && surface.componentId) ids.add(surface.componentId);
    }
    return ids;
  }

  stableComponentSignature(component, renderRequest, seen = new Set()) {
    const pipeline = normalizeComponentPipelineSettings(this.state?.render || {});
    if (pipeline.postProcessing.noiseEnabled && pipeline.postProcessing.noiseAmount > 0.0001) return "";
    if (!component?.id || this.componentIsFrameDynamic(component, seen)) return "";
    return stableStringify({
      version: 3,
      request: {
        role: renderRequest.role || "component",
        width: renderRequest.width,
        height: renderRequest.height,
      },
      component: staticComponentGraphState(component, this.state?.components || []),
      media: staticComponentGraphMediaState(this.state?.media || [], component, this.state?.components || []),
      customShader: this.state?.shaders?.customCode || "",
      pipeline,
    });
  }

  componentIsFrameDynamic(component, seen = new Set()) {
    if (!component || seen.has(component.id)) return true;
    seen.add(component.id);
    if (Array.isArray(component.chain) && component.chain.length) {
      const dynamic = this.chainItemsAreFrameDynamic(component.chain, seen);
      seen.delete(component.id);
      return dynamic;
    }
    const sourceDynamic = this.sourceIsFrameDynamic(component.source, component, seen);
    const effectsDynamic = (component.shaderChain || []).some((pass) => this.effectPassIsFrameDynamic(pass));
    seen.delete(component.id);
    return sourceDynamic || effectsDynamic;
  }

  chainItemsAreFrameDynamic(chain = [], seen = new Set()) {
    for (const item of chain || []) {
      if (item.enabled === false) continue;
      if (item.kind === "group" && this.chainItemsAreFrameDynamic(item.chain || [], seen)) return true;
      if (item.kind === "source" && item.source?.type === "component") {
        const sourceComponent = this.state?.components?.find((component) => component.id === item.source.componentId);
        if (!sourceComponent || this.componentIsFrameDynamic(sourceComponent, seen)) return true;
        continue;
      }
      if (item.kind === "source" && this.sourceIsFrameDynamic(item.source || {}, item, seen)) return true;
      if (item.kind === "effect" && this.effectPassIsFrameDynamic({ id: item.componentId, params: item.params, amount: item.amount })) return true;
    }
    return false;
  }

  sourceIsFrameDynamic(source = {}, owner = {}, seen = new Set()) {
    if (!source || source.type === "black") return false;
    if (source.type === "camera") return true;
    if (source.type === "generator") {
      const component = getGeneratorComponent(source.generatorId || "testPattern");
      const params = normalizeParamValues(component, {
        ...(source.params || {}),
        ...(owner.params || {}),
      });
      return component.runtime?.cacheable === false || component.runtime?.timeDependent?.(params) === true;
    }
    if (source.type === "component") {
      const dependency = this.state?.components?.find((component) => component.id === source.componentId);
      return !dependency || this.componentIsFrameDynamic(dependency, seen);
    }
    if (source.type !== "media") return true;
    const mediaId = source.mediaId || "";
    const mediaMeta = (this.state?.media || []).find((item) => item.id === mediaId);
    const runtimeItem = this.media.get(mediaId);
    if (!mediaMeta || !isReadyMediaItem(runtimeItem)) return true;
    if (mediaMeta.type === "video" || runtimeItem?.video) return true;
    if (mediaMeta.type === "model" || runtimeItem?.model || runtimeItem?.modelData) {
      const params = source.params || owner.params || {};
      return Math.abs(Number(params.spinX) || 0) > 0.0001 ||
        Math.abs(Number(params.spinY) || 0) > 0.0001 ||
        Math.abs(Number(params.spinZ) || 0) > 0.0001;
    }
    return false;
  }

  effectPassIsFrameDynamic(pass = {}) {
    const id = pass.id || pass.componentId || "";
    const component = getShaderComponent(id);
    if (!component) return false;
    const params = normalizeParamValues(component, {
      ...(pass.params && typeof pass.params === "object" ? pass.params : {}),
      ...(pass.amount !== undefined ? { amount: pass.amount } : {}),
    });
    const amount = effectParamNumber(component, params, "amount", 0.35);
    if (amount <= 0.0001) return false;
    return component.runtime?.cacheable === false || component.runtime?.timeDependent?.(params) === true;
  }

  renderComponentSource(component, componentTime = this.visualTime, request = frameRenderRequest(this.state.render)) {
    const renderRequest = this.normalizeRenderRequest(request, "source");
    const key = renderBufferKey(component.id, renderRequestKey(renderRequest));
    let pg = this.componentSource.get(key);
    if (!pg || pg.width !== renderRequest.width || pg.height !== renderRequest.height) {
      pg = createGraphics(renderRequest.width, renderRequest.height);
      this.applyGraphicsPixelDensity(pg, this.requestPixelDensity(renderRequest));
      this.applyGraphicsFont(pg);
      this.componentSource.set(key, pg);
    }
    this.touchRenderCache(this.componentSourceUse, key);
    pg.push();
    pg.clear();
    this.safeDrawSourceToGraphics(pg, withSourceInstance(component.source, `${component.id}:source`), component, componentTime, renderRequest);
    pg.pop();
    return pg;
  }

  renderComponentSourceItem(component, item, componentTime = this.visualTime, request = frameRenderRequest(this.state.render)) {
    return this.renderComponentSourceItemState(
      component,
      item,
      componentTime,
      request,
      renderBufferKey(component.id, item.id || "source")
    ).buffer;
  }

  renderComponentSourceItemState(component, item, componentTime, request, nodeId) {
    const renderRequest = this.normalizeRenderRequest(request, "source");
    const key = renderBufferKey(nodeId, "source", renderRequestKey(renderRequest));
    let pg = this.componentSource.get(key);
    if (!pg || pg.width !== renderRequest.width || pg.height !== renderRequest.height) {
      disposeGraphics(pg);
      pg = createSharedFramebufferTarget(renderRequest.width, renderRequest.height) || createGraphics(renderRequest.width, renderRequest.height);
      if (!isSharedFramebufferTarget(pg)) {
        this.applyGraphicsPixelDensity(pg, this.requestPixelDensity(renderRequest));
        this.applyGraphicsFont(pg);
      }
      this.componentSource.set(key, pg);
    }
    this.touchRenderCache(this.componentSourceUse, key);
    const source = {
      ...sourceWithNodeParams(item.source || component.source, item.params || {}, item.id),
      contentTransform: item.transform || {},
    };
    const runtimeContext = this.nodeRuntimeContext(componentTime);
    const sourceSignature = stableStringify({
      source: staticSourceState(source),
      media: staticMediaStateForSource(this.state?.media || [], source),
      runtimeMedia: runtimeMediaStateForSource(this.media, source),
      time: this.sourceRuntimeTimeKey(source, item, runtimeContext),
      external: this.sourceRuntimeExternalKey(source, item, runtimeContext),
      request: renderRequestKey(renderRequest),
    });
    let runtime = this.sourceNodeRuntimes.get(key);
    if (!runtime) {
      runtime = new RenderNodeRuntime(key);
      this.sourceNodeRuntimes.set(key, runtime);
    }
    runtime.bindOutput(pg);
    const result = runtime.evaluate(sourceSignature, () => {
      pg.push();
      pg.clear();
      this.safeDrawSourceToGraphics(pg, source, component, componentTime, renderRequest);
      pg.pop();
      return pg;
    }, { frame: this.frameIndex, dirtyReason: "source" });
    if (!result.rendered) this.frameProfile.stageCacheHits++;
    else this.frameProfile.stageRenders++;
    return {
      buffer: result.output,
      outputVersion: result.outputVersion,
      nodeKey: key,
      dirtyReason: result.dirtyReason,
    };
  }

  sourceRuntimeTimeKey(source = {}, owner = {}, runtimeContext = {}) {
    if (!source || source.type === "black") return null;
    if (source.type === "camera") return runtimeContext.frame;
    if (source.type === "generator") {
      const component = getGeneratorComponent(source.generatorId || "testPattern");
      const params = normalizeParamValues(component, {
        ...(source.params || {}),
        ...(owner.params || {}),
      });
      return componentRuntimeTimeKey(component, params, runtimeContext);
    }
    if (source.type === "component") {
      const dependency = this.state?.components?.find((component) => component.id === source.componentId);
      if (!dependency || this.componentIsFrameDynamic(dependency)) return runtimeContext.frame;
      return stableStringify({
        component: staticComponentGraphState(dependency, this.state?.components || []),
        media: staticComponentGraphMediaState(this.state?.media || [], dependency, this.state?.components || []),
      });
    }
    if (source.type !== "media") return runtimeContext.frame;
    const mediaId = source.mediaId || "";
    const mediaMeta = (this.state?.media || []).find((entry) => entry.id === mediaId);
    const runtimeItem = this.media.get(mediaId);
    if (mediaMeta?.type === "video" || runtimeItem?.video) return runtimeContext.frame;
    if (mediaMeta?.type === "model" || runtimeItem?.model || runtimeItem?.modelData) {
      const params = source.params || owner.params || {};
      const spinning = Math.abs(Number(params.spinX) || 0) +
        Math.abs(Number(params.spinY) || 0) +
        Math.abs(Number(params.spinZ) || 0) > 0.0001;
      return spinning ? runtimeContext.time : null;
    }
    return null;
  }

  sourceRuntimeExternalKey(source = {}, owner = {}, runtimeContext = {}) {
    if (source?.type !== "generator") return null;
    const component = getGeneratorComponent(source.generatorId || "testPattern");
    const params = normalizeParamValues(component, {
      ...(source.params || {}),
      ...(owner.params || {}),
    });
    return component.runtime?.externalKey?.(params, runtimeContext) ?? null;
  }

  renderPatchSourceNode(component, node, componentTime = this.visualTime, request = frameRenderRequest(this.state.render)) {
    const renderRequest = this.normalizeRenderRequest(node?.state?.renderRequest || request, "source");
    const key = renderBufferKey(component.id, node.id, renderRequestKey(renderRequest));
    let pg = this.componentSource.get(key);
    if (!pg || pg.width !== renderRequest.width || pg.height !== renderRequest.height) {
      pg = createGraphics(renderRequest.width, renderRequest.height);
      this.applyGraphicsPixelDensity(pg, this.requestPixelDensity(renderRequest));
      this.applyGraphicsFont(pg);
      this.componentSource.set(key, pg);
    }
    this.touchRenderCache(this.componentSourceUse, key);
    pg.push();
    pg.clear();
    this.safeDrawSourceToGraphics(pg, sourceFromPatchNode(node), component, componentTime, renderRequest);
    pg.pop();
    return pg;
  }

  safeDrawSourceToGraphics(pg, source, component, componentTime, renderRequest = frameRenderRequest(this.state.render)) {
    try {
      this.drawSourceToGraphics(pg, source, component, componentTime, renderRequest);
    } catch (error) {
      console.error(`[VJ1_SOURCE_CRASH] ${error?.name || "Error"}: ${error?.message || String(error || "unknown")}`, {
        componentId: component.id,
        componentName: component.name,
        source,
        width: pg.width,
        height: pg.height,
        name: error?.name,
        message: error?.message,
        stack: error?.stack,
      });
      pg.background(0);
    }
  }

  drawSourceToGraphics(pg, source, component, componentTime, renderRequest = frameRenderRequest(this.state.render)) {
    if (source.type === "component") {
      const sourceComponent = this.state.components.find((item) => item.id === source.componentId);
      if (!sourceComponent || sourceComponent.id === component.id || sourceComponent.type === "canvas") return;
      const sourceTime = this.componentTimes.get(sourceComponent.id) || componentTime;
      const placement = componentReferencePlacement(
        component,
        sourceComponent,
        this.state.render,
        { width: pg.width, height: pg.height },
        source.placement
      );
      const demandRect = transformedPlacementDemandRect(placement, source.contentTransform);
      const sourceOutput = this.renderComponentForRequest(
        sourceComponent,
        sourceTime,
        componentReferenceRenderRequest(this.state.render, sourceComponent, demandRect, {
          reason: "component-reference",
          renderIdentity: sourceComponent.id,
        })
      );
      this.drawPlacedResultGeometry(pg, createPlacedRenderResult(sourceOutput, {
        destinationRect: placement,
        transform: source.contentTransform,
        sourceIsWebGL: this.isShaderBuffer(sourceOutput),
      }));
    } else if (source.type === "media") {
      const item = this.media.get(source.mediaId);
      if (item?.video && isDrawableMedia(item.video)) {
        syncVideoPlayback(item.video, {
          start: source.start,
          end: source.end,
          speed: (this.state?.global?.playing === false ? 0 : 1) * (Number(source.speed) || 1) * Math.max(0, Number(component.speed) || 0),
        });
        drawWithContentTransform(pg, source.contentTransform, () => {
          drawMediaFit(pg, item.video, 0, 0, pg.width, pg.height, mediaSourceFit(source));
        });
      }
      else if (item?.image && isDrawableMedia(item.image)) {
        const fit = mediaSourceFit(source);
        const qualityRequest = qualityScaledRenderRequest({ width: pg.width, height: pg.height }, source.params || {});
        const image = fit === "cover"
          ? this.getImageRendition(item, qualityRequest.width, qualityRequest.height) || item.image
          : item.image;
        drawWithContentTransform(pg, source.contentTransform, () => {
          drawMediaFit(pg, image, 0, 0, pg.width, pg.height, fit);
        });
      }
      else if (item?.model || item?.modelData) {
        this.drawModelSource(pg, item, source, componentTime, renderRequest);
      }
      else if (item?.imageError) drawStandby(pg, "image load failed");
      else if (item?.modelError) drawStandby(pg, "model load failed");
      else if (item) drawStandby(pg, "loading media");
      else {
        this.requestMissingMedia(source.mediaId);
        drawStandby(pg, "media file not loaded");
      }
    } else if (source.type === "camera") {
      const camera = this.ensureCameraCapture();
      if (camera && isDrawableMedia(camera)) {
        drawWithContentTransform(pg, source.contentTransform, () => {
          drawCover(pg, camera, 0, 0, pg.width, pg.height);
        });
      }
      else drawStandby(pg, this.cameraError || "camera");
    } else if (source.type === "black") {
      pg.background(0);
    } else {
      const generatorTime = instanceTime(source.instanceId || source.generatorId, componentTime);
      if (source.generatorId === "anatomy") {
        this.drawAnatomyGenerator(pg, source, generatorTime, renderRequest);
        return;
      }
      if (source.generatorId === "terrainFlyover") {
        this.drawTerrainGenerator(pg, source, generatorTime, renderRequest);
        return;
      }
      if (this.drawShaderGenerator(pg, source, generatorTime, renderRequest)) return;
      drawWithContentTransform(pg, source.contentTransform, () => {
        drawGenerator(pg, source.generatorId, generatorTime, source.params || {});
      });
    }
  }

  drawAnatomyGenerator(pg, source = {}, componentTime = this.visualTime, renderRequest = frameRenderRequest(this.state.render)) {
    const params = source.params || {};
    const target = this.getModelTarget(renderRequest.width, renderRequest.height, this.requestPixelDensity(renderRequest));
    const viewport = modelViewportMetrics(target, renderRequest);
    const renderMode = params.renderMode || "surface";
    const surfaceColor = modelColor(params.surfaceColor, [217, 212, 201, 255]);
    const wireColor = modelColor(params.wireColor, [75, 73, 68, 204]);
    const wireThickness = resolutionScaledStrokeWidth(modelWireThickness(params), renderRequest);
    const rotation = modelRotation(params, componentTime);
    const detail = Math.max(4, Math.min(14, Math.round(
      (Number(params.detail) || 8) * qualityComputeMultiplier(params, { minimum: 0.55, maximum: 1.35 })
    )));
    const modelScale = Math.max(0.01, Number(params.modelScale) || 1);
    const depth = Math.max(0.05, Number(params.depth) || 1);
    this.measureGpu(target, () => {
      target.push();
      target.clear();
      target.perspective?.(Math.PI / 3, viewport.width / Math.max(1, viewport.height), 0.1, 5000);
      target.camera?.(0, 0, viewport.cameraZ, 0, 0, 0, 0, 1, 0);
      target.ambientLight?.(96);
      target.directionalLight?.(238, 232, 220, -0.45, -0.55, -0.75);
      target.directionalLight?.(82, 94, 108, 0.7, 0.15, -0.35);
      applyModelContentTransform(target, source.contentTransform, viewport);
      target.rotateX(rotation[0]);
      target.rotateY(rotation[1]);
      target.rotateZ(rotation[2]);
      const scale = viewport.unitScale * modelScale * anatomyPartFitScale(params.part);
      target.scale(scale, -scale, scale * depth);
      drawProceduralAnatomy(target, params, componentTime, renderMode, surfaceColor, wireColor, wireThickness, detail);
      target.pop();
    });
    pg.push();
    pg.clear();
    drawBuffer(pg, target, 0, 0, pg.width, pg.height, true);
    pg.pop();
  }

  drawTerrainGenerator(pg, source = {}, componentTime = this.visualTime, renderRequest = frameRenderRequest(this.state.render)) {
    const params = source.params || {};
    const contentTransform = normalizedContentTransform(source.contentTransform);
    const target = this.getTerrainTarget(renderRequest.width, renderRequest.height, this.requestPixelDensity(renderRequest));
    const style = params.style === "wire" ? 1 : params.style === "hybrid" ? 2 : 0;
    const flightSpeed = Math.max(0, Number(params.flightSpeed) || 0);
    const flightTime = this.continuousRateTime(`${source.instanceId || source.generatorId || "terrain"}:flight`, componentTime, flightSpeed);
    const turn = Math.max(-1, Math.min(1, Number(params.turn) || 0));
    const yaw = turn * 0.72 + contentTransform.rotation;
    const cameraAnchor = [
      Math.sin(yaw) * flightTime * 7 + contentTransform.x * 20,
      Math.cos(yaw) * flightTime * 7 + contentTransform.y * 20,
    ];
    const scaleKey = `${source.instanceId || source.generatorId || "terrain"}:scale`;
    const scaleState = advanceSpatialScale(this.terrainScalePhases.get(scaleKey), params.terrainScale, cameraAnchor);
    this.terrainScalePhases.set(scaleKey, scaleState);
    const flightParams = {
      ...params,
      turn: Math.max(-1, Math.min(1, turn + contentTransform.rotation / 0.72)),
      altitude: Math.max(0.2, (Number(params.altitude) || 2.5) / contentTransform.scale - contentTransform.y * 12),
      flightSpeed: 1,
      terrainScale: scaleState.scale / contentTransform.scale,
      terrainPhase: scaleState.phase,
      gridDensity: Math.max(0.25, Math.min(4,
        (Number(params.gridDensity) || 1) * qualityComputeMultiplier(params, { minimum: 0.4, maximum: 1.5 })
      )),
    };
    const sky = normalizedModelColor(params.skyColor, [108, 165, 212, 255]);

    this.measureGpu(target, () => {
      target.push();
      target.clear();
      if (style !== 1) target.background(sky[0] * 255, sky[1] * 255, sky[2] * 255, sky[3] * 255);
      if (style !== 1) {
        drawTerrainSurface(target, this.terrainSurfaceResources, flightParams, flightTime, target.width, target.height, style, sky);
      }
      if (style >= 1) {
        drawTerrainWireframe(target, this.terrainWireResources, flightParams, flightTime, target.width, target.height, renderRequest);
      }
      target.pop();
    });

    pg.push();
    pg.clear();
    drawBuffer(pg, target, 0, 0, pg.width, pg.height, true);
    pg.pop();
  }

  continuousRateTime(key, baseTime, rate) {
    const next = advanceRateClock(this.rateClocks.get(key), baseTime, rate);
    this.rateClocks.set(key, next);
    return next.time;
  }

  drawModelSource(pg, item, source = {}, componentTime = this.visualTime, renderRequest = frameRenderRequest(this.state.render)) {
    const params = source.params || {};
    const target = this.getModelTarget(renderRequest.width, renderRequest.height, this.requestPixelDensity(renderRequest));
    const viewport = modelViewportMetrics(target, renderRequest);
    const renderMode = params.renderMode || "surface";
    const modelScale = Math.max(0.01, Number(params.modelScale) || 1);
    const depth = Math.max(0.05, Number(params.depth) || 1);
    const pointBudget = Math.max(128, Math.min(50000, Math.round(
      (Number(params.pointBudget) || 4000) * qualityComputeMultiplier(params, { minimum: 0.25, maximum: 1.75 })
    )));
    const surfaceColor = modelColor(params.surfaceColor, [220, 225, 220, 255]);
    const wireColor = modelColor(params.wireColor, [20, 20, 20, 220]);
    const wireThickness = resolutionScaledStrokeWidth(modelWireThickness(params), renderRequest);
    const rotation = modelRotation(params, componentTime);
    const gpuToken = this.gpuTimer.begin(target, this.frameIndex);
    try {
    target.push();
    target.clear();
    const scale = viewport.unitScale * modelScale;
    const rawParsedDrawn = item.modelData &&
      drawRawParsedModelMode(target, item, params, componentTime, renderMode, surfaceColor, wireColor, pointBudget, viewport, source.contentTransform);
    if (!rawParsedDrawn) {
      target.perspective?.(Math.PI / 3, viewport.width / Math.max(1, viewport.height), 0.1, 5000);
      target.camera?.(0, 0, viewport.cameraZ, 0, 0, 0, 0, 1, 0);
      target.ambientLight?.(95);
      target.directionalLight?.(220, 220, 220, -0.35, -0.45, -0.75);
      applyModelContentTransform(target, source.contentTransform, viewport);
      target.rotateX(rotation[0]);
      target.rotateY(rotation[1]);
      target.rotateZ(rotation[2]);
      target.scale(scale, scale, scale * depth);
      if (item.modelData && renderMode === "points") {
        drawPointCloud(target, ensureParsedModelPointCloud(item, pointBudget), wireColor);
      } else if (item.modelData) {
        const geometry = ensureParsedModelGeometry(item);
        if (geometry) {
          try {
            drawGeometryModel(target, geometry, renderMode, surfaceColor, wireColor, wireThickness);
          } catch (error) {
            item.modelGeometryFailed = true;
            item.modelGeometry = null;
            item.modelGeometryError = error?.message || String(error || "geometry render failed");
            drawParsedModel(target, item.modelData, renderMode, surfaceColor, wireColor, wireThickness);
          }
        } else {
          drawParsedModel(target, item.modelData, renderMode, surfaceColor, wireColor, wireThickness);
        }
      } else if (renderMode === "points") {
        drawPointCloud(target, ensureP5ModelPointCloud(item, pointBudget), wireColor);
      } else if (renderMode === "wireframe") {
        target.noFill();
        target.stroke(...wireColor);
        target.strokeWeight(wireThickness);
        target.model(item.model);
      } else {
        target.noStroke();
        target.ambientMaterial?.(...surfaceColor);
        target.fill?.(...surfaceColor);
        drawWithPolygonOffset(target, renderMode === "surfaceWire", () => target.model(item.model));
        if (renderMode === "surfaceWire") {
          target.noFill();
          target.stroke(...wireColor);
          target.strokeWeight(wireThickness);
          target.model(item.model);
        }
      }
    }
    target.pop();
    } finally {
      this.gpuTimer.end(gpuToken);
    }
    pg.push();
    pg.clear();
    drawBuffer(pg, target, 0, 0, pg.width, pg.height, true);
    pg.pop();
  }

  getModelTarget(width, height, density = this.renderPixelDensity(this.state?.render || {})) {
    return this.getSpecializedWebglTarget("model", width, height, density, {
      onContextDiscard: (gl) => this.resetModelResources(gl),
    });
  }

  getTerrainTarget(width, height, density = this.renderPixelDensity(this.state?.render || {})) {
    return this.getSpecializedWebglTarget("terrain", width, height, density, {
      onContextDiscard: () => this.resetTerrainResources(),
      preferSharedFramebuffer: true,
      depth: true,
    });
  }

  getSpecializedWebglTarget(kind, width, height, density = this.renderPixelDensity(this.state?.render || {}), {
    onContextDiscard = null,
    preferSharedFramebuffer = false,
    depth = false,
  } = {}) {
    const widthPx = Math.max(1, Math.round(Number(width) || 1));
    const heightPx = Math.max(1, Math.round(Number(height) || 1));
    const targetDensity = Math.max(0.25, Math.min(4, Number(density) || 1));
    let target = this.specializedWebglTargets.get(kind);
    if (!target) {
      target = (preferSharedFramebuffer ? createSharedFramebufferTarget(widthPx, heightPx, { depth }) : null)
        || createGraphics(widthPx, heightPx, WEBGL);
      if (!isSharedFramebufferTarget(target)) this.applyGraphicsPixelDensity(target, targetDensity);
      target.__vj1PixelDensity = targetDensity;
      if (!isSharedFramebufferTarget(target)) target.noStroke();
      this.specializedWebglTargets.set(kind, target);
      return target;
    }
    const sizeChanged = target.width !== widthPx || target.height !== heightPx;
    const densityChanged = target.__vj1PixelDensity !== targetDensity;
    if (sizeChanged || densityChanged) {
      try {
        if (sizeChanged) target.resizeCanvas(widthPx, heightPx);
        if (!isSharedFramebufferTarget(target)) this.applyGraphicsPixelDensity(target, targetDensity);
      } catch {
        onContextDiscard?.(target?.drawingContext);
        disposeGraphics(target);
        target = (preferSharedFramebuffer ? createSharedFramebufferTarget(widthPx, heightPx, { depth }) : null)
          || createGraphics(widthPx, heightPx, WEBGL);
        if (!isSharedFramebufferTarget(target)) this.applyGraphicsPixelDensity(target, targetDensity);
        this.specializedWebglTargets.set(kind, target);
      }
      target.__vj1PixelDensity = targetDensity;
      if (!isSharedFramebufferTarget(target)) target.noStroke();
    }
    return target;
  }

  drawShaderGenerator(pg, sourceOrId, componentTime = this.visualTime, request = frameRenderRequest(this.state.render)) {
    const source = typeof sourceOrId === "object"
      ? sourceOrId
      : { generatorId: sourceOrId, params: {} };
    // Keep every generator on the component's render contract. The old
    // shader path rebuilt a width/height-only request here, dropping logical
    // dimensions, resolution scale, pixel-density state, and render identity.
    // Use the actual source target size while preserving that metadata so
    // shader, 2D, model, and terrain generators all resolve identically.
    const renderRequest = this.normalizeRenderRequest({
      ...request,
      width: pg.width,
      height: pg.height,
    }, "source");
    const target = this.renderShaderGeneratorSource(
      source.generatorId,
      componentTime,
      renderRequest,
      source.params || {},
      source.instanceId || source.generatorId,
      source.contentTransform || {},
      isSharedFramebufferTarget(pg) ? pg : null
    );
    if (!target) return false;
    if (target === pg) return true;
    pg.push();
    pg.clear();
    drawBuffer(pg, target, 0, 0, pg.width, pg.height, true);
    pg.pop();
    return true;
  }

  renderShaderGeneratorSource(id, componentTime = this.visualTime, request = frameRenderRequest(this.state.render), params = {}, instanceId = id, contentTransform = {}, outputTarget = null) {
    const generatorComponent = getGeneratorComponent(id);
    const generatorId = generatorComponent.id;
    const shaderComponent = getGeneratorShaderComponent(generatorId);
    const component = shaderComponent ? { ...shaderComponent, params: generatorComponent.params || shaderComponent.params || [] } : null;
    if (!component) return null;
    const renderRequest = qualityScaledRenderRequest(this.normalizeRenderRequest(request, "source"), params);
    // The target must match the quality-scaled viewport. Drawing a smaller rect
    // into a full-size target changes the apparent size of normalized generators
    // (most visibly Eyeball and Gradient) instead of merely reducing pixel work.
    // A chain source already owns a framebuffer at the requested size. Render
    // straight into it so multiple animated shader generators do not contend
    // for the global effect scratch target and then pay an immediate copy.
    const target = outputTarget && outputTarget.width === renderRequest.width && outputTarget.height === renderRequest.height
      ? outputTarget
      : this.getFxPingPongTarget(renderRequest, 0);
    const shader = this.shaderBuilder.getShader({ id: component.id, component }, target);
    if (!shader) return null;
    const qualityParams = qualityAdjustedGeneratorParams(generatorId, params);
    const rateParam = generatorRateParam(generatorId);
    const rate = rateParam ? Math.max(0, Number(qualityParams[rateParam]) || 0) : 1;
    const shaderTime = rateParam
      ? this.continuousRateTime(`${instanceId || generatorId}:${rateParam}`, componentTime, rate)
      : componentTime;
    const shaderParams = rateParam ? { ...qualityParams, [rateParam]: 1 } : qualityParams;
    const started = performance.now();
    const sample = {
      type: "shader-generator",
      passId: generatorId,
      passName: component.name || generatorId,
      width: renderRequest.width,
      height: renderRequest.height,
      ms: 0,
    };
    const gpuToken = this.gpuTimer.begin(target, this.frameIndex);
    try {
      drawShaderTarget(target, () => {
      clearShaderTarget(target);
      applyShaderTarget(target, shader);
      const contentMatrix = effectTransformUniforms(contentTransform).forward;
      setShaderUniformIfPresent(shader, "useContentTransform", isIdentityTransform(contentTransform) ? 0 : 1);
      setShaderUniformIfPresent(shader, "contentUvMatrix", contentMatrix);
      const shadertoyInterface = usesShadertoyInterface(component);
      if (shadertoyInterface) {
        const now = new Date();
        const drawingSize = shaderDrawingBufferSize(target, renderRequest.width, renderRequest.height);
        setShaderUniformIfPresent(shader, "iResolution", [drawingSize.width, drawingSize.height, 1]);
        setShaderUniformIfPresent(shader, "iTime", shaderTime);
        setShaderUniformIfPresent(shader, "iTimeDelta", this.frameDeltaSeconds);
        setShaderUniformIfPresent(shader, "iFrame", this.frameIndex);
        setShaderUniformIfPresent(shader, "iFrameRate", frameRate());
        setShaderUniformIfPresent(shader, "iMouse", [0, 0, 0, 0]);
        setShaderUniformIfPresent(shader, "iDate", [now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()]);
      } else {
        shader.setUniform("resolution", [renderRequest.width, renderRequest.height]);
        setShaderUniformIfPresent(shader, "time", shaderTime);
      }
      this.setShaderParamUniforms(shader, component, shaderParams, {
        setDefaultAmount: false,
        onlyPresent: shadertoyInterface || generatorId === "eyeball",
      });
      if (generatorId === "eyeball") {
        const eye = eyeballFrameUniforms(shaderTime, shaderParams);
        setShaderUniformIfPresent(shader, "eyeGazeDir", eye.gazeDir);
        setShaderUniformIfPresent(shader, "eyeIrisRight", eye.irisRight);
        setShaderUniformIfPresent(shader, "eyeIrisUp", eye.irisUp);
        setShaderUniformIfPresent(shader, "eyeBlink", eye.blink);
      }
      drawShaderTargetRect(target, renderRequest.width, renderRequest.height);
      resetShaderTarget(target);
      });
    } finally {
      this.gpuTimer.end(gpuToken);
      sample.ms = roundMetric(performance.now() - started);
      this.frameProfile.passSamples.push(sample);
    }
    return target;
  }

  getComponentBuffer(id, request = frameRenderRequest(this.state.render)) {
    const renderRequest = this.normalizeRenderRequest(request, "buffer");
    const key = renderBufferKey(id, renderRequestKey(renderRequest));
    let pg = this.componentBuffer.get(key);
    if (!pg || pg.width !== renderRequest.width || pg.height !== renderRequest.height) {
      pg = createGraphics(renderRequest.width, renderRequest.height);
      this.applyGraphicsPixelDensity(pg, this.requestPixelDensity(renderRequest));
      this.applyGraphicsFont(pg);
      this.componentBuffer.set(key, pg);
    }
    this.touchRenderCache(this.componentBufferUse, key);
    return pg;
  }

  getComponentGpuBuffer(id, request = frameRenderRequest(this.state.render)) {
    const renderRequest = this.normalizeRenderRequest(request, "gpu-buffer");
    const key = renderBufferKey(id, renderRequestKey(renderRequest));
    let target = this.componentGpuBuffer.get(key);
    if (!target || target.width !== renderRequest.width || target.height !== renderRequest.height) {
      disposeGraphics(target);
      target = createSharedFramebufferTarget(renderRequest.width, renderRequest.height);
      if (!target) return this.getComponentBuffer(id, renderRequest);
      this.componentGpuBuffer.set(key, target);
    }
    this.touchRenderCache(this.componentGpuBufferUse, key);
    return target;
  }

  materializeDrawableBuffer(source, key, request = frameRenderRequest(this.state.render)) {
    if (!this.isShaderBuffer(source)) return source;
    const pg = this.getComponentBuffer(key, request);
    pg.push();
    pg.clear();
    drawBuffer(pg, source, 0, 0, pg.width, pg.height, true);
    pg.pop();
    return pg;
  }

  getFxTarget(request = frameRenderRequest(this.state.render)) {
    return this.getFxPingPongTarget(request, 0);
  }

  getFxPingPongTarget(request = frameRenderRequest(this.state.render), slot = 0) {
    const renderRequest = this.normalizeRenderRequest(request, "effect");
    const widthPx = renderRequest.width;
    const heightPx = renderRequest.height;
    const key = renderBufferKey(widthPx, heightPx);
    const targetSlot = slot === 1 ? 1 : 0;
    let group = this.fxTargetGroups.get(key);
    if (!group) {
      this.pruneFxTargetGroups(3);
      group = { targets: [null, null], lastUsed: this.frameIndex };
      this.fxTargetGroups.set(key, group);
    }
    group.lastUsed = this.frameIndex;
    this.fxTargets = group.targets;
    this.fxTargetKey = key;
    let target = group.targets[targetSlot];
    if (!target) {
      target = createSharedFramebufferTarget(widthPx, heightPx) || createGraphics(widthPx, heightPx, WEBGL);
      group.targets[targetSlot] = target;
      if (!isSharedFramebufferTarget(target)) {
        this.applyGraphicsPixelDensity(target, this.requestPixelDensity(renderRequest));
        this.applyGraphicsFont(target);
        target.noStroke();
      }
      return target;
    }
    if (target.width !== widthPx || target.height !== heightPx) {
      try {
        target.resizeCanvas(widthPx, heightPx);
      } catch {
        disposeGraphics(target);
        target = createSharedFramebufferTarget(widthPx, heightPx) || createGraphics(widthPx, heightPx, WEBGL);
        group.targets[targetSlot] = target;
      }
      if (!isSharedFramebufferTarget(target)) {
        this.applyGraphicsPixelDensity(target, this.requestPixelDensity(renderRequest));
        this.applyGraphicsFont(target);
        target.noStroke();
      }
      this.shaderBuilder.clear?.();
    }
    return target;
  }

  pruneFxTargetGroups(maxGroups = 3) {
    if (this.fxTargetGroups.size < maxGroups) return;
    const stale = Array.from(this.fxTargetGroups.entries())
      .sort((a, b) => (a[1].lastUsed || 0) - (b[1].lastUsed || 0));
    const removeCount = Math.max(1, this.fxTargetGroups.size - maxGroups + 1);
    for (const [key, group] of stale.slice(0, removeCount)) {
      for (const target of group.targets || []) disposeGraphics(target);
      this.fxTargetGroups.delete(key);
    }
    this.shaderBuilder.clear?.();
  }

  normalizeRenderRequest(request, role = "texture") {
    if (request && typeof request === "object") {
      return createRenderRequest(request.role || role, request, request);
    }
    return createRenderRequest(role, frameSize(this.state?.render || {}));
  }

  touchRenderCache(useMap, key) {
    useMap?.set?.(key, this.frameIndex);
  }

  pruneRenderCaches() {
    pruneGraphicsMap(this.componentSource, this.componentSourceUse, {
      maxItems: 48,
      currentFrame: this.frameIndex,
      idleFrames: 900,
    });
    pruneGraphicsMap(this.componentBuffer, this.componentBufferUse, {
      maxItems: 48,
      currentFrame: this.frameIndex,
      idleFrames: 900,
    });
    pruneGraphicsMap(this.componentGpuBuffer, this.componentGpuBufferUse, {
      maxItems: 64,
      currentFrame: this.frameIndex,
      idleFrames: 900,
    });
    for (const key of Array.from(this.stableComponentSignatures.keys())) {
      const hasCpuEntry = Array.from(this.componentBuffer.keys()).some((bufferKey) => bufferKey.startsWith(`${key}:`));
      const hasGpuEntry = Array.from(this.componentGpuBuffer.keys()).some((bufferKey) => bufferKey.startsWith(`${key}:`));
      if (!hasCpuEntry && !hasGpuEntry) this.stableComponentSignatures.delete(key);
    }
    for (const key of Array.from(this.chainNodeRuntimes.keys())) {
      const hasGpuEntry = Array.from(this.componentGpuBuffer.keys()).some((bufferKey) => bufferKey.includes(key));
      if (!this.componentBuffer.has(key) && !hasGpuEntry) this.chainNodeRuntimes.delete(key);
    }
    for (const key of Array.from(this.sourceNodeRuntimes.keys())) {
      if (!this.componentSource.has(key)) this.sourceNodeRuntimes.delete(key);
    }
  }

  drawChainLayer(output, source, layer) {
    output.push();
    applyBlend(output, layer.blend);
    output.tint(255, 255 * clamp01(layer.opacity ?? 1));
    drawBuffer(output, source, 0, 0, output.width, output.height, this.isShaderBuffer(source));
    output.noTint();
    output.blendMode(BLEND);
    output.pop();
  }

  drawTransformedLayerFallback(output, source, transform = {}) {
    output.imageMode(CENTER);
    output.translate(
      output.width * 0.5 + (Number(transform.x) || 0) * output.width * 0.5,
      output.height * 0.5 + (Number(transform.y) || 0) * output.height * 0.5
    );
    output.rotate(Number(transform.rotation) || 0);
    output.scale(Math.max(0.01, Number(transform.scale) || 1));
    if (this.isShaderBuffer(source)) {
      drawBuffer(output, source, -output.width / 2, -output.height / 2, output.width, output.height, true);
    } else {
      output.image(source, 0, 0, output.width, output.height);
    }
    output.imageMode(CORNER);
  }

  renderShaderChain(input, chain, request = frameRenderRequest(this.state.render), timeSeconds = this.visualTime) {
    const renderRequest = this.normalizeRenderRequest(request, "effect");
    const rw = renderRequest.width;
    const rh = renderRequest.height;
    // Effects use normalized UVs, but many convert their artistic sizes to pixels
    // through `resolution`. Keep that coordinate system at the component size
    // even when the physical target is rendered at a lower quality resolution.
    const logicalWidth = Math.max(1, Number(renderRequest.logicalWidth) || rw);
    const logicalHeight = Math.max(1, Number(renderRequest.logicalHeight) || rh);
    let current = input;
    let passCount = 0;
    const logicalSchedule = compileShaderSchedule(chain);
    const schedule = fuseLocalShaderSchedule(logicalSchedule);
    if (schedule.length) {
      this.frameProfile.shaderChains++;
      this.frameProfile.maxShaderChainLength = Math.max(this.frameProfile.maxShaderChainLength, logicalSchedule.length);
    }
    for (const job of schedule) {
      const pass = job.pass;
      if (pass.amount <= 0.0001) continue;
      let handoff = false;
      if (this.isShaderBuffer(current) && !isSharedFramebufferTarget(current) && schedule.length <= 1) {
        handoff = true;
        current = this.materializeDrawableBuffer(current, `fx-handoff:${renderRequestKey(renderRequest)}:${passCount}`, renderRequest);
      }
      const target = this.getFxPingPongTarget(renderRequest, this.isShaderBuffer(current) ? nextFxTargetSlot(this.fxTargets, current) : passCount % 2);
      const shader = job.fused
        ? this.shaderBuilder.getFusedShader(job.jobs, target)
        : this.shaderBuilder.getShader(pass, target);
      if (!shader) continue;
      const sourceIsShaderBuffer = this.isShaderBuffer(current);
      this.measureShaderPass(pass, job.component, renderRequest, {
        handoff,
        sourceIsShaderBuffer,
        targetSlot: this.fxTargets?.[1] === target ? 1 : 0,
      }, target, () => {
        drawShaderTarget(target, () => {
        clearShaderTarget(target);
        applyShaderTarget(target, shader);
        shader.setUniform("tex0", unwrapRenderTarget(current));
        shader.setUniform("resolution", [logicalWidth, logicalHeight]);
        shader.setUniform("canvasSize", [logicalWidth, logicalHeight]);
        shader.setUniform("texelSize", [1 / logicalWidth, 1 / logicalHeight]);
        shader.setUniform("sourceFlipY", !sourceIsShaderBuffer);
        shader.setUniform("sourceForceOpaque", false);
        if (job.fused) this.setFusedShaderUniforms(shader, job.jobs, timeSeconds);
        else {
          shader.setUniform("time", instanceTime(pass.instanceId || pass.id, timeSeconds));
          this.setEffectInfrastructureUniforms(shader, pass.transform);
          this.setShaderParamUniforms(shader, job.component, pass.params);
        }
        drawShaderTargetRect(target, rw, rh);
        resetShaderTarget(target);
        });
      });
      current = target;
      passCount++;
    }
    return current;
  }

  renderShaderPassToTarget(input, pass, target, request, timeSeconds = this.visualTime) {
    const renderRequest = this.normalizeRenderRequest(request, "effect");
    const job = compileShaderSchedule([pass])[0];
    if (!job || job.pass.amount <= 0.0001) return input;
    const shaderProgram = this.shaderBuilder.getShader(job.pass, target);
    if (!shaderProgram) return input;
    const logicalWidth = Math.max(1, Number(renderRequest.logicalWidth) || renderRequest.width);
    const logicalHeight = Math.max(1, Number(renderRequest.logicalHeight) || renderRequest.height);
    const sourceIsShaderBuffer = this.isShaderBuffer(input);
    this.frameProfile.shaderChains++;
    this.frameProfile.maxShaderChainLength = Math.max(this.frameProfile.maxShaderChainLength, 1);
    this.measureShaderPass(job.pass, job.component, renderRequest, {
      handoff: false,
      sourceIsShaderBuffer,
      targetSlot: -1,
    }, target, () => {
      drawShaderTarget(target, () => {
        clearShaderTarget(target);
        applyShaderTarget(target, shaderProgram);
        shaderProgram.setUniform("tex0", unwrapRenderTarget(input));
        shaderProgram.setUniform("resolution", [logicalWidth, logicalHeight]);
        shaderProgram.setUniform("canvasSize", [logicalWidth, logicalHeight]);
        shaderProgram.setUniform("texelSize", [1 / logicalWidth, 1 / logicalHeight]);
        shaderProgram.setUniform("sourceFlipY", !sourceIsShaderBuffer);
        shaderProgram.setUniform("sourceForceOpaque", false);
        shaderProgram.setUniform("time", instanceTime(job.pass.instanceId || job.pass.id, timeSeconds));
        this.setEffectInfrastructureUniforms(shaderProgram, job.pass.transform);
        this.setShaderParamUniforms(shaderProgram, job.component, job.pass.params);
        drawShaderTargetRect(target, renderRequest.width, renderRequest.height);
        resetShaderTarget(target);
      });
    });
    return target;
  }

  setFusedShaderUniforms(shaderProgram, jobs, timeSeconds) {
    jobs.forEach((part, index) => {
      shaderProgram.setUniform(
        fusedUniformName(index, "time"),
        instanceTime(part.pass.instanceId || part.pass.id, timeSeconds)
      );
      this.setShaderParamUniforms(shaderProgram, part.component, part.pass.params, {
        uniformPrefix: `f${index}_`,
      });
    });
    const noiseTexture = this.getCachedNoiseTexture();
    if (noiseTexture) {
      setShaderUniformIfPresent(shaderProgram, "noiseTex", noiseTexture);
      setShaderUniformIfPresent(shaderProgram, "noiseTextureSize", [noiseTexture.width, noiseTexture.height]);
    }
  }

  measureShaderPass(pass, component, renderRequest, meta, target, drawPass) {
    const item = {
      type: "shader-pass",
      passId: pass.id || "",
      passName: component?.name || pass.id || "Shader",
      width: renderRequest.width,
      height: renderRequest.height,
      pixels: renderRequest.width * renderRequest.height,
      source: meta.sourceIsShaderBuffer ? "webgl" : "drawable",
      targetSlot: meta.targetSlot,
      handoff: !!meta.handoff,
      ms: 0,
    };
    this.frameProfile.shaderPasses++;
    if (meta.handoff) this.frameProfile.shaderHandoffs++;
    const started = performance.now();
    const result = this.measureGpu(target, drawPass);
    item.ms = performance.now() - started;
    this.frameProfile.shaderMs += item.ms;
    this.frameProfile.passSamples.push(item);
    return result;
  }

  measureProfile(bucket, meta, fn) {
    const started = performance.now();
    const result = fn();
    const ms = performance.now() - started;
    this.frameProfile[bucket] += ms;
    this.frameProfile.passSamples.push({ ...meta, ms });
    return result;
  }

  measureComponentProfile(meta, fn) {
    const started = performance.now();
    const outermost = this.componentProfileDepth === 0;
    this.componentProfileDepth++;
    let result;
    try {
      result = fn();
    } finally {
      this.componentProfileDepth--;
      const ms = performance.now() - started;
      this.frameProfile.componentMs += ms;
      if (outermost) this.frameProfile.componentWallMs += ms;
      this.frameProfile.componentRenders++;
      this.frameProfile.passSamples.push({ ...meta, ms });
    }
    return result;
  }

  finishFrameProfile() {
    const profile = {
      ...this.frameProfile,
      totalMs: performance.now() - this.frameStart,
      passSamples: this.frameProfile.passSamples
        .slice()
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 12)
        .map((item) => ({ ...item, ms: roundMetric(item.ms) })),
    };
    profile.shaderMs = roundMetric(profile.shaderMs);
    profile.sourceMs = roundMetric(profile.sourceMs);
    profile.componentMs = roundMetric(profile.componentMs);
    profile.componentWallMs = roundMetric(profile.componentWallMs);
    profile.totalMs = roundMetric(profile.totalMs);
    this.lastFrameProfile = profile;
  }

  renderShaderNodes(input, nodes, request = frameRenderRequest(this.state.render), timeSeconds = this.visualTime) {
    return this.renderShaderChain(input, nodes.map(shaderPassFromNode), request, timeSeconds);
  }

  setShaderParamUniforms(shader, component, params = {}, options = {}) {
    for (const param of component?.params || []) {
      if (options.onlyPresent && !shader?.uniforms?.[param.id]) continue;
      const value = normalizeParamValue(param, params[param.id]);
      const uniformId = `${options.uniformPrefix || ""}${param.id}`;
      if (param.type === "boolean") {
        shader.setUniform(uniformId, value !== false);
      } else if (param.type === "color") {
        shader.setUniform(uniformId, colorUniform(value));
      } else if (param.type === "enum") {
        shader.setUniform(uniformId, enumUniform(param, value));
      } else {
        shader.setUniform(uniformId, Number(value) || 0);
      }
    }
    if (options.setDefaultAmount !== false && !component?.params?.some((param) => param.id === "amount")) {
      shader.setUniform(`${options.uniformPrefix || ""}amount`, 0);
    }
  }

  renderSurfaces() {
    const transition = this.currentLiveTransition();
    if (transition) {
      this.renderTransitionSurfaces(transition);
      return;
    }
    this.releaseTransitionSurfaceTextures();
    this.renderSingleSceneSurfaces();
  }

  renderSingleSceneSurfaces() {
    const outputBlackout = this.isOutputBlackout();
    const routes = this.buildSurfaceRenderPlan();
    for (const route of routes) {
      const { surface, mapped, component, surfaceRequest: request } = route;
      if (this.canDirectProjectSurfaceRoute(route, outputBlackout)) {
        const view = this.renderSurfaceRouteView(route);
        if (!view) continue;
        this.frameProfile.directSurfaceSamples++;
        this.frameProfile.avoidedSurfaceRasterPixels += request.width * request.height;
        this.measureGpu(drawingContext, () => this.drawSurfaceRouteView(view, route));
        continue;
      }
      this.frameProfile.surfaceRasterPixels += request.width * request.height;
      const pg = this.getSurfaceTexture(request);
      if (!pg) continue;
      pg.push();
      pg.clear();
      if (!outputBlackout) {
        this.drawSurfaceRoute(pg, route);
      } else {
        pg.background(0);
      }
      if (this.mode !== "output" && !outputBlackout && this.state.global.showLabels !== false && this.mapper.isCalibrating()) {
        drawSurfaceLabel(pg, surface, component);
      }
      pg.pop();
      this.measureGpu(drawingContext, () => {
        if (mapped.direct && Number(surface.feather) > 0) {
          this.mapper.drawTexture(pg, mapped.mapperSurface, surface.projectionFit, surface.feather);
        } else if (mapped.direct) this.drawDirectSurfaceTexture(pg, route);
        else this.mapper.drawTexture(pg, mapped.mapperSurface, surface.projectionFit, surface.feather);
      });
    }
  }

  currentLiveTransition(nowMs = Date.now()) {
    const transition = this.state?.liveTransition;
    const durationMs = Math.max(0, Number(transition?.durationMs) || 0);
    const startedAtMs = Number(transition?.startedAtMs) || 0;
    if (!transition?.fromState || !durationMs || !startedAtMs) return null;
    const progress = Math.max(0, Math.min(1, (Number(nowMs) - startedAtMs) / durationMs));
    if (progress >= 1) return null;
    return { ...transition, progress };
  }

  renderTransitionSurfaces(transition) {
    const targetState = this.state;
    if (this.isOutputBlackout()) return;
    if (this.activeTransitionTextureId !== transition.id) {
      this.releaseTransitionSurfaceTextures();
      this.activeTransitionTextureId = transition.id;
    }

    const componentsShared = transition.componentsShared === true;
    this.componentOutput.clear();
    const fromRoutes = this.withRenderState(transition.fromState, () =>
      this.withSurfaceRenderIdentityPrefix(componentsShared ? "" : "transition-from:", () => this.buildSurfaceRenderPlan())
    );
    const toRoutes = this.withSurfaceRenderIdentityPrefix(
      componentsShared ? "" : "transition-to:",
      () => this.buildSurfaceRenderPlan()
    );
    const fromTextures = this.renderTransitionRouteTextures(fromRoutes, transition.fromState, "from");
    const toTextures = this.renderTransitionRouteTextures(toRoutes, targetState, "to");
    const fromBySurface = new Map(fromRoutes.map((route) => [route.surface.id, route]));
    const toBySurface = new Map(toRoutes.map((route) => [route.surface.id, route]));
    const surfaceIds = [];
    for (const surface of targetState.surfaces || []) {
      if ((fromBySurface.has(surface.id) || toBySurface.has(surface.id)) && !surfaceIds.includes(surface.id)) surfaceIds.push(surface.id);
    }
    for (const route of fromRoutes) if (!surfaceIds.includes(route.surface.id)) surfaceIds.push(route.surface.id);

    for (const surfaceId of surfaceIds) {
      const fromRoute = fromBySurface.get(surfaceId);
      const toRoute = toBySurface.get(surfaceId);
      const route = toRoute || fromRoute;
      const mapped = route?.mapped;
      if (!mapped?.mapperSurface) continue;
      const fromTexture = fromTextures.get(surfaceId) || this.getTransparentTransitionTexture("from", surfaceId, toRoute?.surfaceRequest);
      const toTexture = toTextures.get(surfaceId) || this.getTransparentTransitionTexture("to", surfaceId, fromRoute?.surfaceRequest);
      if (!fromTexture || !toTexture) continue;
      const feather = toRoute?.surface?.feather ?? fromRoute?.surface?.feather ?? 0;
      this.measureGpu(drawingContext, () => {
        this.mapper.drawTransitionTextures(fromTexture, toTexture, mapped.mapperSurface, {
          fromProjectionFit: fromRoute?.surface?.projectionFit || (mapped.direct ? "contain" : "cover"),
          toProjectionFit: toRoute?.surface?.projectionFit || (mapped.direct ? "contain" : "cover"),
          feather,
          progress: transition.progress,
        });
      });
    }
  }

  renderTransitionRouteTextures(routes, renderState, side) {
    const textures = new Map();
    this.withRenderState(renderState, () => {
      for (const route of routes) {
        this.frameProfile.surfaceRasterPixels += route.surfaceRequest.width * route.surfaceRequest.height;
        const texture = this.getTransitionSurfaceTexture(side, route.surface.id, route.surfaceRequest);
        if (!texture) continue;
        texture.push();
        texture.clear();
        const previousEffectPrefix = this.transitionSurfaceEffectPrefix;
        this.transitionSurfaceEffectPrefix = side;
        try {
          this.drawSurfaceRoute(texture, route);
        } finally {
          this.transitionSurfaceEffectPrefix = previousEffectPrefix;
        }
        texture.pop();
        textures.set(route.surface.id, texture);
      }
    });
    return textures;
  }

  getTransitionSurfaceTexture(side, surfaceId, request = stableSurfaceRenderRequest(this.state?.render || {})) {
    const widthPx = Math.max(1, Math.round(Number(request?.width) || 1));
    const heightPx = Math.max(1, Math.round(Number(request?.height) || 1));
    const key = `${side}:${surfaceId}`;
    let target = this.transitionSurfaceTextures.get(key);
    if (!target || target.width !== widthPx || target.height !== heightPx) {
      disposeGraphics(target);
      target = createSharedFramebufferTarget(widthPx, heightPx) || createGraphics(widthPx, heightPx);
      if (!isSharedFramebufferTarget(target)) {
        this.applyGraphicsPixelDensity(target, this.requestPixelDensity(request));
        this.applyGraphicsFont(target);
      }
      this.transitionSurfaceTextures.set(key, target);
    }
    return target;
  }

  getTransparentTransitionTexture(side, surfaceId, request) {
    const target = this.getTransitionSurfaceTexture(side, `${surfaceId}:empty`, request);
    target?.push?.();
    target?.clear?.();
    target?.pop?.();
    return target;
  }

  releaseTransitionSurfaceTextures() {
    if (!this.transitionSurfaceTextures?.size && !this.activeTransitionTextureId) return;
    disposeGraphicsMap(this.transitionSurfaceTextures);
    this.transitionSurfaceTextures.clear();
    this.activeTransitionTextureId = "";
  }

  withRenderState(renderState, callback) {
    const previous = this.state;
    this.state = renderState;
    try {
      return callback();
    } finally {
      this.state = previous;
    }
  }

  withSurfaceRenderIdentityPrefix(prefix, callback) {
    const previous = this.surfaceRenderIdentityPrefix;
    this.surfaceRenderIdentityPrefix = prefix;
    try {
      return callback();
    } finally {
      this.surfaceRenderIdentityPrefix = previous;
    }
  }

  buildSurfaceRenderPlan() {
    const renderIdentityPrefix = this.surfaceRenderIdentityPrefix || "";
    const routes = [];
    const viewport = this.displayCanvasSize(this.state?.render || {});
    const pixelScale = this.renderPixelDensity(this.state?.render || {});
    const manualSurfaceLimit = manualSurfaceTextureLimit(this.state?.render || {}, pixelScale);
    for (const storedSurface of this.state.surfaces || []) {
      if (!storedSurface.enabled) continue;
      this.frameProfile.surfaceRouteCandidates++;
      const sourceNode = resolveSceneSourceNode(this.state, storedSurface.sourceNodeId, storedSurface);
      if (!sourceNode) continue;
      const surface = {
        ...storedSurface,
        sourceNodeId: sourceNode.id,
        componentId: sourceNode.componentId,
        outputFrameId: sourceNode.outputFrameId,
      };
      const mapped = this.mapperSurfaces.get(surface.id);
      const component = this.state.components.find((item) => item.id === surface.componentId);
      if (!mapped?.mapperSurface || !component) continue;
      const sourceView = componentSourceView(this.state.render, component, surface, this.state.recordingFrames);
      const maxSurfaceSize = manualSurfaceLimit || {
        // Auto is demand-driven. This is only a conservative WebGL safety
        // bound; source raster limits normally stop demand well before it.
        width: 8192,
        height: 8192,
      };
      const demand = sourceRenderDemand({
        ...sourceView,
        maxSurfaceSize,
        corners: mapped.mapperSurface.corners,
        viewport,
        pixelScale,
        preserveFullFootprint: mapped.direct,
      });
      if (!demand) {
        this.frameProfile.surfaceRoutesCulled++;
        continue;
      }
      routes.push({ surface, mapped, component, sourceView, demand });
    }

    const componentScales = new Map();
    for (const route of routes) {
      componentScales.set(route.component.id, Math.max(
        componentScales.get(route.component.id) || 0,
        route.demand.rasterScale
      ));
    }
    for (const route of routes) {
      const scale = componentScales.get(route.component.id) || route.demand.rasterScale;
      const maxWidth = route.sourceView.maxRasterSize.width;
      const maxHeight = route.sourceView.maxRasterSize.height;
      const widthPx = quantizedRenderDimension(route.sourceView.logicalSize.width * scale, maxWidth);
      const heightPx = quantizedRenderDimension(route.sourceView.logicalSize.height * scale, maxHeight);
      const meta = {
        surfaceId: route.surface.id,
        timingId: route.surface.id,
        renderIdentity: `${renderIdentityPrefix}${route.component.id}`,
      };
      route.componentRequest = createRenderRequest("texture", { width: widthPx, height: heightPx }, {
        ...meta,
        logicalWidth: route.sourceView.logicalSize.width,
        logicalHeight: route.sourceView.logicalSize.height,
        demandScale: scale,
      });
      route.surfaceRequest = createRenderRequest("surface", route.demand.surfaceSize, {
        ...meta,
        logicalWidth: route.demand.sampleRect.width,
        logicalHeight: route.demand.sampleRect.height,
        demandScale: scale,
      });
    }
    this.frameProfile.surfaceRoutesVisible += routes.length;
    const plannedComponents = new Map();
    for (const route of routes) plannedComponents.set(route.component.id, route.componentRequest);
    for (const request of plannedComponents.values()) {
      this.frameProfile.componentRasterPixels += request.width * request.height;
    }
    return routes;
  }

  getSurfaceTexture(request = stableSurfaceRenderRequest(this.state?.render || {})) {
    const widthPx = Math.max(1, Math.round(Number(request.width) || 1));
    const heightPx = Math.max(1, Math.round(Number(request.height) || 1));
    const key = `${widthPx}x${heightPx}`;
    let pg = this.surfaceTextures.get(key);
    if (!pg) {
      pg = createSharedFramebufferTarget(widthPx, heightPx) || createGraphics(widthPx, heightPx);
      if (!isSharedFramebufferTarget(pg)) {
        this.applyGraphicsPixelDensity(pg, this.requestPixelDensity(request));
        this.applyGraphicsFont(pg);
      }
      this.surfaceTextures.set(key, pg);
    }
    return pg;
  }

  drawDirectSurfaceTexture(texture, route = {}, alpha = 1) {
    const rect = route.mapped?.directRect || cornersRect(route.mapped?.mapperSurface?.corners || []);
    if (!texture || !rect || alpha <= 0) return;
    const fit = directFitRects(texture.width, texture.height, rect, route.surface?.projectionFit || "contain");
    const drawable = isSharedFramebufferTarget(texture) ? unwrapRenderTarget(texture) : texture;
    push();
    try {
      resetShader();
      imageMode(CORNER);
      applyBlendGlobal(route.surface?.finalBlend || "normal");
      tint(255, 255 * clamp01(alpha));
      image(
        drawable,
        fit.destination.x - width * 0.5,
        fit.destination.y - height * 0.5,
        fit.destination.width,
        fit.destination.height,
        fit.source.x,
        fit.source.y,
        fit.source.width,
        fit.source.height
      );
      noTint();
      blendMode(BLEND);
    } finally {
      pop();
    }
  }

  canDirectProjectSurfaceRoute(route = {}, outputBlackout = false) {
    if (outputBlackout || this.shouldUseThumbnailPreview()) return false;
    if (route.surface?.finalShaderChain?.length) return false;
    return !(
      this.mode !== "output" &&
      this.state?.global?.showLabels !== false &&
      this.mapper?.isCalibrating?.()
    );
  }

  renderSurfaceRouteView(route = {}) {
    const { surface = {}, component = null, componentRequest = null, demand = null } = route;
    if (!surface.componentId) return null;
    const componentTime = this.componentTimes.get(surface.componentId) || 0;
    const texture = component
      ? this.renderComponentForRequest(component, componentTime, componentRequest)
      : this.mainMix;
    if (!texture) return null;
    return {
      texture,
      sourceRect: scaledComponentSampleRect(demand?.sampleRect, demand?.logicalSize, texture),
    };
  }

  drawSurfaceRouteView(view, route = {}) {
    const { surface = {}, mapped = {}, surfaceRequest = {} } = route;
    const opacity = clamp01(surface.opacity);
    push();
    try {
      applyBlendGlobal(surface.finalBlend || "normal");
      if (mapped.direct && Number(surface.feather) <= 0) {
        this.drawDirectSurfaceView(view, route, opacity);
      } else {
        this.mapper.drawTexture(
          view.texture,
          mapped.mapperSurface,
          surface.projectionFit,
          surface.feather,
          {
            sourceRect: view.sourceRect,
            surfaceSize: surfaceRequest,
            opacity,
          }
        );
      }
    } finally {
      blendMode(BLEND);
      pop();
    }
  }

  drawDirectSurfaceView(view, route = {}, opacity = 1) {
    const rect = route.mapped?.directRect || cornersRect(route.mapped?.mapperSurface?.corners || []);
    const sourceRect = view?.sourceRect;
    const texture = view?.texture;
    if (!texture || !sourceRect || !rect || opacity <= 0) return;
    const fit = directFitRects(sourceRect.width, sourceRect.height, rect, route.surface?.projectionFit || "contain");
    const drawable = isSharedFramebufferTarget(texture) ? unwrapRenderTarget(texture) : texture;
    resetShader();
    imageMode(CORNER);
    tint(255, 255 * opacity);
    image(
      drawable,
      fit.destination.x - width * 0.5,
      fit.destination.y - height * 0.5,
      fit.destination.width,
      fit.destination.height,
      sourceRect.x + fit.source.x,
      sourceRect.y + fit.source.y,
      fit.source.width,
      fit.source.height
    );
    noTint();
  }

  drawSurfaceRoute(pg, route = {}) {
    const { surface = {}, component = null, surfaceRequest: request = null, componentRequest = null, demand = null } = route;
    if (!surface.componentId) {
      pg.clear();
      return;
    }
    if (this.shouldUseThumbnailPreview()) {
      this.drawSurfaceThumbnailRoute(pg, surface, demand);
      return;
    }
    // Component time belongs to the component, not to the projector
    // surface. Per-surface final effects retain their own instance identity.
    const componentTime = this.componentTimes.get(surface.componentId) || 0;
    const source = component
      ? this.renderComponentForRequest(component, componentTime, componentRequest)
      : this.mainMix;

    pg.push();
    applyBlend(pg, surface.finalBlend);
    pg.tint(255, 255 * clamp01(surface.opacity));
    const sampleRect = scaledComponentSampleRect(demand?.sampleRect, demand?.logicalSize, source);
    drawSampleRect(pg, source, sampleRect, 0, 0, pg.width, pg.height);
    pg.noTint();
    pg.blendMode(BLEND);
    pg.pop();

    if (surface.finalShaderChain?.length) {
      const effectIdentity = this.transitionSurfaceEffectPrefix ? `${this.transitionSurfaceEffectPrefix}:${surface.id}` : surface.id;
      const effected = this.renderShaderChain(pg, withShaderInstancePrefix(surface.finalShaderChain, effectIdentity), request, this.visualTime);
      drawBuffer(pg, effected, 0, 0, pg.width, pg.height, this.isShaderBuffer(effected));
    }
  }

  drawSurfaceThumbnailRoute(pg, surface, demand = null) {
    const component = this.state.components.find((item) => item.id === surface.componentId);
    const thumbnail = this.getThumbnailImage(component);
    pg.push();
    applyBlend(pg, surface.finalBlend);
    pg.tint(255, 255 * clamp01(surface.opacity));
    if (thumbnail?.ready && thumbnail.img) {
      const sampleRect = scaledComponentSampleRect(demand?.sampleRect, demand?.logicalSize, thumbnail.img);
      drawSampleRect(pg, thumbnail.img, sampleRect, 0, 0, pg.width, pg.height);
    } else {
      drawStandby(pg, component?.thumbnail ? "loading thumbnail" : "no thumbnail");
    }
    pg.noTint();
    pg.blendMode(BLEND);
    pg.pop();
  }

  getThumbnailImage(component) {
    if (!component?.thumbnail) return null;
    const existing = this.thumbnailImages.get(component.id);
    if (existing?.src === component.thumbnail) return existing;
    const item = { src: component.thumbnail, img: null, ready: false };
    this.thumbnailImages.set(component.id, item);
    loadImage(
      component.thumbnail,
      (img) => {
        item.img = img;
        item.ready = true;
      },
      () => {
        item.ready = false;
      }
    );
    return item;
  }

  captureThumbnailEditTransformBaselines() {
    this.thumbnailEditTransformBaselines.clear();
    for (const component of this.state?.components || []) {
      for (const item of flattenComponentChain(component.chain || [])) {
        if (item?.id) this.thumbnailEditTransformBaselines.set(`${component.id}:${item.id}`, normalizedContentTransform(item.transform));
      }
    }
  }

  isShaderBuffer(buffer) {
    if (!buffer) return false;
    if (isSharedFramebufferTarget(buffer)) return true;
    if (buffer.__vj1ShaderBuffer) return true;
    for (const group of this.fxTargetGroups?.values?.() || []) {
      if ((group.targets || []).includes(buffer)) return true;
    }
    return false;
  }

  requestMissingMedia(mediaId) {
    if (!mediaId || millis() - this.lastMediaRequestAt < 1200) return;
    this.lastMediaRequestAt = millis();
    this.requestMediaFiles?.([mediaId]);
  }

  getImageRendition(item, rw, rh) {
    if (!item?.image || !isDrawableMedia(item.image)) return null;
    const widthPx = Math.max(1, Math.floor(Number(rw) || 1));
    const heightPx = Math.max(1, Math.floor(Number(rh) || 1));
    const key = mediaRenditionKey(item.id, widthPx, heightPx);
    const existing = item.imageRenditions?.get?.(key);
    if (existing) return existing;
    const source = item.image.elt || item.image;
    const sourceWidth = source.naturalWidth || source.width || item.image.width || widthPx;
    const sourceHeight = source.naturalHeight || source.height || item.image.height || heightPx;
    if (sourceWidth <= widthPx * 1.15 && sourceHeight <= heightPx * 1.15) return item.image;
    const pg = createGraphics(widthPx, heightPx);
    pg.pixelDensity?.(1);
    this.applyGraphicsFont(pg);
    pg.push();
    pg.clear();
    drawCover(pg, item.image, 0, 0, widthPx, heightPx);
    pg.pop();
    item.imageRenditions ||= new Map();
    item.imageRenditionOrder ||= [];
    item.imageRenditions.set(key, pg);
    item.imageRenditionOrder.push(key);
    this.queueMediaRenditionSave(item.id, widthPx, heightPx, pg);
    while (item.imageRenditionOrder.length > 4) {
      const staleKey = item.imageRenditionOrder.shift();
      const stale = item.imageRenditions.get(staleKey);
      item.imageRenditions.delete(staleKey);
      disposeGraphics(stale);
    }
    return pg;
  }

  queueMediaRenditionSave(mediaId, widthPx, heightPx, pg) {
    if (!this.sendMediaRendition || !pg || !mediaId) return;
    const key = mediaRenditionKey(mediaId, widthPx, heightPx);
    if (this.pendingRenditionSaves.has(key)) return;
    this.pendingRenditionSaves.add(key);
    graphicsToPngBlob(pg)
      .then((blob) => blob ? this.sendMediaRendition(mediaId, widthPx, heightPx, blob) : false)
      .then((saved) => {
        if (!saved) this.pendingRenditionSaves.delete(key);
      })
      .catch(() => {
        this.pendingRenditionSaves.delete(key);
      });
  }

  renderComponentPreview() {
    const componentId = this.state.ui.selectedComponentId || this.state.components[0]?.id || "";
    const component = this.state.components.find((item) => item.id === componentId);
    const source = this.componentOutput.get(componentId);
    resetShader();
    push();
    imageMode(CORNER);
    if (this.shouldUseThumbnailPreview()) {
      const drewEditableCanvas = component?.type === "canvas" && this.renderCanvasThumbnailEditPreview(component);
      if (!drewEditableCanvas) this.renderFlattenedThumbnailEditPreview(component);
    } else if (source) {
      const rect = this.componentPreviewRect(component, source);
      image(unwrapRenderTarget(source), rect.x - width / 2, rect.y - height / 2, rect.width, rect.height);
    } else {
      const fallback = this.mainMix;
      image(unwrapRenderTarget(fallback), -width / 2, -height / 2, width, height);
    }
    pop();
    this.renderComponentFrameOverlay(component, source);
    this.renderCanvasRecordingFrames(component, source);
    this.renderSelectedChainTransformOverlay();
  }

  renderFlattenedThumbnailEditPreview(component) {
    const thumbnail = this.getThumbnailImage(component);
    if (!thumbnail?.ready || !thumbnail.img) return false;
    // The current component frame is authoritative. Older thumbnails may
    // have been captured under a different aspect and must never resize or
    // escape the current editing frame.
    const rect = this.componentPreviewRect(component);
    const item = this.selectedTransformableChainItem();
    const current = normalizedContentTransform(item?.transform);
    const baseline = item
      ? this.thumbnailEditTransformBaselines.get(`${component.id}:${item.id}`) || current
      : current;
    const editScale = current.scale / Math.max(0.01, baseline.scale);
    withScreenScissor(rect, () => {
      push();
      translate(
        rect.x - width * 0.5 + rect.width * (0.5 + (current.x - baseline.x) * 0.5),
        rect.y - height * 0.5 + rect.height * (0.5 + (current.y - baseline.y) * 0.5)
      );
      rotate(current.rotation - baseline.rotation);
      scale(editScale);
      drawImageCoverCrop(thumbnail.img, -rect.width * 0.5, -rect.height * 0.5, rect.width, rect.height);
      pop();
    });
    return true;
  }

  renderCanvasThumbnailEditPreview(component) {
    const rect = this.componentPreviewRect(component);
    let drawn = 0;
    const drawChain = (chain, parentTransform = normalizedContentTransform(), parentOpacity = 1) => {
      for (const item of chain || []) {
        if (item?.enabled === false) continue;
        if (item.kind === "group") {
          drawChain(
            item.chain || [],
            combineContentTransforms(parentTransform, item.transform),
            parentOpacity * clamp01(item.opacity ?? 1)
          );
          continue;
        }
        if (item.kind !== "source" || item.source?.type !== "component") continue;
        const dependency = this.state.components.find((candidate) => candidate.id === item.source.componentId);
        if (!dependency || dependency.type === "canvas") continue;
        const thumbnail = this.getThumbnailImage(dependency);
        if (!thumbnail?.ready || !thumbnail.img) continue;
        const placement = componentReferencePlacement(component, dependency, this.state.render, rect, item.source?.placement);
        const transform = combineContentTransforms(parentTransform, item.transform);
        push();
        translate(
          rect.x - width * 0.5 + rect.width * (0.5 + transform.x * 0.5),
          rect.y - height * 0.5 + rect.height * (0.5 + transform.y * 0.5)
        );
        rotate(transform.rotation);
        scale(transform.scale);
        tint(255, 255 * parentOpacity * clamp01(item.opacity ?? 1));
        drawImageCoverCrop(
          thumbnail.img,
          placement.x - rect.width * 0.5,
          placement.y - rect.height * 0.5,
          placement.width,
          placement.height
        );
        noTint();
        pop();
        drawn++;
      }
    };
    withScreenScissor(rect, () => drawChain(component.chain || []));
    return drawn > 0;
  }

  componentPreviewRect(component, source = null) {
    if (source?.width && source?.height) return containedRect(width, height, source.width, source.height);
    if (component?.type === "canvas") {
      return containedRect(width, height, component.canvas?.width, component.canvas?.height);
    }
    const metrics = componentFrameMetrics(this.state?.render || {}, component || {});
    return containedRect(width, height, metrics.baseWidth, metrics.baseHeight);
  }

  renderComponentFrameOverlay(component, source = null) {
    if (this.mode !== "component" || !component) return;
    const frame = this.componentPreviewRect(component, source);
    const inset = 1.5;
    resetShader();
    push();
    noFill();
    stroke(101, 224, 211, 235);
    strokeWeight(2);
    rectMode(CORNER);
    rect(
      frame.x - width * 0.5 + inset,
      frame.y - height * 0.5 + inset,
      Math.max(0, frame.width - inset * 2),
      Math.max(0, frame.height - inset * 2)
    );
    pop();
  }

  renderCanvasRecordingFrames(component, source = null) {
    if (this.mode !== "component" || component?.type !== "canvas") return;
    resetShader();
    push();
    noFill();
    stroke(255, 228, 94, 235);
    strokeWeight(2);
    rectMode(CORNER);
    for (const item of this.canvasRecordingFrameRects(component, source)) {
      rect(item.x - width * 0.5, item.y - height * 0.5, item.width, item.height);
      noStroke();
      fill(255, 228, 94, 245);
      for (const corner of canvasRectCorners(item)) {
        rect(corner.x - width * 0.5 - 5, corner.y - height * 0.5 - 5, 10, 10);
      }
      noFill();
      stroke(255, 228, 94, 235);
    }
    pop();
  }

  canvasRecordingFrameRects(component, source = null) {
    if (component?.type !== "canvas") return [];
    const canvasWidth = Math.max(1, Number(component.canvas?.width) || VJ1.canvasWidth);
    const canvasHeight = Math.max(1, Number(component.canvas?.height) || VJ1.canvasHeight);
    const preview = this.componentPreviewRect(component, source);
    return (this.state?.recordingFrames || []).map((frame) => ({
      frame,
      x: preview.x + (Math.max(0, Number(frame.x) || 0) / canvasWidth) * preview.width,
      y: preview.y + (Math.max(0, Number(frame.y) || 0) / canvasHeight) * preview.height,
      width: (Math.max(1, Number(frame.width) || 1) / canvasWidth) * preview.width,
      height: (Math.max(1, Number(frame.height) || 1) / canvasHeight) * preview.height,
    }));
  }

  renderSelectedChainTransformOverlay() {
    if (this.mode !== "component") return;
    const item = this.selectedTransformableChainItem();
    if (!item) return;
    const component = this.state.components.find((entry) => entry.id === this.state.ui.selectedComponentId);
    const frame = this.componentPreviewRect(component, this.componentOutput.get(component?.id));
    const transform = item.transform || {};
    resetShader();
    push();
    noFill();
    stroke(101, 224, 211, 230);
    strokeWeight(2);
    const frameCenterX = frame.x + frame.width * 0.5 - width * 0.5;
    const frameCenterY = frame.y + frame.height * 0.5 - height * 0.5;
    const cx = frameCenterX + (Number(transform.x) || 0) * frame.width * 0.5;
    const cy = frameCenterY + (Number(transform.y) || 0) * frame.height * 0.5;
    const rotation = Number(transform.rotation) || 0;
    const scaleHandleX = 42;
    const scaleHandleY = 0;
    const rotateHandleX = 0;
    const rotateHandleY = -42;

    // The component outline is rendered independently and remains visible
    // even when no chain element is selected.
    translate(frameCenterX, frameCenterY, 2);
    translate(cx - frameCenterX, cy - frameCenterY, 1);
    rotate(rotation);
    stroke(101, 224, 211, 170);
    line(0, 0, scaleHandleX, scaleHandleY);
    stroke(255, 228, 94, 180);
    line(0, 0, rotateHandleX, rotateHandleY);
    noStroke();
    fill(101, 224, 211, 230);
    circle(0, 0, 20);
    circle(scaleHandleX, scaleHandleY, 18);
    fill(255, 228, 94, 230);
    circle(rotateHandleX, rotateHandleY, 16);
    pop();
  }

  setCalibrate(on) {
    const enabled = this.mode !== "output" && !!on;
    if (this.state?.global) this.state.global.calibrating = enabled;
    this.mapper?.setCalibrate(enabled);
  }

  mousePressed(x, y) {
    if (this.mode === "component" && this.startCanvasFrameDrag(x, y)) return;
    if (this.mode === "component" && this.startChainTransformDrag(x, y)) return;
    this.mapper?.mousePressed?.(x, y);
    const surfaceIndex = Number(this.mapper?._dragSurf);
    const surfaceName = Number.isInteger(surfaceIndex) && surfaceIndex >= 0
      ? this.mapper?.surfaces?.[surfaceIndex]?.name
      : "";
    if (surfaceName) this.onSurfaceSelect?.(surfaceName);
  }

  mouseDragged(x, y) {
    if (this.canvasFrameDrag) {
      this.updateCanvasFrameDrag(x, y);
      return;
    }
    if (this.chainTransformDrag) {
      this.updateChainTransformDrag(x, y);
      return;
    }
    this.mapper?.mouseDragged?.(x, y);
  }

  mouseReleased() {
    if (this.canvasFrameDrag) {
      const drag = this.canvasFrameDrag;
      this.canvasFrameDrag = null;
      if (drag.lastRect) this.sendCanvasFrame?.(drag.componentId, drag.frameId, drag.lastRect, { commit: true });
      return;
    }
    if (this.chainTransformDrag) {
      this.chainTransformDrag = null;
      return;
    }
    this.mapper?.mouseReleased?.();
  }

  startCanvasFrameDrag(x, y) {
    const component = this.state?.components?.find((item) => item.id === this.state?.ui?.selectedComponentId);
    if (component?.type !== "canvas") return false;
    const source = this.componentOutput.get(component.id);
    const rects = this.canvasRecordingFrameRects(component, source);
    for (let index = rects.length - 1; index >= 0; index--) {
      const item = rects[index];
      const corners = canvasRectCorners(item);
      const corner = corners.find((entry) => distanceSquared(x, y, entry.x, entry.y) <= 15 * 15);
      const border = canvasFrameBorderHit(item, x, y);
      if (!corner && !border) continue;
      const canvasWidth = Math.max(1, Number(component.canvas?.width) || VJ1.canvasWidth);
      const canvasHeight = Math.max(1, Number(component.canvas?.height) || VJ1.canvasHeight);
      const frame = item.frame;
      this.canvasFrameDrag = {
        componentId: component.id,
        frameId: frame.id,
        mode: corner?.id || "move",
        startX: x,
        startY: y,
        previewWidth: Math.max(1, this.componentPreviewRect(component, source).width),
        previewHeight: Math.max(1, this.componentPreviewRect(component, source).height),
        canvasWidth,
        canvasHeight,
        rect: {
          x: Math.max(0, Number(frame.x) || 0),
          y: Math.max(0, Number(frame.y) || 0),
          width: Math.max(16, Number(frame.width) || 16),
          height: Math.max(16, Number(frame.height) || 16),
        },
        lastRect: null,
      };
      return true;
    }
    return false;
  }

  updateCanvasFrameDrag(x, y) {
    const drag = this.canvasFrameDrag;
    if (!drag) return;
    const dx = (x - drag.startX) * drag.canvasWidth / drag.previewWidth;
    const dy = (y - drag.startY) * drag.canvasHeight / drag.previewHeight;
    const next = drag.mode === "move"
      ? moveCanvasFrameRect(drag.rect, dx, dy, drag.canvasWidth, drag.canvasHeight)
      : resizeCanvasFrameRect(drag.rect, drag.mode, dx, dy, drag.canvasWidth, drag.canvasHeight);
    drag.lastRect = next;
    this.applyLocalCanvasFrame(drag.componentId, drag.frameId, next);
    this.sendCanvasFrame?.(drag.componentId, drag.frameId, next, { commit: false });
  }

  applyLocalCanvasFrame(componentId, frameId, rect) {
    const frame = this.state?.recordingFrames?.find((item) => item.id === frameId);
    if (frame) Object.assign(frame, rect);
  }

  isCalibrating() {
    return this.mode !== "output" && !!this.mapper?.isCalibrating();
  }

  saveMapping() {
    this.emitMapping(this.mapper?.exportData?.() || {}, "Mapping saved");
  }

  schedule(event) {
    if (this.state?.scheduler?.manualLane === false) return;
    this.manualScheduler.enqueue(event);
  }

  selectedTransformableChainItem() {
    const component = this.state?.components?.find((item) => item.id === this.state?.ui?.selectedComponentId);
    if (!component?.chain?.length) return null;
    const selected = findChainItemById(component.chain, this.state.ui.selectedChainItemId);
    if (selected?.kind === "source") return selected;
    if (selected?.kind === "group") return selected;
    const effectComponent = selected?.kind === "effect" ? getShaderComponent(selected.componentId) : null;
    return effectComponent?.spatial ? selected : null;
  }

  startChainTransformDrag(x, y) {
    const item = this.selectedTransformableChainItem();
    if (!item) return false;
    const component = this.state.components.find((entry) => entry.id === this.state.ui.selectedComponentId);
    const frame = this.componentPreviewRect(component, this.componentOutput.get(component?.id));
    const transform = item.transform || {};
    const cx = frame.x + frame.width * 0.5 + (Number(transform.x) || 0) * frame.width * 0.5;
    const cy = frame.y + frame.height * 0.5 + (Number(transform.y) || 0) * frame.height * 0.5;
    const scale = Math.max(0.01, Number(transform.scale) || 1);
    const rotation = Number(transform.rotation) || 0;
    const local = screenToLayerLocal(x, y, cx, cy, rotation);
    const scaleDx = local.x - 42;
    const scaleDy = local.y;
    const rotateDx = local.x;
    const rotateDy = local.y + 42;
    const inside = x >= frame.x && x <= frame.x + frame.width && y >= frame.y && y <= frame.y + frame.height;
    let mode = "";
    if (scaleDx * scaleDx + scaleDy * scaleDy <= 28 * 28) mode = "scale";
    else if (rotateDx * rotateDx + rotateDy * rotateDy <= 30 * 30) mode = "rotate";
    else if (inside) mode = "move";
    if (!mode) return false;
    this.chainTransformDrag = {
      itemId: item.id,
      componentId: this.state.ui.selectedComponentId,
      mode,
      startX: x,
      startY: y,
      centerX: cx,
      centerY: cy,
      frameWidth: frame.width,
      frameHeight: frame.height,
      transform: { x: Number(transform.x) || 0, y: Number(transform.y) || 0, scale, rotation },
      startDistance: Math.max(1, dist(x, y, cx, cy)),
      startAngle: Math.atan2(y - cy, x - cx),
    };
    return true;
  }

  updateChainTransformDrag(x, y) {
    const drag = this.chainTransformDrag;
    if (!drag) return;
    const next = { ...drag.transform };
    if (drag.mode === "move") {
      next.x = drag.transform.x + ((x - drag.startX) / Math.max(1, drag.frameWidth * 0.5));
      next.y = drag.transform.y + ((y - drag.startY) / Math.max(1, drag.frameHeight * 0.5));
    } else if (drag.mode === "scale") {
      const distance = Math.max(1, dist(x, y, drag.centerX, drag.centerY));
      next.scale = Math.max(0.05, drag.transform.scale * (distance / drag.startDistance));
    } else if (drag.mode === "rotate") {
      const angle = Math.atan2(y - drag.centerY, x - drag.centerX);
      next.rotation = drag.transform.rotation + (angle - drag.startAngle);
    }
    this.applyLocalChainTransform(drag.componentId, drag.itemId, next);
    this.sendChainTransform?.(drag.componentId, drag.itemId, next);
  }

  applyLocalChainTransform(componentId, itemId, transform) {
    const component = this.state?.components?.find((item) => item.id === componentId);
    const item = findChainItemById(component?.chain, itemId);
    if (item) item.transform = { ...item.transform, ...transform };
  }

  loadMapping() {
    this.applyProjectMapping();
  }

  resetMapping(surfaceId = "") {
    if (surfaceId) {
      this.mapper?.resetSurface?.(surfaceId);
      this.emitMapping(this.mapper?.exportData?.() || {}, "Surface mapping reset");
      return;
    }
    this.mapper?.resetAll();
    this.emitMapping(this.mapper?.exportData?.() || {}, "Mapping reset");
  }

  exportMapping() {
    downloadJson(this.mappingFromRenderMode(this.mapper?.exportData?.() || {}), "vj1-mapping.json");
  }

  resize() {
    if (!this.buffersMatchRenderSize()) {
      this.createBuffers();
    }
    this.rebuildSurfaces();
    this.applyProjectMapping();
  }

  outputMediaReadiness() {
    const status = createMediaReadinessStatus();
    if (this.mode !== "output" || !this.state) return status;
    const componentsById = new Map((this.state.components || []).map((component) => [component.id, component]));
    for (const surface of this.state.surfaces || []) {
      if (surface.enabled === false || !surface.componentId) continue;
      this.collectComponentMediaReadiness(componentsById.get(surface.componentId), status, componentsById, new Set());
    }
    status.blocked = status.loadingIds.size > 0 || status.missingIds.size > 0 || status.errorIds.size > 0;
    return status;
  }

  collectComponentMediaReadiness(component, status, componentsById, visited) {
    if (!component || !status || visited.has(component.id)) return;
    visited.add(component.id);
    if (Array.isArray(component.chain) && component.chain.length) {
      this.collectChainMediaReadiness(component.chain, status, componentsById, visited);
    } else {
      this.collectSourceMediaReadiness(component.source, status);
    }
    visited.delete(component.id);
  }

  collectChainMediaReadiness(chain, status, componentsById, visited) {
    for (const item of chain || []) {
      if (item.enabled === false) continue;
      if (item.kind === "group") {
        this.collectChainMediaReadiness(item.chain || [], status, componentsById, visited);
        continue;
      }
      if (item.kind === "source" && item.source?.type === "component") {
        this.collectComponentMediaReadiness(componentsById.get(item.source.componentId), status, componentsById, visited);
      } else if (item.kind === "source") {
        this.collectSourceMediaReadiness(item.source, status);
      }
    }
  }

  collectSourceMediaReadiness(source, status) {
    if (source?.type !== "media") return;
    const mediaId = source.mediaId || "";
    if (!mediaId) return;
    status.total++;
    const item = this.media.get(mediaId);
    if (!item) {
      status.missingIds.add(mediaId);
      this.requestMissingMedia(mediaId);
      return;
    }
    if (item.imageError || item.modelError) {
      status.errorIds.add(mediaId);
      return;
    }
    if (!isReadyMediaItem(item)) status.loadingIds.add(mediaId);
  }

  isOutputBlackout() {
    return this.mode === "output" && (!!this.state.global.blackout || !!this.outputMediaStatus?.blocked);
  }

  shouldUseThumbnailPreview() {
    return (this.mode === "preview" || this.mode === "component") && this.state?.ui?.debugPreview === false;
  }

  updateHudAndMetrics() {
    this.gpuTimer.poll(this.frameIndex);
    const frameMs = Math.max(0, Number(this.lastFrameProfile?.totalMs) || (performance.now() - this.frameStart));
    const fps = frameRate();
    const renderCost = frameMs / (1000 / 120);
    this.updateSmoothedMetrics({ fps, frameMs, renderCost });
    this.updateGpuMetric();
    if (this.hud) {
      const hideOutputHud = this.mode === "output" && this.state?.global?.showLabels === false;
      const mediaLoading = this.mode === "output" && !!this.outputMediaStatus?.blocked;
      const showResolution = this.mode !== "output" || this.state?.global?.showLabels !== false;
      const resolution = showResolution ? `<span class="output-resolution">${this.renderResolutionLabel()}</span>` : "";
      this.hud.classList.toggle("is-hidden", !this.state.global.showHud || (hideOutputHud && !mediaLoading));
      this.hud.classList.toggle("is-loading", mediaLoading);
      this.hud.innerHTML = `${mediaLoading ? `<span class="output-loading-dot" aria-hidden="true"></span>` : ""}<span>${Math.round(this.smoothedFps || fps)} fps</span>${resolution}`;
    }
    if (millis() - this.lastMetricsAt > 500) {
      this.lastMetricsAt = millis();
      const renderResolution = this.renderResolutionSize();
      this.sendMetrics?.({
        fps: this.smoothedFps || fps,
        frameMs: this.smoothedFrameMs || frameMs,
        gpuMs: this.smoothedGpuMs || this.gpuTimer.latestMs || 0,
        gpuSupported: this.gpuTimer.supported,
        renderCost: this.smoothedRenderCost || renderCost,
        renderWidth: renderResolution.width,
        renderHeight: renderResolution.height,
        renderPixelDensity: renderResolution.density,
        profile: this.lastFrameProfile,
        message: this.shouldUseThumbnailPreview()
          ? "thumbnail preview"
          : this.mode === "component" ? "component preview" : `${this.mode} rendering`,
      });
    }
  }

  updateSmoothedMetrics({ fps, frameMs, renderCost }) {
    const alpha = 0.12;
    if (!this.smoothedFrameMs) {
      this.smoothedFrameMs = frameMs;
      this.smoothedFps = fps;
      this.smoothedRenderCost = renderCost;
      return;
    }
    this.smoothedFrameMs += (frameMs - this.smoothedFrameMs) * alpha;
    this.smoothedFps += (fps - this.smoothedFps) * alpha;
    this.smoothedRenderCost += (renderCost - this.smoothedRenderCost) * alpha;
  }

  updateGpuMetric() {
    if (this.gpuTimer.sampleId === this.lastGpuSampleId) return;
    this.lastGpuSampleId = this.gpuTimer.sampleId;
    const value = Math.max(0, Number(this.gpuTimer.latestMs) || 0);
    this.smoothedGpuMs = this.smoothedGpuMs
      ? this.smoothedGpuMs + (value - this.smoothedGpuMs) * 0.12
      : value;
  }

  captureSelectedComponentThumbnail() {
    // This method can be reached by a frame that began just before the preview
    // toggle changed. Never read or publish the thumbnail-mode proxy buffer.
    if (this.shouldUseThumbnailPreview()) return;
    if (!this.sendThumbnail || millis() - this.lastThumbnailAt < 1200) return;
    const component = this.state.components.find((item) => item.id === this.state.ui.selectedComponentId) || this.state.components[0];
    if (!component) return;
    const output = this.componentOutput.get(component.id);
    if (!output) return;
    const signature = componentThumbnailSignature(component);
    const needsComponentThumbnail = !component.thumbnail || this.thumbnailSignatures.get(component.id) !== signature;
    const framesNeedingThumbnails = component.type === "canvas"
      ? (this.state.recordingFrames || []).filter((frame) => {
          const frameKey = `${component.id}:${frame.id}`;
          const frameSignature = `${signature}:${frame.x},${frame.y},${frame.width},${frame.height}`;
          return !component.canvas?.frameThumbnails?.[frame.id] || this.thumbnailSignatures.get(frameKey) !== frameSignature;
        })
      : [];
    // Throttle checks as well as captures. In particular, never call get() on a
    // full WebGL framebuffer until metadata proves that a thumbnail is stale.
    this.lastThumbnailAt = millis();
    if (!needsComponentThumbnail && !framesNeedingThumbnails.length) return;
    const readback = isSharedFramebufferTarget(output);
    const thumbnailSource = readback ? output.get() : output;
    let captured = false;
    if (needsComponentThumbnail) {
      const thumbnail = graphicsToThumbnail(thumbnailSource);
      if (thumbnail) {
        this.thumbnailSignatures.set(component.id, signature);
        this.sendThumbnail(component.id, thumbnail);
        captured = true;
      }
    }
    if (component.type === "canvas") {
      const sourceWidth = Math.max(1, Number(thumbnailSource?.width || thumbnailSource?.canvas?.width) || 1);
      const sourceHeight = Math.max(1, Number(thumbnailSource?.height || thumbnailSource?.canvas?.height) || 1);
      const logicalWidth = Math.max(1, Number(component.canvas?.width) || sourceWidth);
      const logicalHeight = Math.max(1, Number(component.canvas?.height) || sourceHeight);
      for (const frame of framesNeedingThumbnails) {
        const frameKey = `${component.id}:${frame.id}`;
        const frameSignature = `${signature}:${frame.x},${frame.y},${frame.width},${frame.height}`;
        const frameThumbnail = graphicsToThumbnail(thumbnailSource, COMPONENT_THUMBNAIL_WIDTH, COMPONENT_THUMBNAIL_HEIGHT, {
          x: Number(frame.x) * sourceWidth / logicalWidth,
          y: Number(frame.y) * sourceHeight / logicalHeight,
          width: Number(frame.width) * sourceWidth / logicalWidth,
          height: Number(frame.height) * sourceHeight / logicalHeight,
        });
        if (!frameThumbnail) continue;
        this.thumbnailSignatures.set(frameKey, frameSignature);
        this.sendThumbnail(component.id, frameThumbnail, { frameId: frame.id });
        captured = true;
      }
    }
    if (readback) thumbnailSource?.remove?.();
  }
}

function mappingStatusForReason(reason = "") {
  if (reason === "autosave") return "Mapping updated";
  if (reason === "reset") return "Mapping reset";
  if (reason === "save" || reason === "save-all") return "Mapping saved";
  return "Mapping updated";
}

function formatDensity(value = 1) {
  const rounded = Math.round(Number(value) * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function mappingSignature(mapping) {
  try {
    return JSON.stringify(mapping || null);
  } catch {
    return "";
  }
}

function offsetMapping(mapping = {}, dx = 0, dy = 0) {
  return {
    ...mapping,
    surfaces: (mapping.surfaces || []).map((surface) => ({
      ...surface,
      corners: (surface.corners || []).map((corner) => ({
        ...corner,
        x: Number(corner.x) + dx,
        y: Number(corner.y) + dy,
      })),
    })),
  };
}

function transformMapping(mapping = {}, sx = 1, sy = 1, dx = 0, dy = 0) {
  return {
    ...mapping,
    surfaces: (mapping.surfaces || []).map((surface) => ({
      ...surface,
      corners: (surface.corners || []).map((corner) => ({
        ...corner,
        x: Number(corner.x) * sx + dx,
        y: Number(corner.y) * sy + dy,
      })),
    })),
  };
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function stableSurfaceRenderRequest(render = {}, meta = {}) {
  return createRenderRequest("surface", defaultSurfaceTextureSize(render), {
    ...meta,
    timingId: meta.timingId || meta.surfaceId || "",
    renderIdentity: meta.renderIdentity ?? meta.instanceId ?? "",
  });
}

function componentRenderRequest(render = {}, component = {}, role = "texture", meta = {}) {
  const metrics = componentFrameMetrics(render, component);
  return createRenderRequest(role, metrics, {
    ...meta,
    logicalWidth: metrics.baseWidth,
    logicalHeight: metrics.baseHeight,
    pixelDensityApplied: true,
    frameShape: metrics.frameShape,
    resolutionScale: metrics.resolutionScale,
    effectiveScale: metrics.effectiveScale,
    timingId: meta.timingId || meta.surfaceId || "",
    renderIdentity: meta.renderIdentity ?? meta.instanceId ?? component.id ?? "",
  });
}

export function componentPipelineSourceRequest(request = {}, pipeline = {}) {
  const upscaling = pipeline?.upscaling || {};
  if (upscaling.enabled !== true || Number(upscaling.amount) >= 0.999) return request;
  const amount = Math.min(1, Math.max(0.35, Number(upscaling.amount) || 0.67));
  return createRenderRequest(request.role || "texture", {
    width: Math.max(1, Math.round((Number(request.width) || 1) * amount)),
    height: Math.max(1, Math.round((Number(request.height) || 1) * amount)),
  }, {
    ...request,
    logicalWidth: Math.max(1, Number(request.logicalWidth) || Number(request.width) || 1),
    logicalHeight: Math.max(1, Number(request.logicalHeight) || Number(request.height) || 1),
    pipelineSource: true,
    pipelineScale: amount,
  });
}

function defaultSurfaceTextureSize(render = {}) {
  const frame = frameSize(render);
  const maxTexture = componentTextureSize(render);
  const scale = Math.min(
    maxTexture.width / Math.max(1, frame.width),
    maxTexture.height / Math.max(1, frame.height)
  );
  return {
    width: Math.max(1, Math.round(frame.width * scale)),
    height: Math.max(1, Math.round(frame.height * scale)),
  };
}

function containedRect(containerWidth, containerHeight, contentWidth, contentHeight) {
  const cw = Math.max(1, Number(containerWidth) || 1);
  const ch = Math.max(1, Number(containerHeight) || 1);
  const iw = Math.max(1, Number(contentWidth) || 1);
  const ih = Math.max(1, Number(contentHeight) || 1);
  const scale = Math.min(cw / iw, ch / ih);
  const width = iw * scale;
  const height = ih * scale;
  return {
    x: (cw - width) * 0.5,
    y: (ch - height) * 0.5,
    width,
    height,
  };
}

function isSourceNode(node = {}) {
  return node.role === "source" || node.kind === "source" || node.kind === "generator";
}

function isEffectNode(node = {}) {
  return node.role === "effect" || node.kind === "effect";
}

function findChainItemById(chain = [], id = "") {
  if (!Array.isArray(chain) || !id) return null;
  for (const item of chain) {
    if (item.id === id) return item;
    const nested = item.kind === "group" ? findChainItemById(item.chain, id) : null;
    if (nested) return nested;
  }
  return null;
}

function combineContentTransforms(parent = {}, child = {}) {
  const outer = normalizedContentTransform(parent);
  const inner = normalizedContentTransform(child);
  const cosAngle = Math.cos(outer.rotation);
  const sinAngle = Math.sin(outer.rotation);
  const childX = inner.x * outer.scale;
  const childY = inner.y * outer.scale;
  return {
    x: outer.x + childX * cosAngle - childY * sinAngle,
    y: outer.y + childX * sinAngle + childY * cosAngle,
    scale: outer.scale * inner.scale,
    rotation: outer.rotation + inner.rotation,
  };
}

function drawImageCoverCrop(source, x, y, targetWidth, targetHeight) {
  const sourceWidth = Math.max(1, Number(source?.width || source?.naturalWidth || source?.elt?.naturalWidth) || targetWidth);
  const sourceHeight = Math.max(1, Number(source?.height || source?.naturalHeight || source?.elt?.naturalHeight) || targetHeight);
  const sourceAspect = sourceWidth / sourceHeight;
  const targetAspect = Math.max(1, targetWidth) / Math.max(1, targetHeight);
  let sx = 0;
  let sy = 0;
  let sw = sourceWidth;
  let sh = sourceHeight;
  if (sourceAspect > targetAspect) {
    sw = sourceHeight * targetAspect;
    sx = (sourceWidth - sw) * 0.5;
  } else if (sourceAspect < targetAspect) {
    sh = sourceWidth / targetAspect;
    sy = (sourceHeight - sh) * 0.5;
  }
  image(source, x, y, targetWidth, targetHeight, sx, sy, sw, sh);
}

function withScreenScissor(rect = {}, draw) {
  const gl = typeof drawingContext !== "undefined" ? drawingContext : null;
  if (!gl?.scissor || !gl?.enable || typeof draw !== "function") return draw?.();
  const canvasWidth = Math.max(1, Number(typeof width === "number" ? width : gl.drawingBufferWidth) || 1);
  const canvasHeight = Math.max(1, Number(typeof height === "number" ? height : gl.drawingBufferHeight) || 1);
  const scaleX = Math.max(0.0001, Number(gl.drawingBufferWidth) || canvasWidth) / canvasWidth;
  const scaleY = Math.max(0.0001, Number(gl.drawingBufferHeight) || canvasHeight) / canvasHeight;
  const left = Math.max(0, Math.min(canvasWidth, Number(rect.x) || 0));
  const top = Math.max(0, Math.min(canvasHeight, Number(rect.y) || 0));
  const right = Math.max(left, Math.min(canvasWidth, left + Math.max(0, Number(rect.width) || 0)));
  const bottom = Math.max(top, Math.min(canvasHeight, top + Math.max(0, Number(rect.height) || 0)));
  const wasEnabled = gl.isEnabled?.(gl.SCISSOR_TEST) === true;
  const previousBox = gl.getParameter?.(gl.SCISSOR_BOX);
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(
    Math.floor(left * scaleX),
    Math.floor((canvasHeight - bottom) * scaleY),
    Math.max(1, Math.ceil((right - left) * scaleX)),
    Math.max(1, Math.ceil((bottom - top) * scaleY))
  );
  try {
    return draw();
  } finally {
    if (previousBox?.length === 4) gl.scissor(previousBox[0], previousBox[1], previousBox[2], previousBox[3]);
    if (!wasEnabled) gl.disable(gl.SCISSOR_TEST);
  }
}

function nodesInComponentChainOrder(component = {}, patch = {}) {
  const nodes = (patch.nodes || []).filter((node) => isSourceNode(node) || isEffectNode(node));
  if (!Array.isArray(component.chain) || !component.chain.length) return nodes;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return flattenComponentChain(component.chain)
    .map((item, index) => {
      if (item.kind === "source") return nodeById.get(`${component.id || "component"}:source:${index}:${item.id}`);
      if (item.kind === "effect") return nodeById.get(`${component.id || "component"}:effect:${index}:${item.componentId}`);
      return null;
    })
    .filter(Boolean);
}

function patchLayerForNode(node = {}) {
  const layer = node.state?.layer || {};
  return {
    id: layer.id || node.id || "layer",
    name: layer.name || node.componentId || node.id || "Layer",
    opacity: layer.opacity ?? 1,
    blend: layer.blend || "normal",
    transform: layer.transform || {},
  };
}

function isSimpleLayer(layer = {}) {
  const transform = layer.transform || {};
  const opacity = layer.opacity === undefined ? 1 : Number(layer.opacity);
  return (layer.blend || "normal") === "normal" &&
    opacity === 1 &&
    isIdentityTransform(transform);
}

function isIdentityTransform(transform = {}) {
  return !Number(transform.x) &&
    !Number(transform.y) &&
    !Number(transform.rotation) &&
    (transform.scale === undefined || Number(transform.scale) === 1);
}

function sourceFromPatchNode(node = {}) {
  if (node.state?.source) return sourceWithNodeParams(node.state.source, node.params || {}, node.id || node.state?.layer?.id);
  const params = node.params || {};
  if (node.kind === "generator" || node.componentId === "testPattern" || params.generatorId) {
    const { generatorId, ...generatorParams } = params;
    return {
      type: "generator",
      generatorId: generatorId || node.componentId || "testPattern",
      params: generatorParams,
      instanceId: node.id || node.componentId || generatorId || "generator",
    };
  }
  if (node.componentId === "source.media" || params.mediaId) {
    const { mediaId, start, end, speed, ...mediaParams } = params;
    return {
      type: "media",
      mediaId: mediaId || "",
      start: Math.max(0, Number(start) || 0),
      end: Math.max(0, Number(end) || 0),
      speed: Math.max(0, Number(speed) || 1),
      params: mediaParams,
    };
  }
  if (node.componentId === "source.camera") return { type: "camera" };
  if (node.componentId === "source.black") return { type: "black" };
  return { type: "generator", generatorId: "testPattern" };
}

export function sourceWithNodeParams(source = {}, params = {}, instanceId = "") {
  const base = withSourceInstance(source, instanceId);
  if (base.type === "generator") {
    const { generatorId, ...generatorParams } = params || {};
    return {
      ...base,
      generatorId: base.generatorId || generatorId || "testPattern",
      params: {
        ...(base.params && typeof base.params === "object" ? base.params : {}),
        ...generatorParams,
      },
    };
  }
  if (base.type === "media") {
    const { mediaId, start, end, speed, ...mediaParams } = params || {};
    return {
      ...base,
      mediaId: base.mediaId || mediaId || "",
      ...(start !== undefined ? { start: Math.max(0, Number(start) || 0) } : {}),
      ...(end !== undefined ? { end: Math.max(0, Number(end) || 0) } : {}),
      ...(speed !== undefined ? { speed: Math.max(0, Number(speed) || 1) } : {}),
      params: {
        ...(base.params && typeof base.params === "object" ? base.params : {}),
        ...mediaParams,
      },
    };
  }
  return base;
}

function mediaSourceFit(source = {}) {
  return source.params?.fit === "cover" ? "cover" : "contain";
}

function shaderPassFromNode(node = {}) {
  return {
    id: node.componentId || node.id || "",
    instanceId: node.id || node.componentId || "",
    enabled: node.enabled !== false,
    params: { ...(node.params || {}) },
    amount: node.params?.amount,
    transform: node.state?.transform || node.transform || {},
  };
}

function renderBufferKey(...parts) {
  return parts.map((part) => String(part)).join(":");
}

function staticComponentState(component = {}) {
  return {
    id: component.id || "",
    type: component.type || "component",
    frameShape: component.frameShape || "landscape",
    resolutionScale: Number(component.resolutionScale) || 1,
    canvas: component.type === "canvas" ? {
      width: Math.max(1, Number(component.canvas?.width) || VJ1.canvasWidth),
      height: Math.max(1, Number(component.canvas?.height) || VJ1.canvasHeight),
    } : null,
    source: staticSourceState(component.source),
    shaderChain: staticEffectChainState(component.shaderChain || []),
    chain: staticChainState(component.chain || []),
  };
}

function staticComponentGraphState(component = {}, components = [], seen = new Set()) {
  if (!component?.id || seen.has(component.id)) return { id: component?.id || "", cycle: true };
  const nextSeen = new Set(seen);
  nextSeen.add(component.id);
  const dependencies = Array.from(componentDependencyIds(component))
    .sort()
    .map((id) => staticComponentGraphState(
      components.find((item) => item.id === id) || { id, missing: true },
      components,
      nextSeen
    ));
  return { ...staticComponentState(component), dependencies };
}

function staticComponentGraphMediaState(media = [], component = {}, components = [], seen = new Set()) {
  const ids = new Set();
  collectComponentGraphMediaIds(component, components, ids, seen);
  return staticMediaStateForIds(media, ids);
}

function collectComponentGraphMediaIds(component = {}, components = [], ids = new Set(), seen = new Set()) {
  if (!component?.id || seen.has(component.id)) return ids;
  seen.add(component.id);
  collectMediaIdsFromSource(component.source, ids);
  collectMediaIdsFromChain(component.chain || [], ids);
  for (const dependencyId of componentDependencyIds(component)) {
    const dependency = components.find((item) => item.id === dependencyId);
    if (dependency) collectComponentGraphMediaIds(dependency, components, ids, seen);
  }
  return ids;
}

function componentDependencyIds(component = {}) {
  const ids = new Set();
  collectComponentIdsFromSource(component.source, ids);
  collectComponentIdsFromChain(component.chain || [], ids);
  return ids;
}

function staticChainState(chain = []) {
  return (chain || []).map((item) => {
    if (item.kind === "group") {
      return {
        id: item.id || "",
        kind: "group",
        enabled: item.enabled !== false,
        transform: item.transform || {},
        opacity: item.opacity ?? 1,
        blend: item.blend || "normal",
        role: item.role || "group",
        layout: item.layout || {},
        chain: staticChainState(item.chain || []),
      };
    }
    if (item.kind === "effect") {
      return {
        id: item.id || "",
        kind: "effect",
        enabled: item.enabled !== false,
        componentId: item.componentId || "",
        amount: item.amount,
        params: item.params || {},
        transform: item.transform || {},
      };
    }
    return {
      id: item.id || "",
      kind: item.kind || "source",
      enabled: item.enabled !== false,
      source: staticSourceState(item.source),
      params: item.params || {},
      transform: item.transform || {},
      opacity: item.opacity ?? 1,
      blend: item.blend || "normal",
    };
  });
}

function staticEffectChainState(chain = []) {
  return (chain || []).map((pass) => ({
    id: pass.id || pass.componentId || "",
    enabled: pass.enabled !== false,
    amount: pass.amount,
    params: pass.params || {},
    transform: pass.transform || {},
  }));
}

function staticSourceState(source = {}) {
  return {
    type: source.type || "black",
    mediaId: source.mediaId || "",
    componentId: source.componentId || "",
    generatorId: source.generatorId || "",
    start: source.start,
    end: source.end,
    speed: source.speed,
    params: source.params || {},
    placement: source.placement || null,
    contentTransform: source.contentTransform || {},
  };
}

function staticMediaState(media = [], component = {}) {
  const ids = new Set();
  collectMediaIdsFromSource(component.source, ids);
  collectMediaIdsFromChain(component.chain || [], ids);
  return staticMediaStateForIds(media, ids);
}

function staticMediaStateForChain(media = [], chain = []) {
  const ids = new Set();
  collectMediaIdsFromChain(chain, ids);
  return staticMediaStateForIds(media, ids);
}

function staticMediaStateForSource(media = [], source = {}) {
  const ids = new Set();
  collectMediaIdsFromSource(source, ids);
  return staticMediaStateForIds(media, ids);
}

function runtimeMediaStateForSource(media = new Map(), source = {}) {
  if (source?.type !== "media" || !source.mediaId) return null;
  const item = media?.get?.(source.mediaId);
  if (!item) return { present: false, ready: false, error: "" };
  return {
    present: true,
    ready: isReadyMediaItem(item),
    error: item.imageError || item.modelError || "",
    kind: item.video ? "video" : item.image ? "image" : (item.model || item.modelData) ? "model" : "loading",
  };
}

function staticMediaStateForIds(media = [], ids = new Set()) {
  return (media || [])
    .filter((item) => ids.has(item.id))
    .map((item) => ({
      id: item.id || "",
      path: item.path || "",
      type: item.type || "",
      size: item.size || 0,
    }));
}

function chainLayerState(item = {}) {
  return {
    enabled: item.enabled !== false,
    transform: item.transform || {},
    opacity: item.opacity ?? 1,
    blend: item.blend || "normal",
  };
}

function componentRuntimeTimeKey(component, params = {}, context = {}) {
  if (component?.runtime?.cacheable === false) return context.frame;
  if (!component?.runtime?.timeDependent?.(params)) return null;
  return component.runtime.timeKey?.(params, context) ?? context.time;
}

export function qualityScaledRenderRequest(request = {}, params = {}, minimum = 0.35) {
  const scale = renderQualityScale(params, { minimum });
  if (scale >= 0.999) return request;
  const logicalWidth = Math.max(1, Number(request.logicalWidth) || Number(request.width) || 1);
  const logicalHeight = Math.max(1, Number(request.logicalHeight) || Number(request.height) || 1);
  const physicalWidth = Math.max(1, Number(request.width) || logicalWidth);
  const physicalHeight = Math.max(1, Number(request.height) || logicalHeight);
  return {
    ...request,
    width: Math.max(32, Math.round(physicalWidth * scale)),
    height: Math.max(32, Math.round(physicalHeight * scale)),
    logicalWidth,
    logicalHeight,
    qualityScale: scale,
  };
}

export function resolutionScaledStrokeWidth(strokeWidth, request = {}, backingSize = null) {
  const width = Math.max(0, Number(strokeWidth) || 0);
  if (width <= 0) return 0;
  const logicalWidth = Math.max(1, Number(request.logicalWidth) || Number(request.width) || 1);
  const logicalHeight = Math.max(1, Number(request.logicalHeight) || Number(request.height) || 1);
  const rasterWidth = Math.max(1, Number(backingSize?.width) || Number(request.width) || logicalWidth);
  const rasterHeight = Math.max(1, Number(backingSize?.height) || Number(request.height) || logicalHeight);
  const rasterScale = Math.max(0.01, Math.min(rasterWidth / logicalWidth, rasterHeight / logicalHeight));
  return Math.max(0.125, width * rasterScale);
}

function qualityComputeMultiplier(params = {}, { minimum = 0.35, maximum = 1.5 } = {}) {
  const quality = renderQualityValue(params);
  if (quality <= 0.5) return minimum + (1 - minimum) * (quality / 0.5);
  return 1 + (maximum - 1) * ((quality - 0.5) / 0.5);
}

export function qualityAdjustedGeneratorParams(generatorId, params = {}) {
  const multiplier = qualityComputeMultiplier(params, { minimum: 0.35, maximum: 1.5 });
  const adjusted = { ...params };
  if (["seascape", "cloudyTunnel", "cherenkovVolume", "biomineLite"].includes(generatorId)) {
    adjusted.raySteps = Math.max(1, Math.round((Number(params.raySteps) || 1) * multiplier));
  }
  if (generatorId === "seascape") {
    adjusted.seaDetail = Math.max(1, Math.round((Number(params.seaDetail) || 1) * qualityComputeMultiplier(params, {
      minimum: 0.5,
      maximum: 1.2,
    })));
  }
  if (generatorId === "cloudyTunnel") {
    adjusted.cloudDetail = Math.max(1, Math.round((Number(params.cloudDetail) || 1) * qualityComputeMultiplier(params, {
      minimum: 0.5,
      maximum: 1.25,
    })));
  }
  if (generatorId === "biomineLite") {
    adjusted.surfaceDetail = Math.max(0, Math.round((Number(params.surfaceDetail) || 0) * qualityComputeMultiplier(params, {
      minimum: 0.5,
      maximum: 1.25,
    })));
  }
  return adjusted;
}

export function eyeballFrameUniforms(timeSeconds = 0, params = {}) {
  const time = Number(timeSeconds) || 0;
  const speed = Math.max(0.05, boundedNumber(params.motionSpeed, 1, 0, 3));
  const range = boundedNumber(params.gazeRange, 1, 0, 1.5);
  const pause = boundedNumber(params.pauseAmount, 0.82, 0, 1);
  const jitter = boundedNumber(params.jitter, 0.35, 0, 1);
  const gazeClock = time * speed * 0.85;
  const gazeSegment = Math.floor(gazeClock);
  const gazePhase = gazeClock - gazeSegment;
  const movePortion = mixNumber(0.98, 0.08, pause);
  const eased = smoothstepNumber(Math.min(1, gazePhase / Math.max(0.00001, movePortion)));
  const gazeA = shaderRandomGaze(gazeSegment);
  const gazeB = shaderRandomGaze(gazeSegment + 1);
  const gaze = [
    (mixNumber(gazeA[0], gazeB[0], eased) + Math.sin(time * 18.7 + shaderHash2(gazeSegment, 1.2) * Math.PI * 2) * 0.018 * jitter) * range,
    (mixNumber(gazeA[1], gazeB[1], eased) + Math.sin(time * 23.1 + shaderHash2(gazeSegment, 8.2) * Math.PI * 2) * 0.018 * jitter) * range,
  ];
  const gazeDir = normalizeVector3([gaze[0], gaze[1], 1]);
  const irisRight = normalizeVector3([gazeDir[2], 0, -gazeDir[0]]);
  const irisUp = normalizeVector3(crossVector3(irisRight, gazeDir));

  const blinkRate = boundedNumber(params.blinkRate, 1, 0, 3);
  let blink = 0;
  if (blinkRate > 0.001) {
    const blinkClock = time * blinkRate * 0.55;
    const blinkSegment = Math.floor(blinkClock);
    const blinkPhase = blinkClock - blinkSegment;
    const blinkChance = shaderHash2(blinkSegment, 11.1) >= 0.34 ? 1 : 0;
    const doubleChance = shaderHash2(blinkSegment, 19.4) >= 0.78 ? 1 : 0;
    blink = Math.max(
      shutterBlinkNumber(blinkPhase),
      shutterBlinkNumber(blinkPhase - 0.2) * doubleChance
    ) * blinkChance;
  }

  return { gazeDir, irisRight, irisUp, blink };
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  return Math.min(max, Math.max(min, Number.isFinite(number) ? number : fallback));
}

function mixNumber(a, b, amount) {
  return a + (b - a) * amount;
}

function smoothstepNumber(value) {
  const amount = Math.min(1, Math.max(0, Number(value) || 0));
  return amount * amount * (3 - 2 * amount);
}

function shaderHash2(x, y) {
  let px = fractNumber((Number(x) || 0) * 0.1031);
  let py = fractNumber((Number(y) || 0) * 0.1031);
  let pz = px;
  const dot = px * (py + 33.33) + py * (pz + 33.33) + pz * (px + 33.33);
  px += dot;
  py += dot;
  pz += dot;
  return fractNumber((px + py) * pz);
}

function shaderRandomGaze(seed) {
  return [
    (shaderHash2(seed, 2.31) * 2 - 1) * 0.72,
    (shaderHash2(seed, 7.77) * 2 - 1) * 0.38,
  ];
}

function shutterBlinkNumber(phase) {
  const close = smoothstepRange(phase, 0.015, 0.045);
  const open = 1 - smoothstepRange(phase, 0.078, 0.125);
  return close * open;
}

function smoothstepRange(value, start, end) {
  return smoothstepNumber(((Number(value) || 0) - start) / Math.max(0.00001, end - start));
}

function fractNumber(value) {
  return value - Math.floor(value);
}

function normalizeVector3(vector) {
  return normalize3(vector);
}

function crossVector3(a, b) {
  return cross3(a, b);
}

function collectMediaIdsFromChain(chain = [], ids) {
  for (const item of chain || []) {
    if (item.kind === "group") collectMediaIdsFromChain(item.chain || [], ids);
    else collectMediaIdsFromSource(item.source, ids);
  }
}

function collectComponentIdsFromChain(chain = [], ids) {
  for (const item of chain || []) {
    if (item.kind === "group") collectComponentIdsFromChain(item.chain || [], ids);
    else collectComponentIdsFromSource(item.source, ids);
  }
}

function collectComponentIdsFromSource(source = {}, ids) {
  if (source?.type === "component" && source.componentId) ids.add(source.componentId);
}

function collectMediaIdsFromSource(source = {}, ids) {
  if (source?.type === "media" && source.mediaId) ids.add(source.mediaId);
}

function effectParamValue(component, params = {}, id, fallback = undefined) {
  const param = (component?.params || []).find((item) => item.id === id);
  return param ? normalizeParamValue(param, params[id]) : (params[id] ?? fallback);
}

function effectParamNumber(component, params = {}, id, fallback = 0) {
  const value = Number(effectParamValue(component, params, id, fallback));
  return Number.isFinite(value) ? value : fallback;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function createMediaReadinessStatus() {
  return {
    blocked: false,
    total: 0,
    loadingIds: new Set(),
    missingIds: new Set(),
    errorIds: new Set(),
  };
}

function isReadyMediaItem(item = {}) {
  if (!item) return false;
  if (item.video) return isDrawableMedia(item.video);
  if (item.image) return isDrawableMedia(item.image);
  if (item.model || item.modelData) return true;
  return item.ready === true;
}

export class GpuTimerTracker {
  constructor({ sampleInterval = 6, maxPending = 12, maxQueryAgeFrames = 60 } = {}) {
    this.apis = new WeakMap();
    this.pending = [];
    this.frames = new Map();
    this.latestMs = 0;
    this.latestFrameId = -1;
    this.sampleId = 0;
    this.supported = false;
    this.sampleInterval = Math.max(1, Math.floor(Number(sampleInterval) || 1));
    this.maxPending = Math.max(1, Math.floor(Number(maxPending) || 1));
    this.maxQueryAgeFrames = Math.max(1, Math.floor(Number(maxQueryAgeFrames) || 1));
  }

  begin(target, frameId) {
    if (frameId % this.sampleInterval !== 0 || this.pending.length >= this.maxPending) return null;
    const gl = webglContextFrom(target);
    const api = this.apiFor(gl);
    if (!api || api.active) return null;
    const query = api.createQuery();
    if (!query) return null;
    try {
      api.begin(query);
    } catch {
      api.deleteQuery(query);
      return null;
    }
    api.active = true;
    const frame = this.frameRecord(frameId);
    frame.expected++;
    return { api, query, frameId };
  }

  end(token) {
    if (!token) return;
    try {
      token.api.end();
      this.pending.push(token);
    } catch {
      const frame = this.frameRecord(token.frameId);
      frame.resolved++;
      frame.invalid = true;
      token.api.deleteQuery(token.query);
    } finally {
      token.api.active = false;
    }
  }

  sealFrame(frameId) {
    this.frameRecord(frameId).sealed = true;
    this.resolveFrames();
  }

  poll(currentFrame = 0) {
    for (let index = this.pending.length - 1; index >= 0; index--) {
      const token = this.pending[index];
      let available = false;
      try {
        available = token.api.available(token.query);
      } catch {
        available = true;
      }
      if (!available && currentFrame - token.frameId < this.maxQueryAgeFrames) continue;
      const frame = this.frameRecord(token.frameId);
      try {
        if (available && !token.api.disjoint()) {
          const elapsedNs = Number(token.api.result(token.query)) || 0;
          frame.queryNs.push(elapsedNs);
        } else frame.invalid = true;
      } catch {
        frame.invalid = true;
      }
      frame.resolved++;
      token.api.deleteQuery(token.query);
      this.pending.splice(index, 1);
    }
    this.resolveFrames();
  }

  apiFor(gl) {
    if (!gl || typeof gl.getExtension !== "function") return null;
    if (this.apis.has(gl)) return this.apis.get(gl);
    let api = null;
    const webgl2Ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
    if (webgl2Ext && typeof gl.createQuery === "function") {
      api = {
        active: false,
        createQuery: () => gl.createQuery(),
        deleteQuery: (query) => gl.deleteQuery(query),
        begin: (query) => gl.beginQuery(webgl2Ext.TIME_ELAPSED_EXT, query),
        end: () => gl.endQuery(webgl2Ext.TIME_ELAPSED_EXT),
        available: (query) => !!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE),
        result: (query) => gl.getQueryParameter(query, gl.QUERY_RESULT),
        disjoint: () => !!gl.getParameter(webgl2Ext.GPU_DISJOINT_EXT),
      };
    } else {
      const webgl1Ext = gl.getExtension("EXT_disjoint_timer_query");
      if (webgl1Ext) {
        api = {
          active: false,
          createQuery: () => webgl1Ext.createQueryEXT(),
          deleteQuery: (query) => webgl1Ext.deleteQueryEXT(query),
          begin: (query) => webgl1Ext.beginQueryEXT(webgl1Ext.TIME_ELAPSED_EXT, query),
          end: () => webgl1Ext.endQueryEXT(webgl1Ext.TIME_ELAPSED_EXT),
          available: (query) => !!webgl1Ext.getQueryObjectEXT(query, webgl1Ext.QUERY_RESULT_AVAILABLE_EXT),
          result: (query) => webgl1Ext.getQueryObjectEXT(query, webgl1Ext.QUERY_RESULT_EXT),
          disjoint: () => !!gl.getParameter(webgl1Ext.GPU_DISJOINT_EXT),
        };
      }
    }
    this.apis.set(gl, api);
    if (api) this.supported = true;
    return api;
  }

  frameRecord(frameId) {
    let frame = this.frames.get(frameId);
    if (!frame) {
      frame = { expected: 0, resolved: 0, queryNs: [], sealed: false, invalid: false };
      this.frames.set(frameId, frame);
    }
    return frame;
  }

  resolveFrames() {
    for (const [frameId, frame] of this.frames) {
      if (!frame.sealed || frame.resolved < frame.expected) continue;
      if (!frame.invalid && frame.expected > 0 && frameId > this.latestFrameId) {
        this.latestMs = averageGpuQueryNanoseconds(frame.queryNs) / 1000000;
        this.latestFrameId = frameId;
        this.sampleId++;
      }
      this.frames.delete(frameId);
    }
  }

  dispose() {
    for (const token of this.pending) token.api.deleteQuery(token.query);
    this.pending.length = 0;
    this.frames.clear();
  }
}

export function averageGpuQueryNanoseconds(queryTimes = []) {
  const values = Array.from(queryTimes, Number).filter((value) => Number.isFinite(value) && value >= 0);
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function webglContextFrom(target) {
  if (!target) return null;
  if (typeof target.getExtension === "function") return target;
  return target?._renderer?.GL || target?.drawingContext || null;
}

function createEmptyFrameProfile() {
  return {
    shaderPasses: 0,
    shaderChains: 0,
    maxShaderChainLength: 0,
    shaderHandoffs: 0,
    componentCacheHits: 0,
    stageCacheHits: 0,
    stageRenders: 0,
    shaderMs: 0,
    sourceMs: 0,
    componentMs: 0,
    componentWallMs: 0,
    componentRenders: 0,
    surfaceRouteCandidates: 0,
    surfaceRoutesVisible: 0,
    surfaceRoutesCulled: 0,
    componentRasterPixels: 0,
    surfaceRasterPixels: 0,
    directSourceComposites: 0,
    avoidedSourceRasterPixels: 0,
    directSurfaceSamples: 0,
    avoidedSurfaceRasterPixels: 0,
    totalMs: 0,
    passSamples: [],
  };
}

function nextFxTargetSlot(targets = [], current = null) {
  return targets[0] === current ? 1 : 0;
}

function roundMetric(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function pruneGraphicsMap(map, useMap, { maxItems, currentFrame, idleFrames }) {
  if (!map || !useMap) return 0;
  const stale = staleRenderCacheKeys(useMap, { maxItems, currentFrame, idleFrames });
  for (const key of stale) {
    const item = map.get(key);
    map.delete(key);
    useMap.delete(key);
    disposeGraphics(item);
  }
  return stale.length;
}

function staleRenderCacheKeys(useMap, { maxItems, currentFrame, idleFrames }) {
  const entries = Array.from(useMap.entries()).sort((a, b) => a[1] - b[1]);
  const stale = [];
  for (const [key, frame] of entries) {
    if (frame === currentFrame) continue;
    const overLimit = entries.length - stale.length > maxItems;
    const idle = currentFrame - frame > idleFrames;
    if (overLimit || idle) stale.push(key);
  }
  return stale;
}

function disposeGraphicsMap(map) {
  if (!map) return;
  const seen = new Set();
  for (const item of map.values()) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    disposeGraphics(item);
  }
  map.clear();
}

function disposeGraphics(item) {
  if (!item) return;
  try {
    item.remove?.();
  } catch {}
}

function graphicsToPngBlob(pg) {
  const canvas = pg?.canvas || pg?.elt;
  if (!canvas?.toBlob) return Promise.resolve(null);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

function componentThumbnailSignature(component) {
  try {
    return JSON.stringify({
      source: component.source,
      opacity: component.opacity,
      blend: component.blend,
      speed: component.speed,
      frameShape: component.frameShape,
      resolutionScale: component.resolutionScale,
      chain: component.chain,
      shaderChain: component.shaderChain,
    });
  } catch {
    return `${component.id}:${millis()}`;
  }
}

const COMPONENT_THUMBNAIL_WIDTH = 768;
const COMPONENT_THUMBNAIL_HEIGHT = 432;
const COMPONENT_THUMBNAIL_QUALITY = 0.92;

function graphicsToThumbnail(pg, width = COMPONENT_THUMBNAIL_WIDTH, height = COMPONENT_THUMBNAIL_HEIGHT, cropRect = null) {
  try {
    const source = pg.canvas || pg.elt;
    if (!source) return "";
    const sourceWidth = source.videoWidth || source.naturalWidth || source.width || width;
    const sourceHeight = source.videoHeight || source.naturalHeight || source.height || height;
    const sx = Math.max(0, Math.min(sourceWidth - 1, Number(cropRect?.x) || 0));
    const sy = Math.max(0, Math.min(sourceHeight - 1, Number(cropRect?.y) || 0));
    const sw = Math.max(1, Math.min(sourceWidth - sx, Number(cropRect?.width) || sourceWidth));
    const sh = Math.max(1, Math.min(sourceHeight - sy, Number(cropRect?.height) || sourceHeight));
    const thumbnailSize = fittedThumbnailSize(sw, sh, width, height);
    const canvas = document.createElement("canvas");
    canvas.width = thumbnailSize.width;
    canvas.height = thumbnailSize.height;
    const context = canvas.getContext("2d");
    if (!context) return "";
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    if (cropRect) context.drawImage(source, sx, sy, sw, sh, 0, 0, thumbnailSize.width, thumbnailSize.height);
    else context.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, thumbnailSize.width, thumbnailSize.height);
    const webp = canvas.toDataURL("image/webp", COMPONENT_THUMBNAIL_QUALITY);
    if (webp.startsWith("data:image/webp")) return webp;
    return canvas.toDataURL("image/png");
  } catch (error) {
    console.warn("[VJ1_THUMBNAIL_CAPTURE_FAILED]", { message: error?.message || String(error) });
    return "";
  }
}

export function fittedThumbnailSize(sourceWidth, sourceHeight, maxWidth = COMPONENT_THUMBNAIL_WIDTH, maxHeight = COMPONENT_THUMBNAIL_HEIGHT) {
  const sw = Math.max(1, Number(sourceWidth) || 1);
  const sh = Math.max(1, Number(sourceHeight) || 1);
  const mw = Math.max(1, Number(maxWidth) || COMPONENT_THUMBNAIL_WIDTH);
  const mh = Math.max(1, Number(maxHeight) || COMPONENT_THUMBNAIL_HEIGHT);
  const scale = Math.min(mw / sw, mh / sh);
  return {
    width: Math.max(1, Math.round(sw * scale)),
    height: Math.max(1, Math.round(sh * scale)),
  };
}

function colorUniform(value) {
  if (Array.isArray(value)) return value.slice(0, 4);
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})?$/i.exec(String(value || ""));
  if (!match) return [1, 1, 1, 1];
  return [
    parseInt(match[1], 16) / 255,
    parseInt(match[2], 16) / 255,
    parseInt(match[3], 16) / 255,
    match[4] ? parseInt(match[4], 16) / 255 : 1,
  ];
}

function chainItemToShaderPass(item) {
  return {
    id: item.componentId || item.id,
    instanceId: item.id || item.componentId || "",
    enabled: item.enabled !== false,
    params: item.params || {},
    amount: item.amount,
    transform: item.transform || {},
  };
}

function withSourceInstance(source = {}, instanceId = "") {
  if (!source || typeof source !== "object") return source;
  return {
    ...source,
    instanceId: instanceId || source.instanceId || source.generatorId || source.type || "source",
  };
}

function normalizedContentTransform(transform = {}) {
  return {
    x: Number(transform.x) || 0,
    y: Number(transform.y) || 0,
    scale: Math.max(0.0001, Number(transform.scale) || 1),
    rotation: Number(transform.rotation) || 0,
  };
}

function drawWithContentTransform(target, transform = {}, draw) {
  if (typeof draw !== "function") return;
  if (isIdentityTransform(transform)) {
    draw();
    return;
  }
  const value = normalizedContentTransform(transform);
  const width = Math.max(1, Number(target?.width) || 1);
  const height = Math.max(1, Number(target?.height) || 1);
  target.push();
  target.translate(width * (0.5 + value.x * 0.5), height * (0.5 + value.y * 0.5));
  target.rotate(value.rotation);
  target.scale(value.scale);
  target.translate(-width * 0.5, -height * 0.5);
  draw();
  target.pop();
}

function applyModelContentTransform(target, transform = {}, viewport = {}) {
  if (isIdentityTransform(transform)) return;
  const value = normalizedContentTransform(transform);
  const width = Math.max(1, Number(viewport.width) || Number(target?.width) || 1);
  const height = Math.max(1, Number(viewport.height) || Number(target?.height) || 1);
  target.translate(value.x * width * 0.5, value.y * height * 0.5, 0);
  target.rotateZ(value.rotation);
  target.scale(value.scale, value.scale, value.scale);
}

function withShaderInstancePrefix(chain = [], prefix = "") {
  return (chain || []).map((pass, index) => ({
    ...pass,
    instanceId: pass.instanceId || `${prefix || "shader"}:${index}:${pass.componentId || pass.id || "pass"}`,
  }));
}

function instanceTime(instanceId, baseTime = 0) {
  return Number(baseTime) + instanceTimeOffset(instanceId);
}

export function advanceRateClock(previous, baseTime, rate) {
  const now = Number(baseTime) || 0;
  const speed = Math.max(0, Number(rate) || 0);
  if (!previous || now < previous.baseTime) {
    return { baseTime: now, time: now * speed };
  }
  return {
    baseTime: now,
    time: previous.time + Math.max(0, now - previous.baseTime) * speed,
  };
}

export function advanceSpatialScale(previous, scale, anchor = [0, 0]) {
  const nextScale = Math.max(0.02, Number(scale) || 0.62);
  const point = [Number(anchor[0]) || 0, Number(anchor[1]) || 0];
  if (!previous) return { scale: nextScale, phase: [0, 0] };
  const delta = previous.scale - nextScale;
  return {
    scale: nextScale,
    phase: [
      previous.phase[0] + point[0] * delta,
      previous.phase[1] + point[1] * delta,
    ],
  };
}

function generatorRateParam(generatorId) {
  if (generatorId === "fireflies" || generatorId === "bezierStrokes" || generatorId === "shadertoyBaseWarp" || generatorId === "seascape" || generatorId === "paintDrips" || generatorId === "cloudyTunnel" || generatorId === "cherenkovVolume" || generatorId === "biomineLite") return "speed";
  return "";
}

function usesShadertoyInterface(component = {}) {
  if (component.type === "shadertoy") return true;
  const code = String(component.code || "");
  return /\bvoid\s+mainImage\s*\(/.test(code) && !/\bvoid\s+main\s*\(/.test(code);
}

function shaderDrawingBufferSize(target, fallbackWidth, fallbackHeight) {
  if (isSharedFramebufferTarget(target)) {
    return {
      width: Math.max(1, Number(target.width) || Number(fallbackWidth) || 1),
      height: Math.max(1, Number(target.height) || Number(fallbackHeight) || 1),
    };
  }
  const gl = target?._renderer?.GL || target?.drawingContext;
  return {
    width: Math.max(1, Number(gl?.drawingBufferWidth) || Number(fallbackWidth) || Number(target?.width) || 1),
    height: Math.max(1, Number(gl?.drawingBufferHeight) || Number(fallbackHeight) || Number(target?.height) || 1),
  };
}

function setShaderUniformIfPresent(shader, name, value) {
  if (shader?.uniforms?.[name]) shader.setUniform(name, value);
}

function instanceTimeOffset(instanceId = "") {
  const text = String(instanceId || "");
  if (!text) return 0;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 4294967295) * 97.0;
}

export function effectTransformUniforms(transform = {}) {
  const x = Number(transform.x) || 0;
  const y = Number(transform.y) || 0;
  const scale = Math.max(0.0001, Number(transform.scale) || 1);
  const rotation = Number(transform.rotation) || 0;
  const centerX = 0.5 + x * 0.5;
  const centerY = 0.5 + y * 0.5;
  const c = Math.cos(-rotation);
  const s = Math.sin(-rotation);
  const a = c / scale;
  const b = -s / scale;
  const d = s / scale;
  const e = c / scale;
  const tx = 0.5 - a * centerX - b * centerY;
  const ty = 0.5 - d * centerX - e * centerY;

  const ic = Math.cos(rotation) * scale;
  const is = Math.sin(rotation) * scale;
  const ia = ic;
  const ib = -is;
  const id = is;
  const ie = ic;
  const itx = centerX - ia * 0.5 - ib * 0.5;
  const ity = centerY - id * 0.5 - ie * 0.5;
  return {
    transform: [x, y, scale, rotation],
    // WebGL matrices are supplied in column-major order.
    forward: [a, d, 0, b, e, 0, tx, ty, 1],
    inverse: [ia, id, 0, ib, ie, 0, itx, ity, 1],
  };
}

function screenToLayerLocal(x, y, cx, cy, rotation) {
  const dx = x - cx;
  const dy = y - cy;
  const c = Math.cos(-rotation);
  const s = Math.sin(-rotation);
  return {
    x: dx * c - dy * s,
    y: dx * s + dy * c,
  };
}

function enumUniform(param, value) {
  const index = (param.values || []).indexOf(value);
  return Math.max(0, index);
}

export function cameraCaptureSettings(render = {}) {
  const frame = frameSize(render);
  const camera = render?.camera || {};
  return {
    width: Math.max(160, Math.min(7680, Math.floor(Number(camera.width) || frame.width))),
    height: Math.max(120, Math.min(4320, Math.floor(Number(camera.height) || frame.height))),
    front: camera.facingMode !== "environment",
    mirrored: camera.mirrored === true,
    maxResolution: camera.maxResolution === true,
  };
}

export function cameraSettingsSignature(render = {}) {
  const camera = cameraCaptureSettings(render);
  return `${camera.width}x${camera.height}:${camera.front ? "front" : "rear"}:${camera.mirrored ? "mirror" : "normal"}:${camera.maxResolution ? "max" : "target"}`;
}

function getPortalWebcameraSetup() {
  if (typeof globalThis.setupWebcamera === "function") return globalThis.setupWebcamera;
  try {
    return Function("return typeof setupWebcamera === 'function' ? setupWebcamera : null")();
  } catch {
    return null;
  }
}

function loadSvgImage(url, item) {
  const image = new Image();
  image.onload = () => {
    item.image = image;
    item.ready = true;
    item.imageError = "";
  };
  image.onerror = (error) => {
    item.imageError = error?.message || "svg load failed";
  };
  image.decoding = "async";
  image.src = url;
}

function drawBuffer(pg, source, x, y, w, h, sourceIsWebGL = false) {
  if (isSharedFramebufferTarget(source)) {
    // drawBuffer coordinates are always top-left based. Shared framebuffers
    // inherit p5's global imageMode, so isolate this copy from callers that
    // temporarily use CENTER for layer transforms.
    pg.push();
    pg.imageMode(CORNER);
    pg.image(unwrapRenderTarget(source), x, y, w, h);
    pg.pop();
    return;
  }
  if (!sourceIsWebGL) {
    pg.image(source, x, y, w, h);
    return;
  }
  drawWebGLBuffer(pg, source, x, y, w, h);
}

function drawShaderTarget(target, draw) {
  if (isSharedFramebufferTarget(target)) {
    return target.drawWebGL(() => {
      push();
      try {
        noStroke();
        return draw();
      } finally {
        pop();
      }
    });
  }
  target.push();
  try {
    return draw();
  } finally {
    target.pop();
  }
}

function clearShaderTarget(target) {
  if (isSharedFramebufferTarget(target)) clear();
  else target.clear();
}

function applyShaderTarget(target, shaderProgram) {
  if (isSharedFramebufferTarget(target)) shader(shaderProgram);
  else target.shader(shaderProgram);
}

function resetShaderTarget(target) {
  if (isSharedFramebufferTarget(target)) resetShader();
  else target.resetShader();
}

function drawShaderTargetRect(target, widthPx, heightPx) {
  if (isSharedFramebufferTarget(target)) rect(-widthPx / 2, -heightPx / 2, widthPx, heightPx);
  else target.rect(-widthPx / 2, -heightPx / 2, widthPx, heightPx);
}

function drawTerrainSurface(target, resourceCache, params, componentTime, planeWidth, planeDepth, style, sky) {
  const gl = target?.drawingContext;
  if (!gl) return false;
  const viewportSize = renderTargetPixelSize(target);
  const previousProgram = gl.getParameter(gl.CURRENT_PROGRAM);
  const previousArrayBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
  const previousElementBuffer = gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING);
  const previousViewport = gl.getParameter(gl.VIEWPORT);
  let resources = resourceCache.get(gl);
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
  const previousDepthTest = gl.isEnabled(gl.DEPTH_TEST);
  const previousBlend = gl.isEnabled(gl.BLEND);
  const previousCullFace = gl.isEnabled(gl.CULL_FACE);
  const previousPolygonOffset = gl.isEnabled(gl.POLYGON_OFFSET_FILL);
  const previousDepthFunc = gl.getParameter(gl.DEPTH_FUNC);
  const previousBlendSrcRgb = gl.getParameter(gl.BLEND_SRC_RGB);
  const previousBlendDstRgb = gl.getParameter(gl.BLEND_DST_RGB);
  const previousBlendSrcAlpha = gl.getParameter(gl.BLEND_SRC_ALPHA);
  const previousBlendDstAlpha = gl.getParameter(gl.BLEND_DST_ALPHA);
  const previousPolygonFactor = gl.getParameter(gl.POLYGON_OFFSET_FACTOR);
  const previousPolygonUnits = gl.getParameter(gl.POLYGON_OFFSET_UNITS);
  const attributeState = captureVertexAttributeState(gl, resources.gridCoord);
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

  restoreVertexAttributeState(gl, attributeState);
  gl.bindBuffer(gl.ARRAY_BUFFER, previousArrayBuffer);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, previousElementBuffer);
  previousDepthTest ? gl.enable(gl.DEPTH_TEST) : gl.disable(gl.DEPTH_TEST);
  previousBlend ? gl.enable(gl.BLEND) : gl.disable(gl.BLEND);
  previousCullFace ? gl.enable(gl.CULL_FACE) : gl.disable(gl.CULL_FACE);
  gl.polygonOffset(previousPolygonFactor, previousPolygonUnits);
  previousPolygonOffset ? gl.enable(gl.POLYGON_OFFSET_FILL) : gl.disable(gl.POLYGON_OFFSET_FILL);
  gl.depthFunc(previousDepthFunc);
  gl.blendFuncSeparate(previousBlendSrcRgb, previousBlendDstRgb, previousBlendSrcAlpha, previousBlendDstAlpha);
  if (previousViewport?.length === 4) gl.viewport(...previousViewport);
  gl.useProgram(previousProgram);
  return true;
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
  } catch {
    return false;
  }
}

function disposeTerrainSurfaceResources(gl, resources) {
  if (!gl || !resources) return;
  try {
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
  };
}

export function terrainSurfaceGridVertices(widthCells = TERRAIN_GRID_CELLS, depthCells = widthCells) {
  const width = Math.max(1, Math.round(Number(widthCells) || 1));
  const depth = Math.max(1, Math.round(Number(depthCells) || 1));
  const vertices = new Float32Array((width + 1) * (depth + 2) * 2);
  let offset = 0;
  for (let y = 0; y <= depth + 1; y++) {
    for (let x = 0; x <= width; x++) {
      vertices[offset++] = x;
      vertices[offset++] = y;
    }
  }
  return vertices;
}

function terrainSurfaceUsesForwardDiagonal(x, worldRow) {
  const selector = ((x * 17 + worldRow * 31 + x * worldRow * 13 + 79) % 11 + 11) % 11;
  return selector >= 5;
}

export function terrainSurfaceTriangleIndices(widthCells = TERRAIN_GRID_CELLS, depthCells = widthCells, baseRow = -1) {
  const width = Math.max(1, Math.round(Number(widthCells) || 1));
  const depth = Math.max(1, Math.round(Number(depthCells) || 1));
  const indices = new Uint16Array(width * (depth + 1) * 6);
  const row = width + 1;
  let offset = 0;
  for (let y = 0; y <= depth; y++) {
    for (let x = 0; x < width; x++) {
      const a = y * row + x;
      const b = a + 1;
      const d = a + row;
      const c = d + 1;
      if (terrainSurfaceUsesForwardDiagonal(x, baseRow + y)) {
        indices.set([a, b, c, a, c, d], offset);
      } else {
        indices.set([a, b, d, d, b, c], offset);
      }
      offset += 6;
    }
  }
  return indices;
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

function drawTerrainWireframe(target, resourceCache, params, componentTime, planeWidth, planeDepth, renderRequest = {}) {
  const gl = target?.drawingContext;
  if (!gl) return false;
  const viewportSize = renderTargetPixelSize(target);
  const previousProgram = gl.getParameter(gl.CURRENT_PROGRAM);
  const previousArrayBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
  const previousElementBuffer = gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING);
  const previousViewport = gl.getParameter(gl.VIEWPORT);
  let resources = resourceCache.get(gl);
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
  const previousDepthTest = gl.isEnabled(gl.DEPTH_TEST);
  const previousBlend = gl.isEnabled(gl.BLEND);
  const previousCullFace = gl.isEnabled(gl.CULL_FACE);
  const previousDepthFunc = gl.getParameter(gl.DEPTH_FUNC);
  const previousBlendSrcRgb = gl.getParameter(gl.BLEND_SRC_RGB);
  const previousBlendDstRgb = gl.getParameter(gl.BLEND_DST_RGB);
  const previousBlendSrcAlpha = gl.getParameter(gl.BLEND_SRC_ALPHA);
  const previousBlendDstAlpha = gl.getParameter(gl.BLEND_DST_ALPHA);
  const attributeStates = [resources.start, resources.end, resources.side, resources.along]
    .map((location) => captureVertexAttributeState(gl, location));
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
  for (const state of attributeStates) restoreVertexAttributeState(gl, state);
  gl.bindBuffer(gl.ARRAY_BUFFER, previousArrayBuffer);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, previousElementBuffer);
  previousDepthTest ? gl.enable(gl.DEPTH_TEST) : gl.disable(gl.DEPTH_TEST);
  previousBlend ? gl.enable(gl.BLEND) : gl.disable(gl.BLEND);
  previousCullFace ? gl.enable(gl.CULL_FACE) : gl.disable(gl.CULL_FACE);
  gl.depthFunc(previousDepthFunc);
  gl.blendFuncSeparate(previousBlendSrcRgb, previousBlendDstRgb, previousBlendSrcAlpha, previousBlendDstAlpha);
  if (previousViewport?.length === 4) gl.viewport(...previousViewport);
  gl.useProgram(previousProgram);
  return true;
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
  } catch {
    return false;
  }
}

function disposeTerrainWireResources(gl, resources) {
  if (!gl || !resources) return;
  try {
    if (resources.vertexBuffer && gl.isBuffer(resources.vertexBuffer)) gl.deleteBuffer(resources.vertexBuffer);
    if (resources.program && gl.isProgram(resources.program)) gl.deleteProgram(resources.program);
  } catch {}
}

function captureVertexAttributeState(gl, location) {
  if (location < 0) return null;
  return {
    location,
    enabled: gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_ENABLED),
    buffer: gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING),
    size: gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_SIZE),
    type: gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_TYPE),
    normalized: gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_NORMALIZED),
    stride: gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_STRIDE),
    offset: gl.getVertexAttribOffset(location, gl.VERTEX_ATTRIB_ARRAY_POINTER),
  };
}

function restoreVertexAttributeState(gl, state) {
  if (!state) return;
  if (state.buffer) {
    gl.bindBuffer(gl.ARRAY_BUFFER, state.buffer);
    gl.vertexAttribPointer(state.location, state.size, state.type, state.normalized, state.stride, state.offset);
  }
  state.enabled ? gl.enableVertexAttribArray(state.location) : gl.disableVertexAttribArray(state.location);
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
      float nearPlane = max(nearClip, 0.01);
      float farPlane = max(farClip, nearPlane + 1.0);
      float clipZ = ((farPlane + nearPlane) / (farPlane - nearPlane)) * cameraZ
        - (2.0 * farPlane * nearPlane) / (farPlane - nearPlane);
      return vec4(
        worldLateral * focalLength / max(aspectRatio, 0.01),
        -cameraY * focalLength,
        clipZ,
        cameraZ
      );
    }

    void main() {
      vec4 startClip = terrainClip(aStart);
      vec4 endClip = terrainClip(aEnd);
      if (terrainEdgeEnabled(aStart, aEnd) < 0.5) {
        vDepth = 1.0;
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
      }
      float clipNear = max(nearClip, 0.01);
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

export function terrainExpandedGridWireVertices(widthCells = TERRAIN_GRID_CELLS, depthCells = widthCells) {
  const width = Math.max(1, Math.round(Number(widthCells) || 1));
  const depth = Math.max(1, Math.round(Number(depthCells) || 1));
  const edgeCount = width * (depth + 2) + (width + 1) * (depth + 1) + width * (depth + 1) * 2;
  const vertices = new Float32Array(edgeCount * 6 * 6);
  let offset = 0;
  const edge = (startX, startY, endX, endY) => {
    for (const [side, along] of [[-1, 0], [-1, 1], [1, 1], [-1, 0], [1, 1], [1, 0]]) {
      vertices[offset++] = startX;
      vertices[offset++] = startY;
      vertices[offset++] = endX;
      vertices[offset++] = endY;
      vertices[offset++] = side;
      vertices[offset++] = along;
    }
  };
  for (let y = 0; y <= depth + 1; y++) {
    for (let x = 0; x < width; x++) edge(x, y, x + 1, y);
  }
  for (let y = 0; y <= depth; y++) {
    for (let x = 0; x <= width; x++) edge(x, y, x, y + 1);
    for (let x = 0; x < width; x++) {
      edge(x, y, x + 1, y + 1);
      edge(x + 1, y, x, y + 1);
    }
  }
  return vertices;
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

const TERRAIN_MESH_CACHE = new Map();

function normalizedTerrainIrregularity(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0.62;
}

function terrainMeshHash(x, y, salt = 0) {
  let value = Math.imul((x + 101 + salt) | 0, 374761393) ^ Math.imul((y + 313 - salt) | 0, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function terrainIrregularMesh(widthCells = TERRAIN_GRID_CELLS, depthCells = TERRAIN_GRID_CELLS, irregularity = 0.62, travelRows = null) {
  const amount = normalizedTerrainIrregularity(irregularity);
  const moving = Number.isFinite(travelRows);
  const baseRow = moving ? Math.floor(travelRows) - 1 : 0;
  const rowCount = moving ? depthCells + 2 : depthCells + 1;
  const key = `${widthCells}:${depthCells}:${Math.round(amount * 100)}:${baseRow}:${moving ? 1 : 0}`;
  if (TERRAIN_MESH_CACHE.has(key)) return TERRAIN_MESH_CACHE.get(key);
  const points = [];
  const maxOffset = 0.44 * amount;
  for (let y = 0; y < rowCount; y++) {
    const worldRow = baseRow + y;
    for (let x = 0; x <= widthCells; x++) {
      const offsetX = x === 0 || x === widthCells ? 0 : (terrainMeshHash(x, worldRow, 17) * 2 - 1) * maxOffset / widthCells;
      const offsetY = moving || (y !== 0 && y !== depthCells) ? (terrainMeshHash(0, worldRow, 43) * 2 - 1) * maxOffset : 0;
      points.push([x / widthCells + offsetX, moving ? worldRow + offsetY : y / depthCells + offsetY / depthCells]);
    }
  }
  const faces = [];
  const row = widthCells + 1;
  for (let y = 0; y < rowCount - 1; y++) {
    for (let x = 0; x < widthCells; x++) {
      const a = y * row + x;
      const b = a + 1;
      const d = a + row;
      const c = d + 1;
      if (terrainMeshHash(x, baseRow + y, 79) < 0.5) faces.push([a, b, d], [d, b, c]);
      else faces.push([a, b, c], [a, c, d]);
    }
  }
  const mesh = { points, faces };
  TERRAIN_MESH_CACHE.set(key, mesh);
  while (TERRAIN_MESH_CACHE.size > 12) TERRAIN_MESH_CACHE.delete(TERRAIN_MESH_CACHE.keys().next().value);
  return mesh;
}

export function terrainGridSize(value) {
  const size = Number.isFinite(Number(value)) ? Number(value) : TERRAIN_GRID_CELLS;
  return Math.max(8, Math.min(144, Math.round(size)));
}

function terrainTessellationSize(extent, gridDensity = 1) {
  const density = Math.max(0.25, Math.min(4, Number(gridDensity) || 1));
  return Math.max(4, Math.min(144, Math.round(terrainGridSize(extent) * density)));
}

function terrainRowMetrics(componentTime, flightSpeed, gridDepth, gridDensity = 1, gridScale = 1) {
  const logicalDepth = terrainGridSize(gridDepth);
  const tessellatedDepth = terrainTessellationSize(logicalDepth, gridDensity);
  const cellScale = 1.5 * Math.max(0.1, Math.min(20, Number(gridScale) || 1));
  const rowSpacing = cellScale * logicalDepth / tessellatedDepth;
  const cameraTravel = Number(componentTime) * Math.max(0, Number(flightSpeed) || 0) * 7.0;
  return { cellScale, rowSpacing, travelRows: cameraTravel / rowSpacing };
}

export function terrainTriangleEdgeUvs(widthCells = TERRAIN_GRID_CELLS, irregularity = 0.62, travelRows = null, depthCells = widthCells) {
  const mesh = terrainIrregularMesh(widthCells, depthCells, irregularity, travelRows);
  const uniqueEdges = new Map();
  for (const face of mesh.faces) {
    for (const [start, end] of [[face[0], face[1]], [face[1], face[2]], [face[2], face[0]]]) {
      const key = start < end ? `${start}:${end}` : `${end}:${start}`;
      if (!uniqueEdges.has(key)) uniqueEdges.set(key, [start, end]);
    }
  }
  const values = [];
  for (const [start, end] of uniqueEdges.values()) values.push(...mesh.points[start], ...mesh.points[end]);
  return new Float32Array(values);
}

export function terrainExpandedWireVertices(widthCells = TERRAIN_GRID_CELLS, irregularity = 0.62, travelRows = null, depthCells = widthCells) {
  const edges = terrainTriangleEdgeUvs(widthCells, irregularity, travelRows, depthCells);
  const vertices = [];
  for (let index = 0; index < edges.length; index += 4) {
    const startX = edges[index];
    const startY = edges[index + 1];
    const endX = edges[index + 2];
    const endY = edges[index + 3];
    const vertex = (side, along) => vertices.push(startX, startY, endX, endY, side, along);
    vertex(-1, 0);
    vertex(-1, 1);
    vertex(1, 1);
    vertex(-1, 0);
    vertex(1, 1);
    vertex(1, 0);
  }
  return new Float32Array(vertices);
}

function setTerrainRawUniforms(gl, resources, params, componentTime, planeWidth, planeDepth, wireColor) {
  gl.uniform1f(resources.time, componentTime);
  gl.uniform1f(resources.flightSpeed, Math.max(0, Number(params.flightSpeed) || 0));
  gl.uniform1f(resources.flightMode, params.flightMode === "terrainFollow" ? 1 : 0);
  gl.uniform1f(resources.turn, Math.max(-1, Math.min(1, Number(params.turn) || 0)));
  gl.uniform1f(resources.altitude, Math.max(0.2, Number(params.altitude) || 2.5));
  gl.uniform1f(resources.pitch, Math.max(-1.4, Number(params.pitch) || 0.28));
  gl.uniform1f(resources.fieldOfView, Math.max(20, Math.min(120, Number(params.fieldOfView) || 60)));
  gl.uniform1f(resources.nearClip, Math.max(0.01, Number(params.nearClip) || 0.1));
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
}

function drawRawParsedModelMode(target, item, params = {}, componentTime = 0, renderMode = "surface", surfaceColor = [220, 225, 220, 255], wireColor = [20, 20, 20, 220], pointBudget = 4000, viewport = null, contentTransform = {}) {
  if (renderMode === "points") {
    return drawRawParsedModel(target, item, params, componentTime, "points", wireColor, pointBudget, viewport, contentTransform);
  }
  if (renderMode === "wireframe") {
    return drawRawParsedWire(target, item, params, componentTime, wireColor, pointBudget, viewport, contentTransform);
  }
  const drewSurface = drawWithPolygonOffset(target, renderMode === "surfaceWire", () => (
    drawRawParsedSurface(target, item, params, componentTime, surfaceColor, viewport, contentTransform)
  ));
  if (drewSurface && renderMode === "surfaceWire") {
    drawRawParsedWire(target, item, params, componentTime, wireColor, pointBudget, viewport, contentTransform);
  }
  return drewSurface;
}

function drawRawParsedModel(target, item, params = {}, componentTime = 0, mode = "points", color = [245, 245, 245, 255], pointBudget = 4000, viewport = null, contentTransform = {}) {
  const gl = target?.drawingContext;
  const mesh = item?.modelData;
  if (!gl || !mesh) return false;
  const resources = ensureRawModelResources(gl, item, mode, pointBudget);
  if (!resources?.buffer || !resources.count || !resources.program) return false;
  const drawingWidth = Math.max(1, gl.drawingBufferWidth || target.width || 1);
  const drawingHeight = Math.max(1, gl.drawingBufferHeight || target.height || 1);
  const metrics = modelViewportMetrics(target, viewport);
  const modelScale = Math.max(0.01, Number(params.modelScale) || 1);
  const depth = Math.max(0.05, Number(params.depth) || 1);
  const scale = metrics.unitScale * modelScale;
  const rotation = modelRotation(params, componentTime);
  const matrices = rawModelMatrices(metrics.width, metrics.height, scale, depth, rotation, contentTransform);
  const rgba = color.map((channel) => Math.max(0, Math.min(1, Number(channel) / 255 || 0)));

  gl.useProgram(resources.program);
  gl.viewport(0, 0, drawingWidth, drawingHeight);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.CULL_FACE);
  if (mode === "wireframe") gl.lineWidth(modelWireThickness(params));
  gl.bindBuffer(gl.ARRAY_BUFFER, resources.buffer);
  gl.enableVertexAttribArray(resources.position);
  gl.vertexAttribPointer(resources.position, 3, gl.FLOAT, false, 0, 0);
  gl.uniformMatrix4fv(resources.mvp, false, matrices.mvp);
  gl.uniformMatrix4fv(resources.model, false, matrices.model);
  gl.uniform1f(resources.depthCutoff, modelDepthCutoff(params, mesh.bounds, matrices.model));
  gl.uniform4fv(resources.color, rgba);
  gl.uniform1f(resources.pointSize, Math.max(1, Number(params.pointSize) || 2));
  gl.drawArrays(mode === "wireframe" ? gl.LINES : gl.POINTS, 0, resources.count);
  gl.disableVertexAttribArray(resources.position);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  if (mode === "wireframe") gl.lineWidth(1);
  gl.useProgram(null);
  return true;
}

function drawRawParsedWire(target, item, params = {}, componentTime = 0, color = [20, 20, 20, 220], pointBudget = 4000, viewport = null, contentTransform = {}) {
  const gl = target?.drawingContext;
  const mesh = item?.modelData;
  if (!gl || !mesh) return false;
  const resources = ensureRawWireResources(gl, item, pointBudget);
  if (!resources?.buffer || !resources.count || !resources.program) return false;
  const drawingWidth = Math.max(1, gl.drawingBufferWidth || target.width || 1);
  const drawingHeight = Math.max(1, gl.drawingBufferHeight || target.height || 1);
  const metrics = modelViewportMetrics(target, viewport);
  const modelScale = Math.max(0.01, Number(params.modelScale) || 1);
  const depth = Math.max(0.05, Number(params.depth) || 1);
  const scale = metrics.unitScale * modelScale;
  const rotation = modelRotation(params, componentTime);
  const matrices = rawModelMatrices(metrics.width, metrics.height, scale, depth, rotation, contentTransform);
  const rgba = color.map((channel) => Math.max(0, Math.min(1, Number(channel) / 255 || 0)));
  const stride = 8 * 4;

  gl.useProgram(resources.program);
  gl.viewport(0, 0, drawingWidth, drawingHeight);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.CULL_FACE);
  gl.bindBuffer(gl.ARRAY_BUFFER, resources.buffer);
  gl.enableVertexAttribArray(resources.start);
  gl.vertexAttribPointer(resources.start, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(resources.end);
  gl.vertexAttribPointer(resources.end, 3, gl.FLOAT, false, stride, 3 * 4);
  gl.enableVertexAttribArray(resources.side);
  gl.vertexAttribPointer(resources.side, 1, gl.FLOAT, false, stride, 6 * 4);
  gl.enableVertexAttribArray(resources.along);
  gl.vertexAttribPointer(resources.along, 1, gl.FLOAT, false, stride, 7 * 4);
  gl.uniformMatrix4fv(resources.mvp, false, matrices.mvp);
  gl.uniformMatrix4fv(resources.model, false, matrices.model);
  gl.uniform1f(resources.depthCutoff, modelDepthCutoff(params, mesh.bounds, matrices.model));
  gl.uniform2f(resources.resolution, drawingWidth, drawingHeight);
  gl.uniform1f(resources.thickness, resolutionScaledStrokeWidth(
    modelWireThickness(params),
    metrics,
    { width: drawingWidth, height: drawingHeight }
  ));
  gl.uniform4fv(resources.color, rgba);
  gl.drawArrays(gl.TRIANGLES, 0, resources.count);
  gl.disableVertexAttribArray(resources.start);
  gl.disableVertexAttribArray(resources.end);
  gl.disableVertexAttribArray(resources.side);
  gl.disableVertexAttribArray(resources.along);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.useProgram(null);
  return true;
}

function drawRawParsedSurface(target, item, params = {}, componentTime = 0, color = [220, 225, 220, 255], viewport = null, contentTransform = {}) {
  const gl = target?.drawingContext;
  const mesh = item?.modelData;
  if (!gl || !mesh) return false;
  const resources = ensureRawSurfaceResources(gl, item);
  if (!resources?.buffer || !resources.count || !resources.program) return false;
  const drawingWidth = Math.max(1, gl.drawingBufferWidth || target.width || 1);
  const drawingHeight = Math.max(1, gl.drawingBufferHeight || target.height || 1);
  const metrics = modelViewportMetrics(target, viewport);
  const modelScale = Math.max(0.01, Number(params.modelScale) || 1);
  const depth = Math.max(0.05, Number(params.depth) || 1);
  const scale = metrics.unitScale * modelScale;
  const rotation = modelRotation(params, componentTime);
  const matrices = rawModelMatrices(metrics.width, metrics.height, scale, depth, rotation, contentTransform);
  const rgba = color.map((channel) => Math.max(0, Math.min(1, Number(channel) / 255 || 0)));

  gl.useProgram(resources.program);
  gl.viewport(0, 0, drawingWidth, drawingHeight);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.CULL_FACE);
  const stride = 6 * 4;
  gl.bindBuffer(gl.ARRAY_BUFFER, resources.buffer);
  gl.enableVertexAttribArray(resources.position);
  gl.vertexAttribPointer(resources.position, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(resources.normal);
  gl.vertexAttribPointer(resources.normal, 3, gl.FLOAT, false, stride, 3 * 4);
  gl.uniformMatrix4fv(resources.mvp, false, matrices.mvp);
  gl.uniformMatrix4fv(resources.model, false, matrices.model);
  gl.uniform1f(resources.depthCutoff, modelDepthCutoff(params, mesh.bounds, matrices.model));
  gl.uniform4fv(resources.color, rgba);
  gl.drawArrays(gl.TRIANGLES, 0, resources.count);
  gl.disableVertexAttribArray(resources.position);
  gl.disableVertexAttribArray(resources.normal);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.useProgram(null);
  return true;
}

const ANATOMY_RING_CACHE = new Map();

function anatomyPartFitScale(part = "face") {
  return ({ face: 0.72, body: 0.4, hand: 0.78, arm: 0.65, leg: 0.61, heart: 0.64 })[part] || 0.72;
}

function drawProceduralAnatomy(target, params = {}, componentTime = 0, renderMode = "surface", surfaceColor = [217, 212, 201, 255], wireColor = [75, 73, 68, 204], wireThickness = 1.6, detail = 8) {
  const part = params.part || "face";
  if (part === "body") return drawLowPolyBody(target, params, renderMode, surfaceColor, wireColor, wireThickness, detail);
  if (part === "hand") return drawLowPolyHand(target, params, renderMode, surfaceColor, wireColor, wireThickness, detail);
  if (part === "arm") return drawLowPolyArm(target, params, renderMode, surfaceColor, wireColor, wireThickness, detail);
  if (part === "leg") return drawLowPolyLeg(target, params, renderMode, surfaceColor, wireColor, wireThickness, detail);
  if (part === "heart") return drawLowPolyHeart(target, params, componentTime, renderMode, surfaceColor, wireColor, wireThickness, detail);
  return drawLowPolyFace(target, params, renderMode, surfaceColor, wireColor, wireThickness, detail);
}

function drawAnatomyShape(target, renderMode, surfaceColor, wireColor, wireThickness, drawShape) {
  if (renderMode !== "wireframe" && renderMode !== "points") {
    target.noStroke();
    target.ambientMaterial?.(...surfaceColor);
    target.fill?.(...surfaceColor);
    drawWithPolygonOffset(target, renderMode === "surfaceWire", drawShape);
  }
  if (renderMode === "wireframe" || renderMode === "surfaceWire" || renderMode === "points") {
    target.noFill();
    target.stroke(...wireColor);
    target.strokeWeight(renderMode === "points" ? Math.max(2, wireThickness * 1.3) : wireThickness);
    drawShape();
  }
}

function anatomyEllipsoid(target, renderMode, surfaceColor, wireColor, wireThickness, detail, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
  target.push();
  target.translate(x, y, z);
  target.rotateX(rx);
  target.rotateY(ry);
  target.rotateZ(rz);
  target.scale(sx, sy, sz);
  drawAnatomyShape(target, renderMode, surfaceColor, wireColor, wireThickness, () => target.sphere(1, detail, detail));
  target.pop();
}

function anatomyRing(detail) {
  const sides = Math.max(4, Math.min(14, Math.round(Number(detail) || 8)));
  let ring = ANATOMY_RING_CACHE.get(sides);
  if (!ring) {
    ring = Array.from({ length: sides }, (_, index) => {
      const angle = index * Math.PI * 2 / sides;
      return [Math.cos(angle), Math.sin(angle)];
    });
    ANATOMY_RING_CACHE.set(sides, ring);
  }
  return ring;
}

function anatomySubtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function anatomyCross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function anatomyNormalize(vector) {
  const inverseLength = 1 / Math.max(0.000001, Math.hypot(vector[0], vector[1], vector[2]));
  return [vector[0] * inverseLength, vector[1] * inverseLength, vector[2] * inverseLength];
}

function anatomyTriangle(a, b, c) {
  return [a, b, c, anatomyNormalize(anatomyCross(anatomySubtract(b, a), anatomySubtract(c, a)))];
}

function drawAnatomyMesh(target, renderMode, surfaceColor, wireColor, wireThickness, rings, capStart = true, capEnd = true) {
  if (!rings.length || !rings[0]?.length) return;
  const sides = rings[0].length;
  const triangles = [];
  for (let row = 0; row < rings.length - 1; row++) {
    for (let side = 0; side < sides; side++) {
      const next = (side + 1) % sides;
      triangles.push(anatomyTriangle(rings[row][side], rings[row + 1][side], rings[row + 1][next]));
      triangles.push(anatomyTriangle(rings[row][side], rings[row + 1][next], rings[row][next]));
    }
  }
  const addCap = (ring, reverse) => {
    const center = ring.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1], sum[2] + point[2]], [0, 0, 0])
      .map((value) => value / ring.length);
    for (let side = 0; side < sides; side++) {
      const next = (side + 1) % sides;
      triangles.push(reverse
        ? anatomyTriangle(center, ring[next], ring[side])
        : anatomyTriangle(center, ring[side], ring[next]));
    }
  };
  if (capStart) addCap(rings[0], true);
  if (capEnd) addCap(rings[rings.length - 1], false);

  const emitTriangles = () => {
    target.beginShape(TRIANGLES);
    for (const triangle of triangles) {
      for (let index = 0; index < 3; index++) {
        target.normal?.(...triangle[3]);
        target.vertex(...triangle[index]);
      }
    }
    target.endShape();
  };

  if (renderMode !== "wireframe" && renderMode !== "points") {
    target.noStroke();
    target.ambientMaterial?.(...surfaceColor);
    target.fill?.(...surfaceColor);
    drawWithPolygonOffset(target, renderMode === "surfaceWire", emitTriangles);
  }
  if (renderMode === "wireframe" || renderMode === "surfaceWire") {
    target.noFill();
    target.stroke(...wireColor);
    target.strokeWeight(wireThickness);
    emitTriangles();
  }
  if (renderMode === "points") {
    target.noFill();
    target.stroke(...wireColor);
    target.strokeWeight(Math.max(2, wireThickness * 1.3));
    target.beginShape(POINTS);
    for (const ring of rings) for (const point of ring) target.vertex(...point);
    target.endShape();
  }
}

function anatomyProfileVolume(target, renderMode, surfaceColor, wireColor, wireThickness, detail, profile) {
  const unitRing = anatomyRing(detail);
  const rings = profile.map((slice) => unitRing.map(([cosine, sine]) => [
    (Number(slice.x) || 0) + cosine * Math.max(0.5, Number(slice.rx) || 0.5),
    Number(slice.y) || 0,
    (Number(slice.z) || 0) + sine * Math.max(0.5, Number(slice.rz) || 0.5),
  ]));
  drawAnatomyMesh(target, renderMode, surfaceColor, wireColor, wireThickness, rings);
}

function anatomyTaperedSegment(target, renderMode, surfaceColor, wireColor, wireThickness, detail, start, end, startRadius, middleRadius, endRadius, depthScale = 0.82) {
  const direction = anatomyNormalize(anatomySubtract(end, start));
  const reference = Math.abs(direction[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const axisA = anatomyNormalize(anatomyCross(direction, reference));
  const axisB = anatomyNormalize(anatomyCross(direction, axisA));
  const unitRing = anatomyRing(detail);
  const slices = [
    [0, startRadius],
    [0.34, middleRadius],
    [0.72, middleRadius * 0.9 + endRadius * 0.1],
    [1, endRadius],
  ];
  const rings = slices.map(([amount, radius]) => {
    const center = [
      start[0] + (end[0] - start[0]) * amount,
      start[1] + (end[1] - start[1]) * amount,
      start[2] + (end[2] - start[2]) * amount,
    ];
    return unitRing.map(([cosine, sine]) => [
      center[0] + axisA[0] * cosine * radius + axisB[0] * sine * radius * depthScale,
      center[1] + axisA[1] * cosine * radius + axisB[1] * sine * radius * depthScale,
      center[2] + axisA[2] * cosine * radius + axisB[2] * sine * radius * depthScale,
    ]);
  });
  drawAnatomyMesh(target, renderMode, surfaceColor, wireColor, wireThickness, rings);
}

function anatomyMixPoint(start, end, amount) {
  return [
    start[0] + (end[0] - start[0]) * amount,
    start[1] + (end[1] - start[1]) * amount,
    start[2] + (end[2] - start[2]) * amount,
  ];
}

function anatomyPathVolume(target, renderMode, surfaceColor, wireColor, wireThickness, detail, path) {
  if (!Array.isArray(path) || path.length < 2) return;
  const unitRing = anatomyRing(detail);
  const rings = path.map((slice, index) => {
    const previous = path[Math.max(0, index - 1)].point;
    const next = path[Math.min(path.length - 1, index + 1)].point;
    const direction = anatomyNormalize(anatomySubtract(next, previous));
    const reference = Math.abs(direction[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
    const axisA = anatomyNormalize(anatomyCross(direction, reference));
    const axisB = anatomyNormalize(anatomyCross(direction, axisA));
    const radius = Math.max(0.5, Number(slice.radius) || 0.5);
    const depthScale = Math.max(0.2, Number(slice.depthScale) || 0.82);
    return unitRing.map(([cosine, sine]) => [
      slice.point[0] + axisA[0] * cosine * radius + axisB[0] * sine * radius * depthScale,
      slice.point[1] + axisA[1] * cosine * radius + axisB[1] * sine * radius * depthScale,
      slice.point[2] + axisA[2] * cosine * radius + axisB[2] * sine * radius * depthScale,
    ]);
  });
  drawAnatomyMesh(target, renderMode, surfaceColor, wireColor, wireThickness, rings);
}

function anatomyShade(color, brightness = 1, alpha = 1) {
  return [
    Math.max(0, Math.min(255, Math.round((Number(color[0]) || 0) * brightness))),
    Math.max(0, Math.min(255, Math.round((Number(color[1]) || 0) * brightness))),
    Math.max(0, Math.min(255, Math.round((Number(color[2]) || 0) * brightness))),
    Math.max(0, Math.min(255, Math.round((Number(color[3]) || 255) * alpha))),
  ];
}

function anatomyAdvanceDown(point, angle, length) {
  return [point[0] + Math.sin(angle) * length, point[1] + Math.cos(angle) * length, point[2]];
}

function drawLowPolyFace(target, params, renderMode, surfaceColor, wireColor, wireThickness, detail) {
  const expression = Math.max(-1, Math.min(1, Number(params.expression) || 0));
  const mouthOpen = clamp01(Number(params.mouthOpen) || 0);
  const brow = Math.max(-1, Math.min(1, Number(params.brow) || 0));
  const squint = clamp01(Number(params.eyeSquint) || 0);
  const featureColor = anatomyShade(wireColor, 0.62, 1);
  const lipColor = anatomyShade(surfaceColor, 0.46, 1);
  const eyeColor = [244, 243, 232, 255];
  const pupilColor = anatomyShade(wireColor, 0.22, 1);

  anatomyProfileVolume(target, renderMode, surfaceColor, wireColor, wireThickness, detail, [
    { y: -102, z: -4, rx: 12, rz: 18 },
    { y: -88, z: -1, rx: 39, rz: 39 },
    { y: -52, z: 1, rx: 56, rz: 49 },
    { y: -14, z: 4, rx: 59, rz: 53 },
    { y: 20, z: 3, rx: 52, rz: 49 },
    { y: 50, z: 0, rx: 40, rz: 40 },
    { y: 68, z: -2, rx: 24, rz: 29 },
  ]);
  anatomyEllipsoid(target, renderMode, surfaceColor, wireColor, wireThickness, detail, -56, -12, 0, 11, 23, 8, 0, 0, -0.12);
  anatomyEllipsoid(target, renderMode, surfaceColor, wireColor, wireThickness, detail, 56, -12, 0, 11, 23, 8, 0, 0, 0.12);
  anatomyTaperedSegment(target, renderMode, surfaceColor, wireColor, wireThickness, detail, [0, -20, 40], [0, 8, 76], 11, 9, 4.5, 0.78);

  const eyeHeight = Math.max(1.8, 7 * (1 - squint * 0.8));
  for (const side of [-1, 1]) {
    const x = side * 25;
    anatomyEllipsoid(target, renderMode, eyeColor, wireColor, wireThickness, Math.max(5, detail - 1), x, -28, 48, 16, eyeHeight, 4.5, 0, side * -0.08, side * 0.03);
    anatomyEllipsoid(target, renderMode, pupilColor, wireColor, wireThickness, Math.max(5, detail - 2), x, -28, 52, 4.2, Math.max(2.4, eyeHeight * 0.62), 2.2);
    anatomyTaperedSegment(target, renderMode, featureColor, wireColor, wireThickness, Math.max(4, detail - 2),
      [side * 9, -48 + brow * 5, 48], [side * 42, -46 - brow * 6, 42], 2.3, 3.2, 1.8, 0.65);
  }

  const mouthY = 30;
  const cornerY = mouthY - expression * 7;
  if (mouthOpen > 0.02) anatomyEllipsoid(target, renderMode, pupilColor, wireColor, wireThickness, Math.max(5, detail - 2), 0, mouthY + 2, 47, 23, 2.5 + mouthOpen * 8, 3);
  anatomyTaperedSegment(target, renderMode, lipColor, wireColor, wireThickness, Math.max(4, detail - 2), [-27, cornerY, 47], [0, mouthY - 1, 51], 1.8, 3, 2.3, 0.62);
  anatomyTaperedSegment(target, renderMode, lipColor, wireColor, wireThickness, Math.max(4, detail - 2), [0, mouthY - 1, 51], [27, cornerY, 47], 2.3, 3, 1.8, 0.62);
  anatomyEllipsoid(target, renderMode, surfaceColor, wireColor, wireThickness, detail, 0, 49, 30, 30, 12, 18, 0.08 + expression * 0.08, 0, 0);
  anatomyTaperedSegment(target, renderMode, surfaceColor, wireColor, wireThickness, detail, [0, 61, -1], [0, 108, 0], 22, 24, 27, 0.86);
}

function drawLowPolyBody(target, params, renderMode, surfaceColor, wireColor, wireThickness, detail) {
  const bend = Math.max(-1, Math.min(1, Number(params.limbBend) || 0));
  anatomyEllipsoid(target, renderMode, surfaceColor, wireColor, wireThickness, detail, 0, -132, 0, 25, 31, 23);
  anatomyTaperedSegment(target, renderMode, surfaceColor, wireColor, wireThickness, detail, [0, -105, 0], [0, -84, 0], 12, 14, 17, 0.86);
  anatomyProfileVolume(target, renderMode, surfaceColor, wireColor, wireThickness, detail, [
    { y: -91, rx: 42, rz: 24 },
    { y: -76, rx: 64, rz: 29 },
    { y: -38, rx: 56, rz: 31 },
    { y: 5, rx: 39, rz: 24 },
    { y: 34, rx: 46, rz: 28 },
    { y: 53, rx: 40, rz: 25 },
  ]);
  drawAnatomyArmChain(target, renderMode, surfaceColor, wireColor, wireThickness, detail, [-59, -73, 0], -1, 0.64, bend, true);
  drawAnatomyArmChain(target, renderMode, surfaceColor, wireColor, wireThickness, detail, [59, -73, 0], 1, 0.64, bend, true);
  drawAnatomyLegChain(target, renderMode, surfaceColor, wireColor, wireThickness, detail, [-25, 46, 0], -1, 0.7, bend);
  drawAnatomyLegChain(target, renderMode, surfaceColor, wireColor, wireThickness, detail, [25, 46, 0], 1, 0.7, bend);
}

function drawAnatomyFinger(target, renderMode, surfaceColor, wireColor, wireThickness, detail, index, start, totalLength, bend) {
  const segmentRatios = [0.43, 0.33, 0.24];
  const curl = 0.12 + bend * 1.45;
  const splay = (index - 1.5) * 0.034;
  const curlFactors = [0.16, 0.56, 0.98];
  let point = start;
  let radius = 6.6 - Math.abs(index - 1.5) * 0.35;
  const path = [{ point, radius, depthScale: 0.78 }];
  for (let segment = 0; segment < segmentRatios.length; segment++) {
    const length = totalLength * segmentRatios[segment];
    const angle = curl * curlFactors[segment];
    const next = [
      point[0] + splay * length,
      point[1] - Math.cos(angle) * length,
      point[2] + Math.sin(angle) * length,
    ];
    const nextRadius = Math.max(2.6, radius - 1.15);
    path.push({ point: anatomyMixPoint(point, next, 0.5), radius: radius * 1.03, depthScale: 0.78 });
    path.push({ point: next, radius: nextRadius * (segment < 2 ? 1.12 : 1), depthScale: 0.78 });
    point = next;
    radius = nextRadius;
  }
  anatomyPathVolume(target, renderMode, surfaceColor, wireColor, wireThickness, detail, path);
}

function drawLowPolyHand(target, params, renderMode, surfaceColor, wireColor, wireThickness, detail) {
  const bend = clamp01(Number(params.fingerBend) || 0);
  anatomyTaperedSegment(target, renderMode, surfaceColor, wireColor, wireThickness, detail, [0, 99, 0], [0, 65, 0], 17, 19, 20, 0.74);
  anatomyProfileVolume(target, renderMode, surfaceColor, wireColor, wireThickness, detail, [
    { y: 69, rx: 19, rz: 13 },
    { y: 48, rx: 30, rz: 16 },
    { y: 15, rx: 38, rz: 18 },
    { y: -5, rx: 35, rz: 15 },
  ]);
  const fingerLengths = [55, 68, 65, 55];
  const fingerXs = [-29, -10, 10, 29];
  for (let index = 0; index < fingerXs.length; index++) {
    drawAnatomyFinger(target, renderMode, surfaceColor, wireColor, wireThickness, detail, index,
      [fingerXs[index], 5 - Math.abs(index - 1.5) * 1.5, 0], fingerLengths[index], bend);
  }
  const thumbStart = [-28, 36, 1];
  const thumbMiddle = [-51, 17, 4 + bend * 5];
  const thumbEnd = [-66, -7, 7 + bend * 13];
  anatomyPathVolume(target, renderMode, surfaceColor, wireColor, wireThickness, detail, [
    { point: thumbStart, radius: 10, depthScale: 0.8 },
    { point: anatomyMixPoint(thumbStart, thumbMiddle, 0.5), radius: 11, depthScale: 0.8 },
    { point: thumbMiddle, radius: 8, depthScale: 0.78 },
    { point: thumbEnd, radius: 5.5, depthScale: 0.76 },
  ]);
}

function drawAnatomyArmChain(target, renderMode, surfaceColor, wireColor, wireThickness, detail, shoulder, mirror, scale, bend, includeHand) {
  const upperAngle = mirror * (0.08 + bend * 0.12);
  const forearmAngle = upperAngle - mirror * bend * 0.72;
  const elbow = anatomyAdvanceDown(shoulder, upperAngle, 82 * scale);
  const wrist = anatomyAdvanceDown(elbow, forearmAngle, 78 * scale);
  const hand = anatomyAdvanceDown(wrist, forearmAngle * 0.86, 25 * scale);
  const fingertips = anatomyAdvanceDown(hand, forearmAngle * 0.72, 17 * scale);
  anatomyPathVolume(target, renderMode, surfaceColor, wireColor, wireThickness, detail, [
    { point: shoulder, radius: 23 * scale, depthScale: 0.88 },
    { point: anatomyMixPoint(shoulder, elbow, 0.2), radius: 22 * scale, depthScale: 0.86 },
    { point: anatomyMixPoint(shoulder, elbow, 0.48), radius: 23.5 * scale, depthScale: 0.84 },
    { point: anatomyMixPoint(shoulder, elbow, 0.84), radius: 15.5 * scale, depthScale: 0.82 },
    { point: elbow, radius: 14 * scale, depthScale: 0.86 },
    { point: anatomyMixPoint(elbow, wrist, 0.2), radius: 15 * scale, depthScale: 0.82 },
    { point: anatomyMixPoint(elbow, wrist, 0.48), radius: 16.5 * scale, depthScale: 0.78 },
    { point: anatomyMixPoint(elbow, wrist, 0.82), radius: 10 * scale, depthScale: 0.76 },
    { point: wrist, radius: 8.5 * scale, depthScale: 0.74 },
    ...(includeHand ? [
      { point: hand, radius: 12 * scale, depthScale: 0.62 },
      { point: fingertips, radius: 5.5 * scale, depthScale: 0.56 },
    ] : []),
  ]);
}

function drawLowPolyArm(target, params, renderMode, surfaceColor, wireColor, wireThickness, detail) {
  const bend = Math.max(-1, Math.min(1, Number(params.limbBend) || 0));
  drawAnatomyArmChain(target, renderMode, surfaceColor, wireColor, wireThickness, detail, [0, -96, 0], 1, 1, bend, true);
}

function drawAnatomyLegChain(target, renderMode, surfaceColor, wireColor, wireThickness, detail, hip, mirror, scale, bend) {
  const thighAngle = mirror * (0.025 + bend * 0.08);
  const shinAngle = thighAngle - mirror * bend * 0.58;
  const knee = anatomyAdvanceDown(hip, thighAngle, 88 * scale);
  const ankle = anatomyAdvanceDown(knee, shinAngle, 86 * scale);
  const toe = [ankle[0] + mirror * 5 * scale, ankle[1] + 19 * scale, ankle[2] + 50 * scale];
  anatomyPathVolume(target, renderMode, surfaceColor, wireColor, wireThickness, detail, [
    { point: hip, radius: 27 * scale, depthScale: 0.9 },
    { point: anatomyMixPoint(hip, knee, 0.2), radius: 26 * scale, depthScale: 0.88 },
    { point: anatomyMixPoint(hip, knee, 0.5), radius: 28 * scale, depthScale: 0.86 },
    { point: anatomyMixPoint(hip, knee, 0.84), radius: 19 * scale, depthScale: 0.84 },
    { point: knee, radius: 17 * scale, depthScale: 0.88 },
    { point: anatomyMixPoint(knee, ankle, 0.2), radius: 20 * scale, depthScale: 0.84 },
    { point: anatomyMixPoint(knee, ankle, 0.48), radius: 21 * scale, depthScale: 0.8 },
    { point: anatomyMixPoint(knee, ankle, 0.84), radius: 11 * scale, depthScale: 0.76 },
    { point: ankle, radius: 9 * scale, depthScale: 0.74 },
    { point: anatomyMixPoint(ankle, toe, 0.56), radius: 18 * scale, depthScale: 0.68 },
    { point: toe, radius: 7 * scale, depthScale: 0.62 },
  ]);
}

function drawLowPolyLeg(target, params, renderMode, surfaceColor, wireColor, wireThickness, detail) {
  const bend = Math.max(-1, Math.min(1, Number(params.limbBend) || 0));
  drawAnatomyLegChain(target, renderMode, surfaceColor, wireColor, wireThickness, detail, [0, -105, 0], 1, 1, bend);
}

function drawLowPolyHeart(target, params, componentTime, renderMode, surfaceColor, wireColor, wireThickness, detail) {
  const pulse = clamp01(Number(params.heartPulse) || 0);
  const beat = pulse * (0.045 + 0.04 * Math.max(0, Math.sin(componentTime * 5.4)) + 0.025 * Math.max(0, Math.sin(componentTime * 10.8 + 0.9)));
  const vesselColor = anatomyShade(surfaceColor, 0.78, 1);
  const coronaryColor = anatomyShade(surfaceColor, 0.48, 1);
  target.push();
  target.rotateZ(0.09);
  target.scale(1 + beat, 1 + beat * 0.72, 1 + beat * 0.6);
  anatomyProfileVolume(target, renderMode, surfaceColor, wireColor, wireThickness, detail, [
    { x: -5, y: -58, z: 0, rx: 34, rz: 27 },
    { x: 1, y: -36, z: 2, rx: 53, rz: 35 },
    { x: 4, y: 0, z: 3, rx: 55, rz: 38 },
    { x: 2, y: 38, z: 1, rx: 43, rz: 32 },
    { x: -4, y: 73, z: -2, rx: 25, rz: 22 },
    { x: -9, y: 96, z: -4, rx: 6, rz: 8 },
  ]);
  anatomyEllipsoid(target, renderMode, surfaceColor, wireColor, wireThickness, detail, -31, -48, 3, 29, 25, 24, 0, 0, -0.18);
  anatomyEllipsoid(target, renderMode, surfaceColor, wireColor, wireThickness, detail, 30, -45, 4, 27, 23, 23, 0, 0, 0.2);
  anatomyTaperedSegment(target, renderMode, vesselColor, wireColor, wireThickness, detail, [-10, -55, 7], [-19, -102, 8], 13, 14, 11, 0.86);
  anatomyTaperedSegment(target, renderMode, vesselColor, wireColor, wireThickness, detail, [-19, -102, 8], [18, -114, 5], 11, 12, 9, 0.86);
  anatomyTaperedSegment(target, renderMode, vesselColor, wireColor, wireThickness, detail, [18, -114, 5], [45, -88, 2], 9, 10, 7, 0.84);
  anatomyTaperedSegment(target, renderMode, vesselColor, wireColor, wireThickness, detail, [-17, -57, 0], [-57, -72, 1], 11, 10, 7, 0.82);
  anatomyTaperedSegment(target, renderMode, vesselColor, wireColor, wireThickness, detail, [28, -53, -1], [34, -103, -3], 12, 11, 8, 0.84);
  anatomyTaperedSegment(target, renderMode, coronaryColor, wireColor, Math.max(0.5, wireThickness * 0.72), Math.max(4, detail - 2), [-7, -39, 36], [-20, 11, 39], 2.6, 2.4, 1.8, 0.62);
  anatomyTaperedSegment(target, renderMode, coronaryColor, wireColor, Math.max(0.5, wireThickness * 0.72), Math.max(4, detail - 2), [-20, 11, 39], [-4, 62, 27], 1.8, 1.7, 1.2, 0.62);
  anatomyTaperedSegment(target, renderMode, coronaryColor, wireColor, Math.max(0.5, wireThickness * 0.72), Math.max(4, detail - 2), [12, -33, 38], [35, 8, 33], 2.2, 2, 1.3, 0.62);
  target.pop();
}

function modelRotation(params = {}, componentTime = 0) {
  return [
    (Number(params.rotationX) || 0) + componentTime * (Number(params.spinX) || 0),
    (Number(params.rotationY) || 0) + componentTime * (Number(params.spinY) || 0),
    (Number(params.rotationZ) || 0) + componentTime * (Number(params.spinZ) || 0),
  ];
}

function modelWireThickness(params = {}) {
  return Math.max(0.5, Math.min(12, Number(params.wireThickness) || 1));
}

export function modelDepthCutoff(params = {}, bounds = null, modelMatrix = null) {
  const requestedDepth = Number(params.visibleDepth);
  const visibleDepth = Math.max(0.02, Math.min(1, Number.isFinite(requestedDepth) ? requestedDepth : 1));
  const range = transformedModelDepthRange(bounds, modelMatrix);
  return range.max - visibleDepth * (range.max - range.min);
}

export function transformedModelDepthRange(bounds = null, modelMatrix = null) {
  const min = validModelBound(bounds?.min, [-50, -50, -50]);
  const max = validModelBound(bounds?.max, [50, 50, 50]);
  const matrix = modelMatrix?.length === 16 ? modelMatrix : mat4Identity();
  let minDepth = Infinity;
  let maxDepth = -Infinity;
  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) {
        const depth = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
        minDepth = Math.min(minDepth, depth);
        maxDepth = Math.max(maxDepth, depth);
      }
    }
  }
  return Number.isFinite(minDepth) && Number.isFinite(maxDepth)
    ? { min: minDepth, max: maxDepth }
    : { min: -50, max: 50 };
}

function validModelBound(value, fallback) {
  return Array.isArray(value) && value.length >= 3 && value.every((entry) => Number.isFinite(Number(entry)))
    ? value.slice(0, 3).map(Number)
    : fallback;
}

function modelViewportMetrics(target, request = {}) {
  const width = Math.max(1, Math.round(Number(request?.width || target?.width) || 1));
  const height = Math.max(1, Math.round(Number(request?.height || target?.height) || 1));
  const logicalWidth = Math.max(1, Number(request?.logicalWidth) || width);
  const logicalHeight = Math.max(1, Number(request?.logicalHeight) || height);
  const verticalUnit = height;
  return {
    width,
    height,
    logicalWidth,
    logicalHeight,
    cameraZ: verticalUnit * 0.92,
    unitScale: verticalUnit * 0.0065,
  };
}

function ensureRawModelResources(gl, item, mode = "points", pointBudget = 4000) {
  const contextResources = ensureRawModelContextResources(gl, item);
  if (!rawModelProgramValid(gl, contextResources.program)) {
    disposeRawModelProgram(gl, contextResources.program);
    contextResources.program = createRawModelProgram(gl);
  }
  if (!contextResources.program) return null;
  const budget = Math.max(128, Math.min(50000, Math.round(Number(pointBudget) || 4000)));
  const meshKey = `${item.modelData?.triangles?.length || 0}`;
  const key = mode === "wireframe" ? `wire:${meshKey}` : `points:${meshKey}:${budget}`;
  let buffer = contextResources.buffers.get(key);
  if (buffer && !rawModelBufferValid(gl, buffer)) {
    disposeRawModelBuffer(gl, buffer);
    contextResources.buffers.delete(key);
    buffer = null;
  }
  if (!buffer) {
    const data = mode === "wireframe"
      ? ensureParsedModelWireLines(item, budget)
      : ensureParsedModelPointCloud(item, budget);
    if (!data?.length) return null;
    pruneRawModelBufferVariants(gl, contextResources, mode === "wireframe" ? `wire:${meshKey}` : `points:${meshKey}:`, key);
    const glBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, glBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    buffer = {
      buffer: glBuffer,
      count: Math.floor(data.length / 3),
    };
    contextResources.buffers.set(key, buffer);
  }
  return {
    ...buffer,
    program: contextResources.program.program,
    position: contextResources.program.position,
    mvp: contextResources.program.mvp,
    model: contextResources.program.model,
    color: contextResources.program.color,
    pointSize: contextResources.program.pointSize,
    depthCutoff: contextResources.program.depthCutoff,
  };
}

function ensureRawSurfaceResources(gl, item) {
  const contextResources = ensureRawModelContextResources(gl, item);
  if (!rawModelProgramValid(gl, contextResources.surfaceProgram)) {
    disposeRawModelProgram(gl, contextResources.surfaceProgram);
    contextResources.surfaceProgram = createRawSurfaceProgram(gl);
  }
  if (!contextResources.surfaceProgram) return null;
  const meshKey = `${item.modelData?.triangles?.length || 0}`;
  const key = `surface:${meshKey}`;
  let buffer = contextResources.buffers.get(key);
  if (buffer && !rawModelBufferValid(gl, buffer)) {
    disposeRawModelBuffer(gl, buffer);
    contextResources.buffers.delete(key);
    buffer = null;
  }
  if (!buffer) {
    const data = buildParsedModelSurfaceVertices(item.modelData);
    if (!data?.length) return null;
    const glBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, glBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    buffer = {
      buffer: glBuffer,
      count: Math.floor(data.length / 6),
    };
    contextResources.buffers.set(key, buffer);
  }
  return {
    ...buffer,
    program: contextResources.surfaceProgram.program,
    position: contextResources.surfaceProgram.position,
    normal: contextResources.surfaceProgram.normal,
    mvp: contextResources.surfaceProgram.mvp,
    model: contextResources.surfaceProgram.model,
    color: contextResources.surfaceProgram.color,
    depthCutoff: contextResources.surfaceProgram.depthCutoff,
  };
}

function ensureRawWireResources(gl, item, pointBudget = 4000) {
  const contextResources = ensureRawModelContextResources(gl, item);
  if (!rawModelProgramValid(gl, contextResources.wireProgram)) {
    disposeRawModelProgram(gl, contextResources.wireProgram);
    contextResources.wireProgram = createRawWireProgram(gl);
  }
  if (!contextResources.wireProgram) return null;
  const budget = Math.max(128, Math.min(50000, Math.round(Number(pointBudget) || 4000)));
  const meshKey = `${item.modelData?.triangles?.length || 0}`;
  const key = `thickWire:${meshKey}:${budget}`;
  let buffer = contextResources.buffers.get(key);
  if (buffer && !rawModelBufferValid(gl, buffer)) {
    disposeRawModelBuffer(gl, buffer);
    contextResources.buffers.delete(key);
    buffer = null;
  }
  if (!buffer) {
    const data = ensureParsedModelThickWireVertices(item, budget);
    if (!data?.length) return null;
    pruneRawModelBufferVariants(gl, contextResources, `thickWire:${meshKey}:`, key);
    const glBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, glBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    buffer = {
      buffer: glBuffer,
      count: Math.floor(data.length / 8),
    };
    contextResources.buffers.set(key, buffer);
  }
  return {
    ...buffer,
    program: contextResources.wireProgram.program,
    start: contextResources.wireProgram.start,
    end: contextResources.wireProgram.end,
    side: contextResources.wireProgram.side,
    along: contextResources.wireProgram.along,
    mvp: contextResources.wireProgram.mvp,
    model: contextResources.wireProgram.model,
    resolution: contextResources.wireProgram.resolution,
    thickness: contextResources.wireProgram.thickness,
    color: contextResources.wireProgram.color,
    depthCutoff: contextResources.wireProgram.depthCutoff,
  };
}

function ensureRawModelContextResources(gl, item) {
  if (!(item.modelRawRenderers instanceof Map)) item.modelRawRenderers = new Map();
  let resources = item.modelRawRenderers.get(gl);
  if (!resources) {
    resources = {
      program: null,
      surfaceProgram: null,
      wireProgram: null,
      buffers: new Map(),
    };
    item.modelRawRenderers.set(gl, resources);
  }
  return resources;
}

function rawModelProgramValid(gl, resource) {
  return !!resource?.program && (typeof gl.isProgram !== "function" || gl.isProgram(resource.program));
}

function rawModelBufferValid(gl, resource) {
  const buffers = [resource?.buffer, resource?.positionBuffer, resource?.normalBuffer].filter(Boolean);
  return buffers.length > 0 && (typeof gl.isBuffer !== "function" || buffers.every((buffer) => gl.isBuffer(buffer)));
}

function pruneRawModelBufferVariants(gl, resources, prefix, keepKey) {
  for (const [key, buffer] of resources.buffers) {
    if (key !== keepKey && key.startsWith(prefix)) {
      disposeRawModelBuffer(gl, buffer);
      resources.buffers.delete(key);
    }
  }
}

function disposeRawModelBuffer(gl, resource) {
  const buffers = new Set([resource?.buffer, resource?.positionBuffer, resource?.normalBuffer].filter(Boolean));
  for (const buffer of buffers) {
    try { gl.deleteBuffer(buffer); } catch {}
  }
}

function disposeRawModelProgram(gl, resource) {
  if (!resource?.program) return;
  try { gl.deleteProgram(resource.program); } catch {}
}

function disposeRawModelContextResources(gl, resources) {
  for (const buffer of resources?.buffers?.values?.() || []) disposeRawModelBuffer(gl, buffer);
  resources?.buffers?.clear?.();
  disposeRawModelProgram(gl, resources?.program);
  disposeRawModelProgram(gl, resources?.surfaceProgram);
  disposeRawModelProgram(gl, resources?.wireProgram);
}

function createRawModelProgram(gl) {
  const vertex = compileRawShader(gl, gl.VERTEX_SHADER, `
    attribute vec3 aPosition;
    uniform mat4 uMvp;
    uniform mat4 uModel;
    uniform float uPointSize;
    varying float vModelDepth;
    void main() {
      gl_Position = uMvp * vec4(aPosition, 1.0);
      vModelDepth = (uModel * vec4(aPosition, 1.0)).z;
      gl_PointSize = uPointSize;
    }
  `);
  const fragment = compileRawShader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    uniform vec4 uColor;
    uniform float uDepthCutoff;
    varying float vModelDepth;
    void main() {
      if (vModelDepth < uDepthCutoff) discard;
      gl_FragColor = uColor;
    }
  `);
  const program = linkSpecializedProgram(gl, vertex, fragment);
  if (!program) return null;
  return {
    program,
    position: gl.getAttribLocation(program, "aPosition"),
    mvp: gl.getUniformLocation(program, "uMvp"),
    model: gl.getUniformLocation(program, "uModel"),
    color: gl.getUniformLocation(program, "uColor"),
    pointSize: gl.getUniformLocation(program, "uPointSize"),
    depthCutoff: gl.getUniformLocation(program, "uDepthCutoff"),
  };
}

function createRawSurfaceProgram(gl) {
  const vertex = compileRawShader(gl, gl.VERTEX_SHADER, `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    uniform mat4 uMvp;
    uniform mat4 uModel;
    varying float vLight;
    varying float vModelDepth;
    void main() {
      vec3 n = normalize((uModel * vec4(aNormal, 0.0)).xyz);
      vec3 keyLight = normalize(vec3(-0.35, -0.45, 0.75));
      vLight = clamp(dot(n, keyLight) * 0.55 + 0.45, 0.0, 1.0);
      vModelDepth = (uModel * vec4(aPosition, 1.0)).z;
      gl_Position = uMvp * vec4(aPosition, 1.0);
    }
  `);
  const fragment = compileRawShader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    uniform vec4 uColor;
    uniform float uDepthCutoff;
    varying float vLight;
    varying float vModelDepth;
    void main() {
      if (vModelDepth < uDepthCutoff) discard;
      gl_FragColor = vec4(uColor.rgb * vLight, uColor.a);
    }
  `);
  const program = linkSpecializedProgram(gl, vertex, fragment);
  if (!program) return null;
  return {
    program,
    position: gl.getAttribLocation(program, "aPosition"),
    normal: gl.getAttribLocation(program, "aNormal"),
    mvp: gl.getUniformLocation(program, "uMvp"),
    model: gl.getUniformLocation(program, "uModel"),
    color: gl.getUniformLocation(program, "uColor"),
    depthCutoff: gl.getUniformLocation(program, "uDepthCutoff"),
  };
}

function createRawWireProgram(gl) {
  const vertex = compileRawShader(gl, gl.VERTEX_SHADER, `
    attribute vec3 aStart;
    attribute vec3 aEnd;
    attribute float aSide;
    attribute float aAlong;
    uniform mat4 uMvp;
    uniform mat4 uModel;
    uniform vec2 uResolution;
    uniform float uThickness;
    varying float vModelDepth;
    void main() {
      vec4 startClip = uMvp * vec4(aStart, 1.0);
      vec4 endClip = uMvp * vec4(aEnd, 1.0);
      float startW = abs(startClip.w) > 0.000001 ? startClip.w : 0.000001;
      float endW = abs(endClip.w) > 0.000001 ? endClip.w : 0.000001;
      vec2 startNdc = startClip.xy / startW;
      vec2 endNdc = endClip.xy / endW;
      vec2 dir = endNdc - startNdc;
      float len = length(dir);
      vec2 normal = len > 0.000001 ? vec2(-dir.y, dir.x) / len : vec2(0.0, 1.0);
      vec4 clip = mix(startClip, endClip, aAlong);
      vModelDepth = (uModel * vec4(mix(aStart, aEnd, aAlong), 1.0)).z;
      vec2 pixelToNdc = vec2(2.0 / max(1.0, uResolution.x), 2.0 / max(1.0, uResolution.y));
      clip.xy += normal * pixelToNdc * (max(0.125, uThickness) * 0.5) * aSide * clip.w;
      gl_Position = clip;
    }
  `);
  const fragment = compileRawShader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    uniform vec4 uColor;
    uniform float uDepthCutoff;
    varying float vModelDepth;
    void main() {
      if (vModelDepth < uDepthCutoff) discard;
      gl_FragColor = uColor;
    }
  `);
  const program = linkSpecializedProgram(gl, vertex, fragment);
  if (!program) return null;
  return {
    program,
    start: gl.getAttribLocation(program, "aStart"),
    end: gl.getAttribLocation(program, "aEnd"),
    side: gl.getAttribLocation(program, "aSide"),
    along: gl.getAttribLocation(program, "aAlong"),
    mvp: gl.getUniformLocation(program, "uMvp"),
    model: gl.getUniformLocation(program, "uModel"),
    resolution: gl.getUniformLocation(program, "uResolution"),
    thickness: gl.getUniformLocation(program, "uThickness"),
    color: gl.getUniformLocation(program, "uColor"),
    depthCutoff: gl.getUniformLocation(program, "uDepthCutoff"),
  };
}

function compileRawShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function linkSpecializedProgram(gl, vertex, fragment) {
  if (!vertex || !fragment) {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    return null;
  }
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.detachShader?.(program, vertex);
  gl.detachShader?.(program, fragment);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

function rawModelMatrices(width = 1, height = 1, scale = 1, depth = 1, rotation = [0, 0, 0], contentTransform = {}) {
  const projection = mat4Perspective(Math.PI / 3, width / Math.max(1, height), 0.1, 5000);
  const cameraZ = Math.max(1, height) * 0.92;
  const view = mat4LookAt([0, 0, cameraZ], [0, 0, 0], [0, 1, 0]);
  let model = mat4Identity();
  if (!isIdentityTransform(contentTransform)) {
    const content = normalizedContentTransform(contentTransform);
    model = mat4Multiply(model, mat4Translation(content.x * width * 0.5, content.y * height * 0.5, 0));
    model = mat4Multiply(model, mat4RotationZ(content.rotation));
    model = mat4Multiply(model, mat4Scale(content.scale, content.scale, content.scale));
  }
  model = mat4Multiply(model, mat4RotationX(rotation[0] || 0));
  model = mat4Multiply(model, mat4RotationY(rotation[1] || 0));
  model = mat4Multiply(model, mat4RotationZ(rotation[2] || 0));
  model = mat4Multiply(model, mat4Scale(scale, scale, scale * depth));
  return {
    model,
    mvp: mat4Multiply(mat4Multiply(projection, view), model),
  };
}

function mat4Identity() {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

function mat4Perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy * 0.5);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, (2 * far * near) * nf, 0,
  ]);
}

function mat4LookAt(eye, center, up) {
  const z = normalize3([eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]]);
  const x = normalize3(cross3(up, z));
  const y = cross3(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot3(x, eye), -dot3(y, eye), -dot3(z, eye), 1,
  ]);
}

function mat4RotationX(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new Float32Array([
    1, 0, 0, 0,
    0, c, s, 0,
    0, -s, c, 0,
    0, 0, 0, 1,
  ]);
}

function mat4RotationY(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new Float32Array([
    c, 0, -s, 0,
    0, 1, 0, 0,
    s, 0, c, 0,
    0, 0, 0, 1,
  ]);
}

function mat4RotationZ(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new Float32Array([
    c, s, 0, 0,
    -s, c, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

function mat4Scale(x, y, z) {
  return new Float32Array([
    x, 0, 0, 0,
    0, y, 0, 0,
    0, 0, z, 0,
    0, 0, 0, 1,
  ]);
}

function mat4Translation(x, y, z) {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ]);
}

function mat4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[0 * 4 + row] * b[col * 4 + 0] +
        a[1 * 4 + row] * b[col * 4 + 1] +
        a[2 * 4 + row] * b[col * 4 + 2] +
        a[3 * 4 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

function normalize3(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function drawPointCloud(target, points, wireColor = [245, 245, 245, 255]) {
  if (!points?.length) return;
  target.noFill();
  target.stroke(...wireColor);
  target.strokeWeight(2);
  target.beginShape(POINTS);
  for (let index = 0; index + 2 < points.length; index += 3) {
    target.vertex(points[index], points[index + 1], points[index + 2]);
  }
  target.endShape();
}

function drawParsedModel(target, mesh, renderMode = "surface", surfaceColor = [220, 225, 220, 255], wireColor = [20, 20, 20, 220], wireThickness = 1) {
  if (renderMode === "points") {
    drawPointCloud(target, buildParsedModelPointCloud(mesh, 4000), wireColor);
    return;
  }
  if (renderMode !== "wireframe") {
    target.noStroke();
    target.ambientMaterial?.(...surfaceColor);
    target.fill?.(...surfaceColor);
    drawWithPolygonOffset(target, renderMode === "surfaceWire", () => drawParsedTriangles(target, mesh));
  }
  if (renderMode === "wireframe" || renderMode === "surfaceWire") {
    target.noFill();
    target.stroke(...wireColor);
    target.strokeWeight(wireThickness);
    drawParsedTriangles(target, mesh);
  }
}

function drawGeometryModel(target, geometry, renderMode = "surface", surfaceColor = [220, 225, 220, 255], wireColor = [20, 20, 20, 220], wireThickness = 1) {
  if (renderMode !== "wireframe") {
    target.noStroke();
    target.ambientMaterial?.(...surfaceColor);
    target.fill?.(...surfaceColor);
    drawWithPolygonOffset(target, renderMode === "surfaceWire", () => target.model(geometry));
  }
  if (renderMode === "wireframe" || renderMode === "surfaceWire") {
    target.noFill();
    target.stroke(...wireColor);
    target.strokeWeight(wireThickness);
    target.model(geometry);
  }
}

function modelColor(value, fallback = [255, 255, 255, 255]) {
  const rgba = colorUniform(value);
  if (!rgba) return fallback;
  return rgba.map((channel) => Math.round(Math.max(0, Math.min(1, Number(channel) || 0)) * 255));
}

function normalizedModelColor(value, fallback = [255, 255, 255, 255]) {
  return modelColor(value, fallback).map((channel) => channel / 255);
}

function drawWithPolygonOffset(target, enabled, draw) {
  const gl = target?.drawingContext;
  if (!enabled || !gl?.polygonOffset || typeof draw !== "function") return draw?.();
  const wasEnabled = gl.isEnabled(gl.POLYGON_OFFSET_FILL);
  const previousFactor = gl.getParameter(gl.POLYGON_OFFSET_FACTOR);
  const previousUnits = gl.getParameter(gl.POLYGON_OFFSET_UNITS);
  gl.enable(gl.POLYGON_OFFSET_FILL);
  gl.polygonOffset(1, 2);
  try {
    return draw();
  } finally {
    gl.polygonOffset(previousFactor, previousUnits);
    if (!wasEnabled) gl.disable(gl.POLYGON_OFFSET_FILL);
  }
}

function ensureParsedModelGeometry(item) {
  if (item.modelGeometryFailed) return null;
  if (item.modelGeometry) return item.modelGeometry;
  const mesh = item.modelData;
  const Geometry = globalThis.p5?.Geometry;
  if (!mesh || typeof Geometry !== "function") return null;
  const geometry = new Geometry();
  geometry.gid = `vj1-stl-${stableGeometryId(item.id)}`;
  for (const triangle of mesh.triangles || []) {
    const base = geometry.vertices.length;
    const normal = normalizeVector(triangle.normal || triangleNormal(triangle.vertices || []));
    for (const vertex of triangle.vertices || []) {
      geometry.vertices.push(createGeometryVector(vertex[0], vertex[1], vertex[2]));
      geometry.vertexNormals?.push?.(createGeometryVector(normal[0], normal[1], normal[2]));
    }
    geometry.faces.push([base, base + 1, base + 2]);
  }
  if (!geometry.vertices.length || !geometry.faces.length) return null;
  geometry._makeTriangleEdges?.();
  geometry._edgesToVertices?.();
  item.modelGeometry = geometry;
  return geometry;
}

function ensureParsedModelPointCloud(item, pointBudget = 4000) {
  const budget = Math.max(128, Math.min(50000, Math.round(Number(pointBudget) || 4000)));
  const mesh = item?.modelData;
  const key = `stl:${mesh?.triangles?.length || 0}:${budget}`;
  if (item?.modelPointCloud && item.modelPointCloudKey === key) return item.modelPointCloud;
  const points = buildParsedModelPointCloud(mesh, budget);
  if (item) {
    item.modelPointCloud = points;
    item.modelPointCloudKey = key;
  }
  return points;
}

function ensureParsedModelWireLines(item, lineBudget = 4000) {
  const budget = Math.max(128, Math.min(50000, Math.round(Number(lineBudget) || 4000)));
  const mesh = item?.modelData;
  const key = `wire:${mesh?.triangles?.length || 0}:${budget}`;
  if (item?.modelWireLines && item.modelWireLinesKey === key) return item.modelWireLines;
  const lines = buildParsedModelWireLines(mesh, budget);
  if (item) {
    item.modelWireLines = lines;
    item.modelWireLinesKey = key;
  }
  return lines;
}

function ensureParsedModelThickWireVertices(item, lineBudget = 4000) {
  const budget = Math.max(128, Math.min(50000, Math.round(Number(lineBudget) || 4000)));
  const mesh = item?.modelData;
  const key = `thickWire:${mesh?.triangles?.length || 0}:${budget}`;
  if (item?.modelThickWireVertices && item.modelThickWireVerticesKey === key) return item.modelThickWireVertices;
  const vertices = buildParsedModelThickWireVertices(ensureParsedModelWireLines(item, budget));
  if (item) {
    item.modelThickWireVertices = vertices;
    item.modelThickWireVerticesKey = key;
  }
  return vertices;
}

function ensureP5ModelPointCloud(item, pointBudget = 4000) {
  const budget = Math.max(128, Math.min(50000, Math.round(Number(pointBudget) || 4000)));
  const vertices = Array.isArray(item?.model?.vertices) ? item.model.vertices : [];
  const key = `p5:${vertices.length}:${budget}`;
  if (item?.modelPointCloud && item.modelPointCloudKey === key) return item.modelPointCloud;
  const stride = Math.max(1, Math.ceil(vertices.length / budget));
  const count = Math.ceil(vertices.length / stride);
  const points = new Float32Array(count * 3);
  let write = 0;
  for (let index = 0; index < vertices.length && write + 2 < points.length; index += stride) {
    const vertex = vertices[index] || {};
    points[write++] = Number(vertex.x) || 0;
    points[write++] = Number(vertex.y) || 0;
    points[write++] = Number(vertex.z) || 0;
  }
  if (item) {
    item.modelPointCloud = points.subarray(0, write);
    item.modelPointCloudKey = key;
  }
  return item?.modelPointCloud || points.subarray(0, write);
}

function buildParsedModelSurfaceVertices(mesh) {
  const triangles = Array.isArray(mesh?.triangles) ? mesh.triangles : [];
  if (!triangles.length) return new Float32Array(0);
  const vertices = new Float32Array(triangles.length * 18);
  let write = 0;
  for (const triangle of triangles) {
    const normal = normalizeVector(triangle.normal || triangleNormal(triangle.vertices || []));
    for (const vertex of triangle.vertices || []) {
      vertices[write++] = Number(vertex[0]) || 0;
      vertices[write++] = Number(vertex[1]) || 0;
      vertices[write++] = Number(vertex[2]) || 0;
      vertices[write++] = normal[0];
      vertices[write++] = normal[1];
      vertices[write++] = normal[2];
    }
  }
  return vertices.subarray(0, write);
}

function buildParsedModelPointCloud(mesh, pointBudget = 4000) {
  const triangles = Array.isArray(mesh?.triangles) ? mesh.triangles : [];
  const totalVertices = triangles.length * 3;
  if (!totalVertices) return new Float32Array(0);
  const budget = Math.max(128, Math.min(50000, Math.round(Number(pointBudget) || 4000)));
  const stride = Math.max(1, Math.ceil(totalVertices / budget));
  const count = Math.ceil(totalVertices / stride);
  const points = new Float32Array(count * 3);
  let seen = 0;
  let write = 0;
  for (const triangle of triangles) {
    for (const vertex of triangle.vertices || []) {
      if (seen % stride === 0 && write + 2 < points.length) {
        points[write++] = Number(vertex[0]) || 0;
        points[write++] = Number(vertex[1]) || 0;
        points[write++] = Number(vertex[2]) || 0;
      }
      seen++;
    }
  }
  return points.subarray(0, write);
}

function buildParsedModelThickWireVertices(lines) {
  if (!lines?.length) return new Float32Array(0);
  const lineCount = Math.floor(lines.length / 6);
  const vertices = new Float32Array(lineCount * 6 * 8);
  let write = 0;
  for (let index = 0; index + 5 < lines.length; index += 6) {
    const ax = lines[index];
    const ay = lines[index + 1];
    const az = lines[index + 2];
    const bx = lines[index + 3];
    const by = lines[index + 4];
    const bz = lines[index + 5];
    write = appendThickWireVertex(vertices, write, ax, ay, az, bx, by, bz, -1, 0);
    write = appendThickWireVertex(vertices, write, ax, ay, az, bx, by, bz, 1, 0);
    write = appendThickWireVertex(vertices, write, ax, ay, az, bx, by, bz, -1, 1);
    write = appendThickWireVertex(vertices, write, ax, ay, az, bx, by, bz, -1, 1);
    write = appendThickWireVertex(vertices, write, ax, ay, az, bx, by, bz, 1, 0);
    write = appendThickWireVertex(vertices, write, ax, ay, az, bx, by, bz, 1, 1);
  }
  return vertices.subarray(0, write);
}

function appendThickWireVertex(vertices, write, ax, ay, az, bx, by, bz, side, along) {
  vertices[write++] = ax;
  vertices[write++] = ay;
  vertices[write++] = az;
  vertices[write++] = bx;
  vertices[write++] = by;
  vertices[write++] = bz;
  vertices[write++] = side;
  vertices[write++] = along;
  return write;
}

function buildParsedModelWireLines(mesh, lineBudget = 4000) {
  const triangles = Array.isArray(mesh?.triangles) ? mesh.triangles : [];
  if (!triangles.length) return new Float32Array(0);
  const totalEdges = triangles.length * 3;
  const budget = Math.max(128, Math.min(50000, Math.round(Number(lineBudget) || 4000)));
  const stride = Math.max(1, Math.ceil(totalEdges / budget));
  const count = Math.ceil(totalEdges / stride);
  const lines = new Float32Array(count * 6);
  let seen = 0;
  let write = 0;
  for (const triangle of triangles) {
    const vertices = triangle.vertices || [];
    write = appendSampledWireLine(lines, write, seen++, stride, vertices[0], vertices[1]);
    write = appendSampledWireLine(lines, write, seen++, stride, vertices[1], vertices[2]);
    write = appendSampledWireLine(lines, write, seen++, stride, vertices[2], vertices[0]);
  }
  return lines.subarray(0, write);
}

function appendSampledWireLine(lines, write, seen, stride, a = [0, 0, 0], b = [0, 0, 0]) {
  if (seen % stride !== 0 || write + 5 >= lines.length) return write;
  lines[write++] = Number(a?.[0]) || 0;
  lines[write++] = Number(a?.[1]) || 0;
  lines[write++] = Number(a?.[2]) || 0;
  lines[write++] = Number(b?.[0]) || 0;
  lines[write++] = Number(b?.[1]) || 0;
  lines[write++] = Number(b?.[2]) || 0;
  return write;
}

function createGeometryVector(x = 0, y = 0, z = 0) {
  const Vector = globalThis.p5?.Vector;
  if (typeof Vector === "function") return new Vector(Number(x) || 0, Number(y) || 0, Number(z) || 0);
  if (typeof globalThis.createVector === "function") return globalThis.createVector(Number(x) || 0, Number(y) || 0, Number(z) || 0);
  return { x: Number(x) || 0, y: Number(y) || 0, z: Number(z) || 0 };
}

function stableGeometryId(id = "") {
  let hash = 2166136261;
  const text = String(id || "model");
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function drawParsedTriangles(target, mesh) {
  target.beginShape(TRIANGLES);
  for (const triangle of mesh.triangles || []) {
    const normal = triangle.normal || [0, 0, 1];
    target.normal?.(normal[0], normal[1], normal[2]);
    for (const vertex of triangle.vertices || []) target.vertex(vertex[0], vertex[1], vertex[2]);
  }
  target.endShape();
}

function parseStlMesh(buffer) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer?.buffer || buffer || []);
  if (bytes.byteLength < 15) throw new Error("STL file is empty");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declaredTriangles = bytes.byteLength >= 84 ? view.getUint32(80, true) : 0;
  const expectedBinarySize = 84 + declaredTriangles * 50;
  const triangles = declaredTriangles > 0 && expectedBinarySize === bytes.byteLength
    ? parseBinaryStl(view, declaredTriangles)
    : parseAsciiStl(new TextDecoder("utf-8").decode(bytes));
  if (!triangles.length) throw new Error("STL contained no triangles");
  return normalizeParsedMesh(triangles);
}

export function parseObjMesh(text = "") {
  const vertices = [];
  const normals = [];
  const faces = [];
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    const type = parts.shift();
    if (type === "v" && parts.length >= 3) {
      vertices.push(parts.slice(0, 3).map((value) => Number(value) || 0));
    } else if (type === "vn" && parts.length >= 3) {
      normals.push(normalizeVector(parts.slice(0, 3).map((value) => Number(value) || 0)));
    } else if (type === "f" && parts.length >= 3) {
      faces.push(parts.map((token) => {
        const [vertexToken, , normalToken] = token.split("/");
        return {
          vertex: resolveObjIndex(vertexToken, vertices.length),
          normal: resolveObjIndex(normalToken, normals.length),
        };
      }));
    }
  }
  const triangles = [];
  for (const face of faces) {
    for (let index = 1; index + 1 < face.length; index++) {
      const corners = [face[0], face[index], face[index + 1]];
      const triangleVertices = corners.map((corner) => vertices[corner.vertex]).filter(Boolean);
      if (triangleVertices.length !== 3) continue;
      const cornerNormals = corners.map((corner) => normals[corner.normal]).filter(Boolean);
      const normal = cornerNormals.length === 3
        ? normalizeVector(cornerNormals.reduce((sum, value) => sum.map((item, axis) => item + value[axis]), [0, 0, 0]))
        : triangleNormal(triangleVertices);
      triangles.push({ normal, vertices: triangleVertices });
    }
  }
  if (!triangles.length) throw new Error("OBJ contained no polygon faces");
  return normalizeParsedMesh(triangles);
}

function resolveObjIndex(token, length) {
  const value = Number.parseInt(token, 10);
  if (!Number.isFinite(value) || value === 0) return -1;
  return value < 0 ? length + value : value - 1;
}

function parseBinaryStl(view, count) {
  const triangles = [];
  let offset = 84;
  for (let index = 0; index < count && offset + 50 <= view.byteLength; index++) {
    const normal = [
      view.getFloat32(offset, true),
      view.getFloat32(offset + 4, true),
      view.getFloat32(offset + 8, true),
    ];
    offset += 12;
    const vertices = [];
    for (let vertexIndex = 0; vertexIndex < 3; vertexIndex++) {
      vertices.push([
        view.getFloat32(offset, true),
        view.getFloat32(offset + 4, true),
        view.getFloat32(offset + 8, true),
      ]);
      offset += 12;
    }
    offset += 2;
    triangles.push({ normal, vertices });
  }
  return triangles;
}

function parseAsciiStl(text = "") {
  const values = [];
  const vertexRe = /vertex\s+([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:e[-+]?\d+)?)/gi;
  let match;
  while ((match = vertexRe.exec(text))) {
    values.push([Number(match[1]), Number(match[2]), Number(match[3])]);
  }
  const triangles = [];
  for (let index = 0; index + 2 < values.length; index += 3) {
    const vertices = [values[index], values[index + 1], values[index + 2]];
    triangles.push({ normal: triangleNormal(vertices), vertices });
  }
  return triangles;
}

function normalizeParsedMesh(triangles) {
  const bounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  for (const triangle of triangles) {
    for (const vertex of triangle.vertices) {
      for (let axis = 0; axis < 3; axis++) {
        bounds.min[axis] = Math.min(bounds.min[axis], vertex[axis]);
        bounds.max[axis] = Math.max(bounds.max[axis], vertex[axis]);
      }
    }
  }
  const center = bounds.min.map((min, axis) => (min + bounds.max[axis]) * 0.5);
  const extent = Math.max(...bounds.max.map((max, axis) => Math.abs(max - bounds.min[axis])), 0.0001);
  const scale = 100 / extent;
  const normalizedTriangles = triangles.map((triangle) => {
    const vertices = triangle.vertices.map((vertex) => vertex.map((value, axis) => (value - center[axis]) * scale));
    return {
      normal: normalizeVector(vectorLength(triangle.normal) > 0.0001 ? triangle.normal : triangleNormal(vertices)),
      vertices,
    };
  });
  const normalizedBounds = {
    min: bounds.min.map((value, axis) => (value - center[axis]) * scale),
    max: bounds.max.map((value, axis) => (value - center[axis]) * scale),
  };
  return { triangles: normalizedTriangles, bounds: normalizedBounds, sourceBounds: bounds };
}

function triangleNormal(vertices) {
  const a = vertices[0] || [0, 0, 0];
  const b = vertices[1] || [0, 0, 0];
  const c = vertices[2] || [0, 0, 0];
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return normalizeVector([
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ]);
}

function normalizeVector(vector = [0, 0, 1]) {
  const length = vectorLength(vector);
  if (length <= 0.0001) return [0, 0, 1];
  return vector.map((value) => value / length);
}

function vectorLength(vector = []) {
  return Math.hypot(Number(vector[0]) || 0, Number(vector[1]) || 0, Number(vector[2]) || 0);
}

function drawSampleRect(pg, source, rect = {}, x = 0, y = 0, w = pg.width, h = pg.height) {
  const sx = Math.max(0, Number(rect.x) || 0);
  const sy = Math.max(0, Number(rect.y) || 0);
  const sw = Math.max(1, Number(rect.width) || source?.width || w);
  const sh = Math.max(1, Number(rect.height) || source?.height || h);
  try {
    pg.image(source, x, y, w, h, sx, sy, sw, sh);
  } catch {
    const drawable = source?.canvas || source?.elt || source;
    pg.drawingContext?.drawImage?.(drawable, sx, sy, sw, sh, x, y, w, h);
  }
}

export function directFitRects(sourceWidth, sourceHeight, target = {}, fit = "stretch") {
  const sw = Math.max(1, Number(sourceWidth) || 1);
  const sh = Math.max(1, Number(sourceHeight) || 1);
  const destination = {
    x: Number(target.x) || 0,
    y: Number(target.y) || 0,
    width: Math.max(1, Number(target.width) || 1),
    height: Math.max(1, Number(target.height) || 1),
  };
  const source = { x: 0, y: 0, width: sw, height: sh };
  if (fit === "contain") {
    const scale = Math.min(destination.width / sw, destination.height / sh);
    const widthPx = sw * scale;
    const heightPx = sh * scale;
    destination.x += (destination.width - widthPx) * 0.5;
    destination.y += (destination.height - heightPx) * 0.5;
    destination.width = widthPx;
    destination.height = heightPx;
  } else if (fit === "cover") {
    const sourceAspect = sw / sh;
    const targetAspect = destination.width / destination.height;
    if (sourceAspect > targetAspect) {
      source.width = sh * targetAspect;
      source.x = (sw - source.width) * 0.5;
    } else {
      source.height = sw / targetAspect;
      source.y = (sh - source.height) * 0.5;
    }
  }
  return { source, destination };
}

function rectToCorners(rect = {}) {
  const x = Number(rect.x) || 0;
  const y = Number(rect.y) || 0;
  const widthPx = Math.max(1, Number(rect.width) || 1);
  const heightPx = Math.max(1, Number(rect.height) || 1);
  return [
    { x, y },
    { x: x + widthPx, y },
    { x: x + widthPx, y: y + heightPx },
    { x, y: y + heightPx },
  ];
}

function cornersRect(corners = []) {
  if (!Array.isArray(corners) || corners.length !== 4) return null;
  const xs = corners.map((corner) => Number(corner?.x));
  const ys = corners.map((corner) => Number(corner?.y));
  if (![...xs, ...ys].every(Number.isFinite)) return null;
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(1, Math.max(...xs) - x),
    height: Math.max(1, Math.max(...ys) - y),
  };
}

function applyBlendGlobal(blend = "normal") {
  if (!blend || blend === "normal") blendMode(BLEND);
  else if (blend === "add") blendMode(ADD);
  else if (blend === "screen") blendMode(SCREEN);
  else if (blend === "multiply") blendMode(MULTIPLY);
  else {
    const mode = globalThis[String(blend || "").toUpperCase()];
    blendMode(typeof mode !== "undefined" ? mode : BLEND);
  }
}

function drawWebGLBuffer(pg, source, x, y, w, h) {
  pg.push();
  pg.translate(x, y + h);
  pg.scale(1, -1);
  pg.image(source, 0, 0, w, h);
  pg.pop();
}

function canvasRectCorners(rect = {}) {
  return [
    { id: "nw", x: rect.x, y: rect.y },
    { id: "ne", x: rect.x + rect.width, y: rect.y },
    { id: "sw", x: rect.x, y: rect.y + rect.height },
    { id: "se", x: rect.x + rect.width, y: rect.y + rect.height },
  ];
}

function distanceSquared(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function canvasFrameBorderHit(rect = {}, x = 0, y = 0, tolerance = 8) {
  const inset = Math.max(0, Number(tolerance) || 0);
  const left = Number(rect.x) || 0;
  const top = Number(rect.y) || 0;
  const right = left + Math.max(0, Number(rect.width) || 0);
  const bottom = top + Math.max(0, Number(rect.height) || 0);
  const withinX = x >= left - inset && x <= right + inset;
  const withinY = y >= top - inset && y <= bottom + inset;
  return (withinY && (Math.abs(x - left) <= inset || Math.abs(x - right) <= inset))
    || (withinX && (Math.abs(y - top) <= inset || Math.abs(y - bottom) <= inset));
}

export function moveCanvasFrameRect(rect, dx, dy, canvasWidth, canvasHeight) {
  return {
    ...rect,
    x: Math.round(Math.max(0, Math.min(canvasWidth - rect.width, rect.x + dx))),
    y: Math.round(Math.max(0, Math.min(canvasHeight - rect.height, rect.y + dy))),
  };
}

export function canvasComponentPlacementRect(canvas = {}, sourceMetrics = {}, target = {}, placement = null) {
  const canvasWidth = Math.max(1, Number(canvas.width) || VJ1.canvasWidth);
  const canvasHeight = Math.max(1, Number(canvas.height) || VJ1.canvasHeight);
  const targetWidth = Math.max(1, Number(target.width) || canvasWidth);
  const targetHeight = Math.max(1, Number(target.height) || canvasHeight);
  const scaleX = targetWidth / canvasWidth;
  const scaleY = targetHeight / canvasHeight;
  const placementScale = Number(placement?.scale);
  const hasRelativePlacement = Number.isFinite(placementScale) && placementScale > 0;
  const sourceWidth = Math.max(1, Number(sourceMetrics.baseWidth) || Number(sourceMetrics.width) || 1);
  const sourceHeight = Math.max(1, Number(sourceMetrics.baseHeight) || Number(sourceMetrics.height) || 1);
  const logicalWidth = placementScale * canvasWidth;
  const logicalHeight = logicalWidth * sourceHeight / sourceWidth;
  const width = Math.max(1, hasRelativePlacement
    ? logicalWidth * scaleX
    : (Number(sourceMetrics.baseWidth) || Number(sourceMetrics.width) || 1) * scaleX);
  const height = Math.max(1, hasRelativePlacement
    ? logicalHeight * scaleY
    : (Number(sourceMetrics.baseHeight) || Number(sourceMetrics.height) || 1) * scaleY);
  return {
    x: Math.round((targetWidth - width) * 0.5),
    y: Math.round((targetHeight - height) * 0.5),
    width: Math.round(width),
    height: Math.round(height),
  };
}

export function componentReferencePlacement(parent = {}, child = {}, render = {}, target = {}, placement = null) {
  const targetWidth = Math.max(1, Number(target.width) || 1);
  const targetHeight = Math.max(1, Number(target.height) || 1);
  if (parent.type !== "canvas") return { x: 0, y: 0, width: targetWidth, height: targetHeight };
  return canvasComponentPlacementRect(parent.canvas, componentFrameMetrics(render, child), target, placement);
}

function fullTargetRect(target = {}) {
  return {
    x: 0,
    y: 0,
    width: Math.max(1, Number(target.width) || 1),
    height: Math.max(1, Number(target.height) || 1),
  };
}

export function componentReferenceRenderRequest(render = {}, component = {}, placement = {}, meta = {}) {
  const metrics = componentFrameMetrics(render, component);
  const desiredScale = Math.max(
    Math.max(1, Number(placement.width) || 1) / metrics.baseWidth,
    Math.max(1, Number(placement.height) || 1) / metrics.baseHeight
  );
  const maximumScale = Math.min(metrics.width / metrics.baseWidth, metrics.height / metrics.baseHeight);
  const scale = Math.min(maximumScale, desiredScale);
  return createRenderRequest("texture", {
    width: quantizedRenderDimension(metrics.baseWidth * scale, metrics.width),
    height: quantizedRenderDimension(metrics.baseHeight * scale, metrics.height),
  }, {
    ...meta,
    logicalWidth: metrics.baseWidth,
    logicalHeight: metrics.baseHeight,
    demandScale: scale,
  });
}

export function canvasPreviewRenderRequest(component = {}, viewportWidth = 1, viewportHeight = 1, meta = {}) {
  const canvas = component.canvas || {};
  const canvasWidth = Math.max(1, Math.round(Number(canvas.width) || VJ1.canvasWidth));
  const canvasHeight = Math.max(1, Math.round(Number(canvas.height) || VJ1.canvasHeight));
  const quality = ["auto", "low", "full"].includes(canvas.previewQuality) ? canvas.previewQuality : "auto";
  const fitScale = Math.min(
    Math.max(1, Number(viewportWidth) || 1) / canvasWidth,
    Math.max(1, Number(viewportHeight) || 1) / canvasHeight,
    1
  );
  const scale = quality === "full" ? 1 : quality === "low" ? fitScale * 0.5 : fitScale;
  return createRenderRequest("texture", {
    width: Math.max(1, Math.round(canvasWidth * scale)),
    height: Math.max(1, Math.round(canvasHeight * scale)),
  }, meta);
}

export function resizeCanvasFrameRect(rect, corner, dx, dy, canvasWidth, canvasHeight) {
  const minSize = 16;
  const east = corner.includes("e");
  const south = corner.includes("s");
  const anchorX = east ? rect.x : rect.x + rect.width;
  const anchorY = south ? rect.y : rect.y + rect.height;
  const draggedX = (east ? rect.x + rect.width : rect.x) + dx;
  const draggedY = (south ? rect.y + rect.height : rect.y) + dy;
  const cornerX = east
    ? Math.max(anchorX + minSize, Math.min(canvasWidth, draggedX))
    : Math.max(0, Math.min(anchorX - minSize, draggedX));
  const cornerY = south
    ? Math.max(anchorY + minSize, Math.min(canvasHeight, draggedY))
    : Math.max(0, Math.min(anchorY - minSize, draggedY));
  return {
    x: Math.round(east ? anchorX : cornerX),
    y: Math.round(south ? anchorY : cornerY),
    width: Math.round(Math.abs(cornerX - anchorX)),
    height: Math.round(Math.abs(cornerY - anchorY)),
  };
}

function canvasRouteFrameRect(component = {}, surface = {}, recordingFrames = []) {
  const canvas = component.canvas || {};
  const frame = recordingFrames.find((item) => item.id === surface.outputFrameId);
  if (frame) return frame;
  return {
    x: 0,
    y: 0,
    width: Math.max(1, Number(canvas.width) || VJ1.canvasWidth),
    height: Math.max(1, Number(canvas.height) || VJ1.canvasHeight),
  };
}

export function componentSourceView(render = {}, component = {}, surface = {}, recordingFrames = []) {
  if (component.type === "canvas") {
    const logicalSize = {
      width: Math.max(1, Number(component.canvas?.width) || VJ1.canvasWidth),
      height: Math.max(1, Number(component.canvas?.height) || VJ1.canvasHeight),
    };
    const recordingFrame = recordingFrames.find((item) => item.id === surface.outputFrameId);
    const maxRasterSize = canvasMaxRasterSize(render, logicalSize);
    return {
      logicalSize,
      sampleRect: canvasRouteFrameRect(component, surface, recordingFrames),
      maxRasterSize,
      // A recording-frame route is cropped and filtered again into its surface
      // texture before projective sampling. Declare that extra sampling demand
      // here so the generic planner raises every upstream dependency together.
      samplingScale: recordingFrame ? RECORDING_FRAME_DEMAND_SCALE : 1,
    };
  }
  const metrics = componentFrameMetrics(render, component);
  const logicalSize = { width: metrics.baseWidth, height: metrics.baseHeight };
  return {
    logicalSize,
    sampleRect: { x: 0, y: 0, width: logicalSize.width, height: logicalSize.height },
    maxRasterSize: { width: metrics.width, height: metrics.height },
  };
}

export function canvasMaxRasterSize(render = {}, logicalSize = {}) {
  const width = Math.max(1, Number(logicalSize.width) || VJ1.canvasWidth);
  const height = Math.max(1, Number(logicalSize.height) || VJ1.canvasHeight);
  const configuredDensity = Math.max(0.5, Math.min(2, Number(render.pixelDensity) || 1));
  // Recording frames are independent views of a Canvas. Keep enough headroom
  // for their declared sampling allowance even at the default density, while
  // retaining the existing pixel-density control as the upper quality policy.
  const scale = Math.max(1, RECORDING_FRAME_DEMAND_SCALE, configuredDensity);
  return {
    width: Math.min(8192, Math.max(1, Math.round(width * scale))),
    height: Math.min(8192, Math.max(1, Math.round(height * scale))),
  };
}

export function scaledComponentSampleRect(sampleRect = {}, logicalSize = {}, source = {}) {
  const logicalWidth = Math.max(1, Number(logicalSize?.width) || Number(source?.width) || 1);
  const logicalHeight = Math.max(1, Number(logicalSize?.height) || Number(source?.height) || 1);
  const sourceWidth = Math.max(1, Number(source?.width) || logicalWidth);
  const sourceHeight = Math.max(1, Number(source?.height) || logicalHeight);
  return {
    x: (Math.max(0, Number(sampleRect?.x) || 0) / logicalWidth) * sourceWidth,
    y: (Math.max(0, Number(sampleRect?.y) || 0) / logicalHeight) * sourceHeight,
    width: (Math.max(1, Number(sampleRect?.width) || logicalWidth) / logicalWidth) * sourceWidth,
    height: (Math.max(1, Number(sampleRect?.height) || logicalHeight) / logicalHeight) * sourceHeight,
  };
}

function quantizedRenderDimension(value, max) {
  const upper = Math.max(1, Math.round(Number(max) || 1));
  const next = Math.min(upper, Math.max(1, Math.round(Number(value) || 1)));
  if (next < 16) return next;
  return Math.min(upper, Math.max(16, Math.round(next / 16) * 16));
}

function drawSurfaceLabel(pg, surface, component) {
  pg.noStroke();
  pg.fill(255, 230);
  pg.textAlign(LEFT, TOP);
  pg.textSize(28);
  pg.text(surface.name, 28, 24);
  pg.textSize(16);
  pg.fill(255, 165);
  pg.text(`${component?.name || "No component"} / ${surface.finalBlend} / ${Math.round(clamp01(surface.opacity) * 100)}%`, 28, 60);
}
