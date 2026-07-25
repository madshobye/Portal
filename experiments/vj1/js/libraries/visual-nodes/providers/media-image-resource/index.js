import {
  defineNode,
  NODE_IMPLEMENTATION_KINDS,
  NODE_PART_KINDS,
} from "../../../node-engine/node-definition.js";
import {
  DrawableMediaResourceType,
  MediaImageResourceType,
} from "../../shared/visual-stage-types.js";

export const MediaImageResourceNode = defineNode({
  id: "core.visual.media-image-resource",
  name: "Project Image",
  version: "0.1.0",
  description: "Declares the image-only view of one project media resource without creating a second loading, decoding, or GPU-upload path.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: {
    mediaId: { type: "string", defaultValue: "" },
  },
  parameters: {
    mediaId: {
      type: "string",
      defaultValue: "",
      editor: { type: "media", categories: ["image"] },
    },
  },
  outlets: {
    image: { type: MediaImageResourceType },
    resource: { type: DrawableMediaResourceType },
  },
  execution: {
    trigger: "input-change",
    domain: "main",
    pure: true,
    asynchronous: false,
  },
  capabilities: [
    "media-resource",
    "project-media-resource",
    "image-resource",
    "declares-media-dependency",
    "retained-value-provider",
    "visual-value-provider",
    "visual-stage",
    "graph-placeable",
  ],
  presentation: {
    catalogs: ["node-graph", "media", "image", "visual-stage"],
    placeableOn: ["visual-graph", "node-graph", "native-visual-graph"],
    previewOutput: "resource",
  },
  metadata: {
    resourceDependencies: [{
      kind: "media",
      parameterId: "mediaId",
      required: true,
    }],
  },
  parts: [{
    id: "media-image-resource-process",
    name: "Media image resource process",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    export: "mediaImageResourceProcess",
    entry: "process",
    source: mediaImageResourceProcess.toString(),
  }],
  process: mediaImageResourceProcess,
});

export function mediaImageResourceProcess({ mediaId = "" } = {}, { output = null, state = {} } = {}) {
  const id = String(mediaId || "");
  const result = output || state.output || (state.output = {
    image: null,
    resource: null,
  });
  const image = result.image || (result.image = {});
  image.kind = "project-media-resource";
  image.mediaKind = "image";
  image.mediaId = id;
  image.start = 0;
  image.end = 0;
  image.speed = 0;
  image.ready = !!id;
  image.resourceIdentity = `project-media:${id}`;
  image.resourceRevision = id;
  result.resource = image;
  return result;
}
