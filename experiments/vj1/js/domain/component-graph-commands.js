import {
  compileComponentGraphItemTopology,
  COMPONENT_PROGRAM_GENERATOR,
  reconcileComponentCompositionConnections,
} from "../libraries/composition-engine/shared/component-program-compiler.js";
import {
  parameterAnimationTracks,
  removeParameterAnimationTrack,
} from "../libraries/composition-engine/shared/parameter-animation-tracks.js";

export const COMPONENT_GRAPH_COMMANDS = Object.freeze({
  INSERT: "component.graph.insert",
  REMOVE: "component.graph.remove",
  MOVE: "component.graph.move",
});

// The abstract layer editor edits the persisted Component Group directly.
// `component.chain` is never read or written here; it is only a disposable
// projection materialized at compile/transport boundaries that still need a
// Component-shaped execution model.
export function applyComponentGraphCommand(state, command = {}) {
  const componentId = String(command.componentId || "");
  let group = componentGraph(state, componentId);
  if (!group) return Object.freeze({ changed: false, selectionId: "" });
  const definitions = componentDefinitionMap(state);
  let changed = false;
  let selectionId = String(command.selectionId || "");

  if (command.type === COMPONENT_GRAPH_COMMANDS.INSERT && command.item?.id) {
    const topology = compileComponentGraphItemTopology(command.item, {
      definitions,
      statePath: `graph:${componentId}:${String(command.item.id)}`,
    });
    const target = findGraphNodeScope(group, String(command.afterNodeId || ""));
    const destination = target?.node?.role === "group" ? target.node : target?.scope || group;
    const insertAt = target?.node?.role === "group"
      ? destination.nodes.length
      : target
        ? target.index + 1
        : destination.nodes.length;
    destination.nodes.splice(insertAt, 0, ...topology.nodes);
    reconcileScope(destination, definitions, topology.connections);
    changed = true;
    selectionId = String(command.item.id);
  } else if (command.type === COMPONENT_GRAPH_COMMANDS.REMOVE) {
    const nodeId = String(command.nodeId || "");
    for (const track of parameterAnimationTracks(state.nodes, componentId, nodeId)) {
      state.nodes = removeParameterAnimationTrack(state.nodes, {
        componentId,
        targetNodeId: nodeId,
        trackId: track.id,
      });
    }
    group = componentGraph(state, componentId);
    const location = findGraphNodeScope(group, nodeId);
    if (location) {
      const owned = ownedGraphNodeIds(location.scope.nodes, nodeId);
      location.scope.nodes = location.scope.nodes.filter((node) => !owned.has(String(node.id || "")));
      location.scope.connections = location.scope.connections.filter((edge) =>
        !owned.has(endpointNodeId(edge.from)) && !owned.has(endpointNodeId(edge.to))
      );
      reconcileScope(location.scope, definitions);
      changed = true;
      if (selectionId === nodeId) selectionId = firstGraphNodeId(group);
    }
  } else if (command.type === COMPONENT_GRAPH_COMMANDS.MOVE) {
    changed = moveGraphNode(
      group,
      String(command.nodeId || ""),
      String(command.targetNodeId || ""),
      command.position || "before",
      definitions,
    );
  } else {
    throw new Error(`COMPONENT_GRAPH_COMMAND_UNKNOWN:${String(command.type || "missing")}`);
  }

  return Object.freeze({ changed, selectionId });
}

export function componentGraphCommandEvent(command, reason) {
  return Object.freeze({
    reason: String(reason || command?.type || "component-graph-command"),
    graphCommand: Object.freeze({ ...command }),
    effects: { graph: { mode: "recompile" } },
  });
}

export function componentGraphNode(state = {}, componentId = "", nodeId = "") {
  return findGraphNodeScope(componentGraph(state, componentId), String(nodeId || ""))?.node || null;
}

export function clearComponentGraphReferences(state = {}, removedComponentId = "") {
  for (const group of state.nodes?.groups || []) {
    if (group.generatedBy !== COMPONENT_PROGRAM_GENERATOR) continue;
    visitGraphNodes(group.nodes || [], (node) => {
      const source = node.configuration?.source;
      if (node.role !== "source" || source?.type !== "component" ||
          String(source.componentId || "") !== String(removedComponentId || "")) return;
      source.componentId = "";
      node.parameters = { ...(node.parameters || {}), componentId: "" };
    });
  }
}

