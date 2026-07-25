import {
  defineNode,
  NODE_EXECUTION_CLASSES,
  NODE_IMPLEMENTATION_KINDS,
  NODE_PART_KINDS,
} from "../../../node-engine/node-definition.js";
import { TextMaskProviderType } from "../../shared/visual-stage-types.js";
import {
  createTextMask,
  FONT_FAMILIES,
  parseTextMarkdown,
  TEXT_MASK_MAX_DIMENSION,
  textMaskDimensions,
  textMaskSignature,
} from "../../generators/text/runtime.js";
import {
  clamp,
  drawStyledLine,
  fontString,
  layoutTextLines,
  measureStyledLine,
  parseInlineMarkdown,
} from "../../generators/text/runtime.js";

const TEXT_MASK_SETTING_IDS = Object.freeze([
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
]);

export const TextMaskProviderNode = defineNode({
  id: "core.visual.text-mask",
  name: "Text Mask",
  version: "0.1.0",
  description: "Lays out text into a retained browser-rasterized alpha mask independently from fill, outline, and image composition.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: {
    width: { type: "number", defaultValue: 1, allowedRange: [1, 16384], clamp: true },
    height: { type: "number", defaultValue: 1, allowedRange: [1, 16384], clamp: true },
    settings: { type: "record", defaultValue: {} },
    text: { type: "string", defaultValue: "# PORTAL\nLIVE TEXT" },
    bold: { type: "boolean", defaultValue: false },
    italic: { type: "boolean", defaultValue: false },
    underline: { type: "boolean", defaultValue: false },
    layout: { type: { type: "enum", values: ["fit lines", "fit block", "fixed"] }, defaultValue: "fit lines" },
    fontFamily: { type: { type: "enum", values: ["sans", "serif", "mono", "condensed", "display"] }, defaultValue: "sans" },
    fontSize: { type: "number", defaultValue: 96, allowedRange: [8, 512], clamp: true },
    textScale: { type: "number", defaultValue: 1, allowedRange: [0.1, 4], clamp: true },
    align: { type: { type: "enum", values: ["left", "center", "right"] }, defaultValue: "center" },
    verticalAlign: { type: { type: "enum", values: ["top", "center", "bottom"] }, defaultValue: "center" },
    lineHeight: { type: "number", defaultValue: 0.92, allowedRange: [0.5, 2], clamp: true },
    letterSpacing: { type: "number", defaultValue: 0, allowedRange: [-0.1, 0.5], clamp: true },
    padding: { type: "number", defaultValue: 0.06, allowedRange: [0, 0.4], clamp: true },
  },
  parameters: {
    providerId: { type: "string", defaultValue: "text-mask" },
    enabled: { type: "boolean", defaultValue: true },
    settings: { type: "record", defaultValue: {} },
  },
  outlets: {
    mask: { type: TextMaskProviderType },
  },
  execution: {
    trigger: "input-change",
    domain: "main",
    pure: false,
    stateful: true,
    asynchronous: false,
    // The stage is safe in the live compiled graph because its retained
    // signature prevents rasterization until layout, text, or demand changes.
    workload: NODE_EXECUTION_CLASSES.LIVE_FRAME,
  },
  capabilities: [
    "text-layout",
    "text-mask",
    "image-resource",
    "retained-value-provider",
    "visual-value-provider",
    "visual-stage",
    "graph-placeable",
  ],
  presentation: {
    catalogs: ["node-graph", "text", "image", "visual-stage"],
    placeableOn: ["visual-graph", "node-graph", "native-visual-graph"],
    previewOutput: "mask",
  },
  parts: [
    {
      id: "text-layout-module",
      name: "Text layout and mask algorithm",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      exports: ["createTextMask", "textMaskDimensions", "textMaskSignature", "parseTextMarkdown"],
      source: [
        `const FONT_FAMILIES = Object.freeze(${JSON.stringify(FONT_FAMILIES)});`,
        `const TEXT_MASK_MAX_DIMENSION = ${TEXT_MASK_MAX_DIMENSION};`,
        createTextMask,
        textMaskDimensions,
        textMaskSignature,
        parseTextMarkdown,
        parseInlineMarkdown,
        layoutTextLines,
        measureStyledLine,
        drawStyledLine,
        fontString,
        clamp,
      ].map((value) => typeof value === "function" ? value.toString() : value).join("\n\n"),
    },
    {
      id: "text-mask-provider-process",
      name: "Text mask provider process",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      export: "textMaskProviderProcess",
      entry: "process",
      dependsOn: ["text-layout-module"],
      source: [
        textMaskProviderProcess,
        record,
      ].map(String).join("\n\n"),
    },
  ],
  moduleBindings: {
    TEXT_MASK_SETTING_IDS,
  },
  moduleExports: {
    createTextMask,
    textMaskDimensions,
    textMaskSignature,
    parseTextMarkdown,
  },
  process: textMaskProviderProcess,
});

export function textMaskProviderProcess(inputs = {}, { output = null, state = {} } = {}) {
  const sourceSettings = record(inputs.settings);
  const settings = state.settings || (state.settings = {});
  for (const id of TEXT_MASK_SETTING_IDS) {
    const value = sourceSettings[id] === undefined ? inputs[id] : sourceSettings[id];
    if (value === undefined) delete settings[id];
    else settings[id] = value;
  }
  const dimensions = textMaskDimensions(inputs.width, inputs.height);
  const signature = textMaskSignature(settings, dimensions.width, dimensions.height);
  if (state.signature !== signature || !state.canvas) {
    state.canvas = createTextMask(
      settings,
      dimensions.width,
      dimensions.height,
      state.canvas || null,
    );
    state.signature = signature;
    state.revision = Math.max(0, Number(state.revision) || 0) + 1;
  }
  const result = output || state.output || (state.output = { mask: null });
  const mask = result.mask || (result.mask = {});
  mask.kind = "text-mask";
  mask.providerId = String(inputs.providerId || "text-mask");
  mask.settings = settings;
  mask.canvas = state.canvas;
  mask.width = dimensions.width;
  mask.height = dimensions.height;
  mask.signature = signature;
  mask.revision = state.revision;
  return result;
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
