/*
Nice debug checker pattern

  // --- draw content into surface1 ---
  const t = millis() * 0.001;
  surface1.background(20);
  surface1.noStroke();
  // checker
  const cell = 64;
  for (let y = 0; y < surface1.height; y += cell) {
    for (let x = 0; x < surface1.width; x += cell) {
      const on = (((x / cell) | 0) + ((y / cell) | 0)) % 2 === 0;
      surface1.fill(on ? 240 : 60);
      surface1.rect(x, y, cell, cell);
    }
  }
  // moving bars
  const bx = (Math.sin(t) * 0.5 + 0.5) * (surface1.width - 40);
  surface1.fill(255);
  surface1.rect(bx, 0, 40, surface1.height);
  const by = (Math.cos(t * 0.7) * 0.5 + 0.5) * (surface1.height - 40);
  surface1.rect(0, by, surface1.width, 40);
  // title
  if (myFont) surface1.textFont(myFont);
  surface1.fill(0);
  surface1.textAlign(CENTER, TOP);
  surface1.textSize(28);
  surface1.text("Surface: Front (1024×768)", surface1.width / 2, 10);


*/

// =============================
// mapping.js (include BEFORE sketch.js)
// =============================

class ProjectionMapper {
  constructor(p5ctxOrOptions, options = {}) {
    
    // p5 context (optional in global mode, but helps in instance mode)
    const hasP5Methods =
      p5ctxOrOptions &&
      typeof p5ctxOrOptions === "object" &&
      typeof p5ctxOrOptions.createGraphics === "function";
    this.p = hasP5Methods ? p5ctxOrOptions : null;
    const opts = hasP5Methods ? options : (p5ctxOrOptions || {});

    this.surfaces = []; // { name, w, h, pg, corners:[p5.Vector*4], hoverIndex, dragging, storageKey }
    this.shader = null; // homography fragment shader (per-pixel inverse mapping)
    this.debugBypass = false; // draw pg directly
    this.debugPassthrough = false; // shader on, but no homography
    this.pickRadius = 60;
    this.calibrate = true; // draw & interact with corner handles
    this.followDebugOverlay = false;
    this._onDebugOverlayChange = null;
    this.bottomLeftToggleEnabled = true;
    this.bottomLeftToggleHoldMs = 1500;
    this.bottomLeftToggleSize = 100;
    this._bottomLeftHoldStartMs = 0;
    this._bottomLeftHoldFired = false;
    this.autoSave = true;
    this.autoSaveDelayMs = 0;
    this._autoSaveTimer = null;
    this._overlayLabelLayer = null;
    this._dragSurf = -1; // index of surface being dragged
    this._dragCorner = -1; // which corner in that surface
    this.defaultMargin = 60;

    // optional overlay font for labels (set via setFont)
    this._overlayFont = null;
    print("Mapper: Option+S save, Option+C calibrate, Option+R reset");

    if (Number.isFinite(opts.pixelDensity)) {
      if (this.p && typeof this.p.pixelDensity === "function") {
        this.p.pixelDensity(opts.pixelDensity);
      } else if (typeof pixelDensity === "function") {
        pixelDensity(opts.pixelDensity);
      }
    }
  }

