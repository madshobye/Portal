import { defineNode, NODE_IMPLEMENTATION_KINDS } from "../../node-engine/node-definition.js";
import { defineNodeGroup } from "../../node-engine/node-group.js?v=explicit-group-compiler-public-group-ports-1";
import {
  FeatureMorphAnalysisType,
  DrawableMediaResourceType,
  GazeBlinkUniformsType,
  GeometryProviderType,
  MediaImageResourceType,
  TextMaskProviderType,
  TopologyProviderType,
  VisualCameraProviderType,
  VisualMaterialProviderType,
} from "./specialized-compound-types.js";
import { PlanarGridGeometryProviderNode } from "../providers/planar-grid/index.js?v=retained-resource-2";
import { LitMeshMaterialProviderNode } from "../providers/lit-mesh-material/index.js?v=canonical-material-1";
import { AnatomyGeometryProviderNode } from "../providers/anatomy-geometry/index.js?v=canonical-anatomy-face-4";
import { AnatomyMotionTransform3dNode } from "../providers/anatomy-motion-transform/index.js?v=anatomy-scene3d-1";
import { AnatomyMaterialPaletteNode } from "../providers/anatomy-material-palette/index.js?v=anatomy-scene3d-1";
import { TerrainHeightFieldGeometryProviderNode } from "../providers/terrain-height-field/index.js?v=semantic-terrain-node-ownership-1";
import { TerrainBiomeMaterialProviderNode } from "../providers/terrain-biome-material/index.js?v=semantic-terrain-node-ownership-1";
import { TerrainWireMaterialProviderNode } from "../providers/terrain-wire-material/index.js?v=semantic-terrain-node-ownership-1";
import { TerrainFlightCameraProviderNode } from "../providers/terrain-flight-camera/index.js?v=semantic-terrain-render-nodes-1";
import { ModelFitCameraNode } from "../providers/model-fit-camera/index.js?v=semantic-anatomy-render-node-1";
import { MeshPatternTopologyProviderNode } from "../providers/mesh-pattern-topology/index.js?v=semantic-mesh-pattern-nodes-1";
import { MeshPatternFillMaterialProviderNode } from "../providers/mesh-pattern-fill-material/index.js?v=mesh-pattern-node-authority-1";
import { MeshPatternWireMaterialProviderNode } from "../providers/mesh-pattern-wire-material/index.js?v=mesh-pattern-node-authority-1";
import {
  TerrainSurfaceToImageNode,
  TerrainWireToImageNode,
} from "../renderers/terrain-passes/index.js?v=semantic-terrain-render-nodes-1";
import {
  MeshPatternFillToImageNode,
  MeshPatternWireToImageNode,
} from "../renderers/mesh-pattern-passes/index.js?v=mesh-pattern-node-authority-1";
import { MediaImageResourceNode } from "../providers/media-image-resource/index.js?v=feature-morph-semantic-1";
import {
  MobileNetMorphAnalysisNode,
  SuperPointMorphAnalysisNode,
} from "../providers/feature-morph-analysis/index.js?v=feature-morph-semantic-1";
import { FeatureMorphToImageNode } from "../renderers/feature-morph-to-image/index.js?v=feature-morph-semantic-1";
import { TextMaskProviderNode } from "../providers/text-mask/index.js?v=text-mask-semantic-1";
import { TextMaskToImageNode } from "../renderers/text-mask-to-image/index.js?v=text-mask-semantic-1";
import { ScreenInputResourceNode } from "../providers/screen-input-resource/index.js?v=screen-input-semantic-1";
import { MediaResourceToImageNode } from "../renderers/media-resource-to-image/index.js?v=screen-input-semantic-1";
import { GazeBlinkControllerNode } from "../providers/gaze-blink-controller/index.js?v=gaze-blink-semantic-1";
import { componentFromNodeDefinition } from "./visual-node-factory.js";

export const SPECIALIZED_COMPOUND_VISUAL_COMPILER_HOOK = "vj1.visual.specialized-compound";
const EMPTY_COMPOUND_CONTEXT = Object.freeze({});
export {
  GeometryProviderType,
  AnatomyGeometryProviderNode,
  AnatomyMotionTransform3dNode,
  AnatomyMaterialPaletteNode,
  LitMeshMaterialProviderNode,
  PlanarGridGeometryProviderNode,
  TerrainHeightFieldGeometryProviderNode,
  TerrainBiomeMaterialProviderNode,
  TerrainWireMaterialProviderNode,
  TerrainFlightCameraProviderNode,
  ModelFitCameraNode,
  FeatureMorphAnalysisType,
  DrawableMediaResourceType,
  GazeBlinkUniformsType,
  FeatureMorphToImageNode,
  MediaImageResourceNode,
  MediaImageResourceType,
  MediaResourceToImageNode,
  MobileNetMorphAnalysisNode,
  MeshPatternTopologyProviderNode,
  MeshPatternFillMaterialProviderNode,
  MeshPatternWireMaterialProviderNode,
  MeshPatternFillToImageNode,
  MeshPatternWireToImageNode,
  TerrainSurfaceToImageNode,
  TerrainWireToImageNode,
  TextMaskProviderNode,
  TextMaskProviderType,
  TextMaskToImageNode,
  TopologyProviderType,
  SuperPointMorphAnalysisNode,
  ScreenInputResourceNode,
  GazeBlinkControllerNode,
  VisualCameraProviderType,
  VisualMaterialProviderType,
};

