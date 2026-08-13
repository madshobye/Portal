import { COMPONENT_PROGRAM_GENERATOR } from "../libraries/composition-engine/shared/component-program-compiler.js";
import {
  liveParameterDiffBank,
  liveParameterDiffTargetId,
} from "./live-parameter-diffs.js";

// The abstract layer editor is a read-only lens over the authoritative
// Component Group. Its controls address node configuration directly; neither
// order, nesting, values, nor paths are sourced from `component.chain`.
export function componentLayerProjection(state = {}, component = {}) {
  const groupIndex = state.nodes?.groups?.findIndex((candidate) =>
    candidate.generatedBy === COMPONENT_PROGRAM_GENERATOR &&
    String(candidate.componentId || "") === String(component.id || "")
  ) ?? -1;
  if (groupIndex < 0) return [];
  const group = state.nodes.groups[groupIndex];
  return projectGraphNodes(group.nodes || [], `nodes.groups.${groupIndex}.nodes`);
}

export function liveComponentLayerProjection(state = {}, component = {}) {
  const live = state.ui?.live || {};
  const targetId = liveParameterDiffTargetId(live, component.id);
  const overrides = liveParameterDiffBank(live, targetId)?.[component.id]?.nodes || {};
  return componentLayerProjection(state, component).map((layer) =>
    materializeLiveLayer(layer, overrides)
  );
}

// Disposable compatibility shape for import/export operations that still
// exchange a linear visual list. Current Components never store this result.
export function componentChainProjection(state = {}, component = {}) {
  const project = (layer) => layer.item?.kind === "group"
    ? { ...layer.item, chain: layer.children.map(project) }
    : layer.item;
  return componentLayerProjection(state, component).map(project);
}

function materializeLiveLayer(layer, overrides) {
  return {
    ...layer,
    item: mergeSparseConfiguration(layer.item, overrides[layer.nodeId]),
    children: layer.children.map((child) => materializeLiveLayer(child, overrides)),
  };
}

function mergeSparseConfiguration(authored, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) return authored;
  const result = { ...authored };
  for (const [key, value] of Object.entries(override)) {
    result[key] = value && typeof value === "object" && !Array.isArray(value)
      ? mergeSparseConfiguration(authored?.[key] && typeof authored[key] === "object" ? authored[key] : {}, value)
      : value;
  }
  return result;
}

export function selectedComponentLayer(state = {}, component = {}, nodeId = "") {
  const projection = componentLayerProjection(state, component);
  return findProjectedLayer(projection, String(nodeId || "")) || firstProjectedLayer(projection);
}

export function componentParameterAddress(nodeId = "", path = "") {
  const id = String(nodeId || "");
  const relativePath = String(path || "").replace(/^\.+|\.+$/g, "");
  return id && relativePath ? `${id}::${relativePath}` : "";
}

export function parseComponentParameterAddress(address = "") {
  const separator = String(address || "").indexOf("::");
  if (separator <= 0) return null;
  const nodeId = String(address).slice(0, separator);
  const path = String(address).slice(separator + 2);
  return nodeId && path ? { nodeId, path } : null;
}

export function componentParameterAddressForPath(state = {}, component = {}, path = "") {
  if (parseComponentParameterAddress(path)) return String(path);
  const layers = componentLayerProjection(state, component);
  const graphPath = String(path || "");
  for (const layer of flattenLayers(layers)) {
    const prefix = `${layer.path}.`;
    if (graphPath.startsWith(prefix)) {
      return componentParameterAddress(layer.nodeId, graphPath.slice(prefix.length));
    }
  }
  return "";
}

// Positional addresses are accepted only while loading an older project. The
// active UI and render transport never call this compatibility converter.
export function migrateLegacyComponentParameterAddress(state = {}, component = {}, path = "") {
  const activeAddress = componentParameterAddressForPath(state, component, path);
  if (activeAddress) return activeAddress;
  return legacyComponentParameterAddress(
    componentLayerProjection(state, component),
    String(path || ""),
  );
}

export function resolveComponentParameterAddress(state = {}, component = {}, address = "") {
  const parsed = parseComponentParameterAddress(address);
  if (!parsed) return null;
  const layer = findProjectedLayer(componentLayerProjection(state, component), parsed.nodeId);
  return layer ? {
    ...parsed,
    layer,
    graphPath: `${layer.path}.${parsed.path}`,
  } : null;
}

function projectGraphNodes(nodes, nodesPath) {
  const result = [];
  for (let index = 0; index < (nodes || []).length; index++) {
    const node = nodes[index];
    if (!["source", "effect", "group"].includes(node?.role) || node.auxiliaryFor) continue;
    const nodePath = `${nodesPath}.${index}`;
    if (!node.configuration) {
      throw new Error(`COMPONENT_GRAPH_CONFIGURATION_MISSING:${String(node.id || "missing")}`);
    }
    result.push({
      nodeId: String(node.id || ""),
      path: `${nodePath}.configuration`,
      item: node.configuration,
      children: node.role === "group"
        ? projectGraphNodes(node.nodes || [], `${nodePath}.nodes`)
        : [],
    });
  }
  return result;
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

function* flattenLayers(layers = []) {
  for (const layer of layers || []) {
    yield layer;
    yield* flattenLayers(layer.children);
  }
}

function legacyComponentParameterAddress(layers, path, base = "chain") {
  for (let index = 0; index < (layers || []).length; index++) {
    const layer = layers[index];
    const prefix = `${base}.${index}.`;
    if (path.startsWith(prefix)) {
      const remainder = path.slice(prefix.length);
      if (remainder.startsWith("chain.")) {
        const nested = legacyComponentParameterAddress(
          layer.children,
          remainder,
          "chain",
        );
        if (nested) return nested;
      } else {
        return componentParameterAddress(layer.nodeId, remainder);
      }
    }
  }
  return "";
}
