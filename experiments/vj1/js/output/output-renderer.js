import { VJ1 } from "../constants.js";
import { clamp01, sanitizeState } from "../domain/models.js";
import { createShaderBuilder } from "../shaders/shader-builder.js";

export class OutputRenderer {
  constructor({ mode, hud, sendMetrics, sendMapping, requestMediaFiles, onSurfaceSelect }) {
    this.mode = mode;
    this.hud = hud;
    this.sendMetrics = sendMetrics;
    this.sendMapping = sendMapping;
    this.requestMediaFiles = requestMediaFiles;
    this.onSurfaceSelect = onSurfaceSelect;
    this.state = null;
    this.mapper = null;
    this.compositionSource = new Map();
    this.compositionOutput = new Map();
    this.compositionBuffer = new Map();
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
    this.lastMetricsAt = 0;
    this.lastMediaRequestAt = 0;
    this.frameStart = 0;
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
    this.setCalibrate(this.mode === "preview" || this.state.global.calibrating);
  }

  createBuffers() {
    const { width: rw, height: rh, surfaceWidth, surfaceHeight } = this.state.render;
    this.sourcePg = createGraphics(rw, rh);
    this.mainMix = createGraphics(rw, rh);
    this.surfaceScratch = createGraphics(surfaceWidth, surfaceHeight);
    this.fxA = createGraphics(rw, rh, WEBGL);
    this.fxB = createGraphics(rw, rh, WEBGL);
    this.fxA.noStroke();
    this.fxB.noStroke();
  }

