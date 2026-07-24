import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";
import { projectedQuadAspect } from "../../render-engine/relative-geometry.js?v=frame-projection-aspect-1";
import {
  DissolveTransitionKernel,
  transitionKernelCacheKey,
  transitionKernelUniformValues,
} from "../../transition-engine/index.js";

export class VjMapper {
  constructor({ onConfigChange, onTransitionError } = {}) {
    this.surfaces = [];
    this.shader = null;
    this.featherShader = null;
    this.transitionShaders = new Map();
    this.failedTransitionShaders = new Set();
    this.calibrate = true;
    this.overlayMode = "always";
    this.pickRadius = 60;
    this.onConfigChange = typeof onConfigChange === "function" ? onConfigChange : null;
    this.onTransitionError = typeof onTransitionError === "function" ? onTransitionError : null;
    this._dragSurf = -1;
    this._dragCorner = -1;
    this._dragMode = "";
    this._dragStart = null;
    this._renderResolution = [0, 0];
  }

  setFont() {}

  setAutoSave() {}

  setCalibrate(on) {
    this.calibrate = !!on;
  }

  setOverlayMode(mode = "always") {
    this.overlayMode = mode === "near" ? "near" : "always";
  }

  isCalibrating() {
    return !!this.calibrate;
  }

  isActive() {
    return this._dragSurf !== -1;
  }

  addSurface({ id, name, width: surfaceWidth, height: surfaceHeight, corners }) {
    const surface = {
      id,
      name: name || id,
      w: Math.max(1, Math.floor(surfaceWidth || 1)),
      h: Math.max(1, Math.floor(surfaceHeight || 1)),
      corners: normalizeCorners(corners),
      defaultCorners: normalizeCorners(corners),
      hoverIndex: -1,
      dragging: -1,
      renderCache: null,
    };
    this.surfaces.push(surface);
    return surface;
  }

  clearSurfaces() {
    this.surfaces.length = 0;
    this._dragSurf = -1;
    this._dragCorner = -1;
    this._dragMode = "";
    this._dragStart = null;
  }

  retainTransitionKernels(kernels = []) {
    const retained = new Set([
      transitionKernelCacheKey(DissolveTransitionKernel),
      ...(kernels || []).map((kernel) => transitionKernelCacheKey(kernel)),
    ]);
    for (const [key, shaderProgram] of this.transitionShaders) {
      const kernelKey = key.replace(/:(?:feather|plain)$/, "");
      if (retained.has(kernelKey)) continue;
      disposeP5Shader(shaderProgram);
      this.transitionShaders.delete(key);
      this.failedTransitionShaders.delete(key);
    }
  }

  dispose() {
    for (const shaderProgram of this.transitionShaders.values()) disposeP5Shader(shaderProgram);
    disposeP5Shader(this.shader);
    disposeP5Shader(this.featherShader);
    this.transitionShaders.clear();
    this.failedTransitionShaders.clear();
    this.shader = null;
    this.featherShader = null;
    this.clearSurfaces();
  }

  exportData() {
    return this.exportConfig();
  }

  exportConfig() {
    return {
      surfaces: this.surfaces.map((surface) => ({
        name: surface.name,
        id: surface.id || surface.name,
        w: surface.w,
        h: surface.h,
        corners: surface.corners.map((corner) => ({ x: corner.x, y: corner.y })),
      })),
    };
  }

  importConfig(config = {}, { replace = false, silent = false } = {}) {
    const incoming = Array.isArray(config?.surfaces) ? config.surfaces : [];
    if (replace) this.clearSurfaces();
    for (const item of incoming) {
      const id = item.id || item.name;
      const name = item.name || id;
      if (!id && !name) continue;
      const surface = this.surfaces.find((candidate) => candidate.id === id || candidate.name === name);
      if (surface) {
        if (Array.isArray(item.corners) && item.corners.length === 4) {
          surface.corners = normalizeCorners(item.corners);
          this._invalidateSurface(surface);
        }
        if (Number.isFinite(Number(item.w))) surface.w = Math.max(1, Math.floor(Number(item.w)));
        if (Number.isFinite(Number(item.h))) surface.h = Math.max(1, Math.floor(Number(item.h)));
      } else if (replace) {
        this.addSurface({
          id,
          name,
          width: item.w,
          height: item.h,
          corners: item.corners,
        });
      }
    }
    if (!silent) this._emitConfigChange("import");
  }

  resetSurface(surfaceId = "") {
    const surface = this.surfaces.find((item) => item.id === surfaceId || item.name === surfaceId);
    if (!surface) return;
    surface.corners = normalizeCorners(surface.defaultCorners);
    this._invalidateSurface(surface);
    this._emitConfigChange("reset-surface");
  }

  resetAll() {
    for (const surface of this.surfaces) {
      surface.corners = normalizeCorners(surface.defaultCorners);
      this._invalidateSurface(surface);
    }
    this._emitConfigChange("reset");
  }

  drawTexture(texture, surface, projectionFit = "cover", feather = 0, options = {}) {
    this.drawTextureBatch([{ texture, surface, projectionFit, feather, options }]);
  }

