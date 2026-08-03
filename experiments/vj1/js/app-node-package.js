import { defineNode, NODE_IMPLEMENTATION_KINDS, NodeRegistry, validateNodeGraphProgramDefinition } from "./libraries/node-engine/index.js";
import { defineNodeArtifact, NodeArtifactCatalog } from "./libraries/node-engine/index.js";
import { nodeEditorProjection } from "./libraries/node-engine/index.js";
import { createProjectGroupDefinitionFromTemplate, createProjectVisualGroupDefinition, normalizeNodeProjectData, serializeNodeArtifact, serializeNodeDefinition } from "./libraries/node-engine/index.js";
import {
  createNodePackageFromProject,
  exportNodePackage,
  importNodePackage,
  installNodePackageIntoProject,
} from "./libraries/node-engine/index.js";
import {
  listEffectNodeComponents,
  listGeneratorNodeComponents,
  VisualStageNodeDefinitions,
} from "./libraries/visual-nodes/index.js";
import {
  AnimationCurveControlNode,
  AnimationSequencerControlNode,
  AudioControlInputNode,
  ComponentTimeControlNode,
  EventTriggerControlNode,
  FrameDelayControlNode,
  HostControlInputNode,
  MapRangeControlNode,
  MidiControlInputNode,
  NumericCombineControlNode,
  OscillatorControlNode,
  OscControlInputNode,
  PointerControlInputNode,
  ProbeControlInputNode,
  PeriodicTriggerControlNode,
  RandomTriggerControlNode,
  SampleHoldControlNode,
  ScalarNoiseControlNode,
  ScalarMathControlNode,
  SelectControlNode,
  SegmentEnvelopeControlNode,
  SliderArtifact,
  SliderNode,
  SmoothControlNode,
  ValueControlNode,
  Vector2ControlNode,
  Vector3ControlNode,
} from "./libraries/control-engine/index.js";
import { CacheEngineNode } from "./libraries/cache-engine/index.js";
import { DataStoreNode } from "./libraries/data-store/index.js";
import { DiagnosticsEngineNode } from "./libraries/diagnostics-engine/index.js";
import { ImageResizeNode } from "./libraries/image-engine/index.js";
import { InstanceTimeNode, RateClockNode, VisualTimeScaleNode } from "./libraries/timing-engine/index.js";
import { NestedNoiseMotionNode, OrbitMotionNode } from "./libraries/motion-engine/index.js";
import { TerrainFlightControllerNode } from "./libraries/terrain-engine/index.js";
import { MappingEngineNode } from "./libraries/mapping-engine/index.js";
import { SceneSurfaceGuideNode, SurfaceCompositionNode } from "./libraries/composition-engine/index.js";
import {
  COMPONENT_PROGRAM_GENERATOR,
  ComponentProgramNode,
  LayerGroupNode,
  TextureOperatorNodeDefinitions,
  VisualSourceNode,
  compileComponentGroupTopology,
  compileComponentRenderPrograms,
  compileVisualRenderPlan,
  componentProgramInstances,
  reconcileComponentGroupTopology,
} from "./libraries/composition-engine/index.js";
import {
  MAPPING_PROGRAM_GENERATOR,
  OutputProgramNode,
  MappingProgramNode,
  SurfaceRouteNode,
  compileOutputGroupTopology,
  compileMappingGroupTopology,
  compileReachableProgramGraph,
  mappingProgramInstances,
} from "./libraries/composition-engine/index.js";
import {
  APPLICATION_PROGRAM_GENERATOR,
  ApplicationProgramRuntime,
  ApplicationProgramNode,
  applicationProgramInstances,
  compileApplicationProgramPlan,
  compileApplicationProgramTopology,
} from "./libraries/composition-engine/index.js";
import { SessionDeviceLifecycleNode } from "./libraries/device-engine/index.js";
import { StateCommandNode } from "./libraries/state-engine/index.js";
import { SerializedStorageNode } from "./libraries/storage-engine/index.js";
import { LivePatchSynchronizerNode } from "./libraries/synchronization-engine/index.js";
import { MediaInputLifecycleNode } from "./libraries/media-engine/index.js";
import { RenderDemandNode } from "./libraries/render-engine/index.js";
import { VisualNodeDefinitionNode } from "./libraries/visual-nodes/index.js";
import {
  Convert3dFileToImageGroup,
  ComposableScene3dGroup,
  Detect3dFormatNode,
  MeshRenderNode,
  MeshResolutionNode,
  ObjParserNode,
  Parse3dObjectGroup,
  Prepare3dAssetGroup,
  Scene3dNodeDefinitions,
  StlParserNode,
  compileScene3dProgram,
} from "./libraries/mesh-engine/index.js";
import { listProjectIsfVisualComponents } from "./libraries/isf-engine/index.js";
import { migrateLegacyComponentParameterAddress } from "./domain/component-layer-projection.js";

const ProjectComponentNode = semanticProjectNode("vj1.project.component", "Component", "A task-oriented visual program composed from reusable nodes.", "texture");
const ProjectSceneNode = semanticProjectNode("vj1.project.scene", "Scene", "A spatial visual program arranging reusable Components against shared projection Surfaces.", "texture");
const ProjectMappingNode = semanticProjectNode("vj1.project.mapping", "Mapping", "A routing program that assigns Scene content to projection Surfaces.", "texture");
const ProjectLiveNode = semanticProjectNode("vj1.project.live", "Live", "The active performance projection of a selected Scene.", "event");

