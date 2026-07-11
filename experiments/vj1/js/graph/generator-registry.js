import { createColorParam, createNumberParam, defineVisualComponent, textureInlet, textureOutlet } from "./component-schema.js";

const RAW_GENERATORS = Object.freeze({
  testPattern: {
    id: "testPattern",
    name: "Test Pattern",
    category: "utility",
  },
  waves: {
    id: "waves",
    name: "Waves",
    category: "motion",
  },
  noise: {
    id: "noise",
    name: "Noise",
    category: "texture",
  },
  plasma: {
    id: "plasma",
    name: "Plasma",
    category: "color",
  },
  gradient: {
    id: "gradient",
    name: "Gradient",
    category: "color",
    params: [
      createNumberParam("colorCount", "Colors", { min: 2, max: 4, step: 1, defaultValue: 2 }),
      createNumberParam("angle", "Angle", { min: -3.14, max: 3.14, step: 0.01, defaultValue: 0 }),
      createNumberParam("offset", "Offset", { min: -1, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("softness", "Softness", { min: 0.1, max: 2, step: 0.01, defaultValue: 1 }),
      createColorParam("colorA", "Color 1", "#ff4f92ff"),
      createColorParam("colorB", "Color 2", "#4ee3e5ff"),
      createColorParam("colorC", "Color 3", "#ffe45eff"),
      createColorParam("colorD", "Color 4", "#00000000"),
    ],
  },
  fireflies: {
    id: "fireflies",
    name: "Fireflies",
    category: "particles",
    params: [
      createNumberParam("count", "Count", { min: 4, max: 24, step: 1, defaultValue: 18 }),
      createNumberParam("glowSize", "Glow size", { min: 0.35, max: 2.5, step: 0.01, defaultValue: 1 }),
      createNumberParam("speed", "Speed", { min: 0, max: 3, step: 0.01, defaultValue: 1 }),
      createNumberParam("trail", "Trail", { min: 0, max: 1, step: 0.01, defaultValue: 0.25 }),
      createNumberParam("brightness", "Brightness", { min: 0, max: 2, step: 0.01, defaultValue: 1 }),
      createNumberParam("twinkle", "Twinkle", { min: 0, max: 1, step: 0.01, defaultValue: 0.75 }),
    ],
  },
  eyeball: {
    id: "eyeball",
    name: "3D Eyeball",
    category: "character",
    params: [
      createNumberParam("irisSize", "Iris size", { min: 0.5, max: 1.6, step: 0.01, defaultValue: 1 }),
      createNumberParam("pupilSize", "Pupil size", { min: 0.5, max: 1.8, step: 0.01, defaultValue: 1 }),
      createNumberParam("gazeRange", "Gaze range", { min: 0, max: 1.5, step: 0.01, defaultValue: 1 }),
      createNumberParam("motionSpeed", "Motion speed", { min: 0, max: 3, step: 0.01, defaultValue: 1 }),
      createNumberParam("pauseAmount", "Pause", { min: 0, max: 1, step: 0.01, defaultValue: 0.82 }),
      createNumberParam("jitter", "Jitter", { min: 0, max: 1, step: 0.01, defaultValue: 0.35 }),
      createNumberParam("blinkRate", "Blink rate", { min: 0, max: 3, step: 0.01, defaultValue: 1 }),
      createNumberParam("lidAmount", "Lid amount", { min: 0, max: 1.5, step: 0.01, defaultValue: 1 }),
      createNumberParam("veinAmount", "Veins", { min: 0, max: 1, step: 0.01, defaultValue: 0.6 }),
    ],
  },
  swayingTrees: {
    id: "swayingTrees",
    name: "Swaying Trees",
    category: "organic",
  },
  checker: {
    id: "checker",
    name: "Checker",
    category: "utility",
  },
  black: {
    id: "black",
    name: "Black",
    category: "utility",
  },
});

const GENERATOR_COMPONENTS = Object.freeze(Object.fromEntries(
  Object.entries(RAW_GENERATORS).map(([id, generator]) => [
    id,
    defineVisualComponent({
      ...generator,
      kind: "generator",
      family: "source",
      processor: "generator",
      scheduler: "frame",
      inlets: [textureInlet("image", "Image")],
      outlets: [textureOutlet("texture", "Texture")],
      params: generator.params || [],
    }),
  ])
));

export function getGeneratorComponent(id) {
  return GENERATOR_COMPONENTS[id] || GENERATOR_COMPONENTS.testPattern;
}

export function listGeneratorComponents() {
  return Object.values(GENERATOR_COMPONENTS);
}
