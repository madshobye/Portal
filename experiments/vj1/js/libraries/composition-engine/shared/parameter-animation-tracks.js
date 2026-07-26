import {
  chainGeneralControlValue,
  isChainGeneralControlParameter,
  withChainGeneralControlValue,
} from "./chain-general-control-parameters.js";

export const PARAMETER_ANIMATION_AUTHOR = "vj1-animation-editor";
export const PARAMETER_ANIMATION_FEATURE = "parameter-animation-track";

const COMPONENT_PROGRAM_GENERATOR = "vj1-component-compiler";
const TIME_NODE_ID = "animation:component-time";
const MIN_DURATION = 0.05;
const MAX_DURATION = 3600;

export function parameterAnimationTracks(nodes = {}, componentId = "", targetNodeId = "") {
  const scope = componentAnimationScope(nodes, componentId, targetNodeId);
  if (!scope) return [];
  return scope.nodes
    .filter(isAnimationTrackNode)
    .filter((node) => String(node.animationTrack?.targetNodeId || "") === String(targetNodeId || ""))
    .map((node) => animationTrackProjection(node, scope.connections))
    .sort((left, right) => left.parameterId.localeCompare(right.parameterId));
}

export function addParameterAnimationTrack(nodes = {}, {
  componentId = "",
  targetNodeId = "",
  parameterId = "",
  mode = "loop",
  from,
  to,
  duration = 2,
  phase = 0,
  baseValue,
  targetRange,
} = {}) {
  const target = targetParameterEndpoint(targetNodeId, parameterId);
  return updateAnimationScope(nodes, componentId, targetNodeId, (scope) => {
    if (scope.nodes.some((node) =>
      isAnimationTrackNode(node) &&
      String(node.animationTrack?.targetNodeId || "") === String(targetNodeId) &&
      String(node.animationTrack?.parameterId || "") === String(parameterId)
    )) {
      throw new Error(`PARAMETER_ANIMATION_EXISTS:${componentId}:${targetNodeId}:${parameterId}`);
    }
    const ensured = ensureGeneratedParameterControl(scope.nodes, {
      targetNodeId,
      parameterId,
      baseValue,
      targetRange,
    });
    scope.nodes = ensured.nodes;
    const baseControl = ensured.control;
    if (ensured.created) {
      scope.connections.push(generatedParameterConnection(baseControl, target));
    }
    const baseConnection = scope.connections.find((edge) =>
      String(edge.to || "") === target &&
      String(edge.from || "") === `${baseControl.id}.value`
    );
    if (!baseConnection || !validRange(baseConnection.targetRange)) {
      throw new Error(`PARAMETER_ANIMATION_TARGET_UNAVAILABLE:${componentId}:${targetNodeId}:${parameterId}`);
    }
    const range = baseConnection.targetRange.map(Number);
    const current = mapRange(
      Number(baseControl.parameters?.value),
      baseConnection.sourceRange,
      range,
    );
    const safeFrom = clampFinite(from, range, current);
    const defaultTo = approximatelyEqual(current, range[1]) ? range[0] : range[1];
    const safeTo = clampFinite(to, range, defaultTo);
    const timeNode = scope.nodes.find(isAnimationTimeNode) ||
      createAnimationTimeNode(uniqueNodeId(scope.nodes, TIME_NODE_ID));
    const trackNode = createAnimationTrackNode({
      id: uniqueNodeId(scope.nodes, `animation:${nodeIdToken(targetNodeId)}:${nodeIdToken(parameterId)}`),
      targetNodeId,
      parameterId,
      mode,
      duration,
      phase,
      range: [safeFrom, safeTo],
    });
    const nodesWithTime = scope.nodes.includes(timeNode) ? scope.nodes : [...scope.nodes, timeNode];
    scope.nodes = [...nodesWithTime, trackNode];
    scope.connections = [
      ...scope.connections.filter((edge) => String(edge.to || "") !== target),
      {
        from: `${timeNode.id}.time`,
        to: `${trackNode.id}.time`,
        type: "number",
        semantic: PARAMETER_ANIMATION_FEATURE,
      },
      {
        from: `${trackNode.id}.value`,
        to: target,
        type: "number",
        sourceRange: [0, 1],
        targetRange: [safeFrom, safeTo],
        semantic: PARAMETER_ANIMATION_FEATURE,
      },
    ];
  });
}

