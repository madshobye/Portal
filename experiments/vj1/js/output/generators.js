const standbyStateByTarget = new WeakMap();

// p5 is intentionally limited to the diagnostic surface below. Visual
// generators execute from their compiled node process, shader program, or an
// explicit retained renderer capability.
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