const CORE_NODE_DEFINITIONS = Object.freeze([
  AnimationCurveControlNode,
  AnimationSequencerControlNode,
  SegmentEnvelopeControlNode,
  SliderNode,
  ValueControlNode,
  ComponentTimeControlNode,
  OscillatorControlNode,
  PeriodicTriggerControlNode,
  RandomTriggerControlNode,
  ScalarNoiseControlNode,
  MapRangeControlNode,
  NumericCombineControlNode,
  ScalarMathControlNode,
  Vector2ControlNode,
  Vector3ControlNode,
  SmoothControlNode,
  SelectControlNode,
  FrameDelayControlNode,
  EventTriggerControlNode,
  SampleHoldControlNode,
  MidiControlInputNode,
  OscControlInputNode,
  AudioControlInputNode,
  HostControlInputNode,
  PointerControlInputNode,
  ProbeControlInputNode,
  CacheEngineNode,
  DataStoreNode,
  DiagnosticsEngineNode,
  ImageResizeNode,
  RateClockNode,
  VisualTimeScaleNode,
  InstanceTimeNode,
  OrbitMotionNode,
  NestedNoiseMotionNode,
  TerrainFlightControllerNode,
  MappingEngineNode,
  SurfaceCompositionNode,
  SceneSurfaceGuideNode,
  ComponentProgramNode,
  LayerGroupNode,
  VisualSourceNode,
  ...TextureOperatorNodeDefinitions,
  SurfaceRouteNode,
  MappingProgramNode,
  OutputProgramNode,
  ApplicationProgramNode,
  SessionDeviceLifecycleNode,
  StateCommandNode,
  SerializedStorageNode,
  LivePatchSynchronizerNode,
  MediaInputLifecycleNode,
  RenderDemandNode,
  VisualNodeDefinitionNode,
  ...VisualStageNodeDefinitions,
  Detect3dFormatNode,
  StlParserNode,
  ObjParserNode,
  Parse3dObjectGroup,
  MeshResolutionNode,
  MeshRenderNode,
  Prepare3dAssetGroup,
  Convert3dFileToImageGroup,
  ...Scene3dNodeDefinitions,
  ProjectComponentNode,
  ProjectSceneNode,
  ProjectMappingNode,
  ProjectLiveNode,
]);

const MODEL_PREVIEW_NODE_DEFINITIONS = Object.freeze([
  Detect3dFormatNode,
  StlParserNode,
  ObjParserNode,
  Parse3dObjectGroup,
  MeshResolutionNode,
  Prepare3dAssetGroup,
  MeshRenderNode,
  ImageResizeNode,
  Convert3dFileToImageGroup,
]);

const ModelPreviewPipelineArtifact = defineNodeArtifact({
  id: "vj1.utility.model-preview-pipeline",
  name: "3D Model Preview Pipeline",
  description: "Persisted application pipeline that converts STL and OBJ media into preview images.",
  artifactType: "utility",
  implementation: {
    nodeType: Convert3dFileToImageGroup.id,
    nodeVersion: Convert3dFileToImageGroup.version,
  },
  capabilities: ["mesh-processing", "produces-image", "internal-utility"],
  presentation: {
    catalogs: ["node-graph"],
    placeableOn: ["node-graph"],
    hiddenFrom: ["component-catalog", "scene-catalog", "element-picker", "mapping-catalog", "live"],
  },
});

export function createVj1NodePackage() {
  const visualComponents = [...listGeneratorNodeComponents(), ...listEffectNodeComponents()];
  const visualDefinitions = visualComponents.map((component) => component.nodeDefinition);
  const builtInDefinitions = [
    ...CORE_NODE_DEFINITIONS,
    ...visualDefinitions,
  ];
  const registry = new NodeRegistry(builtInDefinitions);
  const artifacts = new NodeArtifactCatalog([
    SliderArtifact,
    ...visualComponents.map(visualElementArtifact),
  ]);
  const applicationProgram = compileApplicationProgramTopology();
  let activeApplicationProgram = null;
  const prepareProjectState = (state) => prepareVj1NodeProjectState(state, {
    visualDefinitions,
  });
  const prepareProjectChange = (previous, next) => prepareVj1NodeProjectChange(previous, next, {
    visualDefinitions,
  });
  const applicationProgramForState = (state = {}) => (state?.nodes?.groups || [])
    .find((group) => group.id === applicationProgram.id) || applicationProgram;
  const createApplicationRuntime = ({ group = applicationProgram, ...options } = {}) => {
    const runtime = new ApplicationProgramRuntime(group, { registry, ...options });
    activeApplicationProgram = group;
    return runtime;
  };
  let packageApi = null;
  let cachedInstalledPackages = null;
  let cachedAvailablePackages = null;
  let cachedProjectDefinitions = null;
  let cachedEditorContext = null;
  const editorContext = (
    installedPackages = [],
    availablePackages = installedPackages,
    projectDefinitions = [],
  ) => {
    if (
      installedPackages === cachedInstalledPackages
      && availablePackages === cachedAvailablePackages
      && projectDefinitions === cachedProjectDefinitions
      && cachedEditorContext
    ) return cachedEditorContext;
    const definitions = [...builtInDefinitions];
    const known = new Set(definitions.map((definition) => `${definition.id}@${definition.version}`));
    const packageByDefinition = new Map();
    for (const installedPackage of installedPackages || []) {
      for (const definition of installedPackage.definitions || []) {
        const key = `${definition.id}@${definition.version}`;
        packageByDefinition.set(key, installedPackage);
        if (known.has(key)) continue;
        known.add(key);
        definitions.push(definition);
      }
    }
    for (const definition of projectDefinitions || []) {
      if (definition?.persistence === "package") continue;
      const key = `${definition?.id || ""}@${definition?.version || ""}`;
      if (!definition?.id || known.has(key)) continue;
      known.add(key);
      definitions.push(definition);
    }
    const editorRegistry = new NodeRegistry(definitions);
    cachedInstalledPackages = installedPackages;
    cachedAvailablePackages = availablePackages;
    cachedProjectDefinitions = projectDefinitions;
    cachedEditorContext = Object.freeze({
      ...packageApi,
      registry: editorRegistry,
      installedPackages: Object.freeze([...(installedPackages || [])]),
      availablePackages: Object.freeze([...(availablePackages || [])]),
      packageForDefinition: (definition = {}) =>
        packageByDefinition.get(`${definition.id}@${definition.version}`) || null,
      editorProjection: (definition, options = {}) =>
        nodeEditorProjection(definition, { nodeRegistry: editorRegistry, ...options }),
      preflightGraphEdit: (target, graph) =>
        preflightGraphEdit(target, graph, editorRegistry),
    });
    return cachedEditorContext;
  };
  packageApi = {
    id: "vj1.application",
    version: "0.1.0",
    registry,
    artifacts,
    applicationProgram,
    applicationProgramForState,
    compileApplicationProgram: (group = applicationProgram) => compileApplicationProgramPlan(group),
    applicationProgramStatus: (state = {}) => applicationProgramActivationStatus(
      applicationProgramForState(state),
      activeApplicationProgram
    ),
    createApplicationRuntime,
    createProjectPackage: (state, manifest) => createNodePackageFromProject(state?.nodes, manifest),
    createProjectVisualGroupDefinition,
    createProjectScene3dGroupDefinition: ({ id, name = "3D Scene Group", description } = {}) =>
      createProjectGroupDefinitionFromTemplate(ComposableScene3dGroup, {
        id,
        name,
        description: description || "A project-owned mesh, material, transform, camera, Scene, and image graph compiled into retained 3D render steps.",
      }),
    exportProjectPackage: (state, manifest, options) => exportNodePackage(
      createNodePackageFromProject(state?.nodes, manifest),
      options
    ),
    installProjectPackage: (state, value, options) => {
      const nodePackage = typeof value === "string" ? importNodePackage(value) : value;
      const installed = installNodePackageIntoProject(nodePackage, state?.nodes, options);
      return Object.freeze({
        ...installed,
        state: prepareProjectState({ ...state, nodes: installed.project }),
      });
    },
    projectArtifacts: (state) => createProjectArtifactCatalog(state),
    projectViews: (state) => projectArtifactViews(state),
    prepareProjectState,
    prepareProjectChange,
    editorContext,
    editorProjection: (definition, options = {}) => nodeEditorProjection(definition, { nodeRegistry: registry, ...options }),
  };
  return Object.freeze(packageApi);
}

