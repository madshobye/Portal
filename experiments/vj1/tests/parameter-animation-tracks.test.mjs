import test from "node:test";
import assert from "node:assert/strict";

import { createVj1NodePackage } from "../js/app-node-package.js";
import { parameterAnimationViewTemplate } from "../js/control/animation-view.js";
import { componentSelectedChainSettingsTemplate } from "../js/control/component-view.js";
import {
  createComponentEffect,
  createInitialState,
  createSceneComponent,
} from "../js/domain/models.js";
import {
  addParameterAnimationTrack,
  PARAMETER_ANIMATION_STAGES,
  parameterAnimationSignalSources,
  parameterAnimationTriggerSources,
  parameterAnimationTracks,
  parameterAnimationTriggerAddress,
  removeParameterAnimationTrack,
  updateParameterAnimationTrack,
} from "../js/libraries/composition-engine/shared/parameter-animation-tracks.js";
import { compileComponentRenderPrograms } from "../js/libraries/composition-engine/shared/component-program-compiler.js";
import {
  CHAIN_GENERAL_CONTROL_PATHS,
  chainGeneralControlParameterId,
} from "../js/libraries/composition-engine/shared/chain-general-control-parameters.js";
import { serializeNodeProjectData } from "../js/libraries/node-engine/node-project.js";
import { ControlSignalRuntime } from "../js/output/control-signal-runtime.js";
import {
  getEffectNodeComponent,
  getGeneratorNodeComponent,
} from "../js/libraries/visual-nodes/index.js";

function plasmaState() {
  const packageRoot = createVj1NodePackage();
  const initial = createInitialState();
  const component = initial.components.find((item) => item.type !== "scene");
  const source = component.chain[0];
  source.source = {
    type: "generator",
    generatorId: "plasma",
    params: { speed: 1, motionMode: "steady" },
  };
  initial.ui.selectedComponentId = component.id;
  initial.ui.selectedChainItemId = source.id;
  return {
    packageRoot,
    state: packageRoot.prepareProjectState(initial),
    componentId: component.id,
    targetNodeId: source.id,
  };
}

test("Animation tracks author the existing Component control graph and restore its generated value binding", () => {
  const { state, componentId, targetNodeId } = plasmaState();
  const groupBefore = state.nodes.groups.find((group) => group.componentId === componentId);
  const baseControl = groupBefore.nodes.find((node) =>
    node.targetNodeId === targetNodeId && node.targetParameterId === "speed"
  );
  assert.ok(baseControl);
  assert.ok(groupBefore.connections.some((edge) =>
    edge.from === `${baseControl.id}.value` &&
    edge.to === `${targetNodeId}.$parameter.speed`
  ));

  let nodes = addParameterAnimationTrack(state.nodes, {
    componentId,
    targetNodeId,
    parameterId: "speed",
    from: -0.5,
    to: 2.5,
    duration: 4,
  });
  const group = nodes.groups.find((entry) => entry.componentId === componentId);
  const [track] = parameterAnimationTracks(nodes, componentId, targetNodeId);
  assert.deepEqual(
    {
      parameterId: track.parameterId,
      enabled: track.enabled,
      mode: track.mode,
      from: track.from,
      to: track.to,
      duration: track.duration,
    },
    {
      parameterId: "speed",
      enabled: true,
      mode: "loop",
      from: 0,
      to: 2.5,
      duration: 4,
    },
  );
  assert.equal(group.authoredConnections, true);
  assert.equal(group.persistence, "project-diff");
  assert.ok(group.nodes.some((node) => node.nodeId === "core.control.component-time"));
  assert.ok(group.nodes.some((node) => node.nodeId === "core.control.animation-sequencer"));
  assert.ok(group.nodes.some((node) => node.nodeId === "core.control.animation-curve"));
  assert.ok(!group.connections.some((edge) =>
    edge.from === `${baseControl.id}.value` &&
    edge.to === `${targetNodeId}.$parameter.speed`
  ));

  nodes = updateParameterAnimationTrack(nodes, {
    componentId,
    targetNodeId,
    trackId: track.id,
    patch: { mode: "ping-pong", duration: 2, enabled: false },
  });
  assert.deepEqual(
    parameterAnimationTracks(nodes, componentId, targetNodeId)[0],
    {
      ...track,
      enabled: false,
      mode: "ping-pong",
      duration: 2,
    },
  );
  assert.ok(nodes.groups.find((entry) => entry.componentId === componentId).connections.some((edge) =>
    edge.from === `${baseControl.id}.value` &&
    edge.to === `${targetNodeId}.$parameter.speed`
  ));

  nodes = updateParameterAnimationTrack(nodes, {
    componentId,
    targetNodeId,
    trackId: track.id,
    patch: { from: -1, to: 3 },
  });
  assert.deepEqual(
    parameterAnimationTracks(nodes, componentId, targetNodeId)[0],
    {
      ...track,
      enabled: false,
      mode: "ping-pong",
      duration: 2,
      from: 0,
      to: 3,
    },
  );

  nodes = removeParameterAnimationTrack(nodes, {
    componentId,
    targetNodeId,
    trackId: track.id,
  });
  const restored = nodes.groups.find((entry) => entry.componentId === componentId);
  assert.deepEqual(parameterAnimationTracks(nodes, componentId, targetNodeId), []);
  assert.ok(restored.connections.some((edge) =>
    edge.from === `${baseControl.id}.value` &&
    edge.to === `${targetNodeId}.$parameter.speed`
  ));
  assert.ok(!restored.nodes.some((node) => node.nodeId === "core.control.component-time"));
  assert.ok(!restored.nodes.some((node) => node.nodeId === "core.control.animation-sequencer"));
  assert.ok(!restored.nodes.some((node) => node.nodeId === "core.control.animation-curve"));
});

