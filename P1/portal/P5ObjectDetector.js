// P5 + ml5 Object Detector (p5.js v2 ready)
// Mirrors your ImageClassifier helpers:
//  - getBest(), getDetections(), hasResult(), hasNewResult(), resetNewFlag(), consumeNew()
//  - start()/stop(), optional onDetections callback, simple drawDetections()
// Tested with ml5@1
print("hep");
class P5ObjectDetector {
  /**
   * @param {Object} opts
   * @param {string} [opts.model='cocossd']     // 'cocossd' or a TFJS model URL ending with model.json
   * @param {p5.MediaElement|HTMLVideoElement} opts.video
   * @param {boolean} [opts.videoIsFlipped=false]
   * @param {'webgl'|'cpu'} [opts.backend='webgl']
   * @param {number} [opts.scoreThreshold=0.5]  // filter for draw/best helpers (detector may also support options)
   * @param {function(Array)} [opts.onDetections] // optional callback(detections)
   */
  constructor({
    model = 'cocossd',
    video,
    videoIsFlipped = false,
    backend = 'webgl',
    scoreThreshold = 0.5,
    onDetections = null
  } = {}) {
    if (!video) throw new Error('P5ObjectDetector: video is required');
    this.modelInput = model;
    this.videoP5 = video.elt ? video : null;
    this.video = video.elt ? video.elt : video;
    this.videoIsFlipped = !!videoIsFlipped;
    this.backend = backend;
    this.scoreThreshold = scoreThreshold;
    this.onDetections = onDetections;

    this.detector = null;
    this.detections = null;
    this.best = null;

    this.ready = false;
    this.running = false;

    // flags for your needs
    this._hasResult = false; // have we ever produced a result?
    this._hasNew = false;    // new result since your last check/reset?
    this._scaleToRect = null;
  }

  async init() {
    await this.ensureMl5();
    if (ml5?.setBackend) {
      try { await ml5.setBackend(this.backend); } catch (e) { console.warn(e); }
    }

    const modelRef = this.normalizeModel(this.modelInput);

    // Some versions of ml5 accept options at creation time (e.g., scoreThreshold for coco-ssd)
    // We'll pass a conservative options object and let the model ignore unknown keys.
    const options = { scoreThreshold: this.scoreThreshold };

    this.detector = await ml5.objectDetector(modelRef, options);
    this.ready = true;
    return this;
  }

  start() {
    if (!this.ready || !this.detector) throw new Error('Call init() before start()');
    if (this.running) return;
    if (typeof this.detector.detectStart !== 'function') {
      // Fallback for older ml5: emulate detectStart via requestAnimationFrame
      this.running = true;
      const loop = async () => {
        if (!this.running) return;
        this.detector.detect(this.video, (err, results) => {
          if (!this.running) return;
          if (err) { console.warn(err); return; }
          this.handleDetections(results);
        });
        this._raf = requestAnimationFrame(loop);
      };
      loop();
    } else {
      this.detector.detectStart(this.video, (results) => this.handleDetections(results));
      this.running = true;
    }
  }

  stop() {
    if (!this.detector || !this.running) return;
    if (typeof this.detector.detectStop === 'function') this.detector.detectStop();
    if (this._raf) cancelAnimationFrame(this._raf);
    this.running = false;
  }

  // —— helper API parity with your classifier ——
  /** @returns {boolean} whether we have *any* result yet (ever). */
  hasResult() { return this._hasResult; }

  /** @returns {boolean} whether there is a *new* result since your last reset/consume. */
  hasNewResult() { return this._hasNew; }

  /** clears the "new result" flag (does not clear stored detections) */
  resetNewFlag() { this._hasNew = false; }

  /** alias: clears the flag and returns the latest detections in one go */
  consumeNew() {
    const wasNew = this._hasNew;
    this._hasNew = false;
    return { wasNew, detections: this.detections, best: this.best };
  }

  /** @returns {Array|null} last detections array */
  getDetections() { return this.detections; }

  getDetectionsInRect(x, y, w, h) {
    return this._mapDetectionsToRect(this.detections || [], x, y, w, h);
  }

  getDetectionsScaled() {
    if (!this._scaleToRect) return this.detections || [];
    const r = this._scaleToRect;
    return this._mapDetectionsToCoverRect(this.detections || [], r.x, r.y, r.w, r.h);
  }

  /** @returns {Object|null} top detection by confidence (>= scoreThreshold if possible) */
  getBest() { return this.best; }

