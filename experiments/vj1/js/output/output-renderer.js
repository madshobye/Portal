import { VJ1 } from "../constants.js";
import { componentFrameMetrics } from "../domain/component-frame.js";
import { componentTextureSize } from "../domain/render-resolution.js?v=adaptive-component-demand-29";
import { clamp01, normalizeComponentPipelineSettings, sanitizeState, sceneSourceNodes } from "../domain/models.js?v=surface-media-contract-4";
import { normalizeParamValue, normalizeParamValues } from "../graph/component-schema.js?v=adaptive-component-demand-29";
import { createManualScheduler } from "../graph/manual-scheduler.js";
import { RenderNodeRuntime, textureStateKey } from "../graph/render-node-runtime.js?v=adaptive-component-demand-29";
import { createPlacedRenderResult, directPlacementKind, transformedPlacementDemandRect } from "../graph/placed-render-result.js?v=adaptive-component-demand-29";
import { compileComponentPatch, compileShaderSchedule, flattenComponentChain, fuseLocalShaderSchedule, isFusibleShaderJob } from "../graph/render-scheduler.js?v=shader-component-catalog-extraction-1";
import { getGeneratorComponent } from "../graph/generator-registry.js?v=group-composite-59";
import { createShaderBuilder, fusedUniformName } from "../shaders/shader-builder.js?v=render-core-contract-1";
import { getGeneratorShaderComponent } from "../shaders/generator-shaders.js?v=generator-shader-catalog-extraction-1";
import { getShaderComponent } from "../shaders/shader-registry.js?v=shader-component-catalog-extraction-1";
import { applyBlend } from "./blend-utils.js";
import {
  createSharedFramebufferTarget,
  isSharedFramebufferTarget,
  unwrapRenderTarget,
} from "./shared-framebuffer-target.js?v=render-diagnostics-1";
import { applyFontToGlobal, applyFontToTarget } from "./font-loader.js?v=adaptive-component-demand-29";
import { GpuTimerTracker } from "./gpu-timer-tracker.js?v=adaptive-component-demand-29";
import { drawGenerator, drawStandby } from "./generators.js?v=adaptive-component-demand-29";
import { drawCover, drawMediaFit, isDrawableMedia } from "./media-utils.js?v=video-active-ownership-1";
import { chainLayerState, componentRuntimeTimeKey, createMediaReadinessStatus, isReadyMediaItem, renderBufferKey, runtimeComponentGraphMediaState, runtimeMediaStateForSource, staticComponentGraphMediaState, staticComponentGraphState, staticMediaStateForSource, staticSourceState } from "./component-render-state.js?v=render-stability-2";
import { isEffectNode, isSimpleLayer, isSourceNode, mediaSourceFit, nodesInComponentChainOrder, patchLayerForNode, shaderPassFromNode, sourceFromPatchNode, sourceWithNodeParams, withSourceInstance } from "./component-patch-adapter.js?v=shader-component-catalog-extraction-1";
import { collectOutputMediaReadiness } from "./output-media-readiness.js?v=render-stability-2";
import { OutputMediaRuntime, cameraSettingsSignature } from "./output-media-runtime.js?v=video-active-ownership-1";
import { OutputThumbnailRuntime } from "./output-thumbnail-runtime.js?v=output-assets-runtime-extraction-1";
import { OutputSurfaceRuntime } from "./output-surface-runtime.js?v=transition-route-scope-1";
import { stableSurfaceRenderRequest } from "./surface-render-planner.js?v=surface-runtime-extraction-1";
import { combineContentTransforms, isIdentityTransform, normalizedContentTransform } from "./preview-interaction-geometry.js?v=transform-hit-contract-3";
import { contentTransformCanvasPlacement } from "./content-coordinate-space.js?v=render-core-contract-1";
import { ComponentPreviewInteraction } from "./component-preview-interaction.js?v=transform-hit-contract-3";
import { drawBuffer, withShaderInstancePrefix } from "./render-draw-utils.js?v=render-diagnostics-1";
import { COMPONENT_POST_FRAGMENT_SHADER, COMPONENT_UPSCALE_FRAGMENT_SHADER, LAYER_TRANSFORM_FRAGMENT_SHADER, OVERLAY_BLEND_FRAGMENT_SHADER, RENDER_PASS_VERTEX_SHADER } from "./render-pass-shaders.js?v=render-coordinate-scope-3";
import { componentInstanceTime, effectTransformUniforms, eyeballFrameUniforms, generatorRateParam, globalVisualTimeScale, instanceTime, qualityAdjustedGeneratorParams, qualityScaledRenderRequest, usesShadertoyInterface } from "./render-runtime-math.js?v=render-coordinate-scope-3";
import {
  createRenderRequest,
  defaultProjectSurfaceMapping,
  frameRenderRequest,
  frameSize,
  outputFrameForId,
  outputFrames,
  outputFrameOffset,
  renderRequestKey,
  RECORDING_FRAME_DEMAND_SCALE,
  outputSpanRect,
  worldSize,
} from "./render-geometry.js?v=adaptive-component-demand-29";
import { VjMapper } from "./vj-mapper.js?v=render-diagnostics-1";
import { colorUniform } from "./specialized/model-color.js?v=adaptive-component-demand-29";
import { SpecializedSourceRuntime } from "./specialized/specialized-source-runtime.js?v=terrain-world-up-1";
import {
  canvasMaxRasterSize,
  canvasPreviewRenderRequest,
  componentAdaptiveRasterLimit,
  componentPreviewRenderRequest,
  componentReferencePlacement,
  componentReferenceRenderRequest,
  componentRenderInstanceKey,
  componentSourceView,
  cornersRect,
  fullTargetRect,
  rectToCorners,
  resolutionScaledStrokeWidth,
  routeSourceLookupKey,
  sharedComponentRenderRequests,
} from "./component-render-layout.js?v=instance-sync-60";