test("Numeric animation tracks materialize all six stages and combine with the live authored base", () => {
  const { packageRoot, state, componentId, targetNodeId } = plasmaState();
  let nodes = addParameterAnimationTrack(state.nodes, {
    componentId,
    targetNodeId,
    parameterId: "speed",
    combination: "add",
    from: 0,
    to: 2,
    duration: 2,
  });
  const [track] = parameterAnimationTracks(nodes, componentId, targetNodeId);
  const group = nodes.groups.find((entry) => entry.componentId === componentId);
  const owned = group.nodes.filter((node) =>
    node.animationTrack?.id === track.id || node.animationTrackOwnerId === track.id
  );
  const stages = new Set([
    ...group.nodes.filter((node) => node.animationTimeSource).map((node) => node.animationStage),
    ...owned.map((node) => node.animationTrackStage),
    ...group.connections
      .filter((edge) => edge.semantic === "parameter-animation-track")
      .map((edge) => edge.animationStage)
      .filter(Boolean),
  ]);
  assert.deepEqual([...PARAMETER_ANIMATION_STAGES].filter((stage) => !stages.has(stage)), []);
  assert.ok(owned.some((node) => node.nodeId === "core.control.map-range"));
  assert.ok(owned.some((node) =>
    node.nodeId === "core.control.numeric-combine" &&
    node.parameters.mode === "add"
  ));
  const base = group.nodes.find((node) =>
    node.targetNodeId === targetNodeId && node.targetParameterId === "speed"
  );
  assert.ok(group.connections.some((edge) =>
    edge.from === `${base.id}.value` &&
    edge.to === `${track.id}:combination.base`
  ));

  const program = compileComponentRenderPrograms(state.components, nodes.groups, {
    resolveNodeDefinition: (node) => packageRoot.registry.get(node.nodeId, node.nodeVersion),
  }).get(componentId);
  const operation = program.plan.operations.find((entry) => entry.id === targetNodeId);
  operation.configuration.source.params.speed = 2;
  program.plan.controlProgram.syncGeneratedControlsFromConfiguration();
  const restore = program.plan.controlProgram.apply({ componentTime: 0.5 });
  assert.equal(operation.configuration.source.params.speed, 2.5);
  restore();
  assert.equal(operation.configuration.source.params.speed, 2);

  nodes = updateParameterAnimationTrack(nodes, {
    componentId,
    targetNodeId,
    trackId: track.id,
    patch: {
      combination: "multiply",
      from: 1,
      to: 1.5,
    },
  });
  const multipliedProgram = compileComponentRenderPrograms(state.components, nodes.groups, {
    resolveNodeDefinition: (node) => packageRoot.registry.get(node.nodeId, node.nodeVersion),
  }).get(componentId);
  const multipliedOperation = multipliedProgram.plan.operations.find((entry) => entry.id === targetNodeId);
  multipliedOperation.configuration.source.params.speed = 2;
  multipliedProgram.plan.controlProgram.syncGeneratedControlsFromConfiguration();
  const restoreMultiplied = multipliedProgram.plan.controlProgram.apply({ componentTime: 0.5 });
  assert.equal(multipliedOperation.configuration.source.params.speed, 2.25);
  restoreMultiplied();
  assert.equal(multipliedOperation.configuration.source.params.speed, 2);
});

test("Animation graph fragments survive project serialization and ordinary parameter reconciliation", () => {
  const { packageRoot, state, componentId, targetNodeId } = plasmaState();
  const animatedNodes = addParameterAnimationTrack(state.nodes, {
    componentId,
    targetNodeId,
    parameterId: "speed",
    from: 0.25,
    to: 2,
    duration: 3,
  });
  const serialized = serializeNodeProjectData(animatedNodes);
  const storedGroup = serialized.groups.find((group) => group.componentId === componentId);
  assert.equal(storedGroup.compactTopology, undefined);
  assert.ok(storedGroup.nodes.some((node) => node.animationTrack));
  assert.ok(storedGroup.connections.some((edge) => edge.semantic === "parameter-animation-track"));

  const previous = { ...state, nodes: animatedNodes };
  const componentIndex = previous.components.findIndex((component) => component.id === componentId);
  const component = previous.components[componentIndex];
  const nextComponent = {
    ...component,
    chain: component.chain.map((item) => item.id === targetNodeId
      ? {
        ...item,
        source: {
          ...item.source,
          params: { ...item.source.params, speed: 2.5 },
        },
      }
      : item),
  };
  const next = {
    ...previous,
    components: previous.components.map((entry, index) => index === componentIndex ? nextComponent : entry),
  };
  const reconciled = packageRoot.prepareProjectChange(previous, next);
  const [track] = parameterAnimationTracks(reconciled.nodes, componentId, targetNodeId);
  assert.equal(track.parameterId, "speed");
  const group = reconciled.nodes.groups.find((entry) => entry.componentId === componentId);
  const baseControl = group.nodes.find((node) =>
    node.targetNodeId === targetNodeId && node.targetParameterId === "speed"
  );
  assert.ok(baseControl);
  assert.notEqual(baseControl.parameters.value, 0, "the refreshed generated fallback follows the authored base value");
  assert.ok(group.connections.some((edge) =>
    edge.from === `${track.id}:combination.value` &&
    edge.to === `${targetNodeId}.$parameter.speed`
  ));
});

test("Animation creation materializes an untouched declared parameter into graph authority", () => {
  const { state, componentId, targetNodeId } = plasmaState();
  const before = state.nodes.groups.find((entry) => entry.componentId === componentId);
  assert.ok(!before.nodes.some((node) =>
    node.targetNodeId === targetNodeId && node.targetParameterId === "direction"
  ));
  const nodes = addParameterAnimationTrack(state.nodes, {
    componentId,
    targetNodeId,
    parameterId: "direction",
    baseValue: 0.65,
    targetRange: [-3.14, 3.14],
    from: 0.65,
    to: 3.14,
  });
  const group = nodes.groups.find((entry) => entry.componentId === componentId);
  const control = group.nodes.find((node) =>
    node.targetNodeId === targetNodeId && node.targetParameterId === "direction"
  );
  const target = group.nodes.find((node) => node.id === targetNodeId);
  assert.ok(control);
  assert.equal(target.parameters.direction, 0.65);
  assert.equal(target.configuration.source.params.direction, 0.65);
  assert.equal(parameterAnimationTracks(nodes, componentId, targetNodeId)[0].parameterId, "direction");
});

