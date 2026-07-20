import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../../node-engine/node-definition.js";
import { materializeVisualNodeDefinition } from "../../shared/visual-node-materializer.js";

export const VisualNodeDefinitionNode = defineNode({
  id: "core.visual.node-definition",
  name: "Visual Node Definition",
  version: "0.1.0",
  description: "Materializes editable shader visual nodes and explicit allocation-stable native visual nodes.",
  implementation: NODE_IMPLEMENTATION_KINDS.NATIVE,
  inlets: { component: { type: "any", required: true }, shader: { type: "any", optional: true } },
  outlets: { definition: { type: "any" } },
  execution: { trigger: "manual", domain: "main", pure: true },
  parts: [{
    id: "visual-definition-materializer",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    name: "Visual definition materializer",
    editable: false,
    metadata: { compilerLocked: true, reason: "visual compiler adapter" },
    source: materializeVisualNodeDefinition.toString(),
  }],
  capabilities: ["visual-node", "definition-materialization"],
  process: ({ component, shader }, context = {}) => ({
    definition: materializeVisualNodeDefinition(component, { shader, nativeRenderer: context.nativeRenderer || "" }),
  }),
});
