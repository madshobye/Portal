import { defineNode, NODE_IMPLEMENTATION_KINDS } from "../../node-engine/node-definition.js";
import { defineVisualNodeContract } from "../../render-engine/visual-node-contract.js";

export const TEXTURE_OPERATOR_COMPILER_HOOK = "vj1.visual.texture-operator";

const textureContract = defineVisualNodeContract({
  coordinates: { input: "composition", output: "composition" },
  transform: { domain: "composition", operation: "none" },
  roi: {
    mode: "local",
    halo: 0,
    coordinateSpace: "boundary",
    inputMapping: "identity",
    pixelEquivalentToFullFrame: true,
  },
  allocation: { mode: "visible-boundary" },
  alpha: { input: "premultiplied", output: "premultiplied" },
});

function textureOperator({
  id,
  name,
  description,
  operator,
  inlets,
  parameters = {},
  stateful = false,
  allocation = "visible-boundary",
}) {
  const contract = allocation === "retained"
    ? defineVisualNodeContract({ ...textureContract, allocation: { mode: "retained" } })
    : textureContract;
  return defineNode({
    id,
    name,
    version: "0.1.0",
    description,
    implementation: NODE_IMPLEMENTATION_KINDS.SHADER,
    inlets,
    parameters,
    outlets: { texture: { type: "texture" } },
    execution: { trigger: "frame", domain: "main", stateful, asynchronous: false },
    capabilities: [
      "visual-node",
      "texture-operator",
      "multi-input-visual",
      "graph-placeable",
      "compiled-fast-path",
      ...(stateful ? ["retained-texture-state"] : []),
    ],
    presentation: {
      catalogs: ["node-graph", "visual-operator"],
      placeableOn: ["visual-graph", "node-graph"],
      previewOutput: "texture",
    },
    metadata: {
      visualCompilerHook: {
        id: TEXTURE_OPERATOR_COMPILER_HOOK,
        operator,
        contract,
      },
      visualOperator: operator,
    },
    process: (_inputs, context) => {
      if (typeof context.renderTextureOperator !== "function") {
        throw new Error(`TEXTURE_OPERATOR_RENDER_HOST_MISSING:${operator}`);
      }
      return { texture: context.renderTextureOperator(operator, _inputs, context) };
    },
  });
}

export const MixTextureNode = textureOperator({
  id: "core.visual.mix",
  name: "Mix",
  description: "Combines two premultiplied textures with an editable blend amount and blend mode.",
  operator: "mix",
  inlets: {
    a: { type: "texture", required: true },
    b: { type: "texture", required: true },
  },
  parameters: {
    amount: { type: "number", defaultValue: 0.5, allowedRange: [0, 1], clamp: true, editor: { type: "slider" } },
    mode: {
      type: { type: "enum", values: ["crossfade", "add", "multiply", "screen"] },
      defaultValue: "crossfade",
      editor: { type: "select" },
    },
  },
});

export const MaskTextureNode = textureOperator({
  id: "core.visual.mask",
  name: "Mask",
  description: "Applies the alpha or luminance of one texture to another premultiplied texture.",
  operator: "mask",
  inlets: {
    texture: { type: "texture", required: true },
    mask: { type: "texture", required: true },
  },
  parameters: {
    channel: {
      type: { type: "enum", values: ["alpha", "luminance"] },
      defaultValue: "alpha",
      editor: { type: "select" },
    },
    invert: { type: "boolean", defaultValue: false },
    amount: { type: "number", defaultValue: 1, allowedRange: [0, 1], clamp: true, editor: { type: "slider" } },
  },
});

export const SelectTextureNode = textureOperator({
  id: "core.visual.select",
  name: "Select",
  description: "Selects one of two texture branches without interpreting the graph in the frame loop.",
  operator: "select",
  inlets: {
    a: { type: "texture", required: true },
    b: { type: "texture", required: true },
  },
  parameters: { selection: { type: "boolean", defaultValue: false } },
});

export const TransitionTextureNode = textureOperator({
  id: "core.visual.transition",
  name: "Transition",
  description: "Applies the shared two-endpoint transition contract inside any visual graph.",
  operator: "transition",
  inlets: {
    startImage: { type: "texture", required: true },
    endImage: { type: "texture", required: true },
  },
  parameters: {
    progress: { type: "number", defaultValue: 0, allowedRange: [0, 1], clamp: true, editor: { type: "slider" } },
    transitionId: { type: "string", defaultValue: "vj1.transition.dissolve" },
    transitionParameters: { type: "record", defaultValue: {} },
  },
});

export const FeedbackTextureNode = textureOperator({
  id: "core.visual.feedback",
  name: "Feedback",
  description: "Combines the current texture with an explicitly retained previous-frame texture.",
  operator: "feedback",
  inlets: { texture: { type: "texture", required: true } },
  parameters: {
    amount: { type: "number", defaultValue: 0.85, allowedRange: [0, 0.999], clamp: true, editor: { type: "slider" } },
  },
  stateful: true,
  allocation: "retained",
});

export const DelayTextureNode = textureOperator({
  id: "core.visual.delay",
  name: "Frame Delay",
  description: "Outputs the explicitly retained previous frame and captures the current texture for the next frame.",
  operator: "delay",
  inlets: { texture: { type: "texture", required: true } },
  stateful: true,
  allocation: "retained",
});

export const TextureOperatorNodeDefinitions = Object.freeze([
  MixTextureNode,
  MaskTextureNode,
  SelectTextureNode,
  TransitionTextureNode,
  FeedbackTextureNode,
  DelayTextureNode,
]);