  drawTextureBatch(items = []) {
    const drawableItems = items.filter((item) => item?.texture && item?.surface);
    if (!drawableItems.length) return;
    const dpr = currentPixelDensity();
    this._renderResolution[0] = width * dpr;
    this._renderResolution[1] = height * dpr;
    let activeShader = null;
    let activeTexture = null;
    noStroke();
    try {
      for (const item of drawableItems) {
        const featherAmount = Math.max(0, Math.min(0.5, Number(item.feather) || 0));
        const shaderProgram = this._ensureShader(featherAmount > 0);
        const cache = this._getRenderCache(item.surface, dpr);
        if (!cache) continue;
        const texture = item.texture;
        // p5 owns sampler allocation/binding. Keeping its shader active while
        // swapping p5.Framebuffer sampler objects can leave queued geometry
        // associated with the following texture. A batch is therefore valid
        // only while both shader variant and texture identity stay unchanged.
        if (shaderProgram !== activeShader || texture !== activeTexture) {
          if (activeShader) resetShader();
          shader(shaderProgram);
          shaderProgram.setUniform("uCanvasSize", [width, height]);
          activeShader = shaderProgram;
          activeTexture = texture;
        }
        const options = item.options || {};
        const sourceRect = normalizedSourceRect(texture, options.sourceRect);
        const sourceWidth = sourceRect[2] * Math.max(1, Number(texture.width) || 1);
        const sourceHeight = sourceRect[3] * Math.max(1, Number(texture.height) || 1);
        shaderProgram.setUniform("tex", texture?.framebuffer || texture);
        shaderProgram.setUniform("uHinv", cache.Hc);
        shaderProgram.setUniform("uSourceRect", sourceRect);
        shaderProgram.setUniform("uSourceAspect", Math.max(0.0001, sourceWidth / Math.max(1, sourceHeight)));
        shaderProgram.setUniform("uTargetAspect", cache.targetAspect);
        shaderProgram.setUniform("uProjectionFit", projectionFitMode(item.projectionFit));
        const sourceFitActive = options.sourceFitActive === true;
        shaderProgram.setUniform("uUseSourceFit", sourceFitActive);
        shaderProgram.setUniform("uSourceTargetAspect", Math.max(0.0001, Number(options.sourceAspect) || sourceWidth / Math.max(1, sourceHeight)));
        shaderProgram.setUniform("uSourceFit", projectionFitMode(options.sourceFit || "cover"));
        const opacity = Number(options.opacity ?? 1);
        shaderProgram.setUniform("uOpacity", Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1);
        if (featherAmount > 0) shaderProgram.setUniform("uFeather", featherAmount);
        this._drawSurfaceQuad(cache.vertices);
      }
    } finally {
      if (activeShader) resetShader();
    }
  }

  drawTransitionTextures(fromTexture, toTexture, surface, {
    fromProjectionFit = "cover",
    toProjectionFit = "cover",
    fromSourceRect = null,
    toSourceRect = null,
    fromSourceFitActive = false,
    toSourceFitActive = false,
    fromSourceFit = "cover",
    toSourceFit = "cover",
    fromSourceAspect = 1,
    toSourceAspect = 1,
    fromOpacity = 1,
    toOpacity = 1,
    feather = 0,
    progress = 0,
    transitionKernel = DissolveTransitionKernel,
    transitionParameters = {},
    transitionTime = 0,
    transitionTimeDelta = 0,
    transitionFrameIndex = 0,
  } = {}) {
    if (!fromTexture || !toTexture || !surface) return;
    const featherAmount = Math.max(0, Math.min(0.5, Number(feather) || 0));
    let effectiveKernel = transitionKernel || DissolveTransitionKernel;
    const requestedKey = `${transitionKernelCacheKey(effectiveKernel)}:${featherAmount > 0 ? "feather" : "plain"}`;
    if (this.failedTransitionShaders.has(requestedKey)) effectiveKernel = DissolveTransitionKernel;
    let shaderProgram;
    const dpr = currentPixelDensity();
    this._renderResolution[0] = width * dpr;
    this._renderResolution[1] = height * dpr;
    const cache = this._getRenderCache(surface, dpr);
    if (!cache) return;
    try {
      shaderProgram = this._ensureTransitionShader(featherAmount > 0, effectiveKernel);
      shader(shaderProgram);
    } catch (error) {
      if (effectiveKernel === DissolveTransitionKernel) throw error;
      this.failedTransitionShaders.add(requestedKey);
      const failedProgram = this.transitionShaders.get(requestedKey);
      if (failedProgram) disposeP5Shader(failedProgram);
      this.transitionShaders.delete(requestedKey);
      this.onTransitionError?.(error, effectiveKernel);
      effectiveKernel = DissolveTransitionKernel;
      shaderProgram = this._ensureTransitionShader(featherAmount > 0, effectiveKernel);
      shader(shaderProgram);
    }
    shaderProgram.setUniform("fromTex", fromTexture?.framebuffer || fromTexture);
    shaderProgram.setUniform("toTex", toTexture?.framebuffer || toTexture);
    shaderProgram.setUniform("uCanvasSize", [width, height]);
    shaderProgram.setUniform("uHinv", cache.Hc);
    const normalizedFromRect = normalizedSourceRect(fromTexture, fromSourceRect);
    const normalizedToRect = normalizedSourceRect(toTexture, toSourceRect);
    const fromWidth = normalizedFromRect[2] * Math.max(1, Number(fromTexture.width) || 1);
    const fromHeight = normalizedFromRect[3] * Math.max(1, Number(fromTexture.height) || 1);
    const toWidth = normalizedToRect[2] * Math.max(1, Number(toTexture.width) || 1);
    const toHeight = normalizedToRect[3] * Math.max(1, Number(toTexture.height) || 1);
    shaderProgram.setUniform("uFromSourceRect", normalizedFromRect);
    shaderProgram.setUniform("uToSourceRect", normalizedToRect);
    shaderProgram.setUniform("uFromSourceAspect", Math.max(0.0001, fromWidth / Math.max(1, fromHeight)));
    shaderProgram.setUniform("uToSourceAspect", Math.max(0.0001, toWidth / Math.max(1, toHeight)));
    shaderProgram.setUniform("uFromUseSourceFit", fromSourceFitActive === true);
    shaderProgram.setUniform("uToUseSourceFit", toSourceFitActive === true);
    shaderProgram.setUniform("uFromSourceTargetAspect", Math.max(0.0001, Number(fromSourceAspect) || fromWidth / Math.max(1, fromHeight)));
    shaderProgram.setUniform("uToSourceTargetAspect", Math.max(0.0001, Number(toSourceAspect) || toWidth / Math.max(1, toHeight)));
    shaderProgram.setUniform("uFromSourceFit", projectionFitMode(fromSourceFit));
    shaderProgram.setUniform("uToSourceFit", projectionFitMode(toSourceFit));
    shaderProgram.setUniform("uFromOpacity", Math.max(0, Math.min(1, Number(fromOpacity) || 0)));
    shaderProgram.setUniform("uToOpacity", Math.max(0, Math.min(1, Number(toOpacity) || 0)));
    shaderProgram.setUniform("uTargetAspect", cache.targetAspect);
    shaderProgram.setUniform("uFromProjectionFit", projectionFitMode(fromProjectionFit));
    shaderProgram.setUniform("uToProjectionFit", projectionFitMode(toProjectionFit));
    shaderProgram.setUniform("uTransition", Math.max(0, Math.min(1, Number(progress) || 0)));
    const transitionHostValues = {
      startImageSize: [Math.max(1, Number(fromTexture.width) || 1), Math.max(1, Number(fromTexture.height) || 1)],
      endImageSize: [Math.max(1, Number(toTexture.width) || 1), Math.max(1, Number(toTexture.height) || 1)],
      renderSize: [Math.max(1, Number(surface.w) || 1), Math.max(1, Number(surface.h) || 1)],
      time: Number(transitionTime) || 0,
      timeDelta: Number(transitionTimeDelta) || 0,
      frameIndex: Math.max(0, Math.floor(Number(transitionFrameIndex) || 0)),
      passIndex: 0,
    };
    for (const [id, value] of Object.entries(transitionKernelUniformValues(
      effectiveKernel,
      transitionParameters,
      transitionHostValues
    ))) {
      if (value !== undefined) shaderProgram.setUniform(id, value);
    }
    if (featherAmount > 0) shaderProgram.setUniform("uFeather", featherAmount);
    this._drawSurfaceQuad(cache.vertices);
    resetShader();
  }

