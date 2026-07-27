import {
  chainGeneralControlValue,
  isChainGeneralControlParameter,
  withChainGeneralControlValue,
} from "./chain-general-control-parameters.js";
import { ANIMATION_CURVES } from "../../control-engine/animation-curve/index.js";
import { NUMERIC_COMBINATION_MODES } from "../../control-engine/numeric-combine/index.js";
import {
  PROBE_VISUAL_NODE_ID,
  probeSignalAddress,
} from "../../control-engine/live-signal-addresses.js";

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
const ANIMATION_ENVELOPE_NODE_ID = "core.control.segment-envelope";
const ANIMATION_CURVE_NODE_ID = "core.control.animation-curve";
const ANIMATION_MAP_NODE_ID = "core.control.map-range";
const ANIMATION_COMBINE_NODE_ID = "core.control.numeric-combine";
const ANIMATION_RANDOM_NODE_ID = "core.control.random-trigger";
const ANIMATION_PERIODIC_TRIGGER_NODE_ID = "core.control.periodic-trigger";
const ANIMATION_EVENT_TRIGGER_NODE_ID = "core.control.event-trigger";
const ANIMATION_NOISE_NODE_ID = "core.control.scalar-noise";
const ANIMATION_SMOOTH_NODE_ID = "core.control.smooth";
const ANIMATION_SCALAR_MATH_NODE_ID = "core.control.scalar-math";
const HOST_INPUT_NODE_ID = "core.control.host-input";
const POINTER_INPUT_NODE_ID = "core.control.pointer-input";
const AUDIO_INPUT_NODE_ID = "core.control.audio-input";
const PROBE_INPUT_NODE_ID = "core.control.probe-input";
const LIVE_SIGNAL_NODE_IDS = new Set([
  HOST_INPUT_NODE_ID,
  POINTER_INPUT_NODE_ID,
  AUDIO_INPUT_NODE_ID,
  PROBE_INPUT_NODE_ID,
  "core.control.midi-input",
  "core.control.osc-input",
]);
const DEFAULT_ANIMATION_MARKER_VERSION = 1;
const LIVE_SIGNAL_KINDS = new Set(["pointer", "audio", "probe", "midi", "osc", "control"]);
const ANIMATION_TRANSPORT_KINDS = new Set(["sequence", "envelope", "noise"]);
const ANIMATION_TRIGGER_KINDS = new Set(["manual", "periodic", "random", "pointer", "audio", "probe"]);
const DEFAULT_ENVELOPE_SEGMENTS = Object.freeze([
  Object.freeze({ duration: 0.1, value: 1, curve: "quad-out" }),
  Object.freeze({ duration: 0.3, value: 0, curve: "quad-in" }),
]);

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

export function parameterAnimationSignalSources(
  nodes = {},
  componentId = "",
  targetNodeId = "",
) {
  const fixed = [
    { kind: "timeline", address: "", transportKind: "sequence", label: "Timeline" },
    { kind: "timeline", address: "", transportKind: "envelope", label: "Envelope" },
    { kind: "timeline", address: "", transportKind: "noise", label: "Noise" },
    { kind: "pointer", address: "x", label: "Mouse · X" },
    { kind: "pointer", address: "y", label: "Mouse · Y" },
    { kind: "pointer", address: "down", label: "Mouse · Down" },
    { kind: "pointer", address: "inside", label: "Mouse · Inside preview" },
    { kind: "audio", address: "level", label: "Sound · Overall volume" },
    { kind: "audio", address: "peak", label: "Sound · Peak" },
    { kind: "audio", address: "low", label: "Sound · Low band" },
    { kind: "audio", address: "mid", label: "Sound · Mid band" },
    { kind: "audio", address: "high", label: "Sound · High band" },
    { kind: "audio", address: "beat", label: "Sound · Overall beat" },
    { kind: "audio", address: "beat:low", label: "Sound · Low beat" },
    { kind: "audio", address: "beat:mid", label: "Sound · Mid beat" },
    { kind: "audio", address: "beat:high", label: "Sound · High beat" },
  ];
  const scope = componentAnimationScope(nodes, componentId, targetNodeId);
  if (!scope) return fixed;
  const features = [
    ["brightness", "Brightness"],
    ["r", "Red"],
    ["g", "Green"],
    ["b", "Blue"],
    ["h", "Hue"],
    ["s", "Saturation"],
    ["v", "Value"],
    ["alpha", "Alpha"],
  ];
  const probes = scope.nodes
    .filter((node) => String(node.nodeId || "") === PROBE_VISUAL_NODE_ID)
    .flatMap((node) => features.map(([feature, label]) => ({
      kind: "probe",
      address: probeSignalAddress(componentId, node.id, feature),
      label: `${node.configuration?.name || "Probe"} · ${label}`,
    })));
  return [...fixed, ...probes];
}

export function parameterAnimationTriggerSources(
  nodes = {},
  componentId = "",
  targetNodeId = "",
) {
  const fixed = [
    { kind: "manual", address: "", label: "Manual button" },
    { kind: "periodic", address: "", label: "Periodic" },
    { kind: "random", address: "", label: "Random" },
    { kind: "pointer", address: "pressed", label: "Mouse · Pressed" },
    { kind: "audio", address: "beat", label: "Sound · Overall beat" },
    { kind: "audio", address: "beat:low", label: "Sound · Low beat" },
    { kind: "audio", address: "beat:mid", label: "Sound · Mid beat" },
    { kind: "audio", address: "beat:high", label: "Sound · High beat" },
  ];
  return [
    ...fixed,
    ...parameterAnimationSignalSources(nodes, componentId, targetNodeId)
      .filter((source) => source.kind === "probe")
      .map((source) => ({ ...source, label: `${source.label} crosses threshold` })),
  ];
}

