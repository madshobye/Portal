import {
  chainGeneralControlValue,
  isChainGeneralControlParameter,
  withChainGeneralControlValue,
} from "./chain-general-control-parameters.js";
import { ANIMATION_CURVES } from "../../control-engine/animation-curve/index.js";
import { NUMERIC_COMBINATION_MODES } from "../../control-engine/numeric-combine/index.js";

export const PARAMETER_ANIMATION_AUTHOR = "vj1-animation-editor";
export const PARAMETER_ANIMATION_FEATURE = "parameter-animation-track";
export const PARAMETER_ANIMATION_STAGES = Object.freeze([
  "source",
  "transport",
  "shape",
  "mapping",
  "combination",
  "sink",
]);

const COMPONENT_PROGRAM_GENERATOR = "vj1-component-compiler";
const TIME_NODE_ID = "animation:component-time";
const MIN_DURATION = 0.05;
const MAX_DURATION = 3600;
const MAX_PAUSE = 3600;
const MAX_RANDOM_RATE = 120;
const ANIMATION_SEQUENCER_NODE_ID = "core.control.animation-sequencer";
const ANIMATION_CURVE_NODE_ID = "core.control.animation-curve";
const ANIMATION_MAP_NODE_ID = "core.control.map-range";
const ANIMATION_COMBINE_NODE_ID = "core.control.numeric-combine";
const ANIMATION_RANDOM_NODE_ID = "core.control.random-trigger";
const HOST_INPUT_NODE_ID = "core.control.host-input";

export function parameterAnimationTriggerAddress(componentId = "", trackId = "") {
  return `animation:${nodeIdToken(componentId)}:${nodeIdToken(trackId)}:trigger`;
}