  scaleTo(w, h, x = 0, y = 0) {
    const vw = Math.max(1, this.video?.videoWidth || this.video?.width || width || 1);
    const vh = Math.max(1, this.video?.videoHeight || this.video?.height || height || 1);

    let W = Number.isFinite(Number(w)) ? Number(w) : null;
    let H = Number.isFinite(Number(h)) ? Number(h) : null;
    if (W != null && H == null) H = W * (vh / vw);
    if (H != null && W == null) W = H * (vw / vh);

    const rect = this._computeCoverRect(x, y, W, H);
    this._scaleToRect = rect;
    return rect;
  }

  clearScaleTo() {
    this._scaleToRect = null;
  }

  getScaleToRect() {
    return this._scaleToRect;
  }

  drawImage(...args) {
    if (typeof image !== "function") return;
    const drawSource = this.videoP5 || this.video;
    if (!drawSource) return;
    const vw = this.video?.videoWidth || this.video?.width || width;
    const vh = this.video?.videoHeight || this.video?.height || height;
    const rect = this._resolveRectArgs(args, vw, vh);

    if (rect.w == null && rect.h == null && this._scaleToRect) {
      let r = this._scaleToRect;
      if ((args?.length || 0) >= 2) {
        r = this._computeCoverRect(rect.x, rect.y, r.w, r.h);
        this._scaleToRect = r;
      }
      if (typeof drawingContext?.save === "function") {
        drawingContext.save();
        drawingContext.beginPath();
        drawingContext.rect(r.x, r.y, r.w, r.h);
        drawingContext.clip();
        image(drawSource, r.offsetX, r.offsetY, vw * r.scale, vh * r.scale);
        drawingContext.restore();
      } else {
        image(drawSource, r.offsetX, r.offsetY, vw * r.scale, vh * r.scale);
      }
      return;
    }

    image(drawSource, rect.x, rect.y, rect.w ?? vw, rect.h ?? vh);
  }

  /**
   * Optional on-canvas renderer (p5.js)
   * Draws bounding boxes and labels for detections meeting scoreThreshold.
   * @param {number} [xOffset=0] apply an x translation when drawing
   * @param {number} [yOffset=0] apply a y translation when drawing
   * @param {boolean} [showScore=true] whether to append the score in the label
   */
  drawDetections(...args) {
    if (!this.detections || typeof rect !== 'function') return;
    const parsed = this._resolveDrawArgs(args);
    const showScore = parsed.showScore;
    const items = parsed.mode === "scaled"
      ? this.getDetectionsScaled()
      : this.getDetectionsInRect(parsed.x, parsed.y, parsed.w, parsed.h);

    push();
    noFill();
    stroke(0);
    strokeWeight(2);
    for (const d of items) {
      const conf = d.confidence ?? d.score ?? 0;
      if (conf < this.scoreThreshold) continue;

      const x = d.x ?? d.left ?? 0;
      const y = d.y ?? d.top ?? 0;
      const w = d.width ?? d.w ?? (d.right && d.left ? d.right - d.left : 0);
      const h = d.height ?? d.h ?? (d.bottom && d.top ? d.bottom - d.top : 0);

      rect(x, y, w, h);

      const pct = Math.round((conf || 0) * 100);
      const label = showScore ? `${d.label} (${pct}%)` : `${d.label}`;
      // label background for readability
      push();
      noStroke();
      fill(0, 180);
      rect(x, y - 18, textWidth(label) + 8, 18);
      fill(255);
      textSize(14);
      text(label, x + 4, y - 5);
      pop();
    }
    pop();
  }

  _resolveDrawArgs(args) {
    const a = Array.isArray(args) ? args : [];
    const vw = this.video?.videoWidth || this.video?.width || width;
    const vh = this.video?.videoHeight || this.video?.height || height;

    // legacy: drawDetections(xOffset, yOffset, showScore)
    if (a.length <= 3 && typeof a[2] === "boolean") {
      const x = Number(a[0]) || 0;
      const y = Number(a[1]) || 0;
      if (a.length === 0 && this._scaleToRect) {
        return { mode: "scaled", showScore: true };
      }
      return { mode: "rect", x, y, w: vw, h: vh, showScore: a[2] };
    }

    const rect = this._resolveRectArgs(a, vw, vh);
    const showScore = typeof a[4] === "boolean" ? a[4] : true;
    if (rect.w == null && rect.h == null && this._scaleToRect) {
      return { mode: "scaled", showScore };
    }
    return { mode: "rect", x: rect.x, y: rect.y, w: rect.w ?? vw, h: rect.h ?? vh, showScore };
  }