function applicationProgramActivationStatus(projectGroup, activeGroup) {
  try {
    const projectPlan = compileApplicationProgramPlan(projectGroup);
    const activePlan = activeGroup ? compileApplicationProgramPlan(activeGroup) : null;
    const signature = applicationPlanSignature(projectPlan);
    const activeSignature = activePlan ? applicationPlanSignature(activePlan) : "";
    return Object.freeze({
      valid: true,
      active: !!activePlan && signature === activeSignature,
      requiresRestart: !!activePlan && signature !== activeSignature,
      signature,
      activeSignature,
      error: "",
    });
  } catch (error) {
    return Object.freeze({
      valid: false,
      active: false,
      requiresRestart: false,
      signature: "",
      activeSignature: "",
      error: error?.message || String(error),
    });
  }
}

function applicationPlanSignature(plan = {}) {
  return JSON.stringify({
    services: (plan.services?.nodes || []).map((node) => ({
    id: node.id,
    role: node.role,
    nodeId: node.nodeId,
    nodeVersion: node.nodeVersion,
    dependencies: [...(node.dependencies || [])].sort(),
    })).sort((left, right) => left.id.localeCompare(right.id)),
    dataflow: (plan.dataflow?.routes || []).map((route) => ({
      from: `${route.sourceRole}.${route.sourcePort}`,
      to: `${route.targetRole}.${route.targetPort}`,
      type: route.type,
    })).sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to)),
  });
}

export function prepareVj1NodeProjectState(state = {}, { visualDefinitions = [] } = {}) {
  const currentNodes = normalizeNodeProjectData(state?.nodes);
  const projectVisualDefinitions = listProjectIsfVisualComponents({ ...state, nodes: currentNodes })
    .map((component) => component.nodeDefinition);
  const topologyDefinitions = new Map([
    ...visualDefinitions,
    ...projectVisualDefinitions,
    ...VisualStageNodeDefinitions,
    ...Scene3dNodeDefinitions,
    TerrainFlightControllerNode,
    RenderDemandNode,
    LayerGroupNode,
    VisualSourceNode,
    ...TextureOperatorNodeDefinitions,
  ].map((definition) => [definition.id, definition]));
  const currentGroups = new Map(currentNodes.groups
    .filter((group) => group.generatedBy === COMPONENT_PROGRAM_GENERATOR)
    .map((group) => [String(group.componentId || ""), group]));
  const reconciled = (state?.components || []).map((component) => reconcileComponentGroupTopology(
    component,
    currentGroups.get(String(component.id || "")) || null,
    { definitions: topologyDefinitions }
  ));
  const components = reconciled.map((entry) => entry.component);
  const componentGroups = reconciled.map((entry) => entry.group);
  const prepared = migrateLiveDiffsToGraphNodes({
    ...state,
    components,
    nodes: ensureVj1NodeProjectData(currentNodes, components, {
      visualDefinitions,
      projectVisualDefinitions,
      mappings: state?.mappings,
      surfaces: state?.surfaces,
      componentGroups,
    }),
  }, componentGroups);
  return migrateSignificantParametersToGraphNodes(prepared);
}

function migrateSignificantParametersToGraphNodes(state) {
  let changed = false;
  const components = (state.components || []).map((component) => {
    const significantParams = [...new Set((component.significantParams || []).flatMap((path) => {
      const address = migrateLegacyComponentParameterAddress(state, component, path);
      if (!address) return [];
      if (address !== path) changed = true;
      return [address];
    }))];
    if (significantParams.length === (component.significantParams || []).length &&
        significantParams.every((path, index) => path === component.significantParams[index])) {
      return component;
    }
    changed = true;
    return { ...component, significantParams };
  });
  return changed ? { ...state, components } : state;
}