test("Animation tracks execute through the allocation-stable compiled control program", () => {
  const { packageRoot, state, componentId, targetNodeId } = plasmaState();
  const nodes = addParameterAnimationTrack(state.nodes, {
    componentId,
    targetNodeId,
    parameterId: "speed",
    from: 0,
    to: 4,
    duration: 2,
  });
  const program = compileComponentRenderPrograms(state.components, nodes.groups, {
    resolveNodeDefinition: (node) => packageRoot.registry.get(node.nodeId, node.nodeVersion),
  }).get(componentId);
  const operation = program.plan.operations.find((entry) => entry.id === targetNodeId);
  assert.ok(operation);
  assert.deepEqual(program.plan.controlProgram.diagnostics, []);
  assert.equal(program.plan.controlProgram.steps.some((step) => step.nodeId === "core.control.component-time"), true);
  assert.equal(program.plan.controlProgram.steps.some((step) => step.nodeId === "core.control.animation-sequencer"), true);
  assert.equal(program.plan.controlProgram.steps.some((step) => step.nodeId === "core.control.animation-curve"), true);
  assert.equal(String(program.plan.controlProgram.constructor.name).includes("NodeGraph"), false);
  const retainedOutputs = program.plan.controlProgram.steps.map((step) => step.outputValues);

  const restore = program.plan.controlProgram.apply({ componentTime: 1 });
  assert.equal(operation.configuration.source.params.speed, 2);
  restore();
  assert.equal(operation.configuration.source.params.speed, 1);
  const restoreAgain = program.plan.controlProgram.apply({ componentTime: 1.25 });
  assert.ok(program.plan.controlProgram.steps.every((step, index) =>
    step.outputValues === retainedOutputs[index]
  ));
  restoreAgain();
});

test("live animation drivers reuse Mapping Combination and Sink without a timeline transport", () => {
  const { packageRoot, state, componentId, targetNodeId } = plasmaState();
  const nodes = addParameterAnimationTrack(state.nodes, {
    componentId,
    targetNodeId,
    parameterId: "speed",
    sourceKind: "pointer",
    sourceAddress: "x",
    from: 0,
    to: 4,
  });
  const [track] = parameterAnimationTracks(nodes, componentId, targetNodeId);
  assert.equal(track.sourceKind, "pointer");
  assert.equal(track.sourceAddress, "x");
  const group = nodes.groups.find((entry) => entry.componentId === componentId);
  const owned = group.nodes.filter((node) =>
    node.animationTrack?.id === track.id || node.animationTrackOwnerId === track.id
  );
  assert.deepEqual(
    owned.map((node) => node.nodeId).sort(),
    [
      "core.control.map-range",
      "core.control.numeric-combine",
      "core.control.pointer-input",
    ],
  );
  assert.equal(group.nodes.some((node) => node.nodeId === "core.control.component-time"), false);

  const program = compileComponentRenderPrograms(state.components, nodes.groups, {
    resolveNodeDefinition: (node) => packageRoot.registry.get(node.nodeId, node.nodeVersion),
  }).get(componentId);
  const operation = program.plan.operations.find((entry) => entry.id === targetNodeId);
  assert.deepEqual(
    program.inspect().readiness.requirements.filter(({ kind }) => kind === "control-signal"),
    [{
      kind: "control-signal",
      signalKind: "pointer",
      address: "x",
      required: false,
    }],
  );
  const signals = new ControlSignalRuntime();
  signals.publish("pointer", "x", 0.75);
  const restore = program.plan.controlProgram.apply({
    renderRequest: { controlSignals: signals },
  });
  assert.equal(operation.configuration.source.params.speed, 3);
  restore();
  signals.dispose();
});

test("audio animation drivers retain the frame clock needed by live Web Audio analysis", () => {
  const { packageRoot, state, componentId, targetNodeId } = plasmaState();
  const nodes = addParameterAnimationTrack(state.nodes, {
    componentId,
    targetNodeId,
    parameterId: "speed",
    sourceKind: "audio",
    sourceAddress: "low",
    from: 0,
    to: 4,
  });
  const program = compileComponentRenderPrograms(state.components, nodes.groups, {
    resolveNodeDefinition: (node) => packageRoot.registry.get(node.nodeId, node.nodeVersion),
  }).get(componentId);
  const audioStep = program.plan.controlProgram.inspect().steps.find(
    ({ nodeId }) => nodeId === "core.control.audio-input",
  );
  assert.equal(audioStep.frameDependent, true);
  assert.equal(program.inspect().dynamics.frameDependent, true);
});

test("animation source catalog exposes pointer audio beat and local Probe features", () => {
  const { state, componentId, targetNodeId } = plasmaState();
  const group = state.nodes.groups.find((entry) => entry.componentId === componentId);
  group.nodes.push({
    id: "probe-a",
    nodeId: "vj1.visual.effect.probe",
    role: "effect",
    configuration: { name: "Stage Probe" },
  });
  const sources = parameterAnimationSignalSources(
    state.nodes,
    componentId,
    targetNodeId,
  );
  assert.ok(sources.some(({ kind, address }) => kind === "pointer" && address === "x"));
  assert.ok(sources.some(({ kind, address }) => kind === "audio" && address === "beat:low"));
  assert.ok(sources.some(({ kind, address, label }) =>
    kind === "probe" &&
    address === `component:${componentId}:probe:probe-a:brightness` &&
    label === "Stage Probe · Brightness"
  ));
});

test("triggered envelopes route audio beats through one editable retained graph", () => {
  const { packageRoot, state, componentId, targetNodeId } = plasmaState();
  const nodes = addParameterAnimationTrack(state.nodes, {
    componentId,
    targetNodeId,
    parameterId: "speed",
    from: 0,
    to: 3,
    transportKind: "envelope",
    triggerKind: "audio",
    triggerAddress: "beat:low",
    envelopeSegments: [
      { duration: 0.08, value: 1, curve: "quad-out" },
      { duration: 0.3, value: 0, curve: "cubic-out" },
    ],
  });
  const [track] = parameterAnimationTracks(nodes, componentId, targetNodeId);
  assert.equal(track.transportKind, "envelope");
  assert.equal(track.triggerKind, "audio");
  assert.equal(track.triggerAddress, "beat:low");
  assert.equal(track.envelopeSegments.length, 2);
  const group = nodes.groups.find((entry) => entry.componentId === componentId);
  const owned = group.nodes.filter((node) =>
    node.animationTrack?.id === track.id || node.animationTrackOwnerId === track.id
  );
  assert.ok(owned.some((node) => node.nodeId === "core.control.segment-envelope"));
  assert.ok(owned.some((node) => node.nodeId === "core.control.audio-input"));
  assert.ok(!owned.some((node) => node.nodeId === "core.control.animation-sequencer"));
  assert.ok(!owned.some((node) => node.nodeId === "core.control.animation-curve"));
  const program = compileComponentRenderPrograms(state.components, nodes.groups, {
    resolveNodeDefinition: (node) => packageRoot.registry.get(node.nodeId, node.nodeVersion),
  }).get(componentId);
  assert.deepEqual(program.plan.controlProgram.diagnostics, []);
  assert.ok(program.plan.controlProgram.inspect().requirements.some((requirement) =>
    requirement.kind === "control-signal" &&
    requirement.signalKind === "audio" &&
    requirement.address === "beat:low"
  ));
});

