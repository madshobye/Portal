import { defineNodeGroup } from "../../node-engine/node-group.js";

export const APPLICATION_PROGRAM_GENERATOR = "vj1-application-compiler";

const APPLICATION_RUNTIME_PORTS = Object.freeze({
  timing: { outlets: { time: runtimePort("time") } },
  "state-command": { inlets: { change: runtimePort("command") }, outlets: { event: runtimePort("event") } },
  "data-store": { inlets: { command: runtimePort("event") }, outlets: { snapshot: runtimePort("state") } },
  "session-devices": { inlets: { state: runtimePort("state") } },
  "media-lifecycle": { outlets: { resource: runtimePort("media") } },
  diagnostics: { inlets: { event: runtimePort("metrics") }, outlets: { entries: runtimePort("diagnostics") } },
  "live-synchronization": {
    inlets: { state: runtimePort("state"), media: runtimePort("media") },
    outlets: { batch: runtimePort("patches") },
  },
  storage: { inlets: { value: runtimePort("state"), live: runtimePort("patches") } },
  cache: { outlets: { result: runtimePort("cache") } },
  output: {
    inlets: {
      scene: runtimePort("patches"),
      media: runtimePort("media"),
      time: runtimePort("time"),
      cache: runtimePort("cache"),
    },
    outlets: { metrics: runtimePort("metrics"), output: runtimePort("texture") },
  },
});

export const ApplicationProgramNode = defineNodeGroup({
  id: "core.composition.application-program",
  name: "VJ Application Program",
  version: "0.1.0",
  description: "Configures state, control, media, Live synchronization, storage, cache, output, timing, and diagnostics nodes.",
  executionModel: "compiled-graph",
  graphEditable: false,
  authoring: {
    activation: "read-only",
    reason: "Edit the project-owned Application graph; accepted wiring activates after restart.",
  },
  inlets: { command: { type: "command", optional: true } },
  outlets: { output: { type: "texture", optional: true }, diagnostics: { type: "any", optional: true } },
  execution: { trigger: "manual", domain: "main", stateful: true, asynchronous: true },
  capabilities: ["application-program", "expandable-group", "infrastructure-topology"],
  presentation: { catalogs: ["node-graph"], placeableOn: ["application"], expandable: true, previewOutput: "output" },
  nodes: [],
  connections: [],
  program: async (inputs, context) => {
    if (typeof context.executeApplicationProgram !== "function") throw new Error("APPLICATION_PROGRAM_HOST_MISSING");
    return context.executeApplicationProgram(inputs, context);
  },
});

export function compileApplicationProgramTopology() {
  const nodes = [
    node("clock", "core.timing.visual-time-scale", "timing"),
    node("command", "core.state.command-engine", "state-command"),
    node("state", "core.data.observable-store", "data-store", ["state-command"]),
    node("devices", "core.devices.session-lifecycle", "session-devices", [
      "data-store", "live-synchronization", "diagnostics",
    ]),
    node("media", "core.media.input-lifecycle", "media-lifecycle"),
    node("diagnostics", "core.diagnostics.engine", "diagnostics"),
    node("live", "core.synchronization.live-patches", "live-synchronization", [
      "data-store", "media-lifecycle", "diagnostics",
    ]),
    node("storage", "core.storage.serialized-writes", "storage", [
      "state-command", "data-store", "media-lifecycle", "live-synchronization", "diagnostics",
    ]),
    node("cache", "core.cache.render-engine", "cache", [], "output"),
    node("output", "core.composition.output-program", "output", [
      "timing", "live-synchronization", "media-lifecycle", "cache", "diagnostics",
    ], "output"),
  ];
  const connections = [
    ...applicationServiceConnections(nodes),
    edge("$in.command", "command.change", "command"),
    edge("command.event", "state.command", "event"),
    edge("state.snapshot", "live.state", "state"),
    edge("state.snapshot", "storage.value", "state"),
    edge("state.snapshot", "devices.state", "state"),
    edge("media.resource", "live.media", "media"),
    edge("live.batch", "storage.live", "patches"),
    edge("live.batch", "output.scene", "patches"),
    edge("media.resource", "output.media", "media"),
    edge("clock.time", "output.time", "time"),
    edge("cache.result", "output.cache", "cache"),
    edge("output.metrics", "diagnostics.event", "metrics"),
    edge("output.output", "$out.output", "texture"),
    edge("diagnostics.entries", "$out.diagnostics", "diagnostics"),
  ];
  return {
    id: "vj1.application.program",
    nodeId: ApplicationProgramNode.id,
    nodeVersion: ApplicationProgramNode.version,
    name: "VJ1 Application",
    nodes,
    connections,
    compiler: { id: "vj1.application.service-program", target: "bootstrap", strategy: "compile-setup-dependencies" },
    topologyVersion: 3,
    generatedBy: APPLICATION_PROGRAM_GENERATOR,
  };
}