// Project loading is the one compatibility boundary. Older saves addressed
// Live values by chain array position; convert them once to stable graph node
// identities and remove the old field before the world can be published.
function migrateLiveDiffsToGraphNodes(state, componentGroups = []) {
  const banks = state.ui?.live?.parameterDiffs;
  if (!banks || typeof banks !== "object") return state;
  const groups = new Map(componentGroups.map((group) => [String(group.componentId || ""), group]));
  let changed = false;
  const parameterDiffs = Object.fromEntries(Object.entries(banks).map(([targetId, bank]) => [
    targetId,
    Object.fromEntries(Object.entries(bank || {}).map(([componentId, override]) => {
      if (!Array.isArray(override?.chain)) return [componentId, override];
      const nodes = { ...(override.nodes || {}) };
      migrateLegacyChainOverrides(groups.get(String(componentId))?.nodes || [], override.chain, nodes);
      const { chain: _removed, ...componentOverride } = override;
      changed = true;
      return [componentId, {
        ...componentOverride,
        ...(Object.keys(nodes).length ? { nodes } : {}),
      }];
    })),
  ]));
  if (!changed) return state;
  return {
    ...state,
    ui: {
      ...state.ui,
      live: {
        ...state.ui.live,
        parameterDiffs,
      },
    },
  };
}

function migrateLegacyChainOverrides(nodes = [], chain = [], result = {}) {
  const renderNodes = (nodes || []).filter((node) =>
    ["source", "effect", "group"].includes(node?.role) && !node?.auxiliaryFor
  );
  for (let index = 0; index < renderNodes.length; index++) {
    const node = renderNodes[index];
    const override = chain[index];
    if (!override || typeof override !== "object") continue;
    const { chain: children, ...configuration } = override;
    if (Object.keys(configuration).length) {
      result[String(node.id || "")] = {
        ...(result[String(node.id || "")] || {}),
        ...configuration,
      };
    }
    if (node.role === "group" && Array.isArray(children)) {
      migrateLegacyChainOverrides(node.nodes || [], children, result);
    }
  }
}

// Component configuration changes keep the same compiled topology. Reconcile
// only the changed Component groups and their generated instances so the
// graph-authoritative save remains current without rebuilding every Component,
// Mapping, definition, pin, and artifact in the project. Structural topology
// changes deliberately fall back to the full project compiler.
export function prepareVj1NodeProjectChange(previous = {}, next = {}, {
  visualDefinitions = [],
} = {}) {
  if (previous === next) return next;
  if (previous.nodes !== next.nodes) {
    const incremental = prepareComponentGraphConfigurationChange(previous, next, {
      visualDefinitions,
    });
    if (incremental) return incremental;
    return prepareVj1NodeProjectState(next, { visualDefinitions });
  }
  const previousComponents = previous.components || [];
  const nextComponents = next.components || [];
  if (
    previousComponents.length !== nextComponents.length ||
    previousComponents.some((component, index) =>
      String(component?.id || "") !== String(nextComponents[index]?.id || "")
    )
  ) {
    return prepareVj1NodeProjectState(next, { visualDefinitions });
  }
  const changedIndexes = nextComponents.flatMap((component, index) =>
    component === previousComponents[index] ? [] : [index]
  );
  const routesChanged = previous.mappings !== next.mappings ||
    previous.surfaces !== next.surfaces;
  if (!changedIndexes.length && !routesChanged) return next;

  // prepareChange only receives states that have already passed through
  // prepareProjectState. Re-normalizing the complete node project here would
  // deep-copy every definition, group, instance, and package for a one-field
  // Component edit—the exact whole-world work this incremental boundary
  // exists to remove.
  const currentNodes = next.nodes;
  let reconciled = [];
  const components = nextComponents.slice();
  const groupReplacements = new Map();
  const replacedComponentGroupIds = new Set();
  if (changedIndexes.length) {
    const projectVisualDefinitions = listProjectIsfVisualComponents({
      ...next,
      nodes: currentNodes,
    }).map((component) => component.nodeDefinition);
    const definitions = componentTopologyDefinitionMap({
      visualDefinitions,
      projectVisualDefinitions,
    });
    const groupsByComponent = new Map(currentNodes.groups
      .filter((group) => group.generatedBy === COMPONENT_PROGRAM_GENERATOR)
      .map((group) => [String(group.componentId || ""), group]));
    reconciled = changedIndexes.map((index) => {
      const component = nextComponents[index];
      const existing = groupsByComponent.get(String(component.id || "")) || null;
      const entry = reconcileComponentGroupTopology(component, existing, { definitions });
      const group = {
        ...entry.group,
        persistence: entry.group.authoredConnections === true ? "project-diff" : "compact",
      };
      return { index, existing, component: entry.component, group };
    });
    if (reconciled.some(({ existing, group }) =>
      !existing || componentTopologyShape(existing) !== componentTopologyShape(group)
    )) {
      return prepareVj1NodeProjectState(next, { visualDefinitions });
    }
    for (const entry of reconciled) {
      components[entry.index] = entry.component;
      replacedComponentGroupIds.add(entry.group.id);
      groupReplacements.set(entry.group.id, entry.group);
    }
  }

  let mappingGroups = [];
  if (routesChanged) {
    const existingById = new Map(currentNodes.groups.map((group) => [group.id, group]));
    mappingGroups = [
      compileMappingGroupTopology({ id: "", name: "Working Mapping" }, next.surfaces),
      ...(next.mappings || []).map((mapping) =>
        compileMappingGroupTopology(mapping, next.surfaces)
      ),
      compileOutputGroupTopology(),
    ].map((group) => generatedProgramPersistence(
      reconcileGeneratedProgramTopology(group, existingById.get(group.id))
    ));
    for (const group of mappingGroups) groupReplacements.set(group.id, group);
  }

  const mappingGroupIds = new Set(mappingGroups.map((group) => group.id));
  const groups = currentNodes.groups
    .filter((group) =>
      !routesChanged ||
      group.generatedBy !== MAPPING_PROGRAM_GENERATOR ||
      mappingGroupIds.has(group.id)
    )
    .map((group) => groupReplacements.get(group.id) || group);
  for (const group of mappingGroups) {
    if (!groups.some((entry) => entry.id === group.id)) groups.push(group);
  }
  const instances = currentNodes.instances.filter((instance) => {
    const id = String(instance.id || "");
    if ([...replacedComponentGroupIds].some((groupId) => id.startsWith(`${groupId}/`))) {
      return false;
    }
    return !routesChanged || instance.generatedBy !== MAPPING_PROGRAM_GENERATOR;
  });
  instances.push(
    ...reconciled.flatMap(({ group }) => componentProgramInstances(group)),
    ...mappingProgramInstances(mappingGroups),
  );
  const artifacts = currentNodes.artifacts.map((artifact) => {
    if (artifact.generatedBy !== COMPONENT_PROGRAM_GENERATOR) return artifact;
    const component = components.find((item) =>
      artifact.id === `vj1.project.${item.type === "scene" ? "scene" : "component"}.${item.id}`
    );
    return component ? {
      ...artifact,
      name: component.name || (component.type === "scene" ? "Scene" : "Component"),
    } : artifact;
  });
  return {
    ...next,
    components,
    nodes: {
      ...currentNodes,
      groups,
      instances,
      artifacts,
    },
  };
}

