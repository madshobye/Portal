// Student-friendly wrapper around ml5.neuralNetwork
// Supports classification + regression with recurring learning.
//
// Core idea:
//   learner.learn(input, output)
//
// Typical usage:
//   const learner = await new NeuralLearner({ task: "classification" }).init();
//   learner.learn([x, y], "left");
//   const res = await learner.predict([x, y]);

class NeuralLearner {
  constructor({
    task = "classification",          // "classification" | "regression"
    backend = "webgl",
    nnOptions = {},                    // passed to ml5.neuralNetwork
    trainingOptions = { epochs: 40, batchSize: 12 },
    autoTrain = true,
    retrainDebounceMs = 250,
    onResults = null,
    onTrained = null,
    onEpoch = null,
  } = {}) {
    this.task = String(task || "classification").toLowerCase();
    this.backend = backend;
    this.nnOptions = { debug: false, ...nnOptions };
    this.trainingOptions = { epochs: 40, batchSize: 12, ...trainingOptions };

    this.autoTrain = !!autoTrain;
    this.retrainDebounceMs = Math.max(0, Number(retrainDebounceMs) || 0);

    this._onResults = typeof onResults === "function" ? onResults : null;
    this._onTrained = typeof onTrained === "function" ? onTrained : null;
    this._onEpoch = typeof onEpoch === "function" ? onEpoch : null;

    this.model = null;
    this.samples = []; // [{input, output}]

    this.ready = false;
    this.training = false;
    this.trained = false;

    this._hasResult = false;
    this._hasNew = false;
    this._lastResult = null;

    this._trainTimer = null;
    this._trainInFlight = null;
    this._trainQueued = false;
    this._queuedTrainingOptions = null;
    this._inputKeys = null;
    this._outputKeys = null;
  }

  async init() {
    await this._ensureMl5();

    if (window.ml5?.setBackend) {
      try {
        await window.ml5.setBackend(this.backend);
      } catch (e) {
        console.warn("NeuralLearner setBackend warning:", e);
      }
    }

    this.model = this._createModel();
    this.ready = true;
    return this;
  }

  _createModel() {
    return window.ml5.neuralNetwork({
      task: this.task,
      ...this.nnOptions,
    });
  }

  // Add one training example.
  // input: array/object/primitive
  // output: label/number/array/object
  learn(input, output, { train = this.autoTrain } = {}) {
    if (!this.ready) throw new Error("Call init() before learn()");

    const sample = {
      input: this._normalizeInput(input, true),
      output: this._normalizeOutput(output, true),
    };

    this.samples.push(sample);

    if (train) this._scheduleTrain();

    return this.samples.length;
  }

  // Convenience for adding many samples in one call.
  learnMany(items = [], { train = this.autoTrain } = {}) {
    if (!Array.isArray(items)) throw new Error("learnMany(items): items must be an array");

    for (const item of items) {
      if (!item) continue;
      const input = item.input ?? item.inputs ?? item.x;
      const output = item.output ?? item.outputs ?? item.y ?? item.label ?? item.value;
      this.learn(input, output, { train: false });
    }

    if (train) this._scheduleTrain();
    return this.samples.length;
  }

  _scheduleTrain() {
    if (this._trainTimer) clearTimeout(this._trainTimer);
    this._trainTimer = setTimeout(() => {
      this._trainTimer = null;
      this.train().catch((e) => console.warn("NeuralLearner auto-train error:", e));
    }, this.retrainDebounceMs);
  }

  async train(trainingOptions = null) {
    if (!this.ready) throw new Error("Call init() before train()");
    if (!this.samples.length) throw new Error("No samples. Call learn(input, output) first.");

    const opts = { ...this.trainingOptions, ...(trainingOptions || {}) };
    this._queuedTrainingOptions = opts;
    this._trainQueued = true;

    if (this._trainInFlight) return this._trainInFlight;

    this._trainInFlight = (async () => {
      while (this._trainQueued) {
        this._trainQueued = false;
        const curOpts = this._queuedTrainingOptions || this.trainingOptions;
        await this._trainOnce(curOpts);
      }
      this._trainInFlight = null;
      return true;
    })();

    return this._trainInFlight;
  }