// The first application program deliberately executes as ordinary code rather
// than through a general scheduler. Setup-time service wires are compiled once
// into constructor dependencies; dataflow wires remain a separate description
// of runtime relationships and never introduce a per-frame graph traversal.
export class ApplicationProgramRuntime {
  constructor(group = compileApplicationProgramTopology(), {
    registry = null,
    factories = {},
    context = {},
  } = {}) {
    this.group = group;
    this.plan = compileApplicationServicePlan(group);
    this.dataflowPlan = compileApplicationDataflowPlan(group);
    this.registry = registry;
    this.factories = new Map(Object.entries(factories || {}));
    this.context = context;
    this.nodes = new Map();
    this.services = new Map();
    this.pending = new Map();
    this.inputHandlers = new Map();
    this.routesBySource = new Map();
    for (const route of this.dataflowPlan.routes) {
      const key = applicationRouteKey(route.sourceRole, route.sourcePort);
      const routes = this.routesBySource.get(key) || [];
      routes.push(route);
      this.routesBySource.set(key, routes);
    }
    for (const item of this.plan.nodes) {
      if (!item?.role || this.nodes.has(item.role)) throw new Error(`APPLICATION_PROGRAM_ROLE_INVALID:${item?.role || "missing"}`);
      if (registry && !registry.has(item.nodeId, item.nodeVersion)) {
        throw new Error(`APPLICATION_PROGRAM_NODE_MISSING:${item.nodeId}@${item.nodeVersion}`);
      }
      this.nodes.set(item.role, item);
    }
    for (const item of this.nodes.values()) {
      for (const dependency of item.dependencies || []) {
        if (!this.nodes.has(dependency)) throw new Error(`APPLICATION_PROGRAM_DEPENDENCY_MISSING:${item.role}:${dependency}`);
      }
    }
  }

  async initialize() {
    for (const role of this.nodes.keys()) await this.resolve(role, []);
    return this;
  }

  async resolve(role, stack = []) {
    const id = String(role || "");
    if (this.services.has(id)) return this.services.get(id);
    if (this.pending.has(id)) return this.pending.get(id);
    const item = this.nodes.get(id);
    if (!item) throw new Error(`APPLICATION_PROGRAM_ROLE_UNKNOWN:${id}`);
    if (stack.includes(id)) throw new Error(`APPLICATION_PROGRAM_DEPENDENCY_CYCLE:${[...stack, id].join("->")}`);
    const pending = this.createService(item, [...stack, id]);
    this.pending.set(id, pending);
    try {
      const service = await pending;
      this.services.set(id, service);
      return service;
    } finally {
      this.pending.delete(id);
    }
  }

  get(role) {
    const id = String(role || "");
    if (!this.services.has(id)) throw new Error(`APPLICATION_PROGRAM_SERVICE_UNINITIALIZED:${id}`);
    return this.services.get(id);
  }

  node(role) {
    return this.nodes.get(String(role || "")) || null;
  }

  hasRoute(sourceRole, sourcePort, targetRole = "", targetPort = "") {
    return this.dataflowPlan.routes.some((route) =>
      route.sourceRole === sourceRole && route.sourcePort === sourcePort &&
      (!targetRole || route.targetRole === targetRole) &&
      (!targetPort || route.targetPort === targetPort));
  }

  bindInput(role, port, handler) {
    const key = applicationRouteKey(role, port);
    if (typeof handler !== "function") throw new TypeError(`APPLICATION_PROGRAM_INPUT_HANDLER_INVALID:${key}`);
    if (this.inputHandlers.has(key)) throw new Error(`APPLICATION_PROGRAM_INPUT_HANDLER_DUPLICATE:${key}`);
    this.inputHandlers.set(key, handler);
    return () => {
      if (this.inputHandlers.get(key) === handler) this.inputHandlers.delete(key);
    };
  }

  emit(role, port, value, metadata = {}) {
    // Routes are indexed once at bootstrap. Runtime events therefore dispatch
    // directly and never scan the graph or enter the renderer's frame loop.
    const routes = this.routesBySource.get(applicationRouteKey(role, port)) || [];
    const deliveries = [];
    for (const route of routes) {
      const handler = this.inputHandlers.get(applicationRouteKey(route.targetRole, route.targetPort));
      if (!handler) continue;
      deliveries.push(handler(value, Object.freeze({ ...metadata, route, runtime: this })));
    }
    return Object.freeze(deliveries);
  }

