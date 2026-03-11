// Ink drawing helper for Portal sketches.
// Inspired by expressive ink and flowy dry-brush styles.
//
// Example:
//   await loadScript("portal/ink.js");
//   ink = await new InkDrawing({ mode: "flowy" }).init();
//   ink.updatePointers([{ id: "mouse", x: mouseX, y: mouseY }]);
//   ink.draw();

class InkDrawing {
  constructor({
    layer = null,
    width = null,
    height = null,
    background = 0,
    foreground = 255,
    mode = "flowy",
    params = {},
    brushTextureSize = 96,
  } = {}) {
    this.layer = layer || null;
    this.width = width;
    this.height = height;
    this.backgroundColor = background;
    this.foregroundColor = foreground;
    this.mode = mode || "flowy";
    this.brushTextureSize = Math.max(24, Number(brushTextureSize) || 96);

    this.ready = false;
    this.pointerState = new Map();
    this._activeIds = new Set();
    this._noiseT = random(1000);
    this._brushStamp = null;

    this.presets = this._buildPresets();
    this.params = this._mergeParams(this.presets[this.mode] || this.presets.flowy, params);
  }

  async init() {
    if (!this.layer) {
      const w = Math.max(1, Number(this.width) || width || windowWidth || 1);
      const h = Math.max(1, Number(this.height) || height || windowHeight || 1);
      this.layer = createGraphics(w, h);
    }

    if (typeof this.layer.pixelDensity === "function") this.layer.pixelDensity(1);
    this.clear();
    this._brushStamp = this._makeBrushTexture(this.brushTextureSize);
    this.ready = true;
    return this;
  }

  getLayer() {
    return this.layer;
  }

  setMode(mode, patch = {}) {
    const next = String(mode || "").trim();
    if (!this.presets[next]) throw new Error(`InkDrawing: unknown mode "${mode}"`);
    this.mode = next;
    this.params = this._mergeParams(this.presets[next], patch);
    return this.params;
  }

  patchParams(patch = {}) {
    this.params = this._mergeParams(this.params, patch || {});
    return this.params;
  }

  getParams() {
    return { ...this.params };
  }

  getModes() {
    return Object.keys(this.presets);
  }

  clear(background = this.backgroundColor) {
    if (!this.layer) return;
    this.layer.push();
    this.layer.background(background);
    this.layer.pop();
  }

  fade(amount = 0.03, color = this.backgroundColor) {
    if (!this.layer) return;
    const a = this._clamp01(amount);
    this.layer.push();
    this.layer.noStroke();
    this.layer.fill(this._colorWithAlpha(color, a * 255));
    this.layer.rect(0, 0, this.layer.width, this.layer.height);
    this.layer.pop();
  }

  resize(w, h, preserve = true) {
    const nextW = Math.max(1, Number(w) || 1);
    const nextH = Math.max(1, Number(h) || 1);
    if (!this.layer) {
      this.width = nextW;
      this.height = nextH;
      return;
    }

    const old = this.layer;
    const next = createGraphics(nextW, nextH);
    if (typeof next.pixelDensity === "function") next.pixelDensity(1);
    next.background(this.backgroundColor);
    if (preserve) next.image(old, 0, 0);
    this.layer = next;
  }

  draw(x = 0, y = 0, w = null, h = null) {
    if (!this.layer || typeof image !== "function") return;
    if (w == null || h == null) image(this.layer, x, y);
    else image(this.layer, x, y, w, h);
  }

  beginStroke(id, x, y) {
    const key = String(id);
    this.pointerState.set(key, {
      id: key,
      x: Number(x),
      y: Number(y),
      vx: 0,
      vy: 0,
      angle: 0,
      started: false,
    });
    this._activeIds.add(key);
  }

