import { NODE_PART_KINDS } from "../../../node-engine/node-definition.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";
import { renderView as resolveRenderView, withRenderView } from "../../../render-engine/render-view/index.js";

const manifest = Object.freeze({
  id: "testPattern",
  name: "Test Pattern",
  category: "utility",
});

// This is the node's real allocation-stable render algorithm. The output host
// supplies only the existing p5 target through context; no intermediate target,
// scheduler, or frame-time graph traversal is introduced.
export function drawTestPatternNode(pg, renderRequest = {}, appliedView = null) {
  const view = appliedView || testPatternRenderView(pg, renderRequest);
  if (!appliedView && view.cropped) {
    return withRenderView(pg, renderRequest, (resolved) => drawTestPatternNode(pg, renderRequest, resolved));
  }
  const stripeCount = 8;
  const stripeWidth = view.width / stripeCount;
  const colors = ["#ffffff", "#ffe45e", "#59e36d", "#4ee3e5", "#4d75ff", "#d35cff", "#ff4f92", "#0b0d11"];
  pg.noStroke();
  for (let index = 0; index < stripeCount; index++) {
    pg.fill(colors[index]);
    pg.rect(index * stripeWidth, 0, stripeWidth + 1, view.height * 0.68);
  }
  const blockHeight = view.height * 0.16;
  const y1 = view.height * 0.68;
  for (let index = 0; index < stripeCount; index++) {
    pg.fill(index % 2 === 0 ? "#111820" : "#d7dcd4");
    pg.rect(index * stripeWidth, y1, stripeWidth + 1, blockHeight);
  }
  const y2 = y1 + blockHeight;
  pg.fill("#07090c");
  pg.rect(0, y2, view.width, view.height - y2);
  pg.stroke("#f4f6ef");
  pg.strokeWeight(2);
  pg.noFill();
  const cx = view.width * 0.5;
  const cy = y2 + (view.height - y2) * 0.5;
  const size = Math.min(view.width, view.height) * 0.14;
  pg.rect(cx - size, cy - size * 0.55, size * 2, size * 1.1);
  pg.line(cx - size, cy, cx + size, cy);
  pg.line(cx, cy - size * 0.55, cx, cy + size * 0.55);
  pg.noStroke();
  pg.fill("#f4f6ef");
  pg.textAlign("center", "center");
  pg.textSize(Math.max(18, view.height * 0.04));
  pg.text("TEST PATTERN", cx, cy + size * 0.92);
  drawOrientationBadge(pg, view.width * 0.09, view.height * 0.1, "TL", "#ff4f4f", view);
  drawOrientationBadge(pg, view.width * 0.91, view.height * 0.1, "TR", "#59e36d", view);
  drawOrientationBadge(pg, view.width * 0.09, view.height * 0.9, "BL", "#4d75ff", view);
  drawOrientationBadge(pg, view.width * 0.91, view.height * 0.9, "BR", "#ffe45e", view);
  pg.stroke("#f4f6ef");
  pg.strokeWeight(3);
  pg.line(view.width * 0.5, view.height * 0.18, view.width * 0.5, view.height * 0.05);
  pg.line(view.width * 0.5, view.height * 0.05, view.width * 0.47, view.height * 0.1);
  pg.line(view.width * 0.5, view.height * 0.05, view.width * 0.53, view.height * 0.1);
  pg.noStroke();
  pg.fill("#f4f6ef");
  pg.textSize(Math.max(12, view.height * 0.028));
  pg.text("UP", view.width * 0.5, view.height * 0.22);
}

export function drawOrientationBadge(pg, x, y, label, color, view = pg) {
  const radius = Math.max(20, Math.min(view.width, view.height) * 0.045);
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
  drawTestPatternNode(context.target, context.renderRequest, context.renderView);
  return context.target;
}

// A cropped ROI is a view into the node's full boundary, not a new canvas.
// Keeping this adapter in the node preserves Test Pattern's editable drawing
// algorithm while allowing the render engine to allocate visible pixels only.
export function testPatternRenderView(pg, renderRequest = {}) {
  return resolveRenderView(pg, renderRequest);
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
      exports: ["drawTestPatternNode", "drawOrientationBadge", "testPatternRenderView"],
      source: [drawTestPatternNode, drawOrientationBadge, testPatternRenderView].map((fn) => fn.toString()).join("\n\n"),
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
