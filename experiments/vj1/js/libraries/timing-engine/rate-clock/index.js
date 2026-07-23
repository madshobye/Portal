import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";
import { numberType, recordType } from "../../node-engine/node-types.js";

export const RateClockStateType = recordType("rate-clock-state", {
  baseTime: numberType(),
  time: numberType(),
});

export const RateClockNode = defineNode({
  id: "core.timing.rate-clock",
  name: "Rate Clock",
  version: "0.1.0",
  description: "Advances time continuously while its playback rate changes.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: {
    previous: { type: { ...RateClockStateType, optional: true }, optional: true },
    baseTime: { type: "number", required: true },
    rate: { type: "number", defaultValue: 1, allowedRange: [0, 100], clamp: true },
  },
  outlets: { clock: { type: RateClockStateType } },
  execution: { trigger: "frame", domain: "main", pure: true, asynchronous: false },
  capabilities: ["timing", "phase-continuity", "graph-placeable", "live-fast-path"],
  presentation: { catalogs: ["graph", "timing"], placeableOn: ["node-graph"] },
  parts: [
    {
      id: "rate-clock-algorithm",
      name: "Rate clock algorithm",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      export: "advanceRateClock",
      source: advanceRateClock.toString(),
    },
    {
      id: "rate-clock-process",
      name: "Rate clock process entry",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      export: "rateClockNodeProcess",
      entry: "process",
      dependsOn: ["rate-clock-algorithm"],
      source: rateClockNodeProcess.toString(),
    },
  ],
  process: rateClockNodeProcess,
});

export function rateClockNodeProcess({ previous, baseTime, rate }, { output = {}, state = {} } = {}) {
  output.clock = advanceRateClock(previous, baseTime, rate, state.clockOutput);
  state.clockOutput = output.clock;
  return output;
}

export function advanceRateClock(previous, baseTime, rate, output = null) {
  const now = Number(baseTime) || 0;
  const speed = Math.max(0, Number(rate) || 0);
  const previousBaseTime = previous?.baseTime;
  const previousTime = previous?.time;
  const clock = output || { baseTime: 0, time: 0 };
  clock.baseTime = now;
  clock.time = !previous || now < previousBaseTime
    ? now * speed
    : previousTime + Math.max(0, now - previousBaseTime) * speed;
  return clock;
}
