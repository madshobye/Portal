import { defineNodeGroup } from "../../node-engine/node-group.js?v=explicit-group-compiler-1";
import { componentFromNodeDefinition } from "./visual-node-factory.js";

export function defineCompiledVisualCompound(component, {
  nodes = [],
  connections = [],
  output = "",
  parameterBindings = {},
  parameterPresentation = {},
} = {}) {
  const base = component?.nodeDefinition;
  if (!base) throw new Error("COMPILED_VISUAL_COMPOUND_DEFINITION_MISSING");
  const outputEndpoint = String(output || "");
  if (!outputEndpoint) throw new Error(`COMPILED_VISUAL_COMPOUND_OUTPUT_MISSING:${base.id}`);
  const childNodes = nodes.map((entry) => compiledVisualChildNode(entry));
  const { nativeRenderer: _nativeRenderer, ...baseMetadata } = base.metadata || {};
  const definition = defineNodeGroup({
    ...base,
    executionModel: "compiled-graph",
    authoring: {
      activation: "recompile",
      reason: "The editable child texture graph compiles into retained render operations.",
    },
    nodes: childNodes,
    connections: [
      ...connections,
      { from: outputEndpoint, to: "$out.texture", type: "texture" },
    ],
    publicOutlets: { texture: outputEndpoint },
    controlBindings: parameterBindings,
    controlPresentation: parameterPresentation,
    parts: [],
    capabilities: [
      ...new Set([
        ...(base.capabilities || []),
        "expandable-group",
        "compiled-fast-path",
        "graph-placeable",
      ]),
    ],
    presentation: {
      ...(base.presentation || {}),
      expandable: true,
      previewOutput: "texture",
    },
    metadata: {
      ...baseMetadata,
      nativeRenderer: "",
      visualCompilerHook: {
        id: "vj1.visual.compound",
        contract: baseMetadata.visualContract,
      },
      renderAuthority: "compiled-graph",
    },
  });
  return componentFromNodeDefinition(component, definition, {
    renderAuthority: "compiled-graph",
  });
}

function compiledVisualChildNode(entry = {}) {
  const definition = entry.component?.nodeDefinition || entry.definition;
  if (!definition) throw new Error(`COMPILED_VISUAL_CHILD_DEFINITION_MISSING:${entry.id || "unknown"}`);
  const id = String(entry.id || "");
  if (!id) throw new Error(`COMPILED_VISUAL_CHILD_ID_MISSING:${definition.id}`);
  const parameters = Object.fromEntries(Object.entries(definition.parameters || {}).flatMap(([parameterId, parameter]) =>
    parameter.defaultValue === undefined ? [] : [[parameterId, parameter.defaultValue]]));
  Object.assign(parameters, entry.parameters || {});
  const kind = String(definition.metadata?.visualKind || "");
  if (entry.role === "control" || definition.capabilities?.includes("controller")) {
    return {
      id,
      type: definition.id,
      nodeId: definition.id,
      version: definition.version,
      nodeVersion: definition.version,
      role: "control",
      parameters,
    };
  }
  if (entry.role === "value" || definition.capabilities?.includes("retained-value-provider")) {
    return {
      id,
      type: definition.id,
      nodeId: definition.id,
      version: definition.version,
      nodeVersion: definition.version,
      role: "value",
      parameters,
    };
  }
  if (entry.role === "renderer") {
    const renderer = String(definition.metadata?.nativeRenderer || "");
    if (!renderer) throw new Error(`COMPILED_VISUAL_RENDERER_CAPABILITY_MISSING:${definition.id}`);
    return {
      id,
      type: definition.id,
      nodeId: definition.id,
      version: definition.version,
      nodeVersion: definition.version,
      role: "source",
      parameters,
      configuration: {
        id,
        kind: "source",
        name: definition.name,
        enabled: true,
        opacity: 1,
        blend: "normal",
        source: {
          type: "generator",
          generatorId: definition.id,
          instanceId: id,
          params: { ...parameters },
        },
      },
      compilerHook: {
        id: "vj1.visual.native-source",
        renderer,
        allocationStable: definition.metadata?.allocationStable === true,
        contract: definition.metadata?.visualContract,
      },
    };
  }
  if (kind !== "generator" && kind !== "effect") {
    throw new Error(`COMPILED_VISUAL_CHILD_KIND_UNSUPPORTED:${definition.id}:${kind || "missing"}`);
  }
  const effect = kind === "effect";
  return {
    id,
    type: definition.id,
    nodeId: definition.id,
    version: definition.version,
    nodeVersion: definition.version,
    role: effect ? "effect" : "source",
    parameters,
    configuration: effect
      ? {
          id,
          kind: "effect",
          name: definition.name,
          componentId: definition.metadata.visualId,
          enabled: true,
          opacity: 1,
          blend: "normal",
          params: { ...parameters },
        }
      : {
          id,
          kind: "source",
          name: definition.name,
          enabled: true,
          opacity: 1,
          blend: "normal",
          source: {
            type: "generator",
            generatorId: definition.metadata.visualId,
            instanceId: id,
            params: { ...parameters },
          },
        },
    compilerHook: visualChildCompilerHook(definition, effect),
  };
}

function visualChildCompilerHook(definition, effect) {
  const metadata = definition.metadata || {};
  if (effect) return {
    id: "vj1.visual.shader-effect",
    shaderInterface: metadata.shaderInterface || "effect",
    sampling: metadata.sampling || "unknown",
    fusible: metadata.fusible === true,
    roi: metadata.roi || { mode: "local", halo: 0, coordinateSpace: "boundary" },
    transformDomain: metadata.transformSource === false ? "group-field" : "composition",
    contract: metadata.visualContract,
  };
  if (metadata.nodeOwnedNativeProcess) return {
    id: "vj1.visual.source",
    renderer: "output/source:generator",
    allocationStable: metadata.allocationStableDirectPath === true,
    contract: metadata.visualContract,
  };
  return {
    id: "vj1.visual.shader-generator",
    shaderInterface: metadata.shaderInterface || "generator",
    contract: metadata.visualContract,
  };
}