export function updateParameterAnimationTrack(nodes = {}, {
  componentId = "",
  targetNodeId = "",
  trackId = "",
  patch = {},
} = {}) {
  return updateAnimationScope(nodes, componentId, targetNodeId, (scope) => {
    const index = scope.nodes.findIndex((node) =>
      isAnimationTrackNode(node) && String(node.animationTrack?.id || "") === String(trackId || "")
    );
    if (index < 0) throw new Error(`PARAMETER_ANIMATION_MISSING:${componentId}:${trackId}`);
    const current = scope.nodes[index];
    let next = {
      ...current,
      parameters: {
        ...(current.parameters || {}),
        ...(patch.mode !== undefined ? { waveform: waveformForMode(patch.mode) } : {}),
        ...(patch.duration !== undefined ? { frequency: 1 / normalizeDuration(patch.duration) } : {}),
        ...(patch.phase !== undefined ? { phase: normalizePhase(patch.phase) } : {}),
      },
    };
    const target = targetParameterEndpoint(
      current.animationTrack.targetNodeId,
      current.animationTrack.parameterId,
    );
    const animatedEdge = scope.connections.find((edge) =>
      String(edge.from || "") === `${current.id}.value` &&
      String(edge.to || "") === target
    );
    const baseControl = generatedParameterControl(
      scope.nodes,
      current.animationTrack.targetNodeId,
      current.animationTrack.parameterId,
    );
    const baseRange = baseControl.targetRange ||
      scope.connections.find((edge) => String(edge.from || "") === `${baseControl.id}.value`)?.targetRange;
    if ((patch.from !== undefined || patch.to !== undefined) && !validRange(baseRange)) {
      throw new Error(`PARAMETER_ANIMATION_RANGE_MISSING:${componentId}:${trackId}`);
    }
    if (patch.from !== undefined || patch.to !== undefined) {
      const currentRange = current.animationTrack?.range || animatedEdge?.targetRange || baseRange;
      const nextRange = [
        clampFinite(patch.from, baseRange, Number(currentRange[0])),
        clampFinite(patch.to, baseRange, Number(currentRange[1])),
      ];
      next = {
        ...next,
        animationTrack: { ...next.animationTrack, range: nextRange },
      };
      scope.connections = scope.connections.map((edge) =>
        String(edge.from || "") === `${current.id}.value` && String(edge.to || "") === target
          ? { ...edge, targetRange: nextRange }
          : edge
      );
    }
    if (patch.enabled !== undefined) {
      scope.connections = scope.connections.filter((edge) => String(edge.to || "") !== target);
      scope.connections.push(patch.enabled === false
        ? generatedParameterConnection(baseControl, target)
        : {
          from: `${current.id}.value`,
          to: target,
          type: "number",
          sourceRange: [0, 1],
          targetRange: current.animationTrack?.range || animatedEdge?.targetRange || baseRange,
          semantic: PARAMETER_ANIMATION_FEATURE,
        });
    }
    scope.nodes = scope.nodes.map((node, nodeIndex) => nodeIndex === index ? next : node);
  });
}

export function removeParameterAnimationTrack(nodes = {}, {
  componentId = "",
  targetNodeId = "",
  trackId = "",
} = {}) {
  return updateAnimationScope(nodes, componentId, targetNodeId, (scope) => {
    const track = scope.nodes.find((node) =>
      isAnimationTrackNode(node) && String(node.animationTrack?.id || "") === String(trackId || "")
    );
    if (!track) return;
    const target = targetParameterEndpoint(
      track.animationTrack.targetNodeId,
      track.animationTrack.parameterId,
    );
    const baseControl = generatedParameterControl(
      scope.nodes,
      track.animationTrack.targetNodeId,
      track.animationTrack.parameterId,
    );
    scope.nodes = scope.nodes.filter((node) => node !== track);
    scope.connections = [
      ...scope.connections.filter((edge) =>
        String(edge.from || "").split(".")[0] !== track.id &&
        String(edge.to || "").split(".")[0] !== track.id &&
        String(edge.to || "") !== target
      ),
      generatedParameterConnection(baseControl, target),
    ];
    const timeNode = scope.nodes.find(isAnimationTimeNode);
    const timeInUse = timeNode && scope.connections.some((edge) =>
      String(edge.from || "") === `${timeNode.id}.time`
    );
    if (timeNode && !timeInUse) {
      scope.nodes = scope.nodes.filter((node) => node !== timeNode);
      scope.connections = scope.connections.filter((edge) =>
        String(edge.from || "").split(".")[0] !== timeNode.id &&
        String(edge.to || "").split(".")[0] !== timeNode.id
      );
    }
  });
}