export const ProceduralGeometryProviderNode = descriptorNode({
  id: "core.visual.procedural-geometry-provider",
  name: "Procedural Geometry",
  description: "Selects a procedural geometry provider and exposes its settings independently from rendering.",
  kind: "geometry",
  outlets: { geometry: { type: GeometryProviderType } },
  capabilities: ["geometry-provider", "scene-3d", "specialized-visual-stage"],
});

export const ProceduralTopologyProviderNode = descriptorNode({
  id: "core.visual.procedural-topology-provider",
  name: "Procedural Topology",
  description: "Selects a reusable 2D topology provider independently from its material and renderer.",
  kind: "topology",
  outlets: { topology: { type: TopologyProviderType } },
  capabilities: ["topology-provider", "specialized-visual-stage"],
});

export const ShaderMaterialProviderNode = descriptorNode({
  id: "core.visual.shader-material-provider",
  name: "Shader Material",
  description: "Selects a material or shader program independently from geometry and rendering.",
  kind: "material",
  outlets: { material: { type: VisualMaterialProviderType } },
  capabilities: ["material", "shader", "specialized-visual-stage"],
});

export const VisualCameraProviderNode = descriptorNode({
  id: "core.visual.camera-provider",
  name: "Visual Camera",
  description: "Selects a camera implementation independently from geometry and rendering.",
  kind: "camera",
  outlets: { camera: { type: VisualCameraProviderType } },
  capabilities: ["camera", "scene-3d", "specialized-visual-stage"],
});

export const NativeRenderToTextureNode = descriptorNode({
  id: "core.visual.native-render-to-texture",
  name: "Native Render to Texture",
  description: "Lowers connected providers into a retained custom render operation that produces a texture.",
  kind: "render",
  inlets: {
    geometry: { type: GeometryProviderType, optional: true },
    topology: { type: TopologyProviderType, optional: true },
    material: { type: VisualMaterialProviderType, required: true },
    camera: { type: VisualCameraProviderType, optional: true },
    transform: { type: "transform3d", optional: true },
    controller: { type: "any", optional: true },
    target: { type: "texture", optional: true },
  },
  outlets: { texture: { type: "texture" } },
  capabilities: ["render-operation", "retained-render-target", "specialized-visual-stage"],
});

export const SpecializedCompoundStageNodeDefinitions = Object.freeze([
  ProceduralGeometryProviderNode,
  AnatomyGeometryProviderNode,
  AnatomyMotionTransform3dNode,
  AnatomyMaterialPaletteNode,
  PlanarGridGeometryProviderNode,
  TerrainHeightFieldGeometryProviderNode,
  ProceduralTopologyProviderNode,
  ShaderMaterialProviderNode,
  LitMeshMaterialProviderNode,
  TerrainBiomeMaterialProviderNode,
  TerrainWireMaterialProviderNode,
  TerrainFlightCameraProviderNode,
  ModelFitCameraNode,
  VisualCameraProviderNode,
  MediaImageResourceNode,
  ScreenInputResourceNode,
  GazeBlinkControllerNode,
  SuperPointMorphAnalysisNode,
  MobileNetMorphAnalysisNode,
  FeatureMorphToImageNode,
  MediaResourceToImageNode,
  MeshPatternTopologyProviderNode,
  MeshPatternFillMaterialProviderNode,
  MeshPatternWireMaterialProviderNode,
  MeshPatternFillToImageNode,
  MeshPatternWireToImageNode,
  TerrainSurfaceToImageNode,
  TerrainWireToImageNode,
  TextMaskProviderNode,
  TextMaskToImageNode,
  NativeRenderToTextureNode,
]);

