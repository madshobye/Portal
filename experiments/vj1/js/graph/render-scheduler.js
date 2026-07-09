import { createVisualNode, normalizeParamValues, paramValue, textureInlet, textureOutlet } from "./component-schema.js";
import { getGeneratorComponent } from "./generator-registry.js";
import { getShaderComponent } from "../shaders/shader-registry.js";

export function compileCompositionPatch(composition = {}) {
  const chainNodes = Array.isArray(composition.chain) && composition.chain.length
    ? composition.chain.map((item, index) => chainNodeForItem(composition, item, index))
    : legacyNodesForComposition(composition);
  const outputNode = {
    id: `${composition.id || "composition"}:output`,
    componentId: "output.texture",
    kind: "output",
    role: "output",
    enabled: true,
    inlets: [textureInlet("texture", "Texture")],
    outlets: [textureOutlet("texture", "Texture")],
    params: {},
    state: {},
    scheduler: "frame",
  };
  const nodes = [...chainNodes, outputNode];
  const edges = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({
      from: { nodeId: nodes[i].id, outletId: "texture" },
      to: { nodeId: nodes[i + 1].id, inletId: "texture" },
      type: "texture",
    });
  }
  return {
    id: `${composition.id || "composition"}:patch`,
    type: "linear-composition",
    mode: "hardconfigured",
    nodes,
    edges,
  };
}

function legacyNodesForComposition(composition = {}) {
  const sourceComponent = sourceComponentFor(composition.source);
  const sourceNode = createVisualNode(sourceComponent, {
    id: `${composition.id || "composition"}:source`,
    role: "source",
    params: sourceParams(composition.source),
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

function effectNodeForPass(composition, pass, index) {
  const component = getShaderComponent(pass.id);
  return createVisualNode(component, {
    id: `${composition.id || "composition"}:effect:${index}:${pass.id}`,
    role: "effect",
    enabled: pass.enabled !== false,
    params: passParams(component, pass),
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