test("noise bursts compose Noise Envelope Smooth Mapping and Combination as ordinary nodes", () => {
  const { packageRoot, state, componentId, targetNodeId } = plasmaState();
  const nodes = addParameterAnimationTrack(state.nodes, {
    componentId,
    targetNodeId,
    parameterId: "speed",
    from: 0,
    to: 3,
    transportKind: "noise",
    noiseRate: 8,
    noiseDetail: 3,
    noiseRoughness: 0.65,
    noiseBurst: true,
    smoothing: 0.04,
    triggerKind: "manual",
    envelopeSegments: [
      { duration: 0.03, value: 1, curve: "quad-out" },
      { duration: 0.45, value: 0, curve: "cubic-out" },
    ],
  });
  const [track] = parameterAnimationTracks(nodes, componentId, targetNodeId);
  assert.equal(track.transportKind, "noise");
  assert.equal(track.noiseBurst, true);
  assert.equal(track.smoothing, 0.04);
  const group = nodes.groups.find((entry) => entry.componentId === componentId);
  const ownedIds = group.nodes
    .filter((node) => node.animationTrack?.id === track.id || node.animationTrackOwnerId === track.id)
    .map((node) => node.nodeId);
  for (const nodeId of [
    "core.control.scalar-noise",
    "core.control.segment-envelope",
    "core.control.scalar-math",
    "core.control.smooth",
    "core.control.map-range",
    "core.control.numeric-combine",
    "core.control.host-input",
  ]) {
    assert.ok(ownedIds.includes(nodeId), nodeId);
  }
  const program = compileComponentRenderPrograms(state.components, nodes.groups, {
    resolveNodeDefinition: (node) => packageRoot.registry.get(node.nodeId, node.nodeVersion),
  }).get(componentId);
  assert.deepEqual(program.plan.controlProgram.diagnostics, []);
});

test("animation trigger catalog exposes manual periodic random pointer audio and Probe threshold sources", () => {
  const { state, componentId, targetNodeId } = plasmaState();
  const sources = parameterAnimationTriggerSources(state.nodes, componentId, targetNodeId);
  assert.deepEqual(
    sources.slice(0, 8).map((source) => [source.kind, source.address]),
    [
      ["manual", ""],
      ["periodic", ""],
      ["random", ""],
      ["pointer", "pressed"],
      ["audio", "beat"],
      ["audio", "beat:low"],
      ["audio", "beat:mid"],
      ["audio", "beat:high"],
    ],
  );
});

test("General parameter animations use the same direct control program and restore retained configuration", () => {
  const { packageRoot, state, componentId, targetNodeId } = plasmaState();
  const opacityId = chainGeneralControlParameterId(CHAIN_GENERAL_CONTROL_PATHS.OPACITY);
  const contentXId = chainGeneralControlParameterId(CHAIN_GENERAL_CONTROL_PATHS.CONTENT_X);
  const boundaryScaleId = chainGeneralControlParameterId(CHAIN_GENERAL_CONTROL_PATHS.BOUNDARY_SCALE);
  let nodes = addParameterAnimationTrack(state.nodes, {
    componentId,
    targetNodeId,
    parameterId: opacityId,
    baseValue: 1,
    targetRange: [0, 1],
    from: 0,
    to: 1,
    duration: 2,
  });
  nodes = addParameterAnimationTrack(nodes, {
    componentId,
    targetNodeId,
    parameterId: contentXId,
    baseValue: 0,
    targetRange: [-2, 2],
    from: 0,
    to: 2,
    duration: 2,
  });
  nodes = addParameterAnimationTrack(nodes, {
    componentId,
    targetNodeId,
    parameterId: boundaryScaleId,
    baseValue: 1,
    targetRange: [0.005, 4],
    from: 0.5,
    to: 2,
    duration: 2,
  });
  const program = compileComponentRenderPrograms(state.components, nodes.groups, {
    resolveNodeDefinition: (node) => packageRoot.registry.get(node.nodeId, node.nodeVersion),
  }).get(componentId);
  const operation = program.plan.operations.find((entry) => entry.id === targetNodeId);
  assert.deepEqual(program.plan.controlProgram.diagnostics, []);

  const originalBoundary = { ...operation.configuration.boundary };
  const restore = program.plan.controlProgram.apply({ componentTime: 1 });
  assert.equal(operation.configuration.opacity, 0.5);
  assert.equal(operation.configuration.transform.x, 1);
  assert.ok(Math.abs(
    Math.sqrt(
      operation.configuration.boundary.width *
      operation.configuration.boundary.height,
    ) - 1.25,
  ) < 1e-9);
  restore();
  assert.equal(operation.configuration.opacity, 1);
  assert.equal(operation.configuration.transform.x, 0);
  assert.deepEqual(operation.configuration.boundary, originalBoundary);
});

