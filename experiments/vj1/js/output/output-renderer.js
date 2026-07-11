import { VJ1 } from "../constants.js";
import { clamp01, sanitizeState } from "../domain/models.js?v=world-frame-27";
import { normalizeParamValue } from "../graph/component-schema.js";
import { createManualScheduler } from "../graph/manual-scheduler.js";
import { compileCompositionPatch, compileShaderSchedule, flattenCompositionChain } from "../graph/render-scheduler.js?v=world-frame-27";
import { getGeneratorComponent } from "../graph/generator-registry.js";
import { createShaderBuilder } from "../shaders/shader-builder.js?v=world-frame-27";
import { getGeneratorShaderComponent } from "../shaders/generator-shaders.js?v=world-frame-27";
import { getShaderComponent } from "../shaders/shader-registry.js?v=world-frame-27";
import { applyBlend } from "./blend-utils.js";
import { applyFontToGlobal, applyFontToTarget } from "./font-loader.js?v=world-frame-27";
import { drawGenerator, drawStandby } from "./generators.js";
import { drawCover, drawMediaFit, isDrawableMedia, syncVideoPlayback } from "./media-utils.js";
import {
  createRenderRequest,
  frameRenderRequest,
  frameSize,
  outputFrameOffset,
  renderRequestKey,
  surfaceTextureSize,
  worldSize,
} from "./render-geometry.js";
import { VjMapper } from "./vj-mapper.js?v=world-frame-27";
import { mediaRenditionKey } from "../services/media-rendition-service.js";

export class OutputRenderer {
  constructor({ mode, hud, font, sendMetrics, sendMapping, sendThumbnail, sendChainTransform, sendMediaRendition, requestMediaFiles, onSurfaceSelect }) {
    this.mode = mode;
    this.hud = hud;
    this.font = font || null;
    this.sendMetrics = sendMetrics;
    this.sendMapping = sendMapping;
    this.sendThumbnail = sendThumbnail;
    this.sendChainTransform = sendChainTransform;
    this.sendMediaRendition = sendMediaRendition;
    this.requestMediaFiles = requestMediaFiles;
    this.onSurfaceSelect = onSurfaceSelect;
    this.state = null;
    this.mapper = null;
    this.compositionSource = new Map();
    this.compositionOutput = new Map();
    this.compositionBuffer = new Map();
    this.stableCompositionSignatures = new Map();
    this.compositionSourceUse = new Map();
    this.compositionBufferUse = new Map();
    this.compositionPatches = new Map();
    this.thumbnailImages = new Map();
    this.media = new Map();
    this.modelTargets = new Map();
    this.pendingRenditionSaves = new Set();
    this.sourcePg = null;
    this.fxTargets = [null, null];
    this.fxTargetKey = "";
    this.fxTargetGroups = new Map();
    this.mainMix = null;
    this.surfaceScratch = null;
    this.surfaceTexture = null;
    this.surfaceTextures = new Map();
    this.cameraCapture = null;
    this.cameraRequested = false;
    this.cameraError = "";
    this.chainTransformDrag = null;
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
    this.lastPixelDensity = 0;
    this.frameStart = 0;
    this.frameProfile = createEmptyFrameProfile();
    this.lastFrameProfile = createEmptyFrameProfile();
    this.lastTickMs = 0;
    this.visualTime = 0;
    this.frameIndex = 0;
    this.outputMediaStatus = createMediaReadinessStatus();
    this.scheduledEvents = [];
    this.manualScheduler = createManualScheduler();
    this.compositionTimes = new Map();
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
    this.applyPixelDensity();
    this.applyGlobalFont();
    this.createBuffers();
    this.createMapper();
    this.setCalibrate(this.shouldCalibrateFromState());
  }

  dispose() {
    this.disposeBuffers();
    this.mapperSurfaces?.clear?.();
    this.mapper?.surfaces?.splice?.(0);
    this.cameraCapture?.remove?.();
    this.cameraCapture = null;
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
    this.applyGraphicsFont(this.surfaceScratch);
    this.applyGraphicsFont(this.surfaceTexture);
    for (const pg of this.surfaceTextures?.values?.() || []) this.applyGraphicsFont(pg);
    for (const group of this.fxTargetGroups?.values?.() || []) {
      for (const target of group.targets || []) this.applyGraphicsFont(target);
    }
    for (const pg of this.compositionSource?.values?.() || []) this.applyGraphicsFont(pg);
    for (const pg of this.compositionOutput?.values?.() || []) this.applyGraphicsFont(pg);
    for (const pg of this.compositionBuffer?.values?.() || []) this.applyGraphicsFont(pg);
  }

  createBuffers() {
    this.disposeBuffers();
    this.applyPixelDensity();
    const { width: rw, height: rh } = this.outputFrameSize(this.state.render);
    const { width: surfaceWidth, height: surfaceHeight } = surfaceTextureSize(this.state.render);
    this.sourcePg = createGraphics(rw, rh);
    this.mainMix = createGraphics(rw, rh);
    this.surfaceScratch = createGraphics(surfaceWidth, surfaceHeight);
    this.surfaceTexture = createGraphics(surfaceWidth, surfaceHeight);
    this.applyGraphicsPixelDensity(this.sourcePg);
    this.applyGraphicsPixelDensity(this.mainMix);
    this.applyGraphicsPixelDensity(this.surfaceScratch);
    this.applyGraphicsPixelDensity(this.surfaceTexture);
    this.applyGraphicsFont(this.sourcePg);
    this.applyGraphicsFont(this.mainMix);
    this.applyGraphicsFont(this.surfaceScratch);
    this.applyGraphicsFont(this.surfaceTexture);
  }

  buffersMatchRenderSize() {
    if (!this.state) return false;
    const { width: rw, height: rh } = this.outputFrameSize(this.state.render);
    const { width: surfaceWidth, height: surfaceHeight } = surfaceTextureSize(this.state.render);
    return this.sourcePg?.width === rw &&
      this.sourcePg?.height === rh &&
      this.mainMix?.width === rw &&
      this.mainMix?.height === rh &&
      this.surfaceScratch?.width === surfaceWidth &&
      this.surfaceScratch?.height === surfaceHeight &&
      this.surfaceTexture?.width === surfaceWidth &&
      this.surfaceTexture?.height === surfaceHeight;
  }

