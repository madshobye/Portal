import { NODE_PART_KINDS } from "../../../node-engine/node-definition.js";
import { ALWAYS_TIME_RUNTIME } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
  id: "checker",
  name: "Checker",
  category: "utility",
  runtime: ALWAYS_TIME_RUNTIME,
});

export function drawCheckerNode(pg) {
  const cell = Math.max(18, Math.floor(Math.min(pg.width, pg.height) / 12));
  pg.noStroke();
  for (let y = 0; y < pg.height; y += cell) {
    for (let x = 0; x < pg.width; x += cell) {
      pg.fill(((x / cell + y / cell) | 0) % 2 === 0 ? "#e3e8de" : "#141920");
      pg.rect(x, y, cell, cell);
    }
  }
}

export function checkerNodeProcess(_inputs, context = {}) {
  if (!context.target) throw new Error("CHECKER_RENDER_TARGET_MISSING");
  drawCheckerNode(context.target);
  return context.target;
}

export const VisualComponent = defineGeneratorNode(manifest, null, {
  process: checkerNodeProcess,
  parts: [
    {
      id: "checker-algorithm",
      name: "Checker algorithm",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      export: "drawCheckerNode",
      source: drawCheckerNode.toString(),
    },
    {
      id: "checker-process",
      name: "Checker process entry",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      export: "checkerNodeProcess",
      entry: "process",
      dependsOn: ["checker-algorithm"],
      source: checkerNodeProcess.toString(),
    },
  ],
});

export default VisualComponent;