test("General animation fallbacks survive reconciliation and follow the latest static value", () => {
  const { packageRoot, state, componentId, targetNodeId } = plasmaState();
  const opacityId = chainGeneralControlParameterId(CHAIN_GENERAL_CONTROL_PATHS.OPACITY);
  const animatedNodes = addParameterAnimationTrack(state.nodes, {
    componentId,
    targetNodeId,
    parameterId: opacityId,
    baseValue: 1,
    targetRange: [0, 1],
    from: 0,
    to: 1,
    duration: 2,
  });
  const previous = { ...state, nodes: animatedNodes };
  const next = {
    ...previous,
    components: previous.components.map((component) => component.id === componentId
      ? {
        ...component,
        chain: component.chain.map((item) =>
          item.id === targetNodeId ? { ...item, opacity: 0.4 } : item
        ),
      }
      : component),
  };
  let reconciled = packageRoot.prepareProjectChange(previous, next);
  let group = reconciled.nodes.groups.find((entry) => entry.componentId === componentId);
  const fallback = group.nodes.find((node) =>
    node.animationFallback === true &&
    node.targetNodeId === targetNodeId &&
    node.targetParameterId === opacityId
  );
  assert.ok(fallback);
  assert.equal(fallback.parameters.value, 0.4);

  const [track] = parameterAnimationTracks(reconciled.nodes, componentId, targetNodeId)
    .filter((entry) => entry.parameterId === opacityId);
  reconciled = {
    ...reconciled,
    nodes: updateParameterAnimationTrack(reconciled.nodes, {
      componentId,
      targetNodeId,
      trackId: track.id,
      patch: { enabled: false },
    }),
  };
  const program = compileComponentRenderPrograms(reconciled.components, reconciled.nodes.groups, {
    resolveNodeDefinition: (node) => packageRoot.registry.get(node.nodeId, node.nodeVersion),
  }).get(componentId);
  group = reconciled.nodes.groups.find((entry) => entry.componentId === componentId);
  assert.ok(group.connections.some((edge) =>
    edge.from === `${fallback.id}.value` &&
    edge.to === `${targetNodeId}.$parameter.${opacityId}`
  ));
  const operation = program.plan.operations.find((entry) => entry.id === targetNodeId);
  const restore = program.plan.controlProgram.apply({ componentTime: 1 });
  assert.equal(operation.configuration.opacity, 0.4);
  restore();
  assert.equal(operation.configuration.opacity, 0.4);
});

test("Triggered animation tracks compile one sequencer fragment with transient and deterministic event inputs", () => {
  const { packageRoot, state, componentId, targetNodeId } = plasmaState();
  const nodes = addParameterAnimationTrack(state.nodes, {
    componentId,
    targetNodeId,
    parameterId: "speed",
    mode: "ping-pong",
    runMode: "triggered",
    triggerBehavior: "next-leg",
    curve: "cubic-in-out",
    returnMode: "repeat",
    duration: 4,
    pause: 0.5,
    randomRate: 12,
    from: 0,
    to: 4,
  });
  const [track] = parameterAnimationTracks(nodes, componentId, targetNodeId);
  assert.deepEqual(track, {
    id: track.id,
    targetNodeId,
    parameterId: "speed",
    enabled: true,
    mode: "ping-pong",
    from: 0,
    to: 4,
    duration: 4,
    phase: 0,
    curve: "cubic-in-out",
    returnMode: "repeat",
    pause: 0.5,
    runMode: "triggered",
    triggerBehavior: "next-leg",
    randomRate: 12,
    combination: "replace",
    transportKind: "sequence",
    triggerKind: "random",
    triggerAddress: "",
    triggerThreshold: 0.5,
    triggerInterval: 1,
    smoothing: 0,
  });
  const group = nodes.groups.find((entry) => entry.componentId === componentId);
  const owned = group.nodes.filter((node) =>
    node.animationTrack?.id === track.id || node.animationTrackOwnerId === track.id
  );
  assert.deepEqual(
    owned.map((node) => node.nodeId).sort(),
    [
      "core.control.animation-curve",
      "core.control.animation-sequencer",
      "core.control.map-range",
      "core.control.numeric-combine",
      "core.control.random-trigger",
    ].sort(),
  );
  const program = compileComponentRenderPrograms(state.components, nodes.groups, {
    resolveNodeDefinition: (node) => packageRoot.registry.get(node.nodeId, node.nodeVersion),
  }).get(componentId);
  assert.deepEqual(program.plan.controlProgram.diagnostics, []);
  assert.ok(!program.plan.controlProgram.inspect().requirements.some((requirement) =>
    requirement.kind === "control-signal" &&
    requirement.signalKind === "control"
  ));
  const removed = removeParameterAnimationTrack(nodes, {
    componentId,
    targetNodeId,
    trackId: track.id,
  });
  const removedGroup = removed.groups.find((entry) => entry.componentId === componentId);
  assert.ok(!removedGroup.nodes.some((node) =>
    node.animationTrack?.id === track.id || node.animationTrackOwnerId === track.id
  ));
});

test("Editing a legacy oscillator track migrates it through the common sequencer fragment factory", () => {
  const { state, componentId, targetNodeId } = plasmaState();
  let nodes = addParameterAnimationTrack(state.nodes, {
    componentId,
    targetNodeId,
    parameterId: "speed",
    mode: "ping-pong",
    duration: 4,
    phase: 0.2,
    from: 0,
    to: 3,
  });
  const [created] = parameterAnimationTracks(nodes, componentId, targetNodeId);
  const groups = nodes.groups.map((group) => {
    if (group.componentId !== componentId) return group;
    const ownerIds = new Set(group.nodes
      .filter((node) =>
        node.animationTrack?.id === created.id || node.animationTrackOwnerId === created.id
      )
      .map((node) => node.id));
    const legacy = {
      id: created.id,
      nodeId: "core.control.oscillator",
      nodeVersion: "0.1.0",
      role: "control",
      parameters: { waveform: "triangle", frequency: 0.25, phase: 0.2 },
      authoredBy: "vj1-animation-editor",
      animationTrack: {
        feature: "parameter-animation-track",
        id: created.id,
        targetNodeId,
        parameterId: "speed",
        range: [0, 3],
      },
    };
    const time = group.nodes.find((node) => node.nodeId === "core.control.component-time");
    return {
      ...group,
      nodes: [
        ...group.nodes.filter((node) => !ownerIds.has(node.id)),
        legacy,
      ],
      connections: [
        ...group.connections.filter((edge) =>
          !ownerIds.has(String(edge.from || "").split(".")[0]) &&
          !ownerIds.has(String(edge.to || "").split(".")[0]) &&
          edge.to !== `${targetNodeId}.$parameter.speed`
        ),
        { from: `${time.id}.time`, to: `${legacy.id}.time`, type: "number" },
        {
          from: `${legacy.id}.value`,
          to: `${targetNodeId}.$parameter.speed`,
          type: "number",
          sourceRange: [0, 1],
          targetRange: [0, 3],
          semantic: "parameter-animation-track",
        },
      ],
    };
  });
  nodes = { ...nodes, groups };
  assert.equal(parameterAnimationTracks(nodes, componentId, targetNodeId)[0].duration, 4);

  nodes = updateParameterAnimationTrack(nodes, {
    componentId,
    targetNodeId,
    trackId: created.id,
    patch: { curve: "quart-in-out", pause: 1 },
  });
  const group = nodes.groups.find((entry) => entry.componentId === componentId);
  assert.ok(!group.nodes.some((node) =>
    node.animationTrack?.id === created.id && node.nodeId === "core.control.oscillator"
  ));
  assert.ok(group.nodes.some((node) =>
    node.animationTrack?.id === created.id && node.nodeId === "core.control.animation-sequencer"
  ));
  assert.equal(parameterAnimationTracks(nodes, componentId, targetNodeId)[0].curve, "quart-in-out");
  assert.equal(parameterAnimationTracks(nodes, componentId, targetNodeId)[0].pause, 1);
});

