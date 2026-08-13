import { ComponentProgramNode } from "../component-program/index.js";
import { LayerGroupNode } from "../layer-group/index.js";
import { VisualSourceNode, visualSourceRenderer } from "../visual-source/index.js";
import {
  canonicalizeAuthoredVisualChain,
  canonicalizeAuthoredVisualSource,
} from "./authored-visual-source.js";
import { defineNodeCompiler, NodeCompilerRegistry, NODE_COMPILER_TARGETS } from "../../node-engine/index.js";
import {
  defineVisualNodeContract,
  visualNodeContractFromMetadata,
  VISUAL_TRANSFORM_DOMAINS,
} from "../../render-engine/visual-node-contract.js";
import {
  compileVisualRenderPlan,
  visualRenderPlanConfiguration,
  visualRenderPlanRegionSafe,
  VISUAL_COMPILER_HOOKS,
} from "./visual-render-plan.js";
import {
  inheritAuthoredControlTopology,
  initializeDefaultParameterAnimations,
} from "./parameter-animation-tracks.js";

export const COMPONENT_PROGRAM_GENERATOR = "vj1-component-compiler";
export const COMPONENT_VISUAL_COMPILER_ID = "vj1.visual.component-program";

const componentVisualCompiler = defineNodeCompiler({
  id: COMPONENT_VISUAL_COMPILER_ID,
  target: NODE_COMPILER_TARGETS.VISUAL,
  accepts: (group) => group?.generatedBy === COMPONENT_PROGRAM_GENERATOR,
  compile: (group, { component, resolveNodeDefinition }) => new CompiledComponentRenderProgram(group, component, {
    resolveNodeDefinition,
  }),
});

const componentCompilerRegistry = new NodeCompilerRegistry([componentVisualCompiler]);

export function componentProgramGroupId(componentId) {
  return `vj1.component.${String(componentId || "missing")}`;
}

export function compileComponentGroupTopology(component = {}, {
  definitions = new Map(),
  initializeDefaultAnimations = true,
} = {}) {
  const nodes = compileChainNodes(component.chain || [], `components.${component.id}.chain`, definitions);
  const projectionSignature = componentChainSignature(component.chain || []);
  const group = {
    id: componentProgramGroupId(component.id),
    nodeId: ComponentProgramNode.id,
    nodeVersion: ComponentProgramNode.version,
    componentId: String(component.id || ""),
    artifactType: component.type === "scene" ? "scene" : "component",
    name: component.name || (component.type === "scene" ? "Scene" : "Component"),
    nodes,
    connections: linearConnections(nodes, definitions),
    publicInlets: {},
    publicOutlets: { texture: nodes.length ? `${nodes[nodes.length - 1].id}.texture` : "$in.texture" },
    compiler: {
      id: COMPONENT_VISUAL_COMPILER_ID,
      target: NODE_COMPILER_TARGETS.VISUAL,
      strategy: "allocation-stable-direct-render-program",
    },
    projectionSignature,
    generatedBy: COMPONENT_PROGRAM_GENERATOR,
  };
  return initializeDefaultAnimations
    ? initializeDefaultParameterAnimations(group, { definitions })
    : group;
}

// Product editors insert one semantic visual element at a time. Expose the
// same topology lowering used by initial project migration so graph commands
// never have to mutate `component.chain` and wait for a later reconciliation
// pass to discover the intended node bundle.
export function compileComponentGraphItemTopology(item = {}, {
  definitions = new Map(),
  statePath = "component-graph",
} = {}) {
  const nodes = compileChainNodes([item], statePath, definitions);
  return Object.freeze({
    nodes,
    connections: linearConnections(nodes, definitions),
  });
}

// Reordering the abstract layer projection changes only the composition spine.
// Keep authored animation/control/auxiliary edges intact and rebuild the
// ordered texture edges from the graph nodes that now occupy the scope.
export function reconcileComponentCompositionConnections(
  nodes = [],
  connections = [],
  definitions = new Map(),
) {
  const renderIds = new Set(nodes
    .filter((node) => isComponentRenderNode(node))
    .map((node) => String(node.id || "")));
  const retained = (connections || []).filter((edge) =>
    !isCompositionSpineConnection(edge, renderIds)
  );
  const spine = linearConnections(nodes, definitions)
    .filter((edge) => isCompositionSpineConnection(edge, renderIds))
    .map((edge) => ({ ...edge, semantic: "composition" }));
  return [...retained, ...spine];
}

