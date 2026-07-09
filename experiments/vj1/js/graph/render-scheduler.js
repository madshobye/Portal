import { createVisualNode, normalizeParamValues, paramValue, textureInlet, textureOutlet, textureRenderContract } from "./component-schema.js";
import { getGeneratorComponent } from "./generator-registry.js";
import { getShaderComponent } from "../shaders/shader-registry.js";

export function compileCompositionPatch(composition = {}, renderRequest = {}) {
  const request = normalizePatchRenderRequest(renderRequest);
  const outputId = `${composition.id || "composition"}:output`;
  const graph = Array.isArray(composition.chain) && composition.chain.length
    ? graphForCompositionChain(composition, request, outputId)
    : graphForLegacyComposition(composition, request, outputId);
  const outputNode = {
    id: outputId,
    componentId: "output.texture",
    kind: "output",
    role: "output",
    enabled: true,
    inlets: graph.outputInlets.length ? graph.outputInlets : [textureInlet("texture", "Texture")],
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
  const nodes = [...graph.nodes, outputNode];
  return {
    id: `${composition.id || "composition"}:patch`,
    type: graph.branchCount > 1 ? "layered-composition" : "linear-composition",
    mode: "hardconfigured",
    renderRequest: request,
    branches: graph.branches,
    nodes,
    edges: graph.edges,
  };
}

function graphForCompositionChain(composition, request, outputId) {
  const nodes = [];
  const edges = [];
  const outputInlets = [];
  const branches = [];
  let branchCount = 0;
  let previous = null;
  let branchSource = null;

  const connectToOutput = () => {
    if (!previous) return;
    const inletId = `texture-${branchCount}`;
    outputInlets.push(textureInlet(inletId, `Texture ${branchCount}`));
    edges.push(textureEdge(previous.id, outputId, "texture", inletId));
    branches.push({
      index: branchCount,
      inletId,
      sourceNodeId: branchSource?.id || "",
      terminalNodeId: previous.id,
      layer: branchSource?.state?.layer || null,
    });
    previous = null;
    branchSource = null;
  };

  for (const [index, item] of (composition.chain || []).entries()) {
    const node = withRenderRequest(chainNodeForItem(composition, item, index), request);
    nodes.push(node);
    if (node.role === "source") {
      connectToOutput();
      branchCount++;
      previous = node;
      branchSource = node;
      continue;
    }
    if (node.role === "effect" && previous) {
      edges.push(textureEdge(previous.id, node.id));
      previous = node;
    }
  }
  connectToOutput();

  return {
    nodes,
    edges,
    outputInlets,
    branchCount: Math.max(1, branchCount),
    branches,
  };
}

function graphForLegacyComposition(composition, request, outputId) {
  const nodes = legacyNodesForComposition(composition).map((node) => withRenderRequest(node, request));
  const edges = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push(textureEdge(nodes[i].id, nodes[i + 1].id));
  }
  if (nodes.length) edges.push(textureEdge(nodes[nodes.length - 1].id, outputId));
  return {
    nodes,
    edges,
    outputInlets: [textureInlet("texture-1", "Texture 1")],
    branchCount: 1,
    branches: nodes.length ? [{
      index: 1,
      inletId: "texture-1",
      sourceNodeId: nodes[0]?.id || "",
      terminalNodeId: nodes[nodes.length - 1]?.id || "",
      layer: nodes[0]?.state?.layer || null,
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

function legacyNodesForComposition(composition = {}) {
  const sourceComponent = sourceComponentFor(composition.source);
  const sourceNode = createVisualNode(sourceComponent, {
    id: `${composition.id || "composition"}:source`,
    role: "source",
    params: sourceParams(composition.source),
    state: {
      source: composition.source,
      layer: defaultLayerState(`${composition.id || "composition"}:source`),
    },
  });
  const effectNodes = (composition.shaderChain || []).map((pass, index) => effectNodeForPass(composition, pass, index));
  return [sourceNode, ...effectNodes];
}

function chainNodeForItem(composition, item, index) {
  if (item.kind === "effect") {
    return effectNodeForPass(composition, {
      id: item.componentId,
      enabled: item.enabled,
      params: item.params,
      amount: item.amount,
    }, index);
  }
  const component = sourceComponentFor(item.source);
  return createVisualNode(component, {
    id: `${composition.id || "composition"}:source:${index}:${item.id}`,
    role: "source",
    enabled: item.enabled !== false,
    params: {
      ...sourceParams(item.source),
      ...item.params,
    },
    state: {
      source: item.source,
      layer: layerStateForItem(item),
    },
  });
}

export function compileShaderSchedule(chain = []) {
  return (chain || [])
    .map((pass, index) => {
      const component = getShaderComponent(pass.id);
      if (!component) return null;
      const params = passParams(component, pass);
      return {
        index,
        id: `shader:${index}:${pass.id}`,
        component,
        node: createVisualNode(component, {
          id: `shader:${index}:${pass.id}`,
          role: "effect",
          enabled: pass.enabled !== false,
          params,
        }),
        pass: {
          ...pass,
          enabled: pass.enabled !== false,
          params,
          amount: Number(paramValue(component, params, "amount", pass.amount ?? 0)) || 0,
        },
      };
    })
    .filter((job) => job?.pass.enabled);
}

export function passParams(component, pass = {}) {
  const params = {
    ...(pass.params && typeof pass.params === "object" ? pass.params : {}),
  };
  if (pass.amount !== undefined && params.amount === undefined) params.amount = pass.amount;
  return normalizeParamValues(component, params);
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

function effectNodeForPass(composition, pass, index) {
  const component = getShaderComponent(pass.id);
  return createVisualNode(component, {
    id: `${composition.id || "composition"}:effect:${index}:${pass.id}`,
    role: "effect",
    enabled: pass.enabled !== false,
    params: passParams(component, pass),
    state: {
      pass: {
        id: pass.id,
        enabled: pass.enabled !== false,
        params: passParams(component, pass),
      },
    },
  });
}

function sourceComponentFor(source = {}) {
  if (source.type === "generator") return getGeneratorComponent(source.generatorId);
  return {
    id: `source.${source.type || "black"}`,
    kind: "source",
    family: "source",
    name: source.type || "Source",
    processor: source.type || "source",
    scheduler: "frame",
    inlets: [],
    outlets: [textureOutlet("texture", "Texture")],
    params: [],
  };
}

function sourceParams(source = {}) {
  if (source.type === "generator") return { generatorId: source.generatorId || "testPattern" };
  if (source.type === "media") return { mediaId: source.mediaId || "" };
  return {};
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

function defaultLayerState(id = "source") {
  return {
    id,
    name: "Source",
    opacity: 1,
    blend: "normal",
    transform: {},
  };
}
