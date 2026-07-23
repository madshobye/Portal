import { defineNodeGroup } from "../../node-engine/node-group.js";

export const OutputProgramNode = defineNodeGroup({
  id: "core.composition.output-program",
  name: "Output Program",
  version: "0.1.0",
  description: "Combines active Mapping routes, projection geometry, and final output composition.",
  executionModel: "compiled-graph",
  authoring: { activation: "recompile" },
  inlets: { scene: { type: "any", required: true } },
  outlets: { output: { type: "texture", optional: true } },
  execution: { trigger: "frame", domain: "main", stateful: true },
  capabilities: ["output-composition", "mapping", "expandable-group", "compiled-fast-path"],
  presentation: { catalogs: ["node-graph"], placeableOn: ["application"], expandable: true, previewOutput: "output" },
  nodes: [],
  connections: [],
  program: async (inputs, context) => {
    if (typeof context.executeOutputProgram !== "function") throw new Error("OUTPUT_PROGRAM_RENDER_HOST_MISSING");
    return { output: await context.executeOutputProgram(inputs, context) };
  },
});
