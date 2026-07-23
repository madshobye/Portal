import { compileVisualControlProgram, setCompiledVisualParameter } from "./visual-control-program.js?v=public-control-node-configuration-1";
import {
  defineVisualNodeContract,
  VISUAL_ALLOCATION_MODES,
  VISUAL_COORDINATE_SPACES,
  VISUAL_ROI_MODES,
  visualContractsCompatible,
} from "../../render-engine/visual-node-contract.js";
import {
  frameRenderInvalidation,
  mergeRenderInvalidations,
  revisionRenderInvalidation,
  runtimePolicyRenderInvalidation,
  stableRenderInvalidation,
} from "../../render-engine/invalidation/index.js";
import {
  compileScene3dProgram,
  MeshRenderNode,
  Scene3dNodeDefinitions,
} from "../../mesh-engine/index.js?v=scene3d-media-resource-project-group-authoring-1";
import {
  compileSpecializedCompoundProgram,
  SPECIALIZED_COMPOUND_VISUAL_COMPILER_HOOK,
} from "../../visual-nodes/shared/specialized-compound.js?v=specialized-stage-authority-1";

export const VISUAL_RENDER_OPCODES = Object.freeze({
  SOURCE: "source",
  EFFECT: "effect",
  GROUP: "group",
  MIX: "mix",
  MASK: "mask",
  SELECT: "select",
  TRANSITION: "transition",
  FEEDBACK: "feedback",
  DELAY: "delay",
});

export const VISUAL_COMPILER_HOOKS = Object.freeze({
  SOURCE: "vj1.visual.source",
  NATIVE_SOURCE: "vj1.visual.native-source",
  SHADER_GENERATOR: "vj1.visual.shader-generator",
  SHADER_EFFECT: "vj1.visual.shader-effect",
  GROUP: "vj1.visual.layer-group",
  TEXTURE_OPERATOR: "vj1.visual.texture-operator",
  COMPOUND: "vj1.visual.compound",
  SCENE_3D: "vj1.visual.scene-3d-program",
  SPECIALIZED_COMPOUND: SPECIALIZED_COMPOUND_VISUAL_COMPILER_HOOK,
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
    runtimePolicy: definition?.metadata?.runtimePolicy || null,
    renderInvalidation: definition?.metadata?.renderInvalidation || null,
    ...(hook.renderer ? { renderer: hook.renderer } : {}),
    ...(hook.allocationStable !== undefined ? { allocationStable: hook.allocationStable === true } : {}),
    ...(hook.contract ? { contract: hook.contract } : {}),
    ...visualNativeModuleFields(definition),
  }),
});