function moveGraphNode(group, nodeId, targetNodeId, position, definitions) {
  if (!nodeId || !targetNodeId || nodeId === targetNodeId) return false;
  const source = findGraphNodeScope(group, nodeId);
  const target = findGraphNodeScope(group, targetNodeId);
  if (!source || !target || graphNodeContains(source.node, targetNodeId)) return false;
  const destination = position === "inside" ? target.node : target.scope;
  if (position === "inside" && target.node.role !== "group") return false;
  if (source.scope !== destination && graphNodeHasExternalBindings(source.scope, nodeId)) {
    throw new Error(`COMPONENT_GRAPH_MOVE_BOUND_SCOPE:${nodeId}`);
  }

  const owned = ownedGraphNodeIds(source.scope.nodes, nodeId);
  const bundle = source.scope.nodes.filter((node) => owned.has(String(node.id || "")));
  source.scope.nodes = source.scope.nodes.filter((node) => !owned.has(String(node.id || "")));
  source.scope.connections = source.scope.connections.filter((edge) =>
    !owned.has(endpointNodeId(edge.from)) && !owned.has(endpointNodeId(edge.to))
  );
  reconcileScope(source.scope, definitions);

  const refreshedTarget = findGraphNodeScope(group, targetNodeId);
  const targetScope = position === "inside" ? refreshedTarget.node : refreshedTarget.scope;
  const targetIndex = position === "inside"
    ? targetScope.nodes.length
    : refreshedTarget.index + (position === "after" ? 1 : 0);
  targetScope.nodes.splice(targetIndex, 0, ...bundle);
  reconcileScope(targetScope, definitions);
  return true;
}

function reconcileScope(scope, definitions, additions = []) {
  scope.connections = reconcileComponentCompositionConnections(
    scope.nodes || [],
    [...(scope.connections || []), ...(additions || [])],
    definitions,
  );
  const renderNodes = (scope.nodes || []).filter(isGraphRenderNode);
  if (Object.hasOwn(scope, "publicOutlets")) {
    scope.publicOutlets = {
      ...(scope.publicOutlets || {}),
      texture: renderNodes.length ? `${renderNodes.at(-1).id}.texture` : "$in.texture",
    };
  }
}

function componentGraph(state, componentId) {
  return state.nodes?.groups?.find((group) =>
    group.generatedBy === COMPONENT_PROGRAM_GENERATOR &&
    String(group.componentId || "") === String(componentId || "")
  ) || null;
}

function componentDefinitionMap(state) {
  return new Map((state.nodes?.definitions || []).map((definition) => [String(definition.id || ""), definition]));
}

function findGraphNodeScope(scope, nodeId) {
  if (!scope || !nodeId) return null;
  for (let index = 0; index < (scope.nodes || []).length; index++) {
    const node = scope.nodes[index];
    if (String(node.id || "") === nodeId) return { scope, node, index };
    if (node.role === "group") {
      const nested = findGraphNodeScope(node, nodeId);
      if (nested) return nested;
    }
  }
  return null;
}

function ownedGraphNodeIds(nodes, targetNodeId) {
  return new Set((nodes || []).filter((node) =>
    String(node.id || "") === targetNodeId ||
    String(node.targetNodeId || "") === targetNodeId ||
    String(node.auxiliaryFor?.nodeId || "") === targetNodeId
  ).map((node) => String(node.id || "")));
}

function graphNodeHasExternalBindings(scope, targetNodeId) {
  const owned = ownedGraphNodeIds(scope.nodes || [], targetNodeId);
  return (scope.connections || []).some((edge) => {
    if (edge.semantic === "composition") return false;
    const from = endpointNodeId(edge.from);
    const to = endpointNodeId(edge.to);
    return (owned.has(from) && !owned.has(to) && to !== "$out") ||
      (owned.has(to) && !owned.has(from) && from !== "$in");
  });
}

function graphNodeContains(node, nodeId) {
  return (node?.nodes || []).some((child) =>
    String(child.id || "") === nodeId || graphNodeContains(child, nodeId)
  );
}

function firstGraphNodeId(scope) {
  return String((scope?.nodes || []).find(isGraphRenderNode)?.id || "");
}

function visitGraphNodes(nodes, visitor) {
  for (const node of nodes || []) {
    visitor(node);
    visitGraphNodes(node.nodes || [], visitor);
  }
}

function isGraphRenderNode(node) {
  return ["source", "effect", "group"].includes(node?.role) && !node?.auxiliaryFor;
}

function endpointNodeId(endpoint = "") {
  return String(endpoint || "").split(".")[0];
}