  strokeTo(id, x, y, extra = {}) {
    if (!this.ready || !this.layer) return;

    const key = String(id);
    if (!this.pointerState.has(key)) this.beginStroke(key, x, y);

    const prev = this.pointerState.get(key);
    const cur = {
      id: key,
      x: Number(x),
      y: Number(y),
      pressure: Number(extra.pressure ?? 1),
    };

    if (!prev.started) {
      prev.x = cur.x;
      prev.y = cur.y;
      prev.started = true;
      this.pointerState.set(key, prev);
      return;
    }

    if (this.mode === "inky") this._drawInkySegment(prev, cur);
    else this._drawFlowySegment(prev, cur);

    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    const angle = Math.atan2(dy, dx);

    this.pointerState.set(key, {
      ...prev,
      x: cur.x,
      y: cur.y,
      vx: dx,
      vy: dy,
      angle,
      started: true,
    });
  }

  endStroke(id) {
    const key = String(id);
    this.pointerState.delete(key);
    this._activeIds.delete(key);
  }

  updatePointers(pointers = []) {
    const list = Array.isArray(pointers) ? pointers : [];
    const active = new Set();

    for (const p of list) {
      if (!p || !Number.isFinite(Number(p.x)) || !Number.isFinite(Number(p.y))) continue;
      const id = String(p.id ?? `p${active.size}`);
      active.add(id);
      this._activeIds.add(id);
      this.strokeTo(id, Number(p.x), Number(p.y), p);
    }

    for (const id of Array.from(this.pointerState.keys())) {
      if (!active.has(id)) this.endStroke(id);
    }
  }

  // Convenience bridge for mouse-driven sketches.
  updateMouse(pressed = mouseIsPressed, x = mouseX, y = mouseY) {
    if (pressed) this.updatePointers([{ id: "mouse", x, y }]);
    else this.updatePointers([]);
  }