  async createService(item, stack) {
    const dependencies = {};
    for (const role of item.dependencies || []) dependencies[role] = await this.resolve(role, stack);
    const factory = this.factories.get(item.role);
    if (typeof factory !== "function") {
      if (item.executionDomain === "output") {
        return Object.freeze({ role: item.role, nodeId: item.nodeId, nodeVersion: item.nodeVersion, executionDomain: "output" });
      }
      throw new Error(`APPLICATION_PROGRAM_FACTORY_MISSING:${item.role}`);
    }
    const service = await factory(dependencies, {
      item,
      definition: this.registry?.get(item.nodeId, item.nodeVersion) || null,
      group: this.group,
      runtime: this,
      context: this.context,
    });
    if (service === undefined) throw new Error(`APPLICATION_PROGRAM_FACTORY_EMPTY:${item.role}`);
    return service;
  }
}

export function compileApplicationServicePlan(group = compileApplicationProgramTopology()) {
  const sourceNodes = group?.nodes || [];
  const byId = new Map();
  const byRole = new Map();
  for (const item of sourceNodes) {
    const id = String(item?.id || "");
    const role = String(item?.role || "");
    if (!id || byId.has(id)) throw new Error(`APPLICATION_PROGRAM_NODE_INVALID:${id || "missing"}`);
    if (!role || byRole.has(role)) throw new Error(`APPLICATION_PROGRAM_ROLE_INVALID:${role || "missing"}`);
    byId.set(id, item);
    byRole.set(role, item);
  }
  const dependenciesByRole = new Map([...byRole.keys()].map((role) => [role, new Map()]));
  const setupConnections = [];
  for (const connection of group?.connections || []) {
    const target = applicationEndpoint(connection.to);
    if (connection.phase !== "setup" && !target.port.startsWith("$dependency.")) continue;
    const source = applicationEndpoint(connection.from);
    const sourceNode = byId.get(source.node);
    const targetNode = byId.get(target.node);
    if (!sourceNode || !targetNode) throw new Error(`APPLICATION_PROGRAM_SETUP_NODE_MISSING:${connection.from}:${connection.to}`);
    if (source.port !== "$service" || !target.port.startsWith("$dependency.")) {
      throw new Error(`APPLICATION_PROGRAM_SETUP_PORT_INVALID:${connection.from}:${connection.to}`);
    }
    const dependencyRole = target.port.slice("$dependency.".length);
    if (!(targetNode.dependencyRoles || []).includes(dependencyRole)) {
      throw new Error(`APPLICATION_PROGRAM_DEPENDENCY_UNKNOWN:${targetNode.role}:${dependencyRole}`);
    }
    if (sourceNode.role !== dependencyRole) {
      throw new Error(`APPLICATION_PROGRAM_DEPENDENCY_ROLE_MISMATCH:${targetNode.role}:${dependencyRole}:${sourceNode.role}`);
    }
    const dependencies = dependenciesByRole.get(targetNode.role);
    if (dependencies.has(dependencyRole)) {
      throw new Error(`APPLICATION_PROGRAM_DEPENDENCY_AMBIGUOUS:${targetNode.role}:${dependencyRole}`);
    }
    dependencies.set(dependencyRole, sourceNode.role);
    setupConnections.push(connection);
  }
  const nodes = sourceNodes.map((item) => {
    const dependencies = dependenciesByRole.get(item.role);
    for (const role of item.dependencyRoles || []) {
      if (!dependencies.has(role)) throw new Error(`APPLICATION_PROGRAM_DEPENDENCY_MISSING:${item.role}:${role}`);
    }
    return Object.freeze({ ...item, dependencies: Object.freeze([...dependencies.values()]) });
  });
  assertApplicationDependencyCycles(nodes);
  return Object.freeze({
    id: group.id,
    nodes: Object.freeze(nodes),
    connections: Object.freeze(setupConnections),
  });
}

