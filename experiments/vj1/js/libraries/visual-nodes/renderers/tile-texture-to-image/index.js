import {
  defineNode,
  NODE_EDIT_ACTIVATION,
  NODE_EXECUTION_CLASSES,
  NODE_IMPLEMENTATION_KINDS,
  NODE_PART_KINDS,
} from "../../../node-engine/node-definition.js";
import { MediaImageResourceType } from "../../shared/specialized-compound-types.js";
import {
  TILE_TEXTURE_FRAGMENT_SHADER,
  TILE_TEXTURE_VERTEX_SHADER,
  tileRepeatAmount,
} from "../../generators/tile-texture/runtime.js";

export const TileTextureToImageNode = defineNode({
  id: "core.visual.tile-texture-to-image",
  name: "Tile Texture to Image",
  version: "0.1.0",
  description: "Repeats one connected image resource through the retained single-pass tile shader.",
  implementation: {
    kind: NODE_IMPLEMENTATION_KINDS.NATIVE,
    compiler: "vj1.visual.specialized-compound",
    kernel: "tile-texture",
  },
  inlets: {
    image: { type: MediaImageResourceType, required: true },
  },
  parameters: {
    providerId: { type: "string", defaultValue: "tile-texture-pass" },
    enabled: { type: "boolean", defaultValue: true },
    tileAxis: {
      type: { type: "enum", values: ["both", "horizontal", "vertical"] },
      defaultValue: "both",
    },
    repeat: { type: "number", defaultValue: 1, allowedRange: [0.001, 64], clamp: true },
    offsetX: { type: "number", defaultValue: 0, allowedRange: [-1, 1], clamp: true },
    offsetY: { type: "number", defaultValue: 0, allowedRange: [-1, 1], clamp: true },
    scrollX: { type: "number", defaultValue: 0, allowedRange: [-2, 2], clamp: true },
    scrollY: { type: "number", defaultValue: 0, allowedRange: [-2, 2], clamp: true },
    renderQuality: { type: "number", defaultValue: 0.5, allowedRange: [0, 1], clamp: true },
  },
  outlets: {
    texture: { type: "texture" },
  },
  execution: {
    trigger: "frame",
    domain: "gpu",
    stateful: true,
    asynchronous: false,
    workload: NODE_EXECUTION_CLASSES.LIVE_FRAME,
    roi: { mode: "local", mapping: "content-transform" },
  },
  authoring: {
    activation: NODE_EDIT_ACTIVATION.READ_ONLY,
    reason: "The retained shader target is context-bound; the connected image, repeat algorithm, shader source, and controls remain editable.",
  },
  capabilities: [
    "render-operation",
    "retained-render-target",
    "tile-texture",
    "tile-texture-render-kernel",
    "specialized-visual-stage",
    "graph-placeable",
    "compiled-only",
  ],
  presentation: {
    catalogs: ["node-graph", "image", "texture", "render", "specialized-visual"],
    placeableOn: ["native-visual-graph"],
    previewOutput: "texture",
  },
  metadata: {
    nativeKernel: "tile-texture",
    nativeRenderer: "output/specialized:tileTexture",
    allocationStable: true,
    nativeArtifactRequirements: {
      moduleExports: ["tileRepeatAmount"],
      shaders: ["tile-texture-vertex", "tile-texture-fragment"],
    },
  },
  parts: [
    {
      id: "tile-repeat-module",
      name: "Tile repeat and axis algorithm",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      exports: ["tileRepeatAmount"],
      source: tileRepeatAmount.toString(),
    },
    {
      id: "tile-texture-vertex",
      name: "Tile Texture vertex shader",
      kind: NODE_PART_KINDS.SHADER,
      language: "glsl",
      stage: "vertex",
      program: "tile-texture",
      editable: true,
      source: TILE_TEXTURE_VERTEX_SHADER,
    },
    {
      id: "tile-texture-fragment",
      name: "Tile Texture fragment shader",
      kind: NODE_PART_KINDS.SHADER,
      language: "glsl",
      stage: "fragment",
      program: "tile-texture",
      editable: true,
      source: TILE_TEXTURE_FRAGMENT_SHADER,
    },
  ],
  moduleExports: {
    tileRepeatAmount,
  },
});
