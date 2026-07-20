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
import { listEffectNodeComponents, listGeneratorNodeComponents } from "./libraries/visual-nodes/index.js?v=node-catalog-13";
import { SliderArtifact, SliderNode } from "./libraries/control-engine/index.js";
import { ValueControlNode } from "./libraries/control-engine/index.js";
import { CacheEngineNode } from "./libraries/cache-engine/index.js";
import { DataStoreNode } from "./libraries/data-store/index.js";
import { DiagnosticsEngineNode } from "./libraries/diagnostics-engine/index.js";
import { ImageResizeNode } from "./libraries/image-engine/index.js";
import { InstanceTimeNode, RateClockNode, VisualTimeScaleNode } from "./libraries/timing-engine/index.js";
import { MappingEngineNode } from "./libraries/mapping-engine/index.js";
import { SurfaceCompositionNode } from "./libraries/composition-engine/index.js";
import {
  COMPONENT_PROGRAM_GENERATOR,
  ComponentProgramNode,
  LayerGroupNode,
  VisualSourceNode,
  compileComponentGroupTopology,
  componentProgramInstances,
  reconcileComponentGroupTopology,
} from "./libraries/composition-engine/index.js";
import {
  SCENE_PROGRAM_GENERATOR,
  OutputProgramNode,
  SceneProgramNode,
  SurfaceRouteNode,
  compileOutputGroupTopology,
  compileSceneGroupTopology,
  sceneProgramInstances,
} from "./libraries/composition-engine/index.js";
import {
  APPLICATION_PROGRAM_GENERATOR,
  ApplicationProgramRuntime,
  ApplicationProgramNode,
  applicationProgramInstances,
  compileApplicationProgramPlan,
  compileApplicationProgramTopology,
} from "./libraries/composition-engine/index.js";
import { StateCommandNode } from "./libraries/state-engine/index.js";
import { SerializedStorageNode } from "./libraries/storage-engine/index.js";
import { LivePatchSynchronizerNode } from "./libraries/synchronization-engine/index.js";
import { MediaInputLifecycleNode } from "./libraries/media-engine/index.js";
import { VisualNodeDefinitionNode } from "./libraries/visual-nodes/index.js?v=node-catalog-13";
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

const ProjectComponentNode = semanticProjectNode("vj1.project.component", "Component", "A task-oriented visual program composed from reusable nodes.", "texture");
const ProjectCanvasNode = semanticProjectNode("vj1.project.canvas", "Canvas", "A spatial visual program containing reusable Components and elements.", "texture");
const ProjectSceneNode = semanticProjectNode("vj1.project.scene", "Scene", "A routing and mapping program that assigns Components to output surfaces.", "texture");
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
  ComponentProgramNode,
  LayerGroupNode,
  VisualSourceNode,
  SurfaceRouteNode,
  SceneProgramNode,
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
  ProjectCanvasNode,
  ProjectSceneNode,
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
    hiddenFrom: ["component-catalog", "canvas-catalog", "element-picker", "scene-catalog", "live"],
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
  const topologyDefinitions = new Map([
    ...visualDefinitions,
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
      scenes: state?.scenes,
      surfaces: state?.surfaces,
      componentGroups,
    }),
  };
}