export function compileApplicationDataflowPlan(group = compileApplicationProgramTopology()) {
  const nodes = group?.nodes || [];
  const byId = new Map(nodes.map((item) => [String(item.id || ""), item]));
  const routes = [];
  for (const connection of group?.connections || []) {
    if (connection.phase === "setup" || connection.type === "service") continue;
    const source = applicationEndpoint(connection.from);
    const target = applicationEndpoint(connection.to);
    const sourceNode = source.node === "$in" ? null : byId.get(source.node);
    const targetNode = target.node === "$out" ? null : byId.get(target.node);
    if (source.node !== "$in" && !sourceNode) throw new Error(`APPLICATION_PROGRAM_DATAFLOW_NODE_MISSING:${connection.from}`);
    if (target.node !== "$out" && !targetNode) throw new Error(`APPLICATION_PROGRAM_DATAFLOW_NODE_MISSING:${connection.to}`);
    const sourcePort = sourceNode ? applicationNodePort(sourceNode, "outlets", source.port) : null;
    const targetPort = targetNode ? applicationNodePort(targetNode, "inlets", target.port) : null;
    if (sourceNode && !sourcePort) {
      throw new Error(`APPLICATION_PROGRAM_DATAFLOW_PORT_MISSING:${connection.from}`);
    }
    if (targetNode && !targetPort) {
      throw new Error(`APPLICATION_PROGRAM_DATAFLOW_PORT_MISSING:${connection.to}`);
    }
    const sourceType = sourcePort?.type || connection.type;
    const targetType = targetPort?.type || connection.type;
    if (sourceType !== connection.type || targetType !== connection.type) {
      throw new Error(`APPLICATION_PROGRAM_DATAFLOW_TYPE_MISMATCH:${connection.from}:${connection.to}:${connection.type}`);
    }
    routes.push(Object.freeze({
      sourceNodeId: source.node,
      sourceRole: sourceNode?.role || "$in",
      sourcePort: source.port,
      targetNodeId: target.node,
      targetRole: targetNode?.role || "$out",
      targetPort: target.port,
      type: connection.type,
    }));
  }
  return Object.freeze({ id: group.id, routes: Object.freeze(routes) });
}

export function compileApplicationProgramPlan(group = compileApplicationProgramTopology()) {
  return Object.freeze({
    id: group.id,
    services: compileApplicationServicePlan(group),
    dataflow: compileApplicationDataflowPlan(group),
  });
}

export function applicationProgramInstances(group = compileApplicationProgramTopology()) {
  return (group.nodes || []).map((item) => ({
    id: `${group.id}/${item.id}`,
    nodeId: item.nodeId,
    nodeVersion: item.nodeVersion,
    role: item.role,
    parentGroupId: group.id,
    generatedBy: APPLICATION_PROGRAM_GENERATOR,
  }));
}

function node(id, nodeId, role, dependencies = [], executionDomain = "control") {
  const dependencyRoles = [...dependencies];
  const runtimePorts = APPLICATION_RUNTIME_PORTS[role] || {};
  return {
    id,
    nodeId,
    nodeVersion: "0.1.0",
    role,
    dependencyRoles,
    ports: {
      inlets: {
        ...applicationInstancePorts(runtimePorts.inlets),
        ...Object.fromEntries(dependencyRoles.map((dependencyRole) => [
          `$dependency.${dependencyRole}`,
          { id: `$dependency.${dependencyRole}`, label: `uses ${dependencyRole}`, type: "service", required: true },
        ])),
      },
      outlets: {
        ...applicationInstancePorts(runtimePorts.outlets),
        $service: { id: "$service", label: "service", type: "service" },
      },
    },
    executionDomain,
    generatedBy: APPLICATION_PROGRAM_GENERATOR,
  };
}

function applicationServiceConnections(nodes) {
  const byRole = new Map(nodes.map((item) => [item.role, item]));
  return nodes.flatMap((target) => (target.dependencyRoles || []).map((dependencyRole) => {
    const source = byRole.get(dependencyRole);
    if (!source) throw new Error(`APPLICATION_PROGRAM_DEPENDENCY_MISSING:${target.role}:${dependencyRole}`);
    return edge(`${source.id}.$service`, `${target.id}.$dependency.${dependencyRole}`, "service", { phase: "setup" });
  }));
}

function assertApplicationDependencyCycles(nodes) {
  const byRole = new Map(nodes.map((item) => [item.role, item]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (role, stack = []) => {
    if (visiting.has(role)) throw new Error(`APPLICATION_PROGRAM_DEPENDENCY_CYCLE:${[...stack, role].join("->")}`);
    if (visited.has(role)) return;
    visiting.add(role);
    for (const dependency of byRole.get(role)?.dependencies || []) visit(dependency, [...stack, role]);
    visiting.delete(role);
    visited.add(role);
  };
  for (const role of byRole.keys()) visit(role);
}

function applicationEndpoint(value) {
  const parts = String(value || "").split(".");
  return { node: parts[0], port: parts.slice(1).join(".") };
}

function edge(from, to, type, metadata = {}) {
  return { from, to, type, ...metadata };
}

function runtimePort(type) {
  return Object.freeze({ type, required: false });
}

function applicationRouteKey(role, port) {
  return `${String(role || "")}.${String(port || "")}`;
}

function applicationNodePort(node, direction, port) {
  return node.ports?.[direction]?.[port] || APPLICATION_RUNTIME_PORTS[node.role]?.[direction]?.[port] || null;
}

function applicationInstancePorts(ports = {}) {
  return Object.fromEntries(Object.entries(ports || {}).map(([id, port]) => [id, {
    id,
    label: id,
    ...port,
  }]));
}