function isComponentRenderNode(node = {}) {
  return ["source", "effect", "group"].includes(node.role) && !node.auxiliaryFor;
}

function isCompositionSpineConnection(edge = {}, renderIds = new Set()) {
  if (edge.semantic === "composition") return true;
  const from = String(edge.from || "");
  const to = String(edge.to || "");
  if (to === "$out.texture") return renderIds.has(endpointNodeId(from));
  if (edge.semantic) return false;
  const target = endpointNodeId(to);
  if (!renderIds.has(target)) return false;
  const source = endpointNodeId(from);
  return source === "$in" || renderIds.has(source);
}

function endpointNodeId(endpoint = "") {
  const value = String(endpoint || "");
  return value.startsWith("$in.") || value === "$in" ? "$in" : value.split(".")[0];
}

export function reconcileComponentGroupTopology(component = {}, existingGroup = null, options = {}) {
  if (existingGroup?.compactTopology === true) {
    existingGroup = hydrateCompactComponentGroup(existingGroup, options.definitions || new Map());
  }
  if (existingGroup?.generatedBy === COMPONENT_PROGRAM_GENERATOR) {
    existingGroup = initializeDefaultParameterAnimations(existingGroup, {
      definitions: options.definitions || new Map(),
    });
  }
  if (!existingGroup || existingGroup.generatedBy !== COMPONENT_PROGRAM_GENERATOR) {
    const group = compileComponentGroupTopology(component, options);
    return {
      component: withoutLegacyChain(component, group.projectionSignature),
      group,
      source: "component-import",
    };
  }

  const storedSignature = String(existingGroup.projectionSignature || "");
  if (!storedSignature) {
    const group = inheritAuthoredControlTopology(
      inheritGroupNodeLayout(compileComponentGroupTopology(component, {
        ...options,
        initializeDefaultAnimations: false,
      }), existingGroup),
      existingGroup,
    );
    return {
      component: withoutLegacyChain(component, group.projectionSignature),
      group,
      source: "legacy-component-import",
    };
  }
  const graphChain = componentChainFromGroup(existingGroup, options);
  const graphSignature = componentChainSignature(graphChain);
  const componentSignature = componentChainSignature(component.chain || []);
  const projectionMarker = String(component.nodeProjectionSignature || "");
  const compatibilityEdit = Array.isArray(component.chain)
    && projectionMarker
    && projectionMarker === storedSignature
    && graphSignature === storedSignature
    && componentSignature !== projectionMarker;

  if (compatibilityEdit) {
    const group = inheritAuthoredControlTopology(
      inheritGroupNodeLayout(compileComponentGroupTopology(component, {
        ...options,
        initializeDefaultAnimations: false,
      }), existingGroup),
      existingGroup,
    );
    return {
      component: withoutLegacyChain(component, group.projectionSignature),
      group,
      source: "component-projection-edit",
    };
  }

  // Persisted graph configuration wins on load and after graph edits. A
  // legacy Component chain is consumed only while importing old project data;
  // never republish it beside the graph as a second in-memory authority.
  const definitions = options.definitions || new Map();
  const nodes = annotateComponentCompositionTopology(
    refreshVisualCompilerHooks(existingGroup.nodes || [], definitions),
    definitions,
  );
  const group = {
    ...existingGroup,
    componentId: String(component.id || ""),
    artifactType: component.type === "scene" ? "scene" : "component",
    name: component.name || (component.type === "scene" ? "Scene" : "Component"),
    nodes,
    connections: markCompositionConnections(existingGroup.connections || [], nodes, definitions),
    projectionSignature: graphSignature,
  };
  return {
    component: withoutLegacyChain(component, graphSignature),
    group,
    source: graphSignature === storedSignature ? "node-graph" : "node-graph-edit",
  };
}

