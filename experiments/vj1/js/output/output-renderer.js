import { VJ1 } from "../constants.js";
import { clamp01, sanitizeState } from "../domain/models.js";
import { createShaderBuilder } from "../shaders/shader-builder.js";
import { getShaderComponent } from "../shaders/shader-registry.js";
import { applyBlend } from "./blend-utils.js";
import { drawGenerator, drawStandby } from "./generators.js";
import { drawCover, isDrawableMedia, syncVideoSpeed } from "./media-utils.js";

export class OutputRenderer {
  constructor({ mode, hud, sendMetrics, sendMapping, sendThumbnail, requestMediaFiles, onSurfaceSelect }) {
    this.mode = mode;
    this.hud = hud;
    this.sendMetrics = sendMetrics;
    this.sendMapping = sendMapping;
    this.sendThumbnail = sendThumbnail;
    this.requestMediaFiles = requestMediaFiles;
    this.onSurfaceSelect = onSurfaceSelect;
    this.state = null;
    this.mapper = null;
    this.compositionSource = new Map();
    this.compositionOutput = new Map();
    this.compositionBuffer = new Map();
    this.thumbnailImages = new Map();
    this.media = new Map();
    this.sourcePg = null;
    this.fxA = null;
    this.fxB = null;
    this.mainMix = null;
    this.surfaceScratch = null;
    this.cameraCapture = null;
    this.cameraRequested = false;
    this.cameraError = "";
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
    this.frameStart = 0;
    this.lastTickMs = 0;
    this.visualTime = 0;
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
    this.createBuffers();
    this.createMapper();
    this.setCalibrate(this.shouldCalibrateFromState());
  }

  createBuffers() {
    this.disposeBuffers();
    const { width: rw, height: rh, surfaceWidth, surfaceHeight } = this.state.render;
    this.sourcePg = createGraphics(rw, rh);
    this.mainMix = createGraphics(rw, rh);
    this.surfaceScratch = createGraphics(surfaceWidth, surfaceHeight);
    this.fxA = createGraphics(rw, rh, WEBGL);
    this.fxB = createGraphics(rw, rh, WEBGL);
    this.fxA.noStroke();
    this.fxB.noStroke();
  }

  disposeBuffers() {
    disposeGraphics(this.sourcePg);
    disposeGraphics(this.mainMix);
    disposeGraphics(this.surfaceScratch);
    disposeGraphics(this.fxA);
    disposeGraphics(this.fxB);
    disposeGraphicsMap(this.compositionSource);
    disposeGraphicsMap(this.compositionOutput);
    disposeGraphicsMap(this.compositionBuffer);
    this.sourcePg = null;
    this.mainMix = null;
    this.surfaceScratch = null;
    this.fxA = null;
    this.fxB = null;
    this.shaderBuilder.clear?.();
  }

  createMapper() {
    const ProjectionMapperClass = getProjectionMapperClass();
    this.mapper = new ProjectionMapperClass({
      pixelDensity: 1,
      storage: false,
      storageNamespace: "vj1",
      onConfigChange: (mapping, meta = {}) => {
        this.markLocalMapping(mapping);
        this.sendMapping?.("local", mapping, mappingStatusForReason(meta.reason));
      },
    });
    this.mapper.setAutoSave(true);
    this.syncMapperOverlayMode();
    this.rebuildSurfaces();
    this.applyProjectMapping();
  }

