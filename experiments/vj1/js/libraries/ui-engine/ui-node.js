import {
  defineNode,
  NODE_IMPLEMENTATION_KINDS,
  NODE_PART_KINDS,
} from "../node-engine/index.js";

export const UI_NODE_FORMAT = "ui-node@1";
export const UI_GRAPH_FORMAT = "ui-graph@1";

export const UI_STATE_LIFETIMES = Object.freeze({
  EPHEMERAL: "ephemeral",
  SESSION: "session",
  PROJECT: "project",
});

export const UI_COMMAND_PHASES = Object.freeze({
  BEGIN: "begin",
  CHANGE: "change",
  COMMIT: "commit",
  CANCEL: "cancel",
});

export function defineUiNode(definition = {}) {
  const factory = definition.factory;
  if (typeof factory !== "function") {
    throw new TypeError(`UI_NODE_FACTORY_REQUIRED:${definition.id || "missing"}`);
  }
  const state = normalizeUiStateFields(definition.state);
  const events = Object.freeze((definition.events || []).map(normalizeUiEvent));
  return defineNode({
    ...definition,
    implementation: NODE_IMPLEMENTATION_KINDS.NATIVE,
    execution: {
      trigger: "input-change",
      domain: "ui",
      stateful: state.length > 0,
      ...(definition.execution || {}),
    },
    capabilities: ["ui-node", "retained-dom", ...(definition.capabilities || [])],
    presentation: {
      catalogs: ["ui", ...(definition.presentation?.catalogs || [])],
      placeableOn: ["ui-graph", ...(definition.presentation?.placeableOn || [])],
      ...(definition.presentation || {}),
    },
    parts: [{
      id: "ui-lifecycle",
      name: "Retained UI lifecycle",
      kind: NODE_PART_KINDS.UI,
      editable: false,
      control: String(definition.control || definition.id || "ui-node"),
    }, ...(definition.parts || [])],
    metadata: {
      ...(definition.metadata || {}),
      uiNode: Object.freeze({
        format: UI_NODE_FORMAT,
        state,
        events,
      }),
    },
    moduleExports: {
      ...(definition.moduleExports || {}),
      createUiInstance: factory,
    },
    process: null,
  });
}

export function isUiNodeDefinition(definition) {
  return definition?.metadata?.uiNode?.format === UI_NODE_FORMAT &&
    typeof definition?.moduleExports?.createUiInstance === "function";
}

export function defineUiGraph(graph = {}) {
  const id = requiredText(graph.id, "UI_GRAPH_ID_REQUIRED");
  const nodes = (graph.nodes || []).map((node) => {
    const nodeId = requiredText(node.id, `UI_GRAPH_NODE_ID_REQUIRED:${id}`);
    assertDeclarativeUiValue(node.inputs || {}, `${id}:${nodeId}:inputs`);
    assertDeclarativeUiValue(node.commands || {}, `${id}:${nodeId}:commands`);
    return Object.freeze({
      id: nodeId,
      type: requiredText(node.type || node.nodeId, `UI_GRAPH_NODE_TYPE_REQUIRED:${id}`),
      version: String(node.version || ""),
      parent: String(node.parent || ""),
      slot: String(node.slot || "default"),
      inputs: Object.freeze({ ...(node.inputs || {}) }),
      stateAddress: String(node.stateAddress || ""),
      commands: normalizeUiCommandBindings(node.commands),
    });
  });
  const ids = new Set(nodes.map((node) => node.id));
  if (ids.size !== nodes.length) throw new Error(`UI_GRAPH_NODE_DUPLICATE:${id}`);
  for (const node of nodes) {
    if (node.parent && !ids.has(node.parent)) {
      throw new Error(`UI_GRAPH_PARENT_UNKNOWN:${id}:${node.id}:${node.parent}`);
    }
  }
  assertUiGraphAcyclic(id, nodes);
  return Object.freeze({
    format: UI_GRAPH_FORMAT,
    id,
    version: Math.max(1, Number(graph.version) || 1),
    nodes: Object.freeze(nodes),
  });
}