function hydrateCompactComponentGroup(group, definitions) {
  const hydrateNodes = (nodes) => (nodes || []).flatMap((node) => {
    const hydrated = node.nodes
      ? {
        ...node,
        nodes: hydrateNodes(node.nodes),
      }
      : { ...node };
    if (hydrated.nodes) hydrated.connections = linearConnections(hydrated.nodes, definitions);
    hydrated.compilerHook = visualCompilerHookFor(hydrated.configuration || { kind: hydrated.role }, definitions.get(hydrated.nodeId));
    return [...parameterControlNodes(hydrated, definitions.get(hydrated.nodeId)), hydrated];
  });
  const nodes = hydrateNodes(group.nodes || []);
  const {
    compactTopology: _compactTopology,
    persistence: _persistence,
    ...canonical
  } = group;
  return {
    ...canonical,
    nodes,
    connections: linearConnections(nodes, definitions),
  };
}

function inheritGroupNodeLayout(group, existingGroup) {
  const inherit = (nodes, existingNodes) => {
    const existingById = new Map((existingNodes || []).map((node) => [node.id, node]));
    return (nodes || []).map((node) => {
      const existing = existingById.get(node.id);
      return {
        ...node,
        ...(existing?.position ? { position: { ...existing.position } } : {}),
        ...(existing?.animationDefaults
          ? { animationDefaults: cloneJson(existing.animationDefaults) }
          : {}),
        ...(node.nodes ? { nodes: inherit(node.nodes, existing?.nodes || []) } : {}),
      };
    });
  };
  return { ...group, nodes: inherit(group.nodes || [], existingGroup?.nodes || []) };
}

export function componentChainFromGroup(group = {}, {
  definitions = new Map(),
  resolveNodeDefinition = null,
} = {}) {
  const resolveDefinition = typeof resolveNodeDefinition === "function"
    ? resolveNodeDefinition
    : (node) => definitions.get(String(node?.nodeId || ""));
  return visualRenderPlanConfiguration(compileVisualRenderPlan(group, {}, { resolveDefinition }));
}

export function componentProgramInstances(group = {}) {
  const result = [];
  collectInstances(group.nodes || [], group.id, result);
  return result;
}

export function compileComponentRenderPrograms(components = [], groups = [], {
  resolveNodeDefinition = null,
  rootComponentIds = null,
} = {}) {
  const groupByComponent = new Map((groups || [])
    .filter((group) => group.generatedBy === COMPONENT_PROGRAM_GENERATOR)
    .map((group) => [group.componentId, group]));
  const componentById = new Map((components || []).map((component) => [String(component.id || ""), component]));
  const compileComponent = (component) => {
    const semanticComponent = { ...component };
    // Old project snapshots are upgraded in memory at the compilation
    // boundary. Rendering therefore always consumes a Component program and
    // never needs a second raw-chain execution path.
    let storedGroup =
      groupByComponent.get(String(component.id || "")) ||
      compileComponentGroupTopology(component);
    storedGroup = canonicalizeStoredVisualSourceNodes(storedGroup);
    const definitions = componentGroupDefinitions(
      storedGroup,
      resolveNodeDefinition,
    );
    if (storedGroup.compactTopology === true) {
      storedGroup = hydrateCompactComponentGroup(
        storedGroup,
        definitions,
      );
    }
    // Generated topology can be created before the visual catalog is
    // available, in which case it carries only a generic source hook. Once
    // definitions are resolved, their executable compiler contracts are
    // authoritative. Refresh them before compilation so compound generators
    // publish their actual child graph, readiness, and invalidation instead
    // of remaining opaque source-runtime wrappers until a later graph edit.
    // Unresolved project/package definitions retain their stored hook.
    const nodes = annotateComponentCompositionTopology(
      refreshVisualCompilerHooks(storedGroup.nodes || [], definitions),
      definitions,
    );
    const group = {
      ...storedGroup,
      nodes,
      connections: markCompositionConnections(storedGroup.connections || [], nodes, definitions),
    };
    return [component.id, componentCompilerRegistry.compile(group, {
      target: NODE_COMPILER_TARGETS.VISUAL,
      component: semanticComponent,
      resolveNodeDefinition,
    })];
  };
  if (rootComponentIds == null) {
    return new Map((components || []).map(compileComponent));
  }

  // A retained render plan owns only the programs reachable from its visible
  // roots. Compile a root before reading its declared dependencies so authored
  // Group topology—not a parallel raw-chain walker—remains dependency truth.
  const programs = new Map();
  const pending = [...new Set(Array.from(rootComponentIds || [], String))];
  while (pending.length) {
    const id = pending.shift();
    if (!id || programs.has(id)) continue;
    const component = componentById.get(id);
    if (!component) continue;
    const [componentId, program] = compileComponent(component);
    programs.set(componentId, program);
    const dependencies = program.inspect()?.dependencies || {};
    for (const dependencyId of dependencies.componentPrograms || dependencies.components || []) {
      if (!programs.has(String(dependencyId || ""))) pending.push(String(dependencyId || ""));
    }
  }
  return programs;
}

