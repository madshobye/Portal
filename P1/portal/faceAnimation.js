class PortalFaceAnimation {
  constructor({
    seed = Math.random() * 1000,
    skinTone = [240, 228, 214],
    paperTone = [236, 233, 225],
    inkTone = [17, 17, 17],
    accentTone = [216, 31, 38],
    hairTone = [20, 22, 28],
  } = {}) {
    this.seed = Number(seed) || 0;
    this.skinTone = skinTone.slice(0, 3);
    this.paperTone = paperTone.slice(0, 3);
    this.inkTone = inkTone.slice(0, 3);
    this.accentTone = accentTone.slice(0, 3);
    this.hairTone = hairTone.slice(0, 3);

    this.time = 0;
    this.blink = 0;
    this.nextBlinkAt = 1.1;

    this.state = this._makePose();
    this.target = this._makePose({
      valence: -0.2,
      arousal: 0.25,
      dominance: 0.45,
      tension: 0.55,
    });
  }

  _makePose(next = {}) {
    return {
      valence: this._clamp(next.valence, -1, 1, 0),
      arousal: this._clamp(next.arousal, -1, 1, 0),
      dominance: this._clamp(next.dominance, -1, 1, 0),
      tension: this._clamp(next.tension, 0, 1, 0),
      speaking: this._clamp(next.speaking, 0, 1, 0),
      listening: this._clamp(next.listening, 0, 1, 0),
      thinking: this._clamp(next.thinking, 0, 1, 0),
      gazeX: this._clamp(next.gazeX, -1, 1, 0),
      gazeY: this._clamp(next.gazeY, -1, 1, 0),
      headTurn: this._clamp(next.headTurn, -1, 1, 0),
      headTilt: this._clamp(next.headTilt, -1, 1, 0),
      headPitch: this._clamp(next.headPitch, -1, 1, 0),
    };
  }

  setTarget(next = {}) {
    this.target = {
      ...this.target,
      ...this._makePose({ ...this.target, ...next }),
    };
  }

  setState(next = {}) {
    this.setTarget(next);
  }

  update(dt = 1 / 60) {
    const t = this._clamp(dt, 1 / 240, 0.12, 1 / 60);
    this.time += t;
    const smooth = 1 - Math.pow(0.0007, t);

    for (const key of Object.keys(this.state)) {
      this.state[key] = this._lerp(this.state[key], this.target[key], smooth);
    }

    if (this.time >= this.nextBlinkAt) {
      this.blink += t * 9;
      if (this.blink >= 1) {
        this.blink = 0;
        this.nextBlinkAt = this.time + this._clamp(2.0 - this.state.arousal * 0.6 + this._noise(this.time * 0.8) * 0.35, 1.0, 2.9, 1.8);
      }
    }
  }

  render({ p = null, x = 0, y = 0, w = 300, h = 420 } = {}) {
    const g = p || window;
    const portraitW = 108;
    const portraitH = 140;
    const scale = Math.min(w / portraitW, h / portraitH) * 1.02;
    const drawW = portraitW * scale;
    const drawH = portraitH * scale;
    const originX = x + (w - drawW) * 0.5;
    const originY = y + (h - drawH) * 0.02;

    const s = this.state;
    const talking = 0.5 + 0.5 * Math.sin(this.time * 15 + this.seed);
    const mouthOpen = this._clamp(0.04 + s.speaking * (0.1 + 0.45 * talking), 0.03, 0.7, 0.06);
    const eyeOpen = this._clamp(
      0.44
        + 0.16 * Math.max(0, s.arousal)
        - 0.26 * s.tension
        - 0.12 * Math.max(0, s.dominance)
        + 0.1 * Math.max(0, s.valence)
        - this.blink * 0.75,
      0.04,
      0.82,
      0.42
    );
    const browPinch =
      0.18
      + 0.6 * s.tension
      + 0.26 * Math.max(0, s.dominance)
      + 0.24 * Math.max(0, -s.valence)
      - 0.12 * Math.max(0, s.valence);
    const mouthCurve =
      -0.16
      - 0.52 * Math.max(0, -s.valence)
      + 0.32 * Math.max(0, s.valence)
      - 0.12 * Math.max(0, s.tension - 0.45);
    const headTurn = s.headTurn * 4.6;
    const headTilt = s.headTilt * 0.11;
    const chinDrop = s.headPitch * 4.1;

    g.push();
    g.translate(originX + drawW * 0.5, originY + drawH * 0.5 - 50);
    g.scale(scale);
    g.rotate(headTilt);
    g.translate(headTurn, chinDrop);

    this._drawUpperBody(g, s);
    this._drawNeck(g);
    this._drawCollar(g);
    this._drawHat(g);
    this._drawHair(g, s);
    this._drawFaceShape(g, s);
    this._drawEars(g);
    this._drawEyes(g, eyeOpen, s);
    this._drawBrows(g, browPinch, s);
    this._drawNose(g, s);
    this._drawMouth(g, mouthCurve, mouthOpen, s);

    g.pop();
  }

  _drawUpperBody(g, s) {
    g.push();

    const torsoShift = s.headTurn * 1.4;
    const shoulderLift = -1.1 * Math.max(0, s.tension - 0.2);
    const chestRise = 1.2 * Math.max(0, s.arousal);

    g.translate(torsoShift, shoulderLift + chestRise);

    const coatFill = [235, 238, 242];
    const coatShadow = [219, 224, 231];
    const shirtFill = [247, 245, 240];

    g.noStroke();
    g.fill(coatShadow[0], coatShadow[1], coatShadow[2], 255);
    this._filledBezierShape(g, [
      [-46, 114],
      [-55, 116, -63, 126, -66, 144],
      [-69, 166, -63, 204, -49, 246],
      [-38, 276, -24, 301, -8, 320],
      [0, 329, 0, 329, 8, 320],
      [24, 301, 38, 276, 49, 246],
      [63, 204, 69, 166, 66, 144],
      [63, 126, 55, 116, 46, 114],
      [29, 107, 13, 102, 0, 101],
      [-13, 102, -29, 107, -46, 114],
    ]);

    g.fill(coatFill[0], coatFill[1], coatFill[2], 255);
    this._filledBezierShape(g, [
      [-42, 114],
      [-52, 116, -60, 126, -63, 146],
      [-66, 170, -58, 213, -42, 262],
      [-31, 293, -17, 316, -4, 334],
      [0, 339, 0, 339, 4, 334],
      [17, 316, 31, 293, 42, 262],
      [58, 213, 66, 170, 63, 146],
      [60, 126, 52, 116, 42, 114],
      [27, 109, 12, 105, 0, 104],
      [-12, 105, -27, 109, -42, 114],
    ]);

    g.fill(shirtFill[0], shirtFill[1], shirtFill[2], 252);
    this._filledBezierShape(g, [
      [-15, 118],
      [-21, 135, -19, 183, -14, 233],
      [-10, 273, -5, 307, 0, 334],
      [5, 307, 10, 273, 14, 233],
      [19, 183, 21, 135, 15, 118],
      [9, 114, 4, 112, 0, 112],
      [-4, 112, -9, 114, -15, 118],
    ]);

    g.stroke(this.inkTone[0], this.inkTone[1], this.inkTone[2], 170);
    g.strokeWeight(1.6);
    g.noFill();
    this._openBezier(g, -42, 114, -52, 116, -60, 126, -63, 146);
    this._openBezier(g, -63, 146, -66, 170, -58, 213, -42, 262);
    this._openBezier(g, -42, 262, -31, 293, -17, 316, -4, 334);
    this._openBezier(g, 4, 334, 17, 316, 31, 293, 42, 262);
    this._openBezier(g, 42, 262, 58, 213, 66, 170, 63, 146);
    this._openBezier(g, 63, 146, 60, 126, 52, 116, 42, 114);
    this._openBezier(g, -30, 111, -18, 107, -8, 105, 0, 105);
    this._openBezier(g, 0, 105, 8, 105, 18, 107, 30, 111);

    g.strokeWeight(1.2);
    g.stroke(this.inkTone[0], this.inkTone[1], this.inkTone[2], 110);
    this._openBezier(g, 0, 125, 0, 181, 0, 244, 0, 325);
    this._openBezier(g, -50, 128, -58, 142, -57, 164, -51, 181);
    this._openBezier(g, 50, 128, 58, 142, 57, 164, 51, 181);

    g.strokeWeight(1.4);
    g.stroke(this.inkTone[0], this.inkTone[1], this.inkTone[2], 155);
    this._openBezier(g, -26, 121, -24, 150, -21, 188, -17, 238);
    this._openBezier(g, 26, 121, 24, 150, 21, 188, 17, 238);

    g.noFill();
    this._openBezier(g, -11, 122, -18, 133, -20, 150, -18, 166);
    this._openBezier(g, 11, 122, 18, 133, 20, 150, 18, 166);

    g.pop();
  }

  _drawHat(g) {
    g.push();
    g.noStroke();
    g.fill(252, 251, 248);
    this._filledBezierShape(g, [
      [-34, -20],
      [-31, -44, -17, -56, 0, -58],
      [17, -56, 31, -44, 34, -20],
      [25, -8, 14, 0, 0, 2],
      [-14, 0, -25, -8, -34, -20],
    ]);

    g.stroke(this.inkTone[0], this.inkTone[1], this.inkTone[2]);
    g.strokeWeight(1.8);
    g.noFill();
    this._openBezier(g, -34, -20, -29, -40, -13, -54, 0, -56);
    this._openBezier(g, 0, -56, 13, -54, 29, -40, 34, -20);
    this._openBezier(g, -25, -10, -13, -2, 13, -2, 25, -10);

    g.noStroke();
    g.fill(this.accentTone[0], this.accentTone[1], this.accentTone[2]);
    g.rectMode(g.CENTER);
    g.rect(0, -34, 16, 16);
    g.fill(252, 251, 248);
    g.rect(0, -34, 5, 17);
    g.rect(0, -34, 17, 5);
    g.pop();
  }

  _drawHair(g, s) {
    g.push();
    g.noStroke();
    g.fill(this.hairTone[0], this.hairTone[1], this.hairTone[2]);
    this._filledBezierShape(g, [
      [-30, 2],
      [-27, -8, -16, -16, 0, -18],
      [16, -16, 27, -8, 30, 2],
      [23, 0, 14, -2, 0, -2],
      [-14, -2, -23, 0, -30, 2],
    ]);
    g.pop();
  }

  _drawFaceShape(g, s) {
    g.push();
    g.noStroke();
    g.fill(this.skinTone[0], this.skinTone[1], this.skinTone[2]);

    const cheekInset = 1.2 + s.headTurn * 1.1;
    const jawNarrow = 12.5 + s.tension * 3.2;
    const chinPoint = 36 + s.headPitch * 2.5;

    g.beginShape();
    this._bezierVertices(g, -28, 2, -32, 16, -28 + cheekInset, 28, -21, 36);
    this._bezierVertices(g, -18, 36, -16, 44, -12, 52, -jawNarrow, 60);
    this._bezierVertices(g, -jawNarrow, 60, -5, 66, 5, 66, jawNarrow, 60);
    this._bezierVertices(g, jawNarrow, 60, 12, 52, 16, 44, 18, 36);
    this._bezierVertices(g, 18, 36, 28 - cheekInset, 28, 32, 16, 28, 2);
    this._bezierVertices(g, 28, 2, 18, -10, 11, -16, 0, -18);
    this._bezierVertices(g, 0, -18, -11, -16, -18, -10, -28, 2);
    g.endShape(g.CLOSE);

    g.stroke(this.inkTone[0], this.inkTone[1], this.inkTone[2]);
    g.strokeWeight(1.8);
    g.noFill();
    this._openBezier(g, -28, 2, -32, 16, -28 + cheekInset, 28, -21, 36);
    this._openBezier(g, -18, 36, -16, 44, -12, 52, -jawNarrow, 60);
    this._openBezier(g, -jawNarrow, 60, -5, 66, 5, 66, jawNarrow, 60);
    this._openBezier(g, jawNarrow, 60, 12, 52, 16, 44, 18, 36);
    this._openBezier(g, 18, 36, 28 - cheekInset, 28, 32, 16, 28, 2);
    this._openBezier(g, 28, 2, 18, -10, 11, -16, 0, -18);
    this._openBezier(g, 0, -18, -11, -16, -18, -10, -28, 2);

    g.pop();
  }

  _drawEars(g) {
    g.push();
    g.noFill();
    g.stroke(this.inkTone[0], this.inkTone[1], this.inkTone[2]);
    g.strokeWeight(1.4);
    this._openBezier(g, -28, 16, -34, 18, -34, 28, -28, 32);
    this._openBezier(g, 28, 16, 34, 18, 34, 28, 28, 32);
    g.pop();
  }

  _drawEyes(g, eyeOpen, s) {
    const gazeX = s.gazeX * 1.5;
    const gazeY = s.gazeY * 1.1;
    this._drawEye(g, -14, 18, eyeOpen, gazeX, gazeY);
    this._drawEye(g, 14, 18, eyeOpen, gazeX, gazeY);
  }

  _drawEye(g, x, y, eyeOpen, gazeX, gazeY) {
    const eyeW = 10;
    const eyeH = Math.max(1.5, 6.5 * eyeOpen);

    g.push();
    g.noStroke();
    g.fill(252, 251, 248);
    this._filledBezierShape(g, [
      [x - eyeW, y],
      [x - 6, y - eyeH, x + 6, y - eyeH, x + eyeW, y],
      [x + 6, y + eyeH, x - 6, y + eyeH, x - eyeW, y],
    ]);

    g.fill(this.inkTone[0], this.inkTone[1], this.inkTone[2]);
    g.circle(x + gazeX * 0.7, y + gazeY * 0.5, 3.7);

    g.stroke(this.inkTone[0], this.inkTone[1], this.inkTone[2]);
    g.strokeWeight(1.6);
    g.noFill();
    this._openBezier(g, x - eyeW, y, x - 6, y - eyeH, x + 6, y - eyeH, x + eyeW, y);
    this._openBezier(g, x - eyeW, y, x - 6, y + eyeH, x + 6, y + eyeH, x + eyeW, y);
    g.pop();
  }

  _drawBrows(g, pinch, s) {
    const arch = -1.2 - pinch * 1.4;
    const slant = 2.2 + pinch * 2.4 + Math.max(0, s.dominance) * 1.2;
    g.push();
    g.stroke(this.inkTone[0], this.inkTone[1], this.inkTone[2]);
    g.strokeWeight(3.2);
    g.noFill();
    this._openBezier(g, -26, 14 + slant, -21, 10 + arch, -9, 10 + arch, -4, 14 - slant * 0.55);
    this._openBezier(g, 26, 14 + slant, 21, 10 + arch, 9, 10 + arch, 4, 14 - slant * 0.55);
    g.pop();
  }

  _drawNose(g, s) {
    const pinch = 0.6 + s.tension * 0.8;
    g.push();
    g.stroke(this.inkTone[0], this.inkTone[1], this.inkTone[2]);
    g.strokeWeight(1.6);
    g.noFill();
    this._openBezier(g, 0, 22, -1, 30, -2, 36, 0, 42);
    this._openBezier(g, 0, 42, -2.5 * pinch, 44.5, -2.5 * pinch, 47.5, 0, 48.5);
    this._openBezier(g, 0, 42, 2.5 * pinch, 44.5, 2.5 * pinch, 47.5, 0, 48.5);
    g.pop();
  }

  _drawMouth(g, curve, mouthOpen, s) {
    const y = 56;
    const width = 14 + s.dominance * 1.5;
    const centerDip = curve * 5;
    const openDepth = mouthOpen * 8;

    g.push();
    g.fill(this.accentTone[0], this.accentTone[1], this.accentTone[2], 55 + mouthOpen * 70);
    g.noStroke();
    this._filledBezierShape(g, [
      [-width, y],
      [-7, y + centerDip, 7, y + centerDip, width, y],
      [7, y + openDepth, -7, y + openDepth, -width, y],
    ]);

    g.stroke(this.inkTone[0], this.inkTone[1], this.inkTone[2]);
    g.strokeWeight(1.8);
    g.noFill();
    this._openBezier(g, -width, y, -7, y + centerDip, 7, y + centerDip, width, y);
    g.pop();
  }

  _drawNeck(g) {
    g.push();
    g.fill(232, 218, 202);
    g.noStroke();
    g.quad(-7, 61, 7, 61, 10, 102, -10, 102);
    g.pop();
  }

  _drawCollar(g) {
    g.push();
    g.fill(252, 251, 248);
    g.stroke(this.inkTone[0], this.inkTone[1], this.inkTone[2]);
    g.strokeWeight(1.8);
    g.beginShape();
    g.vertex(-24, 116);
    g.vertex(-10, 99);
    g.vertex(-2, 122);
    g.endShape();
    g.beginShape();
    g.vertex(24, 116);
    g.vertex(10, 99);
    g.vertex(2, 122);
    g.endShape();
    g.pop();
  }

  _filledBezierShape(g, segments) {
    const pts = [];
    let sx = segments[0][0];
    let sy = segments[0][1];
    pts.push([sx, sy]);
    for (let i = 1; i < segments.length; i++) {
      const [c1x, c1y, c2x, c2y, ex, ey] = segments[i];
      for (let t = 0.08; t <= 1.001; t += 0.08) {
        pts.push([
          g.bezierPoint(sx, c1x, c2x, ex, t),
          g.bezierPoint(sy, c1y, c2y, ey, t),
        ]);
      }
      sx = ex;
      sy = ey;
    }
    g.beginShape();
    for (const [px, py] of pts) g.vertex(px, py);
    g.endShape(g.CLOSE);
  }

  _openBezier(g, x1, y1, cx1, cy1, cx2, cy2, x2, y2) {
    g.bezier(x1, y1, cx1, cy1, cx2, cy2, x2, y2);
  }

  _bezierVertices(g, x1, y1, cx1, cy1, cx2, cy2, x2, y2) {
    for (let t = 0.1; t <= 1.001; t += 0.1) {
      g.vertex(
        g.bezierPoint(x1, cx1, cx2, x2, t),
        g.bezierPoint(y1, cy1, cy2, y2, t)
      );
    }
  }

  _noise(v) {
    return Math.sin(v * 1.4 + this.seed * 0.17) * 0.5 + Math.sin(v * 0.6 + this.seed * 0.39) * 0.5;
  }

  _lerp(a, b, t) {
    return a + (b - a) * t;
  }

  _clamp(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }
}

window.PortalFaceAnimation = PortalFaceAnimation;
