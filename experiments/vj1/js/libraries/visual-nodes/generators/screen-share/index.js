import { createBooleanParam, createEnumParam, createTextParam } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";
import {
  defineSpecializedVisualCompound,
  MediaResourceToImageNode,
  ScreenInputResourceNode,
} from "../../shared/specialized-compound.js?v=compiled-graph-value-authority-1";

const manifest = Object.freeze({
    id: "screenShare",
    name: "Screen Share",
    category: "live",
    runtime: ALWAYS_TIME_RUNTIME,
    primaryParamIds: ["inputId", "fit", "mirrored"],
    params: [
      createTextParam("inputId", "Input", "", { ui: "screen-input", rows: 1 }),
      createEnumParam("fit", "Fit", ["contain", "cover", "stretch"], "contain"),
      createBooleanParam("mirrored", "Mirror", false),
    ],
  });

const NativeVisualComponent = defineGeneratorNode(manifest);

export const VisualComponent = defineSpecializedVisualCompound(NativeVisualComponent, {
  compoundKind: "screen-share",
  nativeRenderer: "output/specialized:screenShare",
  nodes: [
    { id: "input", type: ScreenInputResourceNode.id },
    {
      id: "render",
      type: MediaResourceToImageNode.id,
      parameters: { providerId: "screen-input-fit-pass" },
    },
  ],
  connections: [
    { from: "input.resource", to: "render.resource", type: "drawable-media-resource" },
  ],
  output: "render.texture",
  parameterBindings: {
    input: ["inputId"],
    render: ["fit", "mirrored", "renderQuality"],
  },
  parameterPresentation: {
    input: { label: "Screen input", order: 10 },
    render: { label: "Presentation", order: 20 },
  },
  parts: [],
});
export default VisualComponent;