// Compatibility-chain edits rebuild compiler-owned visual nodes. Project-authored
// control fragments remain graph authority and are overlaid on the refreshed
// visual configuration so ordinary parameter edits cannot silently delete them.
export function inheritAuthoredControlTopology(nextGroup = {}, existingGroup = {}) {
  if (existingGroup.authoredConnections !== true) return nextGroup;
  const merged = mergeAuthoredControlScope(
    nextGroup.nodes || [],
    nextGroup.connections || [],
    existingGroup.nodes || [],
    existingGroup.connections || [],
  );
  return {
    ...nextGroup,
    nodes: merged.nodes,
    connections: merged.connections,
    authoredConnections: true,
    persistence: "project-diff",
  };
}

function mergeAuthoredControlScope(nextNodes, nextConnections, existingNodes, existingConnections) {
  const authoredControls = existingNodes.filter((node) =>
    node.role === "control" && (
      node.generatedBy !== COMPONENT_PROGRAM_GENERATOR ||
      node.animationFallback === true
    )
  ).map((node) => refreshedAnimationFallback(node, nextNodes));
  const authoredIds = new Set(authoredControls.map((node) => String(node.id || "")));
  const authoredEdges = existingConnections.filter((edge) => {
    const from = endpointNodeId(edge.from);
    const to = endpointNodeId(edge.to);
    return authoredIds.has(from) || authoredIds.has(to);
  });
  const claimedTargets = new Set(authoredEdges
    .filter((edge) => String(edge.to || "").includes(".$parameter."))
    .map((edge) => String(edge.to || "")));
  const existingById = new Map(existingNodes.map((node) => [String(node.id || ""), node]));
  const refreshed = nextNodes.map((node) => {
    if (!node.nodes) return node;
    const existing = existingById.get(String(node.id || ""));
    if (!existing?.nodes) return node;
    const nested = mergeAuthoredControlScope(
      node.nodes || [],
      node.connections || [],
      existing.nodes || [],
      existing.connections || [],
    );
    return { ...node, nodes: nested.nodes, connections: nested.connections };
  });
  const generatedIds = new Set(refreshed.map((node) => String(node.id || "")));
  const nodes = [...refreshed, ...authoredControls.filter((node) => !generatedIds.has(String(node.id || "")))];
  const connections = [
    ...nextConnections.filter((edge) =>
      !claimedTargets.has(String(edge.to || "")) &&
      !authoredIds.has(endpointNodeId(edge.from)) &&
      !authoredIds.has(endpointNodeId(edge.to))
    ),
    ...authoredEdges,
  ];
  return { nodes, connections };
}

function refreshedAnimationFallback(control, refreshedNodes) {
  if (
    control.animationFallback !== true ||
    !isChainGeneralControlParameter(control.targetParameterId)
  ) {
    return control;
  }
  const target = refreshedNodes.find((node) =>
    String(node.id || "") === String(control.targetNodeId || "")
  );
  const value = chainGeneralControlValue(target?.configuration, control.targetParameterId);
  if (!Number.isFinite(Number(value)) || !validRange(control.targetRange)) return control;
  const normalized = (Number(value) - Number(control.targetRange[0])) /
    (Number(control.targetRange[1]) - Number(control.targetRange[0]));
  return {
    ...control,
    parameters: {
      ...(control.parameters || {}),
      value: Math.min(1, Math.max(0, normalized)),
    },
  };
}

function updateAnimationScope(nodes, componentId, targetNodeId, recipe) {
  const groups = nodes?.groups || [];
  const groupIndex = groups.findIndex((group) =>
    group.generatedBy === COMPONENT_PROGRAM_GENERATOR &&
    String(group.componentId || "") === String(componentId || "")
  );
  if (groupIndex < 0) throw new Error(`PARAMETER_ANIMATION_COMPONENT_GROUP_MISSING:${componentId}`);
  const group = groups[groupIndex];
  const updated = updateNestedScope(group.nodes || [], group.connections || [], targetNodeId, recipe);
  if (!updated.found) throw new Error(`PARAMETER_ANIMATION_TARGET_MISSING:${componentId}:${targetNodeId}`);
  const nextGroup = {
    ...group,
    nodes: updated.nodes,
    connections: updated.connections,
    authoredConnections: true,
    persistence: "project-diff",
  };
  return {
    ...nodes,
    groups: groups.map((entry, index) => index === groupIndex ? nextGroup : entry),
  };
}

