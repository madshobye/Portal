// HandGestureKnn
// Combines HandPose + KnnLearner for trainable hand-gesture recognition.
//
// Goals:
// - left/right agnostic via mirrored training samples
// - robust "new gesture" detection with cooldown + no-gesture hold
// - browser storage persistence + export/download

class HandGestureKnn {
  constructor({
    video,
    videoIsFlipped = true,
    backend = "webgl",
    gestureLabels = ["ok", "no", "up", "down"],
    includeOtherLabel = true,
    otherLabel = "other",
    k = 3,
    storageKey = "portal_hand_gesture_knn",
    autoLoadFromStorage = true,
    autoSaveOnLearn = true,
    predictionThreshold = 0.65,
    gestureHoldMs = 280,
    cooldownMs = 1200,
    noGestureHoldMs = 220,
    trainMirrored = true,
    treatOtherAsNoGesture = true,
    onGesture = null,
    onPrediction = null,
  } = {}) {
    if (!video) throw new Error("HandGestureKnn: video is required");

    this.video = video;
    this.videoIsFlipped = !!videoIsFlipped;
    this.backend = backend;

    this.otherLabel = String(otherLabel || "other");
    this.gestureLabels = this._normalizeLabels(
      gestureLabels,
      !!includeOtherLabel,
      this.otherLabel
    );
    this.selectedLabel = this.gestureLabels[0] || this.otherLabel;

    this.k = Math.max(1, Number(k) || 3);
    this.storageKey = String(storageKey || "portal_hand_gesture_knn");
    this.autoLoadFromStorage = !!autoLoadFromStorage;
    this.autoSaveOnLearn = !!autoSaveOnLearn;

    this.predictionThreshold = Number(predictionThreshold) || 0.65;
    this.gestureHoldMs = Math.max(0, Number(gestureHoldMs) || 280);
    this.cooldownMs = Math.max(0, Number(cooldownMs) || 1200);
    this.noGestureHoldMs = Math.max(0, Number(noGestureHoldMs) || 220);

    this.trainMirrored = !!trainMirrored;
    this.treatOtherAsNoGesture = !!treatOtherAsNoGesture;

    this._onGesture = typeof onGesture === "function" ? onGesture : null;
    this._onPrediction = typeof onPrediction === "function" ? onPrediction : null;

    this.handPose = null;
    this.knn = null;
    this.ready = false;
    this.running = false;
    this.mode = "run"; // "train" | "run"

    this._raf = null;
    this._tickInFlight = false;

    this._prediction = {
      label: null,
      confidence: 0,
      confidences: {},
      timestamp: 0,
      isGesture: false,
    };

    this._hasResult = false;
    this._hasNew = false;
    this._lastGestureResult = null;

    this._lastGestureLabel = null;
    this._lastNewAt = 0;
    this._noneSince = null;
    this._sawNoGestureSinceLastNew = true;
    this._candidateLabel = null;
    this._candidateSince = null;

    this._uiStatusText = "Ready";
    this._uiIdPrefix = "hgk_" + this.storageKey.replace(/[^a-zA-Z0-9_]/g, "_");
  }

  async init() {
    await this._ensureDeps();

    this.handPose = await new HandPose({
      video: this.video,
      videoIsFlipped: this.videoIsFlipped,
      backend: this.backend,
    }).init();

    this.knn = await new KnnLearner({
      backend: this.backend,
      k: this.k,
    }).init();

    if (this.autoLoadFromStorage) {
      try {
        await this.loadTraining();
      } catch (e) {
        console.warn("HandGestureKnn loadTraining warning:", e);
      }
    }

    this.ready = true;
    return this;
  }

