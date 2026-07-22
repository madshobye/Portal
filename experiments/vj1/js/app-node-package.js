import { defineNode, NODE_IMPLEMENTATION_KINDS, NodeRegistry } from "./libraries/node-engine/index.js";
import { defineNodeArtifact, NodeArtifactCatalog } from "./libraries/node-engine/index.js";
import { nodeEditorProjection } from "./libraries/node-engine/index.js";
import { normalizeNodeProjectData, serializeNodeArtifact, serializeNodeDefinition } from "./libraries/node-engine/index.js";
import {
  createNodePackageFromProject,
  exportNodePackage,
  importNodePackage,
  installNodePackageIntoProject,
} from "./libraries/node-engine/index.js";
import { listEffectNodeComponents, listGeneratorNodeComponents } from "./libraries/visual-nodes/index.js?v=sdf-content-editor-1";
import { SliderArtifact, SliderNode } from "./libraries/control-engine/index.js";
import { ValueControlNode } from "./libraries/control-engine/index.js";
import { CacheEngineNode } from "./libraries/cache-engine/index.js";
import { DataStoreNode } from "./libraries/data-store/index.js";
import { DiagnosticsEngineNode } from "./libraries/diagnostics-engine/index.js";
import { ImageResizeNode } from "./libraries/image-engine/index.js";
import { InstanceTimeNode, RateClockNode, VisualTimeScaleNode } from "./libraries/timing-engine/index.js";
import { MappingEngineNode } from "./libraries/mapping-engine/index.js";
import { SceneFrameGuideNode, SurfaceCompositionNode } from "./libraries/composition-engine/index.js?v=scene-frame-guide-node-1";
import {
  COMPONENT_PROGRAM_GENERATOR,
  ComponentProgramNode,
  LayerGroupNode,
  VisualSourceNode,
  compileComponentGroupTopology,
  componentProgramInstances,
  reconcileComponentGroupTopology,
} from "./libraries/composition-engine/index.js?v=mapping-order-authority-1";
import {
  MAPPING_PROGRAM_GENERATOR,
  OutputProgramNode,
  MappingProgramNode,
  SurfaceRouteNode,
  compileOutputGroupTopology,
  compileMappingGroupTopology,
  mappingProgramInstances,
} from "./libraries/composition-engine/index.js?v=mapping-order-authority-1";
import {
  APPLICATION_PROGRAM_GENERATOR,
  ApplicationProgramRuntime,
  ApplicationProgramNode,
  applicationProgramInstances,
  compileApplicationProgramPlan,
  compileApplicationProgramTopology,
} from "./libraries/composition-engine/index.js?v=mapping-order-authority-1";
import { StateCommandNode } from "./libraries/state-engine/index.js";
import { SerializedStorageNode } from "./libraries/storage-engine/index.js";
import { LivePatchSynchronizerNode } from "./libraries/synchronization-engine/index.js";
import { MediaInputLifecycleNode } from "./libraries/media-engine/index.js";
import { VisualNodeDefinitionNode } from "./libraries/visual-nodes/index.js?v=sdf-content-editor-1";
import {
  Convert3dFileToImageGroup,
  Detect3dFormatNode,
  MeshRenderNode,
  MeshResolutionNode,
  ObjParserNode,
  Parse3dObjectGroup,
  Prepare3dAssetGroup,
  StlParserNode,
} from "./libraries/mesh-engine/index.js";
import { listProjectIsfVisualComponents } from "./libraries/isf-engine/index.js?v=isf-coordinates-1";

const ProjectComponentNode = semanticProjectNode("vj1.project.component", "Component", "A task-oriented visual program composed from reusable nodes.", "texture");
const ProjectSceneNode = semanticProjectNode("vj1.project.scene", "Scene", "A spatial visual program containing reusable Components and Frames.", "texture");
const ProjectMappingNode = semanticProjectNode("vj1.project.mapping", "Mapping", "A routing program that assigns Scene Frames to physical surfaces.", "texture");
const ProjectLiveNode = semanticProjectNode("vj1.project.live", "Live", "The active performance projection of a selected Scene.", "event");

const CORE_NODE_DEFINITIONS = Object.freeze([
  SliderNode,
  ValueControlNode,
  CacheEngineNode,
  DataStoreNode,
  DiagnosticsEngineNode,
  ImageResizeNode,
  RateClockNode,
  VisualTimeScaleNode,
  InstanceTimeNode,
  MappingEngineNode,
  SurfaceCompositionNode,
  SceneFrameGuideNode,
  ComponentProgramNode,
  LayerGroupNode,
  VisualSourceNode,
  SurfaceRouteNode,
  MappingProgramNode,
  OutputProgramNode,
  ApplicationProgramNode,
  StateCommandNode,
  SerializedStorageNode,
  LivePatchSynchronizerNode,
  MediaInputLifecycleNode,
  VisualNodeDefinitionNode,
  Detect3dFormatNode,
  StlParserNode,
  ObjParserNode,
  Parse3dObjectGroup,
  MeshResolutionNode,
  MeshRenderNode,
  Prepare3dAssetGroup,
  Convert3dFileToImageGroup,
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
  const registry = new NodeRegistry([
    ...CORE_NODE_DEFINITIONS,
    ...visualDefinitions,
  ]);
  const artifacts = new NodeArtifactCatalog([
    SliderArtifact,
    ...visualComponents.map(visualElementArtifact),
  ]);
  const applicationProgram = compileApplicationProgramTopology();
  let activeApplicationProgram = null;
  const prepareProjectState = (state) => prepareVj1NodeProjectState(state, {
    visualDefinitions,
  });
  const applicationProgramForState = (state = {}) => (state?.nodes?.groups || [])
    .find((group) => group.id === applicationProgram.id) || applicationProgram;
  const createApplicationRuntime = ({ group = applicationProgram, ...options } = {}) => {
    const runtime = new ApplicationProgramRuntime(group, { registry, ...options });
    activeApplicationProgram = group;
    return runtime;
  };
  return Object.freeze({
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
    editorProjection: (definition, options = {}) => nodeEditorProjection(definition, { nodeRegistry: registry, ...options }),
  });
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
    LayerGroupNode,
    VisualSourceNode,
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
  return {
    ...state,
    components,
    nodes: ensureVj1NodeProjectData(currentNodes, components, {
      visualDefinitions,
      projectVisualDefinitions,
      mappings: state?.mappings,
      surfaces: state?.surfaces,
      componentGroups,
    }),
  };
}

export function ensureVj1NodeProjectData(value = {}, components = [], {
  visualDefinitions = [], projectVisualDefinitions = [], mappings = [], surfaces = [], componentGroups: preparedComponentGroups = null,
} = {}) {
  const current = normalizeNodeProjectData(value);
  const topologyDefinitions = new Map([
    ...visualDefinitions,
    ...projectVisualDefinitions,
    LayerGroupNode,
    VisualSourceNode,
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
  const componentDefinitions = [ComponentProgramNode, LayerGroupNode, VisualSourceNode, SliderNode, ValueControlNode];
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