  disposeBuffers() {
    disposeGraphics(this.sourcePg);
    disposeGraphics(this.mainMix);
    disposeGraphics(this.surfaceScratch);
    disposeGraphics(this.surfaceTexture);
    disposeGraphicsMap(this.surfaceTextures);
    this.disposeFxTargetGroups();
    disposeGraphicsMap(this.modelTargets);
    disposeGraphicsMap(this.compositionSource);
    disposeGraphicsMap(this.compositionOutput);
    disposeGraphicsMap(this.compositionBuffer);
    this.compositionSourceUse?.clear?.();
    this.compositionBufferUse?.clear?.();
    this.sourcePg = null;
    this.mainMix = null;
    this.surfaceScratch = null;
    this.surfaceTexture = null;
    this.surfaceTextures?.clear?.();
    this.fxTargets = [null, null];
    this.fxTargetKey = "";
    this.modelTargets?.clear?.();
    this.shaderBuilder.clear?.();
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
        this.emitMapping(mapping, mappingStatusForReason(meta.reason));
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
    const cols = Math.max(1, Math.ceil(Math.sqrt(this.state.surfaces.length)));
    const rows = Math.max(1, Math.ceil(this.state.surfaces.length / cols));
    const gap = Math.max(24, Math.round(Math.min(frame.width, frame.height) * 0.035));
    const cellW = Math.max(1, (frame.width - gap * (cols + 1)) / cols);
    const texture = surfaceTextureSize(this.state.render);
    const idealCellH = cellW * (texture.height / texture.width);
    const maxCellH = Math.max(1, (frame.height - gap * (rows + 1)) / rows);
    const cellH = Math.min(idealCellH, maxCellH);
    const frameX = offset.x;
    const frameY = offset.y;
    this.state.surfaces.forEach((surface, index) => {
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

  setState(nextState) {
    const previousSurfaceIds = (this.state?.surfaces || []).map((surface) => surface.id).join(",");
    const previousSize = this.state ? this.renderSizeSignature(this.state.render) : "";
    const previousMappingSignature = this.mappingSignature;
    this.state = sanitizeState(nextState);
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
    const projectFrame = frameSize(render);
    const world = worldSize(render);
    const texture = surfaceTextureSize(render);
    const density = Math.max(0.5, Math.min(2, Number(render.pixelDensity) || 1));
    return `${frame.width}x${frame.height}:project${projectFrame.width}x${projectFrame.height}:${world.width}x${world.height}:${texture.width}x${texture.height}:pd${density}`;
  }

  outputFrameSize(render = this.state?.render || {}) {
    return frameSize(render);
  }

  displayCanvasSize(render = this.state?.render || {}) {
    const fallback = frameSize(render);
    return {
      width: Math.max(1, Math.floor(Number(typeof width === "number" ? width : fallback.width) || fallback.width)),
      height: Math.max(1, Math.floor(Number(typeof height === "number" ? height : fallback.height) || fallback.height)),
    };
  }

  renderPixelDensity(render = this.state?.render || {}) {
    return Math.max(0.5, Math.min(2, Number(render.pixelDensity) || 1));
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

  applyGraphicsPixelDensity(pg) {
    if (!pg?.pixelDensity) return;
    const density = this.renderPixelDensity(this.state?.render || {});
    pg.pixelDensity(density);
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
    const projectFrame = frameSize(this.state?.render || {});
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
          loadModel(
            url,
            true,
            (model) => {
              item.model = model;
              item.ready = true;
              item.modelError = "";
            },
            (error) => {
              item.modelError = error?.message || String(error || "model load failed");
            },
            "obj"
          );
        }
      }
      this.importMediaRenditions(item, entry?.renditions || []);
    }
  }
  emitMapping(mapping = this.mapper?.exportData?.(), status = "Mapping updated") {
    const projectMapping = this.mappingFromRenderMode(mapping || {});
    this.markLocalMapping(projectMapping);
    this.sendMapping?.("local", projectMapping, status);
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
    if (this.cameraCapture || this.cameraRequested) return this.cameraCapture;
    this.cameraRequested = true;
    this.cameraError = "";
    const setupWebcamera = getPortalWebcameraSetup();
    if (!setupWebcamera) {
      this.cameraError = "camera unavailable";
      return null;
    }
    const frame = frameSize(this.state.render);
    setupWebcamera(true, frame.width, frame.height, false, false)
      .then((camera) => {
        this.cameraCapture = camera;
        this.cameraError = "";
      })
      .catch(() => {
        this.cameraError = "camera blocked";
        this.cameraRequested = false;
      });
    return null;
  }

  draw() {
    if (!this.state) return;
    this.frameStart = performance.now();
    this.frameProfile = createEmptyFrameProfile();
    this.frameIndex++;
    this.tickClock(this.frameStart);
    this.outputMediaStatus = this.outputMediaReadiness();
    this.scheduledEvents = this.state.scheduler?.manualLane === false
      ? []
      : this.manualScheduler.drain({ frame: this.frameIndex, time: this.visualTime });
    background(0);
    if (this.shouldUseThumbnailPreview()) this.renderThumbnailCompositions();
    else this.renderCompositions();
    if (this.mode === "composition") {
      this.renderCompositionPreview();
      this.captureSelectedCompositionThumbnail();
      this.finishFrameProfile();
      this.updateHudAndMetrics();
      this.pruneRenderCaches();
      return;
    }
    this.renderSurfaces();
    const outputBlackout = this.isOutputBlackout();
    const restoreCalibrate = outputBlackout && this.mapper?.isCalibrating?.();
    if (restoreCalibrate) this.mapper.setCalibrate(false);
    this.mapper.drawOverlays();
    this.renderOutputFrameOverlay();
    this.renderSelectedSurfaceOverlay();
    if (restoreCalibrate) this.mapper.setCalibrate(true);
    this.finishFrameProfile();
    this.updateHudAndMetrics();
    this.pruneRenderCaches();
  }

  tickClock(nowMs) {
    if (!this.lastTickMs) {
      this.lastTickMs = nowMs;
      return;
    }
    const dt = Math.min(0.1, Math.max(0, (nowMs - this.lastTickMs) / 1000));
    this.lastTickMs = nowMs;
    this.visualTime += dt;
    const liveCompositionIds = new Set((this.state.compositions || []).map((composition) => composition.id));
    for (const id of this.compositionTimes.keys()) {
      if (!liveCompositionIds.has(id)) this.compositionTimes.delete(id);
    }
    for (const composition of this.state.compositions || []) {
      const speed = Math.max(0, Number(composition.speed) || 0);
      this.compositionTimes.set(composition.id, (this.compositionTimes.get(composition.id) || 0) + dt * speed);
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
    const frameWidth = Math.max(1, Number(this.state?.render?.frameWidth || this.state?.render?.width) || width);
    const frameHeight = Math.max(1, Number(this.state?.render?.frameHeight || this.state?.render?.height) || height);
    if (frameWidth >= width && frameHeight >= height) return;
    const offset = this.outputFrameOffset();
    const gl = drawingContext;
    if (gl?.disable) gl.disable(gl.DEPTH_TEST);
    resetShader();
    push();
    noFill();
    stroke(255, 255, 255, 135);
    strokeWeight(2);
    rectMode(CORNER);
    rect(-width * 0.5 + offset.x, -height * 0.5 + offset.y, frameWidth, frameHeight);
    noStroke();
    fill(255, 255, 255, 150);
    textSize(12);
    textAlign(LEFT, TOP);
    text("output frame", -width * 0.5 + offset.x + 10, -height * 0.5 + offset.y + 8);
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

  renderCompositions() {
    this.compositionOutput.clear();
    this.mainMix.push();
    this.mainMix.clear();
    if (this.isOutputBlackout()) {
      this.mainMix.pop();
      return;
    }
    if (this.mode !== "composition") {
      this.mainMix.pop();
      return;
    }

    const neededCompositionIds = this.neededCompositionIds();
    for (const composition of this.state.compositions || []) {
      if (neededCompositionIds.size && !neededCompositionIds.has(composition.id)) continue;
      const compositionTime = this.compositionTimes.get(composition.id) || 0;
      const output = this.renderCompositionForRequest(
        composition,
        compositionTime,
        createRenderRequest("texture", this.outputFrameSize(this.state.render), { reason: "composition-preview" })
      );
      this.mainMix.push();
      applyBlend(this.mainMix, composition.blend);
      this.mainMix.tint(255, 255 * clamp01(composition.opacity));
      this.mainMix.image(output, 0, 0, this.mainMix.width, this.mainMix.height);
      this.mainMix.noTint();
      this.mainMix.blendMode(BLEND);
      this.mainMix.pop();
    }
    this.mainMix.pop();
  }

  renderCompositionAtSize(composition, compositionTime, rw, rh) {
    return this.renderCompositionForRequest(composition, compositionTime, createRenderRequest("texture", { width: rw, height: rh }));
  }

  renderCompositionForRequest(composition, compositionTime, request = frameRenderRequest(this.state.render)) {
    const renderRequest = this.normalizeRenderRequest(request, "composition");
    const outputKey = renderBufferKey(composition.id, renderRequestKey(renderRequest));
    const cached = this.compositionOutput.get(outputKey);
    if (cached) {
      this.frameProfile.compositionCacheHits++;
      return cached;
    }
    const stableSignature = this.stableCompositionSignature(composition, renderRequest);
    const stableKey = renderBufferKey("stable", outputKey);
    const stableCached = stableSignature ? this.compositionBuffer.get(stableKey) : null;
    if (stableCached &&
        stableCached.width === renderRequest.width &&
        stableCached.height === renderRequest.height &&
        this.stableCompositionSignatures.get(stableKey) === stableSignature) {
      this.touchRenderCache(this.compositionBufferUse, stableKey);
      this.frameProfile.compositionCacheHits++;
      this.cacheCompositionOutput(composition, outputKey, stableCached, renderRequest);
      return stableCached;
    }
    if (composition.type === "canvas") {
      const output = this.measureProfile("compositionMs", {
        type: "composition",
        compositionId: composition.id,
        compositionName: composition.name || composition.id || "Canvas",
        width: renderRequest.width,
        height: renderRequest.height,
      }, () => this.renderCanvasComposition(composition, compositionTime, renderRequest));
      this.cacheCompositionOutput(composition, outputKey, output, renderRequest);
      if (stableSignature) this.storeStableCompositionOutput(stableKey, stableSignature, output, renderRequest);
      return output;
    }
    const patch = compileCompositionPatch(composition, renderRequest);
    this.compositionPatches.set(composition.id, patch);
    const output = this.measureProfile("compositionMs", {
      type: "composition",
      compositionId: composition.id,
      compositionName: composition.name || composition.id || "Composition",
      width: renderRequest.width,
      height: renderRequest.height,
    }, () => this.renderCompositionPatch(composition, patch, compositionTime, renderRequest));
    this.cacheCompositionOutput(composition, outputKey, output, renderRequest);
    if (stableSignature) this.storeStableCompositionOutput(stableKey, stableSignature, output, renderRequest);
    return output;
  }

  cacheCompositionOutput(composition, outputKey, output, renderRequest) {
    this.compositionOutput.set(outputKey, output);
    if (this.mainMix && renderRequest.width === this.mainMix.width && renderRequest.height === this.mainMix.height) {
      this.compositionOutput.set(composition.id, output);
    }
  }

  storeStableCompositionOutput(stableKey, signature, source, renderRequest) {
    const stable = this.getCompositionBuffer(stableKey, renderRequest);
    stable.push();
    stable.clear();
    drawBuffer(stable, source, 0, 0, stable.width, stable.height, this.isShaderBuffer(source));
    stable.pop();
    this.stableCompositionSignatures.set(stableKey, signature);
  }

  renderCanvasComposition(composition, compositionTime, request = frameRenderRequest(this.state.render)) {
    const renderRequest = this.normalizeRenderRequest(request, "composition");
    const output = this.getCompositionBuffer(composition.id, renderRequest);
    const canvas = composition.canvas || {};
    const canvasWidth = Math.max(1, Number(canvas.width) || renderRequest.width);
    const canvasHeight = Math.max(1, Number(canvas.height) || renderRequest.height);
    const scaleX = renderRequest.width / canvasWidth;
    const scaleY = renderRequest.height / canvasHeight;
    output.push();
    output.clear();
    for (const layer of canvas.layers || []) {
      if (layer.enabled === false || !layer.compositionId || layer.compositionId === composition.id) continue;
      const sourceComposition = this.state.compositions.find((item) => item.id === layer.compositionId);
      if (!sourceComposition || sourceComposition.type === "canvas") continue;
      const layerWidth = Math.max(1, Math.round((Number(layer.width) || 1) * scaleX));
      const layerHeight = Math.max(1, Math.round((Number(layer.height) || 1) * scaleY));
      const sourceTime = this.compositionTimes.get(sourceComposition.id) || compositionTime;
      const source = this.renderCompositionForRequest(
        sourceComposition,
        sourceTime,
        createRenderRequest("texture", surfaceTextureSize(this.state.render), { reason: "canvas-layer" })
      );
      output.push();
      applyBlend(output, layer.blend);
      output.tint(255, 255 * clamp01(layer.opacity));
      output.image(
        source,
        (Number(layer.x) || 0) * scaleX,
        (Number(layer.y) || 0) * scaleY,
        layerWidth,
        layerHeight
      );
      output.noTint();
      output.blendMode(BLEND);
      output.pop();
    }
    output.pop();
    return output;
  }

  renderCompositionPatch(composition, patch, compositionTime, request = frameRenderRequest(this.state.render)) {
    const renderRequest = this.normalizeRenderRequest(patch?.renderRequest || request, "composition");
    const output = this.getCompositionBuffer(composition.id, renderRequest);
    output.push();
    output.clear();
    output.pop();

    if (Array.isArray(composition.chain) && composition.chain.length) {
      this.renderCompositionChainItems(composition, composition.chain, output, compositionTime, renderRequest);
      return output;
    }

    const orderedNodes = nodesInCompositionChainOrder(composition, patch);
    for (let index = 0; index < orderedNodes.length; index++) {
      const node = orderedNodes[index];
      if (node.enabled === false || node.role === "output") continue;
      if (isSourceNode(node)) {
        const layer = patchLayerForNode(node);
        const source = this.renderPatchSourceTexture(composition, node, layer, compositionTime, renderRequest);
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
        const effected = this.renderShaderNodes(output, effectRun, renderRequest, compositionTime);
        output.push();
        output.clear();
        drawBuffer(output, effected, 0, 0, output.width, output.height, this.isShaderBuffer(effected));
        output.pop();
        index = nextIndex;
      }
    }
    return output;
  }

  renderPatchSourceTexture(composition, node, layer, compositionTime, renderRequest) {
    const sourceState = sourceFromPatchNode(node);
    if (isSimpleLayer(layer) && sourceState.type === "generator" && getGeneratorShaderComponent(getGeneratorComponent(sourceState.generatorId).id)) {
      return this.measureProfile("sourceMs", {
        type: "source",
        compositionId: composition.id,
        compositionName: composition.name || composition.id || "Composition",
        passId: node.componentId || node.id,
        passName: layer.name || node.componentId || node.id,
        width: renderRequest.width,
        height: renderRequest.height,
      }, () => this.renderShaderGeneratorSource(
        sourceState.generatorId,
        instanceTime(sourceState.instanceId || node.id, compositionTime),
        renderRequest,
        sourceState.params || {}
      ));
    }
    const source = this.measureProfile("sourceMs", {
      type: "source",
      compositionId: composition.id,
      compositionName: composition.name || composition.id || "Composition",
      passId: node.componentId || node.id,
      passName: layer.name || node.componentId || node.id,
      width: renderRequest.width,
      height: renderRequest.height,
    }, () => this.renderPatchSourceNode(composition, node, compositionTime, renderRequest));
    return source;
  }

  renderLegacyComposition(composition, compositionTime, request = frameRenderRequest(this.state.render)) {
    const renderRequest = this.normalizeRenderRequest(request, "composition");
    const source = this.renderCompositionSource(composition, compositionTime, renderRequest);
    const effected = this.renderShaderChain(source, withShaderInstancePrefix(composition.shaderChain, composition.id), renderRequest, compositionTime);
    const output = this.getCompositionBuffer(composition.id, renderRequest);
    output.push();
    output.clear();
    drawBuffer(output, effected, 0, 0, output.width, output.height, this.isShaderBuffer(effected));
    output.pop();
    return output;
  }

  renderCompositionChain(composition, compositionTime, request = frameRenderRequest(this.state.render)) {
    const renderRequest = this.normalizeRenderRequest(request, "composition");
    const output = this.getCompositionBuffer(composition.id, renderRequest);
    output.push();
    output.clear();
    output.pop();

    this.renderCompositionChainItems(composition, composition.chain || [], output, compositionTime, renderRequest);
    return output;
  }

  renderCompositionChainItems(composition, chain, output, compositionTime, renderRequest) {
    for (let index = 0; index < (chain || []).length; index++) {
      const item = chain[index];
      if (item.enabled === false) continue;
      if (item.kind === "source") {
        const source = this.renderCompositionSourceItem(composition, item, compositionTime, renderRequest);
        this.drawChainLayer(output, source, item);
        continue;
      }
      if (item.kind === "effect") {
        const effectRun = [item];
        let nextIndex = index;
        while (chain[nextIndex + 1]?.kind === "effect") {
          nextIndex++;
          if (chain[nextIndex]?.enabled !== false) effectRun.push(chain[nextIndex]);
        }
        const effected = this.renderShaderChain(output, effectRun.map(chainItemToShaderPass), renderRequest, compositionTime);
        output.push();
        output.clear();
        drawBuffer(output, effected, 0, 0, output.width, output.height, this.isShaderBuffer(effected));
        output.pop();
        index = nextIndex;
        continue;
      }
      if (item.kind === "group") {
        const groupOutput = this.getCompositionBuffer(`${composition.id}:${item.id}:group`, renderRequest);
        groupOutput.push();
        groupOutput.clear();
        groupOutput.pop();
        this.renderCompositionChainItems(composition, item.chain || [], groupOutput, compositionTime, renderRequest);
        this.drawChainLayer(output, groupOutput, item);
      }
    }
  }

  renderThumbnailCompositions() {
    this.compositionOutput.clear();
    this.mainMix.push();
    this.mainMix.clear();
    this.mainMix.pop();
  }

  neededCompositionIds() {
    const ids = new Set();
    if (this.mode === "composition") {
      const selected = this.state.ui.selectedCompositionId || this.state.compositions[0]?.id || "";
      if (selected) ids.add(selected);
      return ids;
    }
    for (const surface of this.state.surfaces || []) {
      if (surface.enabled && surface.compositionId) ids.add(surface.compositionId);
    }
    return ids;
  }

  stableCompositionSignature(composition, renderRequest, seen = new Set()) {
    if (composition?.type === "canvas") return "";
    if (!composition?.id || this.compositionIsFrameDynamic(composition, seen)) return "";
    return stableStringify({
      version: 1,
      request: {
        role: renderRequest.role || "composition",
        width: renderRequest.width,
        height: renderRequest.height,
      },
      composition: staticCompositionState(composition),
      media: staticMediaState(this.state?.media || [], composition),
    });
  }

  compositionIsFrameDynamic(composition, seen = new Set()) {
    if (!composition || seen.has(composition.id)) return true;
    seen.add(composition.id);
    if (composition.type === "canvas") {
      for (const layer of composition.canvas?.layers || []) {
        if (layer.enabled === false) continue;
        const sourceComposition = this.state?.compositions?.find((item) => item.id === layer.compositionId);
        if (!sourceComposition || this.compositionIsFrameDynamic(sourceComposition, seen)) return true;
      }
      seen.delete(composition.id);
      return false;
    }
    if (Array.isArray(composition.chain) && composition.chain.length) {
      const dynamic = this.chainItemsAreFrameDynamic(composition.chain);
      seen.delete(composition.id);
      return dynamic;
    }
    const sourceDynamic = this.sourceIsFrameDynamic(composition.source, composition);
    const effectsDynamic = (composition.shaderChain || []).some((pass) => this.effectPassIsFrameDynamic(pass));
    seen.delete(composition.id);
    return sourceDynamic || effectsDynamic;
  }

  chainItemsAreFrameDynamic(chain = []) {
    for (const item of chain || []) {
      if (item.enabled === false) continue;
      if (item.kind === "group" && this.chainItemsAreFrameDynamic(item.chain || [])) return true;
      if (item.kind === "source" && this.sourceIsFrameDynamic(item.source || {}, item)) return true;
      if (item.kind === "effect" && this.effectPassIsFrameDynamic({ id: item.componentId, params: item.params, amount: item.amount })) return true;
    }
    return false;
  }

  sourceIsFrameDynamic(source = {}, owner = {}) {
    if (!source || source.type === "black") return false;
    if (source.type === "camera") return true;
    if (source.type === "generator") {
      if (source.generatorId === "anatomy") {
        const params = { ...(source.params || {}), ...(owner.params || {}) };
        const spins = Math.abs(Number(params.spinX) || 0) + Math.abs(Number(params.spinY) || 0) + Math.abs(Number(params.spinZ) || 0);
        return spins > 0.0001 || (params.part === "heart" && clamp01(Number(params.heartPulse) || 0) > 0.0001);
      }
      return !STATIC_GENERATOR_IDS.has(source.generatorId || "testPattern");
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
    if (!component?.code?.includes("time")) return false;
    const params = {
      ...(pass.params && typeof pass.params === "object" ? pass.params : {}),
    };
    if (pass.amount !== undefined && params.amount === undefined) params.amount = pass.amount;
    const amount = effectParamNumber(component, params, "amount", 0.35);
    if (amount <= 0.0001) return false;
    if (id === "photoGrade") {
      const noiseActive = effectParamNumber(component, params, "grain", 0) > 0.0001 ||
        effectParamNumber(component, params, "noise", 0) > 0.0001 ||
        effectParamNumber(component, params, "distort", 0) > 0.0001;
      return noiseActive && effectParamValue(component, params, "seedMode", "animated") !== "fixed";
    }
    if (id === "smear") {
      const textureActive = ["cctvAmount", "screenPrintAmount", "dotMatrixAmount", "receiptAmount", "ditherAmount", "smearAmount"]
        .some((paramId) => effectParamNumber(component, params, paramId, paramId === "cctvAmount" ? 0.45 : 0) > 0.0001);
      return textureActive && effectParamValue(component, params, "seedMode", "animated") !== "fixed";
    }
    if (SEED_CONTROLLED_EFFECT_IDS.has(id)) {
      return effectParamValue(component, params, "seedMode", "animated") !== "fixed";
    }
    if (id === "rgbSplit") return effectParamNumber(component, params, "motion", 1) > 0.0001;
    if (id === "spinRotate") return Math.abs(effectParamNumber(component, params, "speed", 0.2)) > 0.0001;
    return true;
  }

  renderCompositionSource(composition, compositionTime = this.visualTime, request = frameRenderRequest(this.state.render)) {
    const renderRequest = this.normalizeRenderRequest(request, "source");
    const key = renderBufferKey(composition.id, renderRequestKey(renderRequest));
    let pg = this.compositionSource.get(key);
    if (!pg || pg.width !== renderRequest.width || pg.height !== renderRequest.height) {
      pg = createGraphics(renderRequest.width, renderRequest.height);
      this.applyGraphicsFont(pg);
      this.compositionSource.set(key, pg);
    }
    this.touchRenderCache(this.compositionSourceUse, key);
    pg.push();
    pg.clear();
    this.safeDrawSourceToGraphics(pg, withSourceInstance(composition.source, `${composition.id}:source`), composition, compositionTime, renderRequest);
    pg.pop();
    return pg;
  }

  renderCompositionSourceItem(composition, item, compositionTime = this.visualTime, request = frameRenderRequest(this.state.render)) {
    const renderRequest = this.normalizeRenderRequest(request, "source");
    const key = renderBufferKey(composition.id, item.id, renderRequestKey(renderRequest));
    let pg = this.compositionSource.get(key);
    if (!pg || pg.width !== renderRequest.width || pg.height !== renderRequest.height) {
      pg = createGraphics(renderRequest.width, renderRequest.height);
      this.applyGraphicsFont(pg);
      this.compositionSource.set(key, pg);
    }
    this.touchRenderCache(this.compositionSourceUse, key);
    pg.push();
    pg.clear();
    this.safeDrawSourceToGraphics(pg, withSourceInstance(item.source || composition.source, item.id), composition, compositionTime, renderRequest);
    pg.pop();
    return pg;
  }

  renderPatchSourceNode(composition, node, compositionTime = this.visualTime, request = frameRenderRequest(this.state.render)) {
    const renderRequest = this.normalizeRenderRequest(node?.state?.renderRequest || request, "source");
    const key = renderBufferKey(composition.id, node.id, renderRequestKey(renderRequest));
    let pg = this.compositionSource.get(key);
    if (!pg || pg.width !== renderRequest.width || pg.height !== renderRequest.height) {
      pg = createGraphics(renderRequest.width, renderRequest.height);
      this.applyGraphicsFont(pg);
      this.compositionSource.set(key, pg);
    }
    this.touchRenderCache(this.compositionSourceUse, key);
    pg.push();
    pg.clear();
    this.safeDrawSourceToGraphics(pg, sourceFromPatchNode(node), composition, compositionTime, renderRequest);
    pg.pop();
    return pg;
  }

  safeDrawSourceToGraphics(pg, source, composition, compositionTime, renderRequest = frameRenderRequest(this.state.render)) {
    try {
      this.drawSourceToGraphics(pg, source, composition, compositionTime, renderRequest);
    } catch (error) {
      console.error(`[VJ1_SOURCE_CRASH] ${error?.name || "Error"}: ${error?.message || String(error || "unknown")}`, {
        compositionId: composition.id,
        compositionName: composition.name,
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

  drawSourceToGraphics(pg, source, composition, compositionTime, renderRequest = frameRenderRequest(this.state.render)) {
    if (source.type === "media") {
      const item = this.media.get(source.mediaId);
      if (item?.video && isDrawableMedia(item.video)) {
        syncVideoPlayback(item.video, {
          start: source.start,
          end: source.end,
          speed: (Number(source.speed) || 1) * Math.max(0, Number(composition.speed) || 0),
        });
        drawMediaFit(pg, item.video, 0, 0, pg.width, pg.height, mediaSourceFit(source));
      }
      else if (item?.image && isDrawableMedia(item.image)) {
        const fit = mediaSourceFit(source);
        const image = fit === "cover" ? this.getImageRendition(item, pg.width, pg.height) || item.image : item.image;
        drawMediaFit(pg, image, 0, 0, pg.width, pg.height, fit);
      }
      else if (item?.model || item?.modelData) {
        this.drawModelSource(pg, item, source, compositionTime, renderRequest);
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
      if (camera && isDrawableMedia(camera)) drawCover(pg, camera, 0, 0, pg.width, pg.height);
      else drawStandby(pg, this.cameraError || "camera");
    } else if (source.type === "black") {
      pg.background(0);
    } else {
      const generatorTime = instanceTime(source.instanceId || source.generatorId, compositionTime);
      if (source.generatorId === "anatomy") {
        this.drawAnatomyGenerator(pg, source, generatorTime, renderRequest);
        return;
      }
      if (this.drawShaderGenerator(pg, source, generatorTime)) return;
      drawGenerator(pg, source.generatorId, generatorTime, source.params || {});
    }
  }

  drawAnatomyGenerator(pg, source = {}, compositionTime = this.visualTime, renderRequest = frameRenderRequest(this.state.render)) {
    const target = this.getModelTarget(pg.width, pg.height);
    const viewport = modelViewportMetrics(target, renderRequest);
    const params = source.params || {};
    const renderMode = params.renderMode || "surface";
    const surfaceColor = modelColor(params.surfaceColor, [217, 212, 201, 255]);
    const wireColor = modelColor(params.wireColor, [75, 73, 68, 204]);
    const wireThickness = modelWireThickness(params);
    const rotation = modelRotation(params, compositionTime);
    const detail = Math.max(4, Math.min(14, Math.round(Number(params.detail) || 8)));
    const modelScale = Math.max(0.01, Number(params.modelScale) || 1);
    const depth = Math.max(0.05, Number(params.depth) || 1);
    target.push();
    target.clear();
    target.perspective?.(Math.PI / 3, viewport.width / Math.max(1, viewport.height), 0.1, 5000);
    target.camera?.(0, 0, viewport.cameraZ, 0, 0, 0, 0, 1, 0);
    target.ambientLight?.(96);
    target.directionalLight?.(238, 232, 220, -0.45, -0.55, -0.75);
    target.directionalLight?.(82, 94, 108, 0.7, 0.15, -0.35);
    target.rotateX(rotation[0]);
    target.rotateY(rotation[1]);
    target.rotateZ(rotation[2]);
    const scale = viewport.unitScale * modelScale * anatomyPartFitScale(params.part);
    target.scale(scale, -scale, scale * depth);
    drawProceduralAnatomy(target, params, compositionTime, renderMode, surfaceColor, wireColor, wireThickness, detail);
    target.pop();
    pg.push();
    pg.clear();
    drawBuffer(pg, target, 0, 0, pg.width, pg.height, true);
    pg.pop();
  }

  drawModelSource(pg, item, source = {}, compositionTime = this.visualTime, renderRequest = frameRenderRequest(this.state.render)) {
    const target = this.getModelTarget(pg.width, pg.height);
    const viewport = modelViewportMetrics(target, renderRequest);
    const params = source.params || {};
    const renderMode = params.renderMode || "surface";
    const modelScale = Math.max(0.01, Number(params.modelScale) || 1);
    const depth = Math.max(0.05, Number(params.depth) || 1);
    const pointBudget = Math.max(128, Math.min(50000, Math.round(Number(params.pointBudget) || 4000)));
    const surfaceColor = modelColor(params.surfaceColor, [220, 225, 220, 255]);
    const wireColor = modelColor(params.wireColor, [20, 20, 20, 220]);
    const wireThickness = modelWireThickness(params);
    const rotation = modelRotation(params, compositionTime);
    target.push();
    target.clear();
    const scale = viewport.unitScale * modelScale;
    const rawParsedDrawn = item.modelData && drawRawParsedModelMode(target, item, params, compositionTime, renderMode, surfaceColor, wireColor, pointBudget, viewport);
    if (!rawParsedDrawn) {
      target.perspective?.(Math.PI / 3, viewport.width / Math.max(1, viewport.height), 0.1, 5000);
      target.camera?.(0, 0, viewport.cameraZ, 0, 0, 0, 0, 1, 0);
      target.ambientLight?.(95);
      target.directionalLight?.(220, 220, 220, -0.35, -0.45, -0.75);
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
        target.model(item.model);
        if (renderMode === "surfaceWire") {
          target.noFill();
          target.stroke(...wireColor);
          target.strokeWeight(wireThickness);
          target.model(item.model);
        }
      }
    }
    target.pop();
    pg.push();
    pg.clear();
    drawBuffer(pg, target, 0, 0, pg.width, pg.height, true);
    pg.pop();
  }

  getModelTarget(width, height) {
    const widthPx = Math.max(1, Math.round(Number(width) || 1));
    const heightPx = Math.max(1, Math.round(Number(height) || 1));
    const key = renderBufferKey(widthPx, heightPx);
    let target = this.modelTargets.get(key);
    if (!target) {
      target = createGraphics(widthPx, heightPx, WEBGL);
      this.applyGraphicsPixelDensity(target);
      target.noStroke();
      this.modelTargets.set(key, target);
      return target;
    }
    if (target.width !== widthPx || target.height !== heightPx) {
      try {
        target.resizeCanvas(widthPx, heightPx);
      } catch {
        disposeGraphics(target);
        target = createGraphics(widthPx, heightPx, WEBGL);
        this.modelTargets.set(key, target);
      }
      this.applyGraphicsPixelDensity(target);
      target.noStroke();
    }
    return target;
  }

  drawShaderGenerator(pg, sourceOrId, compositionTime = this.visualTime) {
    const source = typeof sourceOrId === "object"
      ? sourceOrId
      : { generatorId: sourceOrId, params: {} };
    const request = createRenderRequest("source", { width: pg.width, height: pg.height });
    const target = this.renderShaderGeneratorSource(source.generatorId, compositionTime, request, source.params || {});
    if (!target) return false;
    pg.push();
    pg.clear();
    drawBuffer(pg, target, 0, 0, pg.width, pg.height, true);
    pg.pop();
    return true;
  }

  renderShaderGeneratorSource(id, compositionTime = this.visualTime, request = frameRenderRequest(this.state.render), params = {}) {
    const generatorComponent = getGeneratorComponent(id);
    const generatorId = generatorComponent.id;
    const shaderComponent = getGeneratorShaderComponent(generatorId);
    const component = shaderComponent ? { ...shaderComponent, params: generatorComponent.params || shaderComponent.params || [] } : null;
    if (!component) return null;
    const renderRequest = this.normalizeRenderRequest(request, "source");
    const target = this.getFxPingPongTarget(request, 0);
    const shader = this.shaderBuilder.getShader({ id: component.id, component }, target);
    if (!shader) return null;
    const started = performance.now();
    const sample = {
      type: "shader-generator",
      passId: generatorId,
      passName: component.name || generatorId,
      width: renderRequest.width,
      height: renderRequest.height,
      ms: 0,
    };
    try {
      target.push();
      target.clear();
      target.shader(shader);
      shader.setUniform("resolution", [renderRequest.width, renderRequest.height]);
      shader.setUniform("time", compositionTime);
      this.setShaderParamUniforms(shader, component, params, { setDefaultAmount: false });
      target.rect(-renderRequest.width / 2, -renderRequest.height / 2, renderRequest.width, renderRequest.height);
      target.resetShader();
      target.pop();
    } finally {
      sample.ms = roundMetric(performance.now() - started);
      this.frameProfile.passSamples.push(sample);
    }
    return target;
  }

  getCompositionBuffer(id, request = frameRenderRequest(this.state.render)) {
    const renderRequest = this.normalizeRenderRequest(request, "buffer");
    const key = renderBufferKey(id, renderRequestKey(renderRequest));
    let pg = this.compositionBuffer.get(key);
    if (!pg || pg.width !== renderRequest.width || pg.height !== renderRequest.height) {
      pg = createGraphics(renderRequest.width, renderRequest.height);
      this.applyGraphicsFont(pg);
      this.compositionBuffer.set(key, pg);
    }
    this.touchRenderCache(this.compositionBufferUse, key);
    return pg;
  }

  materializeDrawableBuffer(source, key, request = frameRenderRequest(this.state.render)) {
    if (!this.isShaderBuffer(source)) return source;
    const pg = this.getCompositionBuffer(key, request);
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
      target = createGraphics(widthPx, heightPx, WEBGL);
      group.targets[targetSlot] = target;
      this.applyGraphicsFont(target);
      target.noStroke();
      return target;
    }
    if (target.width !== widthPx || target.height !== heightPx) {
      try {
        target.resizeCanvas(widthPx, heightPx);
      } catch {
        disposeGraphics(target);
        target = createGraphics(widthPx, heightPx, WEBGL);
        group.targets[targetSlot] = target;
      }
      this.applyGraphicsFont(target);
      target.noStroke();
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
    pruneGraphicsMap(this.compositionSource, this.compositionSourceUse, {
      maxItems: 48,
      currentFrame: this.frameIndex,
      idleFrames: 900,
    });
    pruneGraphicsMap(this.compositionBuffer, this.compositionBufferUse, {
      maxItems: 48,
      currentFrame: this.frameIndex,
      idleFrames: 900,
    });
    for (const key of Array.from(this.stableCompositionSignatures.keys())) {
      if (!this.compositionBuffer.has(key)) this.stableCompositionSignatures.delete(key);
    }
  }

  drawChainLayer(output, source, layer) {
    const transform = layer.transform || {};
    output.push();
    applyBlend(output, layer.blend);
    output.tint(255, 255 * clamp01(layer.opacity ?? 1));
    output.imageMode(CENTER);
    output.translate(
      output.width * 0.5 + (Number(transform.x) || 0) * output.width * 0.5,
      output.height * 0.5 + (Number(transform.y) || 0) * output.height * 0.5
    );
    output.rotate(Number(transform.rotation) || 0);
    const scale = Math.max(0.01, Number(transform.scale) || 1);
    output.scale(scale);
    if (this.isShaderBuffer(source)) drawBuffer(output, source, -output.width / 2, -output.height / 2, output.width, output.height, true);
    else output.image(source, 0, 0, output.width, output.height);
    output.imageMode(CORNER);
    output.noTint();
    output.blendMode(BLEND);
    output.pop();
  }

  renderShaderChain(input, chain, request = frameRenderRequest(this.state.render), timeSeconds = this.visualTime) {
    const renderRequest = this.normalizeRenderRequest(request, "effect");
    const rw = renderRequest.width;
    const rh = renderRequest.height;
    let current = input;
    let passCount = 0;
    const schedule = compileShaderSchedule(chain);
    if (schedule.length) {
      this.frameProfile.shaderChains++;
      this.frameProfile.maxShaderChainLength = Math.max(this.frameProfile.maxShaderChainLength, schedule.length);
    }
    for (const job of schedule) {
      const pass = job.pass;
      if (pass.amount <= 0.0001) continue;
      let handoff = false;
      if (this.isShaderBuffer(current) && schedule.length <= 1) {
        handoff = true;
        current = this.materializeDrawableBuffer(current, `fx-handoff:${renderRequestKey(renderRequest)}:${passCount}`, renderRequest);
      }
      const target = this.getFxPingPongTarget(renderRequest, this.isShaderBuffer(current) ? nextFxTargetSlot(this.fxTargets, current) : passCount % 2);
      const shader = this.shaderBuilder.getShader(pass, target);
      if (!shader) continue;
      const sourceIsShaderBuffer = this.isShaderBuffer(current);
      this.measureShaderPass(pass, job.component, renderRequest, {
        handoff,
        sourceIsShaderBuffer,
        targetSlot: this.fxTargets?.[1] === target ? 1 : 0,
      }, () => {
        target.push();
        target.clear();
        target.shader(shader);
        shader.setUniform("tex0", current);
        shader.setUniform("resolution", [rw, rh]);
        shader.setUniform("canvasSize", [rw, rh]);
        shader.setUniform("texelSize", [1 / Math.max(1, rw), 1 / Math.max(1, rh)]);
        shader.setUniform("sourceFlipY", !sourceIsShaderBuffer);
        shader.setUniform("sourceForceOpaque", false);
        shader.setUniform("time", instanceTime(pass.instanceId || pass.id, timeSeconds));
        shader.setUniform("effectTransform", effectTransformUniform(pass.transform));
        this.setShaderParamUniforms(shader, job.component, pass.params);
        target.rect(-rw / 2, -rh / 2, rw, rh);
        target.resetShader();
        target.pop();
      });
      current = target;
      passCount++;
    }
    return current;
  }

  measureShaderPass(pass, component, renderRequest, meta, drawPass) {
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
    const result = drawPass();
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
    profile.compositionMs = roundMetric(profile.compositionMs);
    profile.totalMs = roundMetric(profile.totalMs);
    this.lastFrameProfile = profile;
  }

  renderShaderNodes(input, nodes, request = frameRenderRequest(this.state.render), timeSeconds = this.visualTime) {
    return this.renderShaderChain(input, nodes.map(shaderPassFromNode), request, timeSeconds);
  }

  setShaderParamUniforms(shader, component, params = {}, options = {}) {
    for (const param of component?.params || []) {
      const value = normalizeParamValue(param, params[param.id]);
      if (param.type === "boolean") {
        shader.setUniform(param.id, value !== false);
      } else if (param.type === "color") {
        shader.setUniform(param.id, colorUniform(value));
      } else if (param.type === "enum") {
        shader.setUniform(param.id, enumUniform(param, value));
      } else {
        shader.setUniform(param.id, Number(value) || 0);
      }
    }
    if (options.setDefaultAmount !== false && !component?.params?.some((param) => param.id === "amount")) {
      shader.setUniform("amount", 0);
    }
  }

  renderSurfaces() {
    const outputBlackout = this.isOutputBlackout();
    for (const surface of this.state.surfaces) {
      if (!surface.enabled) continue;
      const mapped = this.mapperSurfaces.get(surface.id);
      if (!mapped) continue;
      const composition = this.state.compositions.find((item) => item.id === surface.compositionId);
      const request = this.surfaceRouteRenderRequest(surface, composition);
      const pg = this.getSurfaceTexture(request);
      if (!pg) continue;
      pg.push();
      pg.clear();
      if (!outputBlackout) {
        this.drawSurfaceRoute(pg, surface, composition, request);
      } else {
        pg.background(0);
      }
      if (!outputBlackout && this.state.global.showLabels !== false && this.mapper.isCalibrating()) {
        drawSurfaceLabel(pg, surface, composition);
      }
      pg.pop();
      this.mapper.drawTexture(pg, mapped.mapperSurface);
    }
  }

  surfaceRouteRenderRequest(surface, composition = null) {
    if (composition?.type === "canvas") return canvasCompositionRenderRequest(composition, { surfaceId: surface.id });
    return stableSurfaceRenderRequest(this.state.render, { surfaceId: surface.id });
  }

  getSurfaceTexture(request = stableSurfaceRenderRequest(this.state?.render || {})) {
    const widthPx = Math.max(1, Math.round(Number(request.width) || 1));
    const heightPx = Math.max(1, Math.round(Number(request.height) || 1));
    if (this.surfaceTexture?.width === widthPx && this.surfaceTexture?.height === heightPx) return this.surfaceTexture;
    const key = `${widthPx}x${heightPx}`;
    let pg = this.surfaceTextures.get(key);
    if (!pg) {
      pg = createGraphics(widthPx, heightPx);
      this.applyGraphicsPixelDensity(pg);
      this.applyGraphicsFont(pg);
      this.surfaceTextures.set(key, pg);
    }
    return pg;
  }

  drawSurfaceRoute(pg, surface, composition = null, request = null) {
    if (!surface.compositionId) {
      pg.clear();
      return;
    }
    if (this.shouldUseThumbnailPreview()) {
      this.drawSurfaceThumbnailRoute(pg, surface);
      return;
    }
    composition ||= this.state.compositions.find((item) => item.id === surface.compositionId);
    const compositionTime = instanceTime(`surface:${surface.id}`, this.compositionTimes.get(surface.compositionId) || 0);
    request ||= this.surfaceRouteRenderRequest(surface, composition);
    const source = composition
      ? this.renderCompositionForRequest(composition, compositionTime, request)
      : this.mainMix;

    pg.push();
    applyBlend(pg, surface.finalBlend);
    pg.tint(255, 255 * clamp01(surface.opacity));
    if (composition?.type === "canvas") {
      drawSampleRect(pg, source, surface.sourceRect, 0, 0, pg.width, pg.height);
    } else {
      drawBuffer(pg, source, 0, 0, pg.width, pg.height, this.isShaderBuffer(source));
    }
    pg.noTint();
    pg.blendMode(BLEND);
    pg.pop();

    if (surface.finalShaderChain?.length) {
      const effected = this.renderShaderChain(pg, withShaderInstancePrefix(surface.finalShaderChain, surface.id), request, this.visualTime);
      drawBuffer(pg, effected, 0, 0, pg.width, pg.height, this.isShaderBuffer(effected));
    }
  }

  drawSurfaceThumbnailRoute(pg, surface) {
    const composition = this.state.compositions.find((item) => item.id === surface.compositionId);
    const thumbnail = this.getThumbnailImage(composition);
    pg.push();
    applyBlend(pg, surface.finalBlend);
    pg.tint(255, 255 * clamp01(surface.opacity));
    if (thumbnail?.ready && thumbnail.img) {
      drawBuffer(pg, thumbnail.img, 0, 0, pg.width, pg.height);
    } else {
      drawStandby(pg, composition?.thumbnail ? "loading thumbnail" : "no thumbnail");
    }
    pg.noTint();
    pg.blendMode(BLEND);
    pg.pop();
  }

  getThumbnailImage(composition) {
    if (!composition?.thumbnail) return null;
    const existing = this.thumbnailImages.get(composition.id);
    if (existing?.src === composition.thumbnail) return existing;
    const item = { src: composition.thumbnail, img: null, ready: false };
    this.thumbnailImages.set(composition.id, item);
    loadImage(
      composition.thumbnail,
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

  isShaderBuffer(buffer) {
    if (!buffer) return false;
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

  renderCompositionPreview() {
    const compositionId = this.state.ui.selectedCompositionId || this.state.compositions[0]?.id || "";
    const source = this.compositionOutput.get(compositionId);
    resetShader();
    push();
    imageMode(CORNER);
    if (source) {
      image(source, -width / 2, -height / 2, width, height);
    } else {
      const fallback = this.mainMix;
      image(fallback, -width / 2, -height / 2, width, height);
    }
    pop();
    this.renderSelectedChainTransformOverlay();
  }

  renderSelectedChainTransformOverlay() {
    if (this.mode !== "composition") return;
    const item = this.selectedTransformableChainItem();
    if (!item) return;
    const transform = item.transform || {};
    resetShader();
    push();
    noFill();
    stroke(101, 224, 211, 230);
    strokeWeight(2);
    const cx = (Number(transform.x) || 0) * width * 0.5;
    const cy = (Number(transform.y) || 0) * height * 0.5;
    const scale = Math.max(0.01, Number(transform.scale) || 1);
    const rotation = Number(transform.rotation) || 0;
    const boxW = width * scale;
    const boxH = height * scale;
    const scaleHandleX = 42;
    const scaleHandleY = 0;
    const rotateHandleX = 0;
    const rotateHandleY = -42;
    translate(cx, cy, 2);
    rotate(rotation);
    rectMode(CENTER);
    rect(0, 0, boxW, boxH);
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
    this.state.global.calibrating = !!on;
    this.mapper?.setCalibrate(!!on);
  }

  mousePressed(x, y) {
    if (this.mode === "composition" && this.startChainTransformDrag(x, y)) return;
    this.mapper?.mousePressed?.(x, y);
    const surfaceIndex = Number(this.mapper?._dragSurf);
    const surfaceName = Number.isInteger(surfaceIndex) && surfaceIndex >= 0
      ? this.mapper?.surfaces?.[surfaceIndex]?.name
      : "";
    if (surfaceName) this.onSurfaceSelect?.(surfaceName);
  }

  mouseDragged(x, y) {
    if (this.chainTransformDrag) {
      this.updateChainTransformDrag(x, y);
      return;
    }
    this.mapper?.mouseDragged?.(x, y);
  }

  mouseReleased() {
    if (this.chainTransformDrag) {
      this.chainTransformDrag = null;
      return;
    }
    this.mapper?.mouseReleased?.();
  }

  isCalibrating() {
    return !!this.mapper?.isCalibrating();
  }

  saveMapping() {
    this.emitMapping(this.mapper?.exportData?.() || {}, "Mapping saved");
  }

  schedule(event) {
    if (this.state?.scheduler?.manualLane === false) return;
    this.manualScheduler.enqueue(event);
  }

  selectedTransformableChainItem() {
    const composition = this.state?.compositions?.find((item) => item.id === this.state?.ui?.selectedCompositionId);
    if (!composition?.chain?.length) return null;
    const selected = findChainItemById(composition.chain, this.state.ui.selectedChainItemId);
    if (selected?.kind === "source") return selected;
    if (selected?.kind === "group") return selected;
    const component = selected?.kind === "effect" ? getShaderComponent(selected.componentId) : null;
    return component?.spatial ? selected : null;
  }

  startChainTransformDrag(x, y) {
    const item = this.selectedTransformableChainItem();
    if (!item) return false;
    const transform = item.transform || {};
    const cx = width * 0.5 + (Number(transform.x) || 0) * width * 0.5;
    const cy = height * 0.5 + (Number(transform.y) || 0) * height * 0.5;
    const scale = Math.max(0.01, Number(transform.scale) || 1);
    const rotation = Number(transform.rotation) || 0;
    const local = screenToLayerLocal(x, y, cx, cy, rotation);
    const boxW = width * scale;
    const boxH = height * scale;
    const scaleDx = local.x - 42;
    const scaleDy = local.y;
    const rotateDx = local.x;
    const rotateDy = local.y + 42;
    const inside = Math.abs(local.x) <= boxW * 0.5 && Math.abs(local.y) <= boxH * 0.5;
    let mode = "";
    if (scaleDx * scaleDx + scaleDy * scaleDy <= 28 * 28) mode = "scale";
    else if (rotateDx * rotateDx + rotateDy * rotateDy <= 30 * 30) mode = "rotate";
    else if (inside) mode = "move";
    if (!mode) return false;
    this.chainTransformDrag = {
      itemId: item.id,
      compositionId: this.state.ui.selectedCompositionId,
      mode,
      startX: x,
      startY: y,
      centerX: cx,
      centerY: cy,
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
      next.x = drag.transform.x + ((x - drag.startX) / Math.max(1, width * 0.5));
      next.y = drag.transform.y + ((y - drag.startY) / Math.max(1, height * 0.5));
    } else if (drag.mode === "scale") {
      const distance = Math.max(1, dist(x, y, drag.centerX, drag.centerY));
      next.scale = Math.max(0.05, drag.transform.scale * (distance / drag.startDistance));
    } else if (drag.mode === "rotate") {
      const angle = Math.atan2(y - drag.centerY, x - drag.centerX);
      next.rotation = drag.transform.rotation + (angle - drag.startAngle);
    }
    this.applyLocalChainTransform(drag.compositionId, drag.itemId, next);
    this.sendChainTransform?.(drag.compositionId, drag.itemId, next);
  }

  applyLocalChainTransform(compositionId, itemId, transform) {
    const composition = this.state?.compositions?.find((item) => item.id === compositionId);
    const item = findChainItemById(composition?.chain, itemId);
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
    const compositionsById = new Map((this.state.compositions || []).map((composition) => [composition.id, composition]));
    for (const surface of this.state.surfaces || []) {
      if (surface.enabled === false || !surface.compositionId) continue;
      this.collectCompositionMediaReadiness(compositionsById.get(surface.compositionId), status, compositionsById, new Set());
    }
    status.blocked = status.loadingIds.size > 0 || status.missingIds.size > 0 || status.errorIds.size > 0;
    return status;
  }

  collectCompositionMediaReadiness(composition, status, compositionsById, visited) {
    if (!composition || !status || visited.has(composition.id)) return;
    visited.add(composition.id);
    if (composition.type === "canvas") {
      for (const layer of composition.canvas?.layers || []) {
        if (layer.enabled === false || !layer.compositionId || layer.compositionId === composition.id) continue;
        this.collectCompositionMediaReadiness(compositionsById.get(layer.compositionId), status, compositionsById, visited);
      }
      visited.delete(composition.id);
      return;
    }
    if (Array.isArray(composition.chain) && composition.chain.length) {
      this.collectChainMediaReadiness(composition.chain, status);
    } else {
      this.collectSourceMediaReadiness(composition.source, status);
    }
    visited.delete(composition.id);
  }

  collectChainMediaReadiness(chain, status) {
    for (const item of chain || []) {
      if (item.enabled === false) continue;
      if (item.kind === "group") {
        this.collectChainMediaReadiness(item.chain || [], status);
        continue;
      }
      if (item.kind === "source") this.collectSourceMediaReadiness(item.source, status);
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
    return this.mode === "preview" && this.state?.ui?.debugPreview === false;
  }

  updateHudAndMetrics() {
    const frameMs = performance.now() - this.frameStart;
    const fps = frameRate();
    const renderCost = frameMs / (1000 / 120);
    this.updateSmoothedMetrics({ fps, frameMs, renderCost });
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
        renderCost: this.smoothedRenderCost || renderCost,
        renderWidth: renderResolution.width,
        renderHeight: renderResolution.height,
        renderPixelDensity: renderResolution.density,
        profile: this.lastFrameProfile,
        message: this.shouldUseThumbnailPreview()
          ? "thumbnail preview"
          : this.mode === "composition" ? "composition preview" : `${this.mode} rendering`,
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

  captureSelectedCompositionThumbnail() {
    if (!this.sendThumbnail || millis() - this.lastThumbnailAt < 1200) return;
    const composition = this.state.compositions.find((item) => item.id === this.state.ui.selectedCompositionId) || this.state.compositions[0];
    if (!composition) return;
    const output = this.compositionOutput.get(composition.id);
    if (!output?.canvas) return;
    const signature = compositionThumbnailSignature(composition);
    if (composition.thumbnail && this.thumbnailSignatures.get(composition.id) === signature) return;
    const thumbnail = graphicsToThumbnail(output);
    if (!thumbnail) return;
    this.lastThumbnailAt = millis();
    this.thumbnailSignatures.set(composition.id, signature);
    this.sendThumbnail(composition.id, thumbnail);
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
  return createRenderRequest("surface", aspectPreservingSurfaceTextureSize(render), {
    ...meta,
    instanceId: meta.instanceId || meta.surfaceId || "",
  });
}

function aspectPreservingSurfaceTextureSize(render = {}) {
  const frame = frameSize(render);
  const maxTexture = surfaceTextureSize(render);
  const scale = Math.min(
    maxTexture.width / Math.max(1, frame.width),
    maxTexture.height / Math.max(1, frame.height)
  );
  return {
    width: Math.max(1, Math.round(frame.width * scale)),
    height: Math.max(1, Math.round(frame.height * scale)),
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

function nodesInCompositionChainOrder(composition = {}, patch = {}) {
  const nodes = (patch.nodes || []).filter((node) => isSourceNode(node) || isEffectNode(node));
  if (!Array.isArray(composition.chain) || !composition.chain.length) return nodes;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return flattenCompositionChain(composition.chain)
    .map((item, index) => {
      if (item.kind === "source") return nodeById.get(`${composition.id || "composition"}:source:${index}:${item.id}`);
      if (item.kind === "effect") return nodeById.get(`${composition.id || "composition"}:effect:${index}:${item.componentId}`);
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
    !Number(transform.x) &&
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

function sourceWithNodeParams(source = {}, params = {}, instanceId = "") {
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

const STATIC_GENERATOR_IDS = new Set(["gradient", "checker", "black"]);
const SEED_CONTROLLED_EFFECT_IDS = new Set(["photoGrade", "labelGrain", "labelThresholdGrain", "glitchDistort", "heatShimmer", "smear"]);

function staticCompositionState(composition = {}) {
  return {
    id: composition.id || "",
    type: composition.type || "composition",
    source: staticSourceState(composition.source),
    shaderChain: staticEffectChainState(composition.shaderChain || []),
    chain: staticChainState(composition.chain || []),
  };
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
    generatorId: source.generatorId || "",
    start: source.start,
    end: source.end,
    speed: source.speed,
    params: source.params || {},
  };
}

function staticMediaState(media = [], composition = {}) {
  const ids = new Set();
  collectMediaIdsFromSource(composition.source, ids);
  collectMediaIdsFromChain(composition.chain || [], ids);
  return (media || [])
    .filter((item) => ids.has(item.id))
    .map((item) => ({
      id: item.id || "",
      path: item.path || "",
      type: item.type || "",
      size: item.size || 0,
    }));
}

function collectMediaIdsFromChain(chain = [], ids) {
  for (const item of chain || []) {
    if (item.kind === "group") collectMediaIdsFromChain(item.chain || [], ids);
    else collectMediaIdsFromSource(item.source, ids);
  }
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

function createEmptyFrameProfile() {
  return {
    shaderPasses: 0,
    shaderChains: 0,
    maxShaderChainLength: 0,
    shaderHandoffs: 0,
    compositionCacheHits: 0,
    shaderMs: 0,
    sourceMs: 0,
    compositionMs: 0,
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

function compositionThumbnailSignature(composition) {
  try {
    return JSON.stringify({
      source: composition.source,
      opacity: composition.opacity,
      blend: composition.blend,
      speed: composition.speed,
      chain: composition.chain,
      shaderChain: composition.shaderChain,
    });
  } catch {
    return `${composition.id}:${millis()}`;
  }
}

const COMPOSITION_THUMBNAIL_WIDTH = 768;
const COMPOSITION_THUMBNAIL_HEIGHT = 432;
const COMPOSITION_THUMBNAIL_QUALITY = 0.92;

function graphicsToThumbnail(pg, width = COMPOSITION_THUMBNAIL_WIDTH, height = COMPOSITION_THUMBNAIL_HEIGHT) {
  try {
    const source = pg.canvas || pg.elt;
    if (!source) return "";
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return "";
    const sourceWidth = source.videoWidth || source.naturalWidth || source.width || width;
    const sourceHeight = source.videoHeight || source.naturalHeight || source.height || height;
    const scale = Math.max(width / Math.max(1, sourceWidth), height / Math.max(1, sourceHeight));
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    const dx = (width - drawWidth) * 0.5;
    const dy = (height - drawHeight) * 0.5;
    context.fillStyle = "#000";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, dx, dy, drawWidth, drawHeight);
    const webp = canvas.toDataURL("image/webp", COMPOSITION_THUMBNAIL_QUALITY);
    if (webp.startsWith("data:image/webp")) return webp;
    return canvas.toDataURL("image/png");
  } catch (error) {
    console.warn("[VJ1_THUMBNAIL_CAPTURE_FAILED]", { message: error?.message || String(error) });
    return "";
  }
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

function withShaderInstancePrefix(chain = [], prefix = "") {
  return (chain || []).map((pass, index) => ({
    ...pass,
    instanceId: pass.instanceId || `${prefix || "shader"}:${index}:${pass.componentId || pass.id || "pass"}`,
  }));
}

function instanceTime(instanceId, baseTime = 0) {
  return Number(baseTime) + instanceTimeOffset(instanceId);
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

function effectTransformUniform(transform = {}) {
  return [
    Number(transform.x) || 0,
    Number(transform.y) || 0,
    Math.max(0.0001, Number(transform.scale) || 1),
    Number(transform.rotation) || 0,
  ];
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
  if (!sourceIsWebGL) {
    pg.image(source, x, y, w, h);
    return;
  }
  drawWebGLBuffer(pg, source, x, y, w, h);
}

function drawRawParsedModelMode(target, item, params = {}, compositionTime = 0, renderMode = "surface", surfaceColor = [220, 225, 220, 255], wireColor = [20, 20, 20, 220], pointBudget = 4000, viewport = null) {
  if (renderMode === "points") {
    return drawRawParsedModel(target, item, params, compositionTime, "points", wireColor, pointBudget, viewport);
  }
  if (renderMode === "wireframe") {
    return drawRawParsedWire(target, item, params, compositionTime, wireColor, pointBudget, viewport);
  }
  const drewSurface = drawRawParsedSurface(target, item, params, compositionTime, surfaceColor, viewport);
  if (drewSurface && renderMode === "surfaceWire") {
    drawRawParsedWire(target, item, params, compositionTime, wireColor, pointBudget, viewport);
  }
  return drewSurface;
}

function drawRawParsedModel(target, item, params = {}, compositionTime = 0, mode = "points", color = [245, 245, 245, 255], pointBudget = 4000, viewport = null) {
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
  const rotation = modelRotation(params, compositionTime);
  const mvp = rawModelMvp(metrics.width, metrics.height, scale, depth, rotation);
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
  gl.uniformMatrix4fv(resources.mvp, false, mvp);
  gl.uniform4fv(resources.color, rgba);
  gl.uniform1f(resources.pointSize, Math.max(1, Number(params.pointSize) || 2));
  gl.drawArrays(mode === "wireframe" ? gl.LINES : gl.POINTS, 0, resources.count);
  gl.disableVertexAttribArray(resources.position);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  if (mode === "wireframe") gl.lineWidth(1);
  gl.useProgram(null);
  return true;
}

function drawRawParsedWire(target, item, params = {}, compositionTime = 0, color = [20, 20, 20, 220], pointBudget = 4000, viewport = null) {
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
  const rotation = modelRotation(params, compositionTime);
  const mvp = rawModelMvp(metrics.width, metrics.height, scale, depth, rotation);
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
  gl.uniformMatrix4fv(resources.mvp, false, mvp);
  gl.uniform2f(resources.resolution, drawingWidth, drawingHeight);
  gl.uniform1f(resources.thickness, modelWireThickness(params));
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

function drawRawParsedSurface(target, item, params = {}, compositionTime = 0, color = [220, 225, 220, 255], viewport = null) {
  const gl = target?.drawingContext;
  const mesh = item?.modelData;
  if (!gl || !mesh) return false;
  const resources = ensureRawSurfaceResources(gl, item);
  if (!resources?.positionBuffer || !resources.normalBuffer || !resources.count || !resources.program) return false;
  const drawingWidth = Math.max(1, gl.drawingBufferWidth || target.width || 1);
  const drawingHeight = Math.max(1, gl.drawingBufferHeight || target.height || 1);
  const metrics = modelViewportMetrics(target, viewport);
  const modelScale = Math.max(0.01, Number(params.modelScale) || 1);
  const depth = Math.max(0.05, Number(params.depth) || 1);
  const scale = metrics.unitScale * modelScale;
  const rotation = modelRotation(params, compositionTime);
  const matrices = rawModelMatrices(metrics.width, metrics.height, scale, depth, rotation);
  const rgba = color.map((channel) => Math.max(0, Math.min(1, Number(channel) / 255 || 0)));

  gl.useProgram(resources.program);
  gl.viewport(0, 0, drawingWidth, drawingHeight);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.CULL_FACE);
  gl.bindBuffer(gl.ARRAY_BUFFER, resources.positionBuffer);
  gl.enableVertexAttribArray(resources.position);
  gl.vertexAttribPointer(resources.position, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, resources.normalBuffer);
  gl.enableVertexAttribArray(resources.normal);
  gl.vertexAttribPointer(resources.normal, 3, gl.FLOAT, false, 0, 0);
  gl.uniformMatrix4fv(resources.mvp, false, matrices.mvp);
  gl.uniformMatrix4fv(resources.model, false, matrices.model);
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

function drawProceduralAnatomy(target, params = {}, compositionTime = 0, renderMode = "surface", surfaceColor = [217, 212, 201, 255], wireColor = [75, 73, 68, 204], wireThickness = 1.6, detail = 8) {
  const part = params.part || "face";
  if (part === "body") return drawLowPolyBody(target, params, renderMode, surfaceColor, wireColor, wireThickness, detail);
  if (part === "hand") return drawLowPolyHand(target, params, renderMode, surfaceColor, wireColor, wireThickness, detail);
  if (part === "arm") return drawLowPolyArm(target, params, renderMode, surfaceColor, wireColor, wireThickness, detail);
  if (part === "leg") return drawLowPolyLeg(target, params, renderMode, surfaceColor, wireColor, wireThickness, detail);
  if (part === "heart") return drawLowPolyHeart(target, params, compositionTime, renderMode, surfaceColor, wireColor, wireThickness, detail);
  return drawLowPolyFace(target, params, renderMode, surfaceColor, wireColor, wireThickness, detail);
}

function drawAnatomyShape(target, renderMode, surfaceColor, wireColor, wireThickness, drawShape) {
  if (renderMode !== "wireframe" && renderMode !== "points") {
    target.noStroke();
    target.ambientMaterial?.(...surfaceColor);
    target.fill?.(...surfaceColor);
    drawShape();
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
    emitTriangles();
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

function drawLowPolyHeart(target, params, compositionTime, renderMode, surfaceColor, wireColor, wireThickness, detail) {
  const pulse = clamp01(Number(params.heartPulse) || 0);
  const beat = pulse * (0.045 + 0.04 * Math.max(0, Math.sin(compositionTime * 5.4)) + 0.025 * Math.max(0, Math.sin(compositionTime * 10.8 + 0.9)));
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

function modelRotation(params = {}, compositionTime = 0) {
  return [
    (Number(params.rotationX) || 0) + compositionTime * (Number(params.spinX) || 0),
    (Number(params.rotationY) || 0) + compositionTime * (Number(params.spinY) || 0),
    (Number(params.rotationZ) || 0) + compositionTime * (Number(params.spinZ) || 0),
  ];
}

function modelWireThickness(params = {}) {
  return Math.max(0.5, Math.min(12, Number(params.wireThickness) || 1));
}

function modelViewportMetrics(target, request = {}) {
  const width = Math.max(1, Math.round(Number(request?.width || target?.width) || 1));
  const height = Math.max(1, Math.round(Number(request?.height || target?.height) || 1));
  const verticalUnit = height;
  return {
    width,
    height,
    cameraZ: verticalUnit * 0.92,
    unitScale: verticalUnit * 0.0065,
  };
}

function ensureRawModelResources(gl, item, mode = "points", pointBudget = 4000) {
  item.modelRawRenderers ||= new WeakMap();
  let contextResources = item.modelRawRenderers.get(gl);
  if (!contextResources) {
    contextResources = {
      program: createRawModelProgram(gl),
      surfaceProgram: createRawSurfaceProgram(gl),
      wireProgram: createRawWireProgram(gl),
      buffers: new Map(),
    };
    item.modelRawRenderers.set(gl, contextResources);
  }
  if (!contextResources.program) return null;
  const budget = Math.max(128, Math.min(50000, Math.round(Number(pointBudget) || 4000)));
  const meshKey = `${item.modelData?.triangles?.length || 0}`;
  const key = mode === "wireframe" ? `wire:${meshKey}` : `points:${meshKey}:${budget}`;
  let buffer = contextResources.buffers.get(key);
  if (!buffer) {
    const data = mode === "wireframe"
      ? ensureParsedModelWireLines(item, budget)
      : ensureParsedModelPointCloud(item, budget);
    if (!data?.length) return null;
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
    color: contextResources.program.color,
    pointSize: contextResources.program.pointSize,
  };
}

function ensureRawSurfaceResources(gl, item) {
  item.modelRawRenderers ||= new WeakMap();
  let contextResources = item.modelRawRenderers.get(gl);
  if (!contextResources) {
    contextResources = {
      program: createRawModelProgram(gl),
      surfaceProgram: createRawSurfaceProgram(gl),
      wireProgram: createRawWireProgram(gl),
      buffers: new Map(),
    };
    item.modelRawRenderers.set(gl, contextResources);
  } else if (!contextResources.surfaceProgram) {
    contextResources.surfaceProgram = createRawSurfaceProgram(gl);
  }
  if (!contextResources.surfaceProgram) return null;
  const meshKey = `${item.modelData?.triangles?.length || 0}`;
  const key = `surface:${meshKey}`;
  let buffer = contextResources.buffers.get(key);
  if (!buffer) {
    const data = ensureParsedModelSurfaceArrays(item);
    if (!data?.positions?.length || !data?.normals?.length) return null;
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.positions, gl.STATIC_DRAW);
    const normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.normals, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    buffer = {
      positionBuffer,
      normalBuffer,
      count: Math.floor(data.positions.length / 3),
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
  };
}

function ensureRawWireResources(gl, item, pointBudget = 4000) {
  item.modelRawRenderers ||= new WeakMap();
  let contextResources = item.modelRawRenderers.get(gl);
  if (!contextResources) {
    contextResources = {
      program: createRawModelProgram(gl),
      surfaceProgram: createRawSurfaceProgram(gl),
      wireProgram: createRawWireProgram(gl),
      buffers: new Map(),
    };
    item.modelRawRenderers.set(gl, contextResources);
  } else if (!contextResources.wireProgram) {
    contextResources.wireProgram = createRawWireProgram(gl);
  }
  if (!contextResources.wireProgram) return null;
  const budget = Math.max(128, Math.min(50000, Math.round(Number(pointBudget) || 4000)));
  const meshKey = `${item.modelData?.triangles?.length || 0}`;
  const key = `thickWire:${meshKey}:${budget}`;
  let buffer = contextResources.buffers.get(key);
  if (!buffer) {
    const data = ensureParsedModelThickWireVertices(item, budget);
    if (!data?.length) return null;
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
    resolution: contextResources.wireProgram.resolution,
    thickness: contextResources.wireProgram.thickness,
    color: contextResources.wireProgram.color,
  };
}

function createRawModelProgram(gl) {
  const vertex = compileRawShader(gl, gl.VERTEX_SHADER, `
    attribute vec3 aPosition;
    uniform mat4 uMvp;
    uniform float uPointSize;
    void main() {
      gl_Position = uMvp * vec4(aPosition, 1.0);
      gl_PointSize = uPointSize;
    }
  `);
  const fragment = compileRawShader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    uniform vec4 uColor;
    void main() {
      gl_FragColor = uColor;
    }
  `);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return {
    program,
    position: gl.getAttribLocation(program, "aPosition"),
    mvp: gl.getUniformLocation(program, "uMvp"),
    color: gl.getUniformLocation(program, "uColor"),
    pointSize: gl.getUniformLocation(program, "uPointSize"),
  };
}

function createRawSurfaceProgram(gl) {
  const vertex = compileRawShader(gl, gl.VERTEX_SHADER, `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    uniform mat4 uMvp;
    uniform mat4 uModel;
    varying float vLight;
    void main() {
      vec3 n = normalize((uModel * vec4(aNormal, 0.0)).xyz);
      vec3 keyLight = normalize(vec3(-0.35, -0.45, 0.75));
      vLight = clamp(dot(n, keyLight) * 0.55 + 0.45, 0.0, 1.0);
      gl_Position = uMvp * vec4(aPosition, 1.0);
    }
  `);
  const fragment = compileRawShader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    uniform vec4 uColor;
    varying float vLight;
    void main() {
      gl_FragColor = vec4(uColor.rgb * vLight, uColor.a);
    }
  `);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return {
    program,
    position: gl.getAttribLocation(program, "aPosition"),
    normal: gl.getAttribLocation(program, "aNormal"),
    mvp: gl.getUniformLocation(program, "uMvp"),
    model: gl.getUniformLocation(program, "uModel"),
    color: gl.getUniformLocation(program, "uColor"),
  };
}

function createRawWireProgram(gl) {
  const vertex = compileRawShader(gl, gl.VERTEX_SHADER, `
    attribute vec3 aStart;
    attribute vec3 aEnd;
    attribute float aSide;
    attribute float aAlong;
    uniform mat4 uMvp;
    uniform vec2 uResolution;
    uniform float uThickness;
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
      vec2 pixelToNdc = vec2(2.0 / max(1.0, uResolution.x), 2.0 / max(1.0, uResolution.y));
      clip.xy += normal * pixelToNdc * (max(0.5, uThickness) * 0.5) * aSide * clip.w;
      gl_Position = clip;
    }
  `);
  const fragment = compileRawShader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    uniform vec4 uColor;
    void main() {
      gl_FragColor = uColor;
    }
  `);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return {
    program,
    start: gl.getAttribLocation(program, "aStart"),
    end: gl.getAttribLocation(program, "aEnd"),
    side: gl.getAttribLocation(program, "aSide"),
    along: gl.getAttribLocation(program, "aAlong"),
    mvp: gl.getUniformLocation(program, "uMvp"),
    resolution: gl.getUniformLocation(program, "uResolution"),
    thickness: gl.getUniformLocation(program, "uThickness"),
    color: gl.getUniformLocation(program, "uColor"),
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

function rawModelMvp(width = 1, height = 1, scale = 1, depth = 1, rotation = [0, 0, 0]) {
  return rawModelMatrices(width, height, scale, depth, rotation).mvp;
}

function rawModelMatrices(width = 1, height = 1, scale = 1, depth = 1, rotation = [0, 0, 0]) {
  const projection = mat4Perspective(Math.PI / 3, width / Math.max(1, height), 0.1, 5000);
  const cameraZ = Math.max(1, height) * 0.92;
  const view = mat4LookAt([0, 0, cameraZ], [0, 0, 0], [0, 1, 0]);
  let model = mat4Identity();
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
    drawParsedTriangles(target, mesh);
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
    target.model(geometry);
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

function ensureParsedModelSurfaceArrays(item) {
  const mesh = item?.modelData;
  const key = `surface:${mesh?.triangles?.length || 0}`;
  if (item?.modelSurfaceArrays && item.modelSurfaceArraysKey === key) return item.modelSurfaceArrays;
  const arrays = buildParsedModelSurfaceArrays(mesh);
  if (item) {
    item.modelSurfaceArrays = arrays;
    item.modelSurfaceArraysKey = key;
  }
  return arrays;
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

function buildParsedModelSurfaceArrays(mesh) {
  const triangles = Array.isArray(mesh?.triangles) ? mesh.triangles : [];
  if (!triangles.length) return { positions: new Float32Array(0), normals: new Float32Array(0) };
  const positions = new Float32Array(triangles.length * 9);
  const normals = new Float32Array(triangles.length * 9);
  let write = 0;
  for (const triangle of triangles) {
    const normal = normalizeVector(triangle.normal || triangleNormal(triangle.vertices || []));
    for (const vertex of triangle.vertices || []) {
      positions[write] = Number(vertex[0]) || 0;
      normals[write++] = normal[0];
      positions[write] = Number(vertex[1]) || 0;
      normals[write++] = normal[1];
      positions[write] = Number(vertex[2]) || 0;
      normals[write++] = normal[2];
    }
  }
  return {
    positions: positions.subarray(0, write),
    normals: normals.subarray(0, write),
  };
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
  return { triangles: normalizedTriangles, bounds };
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

function drawWebGLBuffer(pg, source, x, y, w, h) {
  pg.push();
  pg.translate(x, y + h);
  pg.scale(1, -1);
  pg.image(source, 0, 0, w, h);
  pg.pop();
}

function canvasCompositionRenderRequest(composition = {}, meta = {}) {
  const canvas = composition.canvas || {};
  return createRenderRequest("texture", {
    width: Math.max(1, Math.round(Number(canvas.width) || 3840)),
    height: Math.max(1, Math.round(Number(canvas.height) || 2160)),
    reason: "canvas-sample",
  }, {
    ...meta,
    instanceId: meta.instanceId || meta.surfaceId || "",
  });
}

function drawSurfaceLabel(pg, surface, composition) {
  pg.noStroke();
  pg.fill(255, 230);
  pg.textAlign(LEFT, TOP);
  pg.textSize(28);
  pg.text(surface.name, 28, 24);
  pg.textSize(16);
  pg.fill(255, 165);
  pg.text(`${composition?.name || "No composition"} / ${surface.finalBlend} / ${Math.round(clamp01(surface.opacity) * 100)}%`, 28, 60);
}