function canonicalizeStoredVisualSourceNodes(group = {}) {
  const visit = (nodes = []) => {
    let changedNodes = false;
    const semanticNodes = nodes.map((node) => {
    const configuration = node?.configuration;
    const source = configuration?.kind === "source"
      ? canonicalizeAuthoredVisualSource(configuration.source)
      : null;
    const sourceChanged = source && source !== configuration.source;
    const childNodes = Array.isArray(node?.nodes)
      ? visit(node.nodes)
      : node?.nodes;
    const childrenChanged = childNodes !== node?.nodes;
    if (!sourceChanged && !childrenChanged) return node;
    changedNodes = true;
    const nextConfiguration = sourceChanged
      ? { ...configuration, source }
      : configuration;
    const nextNodeId = sourceChanged
      ? nodeTypeForItem(nextConfiguration)
      : node.nodeId;
    const semanticNode = sourceChanged
      ? Object.fromEntries(
          Object.entries(node || {}).filter(([key]) => key !== "compilerHook"),
        )
      : node;
    return {
      ...semanticNode,
      nodeId: nextNodeId,
      ...(sourceChanged ? {
        nodeVersion: "0.1.0",
        parameters: {
          ...(node.parameters || {}),
          ...(source.params || {}),
          sourceType: source.type,
          mediaId: source.params?.mediaId || "",
          componentId: source.componentId || "",
        },
      } : {}),
      ...(nextConfiguration ? { configuration: nextConfiguration } : {}),
      ...(Array.isArray(childNodes)
        ? { nodes: childNodes }
        : {}),
    };
    });
    return changedNodes ? semanticNodes : nodes;
  };
  const nodes = visit(group.nodes || []);
  if (nodes === group.nodes) return group;
  return {
    ...group,
    nodes,
  };
}

function componentGroupDefinitions(group, resolveNodeDefinition) {
  const definitions = new Map();
  if (typeof resolveNodeDefinition !== "function") return definitions;
  const visit = (nodes = []) => {
    for (const node of nodes) {
      const definition = resolveNodeDefinition(node);
      if (definition) definitions.set(String(node.nodeId || ""), definition);
      visit(node.nodes || []);
    }
  };
  visit(group?.nodes || []);
  return definitions;
}

export class CompiledComponentRenderProgram {
  constructor(group, component, { resolveNodeDefinition = null } = {}) {
    this.id = group.id;
    this.componentId = group.componentId;
    this.group = group;
    this.plan = compileVisualRenderPlan(group, component, { resolveDefinition: resolveNodeDefinition });
    // Persisted generated control nodes are a compiled projection, not an
    // authority for current Component values. Reconcile them before the first
    // frame just as live configuration patches do; otherwise a stale projected
    // value can temporarily overwrite the materialized operation it controls.
    this.plan.controlProgram?.syncGeneratedControlsFromConfiguration?.();
    this.generatedBy = COMPONENT_PROGRAM_GENERATOR;
  }

  execute(renderHost, component, componentTime, renderRequest, scopeId = component.id) {
    const runtime = renderHost?.visualPlanRuntime;
    if (typeof runtime?.execute !== "function") throw new Error("VJ1_VISUAL_PLAN_CAPABILITY_REQUIRED");
    return runtime.execute(this.plan, component, componentTime, renderRequest, scopeId);
  }

