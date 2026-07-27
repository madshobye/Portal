import { createNumberParam } from "./component-schema.js";

export const FULL_TURN_RADIANS = Math.PI * 2;

export function createPeriodicAnimationParam(id, label, {
  min = -Math.PI,
  max = Math.PI,
  step = 0.01,
  defaultValue = 0,
  duration = 2,
  animationId = "continuous",
  animationLabel = "Continuous motion",
  legacyRate = null,
  legacyEnabled = null,
} = {}) {
  const span = Number(max) - Number(min);
  const phase = span
    ? (Number(defaultValue) - Number(min)) / span
    : 0;
  return createNumberParam(id, label, {
    min,
    max,
    step,
    defaultValue,
    defaultAnimation: {
      id: animationId,
      version: 1,
      label: animationLabel,
      mode: "loop",
      from: min,
      to: max,
      duration,
      phase: Math.min(1, Math.max(0, phase)),
      curve: "linear",
      returnMode: "retrace",
      pause: 0,
      runMode: "automatic",
      triggerBehavior: "full-sequence",
      randomRate: 0,
      combination: "replace",
      ...(legacyRate ? { legacyRate } : {}),
      ...(legacyEnabled ? { legacyEnabled } : {}),
    },
  });
}
