import { VJ1 } from "../constants.js";
import { clamp01, sanitizeState } from "../domain/models.js?v=world-frame-27";
import { createManualScheduler } from "../graph/manual-scheduler.js";
import { compileCompositionPatch, compileShaderSchedule } from "../graph/render-scheduler.js?v=world-frame-27";
import { createShaderBuilder } from "../shaders/shader-builder.js?v=world-frame-27";
import { applyBlend } from "./blend-utils.js";
import { applyFontToGlobal, applyFontToTarget } from "./font-loader.js?v=world-frame-27";
import { drawGenerator, drawStandby } from "./generators.js";
import { drawCover, isDrawableMedia, syncVideoSpeed } from "./media-utils.js";
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
    this.pendingRenditionSaves = new Set();
    this.sourcePg = null;
    this.fxTarget = null;
    this.fxTargetKey = "";
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
    this.lastTickMs = 0;
    this.visualTime = 0;
    this.frameIndex = 0;
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
    this.applyGraphicsFont(this.fxTarget);
    for (const pg of this.compositionSource?.values?.() || []) this.applyGraphicsFont(pg);
    for (const pg of this.compositionOutput?.values?.() || []) this.applyGraphicsFont(pg);
    for (const pg of this.compositionBuffer?.values?.() || []) this.applyGraphicsFont(pg);
  }

  createBuffers() {
    this.disposeBuffers();
    this.applyPixelDensity();
    const { width: rw, height: rh } = frameSize(this.state.render);
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

  disposeBuffers() {
    disposeGraphics(this.sourcePg);
    disposeGraphics(this.mainMix);
    disposeGraphics(this.surfaceScratch);
    disposeGraphics(this.surfaceTexture);
    disposeGraphics(this.fxTarget);
    disposeGraphicsMap(this.compositionSource);
    disposeGraphicsMap(this.compositionOutput);
    disposeGraphicsMap(this.compositionBuffer);
    this.compositionSourceUse?.clear?.();
    this.compositionBufferUse?.clear?.();
    this.sourcePg = null;
    this.mainMix = null;
    this.surfaceScratch = null;
    this.surfaceTexture = null;
    this.fxTarget = null;
    this.fxTargetKey = "";
    this.shaderBuilder.clear?.();
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
    const frame = frameSize(this.state.render);
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
    const frame = frameSize(render);
    const world = worldSize(render);
    const texture = surfaceTextureSize(render);
    const density = Math.max(0.5, Math.min(2, Number(render.pixelDensity) || 1));
    return `${frame.width}x${frame.height}:${world.width}x${world.height}:${texture.width}x${texture.height}:pd${density}`;
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
    if (!offset.x && !offset.y) return mapping;
    return offsetMapping(mapping, -offset.x, -offset.y);
  }

  mappingFromRenderMode(mapping) {
    if (this.mode !== "output") return mapping;
    const offset = this.outputFrameOffset();
    if (!offset.x && !offset.y) return mapping;
    return offsetMapping(mapping, offset.x, offset.y);
  }

  emitMapping(mapping = this.mapper?.exportData?.(), status = "Mapping updated") {
    const projectMapping = this.mappingFromRenderMode(mapping || {});
    this.markLocalMapping(projectMapping);
    this.sendMapping?.("local", projectMapping, status);
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
        item = { id, file, url, video: null, image: null, imageRenditions: new Map(), imageRenditionOrder: [], ready: false };
        this.media.set(id, item);
        if (/\.(mp4|m4v|mov|webm|ogv)$/i.test(id)) {
          item.video = createVideo(url, () => {
            item.video.hide();
            item.video.volume?.(0);
            item.video.loop();
            item.ready = true;
          });
          item.video.hide();
        } else if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(id)) {
          loadImage(url, (img) => {
            item.image = img;
            item.ready = true;
          });
        }
      }
      this.importMediaRenditions(item, entry?.renditions || []);
    }
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
    this.frameIndex++;
    this.tickClock(this.frameStart);
    this.scheduledEvents = this.state.scheduler?.manualLane === false
      ? []
      : this.manualScheduler.drain({ frame: this.frameIndex, time: this.visualTime });
    background(0);
    if (this.shouldUseThumbnailPreview()) this.renderThumbnailCompositions();
    else this.renderCompositions();
    if (this.mode === "composition") {
      this.renderCompositionPreview();
      this.captureSelectedCompositionThumbnail();
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
    this.mainMix.background(0);
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
      const output = this.renderCompositionForRequest(composition, compositionTime, frameRenderRequest(this.state.render, { reason: "composition-preview" }));
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
    if (cached) return cached;
    const patch = compileCompositionPatch(composition, renderRequest);
    this.compositionPatches.set(composition.id, patch);
    const output = this.renderCompositionPatch(composition, patch, compositionTime, renderRequest);
    this.compositionOutput.set(outputKey, output);
    if (renderRequest.width === this.mainMix.width && renderRequest.height === this.mainMix.height) {
      this.compositionOutput.set(composition.id, output);
    }
    return output;
  }

  renderCompositionPatch(composition, patch, compositionTime, request = frameRenderRequest(this.state.render)) {
    const renderRequest = this.normalizeRenderRequest(patch?.renderRequest || request, "composition");
    const output = this.getCompositionBuffer(composition.id, renderRequest);
    output.push();
    output.clear();
    output.pop();

    const orderedNodes = nodesInCompositionChainOrder(composition, patch);
    for (const node of orderedNodes) {
      if (node.enabled === false || node.role === "output") continue;
      if (isSourceNode(node)) {
        const layer = patchLayerForNode(node);
        const source = this.renderPatchSourceNode(composition, node, compositionTime, renderRequest);
        this.drawChainLayer(output, source, layer);
        continue;
      }
      if (isEffectNode(node)) {
        const effected = this.renderShaderNodes(output, [node], renderRequest, compositionTime);
        output.push();
        output.clear();
        drawBuffer(output, effected, 0, 0, output.width, output.height, this.isShaderBuffer(effected));
        output.pop();
      }
    }
    return output;
  }

  renderLegacyComposition(composition, compositionTime, request = frameRenderRequest(this.state.render)) {
    const renderRequest = this.normalizeRenderRequest(request, "composition");
    const source = this.renderCompositionSource(composition, compositionTime, renderRequest);
    const effected = this.renderShaderChain(source, composition.shaderChain, renderRequest, compositionTime);
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

    for (const item of composition.chain || []) {
      if (item.enabled === false) continue;
      if (item.kind === "source") {
        const source = this.renderCompositionSourceItem(composition, item, compositionTime, renderRequest);
        this.drawChainLayer(output, source, item);
        continue;
      }
      if (item.kind === "effect") {
        const effected = this.renderShaderChain(output, [chainItemToShaderPass(item)], renderRequest, compositionTime);
        output.push();
        output.clear();
        drawBuffer(output, effected, 0, 0, output.width, output.height, this.isShaderBuffer(effected));
        output.pop();
      }
    }
    return output;
  }

  renderThumbnailCompositions() {
    this.compositionOutput.clear();
    this.mainMix.push();
    this.mainMix.background(0);
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
    pg.background(0);
    this.safeDrawSourceToGraphics(pg, composition.source, composition, compositionTime);
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
    pg.background(0);
    this.safeDrawSourceToGraphics(pg, item.source || composition.source, composition, compositionTime);
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
    pg.background(0);
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
        syncVideoSpeed(item.video, composition.speed);
        drawCover(pg, item.video, 0, 0, pg.width, pg.height);
      }
      else if (item?.image && isDrawableMedia(item.image)) {
        const image = this.getImageRendition(item, pg.width, pg.height) || item.image;
        drawCover(pg, image, 0, 0, pg.width, pg.height);
      }
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
      drawGenerator(pg, source.generatorId, compositionTime);
    }
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
    const renderRequest = this.normalizeRenderRequest(request, "effect");
    const widthPx = renderRequest.width;
    const heightPx = renderRequest.height;
    const key = renderBufferKey(widthPx, heightPx);
    if (!this.fxTarget) {
      this.fxTarget = createGraphics(widthPx, heightPx, WEBGL);
      this.fxTargetKey = key;
      this.applyGraphicsFont(this.fxTarget);
      this.fxTarget.noStroke();
      this.shaderBuilder.clear?.();
      return this.fxTarget;
    }
    if (this.fxTargetKey !== key || this.fxTarget.width !== widthPx || this.fxTarget.height !== heightPx) {
      try {
        this.fxTarget.resizeCanvas(widthPx, heightPx);
      } catch {
        disposeGraphics(this.fxTarget);
        this.fxTarget = createGraphics(widthPx, heightPx, WEBGL);
      }
      this.fxTargetKey = key;
      this.applyGraphicsFont(this.fxTarget);
      this.fxTarget.noStroke();
      this.shaderBuilder.clear?.();
    }
    return this.fxTarget;
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
    output.tint(255, 255 * clamp01(layer.opacity));
    output.imageMode(CENTER);
    output.translate(
      output.width * 0.5 + (Number(transform.x) || 0) * output.width * 0.5,
      output.height * 0.5 + (Number(transform.y) || 0) * output.height * 0.5
    );
    output.rotate(Number(transform.rotation) || 0);
    const scale = Math.max(0.01, Number(transform.scale) || 1);
    output.scale(scale);
    output.image(source, 0, 0, output.width, output.height);
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
    for (const job of schedule) {
      const pass = job.pass;
      if (this.isShaderBuffer(current)) {
        current = this.materializeDrawableBuffer(current, `fx-handoff:${renderRequestKey(renderRequest)}:${passCount}`, renderRequest);
      }
      const target = this.getFxTarget(renderRequest);
      const shader = this.shaderBuilder.getShader(pass, target);
      if (!shader) continue;
      target.push();
      target.clear();
      target.shader(shader);
      const sourceIsShaderBuffer = this.isShaderBuffer(current);
      shader.setUniform("tex0", current);
      shader.setUniform("resolution", [rw, rh]);
      shader.setUniform("canvasSize", [rw, rh]);
      shader.setUniform("texelSize", [1 / Math.max(1, rw), 1 / Math.max(1, rh)]);
      shader.setUniform("sourceFlipY", !sourceIsShaderBuffer);
      shader.setUniform("sourceForceOpaque", !sourceIsShaderBuffer);
      shader.setUniform("time", timeSeconds);
      shader.setUniform("effectTransform", effectTransformUniform(pass.transform));
      this.setShaderParamUniforms(shader, job.component, pass.params);
      target.rect(-rw / 2, -rh / 2, rw, rh);
      target.resetShader();
      target.pop();
      current = target;
      passCount++;
    }
    return current;
  }

  renderShaderNodes(input, nodes, request = frameRenderRequest(this.state.render), timeSeconds = this.visualTime) {
    return this.renderShaderChain(input, nodes.map(shaderPassFromNode), request, timeSeconds);
  }

  setShaderParamUniforms(shader, component, params = {}) {
    for (const param of component?.params || []) {
      const value = params[param.id];
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
    if (!component?.params?.some((param) => param.id === "amount")) {
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
      pg.background(0);
      if (!outputBlackout) {
        this.drawSurfaceRoute(pg, surface);
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
      pg.background(0);
      return;
    }
    if (this.shouldUseThumbnailPreview()) {
      this.drawSurfaceThumbnailRoute(pg, surface);
      return;
    }
    const composition = this.state.compositions.find((item) => item.id === surface.compositionId);
    const compositionTime = this.compositionTimes.get(surface.compositionId) || 0;
    const request = stableSurfaceRenderRequest(this.state.render, { surfaceId: surface.id });
    const source = composition
      ? this.renderCompositionForRequest(composition, compositionTime, request)
      : this.mainMix;

    pg.push();
    applyBlend(pg, surface.finalBlend);
    pg.tint(255, 255 * clamp01(surface.opacity));
    drawCover(pg, source, 0, 0, pg.width, pg.height);
    pg.noTint();
    pg.blendMode(BLEND);
    pg.pop();

    if (surface.finalShaderChain?.length) {
      const effected = this.renderShaderChain(pg, surface.finalShaderChain, request, this.visualTime);
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
      drawCover(pg, thumbnail.img, 0, 0, pg.width, pg.height);
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
    return !!buffer && buffer === this.fxTarget;
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
    pg.background(0);
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
    const item = this.selectedSourceChainItem();
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

  selectedSourceChainItem() {
    const composition = this.state?.compositions?.find((item) => item.id === this.state?.ui?.selectedCompositionId);
    if (!composition?.chain?.length) return null;
    const selected = composition.chain.find((item) => item.id === this.state.ui.selectedChainItemId);
    return selected?.kind === "source" ? selected : null;
  }

  startChainTransformDrag(x, y) {
    const item = this.selectedSourceChainItem();
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
    const item = composition?.chain?.find((chainItem) => chainItem.id === itemId);
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
    this.rebuildSurfaces();
    this.applyProjectMapping();
  }

  isOutputBlackout() {
    return this.mode === "output" && !!this.state.global.blackout;
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
      this.hud.classList.toggle("is-hidden", !this.state.global.showHud || hideOutputHud);
      this.hud.textContent = `${Math.round(this.smoothedFps || fps)} fps`;
    }
    if (millis() - this.lastMetricsAt > 500) {
      this.lastMetricsAt = millis();
      this.sendMetrics?.({
        fps: this.smoothedFps || fps,
        frameMs: this.smoothedFrameMs || frameMs,
        renderCost: this.smoothedRenderCost || renderCost,
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
  return createRenderRequest("surface", surfaceTextureSize(render), meta);
}

function isSourceNode(node = {}) {
  return node.role === "source" || node.kind === "source" || node.kind === "generator";
}

function isEffectNode(node = {}) {
  return node.role === "effect" || node.kind === "effect";
}

function nodesInCompositionChainOrder(composition = {}, patch = {}) {
  const nodes = (patch.nodes || []).filter((node) => isSourceNode(node) || isEffectNode(node));
  if (!Array.isArray(composition.chain) || !composition.chain.length) return nodes;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return composition.chain
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

function sourceFromPatchNode(node = {}) {
  if (node.state?.source) return node.state.source;
  const params = node.params || {};
  if (node.kind === "generator" || node.componentId === "testPattern" || params.generatorId) {
    return { type: "generator", generatorId: params.generatorId || node.componentId || "testPattern" };
  }
  if (node.componentId === "source.media" || params.mediaId) {
    return { type: "media", mediaId: params.mediaId || "" };
  }
  if (node.componentId === "source.camera") return { type: "camera" };
  if (node.componentId === "source.black") return { type: "black" };
  return { type: "generator", generatorId: "testPattern" };
}

function shaderPassFromNode(node = {}) {
  return {
    id: node.componentId || node.id || "",
    enabled: node.enabled !== false,
    params: { ...(node.params || {}) },
    amount: node.params?.amount,
    transform: node.state?.transform || node.transform || {},
  };
}

function renderBufferKey(...parts) {
  return parts.map((part) => String(part)).join(":");
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
    enabled: item.enabled !== false,
    params: item.params || {},
    amount: item.amount,
    transform: item.transform || {},
  };
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

function drawBuffer(pg, source, x, y, w, h, sourceIsWebGL = false) {
  if (!sourceIsWebGL) {
    pg.image(source, x, y, w, h);
    return;
  }
  drawWebGLBuffer(pg, source, x, y, w, h);
}

function drawWebGLBuffer(pg, source, x, y, w, h) {
  pg.push();
  pg.translate(x, y + h);
  pg.scale(1, -1);
  pg.image(source, 0, 0, w, h);
  pg.pop();
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
