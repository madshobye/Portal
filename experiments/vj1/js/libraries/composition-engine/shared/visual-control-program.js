import {
  AnimationCurveControlNode,
  AnimationSequencerControlNode,
  AudioControlInputNode,
  ComponentTimeControlNode,
  EventTriggerControlNode,
  FrameDelayControlNode,
  HostControlInputNode,
  MapRangeControlNode,
  MidiControlInputNode,
  NumericCombineControlNode,
  OscillatorControlNode,
  OscControlInputNode,
  PointerControlInputNode,
  ProbeControlInputNode,
  RandomTriggerControlNode,
  SampleHoldControlNode,
  ScalarMathControlNode,
  SelectControlNode,
  SliderNode,
  SmoothControlNode,
  ValueControlNode,
  Vector2ControlNode,
  Vector3ControlNode,
} from "../../control-engine/index.js";
import { InstanceTimeNode, RateClockNode, VisualTimeScaleNode } from "../../timing-engine/index.js";
import { NestedNoiseMotionNode, OrbitMotionNode } from "../../motion-engine/index.js";
import { TerrainFlightControllerNode } from "../../terrain-engine/index.js";
import {
  chainGeneralControlValue,
  chainGeneralControlWrites,
  isChainGeneralControlParameter,
} from "./chain-general-control-parameters.js";

const PARAMETER_SEGMENT = "$parameter";
const BUILT_IN_CONTROL_DEFINITIONS = new Map([
  AnimationCurveControlNode,
  AnimationSequencerControlNode,
  SliderNode,
  ValueControlNode,
  ComponentTimeControlNode,
  OscillatorControlNode,
  RandomTriggerControlNode,
  MapRangeControlNode,
  NumericCombineControlNode,
  ScalarMathControlNode,
  Vector2ControlNode,
  Vector3ControlNode,
  SmoothControlNode,
  SelectControlNode,
  FrameDelayControlNode,
  EventTriggerControlNode,
  SampleHoldControlNode,
  MidiControlInputNode,
  OscControlInputNode,
  AudioControlInputNode,
  HostControlInputNode,
  PointerControlInputNode,
  ProbeControlInputNode,
  InstanceTimeNode,
  RateClockNode,
  VisualTimeScaleNode,
  NestedNoiseMotionNode,
  OrbitMotionNode,
  TerrainFlightControllerNode,
].map((definition) => [definition.id, definition]));

export class VisualControlProgram {
  constructor({ id = "", steps = [], bindings = [], diagnostics = [] } = {}) {
    this.id = String(id || "visual-controls");
    this.steps = Object.freeze([...steps]);
    this.bindings = Object.freeze([...bindings]);
    this.diagnostics = Object.freeze([...diagnostics]);
    this.outputs = new Map();
    this.restorations = [];
    this.restorationCount = 0;
    this.restoreAppliedParameters = () => this.restore();
    this.format = "vj1.visual-control-program@1";
    this.contractVersion = 1;
  }

