import { valueTypeId } from "../../node-engine/node-types.js";

export class VisualValueProgram {
  constructor({ id = "", steps = [], bindings = [], diagnostics = [] } = {}) {
    this.id = String(id || "visual-values");
    this.steps = Object.freeze([...steps]);
    this.bindings = Object.freeze([...bindings]);
    this.diagnostics = Object.freeze([...diagnostics]);
    this.outputs = new Map();
    this.outputIdentities = new Map();
    this.resourceObjects = new WeakMap();
    this.nextResourceObjectId = 1;
    this.evaluationRevision = 0;
    this.stepDependencySignatures = new Map();
    this.stepDependencyRevisions = new Map();
    this.frameDrivenSteps = new Set();
    this.ready = true;
    this.format = "vj1.visual-value-program@1";
    this.contractVersion = 1;
  }

  evaluate({
    componentTime = 0,
    timestamp = componentTime,
    renderRequest = null,
    sourceDetail = null,
    runtimeContext = null,
  } = {}) {
    this.outputs.clear();
    this.outputIdentities.clear();
    this.frameDrivenSteps.clear();
    this.evaluationRevision =
      Math.max(0, Number(this.evaluationRevision) || 0) + 1;
    this.ready = true;
    const boundOperations = new Set();
    for (const binding of this.bindings) {
      if (boundOperations.has(binding.operation)) continue;
      boundOperations.add(binding.operation);
      binding.operation.runtimeValueInputs?.clear?.();
      binding.operation.runtimeValueIdentityInputs?.clear?.();
    }
    for (const step of this.steps) {
      const frameDriven =
        step.frameDynamic === true ||
        step.inputs.some((edge) =>
          this.frameDrivenSteps.has(edge.sourceStepId)
        );
      if (frameDriven) this.frameDrivenSteps.add(step.id);
      const inputs = step.inputValues;
      for (const id of step.parameterIds) inputs[id] = step.parameters[id];
      if (step.frameDynamic && step.inlets.componentTime) {
        inputs.componentTime = componentTime;
      }
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
      const dependencyRevision = frameDriven
        ? 0
        : this.updateStepDependencyRevision(
            step,
            renderRequest,
            sourceDetail,
          );
      const context = step.processContext;
      context.componentTime = componentTime;
      context.timestamp = timestamp;
      context.renderRequest = renderRequest;
      context.sourceDetail = sourceDetail;
      applyRuntimeContext(context, runtimeContext);
      const output = step.process(inputs, context);
      if (output && typeof output.then === "function") {
        throw new Error(`VISUAL_VALUE_ASYNC_RESULT:${this.id}:${step.id}`);
      }
      if (output !== step.outputValues) retainValues(step.outputValues, output);
      this.outputs.set(step.id, step.outputValues);
      if (
        step.externalResolver &&
        !externalStepReady(step, step.externalResolver)
      ) {
        this.ready = false;
        break;
      }
      for (const portId of step.outletIds) {
        if (!(portId in step.outputValues)) continue;
        this.outputIdentities.set(
          `${step.id}.${portId}`,
          retainedValueIdentity(
            step.outputValues[portId],
            step.outlets[portId]?.type,
            this.resourceObjects,
            () => this.nextResourceObjectId++,
            frameDriven ? this.evaluationRevision : 0,
            frameDriven ? 0 : dependencyRevision,
          ),
        );
      }
    }
    for (const binding of this.bindings) {
      const output = this.outputs.get(binding.sourceStepId);
      if (!output || !(binding.sourcePortId in output)) {
        if (!this.ready) {
          binding.operation.runtimeValueInputs.set(binding.targetPortId, null);
          binding.operation.runtimeValueIdentityInputs.set(
            binding.targetPortId,
            `${binding.sourceType}:missing`,
          );
          continue;
        }
        throw new Error(`VISUAL_VALUE_OUTPUT_MISSING:${this.id}:${binding.sourceStepId}.${binding.sourcePortId}`);
      }
      binding.operation.runtimeValueInputs.set(binding.targetPortId, output[binding.sourcePortId]);
      binding.operation.runtimeValueIdentityInputs.set(
        binding.targetPortId,
        this.outputIdentities.get(`${binding.sourceStepId}.${binding.sourcePortId}`) || "",
      );
    }
    return this.ready;
  }

