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
  hasNewResult() { return this._hasNew; resetNewFlag()}

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