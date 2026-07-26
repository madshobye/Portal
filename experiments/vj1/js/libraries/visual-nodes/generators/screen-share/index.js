import { createBooleanParam, createEnumParam, createTextParam } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";
import {
  MediaResourceToImageNode,
  ScreenInputResourceNode,
} from "../../shared/visual-stage-nodes.js";
import { defineCompiledVisualCompound } from "../../shared/compiled-visual-compound.js";

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

export const VisualComponent = defineCompiledVisualCompound(NativeVisualComponent, {
  nodes: [
    { id: "input", definition: ScreenInputResourceNode, role: "value" },
    {
      id: "render",
      definition: MediaResourceToImageNode,
      role: "renderer",
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
});
export default VisualComponent;
