// Student-friendly KNN learner
// - Uses ml5 KNN when available
// - Falls back to a built-in JS KNN to avoid ml5 version/backend conflicts

class KnnLearner {
  constructor({
    backend = "webgl",
    k = 3,
    onResults = null,
  } = {}) {
    this.backend = backend;
    this.k = Math.max(1, Number(k) || 3);
    this._onResults = typeof onResults === "function" ? onResults : null;

    this.knn = null;
    this.ready = false;
    this._mode = "native"; // "ml5" | "native"

    this._examples = []; // native mode: [{ vec, label }]

    this._hasResult = false;
    this._hasNew = false;
    this._lastResult = null;

    this._learnCount = 0;
  }

  async init() {
    const m = window.ml5;

    // Use already-loaded ml5 if it exposes KNN.
    const candidate =
      (typeof m?.knnClassifier === "function" && m.knnClassifier()) ||
      (typeof m?.KNNClassifier === "function" && m.KNNClassifier()) ||
      (typeof m?.KNNClassifier?.create === "function" && m.KNNClassifier.create()) ||
      null;

    if (candidate) {
      this.knn = candidate;
      this._mode = "ml5";

      if (window.ml5?.setBackend) {
        try {
          await window.ml5.setBackend(this.backend);
        } catch (e) {
          console.warn("KnnLearner setBackend warning:", e);
        }
      }
    } else {
      // No ml5 KNN API available: native fallback mode.
      this._mode = "native";
    }

    this.ready = true;
    return this;
  }

  learn(input, label) {
    if (!this.ready) throw new Error("Call init() before learn()");

    const vec = this._prepareInput(input);
    const lbl = String(label ?? "").trim();
    if (!lbl) throw new Error("learn(input, label): label is required");

    this._examples.push({ vec: vec.slice(), label: lbl });
    if (this._mode === "ml5") this.knn.addExample(vec, lbl);

    this._learnCount += 1;
    return this._learnCount;
  }

  learnMany(items = []) {
    if (!Array.isArray(items)) throw new Error("learnMany(items): items must be an array");

    for (const item of items) {
      if (!item) continue;
      const input = item.input ?? item.inputs ?? item.x;
      const label = item.label ?? item.output ?? item.outputs ?? item.y;
      this.learn(input, label);
    }

    return this._learnCount;
  }

  async predict(input) {
    if (!this.ready) throw new Error("Call init() before predict()");
    if (this.labelCount() <= 0) {
      throw new Error("No labels in classifier. Call learn(input, label) first.");
    }

    const vec = this._prepareInput(input);

    let result;
    if (this._mode === "ml5") {
      result = await new Promise((resolve, reject) => {
        try {
          this.knn.classify(vec, (...args) => {
            const [first, second] = args;
            const isResultOnly = args.length === 1 || second === undefined;
            const err = isResultOnly ? null : first;
            const res = isResultOnly ? first : second;
            if (err) reject(err);
            else resolve(res || null);
          });
        } catch (e) {
          reject(e);
        }
      });
    } else {
      result = this._predictNative(vec);
    }

    this._lastResult = result;
    this._hasResult = !!result;
    this._hasNew = true;

    if (typeof this._onResults === "function") {
      try {
        this._onResults(result);
      } catch (e) {
        console.warn("KnnLearner onResults callback error:", e);
      }
    }

    return result;
  }

  async classify(input) {
    return await this.predict(input);
  }

  clearData() {
    if (!this.ready) return;

    if (this._mode === "ml5") {
      if (typeof this.knn?.clearAllLabels === "function") this.knn.clearAllLabels();
    } else {
      this._examples = [];
    }
    this._examples = [];

    this._learnCount = 0;
    this._hasResult = false;
    this._hasNew = false;
    this._lastResult = null;
  }

  async load(url) {
    if (!this.ready) throw new Error("Call init() before load()");
    if (this._mode !== "ml5") throw new Error("load() is only available in ml5 mode");

    await new Promise((resolve, reject) => {
      try {
        this.knn.load(url, () => resolve());
      } catch (e) {
        reject(e);
      }
      setTimeout(resolve, 2000);
    });

    return true;
  }

  _rebuildMl5FromExamples() {
    if (this._mode !== "ml5" || !this.knn) return;
    if (typeof this.knn.clearAllLabels === "function") this.knn.clearAllLabels();
    for (const e of this._examples) {
      this.knn.addExample(e.vec, e.label);
    }
  }

  _exportPayload() {
    return {
      type: "KnnLearner",
      version: 1,
      k: this.k,
      examples: this._examples,
    };
  }

  exportData() {
    return this._exportPayload();
  }

  downloadExport(filename = "portal_knn_learner.json") {
    const payload = this._exportPayload();
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = String(filename || "portal_knn_learner.json");
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
    return true;
  }

