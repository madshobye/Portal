import {
  createVisualNode,
  textureInlet,
  textureOutlet,
  textureRenderContract,
} from "../libraries/visual-nodes/shared/component-schema.js";
import {
  getEffectNodeComponent as getShaderComponent,
  getGeneratorNodeComponent as getGeneratorComponent,
} from "../libraries/visual-nodes/index.js";
import { passParams } from "./shader-scheduler.js";

// Explicit compatibility projection for pre-graph tests and migrations. Output
// and Preview never import this module; production rendering compiles the saved
// visual Group through component-program-compiler instead.
export function compileComponentPatch(component = {}, renderRequest = {}, resolvers = {}) {
  const request = normalizePatchRenderRequest(renderRequest);
  const outputId = `${component.id || "component"}:output`;
  const graph = graphForComponentChain(component, request, outputId, resolvers);
  const outputNode = {
    id: outputId,
    componentId: "output.texture",
    kind: "output",
    role: "output",
    enabled: true,
    inlets: graph.outputInlets.length
      ? graph.outputInlets
      : [textureInlet("texture", "Texture")],
    outlets: [textureOutlet("texture", "Texture")],
    params: {},
    render: textureRenderContract(),
    state: {
      renderRequest: request,
      compositor: {
        type: graph.branchCount > 1 ? "layered" : "passthrough",
        inputCount: graph.outputInlets.length || 1,
        branches: graph.branches,
      },
    },
    scheduler: "frame",
  };
  return {
    id: `${component.id || "component"}:patch`,
    type: graph.branchCount > 1 ? "layered-component" : "linear-component",
    mode: "legacy-chain-projection",
    renderRequest: request,
    branches: graph.branches,
    nodes: [...graph.nodes, outputNode],
    edges: graph.edges,
  };
}

export function flattenComponentChain(chain = []) {
  const flat = [];
  for (const item of chain || []) {
    if (item.enabled === false) continue;
    if (item.kind === "group") {
      flat.push(...flattenComponentChain(item.chain || []));
      continue;
    }
    flat.push(item);
  }
  return flat;
}

function graphForComponentChain(component, request, outputId, resolvers) {
  const chain = (component.chain || []).filter((item) => item.enabled !== false);
  const nodes = chain
    .map((item, index) => chainNodeForItem(component, item, index, resolvers))
    .filter(Boolean)
    .map((node) => withRenderRequest(node, request));
  const edges = [];
  for (let index = 0; index < nodes.length - 1; index++) {
    edges.push(textureEdge(nodes[index].id, nodes[index + 1].id));
  }
  if (nodes.length) {
    edges.push(textureEdge(
      nodes[nodes.length - 1].id,
      outputId,
      "texture",
      "texture",
    ));
  }
  return {
    nodes,
    edges,
    outputInlets: [textureInlet("texture", "Texture")],
    branchCount: 1,
    branches: nodes.length ? [{
      index: 1,
      inletId: "texture",
      sourceNodeId: nodes[0]?.id || "",
      terminalNodeId: nodes[nodes.length - 1]?.id || "",
      layer: null,
    }] : [],
  };
}

function textureEdge(fromId, toId, outletId = "texture", inletId = "texture") {
  return {
    from: { nodeId: fromId, outletId },
    to: { nodeId: toId, inletId },
    type: "texture",
  };
}

function chainNodeForItem(component, item, index, resolvers = {}) {
  if (item.kind === "effect") {
    return effectNodeForPass(component, {
      id: item.componentId,
      enabled: item.enabled,
      params: item.params,
      transform: item.transform,
      opacity: item.opacity,
      blend: item.blend,
    }, index, resolvers.getEffectComponent);
  }
  if (item.kind === "group") {
    return createVisualNode(groupComponentFor(), {
      id: `${component.id || "component"}:group:${index}:${item.id}`,
      role: "group",
      enabled: item.enabled !== false,
      params: { items: flattenComponentChain(item.chain || []).length },
      state: {
        group: {
          id: item.id,
          name: item.name || "Group",
          itemCount: flattenComponentChain(item.chain || []).length,
        },
        layer: layerStateForItem(item),
      },
    });
  }
  const sourceComponent = sourceComponentFor(
    item.source,
    resolvers.getGeneratorComponent,
  );
  if (!sourceComponent) return null;
  return createVisualNode(sourceComponent, {
    id: `${sourceComponent.id || "component"}:source:${index}:${item.id}`,
    role: "source",
    enabled: item.enabled !== false,
    params: sourceParams(item.source),
    state: {
      source: item.source,
      layer: layerStateForItem(item),
    },
  });
}

function groupComponentFor() {
  return {
    id: "structure.group",
    kind: "group",
    family: "structure",
    name: "Group",
    processor: "group",
    scheduler: "frame",
    inlets: [textureInlet("texture", "Texture")],
    outlets: [textureOutlet("texture", "Texture")],
    params: [],
    render: textureRenderContract(),
  };
}

function normalizePatchRenderRequest(request = {}) {
  const width = Math.max(1, Math.floor(Number(request.width) || 1));
  const height = Math.max(1, Math.floor(Number(request.height) || 1));
  return {
    ...request,
    role: request.role || "texture",
    width,
    height,
  };
}

function withRenderRequest(node, request) {
  return {
    ...node,
    state: {
      ...(node.state || {}),
      renderRequest: request,
    },
  };
}

function effectNodeForPass(
  ownerComponent,
  pass,
  index,
  getEffectComponent = getShaderComponent,
) {
  let effectComponent = null;
  try {
    effectComponent = getEffectComponent(pass.id);
  } catch {
    return null;
  }
  if (!effectComponent) return null;
  return createVisualNode(effectComponent, {
    id: `${ownerComponent.id || "component"}:effect:${index}:${pass.id}`,
    role: "effect",
    enabled: pass.enabled !== false,
    params: passParams(effectComponent, pass),
    state: {
      transform: pass.transform || {},
      layer: layerStateForItem(pass),
      pass: {
        id: pass.id,
        enabled: pass.enabled !== false,
        params: passParams(effectComponent, pass),
        transform: pass.transform || {},
        opacity: pass.opacity ?? 1,
        blend: pass.blend || "normal",
      },
    },
  });
}

function sourceComponentFor(source = {}, resolveGenerator = getGeneratorComponent) {
  if (source.type === "generator") {
    try {
      return resolveGenerator(source.generatorId);
    } catch {
      return null;
    }
  }
  return {
    id: `source.${source.type || "black"}`,
    kind: "source",
    family: "source",
    name: source.type || "Source",
    processor: source.type || "source",
    scheduler: "frame",
    inlets: [textureInlet("image", "Image")],
    outlets: [textureOutlet("texture", "Texture")],
    params: [],
  };
}

function sourceParams(source = {}) {
  if (source.type !== "generator") return {};
  return {
    generatorId: source.generatorId,
    ...(source.params && typeof source.params === "object"
      ? source.params
      : {}),
  };
}

function layerStateForItem(item = {}) {
  return {
    id: item.id || "",
    name: item.name || item.componentId || "Layer",
    opacity: item.opacity ?? 1,
    blend: item.blend || "normal",
    transform: item.transform || {},
  };
}