const defaultVisualHookRegistry = new VisualNodeCompilerHookRegistry([
  sourceHook(VISUAL_COMPILER_HOOKS.SOURCE, "source-runtime"),
  sourceHook(VISUAL_COMPILER_HOOKS.NATIVE_SOURCE, "native-specialized"),
  sourceHook(VISUAL_COMPILER_HOOKS.SHADER_GENERATOR, "shader-generator"),
  defineVisualNodeCompilerHook({
    id: VISUAL_COMPILER_HOOKS.SHADER_EFFECT,
    compile: (node, { configuration, definition, path, hook }) => operation(VISUAL_RENDER_OPCODES.EFFECT, node, configuration, path, {
      backend: "shader-effect",
      compilerHook: hook,
      runtimePolicy: definition?.metadata?.runtimePolicy || null,
      renderInvalidation: definition?.metadata?.renderInvalidation || null,
      ...(hook.contract ? { contract: hook.contract } : {}),
      // Older persisted graphs may not carry this compiler metadata yet. Keep
      // that absence explicit so the render host can resolve the node's real
      // definition instead of guessing the wrong coordinate domain.
      transformDomain: hook.transformDomain || null,
      fusion: {
        candidate: hook.fusible === true,
        sampling: hook.sampling || "unknown",
      },
      roi: hook.roi || { mode: "local", halo: 0, coordinateSpace: "boundary" },
    }),
  }),
  defineVisualNodeCompilerHook({
    id: VISUAL_COMPILER_HOOKS.GROUP,
    compile: (node, { configuration, path, compileChildren, hook }) => operation(VISUAL_RENDER_OPCODES.GROUP, node, configuration, path, {
      backend: "layer-group",
      compilerHook: hook,
      ...(hook.contract ? { contract: hook.contract } : {}),
      operations: compileChildren(node, configuration, path),
    }),
  }),
  defineVisualNodeCompilerHook({
    id: VISUAL_COMPILER_HOOKS.COMPOUND,
    compile: (node, {
      configuration,
      definition,
      path,
      compileChildren,
      hook,
      resolveDefinition,
      textureOutputPorts,
    }) => {
      if (!definition) throw new Error(`VISUAL_COMPOUND_DEFINITION_MISSING:${path}`);
      const graph = definition.parts?.find((part) => part.kind === "graph");
      if (!graph) throw new Error(`VISUAL_COMPOUND_GRAPH_MISSING:${path}`);
      const selectedOutputs = selectCompoundVisualOutputs(
        definition,
        graph,
        textureOutputPorts,
        path,
      );
      const connections = compoundVisualConnections(definition, graph, path, selectedOutputs);
      const operations = compileChildren({
        nodes: graph.nodes || [],
        connections,
      }, {
        chain: (graph.nodes || [])
          .filter((child) => child.role !== "control")
          .map((child) => child.configuration)
          .filter(Boolean),
      }, path);
      const controlProgram = compileVisualControlProgram({
        id: `${path}.controls`,
        nodes: graph.nodes || [],
        connections,
      }, operations, { resolveDefinition });
      const compiled = operation(VISUAL_RENDER_OPCODES.GROUP, node, configuration, path, {
        backend: "compiled-visual-group",
        compilerHook: hook,
        ...(hook.contract ? { contract: hook.contract } : {}),
        operations,
        executionModel: selectedOutputs.length > 1
          ? "texture-dag"
          : visualExecutionModel(operations),
        runtimeStates: new Map(),
        retainedOperators: new Map(),
        runtimeOutputStates: new Map(),
        publicTextureInputs: Object.freeze(compoundPublicTextureInputs(definition, graph, path)),
        outputPort: selectedOutputs[0]?.publicId || "texture",
        outputPorts: Object.freeze(selectedOutputs.map((output) => output.publicId)),
        outputBindings: Object.freeze(Object.fromEntries(selectedOutputs.map((output) => [
          output.publicId,
          visualTextureValueReference(output.endpoint),
        ]))),
        publicParameterBindings: compileCompoundPublicParameterBindings(
          definition,
          operations,
          controlProgram,
          path,
        ),
        controlProgram,
      });
      synchronizeCompoundPublicParameters(compiled, definition);
      return compiled;
    },
  }),
  defineVisualNodeCompilerHook({
    id: VISUAL_COMPILER_HOOKS.TEXTURE_OPERATOR,
    compile: (node, { configuration, path, hook }) => {
      const opcode = String(hook.operator || "");
      if (!isTextureOperatorOpcode(opcode)) {
        throw new Error(`VISUAL_TEXTURE_OPERATOR_UNKNOWN:${path}:${opcode || "missing"}`);
      }
      return operation(opcode, node, configuration, path, {
        backend: "texture-operator",
        compilerHook: hook,
        ...(hook.contract ? { contract: hook.contract } : {}),
        allocationStable: opcode === VISUAL_RENDER_OPCODES.SELECT,
        retainedState: opcode === VISUAL_RENDER_OPCODES.FEEDBACK || opcode === VISUAL_RENDER_OPCODES.DELAY,
      });
    },
  }),
  defineVisualNodeCompilerHook({
    id: VISUAL_COMPILER_HOOKS.SCENE_3D,
    compile: (node, { configuration, definition, path, hook, resolveDefinition }) => {
      if (!definition) throw new Error(`VISUAL_SCENE_3D_DEFINITION_MISSING:${path}`);
      const builtIns = new Map([...Scene3dNodeDefinitions, MeshRenderNode].map((item) => [item.id, item]));
      const registry = {
        get(id, version = "") {
          const builtIn = builtIns.get(String(id || ""));
          if (builtIn && (!version || builtIn.version === version)) return builtIn;
          const resolved = typeof resolveDefinition === "function"
            ? resolveDefinition({ nodeId: id, nodeVersion: version, id })
            : null;
          if (!resolved) throw new Error(`SCENE_3D_NODE_NOT_REGISTERED:${id}:${version || "latest"}`);
          return resolved;
        },
      };
      return operation(VISUAL_RENDER_OPCODES.SOURCE, node, configuration, path, {
        backend: "scene-3d-program",
        renderer: hook.renderer || "output/specialized:scene3d-program",
        compilerHook: hook,
        ...(hook.contract ? { contract: hook.contract } : {}),
        allocationStable: true,
        scene3dProgram: compileScene3dProgram(definition, { registry }),
      });
    },
  }),
  defineVisualNodeCompilerHook({
    id: VISUAL_COMPILER_HOOKS.SPECIALIZED_COMPOUND,
    compile: (node, { configuration, definition, path, hook, resolveDefinition }) => {
      if (!definition) throw new Error(`VISUAL_SPECIALIZED_COMPOUND_DEFINITION_MISSING:${path}`);
      return operation(VISUAL_RENDER_OPCODES.SOURCE, node, configuration, path, {
        backend: "native-specialized-compound",
        renderer: hook.renderer || definition.metadata?.nativeRenderer,
        compilerHook: hook,
        ...(hook.contract ? { contract: hook.contract } : {}),
        allocationStable: true,
        nativeCompoundProgram: compileSpecializedCompoundProgram(definition, { resolveDefinition }),
        runtimePolicy: definition.metadata?.runtimePolicy || null,
        renderInvalidation: definition.metadata?.renderInvalidation || null,
        ...visualNativeModuleFields(definition),
      });
    },
  }),
]);

export class VisualRenderPlan {
  constructor({ id, componentId, operations = [], controlProgram = null, diagnostics = [], compilerPasses = [] } = {}) {
    this.id = String(id || "visual-render-plan");
    this.componentId = String(componentId || "");
    this.operations = Object.freeze([...operations]);
    this.controlProgram = controlProgram;
    this.diagnostics = Object.freeze([...diagnostics]);
    this.compilerPasses = Object.freeze([...compilerPasses]);
    this.executionModel = visualExecutionModel(operations);
    this.runtimeStates = new Map();
    this.retainedOperators = new Map();
    this.format = "vj1.visual-render-plan@1";
    this.contractVersion = 1;
    this.introspection = new VisualRenderPlanIntrospection(this);
  }

  replaceConfiguration(itemId, nextConfiguration) {
    const result = replaceOperationConfiguration(this.operations, String(itemId || ""), nextConfiguration);
    if (result.changed) this.operations = Object.freeze(result.operations);
    return result.changed;
  }

  dispose() {
    disposeVisualOperations(this.operations);
    this.runtimeStates.clear();
    this.retainedOperators.clear();
  }