  setFont(font) {
    this._overlayFont = font;
    this.surfaces.forEach((s) => {
      if (s?.pg && typeof s.pg.textFont === "function") {
        s.pg.textFont(font);
      }
    });
  }
  setCalibrate(on) {
    this.calibrate = !!on;
  }
  setShowCorners(on) {
    this.setCalibrate(on);
  }
  toggleCalibrate() {
    this.calibrate = !this.calibrate;
  }
  toggleShowCorners() {
    this.toggleCalibrate();
  }
  isCalibrating() {
    return !!this.calibrate;
  }
  isActive() {
    return this._dragSurf !== -1 && this._dragCorner !== -1;
  }
  screenToSurface(mx, my, { surface = null, padding = 0 } = {}) {
    const touchX = Number(mx);
    const touchY = Number(my);
    if (!Number.isFinite(touchX) || !Number.isFinite(touchY)) return null;

    const candidates =
      surface == null
        ? this.surfaces.map((s, index) => ({ s, index })).reverse()
        : this._resolveSurfaceRefs(surface);

    for (const entry of candidates) {
      const hit = this._screenToSurfaceOn(entry.s, entry.index, touchX, touchY, padding);
      if (hit) return hit;
    }
    return null;
  }
  followDebugOverlayVisibility(on = true) {
    const next = !!on;
    if (this.followDebugOverlay === next) return;
    this.followDebugOverlay = next;

    if (this._onDebugOverlayChange) {
      window.removeEventListener("uiSlim:debugOverlayChange", this._onDebugOverlayChange);
      this._onDebugOverlayChange = null;
    }

    if (this.followDebugOverlay) {
      this._onDebugOverlayChange = (event) => {
        this.calibrate = !!event?.detail?.visible;
      };
      window.addEventListener("uiSlim:debugOverlayChange", this._onDebugOverlayChange);
      if (typeof uiIsDebugOverlayVisible === "function") {
        this.calibrate = !!uiIsDebugOverlayVisible();
      }
    }
  }
  setAutoSave(on = true, delayMs = this.autoSaveDelayMs) {
    this.autoSave = !!on;
    this.autoSaveDelayMs = Math.max(0, Number(delayMs) || 0);
  }
  setPickRadius(px) {
    this.pickRadius = px;
  }
  setDebug({
    bypass = this.debugBypass,
    passthrough = this.debugPassthrough,
  } = {}) {
    this.debugBypass = !!bypass;
    this.debugPassthrough = !!passthrough;
  }
  setBottomLeftToggle({
    enabled = this.bottomLeftToggleEnabled,
    holdMs = this.bottomLeftToggleHoldMs,
    size = this.bottomLeftToggleSize,
  } = {}) {
    this.bottomLeftToggleEnabled = !!enabled;
    this.bottomLeftToggleHoldMs = Math.max(0, Number(holdMs) || 0);
    this.bottomLeftToggleSize = Math.max(16, Number(size) || 100);
  }

  // Add a new mapped surface; returns its p5.Graphics so the user can draw on it.
  // name: unique string; w/h: texture resolution in pixels (rectangles supported)
  add(w, h, name = `surface_${this.surfaces.length + 1}`) {
    const pg = createGraphics(w, h);
    pg.pixelDensity(1);
    if (this._overlayFont && typeof pg.textFont === "function") {
      pg.textFont(this._overlayFont);
    }

    const W = width,
      H = height;
    const m = this.defaultMargin;
    // default corners: inset rectangle
    const corners = [
      createVector(m, m),
      createVector(W - m, m),
      createVector(W - m, H - m),
      createVector(m, H - m),
    ];

    const storageKey = `pm_surface_${name}`;

    this.surfaces.push({
      name,
      w,
      h,
      pg,
      corners,
      hoverIndex: -1,
      dragging: -1,
      storageKey,
    });
    return pg; // So the caller can draw: pg = mapper.add(...)
  }

  removeLastSurface({ clearStorage = true } = {}) {
    if (!this.surfaces.length) return null;
    const removed = this.surfaces.pop();
    if (clearStorage && removed?.storageKey) {
      try {
        localStorage.removeItem(removed.storageKey);
      } catch {}
    }
    return removed || null;
  }

  saveAll() {
    this.surfaces.forEach((s) => {
      try {
        const payload = s.corners.map((v) => ({ x: v.x, y: v.y }));
        localStorage.setItem(
          s.storageKey,
          JSON.stringify(payload)
        );
      } catch (e) {}
    });
  }

  exportConfig() {
    return {
      type: "ProjectionMapper",
      version: 1,
      surfaces: this.surfaces.map((s) => ({
        name: s.name,
        corners: s.corners.map((v) => ({ x: v.x, y: v.y })),
      })),
    };
  }

  exportData() {
    return this.exportConfig();
  }