  drawOverlays(pointerX = mouseX, pointerY = mouseY) {
    if (!this.calibrate) return;
    const pick = this._pickCorner(pointerX, pointerY);
    this.surfaces.forEach((surface, index) => {
      surface.hoverIndex = pick && pick.si === index ? pick.ci : -1;
    });

    const gl = drawingContext;
    const depthWasEnabled = typeof gl?.isEnabled === "function" && gl.isEnabled(gl.DEPTH_TEST);
    if (gl?.disable) gl.disable(gl.DEPTH_TEST);
    push();
    const halfWidth = width * 0.5;
    const halfHeight = height * 0.5;
    for (let si = 0; si < this.surfaces.length; si++) {
      const surface = this.surfaces[si];
      const active = surface.dragging === -2 || this._dragSurf === si;
      const visible = this.overlayMode !== "near" || active || surface.hoverIndex !== -1;
      if (!visible) continue;
      stroke(0, 255, 255);
      strokeWeight(active ? 4 : 2);
      noFill();
      beginShape();
      for (const corner of surface.corners) vertex(corner.x - halfWidth, corner.y - halfHeight, 0);
      endShape(CLOSE);
      for (let i = 0; i < 4; i++) {
        const corner = surface.corners[i];
        const x = corner.x - halfWidth;
        const y = corner.y - halfHeight;
        const handleActive = i === surface.hoverIndex || i === surface.dragging;
        noStroke();
        fill(handleActive ? color(0, 255, 255, 200) : color(0, 255, 255, 90));
        circle(x, y, handleActive ? this.pickRadius * 0.9 : this.pickRadius * 0.6);
        fill(handleActive ? 255 : 210);
        circle(x, y, 16);
      }
    }
    pop();
    if (depthWasEnabled) gl.enable?.(gl.DEPTH_TEST);
    else gl?.disable?.(gl.DEPTH_TEST);
  }

  drawGuidePaths(paths = [], surface = null, { color = [255, 228, 94, 190], weight = 2 } = {}) {
    if (!surface || !Array.isArray(paths) || !paths.length) return;
    const projectedPaths = paths.map((path) => (path || [])
      .map((point) => projectSurfaceUv(surface.corners, point))
      .filter(Boolean))
      .filter((path) => path.length >= 3);
    if (!projectedPaths.length) return;
    const gl = drawingContext;
    const depthWasEnabled = typeof gl?.isEnabled === "function" && gl.isEnabled(gl.DEPTH_TEST);
    gl?.disable?.(gl.DEPTH_TEST);
    resetShader();
    push();
    try {
      noFill();
      stroke(...color);
      strokeWeight(Math.max(1, Number(weight) || 1));
      const halfWidth = width * 0.5;
      const halfHeight = height * 0.5;
      for (const path of projectedPaths) {
        beginShape();
        for (const point of path) vertex(point.x - halfWidth, point.y - halfHeight, 1);
        endShape(CLOSE);
      }
    } finally {
      pop();
      if (depthWasEnabled) gl?.enable?.(gl.DEPTH_TEST);
      else gl?.disable?.(gl.DEPTH_TEST);
    }
  }

  mousePressed(mx = mouseX, my = mouseY) {
    if (!this.calibrate) return;
    const pick = this._pickCorner(mx, my);
    if (pick) {
      this._dragSurf = pick.si;
      this._dragCorner = pick.ci;
      this._dragMode = "corner";
      this._dragStart = null;
      this.surfaces[pick.si].dragging = pick.ci;
      return;
    }

    const hit = this.screenToSurface(mx, my);
    if (!hit) return;
    const surface = this.surfaces[hit.surfaceIndex];
    this._dragSurf = hit.surfaceIndex;
    this._dragCorner = -1;
    this._dragMode = "surface";
    this._dragStart = {
      x: Number(mx),
      y: Number(my),
      corners: surface.corners.map((corner) => ({ x: corner.x, y: corner.y })),
    };
    surface.dragging = -2;
  }

  mouseDragged(mx = mouseX, my = mouseY) {
    if (!this.calibrate || this._dragSurf === -1) return;
    const surface = this.surfaces[this._dragSurf];
    if (!surface) return;
    if (this._dragMode === "surface" && this._dragStart) {
      const dx = Number(mx) - this._dragStart.x;
      const dy = Number(my) - this._dragStart.y;
      surface.corners = this._dragStart.corners.map((corner) => ({
        x: corner.x + dx,
        y: corner.y + dy,
      }));
    } else if (this._dragCorner !== -1) {
      surface.corners[this._dragCorner] = { x: Number(mx), y: Number(my) };
    }
    this._invalidateSurface(surface);
    this._emitConfigChange("drag");
  }

