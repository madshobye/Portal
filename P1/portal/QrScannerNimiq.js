let __nimiqQrScannerLoadPromise = null;

function ensureNimiqQrScannerOnce() {
  if (__nimiqQrScannerLoadPromise) return __nimiqQrScannerLoadPromise;
  __nimiqQrScannerLoadPromise = (async () => {
    if (!window.QrScanner) {
      console.log("[QrScannerNimiq] Loading qr-scanner...");
      await loadScript("https://cdn.jsdelivr.net/npm/qr-scanner@1.4.2/qr-scanner.legacy.min.js");
      console.log("[QrScannerNimiq] qr-scanner loaded.");
    } else {
      console.log("[QrScannerNimiq] qr-scanner already present.");
    }
  })();
  return __nimiqQrScannerLoadPromise;
}

class QrScannerNimiq {
  constructor({
    video,
    videoIsFlipped = false,
    onResult = null,
    preferredCamera = "environment",
    maxScansPerSecond = 12,
  } = {}) {
    this.video = video;
    this.videoP5 = video?.elt ? video : null;
    this.videoIsFlipped = videoIsFlipped;
    this.preferredCamera = preferredCamera;
    this.maxScansPerSecond = maxScansPerSecond;
    this._onResult = typeof onResult === "function" ? onResult : null;

    this.scanner = null;
    this.ready = false;
    this.running = false;
    this._scanTimer = null;
    this._scanIntervalMs = Math.max(50, Math.round(1000 / Math.max(1, maxScansPerSecond)));
    this._scanCanvas = null;
    this._scanContext = null;

    this._result = null;
    this._text = "";
    this._hasResult = false;
    this._hasNew = false;
    this._scaleToRect = null;
  }

  async init() {
    await ensureNimiqQrScannerOnce();

    if (!this.video?.elt) {
      throw new Error("QrScannerNimiq.init(): missing p5 capture in {video: ...}");
    }

    const videoEl = this.video.elt;
    console.log("[QrScannerNimiq] waiting for video readiness...");
    await this._waitForVideoReady(videoEl);
    console.log("[QrScannerNimiq] video ready", {
      width: videoEl.videoWidth,
      height: videoEl.videoHeight,
      readyState: videoEl.readyState,
    });

    this.ready = true;
    console.log("[QrScannerNimiq] init complete");
    return this;
  }

  async start() {
    if (!this.ready) {
      throw new Error("QrScannerNimiq.start(): call await init() first");
    }
    if (this.running) return;
    this.running = true;
    console.log("[QrScannerNimiq] starting scanner...");
    console.log("[QrScannerNimiq] scanner started");
    this._scheduleNextScan(0);
  }

  stop() {
    this.running = false;
    if (this._scanTimer) {
      clearTimeout(this._scanTimer);
      this._scanTimer = null;
    }
  }

  destroy() {
    this.running = false;
    if (this._scanTimer) {
      clearTimeout(this._scanTimer);
      this._scanTimer = null;
    }
  }

  hasResult() {
    return this._hasResult;
  }

  hasNewResult() {
    return this._hasNew;
  }

  consumeNew() {
    const out = {
      wasNew: this._hasNew,
      text: this._text,
      result: this._result,
    };
    this._hasNew = false;
    return out;
  }

  getLatest() {
    return { text: this._text, result: this._result };
  }

  getText() {
    return this._text;
  }

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

  drawImage(...args) {
    if (typeof image !== "function") return;
    const vidEl = this.video?.elt;
    const drawSource = this.videoP5 || this.video;
    if (!drawSource || !vidEl) return;
    const vw = vidEl?.videoWidth || this.video?.width || width;
    const vh = vidEl?.videoHeight || this.video?.height || height;
    const rect = this._resolveRectArgs(args);

    if (rect.w == null && rect.h == null && this._scaleToRect) {
      const r = this._scaleToRect;
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
    const points = this._result?.cornerPoints;
    if (!Array.isArray(points) || points.length < 2 || typeof line !== "function") return;

    const vidEl = this.video?.elt;
    const vw = vidEl?.videoWidth || this.video?.width || width;
    const vh = vidEl?.videoHeight || this.video?.height || height;

    const mapped =
      w == null && h == null && this._scaleToRect
        ? this._mapResultPointsToCover(points, this._scaleToRect)
        : this._mapResultPointsToRect(points, x, y, w ?? vw, h ?? vh, vw, vh);

    if (mapped.length < 2) return;

    push();
    noFill();
    stroke(0, 255, 140);
    strokeWeight(3);

    beginShape();
    for (const p of mapped) vertex(p.x, p.y);
    endShape(CLOSE);

    pop();
  }

  _handleResult(result) {
    const text = result?.data || result?.text || "";
    console.log("[QrScannerNimiq] result", result);
    this._result = result || null;
    this._text = text;
    this._hasResult = !!text;
    this._hasNew = !!text;

    if (this._onResult) {
      try {
        this._onResult(result);
      } catch (error) {
        console.warn("[QrScannerNimiq] onResult threw:", error);
      }
    }
  }

  _scheduleNextScan(delay = this._scanIntervalMs) {
    if (!this.running) return;
    if (this._scanTimer) clearTimeout(this._scanTimer);
    this._scanTimer = setTimeout(() => {
      this._scanTimer = null;
      this._scanOnce();
    }, delay);
  }

  async _scanOnce() {
    if (!this.running) return;
    const videoEl = this.video?.elt;
    if (!videoEl || videoEl.readyState < 2 || videoEl.videoWidth <= 0 || videoEl.videoHeight <= 0) {
      this._scheduleNextScan();
      return;
    }

    try {
      const scanCanvas = this._getScanCanvas(videoEl);
      const scanContext = this._scanContext;
      if (!scanCanvas || !scanContext) {
        this._scheduleNextScan();
        return;
      }

      scanContext.drawImage(videoEl, 0, 0, scanCanvas.width, scanCanvas.height);

      const result = await window.QrScanner.scanImage(scanCanvas, {
        returnDetailedScanResult: true,
      });
      if (result) this._handleResult(result);
    } catch (error) {
      const msg = String(error?.message || error || "");
      if (msg && msg !== "No QR code found" && msg !== "No QR code found.") {
        console.warn("[QrScannerNimiq] decode error:", error);
      }
    }

    this._scheduleNextScan();
  }

  _getScanCanvas(videoEl) {
    const vw = Math.max(1, videoEl?.videoWidth || 0);
    const vh = Math.max(1, videoEl?.videoHeight || 0);
    if (!(vw > 0 && vh > 0)) return null;

    const maxDim = 960;
    const scale = Math.min(1, maxDim / Math.max(vw, vh));
    const targetW = Math.max(1, Math.round(vw * scale));
    const targetH = Math.max(1, Math.round(vh * scale));

    if (!this._scanCanvas) {
      this._scanCanvas = document.createElement("canvas");
      this._scanContext = this._scanCanvas.getContext("2d", { willReadFrequently: true });
    }

    if (
      this._scanCanvas.width !== targetW ||
      this._scanCanvas.height !== targetH
    ) {
      this._scanCanvas.width = targetW;
      this._scanCanvas.height = targetH;
    }

    return this._scanCanvas;
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

  _resolveRectArgs(args) {
    const a = Array.isArray(args) ? args : [];
    if (!a.length) return { x: 0, y: 0, w: null, h: null };
    const toSize = (v) => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
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
      videoEl.videoWidth > 0 &&
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
  }

}

window.QrScannerNimiq = QrScannerNimiq;
