import { defineNode, NODE_IMPLEMENTATION_KINDS } from "../../../node-engine/node-definition.js";
import {
  textureInlet,
  textureOutlet,
} from "../../shared/component-schema.js";
import { componentFromNodeDefinition } from "../../shared/visual-node-factory.js";

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
  params: Object.freeze([]),
  primaryParamIds: Object.freeze([]),
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
  parameters: {},
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