  apply({ componentTime = 0, timestamp = componentTime, renderRequest = null } = {}) {
    this.outputs.clear();
    for (const step of this.steps) {
      const inputs = step.inputValues;
      for (const id of step.parameterIds) inputs[id] = step.parameters[id];
      for (const edge of step.inputs) {
        const source = this.outputs.get(edge.sourceStepId);
        if (!source || !(edge.sourcePortId in source)) {
          throw new Error(`VISUAL_CONTROL_OUTPUT_MISSING:${this.id}:${edge.sourceStepId}.${edge.sourcePortId}`);
        }
        inputs[edge.targetPortId] = mapControlValue(source[edge.sourcePortId], edge.sourceRange, edge.targetRange);
      }
      for (const [id, inlet] of Object.entries(step.inlets)) {
        if (inlet.required && inputs[id] === undefined) {
          throw new Error(`VISUAL_CONTROL_INLET_REQUIRED:${this.id}:${step.id}.${id}`);
        }
      }
      const processContext = step.processContext;
      processContext.componentTime = componentTime;
      processContext.timestamp = timestamp;
      processContext.renderRequest = renderRequest;
      const output = step.process(inputs, processContext);
      if (output && typeof output.then === "function") {
        throw new Error(`VISUAL_CONTROL_ASYNC_RESULT:${this.id}:${step.id}`);
      }
      if (output !== step.outputValues) retainOutputValues(step.outputValues, output);
      this.outputs.set(step.id, step.outputValues);
    }

    this.restorationCount = 0;
    for (const binding of this.bindings) {
      const output = this.outputs.get(binding.sourceStepId);
      if (!output || !(binding.sourcePortId in output)) {
        throw new Error(`VISUAL_CONTROL_OUTPUT_MISSING:${this.id}:${binding.sourceStepId}.${binding.sourcePortId}`);
      }
      const value = mapControlValue(output[binding.sourcePortId], binding.sourceRange, binding.targetRange);
      this.restorationCount = writeVisualParameter(
        binding.operation,
        binding.parameterId,
        value,
        this.restorations,
        this.restorationCount,
      );
    }
    return this.restoreAppliedParameters;
  }

  restore() {
    for (let index = this.restorationCount - 1; index >= 0; index--) {
      restoreProperty(this.restorations[index]);
    }
    this.restorationCount = 0;
  }

  syncGeneratedControlsFromConfiguration() {
    // Persisted direct bindings identify their compatibility control through
    // the parameter edge. Keep that established synchronization path intact.
    for (const binding of this.bindings) {
      if (!binding.generatedControl) continue;
      const step = this.steps.find((item) => item.id === binding.sourceStepId);
      const value = readVisualParameter(binding.operation, binding.parameterId);
      if (!step || value === undefined) continue;
      step.parameters.value = mapControlValue(
        value,
        binding.targetRange,
        binding.sourceRange,
      );
    }
    // Newer authored fragments can place the generated fallback upstream from
    // the final parameter edge. Their compiler metadata points at the same
    // authoritative configuration without adding work to frame evaluation.
    for (const step of this.steps) {
      const binding = step.generatedParameterBinding;
      if (!binding) continue;
      const value = readVisualParameter(binding.operation, binding.parameterId);
      if (value === undefined) continue;
      step.parameters[binding.controlParameterId] = mapControlValue(
        value,
        binding.targetRange,
        binding.sourceRange,
      );
    }
  }

  inspect() {
    const requirements = [];
    const seen = new Set();
    for (const step of this.steps) {
      const dependency = step.controlSignalDependency;
      if (!dependency) continue;
      const signalKind = String(
        step.parameters[dependency.kindParameterId] || "",
      );
      const address = String(
        step.parameters[dependency.addressParameterId] || "",
      );
      const endpoint = dependency.endpointParameterId
        ? String(step.parameters[dependency.endpointParameterId] || "")
        : "";
      if (!signalKind || !address) continue;
      const key = endpoint
        ? `${signalKind}:${endpoint}:${address}`
        : `${signalKind}:${address}`;
      if (seen.has(key)) continue;
      seen.add(key);
      requirements.push(Object.freeze({
        kind: "control-signal",
        signalKind,
        address,
        ...(endpoint ? { endpoint } : {}),
        required: dependency.required === true,
      }));
    }
    return Object.freeze({
      format: "vj1.visual-control-program-introspection@1",
      executionModel: "compiled-direct-controls",
      dynamics: Object.freeze({
        frameDependent: this.steps.some((step) => step.frameDynamic),
      }),
      requirements: Object.freeze(requirements),
      steps: Object.freeze(this.steps.map((step) => Object.freeze({
        id: step.id,
        instanceId: step.instanceId,
        nodeId: step.nodeId,
        frameDependent: step.frameDynamic,
      }))),
    });
  }
}