function prepareComponentGraphConfigurationChange(previous, next, {
  visualDefinitions = [],
} = {}) {
  if (
    previous.components?.length !== next.components?.length ||
    previous.nodes?.groups?.length !== next.nodes?.groups?.length ||
    previous.nodes?.definitions !== next.nodes?.definitions ||
    previous.nodes?.pins !== next.nodes?.pins ||
    previous.nodes?.artifacts !== next.nodes?.artifacts
  ) return null;
  const changedGroupIndexes = next.nodes.groups.flatMap((group, index) =>
    group === previous.nodes.groups[index] ? [] : [index]
  );
  if (!changedGroupIndexes.length || changedGroupIndexes.some((index) => {
    const before = previous.nodes.groups[index];
    const after = next.nodes.groups[index];
    return before?.generatedBy !== COMPONENT_PROGRAM_GENERATOR ||
      after?.generatedBy !== COMPONENT_PROGRAM_GENERATOR ||
      String(before.id || "") !== String(after.id || "") ||
      componentTopologyShape(before) !== componentTopologyShape(after);
  })) return null;

  const projectVisualDefinitions = listProjectIsfVisualComponents(next)
    .map((component) => component.nodeDefinition);
  const definitions = componentTopologyDefinitionMap({
    visualDefinitions,
    projectVisualDefinitions,
  });
  const groups = next.nodes.groups.slice();
  const components = next.components.slice();
  const changedGroupIds = new Set();
  for (const groupIndex of changedGroupIndexes) {
    const candidate = groups[groupIndex];
    const componentIndex = components.findIndex((component) =>
      String(component.id || "") === String(candidate.componentId || "")
    );
    if (componentIndex < 0) return null;
    const reconciled = reconcileComponentGroupTopology(
      components[componentIndex],
      candidate,
      { definitions },
    );
    const group = {
      ...reconciled.group,
      persistence: reconciled.group.authoredConnections === true ? "project-diff" : "compact",
    };
    // Compilation is the activation preflight. Nothing has been published yet;
    // a malformed configuration therefore leaves the previous executable
    // world and all unrelated retained programs untouched.
    const validation = compileComponentRenderPrograms(
      [reconciled.component],
      [group],
      { resolveNodeDefinition: (node) => definitions.get(String(node?.nodeId || "")) },
    );
    for (const program of validation.values()) program.dispose?.();
    groups[groupIndex] = group;
    components[componentIndex] = reconciled.component;
    changedGroupIds.add(String(group.id || ""));
  }
  const instances = next.nodes.instances.filter((instance) =>
    ![...changedGroupIds].some((groupId) => String(instance.id || "").startsWith(`${groupId}/`))
  );
  for (const group of groups) {
    if (changedGroupIds.has(String(group.id || ""))) {
      instances.push(...componentProgramInstances(group));
    }
  }
  return {
    ...next,
    components,
    nodes: {
      ...next.nodes,
      groups,
      instances,
    },
  };
}

