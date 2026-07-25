import { defineNode, NODE_IMPLEMENTATION_KINDS } from "../../node-engine/node-definition.js";
import { isMesh, MeshType } from "../mesh-types.js";

export const MediaMeshNode = defineNode({
  id: "core.scene3d.media-mesh",
  name: "Media Mesh",
  version: "0.1.0",
  description: "Resolves a project 3D asset into the canonical mesh value used by reusable Scene nodes.",
  implementation: NODE_IMPLEMENTATION_KINDS.DATA,
  parameters: {
    mediaId: {
      type: "string",
      defaultValue: "",
      editor: { type: "media", category: "model" },
    },
  },
  outlets: {
    mesh: { type: MeshType },
    importRotation: { type: "vector3" },
    status: { type: "resource-status" },
  },
  execution: {
    trigger: "input-change",
    domain: "main",
    pure: false,
    asynchronous: false,
    external: {
      capability: "project-mesh",
      asynchronous: true,
      lifecycle: "retained-request",
      invalidation: "external-revision",
      pending: "standby",
      error: "diagnostic",
      readyOutlet: "mesh",
    },
  },
  capabilities: [
    "scene-3d",
    "mesh-source",
    "project-media",
    "retained-value-provider",
    "graph-placeable",
  ],
  presentation: {
    catalogs: ["graph", "mesh", "media", "scene-3d", "visual"],
    placeableOn: ["visual-graph", "node-graph"],
  },
  metadata: {
    resourceDependencies: [{
      kind: "media",
      valueType: "mesh",
      parameterId: "mediaId",
      required: true,
    }],
  },
  process: mediaMeshNodeProcess,
});

export function mediaMeshNodeProcess(
  { mediaId = "" } = {},
  {
    resolveMesh = null,
    resolveMeshStatus = null,
    state = {},
    output = null,
  } = {},
) {
  const id = String(mediaId || "");
  const mesh = id && typeof resolveMesh === "function" ? resolveMesh(id) : null;
  const result = output || state.output || (state.output = {
    mesh: null,
    importRotation: [0, 0, 0],
    status: {
      ready: false,
      pending: true,
      label: "loading 3D model",
      error: "",
    },
  });
  result.status ||= {
    ready: false,
    pending: true,
    label: "loading 3D model",
    error: "",
  };
  result.mesh = isMesh(mesh) ? mesh : null;
  result.importRotation =
    // STL has no axis metadata. Keep its documented import basis beside the
    // resolved resource so graphs can inspect, replace, or disconnect it.
    /\.stl$/i.test(id) ? [0, 0, Math.PI] : [0, 0, 0];
  const externalStatus =
    id && typeof resolveMeshStatus === "function"
      ? resolveMeshStatus(id)
      : null;
  result.status.ready = isMesh(mesh);
  const error = String(
    externalStatus?.error ||
    externalStatus?.modelError ||
    externalStatus?.loadError ||
    "",
  );
  result.status.pending = !result.status.ready && !error;
  result.status.label = String(
    externalStatus?.label ||
    externalStatus?.loadStatus ||
    (result.status.ready ? "3D model ready" : "loading 3D model"),
  );
  result.status.error = error;
  return result;
}