export { averageGpuQueryNanoseconds, GpuTimerTracker } from "./gpu-timer-tracker.js?v=adaptive-component-demand-29";
export { parseObjMesh } from "./specialized/model-parsers.js?v=adaptive-component-demand-29";
export { modelDepthCutoff, transformedModelDepthRange } from "./specialized/model-render-math.js?v=model-render-math-extraction-1";
export { chainTransformDragScale, pointInTransformedRect } from "./preview-interaction-geometry.js?v=transform-hit-contract-3";
export { advanceRateClock, advanceSpatialScale, componentInstanceTime, effectTransformUniforms, eyeballFrameUniforms, instanceTime, qualityAdjustedGeneratorParams, qualityScaledRenderRequest } from "./render-runtime-math.js?v=render-coordinate-scope-3";
export { sourceWithNodeParams } from "./component-patch-adapter.js?v=shader-component-catalog-extraction-1";
export { fittedThumbnailSize } from "./thumbnail-utils.js?v=thumbnail-utils-extraction-1";
export { cameraCaptureSettings, cameraSettingsSignature } from "./output-media-runtime.js?v=video-active-ownership-1";
export {
  terrainExpandedGridWireVertices,
  terrainExpandedWireVertices,
  terrainGridSize,
  terrainSurfaceGridVertices,
  terrainSurfaceTriangleIndices,
  terrainTriangleEdgeUvs,
} from "./specialized/terrain-mesh.js?v=adaptive-component-demand-29";
export {
  canvasComponentPlacementRect,
  canvasFrameBorderHit,
  canvasMaxRasterSize,
  canvasPreviewRenderRequest,
  componentAdaptiveRasterLimit,
  componentPreviewRenderRequest,
  componentReferencePlacement,
  componentReferenceRenderRequest,
  componentRenderInstanceKey,
  componentSourceView,
  directFitRects,
  moveCanvasFrameRect,
  resolutionScaledStrokeWidth,
  resizeCanvasFrameRect,
  scaledComponentSampleRect,
  sharedComponentRenderRequests,
} from "./component-render-layout.js?v=instance-sync-60";

