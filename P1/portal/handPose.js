// HandPose aligned to p5 v2 createCapture(...,{ flipped })
// - drawHands(x=0,y=0,w=?,h=?) default w,h = video native size (to match image(cam,0,0))
// - getHands() => VIDEO space, flipped only (NO scaling), with named joints
// - getHandsInRect(x,y,w,h) => flipped + scaled to that rect (for image(cam,x,y,w,h))

class HandPose {
  constructor({
    video,
    videoIsFlipped = false,
    backend = "webgl",
    onResults = null,
  } = {}) {
    if (!video) throw new Error("HandPose: video is required");
    this.video = video.elt ? video.elt : video;
    this.videoIsFlipped = !!videoIsFlipped;
    this.backend = backend;
    this._onResults = typeof onResults === "function" ? onResults : null;

    this.detector = null;

    this.handsRaw = []; // ml5 results (VIDEO space, unflipped)
    this.handsVideo = []; // VIDEO space, flipped (if videoIsFlipped) — NO scaling

    this.ready = false;
    this.running = false;

    this._hasResult = false;
    this._hasNew = false;
    this._raf = null;
    this._reinitInFlight = null;
    this._runtimeOrder = ["tfjs", "mediapipe"];
    this._runtimeIndex = 0;

    // MediaPipe/TFJS hand landmark names in index order
    this._names = [
      "wrist",
      "thumb_cmc",
      "thumb_mcp",
      "thumb_ip",
      "thumb_tip",
      "index_finger_mcp",
      "index_finger_pip",
      "index_finger_dip",
      "index_finger_tip",
      "middle_finger_mcp",
      "middle_finger_pip",
      "middle_finger_dip",
      "middle_finger_tip",
      "ring_finger_mcp",
      "ring_finger_pip",
      "ring_finger_dip",
      "ring_finger_tip",
      "pinky_finger_mcp",
      "pinky_finger_pip",
      "pinky_finger_dip",
      "pinky_finger_tip",
    ];
  }

  async init() {
    await this._ensureMl5AndMPHands();

    if (ml5?.setBackend) {
      try {
        await ml5.setBackend(this.backend);
      } catch (e) {
        console.warn(e);
      }
    }

    this.detector = await this._createDetector();

    // 🔴 IMPORTANT: wait until detector is actually ready
    await this._waitDetectorReady(this.detector);

    this.ready = true;
    return this;
  }

