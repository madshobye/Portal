import {
  defineNode,
  NODE_IMPLEMENTATION_KINDS,
  NODE_PART_KINDS,
} from "../../../node-engine/node-definition.js";
import { DrawableMediaResourceType } from "../../shared/visual-stage-types.js";

export const CameraInputResourceNode = defineNode({
  id: "core.visual.camera-input-resource",
  name: "Camera Input",
  version: "0.1.0",
  description: "Declares the project camera as a reusable drawable resource while the host retains permission, retry, and capture lifecycle ownership.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  outlets: {
    resource: { type: DrawableMediaResourceType },
  },
  execution: {
    trigger: "frame",
    domain: "main",
    pure: true,
    asynchronous: false,
  },
  capabilities: [
    "media-resource",
    "live-media-resource",
    "camera-input-resource",
    "retained-value-provider",
    "visual-value-provider",
    "visual-stage",
    "graph-placeable",
  ],
  presentation: {
    catalogs: ["node-graph", "media", "live", "input", "camera", "visual-stage"],
    placeableOn: ["visual-graph", "node-graph", "native-visual-graph"],
    previewOutput: "resource",
  },
  metadata: {
    resourceDependencies: [{
      kind: "camera",
      id: "default",
      required: true,
    }],
  },
  parts: [{
    id: "camera-input-resource-process",
    name: "Camera input resource process",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    export: "cameraInputResourceProcess",
    entry: "process",
    source: cameraInputResourceProcess.toString(),
  }],
  process: cameraInputResourceProcess,
});

export function cameraInputResourceProcess(_inputs = {}, { output = null, state = {} } = {}) {
  const result = output || state.output || (state.output = { resource: null });
  const resource = result.resource || (result.resource = {});
  resource.kind = "camera-input-resource";
  resource.inputId = "default";
  resource.ready = true;
  return result;
}
