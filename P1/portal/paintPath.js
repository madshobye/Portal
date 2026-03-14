// Basic smoothed paint path helper for Portal sketches.
//
// Responsibilities:
// - record raw pointer points with a minimum spacing
// - build a smoothed Catmull-Rom style curve from those points
// - resample that curve at a fixed distance
//
// Rendering is intentionally left to the sketch or brush module.

class PortalPaintPath {
  constructor({
    rawSpacing = 2,
    sampleSpacing = 8,
    curveSegmentLength = 8,
    maxRawPoints = 0,
  } = {}) {
    this.rawSpacing = Math.max(0.1, Number(rawSpacing) || 2);
    this.sampleSpacing = Math.max(0.1, Number(sampleSpacing) || 8);
    this.curveSegmentLength = Math.max(1, Number(curveSegmentLength) || 8);
    this.maxRawPoints = Math.max(0, Number(maxRawPoints) || 0);
    this.rawPoints = [];
    this.sampledPoints = [];
  }

  reset() {
    this.rawPoints = [];
    this.sampledPoints = [];
  }

  setOptions({
    rawSpacing = this.rawSpacing,
    sampleSpacing = this.sampleSpacing,
    curveSegmentLength = this.curveSegmentLength,
    maxRawPoints = this.maxRawPoints,
  } = {}) {
    this.rawSpacing = Math.max(0.1, Number(rawSpacing) || this.rawSpacing);
    this.sampleSpacing = Math.max(0.1, Number(sampleSpacing) || this.sampleSpacing);
    this.curveSegmentLength = Math.max(1, Number(curveSegmentLength) || this.curveSegmentLength);
    this.maxRawPoints = Math.max(0, Number(maxRawPoints) || 0);
    this._rebuild();
    return this;
  }

  addPoint(x, y) {
    const point = { x: Number(x), y: Number(y) };
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;

    const prev = this.rawPoints[this.rawPoints.length - 1];
    if (!prev) {
      this.rawPoints.push(point);
      this.sampledPoints = [point];
      return true;
    }

    if (PortalPaintPath.distance(prev, point) < this.rawSpacing) {
      return false;
    }

    this.rawPoints.push(point);
    if (this.maxRawPoints > 0 && this.rawPoints.length > this.maxRawPoints) {
      this.rawPoints = this.rawPoints.slice(-this.maxRawPoints);
    }
    this._rebuild();
    return true;
  }

  getRawPoints() {
    return this.rawPoints.map((p) => ({ x: p.x, y: p.y }));
  }

  getSampledPoints() {
    return this.sampledPoints.map((p) => ({ x: p.x, y: p.y }));
  }

  _rebuild() {
    if (this.rawPoints.length === 0) {
      this.sampledPoints = [];
      return;
    }
    if (this.rawPoints.length === 1) {
      this.sampledPoints = this.getRawPoints();
      return;
    }
    const curvePoints = PortalPaintPath.buildCurvePoints(
      this.rawPoints,
      this.curveSegmentLength
    );
    this.sampledPoints = PortalPaintPath.resampleCurvePoints(
      curvePoints,
      this.sampleSpacing
    );
  }

  static distance(a, b) {
    return Math.hypot((b.x || 0) - (a.x || 0), (b.y || 0) - (a.y || 0));
  }

  static buildCurvePoints(rawPoints, curveSegmentLength = 8) {
    if (!Array.isArray(rawPoints) || rawPoints.length < 2) {
      return Array.isArray(rawPoints) ? rawPoints.slice() : [];
    }
    const out = [{ x: rawPoints[0].x, y: rawPoints[0].y }];
    for (let i = 0; i < rawPoints.length - 1; i++) {
      const p0 = rawPoints[Math.max(0, i - 1)];
      const p1 = rawPoints[i];
      const p2 = rawPoints[i + 1];
      const p3 = rawPoints[Math.min(rawPoints.length - 1, i + 2)];
      const segmentLength = PortalPaintPath.distance(p1, p2);
      const steps = Math.max(6, Math.ceil(segmentLength / curveSegmentLength));
      for (let step = 1; step <= steps; step++) {
        const t = step / steps;
        out.push(PortalPaintPath.catmullRomPoint(p0, p1, p2, p3, t));
      }
    }
    return out;
  }

  static catmullRomPoint(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return {
      x: 0.5 * (
        (2 * p1.x) +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
      ),
      y: 0.5 * (
        (2 * p1.y) +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
      ),
    };
  }

  static resampleCurvePoints(points, spacing) {
    if (!Array.isArray(points) || points.length === 0) return [];
    const out = [{ x: points[0].x, y: points[0].y }];
    let last = out[0];
    for (let i = 1; i < points.length; i++) {
      const current = points[i];
      let d = PortalPaintPath.distance(last, current);
      while (d >= spacing) {
        const dx = current.x - last.x;
        const dy = current.y - last.y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-9) break;
        last = {
          x: last.x + (dx / len) * spacing,
          y: last.y + (dy / len) * spacing,
        };
        out.push(last);
        d = PortalPaintPath.distance(last, current);
      }
    }
    return out;
  }
}

window.PortalPaintPath = PortalPaintPath;
