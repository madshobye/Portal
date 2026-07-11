export function planPatchExecution(patch = {}) {
  const nodes = Array.isArray(patch.nodes) ? patch.nodes : [];
  const edges = Array.isArray(patch.edges) ? patch.edges : [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map(nodes.map((node) => [node.id, []]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  const warnings = [];

  for (const edge of edges) {
    const fromId = edge?.from?.nodeId;
    const toId = edge?.to?.nodeId;
    if (!fromId || !toId || !nodeById.has(fromId) || !nodeById.has(toId)) {
      warnings.push({ type: "dangling-edge", edge });
      continue;
    }
    outgoing.get(fromId).push(edge);
    incoming.get(toId).push(edge);
  }

  const order = topologicalOrder(nodes, incoming, outgoing);
  if (order.length !== nodes.length) {
    warnings.push({ type: "cycle-or-disconnected", ordered: order.length, total: nodes.length });
    const ordered = new Set(order.map((node) => node.id));
    for (const node of nodes) {
      if (!ordered.has(node.id)) order.push(node);
    }
  }
  warnings.push(...structuralWarnings(nodes, incoming, outgoing));

  return {
    patchId: patch.id || "",
    nodes: order,
    edges,
    incoming,
    outgoing,
    warnings,
    isLinear: isLinearPatch(order, incoming, outgoing),
  };
}

export function patchNodeDegree(plan, nodeId) {
  return {
    in: plan?.incoming?.get?.(nodeId)?.length || 0,
    out: plan?.outgoing?.get?.(nodeId)?.length || 0,
  };
}

export function planTextureBranches(plan = {}) {
  const nodeById = new Map((plan.nodes || []).map((node) => [node.id, node]));
  const branches = [];
  const sourceNodes = (plan.nodes || []).filter((node) => {
    const incomingTextures = (plan.incoming?.get?.(node.id) || []).filter((edge) => edge.type === "texture");
    return incomingTextures.length === 0 && (isSourceNode(node) || isEffectNode(node));
  });

  for (const source of sourceNodes) {
    const branch = {
      id: source.id,
      source,
      effects: [],
      output: null,
      warnings: [],
    };
    const visited = new Set([source.id]);
    let current = source;

    while (current) {
      const edges = plan.outgoing?.get?.(current.id) || [];
      const textureEdges = edges.filter((edge) => edge.type === "texture");
      if (!textureEdges.length) {
        branch.warnings.push({ type: "open-branch", nodeId: current.id });
        break;
      }
      if (textureEdges.length > 1) {
        branch.warnings.push({ type: "branch-split", nodeId: current.id, count: textureEdges.length });
      }
      const next = nodeById.get(textureEdges[0].to.nodeId);
      if (!next) {
        branch.warnings.push({ type: "dangling-branch-edge", edge: textureEdges[0] });
        break;
      }
      if (visited.has(next.id)) {
        branch.warnings.push({ type: "branch-cycle", nodeId: next.id });
        break;
      }
      visited.add(next.id);
      if (next.role === "output" || next.kind === "output") {
        branch.output = next;
        branch.outputEdge = textureEdges[0];
        branch.inletId = textureEdges[0]?.to?.inletId || "";
        branch.index = textureInletIndex(branch.inletId, branches.length + 1);
        break;
      }
      if (isEffectNode(next) || isSourceNode(next)) {
        branch.effects.push(next);
        current = next;
        continue;
      }
      branch.warnings.push({ type: "unexpected-branch-node", nodeId: next.id, role: next.role || next.kind });
      break;
    }
    branches.push(branch);
  }

  return branches.sort((a, b) => (a.index || 0) - (b.index || 0));
}

export function summarizeTextureBranches(plan = {}) {
  return planCompositorInputs(plan).inputs.map((input) => ({
    index: input.index,
    inletId: input.inletId,
    sourceNodeId: input.sourceNodeId,
    sourceComponentId: input.sourceComponentId,
    sourceLabel: input.sourceLabel,
    effectNodeIds: input.effectNodeIds,
    effectComponentIds: input.effectComponentIds,
    outputNodeId: input.outputNodeId,
    layer: input.layer,
    warnings: input.warnings,
  }));
}

export function planCompositorInputs(plan = {}, outputNodeId = "") {
  const output = findOutputNode(plan, outputNodeId);
  const warnings = [];
  if (!output) warnings.push({ type: "missing-output-node", outputNodeId });
  const inputs = planTextureBranches(plan)
    .filter((branch) => !output || branch.output?.id === output.id)
    .map((branch) => ({
      index: branch.index || 0,
      inletId: branch.inletId || "",
      sourceNodeId: branch.source?.id || "",
      sourceComponentId: branch.source?.componentId || "",
      sourceLabel: branch.source?.state?.layer?.name || branch.source?.componentId || branch.source?.id || "Source",
      effectNodeIds: (branch.effects || []).map((node) => node.id),
      effectComponentIds: (branch.effects || []).map((node) => node.componentId),
      outputNodeId: branch.output?.id || "",
      layer: branch.source?.state?.layer || null,
      source: branch.source,
      effects: branch.effects || [],
      output: branch.output,
      warnings: branch.warnings || [],
    }));
  const expected = Number(output?.state?.compositor?.inputCount || 0);
  if (output && expected && expected !== inputs.length) {
    warnings.push({ type: "planned-compositor-input-mismatch", nodeId: output.id, expected, actual: inputs.length });
  }
  return {
    output,
    inputs,
    warnings,
  };
}

function topologicalOrder(nodes, incoming, outgoing) {
  const inDegree = new Map(nodes.map((node) => [node.id, incoming.get(node.id)?.length || 0]));
  const queue = nodes.filter((node) => inDegree.get(node.id) === 0);
  const order = [];

  while (queue.length) {
    const node = queue.shift();
    order.push(node);
    for (const edge of outgoing.get(node.id) || []) {
      const toId = edge.to.nodeId;
      const next = Math.max(0, (inDegree.get(toId) || 0) - 1);
      inDegree.set(toId, next);
      if (next === 0) {
        const target = nodes.find((candidate) => candidate.id === toId);
        if (target) queue.push(target);
      }
    }
  }

  return order;
}

function isLinearPatch(nodes, incoming, outgoing) {
  if (!nodes.length) return true;
  let startCount = 0;
  let endCount = 0;
  for (const node of nodes) {
    const inCount = incoming.get(node.id)?.length || 0;
    const outCount = outgoing.get(node.id)?.length || 0;
    if (inCount === 0) startCount++;
    if (outCount === 0) endCount++;
    if (inCount > 1 || outCount > 1) return false;
  }
  return startCount === 1 && endCount === 1;
}

function structuralWarnings(nodes, incoming, outgoing) {
  const warnings = [];
  for (const node of nodes) {
    const inCount = incoming.get(node.id)?.length || 0;
    const outCount = outgoing.get(node.id)?.length || 0;
    if (nodes.length > 1 && inCount === 0 && outCount === 0) {
      warnings.push({ type: "orphan-node", nodeId: node.id, role: node.role || node.kind || "" });
    }
    if (node.role === "output" || node.kind === "output") {
      const expected = Number(node.state?.compositor?.inputCount || 0);
      if (expected && expected !== inCount) {
        warnings.push({ type: "compositor-input-mismatch", nodeId: node.id, expected, actual: inCount });
      }
      if (!inCount) warnings.push({ type: "output-without-input", nodeId: node.id });
    }
  }
  return warnings;
}

function isSourceNode(node = {}) {
  return node.role === "source" || node.kind === "source" || node.kind === "generator";
}

function isEffectNode(node = {}) {
  return node.role === "effect" || node.kind === "effect";
}

function findOutputNode(plan = {}, outputNodeId = "") {
  if (outputNodeId) return (plan.nodes || []).find((node) => node.id === outputNodeId) || null;
  return (plan.nodes || []).find((node) => node.role === "output" || node.kind === "output") || null;
}

function textureInletIndex(inletId = "", fallback = 0) {
  const match = String(inletId).match(/(\d+)$/);
  if (!match) return fallback;
  const index = Number(match[1]);
  return Number.isFinite(index) ? index : fallback;
}