  rebuildSurfaces() {
    if (!this.mapper) return;
    const existingCorners = new Map((this.mapper.surfaces || []).map((surface) => [
      surface.name,
      Array.isArray(surface.corners)
        ? surface.corners.map((corner) => ({ x: corner.x, y: corner.y }))
        : null,
    ]));
    while (this.mapper.surfaces.length) {
      const removed = this.mapper.removeLastSurface({ clearStorage: false });
      disposeGraphics(removed?.pg);
      disposeGraphics(removed?.renderCache);
    }
    this.mapperSurfaces.clear();
    const cols = Math.max(1, Math.ceil(Math.sqrt(this.state.surfaces.length)));
    const gap = 40;
    const cellW = (width - gap * (cols + 1)) / cols;
    const cellH = cellW * (this.state.render.surfaceHeight / this.state.render.surfaceWidth);
    this.state.surfaces.forEach((surface, index) => {
      const pg = this.mapper.add(this.state.render.surfaceWidth, this.state.render.surfaceHeight, surface.id);
      const mapperSurface = this.mapper.surfaces[this.mapper.surfaces.length - 1];
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = gap + col * (cellW + gap);
      const y = gap + row * (cellH + gap);
      const preserved = existingCorners.get(surface.id);
      mapperSurface.corners = preserved?.length === 4
        ? preserved.map((corner) => createVector(corner.x, corner.y))
        : [
            createVector(x, y),
            createVector(x + cellW, y),
            createVector(x + cellW, y + cellH),
            createVector(x, y + cellH),
          ];
      this.mapper._invalidateSurface?.(mapperSurface);
      this.mapperSurfaces.set(surface.id, { pg, mapperSurface });
    });
  }

  setState(nextState) {
    const previousSurfaceIds = (this.state?.surfaces || []).map((surface) => surface.id).join(",");
    const previousSize = this.state ? `${this.state.render.width}x${this.state.render.height}:${this.state.render.surfaceWidth}x${this.state.render.surfaceHeight}` : "";
    const previousMappingSignature = this.mappingSignature;
    this.state = sanitizeState(nextState);
    const nextSurfaceIds = this.state.surfaces.map((surface) => surface.id).join(",");
    const nextSize = `${this.state.render.width}x${this.state.render.height}:${this.state.render.surfaceWidth}x${this.state.render.surfaceHeight}`;
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
  }

  syncMapperOverlayMode() {
    this.mapper?.setOverlayMode?.(this.state?.global?.mappingHandleMode || "always");
  }

