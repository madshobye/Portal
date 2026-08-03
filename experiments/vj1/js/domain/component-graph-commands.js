import {
  findChainItemLocation,
  insertChainItemNearSelection,
  moveChainItem,
} from "./chain-operations.js";

export const COMPONENT_GRAPH_COMMANDS = Object.freeze({
  INSERT: "component.graph.insert",
  REMOVE: "component.graph.remove",
  MOVE: "component.graph.move",
});

// The abstract layer editor issues semantic graph commands. During the state
// transaction this function updates the materialized editor projection; the
// node-package activation boundary compiles and validates the authoritative
// Component Group atomically before publication. No UI controller owns raw
// array splice/reorder semantics.
export function applyComponentGraphCommand(state, command = {}) {
  const component = state.components?.find((item) => String(item.id) === String(command.componentId || ""));
  if (!component) return Object.freeze({ changed: false, selectionId: "" });
  component.chain ||= [];
  let changed = false;
  let selectionId = String(command.selectionId || "");

  if (command.type === COMPONENT_GRAPH_COMMANDS.INSERT && command.item?.id) {
    insertChainItemNearSelection(component.chain, command.afterNodeId || "", command.item);
    changed = true;
    selectionId = String(command.item.id);
  } else if (command.type === COMPONENT_GRAPH_COMMANDS.REMOVE) {
    changed = removeProjectedNode(component.chain, String(command.nodeId || ""));
    if (changed && selectionId === String(command.nodeId || "")) {
      selectionId = firstProjectedNodeId(component.chain);
    }
  } else if (command.type === COMPONENT_GRAPH_COMMANDS.MOVE) {
    changed = moveChainItem(
      component.chain,
      String(command.nodeId || ""),
      String(command.targetNodeId || ""),
      command.position || "before",
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

function removeProjectedNode(chain = [], nodeId = "") {
  const location = findChainItemLocation(chain, nodeId);
  if (!location) return false;
  location.chain.splice(location.index, 1);
  return true;
}

function firstProjectedNodeId(chain = []) {
  return String(chain?.[0]?.id || "");
}