export function ensureVj1NodeProjectData(value = {}, components = [], {
  visualDefinitions = [], projectVisualDefinitions = [], mappings = [], surfaces = [], componentGroups: preparedComponentGroups = null,
} = {}) {
  const current = normalizeNodeProjectData(value);
  const topologyDefinitions = new Map([
    ...visualDefinitions,
    ...projectVisualDefinitions,
    ...VisualStageNodeDefinitions,
    ...Scene3dNodeDefinitions,
    TerrainFlightControllerNode,
    RenderDemandNode,
    LayerGroupNode,
    VisualSourceNode,
    ...TextureOperatorNodeDefinitions,
  ].map((definition) => [definition.id, definition]));
  const componentGroups = (preparedComponentGroups || (components || []).map((component) => compileComponentGroupTopology(component, {
    definitions: topologyDefinitions,
  }))).map((group) => ({
    ...group,
    persistence: group.authoredConnections === true ? "project-diff" : "compact",
  }));
  const componentInstances = componentGroups.flatMap(componentProgramInstances);
  const requiredVisualNodeIds = new Set(componentInstances.map((instance) => instance.nodeId));
  const existingGroupsById = new Map(current.groups.map((group) => [group.id, group]));
  const mappingGroups = [
    compileMappingGroupTopology({ id: "", name: "Working Mapping" }, surfaces),
    ...(mappings || []).map((mapping) => compileMappingGroupTopology(mapping, surfaces)),
    compileOutputGroupTopology(),
  ].map((group) => generatedProgramPersistence(reconcileGeneratedProgramTopology(group, existingGroupsById.get(group.id))));
  const applicationGroup = generatedProgramPersistence(reconcileGeneratedProgramTopology(
    compileApplicationProgramTopology(),
    existingGroupsById.get("vj1.application.program")
  ));
  const applicationInstances = applicationProgramInstances(applicationGroup);
  const mappingInstances = mappingProgramInstances(mappingGroups);
  const mappingDefinitions = [SurfaceRouteNode, MappingProgramNode, OutputProgramNode, SurfaceCompositionNode, MappingEngineNode];
  const componentDefinitions = [
    ComponentProgramNode,
    LayerGroupNode,
    VisualSourceNode,
    ...TextureOperatorNodeDefinitions,
    SliderNode,
    ValueControlNode,
    ComponentTimeControlNode,
    AnimationCurveControlNode,
    AnimationSequencerControlNode,
    SegmentEnvelopeControlNode,
    OscillatorControlNode,
    PeriodicTriggerControlNode,
    RandomTriggerControlNode,
    ScalarNoiseControlNode,
    MapRangeControlNode,
    NumericCombineControlNode,
    ScalarMathControlNode,
    Vector2ControlNode,
    Vector3ControlNode,
    SmoothControlNode,
    SelectControlNode,
    FrameDelayControlNode,
    EventTriggerControlNode,
    SampleHoldControlNode,
    MidiControlInputNode,
    OscControlInputNode,
    AudioControlInputNode,
    HostControlInputNode,
    PointerControlInputNode,
    ProbeControlInputNode,
    OrbitMotionNode,
    NestedNoiseMotionNode,
  ];
  const applicationDefinitions = [
    ApplicationProgramNode,
    VisualTimeScaleNode,
    StateCommandNode,
    DataStoreNode,
    MediaInputLifecycleNode,
    LivePatchSynchronizerNode,
    SerializedStorageNode,
    CacheEngineNode,
    OutputProgramNode,
    DiagnosticsEngineNode,
  ];
  const definitions = [
    ...MODEL_PREVIEW_NODE_DEFINITIONS,
    ...componentDefinitions,
    ...mappingDefinitions,
    ...applicationDefinitions,
    ...visualDefinitions.filter((definition) => requiredVisualNodeIds.has(definition.id)),
  ].map((definition) => ({ ...serializeNodeDefinition(definition), persistence: "package" }));
  // Purge every installed library definition from legacy project snapshots,
  // including currently unused visual nodes. A real project edit is stored as
  // a fork; an exact package id/version is never project-owned data.
  const packageDefinitionKeys = new Set([...CORE_NODE_DEFINITIONS, ...visualDefinitions]
    .map((item) => `${item.id}@${item.version}`));
  const modelGroups = [Parse3dObjectGroup, Prepare3dAssetGroup, Convert3dFileToImageGroup].map(persistedGroupTopology);
  const modelGroupIds = new Set(modelGroups.map((group) => group.id));
  const groups = [
    ...current.groups.filter((group) => group.generatedBy !== COMPONENT_PROGRAM_GENERATOR && group.generatedBy !== MAPPING_PROGRAM_GENERATOR && group.generatedBy !== APPLICATION_PROGRAM_GENERATOR && !modelGroupIds.has(group.id)),
    ...componentGroups,
    ...mappingGroups,
    applicationGroup,
  ];
  const instances = [
    ...current.instances.filter((instance) => instance.generatedBy !== COMPONENT_PROGRAM_GENERATOR && instance.generatedBy !== MAPPING_PROGRAM_GENERATOR && instance.generatedBy !== APPLICATION_PROGRAM_GENERATOR),
    ...componentInstances,
    ...mappingInstances,
    ...applicationInstances,
  ];
  const componentArtifacts = (components || []).map((component) => ({
    id: `vj1.project.${component.type === "scene" ? "scene" : "component"}.${component.id}`,
    name: component.name || (component.type === "scene" ? "Scene" : "Component"),
    artifactType: component.type === "scene" ? "scene" : "component",
    implementation: { nodeType: ComponentProgramNode.id, nodeVersion: ComponentProgramNode.version },
    groupId: `vj1.component.${component.id}`,
    generatedBy: COMPONENT_PROGRAM_GENERATOR,
  }));
  return {
    ...current,
    authority: "node-graph",
    definitions: [
      ...current.definitions.filter((item) => !packageDefinitionKeys.has(`${item.id}@${item.version}`)),
      ...definitions,
    ],
    pins: mergeByKey(current.pins, [...MODEL_PREVIEW_NODE_DEFINITIONS, ...componentDefinitions, ...mappingDefinitions, ...applicationDefinitions, ...visualDefinitions.filter((definition) => requiredVisualNodeIds.has(definition.id))].map((definition) => ({
      nodeId: definition.id,
      version: definition.version,
    })), (item) => item.nodeId),
    instances: mergeByKey(instances, [{
      id: "vj1.system.model-preview",
      nodeId: Convert3dFileToImageGroup.id,
      nodeVersion: Convert3dFileToImageGroup.version,
      parameters: { profile: "thumbnail", resolution: "source", width: 100, height: 100, fit: "contain" },
      role: "system-model-preview",
    }], (item) => item.id).map((instance) => generatedInstance(instance)
      ? { ...instance, persistence: "derived" }
      : instance),
    groups: mergeByKey(groups, modelGroups, (item) => item.id),
    artifacts: mergeByKey([
      ...current.artifacts.filter((artifact) => artifact.generatedBy !== COMPONENT_PROGRAM_GENERATOR && artifact.id !== ModelPreviewPipelineArtifact.id),
      ...componentArtifacts.map((artifact) => ({ ...artifact, persistence: "derived" })),
    ], [{ ...serializeNodeArtifact(ModelPreviewPipelineArtifact), persistence: "package" }], (item) => item.id),
  };
}

function componentTopologyDefinitionMap({
  visualDefinitions = [],
  projectVisualDefinitions = [],
} = {}) {
  return new Map([
    ...visualDefinitions,
    ...projectVisualDefinitions,
    ...VisualStageNodeDefinitions,
    ...Scene3dNodeDefinitions,
    TerrainFlightControllerNode,
    RenderDemandNode,
    LayerGroupNode,
    VisualSourceNode,
    ...TextureOperatorNodeDefinitions,
  ].map((definition) => [definition.id, definition]));
}

function componentTopologyShape(group = {}) {
  const nodes = [];
  const visit = (items = []) => {
    for (const node of items) {
      nodes.push(`${node.id}:${node.nodeId}:${node.role || ""}`);
      visit(node.nodes || []);
    }
  };
  visit(group.nodes || []);
  return nodes.join("|");
}

function persistedGroupTopology(definition) {
  const graph = definition.parts.find((part) => part.kind === "graph");
  return {
    id: definition.id,
    nodeId: definition.id,
    nodeVersion: definition.version,
    nodes: graph?.nodes || [],
    connections: graph?.connections || [],
    publicInlets: graph?.publicInlets || {},
    publicOutlets: graph?.publicOutlets || {},
    persistence: "package",
  };
}

