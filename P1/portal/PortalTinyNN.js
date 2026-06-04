/*
  PortalTinyNN

  A deliberately small neural-network engine for Portal teaching sketches.
  Inspired by the x-ml sketch by Halim Rahman and Mads Hobye.

  Credit:
  - Halim Rahman, halim@ebyx.net
  - Mads Hobye, mads@hobye.dk

  This module keeps the math visible and minimal: dense layers, relu/tanh/linear,
  MSE loss, SGD or Adam updates, and simple regression-oriented helpers.
*/

class PortalTinyNN {
  constructor({
    layers = [1, 4, 4, 1],
    activations = null,
    learningRate = 0.01,
    optimizer = "adam",
    magicParams = {},
    seed = 1,
  } = {}) {
    this.layers = this._sanitizeLayers(layers);
    this.activations = this._normalizeActivations(activations);
    this.learningRate = learningRate;
    this.optimizer = String(optimizer || "adam").toLowerCase();
    this.magicParams = {
      sinFreq: 1,
      cosFreq: 1,
      logCurve: 1,
      expCurve: 1,
      sqrtCurve: 1,
      squareGain: 1,
      ...magicParams,
    };
    this.seed = seed >>> 0;
    this.iteration = 0;
    this.loss = 0;
    this.lossHistory = [];
    this.weights = [];
    this.biases = [];
    this.disabledNeurons = {};
    this.neuronActivations = {};
    this._adam = { mW: [], vW: [], mB: [], vB: [], beta1: 0.9, beta2: 0.999, eps: 1e-8 };
    this.reset(seed);
  }

  reset(seed = this.seed) {
    this.seed = seed >>> 0;
    this.iteration = 0;
    this.loss = 0;
    this.lossHistory = [];
    this.weights = [];
    this.biases = [];
    this._adam.mW = [];
    this._adam.vW = [];
    this._adam.mB = [];
    this._adam.vB = [];

    for (let layer = 1; layer < this.layers.length; layer++) {
      const rows = this.layers[layer];
      const cols = this.layers[layer - 1];
      const scale = Math.sqrt(2 / Math.max(1, cols));
      this.weights[layer] = this._matrix(rows, cols, () => this._randNormal() * scale);
      this.biases[layer] = this._matrix(rows, 1, () => 0);
      this._adam.mW[layer] = this._matrix(rows, cols, () => 0);
      this._adam.vW[layer] = this._matrix(rows, cols, () => 0);
      this._adam.mB[layer] = this._matrix(rows, 1, () => 0);
      this._adam.vB[layer] = this._matrix(rows, 1, () => 0);
    }
    return this;
  }

  setLearningRate(value) {
    this.learningRate = Math.max(1e-8, Number(value) || this.learningRate);
  }