  replaceNodeConfiguration(nodeId, configuration) {
    const id = String(nodeId || "");
    if (!id || !configuration) return false;
    if (!this.plan.replaceConfiguration(id, configuration)) {
      throw new Error(`VJ1_COMPILED_CONFIGURATION_TARGET_MISSING:${this.componentId}:${id}`);
    }
    return true;
  }

  syncGraphNodes(group = {}, nodeIds = []) {
    const requested = new Set(Array.from(nodeIds || [], String).filter(Boolean));
    const configurations = new Map();
    collectGraphNodeConfigurations(group.nodes || [], requested, configurations);
    // The authored Group can advance before a retained program is rebuilt.
    // Report that stale compiled target through the ordinary synchronization
    // result so LiveRenderPatchRuntime can rebuild once and retry. Calling the
    // strict single-node replacement here used to throw before that recovery
    // boundary could run.
    const missingIds = [...requested].filter((id) =>
      !configurations.has(id) || !this.plan.hasConfiguration(id)
    );
    if (missingIds.length) return Object.freeze({
      applied: false,
      changedIds: Object.freeze([]),
      missingIds: Object.freeze(missingIds),
    });
    const changedIds = [];
    for (const id of requested) {
      if (this.replaceNodeConfiguration(id, configurations.get(id))) changedIds.push(id);
    }
    if (changedIds.length) this.syncGeneratedControlsFromConfiguration();
    return Object.freeze({
      applied: changedIds.length === requested.size,
      changedIds: Object.freeze(changedIds),
      missingIds: Object.freeze([]),
    });
  }

  configurationState() {
    // Thumbnail identity follows the current compiled configurations rather
    // than the disposable Component chain projection. Build the lightweight
    // projection on invalidation so retained node replacements and topology
    // rebuilds are visible immediately without maintaining a second cache.
    return visualRenderPlanConfiguration(this.plan);
  }

  isRegionSafe(component = null, options = {}) {
    return visualRenderPlanRegionSafe(this.plan, component, options);
  }

  syncGeneratedControlsFromConfiguration() {
    this.plan.controlProgram?.syncGeneratedControlsFromConfiguration();
  }

  inspect() {
    return Object.freeze({
      componentId: this.componentId,
      groupId: this.id,
      ...this.plan.inspect(),
    });
  }

  forEachOperation(visitor) {
    this.plan.introspection.forEachOperation(visitor);
  }

  dispose() {
    this.plan?.dispose?.();
  }
}

function collectGraphNodeConfigurations(nodes, requested, result) {
  for (const node of nodes || []) {
    const id = String(node?.id || "");
    if (requested.has(id) && node.configuration) result.set(id, node.configuration);
    collectGraphNodeConfigurations(node?.nodes || [], requested, result);
  }
}

function compileChainNodes(chain, path, definitions) {
  return (chain || []).filter((item) => item?.id).flatMap((item, index) => {
    const itemPath = `${path}.${index}`;
    const auxiliaryNodes = Object.entries(item.imageInputs || {}).flatMap(([port, source]) => {
      if (!source?.type || !/^[A-Za-z_]\w*$/.test(port)) return [];
      const auxiliaryItem = {
        id: `${item.id}:image:${port}`,
        kind: "source",
        name: port,
        enabled: true,
        source,
        opacity: 1,
        blend: "normal",
        transform: {},
        boundary: {},
        auxiliaryFor: { nodeId: String(item.id), port },
      };
      const auxiliaryNode = {
        id: auxiliaryItem.id,
        nodeId: nodeTypeForItem(auxiliaryItem),
        nodeVersion: "0.1.0",
        role: "source",
        parameters: parametersForItem(auxiliaryItem),
        configuration: cloneChainItem(auxiliaryItem),
        compilerHook: visualCompilerHookFor(
          auxiliaryItem,
          definitions.get(nodeTypeForItem(auxiliaryItem)),
        ),
        statePath: `${itemPath}.imageInputs.${port}`,
        auxiliaryFor: auxiliaryItem.auxiliaryFor,
        generatedBy: COMPONENT_PROGRAM_GENERATOR,
      };
      return [
        ...parameterControlNodes(auxiliaryNode, definitions.get(auxiliaryNode.nodeId)),
        auxiliaryNode,
      ];
    });
    const node = {
      id: String(item.id),
      nodeId: nodeTypeForItem(item),
      nodeVersion: "0.1.0",
      role: item.kind || "source",
      parameters: parametersForItem(item),
      configuration: cloneChainItem(item, { includeChildren: false }),
      compilerHook: visualCompilerHookFor(item, definitions.get(nodeTypeForItem(item))),
      statePath: itemPath,
      generatedBy: COMPONENT_PROGRAM_GENERATOR,
    };
    if (item.kind === "group") {
      node.nodes = compileChainNodes(item.chain || [], `${itemPath}.chain`, definitions);
      node.connections = linearConnections(node.nodes, definitions);
    }
    return [
      ...auxiliaryNodes,
      ...parameterControlNodes(node, definitions.get(node.nodeId)),
      node,
    ];
  });
}

