import {
  defineNode,
  NODE_IMPLEMENTATION_KINDS,
  NODE_PART_KINDS,
} from "../../../node-engine/node-definition.js";
import { MediaImageResourceType } from "../../shared/specialized-compound-types.js";

export const MediaImageResourceNode = defineNode({
  id: "core.visual.media-image-resource",
  name: "Media Image",
  version: "0.1.0",
  description: "Declares one project image as a typed reusable visual resource without owning decoding or GPU upload.",
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
  },
  execution: {
    trigger: "input-change",
    domain: "main",
    pure: true,
    asynchronous: false,
  },
  capabilities: [
    "media-resource",
    "image-resource",
    "declares-media-dependency",
    "specialized-visual-provider",
    "specialized-visual-stage",
    "graph-placeable",
  ],
  presentation: {
    catalogs: ["node-graph", "media", "image", "specialized-visual"],
    placeableOn: ["node-graph", "native-visual-graph"],
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
  const result = output || state.output || (state.output = { image: null });
  const image = result.image || (result.image = {});
  image.kind = "media-image-resource";
  image.mediaId = id;
  image.ready = !!id;
  return result;
}
