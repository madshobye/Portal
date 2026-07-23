import { defineNodeGroup } from "../../node-engine/node-group.js";
import { defineVisualNodeContract } from "../../render-engine/visual-node-contract.js";
import { Material3dNode } from "../material-3d/index.js";
import { PerspectiveCamera3dNode } from "../perspective-camera-3d/index.js";
import { SceneObject3dNode } from "../scene-object-3d/index.js";
import { CombineObjects3dNode } from "../combine-objects-3d/index.js";
import { Scene3dNode } from "../scene-3d/index.js";
import { SceneToImageNode } from "../scene-render/index.js";
import { Transform3dNode } from "../transform-3d/index.js";
import { MediaMeshNode } from "../media-mesh/index.js";

export const SCENE_3D_VISUAL_COMPILER_HOOK = "vj1.visual.scene-3d-program";

export const ComposableScene3dGroup = defineNodeGroup({
  id: "core.scene3d.composable-render",
  name: "Composable 3D Render",
  version: "0.1.0",
  description: "An expandable mesh/object/material/camera Scene graph lowered into retained mesh draws.",
  executionModel: "compiled-graph",
  compiler: { id: "vj1.scene-3d.direct-program", target: "scene-3d" },
  authoring: {
    activation: "recompile",
    reason: "Graph edits recompile direct retained render steps; the frame loop never interprets the group.",
  },
  inlets: {
    meshAId: { type: "string", required: true },
    meshBId: { type: "string", required: true },
    target: { type: "any", required: true },
    componentTime: { type: "number", defaultValue: 0 },
    viewport: { type: "viewport", optional: true },
    contentTransform: { type: "transform2d", defaultValue: {} },
  },
  parameters: {
    meshAId: { type: "string", defaultValue: "", editor: { type: "media" } },
    meshBId: { type: "string", defaultValue: "", editor: { type: "media" } },
  },
  outlets: { texture: { type: "texture" } },
  publicInlets: {
    meshAId: "mesh-a.$parameter.mediaId",
    meshBId: "mesh-b.$parameter.mediaId",
    target: "render.target",
  },
  publicOutlets: { texture: "render.texture" },
  controlBindings: {
    "mesh-a": [{ publicParameterId: "meshAId", targetParameterId: "mediaId" }],
    "mesh-b": [{ publicParameterId: "meshBId", targetParameterId: "mediaId" }],
  },
  controlPresentation: {
    "mesh-a": { sectionId: "meshes", label: "Meshes", order: 0 },
    "mesh-b": { sectionId: "meshes", label: "Meshes", order: 0 },
  },
  capabilities: [
    "visual-node",
    "scene-3d-program",
    "multi-object-3d",
    "expandable-group",
    "compiled-fast-path",
    "graph-placeable",
  ],
  presentation: {
    catalogs: ["node-graph", "visual-source", "scene-3d"],
    placeableOn: ["visual-graph", "node-graph"],
    expandable: true,
    previewOutput: "image",
  },
  metadata: {
    visualCompilerHook: {
      id: SCENE_3D_VISUAL_COMPILER_HOOK,
      renderer: "output/specialized:scene3d-program",
      contract: defineVisualNodeContract({
        transform: { domain: "content" },
        roi: {
          mode: "projective",
          coordinateSpace: "projective",
          inputMapping: "sub-frustum",
          pixelEquivalentToFullFrame: true,
        },
        allocation: { mode: "retained" },
        alpha: { input: "premultiplied", output: "premultiplied" },
      }),
    },
  },
  nodes: [
    { id: "mesh-a", type: MediaMeshNode.id },
    { id: "mesh-b", type: MediaMeshNode.id },
    { id: "transform-a", type: Transform3dNode.id, parameters: { position: [-0.28, 0, 0] } },
    { id: "transform-b", type: Transform3dNode.id, parameters: { position: [0.28, 0, 0] } },
    { id: "material-a", type: Material3dNode.id, parameters: { renderMode: "surface" } },
    { id: "material-b", type: Material3dNode.id, parameters: { renderMode: "surfaceWire" } },
    { id: "camera", type: PerspectiveCamera3dNode.id },
    { id: "object-a", type: SceneObject3dNode.id, parameters: { id: "object-a" } },
    { id: "object-b", type: SceneObject3dNode.id, parameters: { id: "object-b" } },
    { id: "objects", type: CombineObjects3dNode.id },
    { id: "scene", type: Scene3dNode.id },
    { id: "render", type: SceneToImageNode.id },
  ],
  connections: [
    { from: "mesh-a.mesh", to: "object-a.mesh", type: "mesh" },
    { from: "mesh-b.mesh", to: "object-b.mesh", type: "mesh" },
    { from: "transform-a.transform", to: "object-a.transform", type: "transform3d" },
    { from: "transform-b.transform", to: "object-b.transform", type: "transform3d" },
    { from: "material-a.material", to: "object-a.material", type: "material3d" },
    { from: "material-b.material", to: "object-b.material", type: "material3d" },
    { from: "object-a.object", to: "objects.a", type: "object3d" },
    { from: "object-b.object", to: "objects.b", type: "object3d" },
    { from: "objects.objects", to: "scene.objects", type: "list<object3d>" },
    { from: "camera.camera", to: "scene.camera", type: "camera3d" },
    { from: "scene.scene", to: "render.scene", type: "scene3d" },
    { from: "$in.componentTime", to: "render.componentTime", type: "number" },
    { from: "$in.viewport", to: "render.viewport", type: "viewport" },
    { from: "$in.contentTransform", to: "render.contentTransform", type: "transform2d" },
  ],
});
