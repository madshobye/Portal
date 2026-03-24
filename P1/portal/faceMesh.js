// FaceMesh aligned to the HandPose/BodyPose helper style
// - drawKeypoints(x=0,y=0,w=?,h=?) defaults to video native size
// - drawImage(x=0,y=0,w=?,h=?) draws video aligned to the same mapping as landmarks
// - getFaces() => VIDEO space, flipped only (NO scaling)
// - getFacesInRect(x,y,w,h) => flipped + scaled to that rect
// - scaleTo(w,h[,x=0,y=0]) => centered "cover" mapping (fills rect, keeps aspect ratio)

class FaceMesh {
  constructor({
    video,
    videoIsFlipped = false,
    backend = "webgl",
    options = {},
    onResults = null,
  } = {}) {
    if (!video) throw new Error("FaceMesh: video is required");

    this.videoP5 = video.elt ? video : null;
    this.video = video.elt ? video.elt : video;
    this.videoIsFlipped = !!videoIsFlipped;
    this.backend = backend;
    this.options = {
      maxFaces: 1,
      refineLandmarks: true,
      flipHorizontal: false,
      ...options,
    };
    this._onResults = typeof onResults === "function" ? onResults : null;

    this.detector = null;
    this.ready = false;
    this.running = false;

    this.facesRaw = [];   // VIDEO space, unflipped
    this.facesVideo = []; // VIDEO space, flipped-only

    this._hasResult = false;
    this._hasNew = false;

    this._raf = null;
    this._reinitInFlight = null;
    this._scaleToRect = null;
  }

  async init() {
    await this._ensureMl5();

    if (ml5?.setBackend) {
      try {
        await ml5.setBackend(this.backend);
      } catch (e) {
        console.warn(e);
      }
    }

    this.detector = await this._createDetector();
    await this._waitDetectorReady(this.detector);

    this.ready = true;
    return this;
  }

  async start() {
    if (!this.ready || !this.detector) throw new Error("Call init() before start()");
    if (this.running) return;

    this.running = true;
    await this._waitForVideoReady(this.video);

    const loop = async () => {
      if (!this.running) return;
      try {
        const res = await this._detectOnce();
        this._handle(res || []);
      } catch (e) {
        const msg = String(e?.message || e);
        if (msg.includes("estimateFaces") || msg.includes("null")) {
          await this._recoverDetector();
        }
      }
      this._raf = requestAnimationFrame(loop);
    };

    loop();
  }

  stop() {
    if (this.detector && typeof this.detector.detectStop === "function") {
      try {
        this.detector.detectStop();
      } catch {}
    }
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
    this.running = false;
  }

  async _detectOnce() {
    if (!this.detector) throw new Error("FaceMesh detector not ready");

    if (typeof this.detector.detect === "function") {
      try {
        const maybePromise = this.detector.detect(this.video);
        if (maybePromise && typeof maybePromise.then === "function") {
          return await maybePromise;
        }
      } catch (e) {
        throw e;
      }

      return await new Promise((resolve, reject) => {
        this.detector.detect(this.video, (...args) => {
          const [first, second] = args;
          const isResultOnlyCallback =
            args.length === 1 ||
            (second === undefined && (Array.isArray(first) || (first && typeof first === "object")));

          const err = isResultOnlyCallback ? null : first;
          const res = isResultOnlyCallback ? first : second;

          if (err) return reject(err);
          resolve(res || []);
        });
      });
    }

    if (typeof this.detector.detectStart === "function") {
      return await new Promise((resolve, reject) => {
        let settled = false;
        const done = (value, isErr = false) => {
          if (settled) return;
          settled = true;
          if (isErr) reject(value);
          else resolve(value);
        };

        try {
          this.detector.detectStart(this.video, (res) => done(res || []));
        } catch (e) {
          done(e, true);
        }

        setTimeout(() => done([]), 250);
      });
    }

    throw new Error("FaceMesh detector does not expose detect/detectStart");
  }

  async _recoverDetector() {
    if (this._reinitInFlight) return this._reinitInFlight;

    this._reinitInFlight = (async () => {
      try {
        if (this.detector && typeof this.detector.detectStop === "function") {
          try {
            this.detector.detectStop();
          } catch {}
        }

        this.detector = await this._createDetector();
        await this._waitDetectorReady(this.detector);
        this.ready = true;
      } finally {
        this._reinitInFlight = null;
      }
    })();

    return this._reinitInFlight;
  }

