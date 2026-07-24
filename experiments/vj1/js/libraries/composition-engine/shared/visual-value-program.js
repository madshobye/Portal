export class VisualValueProgram {
  constructor({ id = "", steps = [], bindings = [], diagnostics = [] } = {}) {
    this.id = String(id || "visual-values");
    this.steps = Object.freeze([...steps]);
    this.bindings = Object.freeze([...bindings]);
    this.diagnostics = Object.freeze([...diagnostics]);
    this.outputs = new Map();
    this.format = "vj1.visual-value-program@1";
    this.contractVersion = 1;
  }

  evaluate({ componentTime = 0, timestamp = componentTime, renderRequest = null } = {}) {
    this.outputs.clear();
    for (const binding of this.bindings) binding.operation.runtimeValueInputs?.clear?.();
    for (const step of this.steps) {
      const inputs = step.inputValues;
      for (const id of step.parameterIds) inputs[id] = step.parameters[id];
      for (const edge of step.inputs) {
        const source = this.outputs.get(edge.sourceStepId);
        if (!source || !(edge.sourcePortId in source)) {
          throw new Error(`VISUAL_VALUE_OUTPUT_MISSING:${this.id}:${edge.sourceStepId}.${edge.sourcePortId}`);
        }
        inputs[edge.targetPortId] = source[edge.sourcePortId];
      }
      for (const [id, inlet] of Object.entries(step.inlets)) {
        if (inlet.required && inputs[id] === undefined) {
          throw new Error(`VISUAL_VALUE_INLET_REQUIRED:${this.id}:${step.id}.${id}`);
        }
      }
      const context = step.processContext;
      context.componentTime = componentTime;
      context.timestamp = timestamp;
      context.renderRequest = renderRequest;
      const output = step.process(inputs, context);
      if (output && typeof output.then === "function") {
        throw new Error(`VISUAL_VALUE_ASYNC_RESULT:${this.id}:${step.id}`);
      }
      if (output !== step.outputValues) retainValues(step.outputValues, output);
      this.outputs.set(step.id, step.outputValues);
    }
    for (const binding of this.bindings) {
      const output = this.outputs.get(binding.sourceStepId);
      if (!output || !(binding.sourcePortId in output)) {
        throw new Error(`VISUAL_VALUE_OUTPUT_MISSING:${this.id}:${binding.sourceStepId}.${binding.sourcePortId}`);
      }
      binding.operation.runtimeValueInputs.set(binding.targetPortId, output[binding.sourcePortId]);
    }
    return this.outputs;
  }

  dispose() {
    for (const step of this.steps) {
      try {
        step.dispose?.({ state: step.state, output: step.outputValues });
      } catch {}
      for (const key in step.outputValues) delete step.outputValues[key];
    }
    for (const binding of this.bindings) binding.operation.runtimeValueInputs?.clear?.();
    this.outputs.clear();
  }
}

export function compileVisualValueProgram(group = {}, operations = [], {
  resolveDefinition = null,
} = {}) {
  const nodes = group.nodes || [];
  const connections = group.connections || [];
  const values = nodes.filter((node) => node.role === "value");
  const valueById = new Map(values.map((node) => [String(node.id || ""), node]));
  const operationById = new Map((operations || []).map((operation) => [String(operation.id || ""), operation]));
  const renderBindings = connections
    .map((edge) => compileRenderBinding(edge, valueById, operationById))
    .filter(Boolean);
  const required = collectRequiredValues(renderBindings, connections, valueById, group.id || "component");
  const ordered = topologicalValues(required, connections, valueById, group.id || "component");
  const steps = ordered.map((node) => compileValueStep(
    node,
    connections,
    required,
    valueById,
    resolveDefinition,
    group.id || "component",
  ));
  const stepIds = new Map(steps.map((step) => [step.instanceId, step.id]));
  const bindings = renderBindings.map((binding) => Object.freeze({
    ...binding,
    sourceStepId: stepIds.get(binding.sourceStepId),
  }));
  const diagnostics = values
    .filter((node) => !required.has(node.id))
    .map((node) => Object.freeze({
      code: "VISUAL_VALUE_UNUSED_NODE",
      path: `${group.id || "component"}/${node.id}`,
      message: "Value node is not connected to a retained render operation.",
    }));
  return new VisualValueProgram({
    id: `${group.id || "component"}.values`,
    steps,
    bindings,
    diagnostics,
  });
}

function compileValueStep(node, connections, required, valueById, resolveDefinition, path) {
  const definition = resolveValueDefinition(node, resolveDefinition);
  validateValueDefinition(node, definition, path);
  const parameters = Object.fromEntries(Object.entries(definition.parameters || {}).flatMap(([id, parameter]) =>
    parameter.defaultValue === undefined ? [] : [[id, parameter.defaultValue]]));
  Object.assign(parameters, node.parameters || {});
  for (const [id, inlet] of Object.entries(definition.inlets || {})) {
    if (parameters[id] === undefined && inlet.defaultValue !== undefined) parameters[id] = inlet.defaultValue;
  }
  const inputValues = { ...parameters };
  const inputs = connections
    .map((edge) => compileValueInput(edge, node, valueById, required, path))
    .filter(Boolean);
  const state = {};
  const outputValues = {};
  return Object.freeze({
    id: `${path}/${node.id}`,
    instanceId: String(node.id || ""),
    nodeId: String(node.nodeId || node.type || ""),
    parameters,
    parameterIds: Object.freeze(Object.keys(parameters)),
    inlets: definition.inlets || {},
    inputs: Object.freeze(inputs.map((input) => Object.freeze({
      ...input,
      sourceStepId: `${path}/${input.sourceStepId}`,
    }))),
    inputValues,
    outputValues,
    process: definition.process,
    dispose: definition.execution?.dispose,
    frameDynamic: definition.execution?.trigger === "frame",
    state,
    processContext: {
      componentTime: 0,
      timestamp: 0,
      renderRequest: null,
      state,
      parameters,
      output: outputValues,
      executionClass: "retained-value",
    },
  });
}