test("Manual animation events advance compiled Preview and Output programs through host control signals", () => {
  const { packageRoot, state, componentId, targetNodeId } = plasmaState();
  const nodes = addParameterAnimationTrack(state.nodes, {
    componentId,
    targetNodeId,
    parameterId: "speed",
    mode: "ping-pong",
    runMode: "triggered",
    triggerBehavior: "next-leg",
    duration: 2,
    from: 0,
    to: 4,
  });
  const [track] = parameterAnimationTracks(nodes, componentId, targetNodeId);
  const program = compileComponentRenderPrograms(state.components, nodes.groups, {
    resolveNodeDefinition: (node) => packageRoot.registry.get(node.nodeId, node.nodeVersion),
  }).get(componentId);
  const operation = program.plan.operations.find((entry) => entry.id === targetNodeId);
  const signals = new ControlSignalRuntime();
  const request = { componentTime: 0, renderRequest: { controlSignals: signals } };
  program.plan.controlProgram.apply(request)();
  signals.publish("control", parameterAnimationTriggerAddress(componentId, track.id), 1, {
    sequence: 1,
    timestamp: 0,
  });
  request.componentTime = 0;
  program.plan.controlProgram.apply(request)();
  request.componentTime = 0.5;
  const restore = program.plan.controlProgram.apply(request);
  assert.equal(operation.configuration.source.params.speed, 2);
  restore();
  signals.dispose();
});

test("Generic animation recipes render once and target the selected parameter", () => {
  const html = parameterAnimationViewTemplate({
    state: { nodes: {} },
    componentId: "component-a",
    targetNodeId: "node-a",
    parameters: [
      { id: "first", label: "First", type: "number", min: 0, max: 1, value: 0.25 },
      { id: "second", label: "Second", type: "number", min: -1, max: 1, value: 0 },
      { id: "third", label: "Third", type: "number", min: 0, max: 10, value: 5 },
    ],
  });
  assert.equal((html.match(/>Triggered envelope<\/span>/g) || []).length, 1);
  assert.equal((html.match(/>Noise drift<\/span>/g) || []).length, 1);
  assert.equal((html.match(/>Triggered noise burst<\/span>/g) || []).length, 1);
  assert.equal((html.match(/data-animation-use-selected-parameter="true"/g) || []).length, 3);
  assert.match(html, /data-animation-new-parameter/);
  assert.match(html, /value="first"/);
  assert.match(html, /value="second"/);
  assert.match(html, /value="third"/);
});

test("An animation track can move to another unclaimed numeric parameter", () => {
  const fixture = plasmaState();
  let nodes = addParameterAnimationTrack(fixture.state.nodes, {
    componentId: fixture.componentId,
    targetNodeId: fixture.targetNodeId,
    parameterId: "speed",
    from: 0,
    to: 2,
    duration: 3,
  });
  const [track] = parameterAnimationTracks(
    nodes,
    fixture.componentId,
    fixture.targetNodeId,
  );
  nodes = updateParameterAnimationTrack(nodes, {
    componentId: fixture.componentId,
    targetNodeId: fixture.targetNodeId,
    trackId: track.id,
    patch: {
      parameterId: "hueShift",
      baseValue: 0,
      targetRange: [-1, 1],
    },
  });
  const [retargeted] = parameterAnimationTracks(
    nodes,
    fixture.componentId,
    fixture.targetNodeId,
  );
  assert.equal(retargeted.id, track.id);
  assert.equal(retargeted.parameterId, "hueShift");
  assert.equal(retargeted.defaultAnimationId, undefined);

  const group = nodes.groups.find((entry) => entry.componentId === fixture.componentId);
  const speedControl = group.nodes.find((node) =>
    node.targetNodeId === fixture.targetNodeId && node.targetParameterId === "speed"
  );
  const hueControl = group.nodes.find((node) =>
    node.targetNodeId === fixture.targetNodeId && node.targetParameterId === "hueShift"
  );
  assert.ok(group.connections.some((edge) =>
    edge.from === `${speedControl.id}.value` &&
    edge.to === `${fixture.targetNodeId}.$parameter.speed`
  ));
  assert.ok(!group.connections.some((edge) =>
    edge.from === `${hueControl.id}.value` &&
    edge.to === `${fixture.targetNodeId}.$parameter.hueShift`
  ));
  assert.ok(group.connections.some((edge) =>
    edge.semantic === "parameter-animation-track" &&
    edge.to === `${fixture.targetNodeId}.$parameter.hueShift`
  ));
});

test("Visual parameters expose editable suggested animations without a separate runtime", () => {
  const suggestions = [
    [getGeneratorNodeComponent("gradient"), "angle", "Rotate continuously"],
    [getGeneratorNodeComponent("plasma"), "hueShift", "Cycle hue"],
    [getEffectNodeComponent("spinRotate"), "amount", "Pulse amount"],
  ];
  for (const [component, parameterId, label] of suggestions) {
    const parameter = component.params.find((entry) => entry.id === parameterId);
    assert.equal(parameter.suggestedAnimations?.[0]?.label, label);
    assert.equal(
      component.nodeDefinition.parameters[parameterId].metadata.suggestedAnimations?.[0]?.label,
      label,
    );
  }
});