  shouldCalibrateFromState() {
    if (this.mode === "output") return false;
    return this.mode === "preview" || !!this.state.global.calibrating;
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
      this.mapper?.importConfig?.(mapping, { replace: false, silent: true });
    }
    this.mappingSignature = signature;
  }

  markLocalMapping(mapping = this.mapper?.exportData?.()) {
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
      if (!id || this.media.has(id)) continue;
      const url = URL.createObjectURL(file);
      const item = { id, file, url, video: null, image: null, ready: false };
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
    setupWebcamera(true, this.state.render.width, this.state.render.height, false, false)
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
    this.tickClock(this.frameStart);
    background(0);
    if (this.shouldUseThumbnailPreview()) this.renderThumbnailCompositions();
    else this.renderCompositions();
    if (this.mode === "composition") {
      this.renderCompositionPreview();
      this.captureSelectedCompositionThumbnail();
      this.updateHudAndMetrics();
      return;
    }
    this.renderSurfaces();
    const outputBlackout = this.isOutputBlackout();
    const restoreCalibrate = outputBlackout && this.mapper?.isCalibrating?.();
    if (restoreCalibrate) this.mapper.setCalibrate(false);
    this.mapper.render();
    this.renderSelectedSurfaceOverlay();
    if (restoreCalibrate) this.mapper.setCalibrate(true);
    this.updateHudAndMetrics();
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
    if (this.mode === "output" || !this.mapper?.isCalibrating?.()) return;
    const surfaceId = this.state?.ui?.selectedSurfaceId;
    if (!surfaceId) return;
    if (this.state?.global?.mappingHandleMode === "near" && !this.shouldRevealSurfaceOverlay(surfaceId)) return;
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
    strokeWeight(5);
    beginShape();
    for (const corner of corners) vertex(corner.x - w2, corner.y - h2, 1);
    endShape(CLOSE);
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

    const neededCompositionIds = this.neededCompositionIds();
    for (const composition of this.state.compositions || []) {
      if (neededCompositionIds.size && !neededCompositionIds.has(composition.id)) continue;
      const compositionTime = this.compositionTimes.get(composition.id) || 0;
      const source = this.renderCompositionSource(composition, compositionTime);
      const effected = this.renderShaderChain(source, composition.shaderChain, this.state.render.width, this.state.render.height, compositionTime);
      const output = this.getCompositionBuffer(composition.id);
      output.push();
      output.clear();
      drawBuffer(output, effected, 0, 0, output.width, output.height, this.isShaderBuffer(effected));
      output.pop();
      this.compositionOutput.set(composition.id, output);
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

  renderCompositionSource(composition, compositionTime = this.visualTime) {
    let pg = this.compositionSource.get(composition.id);
    if (!pg || pg.width !== this.state.render.width || pg.height !== this.state.render.height) {
      pg = createGraphics(this.state.render.width, this.state.render.height);
      this.compositionSource.set(composition.id, pg);
    }
    pg.push();
    pg.background(0);
    if (composition.source.type === "media") {
      const item = this.media.get(composition.source.mediaId);
      if (item?.video && isDrawableMedia(item.video)) {
        syncVideoSpeed(item.video, composition.speed);
        drawCover(pg, item.video, 0, 0, pg.width, pg.height);
      }
      else if (item?.image && isDrawableMedia(item.image)) drawCover(pg, item.image, 0, 0, pg.width, pg.height);
      else if (item) drawStandby(pg, "loading media");
      else {
        this.requestMissingMedia(composition.source.mediaId);
        drawStandby(pg, "media file not loaded");
      }
    } else if (composition.source.type === "camera") {
      const camera = this.ensureCameraCapture();
      if (camera && isDrawableMedia(camera)) drawCover(pg, camera, 0, 0, pg.width, pg.height);
      else drawStandby(pg, this.cameraError || "camera");
    } else if (composition.source.type === "black") {
      pg.background(0);
    } else {
      try {
        drawGenerator(pg, composition.source.generatorId, compositionTime);
      } catch (error) {
        console.error("[VJ1_GENERATOR_CRASH]", {
          compositionId: composition.id,
          compositionName: composition.name,
          generatorId: composition.source.generatorId,
          width: pg.width,
          height: pg.height,
          name: error?.name,
          message: error?.message,
          stack: error?.stack,
        });
        pg.background(0);
      }
    }
    pg.pop();
    return pg;
  }

  getCompositionBuffer(id) {
    let pg = this.compositionBuffer.get(id);
    if (!pg || pg.width !== this.state.render.width || pg.height !== this.state.render.height) {
      pg = createGraphics(this.state.render.width, this.state.render.height);
      this.compositionBuffer.set(id, pg);
    }
    return pg;
  }

  renderShaderChain(input, chain, rw, rh, timeSeconds = this.visualTime) {
    let current = input;
    let passCount = 0;
    for (const pass of chain || []) {
      if (!pass.enabled) continue;
      const target = passCount % 2 === 0 ? this.fxA : this.fxB;
      const shader = this.shaderBuilder.getShader(pass, target);
      if (!shader) continue;
      target.push();
      target.clear();
      target.shader(shader);
      shader.setUniform("tex0", current);
      shader.setUniform("resolution", [rw, rh]);
      shader.setUniform("canvasSize", [rw, rh]);
      shader.setUniform("texelSize", [1 / Math.max(1, rw), 1 / Math.max(1, rh)]);
      shader.setUniform("sourceFlipY", !this.isShaderBuffer(current));
      shader.setUniform("time", timeSeconds);
      shader.setUniform("amount", Number(pass.amount) || 0);
      target.rect(-rw / 2, -rh / 2, rw, rh);
      target.resetShader();
      target.pop();
      current = target;
      passCount++;
    }
    return current;
  }

  renderSurfaces() {
    const outputBlackout = this.isOutputBlackout();
    for (const surface of this.state.surfaces) {
      const mapped = this.mapperSurfaces.get(surface.id);
      if (!mapped) continue;
      const pg = mapped.pg;
      pg.push();
      pg.background(0);
      if (!outputBlackout && surface.enabled) {
        this.drawSurfaceRoute(pg, surface);
      }
      if (!outputBlackout && this.state.global.showLabels !== false && this.mapper.isCalibrating()) {
        const composition = this.state.compositions.find((item) => item.id === surface.compositionId);
        drawSurfaceLabel(pg, surface, composition);
      }
      pg.pop();
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
    const source = this.compositionOutput.get(surface.compositionId) || this.mainMix;

    pg.push();
    applyBlend(pg, surface.finalBlend);
    pg.tint(255, 255 * clamp01(surface.opacity));
    pg.image(source, 0, 0, pg.width, pg.height);
    pg.noTint();
    pg.blendMode(BLEND);
    pg.pop();

    if (surface.finalShaderChain?.length) {
      const effected = this.renderShaderChain(pg, surface.finalShaderChain, this.state.render.surfaceWidth, this.state.render.surfaceHeight, this.visualTime);
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
    return buffer === this.fxA || buffer === this.fxB;
  }

  requestMissingMedia(mediaId) {
    if (!mediaId || millis() - this.lastMediaRequestAt < 1200) return;
    this.lastMediaRequestAt = millis();
    this.requestMediaFiles?.([mediaId]);
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
  }

  setCalibrate(on) {
    this.state.global.calibrating = !!on;
    this.mapper?.setCalibrate(!!on);
  }

  mousePressed(x, y) {
    this.mapper?.mousePressed?.(x, y);
    const surfaceIndex = Number(this.mapper?._dragSurf);
    const surfaceName = Number.isInteger(surfaceIndex) && surfaceIndex >= 0
      ? this.mapper?.surfaces?.[surfaceIndex]?.name
      : "";
    if (surfaceName) this.onSurfaceSelect?.(surfaceName);
  }

  mouseDragged(x, y) {
    this.mapper?.mouseDragged?.(x, y);
  }

  mouseReleased() {
    const wasMappingActive = !!this.mapper?.isActive?.();
    this.mapper?.mouseReleased?.();
    if (wasMappingActive) {
      const mapping = this.mapper?.exportData?.() || {};
      this.markLocalMapping(mapping);
      this.sendMapping?.("local", mapping, "Mapping updated");
    }
  }

  isCalibrating() {
    return !!this.mapper?.isCalibrating();
  }

  saveMapping() {
    this.sendMapping?.("local", this.mapper?.exportData?.() || {}, "Mapping saved");
  }

  loadMapping() {
    this.applyProjectMapping();
  }

  resetMapping(surfaceId = "") {
    if (surfaceId) {
      this.mapper?.resetSurface?.(surfaceId);
      this.sendMapping?.("local", this.mapper?.exportData?.() || {}, "Surface mapping reset");
      return;
    }
    this.mapper?.resetAll();
    this.sendMapping?.("local", this.mapper?.exportData?.() || {}, "Mapping reset");
  }

  exportMapping() {
    this.mapper?.downloadExport?.("vj1-mapping.json");
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
      this.hud.classList.toggle("is-hidden", !this.state.global.showHud);
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

function getProjectionMapperClass() {
  if (globalThis.ProjectionMapper) return globalThis.ProjectionMapper;
  return Function("return ProjectionMapper")();
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

function disposeGraphicsMap(map) {
  if (!map) return;
  for (const item of map.values()) disposeGraphics(item);
  map.clear();
}

function disposeGraphics(item) {
  if (!item) return;
  try {
    item.remove?.();
  } catch {}
}

function compositionThumbnailSignature(composition) {
  try {
    return JSON.stringify({
      source: composition.source,
      opacity: composition.opacity,
      blend: composition.blend,
      speed: composition.speed,
      shaderChain: composition.shaderChain,
    });
  } catch {
    return `${composition.id}:${millis()}`;
  }
}

function graphicsToThumbnail(pg, width = 160, height = 90) {
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
    return canvas.toDataURL("image/jpeg", 0.72);
  } catch (error) {
    console.warn("[VJ1_THUMBNAIL_CAPTURE_FAILED]", { message: error?.message || String(error) });
    return "";
  }
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
