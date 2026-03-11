// MultiTouch helper for Portal sketches.
// Features:
// - tracks multiple active touches with stable identifiers
// - optional preventDefault to stop page scrolling/zoom gestures
// - drawTouches() helper for quick visual debugging
//
// Example:
//   await loadScript("portal/multiTouch.js");
//   const multiTouch = await new MultiTouch().init();
//   await multiTouch.start();
//   multiTouch.drawTouches();

class MultiTouch {
  constructor({
    target = null,
    preventDefault = true,
    colors = null,
    radius = 24,
    onResults = null,
  } = {}) {
    this.target = target || window;
    this.preventDefault = !!preventDefault;
    this.colors = Array.isArray(colors) && colors.length
      ? colors.slice()
      : ["#ff4d4d", "#52d273", "#4d7cff", "#ffd24d", "#3dd9d6", "#ff66c4"];
    this.radius = Math.max(2, Number(radius) || 24);
    this._onResults = typeof onResults === "function" ? onResults : null;

    this.ready = false;
    this.running = false;

    this._touchMap = new Map();
    this._orderedIds = [];
    this._hasResult = false;
    this._hasNew = false;

    this._boundStart = this._handleTouchStart.bind(this);
    this._boundMove = this._handleTouchMove.bind(this);
    this._boundEnd = this._handleTouchEnd.bind(this);
    this._boundCancel = this._handleTouchEnd.bind(this);
  }

  async init() {
    this.ready = true;
    return this;
  }

  async start() {
    if (!this.ready) throw new Error("MultiTouch: call init() before start()");
    if (this.running) return this;

    const target = this._resolveTarget();
    target.addEventListener("touchstart", this._boundStart, { passive: false });
    target.addEventListener("touchmove", this._boundMove, { passive: false });
    target.addEventListener("touchend", this._boundEnd, { passive: false });
    target.addEventListener("touchcancel", this._boundCancel, { passive: false });

    if (this.preventDefault) this._applyTouchActionNone(target);

    this.running = true;
    return this;
  }

  stop() {
    if (!this.running) return;
    const target = this._resolveTarget();
    target.removeEventListener("touchstart", this._boundStart);
    target.removeEventListener("touchmove", this._boundMove);
    target.removeEventListener("touchend", this._boundEnd);
    target.removeEventListener("touchcancel", this._boundCancel);
    this.running = false;
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

  getTouches() {
    return this._orderedIds
      .map((id) => this._touchMap.get(id))
      .filter(Boolean)
      .map((touch) => ({ ...touch }));
  }

  getTouchesRaw() {
    return this._orderedIds
      .map((id) => this._touchMap.get(id))
      .filter(Boolean);
  }

  getTouchCount() {
    return this._touchMap.size;
  }

  getFirstTouch() {
    return this.getTouches()[0] || null;
  }

  getTouchById(id) {
    const touch = this._touchMap.get(Number(id));
    return touch ? { ...touch } : null;
  }

  drawTouches({
    radius = this.radius,
    showLabels = false,
    labels = "id",
  } = {}) {
    if (typeof ellipse !== "function") return;

    const touches = this.getTouchesRaw();
    noStroke();

    for (let i = 0; i < touches.length; i++) {
      const touch = touches[i];
      fill(this._colorForIndex(i));
      ellipse(touch.x, touch.y, radius, radius);

      if (showLabels && typeof text === "function") {
        fill(255);
        textSize(12);
        const label = labels === "index" ? String(i) : String(touch.id);
        text(label, touch.x + radius * 0.55, touch.y - radius * 0.55);
      }
    }
  }

  _resolveTarget() {
    return this.target || window;
  }

  _applyTouchActionNone(target) {
    const styleTarget =
      target === window ? document.documentElement : target?.style ? target : null;
    if (!styleTarget?.style) return;
    styleTarget.style.touchAction = "none";
    styleTarget.style.webkitUserSelect = "none";
    styleTarget.style.userSelect = "none";
  }

  _handleTouchStart(ev) {
    this._updateTouches(ev, "start");
  }

  _handleTouchMove(ev) {
    this._updateTouches(ev, "move");
  }

  _handleTouchEnd(ev) {
    this._updateTouches(ev, "end");
  }

  _updateTouches(ev, phase) {
    if (this.preventDefault && typeof ev.preventDefault === "function") {
      ev.preventDefault();
    }

    const changed = Array.from(ev.changedTouches || []);

    for (const t of changed) {
      const id = Number(t.identifier);
      if (phase === "end") {
        this._touchMap.delete(id);
        this._orderedIds = this._orderedIds.filter((v) => v !== id);
        continue;
      }

      const prev = this._touchMap.get(id);
      const next = {
        id,
        x: Number(t.clientX),
        y: Number(t.clientY),
        px: Number(prev?.x ?? t.clientX),
        py: Number(prev?.y ?? t.clientY),
        dx: Number(t.clientX - (prev?.x ?? t.clientX)),
        dy: Number(t.clientY - (prev?.y ?? t.clientY)),
        active: true,
      };

      this._touchMap.set(id, next);
      if (!this._orderedIds.includes(id)) this._orderedIds.push(id);
    }

    if (phase === "end") {
      for (const activeTouch of Array.from(ev.touches || [])) {
        const id = Number(activeTouch.identifier);
        const prev = this._touchMap.get(id);
        const next = {
          id,
          x: Number(activeTouch.clientX),
          y: Number(activeTouch.clientY),
          px: Number(prev?.x ?? activeTouch.clientX),
          py: Number(prev?.y ?? activeTouch.clientY),
          dx: Number(activeTouch.clientX - (prev?.x ?? activeTouch.clientX)),
          dy: Number(activeTouch.clientY - (prev?.y ?? activeTouch.clientY)),
          active: true,
        };
        this._touchMap.set(id, next);
        if (!this._orderedIds.includes(id)) this._orderedIds.push(id);
      }
    }

    this._hasResult = this._touchMap.size > 0;
    this._hasNew = true;

    if (this._onResults) {
      try {
        this._onResults(this.getTouches());
      } catch (err) {
        console.warn("MultiTouch onResults callback error:", err);
      }
    }
  }

  _colorForIndex(index) {
    return this.colors[index % this.colors.length];
  }
}