test("Plasma exposes one editable default track and ordinary addable animation suggestions", () => {
  const fixture = plasmaState();
  const component = fixture.state.components
    .find((entry) => entry.id === fixture.componentId);
  const source = component.chain.find((entry) => entry.id === fixture.targetNodeId);
  source.source.params.motionMode = "drift";
  const state = fixture.packageRoot.prepareProjectState({
    ...fixture.state,
    nodes: {
      ...fixture.state.nodes,
      groups: [],
    },
  });
  const tracks = parameterAnimationTracks(
    state.nodes,
    fixture.componentId,
    fixture.targetNodeId,
  );
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].parameterId, "phase");
  assert.equal(tracks[0].defaultAnimationId, "vj1.visual.generator.plasma:phase:plasma-motion@1");

  const plasma = getGeneratorNodeComponent("plasma");
  const html = parameterAnimationViewTemplate({
    state,
    componentId: fixture.componentId,
    targetNodeId: fixture.targetNodeId,
    parameters: plasma.params.map((parameter) => ({
      ...parameter,
      value: source.source.params[parameter.id] ?? parameter.defaultValue,
    })),
  });
  assert.match(html, /<strong>Motion phase<\/strong>/);
  assert.match(html, /data-remove-parameter-animation/);
  assert.match(html, /Orbit direction<\/span>/);
  assert.match(html, /Breathe cell scale<\/span>/);
  assert.match(html, /Breathe distortion<\/span>/);
  assert.match(html, /Cycle hue<\/span>/);
  assert.doesNotMatch(html, />Motion<\/span>\\s*<select/);

  const removedState = fixture.packageRoot.prepareProjectState({
    ...state,
    nodes: removeParameterAnimationTrack(state.nodes, {
      componentId: fixture.componentId,
      targetNodeId: fixture.targetNodeId,
      trackId: tracks[0].id,
    }),
  });
  assert.deepEqual(
    parameterAnimationTracks(
      removedState.nodes,
      fixture.componentId,
      fixture.targetNodeId,
    ),
    [],
    "removing Plasma motion must not silently recreate its default track",
  );
  const removedHtml = parameterAnimationViewTemplate({
    state: removedState,
    componentId: fixture.componentId,
    targetNodeId: fixture.targetNodeId,
    parameters: plasma.params.map((parameter) => ({
      ...parameter,
      value: source.source.params[parameter.id] ?? parameter.defaultValue,
    })),
  });
  assert.match(removedHtml, /Plasma motion<\/span>/);
  const staticProgram = compileComponentRenderPrograms(
    removedState.components,
    removedState.nodes.groups,
    {
      resolveNodeDefinition: (node) =>
        fixture.packageRoot.registry.get(node.nodeId, node.nodeVersion),
    },
  ).get(fixture.componentId);
  assert.equal(
    staticProgram.inspect().dynamics.frameDependent,
    false,
    "removed Plasma motion must leave no hidden shader clock",
  );
});

test("Obvious built-in shader motion is authored once as an editable default animation graph", () => {
  const packageRoot = createVj1NodePackage();
  const initial = createInitialState();
  const component = initial.components.find((item) => item.type !== "scene");
  const effect = createComponentEffect("spinRotate", { speed: -0.5 });
  component.chain.push(effect);

  let state = packageRoot.prepareProjectState(initial);
  const [track] = parameterAnimationTracks(state.nodes, component.id, effect.id);
  assert.deepEqual(
    {
      parameterId: track.parameterId,
      mode: track.mode,
      from: track.from,
      to: track.to,
      duration: track.duration,
      phase: track.phase,
      curve: track.curve,
      defaultAnimationId: track.defaultAnimationId,
    },
    {
      parameterId: "phase",
      mode: "loop",
      from: Math.PI,
      to: -Math.PI,
      duration: Math.PI * 4,
      phase: 0.5,
      curve: "linear",
      defaultAnimationId: "vj1.visual.effect.spinRotate:phase:continuous@1",
    },
  );
  const group = state.nodes.groups.find((entry) => entry.componentId === component.id);
  const target = group.nodes.find((node) => node.id === effect.id);
  assert.ok(target.animationDefaults.handled.includes(track.defaultAnimationId));
  assert.equal(group.persistence, "project-diff");
  assert.ok(group.nodes.some((node) => node.nodeId === "core.control.component-time"));
  assert.ok(group.nodes.some((node) => node.nodeId === "core.control.animation-sequencer"));
  assert.ok(group.nodes.some((node) => node.nodeId === "core.control.animation-curve"));
  assert.ok(group.nodes.some((node) => node.nodeId === "core.control.map-range"));
  assert.ok(group.nodes.some((node) => node.nodeId === "core.control.numeric-combine"));
  const program = compileComponentRenderPrograms(state.components, state.nodes.groups, {
    resolveNodeDefinition: (node) => packageRoot.registry.get(node.nodeId, node.nodeVersion),
  }).get(component.id);
  const operation = program.plan.operations.find((entry) => entry.id === effect.id);
  assert.equal(program.inspect().dynamics.frameDependent, true);
  const restore = program.plan.controlProgram.apply({ componentTime: 1 });
  assert.ok(Math.abs(operation.configuration.params.phase + 0.5) < 1e-9);
  restore();

  state = {
    ...state,
    nodes: removeParameterAnimationTrack(state.nodes, {
      componentId: component.id,
      targetNodeId: effect.id,
      trackId: track.id,
    }),
  };
  state = packageRoot.prepareProjectState(state);
  assert.deepEqual(parameterAnimationTracks(state.nodes, component.id, effect.id), []);
  const reconciledTarget = state.nodes.groups
    .find((entry) => entry.componentId === component.id)
    .nodes.find((node) => node.id === effect.id);
  assert.ok(
    reconciledTarget.animationDefaults.handled.includes(track.defaultAnimationId),
    "removing an editable default must not silently recreate it",
  );
  const phaseParameter = getEffectNodeComponent("spinRotate").params
    .find((parameter) => parameter.id === "phase");
  const html = parameterAnimationViewTemplate({
    state,
    componentId: component.id,
    targetNodeId: effect.id,
    parameters: [{ ...phaseParameter, value: 0 }],
  });
  assert.match(html, /Continuous rotation<\/span>/);
  assert.match(html, /data-animation-phase="0.5"/);
});

