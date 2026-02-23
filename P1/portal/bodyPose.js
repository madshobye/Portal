// BodyPose aligned to the HandPose helper style
// - drawPoses(x=0,y=0,w=?,h=?) defaults to video native size
// - drawImage(x=0,y=0,w=?,h=?) draws video aligned to the same mapping as landmarks
// - getPoses() => VIDEO space, flipped only (NO scaling)
// - getPosesInRect(x,y,w,h) => flipped + scaled to that rect
// - scaleTo(w,h[,x=0,y=0]) => centered "cover" mapping (fills rect, keeps aspect ratio)

class BodyPose {
  constructor({
    video,
    videoIsFlipped = false,
    backend = "webgl",
    modelType = "SINGLEPOSE_THUNDER",
    onResults = null,
  } = {}) {
    if (!video) throw new Error("BodyPose: video is required");

    this.videoP5 = video.elt ? video : null;
    this.video = video.elt ? video.elt : video;
    this.videoIsFlipped = !!videoIsFlipped;
    this.backend = backend;
    this.modelType = modelType;
    this._onResults = typeof onResults === "function" ? onResults : null;

    this.detector = null;
    this.ready = false;
    this.running = false;

    this.posesRaw = [];   // VIDEO space, unflipped
    this.posesVideo = []; // VIDEO space, flipped-only

    this._hasResult = false;
    this._hasNew = false;

    this._raf = null;
    this._reinitInFlight = null;
    this._runtimeOrder = ["tfjs", "mediapipe"];
    this._runtimeIndex = 0;
    this._scaleToRect = null;

    // Canonical MediaPipe Pose keypoint names (33)
    this._names = [
      "nose",
      "left_eye_inner", "left_eye", "left_eye_outer",
      "right_eye_inner", "right_eye", "right_eye_outer",
      "left_ear", "right_ear",
      "mouth_left", "mouth_right",
      "left_shoulder", "right_shoulder",
      "left_elbow", "right_elbow",
      "left_wrist", "right_wrist",
      "left_pinky", "right_pinky",
      "left_index", "right_index",
      "left_thumb", "right_thumb",
      "left_hip", "right_hip",
      "left_knee", "right_knee",
      "left_ankle", "right_ankle",
      "left_heel", "right_heel",
      "left_foot_index", "right_foot_index",
    ];

    this._edges = [
      [11, 12], [11, 23], [12, 24], [23, 24],
      [11, 13], [13, 15], [15, 17], [15, 19], [15, 21],
      [12, 14], [14, 16], [16, 18], [16, 20], [16, 22],
      [23, 25], [25, 27], [27, 29], [27, 31],
      [24, 26], [26, 28], [28, 30], [28, 32],
      [0, 1], [1, 2], [2, 3], [0, 4], [4, 5], [5, 6], [9, 10],
    ];
  }

