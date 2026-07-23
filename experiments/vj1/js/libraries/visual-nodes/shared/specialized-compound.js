import { defineNode, NODE_IMPLEMENTATION_KINDS } from "../../node-engine/node-definition.js";
import { defineNodeGroup } from "../../node-engine/node-group.js?v=explicit-group-compiler-public-group-ports-1";
import { valueType } from "../../node-engine/node-types.js";
import { componentFromNodeDefinition } from "./visual-node-factory.js";

export const SPECIALIZED_COMPOUND_VISUAL_COMPILER_HOOK = "vj1.visual.specialized-compound";

export const GeometryProviderType = valueType("geometry-provider", {
  contractVersion: 1,
  description: "A declarative geometry-producing stage lowered by a specialized visual compiler.",
});

export const TopologyProviderType = valueType("topology-provider", {
  contractVersion: 1,
  description: "A declarative 2D topology-producing stage lowered by a specialized visual compiler.",
});

export const VisualMaterialProviderType = valueType("visual-material-provider", {
  contractVersion: 1,
  description: "A reusable material and shader-program selection for a compiled visual stage.",
});

export const VisualCameraProviderType = valueType("visual-camera-provider", {
  contractVersion: 1,
  description: "A reusable camera contract for a compiled visual stage.",
});

export const ProceduralGeometryProviderNode = descriptorNode({
  id: "core.visual.procedural-geometry-provider",
  name: "Procedural Geometry",
  description: "Selects a procedural geometry provider and exposes its settings independently from rendering.",
  kind: "geometry",
  outlets: { geometry: { type: GeometryProviderType } },
  capabilities: ["geometry-provider", "scene-3d", "specialized-visual-stage"],
});

export const PlanarGridGeometryProviderNode = descriptorNode({
  id: "core.visual.planar-grid-geometry-provider",
  name: "Planar Grid Geometry",
  description: "Produces a reusable flat grid geometry contract for retained 3D renderers.",
  kind: "geometry",
  providerId: "planar-grid",
  outlets: { geometry: { type: GeometryProviderType } },
  capabilities: ["geometry-provider", "scene-3d", "specialized-visual-stage", "planar-grid"],
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
  PlanarGridGeometryProviderNode,
  ProceduralTopologyProviderNode,
  ShaderMaterialProviderNode,
  VisualCameraProviderNode,
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
  parts = component?.nodeDefinition?.parts || [],
} = {}) {
  const base = component?.nodeDefinition;
  if (!base) throw new Error(`SPECIALIZED_VISUAL_COMPOUND_BASE_MISSING:${compoundKind || "unknown"}`);
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
      visualCompilerHook: {
        id: SPECIALIZED_COMPOUND_VISUAL_COMPILER_HOOK,
        renderer: base.metadata?.nativeRenderer,
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
  return Object.freeze({
    format: "vj1.specialized-compound-program@1",
    kind: String(definition.metadata?.nativeCompound?.kind || ""),
    output: String(outputEndpoint),
    stages: Object.freeze(ordered.map((id) => {
      const node = byId.get(id);
      return Object.freeze({
        id,
        nodeId: node.type,
        parameters: Object.freeze({ ...(node.parameters || {}) }),
      });
    })),
    connections: Object.freeze((graph.connections || []).map((connection) => Object.freeze({ ...connection }))),
    parameterBindings: Object.freeze({ ...(definition.metadata?.nativeCompound?.parameterBindings || {}) }),
  });
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

export function specializedCompoundStageProvider(operation = {}, stageId = "", fallback = "") {
  const stage = operation?.nativeCompoundProgram?.stages?.find((item) => item.id === stageId);
  return String(stage?.parameters?.providerId || fallback || "");
}

export function specializedCompoundStageDescriptor(operation = {}, stageId = "") {
  const stage = operation?.nativeCompoundProgram?.stages?.find((item) => item.id === stageId);
  if (!stage) return null;
  return Object.freeze({
    id: stage.id,
    nodeId: stage.nodeId,
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
    const parameterId = String(
      typeof binding === "string"
        ? binding
        : binding?.publicParameterId || binding?.parameterId || ""
    );
    if (!parameterId || authoredParameters?.[parameterId] === undefined) continue;
    result[parameterId] = authoredParameters[parameterId];
  }
  return result;
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
    capabilities: [...capabilities, "graph-placeable", "compiled-only"],
    presentation: {
      catalogs: ["node-graph", "specialized-visual"],
      placeableOn: ["native-visual-graph"],
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
