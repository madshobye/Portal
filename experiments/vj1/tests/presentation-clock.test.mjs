import test from "node:test";
import assert from "node:assert/strict";

import {
  advancePresentationClock,
  createPresentationClock,
} from "../js/libraries/timing-engine/presentation-clock/index.js";

test("presentation clock removes ordinary callback jitter without losing raw time", () => {
  let clock = createPresentationClock();
  const presentationDeltas = [];
  for (const delta of [0.031, 0.035, 0.032, 0.036]) {
    clock = advancePresentationClock(clock, delta, 30, true);
    presentationDeltas.push(clock.presentationDeltaSeconds);
  }
  assert.ok(Math.abs(clock.rawElapsedSeconds - 0.134) < 1e-12);
  assert.ok(Math.max(...presentationDeltas) - Math.min(...presentationDeltas) < 0.001);
  assert.ok(Math.abs(clock.presentationElapsedSeconds - clock.rawElapsedSeconds) < 0.002);
});

test("presentation clock advances multiple cadence ticks after a dropped frame", () => {
  const clock = advancePresentationClock(createPresentationClock(), 0.067, 30, true);
  assert.ok(Math.abs(clock.presentationDeltaSeconds - 2 / 30) < 0.001);
});

test("presentation clock corrects fractional display cadence without periodic catch-up jumps", () => {
  let clock = createPresentationClock();
  const deltas = [];
  for (let index = 0; index < 600; index++) {
    clock = advancePresentationClock(clock, 1 / 59.94, 60, true);
    deltas.push(clock.presentationDeltaSeconds);
  }
  assert.ok(Math.max(...deltas) < 0.017);
  assert.ok(Math.min(...deltas) > 0.016);
  assert.ok(Math.abs(clock.presentationElapsedSeconds - clock.rawElapsedSeconds) < 0.001);
});

test("presentation clock retains raw diagnostics while playback is paused", () => {
  const clock = advancePresentationClock(createPresentationClock(), 0.033, 30, false);
  assert.equal(clock.presentationDeltaSeconds, 0);
  assert.ok(Math.abs(clock.rawElapsedSeconds - 0.033) < 1e-12);
});

test("presentation clock realigns phase when cadence changes", () => {
  let clock = advancePresentationClock(createPresentationClock(), 0.016, 60, true);
  clock = advancePresentationClock(clock, 0.034, 30, true);
  assert.ok(Math.abs(clock.presentationDeltaSeconds - 1 / 30) < 0.001);
  assert.equal(clock.cadenceFps, 30);
});