  inspect() {
    return this.introspection.snapshot();
  }
}

export function compileVisualRenderPlan(group = {}, component = {}, {
  hooks = defaultVisualHookRegistry,
  resolveDefinition = null,
} = {}) {
  const diagnostics = [];
  const authoredOperations = compileOperations(
    group.nodes || [],
    group.connections || [],
    component.chain || [],
    group.id || "component",
    hooks,
    diagnostics,
    resolveDefinition
  );
  const operations = compileVisualContractPasses(authoredOperations, diagnostics);
  const controlProgram = compileVisualControlProgram(group, operations, { resolveDefinition });
  return new VisualRenderPlan({
    id: group.id,
    componentId: group.componentId || component.id,
    operations,
    controlProgram,
    diagnostics: [...diagnostics, ...controlProgram.diagnostics],
    compilerPasses: [
      "contract-normalization",
      "contract-compatibility",
      "roi-backpropagation",
      "transform-normalization",
      "allocation-lowering",
    ],
  });
}

export function compileVisualContractPasses(operations = [], diagnostics = []) {
  const normalized = operations.map((operation) => normalizeOperationContract(operation, diagnostics));
  validateOperationContracts(normalized);
  const lowered = new Array(normalized.length);
  const defaultDemand = Object.freeze({
    mode: VISUAL_ROI_MODES.LOCAL,
    halo: 0,
    coordinateSpace: VISUAL_COORDINATE_SPACES.BOUNDARY,
  });
  const demandById = new Map();
  const hasAuthoredBindings = normalized.some((operation) => Object.keys(operation.textureInputs || {}).length);
  if (normalized.length) demandById.set(normalized[normalized.length - 1].id, defaultDemand);
  for (let index = normalized.length - 1; index >= 0; index--) {
    const operation = normalized[index];
    const demand = demandById.get(operation.id) || defaultDemand;
    const inputDemand = operationInputDemand(operation.contract, demand);
    const allocationMode = inputDemand.mode === VISUAL_ROI_MODES.FULL_FRAME
      ? VISUAL_ALLOCATION_MODES.FULL_FRAME
      : operation.contract.allocation.mode;
    lowered[index] = Object.freeze({
      ...operation,
      lowering: Object.freeze({
        outputDemand: demand,
        inputDemand,
        transform: operation.contract.transform,
        allocation: Object.freeze({
          mode: allocationMode,
          retained: allocationMode === VISUAL_ALLOCATION_MODES.RETAINED,
          frameStable: operation.allocationStable === true
            || allocationMode === VISUAL_ALLOCATION_MODES.RETAINED,
        }),
      }),
    });
    for (const sourceValueId of Object.values(operation.textureInputs || {})) {
      if (!sourceValueId || isExternalTextureSource(sourceValueId)) continue;
      const sourceId = endpointNode(sourceValueId);
      demandById.set(sourceId, mergeRoiDemand(demandById.get(sourceId), inputDemand));
    }
    if (!hasAuthoredBindings && index > 0) {
      const sourceId = normalized[index - 1].id;
      demandById.set(sourceId, mergeRoiDemand(demandById.get(sourceId), inputDemand));
    }
  }
  return lowered;
}

export function visualRenderPlanConfiguration(plan = {}) {
  return (plan.operations || []).map(operationConfiguration);
}

export class VisualRenderPlanIntrospection {
  constructor(plan) {
    this.plan = plan;
    this.format = "vj1.visual-render-plan-introspection@1";
  }

  snapshot() {
    const records = flattenedOperationRecords(this.plan.operations);
    const media = new Set();
    const components = new Set();
    const generators = new Set();
    const effects = new Set();
    const references = [];
    let camera = false;
    const invalidations = [];
    if ((this.plan.controlProgram?.steps || []).some(controlStepIsFrameDynamic)) {
      invalidations.push(frameRenderInvalidation(null, "control-program"));
    }
    for (const record of records) {
      const configuration = record.operation.configuration || {};
      const source = configuration.source || {};
      if (configuration.enabled === false) continue;
      if (record.operation.opcode === VISUAL_RENDER_OPCODES.EFFECT) {
        if (configuration.componentId) effects.add(String(configuration.componentId));
      }
      if (source.type === "component" && source.componentId) {
        components.add(String(source.componentId));
        references.push(reference("component", source.componentId, record.id, "source.componentId"));
      } else if (source.type === "media" && source.mediaId) {
        media.add(String(source.mediaId));
        references.push(reference("media", source.mediaId, record.id, "source.mediaId"));
      } else if (source.type === "camera") {
        camera = true;
        references.push(reference("camera", "default", record.id, "source.type"));
      } else if (source.type === "generator") {
        generators.add(String(source.generatorId || ""));
      }
      collectParameterReferences(source.params, record.id, media, components, references);
      collectScene3dResourceReferences(record.operation, source.params, record.id, media, references);
      invalidations.push(operationRenderInvalidation(record.operation));
    }
    const invalidation = mergeRenderInvalidations(invalidations);
    const dynamic = invalidation.mode === "frame";
    return Object.freeze({
      format: this.format,
      executionModel: this.plan.executionModel,
      compilerPasses: this.plan.compilerPasses,
      dependencies: Object.freeze({
        components: Object.freeze([...components].sort()),
      }),
      mediaDemand: Object.freeze({
        ids: Object.freeze([...media].sort()),
        camera,
      }),
      readiness: Object.freeze({
        requirements: Object.freeze([
          ...[...media].sort().map((id) => Object.freeze({ kind: "media", id })),
          ...(camera ? [Object.freeze({ kind: "camera", id: "default" })] : []),
        ]),
      }),
      dynamics: Object.freeze({
        frameDependent: dynamic,
        hasControlProgram: (this.plan.controlProgram?.steps || []).length > 0,
        invalidation: Object.freeze({
          mode: invalidation.mode,
          reasons: invalidation.reasons,
          mediaRevisionDependent: media.size > 0,
          componentRevisionDependent: components.size > 0,
        }),
      }),
      references: Object.freeze(references),
      editableItems: Object.freeze(records.map(({ operation, path }) => Object.freeze({
        id: operation.id,
        nodeId: operation.nodeId,
        path,
        opcode: operation.opcode,
        backend: operation.backend,
        activation: operation.nativeCompoundProgram || operation.scene3dProgram ? "recompile" : "live",
      }))),
      operations: Object.freeze(records.map(({ operation, path }) => Object.freeze({
        id: operation.id,
        path,
        opcode: operation.opcode,
        backend: operation.backend,
        renderer: operation.renderer || "",
        enabled: operation.configuration?.enabled !== false,
        contract: operation.contract,
      }))),
      catalogKinds: Object.freeze({
        generators: Object.freeze([...generators].filter(Boolean).sort()),
        effects: Object.freeze([...effects].filter(Boolean).sort()),
      }),
    });
  }

