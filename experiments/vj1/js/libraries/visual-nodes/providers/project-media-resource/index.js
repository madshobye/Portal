import {
  defineNode,
  NODE_IMPLEMENTATION_KINDS,
  NODE_PART_KINDS,
} from "../../../node-engine/node-definition.js";
import { DrawableMediaResourceType } from "../../shared/visual-stage-types.js";

export const ProjectMediaResourceNode = defineNode({
  id: "core.visual.project-media-resource",
  name: "Project Media",
  version: "0.1.0",
  description: "Declares one project image or video as a reusable drawable resource while the retained media host owns decoding, playback, sharing, and release.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: {
    mediaId: { type: "string", defaultValue: "" },
    start: { type: "number", defaultValue: 0, allowedRange: [0, 86400], clamp: true },
    end: { type: "number", defaultValue: 0, allowedRange: [0, 86400], clamp: true },
    speed: { type: "number", defaultValue: 1, allowedRange: [0, 4], clamp: true },
  },
  parameters: {
    mediaId: {
      type: "string",
      defaultValue: "",
      editor: { type: "media", category: "" },
    },
    start: { type: "number", defaultValue: 0, allowedRange: [0, 86400], clamp: true },
    end: { type: "number", defaultValue: 0, allowedRange: [0, 86400], clamp: true },
    speed: { type: "number", defaultValue: 1, allowedRange: [0, 4], clamp: true },
  },
  outlets: {
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
    "video-resource",
    "declares-media-dependency",
    "retained-value-provider",
    "graph-placeable",
  ],
  presentation: {
    catalogs: ["node-graph", "media", "image", "video"],
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
    id: "project-media-resource-process",
    name: "Project media resource process",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    export: "projectMediaResourceProcess",
    entry: "process",
    source: projectMediaResourceProcess.toString(),
  }],
  process: projectMediaResourceProcess,
});

export function projectMediaResourceProcess(
  {
    mediaId = "",
    start = 0,
    end = 0,
    speed = 1,
  } = {},
  { output = null, state = {} } = {},
) {
  const id = String(mediaId || "");
  const result = output || state.output || (state.output = { resource: null });
  const resource = result.resource || (result.resource = {});
  resource.kind = "project-media-resource";
  resource.mediaKind = "any";
  resource.mediaId = id;
  resource.start = Math.max(0, Number(start) || 0);
  resource.end = Math.max(0, Number(end) || 0);
  resource.speed = Math.max(0, Number(speed) || 0);
  resource.ready = !!id;
  resource.resourceIdentity = `project-media:${id}`;
  resource.resourceRevision = id;
  return result;
}
