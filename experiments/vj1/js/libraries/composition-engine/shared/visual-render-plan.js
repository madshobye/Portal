import { compileVisualControlProgram, setCompiledVisualParameter } from "./visual-control-program.js";
import { compileVisualValueProgram } from "./visual-value-program.js";
import {
  defineVisualNodeContract,
  VISUAL_ALLOCATION_MODES,
  VISUAL_COORDINATE_SPACES,
  VISUAL_ROI_MODES,
  VISUAL_TRANSFORM_DOMAINS,
  visualContractsCompatible,
} from "../../render-engine/visual-node-contract.js";
import {
  frameRenderInvalidation,
  mergeRenderInvalidations,
  revisionRenderInvalidation,
  runtimePolicyRenderInvalidation,
  stableRenderInvalidation,
} from "../../render-engine/invalidation/index.js";
import { visitVisualParameterReferences } from "../../visual-nodes/shared/parameter-references.js";

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
  PROBE: "probe",
});

export const VISUAL_COMPILER_HOOKS = Object.freeze({
  SOURCE: "vj1.visual.source",
  NATIVE_SOURCE: "vj1.visual.native-source",
  SHADER_GENERATOR: "vj1.visual.shader-generator",
  SHADER_EFFECT: "vj1.visual.shader-effect",
  GROUP: "vj1.visual.layer-group",
  TEXTURE_OPERATOR: "vj1.visual.texture-operator",
  COMPOUND: "vj1.visual.compound",
  PROBE: "vj1.visual.probe",
  DMX_PROBE: "vj1.visual.dmx-probe",
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
  compile: (node, {
    configuration,
    path,
    hook,
    definition,
    nativeModuleDefinitions,
  }) => operation(VISUAL_RENDER_OPCODES.SOURCE, node, configuration, path, {
    backend,
    compilerHook: hook,
    runtimePolicy: definition?.metadata?.runtimePolicy || null,
    renderInvalidation: definition?.metadata?.renderInvalidation || null,
    directPlacement: definition?.metadata?.directPlacement || null,
    renderTarget: visualRenderTargetRequirements(definition, hook),
    ...(hook.renderer ? { renderer: hook.renderer } : {}),
    ...(hook.nativeKernel || definition?.metadata?.nativeKernel
      ? { nativeKernel: hook.nativeKernel || definition.metadata.nativeKernel }
      : {}),
    ...(hook.allocationStable !== undefined ? { allocationStable: hook.allocationStable === true } : {}),
    ...(hook.contract ? { contract: hook.contract } : {}),
    ...(hook.framebufferPass
      ? { framebufferPass: Object.freeze({ ...hook.framebufferPass }) }
      : {}),
    ...visualNativeModuleFields(definition, nativeModuleDefinitions),
  }),
});

