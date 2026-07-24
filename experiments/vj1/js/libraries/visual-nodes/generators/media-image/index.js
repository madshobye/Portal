import { createEnumParam, createTextParam } from "../../shared/component-schema.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";
import { NODE_PART_KINDS } from "../../../node-engine/node-definition.js";

const manifest = Object.freeze({
  id: "mediaImage",
  name: "Media Image",
  category: "media",
  description: "Loads one project image into the retained texture graph.",
  runtime: {
    timeDependent: () => false,
  },
  params: [
    createTextParam("mediaId", "Image", "", { ui: "media", rows: 1 }),
    createEnumParam("fit", "Fit", ["contain", "cover", "stretch"], "stretch"),
  ],
});

export function mediaImageNodeProcess({ params = {} } = {}, context = {}) {
  const target = context.target;
  const view = context.renderView || target;
  const mediaId = String(params.mediaId || "");
  if (!target || !view) throw new Error("MEDIA_IMAGE_TARGET_MISSING");
  if (!mediaId) {
    context.drawStandby?.(target, "choose an image");
    return;
  }
  const item = context.acquireMedia?.(mediaId, { width: view.width });
  if (!item?.image || context.isDrawableMedia?.(item.image) !== true) {
    if (!item) context.requestMissingMedia?.(mediaId);
    context.drawStandby?.(target, item?.imageError || "loading image");
    return;
  }
  const fit = ["contain", "cover", "stretch"].includes(params.fit) ? params.fit : "stretch";
  context.drawMediaFit?.(target, item.image, 0, 0, view.width, view.height, fit);
}

export const VisualComponent = defineGeneratorNode(manifest, null, {
  direct: true,
  process: mediaImageNodeProcess,
  exports: { mediaImageNodeProcess },
  parts: [{
    id: "media-image-process",
    name: "Media image texture source",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    export: "mediaImageNodeProcess",
    entry: "process",
    source: mediaImageNodeProcess.toString(),
  }],
});

export default VisualComponent;
