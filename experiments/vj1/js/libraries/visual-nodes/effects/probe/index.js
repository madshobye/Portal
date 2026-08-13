import { defineNode, NODE_IMPLEMENTATION_KINDS } from "../../../node-engine/node-definition.js";
import {
  createNumberParam,
  textureInlet,
  textureOutlet,
} from "../../shared/component-schema.js";
import { componentFromNodeDefinition } from "../../shared/visual-node-factory.js";

const params = Object.freeze([
  createNumberParam("flowGain", "Optical flow gain", {
    min: 0,
    max: 8,
    step: 0.01,
    defaultValue: 2,
  }),
  createNumberParam("flowSmoothing", "Flow smoothing", {
    min: 0,
    max: 0.95,
    step: 0.01,
    defaultValue: 0.35,
  }),
  createNumberParam("flowThreshold", "Flow noise threshold", {
    min: 0,
    max: 0.25,
    step: 0.001,
    defaultValue: 0.01,
  }),
  createNumberParam("flowResolution", "Flow sample grid", {
    min: 4,
    max: 16,
    step: 1,
    defaultValue: 8,
  }),
]);

const manifest = Object.freeze({
  id: "probe",
  kind: "effect",
  family: "control",
  name: "Probe",
  label: "Probe",
  category: "control",
  processor: "observer",
  scheduler: "event",
  fusible: false,
  spatial: true,
  transformSource: false,
  inlets: Object.freeze([textureInlet("texture", "Texture")]),
  outlets: Object.freeze([textureOutlet("texture", "Texture")]),
  params,
  primaryParamIds: Object.freeze(["flowGain", "flowSmoothing"]),
  detailParamIds: Object.freeze(["flowThreshold", "flowResolution"]),
  description: "Samples a placed image area and publishes normalized color and optical-flow features to the local live-control bus.",
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
  parameters: Object.fromEntries(params.map((parameter) => [parameter.id, {
    id: parameter.id,
    label: parameter.label,
    type: parameter.type,
    defaultValue: parameter.defaultValue,
    allowedRange: [parameter.min, parameter.max],
    expectedRange: [parameter.min, parameter.max],
    step: parameter.step,
    editor: { type: parameter.ui || "slider" },
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
