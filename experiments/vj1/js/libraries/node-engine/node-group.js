import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "./node-definition.js";
import { NodeInstance } from "./node-runtime.js";
import { NodeGraphProgram } from "./node-graph-program.js?v=editable-inlet-literals-generic-graph-preflight-1";

export const NODE_GROUP_EXECUTION_MODELS = Object.freeze({
  GRAPH: "graph",
  COMPILED_GRAPH: "compiled-graph",
  NATIVE_COMPOSITE: "native-composite",
});

export const NODE_GROUP_CONTROL_PROJECTION_FORMAT = "vj1.control-projection@1";

export function defineNodeGroup(definition = {}) {
  const executionModel = normalizeGroupExecutionModel(
    definition.executionModel || definition.implementation?.executionModel,
    definition.program
  );
  const nodes = Object.freeze((definition.nodes || []).map((node) => Object.freeze({
    ...node,
    id: String(node.id || ""),
    type: String(node.type || node.nodeType || ""),
    version: String(node.version || ""),
    parameters: Object.freeze({ ...(node.parameters || {}) }),
    ...(node.position ? { position: Object.freeze({
      x: Number(node.position.x) || 0,
      y: Number(node.position.y) || 0,
    }) } : {}),
  })));
  if (nodes.some((node) => !node.id || !node.type)) throw new Error(`NODE_GROUP_CHILD_INVALID:${definition.id || "missing"}`);
  const connections = Object.freeze((definition.connections || []).map((connection) => Object.freeze({
    ...connection,
    from: String(connection.from || ""),
    to: String(connection.to || ""),
  })));
  const graphPart = {
    id: "graph",
    kind: NODE_PART_KINDS.GRAPH,
    name: "Internal graph",
    editable: definition.graphEditable !== undefined
      ? definition.graphEditable !== false
      : executionModel !== NODE_GROUP_EXECUTION_MODELS.NATIVE_COMPOSITE,
    nodes,
    connections,
    publicInlets: Object.freeze({ ...(definition.publicInlets || {}) }),
    publicOutlets: Object.freeze({ ...(definition.publicOutlets || {}) }),
  };
  const controlProjection = definition.controlBindings
    ? defineNodeGroupControlProjection({
        groupId: definition.id,
        parameters: definition.parameters,
        nodes,
        bindings: definition.controlBindings,
        presentation: definition.controlPresentation,
      })
    : null;
  const node = defineNode({
    ...definition,
    implementation: {
      ...(typeof definition.implementation === "object" ? definition.implementation : {}),
      kind: NODE_IMPLEMENTATION_KINDS.GROUP,
      executionModel,
    },
    parts: [graphPart, ...(definition.parts || []).filter((part) => part.kind !== NODE_PART_KINDS.GRAPH)],
    presentation: { expandable: true, ...(definition.presentation || {}) },
    metadata: controlProjection
      ? { ...(definition.metadata || {}), controlProjection }
      : definition.metadata,
    process: null,
  });
  const compiler = definition.compiler && typeof definition.compiler === "object"
    ? Object.freeze({
        id: String(definition.compiler.id || ""),
        target: String(definition.compiler.target || ""),
        strategy: String(definition.compiler.strategy || ""),
      })
    : null;
  if (compiler && !compiler.id) throw new Error(`NODE_GROUP_COMPILER_MISSING_ID:${definition.id || "missing"}`);
  return Object.freeze({
    ...node,
    compiler,
    program: typeof definition.program === "function" ? definition.program : null,
  });
}

