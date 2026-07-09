import { defineVisualComponent, eventInlet, textureOutlet } from "./component-schema.js";

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
      inlets: [eventInlet("trigger", "Trigger")],
      outlets: [textureOutlet("texture", "Texture")],
      params: [],
    }),
  ])
));

export function getGeneratorComponent(id) {
  return GENERATOR_COMPONENTS[id] || GENERATOR_COMPONENTS.testPattern;
}

export function listGeneratorComponents() {
  return Object.values(GENERATOR_COMPONENTS);
}