  createMapper() {
    const ProjectionMapperClass = getProjectionMapperClass();
    this.mapper = new ProjectionMapperClass({
      pixelDensity: 1,
      storage: false,
      storageNamespace: "vj1",
      onConfigChange: (mapping, meta = {}) => {
        this.sendMapping?.("local", mapping, mappingStatusForReason(meta.reason));
      },
    });
    this.mapper.setAutoSave(true);
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
    while (this.mapper.surfaces.length) this.mapper.removeLastSurface({ clearStorage: false });
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
    if (surfacesChanged || previousMappingSignature !== nextMappingSignature) {
      this.applyProjectMapping(nextMappingSignature);
    }
    this.setCalibrate(this.state.global.calibrating);
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
    background(0);
    this.renderCompositions();
    if (this.mode === "composition") {
      this.renderCompositionPreview();
      this.updateHudAndMetrics();
      return;
    }
    this.renderSurfaces();
    const outputBlackout = this.isOutputBlackout();
    const restoreCalibrate = outputBlackout && this.mapper?.isCalibrating?.();
    if (restoreCalibrate) this.mapper.setCalibrate(false);
    this.mapper.render();
    if (restoreCalibrate) this.mapper.setCalibrate(true);
    this.updateHudAndMetrics();
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
      if (!composition.enabled) continue;
      if (neededCompositionIds.size && !neededCompositionIds.has(composition.id)) continue;
      const source = this.renderCompositionSource(composition);
      const effected = this.renderShaderChain(source, composition.shaderChain, this.state.render.width, this.state.render.height);
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

  renderCompositionSource(composition) {
    let pg = this.compositionSource.get(composition.id);
    if (!pg || pg.width !== this.state.render.width || pg.height !== this.state.render.height) {
      pg = createGraphics(this.state.render.width, this.state.render.height);
      this.compositionSource.set(composition.id, pg);
    }
    pg.push();
    pg.background(0);
    if (composition.source.type === "media") {
      const item = this.media.get(composition.source.mediaId);
      if (item?.video && isDrawableMedia(item.video)) drawCover(pg, item.video, 0, 0, pg.width, pg.height);
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
      drawGenerator(pg, composition.source.generatorId, millis() * 0.001 * Math.max(0.01, composition.speed || 1));
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

  renderShaderChain(input, chain, rw, rh) {
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
      shader.setUniform("time", millis() * 0.001);
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
      if (!outputBlackout && surface.showLabel && this.mapper.isCalibrating()) {
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
    const source = this.compositionOutput.get(surface.compositionId) || this.mainMix;

    pg.push();
    applyBlend(pg, surface.finalBlend);
    pg.tint(255, 255 * clamp01(surface.opacity));
    pg.image(source, 0, 0, pg.width, pg.height);
    pg.noTint();
    pg.blendMode(BLEND);
    pg.pop();

    if (surface.finalShaderChain?.length) {
      const effected = this.renderShaderChain(pg, surface.finalShaderChain, this.state.render.surfaceWidth, this.state.render.surfaceHeight);
      drawBuffer(pg, effected, 0, 0, pg.width, pg.height, this.isShaderBuffer(effected));
    }
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
      this.sendMapping?.("local", this.mapper?.exportData?.() || {}, "Mapping updated");
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

  updateHudAndMetrics() {
    const frameMs = performance.now() - this.frameStart;
    const fps = frameRate();
    if (this.hud) {
      this.hud.classList.toggle("is-hidden", !this.state.global.showHud || this.mode === "output");
      this.hud.textContent = `${Math.round(fps)} fps`;
    }
    if (millis() - this.lastMetricsAt > 500) {
      this.lastMetricsAt = millis();
      this.sendMetrics?.({
        fps,
        frameMs,
        message: this.mode === "composition" ? "composition preview" : `${this.mode} rendering`,
      });
    }
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

function getPortalWebcameraSetup() {
  if (typeof globalThis.setupWebcamera === "function") return globalThis.setupWebcamera;
  try {
    return Function("return typeof setupWebcamera === 'function' ? setupWebcamera : null")();
  } catch {
    return null;
  }
}

function applyBlend(pg, blend) {
  if (blend === "add") pg.blendMode(ADD);
  else if (blend === "screen") pg.blendMode(SCREEN);
  else if (blend === "multiply") pg.blendMode(MULTIPLY);
  else pg.blendMode(BLEND);
}

function drawCover(pg, media, x, y, w, h) {
  const element = media.elt || media;
  const mw = element.videoWidth || element.naturalWidth || media.width || element.width || w;
  const mh = element.videoHeight || element.naturalHeight || media.height || element.height || h;
  const scale = Math.max(w / mw, h / mh);
  const dw = mw * scale;
  const dh = mh * scale;
  pg.image(media, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function drawBuffer(pg, source, x, y, w, h, flipShaderBuffer = false) {
  if (!flipShaderBuffer) {
    pg.image(source, x, y, w, h);
    return;
  }
  pg.push();
  pg.translate(x + w, y + h);
  pg.scale(-1, -1);
  pg.image(source, 0, 0, w, h);
  pg.pop();
}

function isDrawableMedia(media) {
  if (!media) return false;
  const elt = media.elt || media;
  if (elt?.tagName === "VIDEO") {
    return elt.videoWidth > 1 && elt.videoHeight > 1 && elt.readyState >= 2;
  }
  if (elt?.videoWidth > 1 && elt?.videoHeight > 1 && elt.readyState >= 2) return true;
  if (elt?.naturalWidth > 1 && elt?.naturalHeight > 1) return true;
  if (media.width > 1 && media.height > 1) return true;
  return false;
}

function drawStandby(pg, label) {
  pg.background("#080a0e");
  pg.noStroke();
  pg.fill("#171d25");
  for (let y = 0; y < pg.height; y += 56) {
    for (let x = 0; x < pg.width; x += 56) {
      if (((x / 56 + y / 56) | 0) % 2 === 0) pg.rect(x, y, 56, 56);
    }
  }
  pg.fill("#f2f4ee");
  pg.textAlign(CENTER, CENTER);
  pg.textSize(28);
  pg.text(label, pg.width / 2, pg.height / 2);
}

function drawGenerator(pg, id, t) {
  if (id === "noise") return drawNoise(pg, t);
  if (id === "plasma") return drawPlasma(pg, t);
  if (id === "checker") return drawChecker(pg, t);
  if (id === "black") return pg.background(0);
  return drawWaves(pg, t);
}

function drawWaves(pg, t) {
  pg.background("#050608");
  pg.noFill();
  for (let i = 0; i < 34; i++) {
    const hue = i / 34;
    pg.stroke(
      70 + 150 * sin(t + hue * 6.28),
      100 + 110 * sin(t * 0.7 + hue * 4.1),
      150 + 95 * cos(t * 0.8 + hue * 5.0),
      210
    );
    pg.strokeWeight(2);
    pg.beginShape();
    for (let x = -20; x <= pg.width + 20; x += 18) {
      const y =
        pg.height * (0.12 + i * 0.024) +
        sin(x * 0.018 + t * (1.4 + i * 0.04)) * 34 +
        sin(x * 0.006 - t * 0.8 + i) * 58;
      pg.vertex(x, y);
    }
    pg.endShape();
  }
}

function drawNoise(pg, t) {
  pg.noStroke();
  const cell = Math.max(14, Math.floor(pg.width / 64));
  for (let y = 0; y < pg.height; y += cell) {
    for (let x = 0; x < pg.width; x += cell) {
      const n = noise(x * 0.006, y * 0.006, t * 0.3);
      pg.fill(30 + n * 210, 35 + n * 120, 70 + n * 175);
      pg.rect(x, y, cell, cell);
    }
  }
}

function drawPlasma(pg, t) {
  pg.noStroke();
  const cell = Math.max(12, Math.floor(pg.width / 80));
  for (let y = 0; y < pg.height; y += cell) {
    for (let x = 0; x < pg.width; x += cell) {
      const u = x / pg.width;
      const v = y / pg.height;
      const q = sin((u + t * 0.08) * 18) + sin((v - t * 0.06) * 21) + sin((u + v + t * 0.05) * 16);
      pg.fill(120 + 90 * sin(q), 80 + 130 * sin(q + 2.1), 130 + 90 * sin(q + 4.2));
      pg.rect(x, y, cell, cell);
    }
  }
}

function drawChecker(pg, t) {
  const cell = 72;
  pg.background("#0b0d11");
  pg.noStroke();
  for (let y = 0; y < pg.height; y += cell) {
    for (let x = 0; x < pg.width; x += cell) {
      const on = (((x / cell) | 0) + ((y / cell) | 0)) % 2 === 0;
      pg.fill(on ? "#e8ece2" : "#252d37");
      pg.rect(x, y, cell, cell);
    }
  }
  pg.fill("#ff4f92");
  pg.rect(((sin(t) * 0.5 + 0.5) * (pg.width - 40)) | 0, 0, 40, pg.height);
  pg.fill("#44d7c8");
  pg.rect(0, ((cos(t * 0.7) * 0.5 + 0.5) * (pg.height - 40)) | 0, pg.width, 40);
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
