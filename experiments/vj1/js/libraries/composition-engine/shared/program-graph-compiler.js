export function compileReachableProgramGraph(group = {}, {
  outputs = [],
  edgeFilter = () => true,
} = {}) {
  const nodes = (group.nodes || []).filter((node) => node.role !== "control");
  const byId = new Map(nodes.map((node) => [String(node.id || ""), node]));
  const connections = (group.connections || []).filter(edgeFilter);
  const roots = outputs.length
    ? connections.filter((edge) => outputs.includes(edge.to))
    : connections.filter((edge) => String(edge.to || "").startsWith("$out."));
  const incoming = new Map();
  for (const edge of connections) {
    const target = endpointNode(edge.to);
    if (!incoming.has(target)) incoming.set(target, []);
    incoming.get(target).push(edge);
  }
  const ordered = [];
  const visiting = new Set();
  const visited = new Set();
  const visitEndpoint = (endpoint) => {
    const nodeId = endpointNode(endpoint);
    if (!nodeId || nodeId.startsWith("$")) return;
    const node = byId.get(nodeId);
    if (!node) throw new Error(`PROGRAM_GRAPH_NODE_MISSING:${group.id}:${nodeId}`);
    if (visiting.has(nodeId)) throw new Error(`PROGRAM_GRAPH_CYCLE:${group.id}:${nodeId}`);
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const edge of incoming.get(nodeId) || []) visitEndpoint(edge.from);
    visiting.delete(nodeId);
    visited.add(nodeId);
    ordered.push(node);
  };
  for (const edge of roots) visitEndpoint(edge.from);
  const reachableConnections = connections.filter((edge) => {
    const source = endpointNode(edge.from);
    const target = endpointNode(edge.to);
    return (source.startsWith("$") || visited.has(source)) && (target.startsWith("$") || visited.has(target));
  });
  return Object.freeze({
    id: group.id,
    nodes: Object.freeze(ordered),
    connections: Object.freeze(reachableConnections),
    disconnected: Object.freeze(nodes.filter((node) => !visited.has(node.id))),
    outputs: Object.freeze([...outputs]),
  });
}

export function programGraphDependencies(plan = {}) {
  const nodeById = new Map((plan.nodes || []).map((node) => [node.id, node]));
  const result = new Map((plan.nodes || []).map((node) => [node.id, new Set()]));
  for (const edge of plan.connections || []) {
    const source = endpointNode(edge.from);
    const target = endpointNode(edge.to);
    if (!nodeById.has(source) || !nodeById.has(target)) continue;
    result.get(target).add(source);
  }
  return result;
}

function endpointNode(endpoint) {
  return String(endpoint || "").split(".")[0];
}
