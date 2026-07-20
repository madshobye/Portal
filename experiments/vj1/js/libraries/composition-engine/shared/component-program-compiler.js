import { ComponentProgramNode } from "../component-program/index.js";
import { LayerGroupNode } from "../layer-group/index.js";
import { VisualSourceNode } from "../visual-source/index.js";

export const COMPONENT_PROGRAM_GENERATOR = "vj1-component-compiler";

export function componentProgramGroupId(componentId) {
  return `vj1.component.${String(componentId || "missing")}`;
}

export function compileComponentGroupTopology(component = {}, { definitions = new Map() } = {}) {
  const nodes = compileChainNodes(component.chain || [], `components.${component.id}.chain`, definitions);
  return {
    id: componentProgramGroupId(component.id),
    nodeId: ComponentProgramNode.id,
    nodeVersion: ComponentProgramNode.version,
    componentId: String(component.id || ""),
    artifactType: component.type === "canvas" ? "canvas" : "component",
    name: component.name || (component.type === "canvas" ? "Canvas" : "Component"),
    nodes,
    connections: linearConnections(nodes),
    publicInlets: {},
    publicOutlets: { texture: nodes.length ? `${nodes[nodes.length - 1].id}.texture` : "$in.texture" },
    generatedBy: COMPONENT_PROGRAM_GENERATOR,
  };
}

export function componentProgramInstances(group = {}) {
  const result = [];
  collectInstances(group.nodes || [], group.id, result);
  return result;
}

export function compileComponentRenderPrograms(components = [], groups = []) {
  const groupByComponent = new Map((groups || [])
    .filter((group) => group.generatedBy === COMPONENT_PROGRAM_GENERATOR)
    .map((group) => [group.componentId, group]));
  return new Map((components || []).map((component) => {
    // Old project snapshots are upgraded in memory at the compilation
    // boundary. Rendering therefore always consumes a Component program and
    // never needs a second raw-chain execution path.
    const group = groupByComponent.get(String(component.id || "")) || compileComponentGroupTopology(component);
    return [component.id, new CompiledComponentRenderProgram(group, component)];
  }));
}

export class CompiledComponentRenderProgram {
  constructor(group, component) {
    this.id = group.id;
    this.componentId = group.componentId;
    this.group = group;
    this.chain = materializeChain(group.nodes || [], component.chain || [], group.id);
    this.generatedBy = COMPONENT_PROGRAM_GENERATOR;
  }

  execute(renderHost, component, componentTime, renderRequest, scopeId = component.id) {
    return renderHost.renderComponentChainState(component, this.chain, componentTime, renderRequest, scopeId);
  }

  replaceChainItem(itemId, nextItem) {
    const result = replaceMaterializedChainItem(this.chain, String(itemId || ""), nextItem);
    if (result.changed) this.chain = result.chain;
    return result.changed;
  }
}

function replaceMaterializedChainItem(chain = [], itemId, nextItem) {
  let changed = false;
  const nextChain = chain.map((item) => {
    if (String(item?.id || "") === itemId) {
      changed = true;
      return nextItem;
    }
    if (item?.kind !== "group" || !item.chain?.length) return item;
    const nested = replaceMaterializedChainItem(item.chain, itemId, nextItem);
    if (!nested.changed) return item;
    changed = true;
    return { ...item, chain: nested.chain };
  });
  return { chain: changed ? nextChain : chain, changed };
}

function compileChainNodes(chain, path, definitions) {
  return (chain || []).filter((item) => item?.id).flatMap((item, index) => {
    const itemPath = `${path}.${index}`;
    const node = {
      id: String(item.id),
      nodeId: nodeTypeForItem(item),
      nodeVersion: "0.1.0",
      role: item.kind || "source",
      parameters: parametersForItem(item),
      statePath: itemPath,
      generatedBy: COMPONENT_PROGRAM_GENERATOR,
    };
    if (item.kind === "group") {
      node.nodes = compileChainNodes(item.chain || [], `${itemPath}.chain`, definitions);
      node.connections = linearConnections(node.nodes);
    }
    return [...parameterControlNodes(node, definitions.get(node.nodeId)), node];
  });
}

