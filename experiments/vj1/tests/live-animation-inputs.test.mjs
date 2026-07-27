import test from "node:test";
import assert from "node:assert/strict";

import { createVj1NodePackage } from "../js/app-node-package.js";
import {
  createComponentEffect,
  createInitialState,
} from "../js/domain/models.js";
import { compileComponentRenderPrograms } from "../js/libraries/composition-engine/shared/component-program-compiler.js";
import { addParameterAnimationTrack } from "../js/libraries/composition-engine/shared/parameter-animation-tracks.js";
import { probeSignalAddress } from "../js/libraries/control-engine/live-signal-addresses.js";
import {
  pointerSignalValues,
  projectUsesPointerSignals,
} from "../js/output/pointer-control-signals.js";
import {
  probeColorFeatures,
  probeSampleGeometry,
  probeValuesChanged,
} from "../js/output/probe-runtime.js";

test("pointer control values are normalized and pointer demand follows the authored graph", () => {
  assert.deepEqual(pointerSignalValues({
    x: 25,
    y: 75,
    width: 100,
    height: 100,
    down: true,
    inside: false,
    event: "pressed",
  }), {
    x: 0.25,
    y: 0.75,
    down: 1,
    inside: 0,
    pressed: 1,
  });
  assert.equal(projectUsesPointerSignals({ nodes: { groups: [] } }), false);
  assert.equal(projectUsesPointerSignals({
    nodes: {
      groups: [{
        nodes: [{
          role: "control",
          parameters: { kind: "pointer", address: "x" },
        }],
      }],
    },
  }), true);
});

test("Probe color reduction publishes stable normalized RGB HSV brightness and alpha features", () => {
  const features = probeColorFeatures([255, 0, 0, 128]);
  assert.deepEqual(features, {
    r: 1,
    g: 0,
    b: 0,
    h: 0,
    s: 1,
    v: 1,
    brightness: 0.2126,
    alpha: 128 / 255,
  });
  assert.deepEqual(
    probeSampleGeometry(
      { x: 0, y: 0, width: 0.5, height: 0.5, rotation: 0 },
      { width: 100, height: 50 },
      { width: 100, height: 50 },
    ),
    {
      center: [0.5, 0.5],
      size: [0.5, 0.5],
      rotation: 0,
    },
  );
  assert.equal(probeValuesChanged(features, { ...features }), false);
  assert.equal(probeValuesChanged(features, { ...features, r: 0.9 }), true);
});

test("Probe compiles as a passthrough observer and activates only through a local animation signal dependency", () => {
  const packageRoot = createVj1NodePackage();
  let state = createInitialState();
  const component = state.components.find((entry) => entry.type !== "scene");
  component.chain[0].source = {
    type: "generator",
    generatorId: "plasma",
    params: { speed: 1, motionMode: "steady" },
  };
  const probe = createComponentEffect("probe", { sampleRate: 12 });
  component.chain.push(probe);
  state = packageRoot.prepareProjectState(state);
  state.nodes = addParameterAnimationTrack(state.nodes, {
    componentId: component.id,
    targetNodeId: component.chain[0].id,
    parameterId: "speed",
    sourceKind: "probe",
    sourceAddress: probeSignalAddress(
      component.id,
      probe.id,
      "brightness",
    ),
    from: 0,
    to: 2,
  });

  const program = compileComponentRenderPrograms(
    state.components,
    state.nodes.groups,
    {
      resolveNodeDefinition: (node) =>
        packageRoot.registry.get(node.nodeId, node.nodeVersion),
    },
  ).get(component.id);
  const operation = program.plan.operations.find(({ id }) => id === probe.id);
  assert.equal(operation.opcode, "probe");
  assert.equal(operation.backend, "probe-observer");
  assert.equal(operation.configuration.params.sampleRate, 12);
  assert.deepEqual(
    program.inspect().readiness.requirements.filter(({ kind }) =>
      kind === "control-signal"
    ),
    [{
      kind: "control-signal",
      signalKind: "probe",
      address: probeSignalAddress(component.id, probe.id, "brightness"),
      required: false,
    }],
  );
});
