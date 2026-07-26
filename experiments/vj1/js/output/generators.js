const standbyStateByTarget = new WeakMap();

// p5 is intentionally limited to the diagnostic surface below. Visual
// generators execute from their compiled node process, shader program, or an
// explicit retained renderer capability.
export function drawStandby(pg, label, {
  visible = true,
  frame = null,
  graceMs = 0,
  now = null,
  icon = "resource",
  detail = false,
} = {}) {
  pg.push();
  try {
    resetStandbyTransform(pg);
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
    if (graceMs > 0 && currentTime - since < graceMs) return;
    drawStandbyIcon(pg, icon);
    if (detail === true && label) drawStandbyDetail(pg, label);
  } finally {
    pg.pop();
  }
}

export function standbyDiagnosticsVisible({
  mode = "preview",
  debugPreview = true,
  forceVisible = false,
} = {}) {
  return mode !== "output" &&
    (debugPreview !== false || forceVisible === true);
}

function resetStandbyTransform(target) {
  if (target?.__vj1SharedFramebuffer) {
    if (typeof globalThis.resetMatrix !== "function") {
      throw new Error("VJ1_RENDER_CAPABILITY_REQUIRED:p5.resetMatrix");
    }
    globalThis.resetMatrix();
    target.translate(-target.width * 0.5, -target.height * 0.5);
    return;
  }
  if (typeof target?.resetMatrix !== "function") {
    throw new Error("VJ1_RENDER_CAPABILITY_REQUIRED:target.resetMatrix");
  }
  target.resetMatrix();
}

function drawStandbyIcon(target, kind = "resource") {
  const size = Math.max(18, Math.min(56, Math.min(target.width, target.height) * 0.16));
  const centerX = target.width * 0.5;
  const centerY = target.height * 0.5;
  const left = centerX - size * 0.5;
  const top = centerY - size * 0.38;
  target.noFill();
  target.stroke("#aeb6c2");
  target.strokeWeight(Math.max(1.5, size * 0.055));
  target.rect(left, top, size, size * 0.76, size * 0.08);
  if (kind === "video") {
    // Standby diagnostics run on both full p5.Graphics instances and the
    // reduced shared-framebuffer target. Keep their drawing vocabulary to the
    // common 2D contract instead of depending on optional p5 shape helpers.
    const playLeft = centerX - size * 0.12;
    const playTop = centerY - size * 0.18;
    const playBottom = centerY + size * 0.18;
    const playTip = centerX + size * 0.2;
    target.line(playLeft, playTop, playLeft, playBottom);
    target.line(playLeft, playBottom, playTip, centerY);
    target.line(playTip, centerY, playLeft, playTop);
    return;
  }
  if (kind === "model") {
    target.line(centerX, top + size * 0.12, left + size * 0.2, centerY);
    target.line(centerX, top + size * 0.12, left + size * 0.8, centerY);
    target.line(left + size * 0.2, centerY, centerX, top + size * 0.64);
    target.line(left + size * 0.8, centerY, centerX, top + size * 0.64);
    target.line(centerX, top + size * 0.12, centerX, top + size * 0.64);
    return;
  }
  if (kind === "image") {
    target.line(left + size * 0.12, top + size * 0.62, left + size * 0.38, top + size * 0.36);
    target.line(left + size * 0.38, top + size * 0.36, left + size * 0.54, top + size * 0.5);
    target.line(left + size * 0.54, top + size * 0.5, left + size * 0.76, top + size * 0.28);
    target.line(left + size * 0.76, top + size * 0.28, left + size * 0.9, top + size * 0.42);
    return;
  }
  target.line(left + size * 0.22, centerY, left + size * 0.78, centerY);
}

function drawStandbyDetail(target, label) {
  target.noStroke();
  target.fill("#f2f4ee");
  target.textAlign(CENTER, CENTER);
  target.textSize(Math.max(12, Math.min(24, Math.min(target.width, target.height) * 0.055)));
  target.text(label, target.width * 0.5, target.height * 0.64);
}