function nodeTypeForItem(item = {}) {
  if (item.kind === "effect") return `vj1.visual.effect.${item.componentId || "unknown"}`;
  if (item.kind === "group") return LayerGroupNode.id;
  if (item.source?.type === "generator") return `vj1.visual.generator.${item.source.generatorId || "unknown"}`;
  return VisualSourceNode.id;
}

function parametersForItem(item = {}) {
  if (item.kind === "effect") return { ...(item.params || {}), amount: item.amount ?? item.params?.amount };
  if (item.kind === "group") return {
    opacity: item.opacity ?? 1,
    blend: item.blend || "normal",
    transform: item.transform || {},
  };
  return {
    ...(item.source?.params || {}),
    sourceType: item.source?.type || "black",
    mediaId: item.source?.mediaId || "",
    componentId: item.source?.componentId || "",
  };
}

function linearConnections(nodes = []) {
  const connections = [];
  const renderNodes = nodes.filter((node) => node.role !== "control");
  for (const control of nodes.filter((node) => node.role === "control")) {
    connections.push({
      from: `${control.id}.value`,
      to: `${control.targetNodeId}.$parameter.${control.targetParameterId}`,
      type: control.valueType,
      sourceRange: control.sourceRange,
      targetRange: control.targetRange,
    });
  }
  for (let index = 0; index < renderNodes.length; index++) {
    connections.push({
      from: index === 0 ? "$in.texture" : `${renderNodes[index - 1].id}.texture`,
      to: `${renderNodes[index].id}.texture`,
      type: "texture",
    });
  }
  if (renderNodes.length) connections.push({ from: `${renderNodes[renderNodes.length - 1].id}.texture`, to: "$out.texture", type: "texture" });
  return connections;
}

function collectInstances(nodes, groupId, result) {
  for (const node of nodes) {
    const instanceId = `${groupId}/${node.id}`;
    result.push({
      id: instanceId,
      nodeId: node.nodeId,
      nodeVersion: node.nodeVersion,
      parameters: node.parameters || {},
      statePath: node.statePath,
      parentGroupId: groupId,
      generatedBy: COMPONENT_PROGRAM_GENERATOR,
    });
    if (node.nodes?.length) collectInstances(node.nodes, instanceId, result);
  }
}

function materializeChain(topologyNodes, currentChain, groupId) {
  const byId = new Map((currentChain || []).map((item) => [String(item.id || ""), item]));
  return topologyNodes.filter((node) => node.role !== "control").map((node) => {
    const item = byId.get(String(node.id || ""));
    if (!item) throw new Error(`COMPONENT_PROGRAM_ITEM_MISSING:${groupId}:${node.id}`);
    if (node.role !== "group") return item;
    return {
      ...item,
      chain: materializeChain(node.nodes || [], item.chain || [], `${groupId}/${node.id}`),
    };
  });
}

function parameterControlNodes(targetNode, definition) {
  if (!definition) return [];
  return Object.entries(targetNode.parameters || {}).flatMap(([parameterId, value]) => {
    if (value === undefined) return [];
    const parameter = definition.parameters?.[parameterId];
    if (!parameter) return [];
    const numeric = parameter.type?.type === "number" && typeof value === "number";
    const targetRange = parameter.expectedRange || parameter.allowedRange;
    return [{
      id: `${targetNode.id}:param:${parameterId}`,
      nodeId: numeric ? "core.control.slider" : "core.control.value",
      nodeVersion: "0.1.0",
      role: "control",
      targetNodeId: targetNode.id,
      targetParameterId: parameterId,
      valueType: parameter.type?.type || "any",
      sourceRange: numeric ? [0, 1] : null,
      targetRange: numeric && validRange(targetRange) ? [...targetRange] : null,
      parameters: { value: numeric ? normalizedControlValue(value, targetRange) : value },
      generatedBy: COMPONENT_PROGRAM_GENERATOR,
    }];
  });
}

function normalizedControlValue(value, range) {
  if (!validRange(range)) return Math.max(0, Math.min(1, Number(value) || 0));
  return Math.max(0, Math.min(1, (value - range[0]) / (range[1] - range[0])));
}

function validRange(value) {
  return Array.isArray(value) && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]) && value[0] !== value[1];
}
