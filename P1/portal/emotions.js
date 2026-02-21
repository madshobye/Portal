// Emotions tracker helper for the Portal system.
// Uses clmtrackr + emotion_classifier model files.
// API mirrors other portal helpers: init/start/stop + draw/access helpers.

class EmotionTracker {
  constructor({
    video,
    videoIsFlipped = false,
    onResults = null,
  } = {}) {
    if (!video) throw new Error("EmotionTracker: video is required");

    this.video = video.elt ? video.elt : video;
    this.videoIsFlipped = !!videoIsFlipped;
    this._onResults = typeof onResults === "function" ? onResults : null;

    this.tracker = null;
    this.classifier = null;

    this.ready = false;
    this.running = false;

    this.positionsRaw = []; // unflipped VIDEO-space [[x,y], ...]
    this.positionsVideo = []; // flipped VIDEO-space [[x,y], ...]
    this.emotions = []; // [{emotion,value}, ...]

    this._hasResult = false;
    this._hasNew = false;
    this._raf = null;
  }

  async init() {
    await EmotionTracker._ensureLibraries(this._resolvePortalRoot());

    if (!window.clm || !window.emotionClassifier || !window.emotionModel) {
      throw new Error("EmotionTracker: required emotion libraries failed to load");
    }

    this.tracker = new clm.tracker();
    this.tracker.init(pModel);

    this.classifier = new emotionClassifier();
    this.classifier.init(emotionModel);

    this.ready = true;
    return this;
  }

  async start() {
    if (!this.ready || !this.tracker || !this.classifier) {
      throw new Error("Call init() before start()");
    }
    if (this.running) return;

    this.running = true;
    await this._waitForVideoReady(this.video);

    this.tracker.start(this.video);

    const loop = () => {
      if (!this.running) return;
      this._updateFrame();
      this._raf = requestAnimationFrame(loop);
    };

    loop();
  }

  stop() {
    if (this.tracker && typeof this.tracker.stop === "function") {
      try {
        this.tracker.stop();
      } catch {}
    }
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
    this.running = false;
  }

  _updateFrame() {
    const raw = this.tracker.getCurrentPosition();
    const arr = Array.isArray(raw) ? raw : [];

    this.positionsRaw = arr.map((p) => [Number(p?.[0] ?? NaN), Number(p?.[1] ?? NaN)]);
    this.positionsVideo = this._toVideoFlipped(this.positionsRaw);

    if (this.positionsRaw.length > 0) {
      const params = this.tracker.getCurrentParameters();
      const predicted = this.classifier.meanPredict(params);
      this.emotions = Array.isArray(predicted) ? predicted : [];
      this._hasResult = true;
      this._hasNew = true;
    } else {
      this.emotions = [];
      this._hasResult = false;
    }

    if (this._onResults) {
      try {
        this._onResults({
          positions: this.getPositions(),
          emotions: this.getEmotions(),
        });
      } catch (e) {
        console.warn("EmotionTracker onResults threw:", e);
      }
    }
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

  getPositions() {
    return this.positionsVideo;
  }

  getPositionsRaw() {
    return this.positionsRaw;
  }

  getPositionsInRect(x, y, w, h) {
    return this._mapPointsToRect(this.positionsRaw, x, y, w, h);
  }

  getPoint(index = 0, x = 0, y = 0, w = null, h = null) {
    const v = this.video?.elt ? this.video.elt : this.video;
    const vw = v?.videoWidth || v?.width || width;
    const vh = v?.videoHeight || v?.height || height;
    const W = w ?? vw;
    const H = h ?? vh;

    const pts = this.getPositionsInRect(x, y, W, H);
    const p = pts[index];
    if (!p) return { x: 0, y: 0 };
    return { x: p[0], y: p[1] };
  }

  // Convenience alias for easier landmark testing in sketches.
  getLandmark(index = 0, x = 0, y = 0, w = null, h = null) {
    return this.getPoint(index, x, y, w, h);
  }

  landmarkExists(index = 0, x = 0, y = 0, w = null, h = null) {
    const p = this.getLandmark(index, x, y, w, h);
    return !!(p && Number.isFinite(p.x) && Number.isFinite(p.y));
  }

  // lowercase aliases for quick sketch scripting
  getlandmark(index = 0, x = 0, y = 0, w = null, h = null) {
    return this.getLandmark(index, x, y, w, h);
  }

  landmarkexists(index = 0, x = 0, y = 0, w = null, h = null) {
    return this.landmarkExists(index, x, y, w, h);
  }

  // Useful for quick experimentation: returns N landmarks in mapped space.
  getLandmarks(x = 0, y = 0, w = null, h = null, limit = null) {
    const v = this.video?.elt ? this.video.elt : this.video;
    const vw = v?.videoWidth || v?.width || width;
    const vh = v?.videoHeight || v?.height || height;
    const W = w ?? vw;
    const H = h ?? vh;
    const pts = this.getPositionsInRect(x, y, W, H);
    if (limit == null) return pts;
    return pts.slice(0, Math.max(0, limit));
  }

  getEmotions() {
    return this.emotions;
  }

  getEmotion(name) {
    if (!name) return null;
    const key = String(name).toLowerCase();
    return this.emotions.find((e) => String(e?.emotion || "").toLowerCase() === key) || null;
  }

  getDominantEmotion() {
    if (!this.emotions?.length) return null;
    return this.emotions.slice().sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0];
  }