export function defineSpecializedVisualCompound(component, {
  compoundKind,
  nodes,
  connections,
  output = "render.texture",
  parameterBindings = {},
  parameterPresentation = {},
  providerAlternatives = {},
  nativeRenderer = "",
  parts = component?.nodeDefinition?.parts || [],
} = {}) {
  const base = component?.nodeDefinition;
  if (!base) throw new Error(`SPECIALIZED_VISUAL_COMPOUND_BASE_MISSING:${compoundKind || "unknown"}`);
  const compiledRenderer = String(nativeRenderer || base.metadata?.nativeRenderer || "");
  const nativeStageContract = Object.freeze(Object.fromEntries((nodes || []).map((node) => [
    String(node.id || ""),
    Object.freeze({
      nodeId: String(node.type || node.nodeType || ""),
      providerId: String(node.parameters?.providerId || ""),
    }),
  ])));
  const nativeConnectionContract = Object.freeze((connections || []).map((connection) =>
    `${String(connection.from || "")}>${String(connection.to || "")}:${String(connection.type || "")}`
  ).sort());
  const definition = defineNodeGroup({
    ...base,
    executionModel: "compiled-graph",
    graphEditable: true,
    authoring: {
      activation: "recompile",
      reason: "The edited semantic graph is validated and fused back into the retained custom renderer.",
    },
    nodes,
    connections,
    publicOutlets: { texture: output },
    controlBindings: parameterBindings,
    controlPresentation: parameterPresentation,
    capabilities: [
      ...base.capabilities,
      "expandable-group",
      "compiled-fast-path",
      "specialized-visual-compound",
    ],
    presentation: {
      ...base.presentation,
      catalogs: [...new Set([...(base.presentation?.catalogs || []), "node-graph", "visual-source"])],
      placeableOn: [...new Set([...(base.presentation?.placeableOn || []), "visual-graph", "node-graph"])],
      expandable: true,
      previewOutput: "texture",
    },
    metadata: {
      ...base.metadata,
      nativeRenderer: compiledRenderer,
      visualCompilerHook: {
        id: SPECIALIZED_COMPOUND_VISUAL_COMPILER_HOOK,
        renderer: compiledRenderer,
        contract: base.metadata?.visualContract,
      },
      nativeCompound: {
        kind: String(compoundKind || base.metadata?.visualId || base.id),
        parameterBindings: Object.freeze({ ...parameterBindings }),
        output: String(output || ""),
        stageContract: nativeStageContract,
        providerAlternatives: Object.freeze(Object.fromEntries(
          Object.entries(providerAlternatives || {}).map(([stageId, alternatives]) => [
            stageId,
            Object.freeze((alternatives || []).map((alternative) => Object.freeze({
              nodeId: String(alternative.nodeId || ""),
              providerId: String(alternative.providerId || ""),
              label: String(alternative.label || alternative.providerId || alternative.nodeId || ""),
            }))),
          ]),
        )),
        connectionContract: nativeConnectionContract,
      },
    },
    parts,
  });
  return componentFromNodeDefinition(component, definition, {
    renderAuthority: "compiled-specialized-group",
  });
}

