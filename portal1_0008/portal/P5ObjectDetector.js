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
   * @param {'webgl'|'cpu'} [opts.backend='webgl']
   * @param {number} [opts.scoreThreshold=0.5]  // filter for draw/best helpers (detector may also support options)
   * @param {function(Array)} [opts.onDetections] // optional callback(detections)
   */
  constructor({
    model = 'cocossd',
    video,
    backend = 'webgl',
    scoreThreshold = 0.5,
    onDetections = null
  } = {}) {
    if (!video) throw new Error('P5ObjectDetector: video is required');
    this.modelInput = model;
    this.video = video.elt ? video.elt : video;
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

  /** @returns {Object|null} top detection by confidence (>= scoreThreshold if possible) */
  getBest() { return this.best; }

  /**
   * Optional on-canvas renderer (p5.js)
   * Draws bounding boxes and labels for detections meeting scoreThreshold.
   * @param {number} [xOffset=0] apply an x translation when drawing
   * @param {number} [yOffset=0] apply a y translation when drawing
   * @param {boolean} [showScore=true] whether to append the score in the label
   */
  drawDetections(xOffset = 0, yOffset = 0, showScore = true) {
    if (!this.detections || typeof rect !== 'function') return;
    push();
    noFill();
    stroke(0);
    strokeWeight(2);
    for (const d of this.detections) {
      const conf = d.confidence ?? d.score ?? 0;
      if (conf < this.scoreThreshold) continue;

      // ml5 coco-ssd returns: { label, confidence, x, y, width, height }
      const x = (d.x ?? d.left ?? 0) + xOffset;
      const y = (d.y ?? d.top ?? 0) + yOffset;
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
