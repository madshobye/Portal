import { defineNodeGroup } from "../../node-engine/node-group.js";

export const SceneProgramNode = defineNodeGroup({
  id: "core.composition.scene-program",
  name: "Scene Program",
  version: "0.1.0",
  description: "A persisted Scene topology connecting Component groups to surface routes, composition, and mapping.",
  outlets: { routes: { type: "any" } },
  execution: { trigger: "frame", domain: "main", stateful: true },
  capabilities: ["scene-program", "surface-routing", "mapping", "expandable-group", "compiled-fast-path"],
  presentation: { catalogs: ["node-graph", "scene"], placeableOn: ["application"], expandable: true, previewOutput: "routes" },
  nodes: [],
  connections: [],
  program: async (inputs, context) => {
    if (typeof context.executeSceneProgram !== "function") throw new Error("SCENE_PROGRAM_RENDER_HOST_MISSING");
    return { routes: await context.executeSceneProgram(inputs, context) };
  },
});
