import {
  defineNode,
  NODE_IMPLEMENTATION_KINDS,
  NODE_PART_KINDS,
} from "../../../node-engine/node-definition.js";
import { DrawableMediaResourceType } from "../../shared/specialized-compound-types.js";

export const ScreenInputResourceNode = defineNode({
  id: "core.visual.screen-input-resource",
  name: "Screen Input",
  version: "0.1.0",
  description: "Declares one session screen-capture input as a reusable drawable resource without owning browser capture or its lifecycle.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: {
    inputId: { type: "string", defaultValue: "" },
  },
  parameters: {
    inputId: {
      type: "string",
      defaultValue: "",
      editor: { type: "screen-input" },
    },
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
    "live-media-resource",
    "screen-input-resource",
    "specialized-visual-provider",
    "specialized-visual-stage",
    "graph-placeable",
  ],
  presentation: {
    catalogs: ["node-graph", "media", "live", "input", "specialized-visual"],
    placeableOn: ["node-graph", "native-visual-graph"],
    previewOutput: "resource",
  },
  parts: [{
    id: "screen-input-resource-process",
    name: "Screen input resource process",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    export: "screenInputResourceProcess",
    entry: "process",
    source: screenInputResourceProcess.toString(),
  }],
  process: screenInputResourceProcess,
});

export function screenInputResourceProcess({ inputId = "" } = {}, { output = null, state = {} } = {}) {
  const id = String(inputId || "");
  const result = output || state.output || (state.output = { resource: null });
  const resource = result.resource || (result.resource = {});
  resource.kind = "screen-input-resource";
  resource.inputId = id;
  resource.ready = !!id;
  return result;
}
