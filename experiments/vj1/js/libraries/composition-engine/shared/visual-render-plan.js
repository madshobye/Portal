export const VISUAL_RENDER_OPCODES = Object.freeze({
  SOURCE: "source",
  EFFECT: "effect",
  GROUP: "group",
});

export const VISUAL_COMPILER_HOOKS = Object.freeze({
  SOURCE: "vj1.visual.source",
  NATIVE_SOURCE: "vj1.visual.native-source",
  SHADER_GENERATOR: "vj1.visual.shader-generator",
  SHADER_EFFECT: "vj1.visual.shader-effect",
  GROUP: "vj1.visual.layer-group",
});

export function defineVisualNodeCompilerHook({ id, compile } = {}) {
  const hookId = String(id || "");
  if (!hookId || typeof compile !== "function") throw new Error(`VISUAL_NODE_COMPILER_HOOK_INVALID:${hookId || "missing"}`);
  return Object.freeze({ id: hookId, compile });
}

export class VisualNodeCompilerHookRegistry {
  constructor(hooks = []) {
    this.hooks = new Map();
    for (const hook of hooks) this.register(hook);
  }

  register(hook) {
    if (!hook?.id || typeof hook.compile !== "function") throw new Error("VISUAL_NODE_COMPILER_HOOK_INVALID");
    this.hooks.set(hook.id, hook);
    return hook;
  }

  compile(node, context = {}) {
    const hookId = String(node.compilerHook?.id || fallbackHookId(node));
    const hook = this.hooks.get(hookId);
    if (!hook) throw new Error(`VISUAL_NODE_COMPILER_HOOK_MISSING:${node.id}:${hookId}`);
    return hook.compile(node, { ...context, hook: node.compilerHook || { id: hookId } });
  }
}

const sourceHook = (id, backend) => defineVisualNodeCompilerHook({
  id,
  compile: (node, { configuration, path, hook, definition }) => operation(VISUAL_RENDER_OPCODES.SOURCE, node, configuration, path, {
    backend,
    compilerHook: hook,
    ...(hook.renderer ? { renderer: hook.renderer } : {}),
    ...(hook.allocationStable !== undefined ? { allocationStable: hook.allocationStable === true } : {}),
    ...visualNativeModuleFields(definition),
  }),
});

const defaultVisualHookRegistry = new VisualNodeCompilerHookRegistry([
  sourceHook(VISUAL_COMPILER_HOOKS.SOURCE, "source-runtime"),
  sourceHook(VISUAL_COMPILER_HOOKS.NATIVE_SOURCE, "native-specialized"),
  sourceHook(VISUAL_COMPILER_HOOKS.SHADER_GENERATOR, "shader-generator"),
  defineVisualNodeCompilerHook({
    id: VISUAL_COMPILER_HOOKS.SHADER_EFFECT,
    compile: (node, { configuration, path, hook }) => operation(VISUAL_RENDER_OPCODES.EFFECT, node, configuration, path, {
      backend: "shader-effect",
      compilerHook: hook,
      // Older persisted graphs may not carry this compiler metadata yet. Keep
      // that absence explicit so the render host can resolve the node's real
      // definition instead of guessing the wrong coordinate domain.
      transformDomain: hook.transformDomain || null,
      fusion: {
        candidate: hook.fusible === true,
        sampling: hook.sampling || "unknown",
      },
    }),
  }),
  defineVisualNodeCompilerHook({
    id: VISUAL_COMPILER_HOOKS.GROUP,
    compile: (node, { configuration, path, compileChildren, hook }) => operation(VISUAL_RENDER_OPCODES.GROUP, node, configuration, path, {
      backend: "layer-group",
      compilerHook: hook,
      operations: compileChildren(node, configuration, path),
    }),
  }),
]);

export class VisualRenderPlan {
  constructor({ id, componentId, operations = [], diagnostics = [] } = {}) {
    this.id = String(id || "visual-render-plan");
    this.componentId = String(componentId || "");
    this.operations = Object.freeze([...operations]);
    this.diagnostics = Object.freeze([...diagnostics]);
    this.format = "vj1.visual-render-plan@1";
  }

  replaceConfiguration(itemId, nextConfiguration) {
    const result = replaceOperationConfiguration(this.operations, String(itemId || ""), nextConfiguration);
    if (result.changed) this.operations = Object.freeze(result.operations);
    return result.changed;
  }
}

