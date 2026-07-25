import { createEnumParam, createNumberParam, createTextParam } from "../../shared/component-schema.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";
import { MapRangeControlNode, ScalarMathControlNode } from "../../../control-engine/index.js?v=async-media-dirty-1";
import {
  MediaResourceToImageNode,
  ProjectMediaResourceNode,
} from "../../shared/visual-stage-nodes.js?v=mesh-geometry-detail-2";
import { defineCompiledVisualCompound } from "../../shared/compiled-visual-compound.js?v=typed-media-render-process-1";
import { VisualComponent as AlphaFeatherVisualComponent } from "../../effects/alpha-feather/index.js?v=async-media-dirty-1";

const manifest = Object.freeze({
  id: "mediaImage",
  name: "Project Media",
  category: "media",
  description: "Loads one project image or video through a reusable typed resource and retained image operation.",
  runtime: {
    timeDependent: () => false,
  },
  primaryParamIds: ["mediaId", "fit", "alphaCut", "alphaFeather"],
  detailParamIds: ["start", "end", "speed", "mirrored"],
  params: [
    createTextParam("mediaId", "Media", "", { ui: "media", rows: 1 }),
    createEnumParam("fit", "Fit", ["contain", "cover", "stretch"], "contain"),
    createNumberParam("alphaCut", "Cut edge", { min: 0, max: 32, step: 0.25, defaultValue: 0 }),
    createNumberParam("alphaFeather", "Feather", { min: 0, max: 32, step: 0.25, defaultValue: 0 }),
    createNumberParam("start", "Start", { min: 0, max: 86400, step: 0.01, defaultValue: 0 }),
    createNumberParam("end", "End", { min: 0, max: 86400, step: 0.01, defaultValue: 0 }),
    createNumberParam("speed", "Speed", { min: 0, max: 4, step: 0.01, defaultValue: 1 }),
    {
      id: "mirrored",
      label: "Mirror",
      type: "boolean",
      defaultValue: false,
    },
  ],
});

const NativeVisualComponent = defineGeneratorNode(manifest);

export const VisualComponent = defineCompiledVisualCompound(NativeVisualComponent, {
  nodes: [
    { id: "media", definition: ProjectMediaResourceNode, role: "value" },
    {
      id: "render",
      definition: MediaResourceToImageNode,
      role: "renderer",
      parameters: { providerId: "project-media-fit-pass" },
    },
    {
      id: "alpha-radius",
      definition: ScalarMathControlNode,
      role: "control",
      parameters: { operation: "max" },
    },
    {
      id: "alpha-active",
      definition: MapRangeControlNode,
      role: "control",
      parameters: {
        inputMin: 0,
        inputMax: 0.0001,
        outputMin: 0,
        outputMax: 1,
        clamp: true,
      },
    },
    {
      id: "alpha",
      component: AlphaFeatherVisualComponent,
    },
  ],
  connections: [
    { from: "media.resource", to: "render.resource", type: "drawable-media-resource" },
    { from: "alpha-radius.value", to: "alpha-active.value", type: "number" },
    { from: "alpha-active.value", to: "alpha.$parameter.amount", type: "number" },
    { from: "render.texture", to: "alpha.texture", type: "texture" },
  ],
  output: "alpha.texture",
  parameterBindings: {
    media: ["mediaId", "start", "end", "speed"],
    render: ["fit", "mirrored", "renderQuality"],
    "alpha-radius": [
      { publicParameterId: "alphaCut", targetParameterId: "a" },
      { publicParameterId: "alphaFeather", targetParameterId: "b" },
    ],
    alpha: [
      { publicParameterId: "alphaCut", targetParameterId: "cut" },
      { publicParameterId: "alphaFeather", targetParameterId: "feather" },
    ],
  },
  parameterPresentation: {
    media: {
      label: "Project media",
      order: 10,
    },
    render: { label: "Presentation", order: 20 },
    "alpha-radius": { label: "Alpha edge", order: 30 },
    alpha: { label: "Alpha edge", sectionId: "alpha-radius", order: 30 },
  },
});

export default VisualComponent;