  _drawInkySegment(prev, cur) {
    const p = this.params;
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    const speed = Math.hypot(dx, dy);
    const ax = dx - (prev.vx || 0);
    const ay = dy - (prev.vy || 0);
    const accel = Math.hypot(ax, ay);
    const angle = (prev.vx || prev.vy) ? this._angleDelta(Math.atan2(dy, dx), prev.angle || 0) : 0;

    const speed01 = this._clamp01(this._map(speed, 0, 40, 0, 1));
    const accel01 = this._clamp01(this._map(accel, 0, 30, 0, 1));
    let size =
      p.baseSize +
      p.sizeFromSpeed * (p.maxSize - p.baseSize) * Math.pow(speed01, 0.8) +
      p.sizeFromAccel * 12 * accel01;
    size *= this._lerp(1, p.taper, 1 - speed01);

    const steps = Math.max(2, Math.floor(speed / Math.max(1, p.stepPx || 2)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = this._lerp(prev.x, cur.x, t);
      const y = this._lerp(prev.y, cur.y, t);

      for (let b = 0; b < p.bristleCount; b++) {
        const angleNoise = noise(this._noiseT + b * 13.7) * TWO_PI;
        const jitter = (random() - 0.5) * p.wobble * size;
        const offR =
          (randomGaussian() * 0.4 + (noise(x * p.noiseScale, y * p.noiseScale) - 0.5) * p.grain) *
          p.bristleSpread *
          size;
        const ox = Math.cos(angleNoise) * offR + jitter;
        const oy = Math.sin(angleNoise) * offR + jitter;
        const w = Math.max(0.35, size * (0.55 + random(-0.1, 0.1)) / (1 + b * 0.12));

        this.layer.stroke(this._colorWithAlpha(this.foregroundColor, p.ink));
        this.layer.strokeWeight(w);
        this.layer.point(x + ox, y + oy);

        for (let e = 0; e < p.bleedEchoes; e++) {
          this.layer.stroke(this._colorWithAlpha(this.foregroundColor, p.dragAlpha));
          this.layer.strokeWeight(Math.max(0.25, w * 0.5));
          this.layer.point(x + ox + random(-w * 0.8, w * 0.8), y + oy + random(-w * 0.8, w * 0.8));
        }
      }
      this._noiseT += 0.01;
    }

    const dyn = speed01 * (0.6 + 0.4 * accel01) * (1 + p.spatterCurveBoost * this._clamp01(angle / Math.PI));
    if (random() < p.spatterChance * dyn) {
      this._inkySplatter(cur.x, cur.y, dx, dy, dyn);
    }
  }

  _inkySplatter(x, y, dx, dy, dynFactor) {
    const p = this.params;
    const n = Math.floor(random(p.spatterBurst[0], p.spatterBurst[1] + 1) * (0.6 + dynFactor));
    const ang = Math.atan2(dy, dx);
    for (let i = 0; i < n; i++) {
      const throwAngle = ang + random(-Math.PI / 2, Math.PI / 2);
      const mag = random(4, p.spatterThrow * (0.3 + 0.7 * dynFactor));
      const px = x + Math.cos(throwAngle) * mag;
      const py = y + Math.sin(throwAngle) * mag;
      const r = random(p.spatterSize[0], p.spatterSize[1]) * (0.7 + dynFactor);

      this.layer.noStroke();
      this.layer.fill(this._colorWithAlpha(this.foregroundColor, random(160, 255)));
      this.layer.circle(px + random(-2, 2), py + random(-2, 2), r);

      if (random() < 0.25) {
        const back = random(6, 24);
        this.layer.stroke(this._colorWithAlpha(this.foregroundColor, random(120, 220)));
        this.layer.strokeWeight(random(0.6, 1.6));
        this.layer.line(px - Math.cos(throwAngle) * back, py - Math.sin(throwAngle) * back, px, py);
      }
    }
  }

  _drawFlowySegment(prev, cur) {
    const p = this.params;
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    const moved = Math.hypot(dx, dy);
    if (moved < p.moveEps) return;

    const ang = Math.atan2(dy, dx);
    const turn = this._angleDelta(ang, prev.angle || ang);
    const turn01 = this._clamp01(turn / Math.PI);
    const speed01 = this._clamp01(moved / p.speedMax);
    const steps = Math.max(1, Math.floor(moved / p.stepPx));

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = this._lerp(prev.x, cur.x, t);
      const y = this._lerp(prev.y, cur.y, t);

      const sizeMul = this._clamp(
        ((1.15 - 0.45 * speed01) + 0.25 * turn01) * p.brushScale,
        0.55 * p.brushScale,
        1.35 * p.brushScale
      );
      const opacityMul = this._clamp((0.92 - 0.55 * speed01) + 0.2 * (1 - turn01), 0.18, 0.95);
      const jitter = (0.4 + 2.6 * turn01) * (0.6 + 0.6 * speed01);
      const rotJitter = (0.06 + 0.22 * turn01) * (0.4 + 0.8 * speed01);
      const stretch = 1 + 0.55 * speed01;

      this._stampBrushAniso(x + random(-jitter, jitter), y + random(-jitter, jitter), ang, sizeMul, opacityMul, stretch, rotJitter);
      this._drawFeathers(x, y, ang, sizeMul, opacityMul, Math.floor(4 + 10 * turn01), turn01);
      this._scatterGrain(x, y, sizeMul, opacityMul, 10 + Math.floor(22 * speed01) + Math.floor(10 * turn01));
    }
  }

  _stampBrushAniso(x, y, ang, sizeMul, opacityMul, stretch, rotJitter) {
    if (!this._brushStamp) return;
    this.layer.push();
    this.layer.translate(x, y);
    this.layer.rotate(ang + random(-rotJitter, rotJitter));
    this.layer.tint(255, 255 * opacityMul);
    this.layer.imageMode(CENTER);
    const base = this._brushStamp.width * sizeMul * random(0.85, 1.08);
    const w = base * stretch;
    const h = base * (2 - stretch);
    this.layer.image(this._brushStamp, 0, 0, w, h);
    this.layer.noTint();
    this.layer.pop();
  }