export function compileVisualRenderPlan(group = {}, component = {}, {
  hooks = defaultVisualHookRegistry,
  resolveDefinition = null,
} = {}) {
  const diagnostics = [];
  const operations = compileOperations(
    group.nodes || [],
    group.connections || [],
    component.chain || [],
    group.id || "component",
    hooks,
    diagnostics,
    resolveDefinition
  );
  return new VisualRenderPlan({
    id: group.id,
    componentId: group.componentId || component.id,
    operations,
    diagnostics,
  });
}

export function visualRenderPlanConfiguration(plan = {}) {
  return (plan.operations || []).map(operationConfiguration);
}

function compileOperations(nodes, connections, currentChain, path, hooks, diagnostics, resolveDefinition) {
  const renderNodes = orderedRenderNodes(nodes, connections, path, diagnostics);
  const configurationById = new Map((currentChain || []).map((item) => [String(item.id || ""), item]));
  return renderNodes.map((node) => {
    // The persisted graph owns topology and compiler metadata. Its materialized
    // Component projection owns live runtime values, so bind the operation to
    // that exact object when available. Live patches then become visible by
    // identity without recompiling the plan or synchronizing in the frame loop.
    const configuration = configurationById.get(String(node.id || "")) || node.configuration;
    if (!configuration) throw new Error(`VISUAL_RENDER_CONFIGURATION_MISSING:${path}:${node.id}`);
    return hooks.compile(node, {
      configuration,
      definition: typeof resolveDefinition === "function" ? resolveDefinition(node) : null,
      path: `${path}/${node.id}`,
      compileChildren: (groupNode, groupConfiguration, groupPath) => compileOperations(
        groupNode.nodes || [],
        groupNode.connections || [],
        groupConfiguration.chain || [],
        groupPath,
        hooks,
        diagnostics,
        resolveDefinition
      ),
    });
  });
}

function orderedRenderNodes(nodes, connections, path, diagnostics) {
  const renderNodes = (nodes || []).filter((node) => node.role !== "control");
  if (!renderNodes.length) return [];
  const byId = new Map(renderNodes.map((node) => [String(node.id || ""), node]));
  const textureEdges = (connections || []).filter((edge) => edge.type === "texture" || isTextureEndpoint(edge.from) || isTextureEndpoint(edge.to));
  const output = textureEdges.find((edge) => edge.to === "$out.texture");
  if (!output) {
    if (!(connections || []).length) {
      diagnostics.push({ code: "VISUAL_PLAN_LEGACY_ORDER", path, message: "Legacy graph has no edges; retained node order." });
      return renderNodes;
    }
    diagnostics.push({ code: "VISUAL_PLAN_OUTPUT_DISCONNECTED", path, message: "No node is connected to the texture output." });
    return [];
  }
  const incoming = new Map();
  for (const edge of textureEdges) {
    const target = endpointNode(edge.to);
    if (!target || target.startsWith("$")) continue;
    if (incoming.has(target)) throw new Error(`VISUAL_RENDER_MULTIPLE_TEXTURE_INPUTS:${path}:${target}`);
    incoming.set(target, edge);
  }
  const ordered = [];
  const visited = new Set();
  let endpoint = output.from;
  while (endpoint && endpoint !== "$in.texture") {
    const nodeId = endpointNode(endpoint);
    if (!byId.has(nodeId)) throw new Error(`VISUAL_RENDER_TEXTURE_SOURCE_MISSING:${path}:${endpoint}`);
    if (visited.has(nodeId)) throw new Error(`VISUAL_RENDER_TEXTURE_CYCLE:${path}:${nodeId}`);
    visited.add(nodeId);
    ordered.unshift(byId.get(nodeId));
    endpoint = incoming.get(nodeId)?.from || "";
  }
  if (endpoint !== "$in.texture") throw new Error(`VISUAL_RENDER_TEXTURE_INPUT_DISCONNECTED:${path}:${ordered[0]?.id || "output"}`);
  for (const node of renderNodes) {
    if (!visited.has(node.id)) diagnostics.push({ code: "VISUAL_PLAN_UNUSED_NODE", path: `${path}/${node.id}`, message: "Node is not connected to the texture output." });
  }
  return ordered;
}