export function compileSpecializedCompoundProgram(definition, { resolveDefinition } = {}) {
  const graph = definition?.parts?.find((part) => part.kind === "graph");
  if (!graph) throw new Error(`SPECIALIZED_VISUAL_COMPOUND_GRAPH_MISSING:${definition?.id || "missing"}`);
  validateNativeCompoundShape(definition, graph);
  const byId = new Map((graph.nodes || []).map((node) => [node.id, node]));
  const incoming = new Map((graph.nodes || []).map((node) => [node.id, 0]));
  const outgoing = new Map((graph.nodes || []).map((node) => [node.id, []]));
  for (const connection of graph.connections || []) {
    const sourceId = endpointNode(connection.from);
    const targetId = endpointNode(connection.to);
    if (!byId.has(sourceId) || !byId.has(targetId)) {
      throw new Error(`SPECIALIZED_VISUAL_COMPOUND_CONNECTION_INVALID:${definition.id}:${connection.from}:${connection.to}`);
    }
    incoming.set(targetId, incoming.get(targetId) + 1);
    outgoing.get(sourceId).push(targetId);
    validateCompoundConnection(definition, connection, byId, resolveDefinition);
  }
  const queue = [...incoming].filter(([, count]) => count === 0).map(([id]) => id);
  const ordered = [];
  while (queue.length) {
    const id = queue.shift();
    ordered.push(id);
    for (const target of outgoing.get(id) || []) {
      incoming.set(target, incoming.get(target) - 1);
      if (incoming.get(target) === 0) queue.push(target);
    }
  }
  if (ordered.length !== byId.size) throw new Error(`SPECIALIZED_VISUAL_COMPOUND_CYCLE:${definition.id}`);
  const outputEndpoint = Object.values(graph.publicOutlets || {})[0];
  const outputNode = endpointNode(outputEndpoint);
  if (!outputEndpoint || !byId.has(outputNode)) {
    throw new Error(`SPECIALIZED_VISUAL_COMPOUND_OUTPUT_INVALID:${definition.id}:${outputEndpoint || "missing"}`);
  }
  const executableStages = new Map();
  const resolvedDefinitions = new Map();
  for (const id of ordered) {
    const node = byId.get(id);
    const resolvedDefinition = typeof resolveDefinition === "function"
      ? resolveDefinition({
          nodeId: node?.type || node?.nodeType,
          nodeVersion: node?.version || node?.nodeVersion,
        })
      : null;
    if (resolvedDefinition) resolvedDefinitions.set(id, resolvedDefinition);
    const executable = compileExecutableCompoundStage(node, resolveDefinition);
    if (executable) executableStages.set(id, executable);
  }
  const stages = Object.freeze(ordered.map((id) => {
    const node = byId.get(id);
    const resolvedDefinition = resolvedDefinitions.get(id);
    return Object.freeze({
      id,
      nodeId: node.type,
      nativeKernel: String(
        resolvedDefinition?.metadata?.nativeKernel ||
        resolvedDefinition?.implementation?.kernel ||
        "",
      ),
      parameters: Object.freeze({ ...(node.parameters || {}) }),
    });
  }));
  const parameterBindings = Object.freeze({ ...(definition.metadata?.nativeCompound?.parameterBindings || {}) });
  const stageDescriptors = new Map(stages.map((stage) => [
    stage.id,
    Object.freeze({
      id: stage.id,
      nodeId: stage.nodeId,
      nativeKernel: stage.nativeKernel,
      providerId: String(stage.parameters?.providerId || ""),
      enabled: stage.parameters?.enabled !== false,
      settings: Object.freeze(compoundStageAuthoredSettings(stage.parameters)),
    }),
  ]));
  const parameterProjectors = new Map(stages.map((stage) => [
    stage.id,
    compileStageParameterProjector(
      stageDescriptors.get(stage.id),
      parameterBindings[stage.id] || [],
    ),
  ]));
  const connectionPlans = new Map(ordered.map((id) => [id, []]));
  for (const connection of graph.connections || []) {
    connectionPlans.get(endpointNode(connection.to)).push(Object.freeze({
      sourceStageId: endpointNode(connection.from),
      sourcePortId: endpointPort(connection.from),
      targetPortId: endpointPort(connection.to),
    }));
  }
  for (const [id, plans] of connectionPlans) {
    connectionPlans.set(id, Object.freeze(plans));
  }
  const nativeKernels = Object.freeze(stages
    .filter((stage) => stage.nativeKernel)
    .map((stage) => Object.freeze({
      id: stage.id,
      nodeId: stage.nodeId,
      kernel: stage.nativeKernel,
      enabled: stage.parameters?.enabled !== false,
      inputBindings: Object.freeze(Object.fromEntries(
        (connectionPlans.get(stage.id) || []).map((connection) => [
          connection.targetPortId,
          Object.freeze({
            stageId: connection.sourceStageId,
            portId: connection.sourcePortId,
          }),
        ]),
      )),
      outputPorts: Object.freeze(Object.keys(
        resolvedDefinitions.get(stage.id)?.outlets || {},
      )),
    })));
  const nativeKernelById = new Map(nativeKernels.map((kernel) => [kernel.kernel, kernel]));
  const providerInputs = new Map();
  const graphEvaluations = new Map();
  return Object.freeze({
    format: "vj1.specialized-compound-program@2",
    kind: String(definition.metadata?.nativeCompound?.kind || ""),
    output: String(outputEndpoint),
    stages,
    connections: Object.freeze((graph.connections || []).map((connection) => Object.freeze({ ...connection }))),
    parameterBindings,
    executableStages: Object.freeze([...executableStages.keys()]),
    nativeKernels,
    nativeModuleDefinitions: Object.freeze(ordered.flatMap((id) => {
      const resolvedDefinition = resolvedDefinitions.get(id);
      return resolvedDefinition && (
        resolvedDefinition.parts?.length ||
        Object.keys(resolvedDefinition.moduleExports || {}).length
      )
        ? [resolvedDefinition]
        : [];
    })),
    stageDescriptor(stageId) {
      return stageDescriptors.get(String(stageId || "")) || null;
    },
    nativeKernel(kernelId) {
      return nativeKernelById.get(String(kernelId || "")) || null;
    },
    stageParameterView(stageId, authoredParameters = {}, context = {}) {
      const projector = parameterProjectors.get(String(stageId || ""));
      return projector
        ? projectStageParameterView(projector, authoredParameters, compoundInstanceId(context))
        : null;
    },
    executeStage(stageId, inputs = {}, context = {}) {
      const stage = executableStages.get(String(stageId || ""));
      return stage ? executeCompoundStage(stage, inputs, context) : null;
    },
    executeProvider(stageId, authoredParameters = {}, context = {}) {
      const id = String(stageId || "");
      const descriptor = stageDescriptors.get(id);
      const stage = executableStages.get(id);
      const projector = parameterProjectors.get(id);
      if (!descriptor || !stage || !projector) return null;
      const instanceId = compoundInstanceId(context);
      const settings = projectStageParameterView(projector, authoredParameters, instanceId);
      let stageInputs = providerInputs.get(id);
      if (!stageInputs) {
        stageInputs = new Map();
        providerInputs.set(id, stageInputs);
      }
      let inputs = stageInputs.get(instanceId);
      if (!inputs) {
        inputs = {
          providerId: descriptor.providerId,
          enabled: descriptor.enabled,
          settings,
        };
        stageInputs.set(instanceId, inputs);
      }
      inputs.providerId = descriptor.providerId;
      inputs.enabled = descriptor.enabled;
      inputs.settings = settings;
      const output = executeCompoundStage(stage, inputs, context);
      return output && typeof output === "object" ? output[stage.outputId] || null : null;
    },
    evaluateGraph(authoredParameters = {}, context = {}, externalInputs = {}) {
      const instanceId = compoundInstanceId(context);
      let evaluation = graphEvaluations.get(instanceId);
      if (!evaluation) {
        evaluation = createCompoundGraphEvaluation(instanceId, ordered);
        graphEvaluations.set(instanceId, evaluation);
      }
      for (const id of ordered) {
        const descriptor = stageDescriptors.get(id);
        const projector = parameterProjectors.get(id);
        const stage = executableStages.get(id);
        const settings = projector
          ? projectStageParameterView(projector, authoredParameters, instanceId)
          : EMPTY_COMPOUND_CONTEXT;
        const inputs = evaluation.inputRecord(id);
        resetCompoundGraphInputs(inputs, evaluation.inputKeys(id));
        inputs.providerId = descriptor?.providerId || "";
        inputs.enabled = descriptor?.enabled !== false;
        inputs.settings = settings;
        Object.assign(inputs, settings);
        for (const connection of connectionPlans.get(id) || []) {
          const value = evaluation.outputValue(
            connection.sourceStageId,
            connection.sourcePortId,
          );
          if (value === undefined) delete inputs[connection.targetPortId];
          else inputs[connection.targetPortId] = value;
        }
        const stageExternalInputs = compoundStageExternalInputs(externalInputs, id);
        Object.assign(inputs, stageExternalInputs);
        evaluation.rememberInputKeys(id, inputs);
        const output = stage
          ? executeCompoundStage(stage, inputs, context)
          : evaluation.nativeOutputRecord(id);
        evaluation.setStageOutput(id, output);
      }
      return evaluation.publicView;
    },
    dispose() {
      for (const stage of executableStages.values()) disposeExecutableCompoundStage(stage);
      executableStages.clear();
      for (const projector of parameterProjectors.values()) projector.instances.clear();
      parameterProjectors.clear();
      providerInputs.clear();
      graphEvaluations.clear();
    },
  });
}