  inspect() {
    const frameDependent = this.steps.some((step) => step.frameDynamic === true);
    return Object.freeze({
      format: "vj1.visual-value-program-introspection@1",
      executionModel: "retained-typed-values",
      dynamics: Object.freeze({
        frameDependent,
        invalidation: Object.freeze({
          mode: frameDependent ? "frame" : (this.steps.length ? "revision" : "stable"),
          reasons: Object.freeze(frameDependent
            ? ["value-frame"]
            : (this.steps.length ? ["value-input-or-resource-revision"] : [])),
        }),
      }),
      steps: Object.freeze(this.steps.map((step) => Object.freeze({
        id: step.id,
        instanceId: step.instanceId,
        nodeId: step.nodeId,
        trigger: step.trigger,
        frameDependent: step.frameDynamic,
        externalResolver: step.externalResolver,
        resourceDependencies: step.resourceDependencies,
        inputs: Object.freeze(Object.fromEntries(Object.entries(step.inlets)
          .map(([id, port]) => [id, valueTypeId(port?.type || port || "any")]))),
        outputs: Object.freeze(Object.fromEntries(Object.entries(step.outlets)
          .map(([id, port]) => [id, valueTypeId(port?.type || port || "any")]))),
      }))),
      externalResolvers: Object.freeze(this.steps.flatMap((step) =>
        step.externalResolver ? [Object.freeze({
          stepId: step.id,
          nodeId: step.nodeId,
          ...step.externalResolver,
        })] : [])),
      bindings: Object.freeze(this.bindings.map((binding) => Object.freeze({
        sourceStepId: binding.sourceStepId,
        sourcePortId: binding.sourcePortId,
        sourceType: binding.sourceType,
        targetOperationId: binding.operation.id,
        targetPortId: binding.targetPortId,
        targetType: binding.targetType,
      }))),
      readiness: Object.freeze({
        ready: this.ready,
      }),
    });
  }

  dispose() {
    for (const step of this.steps) {
      try {
        step.dispose?.({ state: step.state, output: step.outputValues });
      } catch {}
      for (const key in step.outputValues) delete step.outputValues[key];
    }
    for (const binding of this.bindings) {
      binding.operation.runtimeValueInputs?.clear?.();
      binding.operation.runtimeValueIdentityInputs?.clear?.();
    }
    this.outputs.clear();
    this.outputIdentities.clear();
    this.stepDependencySignatures.clear();
    this.stepDependencyRevisions.clear();
    this.frameDrivenSteps.clear();
    this.ready = false;
  }

  updateStepDependencyRevision(step, renderRequest, sourceDetail) {
    const signature = stableValueIdentity({
      parameters: Object.fromEntries(
        step.parameterIds.map((id) => [id, step.parameters[id]]),
      ),
      inputs: step.inputs.map((edge) => [
        edge.targetPortId,
        this.outputIdentities.get(
          `${edge.sourceStepId}.${edge.sourcePortId}`,
        ) || "",
      ]),
      // A frame-triggered provider may be request-driven without being
      // wall-clock-driven (for example mesh LOD selection). Treat the request
      // as a semantic dependency, not as permission to evaluate every frame.
      context: step.trigger === "frame"
        ? retainedRenderContextIdentity(renderRequest, sourceDetail)
        : null,
    });
    if (this.stepDependencySignatures.get(step.id) !== signature) {
      this.stepDependencySignatures.set(step.id, signature);
      this.stepDependencyRevisions.set(
        step.id,
        Math.max(
          0,
          Number(this.stepDependencyRevisions.get(step.id)) || 0,
        ) + 1,
      );
    }
    return this.stepDependencyRevisions.get(step.id) || 0;
  }
}