  async _trainOnce(opts) {
    this.training = true;
    this.trained = false;

    // Rebuild model from all samples so recurring learn() always includes old + new data.
    this.model = this._createModel();

    for (const s of this.samples) {
      this.model.addData(s.input, s.output);
    }

    this.model.normalizeData();

    await new Promise((resolve, reject) => {
      let done = false;

      const finish = (err = null) => {
        if (done) return;
        done = true;
        if (err) reject(err);
        else resolve();
      };

      const whileTraining = (epochInfo) => {
        if (typeof this._onEpoch === "function") {
          try {
            this._onEpoch(epochInfo);
          } catch (e) {
            console.warn("NeuralLearner onEpoch callback error:", e);
          }
        }
      };

      try {
        const maybePromise = this.model.train(opts, whileTraining, () => finish());
        if (maybePromise && typeof maybePromise.then === "function") {
          maybePromise.then(() => finish()).catch((e) => finish(e));
        }
      } catch (e) {
        finish(e);
      }
    });

    this.training = false;
    this.trained = true;

    if (typeof this._onTrained === "function") {
      try {
        this._onTrained({ samples: this.samples.length, options: opts });
      } catch (e) {
        console.warn("NeuralLearner onTrained callback error:", e);
      }
    }
  }

  async predict(input) {
    if (!this.ready) throw new Error("Call init() before predict()");
    if (!this.trained) throw new Error("Model is not trained yet");

    const inNorm = this._normalizeInput(input, false);

    const result = await new Promise((resolve, reject) => {
      const done = (...args) => {
        const [first, second] = args;
        const isResultOnlyCallback =
          args.length === 1 ||
          (second === undefined &&
            (Array.isArray(first) || (first && typeof first === "object")));

        const err = isResultOnlyCallback ? null : first;
        const value = isResultOnlyCallback ? first : second;

        if (err) reject(err);
        else resolve(value);
      };

      try {
        if (this.task === "classification") {
          if (typeof this.model.classify !== "function") {
            return reject(new Error("This model does not support classify()"));
          }
          this.model.classify(inNorm, (...args) => {
            done(...args);
          });
          return;
        }

        // Regression: prefer predict(), fallback to classify() if needed
        if (typeof this.model.predict === "function") {
          this.model.predict(inNorm, (...args) => {
            done(...args);
          });
          return;
        }

        if (typeof this.model.classify === "function") {
          this.model.classify(inNorm, (...args) => {
            done(...args);
          });
          return;
        }

        reject(new Error("This model does not support predict/classify"));
      } catch (e) {
        reject(e);
      }
    });

    this._lastResult = result;
    this._hasResult = true;
    this._hasNew = true;

    if (typeof this._onResults === "function") {
      try {
        this._onResults(result);
      } catch (e) {
        console.warn("NeuralLearner onResults callback error:", e);
      }
    }

    return result;
  }

  // Convenience aliases
  async classify(input) {
    return await this.predict(input);
  }

  async regress(input) {
    return await this.predict(input);
  }

  clearData() {
    this.samples = [];
    this.trained = false;
    this._hasResult = false;
    this._hasNew = false;
    this._lastResult = null;
    this._inputKeys = null;
    this._outputKeys = null;
  }

  _exportPayload() {
    return {
      type: "NeuralLearner",
      version: 1,
      task: this.task,
      samples: this.samples,
      inputKeys: this._inputKeys,
      outputKeys: this._outputKeys,
      nnOptions: this.nnOptions,
      trainingOptions: this.trainingOptions,
    };
  }

  exportData() {
    return this._exportPayload();
  }

  downloadExport(filename = "portal_neural_learner.json") {
    const payload = this._exportPayload();
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = String(filename || "portal_neural_learner.json");
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
    return true;
  }

  _importPayload(payload, { replace = true } = {}) {
    if (!payload || typeof payload !== "object") {
      throw new Error("NeuralLearner import payload must be an object");
    }

    const incomingSamples = Array.isArray(payload.samples) ? payload.samples : [];
    if (replace) this.clearData();

    if (typeof payload.task === "string" && payload.task) {
      this.task = payload.task;
      this.model = this._createModel();
    }

    if (Array.isArray(payload.inputKeys)) this._inputKeys = payload.inputKeys.slice();
    if (Array.isArray(payload.outputKeys)) this._outputKeys = payload.outputKeys.slice();

    for (const s of incomingSamples) {
      if (!s) continue;
      const input = Array.isArray(s.input) ? s.input.map((v) => this._toFinite(v)) : [];
      const output = Array.isArray(s.output)
        ? (this.task === "classification"
            ? [String(s.output[0] ?? "")]
            : s.output.map((v) => this._toFinite(v)))
        : [];
      if (!input.length || !output.length) continue;
      this.samples.push({ input, output });
    }

    if (payload.trainingOptions && typeof payload.trainingOptions === "object") {
      this.trainingOptions = { ...this.trainingOptions, ...payload.trainingOptions };
    }
    if (payload.nnOptions && typeof payload.nnOptions === "object") {
      this.nnOptions = { ...this.nnOptions, ...payload.nnOptions };
    }
  }