export function addParameterAnimationTrack(nodes = {}, {
  componentId = "",
  targetNodeId = "",
  parameterId = "",
  enabled = true,
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
  defaultAnimationId = "",
  sourceKind = "timeline",
  sourceAddress = "",
  transportKind = "sequence",
  envelopeInitial = 0,
  envelopeSegments = DEFAULT_ENVELOPE_SEGMENTS,
  triggerKind = "",
  triggerAddress = "",
  triggerThreshold = 0.5,
  triggerInterval = 1,
  noiseRate = 1,
  noiseSeed,
  noiseDetail = 2,
  noiseRoughness = 0.5,
  noiseBurst = false,
  smoothing = 0,
} = {}) {
  return updateAnimationScope(nodes, componentId, targetNodeId, (scope) => {
    addAnimationTrackToScope(scope, {
      componentId,
      targetNodeId,
      parameterId,
      enabled,
      mode,
      from,
      to,
      duration,
      phase,
      curve,
      returnMode,
      pause,
      runMode,
      triggerBehavior,
      randomRate,
      combination,
      baseValue,
      targetRange,
      defaultAnimationId,
      sourceKind,
      sourceAddress,
      transportKind,
      envelopeInitial,
      envelopeSegments,
      triggerKind,
      triggerAddress,
      triggerThreshold,
      triggerInterval,
      noiseRate,
      noiseSeed,
      noiseDetail,
      noiseRoughness,
      noiseBurst,
      smoothing,
    });
  });
}

export function addParameterEventTrack(nodes = {}, {
  componentId = "",
  targetNodeId = "",
  parameterId = "",
  enabled = true,
  triggerKind = "manual",
  triggerAddress = "",
  triggerThreshold = 0.5,
  triggerInterval = 1,
  randomRate = 30,
} = {}) {
  return updateAnimationScope(nodes, componentId, targetNodeId, (scope) => {
    const target = targetParameterEndpoint(targetNodeId, parameterId);
    if (scope.nodes.some((node) =>
      isAnimationTrackNode(node) &&
      String(node.animationTrack?.targetNodeId || "") === String(targetNodeId) &&
      String(node.animationTrack?.parameterId || "") === String(parameterId)
    )) {
      throw new Error(
        `PARAMETER_ANIMATION_EXISTS:${componentId}:${targetNodeId}:${parameterId}`,
      );
    }
    const id = uniqueNodeId(
      scope.nodes,
      `animation:${nodeIdToken(targetNodeId)}:${nodeIdToken(parameterId)}`,
    );
    const configuration = normalizedEventTrackConfiguration({
      id,
      targetNodeId,
      parameterId,
      enabled,
      triggerKind,
      triggerAddress,
      triggerThreshold,
      triggerInterval,
      randomRate,
    });
    const needsTime = ["periodic", "random"].includes(configuration.triggerKind);
    const timeNode = needsTime
      ? scope.nodes.find(isAnimationTimeNode) ||
        createAnimationTimeNode(uniqueNodeId(scope.nodes, TIME_NODE_ID))
      : null;
    const fragment = createEventAnimationTrackFragment({
      componentId,
      ...configuration,
      target,
      timeNodeId: timeNode?.id || "",
    });
    const nodesWithTime = timeNode && !scope.nodes.includes(timeNode)
      ? [...scope.nodes, timeNode]
      : scope.nodes;
    scope.nodes = [...nodesWithTime, ...fragment.nodes];
    scope.connections = [
      ...scope.connections.filter((edge) => String(edge.to || "") !== target),
      ...fragment.connections,
    ];
  });
}

export function initializeDefaultParameterAnimations(group = {}, {
  definitions = new Map(),
} = {}) {
  const initialized = initializeDefaultAnimationScope(
    group.nodes || [],
    group.connections || [],
    definitions,
    String(group.componentId || group.id || ""),
  );
  if (!initialized.changed) return group;
  return {
    ...group,
    nodes: initialized.nodes,
    connections: initialized.connections,
    authoredConnections: true,
    persistence: "project-diff",
  };
}

