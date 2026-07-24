import {
  defineNodeCompiler,
  NODE_COMPILER_TARGETS,
  NodeCompilerRegistry,
} from "../../node-engine/node-compiler.js";
import { valueTypeId } from "../../node-engine/node-types.js";

export const SCENE_3D_COMPILER_ID = "vj1.scene-3d.direct-program";

export class CompiledScene3dProgram {
  constructor(group, { registry } = {}) {
    if (!registry) throw new Error(`SCENE_3D_COMPILER_REGISTRY_MISSING:${group?.id || "missing"}`);
    this.id = String(group.id || "scene-3d-program");
    this.format = "vj1.scene-3d-program@1";
    this.contractVersion = 1;
    this.publicInputs = Object.freeze([
      ...Object.entries(group.inlets || {}),
      ...Object.entries(group.parameters || {}).filter(([id]) => !group.inlets?.[id]),
    ].map(([id, inlet]) => Object.freeze({
      id,
      type: valueTypeId(inlet.type || inlet),
      required: inlet.required === true,
    })));
    this.publicInputDefaults = Object.freeze(Object.fromEntries(
      this.publicInputs.flatMap(({ id }) => {
        const value = group.inlets?.[id]?.defaultValue ??
          group.parameters?.[id]?.defaultValue;
        return value === undefined ? [] : [[id, value]];
      }),
    ));
    this.outputs = new Map();
    this.result = {};
    const graph = graphPart(group);
    validateGraphConnections(group, graph, registry);
    const required = reachableNodeIds(graph);
    const ordered = topologicalNodeIds(graph, required);
    this.resourceBindings = Object.freeze(compileResourceBindings(group, graph, registry, required));
    const nodeById = new Map((graph.nodes || []).map((node) => [String(node.id || ""), node]));
    this.steps = Object.freeze(ordered.map((id) => compileStep(
      nodeById.get(id),
      graph,
      registry,
      group,
    )));
    this.publicOutputs = Object.freeze(compilePublicOutputs(group, graph));
    this.diagnostics = Object.freeze((graph.nodes || [])
      .filter((node) => !required.has(String(node.id || "")))
      .map((node) => Object.freeze({
        code: "SCENE_3D_UNUSED_NODE",
        path: `${this.id}/${node.id}`,
        message: "3D node is not connected to a public output.",
      })));
  }

  execute(inputs = {}, context = {}) {
    this.outputs.clear();
    for (const step of this.steps) {
      const values = step.inputValues;
      for (const id of step.parameterIds) values[id] = step.parameters[id];
      for (const edge of step.inputs) {
        const value = edge.sourceNodeId === "$in"
          ? publicInputValue(inputs, this.publicInputDefaults, edge.sourcePortId)
          : this.outputs.get(edge.sourceNodeId)?.[edge.sourcePortId];
        values[edge.targetPortId] = value;
      }
      syncProcessContext(step, context);
      const shouldExecute = step.trigger === "frame" || !step.hasOutput || stepInputsChanged(step);
      if (shouldExecute) {
        const output = step.process(values, step.processContext);
        if (output && typeof output.then === "function") {
          throw new Error(`SCENE_3D_ASYNC_RESULT:${this.id}:${step.id}`);
        }
        if (output !== step.outputValues) retainOutputValues(step.outputValues, output);
        rememberStepInputs(step);
        step.hasOutput = true;
      }
      this.outputs.set(step.id, step.outputValues);
    }
    for (const output of this.publicOutputs) this.result[output.publicId] = undefined;
    for (const output of this.publicOutputs) {
      this.result[output.publicId] = output.sourceNodeId === "$in"
        ? publicInputValue(inputs, this.publicInputDefaults, output.sourcePortId)
        : this.outputs.get(output.sourceNodeId)?.[output.sourcePortId];
    }
    return this.result;
  }

  dispose() {
    for (const step of this.steps) {
      try { step.definition.execution?.dispose?.({ state: step.state }); } catch {}
      step.state = {};
    }
    this.outputs.clear();
  }
}

function publicInputValue(inputs, defaults, id) {
  return inputs[id] === undefined ? defaults[id] : inputs[id];
}

export const Scene3dDirectCompiler = defineNodeCompiler({
  id: SCENE_3D_COMPILER_ID,
  target: NODE_COMPILER_TARGETS.SCENE_3D,
  accepts: (group) => group?.compiler?.target === NODE_COMPILER_TARGETS.SCENE_3D ||
    group?.capabilities?.includes?.("scene-3d-program"),
  compile: (group, context) => new CompiledScene3dProgram(group, context),
});