  async init() {
    await this._ensureMl5AndPose();

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
        if (msg.includes("estimatePoses") || msg.includes("null")) {
          await this._recoverDetector(true);
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
    if (!this.detector || typeof this.detector.detect !== "function") {
      throw new Error("BodyPose detector not ready");
    }

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

  async _recoverDetector(tryNextRuntime = false) {
    if (this._reinitInFlight) return this._reinitInFlight;

    this._reinitInFlight = (async () => {
      try {
        if (tryNextRuntime && this._runtimeIndex < this._runtimeOrder.length - 1) {
          this._runtimeIndex += 1;
        }
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

  _getMl5Options() {
    const runtime = this._runtimeOrder[this._runtimeIndex] || "tfjs";
    if (runtime === "tfjs") {
      return {
        runtime: "tfjs",
        modelType: this.modelType,
      };
    }
    return {
      runtime: "mediapipe",
      modelType: this.modelType,
      solutionPath: "https://cdn.jsdelivr.net/npm/@mediapipe/pose",
    };
  }

  async _createDetector() {
    return await ml5.bodyPose(this._getMl5Options());
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

  getPoses() {
    return this.posesVideo;
  }

  getPosesRaw() {
    return this.posesRaw;
  }

  getPosesInRect(x, y, w, h) {
    return this._mapPosesToRect(this.posesRaw, x, y, w, h);
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

  getPosesScaled() {
    if (!this._scaleToRect) return this.getPoses();
    const r = this._scaleToRect;
    return this._mapPosesToCoverRect(this.posesRaw, r.x, r.y, r.w, r.h);
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
    const arr = this.posesVideo || [];
    return arr.slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0] || null;
  }

  getPose(index = 0) {
    return this.posesVideo?.[index] || null;
  }

  // Returns mapped keypoint position in the same rect as draw/image usage.
  getLimbPosition(person = 0, id = 0, x = 0, y = 0, w = null, h = null) {
    const poses =
      w == null && h == null && this._scaleToRect
        ? this.getPosesScaled()
        : this.getPosesInRect(
            x,
            y,
            w ?? (this.video?.videoWidth || this.video?.width || width),
            h ?? (this.video?.videoHeight || this.video?.height || height)
          );
    const pose = poses?.[person];
    if (!pose) return { x: 0, y: 0 };

    const pts = this._extractKeypoints(pose);
    const p = pts?.[id];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return { x: 0, y: 0 };
    return { x: p.x, y: p.y };
  }

  // Backward-compatible alias for existing sketches.
  getLimpPosition(person = 0, id = 0, x = 0, y = 0, w = null, h = null) {
    return this.getLimbPosition(person, id, x, y, w, h);
  }

  drawPoses(
    x = 0,
    y = 0,
    w = null,
    h = null,
    {
      drawSkeleton = true,
      drawKeypoints = true,
      showLabels = false,
      ptSize = 6,
      minConfidence = 0.5,
      minPoseScore = 0,
    } = {}
  ) {
    const poses =
      w == null && h == null && this._scaleToRect
        ? this.getPosesScaled()
        : this.getPosesInRect(
            x,
            y,
            w ?? (this.video?.videoWidth || this.video?.width || width),
            h ?? (this.video?.videoHeight || this.video?.height || height)
          );
    if (!poses?.length || typeof ellipse !== "function") return;

    push();
    noFill();
    stroke(0);
    strokeWeight(2);

    for (const pose of poses) {
      const poseScore = Number(pose.score ?? 0);
      if (poseScore && poseScore < minPoseScore) continue;

      const pts = this._extractKeypoints(pose);
      if (!pts.length) continue;

      if (drawSkeleton) {
        this._drawSkeletonWithConfidence(pts, minConfidence);
      }

      if (drawKeypoints) {
        noStroke();
        for (const p of pts) {
          if (!this._ptOK(p, minConfidence)) continue;
          fill(0);
          ellipse(p.x, p.y, ptSize + 2, ptSize + 2);
          fill(255);
          ellipse(p.x, p.y, ptSize, ptSize);
        }
      }

      if (showLabels) {
        fill(255);
        textSize(10);
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          if (!this._ptOK(p, minConfidence)) continue;
          text(this._names[i] || i, p.x + 4, p.y - 4);
        }
      }
    }

    pop();
  }

  // -------- Internals --------
  _handle = (results) => {
    let arr = [];
    if (Array.isArray(results)) arr = results;
    else if (Array.isArray(results?.poses)) arr = results.poses;
    else if (results && typeof results === "object") arr = [results];

    this.posesRaw = arr;
    this.posesVideo = this._toVideoFlipped(arr);

    this._hasResult = this.posesRaw.length > 0;
    this._hasNew = true;

    if (this._onResults) {
      try {
        this._onResults(
          this._scaleToRect ? this.getPosesScaled() : this.getPosesInRect(0, 0, width, height)
        );
      } catch (e) {
        console.warn("BodyPose onResults threw:", e);
      }
    }
  };

  _toVideoFlipped(poses) {
    if (!poses?.length) return [];
    const v = this.video?.elt ? this.video.elt : this.video;
    const vw = v?.videoWidth || v?.width || width;

    return poses.map((pose) => {
      const base = this._extractKeypoints(pose);
      const pts = base.map((p) => {
        const q = this._safePoint(p);
        const px = this.videoIsFlipped ? vw - q.x : q.x;
        return { x: px, y: q.y, c: q.c };
      });
      return this._buildPoseObject(pose, pts);
    });
  }

  _mapPosesToRect(poses, x, y, w, h) {
    if (!poses?.length) return [];

    const v = this.video?.elt ? this.video.elt : this.video;
    const vw = v?.videoWidth || v?.width || width;
    const vh = v?.videoHeight || v?.height || height;

    const sx = w / vw;
    const sy = h / vh;

    return poses.map((pose) => {
      const base = this._extractKeypoints(pose);
      const pts = base.map((p) => {
        const q = this._safePoint(p);
        let px = q.x;
        if (this.videoIsFlipped) px = vw - px;
        return { x: x + px * sx, y: y + q.y * sy, c: q.c };
      });
      return this._buildPoseObject(pose, pts);
    });
  }

  _mapPosesToCoverRect(poses, x, y, w, h) {
    if (!poses?.length) return [];

    const rect = this._computeCoverRect(x, y, w, h);
    const v = this.video?.elt ? this.video.elt : this.video;
    const vw = v?.videoWidth || v?.width || width;

    return poses.map((pose) => {
      const base = this._extractKeypoints(pose);
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
      return this._buildPoseObject(pose, pts);
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

  _buildPoseObject(pose, pts) {
    const keypoints = pts.map((p) => ({ x: p.x, y: p.y, score: p.c }));
    const landmarks = pts.map((p) => [p.x, p.y, 0]);
    const named = {};

    for (let i = 0; i < Math.min(this._names.length, pts.length); i++) {
      named[this._names[i]] = { x: pts[i].x, y: pts[i].y, c: pts[i].c };
    }

    return { ...pose, keypoints, landmarks, ...named };
  }

  _extractKeypoints(pose) {
    if (!pose) return [];

    let pts = [];

    if (Array.isArray(pose.keypoints) && pose.keypoints.length) {
      const named = pose.keypoints.map((k) => ({
        x: k.x,
        y: k.y,
        c: Number(k.score ?? k.confidence ?? k.visibility ?? 1),
        name: k.name ?? k.part ?? k.label,
      }));

      const hasNames = named.every((k) => !!k.name);
      pts = hasNames ? this._reorderByName(named) : named;
    } else if (Array.isArray(pose.landmarks) && pose.landmarks.length) {
      if (Array.isArray(pose.landmarks[0])) {
        pts = pose.landmarks.map((p) => ({ x: p[0], y: p[1], c: 1 }));
      } else {
        pts = pose.landmarks.map((p) => ({
          x: p.x,
          y: p.y,
          c: Number(p.visibility ?? p.score ?? p.confidence ?? 1),
        }));
      }
    }

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

      const likelyNormalized = count01 >= Math.max(8, Math.floor(valid * 0.6));
      if (likelyNormalized) {
        pts = pts.map((p) => (p ? { x: p.x * vw, y: p.y * vh, c: p.c } : null));
      }
    }

    return pts;
  }

  _normalizeName(n) {
    if (!n) return null;
    let s = String(n).trim();
    s = s.replace(/([a-z0-9])([A-Z])/g, "$1_$2");
    s = s.replace(/[\s\-]+/g, "_").toLowerCase();
    return s;
  }

  _reorderByName(namedList) {
    const out = new Array(this._names.length).fill(null);
    const map = Object.create(null);
    this._names.forEach((n, i) => {
      map[n] = i;
    });

    for (const kp of namedList) {
      const nm = this._normalizeName(kp.name);
      if (!nm || !(nm in map)) continue;
      const idx = map[nm];
      out[idx] = { x: kp.x, y: kp.y, c: Number(kp.c ?? 1) };
    }

    return out;
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

  _drawSkeletonWithConfidence(pts, minC) {
    stroke(0);
    strokeWeight(2);
    for (const [a, b] of this._edges) {
      const pa = pts[a];
      const pb = pts[b];
      if (this._ptOK(pa, minC) && this._ptOK(pb, minC)) {
        line(pa.x, pa.y, pb.x, pb.y);
      }
    }
  }

  async _ensureMl5AndPose() {
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

    const wantsMediapipe =
      (this._runtimeOrder[this._runtimeIndex] || "tfjs") === "mediapipe";

    if (wantsMediapipe && !window.Pose) {
      try {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js";
          s.async = false;
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      } catch {
        // Keep tfjs as fallback if MediaPipe script conflicts with environment.
        this._runtimeIndex = 0;
      }
    }
  }

  async _waitDetectorReady(detector, timeoutMs = 10000) {
    const start = performance.now();
    const isReady = () =>
      !!detector?.model || !!detector?.poseDetector || !!detector?.predictor;

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
