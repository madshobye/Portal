import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "./node-definition.js";
import { NodeInstance } from "./node-runtime.js";
import { NodeGraphProgram } from "./node-graph-program.js";

export function defineNodeGroup(definition = {}) {
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
    editable: definition.graphEditable !== false,
    nodes,
    connections,
    publicInlets: Object.freeze({ ...(definition.publicInlets || {}) }),
    publicOutlets: Object.freeze({ ...(definition.publicOutlets || {}) }),
  };
  const node = defineNode({
    ...definition,
    implementation: { kind: NODE_IMPLEMENTATION_KINDS.GROUP },
    parts: [graphPart, ...(definition.parts || []).filter((part) => part.kind !== NODE_PART_KINDS.GRAPH)],
    presentation: { expandable: true, ...(definition.presentation || {}) },
    process: null,
  });
  return Object.freeze({ ...node, program: typeof definition.program === "function" ? definition.program : null });
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