  mouseReleased() {
    if (this._dragSurf !== -1) {
      const surface = this.surfaces[this._dragSurf];
      if (surface) surface.dragging = -1;
      this._emitConfigChange("autosave");
    }
    this._dragSurf = -1;
    this._dragCorner = -1;
    this._dragMode = "";
    this._dragStart = null;
  }

  screenToSurface(mx, my) {
    for (let i = this.surfaces.length - 1; i >= 0; i--) {
      const hit = this._screenToSurfaceOn(this.surfaces[i], i, mx, my);
      if (hit) return hit;
    }
    return null;
  }

  _ensureShader(withFeather = false) {
    if (withFeather) {
      if (!this.featherShader) this.featherShader = createShader(mapperVertexShaderSource(), mapperFragmentShaderSource({ feather: true }));
      return this.featherShader;
    }
    if (!this.shader) this.shader = createShader(mapperVertexShaderSource(), mapperFragmentShaderSource());
    return this.shader;
  }

  _ensureTransitionShader(withFeather = false, transitionKernel = DissolveTransitionKernel) {
    const key = `${transitionKernelCacheKey(transitionKernel)}:${withFeather ? "feather" : "plain"}`;
    let shaderProgram = this.transitionShaders.get(key);
    if (!shaderProgram) {
      shaderProgram = createShader(
        mapperVertexShaderSource(),
        mapperTransitionFragmentShaderSource({ feather: withFeather, transitionKernel })
      );
      this.transitionShaders.set(key, shaderProgram);
    }
    return shaderProgram;
  }

  _drawSurfaceQuad(vertices) {
    if (!Array.isArray(vertices) || vertices.length !== 4) return;
    // A mapped quad is shader-filled geometry, never stroked geometry. Keep
    // this invariant at the primitive boundary so transition draws cannot
    // inherit p5's calibration/overlay stroke and expose the strip diagonal.
    push();
    try {
      noStroke();
      beginShape(TRIANGLE_STRIP);
      for (const point of vertices) vertex(point.x, point.y, 0);
      endShape();
    } finally {
      pop();
    }
  }

  _getRenderCache(surface, dpr) {
    const corners = surface?.corners;
    if (!Array.isArray(corners) || corners.length !== 4) return null;
    const [tl, tr, br, bl] = corners;
    const cache = surface.renderCache;
    if (
      cache &&
      cache.dpr === dpr &&
      cache.width === width &&
      cache.height === height &&
      cache.x0 === tl.x &&
      cache.y0 === tl.y &&
      cache.x1 === tr.x &&
      cache.y1 === tr.y &&
      cache.x2 === br.x &&
      cache.y2 === br.y &&
      cache.x3 === bl.x &&
      cache.y3 === bl.y
    ) {
      return cache.valid ? cache : null;
    }

    const bounds = surfaceBounds(tl, tr, br, bl);
    if (!bounds) {
      surface.renderCache = cacheRecord(false, dpr, tl, tr, br, bl);
      return null;
    }
    const homography = computeHomography(tl, tr, br, bl);
    const inverse = invert3x3(homography);
    if (!inverse) {
      surface.renderCache = cacheRecord(false, dpr, tl, tr, br, bl);
      return null;
    }
    surface.renderCache = {
      ...cacheRecord(true, dpr, tl, tr, br, bl),
      Hc: [
        inverse[0], inverse[3], inverse[6],
        inverse[1], inverse[4], inverse[7],
        inverse[2], inverse[5], inverse[8],
      ],
      bounds,
      vertices: surfaceQuadVertices(corners, width, height),
      targetAspect: projectedSurfaceAspect(corners, surface.w / surface.h),
    };
    return surface.renderCache;
  }

  _screenToSurfaceOn(surface, surfaceIndex, mx, my, padding = 0) {
    if (!surface || !Array.isArray(surface.corners) || surface.corners.length !== 4) return null;
    const inverse = invert3x3(computeHomography(...surface.corners));
    if (!inverse) return null;
    const qx = inverse[0] * mx + inverse[1] * my + inverse[2];
    const qy = inverse[3] * mx + inverse[4] * my + inverse[5];
    const qz = inverse[6] * mx + inverse[7] * my + inverse[8];
    if (!Number.isFinite(qz) || Math.abs(qz) < 1e-9) return null;
    const u = qx / qz;
    const v = qy / qz;
    if (u < -padding || u > 1 + padding || v < -padding || v > 1 + padding) return null;
    return { surface, surfaceIndex, name: surface.name, u, v, x: u * surface.w, y: v * surface.h };
  }

  _pickCorner(mx, my) {
    let best = null;
    let bestDistance = Infinity;
    this.surfaces.forEach((surface, si) => {
      surface.corners.forEach((corner, ci) => {
        const dx = Number(mx) - corner.x;
        const dy = Number(my) - corner.y;
        const distance = dx * dx + dy * dy;
        if (distance < this.pickRadius * this.pickRadius && distance < bestDistance) {
          bestDistance = distance;
          best = { si, ci };
        }
      });
    });
    return best;
  }

  _invalidateSurface(surface) {
    if (surface) surface.renderCache = null;
  }

  _emitConfigChange(reason = "change") {
    this.onConfigChange?.(this.exportConfig(), { reason, mapper: this });
  }
}

export function mapperVertexShaderSource() {
  return `
      precision highp float;
      attribute vec3 aPosition;
      uniform mat4 uProjectionMatrix;
      uniform mat4 uModelViewMatrix;
      uniform mat3 uHinv;
      uniform vec2 uCanvasSize;
      varying vec3 vProjectiveUv;
      void main() {
        // Projective sampling belongs to authored canvas coordinates. The p5
        // model matrix may contain an editor-only viewport zoom/pan, which
        // must move the quad without changing which source pixel it samples.
        vec2 authoredScreen = vec2(
          aPosition.x + uCanvasSize.x * 0.5,
          aPosition.y + uCanvasSize.y * 0.5
        );
        vProjectiveUv = uHinv * vec3(authoredScreen, 1.0);
        vec4 clipPosition = uProjectionMatrix * uModelViewMatrix * vec4(aPosition, 1.0);
        gl_Position = clipPosition;
      }
    `;
}