  forEachOperation(visitor) {
    if (typeof visitor !== "function") return;
    visitVisualOperations(this.plan.operations, visitor);
  }
}

export function inspectVisualRenderPlan(plan = {}) {
  return plan?.introspection?.snapshot?.()
    || new VisualRenderPlanIntrospection(plan).snapshot();
}

function compileOperations(nodes, connections, currentChain, path, hooks, diagnostics, resolveDefinition) {
  const renderNodes = orderedRenderNodes(nodes, connections, path, diagnostics);
  const configurationById = new Map((currentChain || []).map((item) => [String(item.id || ""), item]));
  return renderNodes.map((node) => {
    // The persisted graph owns topology and compiler metadata. Its materialized
    // Component projection owns live runtime values, so bind the operation to
    // that exact object when available. Live patches then become visible by
    // identity without recompiling the plan or synchronizing in the frame loop.
    const definition = typeof resolveDefinition === "function" ? resolveDefinition(node) : null;
    const compilerHook = node.compilerHook || definition?.metadata?.visualCompilerHook;
    const effectiveNode = compilerHook ? { ...node, compilerHook } : node;
    const configuration = configurationById.get(String(node.id || "")) || node.configuration
      || (compilerHook?.id === VISUAL_COMPILER_HOOKS.TEXTURE_OPERATOR
        ? textureOperatorConfiguration(node, definition, compilerHook)
        : compilerHook?.id === VISUAL_COMPILER_HOOKS.SCENE_3D
          ? scene3dSourceConfiguration(node, definition)
          : null);
    if (!configuration) throw new Error(`VISUAL_RENDER_CONFIGURATION_MISSING:${path}:${node.id}`);
    const compiled = hooks.compile(effectiveNode, {
      configuration,
      definition,
      resolveDefinition,
      textureOutputPorts: connectedTextureOutputPorts(node.id, connections),
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
    const textureInputs = textureInputBindings(node.id, connections);
    if (compilerHook?.id === VISUAL_COMPILER_HOOKS.TEXTURE_OPERATOR) {
      validateTextureOperatorInputs(node, definition, textureInputs, path);
    }
    return Object.freeze({
      ...compiled,
      textureInputs: Object.freeze(textureInputs),
      textureInputPorts: Object.freeze(Object.keys(textureInputs)),
      // Runtime values are written into this retained map by the optimized
      // texture-DAG executor. Graph topology never becomes per-frame packets.
      runtimeInputStates: new Map(),
    });
  });
}

function orderedRenderNodes(nodes, connections, path, diagnostics) {
  const renderNodes = (nodes || []).filter((node) => node.role !== "control");
  if (!renderNodes.length) return [];
  const byId = new Map(renderNodes.map((node) => [String(node.id || ""), node]));
  const textureEdges = (connections || []).filter((edge) => edge.type === "texture" || isTextureEndpoint(edge.from) || isTextureEndpoint(edge.to));
  const outputs = textureEdges.filter((edge) => endpointNode(edge.to) === "$out");
  if (!outputs.length) {
    if (!(connections || []).length) {
      diagnostics.push({ code: "VISUAL_PLAN_LEGACY_ORDER", path, message: "Legacy graph has no edges; retained node order." });
      return renderNodes;
    }
    diagnostics.push({ code: "VISUAL_PLAN_OUTPUT_DISCONNECTED", path, message: "No node is connected to the texture output." });
    return [];
  }
  const incoming = new Map();
  const occupiedInputs = new Set();
  for (const edge of textureEdges) {
    const target = endpointNode(edge.to);
    if (!target || target.startsWith("$")) continue;
    const inputKey = `${target}.${endpointPort(edge.to)}`;
    if (occupiedInputs.has(inputKey)) throw new Error(`VISUAL_RENDER_MULTIPLE_TEXTURE_INPUTS:${path}:${inputKey}`);
    occupiedInputs.add(inputKey);
    const list = incoming.get(target) || [];
    list.push(edge);
    incoming.set(target, list);
  }
  const ordered = [];
  const visited = new Set();
  const visiting = new Set();
  const visit = (endpoint) => {
    const nodeId = endpointNode(endpoint);
    if (nodeId === "$in") return;
    if (!byId.has(nodeId)) throw new Error(`VISUAL_RENDER_TEXTURE_SOURCE_MISSING:${path}:${endpoint}`);
    if (visiting.has(nodeId)) throw new Error(`VISUAL_RENDER_TEXTURE_CYCLE:${path}:${nodeId}`);
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const edge of incoming.get(nodeId) || []) visit(edge.from);
    visiting.delete(nodeId);
    visited.add(nodeId);
    ordered.push(byId.get(nodeId));
  };
  for (const output of outputs) visit(output.from);
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

function normalizeOperationContract(operation, diagnostics) {
  let contract = defineVisualNodeContract(operation.contract || {});
  if (contract.roi.mode !== VISUAL_ROI_MODES.FULL_FRAME && !contract.roi.pixelEquivalentToFullFrame) {
    diagnostics.push(Object.freeze({
      code: "VISUAL_CONTRACT_ROI_ESCALATED",
      path: operation.path,
      message: "Node cannot guarantee regional pixel equivalence; compiler requires full-frame evaluation.",
    }));
    contract = defineVisualNodeContract({
      ...contract,
      roi: {
        ...contract.roi,
        mode: VISUAL_ROI_MODES.FULL_FRAME,
        coordinateSpace: VISUAL_COORDINATE_SPACES.FULL_FRAME,
      },
      allocation: { mode: VISUAL_ALLOCATION_MODES.FULL_FRAME },
    });
  }
  const nested = operation.opcode === VISUAL_RENDER_OPCODES.GROUP
    ? compileVisualContractPasses(operation.operations || [], diagnostics)
    : operation.operations;
  return Object.freeze({
    ...operation,
    contract,
    ...(nested ? { operations: Object.freeze(nested) } : {}),
  });
}

function validateOperationContracts(operations) {
  const byId = new Map(operations.map((operation) => [operation.id, operation]));
  const hasAuthoredBindings = operations.some((operation) => Object.keys(operation.textureInputs || {}).length);
  for (let index = 0; index < operations.length; index++) {
    const downstream = operations[index];
    const sourceValueIds = Object.values(downstream.textureInputs || {}).filter((id) => !isExternalTextureSource(id));
    const upstreams = sourceValueIds.length
      ? sourceValueIds.map((id) => byId.get(endpointNode(id))).filter(Boolean)
      : !hasAuthoredBindings && index > 0 ? [operations[index - 1]] : [];
    for (const upstream of upstreams) {
      const compatible = visualContractsCompatible(upstream.contract, downstream.contract);
      if (!compatible.coordinates) {
        throw new Error(
          `VISUAL_CONTRACT_COORDINATE_MISMATCH:${upstream.path}:${upstream.contract.coordinates.output}` +
          `:${downstream.path}:${downstream.contract.coordinates.input}`
        );
      }
      if (!compatible.alpha) {
        throw new Error(
          `VISUAL_CONTRACT_ALPHA_MISMATCH:${upstream.path}:${upstream.contract.alpha.output}` +
          `:${downstream.path}:${downstream.contract.alpha.input}`
        );
      }
    }
  }
}

function operationInputDemand(contract, outputDemand) {
  if (contract.roi.mode === VISUAL_ROI_MODES.FULL_FRAME || outputDemand.mode === VISUAL_ROI_MODES.FULL_FRAME) {
    return Object.freeze({
      mode: VISUAL_ROI_MODES.FULL_FRAME,
      halo: 0,
      coordinateSpace: VISUAL_COORDINATE_SPACES.FULL_FRAME,
      mapping: contract.roi.inputMapping,
    });
  }
  if (contract.roi.mode === VISUAL_ROI_MODES.PROJECTIVE) {
    return Object.freeze({
      mode: VISUAL_ROI_MODES.PROJECTIVE,
      halo: outputDemand.halo + contract.roi.halo,
      coordinateSpace: contract.roi.coordinateSpace,
      mapping: contract.roi.inputMapping,
    });
  }
  const halo = outputDemand.halo + contract.roi.halo;
  return Object.freeze({
    mode: halo > 0 || outputDemand.mode === VISUAL_ROI_MODES.NEIGHBORHOOD
      ? VISUAL_ROI_MODES.NEIGHBORHOOD
      : outputDemand.mode,
    halo,
    coordinateSpace: contract.roi.coordinateSpace,
    mapping: contract.roi.inputMapping,
  });
}

function mergeRoiDemand(current, incoming) {
  if (!current) return incoming;
  if (current.mode === VISUAL_ROI_MODES.FULL_FRAME || incoming.mode === VISUAL_ROI_MODES.FULL_FRAME) {
    return Object.freeze({
      mode: VISUAL_ROI_MODES.FULL_FRAME,
      halo: 0,
      coordinateSpace: VISUAL_COORDINATE_SPACES.FULL_FRAME,
    });
  }
  const projective = current.mode === VISUAL_ROI_MODES.PROJECTIVE || incoming.mode === VISUAL_ROI_MODES.PROJECTIVE;
  const halo = Math.max(current.halo, incoming.halo);
  return Object.freeze({
    mode: projective
      ? VISUAL_ROI_MODES.PROJECTIVE
      : halo > 0 || current.mode === VISUAL_ROI_MODES.NEIGHBORHOOD || incoming.mode === VISUAL_ROI_MODES.NEIGHBORHOOD
        ? VISUAL_ROI_MODES.NEIGHBORHOOD
        : VISUAL_ROI_MODES.LOCAL,
    halo,
    coordinateSpace: projective ? VISUAL_COORDINATE_SPACES.PROJECTIVE : incoming.coordinateSpace,
  });
}

function replaceOperationConfiguration(operations, itemId, nextConfiguration) {
  let changed = false;
  const next = operations.map((operation) => {
    if (operation.id === itemId) {
      changed = true;
      const updated = Object.freeze({ ...operation, configuration: nextConfiguration });
      synchronizeCompoundPublicParameters(updated);
      return updated;
    }
    if (operation.opcode !== VISUAL_RENDER_OPCODES.GROUP || !operation.operations?.length) return operation;
    const nested = replaceOperationConfiguration(operation.operations, itemId, nextConfiguration);
    if (!nested.changed) return operation;
    changed = true;
    return Object.freeze({ ...operation, operations: Object.freeze(nested.operations) });
  });
  return { changed, operations: changed ? next : operations };
}

function compileCompoundPublicParameterBindings(definition, operations, controlProgram, path) {
  const projection = definition?.metadata?.controlProjection;
  if (projection?.format !== "vj1.control-projection@1") return Object.freeze([]);
  const operationById = new Map((operations || []).map((item) => [String(item.id || ""), item]));
  const controlStepById = new Map((controlProgram?.steps || []).map((step) => [
    String(step.instanceId || ""),
    step,
  ]));
  const result = [];
  for (const section of projection.sections || []) {
    for (const control of section.controls || []) {
      const parameterId = String(control.parameterId || "");
      if (!definition.parameters?.[parameterId]) {
        throw new Error(`VISUAL_COMPOUND_PUBLIC_PARAMETER_MISSING:${path}:${parameterId || "missing"}`);
      }
      for (const binding of control.bindings || []) {
        const target = operationById.get(String(binding.nodeId || ""));
        const controlStep = controlStepById.get(String(binding.nodeId || ""));
        const targetParameterId = String(binding.parameterId || parameterId);
        if (!target && !controlStep) {
          throw new Error(`VISUAL_COMPOUND_PUBLIC_TARGET_MISSING:${path}:${binding.nodeId || "missing"}`);
        }
        if (controlStep && !Object.hasOwn(controlStep.parameters || {}, targetParameterId)) {
          throw new Error(
            `VISUAL_COMPOUND_PUBLIC_CONTROL_PARAMETER_MISSING:${path}:` +
            `${binding.nodeId || "missing"}.${targetParameterId || "missing"}`
          );
        }
        result.push(Object.freeze(controlStep
          ? {
              parameterId,
              controlStep,
              targetParameterId,
            }
          : {
              parameterId,
              operation: target,
              targetParameterId,
            }));
      }
    }
  }
  return Object.freeze(result);
}

function synchronizeCompoundPublicParameters(operation, definition = null) {
  if (!operation?.publicParameterBindings?.length) return;
  const params = operation.configuration?.source?.params || operation.configuration?.params || {};
  const defaults = definition?.parameters || {};
  const ids = new Set(operation.publicParameterBindings.map((binding) => binding.parameterId));
  for (const id of ids) {
    const value = params[id] !== undefined ? params[id] : defaults[id]?.defaultValue;
    if (value !== undefined) setCompiledVisualParameter(operation, id, value);
  }
}

function disposeVisualOperations(operations) {
  for (const operation of operations || []) {
    operation.scene3dProgram?.dispose?.();
    operation.runtimeStates?.clear?.();
    operation.runtimeInputStates?.clear?.();
    operation.runtimeOutputStates?.clear?.();
    operation.retainedOperators?.clear?.();
    if (operation.operations?.length) disposeVisualOperations(operation.operations);
  }
}

function flattenedOperationRecords(operations, parentPath = "") {
  const records = [];
  for (const operation of operations || []) {
    const path = parentPath ? `${parentPath}/${operation.id}` : String(operation.path || operation.id || "");
    records.push({ operation, path });
    if (operation.operations?.length) records.push(...flattenedOperationRecords(operation.operations, path));
  }
  return records;
}

function visitVisualOperations(operations, visitor) {
  for (const operation of operations || []) {
    visitor(operation);
    if (operation.operations?.length) visitVisualOperations(operation.operations, visitor);
  }
}

function operationIsFrameDynamic(operation) {
  return operationRenderInvalidation(operation).mode === "frame";
}

function operationRenderInvalidation(operation) {
  const configuration = operation.configuration || {};
  const source = configuration.source || {};
  if ((operation.controlProgram?.steps || []).some(controlStepIsFrameDynamic)) {
    return frameRenderInvalidation(null, "compound-control-program");
  }
  if (source.type === "camera") return frameRenderInvalidation(null, "camera");
  if (source.type === "media") {
    const params = source.params || configuration.params || {};
    if (
      Math.abs(Number(params.spinX) || 0) > 0.0001 ||
      Math.abs(Number(params.spinY) || 0) > 0.0001 ||
      Math.abs(Number(params.spinZ) || 0) > 0.0001
    ) return frameRenderInvalidation(null, "media-transform-time");
    return revisionRenderInvalidation(source.mediaId || null, "media-revision");
  }
  if (source.type === "component") {
    return revisionRenderInvalidation(source.componentId || null, "component-revision");
  }
  if (operation.renderInvalidation?.mode === "frame") {
    return frameRenderInvalidation(
      operation.renderInvalidation.key ?? null,
      operation.renderInvalidation.reason || "declared-frame",
    );
  }
  if (operation.renderInvalidation?.mode === "revision") {
    return revisionRenderInvalidation(
      operation.renderInvalidation.key ?? null,
      operation.renderInvalidation.reason || "declared-revision",
    );
  }
  const policyInvalidation = runtimePolicyRenderInvalidation(
    operation.runtimePolicy,
    source.params || configuration.params || {},
  );
  if (policyInvalidation.mode !== "stable") return policyInvalidation;
  if (operation.opcode === VISUAL_RENDER_OPCODES.FEEDBACK || operation.opcode === VISUAL_RENDER_OPCODES.DELAY) {
    return frameRenderInvalidation(null, "retained-feedback");
  }
  return stableRenderInvalidation("operation-stable");
}

function controlStepIsFrameDynamic(step) {
  if (step?.frameDynamic === true) return true;
  return [
    "core.control.component-time",
    "core.control.oscillator",
    "core.timing.rate-clock",
    "core.timing.visual-time-scale",
    "core.timing.instance-time",
    "core.motion.nested-noise",
    "core.motion.orbit",
    "core.terrain.flight-controller",
  ].includes(String(step?.nodeId || ""));
}

function collectParameterReferences(params, operationId, media, components, references, path = "source.params") {
  if (!params || typeof params !== "object") return;
  for (const [key, value] of Object.entries(params)) {
    const nextPath = `${path}.${key}`;
    if (value && typeof value === "object") {
      collectParameterReferences(value, operationId, media, components, references, nextPath);
      continue;
    }
    const id = String(value || "");
    if (!id) continue;
    if (/^componentId$/i.test(key)) {
      components.add(id);
      references.push(reference("component", id, operationId, nextPath));
    } else if (/(?:media|image|mesh|texture|font)[A-Za-z0-9_]*Id$/i.test(key)) {
      media.add(id);
      references.push(reference("media", id, operationId, nextPath));
    }
  }
}

function collectScene3dResourceReferences(operation, params, operationId, media, references) {
  for (const binding of operation?.scene3dProgram?.resourceBindings || []) {
    if (binding.kind !== "media") continue;
    const id = String(binding.publicInputId
      ? params?.[binding.publicInputId] || ""
      : binding.staticId || "");
    if (!id) continue;
    media.add(id);
    references.push(reference(
      binding.valueType === "mesh" ? "media-mesh" : "media",
      id,
      operationId,
      binding.publicInputId
        ? `source.params.${binding.publicInputId}`
        : `scene3d.${binding.nodeId}.${binding.parameterId}`,
    ));
  }
}

function reference(kind, id, operationId, path) {
  return Object.freeze({
    kind,
    id: String(id || ""),
    operationId: String(operationId || ""),
    path: String(path || ""),
  });
}

function fallbackHookId(node) {
  if (node.compilerHook?.id === VISUAL_COMPILER_HOOKS.TEXTURE_OPERATOR || node.role === "operator") {
    return VISUAL_COMPILER_HOOKS.TEXTURE_OPERATOR;
  }
  if (node.role === "group") return VISUAL_COMPILER_HOOKS.GROUP;
  if (node.role === "effect") return VISUAL_COMPILER_HOOKS.SHADER_EFFECT;
  return VISUAL_COMPILER_HOOKS.SOURCE;
}

function endpointNode(endpoint) {
  return String(endpoint || "").split(".")[0];
}

function endpointPort(endpoint) {
  return String(endpoint || "").split(".").slice(1).join(".");
}

function isTextureEndpoint(endpoint) {
  return String(endpoint || "").endsWith(".texture");
}

function textureInputBindings(nodeId, connections) {
  const result = {};
  for (const edge of connections || []) {
    if (
      endpointNode(edge.to) !== String(nodeId || "") ||
      !(edge.type === "texture" || isTextureEndpoint(edge.from) || isTextureEndpoint(edge.to))
    ) continue;
    const sourceNodeId = endpointNode(edge.from);
    result[endpointPort(edge.to) || "texture"] = sourceNodeId === "$in"
      ? `$in.${endpointPort(edge.from) || "texture"}`
      : visualTextureValueReference(edge.from);
  }
  return result;
}

function compoundVisualConnections(definition, graph, path, selectedOutputs) {
  const connections = (graph.connections || []).filter((edge) => endpointNode(edge.to) !== "$out");
  const publicInputs = compoundPublicTextureInputs(definition, graph, path);
  for (const [publicId, endpoint] of Object.entries(publicInputs)) {
    const from = `$in.${publicId}`;
    if (connections.some((edge) => edge.from === from && edge.to === endpoint)) continue;
    if (connections.some((edge) => edge.to === endpoint)) {
      throw new Error(`VISUAL_COMPOUND_PUBLIC_INPUT_OCCUPIED:${path}:${publicId}:${endpoint}`);
    }
    connections.push({ from, to: endpoint, type: "texture" });
  }

  for (const output of selectedOutputs || []) {
    if (!output?.endpoint) continue;
    connections.push({
      from: output.endpoint,
      to: `$out.${output.publicId}`,
      type: "texture",
    });
  }
  return connections;
}

function selectCompoundVisualOutputs(definition, graph, requestedPorts, path) {
  const outputs = new Map();
  const explicitOutputs = (graph.connections || [])
    .filter((edge) => edge.to === "$out.texture")
    .map((edge) => String(edge.from || ""))
    .filter(Boolean);
  if (explicitOutputs.length > 1 && new Set(explicitOutputs).size > 1) {
    throw new Error(`VISUAL_COMPOUND_OUTPUT_AMBIGUOUS:${path}:texture`);
  }
  if (explicitOutputs[0]) outputs.set("texture", explicitOutputs[0]);
  for (const [publicId, endpoint] of Object.entries(graph.publicOutlets || {})) {
    const outlet = definition.outlets?.[publicId];
    if (!outlet) throw new Error(`VISUAL_COMPOUND_PUBLIC_OUTPUT_MISSING:${path}:${publicId}`);
    if (outlet.type?.type !== "texture") {
      throw new Error(`VISUAL_COMPOUND_PUBLIC_OUTPUT_TYPE_UNSUPPORTED:${path}:${publicId}:${outlet.type?.type || "unknown"}`);
    }
    outputs.set(publicId, String(endpoint || ""));
  }
  const requested = [...new Set((requestedPorts || []).filter(Boolean))];
  const selectedIds = requested.length
    ? requested
    : [
        String(definition.presentation?.previewOutput || "")
          || (outputs.has("texture") ? "texture" : outputs.keys().next().value || "texture"),
      ];
  if (!outputs.size && selectedIds.length === 1 && selectedIds[0] === "texture") {
    return Object.freeze([Object.freeze({ publicId: "texture", endpoint: "" })]);
  }
  const selected = [];
  for (const publicId of selectedIds) {
    if (!outputs.has(publicId)) {
      throw new Error(`VISUAL_COMPOUND_PUBLIC_OUTPUT_UNBOUND:${path}:${publicId}`);
    }
    selected.push(Object.freeze({
      publicId,
      endpoint: outputs.get(publicId),
    }));
  }
  return Object.freeze(selected);
}

function compoundPublicTextureInputs(definition, graph, path) {
  const result = {};
  for (const [publicId, endpoint] of Object.entries(graph.publicInlets || {})) {
    const inlet = definition.inlets?.[publicId];
    if (!inlet) throw new Error(`VISUAL_COMPOUND_PUBLIC_INPUT_MISSING:${path}:${publicId}`);
    if (inlet.type?.type !== "texture") {
      throw new Error(`VISUAL_COMPOUND_PUBLIC_INPUT_TYPE_UNSUPPORTED:${path}:${publicId}:${inlet.type?.type || "unknown"}`);
    }
    result[publicId] = String(endpoint || "");
  }
  return result;
}

function visualExecutionModel(operations = []) {
  const externalInputs = new Set();
  let previousId = "";
  for (const operation of operations || []) {
    if (isTextureOperatorOpcode(operation.opcode) || operation.executionModel === "texture-dag") {
      return "texture-dag";
    }
    const inputs = Object.values(operation.textureInputs || {}).filter(Boolean);
    if (inputs.length > 1) return "texture-dag";
    for (const sourceId of inputs) {
      if (isExternalTextureSource(sourceId)) externalInputs.add(sourceId);
      else if (previousId && endpointNode(sourceId) !== previousId) return "texture-dag";
    }
    previousId = operation.id;
  }
  return externalInputs.size > 1 ? "texture-dag" : "compiled-chain";
}

function connectedTextureOutputPorts(nodeId, connections) {
  const sourceId = String(nodeId || "");
  return (connections || [])
    .filter((edge) =>
      endpointNode(edge.from) === sourceId &&
      (edge.type === "texture" || isTextureEndpoint(edge.from) || isTextureEndpoint(edge.to))
    )
    .map((edge) => endpointPort(edge.from) || "texture");
}

function isExternalTextureSource(sourceId) {
  return endpointNode(sourceId) === "$in";
}

function visualTextureValueReference(endpoint) {
  const nodeId = endpointNode(endpoint);
  const portId = endpointPort(endpoint) || "texture";
  return portId === "texture" ? nodeId : `${nodeId}.${portId}`;
}

function textureOperatorConfiguration(node, definition, hook) {
  const params = Object.fromEntries(Object.entries(definition?.parameters || {}).flatMap(([id, parameter]) =>
    parameter.defaultValue === undefined ? [] : [[id, parameter.defaultValue]]));
  Object.assign(params, node.parameters || {}, node.configuration?.params || {});
  return {
    id: String(node.id || ""),
    kind: "texture-operator",
    operator: String(hook.operator || definition?.metadata?.visualOperator || ""),
    enabled: node.configuration?.enabled !== false,
    params,
  };
}

function scene3dSourceConfiguration(node, definition) {
  const params = Object.fromEntries(Object.entries(definition?.parameters || {}).flatMap(([id, parameter]) =>
    parameter.defaultValue === undefined ? [] : [[id, parameter.defaultValue]]));
  Object.assign(params, node.parameters || {}, node.configuration?.source?.params || {});
  return {
    id: String(node.id || ""),
    kind: "source",
    enabled: node.configuration?.enabled !== false,
    source: {
      type: "generator",
      generatorId: "scene3d-program",
      params,
    },
    transform: node.configuration?.transform || {},
    opacity: node.configuration?.opacity ?? 1,
    blend: node.configuration?.blend || "normal",
  };
}

function validateTextureOperatorInputs(node, definition, textureInputs, path) {
  for (const [id, inlet] of Object.entries(definition?.inlets || {})) {
    if (inlet.type?.type !== "texture" || inlet.required !== true) continue;
    if (!textureInputs[id]) throw new Error(`VISUAL_TEXTURE_INPUT_REQUIRED:${path}:${node.id}.${id}`);
  }
}

function isTextureOperatorOpcode(opcode) {
  return [
    VISUAL_RENDER_OPCODES.MIX,
    VISUAL_RENDER_OPCODES.MASK,
    VISUAL_RENDER_OPCODES.SELECT,
    VISUAL_RENDER_OPCODES.TRANSITION,
    VISUAL_RENDER_OPCODES.FEEDBACK,
    VISUAL_RENDER_OPCODES.DELAY,
  ].includes(opcode);
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
