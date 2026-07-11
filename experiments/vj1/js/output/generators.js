import { getGeneratorComponent } from "../graph/generator-registry.js";

export function drawStandby(pg, label) {
  pg.background("#080a0e");
  pg.noStroke();
  pg.fill("#171d25");
  for (let y = 0; y < pg.height; y += 56) {
    for (let x = 0; x < pg.width; x += 56) {
      if (((x / 56 + y / 56) | 0) % 2 === 0) pg.rect(x, y, 56, 56);
    }
  }
  pg.fill("#f2f4ee");
  pg.textAlign(CENTER, CENTER);
  pg.textSize(28);
  pg.text(label, pg.width / 2, pg.height / 2);
}

export function drawGenerator(pg, id, t, params = {}) {
  const generatorId = getGeneratorComponent(id).id;
  if (generatorId === "testPattern") return drawTestPattern(pg);
  if (generatorId === "waves") return drawWaves(pg, t);
  if (generatorId === "noise") return drawNoise(pg, t);
  if (generatorId === "plasma") return drawPlasma(pg, t);
  if (generatorId === "fireflies") return drawFireflies(pg, t, params);
  if (generatorId === "eyeball") return drawEyeball(pg, t, params);
  if (generatorId === "swayingTrees") return drawSwayingTrees(pg, t);
  if (generatorId === "checker") return drawChecker(pg, t);
  if (generatorId === "black") return pg.background(0);
  return drawTestPattern(pg);
}

function drawTestPattern(pg) {
  const stripeCount = 8;
  const stripeWidth = pg.width / stripeCount;
  const colors = ["#ffffff", "#ffe45e", "#59e36d", "#4ee3e5", "#4d75ff", "#d35cff", "#ff4f92", "#0b0d11"];
  pg.noStroke();
  for (let i = 0; i < stripeCount; i++) {
    pg.fill(colors[i]);
    pg.rect(i * stripeWidth, 0, stripeWidth + 1, pg.height * 0.68);
  }
  const blockHeight = pg.height * 0.16;
  const y1 = pg.height * 0.68;
  for (let i = 0; i < stripeCount; i++) {
    pg.fill(i % 2 === 0 ? "#111820" : "#d7dcd4");
    pg.rect(i * stripeWidth, y1, stripeWidth + 1, blockHeight);
  }
  const y2 = y1 + blockHeight;
  pg.fill("#07090c");
  pg.rect(0, y2, pg.width, pg.height - y2);
  pg.stroke("#f4f6ef");
  pg.strokeWeight(2);
  pg.noFill();
  const cx = pg.width * 0.5;
  const cy = y2 + (pg.height - y2) * 0.5;
  const size = Math.min(pg.width, pg.height) * 0.14;
  pg.rect(cx - size, cy - size * 0.55, size * 2, size * 1.1);
  pg.line(cx - size, cy, cx + size, cy);
  pg.line(cx, cy - size * 0.55, cx, cy + size * 0.55);
  pg.noStroke();
  pg.fill("#f4f6ef");
  pg.textAlign(CENTER, CENTER);
  pg.textSize(Math.max(18, pg.height * 0.04));
  pg.text("TEST PATTERN", cx, cy + size * 0.92);
  drawOrientationBadge(pg, pg.width * 0.09, pg.height * 0.1, "TL", "#ff4f4f");
  drawOrientationBadge(pg, pg.width * 0.91, pg.height * 0.1, "TR", "#59e36d");
  drawOrientationBadge(pg, pg.width * 0.09, pg.height * 0.9, "BL", "#4d75ff");
  drawOrientationBadge(pg, pg.width * 0.91, pg.height * 0.9, "BR", "#ffe45e");
  pg.stroke("#f4f6ef");
  pg.strokeWeight(3);
  pg.line(pg.width * 0.5, pg.height * 0.18, pg.width * 0.5, pg.height * 0.05);
  pg.line(pg.width * 0.5, pg.height * 0.05, pg.width * 0.47, pg.height * 0.1);
  pg.line(pg.width * 0.5, pg.height * 0.05, pg.width * 0.53, pg.height * 0.1);
  pg.noStroke();
  pg.fill("#f4f6ef");
  pg.textSize(Math.max(12, pg.height * 0.028));
  pg.text("UP", pg.width * 0.5, pg.height * 0.22);
}

function drawOrientationBadge(pg, x, y, label, color) {
  const radius = Math.max(20, Math.min(pg.width, pg.height) * 0.045);
  pg.push();
  pg.noStroke();
  pg.fill(color);
  pg.circle(x, y, radius * 2);
  pg.fill("#050608");
  pg.textAlign(CENTER, CENTER);
  pg.textSize(Math.max(12, radius * 0.72));
  pg.textStyle(BOLD);
  pg.text(label, x, y);
  pg.textStyle(NORMAL);
  pg.pop();
}