function generatedProgramPersistence(group) {
  return {
    ...group,
    persistence: group.authoredConnections === true ? "project-diff" : "derived",
  };
}

function generatedInstance(instance) {
  return instance.id === "vj1.system.model-preview" || [
    COMPONENT_PROGRAM_GENERATOR,
    MAPPING_PROGRAM_GENERATOR,
    APPLICATION_PROGRAM_GENERATOR,
  ].includes(instance.generatedBy);
}

function inheritGroupNodeLayout(group, existingGroup) {
  if (!existingGroup) return group;
  return {
    ...group,
    nodes: inheritNodeLayout(group.nodes || [], existingGroup.nodes || []),
  };
}

// Scene and Output nodes are projected from current project structure, while
// their compatible connections may be authored in the graph editor. Surviving
// relationships remain project truth; compiler defaults are added only for a
// genuinely new generated node so a newly created Surface is usable without
// resurrecting a connection the user intentionally removed.
function reconcileGeneratedProgramTopology(group, existingGroup) {
  const projected = inheritGroupNodeLayout(group, existingGroup);
  if (!existingGroup?.authoredConnections) return projected;
  const generatedNodeIds = new Set((projected.nodes || []).map((node) => String(node.id || "")));
  const existingNodeIds = new Set((existingGroup.nodes || []).map((node) => String(node.id || "")));
  const validEndpoint = (endpoint) => {
    const nodeId = String(endpoint || "").split(".")[0];
    return nodeId.startsWith("$") || generatedNodeIds.has(nodeId);
  };
  const connections = (existingGroup.connections || []).filter((edge) =>
    validEndpoint(edge.from) && validEndpoint(edge.to)
  );
  const signatures = new Set(connections.map(connectionSignature));
  for (const edge of projected.connections || []) {
    const sourceId = String(edge.from || "").split(".")[0];
    const targetId = String(edge.to || "").split(".")[0];
    const touchesNewNode = (!sourceId.startsWith("$") && !existingNodeIds.has(sourceId)) ||
      (!targetId.startsWith("$") && !existingNodeIds.has(targetId));
    const signature = connectionSignature(edge);
    const addsCompilerConnectionKind = Number(projected.topologyVersion || 0) > Number(existingGroup.topologyVersion || 0) && edge.phase === "setup";
    if ((!touchesNewNode && !addsCompilerConnectionKind) || signatures.has(signature)) continue;
    signatures.add(signature);
    connections.push(edge);
  }
  return {
    ...projected,
    connections,
    publicInlets: existingGroup.publicInlets || projected.publicInlets,
    publicOutlets: existingGroup.publicOutlets || projected.publicOutlets,
    authoredConnections: true,
  };
}

function connectionSignature(edge = {}) {
  return `${String(edge.from || "")}\u0000${String(edge.to || "")}\u0000${String(edge.type || "")}`;
}

function inheritNodeLayout(nodes, existingNodes) {
  const existingById = new Map((existingNodes || []).map((node) => [node.id, node]));
  return (nodes || []).map((node) => {
    const existing = existingById.get(node.id);
    return {
      ...node,
      ...(existing?.position ? { position: { ...existing.position } } : {}),
      ...(node.nodes ? { nodes: inheritNodeLayout(node.nodes, existing?.nodes || []) } : {}),
    };
  });
}

function mergeByKey(existing = [], required = [], keyOf) {
  const result = [...existing];
  const keys = new Set(result.map(keyOf));
  for (const item of required) {
    const key = keyOf(item);
    if (keys.has(key)) continue;
    keys.add(key);
    result.push(item);
  }
  return result;
}

function preflightGraphEdit(target = {}, graph = {}, registry) {
  if (!registry) throw new Error("NODE_GRAPH_PREFLIGHT_REGISTRY_MISSING");
  const candidateGraph = {
    nodes: Array.isArray(graph.nodes) ? graph.nodes : [],
    connections: Array.isArray(graph.connections) ? graph.connections : [],
    publicInlets: graph.publicInlets && typeof graph.publicInlets === "object"
      ? graph.publicInlets
      : {},
    publicOutlets: graph.publicOutlets && typeof graph.publicOutlets === "object"
      ? graph.publicOutlets
      : {},
  };
  if (target.kind === "project-group") {
    const candidate = { ...target.group, ...candidateGraph };
    if (candidate.componentId || candidate.kind === "visual-group") {
      const program = compileVisualRenderPlan(candidate, {}, {
        resolveDefinition: (reference) => resolveGraphDefinition(registry, null, reference),
      });
      program.dispose();
      return true;
    }
    if (candidate.id === "vj1.application.program" || candidate.nodeId === ApplicationProgramNode.id) {
      compileApplicationProgramPlan(candidate);
      return true;
    }
    if (candidate.id === "vj1.output.main" || candidate.nodeId === OutputProgramNode.id) {
      compileReachableProgramGraph(candidate, { outputs: ["$out.output"] });
      return true;
    }
    if (
      candidate.mappingId !== undefined
      || candidate.nodeId === MappingProgramNode.id
      || candidate.compiler?.target === "routing"
    ) {
      compileReachableProgramGraph(candidate, { outputs: ["$out.routes"] });
      return true;
    }
    throw new Error(`NODE_GRAPH_PREFLIGHT_COMPILER_UNAVAILABLE:${candidate.id || "missing"}`);
  }

  const definition = target.definition;
  if (!definition) throw new Error("NODE_GRAPH_PREFLIGHT_DEFINITION_MISSING");
  const materializedGraph = (definition.parts || []).find((part) => part.kind === "graph");
  const definitionGraph = {
    ...candidateGraph,
    publicInlets: materializedGraph?.publicInlets || candidateGraph.publicInlets,
    publicOutlets: materializedGraph?.publicOutlets || candidateGraph.publicOutlets,
  };
  const candidate = {
    ...definition,
    parts: (definition.parts || []).map((part) => part.kind === "graph"
      ? { ...part, ...definitionGraph }
      : part),
  };
  if (candidate.compiler?.target === "scene-3d") {
    const program = compileScene3dProgram(candidate, { registry });
    program.dispose();
    return true;
  }
  const visualCompilerHook = candidate.metadata?.visualCompilerHook;
  const textureOutput = Object.values(candidate.outlets || {})
    .find((port) => String(port?.type?.type || port?.type || "") === "texture");
  if (visualCompilerHook?.id && textureOutput) {
    const outputId = textureOutput.id || "texture";
    const node = {
      id: "$candidate",
      nodeId: candidate.id,
      nodeVersion: candidate.version,
      role: "group",
      compilerHook: visualCompilerHook,
      configuration: {
        id: "$candidate",
        kind: "source",
        enabled: true,
        opacity: 1,
        blend: "normal",
        source: {
          type: "generator",
          generatorId: candidate.metadata?.visualId || candidate.id,
          instanceId: "$candidate",
          params: {},
        },
      },
    };
    const program = compileVisualRenderPlan({
      id: `${candidate.id}.preflight`,
      nodes: [node],
      connections: [{
        from: `$candidate.${outputId}`,
        to: "$out.texture",
        type: "texture",
      }],
    }, {}, {
      resolveDefinition: (reference) => resolveGraphDefinition(registry, candidate, reference),
    });
    program.dispose();
    return true;
  }
  if (candidate.implementation?.executionModel === "graph") {
    validateNodeGraphProgramDefinition(candidate, { registry });
    return true;
  }
  if (candidate.implementation?.executionModel === "compiled-graph") {
    throw new Error(`NODE_GRAPH_PREFLIGHT_COMPILER_UNAVAILABLE:${candidate.id}`);
  }
  return true;
}

