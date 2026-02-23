// P5 + ml5 Image Classifier (p5.js v2 ready)
// Adds: getBestResult(), hasResult(), hasNewResult(), resetNewFlag()/consumeNew()

class P5ImageClassifier {
  /**
   * @param {Object} opts
   * @param {string} [opts.model='MobileNet']   // 'MobileNet' or TM URL (folder or model.json)
   * @param {p5.MediaElement|HTMLVideoElement} opts.video
   * @param {'webgl'|'cpu'} [opts.backend='webgl']
   * @param {number} [opts.topK=3]
   * @param {function(Array)} [opts.onResults]  // optional callback(results)
   */
  constructor({ model = 'MobileNet', video, backend = 'webgl', topK = 3, onResults = null } = {}) {
    if (!video) throw new Error('P5ImageClassifier: video is required');
    this.modelInput = model;
    this.videoP5 = video.elt ? video : null;
    this.video = video.elt ? video.elt : video;
    this.backend = backend;
    this.topK = topK;
    this.onResults = onResults;

    this.classifier = null;
    this.results = null;
    this.best = null;

    this.ready = false;
    this.running = false;

    // flags for your needs
    this._hasResult = false;     // have we ever produced a result?
    this._hasNew = false;        // new result since your last check/reset?
    this._scaleToRect = null;
  }

  async init() {
    await this.ensureMl5();
    if (window.ml5?.setBackend) {
      try { await window.ml5.setBackend(this.backend); } catch (e) { console.warn(e); }
    }
    const url = this.normalizeModel(this.modelInput);
    this.classifier = await window.ml5.imageClassifier(url);
    this.ready = true;
    return this;
  }

  start() {
    if (!this.ready || !this.classifier) throw new Error('Call init() before start()');
    if (this.running) return;
    this.classifier.classifyStart(this.video, (results) => this.handleResults(results));
    this.running = true;
  }

  stop() {
    if (!this.classifier || !this.running) return;
    if (typeof this.classifier.classifyStop === 'function') this.classifier.classifyStop();
    this.running = false;
  }

  // —— Your requested helpers ——
  /** @returns {boolean} whether we have *any* result yet (ever). */
  hasResult() { return this._hasResult; }

  /** @returns {boolean} whether there is a *new* result since your last reset/consume. */
  hasNewResult() { return this._hasNew; }

  /** clears the "new result" flag (does not clear the stored results) */
  resetNewFlag() { this._hasNew = false; }

  /** alias: clears the flag and returns the latest results in one go */
  consumeNew() {
    const wasNew = this._hasNew;
    this._hasNew = false;
    return { wasNew, results: this.results, best: this.best };
  }

  /** @returns {Array|null} last results array */
  getResults() { return this.results; }

  /** @returns {Object|null} top result (label/confidence) */
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


  // Optional on-canvas renderer
  drawResults(x = 16, y = 24, lineH = 20) {
    if (!this.results || typeof text !== 'function') return;
    push();
    textSize(16); fill(255); stroke(0);
    for (let i = 0; i < Math.min(this.topK, this.results.length); i++) {
      const r = this.results[i];
      const pct = Math.round(r.confidence * 100);
      text(`${r.label} (${pct}%)`, x, y + i * lineH);
    }
  
    pop();
  }

  // —— private ——
  handleResults(results) {
    this.results = results || [];
    this.best = this.results[0] || null;
    this._hasResult = this.results.length > 0;
    this._hasNew = true; // mark as fresh until you reset/consume
    if (this.onResults) this.onResults(this.results);
  }

  normalizeModel(model) {
    if (/^https?:/i.test(model)) {
      return model.endsWith('model.json') ? model : model.replace(/\/?$/, '/') + 'model.json';
    }
    return model;
  }

  async ensureMl5() {
   
    await loadScript('https://unpkg.com/ml5@1/dist/ml5.min.js');
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

}



/*let imageClassifier;
let imageResults;
let gotImageClassifierResults = false;
let gotImageClassifierNewResults = false;
let bestResult = "";
async function setupImageClassifier(model,video) {
  await loadScript("https://unpkg.com/ml5@1/dist/ml5.min.js");
  ml5.setBackend("webgl");
  imageClassifier = ml5.imageClassifier(imageModelURL + "model.json");

  // Start detecting objects in the video
  imageClassifier.classifyStart(video, gotImageResult);
  
}

// When we get a result
function gotImageResult(results) {
  // The results are in an array ordered by confidence.
  // console.log(results[0]);
  imageResults = results;
  gotImageClassifierResults = true;
  gotImageClassifierNewResults = true;
  bestResult = results[0];
}

function printResults(x,y)
{
 
    for (let i = 0; i < curResults.length; i++) {
      text(
        curResults[i].label + "(" + round(curResults[i].confidence * 100) + ")",
        60,
        500 + i * 20
      );
    } 
}
*/