export function orderedUiGraphNodes(graph = {}) {
  const normalized = graph?.format === UI_GRAPH_FORMAT ? graph : defineUiGraph(graph);
  const pending = new Map(normalized.nodes.map((node) => [node.id, node]));
  const ordered = [];
  while (pending.size) {
    const ready = [...pending.values()].filter((node) => !node.parent || !pending.has(node.parent));
    if (!ready.length) throw new Error(`UI_GRAPH_CYCLE:${normalized.id}`);
    for (const node of ready) {
      pending.delete(node.id);
      ordered.push(node);
    }
  }
  return Object.freeze(ordered);
}

export function createUiCommand({
  nodeId = "",
  type = "change",
  phase = UI_COMMAND_PHASES.COMMIT,
  payload = {},
  address = "",
  action = "",
  target = null,
  timestamp = Date.now(),
} = {}) {
  const normalizedPhase = Object.values(UI_COMMAND_PHASES).includes(phase)
    ? phase
    : UI_COMMAND_PHASES.COMMIT;
  return Object.freeze({
    domain: "ui",
    nodeId: requiredText(nodeId, "UI_COMMAND_NODE_REQUIRED"),
    type: requiredText(type, "UI_COMMAND_TYPE_REQUIRED"),
    phase: normalizedPhase,
    address: String(address || ""),
    action: String(action || ""),
    target: freezeUiCommandTarget(target),
    payload: Object.freeze({ ...(payload || {}) }),
    timestamp: Math.max(0, Number(timestamp) || 0),
  });
}

function normalizeUiCommandBindings(bindings = {}) {
  return Object.freeze(Object.fromEntries(Object.entries(bindings || {}).map(([event, binding]) => {
    const source = typeof binding === "string" ? { action: binding } : binding || {};
    return [requiredText(event, "UI_COMMAND_BINDING_EVENT_REQUIRED"), Object.freeze({
      action: requiredText(source.action, `UI_COMMAND_BINDING_ACTION_REQUIRED:${event}`),
      address: String(source.address || ""),
      target: freezeUiCommandTarget(source.target),
      payload: Object.freeze({ ...(source.payload && typeof source.payload === "object" ? source.payload : {}) }),
    })];
  })));
}

function freezeUiCommandTarget(target) {
  if (!target || typeof target !== "object" || Array.isArray(target)) return null;
  return Object.freeze({ ...target });
}

function normalizeUiStateFields(fields = []) {
  return Object.freeze((fields || []).map((field) => {
    const source = typeof field === "string" ? { id: field } : field || {};
    const lifetime = Object.values(UI_STATE_LIFETIMES).includes(source.lifetime)
      ? source.lifetime
      : UI_STATE_LIFETIMES.SESSION;
    return Object.freeze({
      id: requiredText(source.id, "UI_NODE_STATE_ID_REQUIRED"),
      lifetime,
      defaultValue: source.defaultValue,
    });
  }));
}

function normalizeUiEvent(event) {
  const source = typeof event === "string" ? { id: event } : event || {};
  return Object.freeze({
    id: requiredText(source.id, "UI_NODE_EVENT_ID_REQUIRED"),
    phase: Object.values(UI_COMMAND_PHASES).includes(source.phase)
      ? source.phase
      : UI_COMMAND_PHASES.COMMIT,
  });
}

function requiredText(value, error) {
  const text = String(value || "").trim();
  if (!text) throw new Error(error);
  return text;
}

function assertDeclarativeUiValue(value, path, seen = new Set()) {
  if (typeof value === "function") throw new Error(`UI_GRAPH_FUNCTION_FORBIDDEN:${path}`);
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertDeclarativeUiValue(child, `${path}/${index}`, seen));
    return;
  }
  for (const [key, child] of Object.entries(value)) assertDeclarativeUiValue(child, `${path}/${key}`, seen);
}

function assertUiGraphAcyclic(id, nodes) {
  const parents = new Map(nodes.map((node) => [node.id, node.parent]));
  for (const node of nodes) {
    const visited = new Set([node.id]);
    let parent = node.parent;
    while (parent) {
      if (visited.has(parent)) throw new Error(`UI_GRAPH_CYCLE:${id}:${node.id}`);
      visited.add(parent);
      parent = parents.get(parent) || "";
    }
  }
}