export function compileVisualValueProgram(group = {}, operations = [], {
  resolveDefinition = null,
} = {}) {
  const nodes = group.nodes || [];
  const connections = group.connections || [];
  const values = nodes.filter((node) => node.role === "value");
  const valueById = new Map(values.map((node) => [String(node.id || ""), node]));
  const nodeById = new Map(nodes.map((node) => [String(node.id || ""), node]));
  const operationById = new Map((operations || []).map((operation) => [String(operation.id || ""), operation]));
  const definitions = new Map();
  const definitionFor = (nodeId) => {
    const id = String(nodeId || "");
    if (definitions.has(id)) return definitions.get(id);
    const node = nodeById.get(id);
    const definition = node && typeof resolveDefinition === "function" ? resolveDefinition(node) : null;
    definitions.set(id, definition || null);
    return definition || null;
  };
  const renderBindings = connections
    .map((edge) => compileRenderBinding(
      edge,
      valueById,
      operationById,
      nodeById,
      definitionFor,
      group.id || "component",
    ))
    .filter(Boolean);
  validateValueConnections(
    connections,
    values,
    valueById,
    operationById,
    nodeById,
    definitionFor,
    renderBindings,
    group.id || "component",
  );
  const required = collectRequiredValues(renderBindings, connections, valueById, group.id || "component");
  const ordered = topologicalValues(required, connections, valueById, group.id || "component");
  const steps = ordered.map((node) => compileValueStep(
    node,
    connections,
    required,
    valueById,
    definitionFor(node.id),
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

function compileValueStep(node, connections, required, valueById, definition, path) {
  definition = resolveValueDefinition(node, definition);
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
  const declaredFrameDependency = definition.execution?.frameDependent;
  const frameDependent =
    typeof declaredFrameDependency === "function"
      ? declaredFrameDependency
      : declaredFrameDependency === false
        ? () => false
        : null;
  return Object.freeze({
    id: `${path}/${node.id}`,
    instanceId: String(node.id || ""),
    nodeId: String(node.nodeId || node.type || ""),
    parameters,
    parameterIds: Object.freeze(Object.keys(parameters)),
    inlets: definition.inlets || {},
    outlets: definition.outlets || {},
    outletIds: Object.freeze(Object.keys(definition.outlets || {})),
    inputs: Object.freeze(inputs.map((input) => Object.freeze({
      ...input,
      sourceStepId: `${path}/${input.sourceStepId}`,
    }))),
    inputValues,
    outputValues,
    process: definition.process,
    dispose: definition.execution?.dispose,
    trigger: String(definition.execution?.trigger || "input-change"),
    // Frame-triggered retained values may declare that their current authored
    // parameters are static. A getter keeps the compiled step authoritative
    // as public parameter bindings update its retained parameter object.
    get frameDynamic() {
      if (definition.execution?.trigger !== "frame") return false;
      if (!frameDependent) return true;
      try {
        return frameDependent(parameters) === true;
      } catch {
        // A broken invalidation declaration must fail safe by rendering rather
        // than publishing a stale retained value.
        return true;
      }
    },
    externalResolver: retainedExternalResolver(definition, node, path),
    resourceDependencies: Object.freeze(
      (definition.metadata?.resourceDependencies || []).map((dependency) =>
        Object.freeze({ ...dependency })),
    ),
    state,
    processContext: {
      componentTime: 0,
      timestamp: 0,
      renderRequest: null,
      sourceDetail: null,
      state,
      parameters,
      output: outputValues,
      nodeModule: definition.moduleExports || null,
      executionClass: "retained-value",
    },
  });
}

function compileRenderBinding(edge, valueById, operationById, nodeById, definitionFor, path) {
  if (textureEdge(edge) || parameterEndpoint(edge.to)) return null;
  const source = endpoint(edge.from);
  const target = endpoint(edge.to);
  if (!source || !target || !valueById.has(source.nodeId) || !operationById.has(target.nodeId)) return null;
  const sourcePort = requiredOutlet(
    definitionFor(source.nodeId),
    source,
    path,
    nodeById.get(source.nodeId),
  );
  const targetPort = requiredInlet(
    definitionFor(target.nodeId),
    target,
    path,
    nodeById.get(target.nodeId),
  );
  assertCompatibleValuePorts(path, edge.from, edge.to, sourcePort, targetPort);
  return {
    sourceStepId: source.nodeId,
    sourcePortId: source.portId,
    sourceType: valueTypeId(sourcePort.type || sourcePort),
    operation: operationById.get(target.nodeId),
    targetPortId: target.portId,
    targetType: valueTypeId(targetPort.type || targetPort),
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

function resolveValueDefinition(node, definition) {
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
  retainedExternalResolver(definition, node, path);
}

function retainValues(target, source) {
  for (const key in target) {
    if (!source || typeof source !== "object" || !(key in source)) delete target[key];
  }
  if (!source || typeof source !== "object") return target;
  for (const key in source) target[key] = source[key];
  return target;
}

function validateValueConnections(
  connections,
  values,
  valueById,
  operationById,
  nodeById,
  definitionFor,
  renderBindings,
  path,
) {
  const incoming = new Set();
  for (const edge of connections || []) {
    if (textureEdge(edge) || parameterEndpoint(edge.to)) continue;
    const source = endpoint(edge.from);
    const target = endpoint(edge.to);
    if (!target || (!valueById.has(target.nodeId) && !operationById.has(target.nodeId))) continue;
    if (!source || !valueById.has(source.nodeId)) {
      if (valueById.has(target.nodeId)) {
        throw new Error(`VISUAL_VALUE_INPUT_SOURCE_INVALID:${path}:${edge.from}`);
      }
      continue;
    }
    const sourcePort = requiredOutlet(
      definitionFor(source.nodeId),
      source,
      path,
      nodeById.get(source.nodeId),
    );
    const targetPort = requiredInlet(
      definitionFor(target.nodeId),
      target,
      path,
      nodeById.get(target.nodeId),
    );
    assertCompatibleValuePorts(path, edge.from, edge.to, sourcePort, targetPort);
    const targetKey = `${target.nodeId}.${target.portId}`;
    if (incoming.has(targetKey)) {
      throw new Error(`VISUAL_VALUE_INPUT_AMBIGUOUS:${path}:${targetKey}`);
    }
    incoming.add(targetKey);
  }
  for (const node of values) {
    const definition = resolveValueDefinition(node, definitionFor(node.id));
    for (const [id, inlet] of Object.entries(definition.inlets || {})) {
      if (
        inlet.required === true &&
        inlet.defaultValue === undefined &&
        node.parameters?.[id] === undefined &&
        !incoming.has(`${node.id}.${id}`)
      ) {
        throw new Error(`VISUAL_VALUE_INLET_REQUIRED:${path}:${node.id}.${id}`);
      }
    }
  }
  const boundTargets = new Set(renderBindings.map((binding) =>
    `${binding.operation.id}.${binding.targetPortId}`));
  for (const operation of operationById.values()) {
    const definition = definitionFor(operation.id);
    if (!definition) continue;
    for (const [id, inlet] of Object.entries(definition.inlets || {})) {
      if (
        valueTypeId(inlet.type || inlet) !== "texture" &&
        inlet.required === true &&
        inlet.defaultValue === undefined &&
        !boundTargets.has(`${operation.id}.${id}`)
      ) {
        throw new Error(`VISUAL_VALUE_RENDER_INLET_REQUIRED:${path}:${operation.id}.${id}`);
      }
    }
  }
}

function requiredOutlet(definition, endpointValue, path, node = null) {
  if (!definition) {
    throw new Error(
      `VISUAL_VALUE_DEFINITION_MISSING:${path}:${endpointValue.nodeId}:${node?.nodeId || node?.type || "unknown"}`,
    );
  }
  const port = definition.outlets?.[endpointValue.portId];
  if (!port) {
    throw new Error(`VISUAL_VALUE_SOURCE_PORT_MISSING:${path}:${endpointValue.nodeId}.${endpointValue.portId}`);
  }
  return port;
}

function requiredInlet(definition, endpointValue, path, node = null) {
  if (!definition) {
    throw new Error(
      `VISUAL_VALUE_DEFINITION_MISSING:${path}:${endpointValue.nodeId}:${node?.nodeId || node?.type || "unknown"}`,
    );
  }
  const port = definition.inlets?.[endpointValue.portId];
  if (!port) {
    throw new Error(`VISUAL_VALUE_TARGET_PORT_MISSING:${path}:${endpointValue.nodeId}.${endpointValue.portId}`);
  }
  return port;
}

function assertCompatibleValuePorts(path, from, to, sourcePort, targetPort) {
  const sourceType = valueTypeId(sourcePort?.type || sourcePort || "any");
  const targetType = valueTypeId(targetPort?.type || targetPort || "any");
  if (sourceType !== "any" && targetType !== "any" && sourceType !== targetType) {
    throw new Error(`VISUAL_VALUE_PORT_TYPE_MISMATCH:${path}:${from}:${to}:${sourceType}:${targetType}`);
  }
}

function retainedValueIdentity(
  value,
  specification,
  objectIds,
  allocateObjectId,
  signalRevision = 0,
  dependencyRevision = 0,
) {
  const type = valueTypeId(specification || "any");
  if (value === null || value === undefined) return `${type}:missing`;
  if (typeof value !== "object" && typeof value !== "function") {
    return `${type}:${String(value)}`;
  }
  let objectId = objectIds.get(value);
  if (!objectId) {
    objectId = allocateObjectId();
    objectIds.set(value, objectId);
  }
  const declaredIdentity = value.resourceIdentity
    ?? value.id
    ?? value.providerId
    ?? value.kind;
  // Allocation identity is only a fallback for values without a semantic
  // dependency revision. Ordinary retained value providers may construct a
  // fresh array/record while representing the same value; allowing that
  // incidental allocation to dirty downstream nodes would defeat retained
  // execution. The compiled step dependency revision is their authority.
  const identity = declaredIdentity
    ?? (dependencyRevision ? "value" : `object-${objectId}`);
  const declaredRevision = value.resourceRevision
    ?? value.revision
    ?? value.signature;
  const revision = signalRevision
    ? declaredRevision === undefined
      ? `signal-${signalRevision}`
      : `${String(declaredRevision)}+signal-${signalRevision}`
    : declaredRevision === undefined && dependencyRevision
      ? `dependency-${dependencyRevision}`
      : declaredRevision ?? value.version ?? 0;
  return `${type}:${String(identity)}@${String(revision)}`;
}

function retainedRenderContextIdentity(renderRequest, sourceDetail) {
  const request = renderRequest || {};
  const detail = sourceDetail || {};
  return {
    request: {
      role: String(request.role || ""),
      width: finiteIdentityNumber(request.width),
      height: finiteIdentityNumber(request.height),
      logicalWidth: finiteIdentityNumber(request.logicalWidth),
      logicalHeight: finiteIdentityNumber(request.logicalHeight),
      pixelRatio: finiteIdentityNumber(request.pixelRatio),
      uvRect: request.uvRect || null,
      roi: request.roi || null,
    },
    sourceDetail: {
      width: finiteIdentityNumber(detail.width),
      height: finiteIdentityNumber(detail.height),
      physicalWidth: finiteIdentityNumber(detail.physicalWidth),
      physicalHeight: finiteIdentityNumber(detail.physicalHeight),
      contentScale: finiteIdentityNumber(detail.contentScale),
    },
  };
}

function finiteIdentityNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function stableValueIdentity(value, seen = new WeakSet()) {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : JSON.stringify(String(value));
  }
  if (
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") return JSON.stringify(String(value));
  if (typeof value === "function") {
    return JSON.stringify(`[function:${value.name || "anonymous"}]`);
  }
  if (typeof value !== "object") return JSON.stringify(String(value));
  if (seen.has(value)) return JSON.stringify("[circular]");
  seen.add(value);
  let result;
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    result = `[${Array.from(value, (item) =>
      stableValueIdentity(item, seen)).join(",")}]`;
  } else {
    result = `{${Object.keys(value)
      .sort()
      .map((key) =>
        `${JSON.stringify(key)}:${stableValueIdentity(value[key], seen)}`)
      .join(",")}}`;
  }
  seen.delete(value);
  return result;
}

function retainedExternalResolver(definition, node, path) {
  const external = definition?.execution?.external;
  if (!external) return null;
  const capability = String(external.capability || "");
  const lifecycle = String(external.lifecycle || "");
  const invalidation = String(external.invalidation || "");
  if (!capability || external.asynchronous !== true) {
    throw new Error(`VISUAL_VALUE_EXTERNAL_CAPABILITY_INVALID:${path}:${node.id}`);
  }
  if (lifecycle !== "retained-request") {
    throw new Error(`VISUAL_VALUE_EXTERNAL_LIFECYCLE_UNSUPPORTED:${path}:${node.id}:${lifecycle || "missing"}`);
  }
  if (invalidation !== "external-revision") {
    throw new Error(`VISUAL_VALUE_EXTERNAL_INVALIDATION_UNSUPPORTED:${path}:${node.id}:${invalidation || "missing"}`);
  }
  const readyOutlet = String(external.readyOutlet || "");
  if (readyOutlet && !definition.outlets?.[readyOutlet]) {
    throw new Error(
      `VISUAL_VALUE_EXTERNAL_READY_OUTLET_MISSING:${path}:${node.id}:${readyOutlet}`,
    );
  }
  return Object.freeze({
    capability,
    asynchronous: true,
    lifecycle,
    invalidation,
    pending: String(external.pending || "standby"),
    error: String(external.error || "diagnostic"),
    readyOutlet,
  });
}

function externalStepReady(step, resolver) {
  const outletId = resolver.readyOutlet || step.outletIds[0] || "";
  return !!outletId && step.outputValues[outletId] != null;
}

function applyRuntimeContext(context, runtimeContext) {
  if (!runtimeContext || typeof runtimeContext !== "object") return;
  for (const [key, value] of Object.entries(runtimeContext)) {
    if (
      key === "state" ||
      key === "parameters" ||
      key === "output" ||
      key === "executionClass"
    ) continue;
    context[key] = value;
  }
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
