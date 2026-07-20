import { getGeneratorNodeComponent as getGeneratorComponent } from "../libraries/visual-nodes/index.js?v=node-catalog-13";
import { drawBlackNode } from "../libraries/visual-nodes/generators/black/index.js";
import { drawCheckerNode } from "../libraries/visual-nodes/generators/checker/index.js";
import { drawTestPatternNode } from "../libraries/visual-nodes/generators/test-pattern/index.js";

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
  // Compatibility entry for legacy plans. Current plans compile these exact
  // node-owned functions and call them directly from the node process.
  if (generatorId === "testPattern") return drawTestPatternNode(pg);
  if (generatorId === "checker") return drawCheckerNode(pg);
  if (generatorId === "black") return drawBlackNode(pg);
  console.error("[VJ1_GENERATOR_RUNTIME_MISSING]", {
    generatorId,
    expectedRuntime: "shader-or-specialized-webgl",
  });
  return drawStandby(pg, `generator unavailable: ${generatorId}`);
}
