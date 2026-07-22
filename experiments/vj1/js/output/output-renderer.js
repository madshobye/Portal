import { VJ1 } from "../constants.js";
import { componentFrameMetrics } from "../domain/component-frame.js";
import { applyLiveRenderPatches, interpolatedLiveRenderValue, isInterpolableLiveRenderPath, resolveLiveRenderPatches } from "../domain/live-render-patch.js?v=render-state-patch-1";
import { sceneFrameSize, renderMaxFrameRate, renderPresentationFrameRate } from "../domain/render-settings.js?v=presentation-clock-1";
import { componentTextureSize } from "../domain/render-resolution.js?v=adaptive-component-demand-29";
import { clamp01, normalizeComponentPipelineSettings, sanitizeState, sceneSourceNodes } from "../domain/models.js?v=transition-start-fit-1";
import { normalizeParamValue, normalizeParamValues } from "../libraries/visual-nodes/shared/component-schema.js";
import { createManualScheduler } from "../graph/manual-scheduler.js";
import { advancePresentationClock, createPresentationClock } from "../libraries/timing-engine/presentation-clock/index.js?v=presentation-clock-1";
import { RenderNodeRuntime, textureStateKey } from "../libraries/render-engine/render-node-contract.js";
import { activeMappingProgramSurfaces, compileComponentRenderPrograms, compileOutputRenderProgram, compileMappingRenderPrograms, VISUAL_SOURCE_RENDERERS, visualSourceRenderer } from "../libraries/composition-engine/index.js?v=mapping-order-authority-1";
import { createPlacedRenderResult, directPlacementKind, transformedPlacementDemandRect } from "../graph/placed-render-result.js?v=adaptive-component-demand-29";
import { compileComponentPatch, compileShaderSchedule, flattenComponentChain, fuseLocalShaderSchedule, isFusibleShaderJob } from "../graph/render-scheduler.js?v=pending-project-node-1";
import { createProjectVisualNodeResolver } from "../libraries/visual-nodes/index.js?v=procedural-2d-1";
import { evaluateIsfDimension } from "../libraries/isf-engine/index.js?v=isf-definition-cache-1";
import { createShaderBuilder, fusedUniformName } from "../shaders/shader-builder.js?v=isf-runtime-1";
import { applyBlend } from "./blend-utils.js";
import {
  createSharedFramebufferTarget,
  isSharedFramebufferTarget,
  unwrapRenderTarget,
} from "./shared-framebuffer-target.js?v=isf-runtime-1";
import { applyFontToGlobal, applyFontToTarget } from "./font-loader.js?v=adaptive-component-demand-29";
import { GpuTimerTracker } from "./gpu-timer-tracker.js?v=runtime-diagnostics-1";
import { drawGenerator, drawStandby } from "./generators.js?v=procedural-2d-1";
import { drawCover, drawMediaFit, isDrawableMedia } from "./media-utils.js?v=runtime-diagnostics-1";
import { chainLayerState, componentRuntimeTimeKey, createMediaReadinessStatus, effectParamState, isReadyMediaItem, renderBufferKey, runtimeComponentGraphMediaState, runtimeMediaStateForSource, staticComponentGraphMediaState, staticComponentGraphState, staticMediaStateForSource, staticSourceState } from "./component-render-state.js?v=scene-live-audit-1";
import { isEffectNode, isSimpleLayer, isSourceNode, mediaSourceAlphaEdge, mediaSourceFit, nodesInComponentChainOrder, patchLayerForNode, shaderPassFromNode, sourceFromPatchNode, sourceWithNodeParams } from "./component-patch-adapter.js?v=chain-general-controls-1";
import { collectOutputMediaReadiness } from "./output-media-readiness.js?v=runtime-diagnostics-1";
import { OutputMediaRuntime } from "./output-media-runtime.js?v=boundary-media-demand-1";
import { cameraSettingsSignature } from "./shared-input-runtime.js?v=camera-input-leases-1";
import { OutputThumbnailRuntime } from "./output-thumbnail-runtime.js?v=runtime-diagnostics-1";
import { OutputSurfaceRuntime } from "./output-surface-runtime.js?v=transition-view-contract-1";
import { stableSurfaceRenderRequest } from "./surface-render-planner.js?v=transition-demand-stability-1";
import { combineContentTransforms, isIdentityTransform, normalizedContentTransform, transformedRectBounds, transformedRectVisibleRegion } from "./preview-interaction-geometry.js?v=alpha-feather-1";
import { contentTransformCanvasPlacement, contentTransformUvMatrices } from "./content-coordinate-space.js?v=gc-allocation-1";
import { ComponentPreviewInteraction } from "./component-preview-interaction.js?v=direct-scene-surface-edit-1";
import { drawBuffer } from "./render-draw-utils.js?v=runtime-diagnostics-1";
import { OutputRenderProfile, roundMetric } from "./output-render-profile.js?v=output-profile-runtime-1";
import { OutputRenderCache, RENDER_CACHE_IDLE_FRAMES } from "../libraries/cache-engine/render-cache/index.js?v=periodic-preview-maintenance-1";
import { FULL_NODE_BOUNDARY, isFullNodeBoundary, nodeBoundaryPixelRect, nodeRoiRequest, sameNodeBoundary } from "../libraries/render-engine/roi/index.js";
import { renderSourceDetail, renderView, withRenderView } from "../libraries/render-engine/render-view/index.js?v=source-detail-contract-1";
import { applyShaderTarget, chainItemToShaderPass, clearShaderTarget, disposeGraphics, drawShaderTarget, drawShaderTargetRect, drawWithContentTransform, effectNeedsComposite, effectParamNumber, enumUniform, nextFxTargetSlot, resetShaderTarget, setDynamicShaderUniformIfPresent, setShaderUniformIfPresent, shaderDrawingBufferSize } from "./shader-target-runtime.js?v=source-roi-view-3";
import { COMPONENT_POST_FRAGMENT_SHADER, COMPONENT_UPSCALE_FRAGMENT_SHADER, LAYER_TRANSFORM_FRAGMENT_SHADER, OVERLAY_BLEND_FRAGMENT_SHADER, RENDER_PASS_VERTEX_SHADER } from "./render-pass-shaders.js?v=render-coordinate-scope-3";
import { componentInstanceTime, effectTransformUniforms, eyeballFrameUniforms, generatorRateParam, globalVisualTimeScale, instanceTime, qualityAdjustedGeneratorParams, qualityScaledRenderRequest, usesShadertoyInterface } from "./render-runtime-math.js?v=volumetric-clouds-1";
import {
  createRenderRequest,
  defaultProjectSurfaceMapping,
  frameRenderRequest,
  frameSize,
  outputFrameForId,
  outputFrames,
  outputFrameOffset,
  instanceInvariantRenderRequest,
  mappingWorldRender,
  renderRequestKey,
  renderRequestStateKey,
  RECORDING_FRAME_DEMAND_SCALE,
  outputSpanRect,
  worldSize,
} from "./render-geometry.js?v=output-one-1";
import { VjMapper } from "../libraries/mapping-engine/mapping-engine/index.js?v=transition-view-contract-1";
import { colorUniform } from "./specialized/model-color.js?v=adaptive-component-demand-29";
import { SpecializedSourceRuntime } from "./specialized/specialized-source-runtime.js?v=full-model-depth-2";
import {
  sceneMaxRasterSize,
  scenePreviewRenderRequest,
  componentAdaptiveRasterLimit,
  componentLogicalPreviewRect,
  componentPreviewRenderRequest,
  componentReferencePlacement,
  componentReferenceCount,
  componentReferencePrefersSharedTexture,
  componentReferenceRegionRequest,
  componentReferenceRenderRequest,
  componentRenderInstanceKey,
  componentSourceView,
  cornersRect,
  fullTargetRect,
  rectToCorners,
  resolutionScaledStrokeWidth,
  sharedComponentRenderRequests,
} from "./component-render-layout.js?v=transition-demand-stability-1";

export { averageGpuQueryNanoseconds, GpuTimerTracker } from "./gpu-timer-tracker.js?v=runtime-diagnostics-1";
export { parseObjMesh } from "../libraries/mesh-engine/obj-parser/index.js";
export { modelDepthCutoff, transformedModelDepthRange } from "../libraries/mesh-engine/mesh-render-math.js";
export { chainTransformDragScale, pointInTransformedRect } from "./preview-interaction-geometry.js?v=alpha-feather-1";
export { advanceRateClock, advanceSpatialScale, componentInstanceTime, effectTransformUniforms, eyeballFrameUniforms, instanceTime, qualityAdjustedGeneratorParams, qualityScaledRenderRequest } from "./render-runtime-math.js?v=volumetric-clouds-1";
export { sourceWithNodeParams } from "./component-patch-adapter.js?v=alpha-feather-1";
export { effectNeedsComposite } from "./shader-target-runtime.js?v=source-roi-view-3";
export { fittedThumbnailSize } from "./thumbnail-utils.js?v=canvas-global-resolution-1";
export { cameraCaptureSettings, cameraSettingsSignature } from "./shared-input-runtime.js?v=camera-input-leases-1";
export {
  terrainExpandedGridWireVertices,
  terrainExpandedWireVertices,
  terrainGridSize,
  terrainSafeNearDistance,
  terrainSurfaceGridVertices,
  terrainSurfaceTriangleIndices,
  terrainTriangleEdgeUvs,
} from "./specialized/terrain-mesh.js?v=node-program-hooks-15";
export {
  sceneComponentPlacementRect,
  sceneFrameBorderHit,
  sceneMaxRasterSize,
  scenePreviewRenderRequest,
  componentAdaptiveRasterLimit,
  componentLogicalPreviewRect,
  componentPreviewRenderRequest,
  componentReferencePlacement,
  componentReferenceCount,
  componentReferencePrefersSharedTexture,
  componentReferenceRegionRequest,
  componentReferenceRenderRequest,
  componentRenderInstanceKey,
  componentSourceView,
  directFitRects,
  moveSceneFrameRect,
  resolutionScaledStrokeWidth,
  resizeSceneFrameRect,
  scaledComponentSampleRect,
  sharedComponentRenderRequests,
} from "./component-render-layout.js?v=transition-demand-stability-1";

export function visualOperationRenderItem(operation = {}, item = {}, inheritedTransform = {}, effectComponent = null) {
  const opcode = operation?.opcode || item?.kind;
  const transformDomain = operation?.transformDomain || operation?.compilerHook?.transformDomain || "";
  const inheritsGroupTransform = opcode !== "effect"
    || transformDomain === "group-field"
    || (!transformDomain && effectComponent?.transformSource === false);
  // The common compiled path returns the authored object directly for
  // composition effects. Besides preserving the correct coordinate domain,
  // this avoids an object allocation and keeps local effects fusion-eligible.
  if (isIdentityTransform(inheritedTransform) || !inheritsGroupTransform) return item;
  return { ...item, transform: combineContentTransforms(inheritedTransform, item.transform || {}) };
}

const NATIVE_SOURCE_HOST_METHODS = Object.freeze({
  "output/specialized:screenShare": "drawScreenShareGenerator",
  "output/specialized:anatomy": "drawAnatomyGenerator",
  "output/specialized:terrainFlyover": "drawTerrainGenerator",
  "output/specialized:featureMorph": "drawFeatureMorphGenerator",
  "output/specialized:featureMorphV2": "drawFeatureMorphGenerator",
  "output/specialized:tileTexture": "drawTileTextureGenerator",
  "output/specialized:text": "drawTextGenerator",
  "output/specialized:meshPatterns": "drawMeshPatternsGenerator",
});
const FULL_RENDER_UV_RECT = Object.freeze([0, 0, 1, 1]);
const BASIC_NATIVE_SOURCE_RENDERERS = new Set([
  "output/specialized:black",
  "output/specialized:checker",
]);
const SOURCE_HOST_METHODS = Object.freeze({
  [VISUAL_SOURCE_RENDERERS.COMPONENT]: "drawComponentReferenceSource",
  [VISUAL_SOURCE_RENDERERS.MEDIA]: "drawMediaSource",
  [VISUAL_SOURCE_RENDERERS.CAMERA]: "drawCameraSource",
  [VISUAL_SOURCE_RENDERERS.BLACK]: "drawBlackSource",
  [VISUAL_SOURCE_RENDERERS.GENERATOR]: "drawGeneratorSource",
});

export function compiledVisualSourceRenderer(operation = {}, source = {}) {
  if (operation.backend === "source-runtime") {
    const renderer = String(operation.renderer || operation.compilerHook?.renderer || "");
    if (renderer) return renderer;
  }
  return visualSourceRenderer(source);
}

export function compiledNativeSourceRenderer(operation = {}, source = {}, generatorComponent = null) {
  if (operation.backend === "native-specialized") {
    const renderer = String(operation.renderer || operation.compilerHook?.renderer || "");
    if (renderer) return renderer;
  }
  if (source.type !== "generator") return "";
  return String(generatorComponent?.nodeDefinition?.metadata?.nativeRenderer || "");
}

export class OutputRenderer {
  constructor({ mode, outputId = "", hud, font, sendMetrics, sendMapping, sendThumbnail, sendChainTransform, sendChainBoundary, sendSceneFrame, sendMediaRendition, requestMediaFiles, onSurfaceSelect, onChainItemSelect, onSceneFrameSelect }) {
    this.mode = mode;
    this.outputId = outputId;
    this.hud = hud;
    this.font = font || null;
    this.sendMetrics = sendMetrics;
    this.sendMapping = sendMapping;
    this.sendThumbnail = sendThumbnail;
    this.sendChainTransform = sendChainTransform;
    this.sendChainBoundary = sendChainBoundary;
    this.sendSceneFrame = sendSceneFrame;
    this.sendMediaRendition = sendMediaRendition;
    this.requestMediaFiles = requestMediaFiles;
    this.onSurfaceSelect = onSurfaceSelect;
    this.onChainItemSelect = onChainItemSelect;
    this.onSceneFrameSelect = onSceneFrameSelect;
    this.state = null;
    this.mapper = null;
    this.renderCache = new OutputRenderCache();
    this.componentSource = this.renderCache.sources;
    this.componentOutput = new Map();
    this.componentBuffer = this.renderCache.buffers;
    this.componentGpuBuffer = this.renderCache.gpuBuffers;
    this.stableComponentSignatures = new Map();
    this.chainNodeRuntimes = new Map();
    this.sourceNodeRuntimes = new Map();
    this.eyeballUniformFrames = new Map();
    this.eyeballUniformFrameUse = new Map();
    this.generatorUniformStates = new Map();
    this.generatorUniformStateUse = new Map();
    this.compiledNodeProcessContexts = new WeakMap();
    this.componentPatches = new Map();
    this.visualNodes = createProjectVisualNodeResolver();
    this.visualResolverOptions = Object.freeze({
      getEffectComponent: (id) => this.effectNodeComponent(id),
      getGeneratorComponent: (id) => this.generatorNodeComponent(id),
    });
    this.visualForkSignature = "";
    this.componentPrograms = new Map();
    this.componentRegionSafety = new WeakMap();
    this.componentVideoPresence = new WeakMap();
    this.mappingPrograms = new Map();
    this.outputProgram = null;
    this.mappingProgramCache = new WeakMap();
    this.componentById = new Map();
    this.routeSourceNodeById = new Map();
    this.liveParamFades = new Map();
    this.liveParamFadeRestores = [];
    this.mediaRuntime = new OutputMediaRuntime({
      getRenderSettings: () => this.state?.render || {},
      requestMediaFiles: (ids) => this.requestMediaFiles?.(ids),
      sendMediaRendition: (mediaId, width, height, blob, sourceRevision) => this.sendMediaRendition?.(mediaId, width, height, blob, sourceRevision),
      applyGraphicsFont: (target) => this.applyGraphicsFont(target),
    });
    this.media = this.mediaRuntime.media;
    this.thumbnailRuntime = new OutputThumbnailRuntime({
      getState: () => this.state,
      getComponentOutput: (componentId) => this.componentOutput.get(componentId),
      canCapture: () => this.mode === "component",
      shouldUseThumbnailPreview: () => this.shouldUseThumbnailPreview(),
      isComponentReady: (component) => !this.componentHasPendingAssets(component),
      sendThumbnail: (...args) => this.sendThumbnail?.(...args),
    });
    // Specialized 3D sources render sequentially and are copied into the
    // component target immediately. Terrain uses a framebuffer in the main
    // WebGL context so resizing its scratch target cannot invalidate p5's
    // cross-context canvas texture cache. Model rendering still falls back to
    // its dedicated p5.Graphics context because it uses p5's 3D drawing API.
    this.sourcePg = null;
    this.fxTargets = [null, null];
    this.fxTargetKey = "";
    this.fxTargetGroups = new Map();
    this.isfPassTargets = new Map();
    this.mainMix = null;
    this.surfaceRuntime = new OutputSurfaceRuntime(this);
    this.previewInteraction = new ComponentPreviewInteraction(this);
    this.mapperSurfaces = new Map();
    this.mappingSignature = "";
    this.localMappingSignature = "";
    this.pendingMappingSignature = "";
    this.pendingMappingStartedAt = 0;
    this.mappingAckWarningSignature = "";
    this.surfaceRebuildPending = false;
    this.lastMetricsAt = 0;
    this.smoothedFrameMs = 0;
    this.smoothedFps = 0;
    this.smoothedRenderCost = 0;
    this.smoothedGpuMs = 0;
    this.lastGpuSampleId = -1;
    this.presentedRenderResolution = null;
    this.gpuTimer = new GpuTimerTracker();
    this.specializedSources = new SpecializedSourceRuntime({
      media: () => this.media,
      acquireMedia: (id, options) => this.acquireMedia(id, options),
      requestMissingMedia: (id) => this.requestMissingMedia(id),
      requestMissingMediaBatch: (ids) => this.requestMissingMediaBatch(ids),
      applyGraphicsPixelDensity: (target, density) => this.applyGraphicsPixelDensity(target, density),
      measureGpu: (target, draw) => this.measureGpu(target, draw),
      gpuTimer: this.gpuTimer,
      frameIndex: () => this.frameIndex,
      showDiagnostics: () => this.state?.ui?.debugPreview !== false,
    });
    this.lastPixelDensity = 0;
    this.frameStart = 0;
    this.profileRuntime = new OutputRenderProfile();
    this.lastTickMs = 0;
    this.frameDeltaSeconds = 0;
    this.visualDeltaSeconds = 0;
    this.visualTime = 0;
    this.rawElapsedTime = 0;
    this.presentationClock = createPresentationClock();
    this.frameIndex = 0;
    this.isfDateUniform = [0, 0, 0, 0];
    this.outputMediaStatus = createMediaReadinessStatus();
    this.scheduledEvents = [];
    this.manualScheduler = createManualScheduler();
    this.componentTimes = new Map();
    this.cachedNoiseTexture = null;
    this.overlayBlendShader = null;
    this.layerTransformShader = null;
    this.componentPipelineShaders = new Map();
    this.shaderBuilder = createShaderBuilder({
      getCustomCode: () => this.state?.shaders?.customCode || "",
      getComponent: (id) => this.effectNodeComponent(id),
      onStatus: (status, error) => {
        this.state.ui.shaderStatus = status;
        this.state.ui.shaderError = error || "";
      },
    });
  }

  async setup(initialState, { normalized = false } = {}) {
    this.state = normalized ? initialState : sanitizeState(initialState || {});
    this.rebuildVisualNodeResolver();
    this.rebuildComponentPrograms();
    this.rebuildMappingPrograms();
    this.rebuildRouteLookups();
    if (this.shouldUseThumbnailPreview()) this.captureThumbnailEditTransformBaselines();
    this.applyPixelDensity();
    this.applyGlobalFont();
    this.createBuffers();
    this.createMapper();
    this.setCalibrate(this.shouldCalibrateFromState());
  }

