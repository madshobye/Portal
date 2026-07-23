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
  outlets: { mesh: { type: MeshType } },
  execution: {
    trigger: "input-change",
    domain: "main",
    pure: false,
    asynchronous: false,
  },
  capabilities: [
    "scene-3d",
    "mesh-source",
    "project-media",
    "graph-placeable",
  ],
  presentation: {
    catalogs: ["graph", "mesh", "media", "scene-3d"],
    placeableOn: ["node-graph"],
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

export function mediaMeshNodeProcess({ mediaId = "" } = {}, { resolveMesh = null } = {}) {
  const id = String(mediaId || "");
  const mesh = id && typeof resolveMesh === "function" ? resolveMesh(id) : null;
  if (!id) throw new Error("MEDIA_MESH_ID_REQUIRED");
  if (!isMesh(mesh)) throw new Error(`MEDIA_MESH_UNAVAILABLE:${id}`);
  return { mesh };
}