export function compileVisualControlProgram(group = {}, operations = [], {
  resolveDefinition = null,
} = {}) {
  const steps = [];
  const bindings = [];
  const diagnostics = [];
  compileScope(group, operations, group.id || "component", {
    resolveDefinition,
    steps,
    bindings,
    diagnostics,
  });
  return new VisualControlProgram({
    id: `${group.id || "component"}.controls`,
    steps,
    bindings,
    diagnostics,
  });
}

function compileScope(group, operations, path, context) {
  const nodes = group.nodes || [];
  const connections = group.connections || [];
  const controls = nodes.filter((node) => node.role === "control");
  const controlById = new Map(controls.map((node) => [String(node.id || ""), node]));
  const operationById = new Map((operations || []).map((operation) => [String(operation.id || ""), operation]));
  const parameterEdges = connections.filter((edge) => parameterEndpoint(edge.to));
  const renderBindings = parameterEdges.filter((edge) => operationById.has(parameterEndpoint(edge.to)?.nodeId));
  const required = collectRequiredControls(renderBindings, connections, controlById, path);
  const ordered = topologicalControls(required, connections, controlById, path);

  for (const node of ordered) {
    const definition = resolveControlDefinition(node, context.resolveDefinition);
    validateControlDefinition(node, definition, path);
    const nodeInputs = connections
      .map((edge) => compileControlInput(edge, node, controlById, required, path))
      .filter(Boolean);
    const parameters = Object.fromEntries(Object.entries(definition.parameters || {}).flatMap(([id, parameter]) =>
      parameter.defaultValue === undefined ? [] : [[id, parameter.defaultValue]]));
    Object.assign(parameters, node.parameters || {});
    const inputValues = { ...parameters };
    for (const [id, inlet] of Object.entries(definition.inlets || {})) {
      if (inlet.defaultValue !== undefined) inputValues[id] = inlet.defaultValue;
    }
    const state = {};
    const outputValues = {};
    const generatedParameterBinding = compilerGeneratedParameterBinding(node, operationById);
    context.steps.push(Object.freeze({
      id: scopedNodeId(path, node.id),
      instanceId: String(node.id || ""),
      nodeId: node.nodeId,
      parameters,
      parameterIds: Object.freeze(Object.keys(parameters)),
      inlets: definition.inlets || {},
      inputValues,
      outputValues,
      inputs: Object.freeze(nodeInputs.map((input) => Object.freeze({
        ...input,
        sourceStepId: scopedNodeId(path, input.sourceStepId),
      }))),
      process: definition.process,
      frameDynamic: definition.execution?.trigger === "frame" || definition.execution?.stateful === true,
      controlSignalDependency: definition.metadata?.controlSignalDependency
        ? Object.freeze({ ...definition.metadata.controlSignalDependency })
        : null,
      generatedParameterBinding,
      state,
      processContext: {
        componentTime: 0,
        timestamp: 0,
        renderRequest: null,
        state,
        parameters,
        output: outputValues,
        executionClass: "live-frame",
      },
    }));
  }

  const boundParameters = new Set();
  for (const edge of renderBindings) {
    const target = parameterEndpoint(edge.to);
    const source = valueEndpoint(edge.from);
    if (!source || !required.has(source.nodeId)) {
      throw new Error(`VISUAL_CONTROL_SOURCE_INVALID:${path}:${edge.from}`);
    }
    const key = `${target.nodeId}.${target.parameterId}`;
    if (boundParameters.has(key)) throw new Error(`VISUAL_CONTROL_PARAMETER_AMBIGUOUS:${path}:${key}`);
    boundParameters.add(key);
    context.bindings.push(Object.freeze({
      sourceStepId: scopedNodeId(path, source.nodeId),
      sourcePortId: source.portId,
      operation: operationById.get(target.nodeId),
      parameterId: target.parameterId,
      generatedControl: controlById.get(source.nodeId)?.generatedBy === "vj1-component-compiler",
      sourceRange: normalizedRange(edge.sourceRange),
      targetRange: normalizedRange(edge.targetRange),
    }));
  }

  for (const node of controls) {
    // Compiler-generated parameter controls intentionally remain dormant when
    // an authored control fragment (for example an Animation track) owns the
    // parameter socket. They are retained as the exact authored-value fallback
    // and therefore are not an invalid unused graph node.
    if (!required.has(node.id) && node.generatedBy !== "vj1-component-compiler") {
      context.diagnostics.push({
        code: "VISUAL_CONTROL_UNUSED_NODE",
        path: `${path}/${node.id}`,
        message: "Control node is not connected to a visual parameter.",
      });
    }
  }

  for (const node of nodes.filter((item) => item.role === "group" && item.nodes)) {
    const operation = operationById.get(String(node.id || ""));
    if (operation) compileScope(node, operation.operations || [], `${path}/${node.id}`, context);
  }
}

