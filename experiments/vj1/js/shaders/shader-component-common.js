import { createEnumParam, createNumberParam } from "../graph/component-schema.js?v=adaptive-component-demand-29";

const SEED_MODE_VALUES = ["animated", "fixed"];

export const ALWAYS_TIME_RUNTIME = Object.freeze({ timeDependent: () => true });

export function animatedSeedRuntime({ active = () => true, fps = 0 } = {}) {
  return Object.freeze({
    timeDependent: (params = {}) => params.seedMode !== "fixed" && active(params),
    timeKey: (_params, context = {}) => fps > 0
      ? Math.floor((Number(context.time) || 0) * fps)
      : context.time,
  });
}

export function noiseSeedParams(defaultSeed = 0) {
  return [
    createEnumParam("seedMode", "Seed mode", SEED_MODE_VALUES, "animated"),
    createNumberParam("seed", "Seed", { min: 0, max: 999, step: 1, defaultValue: defaultSeed }),
  ];
}