  async start() {
    if (!this.ready || !this.detector)
      throw new Error("Call init() before start()");
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
        if (msg.includes("estimateHands") || msg.includes("null")) {
          await this._recoverDetector(true);
        }
      }
      this._raf = requestAnimationFrame(loop);
    };
    loop();
  }

  async _detectOnce() {
    if (!this.detector || typeof this.detector.detect !== "function") {
      throw new Error("HandPose detector not ready");
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
          (second === undefined &&
            (Array.isArray(first) || (first && typeof first === "object")));

        const err = isResultOnlyCallback ? null : first;
        const res = isResultOnlyCallback ? first : second;

        if (err) return reject(err);
        resolve(res || []);
      });
    });
  }

  stop() {
    if (this.detector && typeof this.detector.detectStop === "function")
      this.detector.detectStop();
    if (this._raf) cancelAnimationFrame(this._raf), (this._raf = null);
    this.running = false;
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
    const runtime = this._runtimeOrder[this._runtimeIndex] || "mediapipe";
    if (runtime === "tfjs") return { runtime: "tfjs" };
    return {
      runtime: "mediapipe",
      solutionPath: "https://cdn.jsdelivr.net/npm/@mediapipe/hands",
    };
  }

  async _createDetector() {
    const detector = await ml5.handPose(this._getMl5Options());
    return detector;
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

  /** VIDEO-space, flipped to match a flipped feed, NO scaling. Includes named joints. */
  getHands() {
    return this.handsVideo;
  }

  /** Raw ml5 results (VIDEO-space, unflipped) */
  getHandsRaw() {
    return this.handsRaw;
  }

  /** Hands mapped into the same rect you pass to image(cam, x, y, w, h) */
  getHandsInRect(x, y, w, h) {
    return this._mapHandsToRect(this.handsRaw, x, y, w, h);
  }

  /** Draw into rect; defaults to the video’s native size so it matches image(cam, 0, 0) */
  drawHands(
    x = 0,
    y = 0,
    w = null,
    h = null,
    ptSize = 6,
    drawSkeleton = true,
    showLabels = false
  ) {
    const v = this.video?.elt ? this.video.elt : this.video;
    const vw = v?.videoWidth || v?.width || width;
    const vh = v?.videoHeight || v?.height || height;

    const W = w ?? vw;
    const H = h ?? vh;

    const hands = this.getHandsInRect(x, y, W, H); // flipped + scaled to rect
    if (!hands || !hands.length || typeof ellipse !== "function") return;

    push();
    noFill();
    stroke(0);
    strokeWeight(2);
    for (const hand of hands) {
      const pts = this._extractKeypoints(hand); // already in rect-space
      if (!pts.length) continue;

      if (drawSkeleton) this._drawSkeleton(pts);

      noStroke();
      fill(0);
      for (const p of pts) ellipse(p.x, p.y, ptSize + 2, ptSize + 2);
      fill(255);
      for (const p of pts) ellipse(p.x, p.y, ptSize, ptSize);

      if (showLabels) {
        fill(255);
        textSize(10);
        for (let i = 0; i < pts.length; i++)
          text(i, pts[i].x + 4, pts[i].y - 4);
      }
    }
    pop();
  }

  // -------- Internals --------
  _handle = (results) => {
    // Normalize
    this.handsRaw = Array.isArray(results) ? results : results?.hands || [];
    // VIDEO-space, flipped-only (NO scaling)
    this.handsVideo = this._toVideoFlipped(this.handsRaw);

    this._hasResult = this.handsRaw.length > 0;
    this._hasNew = true;

    if (this._onResults) {
      try {
        // Default onResults gets full-canvas rect mapping, but you can ignore it if unused
        this._onResults(this.getHandsInRect(0, 0, width, height));
      } catch (e) {
        console.warn("onResults threw:", e);
      }
    }
  };

  _toVideoFlipped(hands) {
    if (!hands || !hands.length) return [];
    const v = this.video?.elt ? this.video.elt : this.video;
    const vw = v?.videoWidth || v?.width || width;

    const mapPts = (h, pts) => {
      // Build both shapes and attach named joints for convenience
      const keypoints = pts.map((p) => ({ x: p.x, y: p.y }));
      const landmarks = pts.map((p) => [p.x, p.y, 0]);

      // Also expose named joints (so hand.index_finger_tip works)
      const named = {};
      for (let i = 0; i < Math.min(this._names.length, pts.length); i++) {
        named[this._names[i]] = { x: pts[i].x, y: pts[i].y };
      }

      return { ...h, keypoints, landmarks, ...named };
    };

    return hands.map((h) => {
      const base = this._extractKeypoints(h); // VIDEO space
      const pts = base.map((p) => {
        const x = p.x,
          y = p.y;
        return this.videoIsFlipped ? { x: vw - x, y } : { x, y };
      });
      return mapPts(h, pts);
    });
  }

  _mapHandsToRect(hands, x, y, w, h) {
    if (!hands || !hands.length) return [];
    const v = this.video?.elt ? this.video.elt : this.video;
    const vw = v?.videoWidth || v?.width || width;
    const vh = v?.videoHeight || v?.height || height;

    const flipX = this.videoIsFlipped;
    const sx = w / vw;
    const sy = h / vh;

    const mapPts = (h, pts) => {
      const keypoints = pts.map((p) => ({ x: p.x, y: p.y }));
      const landmarks = pts.map((p) => [p.x, p.y, 0]);
      const named = {};
      for (let i = 0; i < Math.min(this._names.length, pts.length); i++) {
        named[this._names[i]] = { x: pts[i].x, y: pts[i].y };
      }
      return { ...h, keypoints, landmarks, ...named };
    };

    return hands.map((h) => {
      const base = this._extractKeypoints(h); // VIDEO space, unflipped
      const pts = base.map((p) => {
        let px = p.x,
          py = p.y;
        if (flipX) px = vw - px; // mirror in VIDEO space
        return { x: x + px * sx, y: y + py * sy }; // scale + offset into rect
      });
      return mapPts(h, pts); // rect-space with named joints
    });
  }

  _extractKeypoints(hand) {
    if (!hand) return [];
    if (Array.isArray(hand.keypoints) && hand.keypoints.length)
      return hand.keypoints.map((p) => ({ x: p.x, y: p.y }));
    if (Array.isArray(hand.landmarks) && hand.landmarks.length) {
      const lm = hand.landmarks;
      return Array.isArray(lm[0])
        ? lm.map((p) => ({ x: p[0], y: p[1] }))
        : lm.map((p) => ({ x: p.x, y: p.y }));
    }
    return [];
  }

  _drawSkeleton(pts) {
    const chains = [
      [0, 1, 2, 3, 4],
      [0, 5, 6, 7, 8],
      [0, 9, 10, 11, 12],
      [0, 13, 14, 15, 16],
      [0, 17, 18, 19, 20],
    ];
    stroke(0);
    strokeWeight(2);
    for (const c of chains) {
      for (let i = 0; i < c.length - 1; i++) {
        const a = pts[c[i]],
          b = pts[c[i + 1]];
        if (a && b) line(a.x, a.y, b.x, b.y);
      }
    }
  }

  // replace your ensure with this:
  async _ensureMl5AndMPHands() {
    // 1) Load ml5 serially
    if (!window.ml5) {
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://unpkg.com/ml5@1/dist/ml5.min.js";
        s.async = false; // preserve execution order
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }

    // 2) Preload MediaPipe Hands only when using mediapipe runtime
    const wantsMediapipe =
      (this._runtimeOrder[this._runtimeIndex] || "tfjs") === "mediapipe";
    if (wantsMediapipe && !window.Hands) {
      try {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js";
          s.async = false;
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      } catch (e) {
        // p5 v2 can expose a readonly global VERSION that breaks MediaPipe hands.js
        // Fall back to tfjs runtime instead of failing init.
        if (this._runtimeIndex < this._runtimeOrder.length - 1) {
          this._runtimeIndex = 0;
        }
      }
    }
  }

  // wait until the detector is actually usable
  async _waitDetectorReady(detector, timeoutMs = 10000) {
    const start = performance.now();
    const isReady = () =>
      !!detector?.model ||
      !!detector?.handpose ||
      !!detector?.handPose ||
      !!detector?.predictor;

    // Some ml5 models expose a ready/loaded event; use if available.
    if (typeof detector?.on === "function") {
      let resolved = false;
      await new Promise((resolve) => {
        const done = () => {
          if (!resolved) {
            resolved = true;
            resolve();
          }
        };
        try {
          detector.on("loaded", done);
        } catch {}
        try {
          detector.on("ready", done);
        } catch {}
        // Safety: also poll in case no event fires
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

    // Fallback: poll for model/detectStart
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

  // --- Handedness helpers (add inside the class) ---

  /** Return 'Left' | 'Right' | null from a raw ml5/MP hand object */
  _extractHandedness(hand) {
    // Common places ml5/MediaPipe put this:
    // - hand.handedness or hand.handednessLabel: "Left"/"Right"
    // - hand.handednesses: [{label:"Left", score:...}]
    const h =
      hand?.handedness ??
      hand?.handednessLabel ??
      hand?.handedness?.label ??
      (Array.isArray(hand?.handednesses) ? hand.handednesses[0]?.label : null);

    if (!h) return null;
    const s = String(h).toLowerCase();
    if (s.includes("left")) return "Left";
    if (s.includes("right")) return "Right";
    return null;
  }

  /** VIDEO-space, flipped-only, NO scaling (matches getHands()) */
  getLeftHand() {
    return this._getHandBySide("Left", /*rect*/ null);
  }
  getRightHand() {
    return this._getHandBySide("Right", /*rect*/ null);
  }

  /** Rect-mapped (flipped + scaled to the given image rect) */
  getLeftHandInRect(x, y, w, h) {
    return this._getHandBySide("Left", { x, y, w, h });
  }
  getRightHandInRect(x, y, w, h) {
    return this._getHandBySide("Right", { x, y, w, h });
  }

  /**
   * Internal selector:
   *  - If handedness labels are present, use them (anatomical Left/Right).
   *  - Else, fall back to image position in the CURRENT space:
   *      · VIDEO space: uses getHands() (already flipped if feed is flipped)
   *      · RECT space : uses getHandsInRect(x,y,w,h)
   */
  _getHandBySide(target, rect) {
    const list = rect
      ? this.getHandsInRect(rect.x, rect.y, rect.w, rect.h)
      : this.getHands(); // flipped video-space, no scaling

    if (!list || !list.length) return null;

    // Prefer explicit model label
    const labeled = list.find((h) => this._extractHandedness(h) === target);
    if (labeled) return labeled;

    // Fallback: choose by image position (leftmost/rightmost wrist)
    const getPts = (h) => {
      const pts = this._extractKeypoints(h);
      return { pts, wrist: pts[0] || null };
    };

    const withWrist = list
      .map((h) => ({ hand: h, ...getPts(h) }))
      .filter((o) => o.wrist);

    if (!withWrist.length) return null;

    if (target === "Left") {
      // the left hand in the IMAGE is the one with smaller x
      return withWrist.reduce((a, b) => (a.wrist.x < b.wrist.x ? a : b)).hand;
    } else {
      // right hand in the IMAGE -> larger x
      return withWrist.reduce((a, b) => (a.wrist.x > b.wrist.x ? a : b)).hand;
    }
  }
}
