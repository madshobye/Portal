import { NodeRegistry } from "../node-engine/index.js";
import {
  createUiCommand,
  defineUiGraph,
  isUiNodeDefinition,
  orderedUiGraphNodes,
  UI_GRAPH_FORMAT,
} from "./ui-node.js";
import { createUiStateController } from "./ui-state.js";

export class UiNodeRegistry extends NodeRegistry {
  register(definition) {
    if (!isUiNodeDefinition(definition)) throw new Error(`UI_NODE_DEFINITION_REQUIRED:${definition?.id || "missing"}`);
    return super.register(definition);
  }
}

export class RetainedUiRuntime {
  constructor({
    registry = new UiNodeRegistry(),
    state = createUiStateController(),
    document = globalThis.document,
    dispatch = () => {},
    capabilities = {},
  } = {}) {
    this.registry = registry;
    this.state = state;
    this.document = document;
    this.dispatch = dispatch;
    this.capabilities = Object.freeze({ ...(capabilities || {}) });
    this.instances = new Map();
    this.graphs = new Map();
  }

  mountNode({ id, type, version = "", host, inputs = {}, stateAddress = "", commands = {}, scope = "loose" }) {
    const nodeId = String(id || "");
    if (!nodeId || !host) throw new Error("UI_RUNTIME_MOUNT_TARGET_REQUIRED");
    const scopeId = normalizeScope(scope);
    const key = instanceKey(scopeId, nodeId);
    const definition = this.registry.get(type, version);
    const current = this.instances.get(key);
    if (current && current.definition === definition && current.host === host && current.stateAddress === stateAddress) {
      current.commandContext.bindings = commands;
      current.lifecycle.update?.(inputs);
      current.inputs = inputs;
      return current.lifecycle;
    }
    if (current) this.unmountInstance(key);
    const commandContext = { bindings: commands };
    const emit = (type, payload = {}, phase, address = stateAddress) => {
      const configuredBinding = commandContext.bindings?.[type];
      const binding = typeof configuredBinding === "string"
        ? { action: configuredBinding }
        : configuredBinding || {};
      const command = createUiCommand({
        nodeId,
        type,
        phase,
        address: binding.address || address,
        action: binding.action,
        target: binding.target,
        payload: { ...(binding.payload || {}), ...(payload || {}) },
      });
      this.dispatch(command);
      return command;
    };
    const factory = definition.moduleExports.createUiInstance;
    const lifecycle = factory({
      id: nodeId,
      definition,
      host,
      inputs,
      stateAddress,
      state: this.state,
      document: this.document,
      capabilities: this.capabilities,
      emit,
    });
    if (!lifecycle || typeof lifecycle !== "object") throw new Error(`UI_NODE_LIFECYCLE_INVALID:${nodeId}`);
    lifecycle.mount?.();
    this.instances.set(key, { nodeId, scope: scopeId, definition, host, inputs, stateAddress, commandContext, lifecycle });
    return lifecycle;
  }

  updateNode(id, inputs = {}, { scope = "loose" } = {}) {
    const instance = this.instances.get(instanceKey(normalizeScope(scope), String(id || "")));
    if (!instance) return false;
    instance.inputs = inputs;
    instance.lifecycle.update?.(inputs);
    return true;
  }

  getNode(id, { scope = "loose" } = {}) {
    return this.instances.get(instanceKey(normalizeScope(scope), String(id || "")))?.lifecycle || null;
  }

  unmountNode(id, { scope = "loose" } = {}) {
    const key = instanceKey(normalizeScope(scope), String(id || ""));
    return this.unmountInstance(key);
  }

  unmountInstance(key) {
    const instance = this.instances.get(key);
    if (!instance) return false;
    instance.lifecycle.dispose?.();
    this.instances.delete(key);
    return true;
  }

  activate(graph, { host, inputs = {}, scope = "" } = {}) {
    const normalized = graph?.format === UI_GRAPH_FORMAT ? graph : defineUiGraph(graph);
    if (!host) throw new Error("UI_GRAPH_HOST_REQUIRED");
    const scopeId = normalizeScope(scope || normalized.id);
    this.graphs.set(scopeId, { graph: normalized, host });
    const orderedNodes = orderedUiGraphNodes(normalized);
    const retainedIds = new Set(orderedNodes.map((node) => node.id));
    const staleKeys = [...this.instances]
      .filter(([, instance]) => instance.scope === scopeId && !retainedIds.has(instance.nodeId))
      .map(([key]) => key)
      .reverse();
    for (const key of staleKeys) this.unmountInstance(key);
    for (const node of orderedNodes) {
      const parentLifecycle = node.parent
        ? this.instances.get(instanceKey(scopeId, node.parent))?.lifecycle
        : null;
      const nodeHost = node.parent
        ? parentLifecycle?.slot?.(node.slot)
        : host;
      if (!nodeHost) throw new Error(`UI_GRAPH_SLOT_UNAVAILABLE:${normalized.id}:${node.id}:${node.slot}`);
      this.mountNode({
        ...node,
        host: nodeHost,
        scope: scopeId,
        inputs: { ...node.inputs, ...(inputs[node.id] || {}) },
      });
    }
    return normalized;
  }

  deactivate(scope) {
    const scopeId = normalizeScope(scope);
    const keys = [...this.instances]
      .filter(([, instance]) => instance.scope === scopeId)
      .map(([key]) => key)
      .reverse();
    for (const key of keys) this.unmountInstance(key);
    return this.graphs.delete(scopeId);
  }

  broadcast(method, payload) {
    const operation = String(method || "");
    if (!operation) return 0;
    let handled = 0;
    for (const instance of this.instances.values()) {
      const handler = instance.lifecycle?.[operation];
      if (typeof handler !== "function") continue;
      handler(payload);
      handled += 1;
    }
    return handled;
  }

  dispose() {
    for (const key of [...this.instances.keys()].reverse()) this.unmountInstance(key);
    this.graphs.clear();
  }
}

function normalizeScope(value) {
  const scope = String(value || "loose").trim();
  if (!scope || scope.includes("\u0000")) throw new Error("UI_RUNTIME_SCOPE_INVALID");
  return scope;
}

function instanceKey(scope, nodeId) {
  return `${scope}\u0000${nodeId}`;
}
