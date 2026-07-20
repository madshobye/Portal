import { createVisualNode, normalizeParamValues, paramValue, textureInlet, textureOutlet, textureRenderContract } from "./component-schema.js?v=text-generator-1";
import { getGeneratorComponent } from "./generator-registry.js?v=volumetric-clouds-1";
import { getShaderComponent } from "../shaders/shader-registry.js?v=alpha-feather-1";

export function compileComponentPatch(component = {}, renderRequest = {}) {
  const request = normalizePatchRenderRequest(renderRequest);
  const outputId = `${component.id || "component"}:output`;
  const graph = graphForComponentChain(component, request, outputId);
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
    id: `${component.id || "component"}:patch`,
    type: graph.branchCount > 1 ? "layered-component" : "linear-component",
    mode: "hardconfigured",
    renderRequest: request,
    branches: graph.branches,
    nodes,
    edges: graph.edges,
  };
}

function graphForComponentChain(component, request, outputId) {
  const chain = (component.chain || []).filter((item) => item.enabled !== false);
  const nodes = chain
    .map((item, index) => withRenderRequest(chainNodeForItem(component, item, index), request));
  const edges = [];
  for (let index = 0; index < nodes.length - 1; index++) {
    edges.push(textureEdge(nodes[index].id, nodes[index + 1].id));
  }
  if (nodes.length) edges.push(textureEdge(nodes[nodes.length - 1].id, outputId, "texture", "texture"));

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

function textureEdge(fromId, toId, outletId = "texture", inletId = "texture") {
  return {
    from: { nodeId: fromId, outletId },
    to: { nodeId: toId, inletId },
    type: "texture",
  };
}

function chainNodeForItem(component, item, index) {
  if (item.kind === "effect") {
    return effectNodeForPass(component, {
      id: item.componentId,
      enabled: item.enabled,
      params: item.params,
      amount: item.amount,
      transform: item.transform,
      opacity: item.opacity,
      blend: item.blend,
    }, index);
  }
  if (item.kind === "group") {
    return createVisualNode(groupComponentFor(), {
      id: `${component.id || "component"}:group:${index}:${item.id}`,
      role: "group",
      enabled: item.enabled !== false,
      params: {
        items: flattenComponentChain(item.chain || []).length,
      },
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
  const sourceComponent = sourceComponentFor(item.source);
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

export function fuseLocalShaderSchedule(schedule = []) {
  const fused = [];
  let run = [];
  const flush = () => {
    if (run.length === 1) fused.push(run[0]);
    else if (run.length > 1) {
      fused.push({
        fused: true,
        jobs: run,
        component: { name: run.map((job) => job.component.name).join(" + "), sampling: "local" },
        pass: {
          id: `fused:${run.map((job) => job.pass.id).join("+")}`,
          amount: 1,
          params: {},
        },
      });
    }
    run = [];
  };
  for (const job of schedule || []) {
    if (isFusibleShaderJob(job)) run.push(job);
    else {
      flush();
      fused.push(job);
    }
  }
  flush();
  return fused;
}

export function isFusibleShaderJob(job) {
  if (!job?.component?.fusible || job.pass?.amount <= 0.0001) return false;
  if ((job.pass?.blend || "normal") !== "normal" || Math.abs((job.pass?.opacity ?? 1) - 1) > 0.0001) return false;
  const transform = job.pass?.transform || {};
  return Math.abs(Number(transform.x) || 0) < 1e-9 &&
    Math.abs(Number(transform.y) || 0) < 1e-9 &&
    Math.abs((Number(transform.scale) || 1) - 1) < 1e-9 &&
    Math.abs(Number(transform.rotation) || 0) < 1e-9;
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

function effectNodeForPass(ownerComponent, pass, index) {
  const effectComponent = getShaderComponent(pass.id);
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

function sourceComponentFor(source = {}) {
  if (source.type === "generator") return getGeneratorComponent(source.generatorId);
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
  if (source.type === "generator") {
    return {
      generatorId: source.generatorId,
      ...(source.params && typeof source.params === "object" ? source.params : {}),
    };
  }
  if (source.type === "media") {
    return {
      mediaId: source.mediaId || "",
      start: Math.max(0, Number(source.start) || 0),
      end: Math.max(0, Number(source.end) || 0),
      speed: Math.max(0, Number(source.speed) || 1),
      ...(source.params && typeof source.params === "object" ? source.params : {}),
    };
  }
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