export function mapperFragmentShaderSource({ feather = false } = {}) {
  const featherUniform = feather ? "uniform float uFeather;" : "";
  const featherFunction = feather ? `
      float roundedFeatherMask(vec2 maskUv, float maskAspect) {
        vec2 aspect = maskAspect >= 1.0
          ? vec2(maskAspect, 1.0)
          : vec2(1.0, 1.0 / max(maskAspect, 0.0001));
        float cornerRadius = min(0.08, max(0.012, uFeather * 0.35));
        vec2 roundedPoint = abs(maskUv - 0.5) * aspect;
        vec2 roundedHalfSize = 0.5 * aspect - vec2(cornerRadius);
        vec2 roundedDelta = roundedPoint - roundedHalfSize;
        float roundedDistance = length(max(roundedDelta, 0.0)) +
          min(max(roundedDelta.x, roundedDelta.y), 0.0) - cornerRadius;
        return smoothstep(0.0, uFeather, -roundedDistance);
      }` : "";
  const featherCode = feather ? `
        vec2 featherUv = uUseSourceFit ? sourceTargetUv : (uProjectionFit >= 1.5 ? sampleUv : uv);
        float featherAspect = uUseSourceFit ? uSourceTargetAspect : (uProjectionFit >= 1.5 ? uSourceAspect : uTargetAspect);
        float featherMask = roundedFeatherMask(featherUv, featherAspect);
        color *= featherMask;` : "";
  return `
      precision highp float;
      uniform sampler2D tex;
      uniform vec4 uSourceRect;
      uniform float uSourceAspect;
      uniform float uTargetAspect;
      uniform float uProjectionFit;
      uniform bool uUseSourceFit;
      uniform float uSourceTargetAspect;
      uniform float uSourceFit;
      uniform float uOpacity;
      ${featherUniform}
      varying vec3 vProjectiveUv;
      ${featherFunction}
      void main() {
        float w = abs(vProjectiveUv.z) > 1e-6 ? vProjectiveUv.z : 1e-6;
        vec2 uv = clamp(vProjectiveUv.xy / w, vec2(0.0), vec2(1.0));
        vec2 sourceTargetUv = uv;
        vec2 sampleUv = uv;
        float inside = 1.0;
        float projectionSourceAspect = uUseSourceFit ? uSourceTargetAspect : uSourceAspect;
        if (uProjectionFit > 0.5 && uProjectionFit < 1.5) {
          if (projectionSourceAspect > uTargetAspect) {
            sourceTargetUv.x = 0.5 + (uv.x - 0.5) * (uTargetAspect / projectionSourceAspect);
          } else {
            sourceTargetUv.y = 0.5 + (uv.y - 0.5) * (projectionSourceAspect / uTargetAspect);
          }
        } else if (uProjectionFit >= 1.5) {
          if (projectionSourceAspect > uTargetAspect) {
            sourceTargetUv.y = 0.5 + (uv.y - 0.5) * (projectionSourceAspect / uTargetAspect);
          } else {
            sourceTargetUv.x = 0.5 + (uv.x - 0.5) * (uTargetAspect / projectionSourceAspect);
          }
          inside = step(0.0, sourceTargetUv.x) * step(sourceTargetUv.x, 1.0) *
            step(0.0, sourceTargetUv.y) * step(sourceTargetUv.y, 1.0);
        }
        sampleUv = sourceTargetUv;
        if (uUseSourceFit) {
          if (uSourceFit > 0.5 && uSourceFit < 1.5) {
            if (uSourceAspect > uSourceTargetAspect) {
              sampleUv.x = 0.5 + (sourceTargetUv.x - 0.5) * (uSourceTargetAspect / uSourceAspect);
            } else {
              sampleUv.y = 0.5 + (sourceTargetUv.y - 0.5) * (uSourceAspect / uSourceTargetAspect);
            }
          } else if (uSourceFit >= 1.5) {
            if (uSourceAspect > uSourceTargetAspect) {
              sampleUv.y = 0.5 + (sourceTargetUv.y - 0.5) * (uSourceAspect / uSourceTargetAspect);
            } else {
              sampleUv.x = 0.5 + (sourceTargetUv.x - 0.5) * (uSourceTargetAspect / uSourceAspect);
            }
            inside *= step(0.0, sampleUv.x) * step(sampleUv.x, 1.0) *
              step(0.0, sampleUv.y) * step(sampleUv.y, 1.0);
          }
        }
        vec2 textureUv = uSourceRect.xy + clamp(sampleUv, vec2(0.0), vec2(1.0)) * uSourceRect.zw;
        vec4 color = texture2D(tex, textureUv) * inside * uOpacity;
        ${featherCode}
        gl_FragColor = color;
      }
    `;
}