function updateNestedScope(nodes, connections, targetNodeId, recipe) {
  if (nodes.some((node) => String(node.id || "") === String(targetNodeId || ""))) {
    const scope = { nodes: [...nodes], connections: [...connections] };
    recipe(scope);
    return { ...scope, found: true };
  }
  let found = false;
  const nextNodes = nodes.map((node) => {
    if (found || !node.nodes) return node;
    const nested = updateNestedScope(node.nodes || [], node.connections || [], targetNodeId, recipe);
    if (!nested.found) return node;
    found = true;
    return { ...node, nodes: nested.nodes, connections: nested.connections };
  });
  return { nodes: found ? nextNodes : nodes, connections, found };
}

function componentAnimationScope(nodes, componentId, targetNodeId) {
  const group = (nodes?.groups || []).find((entry) =>
    entry.generatedBy === COMPONENT_PROGRAM_GENERATOR &&
    String(entry.componentId || "") === String(componentId || "")
  );
  return group ? findNestedScope(group.nodes || [], group.connections || [], targetNodeId) : null;
}

function findNestedScope(nodes, connections, targetNodeId) {
  if (nodes.some((node) => String(node.id || "") === String(targetNodeId || ""))) {
    return { nodes, connections };
  }
  for (const node of nodes) {
    if (!node.nodes) continue;
    const nested = findNestedScope(node.nodes || [], node.connections || [], targetNodeId);
    if (nested) return nested;
  }
  return null;
}

function createAnimationTimeNode(id = TIME_NODE_ID) {
  return {
    id,
    nodeId: "core.control.component-time",
    nodeVersion: "0.1.0",
    role: "control",
    parameters: { scale: 1, offset: 0 },
    authoredBy: PARAMETER_ANIMATION_AUTHOR,
    animationTimeSource: true,
  };
}

function createAnimationTrackNode({
  id,
  targetNodeId,
  parameterId,
  mode,
  duration,
  phase,
  range,
}) {
  return {
    id,
    nodeId: "core.control.oscillator",
    nodeVersion: "0.1.0",
    role: "control",
    parameters: {
      waveform: waveformForMode(mode),
      frequency: 1 / normalizeDuration(duration),
      phase: normalizePhase(phase),
    },
    authoredBy: PARAMETER_ANIMATION_AUTHOR,
    animationTrack: {
      feature: PARAMETER_ANIMATION_FEATURE,
      id,
      targetNodeId: String(targetNodeId || ""),
      parameterId: String(parameterId || ""),
      range: validRange(range) ? range.map(Number) : [0, 1],
    },
  };
}

function animationTrackProjection(node, connections) {
  const target = targetParameterEndpoint(
    node.animationTrack.targetNodeId,
    node.animationTrack.parameterId,
  );
  const edge = connections.find((candidate) =>
    String(candidate.from || "") === `${node.id}.value` &&
    String(candidate.to || "") === target
  );
  const range = validRange(edge?.targetRange)
    ? edge.targetRange.map(Number)
    : validRange(node.animationTrack?.range)
      ? node.animationTrack.range.map(Number)
      : [0, 1];
  const frequency = Math.abs(Number(node.parameters?.frequency) || 0);
  return {
    id: node.animationTrack.id,
    targetNodeId: node.animationTrack.targetNodeId,
    parameterId: node.animationTrack.parameterId,
    enabled: !!edge,
    mode: modeForWaveform(node.parameters?.waveform),
    from: range[0],
    to: range[1],
    duration: frequency > 0 ? 1 / frequency : 1,
    phase: normalizePhase(node.parameters?.phase),
  };
}

function generatedParameterControl(nodes, targetNodeId, parameterId) {
  const control = nodes.find((node) =>
    node.role === "control" &&
    node.generatedBy === COMPONENT_PROGRAM_GENERATOR &&
    String(node.targetNodeId || "") === String(targetNodeId || "") &&
    String(node.targetParameterId || "") === String(parameterId || "") &&
    node.valueType === "number"
  );
  if (!control) {
    throw new Error(`PARAMETER_ANIMATION_BASE_CONTROL_MISSING:${targetNodeId}:${parameterId}`);
  }
  return control;
}