function addAnimationTrackToScope(scope, {
  componentId = "",
  targetNodeId = "",
  parameterId = "",
  enabled = true,
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
  defaultAnimationId = "",
  sourceKind = "timeline",
  sourceAddress = "",
  transportKind = "sequence",
  envelopeInitial = 0,
  envelopeSegments = DEFAULT_ENVELOPE_SEGMENTS,
  triggerKind = "",
  triggerAddress = "",
  triggerThreshold = 0.5,
  triggerInterval = 1,
  noiseRate = 1,
  noiseSeed,
  noiseDetail = 2,
  noiseRoughness = 0.5,
  noiseBurst = false,
  smoothing = 0,
} = {}) {
  const target = targetParameterEndpoint(targetNodeId, parameterId);
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
  const safeSourceKind = normalizeAnimationSourceKind(sourceKind);
  const timeNode = safeSourceKind === "timeline"
    ? scope.nodes.find(isAnimationTimeNode) ||
      createAnimationTimeNode(uniqueNodeId(scope.nodes, TIME_NODE_ID))
    : null;
  const trackId = uniqueNodeId(
    scope.nodes,
    `animation:${nodeIdToken(targetNodeId)}:${nodeIdToken(parameterId)}`,
  );
  const fragment = createAnimationTrackFragment({
    componentId,
    id: trackId,
    targetNodeId,
    parameterId,
    enabled,
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
    timeNodeId: timeNode?.id || "",
    defaultAnimationId,
    sourceKind: safeSourceKind,
    sourceAddress,
    transportKind,
    envelopeInitial,
    envelopeSegments,
    triggerKind,
    triggerAddress,
    triggerThreshold,
    triggerInterval,
    noiseRate,
    noiseSeed: Number.isFinite(Number(noiseSeed))
      ? Number(noiseSeed)
      : stableAnimationSeed(componentId, trackId),
    noiseDetail,
    noiseRoughness,
    noiseBurst,
    smoothing,
  });
  const nodesWithTime = timeNode && !scope.nodes.includes(timeNode)
    ? [...scope.nodes, timeNode]
    : scope.nodes;
  scope.nodes = [...nodesWithTime, ...fragment.nodes];
  scope.connections = [
    ...scope.connections.filter((edge) => String(edge.to || "") !== target),
    ...fragment.connections,
    enabled === false
      ? generatedParameterConnection(baseControl, target)
      : {
        from: `${fragment.valueNodeId}.value`,
        to: target,
        type: "number",
        semantic: PARAMETER_ANIMATION_FEATURE,
        animationStage: "sink",
      },
  ];
  return trackId;
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
    if (projected.kind === "event") {
      updateEventTrackInScope(scope, {
        componentId,
        current,
        projected,
        patch,
      });
      return;
    }
    const {
      baseValue: requestedBaseValue,
      targetRange: requestedTargetRange,
      ...trackPatch
    } = patch;
    const currentTargetNodeId = String(current.animationTrack.targetNodeId || "");
    const currentParameterId = String(current.animationTrack.parameterId || "");
    const nextParameterId = String(trackPatch.parameterId || currentParameterId);
    const retargeting = nextParameterId !== currentParameterId;
    if (retargeting && scope.nodes.some((node) =>
      isAnimationTrackNode(node) &&
      String(node.animationTrack?.id || "") !== String(trackId || "") &&
      String(node.animationTrack?.targetNodeId || "") === currentTargetNodeId &&
      String(node.animationTrack?.parameterId || "") === nextParameterId
    )) {
      throw new Error(
        `PARAMETER_ANIMATION_EXISTS:${componentId}:${currentTargetNodeId}:${nextParameterId}`,
      );
    }
    const currentTarget = targetParameterEndpoint(
      currentTargetNodeId,
      currentParameterId,
    );
    const nextTarget = targetParameterEndpoint(
      currentTargetNodeId,
      nextParameterId,
    );
    const currentBaseControl = generatedParameterControl(
      scope.nodes,
      currentTargetNodeId,
      currentParameterId,
    );
    const ensured = retargeting
      ? ensureGeneratedParameterControl(scope.nodes, {
          targetNodeId: currentTargetNodeId,
          parameterId: nextParameterId,
          baseValue: requestedBaseValue,
          targetRange: requestedTargetRange,
        })
      : { nodes: scope.nodes, control: currentBaseControl, created: false };
    scope.nodes = ensured.nodes;
    const baseControl = ensured.control;
    if (ensured.created) {
      scope.connections.push(generatedParameterConnection(baseControl, nextTarget));
    }
    const baseRange = baseControl.targetRange ||
      scope.connections.find((edge) =>
        String(edge.from || "") === `${baseControl.id}.value`
      )?.targetRange;
    if (!validRange(baseRange)) {
      throw new Error(`PARAMETER_ANIMATION_RANGE_MISSING:${componentId}:${trackId}`);
    }
    const combination = normalizeCombination(trackPatch.combination ?? projected.combination);
    const mappingBounds = modulationRange(combination, baseRange);
    const baseValue = mapRange(
      Number(baseControl.parameters?.value),
      validRange(baseControl.sourceRange) ? baseControl.sourceRange : [0, 1],
      baseRange,
    );
    const defaults = retargeting
      ? defaultModulationRange(combination, baseValue, baseRange)
      : [projected.from, projected.to];
    const range = [
      clampFinite(trackPatch.from, mappingBounds, defaults[0]),
      clampFinite(trackPatch.to, mappingBounds, defaults[1]),
    ];
    const next = normalizedTrackConfiguration({
      ...projected,
      ...trackPatch,
      from: range[0],
      to: range[1],
      id: projected.id,
      targetNodeId: projected.targetNodeId,
      parameterId: nextParameterId,
      combination,
      ...(retargeting ? { defaultAnimationId: "" } : {}),
    });
    const ownerIds = animationTrackNodeIds(scope.nodes, current);
    const timeNode = next.sourceKind === "timeline"
      ? scope.nodes.find(isAnimationTimeNode) ||
        createAnimationTimeNode(uniqueNodeId(scope.nodes, TIME_NODE_ID))
      : null;
    const retainedNodes = scope.nodes.filter((node) => !ownerIds.has(String(node.id || "")));
    const nodesWithTime = timeNode && !retainedNodes.includes(timeNode)
      ? [...retainedNodes, timeNode]
      : retainedNodes;
    const fragment = createAnimationTrackFragment({
      componentId,
      ...next,
      range,
      parameterRange: baseRange,
      baseControl,
      timeNodeId: timeNode?.id || "",
    });
    scope.nodes = [...nodesWithTime, ...fragment.nodes];
    scope.connections = scope.connections.filter((edge) =>
      !ownerIds.has(endpointNodeId(edge.from)) &&
      !ownerIds.has(endpointNodeId(edge.to)) &&
      String(edge.to || "") !== currentTarget &&
      String(edge.to || "") !== nextTarget
    );
    scope.connections.push(...fragment.connections);
    if (retargeting) {
      scope.connections.push(generatedParameterConnection(currentBaseControl, currentTarget));
    }
    scope.connections.push(next.enabled === false
      ? generatedParameterConnection(baseControl, nextTarget)
      : {
        from: `${fragment.valueNodeId}.value`,
        to: nextTarget,
        type: "number",
        semantic: PARAMETER_ANIMATION_FEATURE,
        animationStage: "sink",
      });
    removeUnusedAnimationTimeNode(scope);
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
    if (track.animationTrack.kind === "event") {
      const ownerIds = animationTrackNodeIds(scope.nodes, track);
      scope.nodes = scope.nodes.filter((node) =>
        !ownerIds.has(String(node.id || ""))
      );
      scope.connections = scope.connections.filter((edge) =>
        !ownerIds.has(endpointNodeId(edge.from)) &&
        !ownerIds.has(endpointNodeId(edge.to)) &&
        String(edge.to || "") !== target
      );
      removeUnusedAnimationTimeNode(scope);
      return;
    }
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
    removeUnusedAnimationTimeNode(scope);
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

function initializeDefaultAnimationScope(nodes, connections, definitions, componentId) {
  let changed = false;
  const nestedNodes = (nodes || []).map((node) => {
    if (!Array.isArray(node.nodes)) return node;
    const nested = initializeDefaultAnimationScope(
      node.nodes,
      node.connections || [],
      definitions,
      componentId,
    );
    if (!nested.changed) return node;
    changed = true;
    return {
      ...node,
      nodes: nested.nodes,
      connections: nested.connections,
    };
  });
  const scope = {
    nodes: nestedNodes,
    connections: [...(connections || [])],
  };
  const targetIds = nestedNodes
    .filter((node) => node.role !== "control")
    .map((node) => String(node.id || ""));
  for (const targetNodeId of targetIds) {
    const target = scope.nodes.find((node) => String(node.id || "") === targetNodeId);
    const definition = definitions.get(String(target?.nodeId || ""));
    for (const [parameterId, parameter] of Object.entries(definition?.parameters || {})) {
      const template = parameter.metadata?.defaultAnimation;
      if (!template) continue;
      const defaultAnimationId = defaultAnimationIdentity(definition.id, parameterId, template);
      if (handledDefaultAnimation(target, defaultAnimationId)) continue;
      const existingTrack = scope.nodes.some((node) =>
        isAnimationTrackNode(node) &&
        String(node.animationTrack?.targetNodeId || "") === targetNodeId &&
        String(node.animationTrack?.parameterId || "") === parameterId
      );
      if (!existingTrack) {
        const configuration = defaultAnimationConfiguration(target, parameter, template);
        if (!configuration.skip) {
          addAnimationTrackToScope(scope, {
            componentId,
            targetNodeId,
            parameterId,
            baseValue: readTargetParameterValue(target, parameterId) ?? parameter.defaultValue,
            targetRange: parameter.expectedRange || parameter.allowedRange,
            defaultAnimationId,
            ...configuration,
          });
        }
      }
      scope.nodes = markDefaultAnimationHandled(scope.nodes, targetNodeId, defaultAnimationId);
      changed = true;
    }
  }
  return {
    nodes: scope.nodes,
    connections: scope.connections,
    changed,
  };
}

function defaultAnimationIdentity(nodeId, parameterId, template) {
  return `${String(nodeId || "visual")}:${String(parameterId || "parameter")}:${String(template.id || "default")}@${Math.max(1, Number(template.version) || 1)}`;
}

function handledDefaultAnimation(target, defaultAnimationId) {
  return (target?.animationDefaults?.handled || []).includes(defaultAnimationId);
}

function markDefaultAnimationHandled(nodes, targetNodeId, defaultAnimationId) {
  return nodes.map((node) => {
    if (String(node.id || "") !== String(targetNodeId || "")) return node;
    const handled = new Set(node.animationDefaults?.handled || []);
    handled.add(defaultAnimationId);
    return {
      ...node,
      animationDefaults: {
        version: DEFAULT_ANIMATION_MARKER_VERSION,
        handled: [...handled],
      },
    };
  });
}

function defaultAnimationConfiguration(target, parameter, template) {
  const configuration = {
    enabled: template.enabled !== false,
    mode: template.mode,
    from: template.from,
    to: template.to,
    duration: template.duration,
    phase: template.phase,
    curve: template.curve,
    returnMode: template.returnMode,
    pause: template.pause,
    runMode: template.runMode,
    triggerBehavior: template.triggerBehavior,
    randomRate: template.randomRate,
    combination: template.combination,
    transportKind: template.transportKind,
    envelopeInitial: template.envelopeInitial,
    envelopeSegments: template.envelopeSegments,
    triggerKind: template.triggerKind,
    triggerAddress: template.triggerAddress,
    triggerThreshold: template.triggerThreshold,
    triggerInterval: template.triggerInterval,
    noiseRate: template.noiseRate,
    noiseSeed: template.noiseSeed,
    noiseDetail: template.noiseDetail,
    noiseRoughness: template.noiseRoughness,
    noiseBurst: template.noiseBurst,
    smoothing: template.smoothing,
  };
  const legacyRate = template.legacyRate;
  if (legacyRate?.parameterId) {
    const candidate = readTargetParameterValue(target, legacyRate.parameterId);
    const rate = Number(candidate ?? legacyRate.defaultValue);
    const unitsPerSecond = Math.abs(Number(legacyRate.unitsPerSecond) || 1);
    if (!Number.isFinite(rate) || Math.abs(rate) <= 0.000001) {
      if (legacyRate.skipWhenZero !== false) return { skip: true };
      configuration.enabled = false;
    } else {
      const span = Math.abs(Number(configuration.to) - Number(configuration.from));
      configuration.duration = span / (Math.abs(rate) * unitsPerSecond);
      if (rate < 0) {
        [configuration.from, configuration.to] = [configuration.to, configuration.from];
      }
    }
  }
  const legacyEnabled = template.legacyEnabled;
  if (legacyEnabled?.parameterId) {
    const value = readTargetParameterValue(target, legacyEnabled.parameterId)
      ?? legacyEnabled.defaultValue;
    const disabled = (legacyEnabled.disabledValues || []).includes(value);
    if (disabled && legacyEnabled.skipWhenDisabled !== false) return { skip: true };
    if (disabled) configuration.enabled = false;
  }
  if (!validRange(parameter.expectedRange || parameter.allowedRange)) return { skip: true };
  return configuration;
}

function readTargetParameterValue(target, parameterId) {
  if (target?.parameters?.[parameterId] !== undefined) {
    return target.parameters[parameterId];
  }
  const configuration = target?.configuration;
  if (target?.role === "effect") return configuration?.params?.[parameterId];
  if (target?.role === "source") return configuration?.source?.params?.[parameterId];
  return configuration?.[parameterId];
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
  enabled,
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
  defaultAnimationId,
  sourceKind,
  sourceAddress,
  transportKind,
  envelopeInitial,
  envelopeSegments,
  triggerKind,
  triggerAddress,
  triggerThreshold,
  triggerInterval,
  noiseRate,
  noiseSeed,
  noiseDetail,
  noiseRoughness,
  noiseBurst,
  smoothing,
}) {
  const configuration = normalizedTrackConfiguration({
    enabled,
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
    sourceKind,
    sourceAddress,
    transportKind,
    envelopeInitial,
    envelopeSegments,
    triggerKind,
    triggerAddress,
    triggerThreshold,
    triggerInterval,
    noiseRate,
    noiseSeed: Number.isFinite(Number(noiseSeed))
      ? Number(noiseSeed)
      : stableAnimationSeed(componentId, id),
    noiseDetail,
    noiseRoughness,
    noiseBurst,
    smoothing,
  });
  const owner = String(id || "");
  const curveId = `${owner}:curve`;
  const mappingId = `${owner}:mapping`;
  const combinationId = `${owner}:combination`;
  const safeParameterRange = validRange(parameterRange) ? parameterRange.map(Number) : [0, 1];
  const safeRange = validRange(range) ? range.map(Number) : [0, 1];
  const timeline = configuration.sourceKind === "timeline";
  const trackMetadata = {
      feature: PARAMETER_ANIMATION_FEATURE,
      version: 5,
      id,
      targetNodeId: String(targetNodeId || ""),
      parameterId: String(parameterId || ""),
      range: safeRange,
      randomRate: configuration.randomRate,
      combination: configuration.combination,
      sourceKind: configuration.sourceKind,
      sourceAddress: configuration.sourceAddress,
      transportKind: configuration.transportKind,
      triggerKind: configuration.triggerKind,
      triggerAddress: configuration.triggerAddress,
      triggerThreshold: configuration.triggerThreshold,
      triggerInterval: configuration.triggerInterval,
      smoothing: configuration.smoothing,
      ...(defaultAnimationId ? { defaultAnimationId: String(defaultAnimationId) } : {}),
  };
  const envelope = timeline && configuration.transportKind === "envelope";
  const noise = timeline && configuration.transportKind === "noise";
  const nodes = [timeline ? {
    id,
    nodeId: envelope
      ? ANIMATION_ENVELOPE_NODE_ID
      : noise ? ANIMATION_NOISE_NODE_ID : ANIMATION_SEQUENCER_NODE_ID,
    nodeVersion: "0.1.0",
    role: "control",
    parameters: envelope ? {
      initial: configuration.envelopeInitial,
      segments: configuration.envelopeSegments,
      retrigger: "restart",
    } : noise ? {
      rate: configuration.noiseRate,
      seed: configuration.noiseSeed,
      detail: configuration.noiseDetail,
      roughness: configuration.noiseRoughness,
    } : {
      runMode: configuration.runMode,
      pattern: configuration.mode,
      triggerBehavior: configuration.triggerBehavior,
      duration: configuration.duration,
      pause: configuration.pause,
      phase: configuration.phase,
    },
    authoredBy: PARAMETER_ANIMATION_AUTHOR,
    animationTrackStage: "transport",
    animationTrack: trackMetadata,
  } : {
    id,
    nodeId: liveSignalNodeId(configuration.sourceKind),
    nodeVersion: "0.1.0",
    role: "control",
    parameters: {
      kind: configuration.sourceKind,
      address: configuration.sourceAddress,
      fallback: 0,
    },
    authoredBy: PARAMETER_ANIMATION_AUTHOR,
    animationTrackStage: "source",
    animationTrack: trackMetadata,
  }, ...(timeline && !envelope && !noise ? [{
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
  }] : []), {
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
  const connections = [];
  let sourceEndpoint;
  if (!timeline) {
    sourceEndpoint = `${owner}.number`;
  } else {
    connections.push(animationConnection(`${timeNodeId}.time`, `${owner}.time`, "number"));
    if (envelope || noise) {
      sourceEndpoint = `${owner}.value`;
    } else {
      connections.push(
        animationConnection(`${owner}.progress`, `${curveId}.progress`, "number"),
        animationConnection(`${owner}.direction`, `${curveId}.direction`, "number"),
      );
      sourceEndpoint = `${curveId}.value`;
    }
  }
  let burstEnvelopeId = "";
  if (noise && configuration.noiseBurst) {
    burstEnvelopeId = `${owner}:burst-envelope`;
    const gateId = `${owner}:burst-gate`;
    nodes.push({
      id: burstEnvelopeId,
      nodeId: ANIMATION_ENVELOPE_NODE_ID,
      nodeVersion: "0.1.0",
      role: "control",
      parameters: {
        initial: 0,
        segments: configuration.envelopeSegments,
        retrigger: "restart",
      },
      authoredBy: PARAMETER_ANIMATION_AUTHOR,
      animationTrackOwnerId: owner,
      animationTrackRole: "burst-envelope",
      animationTrackStage: "shape",
    }, {
      id: gateId,
      nodeId: ANIMATION_SCALAR_MATH_NODE_ID,
      nodeVersion: "0.1.0",
      role: "control",
      parameters: { operation: "multiply" },
      authoredBy: PARAMETER_ANIMATION_AUTHOR,
      animationTrackOwnerId: owner,
      animationTrackRole: "burst-gate",
      animationTrackStage: "shape",
    });
    connections.push(
      animationConnection(`${timeNodeId}.time`, `${burstEnvelopeId}.time`, "number"),
      animationConnection(sourceEndpoint, `${gateId}.a`, "number"),
      animationConnection(`${burstEnvelopeId}.value`, `${gateId}.b`, "number"),
    );
    sourceEndpoint = `${gateId}.value`;
  }
  if (configuration.smoothing > 0) {
    const smoothingId = `${owner}:smoothing`;
    nodes.push({
      id: smoothingId,
      nodeId: ANIMATION_SMOOTH_NODE_ID,
      nodeVersion: "0.1.0",
      role: "control",
      parameters: { timeConstant: configuration.smoothing },
      authoredBy: PARAMETER_ANIMATION_AUTHOR,
      animationTrackOwnerId: owner,
      animationTrackRole: "smoothing",
      animationTrackStage: "shape",
    });
    connections.push(animationConnection(sourceEndpoint, `${smoothingId}.value`, "number"));
    sourceEndpoint = `${smoothingId}.value`;
  }
  connections.push(
    animationConnection(sourceEndpoint, `${mappingId}.value`, "number"),
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
  );
  if (timeline && (envelope || burstEnvelopeId || configuration.runMode === "triggered")) {
    appendAnimationTriggerFragment({
      nodes,
      connections,
      componentId,
      owner,
      timeNodeId,
      configuration,
      envelope: envelope || !!burstEnvelopeId,
      targetId: burstEnvelopeId || owner,
    });
  }
  return { nodes, connections, valueNodeId: combinationId };
}

function appendAnimationTriggerFragment({
  nodes,
  connections,
  componentId,
  owner,
  timeNodeId,
  configuration,
  envelope,
  targetId = owner,
}) {
  const triggerId = `${owner}:trigger`;
  const role = "trigger";
  const owned = {
    authoredBy: PARAMETER_ANIMATION_AUTHOR,
    animationTrackOwnerId: owner,
    animationTrackRole: role,
  };
  let eventEndpoint = "";
  let eventTimeEndpoint = "";
  if (configuration.triggerKind === "periodic") {
    nodes.push({
      id: triggerId,
      nodeId: ANIMATION_PERIODIC_TRIGGER_NODE_ID,
      nodeVersion: "0.1.0",
      role: "control",
      parameters: { interval: configuration.triggerInterval, phase: 0 },
      ...owned,
    });
    connections.push(animationConnection(`${timeNodeId}.time`, `${triggerId}.time`, "number"));
    eventEndpoint = `${triggerId}.event`;
    eventTimeEndpoint = `${triggerId}.eventTime`;
  } else if (configuration.triggerKind === "random") {
    nodes.push({
      id: triggerId,
      nodeId: ANIMATION_RANDOM_NODE_ID,
      nodeVersion: "0.1.0",
      role: "control",
      parameters: {
        ratePerMinute: configuration.randomRate,
        seed: stableAnimationSeed(componentId, owner),
      },
      ...owned,
    });
    connections.push(animationConnection(`${timeNodeId}.time`, `${triggerId}.time`, "number"));
    eventEndpoint = `${triggerId}.event`;
    eventTimeEndpoint = `${triggerId}.eventTime`;
  } else if (configuration.triggerKind === "probe") {
    const thresholdId = `${owner}:trigger-threshold`;
    nodes.push({
      id: triggerId,
      nodeId: PROBE_INPUT_NODE_ID,
      nodeVersion: "0.1.0",
      role: "control",
      parameters: {
        kind: "probe",
        address: configuration.triggerAddress,
        fallback: 0,
      },
      ...owned,
    }, {
      id: thresholdId,
      nodeId: ANIMATION_EVENT_TRIGGER_NODE_ID,
      nodeVersion: "0.1.0",
      role: "control",
      parameters: { threshold: configuration.triggerThreshold },
      authoredBy: PARAMETER_ANIMATION_AUTHOR,
      animationTrackOwnerId: owner,
      animationTrackRole: "trigger-threshold",
    });
    connections.push(animationConnection(`${triggerId}.number`, `${thresholdId}.value`, "number"));
    eventEndpoint = `${thresholdId}.event`;
  } else if (configuration.triggerKind === "pointer" || configuration.triggerKind === "audio") {
    nodes.push({
      id: triggerId,
      nodeId: liveSignalNodeId(configuration.triggerKind),
      nodeVersion: "0.1.0",
      role: "control",
      parameters: {
        kind: configuration.triggerKind,
        address: configuration.triggerAddress,
        fallback: 0,
      },
      ...owned,
    });
    eventEndpoint = `${triggerId}.event`;
  } else {
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
      ...owned,
    });
    eventEndpoint = `${triggerId}.event`;
  }
  const triggerInlet = !envelope && configuration.triggerKind === "random"
    ? "randomTrigger"
    : "trigger";
  connections.push(animationConnection(eventEndpoint, `${targetId}.${triggerInlet}`, "event"));
  if (eventTimeEndpoint && (envelope || configuration.triggerKind === "random")) {
    const timeInlet = !envelope && configuration.triggerKind === "random"
      ? "randomTriggerTime"
      : "triggerTime";
    connections.push(animationConnection(eventTimeEndpoint, `${targetId}.${timeInlet}`, "number"));
  }
}

