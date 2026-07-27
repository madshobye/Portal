import { defineNode, NODE_IMPLEMENTATION_KINDS } from "../../../node-engine/node-definition.js";
import {
  createNumberParam,
  textureInlet,
  textureOutlet,
} from "../../shared/component-schema.js";
import { componentFromNodeDefinition } from "../../shared/visual-node-factory.js";

const sampleRate = createNumberParam("sampleRate", "Sample rate", {
  min: 1,
  max: 30,
  step: 1,
  defaultValue: 15,
});

const manifest = Object.freeze({
  id: "probe",
  kind: "effect",
  family: "control",
  name: "Probe",
  label: "Probe",
  category: "control",
  processor: "observer",
  scheduler: "frame",
  fusible: false,
  spatial: true,
  transformSource: false,
  inlets: Object.freeze([textureInlet("texture", "Texture")]),
  outlets: Object.freeze([textureOutlet("texture", "Texture")]),
  params: Object.freeze([sampleRate]),
  primaryParamIds: Object.freeze(["sampleRate"]),
  detailParamIds: Object.freeze([]),
  description: "Samples a placed image area and publishes normalized color features to the local live-control bus.",
});

const definition = defineNode({
  id: "vj1.visual.effect.probe",
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
  parameters: {
    sampleRate: {
      id: "sampleRate",
      label: "Sample rate",
      type: "number",
      defaultValue: 15,
      allowedRange: [1, 30],
      expectedRange: [1, 30],
      step: 1,
      editor: { type: "slider" },
    },
  },
  execution: {
    trigger: "frame",
    domain: "gpu",
    pure: false,
    stateful: true,
  },
  capabilities: [
    "visual-node",
    "visual-effect",
    "consumes-image",
    "produces-image",
    "control-signal",
    "probe-control",
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
      id: "vj1.visual.probe",
    },
  },
});

export const VisualComponent = componentFromNodeDefinition(
  manifest,
  definition,
  { renderAuthority: "node-definition" },
);

export default VisualComponent;
