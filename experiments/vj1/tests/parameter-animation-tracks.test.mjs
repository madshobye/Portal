import test from "node:test";
import assert from "node:assert/strict";

import { createVj1NodePackage } from "../js/app-node-package.js";
import { componentSelectedChainSettingsTemplate } from "../js/control/component-view.js";
import { createInitialState, createSceneComponent } from "../js/domain/models.js";
import {
  addParameterAnimationTrack,
  PARAMETER_ANIMATION_STAGES,
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
    params: { speed: 1 },
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
      "core.control.host-input",
      "core.control.map-range",
      "core.control.numeric-combine",
      "core.control.random-trigger",
    ].sort(),
  );
  const host = owned.find((node) => node.nodeId === "core.control.host-input");
  assert.equal(host.parameters.address, parameterAnimationTriggerAddress(componentId, track.id));

  const program = compileComponentRenderPrograms(state.components, nodes.groups, {
    resolveNodeDefinition: (node) => packageRoot.registry.get(node.nodeId, node.nodeVersion),
  }).get(componentId);
  assert.deepEqual(program.plan.controlProgram.diagnostics, []);
  assert.ok(program.plan.controlProgram.inspect().requirements.some((requirement) =>
    requirement.kind === "control-signal" &&
    requirement.signalKind === "control" &&
    requirement.address === host.parameters.address
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
  assert.match(html, />Cycle hue<\/span>/);

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
  assert.match(html, /<strong>Motion speed<\/strong>/);
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
        randomRate: 6,
        combination: "multiply",
      },
    }),
  };
  html = componentSelectedChainSettingsTemplate(component, state);
  assert.match(html, /data-trigger-parameter-animation/);
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
