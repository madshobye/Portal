import test from "node:test";
import assert from "node:assert/strict";

import {
  componentTimeControlProcess,
  eventTriggerControlProcess,
  frameDelayControlProcess,
  hostSignalControlProcess,
  mapRangeControlProcess,
  numericCombineControlProcess,
  oscillatorControlProcess,
  sampleHoldControlProcess,
  scalarMathControlProcess,
  selectControlProcess,
  smoothControlProcess,
  vector2ControlProcess,
  vector3ControlProcess,
} from "../js/libraries/control-engine/index.js";

test("reusable modulation nodes provide time, waveforms, mapping, and scalar composition", () => {
  assert.deepEqual(componentTimeControlProcess({ scale: 2, offset: 1 }, { componentTime: 3 }), { time: 7 });
  assert.deepEqual(oscillatorControlProcess({ time: 0.25, waveform: "sine" }), { value: 1, bipolar: 1 });
  assert.deepEqual(oscillatorControlProcess({ time: 0.25, waveform: "triangle" }), { value: 0.5, bipolar: 0 });
  assert.deepEqual(mapRangeControlProcess({
    value: 1.5,
    inputMin: 0,
    inputMax: 1,
    outputMin: 10,
    outputMax: 20,
    clamp: true,
  }), { value: 20 });
  assert.deepEqual(scalarMathControlProcess({ a: 4, b: 3, operation: "multiply" }), { value: 12 });
  assert.deepEqual(scalarMathControlProcess({ a: 4, b: 0, operation: "divide" }), { value: 0 });
  assert.deepEqual(
    numericCombineControlProcess({ base: 0.4, modulation: 0.8, mode: "replace" }),
    { value: 0.8 },
  );
  assert.deepEqual(
    numericCombineControlProcess({
      base: 0.7,
      modulation: 0.5,
      mode: "add",
      clamp: true,
      minimum: 0,
      maximum: 1,
    }),
    { value: 1 },
  );
  assert.deepEqual(
    numericCombineControlProcess({ base: 0.4, modulation: 1.5, mode: "multiply" }),
    { value: 0.6000000000000001 },
  );
});

test("vector selection and stateful signal operators retain their frame-loop storage", () => {
  const vector2State = {};
  const vector2Output = {};
  vector2ControlProcess({ x: 2, y: 3 }, { state: vector2State, output: vector2Output });
  const retainedVector2 = vector2Output.value;
  vector2ControlProcess({ x: 4, y: 5 }, { state: vector2State, output: vector2Output });
  assert.strictEqual(vector2Output.value, retainedVector2);
  assert.deepEqual(vector2Output.value, [4, 5]);

  const vector3State = {};
  const vector3Output = {};
  vector3ControlProcess({ x: 1, y: 2, z: 3 }, { state: vector3State, output: vector3Output });
  const retainedVector3 = vector3Output.value;
  vector3ControlProcess({ x: 6, y: 7, z: 8 }, { state: vector3State, output: vector3Output });
  assert.strictEqual(vector3Output.value, retainedVector3);
  assert.deepEqual(vector3Output.value, [6, 7, 8]);

  assert.deepEqual(selectControlProcess({ index: 2, a: "a", b: "b", c: "c", d: "d" }), { value: "c" });

  const smoothState = {};
  const smoothOutput = {};
  smoothControlProcess({ value: 0, timeConstant: 1 }, { timestamp: 0, state: smoothState, output: smoothOutput });
  smoothControlProcess({ value: 1, timeConstant: 1 }, { timestamp: 1, state: smoothState, output: smoothOutput });
  assert.ok(Math.abs(smoothOutput.value - (1 - Math.exp(-1))) < 1e-12);

  const delayState = {};
  const delayOutput = {};
  frameDelayControlProcess({ value: 10, initial: -1 }, { state: delayState, output: delayOutput });
  assert.equal(delayOutput.value, -1);
  frameDelayControlProcess({ value: 20, initial: -1 }, { state: delayState, output: delayOutput });
  assert.equal(delayOutput.value, 10);
});

test("event and sample-and-hold nodes communicate through monotonic tokens", () => {
  const triggerState = {};
  const triggerOutput = {};
  const holdState = {};
  const holdOutput = {};

  eventTriggerControlProcess({ value: 0.2, threshold: 0.5 }, { state: triggerState, output: triggerOutput });
  sampleHoldControlProcess(
    { value: 10, event: triggerOutput.event, initial: -1 },
    { state: holdState, output: holdOutput },
  );
  assert.equal(triggerOutput.event, null);
  assert.equal(holdOutput.value, -1);

  eventTriggerControlProcess({ value: 0.8, threshold: 0.5 }, { state: triggerState, output: triggerOutput });
  sampleHoldControlProcess(
    { value: 20, event: triggerOutput.event, initial: -1 },
    { state: holdState, output: holdOutput },
  );
  assert.equal(triggerOutput.event, 1);
  assert.equal(holdOutput.value, 20);

  sampleHoldControlProcess(
    { value: 30, event: triggerOutput.event, initial: -1 },
    { state: holdState, output: holdOutput },
  );
  assert.equal(holdOutput.value, 20);
});

test("host control adapter resolves MIDI OSC audio and application signals without owning I/O", () => {
  const signals = {
    midi: new Map([["1:cc:1", { value: 0.75, sequence: 4 }]]),
    osc: { "/vj1/value": 0.5 },
    audio: { level: 0.25 },
    control: { scene: "intro" },
  };
  const output = {};
  const state = {};

  hostSignalControlProcess(
    { kind: "midi", address: "1:cc:1", fallback: 0 },
    { renderRequest: { controlSignals: signals }, output, state },
  );
  assert.deepEqual(output, { value: 0.75, number: 0.75, event: 4, available: true });

  hostSignalControlProcess(
    { kind: "osc", address: "/missing", fallback: 0.2 },
    { renderRequest: { controlSignals: signals }, output, state },
  );
  assert.deepEqual(output, { value: 0.2, number: 0.2, event: 4, available: false });

  hostSignalControlProcess(
    { kind: "audio", address: "level", fallback: 0 },
    { renderRequest: { controlSignals: { resolve: (kind, address) => signals[kind]?.[address] } }, output, state },
  );
  assert.equal(output.value, 0.25);
  assert.equal(output.available, true);
});