function operationConfiguration(operation) {
  if (operation.opcode !== VISUAL_RENDER_OPCODES.GROUP) return operation.configuration;
  return {
    ...operation.configuration,
    chain: (operation.operations || []).map(operationConfiguration),
  };
}

function operation(opcode, node, configuration, path, additions = {}) {
  return Object.freeze({
    opcode,
    id: String(node.id || ""),
    nodeId: String(node.nodeId || node.type || ""),
    nodeVersion: String(node.nodeVersion || node.version || ""),
    path,
    configuration,
    ...additions,
  });
}

function replaceOperationConfiguration(operations, itemId, nextConfiguration) {
  let changed = false;
  const next = operations.map((operation) => {
    if (operation.id === itemId) {
      changed = true;
      return Object.freeze({ ...operation, configuration: nextConfiguration });
    }
    if (operation.opcode !== VISUAL_RENDER_OPCODES.GROUP || !operation.operations?.length) return operation;
    const nested = replaceOperationConfiguration(operation.operations, itemId, nextConfiguration);
    if (!nested.changed) return operation;
    changed = true;
    return Object.freeze({ ...operation, operations: Object.freeze(nested.operations) });
  });
  return { changed, operations: changed ? next : operations };
}

function fallbackHookId(node) {
  if (node.role === "group") return VISUAL_COMPILER_HOOKS.GROUP;
  if (node.role === "effect") return VISUAL_COMPILER_HOOKS.SHADER_EFFECT;
  return VISUAL_COMPILER_HOOKS.SOURCE;
}

function endpointNode(endpoint) {
  return String(endpoint || "").split(".")[0];
}

function isTextureEndpoint(endpoint) {
  return String(endpoint || "").endsWith(".texture");
}

function visualNativeModuleFields(definition = {}) {
  // nodeOwnedNativeProcess predates the richer native-module contract. Keep
  // accepting it so custom/project nodes do not need a package migration just
  // to retain their allocation-stable direct render path.
  if (!definition?.metadata?.nodeOwnedNativeModule && !definition?.metadata?.nodeOwnedNativeProcess) return {};
  const revision = visualNodeModuleRevision(definition);
  const shaders = {};
  const shaderPrograms = new Map();
  for (const part of (definition.parts || []).filter((item) => item.kind === "shader" && item.stage)) {
    // Part ids remain unambiguous for nodes with multiple programs (for
    // example Terrain surface + wire). The first shader for a stage also keeps
    // the compact vertex/fragment compatibility used by single-program nodes.
    shaders[part.id] = part.source || "";
    if (!(part.stage in shaders)) shaders[part.stage] = part.source || "";
    if (part.program) {
      const sources = shaderPrograms.get(part.program) || [];
      sources.push(`${part.id}\u0000${part.source || ""}`);
      shaderPrograms.set(part.program, sources);
    }
  }
  return {
    nodeModule: definition.moduleExports || {},
    nodeShaders: Object.freeze(shaders),
    nodeModuleId: `${definition.id}@${definition.version}`,
    nodeModuleRevision: revision,
    nodeCodeRevision: visualNodePartRevision(definition, new Set(["javascript"])),
    nodeShaderRevision: visualNodePartRevision(definition, new Set(["shader"])),
    nodeShaderProgramRevisions: Object.freeze(Object.fromEntries(
      [...shaderPrograms].map(([program, sources]) => [program, visualSourceRevision(sources.join("\u0001"))])
    )),
    ...(definition.metadata.nodeOwnedNativeProcess && typeof definition.process === "function"
      ? {
          nodeProcess: definition.process,
          nodeProcessId: `${definition.id}@${definition.version}`,
          nodeProcessRevision: revision,
        }
      : {}),
  };
}

function visualNodeModuleRevision(definition = {}) {
  return visualNodePartRevision(definition, new Set(["javascript", "shader"]));
}

function visualNodePartRevision(definition = {}, kinds = new Set()) {
  const source = (definition.parts || [])
    .filter((part) => kinds.has(part.kind))
    .map((part) => `${part.id}\u0000${part.source || ""}`)
    .join("\u0001");
  return visualSourceRevision(source);
}

function visualSourceRevision(source = "") {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
