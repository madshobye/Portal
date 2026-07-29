import { defineNode, NODE_IMPLEMENTATION_KINDS } from "../../../node-engine/node-definition.js";
import {
  createEnumParam,
  createTextParam,
  textureInlet,
  textureOutlet,
} from "../../shared/component-schema.js";
import { componentFromNodeDefinition } from "../../shared/visual-node-factory.js";

const params = Object.freeze([
  createTextParam("fixtureId", "Fixture", ""),
  createTextParam("zone", "Output zone", "all"),
  {
    ...createEnumParam("mode", "Input mode", ["canvas", "control"], "canvas"),
    optionLabels: new Map([
      ["canvas", "Canvas sample"],
      ["control", "Animated controls"],
    ]),
  },
]);

const manifest = Object.freeze({
  id: "dmxProbe",
  kind: "effect",
  family: "control",
  name: "DMX Probe",
  label: "DMX Probe",
  category: "control",
  processor: "observer",
  scheduler: "event",
  fusible: false,
  spatial: true,
  transformSource: false,
  inlets: Object.freeze([textureInlet("texture", "Texture")]),
  outlets: Object.freeze([textureOutlet("texture", "Texture")]),
  params,
  primaryParamIds: Object.freeze(["fixtureId", "zone", "mode"]),
  detailParamIds: Object.freeze([]),
  description: "Samples its placed canvas area or evaluates animated fixture channels and publishes a semantic fixture frame to the global DMX output.",
});

const definition = defineNode({
  id: "vj1.visual.effect.dmxProbe",
  name: manifest.name,
  label: manifest.label,
  version: "0.1.0",
  description: manifest.description,
  implementation: NODE_IMPLEMENTATION_KINDS.NATIVE,
  inlets: {
    texture: { id: "texture", label: "Texture", type: "texture" },
  },
  outlets: {
    texture: { id: "texture", label: "Texture", type: "texture" },
  },
  parameters: Object.fromEntries(params.map((parameter) => [parameter.id, {
    id: parameter.id,
    label: parameter.label,
    type: parameter.type === "enum"
      ? { type: "enum", values: parameter.values }
      : parameter.type,
    defaultValue: parameter.defaultValue,
    ...(parameter.min !== undefined ? {
      allowedRange: [parameter.min, parameter.max],
      expectedRange: [parameter.min, parameter.max],
      step: parameter.step,
    } : {}),
    editor: { type: parameter.ui || (parameter.type === "number" ? "slider" : parameter.type) },
  }])),
  execution: {
    trigger: "input-change",
    domain: "gpu",
    pure: false,
    stateful: false,
  },
  capabilities: [
    "visual-node",
    "visual-effect",
    "consumes-image",
    "produces-image",
    "hardware-output",
    "dmx-output",
  ],
  presentation: {
    catalogs: ["graph", "visual-nodes"],
    placeableOn: ["visual-graph"],
    previewOutput: "texture",
  },
  metadata: {
    visualId: manifest.id,
    visualKind: "effect",
    visualFamily: manifest.family,
    category: manifest.category,
    sampling: "observer",
    transformSource: false,
    requiresBaseSample: false,
    fusible: false,
    visualCompilerHook: {
      id: "vj1.visual.dmx-probe",
    },
  },
});

export const VisualComponent = componentFromNodeDefinition(
  manifest,
  definition,
  { renderAuthority: "node-definition" },
);

export default VisualComponent;