export class OutputRenderer {
  constructor({ mode, outputId = "", hud, font, sendMetrics, sendMapping, sendThumbnail, sendChainTransform, sendCanvasFrame, sendMediaRendition, requestMediaFiles, onSurfaceSelect, onChainItemSelect }) {
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
    this.onChainItemSelect = onChainItemSelect;
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
    this.componentById = new Map();
    this.recordingFrameById = new Map();
    this.routeSourceNodeById = new Map();
    this.routeSourceNodeByLegacyKey = new Map();
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
      shouldUseThumbnailPreview: () => this.shouldUseThumbnailPreview(),
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
    this.gpuTimer = new GpuTimerTracker();
    this.specializedSources = new SpecializedSourceRuntime({
      media: () => this.media,
      requestMissingMedia: (id) => this.requestMissingMedia(id),
      requestMissingMediaBatch: (ids) => this.requestMissingMediaBatch(ids),
      applyGraphicsPixelDensity: (target, density) => this.applyGraphicsPixelDensity(target, density),
      measureGpu: (target, draw) => this.measureGpu(target, draw),
      gpuTimer: this.gpuTimer,
      frameIndex: () => this.frameIndex,
    });
    this.lastPixelDensity = 0;
    this.frameStart = 0;
    this.frameProfile = createEmptyFrameProfile();
    this.lastFrameProfile = createEmptyFrameProfile();
    this.componentProfileDepth = 0;
    this.lastTickMs = 0;
    this.frameDeltaSeconds = 0;
    this.visualDeltaSeconds = 0;
    this.visualTime = 0;
    this.frameIndex = 0;
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
      onStatus: (status, error) => {
        this.state.ui.shaderStatus = status;
        this.state.ui.shaderError = error || "";
      },
    });
  }

  async setup(initialState, { normalized = false } = {}) {
    this.state = normalized ? initialState : sanitizeState(initialState || {});
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
    this.specializedSources.dispose();
    disposeGraphics(this.sourcePg);
    disposeGraphics(this.mainMix);
    this.surfaceRuntime.dispose();
    this.disposeFxTargetGroups();
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
    const defaultMappingById = new Map(defaultProjectSurfaceMapping(this.state.render, mappedSurfaces).map((surface) => [
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
    const rect = outputSpanRect(this.state?.render || {}, surface.destination?.outputIds || []);
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
    const surface = this.state?.mappings?.local?.surfaces?.find((item) =>
      String(item?.id || item?.name || "") === String(surfaceId)
    );
    return Array.isArray(surface?.corners) && surface.corners.length === 4
      ? surface.corners.map((corner) => ({ x: Number(corner.x) || 0, y: Number(corner.y) || 0 }))
      : null;
  }

  worldPointToDisplay(point = {}) {
    const x = Number(point.x) || 0;
    const y = Number(point.y) || 0;
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
    this.state = this.previewInteraction?.reconcileIncomingState(preparedState) || preparedState;
    this.rebuildRouteLookups();
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
  }

  rebuildRouteLookups() {
    const components = this.state?.components || [];
    const frames = this.state?.recordingFrames || [];
    const sourceNodes = sceneSourceNodes(this.state || {});
    this.componentById = new Map(components.map((component) => [component.id, component]));
    this.recordingFrameById = new Map(frames.map((frame) => [frame.id, frame]));
    this.routeSourceNodeById = new Map(sourceNodes.map((node) => [node.id, node]));
    this.routeSourceNodeByLegacyKey = new Map(sourceNodes.map((node) => [
      routeSourceLookupKey(node.componentId, node.outputFrameId),
      node,
    ]));
  }

  resolveRouteSourceNode(surface = {}) {
    return this.routeSourceNodeById.get(surface.sourceNodeId) ||
      this.routeSourceNodeByLegacyKey.get(routeSourceLookupKey(surface.componentId, surface.outputFrameId)) ||
      null;
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
    return mapMappingCorners(mapping, (corner) => this.worldPointToDisplay(corner));
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
    return mapMappingCorners(mapping, (corner) => this.displayPointToWorld(corner));
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

  emitMapping(mapping = this.mapper?.exportData?.(), status = "Mapping updated", meta = {}) {
    const projectMapping = this.mappingFromRenderMode(mapping || {});
    this.markLocalMapping(projectMapping);
    this.sendMapping?.("local", projectMapping, status, meta);
  }

  importMediaRenditions(item, renditions) {
    this.mediaRuntime.importRenditions(item, renditions);
  }

  ensureCameraCapture() {
    return this.mediaRuntime.ensureCameraCapture();
  }

  releaseCameraCapture() {
    this.mediaRuntime.releaseCameraCapture();
  }

  get cameraCapture() {
    return this.mediaRuntime.cameraCapture;
  }

  get cameraError() {
    return this.mediaRuntime.cameraError;
  }

  draw() {
    if (!this.state) return;
    this.mediaRuntime.beginFrame();
    try {
      return this.drawFrame();
    } finally {
      this.mediaRuntime.endFrame();
    }
  }

  drawFrame() {
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
    const playing = this.state?.global?.playing !== false;
    const timeScale = globalVisualTimeScale(this.state?.global);
    this.visualDeltaSeconds = playing ? dt * timeScale : 0;
    if (!playing) return;
    this.visualTime += this.visualDeltaSeconds;
    const liveComponentIds = new Set((this.state.components || []).map((component) => component.id));
    for (const id of this.componentTimes.keys()) {
      if (!liveComponentIds.has(id)) this.componentTimes.delete(id);
    }
    for (const component of this.state.components || []) {
      const speed = Math.max(0, Number(component.speed) || 0);
      this.componentTimes.set(component.id, (this.componentTimes.get(component.id) || 0) + this.visualDeltaSeconds * speed);
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

  renderComponentChainState(component, chain, componentTime, renderRequest, scopeId = component.id, inheritedTransform = {}) {
    let state = this.transparentChainState(component, renderRequest);
    for (let index = 0; index < (chain || []).length; index++) {
      const item = chain[index];
      if (item.enabled === false) continue;
      const renderedItem = isIdentityTransform(inheritedTransform)
        ? item
        : { ...item, transform: combineContentTransforms(inheritedTransform, item.transform || {}) };
      const nodeId = renderBufferKey(component.id, scopeId, index, item.id || item.componentId || item.kind);
      if (item.kind === "source") {
        if (this.canDirectCompositeSource(renderedItem)) {
          state = this.renderDirectSourceNodeState(nodeId, state, component, renderedItem, componentTime, renderRequest);
          continue;
        }
        const sourceState = this.renderComponentSourceItemState(component, renderedItem, componentTime, renderRequest, nodeId);
        // A source owns its coordinate-domain transform while retaining the
        // full Component framebuffer. Composite that already transformed frame
        // without moving or clipping the layer rectangle a second time.
        state = this.renderLayerNodeState(nodeId, state, sourceState, { ...renderedItem, transform: {} }, renderRequest);
        continue;
      }
      if (item.kind === "effect") {
        const firstPass = chainItemToShaderPass(renderedItem);
        const firstJob = compileShaderSchedule([firstPass])[0];
        if (isFusibleShaderJob(firstJob)) {
          const run = [renderedItem];
          let nextIndex = index + 1;
          while (nextIndex < (chain || []).length) {
            const nextItem = chain[nextIndex];
            if (nextItem?.enabled === false) {
              nextIndex++;
              continue;
            }
            if (nextItem?.kind !== "effect") break;
            const renderedNextItem = isIdentityTransform(inheritedTransform)
              ? nextItem
              : { ...nextItem, transform: combineContentTransforms(inheritedTransform, nextItem.transform || {}) };
            const nextJob = compileShaderSchedule([chainItemToShaderPass(renderedNextItem)])[0];
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
      if (item.kind === "group") {
        const groupState = this.renderComponentChainState(
          component,
          item.chain || [],
          componentTime,
          renderRequest,
          renderBufferKey(scopeId, item.id || index),
          combineContentTransforms(inheritedTransform, item.transform || {})
        );
        // A Group is a transform scope: its transform is precomposed into all
        // descendants above. Only its blend/opacity applies at this boundary.
        state = this.renderLayerNodeState(nodeId, state, groupState, { ...item, transform: {} }, renderRequest);
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
      const renderIdentity = componentRenderInstanceKey(dependency, source.instanceId);
      const texture = this.renderComponentForRequest(
        dependency,
        componentInstanceTime(dependency, dependencyTime, source.instanceId),
        componentReferenceRenderRequest(this.state.render, dependency, demandRect, {
          reason: "direct-component-reference",
          renderIdentity,
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
        this.mediaRuntime.claimVideoPlayback(media.video, {
          start: source.start,
          end: source.end,
          speed: (this.state?.global?.playing === false ? 0 : 1) * globalVisualTimeScale(this.state?.global) * (Number(source.speed) || 1) * Math.max(0, Number(component.speed) || 0),
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
    const placement = contentTransformCanvasPlacement(transform, output.width, output.height);
    output.push();
    output.translate(placement.centerX, placement.centerY);
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
      runtimeMedia: runtimeComponentGraphMediaState(this.media, component, this.state?.components || []),
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

  featureMorphPairService(generatorId = "") {
    if (generatorId === "featureMorph") return this.superPointPairs;
    if (generatorId === "featureMorphV2") return this.mobileNetMorphPairs;
    return null;
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
      const renderIdentity = componentRenderInstanceKey(sourceComponent, source.instanceId);
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
        componentInstanceTime(sourceComponent, sourceTime, source.instanceId),
        componentReferenceRenderRequest(this.state.render, sourceComponent, demandRect, {
          reason: "component-reference",
          renderIdentity,
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
        this.mediaRuntime.claimVideoPlayback(item.video, {
          start: source.start,
          end: source.end,
          speed: (this.state?.global?.playing === false ? 0 : 1) * globalVisualTimeScale(this.state?.global) * (Number(source.speed) || 1) * Math.max(0, Number(component.speed) || 0),
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
      else if (item?.loadError || item?.imageError) drawStandby(pg, item?.loadError || "image load failed");
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
      if (source.generatorId === "featureMorph" || source.generatorId === "featureMorphV2") {
        this.drawFeatureMorphGenerator(pg, source, generatorTime, renderRequest);
        return;
      }
      if (source.generatorId === "tileTexture") {
        this.drawTileTextureGenerator(pg, source, generatorTime, renderRequest);
        return;
      }
      if (this.drawShaderGenerator(pg, source, generatorTime, renderRequest)) return;
      drawWithContentTransform(pg, source.contentTransform, () => {
        drawGenerator(pg, source.generatorId, generatorTime, source.params || {});
      });
    }
  }

  drawFeatureMorphGenerator(pg, source = {}, componentTime = this.visualTime, renderRequest = frameRenderRequest(this.state.render)) {
    return this.specializedSources.drawFeatureMorph(pg, source, componentTime, {
      ...renderRequest,
      pixelDensity: this.requestPixelDensity(renderRequest),
    });
  }

  drawTileTextureGenerator(pg, source = {}, componentTime = this.visualTime, renderRequest = frameRenderRequest(this.state.render)) {
    return this.specializedSources.drawTileTexture(pg, source, componentTime, {
      ...renderRequest,
      pixelDensity: this.requestPixelDensity(renderRequest),
    });
  }

  drawAnatomyGenerator(pg, source = {}, componentTime = this.visualTime, renderRequest = frameRenderRequest(this.state.render)) {
    return this.specializedSources.drawAnatomy(pg, source, componentTime, {
      ...renderRequest,
      pixelDensity: this.requestPixelDensity(renderRequest),
    });
  }

  drawTerrainGenerator(pg, source = {}, componentTime = this.visualTime, renderRequest = frameRenderRequest(this.state.render)) {
    return this.specializedSources.drawTerrain(pg, source, componentTime, {
      ...renderRequest,
      pixelDensity: this.requestPixelDensity(renderRequest),
    });
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
        setShaderUniformIfPresent(shader, "iTimeDelta", this.visualDeltaSeconds);
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

  renderSurfaces() { return this.surfaceRuntime.renderSurfaces(); }

  renderSingleSceneSurfaces() { return this.surfaceRuntime.renderSingleSceneSurfaces(); }

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
        const transformPlacement = contentTransformCanvasPlacement(transform, rect.width, rect.height);
        push();
        translate(rect.x - width * 0.5 + transformPlacement.centerX, rect.y - height * 0.5 + transformPlacement.centerY);
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
    return this.previewInteraction.renderComponentFrameOverlay(component, source);
  }

  renderCanvasRecordingFrames(component, source = null) {
    return this.previewInteraction.renderCanvasRecordingFrames(component, source);
  }

  canvasRecordingFrameRects(component, source = null) {
    return this.previewInteraction.canvasRecordingFrameRects(component, source);
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
    return this.previewInteraction.mousePressed(x, y);
  }

  mouseDragged(x, y) {
    return this.previewInteraction.mouseDragged(x, y);
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

  startCanvasFrameDrag(x, y) {
    return this.previewInteraction.startCanvasFrameDrag(x, y);
  }

  updateCanvasFrameDrag(x, y) {
    return this.previewInteraction.updateCanvasFrameDrag(x, y);
  }

  applyLocalCanvasFrame(componentId, frameId, rect) {
    return this.previewInteraction.applyLocalCanvasFrame(frameId, rect);
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

  get canvasFrameDrag() {
    return this.previewInteraction.canvasFrameDrag;
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
    const status = collectOutputMediaReadiness({ mode: this.mode, state: this.state, media: this.media });
    this.requestMissingMediaBatch(Array.from(status.missingIds));
    return status;
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
    return this.thumbnailRuntime.captureSelectedComponentThumbnail();
  }

  get thumbnailEditTransformBaselines() {
    return this.thumbnailRuntime.transformBaselines;
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


function drawWithContentTransform(target, transform = {}, draw) {
  if (typeof draw !== "function") return;
  if (isIdentityTransform(transform)) {
    draw();
    return;
  }
  const width = Math.max(1, Number(target?.width) || 1);
  const height = Math.max(1, Number(target?.height) || 1);
  const value = contentTransformCanvasPlacement(transform, width, height);
  target.push();
  target.translate(value.centerX, value.centerY);
  target.rotate(value.rotation);
  target.scale(value.scale);
  target.translate(-width * 0.5, -height * 0.5);
  draw();
  target.pop();
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


function enumUniform(param, value) {
  const index = (param.values || []).indexOf(value);
  return Math.max(0, index);
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