function compileRenderBinding(edge, valueById, operationById) {
  if (textureEdge(edge) || parameterEndpoint(edge.to)) return null;
  const source = endpoint(edge.from);
  const target = endpoint(edge.to);
  if (!source || !target || !valueById.has(source.nodeId) || !operationById.has(target.nodeId)) return null;
  return {
    sourceStepId: source.nodeId,
    sourcePortId: source.portId,
    operation: operationById.get(target.nodeId),
    targetPortId: target.portId,
  };
}

function collectRequiredValues(bindings, connections, valueById, path) {
  const required = new Set();
  const incoming = new Map();
  for (const edge of connections) {
    if (textureEdge(edge) || parameterEndpoint(edge.to)) continue;
    const target = endpoint(edge.to);
    if (!target || !valueById.has(target.nodeId)) continue;
    const list = incoming.get(target.nodeId) || [];
    list.push(edge);
    incoming.set(target.nodeId, list);
  }
  const visit = (nodeId) => {
    if (required.has(nodeId)) return;
    if (!valueById.has(nodeId)) throw new Error(`VISUAL_VALUE_NODE_MISSING:${path}:${nodeId}`);
    required.add(nodeId);
    for (const edge of incoming.get(nodeId) || []) {
      const source = endpoint(edge.from);
      if (source?.nodeId && valueById.has(source.nodeId)) visit(source.nodeId);
    }
  };
  for (const binding of bindings) visit(binding.sourceStepId);
  return required;
}

function topologicalValues(required, connections, valueById, path) {
  const incoming = new Map([...required].map((id) => [id, 0]));
  const outgoing = new Map([...required].map((id) => [id, []]));
  for (const edge of connections) {
    if (textureEdge(edge) || parameterEndpoint(edge.to)) continue;
    const source = endpoint(edge.from);
    const target = endpoint(edge.to);
    if (!source || !target || !required.has(source.nodeId) || !required.has(target.nodeId)) continue;
    incoming.set(target.nodeId, incoming.get(target.nodeId) + 1);
    outgoing.get(source.nodeId).push(target.nodeId);
  }
  const queue = [...required].filter((id) => incoming.get(id) === 0);
  const result = [];
  while (queue.length) {
    const id = queue.shift();
    result.push(valueById.get(id));
    for (const target of outgoing.get(id)) {
      const count = incoming.get(target) - 1;
      incoming.set(target, count);
      if (count === 0) queue.push(target);
    }
  }
  if (result.length !== required.size) {
    const cycle = [...required].find((id) => incoming.get(id) > 0);
    throw new Error(`VISUAL_VALUE_CYCLE:${path}:${cycle || "unknown"}`);
  }
  return result;
}

function compileValueInput(edge, node, valueById, required, path) {
  if (textureEdge(edge) || parameterEndpoint(edge.to)) return null;
  const target = endpoint(edge.to);
  if (!target || target.nodeId !== node.id) return null;
  const source = endpoint(edge.from);
  if (!source || !valueById.has(source.nodeId) || !required.has(source.nodeId)) {
    throw new Error(`VISUAL_VALUE_INPUT_SOURCE_INVALID:${path}:${edge.from}`);
  }
  return {
    sourceStepId: source.nodeId,
    sourcePortId: source.portId,
    targetPortId: target.portId,
  };
}

function resolveValueDefinition(node, resolveDefinition) {
  const definition = typeof resolveDefinition === "function" ? resolveDefinition(node) : null;
  if (!definition) throw new Error(`VISUAL_VALUE_DEFINITION_MISSING:${node.id}:${node.nodeId || node.type || ""}`);
  return definition;
}

function validateValueDefinition(node, definition, path) {
  if (!definition?.id || typeof definition.process !== "function") {
    throw new Error(`VISUAL_VALUE_NOT_EXECUTABLE:${path}:${node.id}`);
  }
  if (
    definition.execution?.asynchronous ||
    definition.execution?.workload === "bounded" ||
    definition.execution?.workload === "offline" ||
    definition.process.constructor?.name === "AsyncFunction"
  ) {
    throw new Error(`VISUAL_VALUE_NOT_LIVE_SAFE:${path}:${node.id}`);
  }
}

function retainValues(target, source) {
  for (const key in target) {
    if (!source || typeof source !== "object" || !(key in source)) delete target[key];
  }
  if (!source || typeof source !== "object") return target;
  for (const key in source) target[key] = source[key];
  return target;
}

function endpoint(value) {
  const parts = String(value || "").split(".");
  if (parts.length < 2 || parts[0].startsWith("$")) return null;
  return { nodeId: parts[0], portId: parts.slice(1).join(".") };
}

function parameterEndpoint(value) {
  return String(value || "").split(".")[1] === "$parameter";
}

function textureEdge(edge = {}) {
  return edge.type === "texture" ||
    String(edge.from || "").endsWith(".texture") ||
    String(edge.to || "").endsWith(".texture");
}
