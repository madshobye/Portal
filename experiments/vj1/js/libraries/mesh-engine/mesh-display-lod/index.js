import {
  defineNode,
  NODE_IMPLEMENTATION_KINDS,
  NODE_PART_KINDS,
} from "../../node-engine/node-definition.js";
import { MeshType } from "../mesh-types.js";
import {
  modelLodTargetTriangles,
  selectModelLod,
} from "../mesh-resolution/index.js";

export const MeshDisplayLodNode = defineNode({
  id: "core.mesh.display-lod",
  name: "Mesh Display LOD",
  version: "0.1.0",
  description: "Selects an existing retained mesh LOD from image demand and an authored geometry cap without rebuilding geometry.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: {
    mesh: { type: MeshType, required: true },
    viewport: { type: "viewport", optional: true },
    renderMode: {
      type: {
        type: "enum",
        values: ["surface", "points", "wireframe", "surfaceWire", "outline", "surfaceOutline", "xrayOutline"],
      },
      defaultValue: "surface",
    },
    geometryDetail: { type: "number", defaultValue: 0.5, allowedRange: [0, 2], clamp: true },
    wireDetail: { type: "number", defaultValue: 0.25, allowedRange: [0, 1], clamp: true },
  },
  outlets: {
    mesh: { type: MeshType },
    targetTriangles: { type: "number" },
  },
  execution: {
    trigger: "frame",
    domain: "main",
    pure: true,
    asynchronous: false,
    // Render demand is supplied by the current request. It can change which
    // retained LOD is selected without making wall-clock time a dependency.
    frameDependent: false,
  },
  capabilities: [
    "mesh-processing",
    "mesh-lod-selection",
    "scene-3d",
    "retained-value-provider",
    "graph-placeable",
    "live-fast-path",
  ],
  presentation: {
    catalogs: ["graph", "mesh", "scene-3d"],
    placeableOn: ["visual-graph", "node-graph"],
    previewOutput: "mesh",
  },
  parts: [{
    id: "mesh-display-lod-policy",
    name: "Mesh display LOD policy",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    export: "meshDisplayLodProcess",
    entry: "process",
    source: meshDisplayLodProcess.toString(),
  }],
  moduleBindings: {
    modelLodTargetTriangles,
    selectModelLod,
  },
  process: meshDisplayLodProcess,
});

export function meshDisplayLodProcess(
  inputs = {},
  {
    state = {},
    output = null,
    renderRequest = null,
    sourceDetail = null,
  } = {},
) {
  const viewport = inputs.viewport || sourceDetail || renderRequest || {};
  const targetTriangles = modelLodTargetTriangles({
    width: viewport.width,
    height: viewport.height,
    renderMode: inputs.renderMode,
    geometryDetail: inputs.geometryDetail,
    wireDetail: inputs.wireDetail,
  });
  const result = output || state.output || (state.output = {
    mesh: null,
    targetTriangles: 0,
  });
  result.mesh = selectModelLod(inputs.mesh, targetTriangles);
  result.targetTriangles = targetTriangles;
  return result;
}