export function executeSpecializedCompoundStage(
  operation = {},
  stageId = "",
  inputs = {},
  context = {},
) {
  const program = operation?.nativeCompoundProgram;
  if (!program || typeof program.executeStage !== "function") return null;
  return program.executeStage(stageId, inputs, context);
}

export function executeSpecializedCompoundProvider(
  operation = {},
  stageId = "",
  authoredParameters = {},
  context = {},
) {
  const program = operation?.nativeCompoundProgram;
  if (program && typeof program.executeProvider === "function") {
    return program.executeProvider(stageId, authoredParameters, context);
  }
  const descriptor = specializedCompoundStageDescriptor(operation, stageId);
  if (!descriptor) return null;
  const output = executeSpecializedCompoundStage(operation, stageId, {
    providerId: descriptor.providerId,
    enabled: descriptor.enabled,
    settings: specializedCompoundStageParameters(operation, stageId, authoredParameters),
  }, context);
  if (!output || typeof output !== "object") return null;
  return Object.values(output)[0] || null;
}

export function evaluateSpecializedCompoundGraph(
  operation = {},
  authoredParameters = {},
  context = {},
  externalInputs = {},
) {
  const program = operation?.nativeCompoundProgram;
  return typeof program?.evaluateGraph === "function"
    ? program.evaluateGraph(authoredParameters, context, externalInputs)
    : null;
}

export function specializedCompoundStageEnabled(operation = {}, stageId = "") {
  const program = operation?.nativeCompoundProgram;
  // Legacy direct invocations have no graph program. Compiled compounds always
  // carry one, so only those invocations apply authored stage switches.
  if (!program) return true;
  const stages = program.stages || [];
  for (let index = 0; index < stages.length; index += 1) {
    if (stages[index].id === stageId) return stages[index].parameters?.enabled !== false;
  }
  return false;
}

export function specializedCompoundNativeKernel(operation = {}, kernelId = "") {
  const program = operation?.nativeCompoundProgram;
  if (typeof program?.nativeKernel === "function") return program.nativeKernel(kernelId);
  return program?.nativeKernels?.find((kernel) => kernel.kernel === kernelId) || null;
}

export function specializedCompoundStageProvider(operation = {}, stageId = "", fallback = "") {
  const stage = operation?.nativeCompoundProgram?.stages?.find((item) => item.id === stageId);
  return String(stage?.parameters?.providerId || fallback || "");
}

export function specializedCompoundStageDescriptor(operation = {}, stageId = "") {
  const program = operation?.nativeCompoundProgram;
  if (typeof program?.stageDescriptor === "function") {
    return program.stageDescriptor(stageId);
  }
  const stage = program?.stages?.find((item) => item.id === stageId);
  if (!stage) return null;
  return Object.freeze({
    id: stage.id,
    nodeId: stage.nodeId,
    nativeKernel: String(stage.nativeKernel || ""),
    providerId: String(stage.parameters?.providerId || ""),
    enabled: stage.parameters?.enabled !== false,
    settings: Object.freeze(isRecord(stage.parameters?.settings)
      ? { ...stage.parameters.settings }
      : {}),
  });
}

export function specializedCompoundStageParameters(
  operation = {},
  stageId = "",
  authoredParameters = {},
) {
  const program = operation?.nativeCompoundProgram;
  if (!program) return { ...(authoredParameters || {}) };
  const descriptor = specializedCompoundStageDescriptor(operation, stageId);
  if (!descriptor) return {};
  const result = { ...descriptor.settings };
  for (const binding of program.parameterBindings?.[stageId] || []) {
    const publicParameterId = String(
      typeof binding === "string"
        ? binding
        : binding?.publicParameterId || binding?.parameterId || ""
    );
    const targetParameterId = String(
      typeof binding === "string"
        ? binding
        : binding?.targetParameterId || binding?.parameterId || publicParameterId
    );
    if (!publicParameterId || !targetParameterId || authoredParameters?.[publicParameterId] === undefined) continue;
    result[targetParameterId] = authoredParameters[publicParameterId];
  }
  return result;
}

