import { defineNode, NODE_IMPLEMENTATION_KINDS } from "../../node-engine/node-definition.js";
import { MeshCollectionType, isMeshCollection } from "../mesh-collection/index.js";
import {
  MaterialBinding3dListType,
} from "../material-binding-3d/index.js";
import {
  createMaterial3d,
  createObject3d,
  createTransform3d,
  Material3dType,
  Object3dListType,
} from "../scene-types.js?v=mesh-collection-1";

export const MeshCollectionObjects3dNode = defineNode({
  id: "core.scene3d.mesh-collection-objects",
  name: "Mesh Collection Objects",
  version: "0.1.0",
  description: "Expands a canonical Mesh Collection into ordinary Scene objects using typed material-slot bindings.",
  implementation: NODE_IMPLEMENTATION_KINDS.DATA,
  inlets: {
    collection: { type: MeshCollectionType, required: true },
    materialBindings: { type: MaterialBinding3dListType, optional: true, defaultValue: [] },
    defaultMaterial: { type: Material3dType, optional: true },
    transform: { type: "transform3d", optional: true },
    visible: { type: "boolean", defaultValue: true },
  },
  outlets: { objects: { type: Object3dListType } },
  execution: { trigger: "input-change", domain: "main", pure: true },
  capabilities: ["scene-3d", "mesh-collection", "multi-object-3d", "graph-placeable"],
  presentation: { catalogs: ["graph", "mesh", "scene-3d"], placeableOn: ["node-graph"] },
  process: meshCollectionObjects3dNodeProcess,
});

export function meshCollectionObjects3dNodeProcess(inputs = {}, { state = {}, output = null } = {}) {
  const collection = inputs.collection;
  if (!isMeshCollection(collection)) throw new Error("MESH_COLLECTION_OBJECTS_INVALID_COLLECTION");
  const bindings = inputs.materialBindings || [];
  const defaultMaterial = inputs.defaultMaterial?.kind === "material3d"
    ? inputs.defaultMaterial
    : state.defaultMaterial || (state.defaultMaterial = createMaterial3d({ id: "default" }));
  const transform = inputs.transform?.kind === "transform3d"
    ? inputs.transform
    : state.defaultTransform || (state.defaultTransform = createTransform3d());
  const visible = inputs.visible !== false;

  if (
    state.collection !== collection ||
    state.defaultMaterialValue !== defaultMaterial ||
    state.transform !== transform ||
    state.visible !== visible ||
    !sameBindings(state.bindings, bindings)
  ) {
    const materials = materialMap(bindings);
    state.collection = collection;
    state.defaultMaterialValue = defaultMaterial;
    state.transform = transform;
    state.visible = visible;
    state.bindings = Object.freeze([...bindings]);
    state.objects = Object.freeze(collection.parts.map((part) => createObject3d({
      id: `${collection.id}/${part.id}`,
      mesh: part.mesh,
      material: materials.get(part.materialSlot) || defaultMaterial,
      transform,
      visible: visible && part.visible,
      metadata: {
        meshCollectionId: collection.id,
        meshPartId: part.id,
        materialSlot: part.materialSlot,
      },
    })));
  }
  const result = output || state.output || (state.output = { objects: null });
  result.objects = state.objects;
  return result;
}

function materialMap(bindings) {
  const result = new Map();
  for (const binding of bindings) {
    const slot = String(binding?.slot || "");
    if (result.has(slot)) throw new Error(`MATERIAL_BINDING_3D_DUPLICATE:${slot}`);
    if (binding?.material?.kind === "material3d") result.set(slot, binding.material);
  }
  return result;
}

function sameBindings(left, right) {
  return Array.isArray(left) && left.length === right.length &&
    left.every((binding, index) =>
      binding?.slot === right[index]?.slot &&
      binding?.material === right[index]?.material
    );
}
