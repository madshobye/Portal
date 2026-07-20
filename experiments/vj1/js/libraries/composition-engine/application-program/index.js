import { defineNodeGroup } from "../../node-engine/node-group.js";

export const APPLICATION_PROGRAM_GENERATOR = "vj1-application-compiler";

export const ApplicationProgramNode = defineNodeGroup({
  id: "core.composition.application-program",
  name: "VJ Application Program",
  version: "0.1.0",
  description: "Configures state, control, media, Live synchronization, storage, cache, output, timing, and diagnostics nodes.",
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
  return {
    id: "vj1.application.program",
    nodeId: ApplicationProgramNode.id,
    nodeVersion: ApplicationProgramNode.version,
    name: "VJ1 Application",
    nodes,
    connections: [
      edge("$in.command", "command.change", "command"),
      edge("command.event", "state.command", "event"),
      edge("state.snapshot", "live.state", "state"),
      edge("state.snapshot", "storage.value", "state"),
      edge("media.resource", "live.media", "media"),
      edge("live.batch", "storage.live", "patches"),
      edge("live.batch", "output.scene", "patches"),
      edge("media.resource", "output.media", "media"),
      edge("clock.time", "output.time", "time"),
      edge("cache.result", "output.cache", "cache"),
      edge("output.metrics", "diagnostics.event", "metrics"),
      edge("output.output", "$out.output", "texture"),
      edge("diagnostics.entries", "$out.diagnostics", "diagnostics"),
    ],
    generatedBy: APPLICATION_PROGRAM_GENERATOR,
  };
}

// The first application program deliberately executes as ordinary code rather
// than through a general scheduler. The persisted roles and dependency list are
// nevertheless authoritative: factories cannot silently construct a second,
// unrelated application topology beside the one visible in the node editor.
export class ApplicationProgramRuntime {
  constructor(group = compileApplicationProgramTopology(), {
    registry = null,
    factories = {},
    context = {},
  } = {}) {
    this.group = group;
    this.registry = registry;
    this.factories = new Map(Object.entries(factories || {}));
    this.context = context;
    this.nodes = new Map();
    this.services = new Map();
    this.pending = new Map();
    for (const item of group?.nodes || []) {
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
  return {
    id,
    nodeId,
    nodeVersion: "0.1.0",
    role,
    dependencies: [...dependencies],
    executionDomain,
    generatedBy: APPLICATION_PROGRAM_GENERATOR,
  };
}

function edge(from, to, type) {
  return { from, to, type };
}
