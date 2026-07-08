import { VJ1 } from "../constants.js";
import { clamp01, sanitizeState } from "../domain/models.js";
import { createShaderBuilder } from "../shaders/shader-builder.js";

export class OutputRenderer {
  constructor({ mode, hud, sendMetrics, sendMapping }) {
    this.mode = mode;
    this.hud = hud;
    this.sendMetrics = sendMetrics;
    this.sendMapping = sendMapping;
    this.state = null;
    this.mapper = null;
    this.layerSource = new Map();
    this.layerOutput = new Map();
    this.media = new Map();
    this.sourcePg = null;
    this.fxA = null;
    this.fxB = null;
    this.mainMix = null;
    this.surfaceScratch = null;
    this.mapperSurfaces = new Map();
    this.mappingSignature = "";
    this.lastMetricsAt = 0;
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
    this.mapper = new ProjectionMapperClass({ pixelDensity: 1 });
    this.mapper.setAutoSave(true, 80);
    this.rebuildSurfaces();
    this.mapper.loadAll();
    this.applyProjectMapping();
  }

  rebuildSurfaces() {
    if (!this.mapper) return;
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
      mapperSurface.corners = [
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
    if (previousSurfaceIds !== nextSurfaceIds || previousSize !== nextSize) {
      this.rebuildSurfaces();
      this.mapper.loadAll();
    }
    if (previousMappingSignature !== nextMappingSignature) {
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
      this.mapper?.importConfig?.(mapping, { replace: false });
    }
    this.mappingSignature = signature;
  }

  importFiles(files) {
    for (const file of files || []) {
      const id = file.relativePath || file.webkitRelativePath || file.name;
      if (!id || this.media.has(id)) continue;
      const url = URL.createObjectURL(file);
      const item = { id, file, url, video: null, image: null, ready: false };
      this.media.set(id, item);
      if (/\.(mp4|m4v|mov|webm|ogv)$/i.test(id)) {
        item.video = createVideo(url, () => {
          item.video.hide();
          item.video.volume(0);
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

  draw() {
    if (!this.state) return;
    this.frameStart = performance.now();
    background(0);
    this.renderLayers();
    this.renderSurfaces();
    this.mapper.render();
    this.updateHudAndMetrics();
  }

  renderLayers() {
    this.layerOutput.clear();
    this.mainMix.push();
    this.mainMix.background(0);
    if (this.state.global.blackout) {
      this.mainMix.pop();
      return;
    }
    for (const layer of this.state.layers) {
      if (!layer.enabled) continue;
      const source = this.renderLayerSource(layer);
      const output = this.renderShaderChain(source, layer.shaderChain, this.state.render.width, this.state.render.height);
      this.layerOutput.set(layer.id, output);
      this.mainMix.push();
      applyBlend(this.mainMix, layer.blend);
      this.mainMix.tint(255, 255 * clamp01(layer.opacity));
      this.mainMix.image(output, 0, 0, this.mainMix.width, this.mainMix.height);
      this.mainMix.noTint();
      this.mainMix.blendMode(BLEND);
      this.mainMix.pop();
    }
    this.mainMix.pop();
  }

  renderLayerSource(layer) {
    let pg = this.layerSource.get(layer.id);
    if (!pg || pg.width !== this.state.render.width || pg.height !== this.state.render.height) {
      pg = createGraphics(this.state.render.width, this.state.render.height);
      this.layerSource.set(layer.id, pg);
    }
    pg.push();
    pg.background(0);
    if (layer.source.type === "media") {
      const item = this.media.get(layer.source.mediaId);
      if (item?.video) drawCover(pg, item.video, 0, 0, pg.width, pg.height);
      else if (item?.image) drawCover(pg, item.image, 0, 0, pg.width, pg.height);
      else drawStandby(pg, "media");
    } else if (layer.source.type === "camera") {
      drawStandby(pg, "camera");
    } else if (layer.source.type === "black") {
      pg.background(0);
    } else {
      drawGenerator(pg, layer.source.generatorId, millis() * 0.001 * Math.max(0.01, layer.speed || 1));
    }
    pg.pop();
    return pg;
  }

  renderShaderChain(input, chain, rw, rh) {
    let current = input;
    let passCount = 0;
    for (const pass of chain || []) {
      if (!pass.enabled) continue;
      const shader = this.shaderBuilder.getShader(pass);
      if (!shader) continue;
      const target = passCount % 2 === 0 ? this.fxA : this.fxB;
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
    for (const surface of this.state.surfaces) {
      const mapped = this.mapperSurfaces.get(surface.id);
      if (!mapped) continue;
      const pg = mapped.pg;
      pg.push();
      pg.background(0);
      if (!this.state.global.blackout && surface.enabled) {
        this.drawSurfaceRoute(pg, surface);
      }
      if (surface.showLabel && this.mapper.isCalibrating()) drawSurfaceLabel(pg, surface);
      pg.pop();
    }
  }

  drawSurfaceRoute(pg, surface) {
    let source = this.mainMix;
    if (surface.route.type === "layer") source = this.layerOutput.get(surface.route.layerId) || this.mainMix;
    if (surface.route.type === "generator") {
      this.surfaceScratch.push();
      drawGenerator(this.surfaceScratch, surface.route.generatorId, millis() * 0.001);
      this.surfaceScratch.pop();
      source = this.surfaceScratch;
    }
    if (surface.route.type === "black") {
      pg.background(0);
      return;
    }

    pg.push();
    applyBlend(pg, surface.finalBlend);
    pg.tint(255, 255 * clamp01(surface.opacity));
    pg.image(source, 0, 0, pg.width, pg.height);
    pg.noTint();
    pg.blendMode(BLEND);
    pg.pop();

    if (surface.finalShaderChain?.length) {
      const effected = this.renderShaderChain(pg, surface.finalShaderChain, this.state.render.surfaceWidth, this.state.render.surfaceHeight);
      pg.image(effected, 0, 0, pg.width, pg.height);
    }
  }

  setCalibrate(on) {
    this.state.global.calibrating = !!on;
    this.mapper?.setCalibrate(!!on);
  }

  mousePressed(x, y) {
    this.mapper?.mousePressed?.(x, y);
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
    this.mapper?.saveAll();
    this.sendMapping?.("local", this.mapper?.exportData?.() || {}, "Mapping saved");
  }

  loadMapping() {
    this.mapper?.loadAll();
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
    this.mapper?.loadAll();
  }

  updateHudAndMetrics() {
    const frameMs = performance.now() - this.frameStart;
    const fps = frameRate();
    if (this.hud) {
      this.hud.classList.toggle("is-hidden", !this.state.global.showHud || this.mode === "output");
      this.hud.textContent = `${this.mode} / ${Math.round(fps)} fps / ${frameMs.toFixed(1)} ms / ${this.state.surfaces.length} surfaces`;
    }
    if (millis() - this.lastMetricsAt > 500) {
      this.lastMetricsAt = millis();
      this.sendMetrics?.({
        fps,
        frameMs,
        message: `${this.mode} rendering`,
      });
    }
  }
}

function getProjectionMapperClass() {
  if (globalThis.ProjectionMapper) return globalThis.ProjectionMapper;
  return Function("return ProjectionMapper")();
}

function applyBlend(pg, blend) {
  if (blend === "add") pg.blendMode(ADD);
  else if (blend === "screen") pg.blendMode(SCREEN);
  else if (blend === "multiply") pg.blendMode(MULTIPLY);
  else pg.blendMode(BLEND);
}

function drawCover(pg, media, x, y, w, h) {
  const mw = media.width || w;
  const mh = media.height || h;
  const scale = Math.max(w / mw, h / mh);
  const dw = mw * scale;
  const dh = mh * scale;
  pg.image(media, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
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

function drawSurfaceLabel(pg, surface) {
  pg.noStroke();
  pg.fill(255, 230);
  pg.textAlign(LEFT, TOP);
  pg.textSize(28);
  pg.text(surface.name, 28, 24);
  pg.textSize(16);
  pg.fill(255, 165);
  pg.text(`${surface.route.type} / ${surface.finalBlend} / ${Math.round(clamp01(surface.opacity) * 100)}%`, 28, 60);
}
