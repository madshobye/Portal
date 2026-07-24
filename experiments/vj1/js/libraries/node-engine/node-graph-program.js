import { adaptPortValue } from "./node-runtime.js";
import { valueTypeId } from "./node-types.js";

// A deterministic, call-driven graph program for control/data/utility groups.
// It intentionally has no frame clock or scheduler. Visual groups use a
// compiler backend instead, so their hot path is free to fuse and specialize.
export class NodeGraphProgram {
  constructor(definition, { registry, typeRegistry, clock, createInstance } = {}) {
    if (!definition?.id || !registry || typeof createInstance !== "function") throw new Error("NODE_GRAPH_PROGRAM_INVALID");
    validateNodeGraphProgramDefinition(definition, { registry });
    this.definition = definition;
    this.registry = registry;
    this.graph = definition.parts?.find((part) => part.kind === "graph") || {};
    this.children = new Map();
    this.childLiteralInputs = new Map();
    for (const child of this.graph.nodes || []) {
      const nodeId = child.type || child.nodeId;
      const version = child.version || child.nodeVersion || "";
      const childDefinition = registry.get(nodeId, version);
      this.children.set(child.id, createInstance(childDefinition, {
        id: `${definition.id}/${child.id}`,
        parameters: child.parameters || {},
        registry,
        typeRegistry,
        clock,
      }));
      this.childLiteralInputs.set(child.id, Object.fromEntries(
        Object.entries(child.parameters || {}).filter(([id]) => !!childDefinition.inlets?.[id])
      ));
    }
    this.order = topologicalOrder(this.graph.nodes || [], this.graph.connections || []);
  }