function visualRenderTargetRequirements(definition = {}, hook = {}) {
  const declared = {
    ...(definition?.metadata?.renderTarget || {}),
    ...(hook?.renderTarget || {}),
  };
  return Object.freeze({
    depth: declared.depth === true,
  });
}

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
    id: VISUAL_COMPILER_HOOKS.PROBE,
    compile: (node, { configuration, path, hook }) =>
      operation(
        VISUAL_RENDER_OPCODES.PROBE,
        node,
        configuration,
        path,
        {
          backend: "probe-observer",
          compilerHook: hook,
          transformDomain: VISUAL_TRANSFORM_DOMAINS.GROUP_FIELD,
          contract: defineVisualNodeContract({}, {
            transform: { domain: VISUAL_TRANSFORM_DOMAINS.GROUP_FIELD },
            roi: {
              mode: VISUAL_ROI_MODES.LOCAL,
              halo: 0,
              coordinateSpace: VISUAL_COORDINATE_SPACES.BOUNDARY,
            },
          }),
        },
      ),
  }),
  defineVisualNodeCompilerHook({
    id: VISUAL_COMPILER_HOOKS.DMX_PROBE,
    compile: (node, { configuration, path, hook }) =>
      operation(
        VISUAL_RENDER_OPCODES.PROBE,
        node,
        configuration,
        path,
        {
          backend: "dmx-probe-observer",
          compilerHook: hook,
          transformDomain: VISUAL_TRANSFORM_DOMAINS.GROUP_FIELD,
          contract: defineVisualNodeContract({}, {
            transform: { domain: VISUAL_TRANSFORM_DOMAINS.GROUP_FIELD },
            roi: {
              mode: VISUAL_ROI_MODES.LOCAL,
              halo: 0,
              coordinateSpace: VISUAL_COORDINATE_SPACES.BOUNDARY,
            },
          }),
        },
      ),
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
      const childOperations = compileChildren({
        nodes: graph.nodes || [],
        connections,
      }, {
        chain: (graph.nodes || [])
          .filter((child) => child.role !== "control")
          // A Node definition is an immutable template shared by every
          // instance. Its private child configurations are runtime parameter
          // storage, however, so each compiled compound must own a distinct
          // tree. Reusing the definition objects made the last instance of a
          // compound overwrite earlier instances (for example, the second
          // Project Media node changed the first node's fit mode).
          .map((child) => cloneCompoundConfiguration(child.configuration))
          .filter(Boolean),
      }, path);
      const operations = compileFramebufferPassSequences(
        childOperations,
        selectedOutputs,
        path,
      );
      // Resource providers are value nodes, while retained render caches belong
      // to their downstream render operations. Project the provider dependency
      // through the typed-value graph before compiling the programs that bind
      // to those operations. This makes a resource revision invalidate its
      // exact render consumer without rebuilding the visual graph.
      const dependencyControlProgram = compileVisualControlProgram({
        id: `${path}.controls`,
        nodes: graph.nodes || [],
        connections,
      }, operations, { resolveDefinition });
      const dependencyValueProgram = compileVisualValueProgram({
        id: `${path}.values`,
        nodes: graph.nodes || [],
        connections,
      }, operations, { resolveDefinition });
      const dependencyPublicBindings = compileCompoundPublicParameterBindings(
        definition,
        operations,
        dependencyControlProgram,
        dependencyValueProgram,
        path,
      );
      const boundOperations = projectValueDependencies(
        operations,
        dependencyValueProgram,
        {
          publicParameterBindings: dependencyPublicBindings,
          params:
            configuration?.source?.params ||
            configuration?.params ||
            {},
        },
      );
      dependencyControlProgram.dispose?.();
      dependencyValueProgram.dispose();
      const controlProgram = compileVisualControlProgram({
        id: `${path}.controls`,
        nodes: graph.nodes || [],
        connections,
      }, boundOperations, { resolveDefinition });
      const valueProgram = compileVisualValueProgram({
        id: `${path}.values`,
        nodes: graph.nodes || [],
        connections,
      }, boundOperations, { resolveDefinition });
      const placementLowering = compoundPlacementLowering(boundOperations, selectedOutputs);
      const compiled = operation(VISUAL_RENDER_OPCODES.GROUP, node, configuration, path, {
        backend: "compiled-visual-group",
        compilerHook: hook,
        ...(hook.contract ? { contract: hook.contract } : {}),
        runtimePolicy: definition.metadata?.runtimePolicy || null,
        renderInvalidation: definition.metadata?.renderInvalidation || null,
        operations: boundOperations,
        executionModel: selectedOutputs.length > 1
          ? "texture-dag"
          : visualExecutionModel(boundOperations),
        placementLowering,
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
          boundOperations,
          controlProgram,
          valueProgram,
          path,
        ),
        controlProgram,
        valueProgram,
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
]);

function projectValueDependencies(
  operations = [],
  valueProgram = null,
  {
    publicParameterBindings = [],
    params = {},
  } = {},
) {
  if (!valueProgram?.steps?.length || !valueProgram?.bindings?.length) {
    return operations;
  }
  const mediaByStep = new Map();
  const invalidationByStep = new Map();
  const externalRequirementsByStep = new Map();
  for (const step of valueProgram.steps) {
    const media = new Set();
    const upstreamInvalidations = [];
    const externalRequirements = new Map();
    if (step.externalResolver) {
      mergeExternalRequirement(externalRequirements, {
        kind: "capability",
        id: step.externalResolver.capability,
        lifecycle: step.externalResolver.lifecycle,
        asynchronous: true,
        invalidation: step.externalResolver.invalidation,
        sourceStepIds: [step.id],
      });
    }
    for (const input of step.inputs || []) {
      for (const id of mediaByStep.get(input.sourceStepId) || []) media.add(id);
      const upstream = invalidationByStep.get(input.sourceStepId);
      if (upstream) upstreamInvalidations.push(upstream);
      for (
        const requirement of
        externalRequirementsByStep.get(input.sourceStepId)?.values?.() || []
      ) {
        mergeExternalRequirement(externalRequirements, requirement);
      }
    }
    for (const dependency of step.resourceDependencies || []) {
      if (dependency.kind !== "media") continue;
      const publicBinding = publicParameterBindings.find((binding) =>
        binding.controlStep === step &&
        binding.targetParameterId === dependency.parameterId
      );
      const id = String(publicBinding
        ? params?.[publicBinding.parameterId] || ""
        : step.parameters?.[dependency.parameterId] || "");
      if (id) media.add(id);
    }
    mediaByStep.set(step.id, media);
    externalRequirementsByStep.set(step.id, externalRequirements);
    invalidationByStep.set(
      step.id,
      mergeRenderInvalidations(
        upstreamInvalidations,
        step.frameDynamic === true
          ? frameRenderInvalidation(step.id, "value-frame")
          : revisionRenderInvalidation(step.id, "value-revision"),
      ),
    );
  }
  const mediaByOperation = new Map();
  const invalidationByOperation = new Map();
  const externalRequirementsByOperation = new Map();
  for (const binding of valueProgram.bindings) {
    const target = String(binding.operation?.id || "");
    if (!target) continue;
    const media = mediaByOperation.get(target) || new Set();
    for (const id of mediaByStep.get(binding.sourceStepId) || []) media.add(id);
    mediaByOperation.set(target, media);
    invalidationByOperation.set(
      target,
      mergeRenderInvalidations(
        invalidationByOperation.get(target),
        invalidationByStep.get(binding.sourceStepId),
      ),
    );
    const externalRequirements =
      externalRequirementsByOperation.get(target) || new Map();
    for (
      const requirement of
      externalRequirementsByStep.get(binding.sourceStepId)?.values?.() || []
    ) {
      mergeExternalRequirement(externalRequirements, requirement);
    }
    externalRequirementsByOperation.set(target, externalRequirements);
  }
  return operations.map((operation) => {
    const id = String(operation.id || "");
    const projectedMedia = mediaByOperation.get(id);
    const projectedInvalidation = invalidationByOperation.get(id);
    const projectedExternalRequirements = Object.freeze(
      [...(externalRequirementsByOperation.get(id)?.values?.() || [])]
        .map((requirement) => Object.freeze({
          ...requirement,
          sourceStepIds: Object.freeze([
            ...new Set(requirement.sourceStepIds || []),
          ].sort()),
        })),
    );
    if (
      !projectedMedia?.size &&
      !projectedInvalidation &&
      !projectedExternalRequirements.length
    ) return operation;
    return Object.freeze({
      ...operation,
      externalResourceDependent:
        operation.externalResourceDependent === true ||
        projectedExternalRequirements.length > 0,
      ...(projectedExternalRequirements.length
        ? {
            externalResourceRequirements:
              projectedExternalRequirements,
          }
        : {}),
      ...(projectedMedia?.size
        ? {
            mediaDependencies: Object.freeze([
              ...new Set([
                ...(operation.mediaDependencies || []),
                ...projectedMedia,
              ]),
            ].sort()),
          }
        : {}),
      ...(projectedInvalidation
        ? {
            renderInvalidation: mergeRenderInvalidations(
              declaredRenderInvalidation(operation.renderInvalidation),
              projectedInvalidation,
            ),
          }
        : {}),
    });
  });
}

function mergeExternalRequirement(requirements, requirement = {}) {
  const id = String(requirement.id || "");
  if (!id) return;
  const current = requirements.get(id);
  requirements.set(id, {
    kind: String(requirement.kind || current?.kind || "capability"),
    id,
    lifecycle: String(
      requirement.lifecycle || current?.lifecycle || "",
    ),
    asynchronous:
      requirement.asynchronous === true ||
      current?.asynchronous === true,
    invalidation: String(
      requirement.invalidation || current?.invalidation || "",
    ),
    sourceStepIds: [
      ...new Set([
        ...(current?.sourceStepIds || []),
        ...(requirement.sourceStepIds || []),
      ]),
    ],
  });
}

function declaredRenderInvalidation(invalidation = null) {
  if (invalidation?.mode === "frame") {
    return frameRenderInvalidation(
      invalidation.key ?? null,
      invalidation.reason || "declared-frame",
    );
  }
  if (
    invalidation?.mode === "revision" ||
    invalidation?.mode === "dependency"
  ) {
    return revisionRenderInvalidation(
      invalidation.key ?? null,
      invalidation.reason || "declared-revision",
    );
  }
  return stableRenderInvalidation(
    invalidation?.reason || "declared-stable",
  );
}

function compoundPlacementLowering(operations = [], selectedOutputs = []) {
  if (operations.length !== 1 || selectedOutputs.length !== 1) return "compound-output";
  const terminal = operations[0];
  const outputNodeId = endpointNode(selectedOutputs[0]?.endpoint);
  const ordinaryProceduralShader = terminal.opcode === VISUAL_RENDER_OPCODES.SOURCE &&
    terminal.backend === "shader-generator" &&
    terminal.compilerHook?.shaderInterface === "fragment";
  const declaredRenderProcess = terminal.opcode === VISUAL_RENDER_OPCODES.SOURCE &&
    typeof terminal.nodeProcess === "function" &&
    !!terminal.nodeProcessContextFormat &&
    terminal.contract?.transform?.domain === VISUAL_TRANSFORM_DOMAINS.CONTENT;
  return (ordinaryProceduralShader || declaredRenderProcess) &&
    outputNodeId === terminal.id
    ? "terminal-coordinate"
    : "compound-output";
}

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
    if (operation.compositionInput && !isExternalTextureSource(operation.compositionInput)) {
      const sourceId = endpointNode(operation.compositionInput);
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
  return (plan.operations || [])
    .filter((operation) => !operation.configuration?.auxiliaryFor)
    .map(operationConfiguration);
}

// A Component may be evaluated directly into a cropped render request only
// when every operation that currently contributes pixels is regionally
// equivalent to its full-frame evaluation. Disabled operations deliberately
// do not participate: visibility is a live runtime value, and a dormant
// persistent/full-frame shader must not prevent an otherwise local chain from
// using the exact ROI requested by its final consumer.
export function visualRenderPlanRegionSafe(plan = {}, component = null, {
  resolveRoi = null,
} = {}) {
  const authoredConfiguration = new Map();
  const collectAuthored = (chain = []) => {
    for (const item of chain || []) {
      if (item?.id) authoredConfiguration.set(String(item.id), item);
      if (item?.kind === "group") collectAuthored(item.chain || []);
    }
  };
  collectAuthored(component?.chain || []);
  let activeKernels = 0;
  const operationSafe = (operation, configuration) => {
    const contract = operation.contract || {};
    const resolvedRoi = typeof resolveRoi === "function"
      ? resolveRoi(operation, configuration)
      : null;
    const roi = resolvedRoi || contract.roi || {};
    const allocation = contract.allocation || {};
    return roi.mode !== VISUAL_ROI_MODES.FULL_FRAME
      && roi.pixelEquivalentToFullFrame === true
      && allocation.mode !== VISUAL_ALLOCATION_MODES.FULL_FRAME;
  };
  const visit = (operations = [], parentEnabled = true) => {
    for (const operation of operations) {
      const configuration = authoredConfiguration.get(String(operation.id || ""))
        || operation.configuration
        || {};
      const enabled = parentEnabled && configuration.enabled !== false;
      if (!enabled) continue;
      const compound = operation.opcode === VISUAL_RENDER_OPCODES.GROUP
        && operation.operations?.length;
      if (!compound) {
        activeKernels++;
        if (!operationSafe(operation, configuration)) return false;
      }
      if (operation.operations?.length && !visit(operation.operations, enabled)) return false;
    }
    return true;
  };
  return visit(plan.operations || []) && activeKernels > 0;
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
    const componentPrograms = new Set();
    const generators = new Set();
    const effects = new Set();
    const references = [];
    let camera = false;
    const screenInputs = new Set();
    const invalidations = [];
    if ((this.plan.controlProgram?.steps || []).some(controlStepIsFrameDynamic)) {
      invalidations.push(frameRenderInvalidation(null, "control-program"));
    }
    for (const record of records) {
      const configuration = record.operation.configuration || {};
      const source = configuration.source || {};
      // Program reachability is structural, not a visibility state. Retaining
      // the referenced program while an operation is disabled makes live
      // visibility changes allocation-stable and prevents a visible operation
      // from observing a pruned executable closure.
      if (source.type === "component" && source.componentId) {
        componentPrograms.add(String(source.componentId));
      }
      collectParameterReferences(
        source.params,
        record.id,
        new Set(),
        componentPrograms,
        [],
      );
      if (configuration.enabled === false) continue;
      if (record.operation.opcode === VISUAL_RENDER_OPCODES.EFFECT) {
        if (configuration.componentId) effects.add(String(configuration.componentId));
      }
      if (source.type === "component" && source.componentId) {
        components.add(String(source.componentId));
        references.push(reference("component", source.componentId, record.id, "source.componentId"));
      } else if (source.type === "generator") {
        generators.add(String(source.generatorId || ""));
      }
      const typedResources = collectValueResourceReferences(
        record.operation,
        source.params,
        record.id,
        media,
        references,
      );
      if (typedResources.camera) camera = true;
      for (const inputId of typedResources.screenInputs) screenInputs.add(inputId);
      collectParameterReferences(
        source.params,
        record.id,
        media,
        components,
        references,
        "source.params",
        typedResources.handledPaths,
      );
      invalidations.push(operationRenderInvalidation(record.operation));
    }
    const invalidation = mergeRenderInvalidations(invalidations);
    const dynamic = invalidation.mode === "frame";
    const valuePrograms = records.flatMap(({ operation, path }) => {
      const inspection = operation.valueProgram?.inspect?.();
      return inspection ? [Object.freeze({
        operationId: operation.id,
        path,
        ...inspection,
      })] : [];
    });
    const controlPrograms = [
      {
        operationId: this.plan.id || "root",
        path: "",
        program: this.plan.controlProgram,
      },
      ...records.map(({ operation, path }) => ({
        operationId: operation.id,
        path,
        program: operation.controlProgram,
      })),
    ].flatMap(({ operationId, path, program }) => {
      const inspection = program?.inspect?.();
      return inspection?.steps?.length ? [Object.freeze({
        operationId,
        path,
        ...inspection,
      })] : [];
    });
    const externalValueRequirements = valuePrograms.flatMap((program) =>
      (program.externalResolvers || []).map((resolver) => Object.freeze({
        kind: "capability",
        id: resolver.capability,
        lifecycle: resolver.lifecycle,
        asynchronous: true,
      })));
    const controlSignalRequirements = uniqueControlSignalRequirements(
      controlPrograms.flatMap((program) => program.requirements || []),
    );
    for (const requirement of controlSignalRequirements) {
      references.push(reference(
        "control-signal",
        requirement.endpoint
          ? `${requirement.signalKind}:${requirement.endpoint}:${requirement.address}`
          : `${requirement.signalKind}:${requirement.address}`,
        this.plan.id,
        "controlProgram",
      ));
    }
    return Object.freeze({
      format: this.format,
      executionModel: this.plan.executionModel,
      compilerPasses: this.plan.compilerPasses,
      dependencies: Object.freeze({
        components: Object.freeze([...components].sort()),
        componentPrograms: Object.freeze([...componentPrograms].sort()),
      }),
      mediaDemand: Object.freeze({
        ids: Object.freeze([...media].sort()),
        camera,
        screenInputs: Object.freeze([...screenInputs].sort()),
      }),
      readiness: Object.freeze({
        requirements: Object.freeze([
          ...[...media].sort().map((id) => Object.freeze({ kind: "media", id })),
          ...(camera ? [Object.freeze({ kind: "camera", id: "default" })] : []),
          ...[...screenInputs].sort().map((id) =>
            Object.freeze({ kind: "screen-input", id })),
          ...externalValueRequirements,
          ...controlSignalRequirements,
        ]),
      }),
      dynamics: Object.freeze({
        frameDependent: dynamic,
        hasControlProgram: (this.plan.controlProgram?.steps || []).length > 0,
        hasValueProgram: records.some(({ operation }) => (operation.valueProgram?.steps || []).length > 0),
        invalidation: Object.freeze({
          mode: invalidation.mode,
          reasons: invalidation.reasons,
          mediaRevisionDependent: media.size > 0,
          componentRevisionDependent: components.size > 0,
        }),
      }),
      references: Object.freeze(references),
      valuePrograms: Object.freeze(valuePrograms),
      controlPrograms: Object.freeze(controlPrograms),
      editableItems: Object.freeze(records.map(({ operation, path }) => Object.freeze({
        id: operation.id,
        nodeId: operation.nodeId,
        path,
        opcode: operation.opcode,
        backend: operation.backend,
        activation: operation.opcode === VISUAL_RENDER_OPCODES.GROUP ? "recompile" : "live",
      }))),
      operations: Object.freeze(records.map(({ operation, path }) => Object.freeze({
        id: operation.id,
        path,
        opcode: operation.opcode,
        backend: operation.backend,
        renderer: operation.renderer || "",
        enabled: operation.configuration?.enabled !== false,
        contract: operation.contract,
        directPlacement: operation.directPlacement || null,
        renderProcessContext: operation.nodeProcessContextFormat || "",
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
        : null);
    if (!configuration) throw new Error(`VISUAL_RENDER_CONFIGURATION_MISSING:${path}:${node.id}`);
    const compiled = hooks.compile(effectiveNode, {
      configuration,
      definition,
      nativeModuleDefinitions: nativeValueDefinitionsForOperation(
        node.id,
        nodes,
        connections,
        resolveDefinition,
      ),
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
    const compositionInput = compositionInputBinding(node.id, connections);
    if (compilerHook?.id === VISUAL_COMPILER_HOOKS.TEXTURE_OPERATOR) {
      validateTextureOperatorInputs(node, definition, textureInputs, path);
    }
    const mediaDependencies = compiledOperationMediaDependencies(
      compiled,
      configuration,
      node.id,
    );
    return Object.freeze({
      ...compiled,
      textureInputs: Object.freeze(textureInputs),
      textureInputPorts: Object.freeze(Object.keys(textureInputs)),
      compositionInput,
      mediaDependencies,
      // Runtime values are written into this retained map by the optimized
      // texture-DAG executor. Graph topology never becomes per-frame packets.
      runtimeInputStates: new Map(),
      runtimeValueInputs: new Map(),
      runtimeValueIdentityInputs: new Map(),
      // Host-resolved asynchronous values publish their revision into this
      // retained map before the consuming render operation is evaluated.
      // The map keeps capability resolution out of source-specific code and
      // avoids rebuilding graph packets in the frame loop.
      runtimeExternalRevisionInputs: new Map(),
    });
  });
}

function compiledOperationMediaDependencies(
  operation = {},
  configuration = {},
  operationId = "",
) {
  const media = new Set();
  const components = new Set();
  const references = [];
  const params = configuration?.source?.params || {};
  const typedResources = collectValueResourceReferences(
    operation,
    params,
    operationId,
    media,
    references,
  );
  collectParameterReferences(
    params,
    operationId,
    media,
    components,
    references,
    "source.params",
    typedResources.handledPaths,
  );
  return Object.freeze([...media].sort());
}

// Some retained GPU passes must continue on the exact framebuffer produced by
// their input so color and depth attachments remain authoritative. Lower that
// relationship explicitly instead of hiding it inside a monolithic renderer.
// The destructive alias is only legal for a linear, private edge.
function compileFramebufferPassSequences(
  operations = [],
  selectedOutputs = [],
  path = "",
) {
  const byId = new Map(operations.map((operation) => [operation.id, operation]));
  const consumers = new Map();
  for (const operation of operations) {
    for (const sourceValueId of Object.values(operation.textureInputs || {})) {
      if (!sourceValueId || isExternalTextureSource(sourceValueId)) continue;
      const sourceId = endpointNode(sourceValueId);
      const list = consumers.get(sourceId) || [];
      list.push(operation.id);
      consumers.set(sourceId, list);
    }
  }
  const publicOutputNodes = new Set(
    selectedOutputs.map((output) => endpointNode(output.endpoint)),
  );
  const sequenceByOperation = new Map();
  const preserveBySequence = new Map();
  for (const continuation of operations) {
    const declaration = continuation.framebufferPass;
    if (!declaration) continue;
    const inputPort = String(declaration.input || "");
    const sourceValueId = continuation.textureInputs?.[inputPort];
    const sourceId = endpointNode(sourceValueId);
    const source = byId.get(sourceId);
    if (!inputPort || !sourceValueId) {
      throw new Error(
        `VISUAL_FRAMEBUFFER_PASS_INPUT_REQUIRED:${path}:${continuation.id}:${inputPort || "missing"}`,
      );
    }
    if (!source) {
      throw new Error(
        `VISUAL_FRAMEBUFFER_PASS_SOURCE_MISSING:${path}:${continuation.id}:${sourceId || "missing"}`,
      );
    }
    if (
      (consumers.get(sourceId) || []).length !== 1 ||
      publicOutputNodes.has(sourceId)
    ) {
      throw new Error(
        `VISUAL_FRAMEBUFFER_PASS_ALIAS_UNSAFE:${path}:${sourceId}`,
      );
    }
    if (
      source.opcode !== VISUAL_RENDER_OPCODES.SOURCE ||
      continuation.opcode !== VISUAL_RENDER_OPCODES.SOURCE
    ) {
      throw new Error(
        `VISUAL_FRAMEBUFFER_PASS_SOURCE_UNSUPPORTED:${path}:${sourceId}:${continuation.id}`,
      );
    }
    const inherited = sequenceByOperation.get(sourceId);
    const sequenceId =
      inherited?.sequenceId ||
      `${path}/framebuffer-pass/${sourceId}`;
    if (!inherited) {
      sequenceByOperation.set(sourceId, {
        sequenceId,
        phase: "begin",
      });
    }
    sequenceByOperation.set(continuation.id, {
      sequenceId,
      phase: "continue",
      inputPort,
    });
    const preserve = preserveBySequence.get(sequenceId) || new Set();
    for (const attachment of (
      Array.isArray(declaration.preserve)
        ? declaration.preserve
        : ["color", "depth"]
    )) {
      preserve.add(String(attachment));
    }
    preserveBySequence.set(sequenceId, preserve);
  }
  return operations.map((operation) => {
    const framebufferSequence = sequenceByOperation.get(operation.id);
    const preserve = framebufferSequence
      ? preserveBySequence.get(framebufferSequence.sequenceId)
      : null;
    return framebufferSequence
      ? Object.freeze({
          ...operation,
          framebufferSequence: Object.freeze({
            ...framebufferSequence,
            preserve: Object.freeze(
              preserve?.size
                ? [...preserve]
                : ["color", "depth"],
            ),
          }),
        })
      : operation;
  });
}

function nativeValueDefinitionsForOperation(
  operationId,
  nodes,
  connections,
  resolveDefinition,
) {
  if (typeof resolveDefinition !== "function") return [];
  const byId = new Map((nodes || []).map((node) => [String(node.id || ""), node]));
  const incoming = new Map();
  for (const edge of connections || []) {
    if (
      edge.type === "texture" ||
      isTextureEndpoint(edge.from) ||
      isTextureEndpoint(edge.to) ||
      String(edge.to || "").includes(".$parameter.")
    ) continue;
    const source = endpointNode(edge.from);
    const target = endpointNode(edge.to);
    if (!source || !target || !byId.has(source) || !byId.has(target)) continue;
    const list = incoming.get(target) || [];
    list.push(source);
    incoming.set(target, list);
  }
  const ordered = [];
  const visited = new Set();
  const visit = (id) => {
    for (const sourceId of incoming.get(id) || []) {
      if (visited.has(sourceId)) continue;
      visited.add(sourceId);
      visit(sourceId);
      const node = byId.get(sourceId);
      if (node?.role !== "value") continue;
      const definition = resolveDefinition(node);
      if (definition) ordered.push(definition);
    }
  };
  visit(String(operationId || ""));
  return ordered;
}

function orderedRenderNodes(nodes, connections, path, diagnostics) {
  const renderNodes = (nodes || []).filter((node) => node.role !== "control" && node.role !== "value");
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
  // Only an authored Layer Group projects child elements back into the
  // Component/Scene chain. Compiled visual compounds are one public node:
  // their child operations are an editable implementation graph, not legacy
  // chain items. Exposing those private operations here made the compatibility
  // projection differ from its sanitized authored form, so a later edit could
  // be rejected as a conflicting graph change.
  if (
    operation.opcode !== VISUAL_RENDER_OPCODES.GROUP ||
    operation.backend !== "layer-group"
  ) {
    return operation.configuration;
  }
  return {
    ...operation.configuration,
    chain: (operation.operations || [])
      .filter((child) => !child.configuration?.auxiliaryFor)
      .map(operationConfiguration),
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

function cloneCompoundConfiguration(value, seen = new Map()) {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  if (Array.isArray(value)) {
    const clone = [];
    seen.set(value, clone);
    for (const item of value) clone.push(cloneCompoundConfiguration(item, seen));
    return clone;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const clone = {};
  seen.set(value, clone);
  for (const [key, item] of Object.entries(value)) {
    clone[key] = cloneCompoundConfiguration(item, seen);
  }
  return clone;
}

function normalizeOperationContract(operation, diagnostics) {
  let contract = defineVisualNodeContract(operation.contract || {});
  const nested = operation.opcode === VISUAL_RENDER_OPCODES.GROUP
    ? compileVisualContractPasses(operation.operations || [], diagnostics)
    : operation.operations;
  if (operation.opcode === VISUAL_RENDER_OPCODES.GROUP && nested?.length) {
    const nestedDemand = nested.reduce(
      (demand, child) =>
        mergeRoiDemand(demand, child.lowering?.inputDemand),
      null,
    );
    const declaredDemand = {
      mode: contract.roi.mode,
      halo: contract.roi.halo,
      coordinateSpace: contract.roi.coordinateSpace,
      mapping: contract.roi.inputMapping,
    };
    const compoundDemand = mergeRoiDemand(
      declaredDemand,
      nestedDemand,
    );
    contract = defineVisualNodeContract({
      ...contract,
      roi: {
        mode: compoundDemand.mode,
        halo: compoundDemand.halo,
        coordinateSpace: compoundDemand.coordinateSpace,
        inputMapping:
          compoundDemand.mapping || contract.roi.inputMapping,
        pixelEquivalentToFullFrame: true,
      },
      allocation: {
        mode:
          compoundDemand.mode === VISUAL_ROI_MODES.FULL_FRAME
            ? VISUAL_ALLOCATION_MODES.FULL_FRAME
            : contract.allocation.mode,
      },
    });
  }
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
  if (!incoming) return current;
  if (current.mode === VISUAL_ROI_MODES.FULL_FRAME || incoming.mode === VISUAL_ROI_MODES.FULL_FRAME) {
    return Object.freeze({
      mode: VISUAL_ROI_MODES.FULL_FRAME,
      halo: 0,
      coordinateSpace: VISUAL_COORDINATE_SPACES.FULL_FRAME,
      mapping:
        current.mode === VISUAL_ROI_MODES.FULL_FRAME
          ? current.mapping
          : incoming.mapping,
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
    mapping:
      incoming.mapping ||
      current.mapping,
  });
}

function replaceOperationConfiguration(operations, itemId, nextConfiguration) {
  let changed = false;
  const next = operations.map((operation) => {
    if (operation.id === itemId) {
      changed = true;
      const updated = Object.freeze({
        ...operation,
        configuration: nextConfiguration,
        // One semantic visual item owns one authored-configuration epoch.
        // Compiled compounds project public parameters into private child
        // operations, whose typed values may otherwise retain the same
        // identity. Advancing the outer epoch gives every backend the same
        // dirty contract without renderer-specific invalidation hooks.
        configurationRevision:
          Math.max(0, Number(operation.configurationRevision) || 0) + 1,
      });
      synchronizeCompoundPublicParameters(updated);
      return updated;
    }
    if (operation.opcode !== VISUAL_RENDER_OPCODES.GROUP || !operation.operations?.length) return operation;
    const nested = replaceOperationConfiguration(operation.operations, itemId, nextConfiguration);
    if (!nested.changed) return operation;
    changed = true;
    return Object.freeze({
      ...operation,
      operations: Object.freeze(nested.operations),
      // A public Layer Group is also a semantic cache boundary. Propagate a
      // descendant edit through that boundary while leaving sibling groups
      // and Components untouched.
      configurationRevision:
        Math.max(0, Number(operation.configurationRevision) || 0) + 1,
    });
  });
  return { changed, operations: changed ? next : operations };
}

function compileCompoundPublicParameterBindings(definition, operations, controlProgram, valueProgram, path) {
  const projection = definition?.metadata?.controlProjection;
  if (projection?.format !== "vj1.control-projection@1") return Object.freeze([]);
  const operationById = new Map((operations || []).map((item) => [String(item.id || ""), item]));
  const controlStepById = new Map((controlProgram?.steps || []).map((step) => [
    String(step.instanceId || ""),
    step,
  ]));
  const valueStepById = new Map((valueProgram?.steps || []).map((step) => [
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
        const controlStep = controlStepById.get(String(binding.nodeId || ""))
          || valueStepById.get(String(binding.nodeId || ""));
        const targetParameterId = String(binding.parameterId || parameterId);
        if (!target && !controlStep) {
          throw new Error(`VISUAL_COMPOUND_PUBLIC_TARGET_MISSING:${path}:${binding.nodeId || "missing"}`);
        }
        const controlParameter =
          controlStep &&
          Object.hasOwn(controlStep.parameters || {}, targetParameterId);
        const controlInput =
          controlStep &&
          !controlParameter &&
          Object.hasOwn(controlStep.inlets || {}, targetParameterId);
        if (controlInput && (controlStep.inputs || []).some(
          (input) => input.targetPortId === targetParameterId
        )) {
          throw new Error(
            `VISUAL_COMPOUND_PUBLIC_CONTROL_INLET_CONNECTED:${path}:` +
            `${binding.nodeId || "missing"}.${targetParameterId || "missing"}`
          );
        }
        if (controlStep && !controlParameter && !controlInput) {
          if (compoundProviderAlternativeAllowsDifferentParameters(
            definition,
            binding.nodeId,
            controlStep.nodeId,
          )) {
            continue;
          }
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
              ...(controlInput ? { controlInput: true } : {}),
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

function compoundProviderAlternativeAllowsDifferentParameters(definition, instanceId, nodeId) {
  return (definition?.metadata?.providerAlternatives?.[String(instanceId || "")]
    || definition?.metadata?.nativeCompound?.providerAlternatives?.[String(instanceId || "")]
    || []).some((alternative) => String(alternative?.nodeId || "") === String(nodeId || ""));
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
    try {
      operation.nodeProcessDispose?.({
        state: operation.nodeProcessState,
        output: operation.nodeProcessOutput,
      });
    } catch {}
    if (operation.nodeProcessState) {
      for (const key of Object.keys(operation.nodeProcessState)) {
        delete operation.nodeProcessState[key];
      }
    }
    if (operation.nodeProcessOutput) {
      for (const key of Object.keys(operation.nodeProcessOutput)) {
        delete operation.nodeProcessOutput[key];
      }
    }
    operation.valueProgram?.dispose?.();
    operation.runtimeStates?.clear?.();
    operation.runtimeInputStates?.clear?.();
    operation.runtimeValueInputs?.clear?.();
    operation.runtimeValueIdentityInputs?.clear?.();
    operation.runtimeExternalRevisionInputs?.clear?.();
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
  const invalidations = [];
  if ((operation.controlProgram?.steps || []).some(controlStepIsFrameDynamic)) {
    invalidations.push(
      frameRenderInvalidation(null, "compound-control-program"),
    );
  }
  const valueSteps = operation.valueProgram?.steps || [];
  if (valueSteps.some((step) => step.frameDynamic === true)) {
    invalidations.push(
      frameRenderInvalidation(null, "compound-value-program"),
    );
  } else if (valueSteps.length) {
    invalidations.push(
      revisionRenderInvalidation(null, "compound-value-program"),
    );
  }
  if (source.type === "component") {
    invalidations.push(
      revisionRenderInvalidation(
        source.componentId || null,
        "component-revision",
      ),
    );
  }
  if (operation.renderInvalidation?.mode === "frame") {
    invalidations.push(
      frameRenderInvalidation(
        operation.renderInvalidation.key ?? null,
        operation.renderInvalidation.reason || "declared-frame",
      ),
    );
  } else if (operation.renderInvalidation?.mode === "revision") {
    invalidations.push(
      revisionRenderInvalidation(
        operation.renderInvalidation.key ?? null,
        operation.renderInvalidation.reason || "declared-revision",
      ),
    );
  }
  invalidations.push(
    runtimePolicyRenderInvalidation(
      operation.runtimePolicy,
      source.params || configuration.params || {},
    ),
  );
  if (operation.opcode === VISUAL_RENDER_OPCODES.FEEDBACK || operation.opcode === VISUAL_RENDER_OPCODES.DELAY) {
    invalidations.push(
      frameRenderInvalidation(null, "retained-feedback"),
    );
  }
  return mergeRenderInvalidations(
    ...invalidations,
    stableRenderInvalidation("operation-stable"),
  );
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

function collectParameterReferences(
  params,
  operationId,
  media,
  components,
  references,
  path = "source.params",
  ignoredPaths = null,
) {
  visitVisualParameterReferences(params, ({ kind, id, path: referencePath }) => {
    if (ignoredPaths?.has(referencePath)) return;
    if (kind === "component") {
      components.add(id);
      references.push(reference("component", id, operationId, referencePath));
    } else if (kind === "media") {
      media.add(id);
      references.push(reference("media", id, operationId, referencePath));
    }
  }, path);
}

function collectValueResourceReferences(operation, params, operationId, media, references) {
  const handledPaths = new Set();
  const screenInputs = new Set();
  let camera = false;
  for (const step of operation?.valueProgram?.steps || []) {
    for (const dependency of step.resourceDependencies || []) {
      if (dependency.kind === "camera") {
        const id = String(dependency.id || "default");
        camera = true;
        references.push(reference(
          "camera",
          id,
          operationId,
          `values.${step.instanceId}`,
        ));
        continue;
      }
      const publicBinding = (operation.publicParameterBindings || []).find((binding) =>
        binding.controlStep === step &&
        binding.targetParameterId === dependency.parameterId
      );
      const publicParameterId = publicBinding?.parameterId || "";
      const id = String(publicParameterId
        ? params?.[publicParameterId] || ""
        : step.parameters?.[dependency.parameterId] || "");
      if (!id) continue;
      const path = publicParameterId
        ? `source.params.${publicParameterId}`
        : `values.${step.instanceId}.${dependency.parameterId}`;
      handledPaths.add(path);
      if (dependency.kind === "screen-input") {
        screenInputs.add(id);
        references.push(reference(
          "screen-input",
          id,
          operationId,
          path,
        ));
        continue;
      }
      if (dependency.kind !== "media") continue;
      media.add(id);
      references.push(reference(
        dependency.valueType === "mesh" ? "media-mesh" : "media",
        id,
        operationId,
        path,
      ));
    }
  }
  return Object.freeze({
    handledPaths,
    camera,
    screenInputs: Object.freeze([...screenInputs]),
  });
}

function reference(kind, id, operationId, path) {
  return Object.freeze({
    kind,
    id: String(id || ""),
    operationId: String(operationId || ""),
    path: String(path || ""),
  });
}

function uniqueControlSignalRequirements(requirements = []) {
  const unique = new Map();
  for (const requirement of requirements) {
    const signalKind = String(requirement?.signalKind || "");
    const address = String(requirement?.address || "");
    const endpoint = String(requirement?.endpoint || "");
    if (!signalKind || !address) continue;
    const key = endpoint
      ? `${signalKind}:${endpoint}:${address}`
      : `${signalKind}:${address}`;
    if (!unique.has(key)) {
      unique.set(key, Object.freeze({
        kind: "control-signal",
        signalKind,
        address,
        ...(endpoint ? { endpoint } : {}),
        required: requirement.required === true,
      }));
    }
  }
  return Object.freeze([...unique.values()].sort((left, right) =>
    `${left.signalKind}:${left.endpoint || ""}:${left.address}`.localeCompare(
      `${right.signalKind}:${right.endpoint || ""}:${right.address}`,
    )));
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
      edge.semantic === "composition" ||
      !(edge.type === "texture" || isTextureEndpoint(edge.from) || isTextureEndpoint(edge.to))
    ) continue;
    const sourceNodeId = endpointNode(edge.from);
    result[endpointPort(edge.to) || "texture"] = sourceNodeId === "$in"
      ? `$in.${endpointPort(edge.from) || "texture"}`
      : visualTextureValueReference(edge.from);
  }
  return result;
}

function compositionInputBinding(nodeId, connections) {
  const edge = (connections || []).find((candidate) =>
    endpointNode(candidate.to) === String(nodeId || "") &&
    candidate.semantic === "composition" &&
    (candidate.type === "texture" ||
      isTextureEndpoint(candidate.from) ||
      isTextureEndpoint(candidate.to))
  );
  if (!edge) return "";
  return endpointNode(edge.from) === "$in"
    ? `$in.${endpointPort(edge.from) || "texture"}`
    : visualTextureValueReference(edge.from);
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
      const parameterBinding = String(endpoint || "").includes(".$parameter.");
      if (parameterBinding) continue;
      throw new Error(
        `VISUAL_COMPOUND_PUBLIC_VALUE_INPUT_UNSUPPORTED:${path}:${publicId}:${inlet.type?.type || "unknown"}`,
      );
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
    // A source with an authored texture inlet is a render operation over that
    // named input, not an ordinary source-over chain layer. Execute it through
    // the compiled texture DAG so the exact input port is bound. This is what
    // lets independently reusable retained kernels (for example fill -> wire)
    // replace a former parent-owned native composite without changing their
    // semantics or introducing generic frame-loop graph traversal.
    if (operation.opcode === VISUAL_RENDER_OPCODES.SOURCE && inputs.length) {
      return "texture-dag";
    }
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

function visualNativeModuleFields(definition = {}, nativeModuleDefinitions = []) {
  // nodeOwnedNativeProcess predates the richer native-module contract. Keep
  // accepting it so custom/project nodes do not need a package migration just
  // to retain their allocation-stable direct render path.
  if (
    !definition?.metadata?.nodeOwnedNativeModule &&
    !definition?.metadata?.nodeOwnedNativeProcess &&
    !nativeModuleDefinitions?.length
  ) return {};
  const effectiveDefinition = combinedNativeModuleDefinition(definition, nativeModuleDefinitions);
  const revision = visualNodeModuleRevision(effectiveDefinition);
  const shaders = {};
  const shaderPrograms = new Map();
  for (const part of (effectiveDefinition.parts || []).filter((item) => item.kind === "shader" && item.stage)) {
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
  validateVisualNativeArtifactRequirements(
    definition,
    nativeModuleDefinitions,
    effectiveDefinition.moduleExports || {},
    shaders,
  );
  return {
    nodeModule: effectiveDefinition.moduleExports || {},
    nodeShaders: Object.freeze(shaders),
    nodeModuleId: `${definition.id}@${definition.version}`,
    nodeModuleRevision: revision,
    nodeCodeRevision: visualNodePartRevision(effectiveDefinition, new Set(["javascript"])),
    nodeShaderRevision: visualNodePartRevision(effectiveDefinition, new Set(["shader"])),
    nodeShaderProgramRevisions: Object.freeze(Object.fromEntries(
      [...shaderPrograms].map(([program, sources]) => [program, visualSourceRevision(sources.join("\u0001"))])
    )),
    nodeProcessContextFormat: String(
      definition.metadata?.renderProcessContext || "",
    ),
    ...(definition.metadata.nodeOwnedNativeProcess && typeof definition.process === "function"
      ? {
          nodeProcess: definition.process,
          nodeProcessId: `${definition.id}@${definition.version}`,
          nodeProcessRevision: revision,
          nodeProcessState: {},
          nodeProcessOutput: {},
          nodeProcessDispose:
            typeof definition.execution?.dispose === "function"
              ? definition.execution.dispose
              : null,
        }
      : {}),
  };
}

function validateVisualNativeArtifactRequirements(
  ownerDefinition,
  nativeModuleDefinitions,
  moduleExports,
  shaders,
) {
  const definitions = [ownerDefinition, ...(nativeModuleDefinitions || [])];
  for (const definition of definitions) {
    const requirements = definition?.metadata?.nativeArtifactRequirements;
    if (!requirements) continue;
    for (const id of requirements.moduleExports || []) {
      if (typeof moduleExports[id] === "function") continue;
      throw new Error(
        `VISUAL_NATIVE_MODULE_EXPORT_REQUIRED:${ownerDefinition?.id || "unknown"}:${definition.id}:${id}`,
      );
    }
    for (const id of requirements.shaders || []) {
      if (typeof shaders[id] === "string" && shaders[id].trim()) continue;
      throw new Error(
        `VISUAL_NATIVE_SHADER_REQUIRED:${ownerDefinition?.id || "unknown"}:${definition.id}:${id}`,
      );
    }
  }
}

function combinedNativeModuleDefinition(definition, nativeModuleDefinitions) {
  if (!nativeModuleDefinitions?.length) return definition;
  const parts = new Map((definition.parts || []).map((part) => [part.id, part]));
  const moduleExports = { ...(definition.moduleExports || {}) };
  for (const contribution of nativeModuleDefinitions) {
    for (const part of contribution?.parts || []) parts.set(part.id, part);
    Object.assign(moduleExports, contribution?.moduleExports || {});
  }
  return {
    ...definition,
    parts: [...parts.values()],
    moduleExports,
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