export function specializedCompoundStageParameterView(
  operation = {},
  stageId = "",
  authoredParameters = {},
  context = {},
) {
  const program = operation?.nativeCompoundProgram;
  if (!program) return { ...(authoredParameters || {}) };
  if (typeof program.stageParameterView === "function") {
    return program.stageParameterView(stageId, authoredParameters, context);
  }
  const descriptor = specializedCompoundStageDescriptor(operation, stageId);
  if (!descriptor) return null;
  const result = { ...descriptor.settings };
  for (const binding of program.parameterBindings?.[stageId] || []) {
    const publicParameterId = String(
      typeof binding === "string"
        ? binding
        : binding?.publicParameterId || binding?.parameterId || ""
    );
    const targetParameterId = String(
      typeof binding === "string"
        ? binding
        : binding?.targetParameterId || binding?.parameterId || publicParameterId
    );
    if (!publicParameterId || !targetParameterId || authoredParameters?.[publicParameterId] === undefined) continue;
    result[targetParameterId] = authoredParameters[publicParameterId];
  }
  return result;
}

export function specializedCompoundEvaluatedStageSettings(
  operation = {},
  evaluation = null,
  stageId = "",
  authoredParameters = {},
  context = {},
) {
  const settings = evaluation?.stageInputs?.(stageId)?.settings;
  if (operation?.nativeCompoundProgram) {
    if (!isRecord(settings)) {
      throw new Error(`SPECIALIZED_COMPOUND_STAGE_SETTINGS_MISSING:${stageId || "unknown"}`);
    }
    return settings;
  }
  return isRecord(settings)
    ? settings
    : specializedCompoundStageParameterView(
      operation, stageId, authoredParameters, context,
    ) || { ...(authoredParameters || {}) };
}

export function specializedCompoundRuntimeParameters(operation = {}, authoredParameters = {}) {
  const program = operation?.nativeCompoundProgram;
  if (!program) return { ...(authoredParameters || {}) };
  const result = {};
  for (const stage of program.stages || []) {
    Object.assign(
      result,
      specializedCompoundStageParameters(operation, stage.id, authoredParameters),
    );
  }
  return result;
}

function descriptorNode({
  id,
  name,
  description,
  kind,
  providerId = "",
  inlets = {},
  outlets = {},
  capabilities = [],
}) {
  return defineNode({
    id,
    name,
    version: "0.1.0",
    description,
    implementation: NODE_IMPLEMENTATION_KINDS.DATA,
    inlets: {
      providerId: { type: "string", defaultValue: providerId },
      settings: { type: "record", defaultValue: {} },
      ...inlets,
    },
    parameters: {
      providerId: { type: "string", defaultValue: providerId },
      enabled: { type: "boolean", defaultValue: true },
      settings: { type: "record", defaultValue: {} },
    },
    outlets,
    execution: { trigger: "input-change", domain: "main", pure: true },
    capabilities: [...capabilities, "compiled-only", "compatibility-only"],
    presentation: {
      catalogs: ["migration"],
      placeableOn: [],
      hiddenFrom: ["node-library", "node-graph", "specialized-visual"],
    },
    process: (inputs, { output = {} } = {}) => {
      const port = Object.keys(outlets)[0];
      const descriptor = output[port] || {};
      descriptor.kind = kind;
      descriptor.providerId = String(inputs.providerId || "");
      descriptor.settings = inputs.settings || {};
      descriptor.enabled = inputs.enabled !== false;
      output[port] = descriptor;
      return output;
    },
  });
}

function compoundStageAuthoredSettings(parameters = {}) {
  const settings = isRecord(parameters?.settings) ? { ...parameters.settings } : {};
  for (const [id, value] of Object.entries(parameters || {})) {
    if (id === "providerId" || id === "enabled" || id === "settings" || value === undefined) continue;
    settings[id] = value;
  }
  return settings;
}

function compileExecutableCompoundStage(node, resolveDefinition) {
  if (typeof resolveDefinition !== "function") return null;
  const definition = resolveDefinition({
    nodeId: node?.type || node?.nodeType,
    nodeVersion: node?.version || node?.nodeVersion,
  });
  const capabilities = definition?.capabilities || [];
  const executableProvider = [
    "specialized-visual-provider",
    "geometry-provider",
    "topology-provider",
    "material",
    "camera",
  ].some((capability) => capabilities.includes(capability));
  if ((!capabilities.includes("controller") && !executableProvider) || typeof definition.process !== "function") {
    return null;
  }
  if (
    definition.execution?.asynchronous ||
    definition.execution?.workload === "bounded" ||
    definition.execution?.workload === "offline" ||
    definition.process.constructor?.name === "AsyncFunction"
  ) {
    throw new Error(`SPECIALIZED_VISUAL_COMPOUND_STAGE_NOT_LIVE_SAFE:${node.id}`);
  }
  const defaults = {};
  for (const [id, inlet] of Object.entries(definition.inlets || {})) {
    if (inlet.defaultValue !== undefined) defaults[id] = inlet.defaultValue;
  }
  for (const [id, parameter] of Object.entries(definition.parameters || {})) {
    if (parameter.defaultValue !== undefined) defaults[id] = parameter.defaultValue;
  }
  Object.assign(defaults, node.parameters || {});
  return {
    id: String(node.id || ""),
    definition,
    process: definition.process,
    outputId: Object.keys(definition.outlets || {})[0] || "",
    defaults,
    inputIds: Object.freeze([...new Set([
      ...Object.keys(definition.inlets || {}),
      ...Object.keys(definition.parameters || {}),
      ...Object.keys(node.parameters || {}),
    ])]),
    instances: new Map(),
  };
}

