import test from "node:test";
import assert from "node:assert/strict";

import {
  ANIMATION_CURVES,
  animationCurveControlProcess,
  animationCurveValue,
} from "../js/libraries/control-engine/animation-curve/index.js";
import {
  animationSequencerControlProcess,
  automaticAnimationState,
} from "../js/libraries/control-engine/animation-sequencer/index.js";
import {
  randomTriggerControlProcess,
} from "../js/libraries/control-engine/random-trigger/index.js";
import { publishRendererControlSignal } from "../js/output/control-signal-command.js";

test("Animation curves are finite, bounded, and preserve exact endpoints", () => {
  assert.equal(ANIMATION_CURVES.length, 15);
  for (const curve of ANIMATION_CURVES) {
    assert.equal(animationCurveValue(curve, 0), 0, `${curve} starts at zero`);
    assert.equal(animationCurveValue(curve, 1), 1, `${curve} ends at one`);
    for (let index = 0; index <= 100; index++) {
      const value = animationCurveValue(curve, index / 100);
      assert.ok(Number.isFinite(value), `${curve} stays finite`);
      assert.ok(value >= 0 && value <= 1, `${curve} stays bounded`);
    }
  }
});

test("Return curves can retrace or repeat their forward easing shape", () => {
  const output = {};
  animationCurveControlProcess({
    progress: 0.25,
    direction: -1,
    curve: "quad-in",
    returnMode: "retrace",
  }, { output });
  assert.equal(output.value, 0.75 ** 2);
  animationCurveControlProcess({
    progress: 0.25,
    direction: -1,
    curve: "quad-in",
    returnMode: "repeat",
  }, { output });
  assert.equal(output.value, 1 - 0.25 ** 2);
});

test("Automatic sequencer divides ping-pong duration across legs and holds endpoints", () => {
  const output = {};
  automaticAnimationState(output, 1, "ping-pong", 4, 1, 0);
  assert.deepEqual(output, {
    progress: 0.5,
    direction: 1,
    value: 0.5,
    running: true,
    holding: false,
  });
  automaticAnimationState(output, 2.5, "ping-pong", 4, 1, 0);
  assert.deepEqual(output, {
    progress: 1,
    direction: 1,
    value: 1,
    running: false,
    holding: true,
  });
  automaticAnimationState(output, 4, "ping-pong", 4, 1, 0);
  assert.deepEqual(output, {
    progress: 0.5,
    direction: -1,
    value: 0.5,
    running: true,
    holding: false,
  });
});

test("Triggered sequencer runs a complete ping-pong or one leg per trigger", () => {
  const output = {};
  const state = {};
  const run = (time, trigger, triggerBehavior = "full-sequence") =>
    animationSequencerControlProcess({
      time,
      trigger,
      runMode: "triggered",
      pattern: "ping-pong",
      triggerBehavior,
      duration: 4,
      pause: 1,
    }, { output, state });

  run(0, null);
  run(0, 1);
  assert.equal(output.running, true);
  run(2.5, 1);
  assert.equal(output.holding, true);
  assert.equal(output.value, 1);
  run(3, 1);
  assert.equal(output.running, true);
  assert.equal(output.direction, -1);
  run(5.5, 1);
  assert.equal(output.holding, true);
  run(6, 1);
  assert.equal(output.running, false);
  assert.equal(output.value, 0);

  run(8, 2, "next-leg");
  run(10, 2, "next-leg");
  assert.equal(output.value, 1);
  run(11, 2, "next-leg");
  assert.equal(output.running, false);
  assert.equal(output.value, 1);
  run(11, 3, "next-leg");
  assert.equal(output.direction, -1);
  run(14, 3, "next-leg");
  assert.equal(output.running, false);
  assert.equal(output.value, 0);
});

test("Triggered sequencer ignores events while a sequence is active", () => {
  const output = {};
  const state = {};
  const run = (time, trigger) => animationSequencerControlProcess({
    time,
    trigger,
    runMode: "triggered",
    pattern: "ping-pong",
    triggerBehavior: "full-sequence",
    duration: 4,
  }, { output, state });
  run(0, null);
  run(0, 1);
  run(1, 2);
  run(2, 2);
  assert.equal(output.direction, -1);
  assert.equal(output.value, 1);
  run(4, 2);
  assert.equal(output.running, false);
  assert.equal(output.value, 0);
});

test("Random triggers are deterministic, frame-rate independent, and disabled at zero", () => {
  const disabled = {};
  randomTriggerControlProcess({ time: 100, ratePerMinute: 0, seed: 7 }, { output: disabled });
  assert.equal(disabled.event, null);

  for (let bucket = 0; bucket < 200; bucket++) {
    const first = {};
    const second = {};
    randomTriggerControlProcess({
      time: bucket * 0.25 + 0.01,
      ratePerMinute: 60,
      seed: 23,
    }, { output: first });
    randomTriggerControlProcess({
      time: bucket * 0.25 + 0.24,
      ratePerMinute: 60,
      seed: 23,
    }, { output: second });
    assert.deepEqual(second, first);
  }
});

test("Animation control processes reuse caller-owned output records", () => {
  const curveOutput = {};
  const sequencerOutput = {};
  const randomOutput = {};
  assert.equal(animationCurveControlProcess({}, { output: curveOutput }), curveOutput);
  assert.equal(animationSequencerControlProcess({}, { output: sequencerOutput, state: {} }), sequencerOutput);
  assert.equal(randomTriggerControlProcess({}, { output: randomOutput }), randomOutput);
});

test("Renderer trigger commands publish only valid transient control addresses", () => {
  const published = [];
  const renderer = {
    controlSignalRuntime: {
      publish(...args) {
        published.push(args);
        return true;
      },
    },
  };
  assert.equal(publishRendererControlSignal(renderer, {}), false);
  assert.equal(publishRendererControlSignal(renderer, {
    kind: "control",
    address: "animation:component:track:trigger",
    value: 1,
    sequence: 9,
    timestamp: 123,
  }), true);
  assert.deepEqual(published, [[
    "control",
    "animation:component:track:trigger",
    1,
    { sequence: 9, timestamp: 123 },
  ]]);
});
