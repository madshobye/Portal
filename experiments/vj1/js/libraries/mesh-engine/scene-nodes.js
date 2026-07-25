import { MeshRenderNode } from "./mesh-render/index.js?v=node-roi-placement-1";
import { Transform3dNode } from "./transform-3d/index.js";
import { AnimatedTransform3dNode } from "./animated-transform-3d/index.js";
import { Material3dNode } from "./material-3d/index.js?v=editable-inlet-literals-1";
import { SceneObject3dNode } from "./scene-object-3d/index.js";
import { CombineObjects3dNode } from "./combine-objects-3d/index.js";
import { PerspectiveCamera3dNode } from "./perspective-camera-3d/index.js";
import { Scene3dNode } from "./scene-3d/index.js?v=editable-inlet-literals-1";
import { SceneToImageNode } from "./scene-render/index.js?v=node-roi-placement-1";
import { ComposableScene3dGroup } from "./composable-scene-3d/index.js?v=node-roi-placement-1";
import { MediaMeshNode } from "./media-mesh/index.js";
import { PlanarGridMeshNode } from "./planar-grid-mesh/index.js?v=retained-resource-2";
import { MaterialBinding3dNode } from "./material-binding-3d/index.js?v=mesh-collection-2";
import { CombineMaterialBindings3dNode } from "./combine-material-bindings-3d/index.js?v=mesh-collection-2";
import { MeshCollectionObjects3dNode } from "./mesh-collection-objects-3d/index.js?v=mesh-collection-1";
import { ProfileMeshNode } from "./profile-mesh/index.js?v=procedural-mesh-primitives-2";
import { PathTubeMeshNode } from "./path-tube-mesh/index.js?v=procedural-mesh-primitives-2";
import { EllipsoidMeshNode } from "./ellipsoid-mesh/index.js?v=procedural-mesh-primitives-2";
import { MeshDisplayLodNode } from "./mesh-display-lod/index.js?v=node-roi-placement-1";

export {
  Transform3dNode,
  AnimatedTransform3dNode,
  Material3dNode,
  SceneObject3dNode,
  CombineObjects3dNode,
  PerspectiveCamera3dNode,
  Scene3dNode,
  SceneToImageNode,
  ComposableScene3dGroup,
  MediaMeshNode,
  PlanarGridMeshNode,
  MaterialBinding3dNode,
  CombineMaterialBindings3dNode,
  MeshCollectionObjects3dNode,
  ProfileMeshNode,
  PathTubeMeshNode,
  EllipsoidMeshNode,
  MeshDisplayLodNode,
};

// Semantic alias only: the graph has one mesh-to-image operation and does not
// introduce a second scene-renderer authority.
export const MeshToImageNode = MeshRenderNode;

export const Scene3dNodeDefinitions = Object.freeze([
  MediaMeshNode,
  PlanarGridMeshNode,
  MaterialBinding3dNode,
  CombineMaterialBindings3dNode,
  MeshCollectionObjects3dNode,
  ProfileMeshNode,
  PathTubeMeshNode,
  EllipsoidMeshNode,
  MeshDisplayLodNode,
  Transform3dNode,
  AnimatedTransform3dNode,
  Material3dNode,
  SceneObject3dNode,
  CombineObjects3dNode,
  PerspectiveCamera3dNode,
  Scene3dNode,
  SceneToImageNode,
  ComposableScene3dGroup,
]);