function refreshVisualCompilerHooks(nodes, definitions) {
  return (nodes || []).map((node) => {
    const definition = definitions.get(node.nodeId);
    const configuration = node.configuration || { kind: node.role };
    const renderNode =
      node.role === "source" ||
      node.role === "effect" ||
      node.role === "group";
    const compilerHook = renderNode && (definition || node.role === "group")
      ? visualCompilerHookFor(configuration, definition)
      : node.compilerHook;
    return {
      ...node,
      ...(compilerHook ? { compilerHook } : {}),
      ...(node.nodes ? { nodes: refreshVisualCompilerHooks(node.nodes, definitions) } : {}),
    };
  });
}

function nodeTypeForItem(item = {}) {
  if (item.kind === "effect") return `vj1.visual.effect.${item.componentId || "unknown"}`;
  if (item.kind === "group") return LayerGroupNode.id;
  if (item.source?.type === "generator") return `vj1.visual.generator.${item.source.generatorId || "unknown"}`;
  return VisualSourceNode.id;
}

function visualCompilerHookFor(item, definition) {
  const metadata = definition?.metadata || {};
  if (metadata.visualCompilerHook?.id) {
    return metadata.visualCompilerHook;
  }
  if (item.kind === "group") return {
    id: VISUAL_COMPILER_HOOKS.GROUP,
    contract: defineVisualNodeContract({}, {
      transform: { domain: VISUAL_TRANSFORM_DOMAINS.GROUP_FIELD },
      roi: { mode: "local", coordinateSpace: "boundary" },
    }),
  };
  if (item.kind === "effect") return {
    id: VISUAL_COMPILER_HOOKS.SHADER_EFFECT,
    shaderInterface: metadata.shaderInterface || "effect",
    sampling: metadata.sampling || "unknown",
    fusible: metadata.fusible === true,
    contract: visualNodeContractFromMetadata(metadata, {
      transform: {
        domain: metadata.transformSource === false
          ? VISUAL_TRANSFORM_DOMAINS.GROUP_FIELD
          : VISUAL_TRANSFORM_DOMAINS.COMPOSITION,
      },
      roi: metadata.roi || { mode: "local", halo: 0, coordinateSpace: "boundary" },
    }),
    roi: metadata.roi || { mode: "local", halo: 0, coordinateSpace: "boundary" },
    // Pointwise/neighborhood effects consume the already composed texture and
    // therefore stay in Composition coordinates. Spatial field effects own a
    // physical field whose placement follows its containing Group.
    transformDomain: metadata.transformSource === false
      ? VISUAL_TRANSFORM_DOMAINS.GROUP_FIELD
      : VISUAL_TRANSFORM_DOMAINS.COMPOSITION,
  };
  // A code-owned visual process is already the executable source operation.
  // Prefer that generic compiled path over any legacy nativeRenderer label so
  // simple node implementations never require visual-name host dispatch.
  if (metadata.nodeOwnedNativeProcess) return {
    id: VISUAL_COMPILER_HOOKS.SOURCE,
    renderer: visualSourceRenderer(item.source || {}),
    allocationStable: metadata.allocationStableDirectPath === true,
    contract: visualNodeContractFromMetadata(metadata, {
      transform: { domain: VISUAL_TRANSFORM_DOMAINS.CONTENT },
    }),
  };
  if (metadata.nativeRenderer) return {
    id: VISUAL_COMPILER_HOOKS.NATIVE_SOURCE,
    renderer: metadata.nativeRenderer,
    allocationStable: metadata.allocationStableDirectPath === true,
    contract: visualNodeContractFromMetadata(metadata, {
      transform: { domain: VISUAL_TRANSFORM_DOMAINS.CONTENT },
    }),
  };
  if (metadata.nodeOwnedShader) return {
    id: VISUAL_COMPILER_HOOKS.SHADER_GENERATOR,
    shaderInterface: metadata.shaderInterface || "generator",
    contract: visualNodeContractFromMetadata(metadata, {
      transform: { domain: VISUAL_TRANSFORM_DOMAINS.CONTENT },
    }),
  };
  return {
    id: VISUAL_COMPILER_HOOKS.SOURCE,
    renderer: visualSourceRenderer(item.source || {}),
    allocationStable: true,
    contract: visualNodeContractFromMetadata(metadata, {
      transform: { domain: VISUAL_TRANSFORM_DOMAINS.CONTENT },
    }),
  };
}

