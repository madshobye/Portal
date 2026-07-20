import { NODE_PART_KINDS } from "../../../node-engine/node-definition.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
  id: "testPattern",
  name: "Test Pattern",
  category: "utility",
});

// This is the node's real allocation-stable render algorithm. The output host
// supplies only the existing p5 target through context; no intermediate target,
// scheduler, or frame-time graph traversal is introduced.
export function drawTestPatternNode(pg) {
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
  pg.textAlign("center", "center");
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

export function drawOrientationBadge(pg, x, y, label, color) {
  const radius = Math.max(20, Math.min(pg.width, pg.height) * 0.045);
  pg.push();
  pg.noStroke();
  pg.fill(color);
  pg.circle(x, y, radius * 2);
  pg.fill("#050608");
  pg.textAlign("center", "center");
  pg.textSize(Math.max(12, radius * 0.72));
  pg.textStyle("bold");
  pg.text(label, x, y);
  pg.textStyle("normal");
  pg.pop();
}

export function testPatternNodeProcess(_inputs, context = {}) {
  if (!context.target) throw new Error("TEST_PATTERN_RENDER_TARGET_MISSING");
  drawTestPatternNode(context.target);
  return context.target;
}

export const VisualComponent = defineGeneratorNode(manifest, null, {
  process: testPatternNodeProcess,
  parts: [
    {
      id: "test-pattern-algorithm",
      name: "Test pattern algorithm",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      exports: ["drawTestPatternNode", "drawOrientationBadge"],
      source: [drawTestPatternNode, drawOrientationBadge].map((fn) => fn.toString()).join("\n\n"),
    },
    {
      id: "test-pattern-process",
      name: "Test pattern process entry",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      export: "testPatternNodeProcess",
      entry: "process",
      dependsOn: ["test-pattern-algorithm"],
      source: testPatternNodeProcess.toString(),
    },
  ],
});

export default VisualComponent;
