import { globalVisualTimeScale } from "../visual-time-scale/index.js";

export function sessionTimelineNowMs(clock = globalThis.performance) {
  if (
    Number.isFinite(clock?.timeOrigin) &&
    typeof clock?.now === "function"
  ) {
    return clock.timeOrigin + clock.now();
  }
  return Date.now();
}

export function frameTimestampWallTimeMs(
  frameTimestampMs,
  clock = globalThis.performance,
) {
  const timestamp = Number(frameTimestampMs);
  if (Number.isFinite(timestamp) && Number.isFinite(clock?.timeOrigin)) {
    return clock.timeOrigin + timestamp;
  }
  return sessionTimelineNowMs(clock);
}

export function createSessionTimeline(
  nowMs = sessionTimelineNowMs(),
  seed = randomSessionSeed(),
) {
  return {
    revision: 1,
    anchorWallTimeMs: Number(nowMs) || 0,
    anchorTimeSeconds: 0,
    playing: true,
    rate: 1,
    seed: Number(seed) >>> 0,
  };
}

export function sampleSessionTimeline(
  timeline = null,
  nowMs = sessionTimelineNowMs(),
) {
  if (!timeline) return 0;
  const anchor = Math.max(0, Number(timeline.anchorTimeSeconds) || 0);
  if (timeline.playing === false) return anchor;
  const elapsed = Math.max(0, (Number(nowMs) - (Number(timeline.anchorWallTimeMs) || 0)) / 1000);
  return anchor + elapsed * Math.max(0, Number(timeline.rate) || 0);
}

export function rebaseSessionTimeline(
  timeline,
  previousGlobal = {},
  nextGlobal = {},
  nowMs = sessionTimelineNowMs(),
) {
  const current = timeline || createSessionTimeline(nowMs);
  const playing = nextGlobal?.playing !== false;
  const rate = globalVisualTimeScale(nextGlobal);
  const previousPlaying = previousGlobal?.playing !== false;
  const previousRate = globalVisualTimeScale(previousGlobal);
  if (playing === previousPlaying && Math.abs(rate - previousRate) < 1e-12) return current;
  return {
    ...current,
    revision: Math.max(1, Number(current.revision) || 1) + 1,
    anchorWallTimeMs: Number(nowMs) || 0,
    anchorTimeSeconds: sampleSessionTimeline(current, nowMs),
    playing,
    rate,
  };
}

export function normalizeSessionTimeline(
  value = null,
  global = {},
  nowMs = sessionTimelineNowMs(),
) {
  if (!value || typeof value !== "object") {
    const timeline = createSessionTimeline(nowMs);
    return {
      ...timeline,
      playing: global?.playing !== false,
      rate: globalVisualTimeScale(global),
    };
  }
  return {
    revision: Math.max(1, Math.floor(Number(value.revision) || 1)),
    anchorWallTimeMs: Number(value.anchorWallTimeMs) || Number(nowMs) || 0,
    anchorTimeSeconds: Math.max(0, Number(value.anchorTimeSeconds) || 0),
    playing: value.playing !== false,
    rate: Math.max(0, Number(value.rate) || 0),
    seed: Number(value.seed) >>> 0,
  };
}

function randomSessionSeed() {
  if (globalThis.crypto?.getRandomValues) {
    return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 0x100000000);
}
