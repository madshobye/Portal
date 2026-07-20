import { flattenComponentChain } from "../graph/render-scheduler.js?v=chain-general-controls-1";
import { isIdentityTransform } from "./preview-interaction-geometry.js?v=render-coordinate-scope-3";

export function isSourceNode(node = {}) {
  return node.role === "source" || node.kind === "source" || node.kind === "generator";
}

export function isEffectNode(node = {}) {
  return node.role === "effect" || node.kind === "effect";
}

export function nodesInComponentChainOrder(component = {}, patch = {}) {
  const nodes = (patch.nodes || []).filter((node) => isSourceNode(node) || isEffectNode(node));
  if (!Array.isArray(component.chain) || !component.chain.length) return nodes;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return flattenComponentChain(component.chain)
    .map((item, index) => {
      if (item.kind === "source") return nodeById.get(`${component.id || "component"}:source:${index}:${item.id}`);
      if (item.kind === "effect") return nodeById.get(`${component.id || "component"}:effect:${index}:${item.componentId}`);
      return null;
    })
    .filter(Boolean);
}

export function patchLayerForNode(node = {}) {
  const layer = node.state?.layer || {};
  return {
    id: layer.id || node.id || "layer",
    name: layer.name || node.componentId || node.id || "Layer",
    opacity: layer.opacity ?? 1,
    blend: layer.blend || "normal",
    transform: layer.transform || {},
  };
}

export function isSimpleLayer(layer = {}) {
  const transform = layer.transform || {};
  const opacity = layer.opacity === undefined ? 1 : Number(layer.opacity);
  return (layer.blend || "normal") === "normal" &&
    opacity === 1 &&
    isIdentityTransform(transform);
}

export function sourceFromPatchNode(node = {}) {
  if (!node.state?.source) {
    throw new TypeError(`[VJ1_INVALID_RENDER_NODE] Source node ${String(node.id || "unknown")} has no canonical state.source`);
  }
  return sourceWithNodeParams(node.state.source, node.params || {}, node.id || node.state?.layer?.id);
}

export function sourceWithNodeParams(source, params = {}, instanceId = "") {
  if (!source?.type) {
    throw new TypeError(`[VJ1_INVALID_RENDER_SOURCE] Source node ${String(instanceId || "unknown")} has no source.type`);
  }
  const base = withSourceInstance(source, instanceId);
  if (base.type === "generator") {
    const { generatorId, ...generatorParams } = params || {};
    if (!base.generatorId && !generatorId) {
      throw new TypeError(`[VJ1_INVALID_RENDER_SOURCE] Generator node ${String(instanceId || "unknown")} has no generatorId`);
    }
    return {
      ...base,
      generatorId: base.generatorId || generatorId,
      params: {
        ...(base.params && typeof base.params === "object" ? base.params : {}),
        ...generatorParams,
      },
    };
  }
  if (base.type === "media") {
    const { mediaId, start, end, speed, ...mediaParams } = params || {};
    return {
      ...base,
      mediaId: base.mediaId || mediaId || "",
      ...(start !== undefined ? { start: Math.max(0, Number(start) || 0) } : {}),
      ...(end !== undefined ? { end: Math.max(0, Number(end) || 0) } : {}),
      ...(speed !== undefined ? { speed: Math.max(0, Number(speed) || 1) } : {}),
      params: {
        ...(base.params && typeof base.params === "object" ? base.params : {}),
        ...mediaParams,
      },
    };
  }
  return base;
}

export function withSourceInstance(source = {}, instanceId = "") {
  if (!source || typeof source !== "object") return source;
  return {
    ...source,
    instanceId: instanceId || source.instanceId || source.generatorId || source.type || "source",
  };
}

export function mediaSourceFit(source = {}) {
  return source.params?.fit === "cover" ? "cover" : "contain";
}

export function mediaSourceAlphaEdge(source = {}) {
  return {
    cut: clampAlphaEdgePixels(source.params?.alphaCut),
    feather: clampAlphaEdgePixels(source.params?.alphaFeather),
  };
}

function clampAlphaEdgePixels(value) {
  return Math.min(32, Math.max(0, Number(value) || 0));
}

export function shaderPassFromNode(node = {}) {
  const layer = node.state?.layer || {};
  return {
    id: node.componentId || node.id || "",
    instanceId: node.id || node.componentId || "",
    enabled: node.enabled !== false,
    params: { ...(node.params || {}) },
    amount: node.params?.amount,
    transform: node.state?.transform || node.transform || {},
    opacity: layer.opacity ?? 1,
    blend: layer.blend || "normal",
  };
}
