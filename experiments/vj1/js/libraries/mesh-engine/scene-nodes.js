import { MeshRenderNode } from "./mesh-render/index.js";
import { Transform3dNode } from "./transform-3d/index.js";
import { Material3dNode } from "./material-3d/index.js";
import { SceneObject3dNode } from "./scene-object-3d/index.js";
import { CombineObjects3dNode } from "./combine-objects-3d/index.js";
import { PerspectiveCamera3dNode } from "./perspective-camera-3d/index.js";
import { Scene3dNode } from "./scene-3d/index.js";
import { SceneToImageNode } from "./scene-render/index.js";
import { ComposableScene3dGroup } from "./composable-scene-3d/index.js?v=project-group-authoring-1";
import { MediaMeshNode } from "./media-mesh/index.js";

export {
  Transform3dNode,
  Material3dNode,
  SceneObject3dNode,
  CombineObjects3dNode,
  PerspectiveCamera3dNode,
  Scene3dNode,
  SceneToImageNode,
  ComposableScene3dGroup,
  MediaMeshNode,
};

// Semantic alias only: the graph has one mesh-to-image operation and does not
// introduce a second scene-renderer authority.
export const MeshToImageNode = MeshRenderNode;

export const Scene3dNodeDefinitions = Object.freeze([
  MediaMeshNode,
  Transform3dNode,
  Material3dNode,
  SceneObject3dNode,
  CombineObjects3dNode,
  PerspectiveCamera3dNode,
  Scene3dNode,
  SceneToImageNode,
  ComposableScene3dGroup,
]);
