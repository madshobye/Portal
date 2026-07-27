import test from "node:test";
import assert from "node:assert/strict";
import {
  createSessionTimeline,
  frameTimestampWallTimeMs,
  rebaseSessionTimeline,
  sampleSessionTimeline,
  sessionTimelineNowMs,
} from "../js/libraries/timing-engine/session-timeline/index.js";
import { createAppState } from "../js/app-state.js";
import { createInitialState } from "../js/domain/models.js";
import { OutputFrameRuntime } from "../js/output/output-frame-runtime.js";

test("session timeline rebases play and rate changes without changing logical position or seed", () => {
  const initial = {
    ...createSessionTimeline(1000, 42),
    anchorTimeSeconds: 5,
  };
  assert.equal(sampleSessionTimeline(initial, 2000), 6);

  const faster = rebaseSessionTimeline(
    initial,
    { playing: true, timeStretch: 0 },
    { playing: true, timeStretch: 1 },
    2000,
  );
  assert.equal(faster.anchorTimeSeconds, 6);
  assert.equal(faster.rate, 2);
  assert.equal(faster.seed, 42);
  assert.equal(faster.revision, 2);
  assert.equal(sampleSessionTimeline(faster, 2500), 7);

  const paused = rebaseSessionTimeline(
    faster,
    { playing: true, timeStretch: 1 },
    { playing: false, timeStretch: 1 },
    2500,
  );
  assert.equal(sampleSessionTimeline(paused, 9000), 7);
});

test("session timeline uses the high-resolution frame timestamp in the shared wall-clock epoch", () => {
  const clock = {
    timeOrigin: 1_700_000_000_000.25,
    now: () => 125.125,
  };
  assert.equal(sessionTimelineNowMs(clock), 1_700_000_000_125.375);
  assert.equal(
    frameTimestampWallTimeMs(141.7916666667, clock),
    1_700_000_000_142.0417,
  );
});

test("app state owns one session timeline revision across Live and project commands", () => {
  const store = createAppState(createInitialState());
  const initial = store.getState().metrics.sessionTimeline;
  store.update((draft) => {
    draft.global.timeStretch = 1;
  }, "timeline-rate");
  const faster = store.getState().metrics.sessionTimeline;
  assert.equal(faster.revision, initial.revision + 1);
  assert.equal(faster.seed, initial.seed);

  store.update((draft) => {
    draft.global.playing = false;
  }, "toggle-output-playback");
  const paused = store.getState().metrics.sessionTimeline;
  assert.equal(paused.revision, faster.revision + 1);
  assert.equal(paused.seed, initial.seed);
});

test("Preview and Output frame runtimes sample identical logical time and seed", () => {
  const timeline = {
    ...createSessionTimeline(1000, 9876),
    anchorTimeSeconds: 3,
  };
  const host = () => ({
    state: { components: [] },
    componentProgramRuntime: {
      componentById: new Map(),
      runtimeComponents: [],
    },
  });
  const preview = new OutputFrameRuntime(host());
  const output = new OutputFrameRuntime(host());

  preview.tickSessionTimeline(timeline, 2250);
  output.tickSessionTimeline(timeline, 2250);

  assert.equal(preview.visualTime, 4.25);
  assert.equal(output.visualTime, preview.visualTime);
  assert.equal(output.sessionSeed, preview.sessionSeed);
  assert.equal(output.sessionSeed, 9876);
});

test("frame clock advances shared animation time without Date.now quantization", () => {
  const firstFrameMs = 1000.125;
  const secondFrameMs = firstFrameMs + 1000 / 60;
  const timeline = {
    ...createSessionTimeline(
      performance.timeOrigin + firstFrameMs,
      1234,
    ),
    anchorTimeSeconds: 2,
  };
  const runtime = new OutputFrameRuntime({
    mode: "output",
    state: {
      global: { playing: true },
      render: { maxFrameRate: 60 },
      metrics: { sessionTimeline: timeline },
      components: [{ id: "component-a", speed: 1 }],
    },
    componentProgramRuntime: {
      componentById: new Map(),
      runtimeComponents: [],
    },
    presentationRuntime: {
      shouldUseThumbnailPreview: () => false,
    },
  });
  runtime.lastTickMs = firstFrameMs;
  runtime.tickClock(firstFrameMs);
  runtime.tickClock(secondFrameMs);

  assert.ok(Math.abs(runtime.visualTime - (2 + 1 / 60)) < 1e-6);
  assert.ok(Math.abs(runtime.visualDeltaSeconds - 1 / 60) < 1e-6);
  assert.ok(
    Math.abs(runtime.componentTimes.get("component-a") - (2 + 1 / 60)) < 1e-6,
  );
});