function drawWaves(pg, t) {
  pg.background("#050608");
  pg.noFill();
  for (let i = 0; i < 34; i++) {
    const hue = i / 34;
    pg.stroke(
      70 + 150 * sin(t + hue * 6.28),
      100 + 110 * sin(t * 0.7 + hue * 4.1),
      150 + 95 * cos(t * 0.8 + hue * 5.0),
      210
    );
    pg.strokeWeight(2);
    pg.beginShape();
    for (let x = -20; x <= pg.width + 20; x += 18) {
      const y =
        pg.height * (0.12 + i * 0.024) +
        sin(x * 0.018 + t * (1.4 + i * 0.04)) * 34 +
        sin(x * 0.006 - t * 0.8 + i) * 58;
      pg.vertex(x, y);
    }
    pg.endShape();
  }
}

function drawNoise(pg, t) {
  pg.noStroke();
  const cell = Math.max(14, Math.floor(pg.width / 64));
  for (let y = 0; y < pg.height; y += cell) {
    for (let x = 0; x < pg.width; x += cell) {
      const n = valueNoise2d(x * 0.006 + t * 0.07, y * 0.006 - t * 0.05);
      pg.fill(30 + n * 210, 35 + n * 120, 70 + n * 175);
      pg.rect(x, y, cell, cell);
    }
  }
}

