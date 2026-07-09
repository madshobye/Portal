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

export function drawGenerator(pg, id, t) {
  if (id === "testPattern") return drawTestPattern(pg);
  if (id === "noise") return drawNoise(pg, t);
  if (id === "plasma") return drawPlasma(pg, t);
  if (id === "checker") return drawChecker(pg, t);
  if (id === "black") return pg.background(0);
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
      const n = noise(x * 0.006, y * 0.006, t * 0.3);
      pg.fill(30 + n * 210, 35 + n * 120, 70 + n * 175);
      pg.rect(x, y, cell, cell);
    }
  }
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