function createEventAnimationTrackFragment({
  componentId,
  id,
  targetNodeId,
  parameterId,
  enabled,
  triggerKind,
  triggerAddress,
  triggerThreshold,
  triggerInterval,
  randomRate,
  target,
  timeNodeId,
}) {
  const nodes = [];
  const connections = [];
  const owned = {
    authoredBy: PARAMETER_ANIMATION_AUTHOR,
    animationTrackOwnerId: id,
    animationTrackRole: "event-source",
    animationTrackStage: "source",
  };
  const animationTrack = {
    feature: PARAMETER_ANIMATION_FEATURE,
    kind: "event",
    id,
    targetNodeId,
    parameterId,
    enabled,
    triggerKind,
    triggerAddress,
    triggerThreshold,
    triggerInterval,
    randomRate,
  };
  let eventEndpoint = "";
  if (triggerKind === "periodic") {
    nodes.push({
      id,
      nodeId: ANIMATION_PERIODIC_TRIGGER_NODE_ID,
      nodeVersion: "0.1.0",
      role: "control",
      parameters: { interval: triggerInterval, phase: 0 },
      ...owned,
      animationTrack,
    });
    connections.push(
      animationConnection(`${timeNodeId}.time`, `${id}.time`, "number"),
    );
    eventEndpoint = `${id}.event`;
  } else if (triggerKind === "random") {
    nodes.push({
      id,
      nodeId: ANIMATION_RANDOM_NODE_ID,
      nodeVersion: "0.1.0",
      role: "control",
      parameters: {
        ratePerMinute: randomRate,
        seed: stableAnimationSeed(componentId, id),
      },
      ...owned,
      animationTrack,
    });
    connections.push(
      animationConnection(`${timeNodeId}.time`, `${id}.time`, "number"),
    );
    eventEndpoint = `${id}.event`;
  } else if (triggerKind === "probe") {
    const sourceId = `${id}:source`;
    nodes.push({
      id: sourceId,
      nodeId: PROBE_INPUT_NODE_ID,
      nodeVersion: "0.1.0",
      role: "control",
      parameters: {
        kind: "probe",
        address: triggerAddress,
        fallback: 0,
      },
      ...owned,
    }, {
      id,
      nodeId: ANIMATION_EVENT_TRIGGER_NODE_ID,
      nodeVersion: "0.1.0",
      role: "control",
      parameters: { threshold: triggerThreshold },
      ...owned,
      animationTrack,
    });
    connections.push(
      animationConnection(`${sourceId}.number`, `${id}.value`, "number"),
    );
    eventEndpoint = `${id}.event`;
  } else if (triggerKind === "pointer" || triggerKind === "audio") {
    nodes.push({
      id,
      nodeId: liveSignalNodeId(triggerKind),
      nodeVersion: "0.1.0",
      role: "control",
      parameters: {
        kind: triggerKind,
        address: triggerAddress,
        fallback: 0,
      },
      ...owned,
      animationTrack,
    });
    eventEndpoint = `${id}.event`;
  } else {
    nodes.push({
      id,
      nodeId: HOST_INPUT_NODE_ID,
      nodeVersion: "0.1.0",
      role: "control",
      parameters: {
        kind: "control",
        address: parameterAnimationTriggerAddress(componentId, id),
        fallback: 0,
      },
      ...owned,
      animationTrack,
    });
    eventEndpoint = `${id}.event`;
  }
  if (enabled) {
    connections.push({
      from: eventEndpoint,
      to: target,
      type: "event",
      semantic: PARAMETER_ANIMATION_FEATURE,
      animationStage: "sink",
    });
  }
  return { nodes, connections };
}