function resolveGraphDefinition(registry, candidate, reference = {}) {
  const id = String(
    typeof reference === "string"
      ? reference
      : reference.nodeId || reference.type || reference.id || ""
  );
  const version = typeof reference === "string"
    ? ""
    : String(reference.nodeVersion || reference.version || "");
  if (candidate && (id === candidate.id || id === candidate.metadata?.baseNode?.id)) return candidate;
  try {
    return registry.get(id, version);
  } catch {
    return null;
  }
}

export function createProjectArtifactCatalog(state = {}) {
  const artifacts = [];
  for (const component of state.components || []) {
    const scene = component.type === "scene";
    artifacts.push(defineNodeArtifact({
      id: `vj1.project.${scene ? "scene" : "component"}.${component.id}`,
      name: component.name || (scene ? "Scene" : "Component"),
      description: scene ? "Project Scene" : "Project Component",
      artifactType: scene ? "scene" : "component",
      implementation: {
        nodeType: scene ? ProjectSceneNode.id : ProjectComponentNode.id,
        nodeVersion: scene ? ProjectSceneNode.version : ProjectComponentNode.version,
      },
      capabilities: scene ? ["visual-program", "spatial-composition"] : ["visual-program"],
      presentation: {
        catalogs: [scene ? "scene" : "component"],
        placeableOn: scene ? ["mapping-surface", "scene-catalog"] : ["scene", "mapping-surface", "component-catalog"],
      },
      metadata: { projectId: component.id, catalogMarker: component.catalogMarker || 0 },
    }));
  }
  for (const mapping of state.mappings || []) {
    artifacts.push(defineNodeArtifact({
      id: `vj1.project.mapping.${mapping.id}`,
      name: mapping.name || "Mapping",
      description: "Project Mapping",
      artifactType: "mapping",
      implementation: { nodeType: ProjectMappingNode.id, nodeVersion: ProjectMappingNode.version },
      capabilities: ["surface-routing", "mapping"],
      presentation: { catalogs: ["mapping"], placeableOn: ["mapping-catalog"] },
      metadata: { projectId: mapping.id, catalogMarker: mapping.catalogMarker || 0 },
    }));
  }
  artifacts.push(defineNodeArtifact({
    id: "vj1.project.live",
    name: "Live",
    description: "Current Live performance state",
    artifactType: "live",
    implementation: { nodeType: ProjectLiveNode.id, nodeVersion: ProjectLiveNode.version },
    capabilities: ["performance-state"],
    presentation: { catalogs: ["live"], placeableOn: ["application"] },
    metadata: { selectedSceneId: state.ui?.live?.selectedSceneId || "" },
  }));
  return new NodeArtifactCatalog(artifacts);
}

export function projectArtifactViews(state = {}) {
  const catalog = createProjectArtifactCatalog(state);
  return Object.freeze({
    component: Object.freeze(catalog.list({ catalog: "component" })),
    scene: Object.freeze(catalog.list({ catalog: "scene" })),
    mapping: Object.freeze(catalog.list({ catalog: "mapping" })),
    liveScene: Object.freeze(catalog.list({ catalog: "scene" })),
    live: Object.freeze(catalog.list({ catalog: "live" })),
  });
}

function visualElementArtifact(component) {
  return defineNodeArtifact({
    id: `vj1.element.${component.kind}.${component.id}`,
    name: component.name,
    description: component.description,
    version: component.version,
    artifactType: "visual-element",
    implementation: { nodeType: component.nodeDefinition.id, nodeVersion: component.nodeDefinition.version },
    capabilities: component.nodeDefinition.capabilities,
    presentation: {
      catalogs: ["element-picker", component.kind, component.category],
      placeableOn: ["component-chain", "scene-chain", "node-graph"],
      hiddenFrom: ["component-catalog", "scene-catalog", "mapping-catalog", "live"],
    },
    metadata: { visualId: component.id, family: component.family, category: component.category },
  });
}

function semanticProjectNode(id, name, description, outputType) {
  return defineNode({
    id,
    name,
    version: "0.1.0",
    description,
    implementation: NODE_IMPLEMENTATION_KINDS.GROUP,
    inlets: { input: { type: outputType, optional: true } },
    outlets: { output: { type: outputType, optional: true } },
    execution: { trigger: "manual", domain: "main", stateful: true },
    capabilities: ["semantic-project-object", "expandable-group"],
    presentation: { catalogs: [], placeableOn: [], expandable: true },
  });
}
