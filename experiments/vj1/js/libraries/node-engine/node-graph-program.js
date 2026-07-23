import { adaptPortValue } from "./node-runtime.js";

// A deterministic, call-driven graph program for control/data/utility groups.
// It intentionally has no frame clock or scheduler. Visual groups use a
// compiler backend instead, so their hot path is free to fuse and specialize.
export class NodeGraphProgram {
  constructor(definition, { registry, typeRegistry, clock, createInstance } = {}) {
    if (!definition?.id || !registry || typeof createInstance !== "function") throw new Error("NODE_GRAPH_PROGRAM_INVALID");
    this.definition = definition;
    this.registry = registry;
    this.graph = definition.parts?.find((part) => part.kind === "graph") || {};
    this.children = new Map();
    for (const child of this.graph.nodes || []) {
      const nodeId = child.type || child.nodeId;
      const version = child.version || child.nodeVersion || "";
      this.children.set(child.id, createInstance(registry.get(nodeId, version), {
        id: `${definition.id}/${child.id}`,
        parameters: child.parameters || {},
        registry,
        typeRegistry,
        clock,
      }));
    }
    this.order = topologicalOrder(this.graph.nodes || [], this.graph.connections || []);
  }

  async execute(inputs = {}, context = {}) {
    const outputs = new Map();
    for (const childId of this.order) {
      const child = this.children.get(childId);
      const childInputs = {};
      const childParameters = {};
      for (const section of this.definition.metadata?.controlProjection?.sections || []) {
        for (const control of section.controls || []) {
          if (!(control.parameterId in inputs)) continue;
          for (const binding of control.bindings || []) {
            if (binding.nodeId === childId) childParameters[binding.parameterId] = inputs[control.parameterId];
          }
        }
      }
      for (const edge of this.graph.connections || []) {
        const target = parseEndpoint(edge.to);
        if (target.node !== childId) continue;
        const source = parseEndpoint(edge.from);
        const value = endpointValue(source, inputs, outputs);
        if (value === undefined) continue;
        if (target.parameter) {
          childParameters[target.port] = value;
          continue;
        }
        const sourcePort = source.node === "$in"
          ? this.definition.inlets?.[source.port]
          : this.children.get(source.node)?.definition?.outlets?.[source.port];
        const targetPort = child.definition.inlets?.[target.port];
        childInputs[target.port] = adaptPortValue(value, sourcePort, targetPort);
      }
      for (const [publicId, destination] of Object.entries(this.graph.publicInlets || {})) {
        const target = parseEndpoint(destination);
        if (target.node !== childId || !(publicId in inputs)) continue;
        if (target.parameter) childParameters[target.port] = inputs[publicId];
        else childInputs[target.port] = adaptPortValue(inputs[publicId], this.definition.inlets?.[publicId], child.definition.inlets?.[target.port]);
      }
      outputs.set(childId, await child.run(childInputs, {
        ...context,
        // Group parameter overrides belong to the Group. Only bindings that
        // explicitly target this child may cross the compound boundary.
        parameters: childParameters,
      }));
    }

    const result = {};
    for (const edge of this.graph.connections || []) {
      const target = parseEndpoint(edge.to);
      if (target.node !== "$out") continue;
      result[target.port] = endpointValue(parseEndpoint(edge.from), inputs, outputs);
    }
    for (const [publicId, sourceEndpoint] of Object.entries(this.graph.publicOutlets || {})) {
      result[publicId] = endpointValue(parseEndpoint(sourceEndpoint), inputs, outputs);
    }
    return result;
  }

  dispose() {
    for (const child of this.children.values()) child.dispose();
    this.children.clear();
  }
}

function topologicalOrder(nodes, connections) {
  const ids = nodes.map((node) => String(node.id || ""));
  const indegree = new Map(ids.map((id) => [id, 0]));
  const outgoing = new Map(ids.map((id) => [id, []]));
  for (const edge of connections || []) {
    const from = parseEndpoint(edge.from).node;
    const to = parseEndpoint(edge.to).node;
    if (!indegree.has(from) || !indegree.has(to) || from === to) continue;
    outgoing.get(from).push(to);
    indegree.set(to, indegree.get(to) + 1);
  }
  const queue = ids.filter((id) => indegree.get(id) === 0);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const target of outgoing.get(id) || []) {
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  if (order.length !== ids.length) throw new Error(`NODE_GRAPH_CYCLE:${ids.filter((id) => !order.includes(id)).join(",")}`);
  return order;
}

function parseEndpoint(value) {
  const parts = String(value || "").split(".");
  if (parts.length >= 3 && parts[1] === "$parameter") return { node: parts[0], port: parts.slice(2).join("."), parameter: true };
  return { node: parts[0], port: parts.slice(1).join("."), parameter: false };
}

function endpointValue(endpoint, inputs, outputs) {
  if (endpoint.node === "$in") return inputs[endpoint.port];
  return outputs.get(endpoint.node)?.[endpoint.port];
}