  _mapDetectionsToRect(detections, x, y, w, h) {
    const vw = this.video?.videoWidth || this.video?.width || width;
    const vh = this.video?.videoHeight || this.video?.height || height;
    const sx = w / vw;
    const sy = h / vh;

    return (detections || []).map((d) => {
      const rawX = Number(d.x ?? d.left ?? 0);
      const rawY = Number(d.y ?? d.top ?? 0);
      const rawW = Number(d.width ?? d.w ?? ((d.right && d.left) ? d.right - d.left : 0));
      const rawH = Number(d.height ?? d.h ?? ((d.bottom && d.top) ? d.bottom - d.top : 0));
      const xFlipped = this.videoIsFlipped ? (vw - rawX - rawW) : rawX;

      return {
        ...d,
        x: x + xFlipped * sx,
        y: y + rawY * sy,
        width: rawW * sx,
        height: rawH * sy,
      };
    });
  }

  _mapDetectionsToCoverRect(detections, x, y, w, h) {
    const rect = this._computeCoverRect(x, y, w, h);
    const vw = this.video?.videoWidth || this.video?.width || width;

    return (detections || []).map((d) => {
      const rawX = Number(d.x ?? d.left ?? 0);
      const rawY = Number(d.y ?? d.top ?? 0);
      const rawW = Number(d.width ?? d.w ?? ((d.right && d.left) ? d.right - d.left : 0));
      const rawH = Number(d.height ?? d.h ?? ((d.bottom && d.top) ? d.bottom - d.top : 0));
      const xFlipped = this.videoIsFlipped ? (vw - rawX - rawW) : rawX;

      return {
        ...d,
        x: rect.offsetX + xFlipped * rect.scale,
        y: rect.offsetY + rawY * rect.scale,
        width: rawW * rect.scale,
        height: rawH * rect.scale,
      };
    });
  }

  _computeCoverRect(x, y, w, h) {
    const vw = Math.max(1, this.video?.videoWidth || this.video?.width || width || 1);
    const vh = Math.max(1, this.video?.videoHeight || this.video?.height || height || 1);
    const W = Math.max(1, Number(w) || vw);
    const H = Math.max(1, Number(h) || vh);
    const X = Number(x) || 0;
    const Y = Number(y) || 0;

    const scale = Math.max(W / vw, H / vh);
    const drawW = vw * scale;
    const drawH = vh * scale;
    const offsetX = X + (W - drawW) * 0.5;
    const offsetY = Y + (H - drawH) * 0.5;

    return { x: X, y: Y, w: W, h: H, scale, offsetX, offsetY };
  }

  _resolveRectArgs(args, defaultW, defaultH) {
    const a = Array.isArray(args) ? args : [];
    if (!a.length) return { x: 0, y: 0, w: null, h: null };
    const toSize = (v) => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    if (a.length === 1 && a[0] && typeof a[0] === "object") {
      const o = a[0];
      return {
        x: Number(o.x) || 0,
        y: Number(o.y) || 0,
        w: toSize(o.w),
        h: toSize(o.h),
      };
    }
    return {
      x: Number(a[0]) || 0,
      y: Number(a[1]) || 0,
      w: toSize(a[2]),
      h: toSize(a[3]),
    };
  }

  // —— private ——
  handleDetections(detections) {
    this.detections = Array.isArray(detections) ? detections : [];
    // pick highest-confidence detection above threshold if present
    this.best = this.detections
      .slice()
      .sort((a, b) => (b.confidence ?? b.score ?? 0) - (a.confidence ?? a.score ?? 0))[0] || null;

    const bestScore = this.best ? (this.best.confidence ?? this.best.score ?? 0) : 0;
    if (this.best && bestScore < this.scoreThreshold) {
      // keep best anyway, but callers can ignore if below threshold
    }

    this._hasResult = this.detections.length > 0;
    this._hasNew = true;
    if (this.onDetections) this.onDetections(this.detections);
  }

  normalizeModel(model) {
    // allow either a known keyword ('cocossd') or a direct TFJS URL
    if (/^https?:/i.test(model)) {
      return model.endsWith('model.json') ? model : model.replace(/\/?$/, '/') + 'model.json';
    }
    return model; // e.g., 'cocossd'
  }

  async ensureMl5() {
    // assumes you have loadScript(url) in scope (like in your original snippet)
    await loadScript('https://unpkg.com/ml5@0.12.2/dist/ml5.min.js');
  }
}