test("Heartbeat materializes its periodic double beat as an ordinary editable envelope", () => {
  const packageRoot = createVj1NodePackage();
  const initial = createInitialState();
  const component = initial.components.find((item) => item.type !== "scene");
  const effect = createComponentEffect("heartbeatPulse");
  component.chain.push(effect);
  const state = packageRoot.prepareProjectState(initial);
  const [track] = parameterAnimationTracks(state.nodes, component.id, effect.id);
  assert.equal(track.parameterId, "pulse");
  assert.equal(track.transportKind, "envelope");
  assert.equal(track.triggerKind, "periodic");
  assert.equal(track.triggerInterval, 1);
  assert.equal(track.envelopeSegments.length, 5);
  const group = state.nodes.groups.find((entry) => entry.componentId === component.id);
  const owned = group.nodes.filter((node) =>
    node.animationTrack?.id === track.id || node.animationTrackOwnerId === track.id
  );
  assert.ok(owned.some((node) => node.nodeId === "core.control.segment-envelope"));
  assert.ok(owned.some((node) => node.nodeId === "core.control.periodic-trigger"));
  assert.ok(!owned.some((node) => node.nodeId === "core.control.animation-sequencer"));
  const html = parameterAnimationViewTemplate({
    state,
    componentId: component.id,
    targetNodeId: effect.id,
    parameters: getEffectNodeComponent("heartbeatPulse").params.map((parameter) => ({
      ...parameter,
      value: effect.params[parameter.id] ?? parameter.defaultValue,
    })),
  });
  assert.match(html, /<strong>Pulse<\/strong>/);
  assert.match(html, /data-animation-envelope-segment/);
  assert.match(html, />\s*Periodic/);
  assert.match(html, /data-animation-track-field="envelopeInitial"/);
  assert.match(html, /data-animation-track-field="triggerInterval"/);
});

test("Converted shader motion exposes phase parameters and no longer reads the shader clock", () => {
  const expectations = [
    ["spinRotate", ["phase"]],
    ["rgbSplit", ["phase"]],
    ["ripple", ["phase"]],
    ["mirrorFold", ["phase"]],
    ["tileRepeat", ["phaseX", "phaseY"]],
  ];
  for (const [effectId, phaseIds] of expectations) {
    const effect = getEffectNodeComponent(effectId);
    assert.doesNotMatch(effect.code, /\btime\b/, `${effectId} should have one animation authority`);
    for (const phaseId of phaseIds) {
      const parameter = effect.params.find((entry) => entry.id === phaseId);
      assert.ok(parameter?.defaultAnimation, `${effectId}.${phaseId} should declare its editable default`);
      assert.equal(
        effect.nodeDefinition.parameters[phaseId].metadata.defaultAnimation.id,
        parameter.defaultAnimation.id,
      );
    }
  }
  assert.equal(
    getGeneratorNodeComponent("terrainFlyover").params
      .find((parameter) => parameter.id === "flightSpeed")?.label,
    "Flight speed",
    "unbounded terrain travel remains a semantic speed rather than a fake bounded phase",
  );
});

test("Tile Repeat migrates independent signed scroll rates into exact phase-track timing", () => {
  const packageRoot = createVj1NodePackage();
  const initial = createInitialState();
  const component = initial.components.find((item) => item.type !== "scene");
  const effect = createComponentEffect("tileRepeat", {
    scrollX: 0.25,
    scrollY: -0.5,
  });
  component.chain.push(effect);

  const state = packageRoot.prepareProjectState(initial);
  const tracks = parameterAnimationTracks(state.nodes, component.id, effect.id);
  assert.deepEqual(tracks.map((track) => ({
    parameterId: track.parameterId,
    from: track.from,
    to: track.to,
    duration: track.duration,
  })), [
    { parameterId: "phaseX", from: 0, to: 1, duration: 4 },
    { parameterId: "phaseY", from: 1, to: 0, duration: 2 },
  ]);
});

test("Component and Scene inspectors share one Animation tab before General", () => {
  const fixture = plasmaState();
  let state = fixture.state;
  let component = state.components.find((entry) => entry.id === fixture.componentId);
  let html = componentSelectedChainSettingsTemplate(component, state);
  assert.match(html, />Animation<\/label>/);
  assert.ok(html.indexOf(">Animation</label>") < html.indexOf(">General</label>"));
  assert.match(html, /data-animation-new-parameter/);
  assert.match(html, /value="speed"/);
  assert.match(html, /value="\$general\.opacity"/);
  assert.match(html, />Boundary scale<\/option>/);
  assert.match(html, /data-add-animation-suggestion/);
  assert.match(html, /Cycle hue<\/span>/);

  state = {
    ...state,
    nodes: addParameterAnimationTrack(state.nodes, {
      componentId: fixture.componentId,
      targetNodeId: fixture.targetNodeId,
      parameterId: "speed",
      from: 0,
      to: 2,
      duration: 2,
    }),
  };
  html = componentSelectedChainSettingsTemplate(component, state);
  assert.match(html, /class="parameter-animation-track is-enabled"/);
  assert.match(html, /<strong>Motion amount<\/strong>/);
  assert.match(html, /data-animation-track-field="mode"/);
  assert.match(html, /data-animation-track-field="curve"/);
  assert.match(html, /data-animation-track-field="runMode"/);
  assert.match(html, /data-animation-track-field="pause"/);
  assert.match(html, /data-animation-track-field="combination"/);
  const [uiTrack] = parameterAnimationTracks(state.nodes, fixture.componentId, fixture.targetNodeId);
  state = {
    ...state,
    nodes: updateParameterAnimationTrack(state.nodes, {
      componentId: fixture.componentId,
      targetNodeId: fixture.targetNodeId,
      trackId: uiTrack.id,
      patch: {
        mode: "ping-pong",
        runMode: "triggered",
        triggerBehavior: "next-leg",
        triggerKind: "random",
        randomRate: 6,
        combination: "multiply",
      },
    }),
  };
  html = componentSelectedChainSettingsTemplate(component, state);
  assert.match(html, /data-animation-trigger-source/);
  assert.match(html, /data-toggle-animation-return/);
  assert.match(html, /data-animation-track-field="triggerBehavior"/);
  assert.match(html, /data-animation-track-field="randomRate"/);
  assert.match(html, /data-animation-track-field="combination"/);
  assert.match(html, /value="multiply" selected/);
  assert.match(html, /Stop at each end/);

  const scene = createSceneComponent(0);
  const effect = {
    id: "scene-animation-effect",
    kind: "effect",
    componentId: "invert",
    enabled: true,
    params: { amount: 0.5 },
    opacity: 1,
    blend: "normal",
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
  };
  const withEffect = {
    ...state,
    components: [...state.components, { ...scene, chain: [effect] }],
    ui: { ...state.ui, selectedComponentId: scene.id, selectedChainItemId: effect.id },
  };
  const prepared = fixture.packageRoot.prepareProjectState(withEffect);
  component = prepared.components.find((entry) => entry.id === scene.id);
  html = componentSelectedChainSettingsTemplate(component, prepared);
  assert.match(html, />Animation<\/label>/);
  assert.match(html, /value="amount"/);
});
