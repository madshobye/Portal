import test from "node:test";
import assert from "node:assert/strict";

import { createVj1NodePackage } from "../js/app-node-package.js";
import { componentSelectedChainSettingsTemplate } from "../js/control/component-view.js";
import { createInitialState, createSceneComponent } from "../js/domain/models.js";
import {
  addParameterAnimationTrack,
  parameterAnimationTracks,
  removeParameterAnimationTrack,
  updateParameterAnimationTrack,
} from "../js/libraries/composition-engine/shared/parameter-animation-tracks.js";
import { compileComponentRenderPrograms } from "../js/libraries/composition-engine/shared/component-program-compiler.js";
import {
  CHAIN_GENERAL_CONTROL_PATHS,
  chainGeneralControlParameterId,
} from "../js/libraries/composition-engine/shared/chain-general-control-parameters.js";
import { serializeNodeProjectData } from "../js/libraries/node-engine/node-project.js";

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
  assert.ok(group.nodes.some((node) => node.nodeId === "core.control.oscillator"));
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
  assert.ok(!restored.nodes.some((node) => node.nodeId === "core.control.oscillator"));
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
    edge.from === `${track.id}.value` &&
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
  assert.equal(program.plan.controlProgram.steps.some((step) => step.nodeId === "core.control.oscillator"), true);
  assert.equal(String(program.plan.controlProgram.constructor.name).includes("NodeGraph"), false);

  const restore = program.plan.controlProgram.apply({ componentTime: 1 });
  assert.equal(operation.configuration.source.params.speed, 2);
  restore();
  assert.equal(operation.configuration.source.params.speed, 1);
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