const scene3dCompilerRegistry = new NodeCompilerRegistry([Scene3dDirectCompiler]);

export function compileScene3dProgram(group, { registry } = {}) {
  return scene3dCompilerRegistry.compile(group, {
    target: NODE_COMPILER_TARGETS.SCENE_3D,
    registry,
  });
}

function compileStep(node, graph, registry, group) {
  const definition = registry.get(node.type || node.nodeId, node.version || node.nodeVersion || "");
  if (typeof definition.process !== "function") throw new Error(`SCENE_3D_NODE_NOT_EXECUTABLE:${node.id}`);
  if (definition.execution?.asynchronous || definition.execution?.workload === "bounded" || definition.execution?.workload === "offline" ||
      definition.process.constructor?.name === "AsyncFunction") {
    throw new Error(`SCENE_3D_NODE_NOT_LIVE_SAFE:${node.id}`);
  }
  const inputs = incomingEdges(node.id, graph, group);
  const parameters = Object.fromEntries(Object.entries(definition.parameters || {}).flatMap(([id, parameter]) =>
    parameter.defaultValue === undefined ? [] : [[id, parameter.defaultValue]]));
  const inputValues = {};
  for (const [id, inlet] of Object.entries(definition.inlets || {})) {
    if (inlet.defaultValue !== undefined) inputValues[id] = inlet.defaultValue;
    if (
      inlet.required &&
      inlet.defaultValue === undefined &&
      node.parameters?.[id] === undefined &&
      !inputs.some((edge) => edge.targetPortId === id)
    ) {
      throw new Error(`SCENE_3D_INLET_REQUIRED:${node.id}.${id}`);
    }
  }
  // Node-authored values may target either declared parameters or literal
  // inlets. They are applied after defaults and before graph edges, so a wire
  // supersedes the literal without the compiler silently discarding it.
  Object.assign(parameters, node.parameters || {});
  Object.assign(inputValues, parameters);
  const state = {};
  const outputValues = {};
  return {
    id: String(node.id || ""),
    definition,
    process: definition.process,
    parameters,
    parameterIds: Object.freeze(Object.keys(parameters)),
    inputValues,
    comparedInputIds: Object.freeze([...new Set([
      ...Object.keys(inputValues),
      ...inputs.map((edge) => edge.targetPortId),
    ])]),
    previousInputValues: {},
    dynamicInputIds: Object.freeze([...new Set(inputs.map((edge) => edge.targetPortId))]),
    inputs: Object.freeze(inputs),
    state,
    outputValues,
    hasOutput: false,
    trigger: definition.execution?.trigger || "manual",
    processContext: {
      state,
      parameters,
      output: outputValues,
      executionClass: "live-frame",
    },
    processContextKeys: new Set(),
  };
}

function syncProcessContext(step, context) {
  for (const key of step.processContextKeys) {
    if (!(key in context)) {
      delete step.processContext[key];
      step.processContextKeys.delete(key);
    }
  }
  for (const key in context) {
    if (key === "state" || key === "parameters" || key === "output" || key === "executionClass") continue;
    step.processContext[key] = context[key];
    step.processContextKeys.add(key);
  }
  step.processContext.state = step.state;
  step.processContext.parameters = step.parameters;
  step.processContext.output = step.outputValues;
  step.processContext.executionClass = "live-frame";
}

function stepInputsChanged(step) {
  for (const key of step.comparedInputIds) {
    if (!Object.is(step.previousInputValues[key], step.inputValues[key])) return true;
  }
  return false;
}

function rememberStepInputs(step) {
  for (const key of step.comparedInputIds) step.previousInputValues[key] = step.inputValues[key];
}

function retainOutputValues(target, source) {
  for (const key in target) {
    if (!source || typeof source !== "object" || !(key in source)) delete target[key];
  }
  if (!source || typeof source !== "object") return target;
  for (const key in source) target[key] = source[key];
  return target;
}