function parametersForItem(item = {}) {
  if (item.kind === "effect") return { ...(item.params || {}) };
  if (item.kind === "group") return {
    opacity: item.opacity ?? 1,
    blend: item.blend || "normal",
    transform: item.transform || {},
  };
  return {
    ...(item.source?.params || {}),
    sourceType: item.source?.type || "black",
    mediaId: item.source?.mediaId || "",
    componentId: item.source?.componentId || "",
  };
}

function linearConnections(nodes = [], definitions = new Map()) {
  const connections = [];
  const renderNodes = nodes.filter((node) => node.role !== "control" && !node.auxiliaryFor);
  const auxiliaryNodes = nodes.filter((node) => node.auxiliaryFor);
  for (const control of nodes.filter((node) => node.role === "control")) {
    connections.push({
      from: `${control.id}.value`,
      to: `${control.targetNodeId}.$parameter.${control.targetParameterId}`,
      type: control.valueType,
      sourceRange: control.sourceRange,
      targetRange: control.targetRange,
    });
  }
  for (let index = 0; index < renderNodes.length; index++) {
    const node = renderNodes[index];
    const hasAuxiliaryImages = auxiliaryNodes.some(
      (candidate) => candidate.auxiliaryFor?.nodeId === node.id,
    );
    connections.push({
      from: index === 0 ? "$in.texture" : `${renderNodes[index - 1].id}.texture`,
      to: `${node.id}.${compositionTextureInletId(node, auxiliaryNodes, definitions)}`,
      type: "texture",
      // Once an effect has another named texture dependency the executor
      // switches to DAG mode. Its preceding composition texture must then be
      // an explicit inputImage binding instead of only an ordering edge.
      semantic: node.role === "effect" && hasAuxiliaryImages
        ? "primary-image"
        : "composition",
    });
  }
  for (const auxiliary of auxiliaryNodes) {
    connections.push({
      from: `${auxiliary.id}.texture`,
      to: `${auxiliary.auxiliaryFor.nodeId}.${auxiliary.auxiliaryFor.port}`,
      type: "texture",
      semantic: "auxiliary-image",
    });
  }
  if (renderNodes.length) connections.push({ from: `${renderNodes[renderNodes.length - 1].id}.texture`, to: "$out.texture", type: "texture" });
  return connections;
}

function compositionTextureInletId(node, auxiliaryNodes, definitions) {
  const occupied = new Set(auxiliaryNodes
    .filter((candidate) => candidate.auxiliaryFor?.nodeId === node.id)
    .map((candidate) => candidate.auxiliaryFor.port));
  const preferred = textureInletId(node, definitions);
  return occupied.has(preferred) ? "texture" : preferred;
}

function annotateComponentCompositionTopology(nodes = [], definitions = new Map()) {
  return (nodes || []).map((node) => {
    if (!node.nodes) return node;
    const children = annotateComponentCompositionTopology(node.nodes, definitions);
    return {
      ...node,
      nodes: children,
      connections: markCompositionConnections(node.connections || [], children, definitions),
    };
  });
}

