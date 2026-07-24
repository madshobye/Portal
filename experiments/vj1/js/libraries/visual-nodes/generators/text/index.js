import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createTextParam } from "../../shared/component-schema.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";
import { RenderDemandNode } from "../../../render-engine/index.js";
import {
  TextMaskProviderNode,
  TextMaskToImageNode,
} from "../../shared/specialized-compound.js?v=compiled-graph-value-authority-1";
import {
  defineCompiledVisualCompound,
} from "../../shared/compiled-visual-compound.js";

const manifest = Object.freeze({
    id: "text",
    name: "Text",
    category: "typography",
    primaryParamIds: ["text"],
    detailParamIds: ["layout", "fontFamily", "fontSize", "textScale", "align", "verticalAlign", "lineHeight", "letterSpacing", "padding", "fillColor", "outlineColor", "outlineWidth", "backgroundColor", "renderQuality"],
    params: [
      {
        ...createTextParam("text", "Text", "# PORTAL\nLIVE TEXT", { ui: "markdown", rows: 4 }),
        styleControls: ["bold", "italic", "underline", "fillEnabled", "outlineEnabled"],
      },
      { ...createBooleanParam("bold", "Bold", false), ui: "text-style-toggle" },
      { ...createBooleanParam("italic", "Italic", false), ui: "text-style-toggle" },
      { ...createBooleanParam("underline", "Underline", false), ui: "text-style-toggle" },
      { ...createBooleanParam("fillEnabled", "Fill", true), ui: "text-style-toggle" },
      { ...createBooleanParam("outlineEnabled", "Outline", false), ui: "text-style-toggle" },
      createEnumParam("layout", "Layout", ["fit lines", "fit block", "fixed"], "fit lines"),
      createEnumParam("fontFamily", "Font", ["sans", "serif", "mono", "condensed", "display"], "sans"),
      createNumberParam("fontSize", "Font size", { min: 8, max: 512, step: 1, defaultValue: 96, scale: "log" }),
      createNumberParam("textScale", "Text scale", { min: 0.1, max: 4, step: 0.01, defaultValue: 1, scale: "log" }),
      createEnumParam("align", "Align", ["left", "center", "right"], "center"),
      createEnumParam("verticalAlign", "Vertical align", ["top", "center", "bottom"], "center"),
      createNumberParam("lineHeight", "Line height", { min: 0.5, max: 2, step: 0.01, defaultValue: 0.92 }),
      createNumberParam("letterSpacing", "Letter spacing", { min: -0.1, max: 0.5, step: 0.001, defaultValue: 0 }),
      createNumberParam("padding", "Padding", { min: 0, max: 0.4, step: 0.001, defaultValue: 0.06 }),
      createColorParam("fillColor", "Fill", "#ffffffff"),
      createColorParam("outlineColor", "Outline", "#ffffffff"),
      createNumberParam("outlineWidth", "Outline width", { min: 0, max: 0.16, step: 0.001, defaultValue: 0.012 }),
      createColorParam("backgroundColor", "Background", "#00000000"),
    ],
  });

const NativeVisualComponent = defineGeneratorNode(manifest);

export const VisualComponent = defineCompiledVisualCompound(NativeVisualComponent, {
  nodes: [
    { id: "demand", definition: RenderDemandNode, role: "value" },
    { id: "mask", definition: TextMaskProviderNode, role: "value", parameters: { providerId: "text-mask" } },
    { id: "render", definition: TextMaskToImageNode, role: "renderer", parameters: { providerId: "text-mask-pass" } },
  ],
  connections: [
    { from: "demand.width", to: "mask.width", type: "number" },
    { from: "demand.height", to: "mask.height", type: "number" },
    { from: "mask.mask", to: "render.mask", type: "text-mask-provider" },
  ],
  output: "render.texture",
  parameterBindings: {
    mask: [
      "text",
      "bold",
      "italic",
      "underline",
      "layout",
      "fontFamily",
      "fontSize",
      "textScale",
      "align",
      "verticalAlign",
      "lineHeight",
      "letterSpacing",
      "padding",
    ],
    render: [
      "fillEnabled",
      "outlineEnabled",
      "fillColor",
      "outlineColor",
      "outlineWidth",
      "backgroundColor",
      "renderQuality",
    ],
  },
  parameterPresentation: {
    mask: { label: "Text layout", order: 10 },
    render: { label: "Text style", order: 20 },
  },
});
export default VisualComponent;
