/************* Singleton loader for ZXing *************/
let __zxingLoaderPromise = null;

function loadScriptSerial(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = false; // preserve order
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function ensureZXingOnce() {
  if (__zxingLoaderPromise) return __zxingLoaderPromise;
  __zxingLoaderPromise = (async () => {
    if (!window.ZXing) {
      console.log("[QrReader] Loading ZXing...");
      await loadScriptSerial('https://unpkg.com/@zxing/library@latest');
      console.log("[QrReader] ZXing loaded.");
    } else {
      console.log("[QrReader] ZXing already present.");
    }
  })();
  return __zxingLoaderPromise;
}


class QrReader {
  constructor({ video, videoIsFlipped = false, onResult = null, cooldownMs = 5000 } = {}) {
    this.video = video;
    this.videoP5 = video?.elt ? video : null;
    this.videoIsFlipped = videoIsFlipped;
    this._onResult = (typeof onResult === "function") ? onResult : null;

    this._cooldownMs = cooldownMs;
    this._lastText = "";
    this._lastNewAtMs = 0;
    this._sawNotFoundSinceLastNew = false;

    this._result = null;
    this._text = "";
    this._hasResult = false;
    this._hasNew = false;

    this.reader = null;
    this.running = false;
    this.ready = false;
    this._stopFn = null;
    this._scaleToRect = null;
  }

  _nowMs() {
    if (typeof millis === "function") return millis();
    if (typeof performance !== "undefined" && performance.now) return performance.now();
    return Date.now();
  }

  async init() {
    await ensureZXingOnce();

    if (!this.video || !this.video.elt) {
      throw new Error("QrReader.init(): missing p5 capture in {video: ...}");
    }

    this.reader = new ZXing.BrowserMultiFormatReader();

    // Wait for camera to actually have frames
    await this._waitForVideoReady(this.video.elt);
    await this._waitForRealFrames(this.video.elt);

    // AFTER we have confirmed the video can play, apply the play() guard
    this._guardVideoPlay(this.video.elt);

    this.ready = true;
    return this;
  }

  _guardVideoPlay(el) {
    if (!el || el.__playIsGuarded) return;
    el.__playIsGuarded = true;

    const origPlay = el.play?.bind(el);

    el.play = function guardedPlay() {
      // If it's already playing and has dimensions, don't spam warnings.
      if (!el.paused && el.readyState >= 2 && el.videoWidth > 0 && el.videoHeight > 0) {
        return Promise.resolve();
      }
      return origPlay ? origPlay() : Promise.resolve();
    };
  }

  start() {
    if (!this.ready || !this.reader) {
      throw new Error("QrReader.start(): call await init() first");
    }
    if (this.running) return;
    this.running = true;

    const vidEl = this.video.elt;
  syncVideoDimensions(this.video);
    const handleDecode = (result, err) => {
      // This should be spammy if ZXing is alive. If you see nothing, ZXing isn't running.
      // console.log("[QrReader] callback", result, err);

      if (!this.running) return;

      if (result) {
        const text = result.text ?? "";
        const now = this._nowMs();
        const firstEver = !this._hasResult;

        let isNew = false;

        if (text !== this._lastText) {
          isNew = true;
        } else {
          const cooldownOk = (now - this._lastNewAtMs) >= this._cooldownMs;
          if (cooldownOk && this._sawNotFoundSinceLastNew) {
            isNew = true;
          }
        }

        this._result = result;
        this._text = text;
        this._hasResult = true;

        this._hasNew = isNew || firstEver;
        if (this._hasNew) {
          this._lastText = text;
          this._lastNewAtMs = now;
          this._sawNotFoundSinceLastNew = false;

          if (this._onResult) {
            try { this._onResult(result); }
            catch (e) { console.warn("[QrReader] onResult threw:", e); }
          }
        }
      } else if (err) {
        if (err instanceof ZXing.NotFoundException) {
          this._sawNotFoundSinceLastNew = true;
        } else {
          console.error("[QrReader] ZXing error:", err);
        }
      }
    };

    // First choice: decodeFromVideoDevice (battle-tested)
    if (typeof this.reader.decodeFromVideoDevice === "function") {
      try {
        this.reader.decodeFromVideoDevice(null, vidEl, handleDecode);
        this._stopFn = () => { try { this.reader.reset(); } catch {} };
        return;
      } catch (e) {
        console.warn("[QrReader] decodeFromVideoDevice threw, falling back:", e);
      }
    }

    // Fallback: decodeFromVideoElementContinuously / decodeFromVideoElement
    const alt =
      this.reader.decodeFromVideoElementContinuously ||
      this.reader.decodeFromVideoElement ||
      null;

    if (alt) {
      alt.call(this.reader, vidEl, handleDecode);
      this._stopFn = () => { try { this.reader.reset(); } catch {} };
      return;
    }

    console.error("[QrReader] No suitable decode method found on ZXing reader.");
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    try { this._stopFn && this._stopFn(); } catch {}
    this._stopFn = null;
  }

  dispose() {
    this.stop();
  }

  hasResult()        { return this._hasResult; }
  hasNewResult()     { return this._hasNew; }
  resetNewFlag()     { this._hasNew = false; }
  consumeNew() {
    const wasNew = this._hasNew;
    this._hasNew = false;
    return { wasNew, text: this._text, result: this._result };
  }
  getLatest()        { return { text: this._text, result: this._result }; }
  getlatest()        { return this.getLatest(); }
  getText()          { return this._text; }
  getResult()        { return this._result; }

  scaleTo(w, h, x = 0, y = 0) {
    const vidEl = this.video?.elt;
    const vw = Math.max(1, vidEl?.videoWidth || this.video?.width || width || 1);
    const vh = Math.max(1, vidEl?.videoHeight || this.video?.height || height || 1);

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
    const vidEl = this.video?.elt;
    const drawSource = this.videoP5 || this.video;
    if (!drawSource || !vidEl) return;
    const vw = vidEl?.videoWidth || this.video?.width || width;
    const vh = vidEl?.videoHeight || this.video?.height || height;
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

  drawOverlay(x = 0, y = 0, w = null, h = null) {
    if (!this._result || typeof line !== "function") return;

    const vidEl = this.video?.elt;
    const vw = vidEl?.videoWidth  || this.video?.width  || width;
    const vh = vidEl?.videoHeight || this.video?.height || height;

    const pts = Array.isArray(this._result.resultPoints)
      ? this._result.resultPoints
      : [];

    const mapped =
      w == null && h == null && this._scaleToRect
        ? this._mapResultPointsToCover(pts, this._scaleToRect)
        : this._mapResultPointsToRect(pts, x, y, w ?? vw, h ?? vh, vw, vh);

    if (mapped.length < 2) return;

    push();
    noFill();
    stroke(0);
    strokeWeight(3);

    const L = 18;
    for (const p of mapped) {
      line(p.x - L, p.y, p.x - L/2, p.y);
      line(p.x + L, p.y, p.x + L/2, p.y);
      line(p.x, p.y - L, p.x, p.y - L/2);
      line(p.x, p.y + L, p.x, p.y + L/2);
    }

    for (let i = 0; i < mapped.length - 1; i++) {
      const a = mapped[i];
      const b = mapped[i + 1];
      line(a.x, a.y, b.x, b.y);
    }

    pop();
  }

  _mapResultPointsToRect(points, x, y, w, h, vw, vh) {
    const sx = w / vw;
    const sy = h / vh;
    return points
      .map((p) => {
        if (!p || p.x == null || p.y == null) return null;
        const px = this.videoIsFlipped ? vw - p.x : p.x;
        return { x: x + px * sx, y: y + p.y * sy };
      })
      .filter(Boolean);
  }

  _mapResultPointsToCover(points, rect) {
    const vidEl = this.video?.elt;
    const vw = vidEl?.videoWidth || this.video?.width || width;
    return points
      .map((p) => {
        if (!p || p.x == null || p.y == null) return null;
        const px = this.videoIsFlipped ? vw - p.x : p.x;
        return {
          x: rect.offsetX + px * rect.scale,
          y: rect.offsetY + p.y * rect.scale,
        };
      })
      .filter(Boolean);
  }

  _computeCoverRect(x, y, w, h) {
    const vidEl = this.video?.elt;
    const vw = Math.max(1, vidEl?.videoWidth || this.video?.width || width || 1);
    const vh = Math.max(1, vidEl?.videoHeight || this.video?.height || height || 1);
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

  async _waitForVideoReady(videoEl) {
    try {
      videoEl.setAttribute?.("playsinline", "");
      await videoEl.play?.();
    } catch {}

    const ready = () =>
      videoEl.readyState >= 2 &&
      videoEl.videoWidth  > 0 &&
      videoEl.videoHeight > 0;

    if (ready()) return;

    await new Promise((resolve) => {
      const on = () => {
        if (ready()) {
          videoEl.removeEventListener?.("loadeddata", on);
          videoEl.removeEventListener?.("loadedmetadata", on);
          resolve();
        }
      };
      videoEl.addEventListener?.("loadeddata", on);
      videoEl.addEventListener?.("loadedmetadata", on);

      const id = setInterval(() => {
        if (ready()) {
          clearInterval(id);
          resolve();
        }
      }, 50);
    });

    if (!videoEl.width || !videoEl.height) {
      videoEl.width  = videoEl.videoWidth;
      videoEl.height = videoEl.videoHeight;
    }
  }

  async _waitForRealFrames(videoEl, minFrames = 2, timeoutMs = 4000) {
    try {
      videoEl.setAttribute("playsinline", "");
      await videoEl.play?.();
    } catch {}

    const now = () =>
      (typeof performance !== "undefined" ? performance.now() : Date.now());
    const t0 = now();

    if (typeof videoEl.requestVideoFrameCallback === "function") {
      let seen = 0;
      await new Promise((resolve) => {
        const onF = () => {
          seen++;
          if (seen >= minFrames || (now() - t0) > timeoutMs) {
            resolve();
          } else {
            videoEl.requestVideoFrameCallback(onF);
          }
        };
        videoEl.requestVideoFrameCallback(onF);
      });
      return;
    }

    if (videoEl.readyState < 2) {
      await new Promise((resolve) => {
        const onPlay = () => {
          videoEl.removeEventListener("playing", onPlay);
          resolve();
        };
        videoEl.addEventListener("playing", onPlay);
        setTimeout(resolve, timeoutMs);
      });
    }

    await new Promise(r =>
      requestAnimationFrame(() => requestAnimationFrame(r))
    );
  }
}