export function ensureVj1NodeProjectData(value = {}, components = [], {
  visualDefinitions = [], scenes = [], surfaces = [], componentGroups: preparedComponentGroups = null,
} = {}) {
  const current = normalizeNodeProjectData(value);
  const topologyDefinitions = new Map([
    ...visualDefinitions,
    LayerGroupNode,
    VisualSourceNode,
  ].map((definition) => [definition.id, definition]));
  const componentGroups = preparedComponentGroups || (components || []).map((component) => compileComponentGroupTopology(component, {
    definitions: topologyDefinitions,
  }));
  const componentInstances = componentGroups.flatMap(componentProgramInstances);
  const requiredVisualNodeIds = new Set(componentInstances.map((instance) => instance.nodeId));
  const existingGroupsById = new Map(current.groups.map((group) => [group.id, group]));
  const sceneGroups = [
    compileSceneGroupTopology({ id: "", name: "Working Scene" }, surfaces),
    ...(scenes || []).map((scene) => compileSceneGroupTopology(scene, surfaces)),
    compileOutputGroupTopology(),
  ].map((group) => reconcileGeneratedProgramTopology(group, existingGroupsById.get(group.id)));
  const applicationGroup = reconcileGeneratedProgramTopology(
    compileApplicationProgramTopology(),
    existingGroupsById.get("vj1.application.program")
  );
  const applicationInstances = applicationProgramInstances(applicationGroup);
  const sceneInstances = sceneProgramInstances(sceneGroups);
  const sceneDefinitions = [SurfaceRouteNode, SceneProgramNode, OutputProgramNode, SurfaceCompositionNode, MappingEngineNode];
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
    ...sceneDefinitions,
    ...applicationDefinitions,
    ...visualDefinitions.filter((definition) => requiredVisualNodeIds.has(definition.id)),
  ].map(serializeNodeDefinition);
  const modelGroups = [Parse3dObjectGroup, Prepare3dAssetGroup, Convert3dFileToImageGroup].map(persistedGroupTopology);
  const groups = [
    ...current.groups.filter((group) => group.generatedBy !== COMPONENT_PROGRAM_GENERATOR && group.generatedBy !== SCENE_PROGRAM_GENERATOR && group.generatedBy !== APPLICATION_PROGRAM_GENERATOR),
    ...componentGroups,
    ...sceneGroups,
    applicationGroup,
  ];
  const instances = [
    ...current.instances.filter((instance) => instance.generatedBy !== COMPONENT_PROGRAM_GENERATOR && instance.generatedBy !== SCENE_PROGRAM_GENERATOR && instance.generatedBy !== APPLICATION_PROGRAM_GENERATOR),
    ...componentInstances,
    ...sceneInstances,
    ...applicationInstances,
  ];
  const componentArtifacts = (components || []).map((component) => ({
    id: `vj1.project.${component.type === "canvas" ? "canvas" : "component"}.${component.id}`,
    name: component.name || (component.type === "canvas" ? "Canvas" : "Component"),
    artifactType: component.type === "canvas" ? "canvas" : "component",
    implementation: { nodeType: ComponentProgramNode.id, nodeVersion: ComponentProgramNode.version },
    groupId: `vj1.component.${component.id}`,
    generatedBy: COMPONENT_PROGRAM_GENERATOR,
  }));
  return {
    ...current,
    authority: "node-graph",
    definitions: mergeByKey(current.definitions, definitions, (item) => `${item.id}@${item.version}`),
    pins: mergeByKey(current.pins, [...MODEL_PREVIEW_NODE_DEFINITIONS, ...componentDefinitions, ...sceneDefinitions, ...applicationDefinitions, ...visualDefinitions.filter((definition) => requiredVisualNodeIds.has(definition.id))].map((definition) => ({
      nodeId: definition.id,
      version: definition.version,
    })), (item) => item.nodeId),
    instances: mergeByKey(instances, [{
      id: "vj1.system.model-preview",
      nodeId: Convert3dFileToImageGroup.id,
      nodeVersion: Convert3dFileToImageGroup.version,
      parameters: { profile: "thumbnail", resolution: "source", width: 100, height: 100, fit: "contain" },
      role: "system-model-preview",
    }], (item) => item.id),
    groups: mergeByKey(groups, modelGroups, (item) => item.id),
    artifacts: mergeByKey([
      ...current.artifacts.filter((artifact) => artifact.generatedBy !== COMPONENT_PROGRAM_GENERATOR),
      ...componentArtifacts,
    ], [serializeNodeArtifact(ModelPreviewPipelineArtifact)], (item) => item.id),
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
  };
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
    const canvas = component.type === "canvas";
    artifacts.push(defineNodeArtifact({
      id: `vj1.project.${canvas ? "canvas" : "component"}.${component.id}`,
      name: component.name || (canvas ? "Canvas" : "Component"),
      description: canvas ? "Project Canvas" : "Project Component",
      artifactType: canvas ? "canvas" : "component",
      implementation: {
        nodeType: canvas ? ProjectCanvasNode.id : ProjectComponentNode.id,
        nodeVersion: canvas ? ProjectCanvasNode.version : ProjectComponentNode.version,
      },
      capabilities: canvas ? ["visual-program", "spatial-composition"] : ["visual-program"],
      presentation: {
        catalogs: [canvas ? "canvas" : "component"],
        placeableOn: canvas ? ["scene-surface", "canvas-catalog"] : ["canvas", "scene-surface", "component-catalog"],
      },
      metadata: { projectId: component.id, catalogMarker: component.catalogMarker || 0 },
    }));
  }
  for (const scene of state.scenes || []) {
    artifacts.push(defineNodeArtifact({
      id: `vj1.project.scene.${scene.id}`,
      name: scene.name || "Scene",
      description: "Project Scene",
      artifactType: "scene",
      implementation: { nodeType: ProjectSceneNode.id, nodeVersion: ProjectSceneNode.version },
      capabilities: ["surface-routing", "mapping"],
      presentation: { catalogs: ["scene", "live-scene"], placeableOn: ["scene-catalog", "live"] },
      metadata: { projectId: scene.id, catalogMarker: scene.catalogMarker || 0 },
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
    canvas: Object.freeze(catalog.list({ catalog: "canvas" })),
    scene: Object.freeze(catalog.list({ catalog: "scene" })),
    liveScene: Object.freeze(catalog.list({ catalog: "live-scene" })),
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
      placeableOn: ["component-chain", "canvas-chain", "node-graph"],
      hiddenFrom: ["component-catalog", "canvas-catalog", "scene-catalog", "live"],
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