  async execute(inputs = {}, context = {}) {
    const outputs = new Map();
    for (const childId of this.order) {
      const child = this.children.get(childId);
      const childInputs = { ...(this.childLiteralInputs.get(childId) || {}) };
      const childParameters = {};
      for (const section of this.definition.metadata?.controlProjection?.sections || []) {
        for (const control of section.controls || []) {
          if (!(control.parameterId in inputs)) continue;
          for (const binding of control.bindings || []) {
            if (binding.nodeId !== childId) continue;
            if (child.definition.parameters?.[binding.parameterId]) {
              childParameters[binding.parameterId] = inputs[control.parameterId];
            } else if (child.definition.inlets?.[binding.parameterId]) {
              childInputs[binding.parameterId] = inputs[control.parameterId];
            }
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
    this.childLiteralInputs.clear();
  }
}

// Generic utility/control Groups are call-driven rather than render-compiled,
// but they still have a real compiler boundary. Validate the complete semantic
// graph before child construction so editor preflight and runtime activation
// reject the same invalid topology without instantiating partial resources.
export function validateNodeGraphProgramDefinition(definition, { registry } = {}) {
  if (!definition?.id || !registry) throw new Error("NODE_GRAPH_PROGRAM_INVALID");
  const graph = definition.parts?.find((part) => part.kind === "graph");
  if (!graph) throw new Error(`NODE_GRAPH_PART_MISSING:${definition.id}`);
  const nodes = graph.nodes || [];
  const byId = new Map();
  const childDefinitions = new Map();
  for (const child of nodes) {
    const childId = String(child.id || "");
    if (!childId || byId.has(childId)) {
      throw new Error(`NODE_GRAPH_CHILD_DUPLICATE:${definition.id}:${childId || "missing"}`);
    }
    const childDefinition = registry.get(child.type || child.nodeId, child.version || child.nodeVersion || "");
    byId.set(childId, child);
    childDefinitions.set(childId, childDefinition);
    for (const parameterId of Object.keys(child.parameters || {})) {
      if (!childDefinition.parameters?.[parameterId] && !childDefinition.inlets?.[parameterId]) {
        throw new Error(`NODE_GRAPH_LITERAL_UNKNOWN:${definition.id}:${childId}.${parameterId}`);
      }
    }
  }

  const incomingTargets = new Set();
  for (const edge of graph.connections || []) {
    const source = graphEndpoint(edge.from);
    const target = graphEndpoint(edge.to);
    const sourcePort = graphSourcePort(definition, childDefinitions, source);
    const targetPort = graphTargetPort(definition, childDefinitions, target);
    assertCompatibleGraphPorts(definition.id, edge.from, edge.to, sourcePort, targetPort);
    const targetKey = `${target.node}.${target.parameter ? "$parameter." : ""}${target.port}`;
    if (incomingTargets.has(targetKey)) {
      throw new Error(`NODE_GRAPH_INPUT_AMBIGUOUS:${definition.id}:${targetKey}`);
    }
    incomingTargets.add(targetKey);
  }

  for (const [publicId, destination] of Object.entries(graph.publicInlets || {})) {
    const publicPort = definition.inlets?.[publicId] || definition.parameters?.[publicId];
    if (!publicPort) throw new Error(`NODE_GRAPH_PUBLIC_INLET_UNKNOWN:${definition.id}:${publicId}`);
    const target = graphEndpoint(destination);
    const targetPort = graphTargetPort(definition, childDefinitions, target, { publicMapping: true });
    assertCompatibleGraphPorts(definition.id, `$in.${publicId}`, destination, publicPort, targetPort);
    const targetKey = `${target.node}.${target.parameter ? "$parameter." : ""}${target.port}`;
    if (incomingTargets.has(targetKey)) {
      throw new Error(`NODE_GRAPH_INPUT_AMBIGUOUS:${definition.id}:${targetKey}`);
    }
    incomingTargets.add(targetKey);
  }

  const publicOutputIds = new Set();
  for (const [publicId, sourceEndpoint] of Object.entries(graph.publicOutlets || {})) {
    const publicPort = definition.outlets?.[publicId];
    if (!publicPort) throw new Error(`NODE_GRAPH_PUBLIC_OUTLET_UNKNOWN:${definition.id}:${publicId}`);
    const sourcePort = graphSourcePort(
      definition,
      childDefinitions,
      graphEndpoint(sourceEndpoint),
      { publicMapping: true },
    );
    assertCompatibleGraphPorts(definition.id, sourceEndpoint, `$out.${publicId}`, sourcePort, publicPort);
    publicOutputIds.add(publicId);
  }
  for (const edge of graph.connections || []) {
    const target = graphEndpoint(edge.to);
    if (target.node !== "$out") continue;
    if (publicOutputIds.has(target.port)) {
      throw new Error(`NODE_GRAPH_OUTPUT_AMBIGUOUS:${definition.id}:${target.port}`);
    }
    publicOutputIds.add(target.port);
  }

  for (const section of definition.metadata?.controlProjection?.sections || []) {
    for (const control of section.controls || []) {
      if (!definition.parameters?.[control.parameterId] && !definition.inlets?.[control.parameterId]) {
        throw new Error(`NODE_GRAPH_CONTROL_PUBLIC_UNKNOWN:${definition.id}:${control.parameterId}`);
      }
      for (const binding of control.bindings || []) {
        const childDefinition = childDefinitions.get(String(binding.nodeId || ""));
        if (!childDefinition) {
          throw new Error(`NODE_GRAPH_CONTROL_CHILD_UNKNOWN:${definition.id}:${binding.nodeId || "missing"}`);
        }
        if (!childDefinition.parameters?.[binding.parameterId] && !childDefinition.inlets?.[binding.parameterId]) {
          throw new Error(`NODE_GRAPH_CONTROL_TARGET_UNKNOWN:${definition.id}:${binding.nodeId}.${binding.parameterId}`);
        }
        incomingTargets.add(`${binding.nodeId}.$parameter.${binding.parameterId}`);
      }
    }
  }

  for (const [childId, childDefinition] of childDefinitions) {
    const child = byId.get(childId);
    for (const [inletId, inlet] of Object.entries(childDefinition.inlets || {})) {
      if (
        inlet.required === true
        && inlet.defaultValue === undefined
        && child.parameters?.[inletId] === undefined
        && !incomingTargets.has(`${childId}.${inletId}`)
        && !incomingTargets.has(`${childId}.$parameter.${inletId}`)
      ) {
        throw new Error(`NODE_GRAPH_INLET_REQUIRED:${definition.id}:${childId}.${inletId}`);
      }
    }
  }
  topologicalOrder(nodes, graph.connections || []);
  return true;
}

function graphEndpoint(value) {
  const endpoint = parseEndpoint(value);
  if (!endpoint.node || !endpoint.port) throw new Error(`NODE_GRAPH_ENDPOINT_INVALID:${String(value || "")}`);
  return endpoint;
}

function graphSourcePort(definition, childDefinitions, endpoint, { publicMapping = false } = {}) {
  if (endpoint.parameter) throw new Error(`NODE_GRAPH_SOURCE_PARAMETER_INVALID:${definition.id}:${endpoint.node}.${endpoint.port}`);
  if (endpoint.node === "$in") {
    const port = definition.inlets?.[endpoint.port] || definition.parameters?.[endpoint.port];
    if (!port) throw new Error(`NODE_GRAPH_SOURCE_PORT_MISSING:${definition.id}:$in.${endpoint.port}`);
    return port;
  }
  if (endpoint.node === "$out") {
    throw new Error(`NODE_GRAPH_SOURCE_NODE_INVALID:${definition.id}:$out`);
  }
  const childDefinition = childDefinitions.get(endpoint.node);
  if (!childDefinition) throw new Error(`NODE_GRAPH_CHILD_MISSING:${definition.id}:${endpoint.node}`);
  const port = childDefinition.outlets?.[endpoint.port];
  if (!port) {
    const code = publicMapping ? "NODE_GRAPH_PUBLIC_SOURCE_PORT_MISSING" : "NODE_GRAPH_SOURCE_PORT_MISSING";
    throw new Error(`${code}:${definition.id}:${endpoint.node}.${endpoint.port}`);
  }
  return port;
}

function graphTargetPort(definition, childDefinitions, endpoint, { publicMapping = false } = {}) {
  if (endpoint.node === "$out") {
    if (endpoint.parameter) throw new Error(`NODE_GRAPH_TARGET_PARAMETER_INVALID:${definition.id}:$out.${endpoint.port}`);
    const port = definition.outlets?.[endpoint.port];
    if (!port) throw new Error(`NODE_GRAPH_TARGET_PORT_MISSING:${definition.id}:$out.${endpoint.port}`);
    return port;
  }
  if (endpoint.node === "$in") throw new Error(`NODE_GRAPH_TARGET_NODE_INVALID:${definition.id}:$in`);
  const childDefinition = childDefinitions.get(endpoint.node);
  if (!childDefinition) throw new Error(`NODE_GRAPH_CHILD_MISSING:${definition.id}:${endpoint.node}`);
  const port = endpoint.parameter
    ? childDefinition.parameters?.[endpoint.port] || childDefinition.inlets?.[endpoint.port]
    : childDefinition.inlets?.[endpoint.port];
  if (!port) {
    const code = publicMapping ? "NODE_GRAPH_PUBLIC_TARGET_PORT_MISSING" : "NODE_GRAPH_TARGET_PORT_MISSING";
    throw new Error(`${code}:${definition.id}:${endpoint.node}.${endpoint.port}`);
  }
  return port;
}

function assertCompatibleGraphPorts(groupId, from, to, sourcePort, targetPort) {
  const sourceType = valueTypeId(sourcePort?.type || sourcePort || "any");
  const targetType = valueTypeId(targetPort?.type || targetPort || "any");
  if (sourceType !== "any" && targetType !== "any" && sourceType !== targetType) {
    throw new Error(`NODE_GRAPH_PORT_TYPE_MISMATCH:${groupId}:${from}:${to}:${sourceType}:${targetType}`);
  }
}

function topologicalOrder(nodes, connections) {
  const ids = nodes.map((node) => String(node.id || ""));
  const indegree = new Map(ids.map((id) => [id, 0]));
  const outgoing = new Map(ids.map((id) => [id, []]));
  for (const edge of connections || []) {
    const from = parseEndpoint(edge.from).node;
    const to = parseEndpoint(edge.to).node;
    if (!indegree.has(from) || !indegree.has(to)) continue;
    if (from === to) throw new Error(`NODE_GRAPH_CYCLE:${from}`);
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