function updateEventTrackInScope(scope, {
  componentId,
  current,
  projected,
  patch,
}) {
  const currentTargetNodeId = String(current.animationTrack.targetNodeId || "");
  const currentParameterId = String(current.animationTrack.parameterId || "");
  const nextParameterId = String(patch.parameterId || currentParameterId);
  if (nextParameterId !== currentParameterId && scope.nodes.some((node) =>
    isAnimationTrackNode(node) &&
    String(node.animationTrack?.id || "") !== String(projected.id || "") &&
    String(node.animationTrack?.targetNodeId || "") === currentTargetNodeId &&
    String(node.animationTrack?.parameterId || "") === nextParameterId
  )) {
    throw new Error(
      `PARAMETER_ANIMATION_EXISTS:${componentId}:${currentTargetNodeId}:${nextParameterId}`,
    );
  }
  const currentTarget = targetParameterEndpoint(
    currentTargetNodeId,
    currentParameterId,
  );
  const nextTarget = targetParameterEndpoint(
    currentTargetNodeId,
    nextParameterId,
  );
  const next = normalizedEventTrackConfiguration({
    ...projected,
    ...patch,
    id: projected.id,
    targetNodeId: currentTargetNodeId,
    parameterId: nextParameterId,
  });
  const ownerIds = animationTrackNodeIds(scope.nodes, current);
  const retainedNodes = scope.nodes.filter((node) =>
    !ownerIds.has(String(node.id || ""))
  );
  const needsTime = ["periodic", "random"].includes(next.triggerKind);
  const timeNode = needsTime
    ? retainedNodes.find(isAnimationTimeNode) ||
      createAnimationTimeNode(uniqueNodeId(retainedNodes, TIME_NODE_ID))
    : null;
  const nodesWithTime = timeNode && !retainedNodes.includes(timeNode)
    ? [...retainedNodes, timeNode]
    : retainedNodes;
  const fragment = createEventAnimationTrackFragment({
    componentId,
    ...next,
    target: nextTarget,
    timeNodeId: timeNode?.id || "",
  });
  scope.nodes = [...nodesWithTime, ...fragment.nodes];
  scope.connections = [
    ...scope.connections.filter((edge) =>
      !ownerIds.has(endpointNodeId(edge.from)) &&
      !ownerIds.has(endpointNodeId(edge.to)) &&
      String(edge.to || "") !== currentTarget &&
      String(edge.to || "") !== nextTarget
    ),
    ...fragment.connections,
  ];
  removeUnusedAnimationTimeNode(scope);
}