function incomingEdges(nodeId, graph, group = {}) {
  const result = [];
  for (const edge of graph.connections || []) {
    const target = endpoint(edge.to);
    if (target.nodeId !== nodeId) continue;
    const source = endpoint(edge.from);
    result.push(Object.freeze({
      sourceNodeId: source.nodeId,
      sourcePortId: source.portId,
      targetPortId: target.portId,
    }));
  }
  for (const [publicId, destination] of Object.entries(graph.publicInlets || {})) {
    const target = endpoint(destination);
    if (target.nodeId !== nodeId) continue;
    result.push(Object.freeze({
      sourceNodeId: "$in",
      sourcePortId: publicId,
      targetPortId: target.portId,
    }));
  }
  for (const section of group.metadata?.controlProjection?.sections || []) {
    for (const control of section.controls || []) {
      for (const binding of control.bindings || []) {
        if (String(binding.nodeId || "") !== String(nodeId || "")) continue;
        result.push(Object.freeze({
          sourceNodeId: "$in",
          sourcePortId: String(control.parameterId || ""),
          targetPortId: String(binding.parameterId || ""),
        }));
      }
    }
  }
  return result.filter((edge, index) => result.findIndex((candidate) =>
    candidate.sourceNodeId === edge.sourceNodeId &&
    candidate.sourcePortId === edge.sourcePortId &&
    candidate.targetPortId === edge.targetPortId) === index);
}

function compilePublicOutputs(group, graph) {
  const outputs = [];
  for (const edge of graph.connections || []) {
    const target = endpoint(edge.to);
    if (target.nodeId !== "$out") continue;
    const source = endpoint(edge.from);
    outputs.push(Object.freeze({
      publicId: target.portId,
      sourceNodeId: source.nodeId,
      sourcePortId: source.portId,
    }));
  }
  for (const [publicId, sourceEndpoint] of Object.entries(graph.publicOutlets || {})) {
    const source = endpoint(sourceEndpoint);
    outputs.push(Object.freeze({
      publicId,
      sourceNodeId: source.nodeId,
      sourcePortId: source.portId,
    }));
  }
  const declared = Object.keys(group.outlets || {});
  return outputs.filter((output, index) =>
    declared.includes(output.publicId) &&
    outputs.findIndex((candidate) => candidate.publicId === output.publicId) === index);
}

function compileResourceBindings(group, graph, registry, required) {
  const result = [];
  for (const node of graph.nodes || []) {
    const nodeId = String(node.id || "");
    if (!required.has(nodeId)) continue;
    const definition = registry.get(node.type || node.nodeId, node.version || node.nodeVersion || "");
    for (const dependency of definition.metadata?.resourceDependencies || []) {
      const parameterId = String(dependency?.parameterId || "");
      if (!parameterId || !definition.parameters?.[parameterId]) {
        throw new Error(`SCENE_3D_RESOURCE_PARAMETER_MISSING:${group.id}:${nodeId}:${parameterId || "missing"}`);
      }
      const publicInputId = resourcePublicInputId(group, graph, nodeId, parameterId);
      result.push(Object.freeze({
        nodeId,
        kind: String(dependency.kind || ""),
        valueType: valueTypeId(dependency.valueType || "any"),
        parameterId,
        publicInputId,
        staticId: publicInputId
          ? ""
          : String(node.parameters?.[parameterId] ?? definition.parameters[parameterId].defaultValue ?? ""),
        required: dependency.required !== false,
      }));
    }
  }
  return result;
}

function resourcePublicInputId(group, graph, nodeId, parameterId) {
  const matchesTarget = (value) => {
    const parsed = endpoint(value);
    return parsed.nodeId === nodeId && parsed.portId === parameterId;
  };
  for (const [publicId, destination] of Object.entries(graph.publicInlets || {})) {
    if (matchesTarget(destination)) return String(publicId);
  }
  for (const edge of graph.connections || []) {
    if (!matchesTarget(edge.to)) continue;
    const source = endpoint(edge.from);
    if (source.nodeId === "$in") return source.portId;
    throw new Error(`SCENE_3D_RESOURCE_DYNAMIC_SOURCE_UNSUPPORTED:${group.id}:${nodeId}.${parameterId}`);
  }
  for (const section of group.metadata?.controlProjection?.sections || []) {
    for (const control of section.controls || []) {
      for (const binding of control.bindings || []) {
        if (
          String(binding.nodeId || "") === nodeId &&
          String(binding.parameterId || "") === parameterId
        ) {
          return String(control.parameterId || "");
        }
      }
    }
  }
  return "";
}

function reachableNodeIds(graph) {
  const incoming = new Map();
  for (const edge of graph.connections || []) {
    const target = endpoint(edge.to);
    const source = endpoint(edge.from);
    if (source.nodeId.startsWith("$")) continue;
    const list = incoming.get(target.nodeId) || [];
    list.push(source.nodeId);
    incoming.set(target.nodeId, list);
  }
  const roots = [];
  for (const edge of graph.connections || []) {
    const target = endpoint(edge.to);
    if (target.nodeId === "$out") roots.push(endpoint(edge.from).nodeId);
  }
  for (const value of Object.values(graph.publicOutlets || {})) roots.push(endpoint(value).nodeId);
  const required = new Set();
  const visit = (id) => {
    if (!id || id.startsWith("$") || required.has(id)) return;
    required.add(id);
    for (const dependency of incoming.get(id) || []) visit(dependency);
  };
  roots.forEach(visit);
  return required;
}