  async start() {
    if (!this.ready) throw new Error("Call init() before start()");
    if (this.running) return;

    await this.handPose.start();
    this.running = true;

    const loop = async () => {
      if (!this.running) return;
      if (!this._tickInFlight) {
        this._tickInFlight = true;
        try {
          await this._tick();
        } finally {
          this._tickInFlight = false;
        }
      }
      this._raf = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this.handPose?.stop?.();
  }

  setMode(mode = "run") {
    const m = String(mode).toLowerCase();
    this.mode = m === "train" ? "train" : "run";
    this._uiStatusText = "Mode: " + this.mode;
    return this.mode;
  }

  toggleMode() {
    return this.setMode(this.mode === "train" ? "run" : "train");
  }

  setSelectedLabel(label) {
    const l = String(label || "").trim();
    if (!l) return this.selectedLabel;
    if (!this.gestureLabels.includes(l)) this.gestureLabels.push(l);
    this.selectedLabel = l;
    this._uiStatusText = "Selected label: " + l;
    return this.selectedLabel;
  }

  getSelectedLabel() {
    return this.selectedLabel;
  }

  getLabels() {
    return this.gestureLabels.slice();
  }

  setLabels(labels = [], { includeOther = true } = {}) {
    this.gestureLabels = this._normalizeLabels(labels, includeOther, this.otherLabel);
    if (!this.gestureLabels.includes(this.selectedLabel)) {
      this.selectedLabel = this.gestureLabels[0] || this.otherLabel;
    }
    return this.getLabels();
  }

  learn(label = null) {
    if (!this.ready) throw new Error("Call init() before learn()");

    const useLabel = String(label || this.selectedLabel || "").trim();
    if (!useLabel) throw new Error("learn(label): label is required");

    const hand = this.getTrackedHand();
    if (!hand) return false;

    const feat = this._extractFeature(hand);
    if (!feat) return false;

    this.knn.learn(feat, useLabel);
    if (this.trainMirrored) {
      this.knn.learn(this._mirrorFeature(feat), useLabel);
    }

    if (this.autoSaveOnLearn) {
      try {
        this.saveTraining();
      } catch {}
    }

    if (!this.gestureLabels.includes(useLabel)) this.gestureLabels.push(useLabel);
    return true;
  }

  clearTraining() {
    this.knn?.clearData?.();
    try {
      localStorage.removeItem(this.storageKey);
    } catch {}
    this._uiStatusText = "Training cleared";
    return true;
  }

  saveTraining() {
    if (!this.knn) return false;
    return this.knn.saveToStorage(this.storageKey);
  }

  async loadTraining() {
    if (!this.knn) return false;
    return await this.knn.loadFromStorage(this.storageKey, { replace: true });
  }

  downloadTraining(filename = "portal_hand_gesture_knn.json") {
    const ok = this.knn?.downloadExport?.(filename) || false;
    if (ok) this._uiStatusText = "Training downloaded";
    return ok;
  }

  getCountsByLabel() {
    return this.knn?.getCountsByLabel?.() || {};
  }

  sampleCount() {
    return Number(this.knn?.sampleCount?.() || 0);
  }

  getPrediction() {
    return this._prediction;
  }

  hasResult() {
    return this._hasResult;
  }

  hasNewResult() {
    return this._hasNew;
  }

  resetNewFlag() {
    this._hasNew = false;
  }

  consumeNew() {
    const wasNew = this._hasNew;
    this._hasNew = false;
    return { wasNew, result: this._lastGestureResult };
  }

  getResult() {
    return this._lastGestureResult;
  }

  getTrackedHand() {
    return this.handPose?.getFirstHand?.() || null;
  }

  getStatusText() {
    return this._uiStatusText;
  }

  drawUI({
    x = 24,
    y = 24,
    labelButtonWidth = 82,
    labelButtonHeight = 34,
    labelGap = 8,
    labels = null,
  } = {}) {
    const activeLabels = Array.isArray(labels) && labels.length ? labels : this.gestureLabels;

    const learnToggle = uiToggle(this._uiId("learn_mode"), "Learn", {
      x,
      y,
      width: 220,
      height: 40,
      fontSize: 16,
      onBgColor: "#ff4d4d",
      offBgColor: "gray",
    });

    const nextMode = learnToggle.value ? "train" : "run";
    if (nextMode !== this.mode) this.setMode(nextMode);

    let gx = x;
    const gy = y + 50;
    const counts = this.getCountsByLabel();
    const prediction = this.getPrediction();
    const activeLabelInRun = prediction?.label || "";

    for (const g of activeLabels) {
      const isActive = this.mode === "run" ? g === activeLabelInRun : g === this.selectedLabel;
      const count = Number(counts?.[g] || 0);
      const style = {
        x: gx,
        y: gy,
        width: labelButtonWidth,
        height: labelButtonHeight,
        fontSize: 12,
        bgColor: isActive ? "#7aa7ff" : "silver",
      };
      if (uiButton(g + " (" + count + ")", style).clicked) {
        if (this.mode === "train") {
          this.setSelectedLabel(g);
          const ok = this.learn(g);
          this._uiStatusText = ok ? "Learned: " + g : "No hand detected for training";
        }
      }
      gx += labelButtonWidth + labelGap;
    }

    if (this.mode === "train") {
      if (
        uiButton("Clear Training", {
          x,
          y: y + 96,
          width: 150,
          height: 38,
          fontSize: 15,
        }).clicked
      ) {
        this.clearTraining();
      }

      if (
        uiButton("Download", {
          x: x + 160,
          y: y + 96,
          width: 120,
          height: 38,
          fontSize: 15,
        }).clicked
      ) {
        this.downloadTraining("hand_gesture_knn.json");
      }
    }

    return {
      mode: this.mode,
      selectedLabel: this.selectedLabel,
      statusText: this._uiStatusText,
      prediction,
      counts,
    };
  }

  // Proxy helpers so usage matches HandPose pattern in sketches.
  scaleTo(w, h, x = 0, y = 0) {
    return this.handPose?.scaleTo?.(w, h, x, y);
  }
  drawImage(...args) {
    return this.handPose?.drawImage?.(...args);
  }
  drawHands(...args) {
    return this.handPose?.drawHands?.(...args);
  }

  async _tick() {
    if (this.mode !== "run") return;
    if (!this.knn || this.knn.labelCount() <= 0) return;

    const hand = this.getTrackedHand();
    if (!hand) {
      this._handleNoGesture();
      return;
    }

    const feat = this._extractFeature(hand);
    if (!feat) {
      this._handleNoGesture();
      return;
    }

    let pred;
    try {
      pred = await this.knn.predict(feat);
    } catch {
      return;
    }
    const best = this._bestFromPrediction(pred);
    const now = this._nowMs();

    let label = best.label;
    const confidence = best.confidence;

    let isGesture = !!label && confidence >= this.predictionThreshold;
    if (isGesture && this.treatOtherAsNoGesture && label === this.otherLabel) {
      isGesture = false;
      label = null;
    }

    this._prediction = {
      label,
      confidence,
      confidences: best.confidences,
      timestamp: now,
      isGesture,
    };

    if (this._onPrediction) {
      try {
        this._onPrediction(this._prediction);
      } catch (e) {
        console.warn("HandGestureKnn onPrediction callback error:", e);
      }
    }

    if (!isGesture) {
      this._handleNoGesture();
      return;
    }

    this._noneSince = null;

    if (label !== this._candidateLabel) {
      this._candidateLabel = label;
      this._candidateSince = now;
      return;
    }
    const stableForMs = now - (this._candidateSince ?? now);
    if (stableForMs < this.gestureHoldMs) return;

    let isNew = false;
    if (!this._lastGestureLabel) {
      isNew = true;
    } else if (label !== this._lastGestureLabel) {
      const cooldownOk = now - this._lastNewAt >= this.cooldownMs;
      if (this._sawNoGestureSinceLastNew || cooldownOk) isNew = true;
    }

    if (isNew) {
      const event = {
        label,
        confidence,
        confidences: best.confidences,
        timestamp: now,
      };
      this._lastGestureResult = event;
      this._hasResult = true;
      this._hasNew = true;
      this._lastGestureLabel = label;
      this._lastNewAt = now;
      this._sawNoGestureSinceLastNew = false;

      if (this._onGesture) {
        try {
          this._onGesture(event);
        } catch (e) {
          console.warn("HandGestureKnn onGesture callback error:", e);
        }
      }
    }
  }

  _handleNoGesture() {
    const now = this._nowMs();
    if (this._noneSince == null) this._noneSince = now;
    if (now - this._noneSince >= this.noGestureHoldMs) {
      this._sawNoGestureSinceLastNew = true;
      this._candidateLabel = null;
      this._candidateSince = null;
    }
  }

  _extractFeature(hand) {
    const pts = this._extractKeypoints(hand);
    if (!pts || pts.length < 21) return null;

    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (!p) continue;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;

    // Normalize by gesture bounding box so webcam position and absolute hand size
    // do not influence classification.
    const bw = maxX - minX;
    const bh = maxY - minY;
    if (!(bw > 0.0001) || !(bh > 0.0001)) return null;

    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const halfW = bw * 0.5;
    const halfH = bh * 0.5;

    const feat = [];
    for (const p of pts) {
      const nx = (p.x - cx) / halfW; // approx [-1,1]
      const ny = (p.y - cy) / halfH; // approx [-1,1]
      feat.push(nx, ny);
    }
    return feat;
  }

  _mirrorFeature(vec) {
    const out = new Array(vec.length);
    for (let i = 0; i < vec.length; i += 2) {
      out[i] = -vec[i];
      out[i + 1] = vec[i + 1];
    }
    return out;
  }

  _extractKeypoints(hand) {
    if (!hand) return [];
    if (Array.isArray(hand.keypoints) && hand.keypoints.length) {
      return hand.keypoints.map((p) => ({ x: Number(p.x), y: Number(p.y) }));
    }
    if (Array.isArray(hand.landmarks) && hand.landmarks.length) {
      const lm = hand.landmarks;
      if (Array.isArray(lm[0])) {
        return lm.map((p) => ({ x: Number(p[0]), y: Number(p[1]) }));
      }
      return lm.map((p) => ({ x: Number(p.x), y: Number(p.y) }));
    }
    return [];
  }

  _bestFromPrediction(pred) {
    const label = pred?.label ?? pred?.result?.label ?? null;
    const confidences = pred?.confidencesByLabel || {};
    let confidence = 0;
    if (label && Number.isFinite(Number(confidences[label]))) {
      confidence = Number(confidences[label]);
    } else {
      // Fallback: max confidence if label missing from map
      for (const v of Object.values(confidences)) {
        const n = Number(v);
        if (Number.isFinite(n) && n > confidence) confidence = n;
      }
    }
    return { label, confidence, confidences };
  }

  _normalizeLabels(labels, includeOther, otherLabel) {
    const out = [];
    for (const l of Array.isArray(labels) ? labels : []) {
      const s = String(l || "").trim();
      if (!s || out.includes(s)) continue;
      out.push(s);
    }
    if (includeOther && !out.includes(otherLabel)) out.push(otherLabel);
    return out;
  }

  _nowMs() {
    if (typeof millis === "function") return millis();
    if (typeof performance !== "undefined" && performance.now) return performance.now();
    return Date.now();
  }

  _uiId(name) {
    return this._uiIdPrefix + "_" + String(name || "x");
  }

  async _ensureDeps() {
    const hasHandPose = () => typeof HandPose !== "undefined";
    const hasKnnLearner = () => typeof KnnLearner !== "undefined";

    if (!hasHandPose()) await loadScript("portal/handPose.js");
    if (!hasKnnLearner()) await loadScript("portal/knnLearner.js");

    if (!hasHandPose() || !hasKnnLearner()) {
      throw new Error("HandGestureKnn: required dependencies failed to load");
    }
  }
}