function ensureGeneratedParameterControl(nodes, {
  targetNodeId,
  parameterId,
  baseValue,
  targetRange,
}) {
  const existing = nodes.find((node) =>
    node.role === "control" &&
    node.generatedBy === COMPONENT_PROGRAM_GENERATOR &&
    String(node.targetNodeId || "") === String(targetNodeId || "") &&
    String(node.targetParameterId || "") === String(parameterId || "") &&
    node.valueType === "number"
  );
  if (existing) return { nodes, control: existing, created: false };
  if (!validRange(targetRange) || !Number.isFinite(Number(baseValue))) {
    throw new Error(`PARAMETER_ANIMATION_BASE_CONTROL_MISSING:${targetNodeId}:${parameterId}`);
  }
  const range = targetRange.map(Number);
  const value = clampFinite(baseValue, range, range[0]);
  const control = {
    id: uniqueNodeId(nodes, `${nodeIdToken(targetNodeId)}:param:${nodeIdToken(parameterId)}`),
    nodeId: "core.control.slider",
    nodeVersion: "0.1.0",
    role: "control",
    targetNodeId: String(targetNodeId),
    targetParameterId: String(parameterId),
    valueType: "number",
    sourceRange: [0, 1],
    targetRange: range,
    parameters: {
      value: (value - range[0]) / (range[1] - range[0]),
    },
    generatedBy: COMPONENT_PROGRAM_GENERATOR,
    animationFallback: true,
  };
  const nextNodes = nodes.flatMap((node) => {
    if (String(node.id || "") !== String(targetNodeId)) return [node];
    const configuration = node.configuration || {};
    const nextConfiguration = isChainGeneralControlParameter(parameterId)
      ? withChainGeneralControlValue(configuration, parameterId, value)
      : node.role === "effect"
      ? {
        ...configuration,
        params: { ...(configuration.params || {}), [parameterId]: value },
      }
      : {
        ...configuration,
        source: {
          ...(configuration.source || {}),
          params: { ...(configuration.source?.params || {}), [parameterId]: value },
        },
      };
    return [
      control,
      {
        ...node,
        parameters: { ...(node.parameters || {}), [parameterId]: value },
        configuration: nextConfiguration,
      },
    ];
  });
  if (!nextNodes.some((node) => node === control)) {
    throw new Error(`PARAMETER_ANIMATION_TARGET_MISSING:${targetNodeId}`);
  }
  return { nodes: nextNodes, control, created: true };
}

function generatedParameterConnection(control, target) {
  return {
    from: `${control.id}.value`,
    to: target,
    type: control.valueType || "number",
    sourceRange: validRange(control.sourceRange) ? [...control.sourceRange] : [0, 1],
    targetRange: validRange(control.targetRange) ? [...control.targetRange] : null,
  };
}

function targetParameterEndpoint(targetNodeId, parameterId) {
  const node = String(targetNodeId || "");
  const parameter = String(parameterId || "");
  if (!node || !parameter) throw new Error("PARAMETER_ANIMATION_TARGET_INVALID");
  return `${node}.$parameter.${parameter}`;
}

function isAnimationTrackNode(node) {
  return node?.animationTrack?.feature === PARAMETER_ANIMATION_FEATURE;
}

function isAnimationTimeNode(node) {
  return node?.animationTimeSource === true && node?.authoredBy === PARAMETER_ANIMATION_AUTHOR;
}

function waveformForMode(mode) {
  return mode === "ping-pong" ? "triangle" : "saw";
}

function modeForWaveform(waveform) {
  return waveform === "triangle" ? "ping-pong" : "loop";
}

function normalizeDuration(value) {
  const duration = Number(value);
  return Math.min(MAX_DURATION, Math.max(MIN_DURATION, Number.isFinite(duration) ? duration : 2));
}

function normalizePhase(value) {
  const phase = Number(value);
  if (!Number.isFinite(phase)) return 0;
  return phase - Math.floor(phase);
}

function clampFinite(value, range, fallback) {
  const number = Number(value);
  const safe = Number.isFinite(number) ? number : Number(fallback);
  const min = Math.min(Number(range[0]), Number(range[1]));
  const max = Math.max(Number(range[0]), Number(range[1]));
  return Math.min(max, Math.max(min, safe));
}

function validRange(value) {
  return Array.isArray(value) && value.length >= 2 &&
    Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1])) &&
    Number(value[0]) !== Number(value[1]);
}

function mapRange(value, sourceRange, targetRange) {
  if (!validRange(sourceRange) || !validRange(targetRange)) return Number(value) || 0;
  const progress = (Number(value) - Number(sourceRange[0])) /
    (Number(sourceRange[1]) - Number(sourceRange[0]));
  return Number(targetRange[0]) + progress * (Number(targetRange[1]) - Number(targetRange[0]));
}

function uniqueNodeId(nodes, base) {
  const ids = new Set(nodes.map((node) => String(node.id || "")));
  if (!ids.has(base)) return base;
  let suffix = 2;
  while (ids.has(`${base}:${suffix}`)) suffix += 1;
  return `${base}:${suffix}`;
}

function nodeIdToken(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9:_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "value";
}

function endpointNodeId(value) {
  return String(value || "").split(".")[0];
}

function approximatelyEqual(left, right) {
  return Math.abs(Number(left) - Number(right)) <= 1e-9;
}