export function mapperTransitionFragmentShaderSource({
  feather = false,
  transitionKernel = DissolveTransitionKernel,
} = {}) {
  const featherUniform = feather ? "uniform float uFeather;" : "";
  const featherFunction = feather ? `
      float roundedFeatherMask(vec2 maskUv, float maskAspect) {
        vec2 aspect = maskAspect >= 1.0
          ? vec2(maskAspect, 1.0)
          : vec2(1.0, 1.0 / max(maskAspect, 0.0001));
        float cornerRadius = min(0.08, max(0.012, uFeather * 0.35));
        vec2 roundedPoint = abs(maskUv - 0.5) * aspect;
        vec2 roundedHalfSize = 0.5 * aspect - vec2(cornerRadius);
        vec2 roundedDelta = roundedPoint - roundedHalfSize;
        float roundedDistance = length(max(roundedDelta, 0.0)) +
          min(max(roundedDelta.x, roundedDelta.y), 0.0) - cornerRadius;
        return smoothstep(0.0, uFeather, -roundedDistance);
      }` : "";
  const featherCode = feather ? `
        vec2 fromFeatherUv = uFromUseSourceFit ? fromSourceTargetUv : (uFromProjectionFit >= 1.5 ? fromUv : uv);
        float fromFeatherAspect = uFromUseSourceFit ? uFromSourceTargetAspect : (uFromProjectionFit >= 1.5 ? uFromSourceAspect : uTargetAspect);
        fromColor *= roundedFeatherMask(fromFeatherUv, fromFeatherAspect);
        vec2 toFeatherUv = uToUseSourceFit ? toSourceTargetUv : (uToProjectionFit >= 1.5 ? toUv : uv);
        float toFeatherAspect = uToUseSourceFit ? uToSourceTargetAspect : (uToProjectionFit >= 1.5 ? uToSourceAspect : uTargetAspect);
        toColor *= roundedFeatherMask(toFeatherUv, toFeatherAspect);` : "";
  return `
      precision highp float;
      uniform sampler2D fromTex;
      uniform sampler2D toTex;
      uniform vec4 uFromSourceRect;
      uniform vec4 uToSourceRect;
      uniform float uFromSourceAspect;
      uniform float uToSourceAspect;
      uniform bool uFromUseSourceFit;
      uniform bool uToUseSourceFit;
      uniform float uFromSourceTargetAspect;
      uniform float uToSourceTargetAspect;
      uniform float uFromSourceFit;
      uniform float uToSourceFit;
      uniform float uFromOpacity;
      uniform float uToOpacity;
      uniform float uTargetAspect;
      uniform float uFromProjectionFit;
      uniform float uToProjectionFit;
      uniform float uTransition;
      ${featherUniform}
      varying vec3 vProjectiveUv;
      ${featherFunction}
      ${transitionKernel?.source || DissolveTransitionKernel.source}
      void main() {
        float w = abs(vProjectiveUv.z) > 1e-6 ? vProjectiveUv.z : 1e-6;
        vec2 uv = clamp(vProjectiveUv.xy / w, vec2(0.0), vec2(1.0));
        float fromProjectionSourceAspect = uFromUseSourceFit ? uFromSourceTargetAspect : uFromSourceAspect;
        vec2 fromSourceTargetUv = uv;
        vec2 fromUv = uv;
        float fromInside = 1.0;
        if (uFromProjectionFit > 0.5 && uFromProjectionFit < 1.5) {
          if (fromProjectionSourceAspect > uTargetAspect) {
            fromSourceTargetUv.x = 0.5 + (uv.x - 0.5) * (uTargetAspect / fromProjectionSourceAspect);
          } else {
            fromSourceTargetUv.y = 0.5 + (uv.y - 0.5) * (fromProjectionSourceAspect / uTargetAspect);
          }
        } else if (uFromProjectionFit >= 1.5) {
          if (fromProjectionSourceAspect > uTargetAspect) {
            fromSourceTargetUv.y = 0.5 + (uv.y - 0.5) * (fromProjectionSourceAspect / uTargetAspect);
          } else {
            fromSourceTargetUv.x = 0.5 + (uv.x - 0.5) * (uTargetAspect / fromProjectionSourceAspect);
          }
          fromInside = step(0.0, fromSourceTargetUv.x) * step(fromSourceTargetUv.x, 1.0) *
            step(0.0, fromSourceTargetUv.y) * step(fromSourceTargetUv.y, 1.0);
        }
        fromUv = fromSourceTargetUv;
        if (uFromUseSourceFit) {
          if (uFromSourceFit > 0.5 && uFromSourceFit < 1.5) {
            if (uFromSourceAspect > uFromSourceTargetAspect) {
              fromUv.x = 0.5 + (fromSourceTargetUv.x - 0.5) * (uFromSourceTargetAspect / uFromSourceAspect);
            } else {
              fromUv.y = 0.5 + (fromSourceTargetUv.y - 0.5) * (uFromSourceAspect / uFromSourceTargetAspect);
            }
          } else if (uFromSourceFit >= 1.5) {
            if (uFromSourceAspect > uFromSourceTargetAspect) {
              fromUv.y = 0.5 + (fromSourceTargetUv.y - 0.5) * (uFromSourceAspect / uFromSourceTargetAspect);
            } else {
              fromUv.x = 0.5 + (fromSourceTargetUv.x - 0.5) * (uFromSourceTargetAspect / uFromSourceAspect);
            }
            fromInside *= step(0.0, fromUv.x) * step(fromUv.x, 1.0) *
              step(0.0, fromUv.y) * step(fromUv.y, 1.0);
          }
        }

        float toProjectionSourceAspect = uToUseSourceFit ? uToSourceTargetAspect : uToSourceAspect;
        vec2 toSourceTargetUv = uv;
        vec2 toUv = uv;
        float toInside = 1.0;
        if (uToProjectionFit > 0.5 && uToProjectionFit < 1.5) {
          if (toProjectionSourceAspect > uTargetAspect) {
            toSourceTargetUv.x = 0.5 + (uv.x - 0.5) * (uTargetAspect / toProjectionSourceAspect);
          } else {
            toSourceTargetUv.y = 0.5 + (uv.y - 0.5) * (toProjectionSourceAspect / uTargetAspect);
          }
        } else if (uToProjectionFit >= 1.5) {
          if (toProjectionSourceAspect > uTargetAspect) {
            toSourceTargetUv.y = 0.5 + (uv.y - 0.5) * (toProjectionSourceAspect / uTargetAspect);
          } else {
            toSourceTargetUv.x = 0.5 + (uv.x - 0.5) * (uTargetAspect / toProjectionSourceAspect);
          }
          toInside = step(0.0, toSourceTargetUv.x) * step(toSourceTargetUv.x, 1.0) *
            step(0.0, toSourceTargetUv.y) * step(toSourceTargetUv.y, 1.0);
        }
        toUv = toSourceTargetUv;
        if (uToUseSourceFit) {
          if (uToSourceFit > 0.5 && uToSourceFit < 1.5) {
            if (uToSourceAspect > uToSourceTargetAspect) {
              toUv.x = 0.5 + (toSourceTargetUv.x - 0.5) * (uToSourceTargetAspect / uToSourceAspect);
            } else {
              toUv.y = 0.5 + (toSourceTargetUv.y - 0.5) * (uToSourceAspect / uToSourceTargetAspect);
            }
          } else if (uToSourceFit >= 1.5) {
            if (uToSourceAspect > uToSourceTargetAspect) {
              toUv.y = 0.5 + (toSourceTargetUv.y - 0.5) * (uToSourceAspect / uToSourceTargetAspect);
            } else {
              toUv.x = 0.5 + (toSourceTargetUv.x - 0.5) * (uToSourceTargetAspect / uToSourceAspect);
            }
            toInside *= step(0.0, toUv.x) * step(toUv.x, 1.0) *
              step(0.0, toUv.y) * step(toUv.y, 1.0);
          }
        }

        vec2 fromTextureUv = uFromSourceRect.xy + clamp(fromUv, vec2(0.0), vec2(1.0)) * uFromSourceRect.zw;
        vec2 toTextureUv = uToSourceRect.xy + clamp(toUv, vec2(0.0), vec2(1.0)) * uToSourceRect.zw;
        vec4 fromColor = texture2D(fromTex, fromTextureUv) * fromInside * uFromOpacity;
        vec4 toColor = texture2D(toTex, toTextureUv) * toInside * uToOpacity;
        ${featherCode}
        vec4 color = vj1Transition(fromColor, toColor, uv, clamp(uTransition, 0.0, 1.0));
        gl_FragColor = color;
      }
    `;
}