  _drawFeathers(x, y, ang, sizeMul, opacityMul, count, turn01) {
    const lenBase = (14 + 10 * turn01) * sizeMul;
    const px = Math.cos(ang + Math.PI / 2);
    const py = Math.sin(ang + Math.PI / 2);

    this.layer.push();
    this.layer.stroke(this._colorWithAlpha(this.foregroundColor, 255 * opacityMul * (0.32 + 0.28 * turn01)));
    this.layer.strokeWeight(1);

    for (let i = 0; i < count; i++) {
      const off = random(-12, 12) * sizeMul * (0.7 + 0.9 * turn01);
      const hx = x + px * off;
      const hy = y + py * off;
      const l = lenBase * random(0.25, 1.0);
      this.layer.line(hx, hy, hx - Math.cos(ang) * l * random(0.8, 1.15), hy - Math.sin(ang) * l * random(0.8, 1.15));
    }
    this.layer.pop();
  }

  _scatterGrain(x, y, sizeMul, opacityMul, amount) {
    this.layer.push();
    this.layer.stroke(this._colorWithAlpha(this.foregroundColor, 255 * opacityMul * 0.28));
    this.layer.strokeWeight(1);
    for (let i = 0; i < amount; i++) {
      const r = random(2, 18) * sizeMul;
      const a = random(TWO_PI);
      this.layer.point(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    this.layer.pop();
  }

  _makeBrushTexture(sz) {
    const g = createGraphics(sz, sz);
    if (typeof g.pixelDensity === "function") g.pixelDensity(1);
    g.clear();
    g.loadPixels();
    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {
        const cx = x - sz * 0.5;
        const cy = y - sz * 0.5;
        const rr = Math.sqrt(cx * cx + cy * cy) / (sz * 0.5);
        let a = 1 - this._smoothEdge(0.15, 1.0, rr);
        a *= this._clamp01(this._map(noise(x * 0.08, y * 0.08), 0.25, 0.85, 0, 1));
        a *= this._clamp01(this._map(noise(x * 0.18 + 100, y * 0.18 + 100), 0.15, 0.95, 0.6, 1.05));
        if (random() < 0.06) a *= random(0.1, 0.7);

        const idx = 4 * (y * sz + x);
        g.pixels[idx + 0] = 255;
        g.pixels[idx + 1] = 255;
        g.pixels[idx + 2] = 255;
        g.pixels[idx + 3] = Math.floor(255 * this._clamp01(a));
      }
    }
    g.updatePixels();
    return g;
  }

  _buildPresets() {
    return {
      flowy: {
        moveEps: 0.3,
        stepPx: 2,
        speedMax: 45,
        brushScale: 0.85,
      },
      inky: {
        baseSize: 8,
        maxSize: 44,
        taper: 0.65,
        ink: 200,
        dragAlpha: 65,
        wobble: 0.8,
        bristleCount: 10,
        bristleSpread: 0.55,
        bleedEchoes: 2,
        noiseScale: 0.008,
        spatterChance: 0.05,
        spatterBurst: [2, 8],
        spatterSize: [1, 7],
        spatterThrow: 80,
        spatterCurveBoost: 1.6,
        sizeFromSpeed: 0.9,
        sizeFromAccel: 0.3,
        grain: 0.6,
        stepPx: 2,
      },
      marker: {
        moveEps: 0.15,
        stepPx: 1.5,
        speedMax: 60,
        brushScale: 0.55,
      },
      wash: {
        moveEps: 0.25,
        stepPx: 3,
        speedMax: 35,
        brushScale: 1.1,
      },
    };
  }

  _mergeParams(base, patch) {
    return Object.assign({}, base || {}, patch || {});
  }

  _map(v, inMin, inMax, outMin, outMax) {
    if (inMax === inMin) return outMin;
    const t = (v - inMin) / (inMax - inMin);
    return outMin + (outMax - outMin) * t;
  }

  _lerp(a, b, t) {
    return a + (b - a) * t;
  }

  _clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  _clamp01(v) {
    return this._clamp(v, 0, 1);
  }

  _angleDelta(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return Math.abs(d);
  }

  _smoothEdge(edge0, edge1, value) {
    const t = this._clamp01((value - edge0) / (edge1 - edge0));
    return t * t * (3 - 2 * t);
  }

  _colorWithAlpha(value, alpha = 255) {
    const c = color(value);
    return color(red(c), green(c), blue(c), alpha);
  }
}
