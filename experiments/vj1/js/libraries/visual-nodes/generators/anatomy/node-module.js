import { NODE_PART_KINDS } from "../../../node-engine/node-definition.js";
import {
  anatomyAlgorithmModuleSource,
  anatomyPartFitScale,
  AnatomyNodeModuleExports,
  drawProceduralAnatomy,
} from "./runtime.js";

export function anatomyNodeProcess(inputs = {}, context = {}) {
  if (typeof context.renderNativeVisualNode !== "function") throw new Error("ANATOMY_NODE_RENDER_HOST_MISSING");
  return context.renderNativeVisualNode({ inputs, context });
}

export function anatomyNodeModuleParts() {
  return [
    {
      id: "anatomy-geometry-module",
      name: "Low Poly Anatomy procedural geometry",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      exports: ["anatomyPartFitScale", "drawProceduralAnatomy"],
      source: anatomyAlgorithmModuleSource(),
    },
    {
      id: "anatomy-process",
      name: "Low Poly Anatomy process entry",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      export: "anatomyNodeProcess",
      entry: "process",
      dependsOn: ["anatomy-geometry-module"],
      source: anatomyNodeProcess.toString(),
    },
  ];
}

export { anatomyPartFitScale, drawProceduralAnatomy };
export const AnatomyNodeExports = AnatomyNodeModuleExports;