function collectRequiredControls(renderBindings, connections, controlById, path) {
  const required = new Set();
  const incoming = new Map();
  for (const edge of connections) {
    const target = valueEndpoint(edge.to);
    if (!target || !controlById.has(target.nodeId)) continue;
    const list = incoming.get(target.nodeId) || [];
    list.push(edge);
    incoming.set(target.nodeId, list);
  }
  const visit = (nodeId) => {
    if (required.has(nodeId)) return;
    if (!controlById.has(nodeId)) throw new Error(`VISUAL_CONTROL_NODE_MISSING:${path}:${nodeId}`);
    required.add(nodeId);
    for (const edge of incoming.get(nodeId) || []) {
      const source = valueEndpoint(edge.from);
      if (source?.nodeId && controlById.has(source.nodeId)) visit(source.nodeId);
    }
  };
  for (const edge of renderBindings) {
    const source = valueEndpoint(edge.from);
    if (!source?.nodeId) throw new Error(`VISUAL_CONTROL_SOURCE_INVALID:${path}:${edge.from}`);
    visit(source.nodeId);
  }
  return required;
}

function topologicalControls(required, connections, controlById, path) {
  const incomingCount = new Map([...required].map((id) => [id, 0]));
  const outgoing = new Map([...required].map((id) => [id, []]));
  for (const edge of connections) {
    const source = valueEndpoint(edge.from);
    const target = valueEndpoint(edge.to);
    if (!source || !target || !required.has(source.nodeId) || !required.has(target.nodeId)) continue;
    incomingCount.set(target.nodeId, incomingCount.get(target.nodeId) + 1);
    outgoing.get(source.nodeId).push(target.nodeId);
  }
  const queue = [...required].filter((id) => incomingCount.get(id) === 0);
  const result = [];
  while (queue.length) {
    const id = queue.shift();
    result.push(controlById.get(id));
    for (const target of outgoing.get(id)) {
      const count = incomingCount.get(target) - 1;
      incomingCount.set(target, count);
      if (count === 0) queue.push(target);
    }
  }
  if (result.length !== required.size) {
    const cycle = [...required].find((id) => incomingCount.get(id) > 0);
    throw new Error(`VISUAL_CONTROL_CYCLE:${path}:${cycle || "unknown"}`);
  }
  return result;
}

function compileControlInput(edge, node, controlById, required, path) {
  const target = valueEndpoint(edge.to);
  if (!target || target.nodeId !== node.id) return null;
  const source = valueEndpoint(edge.from);
  if (!source || !controlById.has(source.nodeId) || !required.has(source.nodeId)) {
    throw new Error(`VISUAL_CONTROL_INPUT_SOURCE_INVALID:${path}:${edge.from}`);
  }
  return {
    sourceStepId: source.nodeId,
    sourcePortId: source.portId,
    targetPortId: target.portId,
    sourceRange: normalizedRange(edge.sourceRange),
    targetRange: normalizedRange(edge.targetRange),
  };
}

