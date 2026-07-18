import { getGeneratorComponent } from "../graph/generator-registry.js";

const standbyStateByTarget = new WeakMap();

// p5 is intentionally limited to import/diagnostic utilities and the two
// calibration primitives below. Production visual generators live in the
// shader registry or an explicit specialized raw-WebGL runtime.
export function drawStandby(pg, label, { visible = true, frame = null, graceMs = 0, now = null } = {}) {
  pg.clear();
  if (!visible) return;
  const currentTime = Number.isFinite(now)
    ? now
    : typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
  const previous = standbyStateByTarget.get(pg);
  const continuous = previous && previous.label === label && (
    Number.isFinite(frame) && Number.isFinite(previous.frame)
      ? frame === previous.frame + 1
      : currentTime - previous.at < 250
  );
  const since = continuous ? previous.since : currentTime;
  standbyStateByTarget.set(pg, { label, frame, since, at: currentTime });
  if (graceMs > 0 && currentTime - since < graceMs) {
    pg.background("#000000");
    return;
  }
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

export function drawGenerator(pg, id) {
  const generatorId = getGeneratorComponent(id).id;
  if (generatorId === "testPattern") return drawTestPattern(pg);
  if (generatorId === "checker") return drawChecker(pg);
  if (generatorId === "black") return pg.background(0);
  console.error("[VJ1_GENERATOR_RUNTIME_MISSING]", {
    generatorId,
    expectedRuntime: "shader-or-specialized-webgl",
  });
  return drawStandby(pg, `generator unavailable: ${generatorId}`);
}

function drawTestPattern(pg) {
  const stripeCount = 8;
  const stripeWidth = pg.width / stripeCount;
  const colors = ["#ffffff", "#ffe45e", "#59e36d", "#4ee3e5", "#4d75ff", "#d35cff", "#ff4f92", "#0b0d11"];
  pg.noStroke();
  for (let index = 0; index < stripeCount; index++) {
    pg.fill(colors[index]);
    pg.rect(index * stripeWidth, 0, stripeWidth + 1, pg.height * 0.68);
  }
  const blockHeight = pg.height * 0.16;
  const y1 = pg.height * 0.68;
  for (let index = 0; index < stripeCount; index++) {
    pg.fill(index % 2 === 0 ? "#111820" : "#d7dcd4");
    pg.rect(index * stripeWidth, y1, stripeWidth + 1, blockHeight);
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

function drawChecker(pg) {
  const cell = Math.max(18, Math.floor(Math.min(pg.width, pg.height) / 12));
  pg.noStroke();
  for (let y = 0; y < pg.height; y += cell) {
    for (let x = 0; x < pg.width; x += cell) {
      pg.fill(((x / cell + y / cell) | 0) % 2 === 0 ? "#e3e8de" : "#141920");
      pg.rect(x, y, cell, cell);
    }
  }
}