  downloadExport(filename = "projection_mapper_config.json") {
    const payload = this.exportConfig();
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = String(filename || "projection_mapper_config.json");
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
    return true;
  }

  importConfig(config, { replace = true } = {}) {
    if (!config || typeof config !== "object") {
      throw new Error("ProjectionMapper importConfig requires an object");
    }
    const surfaces = Array.isArray(config.surfaces) ? config.surfaces : [];
    const byName = new Map(surfaces.map((s) => [s?.name, s]));

    this.surfaces.forEach((s) => {
      const incoming = byName.get(s.name);
      if (!incoming || !Array.isArray(incoming.corners)) {
        if (replace) return;
        return;
      }
      if (incoming.corners.length !== 4) return;
      s.corners = incoming.corners.map((p) => createVector(p.x, p.y));
    });
  }

  saveToStorage(key = "pm_config") {
    localStorage.setItem(String(key), JSON.stringify(this.exportConfig()));
    return true;
  }

  loadFromStorage(key = "pm_config", opts = {}) {
    const raw = localStorage.getItem(String(key));
    if (!raw) return false;
    const cfg = JSON.parse(raw);
    this.importConfig(cfg, opts);
    return true;
  }

  async loadFromURL(url, opts = {}) {
    if (!url) throw new Error("ProjectionMapper loadFromURL(url): url is required");
    const cfg = await fetch(String(url)).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status} while loading ${url}`);
      return r.json();
    });
    this.importConfig(cfg, opts);
    return true;
  }

  savetostorage(key = "pm_config") { return this.saveToStorage(key); }
  loadfromstorage(key = "pm_config", opts = {}) { return this.loadFromStorage(key, opts); }
  loadfromurl(url, opts = {}) { return this.loadFromURL(url, opts); }
  exportdata() { return this.exportData(); }
  downloadexport(filename = "projection_mapper_config.json") { return this.downloadExport(filename); }

  loadAll() {
    this.surfaces.forEach((s) => {
      try {
        const raw = localStorage.getItem(s.storageKey);
        if (!raw) return;
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length === 4) {
          s.corners = arr.map((p) => createVector(p.x, p.y));
        }
      } catch (e) {}
    });
  }

  resetAll() {
    const W = width,
      H = height;
    const m = this.defaultMargin;
    this.surfaces.forEach((s) => {
      s.corners = [
        createVector(m, m),
        createVector(W - m, m),
        createVector(W - m, H - m),
        createVector(m, H - m),
      ];
    });
    this._saveNow();
  }

  // Call in draw(): renders all surfaces with inverse-homography per-pixel mapping.
  render() {
    this._syncUiSlimInput();
    this._handleBottomLeftToggle();

    if (this.debugBypass) {
      // Draw each texture directly tiled; helpful sanity check
      const W2 = width * 0.5,
        H2 = height * 0.5;
      let y = -H2,
        x = -W2;
      noStroke();
      this.surfaces.forEach((s, i) => {
        const w = width / Math.ceil(Math.sqrt(this.surfaces.length));
        const h = (w * s.h) / s.w;
        image(s.pg, x, y, w, h);
        x += w;
        if (x + w > W2) {
          x = -W2;
          y += h;
        }
      });
      if (this.calibrate) this._drawOverlays();
      return;
    }

    this._ensureShader();

    // For each surface: compute H (unit square -> screen), invert, send COLUMN-MAJOR
    shader(this.shader);
    this.surfaces.forEach((s) => {
      const dpr = this._currentPixelDensity();
 
      const scaledCorners = s.corners.map((c) => createVector(c.x * dpr, c.y * dpr));
      const H = this._computeHomographyDLT(scaledCorners);
      const Hinv = this._invert3x3(H);
      if (!Hinv) return; // skip degenerate
      const Hc = [
        Hinv[0],
        Hinv[3],
        Hinv[6], // column-major
        Hinv[1],
        Hinv[4],
        Hinv[7],
        Hinv[2],
        Hinv[5],
        Hinv[8],
      ];
      this.shader.setUniform("tex", s.pg);
      this.shader.setUniform("uResolution", [width * dpr, height * dpr]);
      this.shader.setUniform("uHinv", Hc);
      this.shader.setUniform("uPassthrough", this.debugPassthrough);
      this._drawFullScreenStrip();
    });
    resetShader();

    if (this.calibrate) this._drawOverlays();
  }

  // ---- Event forwarding (call these from sketch.js mouse handlers) ----
  mousePressed(mx = mouseX, my = mouseY) {
    if (!this.calibrate) return;
    const pick = this._pickCorner(mx, my);
    if (pick) {
      this._dragSurf = pick.si;
      this._dragCorner = pick.ci;
      this.surfaces[pick.si].dragging = pick.ci;
     /* console.log(
        `Drag start ${this.surfaces[pick.si].name} corner #${pick.ci}`
      );*/
    }
  }

  mouseDragged(mx = mouseX, my = mouseY) {
    if (this.calibrate && this._dragSurf !== -1) {
      const s = this.surfaces[this._dragSurf];
      s.corners[this._dragCorner].set(mx, my);
    }
  }

  mouseReleased() {
    if (this._dragSurf !== -1) {
      this.surfaces[this._dragSurf].dragging = -1;
      this.saveAll();
    }
    this._dragSurf = -1;
    this._dragCorner = -1;
  }

  // -------------------- Internals --------------------
  _ensureShader() {
    if (this.shader) return;
    const vertSrc = `
      precision mediump float;
      attribute vec3 aPosition;
      uniform mat4 uProjectionMatrix;
      uniform mat4 uModelViewMatrix;
      void main(){
        gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aPosition, 1.0);
      }
    `;
    const fragSrc = `
      precision mediump float;
      uniform sampler2D tex;
      uniform mat3 uHinv;         // maps screen (x,y,1) -> (u,v,w)
      uniform vec2 uResolution;   // canvas size in pixels
      uniform bool uPassthrough;  // show texture without mapping
      void main(){
        if (uPassthrough) {
          vec2 uv = gl_FragCoord.xy / uResolution;
          uv.y = 1.0 - uv.y; // flip Y to match top-left origin
          gl_FragColor = texture2D(tex, uv);
          return;
        }
        vec2 scr = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);
        vec3 q = uHinv * vec3(scr, 1.0);
        float w = (q.z != 0.0) ? q.z : 1e-6;
        vec2 uv = q.xy / w;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
        gl_FragColor = texture2D(tex, uv);
      }
    `;
    this.shader = createShader(vertSrc, fragSrc);
  }

  _drawFullScreenStrip() {
    noStroke();
    beginShape(TRIANGLE_STRIP);
    vertex(-width / 2, -height / 2, 0);
    vertex(width / 2, -height / 2, 0);
    vertex(-width / 2, height / 2, 0);
    vertex(width / 2, height / 2, 0);
    endShape();
  }

  _currentPixelDensity() {
    const gl = drawingContext;
    if (
      gl &&
      Number.isFinite(gl.drawingBufferWidth) &&
      Number.isFinite(width) &&
      width > 0
    ) {
      const dpr = gl.drawingBufferWidth / width;
      if (Number.isFinite(dpr) && dpr > 0) return dpr;
    }
    if (typeof pixelDensity === "function") {
      const dpr = pixelDensity();
      if (Number.isFinite(dpr) && dpr > 0) return dpr;
    }
    return 1;
  }

  _drawOverlays() {
    // Update hover indices
    const px = typeof uiMX !== "undefined" ? uiMX : mouseX;
    const py = typeof uiMY !== "undefined" ? uiMY : mouseY;
    const pick = this._pickCorner(px, py);
    this.surfaces.forEach((s, si) => {
      s.hoverIndex = pick && pick.si === si ? pick.ci : -1;
    });

    // Draw overlays on top (depth off)
    const gl = drawingContext;
    if (gl && gl.disable) gl.disable(gl.DEPTH_TEST);

    push();
    const W2 = width * 0.5,
      H2 = height * 0.5;
    const labelLayer = this._overlayFont ? this._getOverlayLabelLayer() : null;
    if (labelLayer) {
      labelLayer.clear();
      labelLayer.push();
      labelLayer.fill(255);
      labelLayer.noStroke();
      labelLayer.textFont(this._overlayFont);
      labelLayer.textSize(13);
      labelLayer.textAlign(LEFT, BOTTOM);
    }
    this.surfaces.forEach((s) => {
      // outline
      stroke(0, 255, 255);
      strokeWeight(2);
      noFill();
      beginShape();
      for (let i = 0; i < 4; i++)
        vertex(s.corners[i].x - W2, s.corners[i].y - H2, 0);
      endShape(CLOSE);

      // handles
      for (let i = 0; i < 4; i++) {
        const sx = s.corners[i].x - W2;
        const sy = s.corners[i].y - H2;
        const isActive = i === s.hoverIndex || i === s.dragging;
        noStroke();
        fill(isActive ? color(0, 255, 255, 200) : color(0, 255, 255, 90));
        circle(
          sx,
          sy,
          isActive ? this.pickRadius * 0.9 : this.pickRadius * 0.6
        );
        fill(isActive ? 255 : 210);
        circle(sx, sy, 16);
        if (labelLayer) {
          labelLayer.text(`${s.name} #${i}`, s.corners[i].x + 14, s.corners[i].y - 8);
        }
      }
    });
    pop();

    if (labelLayer) {
      labelLayer.pop();
      push();
      imageMode(CORNER);
      image(labelLayer, -W2, -H2, width, height);
      pop();
    }

    if (gl && gl.enable) gl.enable(gl.DEPTH_TEST);
  }

  _getOverlayLabelLayer() {
    if (
      !this._overlayLabelLayer ||
      this._overlayLabelLayer.width !== width ||
      this._overlayLabelLayer.height !== height
    ) {
      this._overlayLabelLayer = createGraphics(width, height);
      this._overlayLabelLayer.pixelDensity(1);
    }
    return this._overlayLabelLayer;
  }

  _resolveSurfaceRefs(surface) {
    if (Number.isInteger(surface)) {
      const s = this.surfaces[surface];
      return s ? [{ s, index: surface }] : [];
    }
    if (typeof surface === "string") {
      const index = this.surfaces.findIndex((s) => s.name === surface);
      return index >= 0 ? [{ s: this.surfaces[index], index }] : [];
    }
    const index = this.surfaces.indexOf(surface);
    return index >= 0 ? [{ s: this.surfaces[index], index }] : [];
  }

  _screenToSurfaceOn(surface, surfaceIndex, mx, my, padding = 0) {
    if (!surface || !Array.isArray(surface.corners) || surface.corners.length !== 4) {
      return null;
    }
    const H = this._computeHomographyDLT(surface.corners);
    const Hinv = this._invert3x3(H);
    if (!Hinv) return null;

    const qx = Hinv[0] * mx + Hinv[1] * my + Hinv[2];
    const qy = Hinv[3] * mx + Hinv[4] * my + Hinv[5];
    const qz = Hinv[6] * mx + Hinv[7] * my + Hinv[8];
    if (!Number.isFinite(qz) || Math.abs(qz) < 1e-9) return null;

    const u = qx / qz;
    const v = qy / qz;
    if (u < -padding || u > 1 + padding || v < -padding || v > 1 + padding) {
      return null;
    }

    return {
      surface,
      surfaceIndex,
      name: surface.name,
      u,
      v,
      x: u * surface.w,
      y: v * surface.h,
    };
  }

  _pickCorner(mx, my) {
    let best = null;
    let bestD2 = Infinity;
    this.surfaces.forEach((s, si) => {
      for (let ci = 0; ci < 4; ci++) {
        const dx = mx - s.corners[ci].x;
        const dy = my - s.corners[ci].y;
        const d2 = dx * dx + dy * dy;
        if (d2 < this.pickRadius * this.pickRadius && d2 < bestD2) {
          bestD2 = d2;
          best = { si, ci };
        }
      }
    });
  //  if (best)
  //    console.log(`Hover ${this.surfaces[best.si].name} corner #${best.ci}`);
    return best;
  }

  // ---- Homography (DLT) and inverse ----
  _computeHomographyDLT(corners) {
    // corners: [TL, TR, BR, BL] in screen space
    const tl = corners[0],
      tr = corners[1],
      br = corners[2],
      bl = corners[3];
    const pts = [
      { u: 0, v: 0, x: tl.x, y: tl.y },
      { u: 1, v: 0, x: tr.x, y: tr.y },
      { u: 1, v: 1, x: br.x, y: br.y },
      { u: 0, v: 1, x: bl.x, y: bl.y },
    ];
    const A = new Array(8).fill(0).map(() => new Array(8).fill(0));
    const b = new Array(8).fill(0);
    for (let i = 0; i < 4; i++) {
      const { u, v, x, y } = pts[i];
      // x row
      A[2 * i][0] = u;
      A[2 * i][1] = v;
      A[2 * i][2] = 1;
      A[2 * i][3] = 0;
      A[2 * i][4] = 0;
      A[2 * i][5] = 0;
      A[2 * i][6] = -u * x;
      A[2 * i][7] = -v * x;
      b[2 * i] = x;
      // y row
      A[2 * i + 1][0] = 0;
      A[2 * i + 1][1] = 0;
      A[2 * i + 1][2] = 0;
      A[2 * i + 1][3] = u;
      A[2 * i + 1][4] = v;
      A[2 * i + 1][5] = 1;
      A[2 * i + 1][6] = -u * y;
      A[2 * i + 1][7] = -v * y;
      b[2 * i + 1] = y;
    }
    const h = this._solve8(A, b);
    if (!h) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  }

  _solve8(A, b) {
    const M = A.map((r) => r.slice());
    const y = b.slice();
    const n = 8;
    for (let col = 0; col < n; col++) {
      let pivot = col,
        maxAbs = Math.abs(M[col][col]);
      for (let r = col + 1; r < n; r++) {
        const v = Math.abs(M[r][col]);
        if (v > maxAbs) {
          maxAbs = v;
          pivot = r;
        }
      }
      if (maxAbs < 1e-9) return null;
      if (pivot !== col) {
        [M[col], M[pivot]] = [M[pivot], M[col]];
        const ty = y[col];
        y[col] = y[pivot];
        y[pivot] = ty;
      }
      const div = M[col][col];
      for (let c = col; c < n; c++) M[col][c] /= div;
      y[col] /= div;
      for (let r = col + 1; r < n; r++) {
        const f = M[r][col];
        if (f === 0) continue;
        for (let c = col; c < n; c++) M[r][c] -= f * M[col][c];
        y[r] -= f * y[col];
      }
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      let s = y[i];
      for (let c = i + 1; c < n; c++) s -= M[i][c] * x[c];
      x[i] = s;
    }
    for (let i = 0; i < n; i++) if (!Number.isFinite(x[i])) return null;
    return x;
  }

  _invert3x3(H) {
    const a = H[0],
      b = H[1],
      c = H[2],
      d = H[3],
      e = H[4],
      f = H[5],
      g = H[6],
      h = H[7],
      i = H[8];
    const A = e * i - f * h;
    const B = -(d * i - f * g);
    const C = d * h - e * g;
    const D = -(b * i - c * h);
    const E = a * i - c * g;
    const F = -(a * h - b * g);
    const G = b * f - c * e;
    const Hc = -(a * f - c * d);
    const I = a * e - b * d;
    const det = a * A + b * B + c * C;
    if (Math.abs(det) < 1e-9) return null;
    const invDet = 1.0 / det;
    return [
      A * invDet,
      D * invDet,
      G * invDet,
      B * invDet,
      E * invDet,
      Hc * invDet,
      C * invDet,
      F * invDet,
      I * invDet,
    ];
  }

  _queueAutoSave() {
    if (!this.autoSave) return;
    if (this.autoSaveDelayMs <= 0) {
      this._persistAutoSave();
      return;
    }
    if (this._autoSaveTimer) clearTimeout(this._autoSaveTimer);
    this._autoSaveTimer = setTimeout(() => {
      this._autoSaveTimer = null;
      this._persistAutoSave();
    }, this.autoSaveDelayMs);
  }

  _saveNow() {
    if (this._autoSaveTimer) {
      clearTimeout(this._autoSaveTimer);
      this._autoSaveTimer = null;
    }
    if (!this.autoSave) return;
    this._persistAutoSave();
  }

  _persistAutoSave() {
    this.saveAll();
  }

  _handleBottomLeftToggle() {
    if (!this.bottomLeftToggleEnabled) return;
    const pointer = this._getActivePointer();
    if (!pointer) {
      this._bottomLeftHoldStartMs = 0;
      this._bottomLeftHoldFired = false;
      return;
    }

    if (!this._isInBottomLeftToggleZone(pointer.x, pointer.y)) {
      this._bottomLeftHoldStartMs = 0;
      this._bottomLeftHoldFired = false;
      return;
    }

    const now = (typeof millis === "function") ? millis() : Date.now();
    if (!this._bottomLeftHoldStartMs) {
      this._bottomLeftHoldStartMs = now;
      this._bottomLeftHoldFired = false;
    }

    if (
      !this._bottomLeftHoldFired &&
      now - this._bottomLeftHoldStartMs >= this.bottomLeftToggleHoldMs
    ) {
      this.calibrate = !this.calibrate;
      this._bottomLeftHoldFired = true;
    }
  }

  _getActivePointer() {
    if (Array.isArray(globalThis.touches) && globalThis.touches.length > 0) {
      const t = globalThis.touches[0];
      return { x: Number(t.x), y: Number(t.y) };
    }
    if (typeof mouseIsPressed !== "undefined" && mouseIsPressed) {
      return { x: Number(mouseX), y: Number(mouseY) };
    }
    return null;
  }

  _isInBottomLeftToggleZone(x, y) {
    return (
      x >= width - this.bottomLeftToggleSize &&
      x <= width &&
      y >= height - this.bottomLeftToggleSize &&
      y <= height
    );
  }

  _syncUiSlimInput() {
    if (typeof uiMP === "undefined") return;

    const px = typeof uiMX !== "undefined" ? uiMX : mouseX;
    const py = typeof uiMY !== "undefined" ? uiMY : mouseY;
    const pxOld = typeof uiMXOld !== "undefined" ? uiMXOld : px;
    const pyOld = typeof uiMYOld !== "undefined" ? uiMYOld : py;
    const pressed = !!uiMP;
    const pressedOld = !!uiMPOld;
    const moved = px !== pxOld || py !== pyOld;

    if (pressed && !pressedOld) {
      this.mousePressed(px, py);
    } else if (pressed && moved) {
      this.mouseDragged(px, py);
    } else if (!pressed && pressedOld) {
      this.mouseReleased();
    }

    if (typeof uiKeyPressed !== "undefined" && typeof uiKeyPressedOld !== "undefined") {
      if (
        uiKeyPressed &&
        !uiKeyPressedOld &&
        typeof uiAltPressed !== "undefined" &&
        uiAltPressed
      ) {
        const mapperKey = (typeof uiKeyCode !== "undefined" && uiKeyCode) ? uiKeyCode : uiKey;
        if (typeof mapperKey !== "undefined") {
          this.keyPressed(mapperKey);
        }
      }
    }
  }

  keyPressed(key) {
    if (key === "c" || key === "C" || key === "KeyC") this.toggleCalibrate();
    if (key === "s" || key === "S" || key === "KeyS") this.saveAll();
    if (key === "l" || key === "L" || key === "KeyL") this.loadAll();
    if (key === "r" || key === "R" || key === "KeyR") this.resetAll();
    if (key === "d" || key === "D" || key === "KeyD")
      this.setDebug({ bypass: !this.debugBypass });
    if (key === "g" || key === "G" || key === "KeyG")
      this.setDebug({
        bypass: this.debugBypass,
        passthrough: !this.debugPassthrough,
      });
  }
}