function resolveControlDefinition(node, resolveDefinition) {
  if (typeof resolveDefinition === "function") {
    const resolved = resolveDefinition(node);
    if (resolved) return resolved;
  }
  const builtIn = BUILT_IN_CONTROL_DEFINITIONS.get(String(node.nodeId || ""));
  if (builtIn) return builtIn;
  throw new Error(`VISUAL_CONTROL_DEFINITION_MISSING:${node.id}:${node.nodeId}`);
}

function validateControlDefinition(node, definition, path) {
  if (!definition?.id || typeof definition.process !== "function") {
    throw new Error(`VISUAL_CONTROL_NOT_EXECUTABLE:${path}:${node.id}`);
  }
  if (definition.execution?.asynchronous || definition.execution?.workload === "bounded" || definition.execution?.workload === "offline") {
    throw new Error(`VISUAL_CONTROL_NOT_LIVE_SAFE:${path}:${node.id}`);
  }
  if (definition.process.constructor?.name === "AsyncFunction") {
    throw new Error(`VISUAL_CONTROL_ASYNC_PROCESS:${path}:${node.id}`);
  }
}

function compilerGeneratedParameterBinding(node, operationById) {
  if (
    node.generatedBy !== "vj1-component-compiler" ||
    !node.targetNodeId ||
    !node.targetParameterId
  ) return null;
  const operation = operationById.get(String(node.targetNodeId));
  if (!operation) return null;
  return Object.freeze({
    operation,
    parameterId: String(node.targetParameterId),
    controlParameterId: "value",
    sourceRange: normalizedRange(node.sourceRange),
    targetRange: normalizedRange(node.targetRange),
  });
}

function writeVisualParameter(operation, parameterId, value, restorations, index) {
  index = writeDirectVisualParameter(operation, parameterId, value, restorations, index);
  for (const binding of operation?.publicParameterBindings || []) {
    if (binding.parameterId !== parameterId) continue;
    index = binding.controlStep
      ? writeProperty(
          binding.controlInput
            ? binding.controlStep.inputValues
            : binding.controlStep.parameters,
          binding.targetParameterId,
          value,
          restorations,
          index,
        )
      : writeVisualParameter(
          binding.operation,
          binding.targetParameterId,
          value,
          restorations,
          index,
        );
  }
  return index;
}

function writeDirectVisualParameter(operation, parameterId, value, restorations, index) {
  const configuration = operation?.configuration;
  if (!configuration) return index;
  if (isChainGeneralControlParameter(parameterId)) {
    for (const write of chainGeneralControlWrites(configuration, parameterId, value)) {
      index = writeProperty(write.target, write.key, write.value, restorations, index);
    }
    return index;
  }
  if (operation.opcode === "effect") {
    index = writeProperty(configuration.params || (configuration.params = {}), parameterId, value, restorations, index);
    return index;
  }
  if (operation.opcode === "source" || configuration.kind === "source") {
    const source = configuration.source || (configuration.source = {});
    if (parameterId === "sourceType") return writeProperty(source, "type", value, restorations, index);
    if (isDirectSourceIdentityParameter(source, parameterId)) {
      return writeProperty(source, parameterId, value, restorations, index);
    }
    return writeProperty(source.params || (source.params = {}), parameterId, value, restorations, index);
  }
  if (configuration.kind === "texture-operator") {
    return writeProperty(configuration.params || (configuration.params = {}), parameterId, value, restorations, index);
  }
  return writeProperty(configuration, parameterId, value, restorations, index);
}

function readVisualParameter(operation, parameterId) {
  const configuration = operation?.configuration;
  if (!configuration) return undefined;
  if (isChainGeneralControlParameter(parameterId)) {
    return chainGeneralControlValue(configuration, parameterId);
  }
  if (operation.opcode === "effect") {
    return configuration.params?.[parameterId];
  }
  if (operation.opcode === "source" || configuration.kind === "source") {
    if (parameterId === "sourceType") return configuration.source?.type;
    if (isDirectSourceIdentityParameter(configuration.source, parameterId)) {
      return configuration.source?.[parameterId];
    }
    return configuration.source?.params?.[parameterId];
  }
  if (configuration.kind === "texture-operator") return configuration.params?.[parameterId];
  return configuration[parameterId];
}