  async _createDetector() {
    return await ml5.faceMesh(this.options);
  }

  // -------- Public API --------
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
    return { wasNew, faces: this.getFaces(), best: this.getBest() };
  }

  getLatest() {
    return { faces: this.getFaces(), best: this.getBest() };
  }

  getlatest() {
    return this.getLatest();
  }

  getFaces() {
    return this.facesVideo;
  }

  getFacesRaw() {
    return this.facesRaw;
  }

  getFacesInRect(x, y, w, h) {
    return this._mapFacesToRect(this.facesRaw, x, y, w, h);
  }

  scaleTo(w, h, x = 0, y = 0) {
    const v = this.video?.elt ? this.video.elt : this.video;
    const vw = Math.max(1, v?.videoWidth || v?.width || width || 1);
    const vh = Math.max(1, v?.videoHeight || v?.height || height || 1);

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

  getFacesScaled() {
    if (!this._scaleToRect) return this.getFaces();
    const r = this._scaleToRect;
    return this._mapFacesToCoverRect(this.facesRaw, r.x, r.y, r.w, r.h);
  }

  drawImage(...args) {
    if (typeof image !== "function") return;
    const v = this.video?.elt ? this.video.elt : this.video;
    const drawSource = this.videoP5 || this.video;
    if (!drawSource) return;
    const vw = v?.videoWidth || v?.width || width;
    const vh = v?.videoHeight || v?.height || height;
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

  getBest() {
    return this.facesVideo?.[0] || null;
  }

  drawKeypoints(
    x = 0,
    y = 0,
    w = null,
    h = null,
    {
      minConfidence = 0,
      pointSize = 5,
      color = [0, 255, 0],
    } = {}
  ) {
    const faces =
      w == null && h == null && this._scaleToRect
        ? this.getFacesScaled()
        : this.getFacesInRect(
            x,
            y,
            w ?? (this.video?.videoWidth || this.video?.width || width),
            h ?? (this.video?.videoHeight || this.video?.height || height)
          );
    if (!faces?.length || typeof circle !== "function") return;

    push();
    noStroke();
    fill(color[0] ?? 0, color[1] ?? 255, color[2] ?? 0);

    for (const face of faces) {
      const pts = this._extractKeypoints(face);
      for (const p of pts) {
        if (!this._ptOK(p, minConfidence)) continue;
        circle(p.x, p.y, pointSize);
      }
    }

    pop();
  }

  // Alias for API symmetry
  drawFaces(...args) {
    return this.drawKeypoints(...args);
  }

  // -------- Internals --------
  _handle = (results) => {
    let arr = [];
    if (Array.isArray(results)) arr = results;
    else if (Array.isArray(results?.faces)) arr = results.faces;
    else if (results && typeof results === "object") arr = [results];

    this.facesRaw = arr;
    this.facesVideo = this._toVideoFlipped(arr);

    this._hasResult = this.facesRaw.length > 0;
    this._hasNew = true;

    if (this._onResults) {
      try {
        this._onResults(
          this._scaleToRect ? this.getFacesScaled() : this.getFacesInRect(0, 0, width, height)
        );
      } catch (e) {
        console.warn("FaceMesh onResults threw:", e);
      }
    }
  };

  _toVideoFlipped(faces) {
    if (!faces?.length) return [];

    const v = this.video?.elt ? this.video.elt : this.video;
    const vw = v?.videoWidth || v?.width || width;

    return faces.map((face) => {
      const base = this._extractKeypoints(face);
      const pts = base.map((p) => {
        const q = this._safePoint(p);
        const px = this.videoIsFlipped ? vw - q.x : q.x;
        return { x: px, y: q.y, c: q.c };
      });
      return this._buildFaceObject(face, pts);
    });
  }

  _mapFacesToRect(faces, x, y, w, h) {
    if (!faces?.length) return [];

    const v = this.video?.elt ? this.video.elt : this.video;
    const vw = v?.videoWidth || v?.width || width;
    const vh = v?.videoHeight || v?.height || height;

    const sx = w / vw;
    const sy = h / vh;

    return faces.map((face) => {
      const base = this._extractKeypoints(face);
      const pts = base.map((p) => {
        const q = this._safePoint(p);
        let px = q.x;
        if (this.videoIsFlipped) px = vw - px;
        return { x: x + px * sx, y: y + q.y * sy, c: q.c };
      });
      return this._buildFaceObject(face, pts);
    });
  }

  _mapFacesToCoverRect(faces, x, y, w, h) {
    if (!faces?.length) return [];

    const rect = this._computeCoverRect(x, y, w, h);
    const v = this.video?.elt ? this.video.elt : this.video;
    const vw = v?.videoWidth || v?.width || width;

    return faces.map((face) => {
      const base = this._extractKeypoints(face);
      const pts = base.map((p) => {
        const q = this._safePoint(p);
        let px = q.x;
        if (this.videoIsFlipped) px = vw - px;
        return {
          x: rect.offsetX + px * rect.scale,
          y: rect.offsetY + q.y * rect.scale,
          c: q.c,
        };
      });
      return this._buildFaceObject(face, pts);
    });
  }

  _computeCoverRect(x, y, w, h) {
    const v = this.video?.elt ? this.video.elt : this.video;
    const vw = Math.max(1, v?.videoWidth || v?.width || width || 1);
    const vh = Math.max(1, v?.videoHeight || v?.height || height || 1);
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

  _buildFaceObject(face, pts) {
    const keypoints = pts.map((p) => ({ x: p.x, y: p.y, score: p.c }));
    const landmarks = pts.map((p) => [p.x, p.y, 0]);
    return { ...face, keypoints, landmarks };
  }

  _extractKeypoints(face) {
    if (!face) return [];

    let pts = [];

    if (Array.isArray(face.keypoints) && face.keypoints.length) {
      pts = face.keypoints.map((k) => ({
        x: k.x,
        y: k.y,
        c: Number(k.score ?? k.confidence ?? k.visibility ?? 1),
      }));
    } else if (Array.isArray(face.scaledMesh) && face.scaledMesh.length) {
      pts = face.scaledMesh.map((p) => ({ x: p[0], y: p[1], c: 1 }));
    } else if (Array.isArray(face.mesh) && face.mesh.length) {
      pts = face.mesh.map((p) => ({ x: p[0], y: p[1], c: 1 }));
    } else if (Array.isArray(face.landmarks) && face.landmarks.length) {
      if (Array.isArray(face.landmarks[0])) {
        pts = face.landmarks.map((p) => ({ x: p[0], y: p[1], c: 1 }));
      } else {
        pts = face.landmarks.map((p) => ({
          x: p.x,
          y: p.y,
          c: Number(p.visibility ?? p.score ?? p.confidence ?? 1),
        }));
      }
    }

    // normalize 0..1 to pixel coordinates if needed
    if (pts.length) {
      const v = this.video?.elt ? this.video.elt : this.video;
      const vw = v?.videoWidth || v?.width || width;
      const vh = v?.videoHeight || v?.height || height;

      let count01 = 0;
      let valid = 0;
      for (const p of pts) {
        if (!p) continue;
        valid++;
        if (p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) count01++;
      }

      const likelyNormalized = count01 >= Math.max(20, Math.floor(valid * 0.6));
      if (likelyNormalized) {
        pts = pts.map((p) => (p ? { x: p.x * vw, y: p.y * vh, c: p.c } : null));
      }
    }

    return pts;
  }

  _safePoint(p) {
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      return { x: p.x, y: p.y, c: Number.isFinite(p.c) ? p.c : 1 };
    }
    return { x: NaN, y: NaN, c: 0 };
  }

  _ptOK(p, minC) {
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.c ?? 0) >= minC;
  }

  async _ensureMl5() {
    if (!window.ml5) {
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://unpkg.com/ml5@1/dist/ml5.min.js";
        s.async = false;
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
  }

  async _waitDetectorReady(detector, timeoutMs = 10000) {
    const start = performance.now();
    const isReady = () =>
      !!detector?.model || !!detector?.faceMesh || !!detector?.predictor;

    if (typeof detector?.on === "function") {
      let doneOnce = false;
      await new Promise((resolve) => {
        const done = () => {
          if (!doneOnce) {
            doneOnce = true;
            resolve();
          }
        };
        try {
          detector.on("loaded", done);
        } catch {}
        try {
          detector.on("ready", done);
        } catch {}

        const id = setInterval(() => {
          if (isReady()) {
            clearInterval(id);
            done();
          }
          if (performance.now() - start > timeoutMs) {
            clearInterval(id);
            done();
          }
        }, 50);
      });
      return;
    }

    while (performance.now() - start < timeoutMs) {
      if (isReady()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
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
}
