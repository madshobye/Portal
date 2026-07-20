import { NODE_PART_KINDS } from "../../../node-engine/node-definition.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
  id: "black",
  name: "Black",
  category: "utility",
});

export function drawBlackNode(pg) {
  pg.background(0);
}

export function blackNodeProcess(_inputs, context = {}) {
  if (!context.target) throw new Error("BLACK_RENDER_TARGET_MISSING");
  drawBlackNode(context.target);
  return context.target;
}

export const VisualComponent = defineGeneratorNode(manifest, null, {
  process: blackNodeProcess,
  parts: [
    {
      id: "black-algorithm",
      name: "Black frame algorithm",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      export: "drawBlackNode",
      source: drawBlackNode.toString(),
    },
    {
      id: "black-process",
      name: "Black process entry",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      export: "blackNodeProcess",
      entry: "process",
      dependsOn: ["black-algorithm"],
      source: blackNodeProcess.toString(),
    },
  ],
});

export default VisualComponent;