  saveToStorage(key = "portal_neural_learner") {
    if (!this.ready) throw new Error("Call init() before saveToStorage()");
    const raw = JSON.stringify(this._exportPayload());
    localStorage.setItem(String(key), raw);
    return true;
  }

  async loadFromStorage(key = "portal_neural_learner", { train = true, replace = true } = {}) {
    if (!this.ready) throw new Error("Call init() before loadFromStorage()");
    const raw = localStorage.getItem(String(key));
    if (!raw) return false;
    const payload = JSON.parse(raw);
    this._importPayload(payload, { replace });
    if (train && this.samples.length) await this.train();
    return true;
  }

  async loadFromURL(url, { train = true, replace = true } = {}) {
    if (!this.ready) throw new Error("Call init() before loadFromURL()");
    if (!url) throw new Error("loadFromURL(url): url is required");
    const payload = await fetch(String(url)).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status} while loading ${url}`);
      return r.json();
    });
    this._importPayload(payload, { replace });
    if (train && this.samples.length) await this.train();
    return true;
  }

  savetostorage(key = "portal_neural_learner") { return this.saveToStorage(key); }
  loadfromstorage(key = "portal_neural_learner", opts = {}) { return this.loadFromStorage(key, opts); }
  loadfromurl(url, opts = {}) { return this.loadFromURL(url, opts); }
  exportdata() { return this.exportData(); }
  downloadexport(filename = "portal_neural_learner.json") { return this.downloadExport(filename); }

  sampleCount() {
    return this.samples.length;
  }
  samplecount() {
    return this.sampleCount();
  }

  isTrained() {
    return !!this.trained;
  }
  istrained() {
    return this.isTrained();
  }

  hasResult() {
    return this._hasResult;
  }

  hasNewResult() {
    return this._hasNew;
  }
  hasnewresult() {
    return this.hasNewResult();
  }

  resetNewFlag() {
    this._hasNew = false;
  }

  consumeNew() {
    const wasNew = this._hasNew;
    this._hasNew = false;
    return { wasNew, result: this._lastResult };
  }
  consumenew() {
    return this.consumeNew();
  }

  getResult() {
    return this._lastResult;
  }
  getresult() {
    return this.getResult();
  }

  // Classification helper
  getBestLabel() {
    if (!Array.isArray(this._lastResult) || !this._lastResult.length) return null;
    const top = this._lastResult[0];
    if (!top) return null;
    return {
      label: top.label,
      confidence: Number(top.confidence ?? 0),
    };
  }

  // Regression helper
  getValue(field = "value") {
    const r = this._lastResult;
    if (typeof r === "number") return r;
    if (Array.isArray(r) && r.length) {
      const v = r[0]?.[field] ?? r[0]?.value ?? r[0]?.y ?? r[0];
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    if (r && typeof r === "object") {
      const v = r[field] ?? r.value ?? r.y ?? r[0];
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  // Generic output accessor for object-shaped outputs.
  getField(field, fallback = null) {
    if (!field) return fallback;
    const r = this._lastResult;
    if (r == null) return fallback;

    if (Array.isArray(r) && r.length && r[0] && typeof r[0] === "object") {
      return r[0][field] ?? fallback;
    }
    if (typeof r === "object") {
      return r[field] ?? fallback;
    }
    return fallback;
  }

  _normalizeInput(input, isLearn = false) {
    if (Array.isArray(input)) return input.map((v) => this._toFinite(v));

    if (input && typeof input === "object") {
      if (isLearn || !this._inputKeys) this._inputKeys = Object.keys(input);
      const keys = this._inputKeys || Object.keys(input);
      return keys.map((k) => this._toFinite(input[k]));
    }

    return [this._toFinite(input)];
  }

  _normalizeOutput(output, isLearn = false) {
    if (this.task === "classification") {
      if (Array.isArray(output)) return [String(output[0] ?? "")];
      if (output && typeof output === "object") {
        const key = Object.keys(output)[0];
        return [String(output[key])];
      }
      return [String(output ?? "")];
    }

    // regression
    if (Array.isArray(output)) return output.map((v) => this._toFinite(v));
    if (output && typeof output === "object") {
      if (isLearn || !this._outputKeys) this._outputKeys = Object.keys(output);
      const keys = this._outputKeys || Object.keys(output);
      return keys.map((k) => this._toFinite(output[k]));
    }
    const n = Number(output);
    return [Number.isFinite(n) ? n : 0];
  }

  _toFinite(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  async _ensureMl5() {
    if (window.ml5?.neuralNetwork) return;
    await loadScript("https://unpkg.com/ml5@1/dist/ml5.min.js");
  }
}
