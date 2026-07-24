import { createEnumParam, createNumberParam, createTextParam } from "../../shared/component-schema.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";
import { defineCompiledVisualCompound } from "../../shared/compiled-visual-compound.js";
import MediaImage from "../media-image/index.js";
import TileRepeat from "../../effects/tile-repeat/index.js";

const manifest = Object.freeze({
    id: "tileTexture",
    name: "Tile Texture",
    category: "texture",
    runtime: {
      timeDependent: (params = {}) =>
        Math.abs(Number(params.scrollX) || 0) > 0.0001 ||
        Math.abs(Number(params.scrollY) || 0) > 0.0001,
    },
    params: [
      createTextParam("imageId", "Image", ""),
      createEnumParam("tileAxis", "Tiling", ["both", "horizontal", "vertical"], "both"),
      createNumberParam("repeat", "Repeat", { min: 0.001, max: 64, step: 0.001, defaultValue: 1 }),
      createNumberParam("offsetX", "Offset X", { min: -1, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("offsetY", "Offset Y", { min: -1, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("scrollX", "Scroll X", { min: -2, max: 2, step: 0.01, defaultValue: 0 }),
      createNumberParam("scrollY", "Scroll Y", { min: -2, max: 2, step: 0.01, defaultValue: 0 }),
    ],
  });

const NativeVisualComponent = defineGeneratorNode(manifest);

export const VisualComponent = defineCompiledVisualCompound(NativeVisualComponent, {
  nodes: [
    { id: "image", component: MediaImage, parameters: { fit: "stretch" } },
    { id: "render", component: TileRepeat, parameters: { amount: 1 } },
  ],
  connections: [
    { from: "image.texture", to: "render.texture", type: "texture" },
  ],
  output: "render.texture",
  parameterBindings: {
    image: [{ publicParameterId: "imageId", targetParameterId: "mediaId" }],
    render: ["tileAxis", "repeat", "offsetX", "offsetY", "scrollX", "scrollY", "renderQuality"],
  },
  parameterPresentation: {
    image: { hidden: true },
    render: { label: "Tile render", order: 10 },
  },
});
export default VisualComponent;