  drawPoints(
    x = 0,
    y = 0,
    w = null,
    h = null,
    {
      pointSize = 2,
      color = [255, 255, 255],
      maxPoints = null,
    } = {}
  ) {
    const v = this.video?.elt ? this.video.elt : this.video;
    const vw = v?.videoWidth || v?.width || width;
    const vh = v?.videoHeight || v?.height || height;
    const W = w ?? vw;
    const H = h ?? vh;

    const pts = this.getPositionsInRect(x, y, W, H);
    if (!pts?.length || typeof ellipse !== "function") return;

    const n = maxPoints == null ? pts.length : Math.min(pts.length, maxPoints);

    push();
    noStroke();
    fill(color[0] ?? 255, color[1] ?? 255, color[2] ?? 255);
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
      ellipse(p[0], p[1], pointSize, pointSize);
    }
    pop();
  }

  drawEmotionBars(
    x = 20,
    y = null,
    {
      barWidth = 30,
      barHeight = 100,
      spacing = 110,
      textSizePx = 20,
      textColor = [255, 255, 255],
    } = {}
  ) {
    if (!this.emotions?.length) return;

    const baseY = y ?? (height - 80);

    push();
    fill(textColor[0], textColor[1], textColor[2]);
    noStroke();
    textSize(textSizePx);

    for (let i = 0; i < this.emotions.length; i++) {
      const e = this.emotions[i];
      const label = String(e?.emotion || "").toUpperCase();
      const val = Number(e?.value ?? 0);
      const bx = x + i * spacing;

      text(label, bx, baseY + 40);
      rect(bx, baseY, barWidth, -val * barHeight);
    }

    pop();
  }

  _toVideoFlipped(points) {
    if (!points?.length) return [];

    const v = this.video?.elt ? this.video.elt : this.video;
    const vw = v?.videoWidth || v?.width || width;

    return points.map((p) => {
      const x = Number(p?.[0] ?? NaN);
      const y = Number(p?.[1] ?? NaN);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return [NaN, NaN];
      return this.videoIsFlipped ? [vw - x, y] : [x, y];
    });
  }

  _mapPointsToRect(points, x, y, w, h) {
    if (!points?.length) return [];

    const v = this.video?.elt ? this.video.elt : this.video;
    const vw = v?.videoWidth || v?.width || width;
    const vh = v?.videoHeight || v?.height || height;
    const sx = w / vw;
    const sy = h / vh;

    return points.map((p) => {
      let px = Number(p?.[0] ?? NaN);
      const py = Number(p?.[1] ?? NaN);
      if (!Number.isFinite(px) || !Number.isFinite(py)) return [NaN, NaN];
      if (this.videoIsFlipped) px = vw - px;
      return [x + px * sx, y + py * sy];
    });
  }

  _resolvePortalRoot() {
    if (typeof baseURL !== "undefined" && typeof baseURL === "string" && baseURL) {
      return baseURL;
    }

    const fromSrc = (src) => {
      try {
        const u = new URL(src, window.location.href);
        const marker = "/portal/emotions.js";
        const idx = u.pathname.lastIndexOf(marker);
        if (idx === -1) return null;
        const rootPath = u.pathname.slice(0, idx + 1);
        return `${u.origin}${rootPath}`;
      } catch {
        return null;
      }
    };

    const current = fromSrc(document.currentScript?.src);
    if (current) return current;

    const loaded = [...document.scripts].map((s) => fromSrc(s.src)).find(Boolean);
    if (loaded) return loaded;

    return new URL("./", window.location.href).href;
  }

  async _waitForVideoReady(video) {
    try {
      video.setAttribute?.("playsinline", "");
      await video.play?.();
    } catch {}

    const ready = () =>
      video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0;

    if (ready()) return;

    await new Promise((resolve) => {
      const on = () => {
        if (ready()) {
          video.removeEventListener?.("loadeddata", on);
          video.removeEventListener?.("loadedmetadata", on);
          resolve();
        }
      };

      video.addEventListener?.("loadeddata", on);
      video.addEventListener?.("loadedmetadata", on);

      const id = setInterval(() => {
        if (ready()) {
          clearInterval(id);
          resolve();
        }
      }, 50);
    });

    if (!video.width || !video.height) {
      video.width = video.videoWidth;
      video.height = video.videoHeight;
    }
  }

  static async _ensureLibraries(root) {
    if (EmotionTracker._loadPromise) return EmotionTracker._loadPromise;

    const loadOne = (src) =>
      new Promise((resolve, reject) => {
        const normalized = (() => {
          try {
            const u = new URL(src, window.location.href);
            u.search = "";
            u.hash = "";
            return u.href;
          } catch {
            return src;
          }
        })();

        const exists = [...document.scripts].some((s) => {
          try {
            const u = new URL(s.src, window.location.href);
            u.search = "";
            u.hash = "";
            return u.href === normalized;
          } catch {
            return s.src === src;
          }
        });

        if (exists) return resolve();

        const s = document.createElement("script");
        s.src = src;
        s.async = false;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error(`Failed to load: ${src}`));
        document.head.appendChild(s);
      });

    const rootClean = root.endsWith("/") ? root : `${root}/`;
    const base = `${rootClean}libs/emotion/`;

    EmotionTracker._loadPromise = (async () => {
      await loadOne(`${base}clmtrackr.js`);
      await loadOne(`${base}model_pca_20_svm.js`);
      await loadOne(`${base}emotion_classifier.js`);
      await loadOne(`${base}emotionmodel.js`);
    })();

    return EmotionTracker._loadPromise;
  }
}

// Legacy-friendly alias
class Emotions extends EmotionTracker {}
