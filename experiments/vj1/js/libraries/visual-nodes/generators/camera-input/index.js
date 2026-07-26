import { createEnumParam } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";
import {
  CameraInputResourceNode,
  MediaResourceToImageNode,
} from "../../shared/visual-stage-nodes.js";
import { defineCompiledVisualCompound } from "../../shared/compiled-visual-compound.js";

const manifest = Object.freeze({
  id: "cameraInput",
  name: "Live Camera",
  category: "live",
  runtime: ALWAYS_TIME_RUNTIME,
  primaryParamIds: ["fit"],
  params: [
    createEnumParam("fit", "Fit", ["contain", "cover", "stretch"], "cover"),
  ],
});

const NativeVisualComponent = defineGeneratorNode(manifest);

export const VisualComponent = defineCompiledVisualCompound(NativeVisualComponent, {
  nodes: [
    { id: "input", definition: CameraInputResourceNode, role: "value" },
    {
      id: "render",
      definition: MediaResourceToImageNode,
      role: "renderer",
      parameters: { providerId: "camera-input-fit-pass" },
    },
  ],
  connections: [
    { from: "input.resource", to: "render.resource", type: "drawable-media-resource" },
  ],
  output: "render.texture",
  parameterBindings: {
    render: ["fit", "renderQuality"],
  },
  parameterPresentation: {
    input: { label: "Camera input", order: 10 },
    render: { label: "Presentation", order: 20 },
  },
});

export default VisualComponent;
