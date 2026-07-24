import {
  defineNode,
  NODE_EDIT_ACTIVATION,
  NODE_EXECUTION_CLASSES,
  NODE_IMPLEMENTATION_KINDS,
  NODE_PART_KINDS,
} from "../../../node-engine/node-definition.js";
import { DrawableMediaResourceType } from "../../shared/specialized-compound-types.js";

export const MediaResourceToImageNode = defineNode({
  id: "core.visual.media-resource-to-image",
  name: "Media Resource to Image",
  version: "0.1.0",
  description: "Fits and optionally mirrors a connected host-resolved drawable media resource into the current retained image target.",
  implementation: {
    kind: NODE_IMPLEMENTATION_KINDS.NATIVE,
    compiler: "vj1.visual.specialized-compound",
    kernel: "media-resource-fit",
  },
  inlets: {
    resource: { type: DrawableMediaResourceType, required: true },
  },
  parameters: {
    providerId: { type: "string", defaultValue: "media-resource-fit-pass" },
    enabled: { type: "boolean", defaultValue: true },
    fit: {
      type: { type: "enum", values: ["contain", "cover", "stretch"] },
      defaultValue: "contain",
    },
    mirrored: { type: "boolean", defaultValue: false },
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
    reason: "Browser media acquisition and the p5 target are host-bound; resource selection, fit, mirroring, and graph composition remain editable.",
  },
  capabilities: [
    "render-operation",
    "media-fit",
    "live-media",
    "specialized-visual-stage",
    "graph-placeable",
    "compiled-only",
  ],
  presentation: {
    catalogs: ["node-graph", "media", "live", "image", "render", "specialized-visual"],
    placeableOn: ["native-visual-graph"],
    previewOutput: "texture",
  },
  metadata: {
    nativeKernel: "media-resource-fit",
    nativeRenderer: "output/specialized:screenShare",
    allocationStable: true,
    nativeArtifactRequirements: {
      moduleExports: ["drawMediaResourceToImage"],
      shaders: [],
    },
  },
  parts: [{
    id: "media-resource-fit-module",
    name: "Media resource fit and mirror algorithm",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    exports: ["drawMediaResourceToImage"],
    source: drawMediaResourceToImage.toString(),
  }],
  moduleExports: {
    drawMediaResourceToImage,
  },
});

export function drawMediaResourceToImage(target, media, params = {}, drawMediaFit, view = target) {
  const fit = ["contain", "cover", "stretch"].includes(params.fit) ? params.fit : "contain";
  target.push();
  if (params.mirrored === true) {
    target.translate(view.width, 0);
    target.scale(-1, 1);
  }
  drawMediaFit(target, media, 0, 0, view.width, view.height, fit);
  target.pop();
}
