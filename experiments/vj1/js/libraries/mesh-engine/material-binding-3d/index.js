import { defineNode, NODE_IMPLEMENTATION_KINDS } from "../../node-engine/node-definition.js";
import { listType, valueType } from "../../node-engine/node-types.js";
import { Material3dType } from "../scene-types.js";

export const MaterialBinding3dType = valueType("material-binding3d", {
  contractVersion: 1,
});
export const MaterialBinding3dListType = listType(MaterialBinding3dType);

export const MaterialBinding3dNode = defineNode({
  id: "core.scene3d.material-binding",
  name: "3D Material Binding",
  version: "0.1.0",
  description: "Binds a reusable Material3d value to a named Mesh Collection material slot.",
  implementation: NODE_IMPLEMENTATION_KINDS.DATA,
  inlets: {
    slot: { type: "string", defaultValue: "default" },
    material: { type: Material3dType, required: true },
  },
  outlets: { binding: { type: MaterialBinding3dType } },
  execution: { trigger: "input-change", domain: "main", pure: true },
  capabilities: ["scene-3d", "material-binding", "graph-placeable"],
  presentation: { catalogs: ["graph", "mesh", "material", "scene-3d"], placeableOn: ["node-graph"] },
  process: materialBinding3dNodeProcess,
});

export function materialBinding3dNodeProcess({ slot, material } = {}, { state = {}, output = null } = {}) {
  const normalizedSlot = String(slot || "default");
  if (state.slot !== normalizedSlot || state.material !== material || !state.binding) {
    state.slot = normalizedSlot;
    state.material = material;
    state.binding = Object.freeze({
      kind: "material-binding3d",
      contractVersion: 1,
      slot: normalizedSlot,
      material,
    });
  }
  const result = output || state.output || (state.output = { binding: null });
  result.binding = state.binding;
  return result;
}
