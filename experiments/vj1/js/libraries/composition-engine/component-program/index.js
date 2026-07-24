import { defineNodeGroup } from "../../node-engine/node-group.js";

export const ComponentProgramNode = defineNodeGroup({
  id: "core.composition.component-program",
  name: "Component Program",
  version: "0.1.0",
  description: "A persisted Component or Scene visual topology compiled into a direct render program.",
  executionModel: "compiled-graph",
  graphEditable: false,
  authoring: {
    activation: "read-only",
    reason: "Edit the project-owned Component graph rather than this compiler template.",
  },
  inlets: { texture: { type: "texture", optional: true } },
  outlets: { texture: { type: "texture" } },
  execution: { trigger: "frame", domain: "main", stateful: true },
  capabilities: ["visual-program", "component-program", "expandable-group", "compiled-fast-path"],
  presentation: { catalogs: ["node-graph"], placeableOn: ["application"], expandable: true, previewOutput: "texture" },
  nodes: [],
  connections: [],
  program: async (inputs, context) => {
    if (typeof context.executeComponentProgram !== "function") throw new Error("COMPONENT_PROGRAM_RENDER_HOST_MISSING");
    return { texture: await context.executeComponentProgram(inputs, context) };
  },
});