// A Group publishes ordinary public parameters. This projection only describes
// how those controls are organized in a shared inspector and which semantic
// child parameters they feed. It never installs custom UI code or participates
// in the frame loop.
export function defineNodeGroupControlProjection({
  groupId = "",
  parameters = {},
  nodes = [],
  bindings = {},
  presentation = {},
} = {}) {
  const publicParameters = new Set(Array.isArray(parameters)
    ? parameters.map((parameter) => String(parameter?.id || "")).filter(Boolean)
    : Object.keys(parameters || {}));
  const childNodes = new Set((nodes || []).map((node) => String(node?.id || "")).filter(Boolean));
  const bindingsByParameter = new Map();
  const normalizedBindings = [];
  for (const [nodeId, controls] of Object.entries(bindings || {})) {
    if (!childNodes.has(nodeId)) throw new Error(`NODE_GROUP_CONTROL_NODE_UNKNOWN:${groupId || "missing"}:${nodeId}`);
    for (const entry of controls || []) {
      const publicParameterId = String(
        typeof entry === "string" ? entry : entry?.publicParameterId || entry?.parameterId || ""
      );
      const targetParameterId = String(
        typeof entry === "string" ? entry : entry?.targetParameterId || entry?.parameterId || publicParameterId
      );
      if (!publicParameters.has(publicParameterId)) {
        throw new Error(`NODE_GROUP_CONTROL_PARAMETER_UNKNOWN:${groupId || "missing"}:${nodeId}:${publicParameterId}`);
      }
      const binding = Object.freeze({ nodeId, parameterId: targetParameterId });
      const parameterBindings = bindingsByParameter.get(publicParameterId) || [];
      parameterBindings.push(binding);
      bindingsByParameter.set(publicParameterId, parameterBindings);
      normalizedBindings.push({ nodeId, publicParameterId });
    }
  }

  const sections = new Map();
  const presentedParameters = new Set();
  for (const [nodeId, controls] of Object.entries(bindings || {})) {
    const sectionPresentation = presentation?.[nodeId] || {};
    if (sectionPresentation.hidden === true) continue;
    const omittedParameters = new Set(sectionPresentation.omitParameterIds || []);
    const sectionId = String(sectionPresentation.sectionId || nodeId);
    const section = sections.get(sectionId) || {
      id: sectionId,
      label: String(sectionPresentation.label || humanizeControlSection(sectionId)),
      order: Number.isFinite(Number(sectionPresentation.order)) ? Number(sectionPresentation.order) : sections.size,
      controls: new Map(),
    };
    const nodeBindings = normalizedBindings.filter((binding) => binding.nodeId === nodeId);
    for (const binding of nodeBindings) {
      const parameterId = binding.publicParameterId;
      if (omittedParameters.has(parameterId) || presentedParameters.has(parameterId)) continue;
      section.controls.set(parameterId, {
        parameterId,
        bindings: bindingsByParameter.get(parameterId) || [],
      });
      presentedParameters.add(parameterId);
    }
    if (section.controls.size) sections.set(sectionId, section);
  }
  return Object.freeze({
    format: NODE_GROUP_CONTROL_PROJECTION_FORMAT,
    sections: Object.freeze([...sections.values()]
      .sort((left, right) => left.order - right.order)
      .map((section) => Object.freeze({
        id: section.id,
        label: section.label,
        controls: Object.freeze([...section.controls.values()].map((control) => Object.freeze({
          parameterId: control.parameterId,
          bindings: Object.freeze(control.bindings),
        }))),
      }))),
  });
}

function humanizeControlSection(value = "") {
  const spaced = String(value || "")
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  return spaced ? spaced.replace(/^./, (character) => character.toUpperCase()) : "Controls";
}

function normalizeGroupExecutionModel(value, program) {
  const fallback = typeof program === "function"
    ? NODE_GROUP_EXECUTION_MODELS.NATIVE_COMPOSITE
    : NODE_GROUP_EXECUTION_MODELS.GRAPH;
  const model = String(value || fallback);
  if (!Object.values(NODE_GROUP_EXECUTION_MODELS).includes(model)) {
    throw new Error(`NODE_GROUP_EXECUTION_MODEL_UNKNOWN:${model}`);
  }
  return model;
}

export class NodeGroupInstance extends NodeInstance {
  constructor(definition, { registry, ...options } = {}) {
    if (!registry) throw new Error(`NODE_GROUP_MISSING_REGISTRY:${definition?.id || "missing"}`);
    super(definition, options);
    this.registry = registry;
    this.children = new Map();
    const graph = definition.parts.find((part) => part.kind === NODE_PART_KINDS.GRAPH);
    if (typeof definition.program === "function") {
      for (const child of graph?.nodes || []) {
        const childDefinition = registry.get(child.type, child.version);
        this.children.set(child.id, createNodeInstance(childDefinition, {
          id: `${this.id}/${child.id}`,
          parameters: child.parameters,
          registry,
          typeRegistry: this.typeRegistry,
          clock: this.clock,
        }));
      }
    }
    this.graphProgram = typeof definition.program !== "function"
      ? new NodeGraphProgram(definition, {
          registry,
          typeRegistry: this.typeRegistry,
          clock: this.clock,
          createInstance: createNodeInstance,
        })
      : null;
    this.executor = async (inputs, context) => {
      if (this.graphProgram) return this.graphProgram.execute(inputs, context);
      const { parameters: _groupParameterOverrides, ...inheritedContext } = context;
      return definition.program(inputs, {
        ...context,
        run: async (childId, childInputs = {}, childContext = {}) => {
          const child = this.children.get(childId);
          if (!child) throw new Error(`NODE_GROUP_CHILD_UNKNOWN:${definition.id}:${childId}`);
          // Parameter overrides target one child invocation and must not leak
          // recursively into differently-shaped parameters of nested groups.
          return child.run(childInputs, { ...inheritedContext, ...childContext });
        },
        child: (childId) => this.children.get(childId) || null,
      });
    };
  }

  dispose() {
    this.graphProgram?.dispose();
    this.graphProgram = null;
    for (const child of this.children.values()) child.dispose();
    this.children.clear();
    super.dispose();
  }
}

export function createNodeInstance(definition, options = {}) {
  return definition?.implementation?.kind === NODE_IMPLEMENTATION_KINDS.GROUP
    ? new NodeGroupInstance(definition, options)
    : new NodeInstance(definition, options);
}
