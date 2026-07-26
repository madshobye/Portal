import {
  defineNode,
  NODE_EDIT_ACTIVATION,
  NODE_EXECUTION_CLASSES,
  NODE_IMPLEMENTATION_KINDS,
  NODE_PART_KINDS,
} from "../../../node-engine/node-definition.js";
import { DrawableMediaResourceType } from "../../shared/visual-stage-types.js";

export const MediaResourceToImageNode = defineNode({
  id: "core.visual.media-resource-to-image",
  name: "Media Resource to Image",
  version: "0.1.0",
  description: "Fits and optionally mirrors a connected host-resolved drawable media resource into the current retained image target.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
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
    activation: NODE_EDIT_ACTIVATION.RECOMPILE,
    reason: "The host supplies drawable resources and the retained target; this node owns the editable fit and presentation process.",
  },
  capabilities: [
    "render-operation",
    "media-fit",
    "live-media",
    "typed-media-renderer",
    "graph-placeable",
    "compiled-only",
  ],
  presentation: {
    catalogs: ["node-graph", "media", "live", "image", "render", "visual-stage"],
    placeableOn: ["visual-graph", "node-graph", "native-visual-graph"],
    previewOutput: "texture",
  },
  metadata: {
    nodeOwnedNativeModule: true,
    nodeOwnedNativeProcess: true,
    allocationStable: true,
    allocationStableDirectPath: true,
    directPlacement: Object.freeze({
      kind: "drawable-resource",
      input: "resource",
      fitParameter: "fit",
      mirrorParameter: "mirrored",
      retainProjectVideoFrame: true,
    }),
    nativeArtifactRequirements: {
      moduleExports: [
        "drawMediaResourceToImage",
        "mediaResourceToImageProcess",
      ],
      shaders: [],
    },
  },
  parts: [
    {
      id: "media-resource-fit-module",
      name: "Media resource fit and mirror algorithm",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      exports: ["drawMediaResourceToImage"],
      source: drawMediaResourceToImage.toString(),
    },
    {
      id: "media-resource-to-image-process",
      name: "Typed media resource render process",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      entry: "process",
      exports: ["mediaResourceToImageProcess"],
      dependsOn: ["media-resource-fit-module"],
      source: mediaResourceToImageProcess.toString(),
    },
  ],
  process: mediaResourceToImageProcess,
  moduleExports: {
    drawMediaResourceToImage,
    mediaResourceToImageProcess,
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

export function mediaResourceToImageProcess(
  {
    params = {},
    runtimeValues = null,
    resource = null,
  } = {},
  context = {},
) {
  const descriptor =
    resource ||
    runtimeValues?.get?.("resource") ||
    null;
  const media = context.acquireDrawableResource(
    descriptor,
    Number(context.renderView?.width) || Number(context.target?.width) || 0,
  );
  const error = context.drawableResourceError(descriptor);
  if (!media || context.isDrawableMedia?.(media) !== true) {
    context.drawStandby?.(
      context.target,
      error || "media resource unavailable",
      {
        forceVisible: true,
        icon: mediaResourceDiagnosticKind(descriptor),
      },
    );
    return context.target || null;
  }
  drawMediaResourceToImage(
    context.target,
    media,
    params,
    context.drawMediaFit,
    context.renderView || context.target,
  );
  return context.target || null;
}

export function mediaResourceDiagnosticKind(descriptor = {}) {
  const declaredKind = String(descriptor?.mediaKind || "").toLowerCase();
  if (["image", "video", "model"].includes(declaredKind)) return declaredKind;
  const mediaId = String(descriptor?.mediaId || "").toLowerCase().split(/[?#]/, 1)[0];
  if (/\.(mp4|m4v|mov|webm|ogv)$/.test(mediaId)) return "video";
  if (/\.(stl|obj|gltf|glb|ply)$/.test(mediaId)) return "model";
  if (/\.(png|jpe?g|gif|webp|avif|bmp|svg)$/.test(mediaId)) return "image";
  return "resource";
}