export function projectionFitMode(value = "cover") {
  if (value === "stretch") return 0;
  if (value === "contain") return 2;
  return 1;
}

export function normalizedSourceRect(texture = {}, rect = null) {
  const width = Math.max(1, Number(texture?.width) || 1);
  const height = Math.max(1, Number(texture?.height) || 1);
  if (!rect) return [0, 0, 1, 1];
  const x = Math.max(0, Math.min(width, Number(rect.x) || 0));
  const y = Math.max(0, Math.min(height, Number(rect.y) || 0));
  const rectWidth = Math.max(1, Math.min(width - x, Number(rect.width) || width));
  const rectHeight = Math.max(1, Math.min(height - y, Number(rect.height) || height));
  return [x / width, y / height, rectWidth / width, rectHeight / height];
}

export function surfaceQuadVertices(corners, canvasWidth, canvasHeight) {
  if (!Array.isArray(corners) || corners.length !== 4) return [];
  const [tl, tr, br, bl] = corners;
  return [tl, tr, bl, br].map((point) => ({
    x: point.x - Number(canvasWidth) * 0.5,
    y: point.y - Number(canvasHeight) * 0.5,
  }));
}

export function projectedSurfaceAspect(corners = [], fallback = 1) {
  return projectedQuadAspect(corners, fallback);
}

