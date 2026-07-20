import { defineNode, NODE_IMPLEMENTATION_KINDS, NodeRegistry } from "./libraries/node-engine/index.js";
import { defineNodeArtifact, NodeArtifactCatalog } from "./libraries/node-engine/index.js";
import { nodeEditorProjection } from "./libraries/node-engine/index.js";
import { normalizeNodeProjectData, serializeNodeArtifact, serializeNodeDefinition } from "./libraries/node-engine/index.js";
import { listEffectNodeComponents, listGeneratorNodeComponents } from "./libraries/visual-nodes/index.js";
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
  compileApplicationProgramTopology,
} from "./libraries/composition-engine/index.js";
import { StateCommandNode } from "./libraries/state-engine/index.js";
import { SerializedStorageNode } from "./libraries/storage-engine/index.js";
import { LivePatchSynchronizerNode } from "./libraries/synchronization-engine/index.js";
import { MediaInputLifecycleNode } from "./libraries/media-engine/index.js";
import { VisualNodeDefinitionNode } from "./libraries/visual-nodes/index.js";
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
  return Object.freeze({
    id: "vj1.application",
    version: "0.1.0",
    registry,
    artifacts,
    applicationProgram,
    createApplicationRuntime: (options = {}) => new ApplicationProgramRuntime(applicationProgram, {
      registry,
      ...options,
    }),
    projectArtifacts: (state) => createProjectArtifactCatalog(state),
    projectViews: (state) => projectArtifactViews(state),
    prepareProjectState: (state) => ({
      ...state,
      nodes: ensureVj1NodeProjectData(state?.nodes, state?.components, {
        visualDefinitions,
        scenes: state?.scenes,
        surfaces: state?.surfaces,
      }),
    }),
    editorProjection: (definition, options = {}) => nodeEditorProjection(definition, { nodeRegistry: registry, ...options }),
  });
}

export function ensureVj1NodeProjectData(value = {}, components = [], {
  visualDefinitions = [], scenes = [], surfaces = [],
} = {}) {
  const current = normalizeNodeProjectData(value);
  const topologyDefinitions = new Map([
    ...visualDefinitions,
    LayerGroupNode,
    VisualSourceNode,
  ].map((definition) => [definition.id, definition]));
  const componentGroups = (components || []).map((component) => compileComponentGroupTopology(component, {
    definitions: topologyDefinitions,
  }));
  const componentInstances = componentGroups.flatMap(componentProgramInstances);
  const requiredVisualNodeIds = new Set(componentInstances.map((instance) => instance.nodeId));
  const sceneGroups = [
    compileSceneGroupTopology({ id: "", name: "Working Scene" }, surfaces),
    ...(scenes || []).map((scene) => compileSceneGroupTopology(scene, surfaces)),
    compileOutputGroupTopology(),
  ];
  const applicationGroup = compileApplicationProgramTopology();
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