function markCompositionConnections(connections = [], nodes = [], definitions = new Map()) {
  const renderNodes = nodes.filter((node) => node.role !== "control" && !node.auxiliaryFor);
  const canonical = new Set(renderNodes.map((node, index) => (
    `${index === 0 ? "$in" : renderNodes[index - 1].id}\u0000${node.id}`
  )));
  return (connections || []).map((edge) => (
    edge.semantic ||
    !canonical.has(`${String(edge.from || "").split(".")[0]}\u0000${String(edge.to || "").split(".")[0]}`)
      ? edge
      : { ...edge, semantic: "composition" }
  ));
}

function textureInletId(node, definitions) {
  const definition = definitions.get(node.nodeId);
  const inlet = Object.values(definition?.inlets || {}).find((port) => (port.type?.type || port.type) === "texture");
  return inlet?.id || "texture";
}

function collectInstances(nodes, groupId, result) {
  for (const node of nodes) {
    const instanceId = `${groupId}/${node.id}`;
    result.push({
      id: instanceId,
      nodeId: node.nodeId,
      nodeVersion: node.nodeVersion,
      parameters: node.parameters || {},
      statePath: node.statePath,
      parentGroupId: groupId,
      generatedBy: COMPONENT_PROGRAM_GENERATOR,
    });
    if (node.nodes?.length) collectInstances(node.nodes, instanceId, result);
  }
}

function materializeChain(topologyNodes, currentChain, groupId) {
  const byId = new Map((currentChain || []).map((item) => [String(item.id || ""), item]));
  return topologyNodes.filter((node) => node.role !== "control" && !node.auxiliaryFor).map((node) => {
    const item = node.configuration || byId.get(String(node.id || ""));
    if (!item) throw new Error(`COMPONENT_PROGRAM_ITEM_MISSING:${groupId}:${node.id}`);
    if (node.role !== "group") return item;
    return {
      ...item,
      chain: materializeChain(node.nodes || [], item.chain || [], `${groupId}/${node.id}`),
    };
  });
}

function withoutLegacyChain(component, signature) {
  const { chain: _legacyChain, ...metadata } = component || {};
  return { ...metadata, nodeProjectionSignature: signature };
}

function componentChainSignature(chain) {
  const source = JSON.stringify(chain || []);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < source.length; index++) {
    const code = source.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
    second ^= second >>> 13;
  }
  return `chain-v1:${source.length}:${(first >>> 0).toString(36)}:${(second >>> 0).toString(36)}`;
}

function cloneChainItem(item, { includeChildren = true } = {}) {
  const value = { ...(item || {}) };
  if (value.source) value.source = cloneJson(value.source);
  if (value.imageInputs) value.imageInputs = cloneJson(value.imageInputs);
  if (value.params) value.params = cloneJson(value.params);
  if (value.transform) value.transform = cloneJson(value.transform);
  if (value.kind === "group") value.chain = includeChildren ? cloneJson(value.chain || []) : [];
  return value;
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function parameterControlNodes(targetNode, definition) {
  if (!definition) return [];
  return Object.entries(targetNode.parameters || {}).flatMap(([parameterId, value]) => {
    if (value === undefined) return [];
    const parameter = definition.parameters?.[parameterId];
    if (!parameter) return [];
    const numeric = parameter.type?.type === "number" && typeof value === "number";
    const targetRange = parameter.expectedRange || parameter.allowedRange;
    return [{
      id: `${targetNode.id}:param:${parameterId}`,
      nodeId: numeric ? "core.control.slider" : "core.control.value",
      nodeVersion: "0.1.0",
      role: "control",
      targetNodeId: targetNode.id,
      targetParameterId: parameterId,
      valueType: parameter.type?.type || "any",
      sourceRange: numeric ? [0, 1] : null,
      targetRange: numeric && validRange(targetRange) ? [...targetRange] : null,
      parameters: { value: numeric ? normalizedControlValue(value, targetRange) : value },
      generatedBy: COMPONENT_PROGRAM_GENERATOR,
    }];
  });
}

function normalizedControlValue(value, range) {
  if (!validRange(range)) return Math.max(0, Math.min(1, Number(value) || 0));
  return Math.max(0, Math.min(1, (value - range[0]) / (range[1] - range[0])));
}

function validRange(value) {
  return Array.isArray(value) && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]) && value[0] !== value[1];
}