  dispose() {
    this.previewInteraction.dispose();
    this.thumbnailRuntime.dispose();
    this.gpuTimer?.dispose?.();
    this.disposeBuffers();
    this.mapperSurfaces?.clear?.();
    this.mapper?.surfaces?.splice?.(0);
    this.mediaRuntime.dispose();
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
    this.surfaceRuntime.applyFont((target) => this.applyGraphicsFont(target));
    for (const group of this.fxTargetGroups?.values?.() || []) {
      for (const target of group.targets || []) this.applyGraphicsFont(target);
    }
    for (const pg of this.componentSource?.values?.() || []) this.applyGraphicsFont(pg);
    for (const pg of this.componentOutput?.values?.() || []) this.applyGraphicsFont(pg);
    for (const pg of this.componentBuffer?.values?.() || []) this.applyGraphicsFont(pg);
  }

  createBuffers() {
    // Window resizing must not destroy and recreate the dedicated model
    // WebGL context on every event. Specialized targets resize in place on
    // their next use; only a final renderer disposal owns their destruction.
    this.disposeBuffers({ preserveSpecialized: true });
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

  disposeBuffers({ preserveSpecialized = false } = {}) {
    if (!preserveSpecialized) this.specializedSources.dispose();
    disposeGraphics(this.sourcePg);
    disposeGraphics(this.mainMix);
    this.surfaceRuntime.dispose();
    this.disposeFxTargetGroups();
    this.disposeIsfPassTargets();
    // Render-cycle aliases; componentGpuBuffer owns these targets.
    this.componentOutput.clear();
    this.renderCache.dispose();
    this.stableComponentSignatures?.clear?.();
    this.chainNodeRuntimes?.clear?.();
    this.sourceNodeRuntimes?.clear?.();
    this.eyeballUniformFrames?.clear?.();
    this.eyeballUniformFrameUse?.clear?.();
    this.generatorUniformStates?.clear?.();
    this.generatorUniformStateUse?.clear?.();
    this.sourcePg = null;
    this.mainMix = null;
    this.fxTargets = [null, null];
    this.fxTargetKey = "";
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
    this.specializedSources.resetTerrainResources();
  }

  resetModelResources(gl = null) {
    this.specializedSources.resetModelResources(gl);
  }

  get specializedWebglTargets() {
    return this.specializedSources.targets;
  }

  get superPointPairs() {
    return this.specializedSources.superPointPairs;
  }

  set superPointPairs(service) {
    this.specializedSources.superPointPairs = service;
  }

  get mobileNetMorphPairs() {
    return this.specializedSources.mobileNetMorphPairs;
  }

  set mobileNetMorphPairs(service) {
    this.specializedSources.mobileNetMorphPairs = service;
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

  disposeIsfPassTargets() {
    const seen = new Set();
    for (const entry of this.isfPassTargets?.values?.() || []) {
      for (const target of entry.targets || []) {
        if (!target || seen.has(target)) continue;
        seen.add(target);
        disposeGraphics(target);
      }
    }
    this.isfPassTargets?.clear?.();
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
    this.rebuildSurfaces();
    this.applyProjectMapping();
  }

  rebuildSurfaces({ preferExistingMapping = false } = {}) {
    if (!this.mapper) return;
    const existingCorners = new Map((this.mapper.surfaces || []).map((surface) => [
      surface.id || surface.name,
      Array.isArray(surface.corners)
        ? surface.corners.map((corner) => ({ x: corner.x, y: corner.y }))
        : null,
    ]));
    this.mapper.clearSurfaces();
    this.mapperSurfaces.clear();
    const mappedSurfaces = this.state.surfaces.filter((surface) => surface.destination?.type !== "direct");
    const projectRender = this.mappingProjectRender();
    const defaultMappingById = new Map(defaultProjectSurfaceMapping(projectRender, mappedSurfaces).map((surface) => [
      surface.id || surface.name,
      surface,
    ]));
    const texture = componentTextureSize(this.state.render);
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
    mappedSurfaces.forEach((surface) => {
      const preserved = existingCorners.get(surface.id);
      const persisted = this.projectMappingSurfaceCorners(surface.id);
      const fallback = defaultMappingById.get(surface.id)?.corners;
      const existingProjectCorners = preserved?.length === 4
        ? (this.mode === "output" ? preserved.map((corner) => this.displayPointToWorld(corner)) : preserved)
        : null;
      const projectCorners = preferExistingMapping && existingProjectCorners?.length === 4
        ? existingProjectCorners
        : persisted?.length === 4
          ? persisted
          : existingProjectCorners?.length === 4
            ? existingProjectCorners
            : fallback;
      if (!Array.isArray(projectCorners) || projectCorners.length !== 4) return;
      const corners = projectCorners.map((corner) => this.worldPointToDisplay(corner));
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
    const rect = outputSpanRect(this.mappingProjectRender(), surface.destination?.outputIds || []);
    if (!rect) return null;
    const topLeft = this.worldPointToDisplay({ x: rect.x, y: rect.y });
    const bottomRight = this.worldPointToDisplay({ x: rect.x + rect.width, y: rect.y + rect.height });
    const x = topLeft.x;
    const y = topLeft.y;
    const widthPx = bottomRight.x - topLeft.x;
    const heightPx = bottomRight.y - topLeft.y;
    return rectToCorners({ x, y, width: widthPx, height: heightPx });
  }

  projectMappingSurfaceCorners(surfaceId = "") {
    const surface = this.state?.mappingCalibration?.surfaces?.find((item) =>
      String(item?.id || item?.name || "") === String(surfaceId)
    );
    const world = worldSize(this.mappingProjectRender());
    const relative = this.state?.mappingCalibration?.coordinateSpace === "relative";
    return Array.isArray(surface?.corners) && surface.corners.length === 4
      ? surface.corners.map((corner) => ({
          x: (Number(corner.x) || 0) * (relative ? world.width : 1),
          y: (Number(corner.y) || 0) * (relative ? world.height : 1),
        }))
      : null;
  }

  worldPointToDisplay(point = {}) {
    const x = Number(point.x) || 0;
    const y = Number(point.y) || 0;
    // Only a standalone Output window converts the shared project world into
    // a presentation cover. Embedded Live is an editor preview like Scene:
    // its p5 canvas fills the host, while the authored Output frame retains
    // its own aspect and margin inside that world.
    if (this.mode !== "output") return { x, y };
    const offset = this.outputFrameOffset();
    const transform = this.outputFrameTransform();
    return {
      x: (x - offset.x) * transform.scale + transform.x,
      y: (y - offset.y) * transform.scale + transform.y,
    };
  }

  displayPointToWorld(point = {}) {
    const x = Number(point.x) || 0;
    const y = Number(point.y) || 0;
    if (this.mode !== "output") return { x, y };
    const offset = this.outputFrameOffset();
    const transform = this.outputFrameTransform();
    return {
      x: (x - transform.x) / Math.max(0.0001, transform.scale) + offset.x,
      y: (y - transform.y) / Math.max(0.0001, transform.scale) + offset.y,
    };
  }

  setState(nextState, { normalized = false } = {}) {
    const wasThumbnailPreview = this.shouldUseThumbnailPreview();
    const previousCameraSignature = cameraSettingsSignature(this.state?.render);
    const previousSurfaceIds = (this.state?.surfaces || []).map((surface) => surface.id).join(",");
    const previousSize = this.state ? this.renderSizeSignature(this.state.render) : "";
    const previousMappingSignature = this.mappingSignature;
    const mappingInteractionActive = !!this.mapper?.isActive?.();
    const preparedState = normalized ? nextState : sanitizeState(nextState);
    this.clearLiveParamFades();
    this.state = this.previewInteraction?.reconcileIncomingState(preparedState) || preparedState;
    this.componentVideoPresence = new WeakMap();
    this.pruneComponentTimes();
    this.rebuildVisualNodeResolver();
    this.rebuildComponentPrograms();
    this.rebuildMappingPrograms();
    this.rebuildRouteLookups();
    const nextCameraSignature = cameraSettingsSignature(this.state.render);
    if (previousCameraSignature && previousCameraSignature !== nextCameraSignature) this.releaseCameraInput();
    const isThumbnailPreview = this.shouldUseThumbnailPreview();
    if (isThumbnailPreview && !wasThumbnailPreview) this.captureThumbnailEditTransformBaselines();
    if (!isThumbnailPreview && wasThumbnailPreview) this.thumbnailEditTransformBaselines.clear();
    const nextSurfaceIds = this.state.surfaces.map((surface) => surface.id).join(",");
    const nextSize = this.renderSizeSignature(this.state.render);
    const nextMappingSignature = this.currentMappingSignature();
    // A mapping echo is an acknowledgement even while the pointer gesture is
    // still active. Applying project geometry remains deferred during the
    // gesture, but ownership must be released now: mouseReleased emits its
    // final state before VjMapper clears its active-drag marker.
    if (this.pendingMappingSignature && nextMappingSignature === this.pendingMappingSignature) {
      this.shouldIgnoreIncomingMapping(nextMappingSignature);
    }
    if (previousSize && previousSize !== nextSize) {
      this.createBuffers();
    }
    const surfacesChanged = previousSurfaceIds !== nextSurfaceIds || previousSize !== nextSize;
    if (surfacesChanged) {
      if (mappingInteractionActive) this.surfaceRebuildPending = true;
      else {
        this.surfaceRebuildPending = false;
        this.rebuildSurfaces({ preferExistingMapping: !!this.pendingMappingSignature });
      }
    }
    const ignoreIncomingMapping = !mappingInteractionActive && this.pendingMappingSignature
      ? this.shouldIgnoreIncomingMapping(nextMappingSignature)
      : false;
    if (
      (surfacesChanged || previousMappingSignature !== nextMappingSignature) &&
      !mappingInteractionActive &&
      !ignoreIncomingMapping
    ) {
      this.applyProjectMapping(nextMappingSignature);
    }
    this.setCalibrate(this.shouldCalibrateFromState());
    this.syncMapperOverlayMode();
    this.thumbnailRuntime.invalidateSelectedComponent();
  }

  applyLivePatches(patches = [], nowMs = performance.now()) {
    const durationMs = Math.max(0, Number(this.state?.ui?.live?.paramFadeDuration) || 0) * 1000;
    return this.applyRenderPatches(patches, nowMs, durationMs);
  }

  applyRenderPatches(patches = [], nowMs = performance.now(), durationMs = 0) {
    const resolution = resolveLiveRenderPatches(this.state, patches);
    if (!resolution.applied) return resolution;
    if (resolution.statePaths.length) {
      // State-root patches update their narrowly owned renderer subsystem.
      // Rebuilding Component programs, media presence, caches, and route
      // lookups for every Mapping corner sample caused the output queue that
      // this patch protocol exists to avoid.
      const nextState = { ...this.state };
      const result = applyLiveRenderPatches(nextState, patches);
      if (!result.applied) return result;
      this.state = nextState;
      if (result.statePaths.includes("mappingCalibration")) {
        const signature = this.currentMappingSignature();
        const mappingInteractionActive = !!this.mapper?.isActive?.();
        const ignoreIncomingMapping = !mappingInteractionActive && this.pendingMappingSignature
          ? this.shouldIgnoreIncomingMapping(signature)
          : false;
        if (!mappingInteractionActive && !ignoreIncomingMapping) this.applyProjectMapping(signature);
      }
      return result;
    }
    durationMs = Math.max(0, Number(durationMs) || 0);
    const candidates = resolution.destinations.map((destination) => {
      const key = `${destination.componentId}:${destination.path}`;
      const active = this.liveParamFades.get(key);
      const from = active
        ? interpolatedLiveRenderValue(active.from, active.to, active.startedAtMs, active.durationMs, nowMs)
        : destination.target[destination.leaf];
      return { destination, key, active, from };
    });
    const result = applyLiveRenderPatches(this.state, patches);
    if (!result.applied) return result;
    for (const candidate of candidates) {
      const { destination, key, active, from } = candidate;
      const to = destination.value;
      const canFade = durationMs > 0 &&
        isInterpolableLiveRenderPath(destination.path) &&
        Number.isFinite(from) &&
        Number.isFinite(to);
      if (!canFade || Object.is(from, to)) {
        if (durationMs <= 0 || !active || !Object.is(active.to, to)) this.liveParamFades.delete(key);
        continue;
      }
      // The final change event repeats the last scrub target. Preserve the
      // running clock rather than restarting the same fade on pointer release.
      if (active && Object.is(active.to, to)) continue;
      this.liveParamFades.set(key, {
        target: destination.target,
        leaf: destination.leaf,
        from,
        to,
        startedAtMs: Number(nowMs) || 0,
        durationMs,
      });
    }
    for (const componentId of result.componentIds) this.refreshComponentLookup(componentId);
    if (result.componentIds.length) this.thumbnailRuntime.invalidateSelectedComponent();
    return result;
  }

  applyLiveParamFadeFrame(nowMs = performance.now()) {
    this.liveParamFadeRestores.length = 0;
    for (const [key, fade] of this.liveParamFades) {
      if (!Object.is(fade.target[fade.leaf], fade.to)) {
        this.liveParamFades.delete(key);
        continue;
      }
      if (Number(nowMs) >= fade.startedAtMs + fade.durationMs) {
        this.liveParamFades.delete(key);
        continue;
      }
      const value = interpolatedLiveRenderValue(fade.from, fade.to, fade.startedAtMs, fade.durationMs, nowMs);
      this.liveParamFadeRestores.push(fade);
      fade.target[fade.leaf] = value;
    }
  }

  restoreLiveParamFadeFrame() {
    for (const fade of this.liveParamFadeRestores) fade.target[fade.leaf] = fade.to;
    this.liveParamFadeRestores.length = 0;
  }

  clearLiveParamFades() {
    this.restoreLiveParamFadeFrame();
    this.liveParamFades.clear();
  }

  rebuildComponentPrograms() {
    this.componentPrograms = compileComponentRenderPrograms(
      this.state?.components || [],
      this.state?.nodes?.groups || [],
      { resolveNodeDefinition: (node) => this.visualNodes.definition(node.nodeId) }
    );
  }

  rebuildVisualNodeResolver() {
    const signature = JSON.stringify({
      forks: (this.state?.nodes?.forks || []).map((fork) => [
        fork?.id, fork?.active !== false, fork?.base?.id, fork?.base?.version, fork?.definition,
      ]),
      projectDefinitions: (this.state?.nodes?.definitions || [])
        .filter((definition) => definition?.metadata?.isf?.format === "isf@2")
        .map((definition) => [
        definition?.id,
        definition?.version,
        definition?.metadata?.isf?.sourceHash || "",
        ]),
    });
    if (signature === this.visualForkSignature) return;
    this.visualForkSignature = signature;
    this.visualNodes = createProjectVisualNodeResolver(this.state || {});
    this.componentRegionSafety = new WeakMap();
    this.disposeIsfPassTargets();
    // Shader objects are context-bound and keyed by source. Clear only when
    // project node code changes, never during ordinary frames or parameter
    // scrubs.
    this.shaderBuilder?.clear?.();
  }

  effectNodeComponent(id) {
    return this.visualNodes.effect(id);
  }

  generatorNodeComponent(id) {
    return this.visualNodes.generator(id);
  }

  generatorShaderComponent(id) {
    return this.visualNodes.generatorShader(id);
  }

  rebuildMappingPrograms() {
    const groups = this.state?.nodes?.groups || [];
    this.mappingPrograms = compileMappingRenderPrograms(this.state || {}, groups);
    this.outputProgram = compileOutputRenderProgram(groups);
    if (this.state && typeof this.state === "object") {
      this.mappingProgramCache.set(this.state, {
        mappings: this.mappingPrograms,
        output: this.outputProgram,
      });
    }
  }

  mappingProgramSurfaces(state = this.state) {
    if (!state || typeof state !== "object") return [];
    if (state === this.state) {
      return activeMappingProgramSurfaces(state, this.mappingPrograms, this.outputProgram);
    }
    let compiled = this.mappingProgramCache.get(state);
    if (!compiled) {
      const groups = state.nodes?.groups || [];
      compiled = {
        mappings: compileMappingRenderPrograms(state, groups),
        output: compileOutputRenderProgram(groups),
      };
      this.mappingProgramCache.set(state, compiled);
    }
    return activeMappingProgramSurfaces(state, compiled.mappings, compiled.output);
  }

  componentProgramChain(component = {}) {
    const program = this.componentPrograms.get(component.id);
    if (!program) throw new Error(`VJ1_COMPONENT_PROGRAM_MISSING:${component.id || "unknown"}`);
    return program.chain;
  }

  rebuildRouteLookups() {
    const components = this.state?.components || [];
    // System Components are intentionally absent from user-facing catalogs,
    // but their routes are still executable. Mapping's test-pattern preview
    // is one such route, so the renderer index must include it.
    const sourceNodes = sceneSourceNodes(this.state || {}, { includeSystem: true });
    this.componentById = new Map(components.map((component) => [component.id, component]));
    this.routeSourceNodeById = new Map(sourceNodes.map((node) => [node.id, node]));
  }

  refreshComponentLookup(componentId) {
    const component = this.state?.components?.find((item) => item.id === componentId);
    if (component) this.componentById.set(componentId, component);
    else this.componentById.delete(componentId);
  }

  resolveRouteSourceNode(surface = {}) {
    return this.routeSourceNodeById.get(surface.sourceNodeId) || null;
  }

  renderSizeSignature(render = {}) {
    const frame = this.outputFrameSize(render);
    const world = worldSize(render);
    const texture = componentTextureSize(render);
    const density = this.renderPixelDensity(render);
    const outputs = outputFrames(render).map((output) => `${output.id}:${output.width}x${output.height}@${output.x},${output.y}`).join("|");
    return `${this.outputId}:${frame.width}x${frame.height}:${outputs}:${world.width}x${world.height}:ct${texture.width}x${texture.height}:ceiling${render.resolutionCeiling || "auto"}:pd${density}`;
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
    const demandScale = Math.max(0.125, Math.min(8, Number(render.previewRasterScale) || 1));
    return Math.max(0.125, Math.min(2, configured * demandScale));
  }

  renderResolutionSize(render = this.state?.render || {}) {
    if (this.mode !== "output" && this.presentedRenderResolution) {
      return { ...this.presentedRenderResolution };
    }
    const frame = this.displayCanvasSize(render);
    const estimatedDensity = this.renderPixelDensity(render);
    const context = typeof drawingContext !== "undefined" ? drawingContext : null;
    const actualWidth = Math.round(Number(context?.drawingBufferWidth) || 0);
    const actualHeight = Math.round(Number(context?.drawingBufferHeight) || 0);
    const widthPx = actualWidth > 0 ? actualWidth : Math.round(frame.width * estimatedDensity);
    const heightPx = actualHeight > 0 ? actualHeight : Math.round(frame.height * estimatedDensity);
    const density = Math.max(0.125, Math.min(4, Math.min(widthPx / frame.width, heightPx / frame.height)));
    return {
      width: Math.max(1, widthPx),
      height: Math.max(1, heightPx),
      density,
    };
  }

  renderResolutionLabel(render = this.state?.render || {}) {
    const size = this.renderResolutionSize(render);
    const densityLabel = size.density === 1 ? "" : ` @${formatDensity(size.density)}x`;
    return `${size.width}x${size.height}${densityLabel}`;
  }

  previewViewportZoomLabel(render = this.state?.render || {}) {
    const zoom = Math.max(0.1, Math.min(6, Number(render.previewViewportZoom) || 1));
    return `${zoom.toFixed(2)}x view`;
  }

  previewViewportTransform(render = this.state?.render || {}) {
    if (this.mode === "output") return { zoom: 1, x: 0, y: 0 };
    const userZoom = Math.max(0.1, Math.min(6, Number(render.previewViewportZoom) || 1));
    const userX = Number(render.previewViewportX) || 0;
    const userY = Number(render.previewViewportY) || 0;
    // Component/Scene editing already uses the fixed p5 canvas as its logical
    // world. Mapping and Live instead own an aspect-stable project world that
    // must first be contained in that canvas, then receive the same user zoom.
    if (this.mode === "component") return { zoom: userZoom, x: userX, y: userY };
    const host = this.displayCanvasSize(render);
    const project = worldSize(this.mappingProjectRender());
    const baseScale = Math.min(
      host.width / Math.max(1, project.width),
      host.height / Math.max(1, project.height)
    );
    const zoom = Math.max(0.01, baseScale * userZoom);
    return {
      zoom,
      x: userX + (host.width * 0.5 - project.width * 0.5) * zoom,
      y: userY + (host.height * 0.5 - project.height * 0.5) * zoom,
    };
  }

  withPreviewViewportTransform(draw) {
    if (typeof draw !== "function") return undefined;
    const viewport = this.previewViewportTransform();
    if (this.mode === "output" || (viewport.zoom === 1 && viewport.x === 0 && viewport.y === 0)) return draw();
    push();
    try {
      translate(viewport.x, viewport.y);
      scale(viewport.zoom);
      return draw();
    } finally {
      pop();
    }
  }

  previewDisplayPointToWorld(point = {}) {
    const viewport = this.previewViewportTransform();
    const centerX = this.displayCanvasSize().width * 0.5;
    const centerY = this.displayCanvasSize().height * 0.5;
    return {
      x: ((Number(point.x) || 0) - centerX - viewport.x) / viewport.zoom + centerX,
      y: ((Number(point.y) || 0) - centerY - viewport.y) / viewport.zoom + centerY,
    };
  }

  previewDiagnosticHudMarkup(fps, render = this.state?.render || {}) {
    const logical = this.displayCanvasSize(render);
    const context = typeof drawingContext !== "undefined" ? drawingContext : null;
    const backingWidth = Math.max(1, Math.round(Number(context?.drawingBufferWidth) || logical.width));
    const backingHeight = Math.max(1, Math.round(Number(context?.drawingBufferHeight) || logical.height));
    const browserWidth = Math.max(1, Math.round(Number(globalThis.window?.innerWidth) || logical.width));
    const browserHeight = Math.max(1, Math.round(Number(globalThis.window?.innerHeight) || logical.height));
    const p5WindowWidth = Math.max(1, Math.round(Number(globalThis.windowWidth) || browserWidth));
    const p5WindowHeight = Math.max(1, Math.round(Number(globalThis.windowHeight) || browserHeight));
    const hostWidth = Math.max(1, Math.round(Number(render.hostViewport?.width) || logical.width));
    const hostHeight = Math.max(1, Math.round(Number(render.hostViewport?.height) || logical.height));
    const configuredDensity = Math.max(0.5, Math.min(2, Number(render.pixelDensity) || 1));
    const previewScale = Math.max(0.125, Math.min(8, Number(render.previewRasterScale) || 1));
    const effectiveDensity = this.renderPixelDensity(render);
    let actualP5Density = Number(this.lastPixelDensity) || effectiveDensity;
    if (typeof pixelDensity === "function") {
      try {
        actualP5Density = Number(pixelDensity()) || actualP5Density;
      } catch (_error) {
        // The diagnostic overlay must never interfere with rendering if p5 is
        // between canvas allocations during a resize.
      }
    }
    return [
      `<span>${Math.round(this.smoothedFps || fps)} fps</span><span class="output-resolution">render ${this.renderResolutionLabel(render)}</span><span>${this.previewViewportZoomLabel(render)}</span><span>pan ${Number(render.previewViewportX) || 0},${Number(render.previewViewportY) || 0}</span>`,
      `<span>p5 canvas ${logical.width}x${logical.height}</span><span>backing ${backingWidth}x${backingHeight}</span>`,
      `<span>windowWidth ${p5WindowWidth}</span><span>windowHeight ${p5WindowHeight}</span><span>browser ${browserWidth}x${browserHeight}</span><span>host ${hostWidth}x${hostHeight}</span>`,
      `<span>density param ${formatDensity(configuredDensity)}x</span><span>preview scale ${formatDensity(previewScale)}x</span><span>effective ${formatDensity(effectiveDensity)}x</span><span>p5 ${formatDensity(actualP5Density)}x</span>`,
    ].map((line) => `<span class="preview-debug-line">${line}</span>`).join("");
  }

  recordPresentedRenderRequest(request = {}) {
    const width = Math.max(1, Math.round(Number(request?.width) || 1));
    const height = Math.max(1, Math.round(Number(request?.height) || 1));
    const current = this.presentedRenderResolution;
    if (current && current.width * current.height >= width * height) return;
    this.presentedRenderResolution = {
      width,
      height,
      density: this.renderPixelDensity(this.state?.render || {}),
    };
  }

  syncMapperOverlayMode() {
    this.mapper?.setOverlayMode?.(this.state?.global?.mappingHandleMode || "always");
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
      return JSON.stringify(this.state?.mappingCalibration || null);
    } catch (error) {
      console.warn("[VJ1_MAPPING_SIGNATURE_FAILED]", { fallback: "mapping acknowledgement disabled for invalid state", message: error?.message || String(error) });
      return "";
    }
  }

  applyProjectMapping(signature = this.currentMappingSignature()) {
    const mapping = this.state?.mappingCalibration;
    if (mapping?.surfaces?.length) {
      this.mapper?.importConfig?.(this.mappingForRenderMode(mapping), { replace: false, silent: true });
    }
    this.mappingSignature = signature;
  }

  mappingForRenderMode(mapping) {
    const projectRender = this.mappingProjectRender();
    const world = worldSize(projectRender);
    const worldMapping = mapping?.coordinateSpace === "relative"
      ? mapMappingCorners(mapping, (corner) => ({
          x: (Number(corner.x) || 0) * world.width,
          y: (Number(corner.y) || 0) * world.height,
        }))
      : mapping;
    if (this.mode !== "output") return worldMapping;
    return mapMappingCorners(worldMapping, (corner) => this.worldPointToDisplay(corner));
  }

  outputFrameTransform() {
    const presentationMode = this.mode === "output";
    const projectFrame = presentationMode
      ? outputFrameForId(this.mappingProjectRender(), this.outputId)
      : this.outputFrameSize(this.state?.render || {});
    const outputFrame = this.displayCanvasSize(this.state?.render || {});
    // One uniform cover transform is the presentation authority for direct
    // output and every mapped surface. The popup may have different
    // proportions from its configured Output; crop the excess axis instead
    // of letterboxing, while keeping every projected layer locked together.
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
    const worldMapping = this.mode === "output"
      ? mapMappingCorners(mapping, (corner) => this.displayPointToWorld(corner))
      : mapping;
    const projectRender = this.mappingProjectRender();
    const world = worldSize(projectRender);
    const normalized = mapMappingCorners(worldMapping, (corner) => ({
      x: (Number(corner.x) || 0) / Math.max(1, world.width),
      y: (Number(corner.y) || 0) / Math.max(1, world.height),
    }));
    return {
      ...normalized,
      coordinateSpace: "relative",
      surfaces: (normalized?.surfaces || []).map((surface) => {
        const { w: _w, h: _h, ...persisted } = surface || {};
        return persisted;
      }),
    };
  }

  outputFrameOffset() {
    if (this.mode === "output") {
      const frame = outputFrameForId(this.mappingProjectRender(), this.outputId);
      return { x: frame?.x || 0, y: frame?.y || 0 };
    }
    return outputFrameOffset(this.state?.render || {});
  }

  mappingProjectRender() {
    return mappingWorldRender(this.state?.render || {});
  }

  markLocalMapping(mapping = this.mappingFromRenderMode(this.mapper?.exportData?.())) {
    this.localMappingSignature = mappingSignature(mapping);
    this.pendingMappingSignature = this.localMappingSignature;
    this.pendingMappingStartedAt = performance.now();
    this.mappingAckWarningSignature = "";
    this.mappingSignature = this.localMappingSignature;
  }

  shouldIgnoreIncomingMapping(signature) {
    if (!this.pendingMappingSignature) return false;
    if (signature === this.pendingMappingSignature) {
      this.pendingMappingSignature = "";
      this.pendingMappingStartedAt = 0;
      this.mappingAckWarningSignature = "";
      return false;
    }
    if (performance.now() - this.pendingMappingStartedAt < 5000) return true;
    if (this.mappingAckWarningSignature !== this.pendingMappingSignature) {
      this.mappingAckWarningSignature = this.pendingMappingSignature;
      console.warn("[VJ1_MAPPING_ACK_TIMEOUT]", {
        pendingSignature: this.pendingMappingSignature,
        incomingSignature: signature,
        message: "Local surface mapping was not acknowledged within 5 seconds; accepting the latest project mapping",
      });
    }
    this.pendingMappingSignature = "";
    this.pendingMappingStartedAt = 0;
    return false;
  }

  importFiles(files) {
    this.mediaRuntime.importFiles(files);
  }

  acquireMedia(mediaId, options = {}) {
    const frame = frameSize(this.state?.render || {});
    return this.mediaRuntime.acquireMedia(this.media.get(mediaId), {
      ...options,
      width: Math.max(1, Number(options.width) || frame.width),
    });
  }

  emitMapping(mapping = this.mapper?.exportData?.(), status = "Mapping updated", meta = {}) {
    const projectMapping = this.mappingFromRenderMode(mapping || {});
    this.markLocalMapping(projectMapping);
    this.sendMapping?.("local", projectMapping, status, meta);
  }

  importMediaRenditions(item, renditions) {
    this.mediaRuntime.importRenditions(item, renditions);
  }

  acquireCameraInput() {
    return this.mediaRuntime.acquireCameraInput();
  }

  acquireScreenInput(inputId = "") {
    return this.mediaRuntime.acquireScreenInput(inputId);
  }

  releaseCameraInput() {
    this.mediaRuntime.releaseCameraInput();
  }

  get cameraCapture() {
    return this.mediaRuntime.cameraCapture;
  }

  get cameraError() {
    return this.mediaRuntime.cameraError;
  }

  screenError(inputId = "") {
    return this.mediaRuntime.screenError(inputId);
  }

  draw() {
    if (!this.state) return;
    this.mediaRuntime.beginFrame();
    this.applyLiveParamFadeFrame();
    try {
      return this.drawFrame();
    } finally {
      this.restoreLiveParamFadeFrame();
      this.mediaRuntime.endFrame();
    }
  }

  drawFrame() {
    this.gpuTimer.poll(this.frameIndex);
    this.frameStart = performance.now();
    this.frameIndex++;
    // Detailed pass attribution is diagnostic sampling, not render work. Six
    // frames provide 10 Hz detail at 60 fps while the full-frame CPU clock and
    // GPU query tracker continue to update normally.
    this.profileRuntime.beginFrame(this.frameIndex);
    this.tickClock(this.frameStart);
    this.outputMediaStatus = this.outputMediaReadiness();
    if (this.shouldHoldOutputFrameForMedia()) {
      // Keep the last completely rendered frame on the presentation canvas.
      // This needs no extra framebuffer and prevents a loading video from
      // flashing Output black between decoder readiness notifications.
      this.pruneRenderCaches();
      this.gpuTimer.sealFrame(this.frameIndex);
      this.finishFrameProfile();
      this.updateHudAndMetrics();
      return;
    }
    this.presentedRenderResolution = null;
    this.scheduledEvents = this.state.scheduler?.manualLane === false
      ? []
      : this.manualScheduler.drain({ frame: this.frameIndex, time: this.visualTime });
    background(0);
    if (this.shouldUseThumbnailPreview()) this.renderThumbnailComponents();
    else this.renderComponents();
    if (this.mode === "component") {
      this.measureGpu(drawingContext, () => this.withPreviewViewportTransform(() => this.renderComponentPreview()));
      this.pruneRenderCaches();
      this.gpuTimer.sealFrame(this.frameIndex);
      this.finishFrameProfile();
      this.updateHudAndMetrics();
      return;
    }
    this.withPreviewViewportTransform(() => {
      this.renderSurfaces();
      this.measureGpu(drawingContext, () => {
        const outputBlackout = this.isOutputBlackout();
        const restoreCalibrate = outputBlackout && this.mapper?.isCalibrating?.();
        if (restoreCalibrate) this.mapper.setCalibrate(false);
        const pointer = this.previewDisplayPointToWorld({ x: globalThis.mouseX, y: globalThis.mouseY });
        this.mapper.drawOverlays(pointer.x, pointer.y);
        this.renderMappingFrameOverlay();
        this.renderSelectedSurfaceOverlay();
        if (restoreCalibrate) this.mapper.setCalibrate(true);
      });
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
    const playing = this.isPlaybackActive();
    this.presentationClock = advancePresentationClock(
      this.presentationClock,
      dt,
      renderPresentationFrameRate(this.state?.render, {
        mode: this.mode,
        thumbnailPreview: this.shouldUseThumbnailPreview(),
        outputWindowOpen: this.state?.ui?.outputWindowOpen === true,
      }),
      playing
    );
    this.rawElapsedTime = this.presentationClock.rawElapsedSeconds;
    const timeScale = globalVisualTimeScale(this.state?.global);
    this.visualDeltaSeconds = this.presentationClock.presentationDeltaSeconds * timeScale;
    if (!playing) return;
    this.visualTime += this.visualDeltaSeconds;
    for (const component of this.state.components || []) {
      const speed = Math.max(0, Number(component.speed) || 0);
      this.componentTimes.set(component.id, (this.componentTimes.get(component.id) || 0) + this.visualDeltaSeconds * speed);
    }
  }

  pruneComponentTimes() {
    if (!this.componentTimes.size) return;
    const liveComponentIds = new Set((this.state?.components || []).map((component) => component.id));
    for (const id of this.componentTimes.keys()) {
      if (!liveComponentIds.has(id)) this.componentTimes.delete(id);
    }
  }

  isPlaybackActive() {
    // Playback is an output transport command. The editor preview remains a
    // live monitor even while connected output windows are intentionally held.
    return this.mode !== "output" || this.state?.global?.playing !== false;
  }

  renderSelectedSurfaceOverlay() {
    if (this.mode === "output") return;
    const workspace = this.state?.ui?.workspace;
    const mappingSelection = workspace === "mapping";
    const liveSelection = workspace === "live";
    if (!mappingSelection && !liveSelection) return;
    const surfaceId = this.state?.ui?.selectedSurfaceId;
    if (!surfaceId) return;
    const calibrating = !!this.mapper?.isCalibrating?.();
    const revealHandles = mappingSelection && calibrating && (
      this.state?.global?.mappingHandleMode !== "near" || this.shouldRevealSurfaceOverlay(surfaceId)
    );
    const mapped = this.mapperSurfaces.get(surfaceId);
    // Direct routes are not editable Mapping geometry, but in Live they are
    // still selectable projection destinations and need the same navigation
    // outline as authored Surfaces. Never expose calibration handles there.
    if (mapped?.direct && !liveSelection) return;
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

  renderMappingFrameOverlay() {
    if (this.mode !== "preview" || this.state?.ui?.workspace !== "mapping") return;
    // The guide is authored geometry, so it must use the same canonical world
    // as Surface corners. The surrounding p5 transform presents both together.
    const frames = outputFrames(this.mappingProjectRender());
    if (!frames.length) return;
    const gl = drawingContext;
    if (gl?.disable) gl.disable(gl.DEPTH_TEST);
    resetShader();
    push();
    noFill();
    rectMode(CORNER);
    stroke(101, 224, 211, 190);
    strokeWeight(2);
    for (const frame of frames) {
      rect(
        Number(frame.x || 0) - width * 0.5,
        Number(frame.y || 0) - height * 0.5,
        Math.max(1, Number(frame.width) || 1),
        Math.max(1, Number(frame.height) || 1)
      );
    }
    pop();
    if (gl?.enable) gl.enable(gl.DEPTH_TEST);
  }

  shouldRevealSurfaceOverlay(surfaceId) {
    const mapped = this.mapperSurfaces.get(surfaceId);
    const corners = mapped?.mapperSurface?.corners;
    if (!Array.isArray(corners)) return false;
    if (mapped?.mapperSurface?.dragging !== -1) return true;
    const pointer = this.previewDisplayPointToWorld({
      x: typeof mouseX === "number" ? mouseX : -99999,
      y: typeof mouseY === "number" ? mouseY : -99999,
    });
    const px = pointer.x;
    const py = pointer.y;
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
      const request = component.type === "scene"
        ? scenePreviewRenderRequest(this.state?.render || {}, component, width, height, { reason: "component-preview", renderIdentity: component.id })
        : componentPreviewRenderRequest(
            this.state.render,
            component,
            width,
            height,
            this.renderPixelDensity(this.state.render),
            { reason: "component-preview", renderIdentity: component.id }
          );
      const output = this.renderComponentForRequest(
        component,
        componentTime,
        request
      );
      this.recordPresentedRenderRequest(request);
      this.componentOutput.set(component.id, output);
      const rect = containedRect(this.mainMix.width, this.mainMix.height, output.width, output.height);
      this.mainMix.push();
      applyBlend(this.mainMix, component.blend);
      this.mainMix.tint(255, 255 * clamp01(component.opacity));
      this.drawPlacedResultGeometry(this.mainMix, createPlacedRenderResult(output, {
        destinationRect: rect,
        transform: component.transform,
        sourceIsWebGL: this.isShaderBuffer(output),
      }));
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
    const renderRequest = component?.type === "scene"
      ? outputRequest
      : componentPipelineSourceRequest(outputRequest, pipeline);
    const outputKey = renderBufferKey(component.id, renderRequestStateKey(outputRequest));
    const cached = this.componentOutput.get(outputKey);
    if (cached) {
      this.claimRetainedComponentMedia(component);
      this.frameProfile.componentCacheHits++;
      return cached;
    }
    // Moving regional windows reuse size-keyed GPU allocations, but they must
    // not create persistent stable-cache entries for every crop position.
    const stableSignature = outputRequest.regionView === true
      ? ""
      : this.stableComponentSignature(component, outputRequest);
    const stableKey = renderBufferKey("stable", outputKey);
    const stableGpuKey = renderBufferKey(stableKey, renderRequestKey(outputRequest));
    const stableGpuCached = stableSignature ? this.componentGpuBuffer.get(stableGpuKey) : null;
    const stableCpuCached = stableSignature ? this.componentBuffer.get(stableGpuKey) : null;
    const stableCached = stableGpuCached || stableCpuCached;
    if (stableCached &&
        stableCached.width === outputRequest.width &&
        stableCached.height === outputRequest.height &&
        this.stableComponentSignatures.get(stableKey) === stableSignature) {
      // A retained frame still owns its live media. Without renewing this
      // lease, endFrame() pauses a cached video after its first decoded frame.
      this.claimRetainedComponentMedia(component);
      if (stableGpuCached) this.renderCache.touch("gpu-buffer", stableGpuKey, this.frameIndex);
      else this.renderCache.touch("buffer", stableGpuKey, this.frameIndex);
      this.frameProfile.componentCacheHits++;
      this.cacheComponentOutput(component, outputKey, stableCached, outputRequest);
      return stableCached;
    }
    if (component.type === "scene") {
      const output = this.measureComponentProfile({
        type: "component",
        componentId: component.id,
        componentName: component.name || component.id || "Scene",
        width: outputRequest.width,
        height: outputRequest.height,
      }, () => this.renderSceneComponent(component, componentTime, renderRequest));
      this.cacheComponentOutput(component, outputKey, output, outputRequest);
      if (stableSignature) this.storeStableComponentOutput(stableKey, stableSignature, output, outputRequest);
      return output;
    }
    const patch = compileComponentPatch(component, renderRequest, this.visualResolverOptions);
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
      const pipelined = this.renderComponentOutputPipeline(
        component,
        source,
        renderRequest,
        outputRequest,
        componentTime,
        pipeline
      );
      return pipelined;
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
      const target = this.getComponentPipelineTarget(`${component.id}:upscale:${outputRequest.renderIdentity || "shared"}`, outputRequest);
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
      const target = this.getComponentPipelineTarget(`${component.id}:post:${outputRequest.renderIdentity || "shared"}`, outputRequest);
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
    this.renderCache.touch("gpu-buffer", key, this.frameIndex);
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
      const fragment = kind === "upscale"
        ? COMPONENT_UPSCALE_FRAGMENT_SHADER
        : kind === "transform"
          ? LAYER_TRANSFORM_FRAGMENT_SHADER
          : COMPONENT_POST_FRAGMENT_SHADER;
      shaders[kind] = target.createShader(RENDER_PASS_VERTEX_SHADER, fragment);
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

  renderSceneComponent(component, componentTime, request = frameRenderRequest(this.state.render)) {
    const renderRequest = this.normalizeRenderRequest(request, "component");
    const program = this.componentPrograms.get(component.id);
    if (!program) throw new Error(`VJ1_COMPONENT_PROGRAM_MISSING:${component.id || "unknown"}`);
    const state = program.execute(this, component, componentTime, renderRequest, renderBufferKey(component.id, "component-output"));
    return state.buffer;
  }

  renderComponentPatch(component, patch, componentTime, request = frameRenderRequest(this.state.render)) {
    const renderRequest = this.normalizeRenderRequest(patch?.renderRequest || request, "component");
    const program = this.componentPrograms.get(component.id);
    const programChain = this.componentProgramChain(component);
    if (programChain.length) {
      const state = program.execute(this, component, componentTime, renderRequest);
      return state.buffer;
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
    const generatorComponent = sourceState.type === "generator"
      ? this.generatorNodeComponent(sourceState.generatorId)
      : null;
    if (isSimpleLayer(layer) && generatorComponent && sourceState.generatorId !== "terrainFlyover" && this.generatorShaderComponent(generatorComponent.id)) {
      return this.measureProfile("sourceMs", {
        type: "source",
        componentId: component.id,
        componentName: component.name || component.id || "Component",
        passId: node.componentId || node.id,
        chainItemId: node.id || sourceState.instanceId || "",
        implementationId: sourceState.generatorId || sourceState.type || node.componentId || "",
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
      chainItemId: node.id || sourceState.instanceId || "",
      implementationId: sourceState.generatorId || sourceState.type || node.componentId || "",
      passName: layer.name || node.componentId || node.id,
      width: renderRequest.width,
      height: renderRequest.height,
    }, () => this.renderPatchSourceNode(component, node, componentTime, renderRequest));
    return source;
  }

  renderComponentChain(component, componentTime, request = frameRenderRequest(this.state.render)) {
    const renderRequest = this.normalizeRenderRequest(request, "component");
    const program = this.componentPrograms.get(component.id);
    if (!program) throw new Error(`VJ1_COMPONENT_PROGRAM_MISSING:${component.id || "unknown"}`);
    const state = program.execute(this, component, componentTime, renderRequest);
    return state.buffer;
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

  executeVisualRenderPlan(plan, component, componentTime, renderRequest, scopeId = component.id) {
    if (plan?.format !== "vj1.visual-render-plan@1" || !Array.isArray(plan.operations)) {
      throw new Error(`VJ1_VISUAL_RENDER_PLAN_INVALID:${plan?.id || component.id || "unknown"}`);
    }
    return this.renderComponentOperationsState(component, plan.operations, componentTime, renderRequest, scopeId);
  }

  renderComponentChainState(component, chain, componentTime, renderRequest, scopeId = component.id, inheritedTransform = {}) {
    return this.renderComponentOperationsState(component, chain, componentTime, renderRequest, scopeId, inheritedTransform);
  }

  // Compiled visual operations retain the existing direct GPU path. This is
  // intentionally a tight specialized loop rather than generic runtime traversal:
  // graph topology, node definitions, and compiler hooks were already resolved
  // when the project state changed, outside the frame.
  renderComponentOperationsState(component, operations, componentTime, renderRequest, scopeId = component.id, inheritedTransform = {}) {
    let state = this.transparentChainState(component, renderRequest);
    for (let index = 0; index < (operations || []).length; index++) {
      const operation = operations[index];
      const item = operation?.configuration || operation;
      const opcode = operation?.opcode || item?.kind;
      if (item.enabled === false) continue;
      const effectComponent = opcode === "effect" && !operation?.transformDomain
        ? this.effectNodeComponent(item.componentId)
        : null;
      const effectRoi = operation?.roi || operation?.compilerHook?.roi || effectComponent?.runtime?.roi;
      const renderedItem = visualOperationRenderItem(operation, item, inheritedTransform, effectComponent);
      const nodeId = renderBufferKey(component.id, scopeId, index, item.id || item.componentId || item.kind);
      if (opcode === "source") {
        if (!isFullNodeBoundary(renderedItem.boundary)) {
          const roiRequest = nodeRoiRequest(renderRequest, renderedItem.boundary, {
            renderIdentity: renderBufferKey(renderRequest.renderIdentity || component.id, renderedItem.id || nodeId),
          });
          if (roiRequest.empty) continue;
          const sourceState = this.renderComponentSourceItemState(component, renderedItem, componentTime, roiRequest, nodeId, operation);
          state = this.renderBoundedLayerNodeState(nodeId, state, sourceState, renderedItem, renderRequest, roiRequest.roi);
          continue;
        }
        if (this.canDirectCompositeSource(renderedItem, renderRequest)) {
          state = this.renderDirectSourceNodeState(nodeId, state, component, renderedItem, componentTime, renderRequest);
          continue;
        }
        const sourceState = this.renderComponentSourceItemState(component, renderedItem, componentTime, renderRequest, nodeId, operation);
        // A source owns its coordinate-domain transform while retaining the
        // full Component framebuffer. Composite that already transformed frame
        // without moving or clipping the layer rectangle a second time.
        state = this.renderLayerNodeState(nodeId, state, sourceState, { ...renderedItem, transform: {} }, renderRequest);
        continue;
      }
      if (opcode === "effect") {
        if (!isFullNodeBoundary(renderedItem.boundary)) {
          if (nodeBoundaryPixelRect(renderedItem.boundary, renderRequest).empty) continue;
          if (effectRoi?.mode === "full-frame") {
            state = this.renderFullFrameEffectWithinBoundary(nodeId, state, renderedItem, componentTime, renderRequest);
            continue;
          }
          const run = [renderedItem];
          let nextIndex = index + 1;
          while (nextIndex < (operations || []).length) {
            const nextOperation = operations[nextIndex];
            const nextItem = nextOperation?.configuration || nextOperation;
            if (nextItem?.enabled === false) {
              nextIndex++;
              continue;
            }
            if ((nextOperation?.opcode || nextItem?.kind) !== "effect") break;
            const nextEffectComponent = !nextOperation?.transformDomain
              ? this.effectNodeComponent(nextItem.componentId)
              : null;
            const nextEffectRoi = nextOperation?.roi || nextOperation?.compilerHook?.roi || nextEffectComponent?.runtime?.roi;
            if (nextEffectRoi?.mode === "full-frame") break;
            const renderedNextItem = visualOperationRenderItem(nextOperation, nextItem, inheritedTransform, nextEffectComponent);
            if (!sameNodeBoundary(renderedItem.boundary, renderedNextItem.boundary)) break;
            run.push(renderedNextItem);
            nextIndex++;
          }
          state = this.renderBoundedEffectRunNodeState(nodeId, state, run, componentTime, renderRequest);
          index = nextIndex - 1;
          continue;
        }
        const firstPass = chainItemToShaderPass(renderedItem);
        const firstJob = compileShaderSchedule([firstPass], this.visualResolverOptions)[0];
        if (isFusibleShaderJob(firstJob)) {
          const run = [renderedItem];
          let nextIndex = index + 1;
          while (nextIndex < (operations || []).length) {
            const nextOperation = operations[nextIndex];
            const nextItem = nextOperation?.configuration || nextOperation;
            if (nextItem?.enabled === false) {
              nextIndex++;
              continue;
            }
            if ((nextOperation?.opcode || nextItem?.kind) !== "effect") break;
            const nextEffectComponent = !nextOperation?.transformDomain
              ? this.effectNodeComponent(nextItem.componentId)
              : null;
            const renderedNextItem = visualOperationRenderItem(nextOperation, nextItem, inheritedTransform, nextEffectComponent);
            const nextJob = compileShaderSchedule([chainItemToShaderPass(renderedNextItem)], this.visualResolverOptions)[0];
            if (!isFusibleShaderJob(nextJob)) break;
            run.push(renderedNextItem);
            nextIndex++;
          }
          if (run.length > 1) {
            const runNodeId = renderBufferKey(nodeId, "fused", run.length);
            state = this.renderEffectRunNodeState(runNodeId, state, run, componentTime, renderRequest);
            index = nextIndex - 1;
            continue;
          }
        }
        state = this.renderEffectNodeState(nodeId, state, renderedItem, componentTime, renderRequest);
        continue;
      }
      if (opcode === "group") {
        const bounded = !isFullNodeBoundary(renderedItem.boundary);
        const groupRequest = bounded
          ? nodeRoiRequest(renderRequest, renderedItem.boundary, {
              renderIdentity: renderBufferKey(renderRequest.renderIdentity || component.id, renderedItem.id || nodeId),
            })
          : renderRequest;
        if (groupRequest.empty) continue;
        const groupState = this.renderComponentOperationsState(
          component,
          operation?.operations || item.chain || [],
          componentTime,
          groupRequest,
          renderBufferKey(scopeId, item.id || index),
          combineContentTransforms(inheritedTransform, item.transform || {})
        );
        // A Group is a transform scope: its transform is precomposed into all
        // descendants above. Only its blend/opacity applies at this boundary.
        state = bounded
          ? this.renderBoundedLayerNodeState(nodeId, state, groupState, { ...item, transform: {} }, renderRequest, groupRequest.roi)
          : this.renderLayerNodeState(nodeId, state, groupState, { ...item, transform: {} }, renderRequest);
      }
    }
    return state;
  }

  canDirectCompositeSource(item = {}, renderRequest = {}) {
    // Direct placement uses the allocation as its complete coordinate frame.
    // A regional Scene request is only a window into a larger logical frame,
    // so route it through the render-view-aware source implementation.
    if (renderRequest.regionView === true) return false;
    const source = item.source || {};
    if (this.imageSourceNeedsAlphaEdge(source)) return false;
    const dependency = source.type === "component"
      ? this.state?.components?.find((component) => component.id === source.componentId)
      : null;
    const mediaDemandRequest = qualityScaledRenderRequest(renderRequest, source.params || {});
    const media = source.type === "media"
      ? this.acquireMedia(source.mediaId, { width: mediaSourceDemandWidth(mediaDemandRequest, source) })
      : null;
    const camera = source.type === "camera" ? this.acquireCameraInput() : null;
    return !!directPlacementKind({
      source,
      blend: item.blend || "normal",
      dependency,
      mediaDrawable: !!media && (
        (media.video && isDrawableMedia(media.video)) ||
        (media.image && isDrawableMedia(media.image))
      ),
      mediaIsModel: !!(media?.model || media?.modelData),
      cameraDrawable: !!camera && isDrawableMedia(camera),
    });
  }

  componentRegionSafe(component = {}, visiting = new Set()) {
    if (!component?.id || visiting.has(component.id)) return false;
    const cached = this.componentRegionSafety.get(component);
    if (cached !== undefined) return cached;
    visiting.add(component.id);
    const visit = (chain) => (chain || []).every((item) => {
      if (item?.enabled === false) return true;
      if (item?.kind === "group") return visit(item.chain);
      if (item?.kind === "effect") {
        const effect = this.effectNodeComponent(item.componentId);
        // Surface ROI must be pixel-equivalent to a full Scene crop.
        // Effects that sample neighboring/arbitrary source coordinates need
        // a halo/global adapter and therefore retain the established full-
        // Scene path for now. Local filters remain region-safe.
        return !!effect?.code && effect.runtime?.roi?.mode === "local" && effect.sampling === "local";
      }
      if (item?.kind !== "source") return false;
      if (item.source?.type === "black") return true;
      if (item.source?.type === "component") {
        const dependency = this.state?.components?.find((candidate) => candidate.id === item.source.componentId);
        return !!dependency && dependency.type !== "scene" && this.componentRegionSafe(dependency, visiting);
      }
      if (item.source?.type === "media" || item.source?.type === "camera") return true;
      if (item.source?.type !== "generator") return false;
      return !!this.generatorNodeComponent(item.source.generatorId);
    });
    const safe = visit(component.chain);
    visiting.delete(component.id);
    this.componentRegionSafety.set(component, safe);
    return safe;
  }

  sceneComponentRegionSafe(component = {}) {
    return component.type === "scene" && this.componentRegionSafe(component);
  }

  sceneComponentFrameFanoutSafe(component = {}, visiting = new Set()) {
    if (component?.type !== "scene" || !component.id) return false;
    const visitChain = (chain) => (chain || []).every((item) => {
      if (item?.enabled === false) return true;
      if (item?.kind === "group") return visitChain(item.chain);
      if (item?.kind !== "source" || item.source?.type !== "component") return true;
      const dependency = this.state?.components?.find((candidate) => candidate.id === item.source.componentId);
      if (!dependency || dependency.syncInstances === false) return false;
      return visitComponent(dependency);
    });
    const visitComponent = (candidate) => {
      if (!candidate?.id || visiting.has(candidate.id)) return false;
      visiting.add(candidate.id);
      const safe = visitChain(candidate.chain);
      visiting.delete(candidate.id);
      return safe;
    };
    return visitComponent(component);
  }

  videoPlaybackOptions(source = {}, component = {}) {
    return {
      start: source.start,
      end: source.end,
      speed: (this.isPlaybackActive() ? 1 : 0) *
        globalVisualTimeScale(this.state?.global) *
        (Number(source.speed) || 1) *
        Math.max(0, Number(component.speed) || 0),
    };
  }

  claimRetainedComponentMedia(component = {}, visiting = new Set()) {
    if (!component?.id || visiting.has(component.id) || !this.componentContainsVideo(component)) return;
    visiting.add(component.id);
    const visit = (chain = []) => {
      for (const item of chain || []) {
        if (!item || item.enabled === false) continue;
        if (item.kind === "group") {
          visit(item.chain || []);
          continue;
        }
        if (item.kind !== "source") continue;
        const source = sourceWithNodeParams(item.source, {}, item.id);
        if (source.type === "component") {
          const dependency = this.state?.components?.find((candidate) => candidate.id === source.componentId);
          if (dependency) this.claimRetainedComponentMedia(dependency, visiting);
          continue;
        }
        if (source.type !== "media") continue;
        const runtimeItem = this.media.get(source.mediaId);
        const mediaMeta = (this.state?.media || []).find((entry) => entry.id === source.mediaId);
        if (mediaMeta?.type !== "video" && !runtimeItem?.video) continue;
        this.acquireMedia(source.mediaId, {
          playback: this.videoPlaybackOptions(source, component),
        });
      }
    };
    visit(component.chain || []);
    visiting.delete(component.id);
  }

  componentContainsVideo(component = {}, visiting = new Set()) {
    if (!component?.id) return false;
    const cached = this.componentVideoPresence.get(component);
    if (cached != null) return cached;
    if (visiting.has(component.id)) return false;
    visiting.add(component.id);
    let containsVideo = false;
    const visit = (chain = []) => {
      for (const item of chain || []) {
        if (!item || item.enabled === false) continue;
        if (item.kind === "group") {
          visit(item.chain || []);
          if (containsVideo) return;
          continue;
        }
        if (item.kind !== "source") continue;
        const source = sourceWithNodeParams(item.source, {}, item.id);
        if (source.type === "component") {
          const dependency = this.state?.components?.find((candidate) => candidate.id === source.componentId);
          if (dependency && this.componentContainsVideo(dependency, visiting)) containsVideo = true;
        } else if (source.type === "media") {
          const runtimeItem = this.media.get(source.mediaId);
          const mediaMeta = (this.state?.media || []).find((entry) => entry.id === source.mediaId);
          containsVideo = mediaMeta?.type === "video" || !!runtimeItem?.video || /\.(mp4|m4v|mov|webm|ogv)$/i.test(source.mediaId || "");
        }
        if (containsVideo) return;
      }
    };
    visit(component.chain || []);
    visiting.delete(component.id);
    this.componentVideoPresence.set(component, containsVideo);
    return containsVideo;
  }

  renderDirectSourceNodeState(nodeId, inputState, component, item, componentTime, renderRequest) {
    const source = {
      ...sourceWithNodeParams(item.source, {}, item.id),
      contentTransform: item.transform || {},
    };
    const runtimeContext = this.nodeRuntimeContext(componentTime);
    const time = this.sourceRuntimeTimeKey(source, item, runtimeContext);
    const external = this.sourceRuntimeExternalKey(source, item, runtimeContext);
    const instanceInvariant = inputState.instanceInvariant === true &&
      !this.sourceIsFrameDynamic(source, item);
    const evaluationRequest = instanceInvariant
      ? instanceInvariantRenderRequest(renderRequest)
      : renderRequest;
    const signature = stableStringify({
      input: textureStateKey(inputState),
      source: staticSourceState(source),
      media: staticMediaStateForSource(this.state?.media || [], source),
      runtimeMedia: runtimeMediaStateForSource(this.media, source),
      time,
      external,
      layer: chainLayerState(item),
      request: renderRequestStateKey(evaluationRequest),
    });
    return this.evaluateChainNode(nodeId, signature, renderRequest, (output) => {
      output.push();
      output.clear();
      drawBuffer(output, inputState.buffer, 0, 0, output.width, output.height, this.isShaderBuffer(inputState.buffer));
      output.pop();
      const placed = this.resolvePlacedSourceResult(output, source, component, componentTime, evaluationRequest);
      const clipRect = isFullNodeBoundary(item.boundary)
        ? null
        : nodeBoundaryPixelRect(item.boundary, renderRequest);
      if (placed) this.drawPlacedSourceResult(output, placed, item, clipRect);
      this.frameProfile.directSourceComposites++;
      this.frameProfile.avoidedSourceRasterPixels += renderRequest.width * renderRequest.height;
    }, "direct-source", { instanceInvariant });
  }

  resolvePlacedSourceResult(output, source, component, componentTime, renderRequest) {
    const target = { width: output.width, height: output.height };
    if (source.type === "component") {
      const dependency = this.state.components.find((item) => item.id === source.componentId);
      if (!dependency || dependency.id === component.id || dependency.type === "scene") return null;
      const placement = componentReferencePlacement(component, dependency, this.state.render, target, source.placement);
      const placementTransform = combineContentTransforms(source.contentTransform, dependency.transform);
      const demandRect = transformedPlacementDemandRect(placement, placementTransform);
      const dependencyTime = this.componentTimes.get(dependency.id) || componentTime;
      const renderIdentity = componentRenderInstanceKey(dependency, source.instanceId);
      const referenceCount = componentReferenceCount(component, dependency.id);
      const texture = this.renderComponentForRequest(
        dependency,
        componentInstanceTime(dependency, dependencyTime, source.instanceId),
        componentReferenceRenderRequest(this.state.render, dependency, demandRect, {
          reason: "direct-component-reference",
          renderIdentity,
          sharedResolutionClass: dependency.syncInstances !== false && referenceCount > 1,
        })
      );
      return createPlacedRenderResult(texture, {
        destinationRect: placement,
        transform: placementTransform,
        sourceIsWebGL: this.isShaderBuffer(texture),
      });
    }
    if (source.type === "media") {
      const playback = this.videoPlaybackOptions(source, component);
      const qualityRequest = qualityScaledRenderRequest(renderRequest, source.params || {});
      const media = this.acquireMedia(source.mediaId, {
        playback,
        width: mediaSourceDemandWidth(qualityRequest, source),
      });
      if (media?.video && isDrawableMedia(media.video)) {
        return createPlacedRenderResult(media.video, {
          destinationRect: fullTargetRect(target),
          fit: mediaSourceFit(source),
          transform: source.contentTransform,
        });
      }
      if (media?.image && isDrawableMedia(media.image)) {
        const fit = mediaSourceFit(source);
        const renditionDemand = mediaSourceDemandSize(qualityRequest, source);
        const texture = fit === "cover"
          ? this.getImageRendition(media, renditionDemand.width, renditionDemand.height) || media.image
          : media.image;
        return createPlacedRenderResult(texture, {
          destinationRect: fullTargetRect(target),
          fit,
          transform: source.contentTransform,
        });
      }
      return null;
    }
    if (source.type === "camera") {
      const camera = this.acquireCameraInput();
      if (!camera || !isDrawableMedia(camera)) return null;
      return createPlacedRenderResult(camera, {
        destinationRect: fullTargetRect(target),
        fit: "cover",
        transform: source.contentTransform,
      });
    }
    return null;
  }

  drawPlacedSourceResult(output, placed, layer = {}, clipRect = null) {
    output.push();
    applyBlend(output, layer.blend);
    output.tint(255, 255 * clamp01(layer.opacity ?? 1));
    withTargetScissor(output, clipRect, () => this.drawPlacedResultGeometry(output, placed));
    output.noTint();
    output.blendMode(BLEND);
    output.pop();
  }

  drawPlacedResultGeometry(output, placed, coordinateTarget = output) {
    const rect = placed.destinationRect;
    const transform = normalizedContentTransform(placed.transform);
    const coordinateWidth = Math.max(1, Number(coordinateTarget?.width) || Number(output.width) || 1);
    const coordinateHeight = Math.max(1, Number(coordinateTarget?.height) || Number(output.height) || 1);
    const placement = contentTransformCanvasPlacement(transform, coordinateWidth, coordinateHeight);
    output.push();
    output.translate(placement.centerX, placement.centerY);
    output.rotate(transform.rotation);
    output.scale(transform.scale);
    const x = rect.x - coordinateWidth * 0.5;
    const y = rect.y - coordinateHeight * 0.5;
    if (placed.fit === "stretch") {
      drawBuffer(output, placed.texture, x, y, rect.width, rect.height, placed.sourceIsWebGL);
    } else {
      drawMediaFit(output, placed.texture, x, y, rect.width, rect.height, placed.fit);
    }
    output.pop();
  }

  transparentChainState(component, renderRequest) {
    const nodeId = renderBufferKey(component.id, "transparent");
    const evaluationRequest = instanceInvariantRenderRequest(renderRequest);
    const signature = stableStringify({
      transparent: true,
      request: renderRequestStateKey(evaluationRequest),
    });
    return this.evaluateChainNode(nodeId, signature, renderRequest, (output) => {
      output.push();
      output.clear();
      output.pop();
    }, "initial", { instanceInvariant: true });
  }

  renderLayerNodeState(nodeId, inputState, layerState, layer, renderRequest) {
    const contentState = this.renderLayerContentTransformState(
      renderBufferKey(nodeId, "content-transform"),
      layerState,
      layer.transform || {},
      renderRequest
    );
    const compositeLayer = { ...layer, transform: {} };
    const instanceInvariant = inputState.instanceInvariant === true && contentState.instanceInvariant === true;
    const evaluationRequest = instanceInvariant
      ? instanceInvariantRenderRequest(renderRequest)
      : renderRequest;
    const signature = stableStringify({
      input: textureStateKey(inputState),
      layer: textureStateKey(contentState),
      state: chainLayerState(layer),
      request: renderRequestStateKey(evaluationRequest),
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
    }, "layer", { instanceInvariant });
  }

  renderBoundedLayerNodeState(nodeId, inputState, layerState, layer, renderRequest, roi) {
    const instanceInvariant = inputState.instanceInvariant === true && layerState.instanceInvariant === true;
    const evaluationRequest = instanceInvariant
      ? instanceInvariantRenderRequest(renderRequest)
      : renderRequest;
    const signature = stableStringify({
      input: textureStateKey(inputState),
      layer: textureStateKey(layerState),
      state: chainLayerState(layer),
      roi,
      request: renderRequestStateKey(evaluationRequest),
    });
    return this.evaluateChainNode(renderBufferKey(nodeId, "bounded-layer"), signature, renderRequest, (output) => {
      output.push();
      output.clear();
      drawBuffer(output, inputState.buffer, 0, 0, output.width, output.height, this.isShaderBuffer(inputState.buffer));
      applyBlend(output, layer.blend);
      output.tint(255, 255 * clamp01(layer.opacity ?? 1));
      this.drawNodeRegionGeometry(output, layerState.buffer, roi);
      output.noTint();
      output.blendMode(BLEND);
      output.pop();
    }, "bounded-layer", { instanceInvariant });
  }

  renderBoundedEffectNodeState(nodeId, inputState, item, componentTime, renderRequest) {
    return this.renderBoundedEffectRunNodeState(nodeId, inputState, [item], componentTime, renderRequest);
  }

  renderFullFrameEffectWithinBoundary(nodeId, inputState, item, componentTime, renderRequest) {
    const fullState = this.renderEffectNodeState(
      renderBufferKey(nodeId, "full-frame-effect"),
      inputState,
      { ...item, boundary: FULL_NODE_BOUNDARY },
      componentTime,
      renderRequest
    );
    const roiRequest = nodeRoiRequest(renderRequest, item.boundary, {
      renderIdentity: renderBufferKey(renderRequest.renderIdentity || "effect", item.id || item.componentId),
    });
    const regionState = this.extractNodeRegionState(
      renderBufferKey(nodeId, "full-frame-region"),
      fullState,
      renderRequest,
      roiRequest
    );
    return this.compositeNodeRegionState(
      renderBufferKey(nodeId, "full-frame-composite"),
      inputState,
      regionState,
      renderRequest,
      roiRequest.roi
    );
  }

  renderBoundedEffectRunNodeState(nodeId, inputState, items, componentTime, renderRequest) {
    const boundary = items[0]?.boundary || FULL_NODE_BOUNDARY;
    const roiRequest = nodeRoiRequest(renderRequest, boundary, {
      renderIdentity: renderBufferKey(renderRequest.renderIdentity || "effect", items.map((item) => item.id || item.componentId).join("+")),
    });
    const regionState = this.extractNodeRegionState(renderBufferKey(nodeId, "extract"), inputState, renderRequest, roiRequest);
    let effectState = regionState;
    for (let index = 0; index < items.length; index++) {
      effectState = this.renderEffectNodeState(
        renderBufferKey(nodeId, "roi-effect", index, items[index].id || items[index].componentId),
        effectState,
        { ...items[index], boundary: FULL_NODE_BOUNDARY },
        componentTime,
        roiRequest
      );
    }
    return this.compositeNodeRegionState(renderBufferKey(nodeId, "roi-composite"), inputState, effectState, renderRequest, roiRequest.roi);
  }

  extractNodeRegionState(nodeId, inputState, fullRequest, roiRequest) {
    const instanceInvariant = inputState.instanceInvariant === true;
    const evaluationRequest = instanceInvariant
      ? instanceInvariantRenderRequest(fullRequest)
      : fullRequest;
    const signature = stableStringify({
      input: textureStateKey(inputState),
      roi: roiRequest.roi,
      request: renderRequestStateKey(evaluationRequest),
    });
    return this.evaluateChainNode(nodeId, signature, roiRequest, (output) => {
      const roi = roiRequest.roi;
      output.push();
      output.clear();
      output.translate(-roi.sampleX, -roi.sampleY);
      output.translate(roi.boundaryWidth * 0.5, roi.boundaryHeight * 0.5);
      output.rotate(-roi.rotation);
      output.translate(-roi.centerX, -roi.centerY);
      drawBuffer(
        output,
        inputState.buffer,
        0,
        0,
        roi.fullWidth,
        roi.fullHeight,
        this.isShaderBuffer(inputState.buffer)
      );
      output.pop();
    }, "roi-extract", { instanceInvariant });
  }

  compositeNodeRegionState(nodeId, inputState, regionState, renderRequest, roi) {
    const instanceInvariant = inputState.instanceInvariant === true && regionState.instanceInvariant === true;
    const evaluationRequest = instanceInvariant
      ? instanceInvariantRenderRequest(renderRequest)
      : renderRequest;
    const signature = stableStringify({
      input: textureStateKey(inputState),
      region: textureStateKey(regionState),
      roi,
      request: renderRequestStateKey(evaluationRequest),
    });
    return this.evaluateChainNode(nodeId, signature, renderRequest, (output) => {
      output.push();
      output.clear();
      drawBuffer(output, inputState.buffer, 0, 0, output.width, output.height, this.isShaderBuffer(inputState.buffer));
      // Replacement is important for alpha-key and mask effects: ordinary
      // source-over compositing would retain pixels made transparent by the ROI.
      output.blendMode(REPLACE);
      this.drawNodeRegionGeometry(output, regionState.buffer, roi);
      output.blendMode(BLEND);
      output.pop();
    }, "roi-composite", { instanceInvariant });
  }

  drawNodeRegionGeometry(output, region, roi) {
    output.push();
    output.translate(roi.centerX, roi.centerY);
    output.rotate(roi.rotation);
    drawBuffer(
      output,
      region,
      -roi.boundaryWidth * 0.5 + roi.sampleX,
      -roi.boundaryHeight * 0.5 + roi.sampleY,
      roi.width,
      roi.height,
      this.isShaderBuffer(region)
    );
    output.pop();
  }

  renderLayerContentTransformState(nodeId, inputState, transform, renderRequest) {
    if (isIdentityTransform(transform)) return inputState;
    const instanceInvariant = inputState.instanceInvariant === true;
    const evaluationRequest = instanceInvariant
      ? instanceInvariantRenderRequest(renderRequest)
      : renderRequest;
    const signature = stableStringify({
      input: textureStateKey(inputState),
      transform,
      request: renderRequestStateKey(evaluationRequest),
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
    }, "content-transform", { instanceInvariant });
  }

  getLayerTransformShader(target) {
    if (this.layerTransformShader) return this.layerTransformShader;
    try {
      this.layerTransformShader = target.createShader(RENDER_PASS_VERTEX_SHADER, LAYER_TRANSFORM_FRAGMENT_SHADER);
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
      this.overlayBlendShader = target.createShader(RENDER_PASS_VERTEX_SHADER, OVERLAY_BLEND_FRAGMENT_SHADER);
    } catch (error) {
      console.error("[VJ1_OVERLAY_SHADER_FAILED]", error?.message || error);
      return null;
    }
    return this.overlayBlendShader;
  }

  renderEffectNodeState(nodeId, inputState, item, componentTime, renderRequest) {
    const component = this.effectNodeComponent(item.componentId);
    if (!component) return inputState;
    const params = normalizeParamValues(component, effectParamState(item));
    const amount = effectParamNumber(component, params, "amount", item.amount ?? 0.35);
    if ((item.opacity ?? 1) <= 0.0001) return inputState;
    if (amount <= 0.0001) return inputState;
    const runtimeContext = this.nodeRuntimeContext(componentTime);
    const external = component.runtime?.externalKey?.(params, runtimeContext) ?? null;
    const instanceInvariant = inputState.instanceInvariant === true &&
      !this.effectPassIsFrameDynamic({ id: item.componentId, params, amount }) &&
      external === null;
    const evaluationRequest = instanceInvariant
      ? instanceInvariantRenderRequest(renderRequest)
      : renderRequest;
    const signature = stableStringify({
      input: textureStateKey(inputState),
      params,
      transform: item.transform || {},
      time: componentRuntimeTimeKey(component, params, runtimeContext),
      external,
      customShader: item.componentId === "custom" ? this.state?.shaders?.customCode || "" : "",
      request: renderRequestStateKey(evaluationRequest),
    });
    const needsComposite = effectNeedsComposite(item);
    const effectState = this.evaluateChainNode(needsComposite ? renderBufferKey(nodeId, "effect") : nodeId, signature, renderRequest, (output) => {
      const pass = chainItemToShaderPass({ ...item, params, amount });
      const qualityRequest = qualityScaledRenderRequest(evaluationRequest, params);
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
    }, "effect", { instanceInvariant });
    if (!needsComposite) return effectState;
    return this.renderLayerNodeState(
      renderBufferKey(nodeId, "composite"),
      inputState,
      effectState,
      { opacity: item.opacity ?? 1, blend: item.blend || "normal", transform: {} },
      renderRequest
    );
  }

  renderEffectRunNodeState(nodeId, inputState, items, componentTime, renderRequest) {
    const passes = items.map((item) => chainItemToShaderPass(item));
    const instanceInvariant = inputState.instanceInvariant === true &&
      passes.every((pass) => !this.effectPassIsFrameDynamic(pass));
    const evaluationRequest = instanceInvariant
      ? instanceInvariantRenderRequest(renderRequest)
      : renderRequest;
    const signature = stableStringify({
      input: textureStateKey(inputState),
      passes,
      time: passes.map((pass) => {
        const component = this.effectNodeComponent(pass.id);
        return componentRuntimeTimeKey(component, pass.params, this.nodeRuntimeContext(componentTime));
      }),
      request: renderRequestStateKey(evaluationRequest),
    });
    return this.evaluateChainNode(nodeId, signature, renderRequest, (output) => {
      const effected = this.renderShaderChain(inputState.buffer, passes, evaluationRequest, componentTime);
      output.push();
      output.clear();
      drawBuffer(output, effected, 0, 0, output.width, output.height, this.isShaderBuffer(effected));
      output.pop();
    }, "fused-effect-run", { instanceInvariant });
  }

  evaluateChainNode(nodeId, signature, renderRequest, render, dirtyReason, options = {}) {
    const instanceInvariant = options.instanceInvariant === true;
    const evaluationRequest = instanceInvariant
      ? instanceInvariantRenderRequest(renderRequest)
      : renderRequest;
    const bufferId = renderBufferKey("node", nodeId);
    const runtimeKey = renderBufferKey(bufferId, renderRequestKey(evaluationRequest));
    const output = this.getComponentGpuBuffer(bufferId, evaluationRequest);
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
      instanceInvariant,
    };
  }

  nodeRuntimeContext(time) {
    return {
      time: Number(time) || 0,
      frame: this.frameIndex,
      playing: this.isPlaybackActive(),
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
      // A component transform belongs to its consumer. The canonical texture
      // is reusable while that placement changes; nested component transforms
      // remain part of the parent component's rendered graph.
      component: staticComponentGraphState(component, this.state?.components || [], new Set(), false),
      media: staticComponentGraphMediaState(this.state?.media || [], component, this.state?.components || []),
      runtimeMedia: runtimeComponentGraphMediaState(this.media, component, this.state?.components || []),
      customShader: this.state?.shaders?.customCode || "",
      pipeline,
    });
  }

  componentIsFrameDynamic(component, seen = new Set()) {
    if (!component || seen.has(component.id)) return true;
    seen.add(component.id);
    const dynamic = this.chainItemsAreFrameDynamic(component.chain || [], seen);
    seen.delete(component.id);
    return dynamic;
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

  featureMorphPairService(generatorId = "") {
    if (generatorId === "featureMorph") return this.superPointPairs;
    if (generatorId === "featureMorphV2") return this.mobileNetMorphPairs;
    return null;
  }

  sourceIsFrameDynamic(source = {}, owner = {}, seen = new Set()) {
    if (!source || source.type === "black") return false;
    if (source.type === "camera") return true;
    if (source.type === "generator") {
      const component = this.generatorNodeComponent(source.generatorId);
      // File-backed definitions are installed after the initial project
      // snapshot. Keep a pending source dynamic so a temporary transparent
      // result cannot enter the stable Component cache.
      if (!component) return true;
      const params = normalizeParamValues(component, source.params || {});
      const featureMorphPairs = this.featureMorphPairService(source.generatorId);
      if (featureMorphPairs && params.imageAId && params.imageBId) {
        const imageA = this.media.get(params.imageAId);
        const imageB = this.media.get(params.imageBId);
        if (!isReadyMediaItem(imageA) || !isReadyMediaItem(imageB)) return true;
        const analysisStatus = featureMorphPairs.status(params, {
          imageAFile: imageA.file,
          imageBFile: imageB.file,
        });
        if (analysisStatus === "idle" || analysisStatus === "loading") return true;
      }
      if (source.generatorId === "tileTexture" && params.imageId && !isReadyMediaItem(this.media.get(params.imageId))) return true;
      return component.runtime?.cacheable === false || component.runtime?.timeDependent?.(params) === true;
    }
    if (source.type === "component") {
      const dependency = this.state?.components?.find((component) => component.id === source.componentId);
      return !dependency || this.componentIsFrameDynamic(dependency, seen);
    }
    if (source.type !== "media") return true;
    const mediaId = source.mediaId || "";
    const mediaMeta = (this.state?.media || []).find((item) => item.id === mediaId);
    // Classification must never claim, load, play, or pause media. The actual
    // source draw and Output readiness traversal own those lifecycle actions.
    const runtimeItem = this.media.get(mediaId);
    if (!mediaMeta || !isReadyMediaItem(runtimeItem)) return true;
    if (mediaMeta.type === "video" || runtimeItem?.video) {
      // Modern video elements report decoded-frame presentation directly.
      // Their revision is part of the stable component signature, so the
      // chain only needs renderer-frame invalidation on older browsers.
      return runtimeItem?.videoFrameDriven !== true;
    }
    if (mediaMeta.type === "model" || runtimeItem?.model || runtimeItem?.modelData) {
      const params = source.params || {};
      return Math.abs(Number(params.spinX) || 0) > 0.0001 ||
        Math.abs(Number(params.spinY) || 0) > 0.0001 ||
        Math.abs(Number(params.spinZ) || 0) > 0.0001;
    }
    return false;
  }

  effectPassIsFrameDynamic(pass = {}) {
    const id = pass.id || pass.componentId || "";
    const component = this.effectNodeComponent(id);
    // A pending file-backed effect is pass-through for compilation, but must
    // stay dynamic so that pass-through output is never retained as stable.
    if (!component) return true;
    const params = normalizeParamValues(component, {
      ...(pass.params && typeof pass.params === "object" ? pass.params : {}),
      ...(pass.amount !== undefined ? { amount: pass.amount } : {}),
    });
    const amount = effectParamNumber(component, params, "amount", 0.35);
    if (amount <= 0.0001) return false;
    return component.runtime?.cacheable === false || component.runtime?.timeDependent?.(params) === true;
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

  renderComponentSourceItemState(component, item, componentTime, request, nodeId, operation = null) {
    const renderRequest = this.normalizeRenderRequest(request, "source");
    const source = {
      ...sourceWithNodeParams(item.source, {}, item.id),
      contentTransform: item.transform || {},
    };
    const runtimeContext = this.nodeRuntimeContext(componentTime);
    const instanceInvariant = !this.sourceIsFrameDynamic(source, item);
    const evaluationRequest = instanceInvariant
      ? instanceInvariantRenderRequest(renderRequest)
      : renderRequest;
    const key = renderBufferKey(nodeId, "source", renderRequestKey(evaluationRequest));
    let pg = this.componentSource.get(key);
    if (!pg || pg.width !== evaluationRequest.width || pg.height !== evaluationRequest.height) {
      disposeGraphics(pg);
      pg = createSharedFramebufferTarget(evaluationRequest.width, evaluationRequest.height) || createGraphics(evaluationRequest.width, evaluationRequest.height);
      if (!isSharedFramebufferTarget(pg)) {
        this.applyGraphicsPixelDensity(pg, this.requestPixelDensity(evaluationRequest));
        this.applyGraphicsFont(pg);
      }
      this.componentSource.set(key, pg);
    }
    this.renderCache.touch("source", key, this.frameIndex);
    const sourceSignature = stableStringify({
      source: staticSourceState(source),
      execution: operation ? {
        backend: operation.backend || "",
        renderer: operation.renderer || operation.compilerHook?.renderer || "",
        nodeId: operation.nodeId || "",
        nodeVersion: operation.nodeVersion || "",
        nodeModule: operation.nodeModuleRevision || operation.nodeProcessRevision || "",
      } : null,
      media: staticMediaStateForSource(this.state?.media || [], source),
      runtimeMedia: runtimeMediaStateForSource(this.media, source),
      time: this.sourceRuntimeTimeKey(source, item, runtimeContext),
      external: this.sourceRuntimeExternalKey(source, item, runtimeContext),
      request: renderRequestStateKey(evaluationRequest),
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
      this.safeDrawSourceToGraphics(pg, source, component, componentTime, evaluationRequest, operation);
      pg.pop();
      return pg;
    }, { frame: this.frameIndex, dirtyReason: "source" });
    if (!result.rendered) this.frameProfile.stageCacheHits++;
    else this.frameProfile.stageRenders++;
    const sourceState = {
      buffer: result.output,
      outputVersion: result.outputVersion,
      nodeKey: key,
      dirtyReason: result.dirtyReason,
      instanceInvariant,
    };
    if (!this.imageSourceNeedsAlphaEdge(source)) return sourceState;
    const edge = mediaSourceAlphaEdge(source);
    return this.renderEffectNodeState(
      renderBufferKey(nodeId, "image-alpha-edge"),
      sourceState,
      {
        id: renderBufferKey(item.id || nodeId, "image-alpha-edge"),
        kind: "effect",
        componentId: "alphaFeather",
        amount: 1,
        params: { amount: 1, cut: edge.cut, feather: edge.feather, renderQuality: 1 },
        transform: {},
      },
      componentTime,
      evaluationRequest
    );
  }

  imageSourceNeedsAlphaEdge(source = {}) {
    if (source.type !== "media") return false;
    const media = (this.state?.media || []).find((item) => item.id === source.mediaId);
    const isImage = media?.type === "image" || /\.(avif|bmp|gif|jpe?g|png|webp)$/i.test(String(source.mediaId || ""));
    if (!isImage) return false;
    const edge = mediaSourceAlphaEdge(source);
    return edge.cut > 0.0001 || edge.feather > 0.0001;
  }

  sourceRuntimeTimeKey(source = {}, owner = {}, runtimeContext = {}) {
    if (!source || source.type === "black") return null;
    if (source.type === "camera") return runtimeContext.frame;
    if (source.type === "generator") {
      const component = this.generatorNodeComponent(source.generatorId);
      if (!component) return runtimeContext.frame;
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
    if (mediaMeta?.type === "video" || runtimeItem?.video) {
      return runtimeItem?.videoFrameDriven === true
        ? Math.max(0, Number(runtimeItem.videoFrameRevision) || 0)
        : runtimeContext.frame;
    }
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
    const featureMorphPairs = this.featureMorphPairService(source.generatorId);
    if (featureMorphPairs) {
      const params = { ...(source.params || {}), ...(owner.params || {}) };
      const imageA = this.media.get(params.imageAId);
      const imageB = this.media.get(params.imageBId);
      return featureMorphPairs.externalKey(params, {
        imageAFile: imageA?.file,
        imageBFile: imageB?.file,
      });
    }
    const component = this.generatorNodeComponent(source.generatorId);
    if (!component) return runtimeContext.frame;
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
    this.renderCache.touch("source", key, this.frameIndex);
    pg.push();
    pg.clear();
    this.safeDrawSourceToGraphics(pg, sourceFromPatchNode(node), component, componentTime, renderRequest);
    pg.pop();
    return pg;
  }

  safeDrawSourceToGraphics(pg, source, component, componentTime, renderRequest = frameRenderRequest(this.state.render), operation = null) {
    try {
      this.drawSourceToGraphics(pg, source, component, componentTime, renderRequest, operation);
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

  drawSourceToGraphics(pg, source, component, componentTime, renderRequest = frameRenderRequest(this.state.render), operation = null) {
    const rendererId = compiledVisualSourceRenderer(operation || {}, source);
    const method = SOURCE_HOST_METHODS[rendererId];
    if (!method || typeof this[method] !== "function") {
      console.error("[VJ1_SOURCE_RENDERER_MISSING]", { rendererId, sourceType: source.type || "unknown" });
      this.drawStandby(pg, `source renderer unavailable: ${source.type || "unknown"}`);
      return;
    }
    this[method](pg, source, component, componentTime, renderRequest, operation);
  }

  drawComponentReferenceSource(pg, source, component, componentTime, renderRequest) {
    const sourceComponent = this.state.components.find((item) => item.id === source.componentId);
    if (!sourceComponent || sourceComponent.id === component.id || sourceComponent.type === "scene") return;
    const sourceTime = this.componentTimes.get(sourceComponent.id) || componentTime;
    const renderIdentity = componentRenderInstanceKey(sourceComponent, source.instanceId);
    const view = renderView(pg, renderRequest);
    const placement = componentReferencePlacement(
      component,
      sourceComponent,
      this.state.render,
      view,
      source.placement
    );
    const placementTransform = combineContentTransforms(source.contentTransform, sourceComponent.transform);
    const demandRect = transformedPlacementDemandRect(placement, placementTransform);
    const coordinateFrame = { x: 0, y: 0, width: view.width, height: view.height };
    const viewport = {
      x: view.x,
      y: view.y,
      width: view.allocationWidth,
      height: view.allocationHeight,
    };
    const visiblePlacement = transformedRectBounds(
      coordinateFrame,
      placement,
      placementTransform
    );
    if (!rectsIntersect(visiblePlacement, viewport)) return;
    const referenceCount = componentReferenceCount(component, sourceComponent.id);
    const fullSourceRequest = componentReferenceRenderRequest(this.state.render, sourceComponent, demandRect, {
      reason: "component-reference",
      renderIdentity,
      sharedResolutionClass: sourceComponent.syncInstances !== false && referenceCount > 1,
    });
    // Small repeated synchronized references are cheaper as one shared full
    // texture: at these sizes p5/shader setup dominates fragment work. Large
    // references retain regional rendering so the previous multi-megapixel
    // allocation problem cannot return.
    const preferSharedTexture = componentReferencePrefersSharedTexture(sourceComponent, referenceCount, fullSourceRequest);
    const visibleRegion = renderRequest.regionView === true && !preferSharedTexture && this.componentRegionSafe(sourceComponent)
      ? transformedRectVisibleRegion(coordinateFrame, placement, placementTransform, viewport)
      : null;
    const sourceRequest = visibleRegion
      ? componentReferenceRegionRequest(fullSourceRequest, visibleRegion.uvRect, {
          reason: "component-reference-region",
        })
      : fullSourceRequest;
    const sourceOutput = this.renderComponentForRequest(
      sourceComponent,
      componentInstanceTime(sourceComponent, sourceTime, source.instanceId),
      sourceRequest
    );
    withRenderView(pg, renderRequest, () => {
      this.drawPlacedResultGeometry(pg, createPlacedRenderResult(sourceOutput, {
        destinationRect: visibleRegion?.destinationRect || placement,
        transform: placementTransform,
        sourceIsWebGL: this.isShaderBuffer(sourceOutput),
      }), view);
    });
  }

  drawMediaSource(pg, source, component, componentTime, renderRequest) {
    const playback = this.videoPlaybackOptions(source, component);
    const view = renderView(pg, renderRequest);
    // `renderView` has already expanded a clipped ROI back to the full physical
    // boundary. Do not carry the ROI UV rectangle into this second contract or
    // it would expand the demand twice.
    const qualityRequest = qualityScaledRenderRequest({
      width: view.width,
      height: view.height,
    }, source.params || {});
    const item = this.acquireMedia(source.mediaId, {
      playback,
      width: mediaSourceDemandWidth(qualityRequest, source),
    });
    if (item?.video && isDrawableMedia(item.video)) {
      drawWithContentTransform(pg, source.contentTransform, (view) => {
        drawMediaFit(pg, item.video, 0, 0, view.width, view.height, mediaSourceFit(source));
      }, renderRequest);
    }
    else if (item?.image && isDrawableMedia(item.image)) {
      const fit = mediaSourceFit(source);
      const renditionDemand = mediaSourceDemandSize(qualityRequest, source);
      const image = fit === "cover"
        ? this.getImageRendition(item, renditionDemand.width, renditionDemand.height) || item.image
        : item.image;
      drawWithContentTransform(pg, source.contentTransform, (renderView) => {
        drawMediaFit(pg, image, 0, 0, renderView.width, renderView.height, fit);
      }, renderRequest);
    }
    else if (item?.model || item?.modelData) {
      this.drawModelSource(pg, item, source, componentTime, renderRequest);
    }
    else if (item?.modelError) this.drawStandby(pg, `3D model error: ${item.modelError}`, { forceVisible: true });
    else if (item?.loadError || item?.imageError) this.drawStandby(pg, item?.loadError || "image load failed", { forceVisible: true });
    else if (item) this.drawStandby(pg, item.loadStatus || "loading media");
    else {
      this.requestMissingMedia(source.mediaId);
      this.drawStandby(pg, "media file not loaded");
    }
  }

  drawCameraSource(pg, source, _component, _componentTime, renderRequest) {
    const camera = this.acquireCameraInput();
    if (camera && isDrawableMedia(camera)) {
      drawWithContentTransform(pg, source.contentTransform, (view) => {
        drawCover(pg, camera, 0, 0, view.width, view.height);
      }, renderRequest);
    }
    else this.drawStandby(pg, this.cameraError || "camera");
  }

  drawBlackSource(pg) {
    pg.background(0);
  }

  drawGeneratorSource(pg, source, _component, componentTime, renderRequest, operation) {
    const generatorTime = instanceTime(source.instanceId || source.generatorId, componentTime);
    if (typeof operation?.nodeProcess === "function") {
      drawWithContentTransform(pg, source.contentTransform, (view) => {
        this.executeCompiledVisualNodeProcess(operation, pg, source, generatorTime, renderRequest, view);
      }, renderRequest);
      return;
    }
    const generatorComponent = this.generatorNodeComponent(source.generatorId);
    if (!generatorComponent) return;
    const nativeRenderer = compiledNativeSourceRenderer(operation || {}, source, generatorComponent);
    if (nativeRenderer && this.drawCompiledNativeSource(nativeRenderer, pg, source, generatorTime, renderRequest, operation)) return;
    const shaderGenerator = this.generatorShaderComponent(generatorComponent.id);
    if (shaderGenerator) {
      if (this.drawShaderGenerator(pg, source, generatorTime, renderRequest)) return;
      console.error("[VJ1_SHADER_GENERATOR_UNAVAILABLE]", {
        generatorId: source.generatorId,
        fallback: "transparent diagnostic standby",
      });
      this.drawStandby(pg, `shader unavailable: ${source.generatorId}`);
      return;
    }
    drawWithContentTransform(pg, source.contentTransform, (view) => {
      drawGenerator(pg, source.generatorId, generatorTime, source.params || {}, renderRequest, view);
    }, renderRequest);
  }

  executeCompiledVisualNodeProcess(operation, target, source, time, renderRequest, sourceRenderView = null) {
    let invocation = this.compiledNodeProcessContexts.get(operation);
    if (!invocation) {
      // One mutable invocation envelope per compiled operation avoids creating
      // frame-local wrapper objects while preserving the ordinary node process
      // signature used by editable project forks.
      invocation = {
        inputs: { source: null, params: null },
        context: {
          target: null,
          source: null,
          time: 0,
          renderRequest: null,
          renderView: null,
          executionClass: "live-frame",
          renderHost: this,
          // Stable capability bindings let direct nodes own their behavior
          // without importing application/output internals or allocating
          // frame-local adapters.
          acquireScreenInput: this.acquireScreenInput.bind(this),
          screenInputError: this.screenError.bind(this),
          isDrawableMedia,
          drawMediaFit,
          drawStandby: this.drawStandby.bind(this),
        },
      };
      this.compiledNodeProcessContexts.set(operation, invocation);
    }
    invocation.inputs.source = source;
    invocation.inputs.params = source.params || {};
    invocation.context.target = target;
    invocation.context.source = source;
    invocation.context.time = time;
    invocation.context.renderRequest = renderRequest;
    invocation.context.renderView = sourceRenderView || renderView(target, renderRequest);
    const result = operation.nodeProcess(invocation.inputs, invocation.context);
    if (result && typeof result.then === "function") {
      throw new Error(`VJ1_VISUAL_NODE_PROCESS_ASYNC:${operation.nodeProcessId || operation.nodeId || operation.id}`);
    }
    return result;
  }

  drawCompiledNativeSource(rendererId, pg, source, generatorTime, renderRequest, operation = null) {
    const method = NATIVE_SOURCE_HOST_METHODS[rendererId];
    if (method && typeof this[method] === "function") {
      this[method](pg, source, generatorTime, renderRequest, operation);
      return true;
    }
    if (BASIC_NATIVE_SOURCE_RENDERERS.has(rendererId)) {
      drawWithContentTransform(pg, source.contentTransform, (view) => {
        drawGenerator(pg, source.generatorId, generatorTime, source.params || {}, renderRequest, view);
      }, renderRequest);
      return true;
    }
    console.error("[VJ1_NATIVE_SOURCE_RENDERER_MISSING]", {
      rendererId,
      generatorId: source.generatorId,
    });
    this.drawStandby(pg, `native renderer unavailable: ${source.generatorId}`);
    return true;
  }

  drawScreenShareGenerator(pg, source = {}, _componentTime, renderRequest) {
    const inputId = String(source.params?.inputId || "");
    const screen = this.acquireScreenInput(inputId);
    if (!screen || !isDrawableMedia(screen)) {
      this.drawStandby(pg, this.screenError(inputId) || "screen share unavailable", { forceVisible: true });
      return;
    }
    const fit = ["contain", "cover", "stretch"].includes(source.params?.fit) ? source.params.fit : "contain";
    drawWithContentTransform(pg, source.contentTransform, (view) => {
      pg.push();
      if (source.params?.mirrored === true) {
        pg.translate(view.width, 0);
        pg.scale(-1, 1);
      }
      drawMediaFit(pg, screen, 0, 0, view.width, view.height, fit);
      pg.pop();
    }, renderRequest);
  }

  drawStandby(target, label, { forceVisible = false } = {}) {
    const transient = /loading|reading|processing|checking|preparing|matching|finding|not loaded/i.test(String(label || ""));
    const debugVisible = this.state?.ui?.debugPreview !== false;
    drawStandby(target, label, {
      visible: debugVisible || (forceVisible && this.mode !== "output"),
      frame: this.frameIndex,
      graceMs: transient ? 1000 : 0,
    });
  }

  componentHasPendingAssets(component, seen = new Set()) {
    if (!component?.id || seen.has(component.id)) return false;
    seen.add(component.id);
    const pending = (component.chain || []).some((item) => this.chainItemHasPendingAssets(item, seen));
    seen.delete(component.id);
    return pending;
  }

  chainItemHasPendingAssets(item, seen) {
    if (!item || item.enabled === false) return false;
    if (item.kind === "group") return (item.chain || []).some((child) => this.chainItemHasPendingAssets(child, seen));
    if (item.kind !== "source") return false;
    const source = item.source || {};
    if (source.type === "component") {
      const dependency = this.state?.components?.find((component) => component.id === source.componentId);
      return dependency ? this.componentHasPendingAssets(dependency, seen) : false;
    }
    if (source.type === "camera" || source.type === "media") {
      return source.type === "camera"
        ? !isDrawableMedia(this.acquireCameraInput())
        : !isReadyMediaItem(this.acquireMedia(source.mediaId));
    }
    if (source.type !== "generator") return false;
    const params = source.params || {};
    if (source.generatorId === "tileTexture") return !!params.imageId && !isReadyMediaItem(this.acquireMedia(params.imageId));
    const pairs = this.featureMorphPairService(source.generatorId);
    if (!pairs) return false;
    const imageA = this.acquireMedia(params.imageAId);
    const imageB = this.acquireMedia(params.imageBId);
    if (!isReadyMediaItem(imageA) || !isReadyMediaItem(imageB)) return true;
    const status = pairs.status(params, { imageAFile: imageA.file, imageBFile: imageB.file });
    return status === "idle" || status === "loading";
  }

  drawFeatureMorphGenerator(pg, source = {}, componentTime = this.visualTime, renderRequest = frameRenderRequest(this.state.render), operation = null) {
    return this.specializedSources.drawFeatureMorph(pg, source, componentTime, {
      ...renderRequest,
      pixelDensity: this.requestPixelDensity(renderRequest),
    }, operation);
  }

  drawTileTextureGenerator(pg, source = {}, componentTime = this.visualTime, renderRequest = frameRenderRequest(this.state.render), operation = null) {
    return this.specializedSources.drawTileTexture(pg, source, componentTime, {
      ...renderRequest,
      pixelDensity: this.requestPixelDensity(renderRequest),
    }, operation);
  }

  drawTextGenerator(pg, source = {}, componentTime = this.visualTime, renderRequest = frameRenderRequest(this.state.render), operation = null) {
    return this.specializedSources.drawText(pg, source, componentTime, {
      ...renderRequest,
      pixelDensity: this.requestPixelDensity(renderRequest),
    }, operation);
  }

  drawMeshPatternsGenerator(pg, source = {}, componentTime = this.visualTime, renderRequest = frameRenderRequest(this.state.render), operation = null) {
    return this.specializedSources.drawMeshPatterns(pg, source, componentTime, {
      ...renderRequest,
      pixelDensity: this.requestPixelDensity(renderRequest),
    }, operation);
  }

  drawAnatomyGenerator(pg, source = {}, componentTime = this.visualTime, renderRequest = frameRenderRequest(this.state.render), operation = null) {
    return this.specializedSources.drawAnatomy(pg, source, componentTime, {
      ...renderRequest,
      pixelDensity: this.requestPixelDensity(renderRequest),
    }, operation);
  }

  drawTerrainGenerator(pg, source = {}, componentTime = this.visualTime, renderRequest = frameRenderRequest(this.state.render), operation = null) {
    return this.specializedSources.drawTerrain(pg, source, componentTime, {
      ...renderRequest,
      pixelDensity: this.requestPixelDensity(renderRequest),
    }, operation);
  }

  drawModelSource(pg, item, source = {}, componentTime = this.visualTime, renderRequest = frameRenderRequest(this.state.render)) {
    return this.specializedSources.drawModel(pg, item, source, componentTime, {
      ...renderRequest,
      pixelDensity: this.requestPixelDensity(renderRequest),
    });
  }

  continuousRateTime(key, baseTime, rate) {
    return this.specializedSources.continuousRateTime(key, baseTime, rate);
  }

  getModelTarget(width, height, density = this.renderPixelDensity(this.state?.render || {})) {
    return this.specializedSources.getModelTarget(width, height, density);
  }

  getTerrainTarget(width, height, density = this.renderPixelDensity(this.state?.render || {})) {
    return this.specializedSources.getTerrainTarget(width, height, density);
  }

  getSpecializedWebglTarget(kind, width, height, density = this.renderPixelDensity(this.state?.render || {}), options = {}) {
    return this.specializedSources.getTarget(kind, width, height, density, options);
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
    const generatorComponent = this.generatorNodeComponent(id);
    if (!generatorComponent) return null;
    const generatorId = generatorComponent.id;
    const shaderComponent = this.generatorShaderComponent(generatorId);
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
    const generatorUniformKey = `${generatorId}:${instanceId || generatorId}`;
    const generatorUniformState = contentTransformUvMatrices(
      contentTransform,
      this.generatorUniformStates.get(generatorUniformKey)
    );
    generatorUniformState.resolution ||= [0, 0];
    generatorUniformState.iResolution ||= [0, 0, 1];
    generatorUniformState.iMouse ||= [0, 0, 0, 0];
    generatorUniformState.iDate ||= [0, 0, 0, 0];
    this.generatorUniformStates.set(generatorUniformKey, generatorUniformState);
    this.generatorUniformStateUse.set(generatorUniformKey, this.frameIndex);
    const drawingSize = shaderDrawingBufferSize(target, renderRequest.width, renderRequest.height);
    const sourceDetail = renderSourceDetail(drawingSize, renderRequest, {
      contentScale: contentTransform?.scale,
    });
    if (this.isfNeedsPassRuntime(component)) {
      return this.renderIsfProgram({
        component,
        shader,
        finalTarget: target,
        renderRequest,
        timeSeconds: shaderTime,
        params: shaderParams,
        instanceId: instanceId || generatorId,
        contentMatrix: generatorUniformState.sampling,
        useContentTransform: !isIdentityTransform(contentTransform),
        sourceDetail,
      });
    }
    const started = this.collectDetailedProfile ? performance.now() : 0;
    const sample = this.collectDetailedProfile ? {
      type: "shader-generator",
      passId: generatorId,
      passName: component.name || generatorId,
      ...this.activeComponentProfileIdentity(),
      width: renderRequest.width,
      height: renderRequest.height,
      ms: 0,
    } : null;
    const gpuToken = this.gpuTimer.begin(target, this.frameIndex);
    try {
      drawShaderTarget(target, () => {
      clearShaderTarget(target);
      applyShaderTarget(target, shader);
      const contentMatrix = generatorUniformState.sampling;
      setShaderUniformIfPresent(shader, "useContentTransform", isIdentityTransform(contentTransform) ? 0 : 1);
      setShaderUniformIfPresent(shader, "contentUvMatrix", contentMatrix);
      setShaderUniformIfPresent(shader, "renderUvRect", renderRequest.uvRect || FULL_RENDER_UV_RECT);
      const shadertoyInterface = usesShadertoyInterface(component);
      const isfInterface = component.type === "isf";
      if (shadertoyInterface) {
        const now = new Date();
        generatorUniformState.iResolution[0] = Math.max(1, sourceDetail.width);
        generatorUniformState.iResolution[1] = Math.max(1, sourceDetail.height);
        generatorUniformState.iResolution[2] = 1;
        setShaderUniformIfPresent(shader, "iResolution", generatorUniformState.iResolution);
        setShaderUniformIfPresent(shader, "iTime", shaderTime);
        setShaderUniformIfPresent(shader, "iTimeDelta", this.visualDeltaSeconds);
        setShaderUniformIfPresent(shader, "iFrame", this.frameIndex);
        setShaderUniformIfPresent(shader, "iFrameRate", frameRate());
        setShaderUniformIfPresent(shader, "iMouse", generatorUniformState.iMouse);
        generatorUniformState.iDate[0] = now.getFullYear();
        generatorUniformState.iDate[1] = now.getMonth() + 1;
        generatorUniformState.iDate[2] = now.getDate();
        generatorUniformState.iDate[3] = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
        setShaderUniformIfPresent(shader, "iDate", generatorUniformState.iDate);
      } else if (isfInterface) {
        this.setIsfFrameUniforms(shader, component, {
          renderRequest,
          timeSeconds: shaderTime,
          params: shaderParams,
          generatorUniformState,
          sourceDetail,
        });
      } else {
        generatorUniformState.resolution[0] = Math.max(1, sourceDetail.width);
        generatorUniformState.resolution[1] = Math.max(1, sourceDetail.height);
        shader.setUniform("resolution", generatorUniformState.resolution);
        setShaderUniformIfPresent(shader, "time", shaderTime);
      }
      this.setShaderParamUniforms(shader, component, shaderParams, {
        setDefaultAmount: false,
        onlyPresent: shadertoyInterface || isfInterface || generatorId === "eyeball",
      });
      if (generatorId === "eyeball") {
        const eyeKey = instanceId || generatorId;
        const eye = eyeballFrameUniforms(shaderTime, shaderParams, this.eyeballUniformFrames.get(eyeKey));
        this.eyeballUniformFrames.set(eyeKey, eye);
        this.eyeballUniformFrameUse.set(eyeKey, this.frameIndex);
        setDynamicShaderUniformIfPresent(shader, "eyeGazeDir", eye.gazeDir);
        setDynamicShaderUniformIfPresent(shader, "eyeIrisRight", eye.irisRight);
        setDynamicShaderUniformIfPresent(shader, "eyeIrisUp", eye.irisUp);
        setShaderUniformIfPresent(shader, "eyeBlink", eye.blink);
      }
      drawShaderTargetRect(target, renderRequest.width, renderRequest.height);
      resetShaderTarget(target);
      });
    } finally {
      this.gpuTimer.end(gpuToken);
      if (sample) {
        sample.ms = roundMetric(performance.now() - started);
        this.frameProfile.passSamples.push(sample);
      }
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
    this.renderCache.touch("buffer", key, this.frameIndex);
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
    this.renderCache.touch("gpu-buffer", key, this.frameIndex);
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

  getIsfPassTarget(component, instanceId, pass, widthPx, heightPx) {
    const floatFormat = pass.float ? globalThis.FLOAT : null;
    if (pass.float && floatFormat == null) {
      console.error("[VJ1_ISF_FLOAT_TARGET_UNAVAILABLE]", {
        shader: component?.id || "",
        pass: pass.target || pass.index,
        message: "This ISF requires floating-point framebuffer support.",
      });
      return null;
    }
    const key = `${component?.id || "isf"}:${component?.isf?.sourceHash || ""}:${instanceId || "shared"}:${pass.target}`;
    let entry = this.isfPassTargets.get(key);
    const targetCount = pass.persistent ? 2 : 1;
    if (entry && (entry.width !== widthPx || entry.height !== heightPx || entry.float !== !!pass.float || entry.targets.length !== targetCount)) {
      for (const target of entry.targets) disposeGraphics(target);
      this.isfPassTargets.delete(key);
      entry = null;
    }
    if (!entry) {
      const targets = [];
      for (let index = 0; index < targetCount; index++) {
        const target = createSharedFramebufferTarget(widthPx, heightPx, { format: floatFormat });
        if (!target) {
          for (const created of targets) disposeGraphics(created);
          return null;
        }
        drawShaderTarget(target, () => clearShaderTarget(target));
        targets.push(target);
      }
      entry = { targets, width: widthPx, height: heightPx, float: !!pass.float, current: 0, lastUsed: this.frameIndex };
      this.isfPassTargets.set(key, entry);
    }
    entry.lastUsed = this.frameIndex;
    return entry;
  }

  pruneIsfPassTargets(maxIdleFrames = 600) {
    for (const [key, entry] of this.isfPassTargets) {
      if (this.frameIndex - entry.lastUsed <= maxIdleFrames) continue;
      for (const target of entry.targets) disposeGraphics(target);
      this.isfPassTargets.delete(key);
    }
  }

  normalizeRenderRequest(request, role = "texture") {
    if (request && typeof request === "object") {
      return createRenderRequest(request.role || role, request, request);
    }
    return createRenderRequest(role, frameSize(this.state?.render || {}));
  }

  pruneRenderCaches() {
    if (!this.renderCache.prune(this.frameIndex)) return;
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
    for (const [key, lastUsed] of this.eyeballUniformFrameUse) {
      if (this.frameIndex - lastUsed <= RENDER_CACHE_IDLE_FRAMES) continue;
      this.eyeballUniformFrameUse.delete(key);
      this.eyeballUniformFrames.delete(key);
    }
    for (const [key, lastUsed] of this.generatorUniformStateUse) {
      if (this.frameIndex - lastUsed <= RENDER_CACHE_IDLE_FRAMES) continue;
      this.generatorUniformStateUse.delete(key);
      this.generatorUniformStates.delete(key);
    }
    this.pruneIsfPassTargets(RENDER_CACHE_IDLE_FRAMES);
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
    const placement = contentTransformCanvasPlacement(transform, output.width, output.height);
    output.imageMode(CENTER);
    output.translate(placement.centerX, placement.centerY);
    output.rotate(placement.rotation);
    output.scale(placement.scale);
    if (this.isShaderBuffer(source)) {
      drawBuffer(output, source, -output.width / 2, -output.height / 2, output.width, output.height, true);
    } else {
      output.image(source, 0, 0, output.width, output.height);
    }
    output.imageMode(CORNER);
  }

  isfNeedsPassRuntime(component) {
    const passes = component?.isf?.passes || [];
    return passes.length > 1 || passes.some((pass) =>
      pass.target || pass.persistent || pass.float || pass.width !== "$WIDTH" || pass.height !== "$HEIGHT"
    );
  }

  renderIsfProgram({
    component,
    shader,
    input = null,
    finalTarget,
    renderRequest,
    timeSeconds,
    params = {},
    instanceId = "",
    contentMatrix = null,
    useContentTransform = false,
    effectTransform = null,
    sourceDetail = null,
  }) {
    const passes = component?.isf?.passes || [];
    if (!passes.length || !shader || !finalTarget) return null;
    const baseWidth = Math.max(1, Number(renderRequest.width) || 1);
    const baseHeight = Math.max(1, Number(renderRequest.height) || 1);
    const dimensionValues = { WIDTH: baseWidth, HEIGHT: baseHeight };
    for (const param of component.params || []) {
      if (Number.isInteger(param.isfVectorIndex)) continue;
      const normalized = normalizeParamValue(param, params[param.id]);
      dimensionValues[param.id] = param.type === "enum" && Array.isArray(param.isfValues)
        ? Number(param.isfValues[enumUniform(param, normalized)]) || 0
        : Number(normalized) || 0;
    }
    const targetTextures = new Map();
    let result = finalTarget;
    for (let index = 0; index < passes.length; index++) {
      const pass = passes[index];
      const finalPass = index === passes.length - 1;
      let widthPx;
      let heightPx;
      try {
        widthPx = evaluateIsfDimension(pass.width, dimensionValues);
        heightPx = evaluateIsfDimension(pass.height, dimensionValues);
      } catch (error) {
        console.error("[VJ1_ISF_PASS_SIZE_FAILED]", {
          shader: component.id,
          pass: pass.target || index,
          message: error?.message || String(error),
        });
        return null;
      }
      let destination = finalTarget;
      let passEntry = null;
      if (pass.target) {
        passEntry = this.getIsfPassTarget(component, instanceId, pass, widthPx, heightPx);
        if (!passEntry) return null;
        if (pass.persistent) targetTextures.set(pass.target, passEntry.targets[passEntry.current]);
        destination = pass.persistent
          ? passEntry.targets[passEntry.current === 0 ? 1 : 0]
          : passEntry.targets[0];
      } else if (widthPx !== finalTarget.width || heightPx !== finalTarget.height) {
        const finalBufferPass = { ...pass, target: "__vj1FinalPass", persistent: false };
        passEntry = this.getIsfPassTarget(component, instanceId, finalBufferPass, widthPx, heightPx);
        if (!passEntry) return null;
        destination = passEntry.targets[0];
      }
      const passRequest = {
        ...renderRequest,
        width: widthPx,
        height: heightPx,
        logicalWidth: widthPx,
        logicalHeight: heightPx,
      };
      const drawPass = () => drawShaderTarget(destination, () => {
        clearShaderTarget(destination);
        applyShaderTarget(destination, shader);
        setShaderUniformIfPresent(shader, "renderUvRect", renderRequest.uvRect || FULL_RENDER_UV_RECT);
        if (contentMatrix) setShaderUniformIfPresent(shader, "contentUvMatrix", contentMatrix);
        setShaderUniformIfPresent(shader, "useContentTransform", useContentTransform ? 1 : 0);
        if (effectTransform) this.setEffectInfrastructureUniforms(shader, effectTransform);
        this.setIsfFrameUniforms(shader, component, {
          input,
          renderRequest: passRequest,
          timeSeconds,
          params,
          passIndex: index,
          targetTextures,
          sourceDetail: finalPass ? sourceDetail : null,
        });
        setShaderUniformIfPresent(shader, "vj1IsfFinalPass", finalPass);
        this.setShaderParamUniforms(shader, component, params, { onlyPresent: true });
        drawShaderTargetRect(destination, widthPx, heightPx);
        resetShaderTarget(destination);
      });
      this.measureShaderPass({ id: component.id, instanceId }, component, passRequest, {
        handoff: false,
        sourceIsShaderBuffer: this.isShaderBuffer(input),
        targetSlot: -1,
      }, destination, drawPass);
      if (passEntry && pass.target) {
        if (pass.persistent) passEntry.current = passEntry.current === 0 ? 1 : 0;
        targetTextures.set(pass.target, destination);
      }
      result = destination;
    }
    return result;
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
    const logicalSchedule = compileShaderSchedule(chain, this.visualResolverOptions);
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
      if (!job.fused && this.isfNeedsPassRuntime(job.component)) {
        const rendered = this.renderIsfProgram({
          component: job.component,
          shader,
          input: current,
          finalTarget: target,
          renderRequest,
          timeSeconds: instanceTime(pass.instanceId || pass.id, timeSeconds),
          params: pass.params,
          instanceId: pass.instanceId || pass.id,
          effectTransform: pass.transform,
        });
        if (rendered) {
          current = rendered;
          passCount++;
        }
        continue;
      }
      this.measureShaderPass(pass, job.component, renderRequest, {
        handoff,
        sourceIsShaderBuffer,
        targetSlot: this.fxTargets?.[1] === target ? 1 : 0,
      }, target, () => {
        drawShaderTarget(target, () => {
        clearShaderTarget(target);
        applyShaderTarget(target, shader);
        const isfInterface = job.component?.type === "isf";
        if (isfInterface) {
          setShaderUniformIfPresent(shader, "renderUvRect", renderRequest.uvRect || FULL_RENDER_UV_RECT);
        } else {
          shader.setUniform("tex0", unwrapRenderTarget(current));
          shader.setUniform("resolution", [logicalWidth, logicalHeight]);
          shader.setUniform("renderUvRect", renderRequest.uvRect || FULL_RENDER_UV_RECT);
          shader.setUniform("canvasSize", [logicalWidth, logicalHeight]);
          shader.setUniform("texelSize", [1 / logicalWidth, 1 / logicalHeight]);
          shader.setUniform("sourceFlipY", !sourceIsShaderBuffer);
          shader.setUniform("sourceForceOpaque", false);
        }
        if (job.fused) this.setFusedShaderUniforms(shader, job.jobs, timeSeconds);
        else {
          const passTime = instanceTime(pass.instanceId || pass.id, timeSeconds);
          if (isfInterface) setShaderUniformIfPresent(shader, "time", passTime);
          else shader.setUniform("time", passTime);
          this.setEffectInfrastructureUniforms(shader, pass.transform);
          if (job.component?.type === "isf") {
            this.setIsfFrameUniforms(shader, job.component, {
              input: current,
              renderRequest,
              timeSeconds: passTime,
              params: pass.params,
            });
          }
          setShaderUniformIfPresent(shader, "vj1IsfFinalPass", true);
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
    const job = compileShaderSchedule([pass], this.visualResolverOptions)[0];
    if (!job || job.pass.amount <= 0.0001) return input;
    const shaderProgram = this.shaderBuilder.getShader(job.pass, target);
    if (!shaderProgram) return input;
    if (this.isfNeedsPassRuntime(job.component)) {
      return this.renderIsfProgram({
        component: job.component,
        shader: shaderProgram,
        input,
        finalTarget: target,
        renderRequest,
        timeSeconds: instanceTime(job.pass.instanceId || job.pass.id, timeSeconds),
        params: job.pass.params,
        instanceId: job.pass.instanceId || job.pass.id,
        effectTransform: job.pass.transform,
      }) || input;
    }
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
        const isfInterface = job.component?.type === "isf";
        if (isfInterface) {
          setShaderUniformIfPresent(shaderProgram, "renderUvRect", renderRequest.uvRect || FULL_RENDER_UV_RECT);
        } else {
          shaderProgram.setUniform("tex0", unwrapRenderTarget(input));
          shaderProgram.setUniform("resolution", [logicalWidth, logicalHeight]);
          shaderProgram.setUniform("renderUvRect", renderRequest.uvRect || FULL_RENDER_UV_RECT);
          shaderProgram.setUniform("canvasSize", [logicalWidth, logicalHeight]);
          shaderProgram.setUniform("texelSize", [1 / logicalWidth, 1 / logicalHeight]);
          shaderProgram.setUniform("sourceFlipY", !sourceIsShaderBuffer);
          shaderProgram.setUniform("sourceForceOpaque", false);
        }
        const passTime = instanceTime(job.pass.instanceId || job.pass.id, timeSeconds);
        if (isfInterface) setShaderUniformIfPresent(shaderProgram, "time", passTime);
        else shaderProgram.setUniform("time", passTime);
        this.setEffectInfrastructureUniforms(shaderProgram, job.pass.transform);
        if (job.component?.type === "isf") {
          this.setIsfFrameUniforms(shaderProgram, job.component, {
            input,
            renderRequest,
            timeSeconds: passTime,
            params: job.pass.params,
          });
        }
        setShaderUniformIfPresent(shaderProgram, "vj1IsfFinalPass", true);
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
    this.frameProfile.shaderPasses++;
    if (meta.handoff) this.frameProfile.shaderHandoffs++;
    if (!this.collectDetailedProfile) return this.measureGpu(target, drawPass);
    const item = {
      type: "shader-pass",
      passId: pass.id || "",
      chainItemId: pass.instanceId || "",
      implementationId: pass.id || "",
      passName: component?.name || pass.id || "Shader",
      ...this.activeComponentProfileIdentity(),
      width: renderRequest.width,
      height: renderRequest.height,
      pixels: renderRequest.width * renderRequest.height,
      source: meta.sourceIsShaderBuffer ? "webgl" : "drawable",
      targetSlot: meta.targetSlot,
      handoff: !!meta.handoff,
      ms: 0,
    };
    const started = performance.now();
    const result = this.measureGpu(target, drawPass);
    item.ms = performance.now() - started;
    this.frameProfile.shaderMs += item.ms;
    this.frameProfile.passSamples.push(item);
    return result;
  }

  measureProfile(bucket, meta, fn) {
    return this.profileRuntime.measure(bucket, meta, fn);
  }

  measureComponentProfile(meta, fn) {
    return this.profileRuntime.measureComponent(meta, fn);
  }

  activeComponentProfileIdentity() {
    return this.profileRuntime.activeComponentIdentity();
  }

  finishFrameProfile() {
    return this.profileRuntime.finishFrame(this.frameStart);
  }

  renderShaderNodes(input, nodes, request = frameRenderRequest(this.state.render), timeSeconds = this.visualTime) {
    return this.renderShaderChain(input, nodes.map(shaderPassFromNode), request, timeSeconds);
  }

  setShaderParamUniforms(shader, component, params = {}, options = {}) {
    const vectors = new Map();
    for (const param of component?.params || []) {
      const value = normalizeParamValue(param, params[param.id]);
      const uniformId = `${options.uniformPrefix || ""}${param.id}`;
      if (Number.isInteger(param.isfVectorIndex) && param.isfUniform) {
        const vectorUniform = `${options.uniformPrefix || ""}${param.isfUniform}`;
        const vector = vectors.get(vectorUniform) || [0, 0];
        vector[param.isfVectorIndex] = Number(value) || 0;
        vectors.set(vectorUniform, vector);
        continue;
      }
      if (options.onlyPresent && !shader?.uniforms?.[uniformId]) continue;
      if (param.type === "boolean") {
        shader.setUniform(uniformId, value !== false);
      } else if (param.type === "color") {
        shader.setUniform(uniformId, colorUniform(value));
      } else if (param.type === "enum") {
        const enumIndex = enumUniform(param, value);
        shader.setUniform(uniformId, Array.isArray(param.isfValues) ? Number(param.isfValues[enumIndex]) || 0 : enumIndex);
      } else {
        shader.setUniform(uniformId, Number(value) || 0);
      }
    }
    for (const [uniformId, vector] of vectors) {
      if (!options.onlyPresent || shader?.uniforms?.[uniformId]) shader.setUniform(uniformId, vector);
    }
    if (options.setDefaultAmount !== false && !component?.params?.some((param) => param.id === "amount")) {
      shader.setUniform(`${options.uniformPrefix || ""}amount`, 0);
    }
  }

  setIsfFrameUniforms(shader, component, {
    input = null,
    renderRequest = {},
    timeSeconds = this.visualTime,
    params = {},
    passIndex = 0,
    generatorUniformState = null,
    targetTextures = null,
    sourceDetail = null,
  } = {}) {
    const logicalWidth = Math.max(1, Number(sourceDetail?.width) || Number(renderRequest.logicalWidth) || Number(renderRequest.width) || 1);
    const logicalHeight = Math.max(1, Number(sourceDetail?.height) || Number(renderRequest.logicalHeight) || Number(renderRequest.height) || 1);
    const now = new Date();
    const date = generatorUniformState?.iDate || this.isfDateUniform;
    date[0] = now.getFullYear();
    date[1] = now.getMonth() + 1;
    date[2] = now.getDate();
    date[3] = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds() + now.getMilliseconds() / 1000;
    setShaderUniformIfPresent(shader, "TIME", timeSeconds);
    setShaderUniformIfPresent(shader, "TIMEDELTA", this.visualDeltaSeconds);
    setShaderUniformIfPresent(shader, "FRAMEINDEX", this.frameIndex);
    setShaderUniformIfPresent(shader, "PASSINDEX", passIndex);
    setShaderUniformIfPresent(shader, "DATE", date);
    setShaderUniformIfPresent(shader, "RENDERSIZE", [logicalWidth, logicalHeight]);
    setShaderUniformIfPresent(shader, "vj1IsfFinalPass", true);
    if (input) {
      setShaderUniformIfPresent(shader, "inputImage", unwrapRenderTarget(input));
      setShaderUniformIfPresent(shader, "inputImage_imgSize", [Math.max(1, input.width || logicalWidth), Math.max(1, input.height || logicalHeight)]);
    }
    for (const [name, texture] of targetTextures || []) {
      if (!texture) continue;
      setShaderUniformIfPresent(shader, name, unwrapRenderTarget(texture));
      setShaderUniformIfPresent(shader, `${name}_imgSize`, [Math.max(1, texture.width || 1), Math.max(1, texture.height || 1)]);
    }
    // Parameter normalization remains centralized in the normal component
    // uniform path; this call is intentionally limited to the ISF host API.
    void component;
    void params;
  }

  renderSurfaces() { return this.surfaceRuntime.renderSurfaces(); }

  renderMappingSurfaces() { return this.surfaceRuntime.renderMappingSurfaces(); }

  currentLiveTransition(nowMs = Date.now()) { return this.surfaceRuntime.currentLiveTransition(nowMs); }

  renderTransitionSurfaces(transition) { return this.surfaceRuntime.renderTransitionSurfaces(transition); }

  renderTransitionRouteTextures(routes, renderState, side) { return this.surfaceRuntime.renderTransitionRouteTextures(routes, renderState, side); }

  getTransitionSurfaceTexture(side, surfaceId, request = stableSurfaceRenderRequest(this.state?.render || {})) {
    return this.surfaceRuntime.getTransitionSurfaceTexture(side, surfaceId, request);
  }

  getTransparentTransitionTexture(side, surfaceId, request) { return this.surfaceRuntime.getTransparentTransitionTexture(side, surfaceId, request); }

  releaseTransitionSurfaceTextures() { return this.surfaceRuntime.releaseTransitionSurfaceTextures(); }

  withRenderState(renderState, callback) { return this.surfaceRuntime.withRenderState(renderState, callback); }

  withSurfaceRenderIdentityPrefix(prefix, callback) { return this.surfaceRuntime.withSurfaceRenderIdentityPrefix(prefix, callback); }

  buildSurfaceRenderPlan() { return this.surfaceRuntime.buildSurfaceRenderPlan(); }

  getSurfaceTexture(request = stableSurfaceRenderRequest(this.state?.render || {})) { return this.surfaceRuntime.getSurfaceTexture(request); }

  drawDirectSurfaceTexture(texture, route = {}, alpha = 1) { return this.surfaceRuntime.drawDirectSurfaceTexture(texture, route, alpha); }

  canDirectProjectSurfaceRoute(route = {}, outputBlackout = false) { return this.surfaceRuntime.canDirectProjectSurfaceRoute(route, outputBlackout); }

  renderSurfaceRouteView(route = {}) { return this.surfaceRuntime.renderSurfaceRouteView(route); }

  drawSurfaceRouteView(view, route = {}) { return this.surfaceRuntime.drawSurfaceRouteView(view, route); }

  drawSurfaceRouteViewBatch(items = [], blend = "normal") { return this.surfaceRuntime.drawSurfaceRouteViewBatch(items, blend); }

  drawDirectSurfaceView(view, route = {}, opacity = 1) { return this.surfaceRuntime.drawDirectSurfaceView(view, route, opacity); }

  drawSurfaceRoute(pg, route = {}) { return this.surfaceRuntime.drawSurfaceRoute(pg, route); }

  drawSurfaceThumbnailRoute(pg, surface, demand = null) { return this.surfaceRuntime.drawSurfaceThumbnailRoute(pg, surface, demand); }

  getThumbnailImage(component) {
    return this.thumbnailRuntime.getThumbnailImage(component);
  }

  captureThumbnailEditTransformBaselines() {
    return this.thumbnailRuntime.captureEditTransformBaselines();
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
    return this.mediaRuntime.requestMissingMedia(mediaId);
  }

  requestMissingMediaBatch(mediaIds = []) {
    return this.mediaRuntime.requestMissingMediaBatch(mediaIds);
  }

  getImageRendition(item, rw, rh) {
    return this.mediaRuntime.getImageRendition(item, rw, rh);
  }

  queueMediaRenditionSave(mediaId, widthPx, heightPx, pg, sourceRevision = "") {
    return this.mediaRuntime.queueMediaRenditionSave(mediaId, widthPx, heightPx, pg, sourceRevision);
  }

  renderComponentPreview() {
    const componentId = this.state.ui.selectedComponentId || this.state.components[0]?.id || "";
    const component = this.state.components.find((item) => item.id === componentId);
    const source = this.componentOutput.get(componentId);
    resetShader();
    push();
    imageMode(CORNER);
    if (this.shouldUseThumbnailPreview()) {
      // A Scene thumbnail is the flattened composition authority. Never
      // synthesize one from child thumbnails: that omits media, effects, and
      // route context. The thumbnail runtime keeps the last valid snapshot
      // published until its replacement succeeds.
      const drewSceneSnapshot = component?.type === "scene" && this.renderSceneThumbnailSnapshotPreview(component);
      if (!drewSceneSnapshot && component?.type !== "scene") this.renderFlattenedThumbnailEditPreview(component);
    } else if (source) {
      const rect = this.componentPreviewRect(component, source);
      image(unwrapRenderTarget(source), rect.x - width / 2, rect.y - height / 2, rect.width, rect.height);
    } else {
      const fallback = this.mainMix;
      image(unwrapRenderTarget(fallback), -width / 2, -height / 2, width, height);
    }
    pop();
    this.renderComponentFrameOverlay(component, source);
    this.renderSceneFrames(component, source);
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
    const editPlacement = contentTransformCanvasPlacement({
      x: current.x - baseline.x,
      y: current.y - baseline.y,
    }, rect.width, rect.height);
    withScreenScissor(rect, () => {
      push();
      translate(rect.x - width * 0.5 + editPlacement.centerX, rect.y - height * 0.5 + editPlacement.centerY);
      rotate(current.rotation - baseline.rotation);
      scale(editScale);
      drawImageCoverCrop(thumbnail.img, -rect.width * 0.5, -rect.height * 0.5, rect.width, rect.height);
      pop();
    }, this.previewViewportTransform());
    return true;
  }

  renderSceneThumbnailSnapshotPreview(component) {
    const thumbnail = this.getThumbnailImage(component);
    if (!thumbnail?.ready || !thumbnail.img) return false;
    const rect = this.componentPreviewRect(component);
    withScreenScissor(rect, () => {
      drawImageCoverCrop(
        thumbnail.img,
        rect.x - width * 0.5,
        rect.y - height * 0.5,
        rect.width,
        rect.height
      );
    }, this.previewViewportTransform());
    return true;
  }

  componentPreviewRect(component, source = null) {
    return componentLogicalPreviewRect(this.state?.render || {}, component || {}, width, height, {
      sceneEditorWorld: this.mode === "component" && this.state?.ui?.workspace === "scene",
    });
  }

  renderComponentFrameOverlay(component, source = null) {
    return this.previewInteraction.renderComponentFrameOverlay(component, source);
  }

  renderSceneFrames(component, source = null) {
    return this.previewInteraction.renderSceneFrames(component, source);
  }

  sceneFrameRects(component, source = null) {
    return this.previewInteraction.sceneFrameRects(component, source);
  }

  renderSelectedChainTransformOverlay() {
    return this.previewInteraction.renderSelectedChainTransformOverlay();
  }

  setCalibrate(on) {
    const enabled = this.mode !== "output" && !!on;
    if (this.state?.global) this.state.global.calibrating = enabled;
    this.mapper?.setCalibrate(enabled);
  }

  mousePressed(x, y) {
    const point = this.previewDisplayPointToWorld({ x, y });
    return this.previewInteraction.mousePressed(point.x, point.y);
  }

  mouseDragged(x, y) {
    const point = this.previewDisplayPointToWorld({ x, y });
    return this.previewInteraction.mouseDragged(point.x, point.y);
  }

  mouseReleased() {
    const mappingWasActive = !!this.mapper?.isActive?.();
    const result = this.previewInteraction.mouseReleased();
    if (mappingWasActive && this.surfaceRebuildPending) {
      this.surfaceRebuildPending = false;
      this.rebuildSurfaces({ preferExistingMapping: true });
      const signature = this.currentMappingSignature();
      if (!this.shouldIgnoreIncomingMapping(signature)) this.applyProjectMapping(signature);
    }
    return result;
  }

  startSceneFrameDrag(x, y) {
    return this.previewInteraction.startSceneFrameDrag(x, y);
  }

  updateSceneFrameDrag(x, y) {
    return this.previewInteraction.updateSceneFrameDrag(x, y);
  }

  applyLocalSceneFrame(componentId, frameId, rect) {
    return this.previewInteraction.applyLocalSceneFrame(frameId, rect);
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
    return this.previewInteraction.selectedTransformableChainItem();
  }

  chainItemAtPoint(x, y) {
    return this.previewInteraction.chainItemAtPoint(x, y);
  }

  selectChainItemAtPoint(x, y, knownHit = null) {
    return this.previewInteraction.selectChainItemAtPoint(x, y, knownHit);
  }

  selectedChildOwnsGroupDrag(hit, x, y) {
    return this.previewInteraction.selectedChildOwnsGroupDrag(hit, x, y);
  }

  chainItemBaseRect(component, item, frame) {
    return this.previewInteraction.chainItemBaseRect(component, item, frame);
  }

  chainItemPreviewGeometry(component, item) {
    return this.previewInteraction.chainItemPreviewGeometry(component, item);
  }

  startChainTransformDrag(x, y, { handlesOnly = false, moveOnly = false } = {}) {
    return this.previewInteraction.startChainTransformDrag(x, y, { handlesOnly, moveOnly });
  }

  updateChainTransformDrag(x, y) {
    return this.previewInteraction.updateChainTransformDrag(x, y);
  }

  applyLocalChainTransform(componentId, itemId, transform) {
    return this.previewInteraction.applyLocalChainTransform(componentId, itemId, transform);
  }

  get chainTransformDrag() {
    return this.previewInteraction.chainTransformDrag;
  }

  get sceneFrameDrag() {
    return this.previewInteraction.sceneFrameDrag;
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
    if (this.mapper?.isActive?.()) {
      this.surfaceRebuildPending = true;
      return;
    }
    this.rebuildSurfaces({ preferExistingMapping: !!this.pendingMappingSignature });
    const signature = this.currentMappingSignature();
    if (!this.shouldIgnoreIncomingMapping(signature)) this.applyProjectMapping(signature);
  }

  outputMediaReadiness() {
    return this.mediaReadinessForState(this.state);
  }

  prepareOutputState(state, { requireMedia = false } = {}) {
    const status = this.mediaReadinessForState(state, { requireMedia });
    this.mediaRuntime.reserveMedia(status.mediaIds);
    return status;
  }

  clearPreparedOutputState() {
    this.mediaRuntime.reserveMedia();
  }

  mediaReadinessForState(state, { requireMedia = false } = {}) {
    const frame = frameSize(state?.render || {});
    const status = collectOutputMediaReadiness({
      mode: requireMedia ? "output" : this.mode,
      state,
      media: this.media,
      acquireMedia: (id) => this.mediaRuntime.acquireMedia(this.media.get(id), { width: frame.width }),
    });
    this.requestMissingMediaBatch(Array.from(status.missingIds));
    return status;
  }

  isOutputBlackout() {
    return this.mode === "output" && (!!this.state.global.blackout || !!this.outputMediaStatus?.blocked);
  }

  shouldHoldOutputFrameForMedia() {
    const status = this.outputMediaStatus;
    return this.mode === "output" &&
      !this.state?.global?.blackout &&
      status?.loadingIds?.size > 0 &&
      status?.missingIds?.size === 0 &&
      status?.errorIds?.size === 0;
  }

  shouldUseThumbnailPreview() {
    return (this.mode === "preview" || this.mode === "component" || this.mode === "live") &&
      this.state?.ui?.debugPreview === false;
  }

  updateHudAndMetrics() {
    this.gpuTimer.poll(this.frameIndex);
    const frameMs = Math.max(0, performance.now() - this.frameStart);
    const fps = frameRate();
    const renderCost = frameMs / (1000 / renderMaxFrameRate(this.state?.render));
    this.updateSmoothedMetrics({ fps, frameMs, renderCost });
    this.updateGpuMetric();
    if (this.hud) {
      const mediaLoading = this.mode === "output" && !!this.outputMediaStatus?.blocked;
      const resolution = `<span class="output-resolution">${this.renderResolutionLabel()}</span>`;
      const diagnostic = this.mode !== "output" && this.state?.ui?.previewDiagnostics === true;
      this.hud.classList.toggle("is-hidden", !this.state.global.showHud);
      this.hud.classList.toggle("is-loading", mediaLoading);
      this.hud.classList.toggle("is-diagnostic", diagnostic);
      const markup = diagnostic
        ? this.previewDiagnosticHudMarkup(fps)
        : `${mediaLoading ? `<span class="output-loading-dot" aria-hidden="true"></span>` : ""}<span>${Math.round(this.smoothedFps || fps)} fps</span>${resolution}`;
      if (this.hud.innerHTML !== markup) this.hud.innerHTML = markup;
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
    return this.thumbnailRuntime.captureSelectedComponentThumbnail();
  }

  setThumbnailInteractionActive(active) {
    this.thumbnailRuntime.setInteractionActive(active);
  }

  get thumbnailEditTransformBaselines() {
    return this.thumbnailRuntime.transformBaselines;
  }

  get frameProfile() {
    return this.profileRuntime.frameProfile;
  }

  get lastFrameProfile() {
    return this.profileRuntime.lastFrameProfile;
  }

  get collectDetailedProfile() {
    return this.profileRuntime.collectDetailed;
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
  } catch (error) {
    console.warn("[VJ1_MAPPING_SIGNATURE_FAILED]", { fallback: "empty mapping signature", message: error?.message || String(error) });
    return "";
  }
}

function mapMappingCorners(mapping = {}, transformPoint = (point) => point) {
  return {
    ...mapping,
    surfaces: (mapping.surfaces || []).map((surface) => ({
      ...surface,
      corners: (surface.corners || []).map((corner) => ({
        ...corner,
        ...transformPoint(corner),
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

export function mediaSourceDemandSize(request = {}, source = {}) {
  const descriptor = request && typeof request === "object" ? request : { width: request };
  return renderSourceDetail(descriptor, descriptor, {
    contentScale: source?.contentTransform?.scale,
  });
}

export function mediaSourceDemandWidth(request = {}, source = {}) {
  return mediaSourceDemandSize(request, source).width;
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

// Editor-only clip for transformed stale thumbnails. This changes GL scissor
// state around an existing draw; it does not create a render target or pass.
function withScreenScissor(rect = {}, draw, viewport = {}) {
  const gl = typeof drawingContext !== "undefined" ? drawingContext : null;
  if (!gl?.scissor || !gl?.enable || typeof draw !== "function") return draw?.();
  const canvasWidth = Math.max(1, Number(typeof width === "number" ? width : gl.drawingBufferWidth) || 1);
  const canvasHeight = Math.max(1, Number(typeof height === "number" ? height : gl.drawingBufferHeight) || 1);
  const scaleX = Math.max(0.0001, Number(gl.drawingBufferWidth) || canvasWidth) / canvasWidth;
  const scaleY = Math.max(0.0001, Number(gl.drawingBufferHeight) || canvasHeight) / canvasHeight;
  const zoom = Math.max(0.1, Math.min(6, Number(viewport.zoom) || 1));
  const panX = Number(viewport.x) || 0;
  const panY = Number(viewport.y) || 0;
  const transformedLeft = canvasWidth * 0.5 + ((Number(rect.x) || 0) - canvasWidth * 0.5) * zoom + panX;
  const transformedTop = canvasHeight * 0.5 + ((Number(rect.y) || 0) - canvasHeight * 0.5) * zoom + panY;
  const left = Math.max(0, Math.min(canvasWidth, transformedLeft));
  const top = Math.max(0, Math.min(canvasHeight, transformedTop));
  const right = Math.max(left, Math.min(canvasWidth, transformedLeft + Math.max(0, Number(rect.width) || 0) * zoom));
  const bottom = Math.max(top, Math.min(canvasHeight, transformedTop + Math.max(0, Number(rect.height) || 0) * zoom));
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

function withTargetScissor(target, rect, draw) {
  if (!rect || typeof draw !== "function") return draw?.();
  const gl = target?.drawingContext;
  if (!gl?.scissor || !gl?.enable) {
    if (!gl?.save || !gl?.beginPath || !gl?.rect || !gl?.clip) return draw();
    gl.save();
    gl.beginPath();
    gl.rect(Number(rect.x) || 0, Number(rect.y) || 0, Math.max(0, Number(rect.width) || 0), Math.max(0, Number(rect.height) || 0));
    gl.clip();
    try {
      return draw();
    } finally {
      gl.restore();
    }
  }
  const targetWidth = Math.max(1, Number(target?.width) || 1);
  const targetHeight = Math.max(1, Number(target?.height) || 1);
  const density = target?.__vj1SharedFramebuffer
    ? 1
    : Math.max(1, Number(target?.pixelDensity?.()) || 1);
  const left = Math.max(0, Math.min(targetWidth, Number(rect.x) || 0));
  const top = Math.max(0, Math.min(targetHeight, Number(rect.y) || 0));
  const right = Math.max(left, Math.min(targetWidth, left + Math.max(0, Number(rect.width) || 0)));
  const bottom = Math.max(top, Math.min(targetHeight, top + Math.max(0, Number(rect.height) || 0)));
  const wasEnabled = gl.isEnabled?.(gl.SCISSOR_TEST) === true;
  const previousBox = gl.getParameter?.(gl.SCISSOR_BOX);
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(
    Math.floor(left * density),
    Math.floor((targetHeight - bottom) * density),
    Math.max(1, Math.ceil((right - left) * density)),
    Math.max(1, Math.ceil((bottom - top) * density))
  );
  try {
    return draw();
  } finally {
    if (previousBox?.length === 4) gl.scissor(previousBox[0], previousBox[1], previousBox[2], previousBox[3]);
    if (!wasEnabled) gl.disable(gl.SCISSOR_TEST);
  }
}

function rectsIntersect(left = {}, right = {}) {
  const leftX = Number(left.x) || 0;
  const leftY = Number(left.y) || 0;
  const rightX = Number(right.x) || 0;
  const rightY = Number(right.y) || 0;
  return leftX < rightX + Math.max(0, Number(right.width) || 0) &&
    leftX + Math.max(0, Number(left.width) || 0) > rightX &&
    leftY < rightY + Math.max(0, Number(right.height) || 0) &&
    leftY + Math.max(0, Number(left.height) || 0) > rightY;
}


function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
