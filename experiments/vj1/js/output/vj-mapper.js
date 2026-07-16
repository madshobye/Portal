export class VjMapper {
  constructor({ onConfigChange } = {}) {
    this.surfaces = [];
    this.shader = null;
    this.featherShader = null;
    this.transitionShader = null;
    this.transitionFeatherShader = null;
    this.calibrate = true;
    this.overlayMode = "always";
    this.pickRadius = 60;
    this.edgeSoftness = 0;
    this.onConfigChange = typeof onConfigChange === "function" ? onConfigChange : null;
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

  setEdgeSoftness(value = 0) {
    const next = Math.max(0, Math.min(8, Number(value) || 0));
    this.edgeSoftness = next;
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

  drawTexture(texture, surface, projectionFit = "cover", feather = 0) {
    if (!texture || !surface) return;
    const featherAmount = Math.max(0, Math.min(0.5, Number(feather) || 0));
    const shaderProgram = this._ensureShader(featherAmount > 0);
    const dpr = currentPixelDensity();
    this._renderResolution[0] = width * dpr;
    this._renderResolution[1] = height * dpr;
    const cache = this._getRenderCache(surface, dpr);
    if (!cache) return;
    shader(shaderProgram);
    shaderProgram.setUniform("tex", texture?.framebuffer || texture);
    shaderProgram.setUniform("uCanvasSize", [width, height]);
    shaderProgram.setUniform("uHinv", cache.Hc);
    shaderProgram.setUniform("uSurfaceSize", [texture.width || surface.w, texture.height || surface.h]);
    shaderProgram.setUniform("uSourceAspect", Math.max(0.0001, Number(texture.width) || 1) / Math.max(1, Number(texture.height) || 1));
    shaderProgram.setUniform("uTargetAspect", projectedSurfaceAspect(surface.corners, surface.w / surface.h));
    shaderProgram.setUniform("uProjectionFit", projectionFitMode(projectionFit));
    if (featherAmount > 0) shaderProgram.setUniform("uFeather", featherAmount);
    shaderProgram.setUniform("uEdgeSoftness", this.edgeSoftness);
    this._drawSurfaceQuad(surface.corners);
    resetShader();
  }

  drawTransitionTextures(fromTexture, toTexture, surface, {
    fromProjectionFit = "cover",
    toProjectionFit = "cover",
    feather = 0,
    progress = 0,
  } = {}) {
    if (!fromTexture || !toTexture || !surface) return;
    const featherAmount = Math.max(0, Math.min(0.5, Number(feather) || 0));
    const shaderProgram = this._ensureTransitionShader(featherAmount > 0);
    const dpr = currentPixelDensity();
    this._renderResolution[0] = width * dpr;
    this._renderResolution[1] = height * dpr;
    const cache = this._getRenderCache(surface, dpr);
    if (!cache) return;
    shader(shaderProgram);
    shaderProgram.setUniform("fromTex", fromTexture?.framebuffer || fromTexture);
    shaderProgram.setUniform("toTex", toTexture?.framebuffer || toTexture);
    shaderProgram.setUniform("uCanvasSize", [width, height]);
    shaderProgram.setUniform("uHinv", cache.Hc);
    shaderProgram.setUniform("uFromSurfaceSize", [fromTexture.width || surface.w, fromTexture.height || surface.h]);
    shaderProgram.setUniform("uToSurfaceSize", [toTexture.width || surface.w, toTexture.height || surface.h]);
    shaderProgram.setUniform("uFromSourceAspect", Math.max(0.0001, Number(fromTexture.width) || 1) / Math.max(1, Number(fromTexture.height) || 1));
    shaderProgram.setUniform("uToSourceAspect", Math.max(0.0001, Number(toTexture.width) || 1) / Math.max(1, Number(toTexture.height) || 1));
    shaderProgram.setUniform("uTargetAspect", projectedSurfaceAspect(surface.corners, surface.w / surface.h));
    shaderProgram.setUniform("uFromProjectionFit", projectionFitMode(fromProjectionFit));
    shaderProgram.setUniform("uToProjectionFit", projectionFitMode(toProjectionFit));
    shaderProgram.setUniform("uTransition", Math.max(0, Math.min(1, Number(progress) || 0)));
    if (featherAmount > 0) shaderProgram.setUniform("uFeather", featherAmount);
    shaderProgram.setUniform("uEdgeSoftness", this.edgeSoftness);
    this._drawSurfaceQuad(surface.corners);
    resetShader();
  }

  drawOverlays() {
    if (!this.calibrate) return;
    const pick = this._pickCorner(mouseX, mouseY);
    this.surfaces.forEach((surface, index) => {
      surface.hoverIndex = pick && pick.si === index ? pick.ci : -1;
    });

    const gl = drawingContext;
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
    if (gl?.enable) gl.enable(gl.DEPTH_TEST);
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

  _ensureTransitionShader(withFeather = false) {
    if (withFeather) {
      if (!this.transitionFeatherShader) this.transitionFeatherShader = createShader(mapperVertexShaderSource(), mapperTransitionFragmentShaderSource({ feather: true }));
      return this.transitionFeatherShader;
    }
    if (!this.transitionShader) this.transitionShader = createShader(mapperVertexShaderSource(), mapperTransitionFragmentShaderSource());
    return this.transitionShader;
  }

  _drawSurfaceQuad(corners) {
    if (!Array.isArray(corners) || corners.length !== 4) return;
    noStroke();
    const vertices = surfaceQuadVertices(corners, width, height);
    beginShape(TRIANGLE_STRIP);
    for (const point of vertices) vertex(point.x, point.y, 0);
    endShape();
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
        vec4 clipPosition = uProjectionMatrix * uModelViewMatrix * vec4(aPosition, 1.0);
        vec2 ndc = clipPosition.xy / max(abs(clipPosition.w), 1e-6);
        vec2 screen = vec2(
          (ndc.x * 0.5 + 0.5) * uCanvasSize.x,
          (0.5 - ndc.y * 0.5) * uCanvasSize.y
        );
        vProjectiveUv = uHinv * vec3(screen, 1.0);
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
        vec2 featherUv = uProjectionFit >= 1.5 ? sampleUv : uv;
        float featherAspect = uProjectionFit >= 1.5 ? uSourceAspect : uTargetAspect;
        float featherMask = roundedFeatherMask(featherUv, featherAspect);
        color *= featherMask;` : "";
  return `
      precision highp float;
      uniform sampler2D tex;
      uniform vec2 uSurfaceSize;
      uniform float uSourceAspect;
      uniform float uTargetAspect;
      uniform float uProjectionFit;
      ${featherUniform}
      uniform float uEdgeSoftness;
      varying vec3 vProjectiveUv;
      ${featherFunction}
      void main() {
        float w = abs(vProjectiveUv.z) > 1e-6 ? vProjectiveUv.z : 1e-6;
        vec2 uv = clamp(vProjectiveUv.xy / w, vec2(0.0), vec2(1.0));
        vec2 sampleUv = uv;
        float inside = 1.0;
        if (uProjectionFit > 0.5 && uProjectionFit < 1.5) {
          if (uSourceAspect > uTargetAspect) {
            sampleUv.x = 0.5 + (uv.x - 0.5) * (uTargetAspect / uSourceAspect);
          } else {
            sampleUv.y = 0.5 + (uv.y - 0.5) * (uSourceAspect / uTargetAspect);
          }
        } else if (uProjectionFit >= 1.5) {
          if (uSourceAspect > uTargetAspect) {
            sampleUv.y = 0.5 + (uv.y - 0.5) * (uSourceAspect / uTargetAspect);
          } else {
            sampleUv.x = 0.5 + (uv.x - 0.5) * (uTargetAspect / uSourceAspect);
          }
          inside = step(0.0, sampleUv.x) * step(sampleUv.x, 1.0) *
            step(0.0, sampleUv.y) * step(sampleUv.y, 1.0);
        }
        vec4 color = texture2D(tex, clamp(sampleUv, vec2(0.0), vec2(1.0))) * inside;
        ${featherCode}
        if (uEdgeSoftness > 0.0) {
          vec2 edgePx = min(uv, 1.0 - uv) * uSurfaceSize;
          float edge = min(edgePx.x, edgePx.y);
          color.a *= smoothstep(0.0, uEdgeSoftness, edge);
        }
        gl_FragColor = color;
      }
    `;
}

export function mapperTransitionFragmentShaderSource({ feather = false } = {}) {
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
        vec2 fromFeatherUv = uFromProjectionFit >= 1.5 ? fromUv : uv;
        float fromFeatherAspect = uFromProjectionFit >= 1.5 ? uFromSourceAspect : uTargetAspect;
        fromColor *= roundedFeatherMask(fromFeatherUv, fromFeatherAspect);
        vec2 toFeatherUv = uToProjectionFit >= 1.5 ? toUv : uv;
        float toFeatherAspect = uToProjectionFit >= 1.5 ? uToSourceAspect : uTargetAspect;
        toColor *= roundedFeatherMask(toFeatherUv, toFeatherAspect);` : "";
  return `
      precision highp float;
      uniform sampler2D fromTex;
      uniform sampler2D toTex;
      uniform vec2 uFromSurfaceSize;
      uniform vec2 uToSurfaceSize;
      uniform float uFromSourceAspect;
      uniform float uToSourceAspect;
      uniform float uTargetAspect;
      uniform float uFromProjectionFit;
      uniform float uToProjectionFit;
      uniform float uTransition;
      ${featherUniform}
      uniform float uEdgeSoftness;
      varying vec3 vProjectiveUv;
      ${featherFunction}
      void main() {
        float w = abs(vProjectiveUv.z) > 1e-6 ? vProjectiveUv.z : 1e-6;
        vec2 uv = clamp(vProjectiveUv.xy / w, vec2(0.0), vec2(1.0));
        vec2 fromUv = uv;
        float fromInside = 1.0;
        if (uFromProjectionFit > 0.5 && uFromProjectionFit < 1.5) {
          if (uFromSourceAspect > uTargetAspect) {
            fromUv.x = 0.5 + (uv.x - 0.5) * (uTargetAspect / uFromSourceAspect);
          } else {
            fromUv.y = 0.5 + (uv.y - 0.5) * (uFromSourceAspect / uTargetAspect);
          }
        } else if (uFromProjectionFit >= 1.5) {
          if (uFromSourceAspect > uTargetAspect) {
            fromUv.y = 0.5 + (uv.y - 0.5) * (uFromSourceAspect / uTargetAspect);
          } else {
            fromUv.x = 0.5 + (uv.x - 0.5) * (uTargetAspect / uFromSourceAspect);
          }
          fromInside = step(0.0, fromUv.x) * step(fromUv.x, 1.0) *
            step(0.0, fromUv.y) * step(fromUv.y, 1.0);
        }

        vec2 toUv = uv;
        float toInside = 1.0;
        if (uToProjectionFit > 0.5 && uToProjectionFit < 1.5) {
          if (uToSourceAspect > uTargetAspect) {
            toUv.x = 0.5 + (uv.x - 0.5) * (uTargetAspect / uToSourceAspect);
          } else {
            toUv.y = 0.5 + (uv.y - 0.5) * (uToSourceAspect / uTargetAspect);
          }
        } else if (uToProjectionFit >= 1.5) {
          if (uToSourceAspect > uTargetAspect) {
            toUv.y = 0.5 + (uv.y - 0.5) * (uToSourceAspect / uTargetAspect);
          } else {
            toUv.x = 0.5 + (uv.x - 0.5) * (uTargetAspect / uToSourceAspect);
          }
          toInside = step(0.0, toUv.x) * step(toUv.x, 1.0) *
            step(0.0, toUv.y) * step(toUv.y, 1.0);
        }

        vec4 fromColor = texture2D(fromTex, clamp(fromUv, vec2(0.0), vec2(1.0))) * fromInside;
        vec4 toColor = texture2D(toTex, clamp(toUv, vec2(0.0), vec2(1.0))) * toInside;
        ${featherCode}
        vec4 color = mix(fromColor, toColor, clamp(uTransition, 0.0, 1.0));
        if (uEdgeSoftness > 0.0) {
          vec2 surfaceSize = mix(uFromSurfaceSize, uToSurfaceSize, clamp(uTransition, 0.0, 1.0));
          vec2 edgePx = min(uv, 1.0 - uv) * surfaceSize;
          float edge = min(edgePx.x, edgePx.y);
          float edgeMask = smoothstep(0.0, uEdgeSoftness, edge);
          color *= edgeMask;
        }
        gl_FragColor = color;
      }
    `;
}

export function projectionFitMode(value = "cover") {
  if (value === "stretch") return 0;
  if (value === "contain") return 2;
  return 1;
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
  const safeFallback = Math.max(0.0001, Number(fallback) || 1);
  if (!Array.isArray(corners) || corners.length !== 4) return safeFallback;
  const [tl, tr, br, bl] = corners;
  if (![tl, tr, br, bl].every(validPoint)) return safeFallback;
  // Projection fit describes the visible mapped quadrilateral, not the
  // surface's stored logical dimensions. Averaging opposing edges gives one
  // stable aspect for trapezoids without letting the longest edge dominate.
  const width = (pointDistance(tl, tr) + pointDistance(bl, br)) * 0.5;
  const height = (pointDistance(tl, bl) + pointDistance(tr, br)) * 0.5;
  if (!(width > 0) || !(height > 0)) return safeFallback;
  return Math.max(0.0001, width / height);
}

function validPoint(point) {
  return point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y));
}

function pointDistance(a, b) {
  const dx = Number(a.x) - Number(b.x);
  const dy = Number(a.y) - Number(b.y);
  return Math.sqrt(dx * dx + dy * dy);
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

function surfaceBounds(tl, tr, br, bl) {
  const pad = 1;
  const minX = Math.max(0, Math.floor(Math.min(tl.x, tr.x, br.x, bl.x) - pad));
  const minY = Math.max(0, Math.floor(Math.min(tl.y, tr.y, br.y, bl.y) - pad));
  const maxX = Math.min(width, Math.ceil(Math.max(tl.x, tr.x, br.x, bl.x) + pad));
  const maxY = Math.min(height, Math.ceil(Math.max(tl.y, tr.y, br.y, bl.y) + pad));
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