  resizeLayers(nextLayers, { activations = this.activations, preserve = true } = {}) {
    const oldWeights = this._cloneMatrixList(this.weights);
    const oldBiases = this._cloneMatrixList(this.biases);
    const oldLayers = [...this.layers];
    const oldDisabled = this.getDisabledNeurons();
    const oldNeuronActivations = this.getNeuronActivations();

    this.layers = this._sanitizeLayers(nextLayers);
    this.activations = this._normalizeActivations(activations);
    this.reset(this.seed);

    if (!preserve) {
      this.disabledNeurons = {};
      this.neuronActivations = {};
    } else {
      for (let layer = 1; layer < this.layers.length; layer++) {
        const oldLayer = layer === this.layers.length - 1
          ? oldLayers.length - 1
          : (layer < oldLayers.length - 1 ? layer : -1);
        const oldW = oldWeights[oldLayer];
        const oldB = oldBiases[oldLayer];
        if (!oldW || !oldB) continue;
        const rows = Math.min(this.layers[layer], oldLayers[oldLayer] || 0);
        const cols = Math.min(this.layers[layer - 1], oldLayers[oldLayer - 1] || 0);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) this.weights[layer][r][c] = oldW[r][c];
          this.biases[layer][r][0] = oldB[r][0];
        }
      }
      this.setDisabledNeurons(oldDisabled);
      this.setNeuronActivations(oldNeuronActivations);
      this._clipNeuronMaps();
    }

    this.iteration = 0;
    this.loss = 0;
    this.lossHistory = [];
    return this;
  }

  predict(input) {
    return this._forward(this._column(input)).a[this.layers.length - 1].map((row) => row[0]);
  }

  train(samples, {
    steps = 1,
    learningRate = this.learningRate,
    batchSize = 0,
    recordLossEachStep = true,
  } = {}) {
    if (!Array.isArray(samples) || samples.length === 0) return this.getStats();
    const lr = Math.max(1e-8, Number(learningRate) || this.learningRate);
    const size = Math.max(0, Math.floor(Number(batchSize) || 0));

    for (let step = 0; step < steps; step++) {
      const batch = size > 0 && size < samples.length
        ? this._sampleBatch(samples, size)
        : samples;
      const grads = this._emptyGradients();
      let totalLoss = 0;

      for (const sample of batch) {
        const x = this._column(sample.input ?? sample.x);
        const y = this._column(sample.output ?? sample.y);
        const pass = this._forward(x);
        totalLoss += this._mse(pass.a[this.layers.length - 1], y);
        this._backward(pass, y, grads);
      }

      this._applyGradients(grads, lr, batch.length);
      this.iteration += 1;
      this.loss = totalLoss / batch.length;
      if (recordLossEachStep) this._pushLoss(this.loss);
    }

    if (!recordLossEachStep) this._pushLoss(this.loss);
    return this.getStats();
  }

  evaluateLoss(samples, { record = false } = {}) {
    if (!Array.isArray(samples) || samples.length === 0) return this.loss;
    let totalLoss = 0;
    for (const sample of samples) {
      const x = this._column(sample.input ?? sample.x);
      const y = this._column(sample.output ?? sample.y);
      const pass = this._forward(x);
      totalLoss += this._mse(pass.a[this.layers.length - 1], y);
    }
    this.loss = totalLoss / samples.length;
    if (record) this._pushLoss(this.loss);
    return this.loss;
  }

  getStats() {
    return {
      iteration: this.iteration,
      loss: this.loss,
      lossHistory: [...this.lossHistory],
      layers: [...this.layers],
      activations: [...this.activations],
      learningRate: this.learningRate,
      optimizer: this.optimizer,
    };
  }

  getWeights() {
    return this.weights;
  }

  getBiases() {
    return this.biases;
  }

  isNeuronEnabled(layer, neuron) {
    return !this.disabledNeurons?.[layer]?.has(neuron);
  }

  setNeuronEnabled(layer, neuron, enabled = true) {
    if (layer <= 0 || layer >= this.layers.length - 1) return false;
    if (!this.disabledNeurons[layer]) this.disabledNeurons[layer] = new Set();
    if (enabled) this.disabledNeurons[layer].delete(neuron);
    else this.disabledNeurons[layer].add(neuron);
    return this.isNeuronEnabled(layer, neuron);
  }

  toggleNeuron(layer, neuron) {
    return this.setNeuronEnabled(layer, neuron, !this.isNeuronEnabled(layer, neuron));
  }

  getDisabledNeurons() {
    const out = {};
    for (const [layer, set] of Object.entries(this.disabledNeurons || {})) {
      out[layer] = [...set];
    }
    return out;
  }

  setDisabledNeurons(disabled = {}) {
    this.disabledNeurons = {};
    for (const [layer, neurons] of Object.entries(disabled || {})) {
      const layerIndex = Number(layer);
      if (!Number.isFinite(layerIndex)) continue;
      this.disabledNeurons[layerIndex] = new Set(
        (Array.isArray(neurons) ? neurons : []).filter((n) => Number.isInteger(n))
      );
    }
  }

  getMagicParams() {
    return { ...this.magicParams };
  }

  setMagicParam(name, value) {
    if (!Object.prototype.hasOwnProperty.call(this.magicParams, name)) return;
    this.magicParams[name] = Math.max(0.01, Number(value) || this.magicParams[name]);
  }

  setMagicParams(params = {}) {
    for (const [name, value] of Object.entries(params)) this.setMagicParam(name, value);
  }

  getNeuronActivations() {
    const out = {};
    for (const [layer, values] of Object.entries(this.neuronActivations || {})) {
      out[layer] = { ...values };
    }
    return out;
  }

  setNeuronActivations(activations = {}) {
    this.neuronActivations = {};
    for (const [layer, values] of Object.entries(activations || {})) {
      const layerIndex = Number(layer);
      if (!Number.isFinite(layerIndex) || !values || typeof values !== "object") continue;
      this.neuronActivations[layerIndex] = { ...values };
    }
  }

  getActivationChoices() {
    return ["tanh", "relu", "sigmoid", "linear", "sin", "cos", "log", "exp", "sqrt", "square"];
  }

  getNeuronActivation(layer, neuron) {
    if (layer <= 0) return "input";
    if (layer >= this.layers.length - 1) return this.activations?.[layer] || "linear";
    return this.neuronActivations?.[layer]?.[neuron] || this._baseNeuronActivation(layer, neuron);
  }

  setNeuronActivation(layer, neuron, activation) {
    if (layer <= 0 || layer >= this.layers.length - 1) return this.getNeuronActivation(layer, neuron);
    const choices = this.getActivationChoices();
    if (!choices.includes(activation)) return this.getNeuronActivation(layer, neuron);
    if (!this.neuronActivations[layer]) this.neuronActivations[layer] = {};
    this.neuronActivations[layer][neuron] = activation;
    return activation;
  }

  cycleNeuronActivation(layer, neuron) {
    const choices = this.getActivationChoices();
    const current = this.getNeuronActivation(layer, neuron);
    const index = choices.indexOf(current);
    const next = choices[(index + 1 + choices.length) % choices.length];
    return this.setNeuronActivation(layer, neuron, next);
  }

  getMagicKind(index) {
    return this._magicKind(index);
  }

  getWeight(layer, row, col) {
    return this.weights?.[layer]?.[row]?.[col];
  }

  setWeight(layer, row, col, value) {
    if (this.weights?.[layer]?.[row] && Number.isFinite(Number(value))) {
      this.weights[layer][row][col] = Number(value);
    }
  }

  getBias(layer, row) {
    return this.biases?.[layer]?.[row]?.[0];
  }

  setBias(layer, row, value) {
    if (this.biases?.[layer]?.[row] && Number.isFinite(Number(value))) {
      this.biases[layer][row][0] = Number(value);
    }
  }

  exportState() {
    return {
      layers: [...this.layers],
      activations: [...this.activations],
      learningRate: this.learningRate,
      optimizer: this.optimizer,
      seed: this.seed,
      iteration: this.iteration,
      loss: this.loss,
      lossHistory: [...this.lossHistory],
      weights: this._cloneMatrixList(this.weights),
      biases: this._cloneMatrixList(this.biases),
      disabledNeurons: this.getDisabledNeurons(),
      neuronActivations: this.getNeuronActivations(),
      magicParams: this.getMagicParams(),
    };
  }

  importState(state = {}) {
    if (!state || typeof state !== "object") return this;
    if (Array.isArray(state.layers)) {
      this.resizeLayers(state.layers, { activations: state.activations, preserve: false });
    } else if (Array.isArray(state.activations)) {
      this.activations = this._normalizeActivations(state.activations);
    }
    if (Array.isArray(state.weights) && this._matrixListMatches(state.weights, false)) this.weights = this._cloneMatrixList(state.weights);
    if (Array.isArray(state.biases) && this._matrixListMatches(state.biases, true)) this.biases = this._cloneMatrixList(state.biases);
    if (Number.isFinite(Number(state.iteration))) this.iteration = Number(state.iteration);
    if (Number.isFinite(Number(state.loss))) this.loss = Number(state.loss);
    if (Array.isArray(state.lossHistory)) this.lossHistory = state.lossHistory.map(Number).filter(Number.isFinite).slice(-240);
    if (state.disabledNeurons) this.setDisabledNeurons(state.disabledNeurons);
    if (state.neuronActivations) this.setNeuronActivations(state.neuronActivations);
    this._clipNeuronMaps();
    if (state.magicParams) this.setMagicParams(state.magicParams);
    return this;
  }

  _forward(inputColumn) {
    const a = [];
    const z = [];
    a[0] = inputColumn;

    for (let layer = 1; layer < this.layers.length; layer++) {
      z[layer] = this._add(this._dot(this.weights[layer], a[layer - 1]), this.biases[layer]);
      a[layer] = this._activate(z[layer], this.activations[layer], layer);
      this._applyNeuronMask(layer, a[layer]);
    }

    return { a, z };
  }

  _backward(pass, target, grads) {
    let delta = this._scale(
      this._hadamard(
        this._subtract(pass.a[this.layers.length - 1], target),
        this._activationDerivative(pass.z[this.layers.length - 1], this.activations[this.layers.length - 1])
      ),
      2 / Math.max(1, target.length)
    );

    for (let layer = this.layers.length - 1; layer > 0; layer--) {
      this._applyNeuronMask(layer, delta);
      grads.dW[layer] = this._add(grads.dW[layer], this._dot(delta, this._transpose(pass.a[layer - 1])));
      grads.dB[layer] = this._add(grads.dB[layer], delta);

      if (layer > 1) {
        delta = this._hadamard(
          this._dot(this._transpose(this.weights[layer]), delta),
          this._activationDerivative(pass.z[layer - 1], this.activations[layer - 1], layer - 1)
        );
      }
    }
  }

  _applyGradients(grads, learningRate, sampleCount) {
    const invN = 1 / Math.max(1, sampleCount);
    const beta1 = this._adam.beta1;
    const beta2 = this._adam.beta2;
    const eps = this._adam.eps;
    const adamT = this.iteration + 1;

    for (let layer = 1; layer < this.layers.length; layer++) {
      const dW = this._scale(grads.dW[layer], invN);
      const dB = this._scale(grads.dB[layer], invN);

      if (this.optimizer === "sgd") {
        this.weights[layer] = this._subtract(this.weights[layer], this._scale(dW, learningRate));
        this.biases[layer] = this._subtract(this.biases[layer], this._scale(dB, learningRate));
        continue;
      }

      for (let r = 0; r < this.weights[layer].length; r++) {
        for (let c = 0; c < this.weights[layer][r].length; c++) {
          const grad = dW[r][c];
          this._adam.mW[layer][r][c] = beta1 * this._adam.mW[layer][r][c] + (1 - beta1) * grad;
          this._adam.vW[layer][r][c] = beta2 * this._adam.vW[layer][r][c] + (1 - beta2) * grad * grad;
          const mHat = this._adam.mW[layer][r][c] / (1 - Math.pow(beta1, adamT));
          const vHat = this._adam.vW[layer][r][c] / (1 - Math.pow(beta2, adamT));
          this.weights[layer][r][c] -= learningRate * mHat / (Math.sqrt(vHat) + eps);
        }
      }

      for (let r = 0; r < this.biases[layer].length; r++) {
        const grad = dB[r][0];
        this._adam.mB[layer][r][0] = beta1 * this._adam.mB[layer][r][0] + (1 - beta1) * grad;
        this._adam.vB[layer][r][0] = beta2 * this._adam.vB[layer][r][0] + (1 - beta2) * grad * grad;
        const mHat = this._adam.mB[layer][r][0] / (1 - Math.pow(beta1, adamT));
        const vHat = this._adam.vB[layer][r][0] / (1 - Math.pow(beta2, adamT));
        this.biases[layer][r][0] -= learningRate * mHat / (Math.sqrt(vHat) + eps);
      }
    }
  }

  _emptyGradients() {
    const dW = [];
    const dB = [];
    for (let layer = 1; layer < this.layers.length; layer++) {
      dW[layer] = this._matrix(this.layers[layer], this.layers[layer - 1], () => 0);
      dB[layer] = this._matrix(this.layers[layer], 1, () => 0);
    }
    return { dW, dB };
  }

  _sampleBatch(samples, batchSize) {
    const batch = [];
    for (let i = 0; i < batchSize; i++) {
      batch.push(samples[Math.floor(Math.random() * samples.length)]);
    }
    return batch;
  }

  _pushLoss(value) {
    if (!Number.isFinite(value)) return;
    this.lossHistory.push(value);
    if (this.lossHistory.length > 240) this.lossHistory.shift();
  }

  _activate(m, name, layer = -1) {
    const fn = String(name || "linear").toLowerCase();
    return this._map(m, (v, r) => {
      const neuronFn = layer >= 0 ? this.getNeuronActivation(layer, r) : fn;
      return this._activateValue(v, neuronFn, r);
    });
  }

  _activationDerivative(z, name, layer = -1) {
    const fn = String(name || "linear").toLowerCase();
    return this._map(z, (v, r) => {
      const neuronFn = layer >= 0 ? this.getNeuronActivation(layer, r) : fn;
      return this._activationDerivativeValue(v, neuronFn, r);
    });
  }

  _applyNeuronMask(layer, values) {
    const disabled = this.disabledNeurons?.[layer];
    if (!disabled || disabled.size === 0) return values;
    for (const neuron of disabled) {
      if (!values[neuron]) continue;
      for (let c = 0; c < values[neuron].length; c++) values[neuron][c] = 0;
    }
    return values;
  }

  _magicKind(index) {
    const kinds = [
      "sin",
      "cos",
      "log",
      "exp",
      "sqrt",
      "square",
      "linear",
      "relu",
      "tanh",
      "sigmoid",
    ];
    return kinds[index % kinds.length];
  }

  _baseNeuronActivation(layer, neuron) {
    const activation = this.activations?.[layer] || "linear";
    return activation === "magic" ? this._magicKind(neuron) : activation;
  }

  _magicActivate(v, index) {
    return this._activateValue(v, this._magicKind(index), index);
  }

  _activateValue(v, kind, index = 0) {
    const p = this.magicParams;
    if (kind === "sin") return Math.sin(v * p.sinFreq);
    if (kind === "cos") return Math.cos(v * p.cosFreq);
    if (kind === "log") {
      const k = p.logCurve;
      return Math.sign(v) * Math.log1p(Math.abs(v) * k) / Math.log1p(k);
    }
    if (kind === "exp") {
      const z = Math.max(-4, Math.min(4, v * p.expCurve));
      return Math.exp(z) / Math.exp(4);
    }
    if (kind === "sqrt") {
      const k = p.sqrtCurve;
      return Math.sign(v) * Math.sqrt(Math.abs(v) * k + 1e-8) / Math.sqrt(k + 1e-8);
    }
    if (kind === "square") return v * v * p.squareGain;
    if (kind === "relu") return Math.max(0, v);
    if (kind === "tanh") return Math.tanh(v);
    if (kind === "sigmoid") return 1 / (1 + Math.exp(-v));
    return v;
  }

  _magicDerivative(v, index) {
    return this._activationDerivativeValue(v, this._magicKind(index), index);
  }

  _activationDerivativeValue(v, kind, index = 0) {
    const p = this.magicParams;
    if (kind === "sin") return p.sinFreq * Math.cos(v * p.sinFreq);
    if (kind === "cos") return -p.cosFreq * Math.sin(v * p.cosFreq);
    if (kind === "log") {
      const k = p.logCurve;
      return k / (Math.log1p(k) * (1 + Math.abs(v) * k));
    }
    if (kind === "exp") {
      const z = v * p.expCurve;
      if (z <= -4 || z >= 4) return 0;
      return p.expCurve * Math.exp(z) / Math.exp(4);
    }
    if (kind === "sqrt") {
      const k = p.sqrtCurve;
      return k / (2 * Math.sqrt(Math.abs(v) * k + 1e-8) * Math.sqrt(k + 1e-8));
    }
    if (kind === "square") return 2 * v * p.squareGain;
    if (kind === "relu") return v > 0 ? 1 : 0;
    if (kind === "tanh") {
      const t = Math.tanh(v);
      return 1 - t * t;
    }
    if (kind === "sigmoid") {
      const s = 1 / (1 + Math.exp(-v));
      return s * (1 - s);
    }
    return 1;
  }

  _mse(predicted, target) {
    let sum = 0;
    let count = 0;
    for (let r = 0; r < predicted.length; r++) {
      for (let c = 0; c < predicted[r].length; c++) {
        const d = predicted[r][c] - target[r][c];
        sum += d * d;
        count += 1;
      }
    }
    return sum / Math.max(1, count);
  }

  _column(value) {
    if (Array.isArray(value)) return value.map((v) => [Number(v) || 0]);
    return [[Number(value) || 0]];
  }

  _matrix(rows, cols, fill) {
    return Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => fill(r, c))
    );
  }

  _sanitizeLayers(layers) {
    const clean = (Array.isArray(layers) ? layers : [1, 4, 4, 1])
      .map((n) => Math.max(1, Math.floor(Number(n) || 1)));
    if (clean.length < 2) return [1, 1];
    clean[0] = Math.max(1, clean[0]);
    clean[clean.length - 1] = Math.max(1, clean[clean.length - 1]);
    return clean;
  }

  _normalizeActivations(activations = null) {
    const out = [];
    for (let i = 0; i < this.layers.length; i++) {
      if (i === 0) out[i] = "input";
      else if (i === this.layers.length - 1) out[i] = "linear";
      else out[i] = activations?.[i] || "tanh";
    }
    return out;
  }

  _matrixListMatches(list, isBias = false) {
    for (let layer = 1; layer < this.layers.length; layer++) {
      const matrix = list[layer];
      const rows = this.layers[layer];
      const cols = isBias ? 1 : this.layers[layer - 1];
      if (!Array.isArray(matrix) || matrix.length !== rows) return false;
      for (let r = 0; r < rows; r++) {
        if (!Array.isArray(matrix[r]) || matrix[r].length !== cols) return false;
      }
    }
    return true;
  }

  _clipNeuronMaps() {
    const clippedDisabled = {};
    for (const [layer, set] of Object.entries(this.disabledNeurons || {})) {
      const layerIndex = Number(layer);
      if (layerIndex <= 0 || layerIndex >= this.layers.length - 1) continue;
      const maxNeurons = this.layers[layerIndex];
      const kept = [...set].filter((n) => Number.isInteger(n) && n >= 0 && n < maxNeurons);
      if (kept.length) clippedDisabled[layerIndex] = new Set(kept);
    }
    this.disabledNeurons = clippedDisabled;

    const clippedActivations = {};
    const choices = this.getActivationChoices();
    for (const [layer, values] of Object.entries(this.neuronActivations || {})) {
      const layerIndex = Number(layer);
      if (layerIndex <= 0 || layerIndex >= this.layers.length - 1) continue;
      const maxNeurons = this.layers[layerIndex];
      clippedActivations[layerIndex] = {};
      for (const [neuron, activation] of Object.entries(values || {})) {
        const neuronIndex = Number(neuron);
        if (neuronIndex >= 0 && neuronIndex < maxNeurons && choices.includes(activation)) {
          clippedActivations[layerIndex][neuronIndex] = activation;
        }
      }
    }
    this.neuronActivations = clippedActivations;
  }

  _cloneMatrixList(list) {
    return list.map((matrix) => (
      Array.isArray(matrix)
        ? matrix.map((row) => (Array.isArray(row) ? row.map(Number) : row))
        : matrix
    ));
  }

  _map(a, fn) {
    return a.map((row, r) => row.map((v, c) => fn(v, r, c)));
  }

  _add(a, b) {
    return a.map((row, r) => row.map((v, c) => v + b[r][c]));
  }

  _subtract(a, b) {
    return a.map((row, r) => row.map((v, c) => v - b[r][c]));
  }

  _scale(a, scalar) {
    return this._map(a, (v) => v * scalar);
  }

  _hadamard(a, b) {
    return a.map((row, r) => row.map((v, c) => v * b[r][c]));
  }

  _dot(a, b) {
    const rows = a.length;
    const cols = b[0].length;
    const inner = b.length;
    const out = this._matrix(rows, cols, () => 0);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let sum = 0;
        for (let k = 0; k < inner; k++) sum += a[r][k] * b[k][c];
        out[r][c] = sum;
      }
    }
    return out;
  }

  _transpose(a) {
    return this._matrix(a[0].length, a.length, (r, c) => a[c][r]);
  }

  _rand() {
    this.seed = (1664525 * this.seed + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  _randNormal() {
    const u = Math.max(1e-9, this._rand());
    const v = Math.max(1e-9, this._rand());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

window.PortalTinyNN = PortalTinyNN;