function animationTrackProjection(node, nodes, connections) {
  const target = targetParameterEndpoint(
    node.animationTrack.targetNodeId,
    node.animationTrack.parameterId,
  );
  if (node.animationTrack.kind === "event") {
    const ownerIds = animationTrackNodeIds(nodes, node);
    return normalizedEventTrackConfiguration({
      ...node.animationTrack,
      enabled: connections.some((edge) =>
        String(edge.to || "") === target &&
        ownerIds.has(endpointNodeId(edge.from))
      ),
    });
  }
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
    return projectedTrackConfiguration({
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
  const envelope = node.nodeId === ANIMATION_ENVELOPE_NODE_ID;
  const noise = node.nodeId === ANIMATION_NOISE_NODE_ID;
  const burstEnvelope = nodes.find((candidate) =>
    candidate.animationTrackOwnerId === node.animationTrack.id &&
    candidate.animationTrackRole === "burst-envelope"
  );
  const smoothingNode = nodes.find((candidate) =>
    candidate.animationTrackOwnerId === node.animationTrack.id &&
    candidate.animationTrackRole === "smoothing"
  );
  const usesTrigger = envelope || !!burstEnvelope || node.parameters?.runMode === "triggered";
  return projectedTrackConfiguration({
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
    transportKind: envelope ? "envelope" : noise ? "noise" : node.animationTrack?.transportKind,
    ...(envelope || burstEnvelope ? {
      envelopeInitial: envelope ? node.parameters?.initial : 0,
      envelopeSegments: envelope
        ? node.parameters?.segments
        : burstEnvelope?.parameters?.segments,
    } : {}),
    ...(usesTrigger ? {
      triggerKind: node.animationTrack?.triggerKind,
      triggerAddress: node.animationTrack?.triggerAddress,
      triggerThreshold: node.animationTrack?.triggerThreshold,
      triggerInterval: node.animationTrack?.triggerInterval,
    } : {}),
    ...(noise ? {
      noiseRate: node.parameters?.rate,
      noiseSeed: node.parameters?.seed,
      noiseDetail: node.parameters?.detail,
      noiseRoughness: node.parameters?.roughness,
      noiseBurst: !!burstEnvelope,
    } : {}),
    smoothing: smoothingNode?.parameters?.timeConstant ?? node.animationTrack?.smoothing ?? 0,
    ...(LIVE_SIGNAL_NODE_IDS.has(node.nodeId) ? {
      sourceKind: normalizeAnimationSourceKind(node.parameters?.kind),
      sourceAddress: String(node.parameters?.address || ""),
    } : {}),
    ...(node.animationTrack?.defaultAnimationId
      ? { defaultAnimationId: node.animationTrack.defaultAnimationId }
      : {}),
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
  const owned = nodes.filter((node) =>
    String(node.animationTrackOwnerId || "") === String(track.animationTrack?.id || "") &&
    ["combination", "shape", "curve"].includes(node.animationTrackRole)
  );
  return owned.find((node) => node.animationTrackRole === "combination")?.id ||
    owned.find((node) => ["shape", "curve"].includes(node.animationTrackRole))?.id ||
    track?.id;
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
  const { sourceKind: requestedSourceKind, sourceAddress: requestedSourceAddress } = configuration;
  const sourceKind = normalizeAnimationSourceKind(requestedSourceKind);
  const sourceAddress = String(requestedSourceAddress || "");
  const transportKind = ANIMATION_TRANSPORT_KINDS.has(configuration.transportKind)
    ? configuration.transportKind
    : "sequence";
  const triggerKind = ANIMATION_TRIGGER_KINDS.has(configuration.triggerKind)
    ? configuration.triggerKind
    : Number(configuration.randomRate) > 0 ? "random" : "manual";
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
    sourceKind,
    sourceAddress,
    transportKind,
    envelopeInitial: Number.isFinite(Number(configuration.envelopeInitial))
      ? Number(configuration.envelopeInitial)
      : 0,
    envelopeSegments: normalizeEnvelopeSegments(configuration.envelopeSegments),
    triggerKind,
    triggerAddress: String(configuration.triggerAddress || defaultTriggerAddress(triggerKind)),
    triggerThreshold: Math.min(1, Math.max(0,
      Number.isFinite(Number(configuration.triggerThreshold))
        ? Number(configuration.triggerThreshold)
        : 0.5
    )),
    triggerInterval: Math.min(MAX_DURATION, Math.max(0.01, Number(configuration.triggerInterval) || 1)),
    noiseRate: Math.min(120, Math.max(0.01, Number(configuration.noiseRate) || 1)),
    noiseSeed: Number.isFinite(Number(configuration.noiseSeed))
      ? Number(configuration.noiseSeed)
      : 1,
    noiseDetail: Math.min(4, Math.max(1, Math.round(Number(configuration.noiseDetail) || 2))),
    noiseRoughness: Math.min(1, Math.max(0,
      Number.isFinite(Number(configuration.noiseRoughness))
        ? Number(configuration.noiseRoughness)
        : 0.5
    )),
    noiseBurst: configuration.noiseBurst === true,
    smoothing: Math.min(60, Math.max(0, Number(configuration.smoothing) || 0)),
    ...(configuration.defaultAnimationId
      ? { defaultAnimationId: String(configuration.defaultAnimationId) }
      : {}),
  };
}

function normalizedEventTrackConfiguration(configuration = {}) {
  const triggerKind = ANIMATION_TRIGGER_KINDS.has(configuration.triggerKind)
    ? configuration.triggerKind
    : "manual";
  return {
    kind: "event",
    id: String(configuration.id || ""),
    targetNodeId: String(configuration.targetNodeId || ""),
    parameterId: String(configuration.parameterId || ""),
    enabled: configuration.enabled !== false,
    triggerKind,
    triggerAddress: String(
      configuration.triggerAddress || defaultTriggerAddress(triggerKind),
    ),
    triggerThreshold: Math.min(1, Math.max(
      0,
      Number.isFinite(Number(configuration.triggerThreshold))
        ? Number(configuration.triggerThreshold)
        : 0.5,
    )),
    triggerInterval: Math.min(
      MAX_DURATION,
      Math.max(0.01, Number(configuration.triggerInterval) || 1),
    ),
    randomRate: Math.min(
      MAX_RANDOM_RATE,
      Math.max(0, Number(configuration.randomRate) || 0),
    ),
  };
}

function normalizeEnvelopeSegments(value) {
  const source = Array.isArray(value) ? value : DEFAULT_ENVELOPE_SEGMENTS;
  return source.slice(0, 32).map((segment) => ({
    duration: Math.min(MAX_DURATION, Math.max(0.001, Number(segment?.duration) || 0.1)),
    value: Number.isFinite(Number(segment?.value)) ? Number(segment.value) : 0,
    curve: normalizeCurve(segment?.curve),
  }));
}

function defaultTriggerAddress(kind) {
  if (kind === "pointer") return "pressed";
  if (kind === "audio") return "beat";
  return "";
}

function projectedTrackConfiguration(configuration = {}) {
  const normalized = normalizedTrackConfiguration(configuration);
  const projected = { ...normalized };
  if (configuration.envelopeSegments === undefined) {
    delete projected.envelopeInitial;
    delete projected.envelopeSegments;
  }
  if (configuration.triggerKind === undefined) {
    delete projected.triggerKind;
    delete projected.triggerAddress;
    delete projected.triggerThreshold;
    delete projected.triggerInterval;
  }
  if (configuration.noiseRate === undefined) {
    delete projected.noiseRate;
    delete projected.noiseSeed;
    delete projected.noiseDetail;
    delete projected.noiseRoughness;
    delete projected.noiseBurst;
  }
  if (normalized.sourceKind !== "timeline") return projected;
  delete projected.sourceKind;
  delete projected.sourceAddress;
  return projected;
}

function normalizeAnimationSourceKind(value) {
  const kind = String(value || "timeline");
  return LIVE_SIGNAL_KINDS.has(kind) ? kind : "timeline";
}

function liveSignalNodeId(kind) {
  switch (normalizeAnimationSourceKind(kind)) {
    case "pointer": return POINTER_INPUT_NODE_ID;
    case "audio": return AUDIO_INPUT_NODE_ID;
    case "probe": return PROBE_INPUT_NODE_ID;
    case "midi": return "core.control.midi-input";
    case "osc": return "core.control.osc-input";
    default: return HOST_INPUT_NODE_ID;
  }
}

function removeUnusedAnimationTimeNode(scope) {
  const timeNode = scope.nodes.find(isAnimationTimeNode);
  const timeInUse = timeNode && scope.connections.some((edge) =>
    String(edge.from || "") === `${timeNode.id}.time`
  );
  if (!timeNode || timeInUse) return;
  scope.nodes = scope.nodes.filter((node) => node !== timeNode);
  scope.connections = scope.connections.filter((edge) =>
    endpointNodeId(edge.from) !== timeNode.id &&
    endpointNodeId(edge.to) !== timeNode.id
  );
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