function normalizeCorners(corners = []) {
  return Array.isArray(corners) && corners.length === 4
    ? corners.map((corner) => ({ x: Number(corner.x) || 0, y: Number(corner.y) || 0 }))
    : [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
}

function currentPixelDensity() {
  const gl = drawingContext;
  if (gl && Number.isFinite(gl.drawingBufferWidth) && Number.isFinite(width) && width > 0) {
    const dpr = gl.drawingBufferWidth / width;
    if (Number.isFinite(dpr) && dpr > 0) return dpr;
  }
  if (typeof pixelDensity === "function") {
    const dpr = pixelDensity();
    if (Number.isFinite(dpr) && dpr > 0) return dpr;
  }
  return 1;
}

export function disposeP5Shader(shaderProgram) {
  if (!shaderProgram) return;
  const gl = shaderProgram?._renderer?.GL || shaderProgram?._renderer?.drawingContext;
  const program = shaderProgram?._glProgram;
  deleteWebGlResource(gl, program, "isProgram", "deleteProgram");
  const vertex = shaderProgram?._vertShader;
  deleteWebGlResource(gl, vertex, "isShader", "deleteShader");
  const fragment = shaderProgram?._fragShader;
  deleteWebGlResource(gl, fragment, "isShader", "deleteShader");
  shaderProgram._glProgram = 0;
  shaderProgram._vertShader = 0;
  shaderProgram._fragShader = 0;
}

function deleteWebGlResource(gl, resource, predicateName, deleteName) {
  if (!gl || !resource ||
      typeof gl[predicateName] !== "function" ||
      typeof gl[deleteName] !== "function") return false;
  // p5 shader wrappers can retain source/wrapper values in these private
  // fields while compilation or context replacement is in progress. WebIDL
  // predicates throw for those values instead of returning false, so resource
  // disposal must treat type rejection as "not owned by this GL context".
  try {
    if (!gl[predicateName](resource)) return false;
    gl[deleteName](resource);
    return true;
  } catch {
    return false;
  }
}

function surfaceBounds(tl, tr, br, bl) {
  const pad = 1;
  const values = [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y].map(Number);
  if (!values.every(Number.isFinite)) return null;
  const minX = Math.floor(Math.min(tl.x, tr.x, br.x, bl.x) - pad);
  const minY = Math.floor(Math.min(tl.y, tr.y, br.y, bl.y) - pad);
  const maxX = Math.ceil(Math.max(tl.x, tr.x, br.x, bl.x) + pad);
  const maxY = Math.ceil(Math.max(tl.y, tr.y, br.y, bl.y) + pad);
  // Authored Mapping coordinates are allowed outside the raw p5 host. The
  // shared preview model transform can bring them onscreen (notably when a
  // multi-Output world is contained in a narrower preview). Clipping here
  // rejected the shader cache before that transform, producing visible
  // overlays with blank textures. GL clipping and the render-demand planner
  // already handle genuinely invisible geometry.
  if (maxX <= minX || maxY <= minY) return null;
  return { x0: minX, y0: minY, x1: maxX, y1: maxY };
}

function cacheRecord(valid, dpr, tl, tr, br, bl) {
  return {
    valid,
    dpr,
    width,
    height,
    x0: tl.x,
    y0: tl.y,
    x1: tr.x,
    y1: tr.y,
    x2: br.x,
    y2: br.y,
    x3: bl.x,
    y3: bl.y,
  };
}

function computeHomography(tl, tr, br, bl) {
  const points = [
    [0, 0, tl.x, tl.y],
    [1, 0, tr.x, tr.y],
    [1, 1, br.x, br.y],
    [0, 1, bl.x, bl.y],
  ];
  const matrix = new Array(8).fill(0).map(() => new Array(8).fill(0));
  const values = new Array(8).fill(0);
  for (let i = 0; i < 4; i++) {
    const [u, v, x, y] = points[i];
    matrix[2 * i][0] = u;
    matrix[2 * i][1] = v;
    matrix[2 * i][2] = 1;
    matrix[2 * i][6] = -u * x;
    matrix[2 * i][7] = -v * x;
    values[2 * i] = x;
    matrix[2 * i + 1][3] = u;
    matrix[2 * i + 1][4] = v;
    matrix[2 * i + 1][5] = 1;
    matrix[2 * i + 1][6] = -u * y;
    matrix[2 * i + 1][7] = -v * y;
    values[2 * i + 1] = y;
  }
  const h = solve8(matrix, values);
  return h ? [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1] : [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

export function projectSurfaceUv(corners = [], point = {}) {
  if (!Array.isArray(corners) || corners.length !== 4) return null;
  const matrix = computeHomography(...corners);
  const u = Number(point.x);
  const v = Number(point.y);
  if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
  const qx = matrix[0] * u + matrix[1] * v + matrix[2];
  const qy = matrix[3] * u + matrix[4] * v + matrix[5];
  const qz = matrix[6] * u + matrix[7] * v + matrix[8];
  if (!Number.isFinite(qz) || Math.abs(qz) < 1e-9) return null;
  return { x: qx / qz, y: qy / qz };
}

function solve8(matrix, values) {
  const work = matrix.map((row) => row.slice());
  const y = values.slice();
  const size = 8;
  for (let col = 0; col < size; col++) {
    let pivot = col;
    let maxAbs = Math.abs(work[col][col]);
    for (let row = col + 1; row < size; row++) {
      const next = Math.abs(work[row][col]);
      if (next > maxAbs) {
        maxAbs = next;
        pivot = row;
      }
    }
    if (maxAbs < 1e-9) return null;
    if (pivot !== col) {
      [work[col], work[pivot]] = [work[pivot], work[col]];
      [y[col], y[pivot]] = [y[pivot], y[col]];
    }
    const div = work[col][col];
    for (let c = col; c < size; c++) work[col][c] /= div;
    y[col] /= div;
    for (let row = col + 1; row < size; row++) {
      const factor = work[row][col];
      if (factor === 0) continue;
      for (let c = col; c < size; c++) work[row][c] -= factor * work[col][c];
      y[row] -= factor * y[col];
    }
  }
  const result = new Array(size).fill(0);
  for (let row = size - 1; row >= 0; row--) {
    let sum = y[row];
    for (let c = row + 1; c < size; c++) sum -= work[row][c] * result[c];
    result[row] = sum;
  }
  return result.every(Number.isFinite) ? result : null;
}

function invert3x3(matrix) {
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const D = -(b * i - c * h);
  const E = a * i - c * g;
  const F = -(a * h - b * g);
  const G = b * f - c * e;
  const H = -(a * f - c * d);
  const I = a * e - b * d;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-9) return null;
  const invDet = 1 / det;
  return [A * invDet, D * invDet, G * invDet, B * invDet, E * invDet, H * invDet, C * invDet, F * invDet, I * invDet];
}

export const MappingEngineNode = defineNode({
  id: "core.mapping.projection-engine",
  name: "Projection Mapping Engine",
  version: "0.1.0",
  description: "Owns projection surfaces, homographies, shader drawing, calibration interaction, and mapping serialization.",
  implementation: NODE_IMPLEMENTATION_KINDS.SHADER,
  inlets: {
    engine: { type: "any", required: true },
    config: { type: "any", optional: true },
    surfaceId: { type: "string", optional: true, defaultValue: "" },
    enabled: { type: "boolean", optional: true, defaultValue: true },
  },
  parameters: {
    command: {
      type: { type: "enum", values: ["serialize", "apply-config", "reset-all", "reset-surface", "set-calibrate"] },
      defaultValue: "serialize",
    },
  },
  outlets: {
    config: { type: "any" },
    active: { type: "boolean" },
  },
  execution: { trigger: "manual", domain: "main", stateful: true, asynchronous: false },
  capabilities: ["projection-mapping", "homography", "calibration-ui", "gpu", "graph-placeable", "live-fast-path"],
  presentation: { catalogs: ["graph", "mapping", "render"], placeableOn: ["node-graph"], previewOutput: "config" },
  parts: [
    {
      id: "mapping-engine",
      name: "Mapping engine",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      export: "VjMapper",
      source: [VjMapper, computeHomography, projectSurfaceUv, solve8, invert3x3, surfaceQuadVertices, projectedQuadAspect, projectedSurfaceAspect]
        .map((value) => value.toString()).join("\n\n"),
    },
    {
      id: "mapping-shaders",
      name: "Mapping shaders",
      kind: NODE_PART_KINDS.SHADER,
      language: "glsl",
      editable: true,
      module: import.meta.url,
      exports: ["mapperVertexShaderSource", "mapperFragmentShaderSource", "mapperTransitionFragmentShaderSource"],
      source: [
        mapperVertexShaderSource(),
        mapperFragmentShaderSource(),
        mapperFragmentShaderSource({ feather: true }),
        mapperTransitionFragmentShaderSource(),
        mapperTransitionFragmentShaderSource({ feather: true }),
      ].join("\n\n"),
    },
  ],
  process: mappingEngineNodeProcess,
});

export function mappingEngineNodeProcess({ engine, command = "serialize", config, surfaceId = "", enabled = true } = {}) {
  if (!(engine instanceof VjMapper)) throw new TypeError("MAPPING_ENGINE_INSTANCE_REQUIRED");
  if (command === "apply-config") engine.importConfig(config);
  else if (command === "reset-all") engine.resetAll();
  else if (command === "reset-surface") engine.resetSurface(surfaceId);
  else if (command === "set-calibrate") engine.setCalibrate(enabled);
  return { config: engine.exportConfig(), active: engine.isActive() };
}