export function parameterAnimationTracks(nodes = {}, componentId = "", targetNodeId = "") {
  const scope = componentAnimationScope(nodes, componentId, targetNodeId);
  if (!scope) return [];
  return scope.nodes
    .filter(isAnimationTrackNode)
    .filter((node) => String(node.animationTrack?.targetNodeId || "") === String(targetNodeId || ""))
    .map((node) => animationTrackProjection(node, scope.nodes, scope.connections))
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
  curve = "linear",
  returnMode = "retrace",
  pause = 0,
  runMode = "automatic",
  triggerBehavior = "full-sequence",
  randomRate = 0,
  combination = "replace",
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
    const parameterRange = baseConnection.targetRange.map(Number);
    const current = mapRange(
      Number(baseControl.parameters?.value),
      baseConnection.sourceRange,
      parameterRange,
    );
    const safeCombination = normalizeCombination(combination);
    const mappingBounds = modulationRange(safeCombination, parameterRange);
    const defaults = defaultModulationRange(safeCombination, current, parameterRange);
    const safeFrom = clampFinite(from, mappingBounds, defaults[0]);
    const safeTo = clampFinite(to, mappingBounds, defaults[1]);
    const timeNode = scope.nodes.find(isAnimationTimeNode) ||
      createAnimationTimeNode(uniqueNodeId(scope.nodes, TIME_NODE_ID));
    const trackId = uniqueNodeId(
      scope.nodes,
      `animation:${nodeIdToken(targetNodeId)}:${nodeIdToken(parameterId)}`,
    );
    const fragment = createAnimationTrackFragment({
      componentId,
      id: trackId,
      targetNodeId,
      parameterId,
      mode,
      duration,
      phase,
      curve,
      returnMode,
      pause,
      runMode,
      triggerBehavior,
      randomRate,
      combination: safeCombination,
      range: [safeFrom, safeTo],
      parameterRange,
      baseControl,
      timeNodeId: timeNode.id,
    });
    const nodesWithTime = scope.nodes.includes(timeNode) ? scope.nodes : [...scope.nodes, timeNode];
    scope.nodes = [...nodesWithTime, ...fragment.nodes];
    scope.connections = [
      ...scope.connections.filter((edge) => String(edge.to || "") !== target),
      ...fragment.connections,
      {
        from: `${fragment.valueNodeId}.value`,
        to: target,
        type: "number",
        semantic: PARAMETER_ANIMATION_FEATURE,
        animationStage: "sink",
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
    const projected = animationTrackProjection(current, scope.nodes, scope.connections);
    const target = targetParameterEndpoint(
      current.animationTrack.targetNodeId,
      current.animationTrack.parameterId,
    );
    const baseControl = generatedParameterControl(
      scope.nodes,
      current.animationTrack.targetNodeId,
      current.animationTrack.parameterId,
    );
    const baseRange = baseControl.targetRange ||
      scope.connections.find((edge) => String(edge.from || "") === `${baseControl.id}.value`)?.targetRange;
    if (!validRange(baseRange)) {
      throw new Error(`PARAMETER_ANIMATION_RANGE_MISSING:${componentId}:${trackId}`);
    }
    const combination = normalizeCombination(patch.combination ?? projected.combination);
    const mappingBounds = modulationRange(combination, baseRange);
    const range = [
      clampFinite(patch.from, mappingBounds, projected.from),
      clampFinite(patch.to, mappingBounds, projected.to),
    ];
    const next = normalizedTrackConfiguration({
      ...projected,
      ...patch,
      from: range[0],
      to: range[1],
      id: projected.id,
      targetNodeId: projected.targetNodeId,
      parameterId: projected.parameterId,
      combination,
    });
    const ownerIds = animationTrackNodeIds(scope.nodes, current);
    const timeNode = scope.nodes.find(isAnimationTimeNode) ||
      createAnimationTimeNode(uniqueNodeId(scope.nodes, TIME_NODE_ID));
    const retainedNodes = scope.nodes.filter((node) => !ownerIds.has(String(node.id || "")));
    const nodesWithTime = retainedNodes.includes(timeNode) ? retainedNodes : [...retainedNodes, timeNode];
    const fragment = createAnimationTrackFragment({
      componentId,
      ...next,
      range,
      parameterRange: baseRange,
      baseControl,
      timeNodeId: timeNode.id,
    });
    scope.nodes = [...nodesWithTime, ...fragment.nodes];
    scope.connections = scope.connections.filter((edge) =>
      !ownerIds.has(endpointNodeId(edge.from)) &&
      !ownerIds.has(endpointNodeId(edge.to)) &&
      String(edge.to || "") !== target
    );
    scope.connections.push(...fragment.connections);
    scope.connections.push(next.enabled === false
      ? generatedParameterConnection(baseControl, target)
      : {
        from: `${fragment.valueNodeId}.value`,
        to: target,
        type: "number",
        semantic: PARAMETER_ANIMATION_FEATURE,
        animationStage: "sink",
      });
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
    const ownerIds = animationTrackNodeIds(scope.nodes, track);
    scope.nodes = scope.nodes.filter((node) => !ownerIds.has(String(node.id || "")));
    scope.connections = [
      ...scope.connections.filter((edge) =>
        !ownerIds.has(endpointNodeId(edge.from)) &&
        !ownerIds.has(endpointNodeId(edge.to)) &&
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
    animationStage: "source",
  };
}

function createAnimationTrackFragment({
  componentId,
  id,
  targetNodeId,
  parameterId,
  mode,
  duration,
  phase,
  curve,
  returnMode,
  pause,
  runMode,
  triggerBehavior,
  randomRate,
  combination,
  range,
  parameterRange,
  baseControl,
  timeNodeId,
}) {
  const configuration = normalizedTrackConfiguration({
    mode,
    duration,
    phase,
    curve,
    returnMode,
    pause,
    runMode,
    triggerBehavior,
    randomRate,
    combination,
  });
  const owner = String(id || "");
  const curveId = `${owner}:curve`;
  const mappingId = `${owner}:mapping`;
  const combinationId = `${owner}:combination`;
  const safeParameterRange = validRange(parameterRange) ? parameterRange.map(Number) : [0, 1];
  const safeRange = validRange(range) ? range.map(Number) : [0, 1];
  const nodes = [{
    id,
    nodeId: ANIMATION_SEQUENCER_NODE_ID,
    nodeVersion: "0.1.0",
    role: "control",
    parameters: {
      runMode: configuration.runMode,
      pattern: configuration.mode,
      triggerBehavior: configuration.triggerBehavior,
      duration: configuration.duration,
      pause: configuration.pause,
      phase: configuration.phase,
    },
    authoredBy: PARAMETER_ANIMATION_AUTHOR,
    animationTrackStage: "transport",
    animationTrack: {
      feature: PARAMETER_ANIMATION_FEATURE,
      version: 3,
      id,
      targetNodeId: String(targetNodeId || ""),
      parameterId: String(parameterId || ""),
      range: safeRange,
      randomRate: configuration.randomRate,
      combination: configuration.combination,
    },
  }, {
    id: curveId,
    nodeId: ANIMATION_CURVE_NODE_ID,
    nodeVersion: "0.1.0",
    role: "control",
    parameters: {
      curve: configuration.curve,
      returnMode: configuration.returnMode,
    },
    authoredBy: PARAMETER_ANIMATION_AUTHOR,
    animationTrackOwnerId: owner,
    animationTrackRole: "shape",
    animationTrackStage: "shape",
  }, {
    id: mappingId,
    nodeId: ANIMATION_MAP_NODE_ID,
    nodeVersion: "0.1.0",
    role: "control",
    parameters: {
      inputMin: 0,
      inputMax: 1,
      outputMin: safeRange[0],
      outputMax: safeRange[1],
      clamp: true,
    },
    authoredBy: PARAMETER_ANIMATION_AUTHOR,
    animationTrackOwnerId: owner,
    animationTrackRole: "mapping",
    animationTrackStage: "mapping",
  }, {
    id: combinationId,
    nodeId: ANIMATION_COMBINE_NODE_ID,
    nodeVersion: "0.1.0",
    role: "control",
    parameters: {
      mode: configuration.combination,
      clamp: true,
      minimum: Math.min(...safeParameterRange),
      maximum: Math.max(...safeParameterRange),
    },
    authoredBy: PARAMETER_ANIMATION_AUTHOR,
    animationTrackOwnerId: owner,
    animationTrackRole: "combination",
    animationTrackStage: "combination",
  }];
  const connections = [
    animationConnection(`${timeNodeId}.time`, `${owner}.time`, "number"),
    animationConnection(`${owner}.progress`, `${curveId}.progress`, "number"),
    animationConnection(`${owner}.direction`, `${curveId}.direction`, "number"),
    animationConnection(`${curveId}.value`, `${mappingId}.value`, "number"),
    animationConnection(`${mappingId}.value`, `${combinationId}.modulation`, "number"),
    {
      from: `${baseControl.id}.value`,
      to: `${combinationId}.base`,
      type: "number",
      sourceRange: validRange(baseControl.sourceRange) ? [...baseControl.sourceRange] : [0, 1],
      targetRange: safeParameterRange,
      semantic: PARAMETER_ANIMATION_FEATURE,
      animationStage: "combination",
    },
  ];
  if (configuration.runMode === "triggered") {
    const triggerId = `${owner}:trigger`;
    nodes.push({
      id: triggerId,
      nodeId: HOST_INPUT_NODE_ID,
      nodeVersion: "0.1.0",
      role: "control",
      parameters: {
        kind: "control",
        address: parameterAnimationTriggerAddress(componentId, owner),
        fallback: 0,
      },
      authoredBy: PARAMETER_ANIMATION_AUTHOR,
      animationTrackOwnerId: owner,
      animationTrackRole: "trigger",
    });
    connections.push(animationConnection(`${triggerId}.event`, `${owner}.trigger`, "event"));
    if (configuration.randomRate > 0) {
      const randomId = `${owner}:random`;
      nodes.push({
        id: randomId,
        nodeId: ANIMATION_RANDOM_NODE_ID,
        nodeVersion: "0.1.0",
        role: "control",
        parameters: {
          ratePerMinute: configuration.randomRate,
          seed: stableAnimationSeed(componentId, owner),
        },
        authoredBy: PARAMETER_ANIMATION_AUTHOR,
        animationTrackOwnerId: owner,
        animationTrackRole: "random-trigger",
      });
      connections.push(
        animationConnection(`${timeNodeId}.time`, `${randomId}.time`, "number"),
        animationConnection(`${randomId}.event`, `${owner}.randomTrigger`, "event"),
        animationConnection(`${randomId}.eventTime`, `${owner}.randomTriggerTime`, "number"),
      );
    }
  }
  return { nodes, connections, valueNodeId: combinationId };
}

function animationTrackProjection(node, nodes, connections) {
  const target = targetParameterEndpoint(
    node.animationTrack.targetNodeId,
    node.animationTrack.parameterId,
  );
  const valueNodeId = animationTrackValueNodeId(node, nodes);
  const edge = connections.find((candidate) =>
    String(candidate.from || "") === `${valueNodeId}.value` &&
    String(candidate.to || "") === target
  );
  const mappingNode = nodes.find((candidate) =>
    candidate.animationTrackOwnerId === node.animationTrack.id &&
    candidate.animationTrackRole === "mapping"
  );
  const combinationNode = nodes.find((candidate) =>
    candidate.animationTrackOwnerId === node.animationTrack.id &&
    candidate.animationTrackRole === "combination"
  );
  const mappedRange = [
    mappingNode?.parameters?.outputMin,
    mappingNode?.parameters?.outputMax,
  ];
  const range = validRange(mappedRange)
    ? mappedRange.map(Number)
    : validRange(edge?.targetRange)
      ? edge.targetRange.map(Number)
    : validRange(node.animationTrack?.range)
      ? node.animationTrack.range.map(Number)
      : [0, 1];
  if (node.nodeId === "core.control.oscillator") {
    const frequency = Math.abs(Number(node.parameters?.frequency) || 0);
    return normalizedTrackConfiguration({
      id: node.animationTrack.id,
      targetNodeId: node.animationTrack.targetNodeId,
      parameterId: node.animationTrack.parameterId,
      enabled: !!edge,
      mode: modeForWaveform(node.parameters?.waveform),
      from: range[0],
      to: range[1],
      duration: frequency > 0 ? 1 / frequency : 1,
      phase: normalizePhase(node.parameters?.phase),
      combination: "replace",
    });
  }
  const curveNode = nodes.find((candidate) =>
    candidate.animationTrackOwnerId === node.animationTrack.id &&
    ["shape", "curve"].includes(candidate.animationTrackRole)
  );
  return normalizedTrackConfiguration({
    id: node.animationTrack.id,
    targetNodeId: node.animationTrack.targetNodeId,
    parameterId: node.animationTrack.parameterId,
    enabled: !!edge,
    mode: node.parameters?.pattern,
    from: range[0],
    to: range[1],
    duration: node.parameters?.duration,
    phase: normalizePhase(node.parameters?.phase),
    curve: curveNode?.parameters?.curve,
    returnMode: curveNode?.parameters?.returnMode,
    pause: node.parameters?.pause,
    runMode: node.parameters?.runMode,
    triggerBehavior: node.parameters?.triggerBehavior,
    randomRate: node.animationTrack?.randomRate,
    combination: combinationNode?.parameters?.mode || node.animationTrack?.combination,
  });
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

function animationTrackNodeIds(nodes, track) {
  const owner = String(track?.animationTrack?.id || track?.id || "");
  return new Set(nodes
    .filter((node) =>
      String(node.id || "") === String(track?.id || "") ||
      String(node.animationTrackOwnerId || "") === owner
    )
    .map((node) => String(node.id || "")));
}

function animationTrackValueNodeId(track, nodes) {
  if (track?.nodeId === ANIMATION_SEQUENCER_NODE_ID) {
    const owned = nodes.filter((node) =>
      String(node.animationTrackOwnerId || "") === String(track.animationTrack?.id || "") &&
      ["combination", "shape", "curve"].includes(node.animationTrackRole)
    );
    return owned.find((node) => node.animationTrackRole === "combination")?.id ||
      owned.find((node) => ["shape", "curve"].includes(node.animationTrackRole))?.id ||
      `${track.id}:curve`;
  }
  return track?.id;
}

function animationConnection(from, to, type = "number") {
  return {
    from,
    to,
    type,
    semantic: PARAMETER_ANIMATION_FEATURE,
  };
}

function normalizedTrackConfiguration(configuration = {}) {
  return {
    ...configuration,
    enabled: configuration.enabled !== false,
    mode: configuration.mode === "ping-pong" ? "ping-pong" : "loop",
    duration: normalizeDuration(configuration.duration),
    phase: normalizePhase(configuration.phase),
    curve: normalizeCurve(configuration.curve),
    returnMode: configuration.returnMode === "repeat" ? "repeat" : "retrace",
    pause: Math.min(MAX_PAUSE, Math.max(0, Number(configuration.pause) || 0)),
    runMode: configuration.runMode === "triggered" ? "triggered" : "automatic",
    triggerBehavior: configuration.triggerBehavior === "next-leg" ? "next-leg" : "full-sequence",
    randomRate: Math.min(MAX_RANDOM_RATE, Math.max(0, Number(configuration.randomRate) || 0)),
    combination: normalizeCombination(configuration.combination),
  };
}

function normalizeCurve(value) {
  return ANIMATION_CURVES.includes(value) ? value : "linear";
}

function normalizeCombination(value) {
  return NUMERIC_COMBINATION_MODES.includes(value) ? value : "replace";
}

function modulationRange(combination, parameterRange) {
  const low = Math.min(Number(parameterRange[0]), Number(parameterRange[1]));
  const high = Math.max(Number(parameterRange[0]), Number(parameterRange[1]));
  if (combination === "add") {
    const span = Math.max(Math.abs(high - low), 0.000001);
    return [-span, span];
  }
  if (combination === "multiply") return [-4, 4];
  return [low, high];
}

function defaultModulationRange(combination, current, parameterRange) {
  if (combination === "add") {
    return [0, Math.abs(Number(parameterRange[1]) - Number(parameterRange[0]))];
  }
  if (combination === "multiply") return [1, 0];
  return [
    current,
    approximatelyEqual(current, parameterRange[1]) ? parameterRange[0] : parameterRange[1],
  ];
}

function stableAnimationSeed(componentId, trackId) {
  const value = `${componentId}:${trackId}`;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0 || 1;
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