function executeCompoundStage(stage, inputs = {}, context = {}) {
  const instanceId = compoundInstanceId(context);
  let instance = stage.instances.get(instanceId);
  if (!instance) {
    const state = {};
    const output = {};
    instance = {
      state,
      output,
      inputs: { ...stage.defaults },
      processContext: {
        state,
        output,
        executionClass: "live-frame",
      },
      contextKeys: new Set(),
    };
    stage.instances.set(instanceId, instance);
  }
  for (const id of stage.inputIds) {
    if (Object.prototype.hasOwnProperty.call(stage.defaults, id)) instance.inputs[id] = stage.defaults[id];
    else delete instance.inputs[id];
  }
  Object.assign(instance.inputs, inputs || {});
  const contextRecord = isRecord(context) ? context : EMPTY_COMPOUND_CONTEXT;
  for (const key of instance.contextKeys) {
    if (!(key in contextRecord)) {
      delete instance.processContext[key];
      instance.contextKeys.delete(key);
    }
  }
  for (const key in contextRecord) {
    if (key === "state" || key === "output" || key === "instanceId" || key === "renderIdentity") continue;
    instance.processContext[key] = context[key];
    instance.contextKeys.add(key);
  }
  const result = stage.process(instance.inputs, instance.processContext);
  if (result && typeof result.then === "function") {
    throw new Error(`SPECIALIZED_VISUAL_COMPOUND_STAGE_ASYNC_RESULT:${stage.id}`);
  }
  if (result !== instance.output) retainCompoundStageOutput(instance.output, result);
  return instance.output;
}

function compileStageParameterProjector(descriptor, bindings = []) {
  const normalizedBindings = Object.freeze((bindings || []).map((binding) => {
    const publicParameterId = String(
      typeof binding === "string"
        ? binding
        : binding?.publicParameterId || binding?.parameterId || ""
    );
    const targetParameterId = String(
      typeof binding === "string"
        ? binding
        : binding?.targetParameterId || binding?.parameterId || publicParameterId
    );
    return Object.freeze({ publicParameterId, targetParameterId });
  }).filter((binding) => binding.publicParameterId && binding.targetParameterId));
  const template = { ...(descriptor?.settings || {}) };
  return {
    template: Object.freeze(template),
    defaultEntries: Object.freeze(Object.entries(template).map((entry) => Object.freeze(entry))),
    bindings: normalizedBindings,
    instances: new Map(),
  };
}

function projectStageParameterView(projector, authoredParameters, instanceId) {
  let view = projector.instances.get(instanceId);
  if (!view) {
    view = { ...projector.template };
    projector.instances.set(instanceId, view);
  }
  for (const [key, value] of projector.defaultEntries) view[key] = value;
  for (const binding of projector.bindings) {
    const value = authoredParameters?.[binding.publicParameterId];
    if (value !== undefined) view[binding.targetParameterId] = value;
    else if (!Object.prototype.hasOwnProperty.call(projector.template, binding.targetParameterId)) {
      delete view[binding.targetParameterId];
    }
  }
  return view;
}

function createCompoundGraphEvaluation(instanceId, orderedStageIds) {
  const inputs = new Map();
  const outputs = new Map();
  const nativeOutputs = new Map();
  const inputKeySets = new Map();
  for (const id of orderedStageIds) {
    inputs.set(id, {});
    outputs.set(id, null);
    nativeOutputs.set(id, {});
    inputKeySets.set(id, new Set());
  }
  const evaluation = {
    instanceId,
    inputRecord(stageId) {
      return inputs.get(String(stageId || "")) || EMPTY_COMPOUND_CONTEXT;
    },
    inputKeys(stageId) {
      return inputKeySets.get(String(stageId || "")) || new Set();
    },
    rememberInputKeys(stageId, record) {
      const keys = inputKeySets.get(String(stageId || ""));
      if (!keys) return;
      keys.clear();
      for (const key in record) keys.add(key);
    },
    nativeOutputRecord(stageId) {
      return nativeOutputs.get(String(stageId || "")) || EMPTY_COMPOUND_CONTEXT;
    },
    setStageOutput(stageId, output) {
      outputs.set(String(stageId || ""), output || null);
    },
    outputValue(stageId, portId = "") {
      const output = outputs.get(String(stageId || ""));
      if (!portId) return output || null;
      return output && typeof output === "object" ? output[portId] : undefined;
    },
  };
  evaluation.publicView = Object.freeze({
    format: "vj1.specialized-compound-evaluation@1",
    instanceId,
    stageInputs(stageId) {
      return inputs.get(String(stageId || "")) || null;
    },
    stageInput(stageId, portId) {
      return inputs.get(String(stageId || ""))?.[String(portId || "")];
    },
    stageOutputs(stageId) {
      return outputs.get(String(stageId || "")) || null;
    },
    stageOutput(stageId, portId) {
      return evaluation.outputValue(stageId, String(portId || ""));
    },
    publishNativeOutput(stageId, portId, value) {
      const id = String(stageId || "");
      const output = nativeOutputs.get(id);
      if (!output) return false;
      output[String(portId || "")] = value;
      outputs.set(id, output);
      return true;
    },
  });
  return evaluation;
}