export function setCompiledVisualParameter(operation, parameterId, value) {
  setDirectVisualParameter(operation, parameterId, value);
  for (const binding of operation?.publicParameterBindings || []) {
    if (binding.parameterId !== parameterId) continue;
    if (binding.controlStep) {
      const target = binding.controlInput
        ? binding.controlStep.inputValues
        : binding.controlStep.parameters;
      target[binding.targetParameterId] = value;
    } else {
      setCompiledVisualParameter(binding.operation, binding.targetParameterId, value);
    }
  }
}

function setDirectVisualParameter(operation, parameterId, value) {
  const configuration = operation?.configuration;
  if (!configuration) return;
  if (isChainGeneralControlParameter(parameterId)) {
    for (const write of chainGeneralControlWrites(configuration, parameterId, value)) {
      write.target[write.key] = write.value;
    }
    return;
  }
  if (operation.opcode === "effect") {
    (configuration.params || (configuration.params = {}))[parameterId] = value;
    return;
  }
  if (operation.opcode === "source" || configuration.kind === "source") {
    const source = configuration.source || (configuration.source = {});
    if (parameterId === "sourceType") source.type = value;
    else if (isDirectSourceIdentityParameter(source, parameterId)) source[parameterId] = value;
    else (source.params || (source.params = {}))[parameterId] = value;
    return;
  }
  if (configuration.kind === "texture-operator") {
    (configuration.params || (configuration.params = {}))[parameterId] = value;
    return;
  }
  configuration[parameterId] = value;
}

function isDirectSourceIdentityParameter(source, parameterId) {
  return (source?.type === "media" && parameterId === "mediaId")
    || (source?.type === "component" && parameterId === "componentId");
}

function writeProperty(target, key, value, restorations, index) {
  const restoration = restorations[index] || (restorations[index] = {
    target: null,
    key: "",
    previous: undefined,
    hadOwn: false,
  });
  restoration.target = target;
  restoration.key = key;
  restoration.hadOwn = Object.prototype.hasOwnProperty.call(target, key);
  restoration.previous = target[key];
  target[key] = value;
  return index + 1;
}

function restoreProperty({ target, key, previous, hadOwn }) {
  if (hadOwn) target[key] = previous;
  else delete target[key];
}

function retainOutputValues(target, source) {
  for (const key in target) {
    if (!source || typeof source !== "object" || !(key in source)) delete target[key];
  }
  if (!source || typeof source !== "object") return target;
  for (const key in source) target[key] = source[key];
  return target;
}

export function mapControlValue(value, sourceRange, targetRange) {
  const source = validControlRange(sourceRange);
  const target = validControlRange(targetRange);
  if (!source || !target || typeof value !== "number") return value;
  const progress = (value - source[0]) / (source[1] - source[0]);
  return target[0] + progress * (target[1] - target[0]);
}

function normalizedRange(value) {
  const range = validControlRange(value);
  return range ? Object.freeze([Number(range[0]), Number(range[1])]) : null;
}

function validControlRange(value) {
  return Array.isArray(value) && value.length >= 2 &&
    Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1])) &&
    Number(value[0]) !== Number(value[1])
    ? value
    : null;
}

function parameterEndpoint(value) {
  const parts = String(value || "").split(".");
  return parts.length >= 3 && parts[1] === PARAMETER_SEGMENT
    ? { nodeId: parts[0], parameterId: parts.slice(2).join(".") }
    : null;
}

function valueEndpoint(value) {
  const parts = String(value || "").split(".");
  if (parts.length < 2 || parts[0].startsWith("$")) return null;
  return {
    nodeId: parts[0],
    portId: parts[1] === PARAMETER_SEGMENT ? parts.slice(2).join(".") : parts.slice(1).join("."),
  };
}

function scopedNodeId(path, nodeId) {
  return `${path}/${nodeId}`;
}
