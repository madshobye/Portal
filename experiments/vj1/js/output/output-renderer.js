import { VJ1 } from "../constants.js";
import { clamp01, sanitizeState } from "../domain/models.js?v=world-frame-27";
import { normalizeParamValue } from "../graph/component-schema.js";
import { createManualScheduler } from "../graph/manual-scheduler.js";
import { compileCompositionPatch, compileShaderSchedule } from "../graph/render-scheduler.js?v=world-frame-27";
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

  syncMapperOverlayMode() {
    this.mapper?.setOverlayMode?.(this.state?.global?.mappingHandleMode || "always");
  }

  syncMapperEdgeSoftness() {
    this.mapper?.setEdgeSoftness?.(this.state?.render?.edgeSoftness || 0);
  }

  applyPixelDensity() {
    const density = Math.max(0.5, Math.min(2, Number(this.state?.render?.pixelDensity) || 1));
    if (this.lastPixelDensity === density) return;
    if (typeof pixelDensity === "function") pixelDensity(density);
    this.lastPixelDensity = density;
  }

  applyGraphicsPixelDensity(pg) {
    if (!pg?.pixelDensity) return;
    const density = Math.max(0.5, Math.min(2, Number(this.state?.render?.pixelDensity) || 1));
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
        item = { id, file, url, video: null, image: null, imageError: "", model: null, modelData: null, modelGeometry: null, modelGeometryFailed: false, modelError: "", imageRenditions: new Map(), imageRenditionOrder: [], ready: false };
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
    if (composition.type === "canvas") {
      const output = this.measureProfile("compositionMs", {
        type: "composition",
        compositionId: composition.id,
        compositionName: composition.name || composition.id || "Canvas",
        width: renderRequest.width,
        height: renderRequest.height,
      }, () => this.renderCanvasComposition(composition, compositionTime, renderRequest));
      this.compositionOutput.set(outputKey, output);
      if (renderRequest.width === this.mainMix.width && renderRequest.height === this.mainMix.height) {
        this.compositionOutput.set(composition.id, output);
      }
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
    this.compositionOutput.set(outputKey, output);
    if (renderRequest.width === this.mainMix.width && renderRequest.height === this.mainMix.height) {
      this.compositionOutput.set(composition.id, output);
    }
    return output;
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
        drawBuffer(groupOutput, output, 0, 0, groupOutput.width, groupOutput.height, this.isShaderBuffer(output));
        groupOutput.pop();
        this.renderCompositionChainItems(composition, item.chain || [], groupOutput, compositionTime, renderRequest);
        output.push();
        output.clear();
        output.pop();
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
    this.safeDrawSourceToGraphics(pg, withSourceInstance(composition.source, `${composition.id}:source`), composition, compositionTime);
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
    this.safeDrawSourceToGraphics(pg, withSourceInstance(item.source || composition.source, item.id), composition, compositionTime);
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
    this.safeDrawSourceToGraphics(pg, sourceFromPatchNode(node), composition, compositionTime);
    pg.pop();
    return pg;
  }

  safeDrawSourceToGraphics(pg, source, composition, compositionTime) {
    try {
      this.drawSourceToGraphics(pg, source, composition, compositionTime);
    } catch (error) {
      console.error("[VJ1_SOURCE_CRASH]", {
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

  drawSourceToGraphics(pg, source, composition, compositionTime) {
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
        this.drawModelSource(pg, item, source, compositionTime);
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
      if (this.drawShaderGenerator(pg, source, generatorTime)) return;
      drawGenerator(pg, source.generatorId, generatorTime, source.params || {});
    }
  }

  drawModelSource(pg, item, source = {}, compositionTime = this.visualTime) {
    const target = this.getModelTarget(pg.width, pg.height);
    const params = source.params || {};
    const renderMode = params.renderMode || "surface";
    const modelScale = Math.max(0.01, Number(params.modelScale) || 1);
    const depth = Math.max(0.05, Number(params.depth) || 1);
    const surfaceColor = modelColor(params.surfaceColor, [220, 225, 220, 255]);
    const wireColor = modelColor(params.wireColor, [20, 20, 20, 220]);
    target.push();
    target.clear();
    target.perspective?.(Math.PI / 3, target.width / Math.max(1, target.height), 0.1, 5000);
    target.camera?.(0, 0, Math.max(target.width, target.height) * 0.92, 0, 0, 0, 0, 1, 0);
    target.ambientLight?.(95);
    target.directionalLight?.(220, 220, 220, -0.35, -0.45, -0.75);
    target.rotateX((Number(params.rotationX) || 0) + compositionTime * (Number(params.spinX) || 0));
    target.rotateY((Number(params.rotationY) || 0) + compositionTime * (Number(params.spinY) || 0));
    target.rotateZ((Number(params.rotationZ) || 0) + compositionTime * (Number(params.spinZ) || 0));
    const scale = Math.min(target.width, target.height) * 0.0065 * modelScale;
    target.scale(scale, scale, scale * depth);
    if (item.modelData) {
      const geometry = ensureParsedModelGeometry(item);
      if (geometry && renderMode !== "points") {
        try {
          drawGeometryModel(target, geometry, renderMode, surfaceColor, wireColor);
        } catch (error) {
          item.modelGeometryFailed = true;
          item.modelGeometry = null;
          item.modelGeometryError = error?.message || String(error || "geometry render failed");
          drawParsedModel(target, item.modelData, renderMode, surfaceColor, wireColor);
        }
      } else {
        drawParsedModel(target, item.modelData, renderMode, surfaceColor, wireColor);
      }
    } else if (renderMode === "points") {
      drawModelPoints(target, item.model, wireColor);
    } else if (renderMode === "wireframe") {
      target.noFill();
      target.stroke(...wireColor);
      target.strokeWeight(1);
      target.model(item.model);
    } else {
      target.noStroke();
      target.ambientMaterial?.(...surfaceColor);
      target.fill?.(...surfaceColor);
      target.model(item.model);
      if (renderMode === "surfaceWire") {
        target.noFill();
        target.stroke(...wireColor);
        target.strokeWeight(0.8);
        target.model(item.model);
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
      const pg = this.surfaceTexture;
      if (!pg) continue;
      pg.push();
      pg.clear();
      if (!outputBlackout) {
        this.drawSurfaceRoute(pg, surface);
      } else {
        pg.background(0);
      }
      if (!outputBlackout && this.state.global.showLabels !== false && this.mapper.isCalibrating()) {
        const composition = this.state.compositions.find((item) => item.id === surface.compositionId);
        drawSurfaceLabel(pg, surface, composition);
      }
      pg.pop();
      this.mapper.drawTexture(pg, mapped.mapperSurface);
    }
  }

  drawSurfaceRoute(pg, surface) {
    if (!surface.compositionId) {
      pg.clear();
      return;
    }
    if (this.shouldUseThumbnailPreview()) {
      this.drawSurfaceThumbnailRoute(pg, surface);
      return;
    }
    const composition = this.state.compositions.find((item) => item.id === surface.compositionId);
    const compositionTime = instanceTime(`surface:${surface.id}`, this.compositionTimes.get(surface.compositionId) || 0);
    const request = composition?.type === "canvas"
      ? canvasCompositionRenderRequest(composition, { surfaceId: surface.id })
      : stableFrameRenderRequest(this.state.render, { surfaceId: surface.id });
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
    graphicsToJpegBlob(pg)
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
      this.hud.classList.toggle("is-hidden", !this.state.global.showHud || (hideOutputHud && !mediaLoading));
      this.hud.classList.toggle("is-loading", mediaLoading);
      this.hud.innerHTML = `${mediaLoading ? `<span class="output-loading-dot" aria-hidden="true"></span>` : ""}<span>${Math.round(this.smoothedFps || fps)} fps</span>`;
    }
    if (millis() - this.lastMetricsAt > 500) {
      this.lastMetricsAt = millis();
      this.sendMetrics?.({
        fps: this.smoothedFps || fps,
        frameMs: this.smoothedFrameMs || frameMs,
        renderCost: this.smoothedRenderCost || renderCost,
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
  return createRenderRequest("surface", surfaceTextureSize(render), {
    ...meta,
    instanceId: meta.instanceId || meta.surfaceId || "",
  });
}

function stableFrameRenderRequest(render = {}, meta = {}) {
  return createRenderRequest("frame", frameSize(render), {
    ...meta,
    instanceId: meta.instanceId || meta.surfaceId || "",
  });
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

function flattenCompositionChain(chain = []) {
  const flat = [];
  for (const item of chain || []) {
    if (item.enabled === false) continue;
    if (item.kind === "group") {
      flat.push(...flattenCompositionChain(item.chain || []));
      continue;
    }
    flat.push(item);
  }
  return flat;
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
  if (node.state?.source) return withSourceInstance(node.state.source, node.id || node.state?.layer?.id);
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

function graphicsToJpegBlob(pg) {
  const canvas = pg?.canvas || pg?.elt;
  if (!canvas?.toBlob) return Promise.resolve(null);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.84));
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

function graphicsToThumbnail(pg, width = 512, height = 288) {
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
    context.drawImage(source, dx, dy, drawWidth, drawHeight);
    return canvas.toDataURL("image/jpeg", 0.82);
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

function drawModelPoints(target, model, wireColor = [245, 245, 245, 255]) {
  const vertices = Array.isArray(model?.vertices) ? model.vertices : [];
  target.noFill();
  target.stroke(...wireColor);
  target.strokeWeight(2);
  target.beginShape(POINTS);
  for (const vertex of vertices) {
    target.vertex(Number(vertex.x) || 0, Number(vertex.y) || 0, Number(vertex.z) || 0);
  }
  target.endShape();
}

function drawParsedModel(target, mesh, renderMode = "surface", surfaceColor = [220, 225, 220, 255], wireColor = [20, 20, 20, 220]) {
  if (renderMode === "points") {
    target.noFill();
    target.stroke(...wireColor);
    target.strokeWeight(2);
    target.beginShape(POINTS);
    for (const triangle of mesh.triangles || []) {
      for (const vertex of triangle.vertices || []) target.vertex(vertex[0], vertex[1], vertex[2]);
    }
    target.endShape();
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
    target.strokeWeight(renderMode === "wireframe" ? 1 : 0.8);
    drawParsedTriangles(target, mesh);
  }
}

function drawGeometryModel(target, geometry, renderMode = "surface", surfaceColor = [220, 225, 220, 255], wireColor = [20, 20, 20, 220]) {
  if (renderMode !== "wireframe") {
    target.noStroke();
    target.ambientMaterial?.(...surfaceColor);
    target.fill?.(...surfaceColor);
    target.model(geometry);
  }
  if (renderMode === "wireframe" || renderMode === "surfaceWire") {
    target.noFill();
    target.stroke(...wireColor);
    target.strokeWeight(renderMode === "wireframe" ? 1 : 0.8);
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