function topologicalNodeIds(graph, required) {
  const ids = (graph.nodes || []).map((node) => String(node.id || "")).filter((id) => required.has(id));
  const indegree = new Map(ids.map((id) => [id, 0]));
  const outgoing = new Map(ids.map((id) => [id, []]));
  for (const edge of graph.connections || []) {
    const from = endpoint(edge.from).nodeId;
    const to = endpoint(edge.to).nodeId;
    if (!indegree.has(from) || !indegree.has(to) || from === to) continue;
    outgoing.get(from).push(to);
    indegree.set(to, indegree.get(to) + 1);
  }
  const queue = ids.filter((id) => indegree.get(id) === 0);
  const ordered = [];
  while (queue.length) {
    const id = queue.shift();
    ordered.push(id);
    for (const target of outgoing.get(id)) {
      const count = indegree.get(target) - 1;
      indegree.set(target, count);
      if (count === 0) queue.push(target);
    }
  }
  if (ordered.length !== ids.length) {
    throw new Error(`SCENE_3D_GRAPH_CYCLE:${ids.filter((id) => !ordered.includes(id)).join(",")}`);
  }
  return ordered;
}

function graphPart(group) {
  return group.parts?.find((part) => part.kind === "graph") || group;
}

function endpoint(value) {
  const parts = String(value || "").split(".");
  return {
    nodeId: parts[0],
    portId: parts[1] === "$parameter" ? parts.slice(2).join(".") : parts.slice(1).join("."),
    parameter: parts[1] === "$parameter",
  };
}

function validateGraphConnections(group, graph, registry) {
  const definitions = new Map((graph.nodes || []).map((node) => [
    String(node.id || ""),
    registry.get(node.type || node.nodeId, node.version || node.nodeVersion || ""),
  ]));
  const port = (parsed, direction) => {
    if (parsed.nodeId === "$in") return direction === "source"
      ? group.inlets?.[parsed.portId] || group.parameters?.[parsed.portId]
      : null;
    if (parsed.nodeId === "$out") return direction === "target" ? group.outlets?.[parsed.portId] : null;
    const definition = definitions.get(parsed.nodeId);
    if (!definition) throw new Error(`SCENE_3D_NODE_MISSING:${group.id}:${parsed.nodeId}`);
    return direction === "source"
      ? definition.outlets?.[parsed.portId]
      : parsed.parameter
        ? definition.parameters?.[parsed.portId]
        : definition.inlets?.[parsed.portId];
  };
  const validate = (from, to) => {
    const source = endpoint(from);
    const target = endpoint(to);
    const sourcePort = port(source, "source");
    const targetPort = port(target, "target");
    if (!sourcePort) throw new Error(`SCENE_3D_SOURCE_PORT_MISSING:${group.id}:${from}`);
    if (!targetPort) throw new Error(`SCENE_3D_TARGET_PORT_MISSING:${group.id}:${to}`);
    const sourceType = valueTypeId(sourcePort.type);
    const targetType = valueTypeId(targetPort.type);
    if (sourceType !== "any" && targetType !== "any" && sourceType !== targetType) {
      throw new Error(`SCENE_3D_PORT_TYPE_MISMATCH:${group.id}:${from}:${sourceType}:${to}:${targetType}`);
    }
  };
  for (const edge of graph.connections || []) validate(edge.from, edge.to);
  for (const [publicId, destination] of Object.entries(graph.publicInlets || {})) {
    validate(`$in.${publicId}`, destination);
  }
  for (const [publicId, source] of Object.entries(graph.publicOutlets || {})) {
    validate(source, `$out.${publicId}`);
  }
  for (const section of group.metadata?.controlProjection?.sections || []) {
    for (const control of section.controls || []) {
      for (const binding of control.bindings || []) {
        const childDefinition = definitions.get(String(binding.nodeId || ""));
        const target = childDefinition?.parameters?.[binding.parameterId]
          ? `${binding.nodeId}.$parameter.${binding.parameterId}`
          : `${binding.nodeId}.${binding.parameterId}`;
        validate(
          `$in.${control.parameterId}`,
          target,
        );
      }
    }
  }
}