function valueNoise2d(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smoothstep01(x - ix);
  const fy = smoothstep01(y - iy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return mix(mix(a, b, fx), mix(c, d, fx), fy);
}

function hash2(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function smoothstep01(value) {
  return value * value * (3 - 2 * value);
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function paramNumber(params, id, fallback, min = -Infinity, max = Infinity) {
  return clampNumber(params?.[id], min, max, fallback);
}

function paramColor(params, id, fallback = [255, 255, 255, 255]) {
  const value = String(params?.[id] || "");
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})?$/i.exec(value);
  if (!match) return fallback;
  return [
    parseInt(match[1], 16),
    parseInt(match[2], 16),
    parseInt(match[3], 16),
    match[4] ? parseInt(match[4], 16) : 255,
  ];
}

function randomGaze(seed) {
  return {
    x: (hash2(seed * 17.1, 2.3) * 2 - 1) * 0.72,
    y: (hash2(seed * 9.7, 5.1) * 2 - 1) * 0.38,
  };
}

function naturalEyeGaze(t, params = {}) {
  const speed = Math.max(0.05, paramNumber(params, "motionSpeed", 1, 0, 3));
  const range = paramNumber(params, "gazeRange", 1, 0, 1.5);
  const pause = paramNumber(params, "pauseAmount", 0.82, 0, 1);
  const jitter = paramNumber(params, "jitter", 0.35, 0, 1);
  const clock = t * speed * 0.85;
  const segment = Math.floor(clock);
  const f = clock - segment;
  const movePortion = mix(0.98, 0.08, pause);
  const ease = smoothstep01(Math.min(1, f / movePortion));
  const a = randomGaze(segment);
  const b = randomGaze(segment + 1);
  const microX = Math.sin(t * 18.7 + hash2(segment, 1.2) * Math.PI * 2) * 0.018 * jitter;
  const microY = Math.sin(t * 23.1 + hash2(segment, 8.2) * Math.PI * 2) * 0.018 * jitter;
  return {
    x: (mix(a.x, b.x, ease) + microX) * range,
    y: (mix(a.y, b.y, ease) + microY) * range,
  };
}

function blinkAmount(t, params = {}) {
  const blinkRate = paramNumber(params, "blinkRate", 1, 0, 3);
  if (blinkRate <= 0.001) return 0;
  const clock = t * blinkRate * 0.55;
  const segment = Math.floor(clock);
  const phase = clock - segment;
  const primary = shutterBlinkAmount(phase);
  const doubleBlinkChance = hash2(segment, 19.4) > 0.78 ? 1 : 0;
  const secondary = shutterBlinkAmount(phase - 0.2) * doubleBlinkChance;
  return Math.max(primary, secondary) * (hash2(segment, 11.1) > 0.34 ? 1 : 0);
}

function shutterBlinkAmount(phase) {
  const close = normalizedRamp(phase, 0.015, 0.045);
  const open = 1 - normalizedRamp(phase, 0.078, 0.125);
  return close * open;
}

function normalizedRamp(value, start, end) {
  const amount = (value - start) / Math.max(0.00001, end - start);
  return smoothstep01(Math.min(1, Math.max(0, amount)));
}

function drawPlasma(pg, t) {
  pg.noStroke();
  const cell = Math.max(12, Math.floor(pg.width / 80));
  const ctx = pg.drawingContext;
  for (let y = 0; y < pg.height; y += cell) {
    for (let x = 0; x < pg.width; x += cell) {
      const u = x / pg.width;
      const v = y / pg.height;
      const q = sin((u + t * 0.08) * 18) + sin((v - t * 0.06) * 21) + sin((u + v + t * 0.05) * 16);
      const r = 120 + 90 * sin(q);
      const g = 80 + 130 * sin(q + 2.1);
      const b = 130 + 90 * sin(q + 4.2);
      if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) continue;
      ctx.fillStyle = `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
      ctx.fillRect(x, y, cell, cell);
    }
  }
}

function drawChecker(pg, t) {
  const cell = 72;
  pg.background("#0b0d11");
  pg.noStroke();
  for (let y = 0; y < pg.height; y += cell) {
    for (let x = 0; x < pg.width; x += cell) {
      const on = (((x / cell) | 0) + ((y / cell) | 0)) % 2 === 0;
      pg.fill(on ? "#e8ece2" : "#252d37");
      pg.rect(x, y, cell, cell);
    }
  }
  pg.fill("#ff4f92");
  pg.rect(((sin(t) * 0.5 + 0.5) * (pg.width - 40)) | 0, 0, 40, pg.height);
  pg.fill("#44d7c8");
  pg.rect(0, ((cos(t * 0.7) * 0.5 + 0.5) * (pg.height - 40)) | 0, pg.width, 40);
}

function drawFireflies(pg, t, params = {}) {
  pg.clear();
  pg.noStroke();
  const count = Math.round(paramNumber(params, "count", 18, 4, 24));
  const glowSize = paramNumber(params, "glowSize", 1, 0.35, 2.5);
  const speedParam = paramNumber(params, "speed", 1, 0, 3);
  const trailAmount = paramNumber(params, "trail", 0.25, 0, 1);
  const brightness = paramNumber(params, "brightness", 1, 0, 2);
  const twinkle = paramNumber(params, "twinkle", 0.75, 0, 1);
  const tint = paramColor(params, "tintColor", [255, 240, 109, 255]);
  for (let i = 0; i < count; i++) {
    const sx = hash2(i * 17.13, 3.7);
    const sy = hash2(i * 41.71, 9.2);
    const speed = (0.12 + hash2(i * 9.7, 2.1) * 0.52) * speedParam;
    const x = (sx + sin(t * speed * 0.7 + i * 1.37) * 0.16 + cos(t * speed * 0.31) * 0.08) * pg.width;
    const y = (sy + cos(t * speed * 0.9 + i * 0.73) * 0.14 + sin(t * speed * 0.43) * 0.06) * pg.height;
    const px = ((x % pg.width) + pg.width) % pg.width;
    const py = ((y % pg.height) + pg.height) % pg.height;
    const blinkWave = Math.max(0, sin(t * speedParam * (2 + sx * 4.5) + i * 4.1) * 0.5 + 0.5);
    const blink = mix(1, smoothstep01(blinkWave), twinkle);
    const size = Math.min(pg.width, pg.height) * (0.006 + sy * 0.012) * glowSize;
    if (trailAmount > 0.001) {
      pg.fill(tint[0], tint[1], tint[2], tint[3] * 0.18 * blink * brightness * trailAmount);
      pg.ellipse(px - size * 2.8, py, size * 8, size * 2.2);
    }
    pg.fill(tint[0], tint[1], tint[2], tint[3] * 0.13 * blink * brightness);
    pg.circle(px, py, size * 9);
    pg.fill(tint[0], tint[1], tint[2], tint[3] * 0.43 * blink * brightness);
    pg.circle(px, py, size * 3.4);
    pg.fill(255, 255, 255, tint[3] * 0.9 * blink * brightness);
    pg.circle(px, py, size);
  }
}

function drawEyeball(pg, t, params = {}) {
  pg.clear();
  const cx = pg.width / 2;
  const cy = pg.height / 2;
  const radius = Math.min(pg.width, pg.height) * 0.36;
  const irisSize = paramNumber(params, "irisSize", 1, 0.5, 1.6);
  const pupilSize = paramNumber(params, "pupilSize", 1, 0.5, 1.8);
  const gaze = naturalEyeGaze(t, params);
  const lookX = gaze.x * radius * 0.30;
  const lookY = gaze.y * radius * 0.30;
  const blink = blinkAmount(t, params);

  pg.noStroke();
  const ctx = pg.drawingContext;
  const sclera = ctx.createRadialGradient(cx - radius * 0.26, cy - radius * 0.28, radius * 0.08, cx, cy, radius);
  sclera.addColorStop(0, "rgba(255,248,225,1)");
  sclera.addColorStop(0.70, "rgba(235,229,211,1)");
  sclera.addColorStop(0.96, "rgba(92,84,78,1)");
  sclera.addColorStop(1, "rgba(42,38,36,1)");
  ctx.fillStyle = sclera;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  pg.noStroke();
  pg.fill(14, 36, 38, 255);
  pg.circle(cx + lookX, cy + lookY, radius * 1.70 * irisSize);
  pg.fill(28, 166, 142, 255);
  pg.circle(cx + lookX, cy + lookY, radius * 1.44 * irisSize);
  pg.fill(205, 145, 72, 112);
  pg.circle(cx + lookX, cy + lookY, radius * 0.84 * irisSize);
  pg.fill(5, 4, 3, 255);
  pg.circle(cx + lookX, cy + lookY, radius * 0.46 * pupilSize);
  pg.fill(255, 255, 255, 210);
  pg.circle(cx - radius * 0.28, cy - radius * 0.3, radius * 0.16);
  if (blink > 0.02) {
    const openHalf = radius * (1.08 - blink * 1.2);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();
    pg.fill(116, 46, 42, 245);
    pg.rect(cx - radius, cy - radius, radius * 2, Math.max(0, radius - openHalf));
    pg.rect(cx - radius, cy + openHalf, radius * 2, Math.max(0, radius - openHalf));
    ctx.restore();
  }
}

function drawSwayingTrees(pg, t) {
  pg.clear();
  pg.push();
  pg.strokeCap(ROUND);
  pg.strokeJoin(ROUND);
  const count = 7;
  const minDim = Math.min(pg.width, pg.height);
  for (let i = 0; i < count; i++) {
    const seed = i + 1;
    const sx = (i + 0.5) / count + (hash2(seed * 3.17, 2.4) - 0.5) * 0.08;
    const rootX = Math.max(pg.width * 0.04, Math.min(pg.width * 0.96, sx * pg.width));
    const rootY = pg.height * 0.98;
    const height = pg.height * (0.34 + hash2(seed * 4.71, 3.2) * 0.5);
    const bend = (hash2(seed * 8.63, 0.9) - 0.5) * pg.width * 0.11;
    const swayPhase = t * (0.42 + hash2(seed * 6.19, 8.1) * 0.32) + seed * 2.37;
    const sway = sin(swayPhase) * pg.width * (0.016 + hash2(seed * 5.41, 1.8) * 0.022);
    const topX = rootX + bend + sway;
    const topY = rootY - height;
    const trunkWidth = minDim * (0.012 + hash2(seed * 9.83, 6.4) * 0.012);

    pg.stroke(52, 30, 13, 220);
    pg.strokeWeight(trunkWidth);
    pg.line(rootX, rootY, topX, topY);

    for (let j = 0; j < 5; j++) {
      const k = 0.3 + j * 0.13 + hash2(seed * 11, j) * 0.055;
      const bx = mix(rootX, topX, k);
      const by = mix(rootY, topY, k);
      const side = (i + j) % 2 === 0 ? -1 : 1;
      const length = pg.width * (0.08 + hash2(seed * 13, j) * 0.11);
      const rise = pg.height * (0.045 + hash2(seed * 17, j) * 0.11);
      const branchSway = sin(swayPhase + j * 0.9) * pg.width * 0.022 * (0.5 + k);
      const tx = bx + side * length + branchSway;
      const ty = by - rise;

      pg.strokeWeight(trunkWidth * (0.36 + k * 0.22));
      pg.stroke(60, 35, 15, 205);
      pg.line(bx, by, tx, ty);

      for (let l = 0; l < 3; l++) {
        const lk = 0.36 + l * 0.25 + hash2(seed * 23 + j * 5 + l, 4.2) * 0.12;
        const leafX = mix(bx, tx, lk) + sin(swayPhase * 1.24 + j * 1.7 + l) * pg.width * 0.018;
        const leafY = mix(by, ty, lk) + cos(swayPhase * 0.83 + l * 2) * pg.height * 0.012;
        const leafSize = minDim * (0.032 + hash2(seed * 29 + j * 3 + l, 5.3) * 0.032);
        const warmth = hash2(seed * 37 + j * 11 + l, 6.8);
        pg.noStroke();
        pg.fill(
          36 + warmth * 130,
          104 + warmth * 92,
          38 + warmth * 20,
          205
        );
        pg.push();
        pg.translate(leafX, leafY);
        pg.rotate(side * 0.68 + sin(t * 0.8 + seed + j + l) * 0.22);
        pg.ellipse(0, 0, leafSize * 0.72, leafSize * 1.18);
        pg.stroke(220, 240, 150, 38);
        pg.strokeWeight(Math.max(1, leafSize * 0.05));
        pg.line(0, -leafSize * 0.44, 0, leafSize * 0.44);
        pg.pop();
      }
    }
  }
  pg.noStroke();
  pg.fill(24, 54, 20, 82);
  pg.rect(0, pg.height * 0.965, pg.width, pg.height * 0.035);
  pg.pop();
}