  _importPayload(payload, { replace = true } = {}) {
    if (!payload || typeof payload !== "object") {
      throw new Error("KnnLearner import payload must be an object");
    }

    if (replace) this.clearData();
    if (Number.isFinite(Number(payload.k))) {
      this.k = Math.max(1, Number(payload.k));
    }

    const arr = Array.isArray(payload.examples) ? payload.examples : [];
    for (const item of arr) {
      if (!item) continue;
      const vec = this._prepareInput(item.vec ?? item.input ?? item.x);
      const label = String(item.label ?? item.output ?? item.y ?? "").trim();
      if (!label) continue;
      this._examples.push({ vec: vec.slice(), label });
      this._learnCount += 1;
    }

    this._rebuildMl5FromExamples();
  }

  saveToStorage(key = "portal_knn_learner") {
    if (!this.ready) throw new Error("Call init() before saveToStorage()");
    localStorage.setItem(String(key), JSON.stringify(this._exportPayload()));
    return true;
  }

  async loadFromStorage(key = "portal_knn_learner", { replace = true } = {}) {
    if (!this.ready) throw new Error("Call init() before loadFromStorage()");
    const raw = localStorage.getItem(String(key));
    if (!raw) return false;
    const payload = JSON.parse(raw);
    this._importPayload(payload, { replace });
    return true;
  }

  async loadFromURL(url, { replace = true } = {}) {
    if (!this.ready) throw new Error("Call init() before loadFromURL()");
    if (!url) throw new Error("loadFromURL(url): url is required");
    const payload = await fetch(String(url)).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status} while loading ${url}`);
      return r.json();
    });
    this._importPayload(payload, { replace });
    return true;
  }

  savetostorage(key = "portal_knn_learner") { return this.saveToStorage(key); }
  loadfromstorage(key = "portal_knn_learner", opts = {}) { return this.loadFromStorage(key, opts); }
  loadfromurl(url, opts = {}) { return this.loadFromURL(url, opts); }
  exportdata() { return this.exportData(); }
  downloadexport(filename = "portal_knn_learner.json") { return this.downloadExport(filename); }

  save(filename = null) {
    if (!this.ready) throw new Error("Call init() before save()");
    if (this._mode !== "ml5") throw new Error("save() is only available in ml5 mode");
    if (typeof this.knn?.save !== "function") {
      throw new Error("This ml5 KNN instance does not support save()");
    }
    return filename ? this.knn.save(filename) : this.knn.save();
  }

  sampleCount() { return this._learnCount; }
  samplecount() { return this.sampleCount(); }

  labelCount() {
    return Object.keys(this.getCountsByLabel()).length;
  }

  getCountsByLabel() {
    const out = {};
    for (const e of this._examples) out[e.label] = (out[e.label] || 0) + 1;
    return out;
  }

  hasResult() { return this._hasResult; }
  hasNewResult() { return this._hasNew; }
  hasnewresult() { return this.hasNewResult(); }
  resetNewFlag() { this._hasNew = false; }

  consumeNew() {
    const wasNew = this._hasNew;
    this._hasNew = false;
    return { wasNew, result: this._lastResult };
  }
  consumenew() { return this.consumeNew(); }

  getResult() { return this._lastResult; }
  getresult() { return this.getResult(); }

  getBestLabel() {
    const r = this._lastResult;
    if (!r) return null;

    const label = r.label ?? r?.result?.label ?? null;
    const confidences = r.confidencesByLabel || {};
    let confidence = 0;
    if (label && Number.isFinite(Number(confidences[label]))) {
      confidence = Number(confidences[label]);
    }
    return label ? { label, confidence } : null;
  }

  getConfidences() {
    const r = this._lastResult;
    if (!r) return {};
    return r.confidencesByLabel || {};
  }

  _predictNative(vec) {
    const n = this._examples.length;
    const k = Math.min(this.k, n);

    const ranked = this._examples
      .map((e) => ({
        label: e.label,
        d: this._distance(vec, e.vec),
      }))
      .sort((a, b) => a.d - b.d)
      .slice(0, k);

    const vote = {};
    for (const r of ranked) vote[r.label] = (vote[r.label] || 0) + 1;

    let bestLabel = null;
    let bestVotes = -1;
    for (const [label, count] of Object.entries(vote)) {
      if (count > bestVotes) {
        bestVotes = count;
        bestLabel = label;
      }
    }

    const confidencesByLabel = {};
    for (const [label, count] of Object.entries(vote)) {
      confidencesByLabel[label] = count / k;
    }

    return {
      label: bestLabel,
      confidencesByLabel,
    };
  }

  _distance(a, b) {
    const n = Math.max(a.length, b.length);
    let s = 0;
    for (let i = 0; i < n; i++) {
      const av = Number.isFinite(a[i]) ? a[i] : 0;
      const bv = Number.isFinite(b[i]) ? b[i] : 0;
      const d = av - bv;
      s += d * d;
    }
    return Math.sqrt(s);
  }

  _prepareInput(input) {
    if (Array.isArray(input)) return this._flattenNumeric(input);
    if (input && typeof input === "object") return this._flattenNumeric(Object.values(input));
    return this._flattenNumeric([input]);
  }

  _flattenNumeric(value) {
    const out = [];
    const visit = (v) => {
      if (Array.isArray(v)) {
        for (const item of v) visit(item);
        return;
      }
      const n = Number(v);
      out.push(Number.isFinite(n) ? n : 0);
    };
    visit(value);
    return out;
  }
}
