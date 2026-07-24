import { defineNodeGroup } from "../../node-engine/node-group.js";

export const MappingProgramNode = defineNodeGroup({
  id: "core.composition.mapping-program",
  name: "Mapping Program",
  version: "0.1.0",
  description: "A persisted Mapping topology connecting Scene routes to physical Surfaces.",
  executionModel: "compiled-graph",
  graphEditable: false,
  authoring: {
    activation: "read-only",
    reason: "Edit the project-owned Mapping graph rather than this compiler template.",
  },
  outlets: { routes: { type: "any" } },
  execution: { trigger: "frame", domain: "main", stateful: true },
  capabilities: ["mapping-program", "surface-routing", "mapping", "expandable-group", "compiled-fast-path"],
  presentation: { catalogs: ["node-graph", "mapping"], placeableOn: ["application"], expandable: true, previewOutput: "routes" },
  nodes: [],
  connections: [],
  program: async (inputs, context) => {
    if (typeof context.executeMappingProgram !== "function") throw new Error("MAPPING_PROGRAM_RENDER_HOST_MISSING");
    return { routes: await context.executeMappingProgram(inputs, context) };
  },
});
