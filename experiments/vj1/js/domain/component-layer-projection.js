import { COMPONENT_PROGRAM_GENERATOR } from "../libraries/composition-engine/shared/component-program-compiler.js";

// The layer editor is a lens over the authoritative Component Group. Node
// identity/order/nesting come from the graph; the attached `item` is the
// materialized configuration projection used by existing parameter controls.
export function componentLayerProjection(state = {}, component = {}) {
  const ownerPath = componentStatePath(state, component);
  const group = state.nodes?.groups?.find((candidate) =>
    candidate.generatedBy === COMPONENT_PROGRAM_GENERATOR &&
    String(candidate.componentId || "") === String(component.id || "")
  );
  if (!group) return projectUnpreparedChain(component.chain || [], `${ownerPath}.chain`);
  const itemById = new Map();
  collectItems(component.chain || [], itemById, `${ownerPath}.chain`);
  return projectGraphNodes(group.nodes || [], itemById);
}

export function selectedComponentLayer(state = {}, component = {}, nodeId = "") {
  const projection = componentLayerProjection(state, component);
  return findProjectedLayer(projection, String(nodeId || "")) || firstProjectedLayer(projection);
}

function projectGraphNodes(nodes, itemById) {
  const renderNodes = (nodes || []).filter((node) =>
    ["source", "effect", "group"].includes(node.role) && !node.auxiliaryFor
  );
  return renderNodes.flatMap((node) => {
    const projection = itemById.get(String(node.id || ""));
    if (!projection) return [];
    const { item, path } = projection;
    return [{
      nodeId: String(node.id),
      path,
      item,
      children: node.role === "group"
        ? projectGraphNodes(node.nodes || [], itemById)
        : [],
    }];
  });
}

function projectUnpreparedChain(chain, base) {
  return (chain || []).map((item, index) => {
    const path = `${base}.${index}`;
    return {
      nodeId: String(item.id || ""),
      path,
      item,
      children: item.kind === "group" ? projectUnpreparedChain(item.chain || [], `${path}.chain`) : [],
    };
  });
}

function collectItems(chain, result, base) {
  for (let index = 0; index < (chain || []).length; index++) {
    const item = chain[index];
    const path = `${base}.${index}`;
    if (item?.id) result.set(String(item.id), { item, path });
    if (item?.kind === "group") collectItems(item.chain || [], result, `${path}.chain`);
  }
}

function findProjectedLayer(entries, nodeId) {
  for (const entry of entries || []) {
    if (entry.nodeId === nodeId) return entry;
    const nested = findProjectedLayer(entry.children, nodeId);
    if (nested) return nested;
  }
  return null;
}

function firstProjectedLayer(entries) {
  return entries?.[0] || null;
}

function componentStatePath(state, component) {
  const index = state.components?.findIndex((candidate) => candidate.id === component.id) ?? -1;
  return `components.${Math.max(0, index)}`;
}
