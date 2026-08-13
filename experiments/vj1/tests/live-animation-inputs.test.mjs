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
  ProbeRuntime,
  probeColorFeatures,
  probeOpticalFlowFeatures,
  probeSampleGeometry,
  probeValuesChanged,
} from "../js/output/probe-runtime.js";
import { AsyncPixelReadback } from "../js/output/async-pixel-readback.js";

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

test("Probe optical flow exposes translation, rotation, expansion, amount, and confidence", () => {
  const width = 8;
  const height = 8;
  const grid = (offsetX = 0) => Array.from({ length: width * height }, (_, index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    const value = Math.max(0, 1 - Math.hypot(x - 3.1 - offsetX, y - 3.7) / 4);
    return { brightness: value };
  });
  const stationary = probeOpticalFlowFeatures(grid(), grid(), width, height);
  const translated = probeOpticalFlowFeatures(grid(), grid(0.25), width, height, {
    gain: 2,
    threshold: 0,
  });

  assert.deepEqual(stationary, {
    flow: 0,
    flowX: 0,
    flowY: 0,
    flowRotation: 0,
    flowExpansion: 0,
    flowConfidence: 0,
  });
  assert.equal(translated.flow > 0, true);
  assert.equal(translated.flowX > 0, true);
  assert.equal(Math.abs(translated.flowY) < translated.flowX, true);
  assert.equal(translated.flowConfidence > 0, true);
  assert.equal(Number.isFinite(translated.flowRotation), true);
  assert.equal(Number.isFinite(translated.flowExpansion), true);
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
      { x: 0.5, y: 0.5, width: 0.5, height: 0.5, rotation: 0 },
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

test("Probe publishes each changed upstream sample without waiting for presentation time", () => {
  const publications = [];
  const runtime = new ProbeRuntime({
    componentProgramRuntime: {
      requiresControlSignal: (_kind, address) =>
        !/:(flow|flowX|flowY|flowRotation|flowExpansion|flowConfidence)$/.test(address),
    },
    controlSignalRuntime: {
      publishBatch(kind, addresses, metadata) {
        publications.push({ kind, addresses, metadata });
        return true;
      },
    },
  }, {
    clock: () => 100,
  });
  let sample = probeColorFeatures([255, 0, 0, 255]);
  runtime.sample = () => sample;
  const component = { id: "component-a" };
  const operation = { id: "probe-a" };
  const renderedItem = { id: "probe-a", boundary: {} };
  const renderState = { buffer: {} };

  assert.equal(
    runtime.observe(component, operation, renderedItem, renderState, {}),
    true,
  );
  sample = probeColorFeatures([0, 255, 0, 255]);
  assert.equal(
    runtime.observe(component, operation, renderedItem, renderState, {}),
    true,
  );
  assert.equal(
    runtime.observe(component, operation, renderedItem, renderState, {}),
    false,
  );
  assert.equal(publications.length, 2);
  assert.equal(publications[0].metadata.timestamp, 100);
  assert.equal(publications[1].metadata.timestamp, 100);
});

test("Probe pixel readback waits for a WebGL2 fence instead of synchronizing the frame", () => {
  const calls = [];
  const statuses = [0x911B, 0x911A, 0x911A];
  const gl = {
    PIXEL_PACK_BUFFER: 0x88EB,
    STREAM_READ: 0x88E1,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    SYNC_GPU_COMMANDS_COMPLETE: 0x9117,
    ALREADY_SIGNALED: 0x911A,
    CONDITION_SATISFIED: 0x911C,
    WAIT_FAILED: 0x911D,
    createBuffer: () => ({ id: "pbo" }),
    bindBuffer: (...args) => calls.push(["bindBuffer", ...args]),
    bufferData: (...args) => calls.push(["bufferData", ...args]),
    readPixels: (...args) => calls.push(["readPixels", ...args]),
    fenceSync: () => ({ id: "fence" }),
    clientWaitSync: () => statuses.shift(),
    getBufferSubData(_target, _offset, pixels) {
      pixels.set([12, 34, 56, 255]);
    },
    deleteSync: () => calls.push(["deleteSync"]),
    deleteBuffer: () => calls.push(["deleteBuffer"]),
    flush: () => calls.push(["flush"]),
  };
  let begins = 0;
  let ends = 0;
  const target = {
    drawingContext: gl,
    framebuffer: {
      begin: () => begins++,
      end: () => ends++,
    },
  };
  const readback = new AsyncPixelReadback();

  assert.deepEqual(readback.read(target, "probe-a", 1, 1, "frame-1"), {
    supported: true,
    pixels: null,
    revision: "",
    pending: true,
  });
  assert.deepEqual(readback.read(target, "probe-a", 1, 1, "frame-1"), {
    supported: true,
    pixels: null,
    revision: "",
    pending: true,
  });
  const completed = readback.read(target, "probe-a", 1, 1, "frame-2");
  assert.equal(completed.supported, true);
  assert.deepEqual([...completed.pixels], [12, 34, 56, 255]);
  assert.equal(completed.revision, "frame-1");
  assert.equal(completed.pending, true);
  assert.equal(calls.filter(([name]) => name === "readPixels").length, 2);
  assert.equal(begins, 2);
  assert.equal(ends, 2);

  const stable = readback.read(target, "probe-a", 1, 1, "frame-2");
  assert.deepEqual([...stable.pixels], [12, 34, 56, 255]);
  assert.equal(stable.pending, false);
  assert.equal(calls.filter(([name]) => name === "readPixels").length, 2);

  readback.dispose();
  assert.equal(calls.some(([name]) => name === "deleteBuffer"), true);
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
  const probe = createComponentEffect("probe");
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
  assert.equal(Object.hasOwn(operation.configuration.params, "sampleRate"), false);
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
