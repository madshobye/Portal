import { defineNode, NODE_IMPLEMENTATION_KINDS } from "../../node-engine/node-definition.js";
import {
  MaterialBinding3dListType,
  MaterialBinding3dType,
} from "../material-binding-3d/index.js?v=mesh-collection-2";

export const CombineMaterialBindings3dNode = defineNode({
  id: "core.scene3d.combine-material-bindings",
  name: "Combine 3D Material Bindings",
  version: "0.1.0",
  description: "Combines material-slot bindings incrementally for a Mesh Collection.",
  implementation: NODE_IMPLEMENTATION_KINDS.DATA,
  inlets: {
    bindings: { type: MaterialBinding3dListType, optional: true, defaultValue: [] },
    a: { type: MaterialBinding3dType, optional: true },
    b: { type: MaterialBinding3dType, optional: true },
  },
  outlets: { bindings: { type: MaterialBinding3dListType } },
  execution: { trigger: "input-change", domain: "main", pure: true },
  capabilities: ["scene-3d", "material-binding", "collection", "graph-placeable"],
  presentation: { catalogs: ["graph", "mesh", "material", "scene-3d"], placeableOn: ["node-graph"] },
  process: combineMaterialBindings3dNodeProcess,
});

export function combineMaterialBindings3dNodeProcess(
  { bindings = [], a, b } = {},
  { state = {}, output = null } = {},
) {
  const values = [...(bindings || []), a, b].filter(Boolean);
  if (!sameIdentityList(state.values, values)) {
    assertUniqueMaterialSlots(values);
    state.values = Object.freeze(values);
  }
  const result = output || state.output || (state.output = { bindings: null });
  result.bindings = state.values || Object.freeze([]);
  return result;
}

function assertUniqueMaterialSlots(bindings) {
  const slots = new Set();
  for (const binding of bindings) {
    const slot = String(binding?.slot || "");
    if (slots.has(slot)) throw new Error(`MATERIAL_BINDING_3D_DUPLICATE:${slot}`);
    slots.add(slot);
  }
}

function sameIdentityList(left, right) {
  return Array.isArray(left) && left.length === right.length &&
    left.every((value, index) => value === right[index]);
}