function resetCompoundGraphInputs(inputs, keys) {
  for (const key of keys) delete inputs[key];
}

function compoundStageExternalInputs(externalInputs, stageId) {
  if (!isRecord(externalInputs)) return EMPTY_COMPOUND_CONTEXT;
  const direct = externalInputs[stageId];
  return isRecord(direct) ? direct : EMPTY_COMPOUND_CONTEXT;
}

function compoundInstanceId(context) {
  if (typeof context === "string" || typeof context === "number" || typeof context === "symbol") {
    return context;
  }
  return String(context?.instanceId || context?.renderIdentity || "default");
}

function disposeExecutableCompoundStage(stage) {
  for (const instance of stage.instances.values()) {
    try {
      stage.definition.execution?.dispose?.({
        state: instance.state,
        output: instance.output,
      });
    } catch {}
  }
  stage.instances.clear();
}

function retainCompoundStageOutput(target, source) {
  for (const key in target) {
    if (!source || typeof source !== "object" || !(key in source)) delete target[key];
  }
  if (!source || typeof source !== "object") return target;
  for (const key in source) target[key] = source[key];
  return target;
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validateCompoundConnection(definition, connection, byId, resolveDefinition) {
  if (typeof resolveDefinition !== "function") return;
  const source = resolveDefinition({ nodeId: byId.get(endpointNode(connection.from)).type });
  const target = resolveDefinition({ nodeId: byId.get(endpointNode(connection.to)).type });
  if (!source || !target) {
    throw new Error(`SPECIALIZED_VISUAL_COMPOUND_STAGE_UNKNOWN:${definition.id}:${connection.from}:${connection.to}`);
  }
  const sourcePort = source.outlets?.[endpointPort(connection.from)];
  const targetPort = target.inlets?.[endpointPort(connection.to)];
  if (!sourcePort || !targetPort) {
    throw new Error(`SPECIALIZED_VISUAL_COMPOUND_PORT_INVALID:${definition.id}:${connection.from}:${connection.to}`);
  }
  const sourceType = sourcePort.type?.type || sourcePort.type;
  const targetType = targetPort.type?.type || targetPort.type;
  if (sourceType !== targetType && sourceType !== "any" && targetType !== "any") {
    throw new Error(`SPECIALIZED_VISUAL_COMPOUND_TYPE_MISMATCH:${definition.id}:${connection.from}:${sourceType}:${connection.to}:${targetType}`);
  }
}

function validateNativeCompoundShape(definition, graph) {
  const contract = definition.metadata?.nativeCompound || {};
  const stageContract = contract.stageContract || {};
  const actualNodes = new Map((graph.nodes || []).map((node) => [String(node.id || ""), node]));
  const expectedStageIds = Object.keys(stageContract).sort();
  const actualStageIds = [...actualNodes.keys()].sort();
  if (JSON.stringify(actualStageIds) !== JSON.stringify(expectedStageIds)) {
    throw new Error(`SPECIALIZED_VISUAL_COMPOUND_TOPOLOGY_UNSUPPORTED:${definition.id}:stages`);
  }
  for (const [stageId, expected] of Object.entries(stageContract)) {
    const actual = actualNodes.get(stageId);
    const candidates = [
      expected,
      ...(contract.providerAlternatives?.[stageId] || []),
    ];
    const supported = candidates.some((candidate) =>
      String(actual?.type || actual?.nodeType || "") === String(candidate.nodeId || "")
      && String(actual?.parameters?.providerId || "") === String(candidate.providerId || ""));
    if (!supported) {
      throw new Error(`SPECIALIZED_VISUAL_COMPOUND_PROVIDER_UNSUPPORTED:${definition.id}:${stageId}`);
    }
  }
  const actualConnections = (graph.connections || []).map((connection) =>
    `${String(connection.from || "")}>${String(connection.to || "")}:${String(connection.type || "")}`
  ).sort();
  if (JSON.stringify(actualConnections) !== JSON.stringify(contract.connectionContract || [])) {
    throw new Error(`SPECIALIZED_VISUAL_COMPOUND_TOPOLOGY_UNSUPPORTED:${definition.id}:connections`);
  }
  const output = String(Object.values(graph.publicOutlets || {})[0] || "");
  if (output !== String(contract.output || "")) {
    throw new Error(`SPECIALIZED_VISUAL_COMPOUND_TOPOLOGY_UNSUPPORTED:${definition.id}:output`);
  }
}

function endpointNode(endpoint) {
  return String(endpoint || "").split(".")[0];
}

function endpointPort(endpoint) {
  return String(endpoint || "").split(".").slice(1).join(".");
}
