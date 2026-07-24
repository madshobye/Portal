import {
  createColorParam,
  createEnumParam,
  createNumberParam,
  createTextParam,
} from "../../shared/component-schema.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";
import { defineScene3dVisualCompound } from "../../shared/scene3d-visual-compound.js?v=anatomy-scene3d-1";
import {
  LitMeshMaterialProviderNode,
  ModelFitCameraNode,
} from "../../shared/specialized-compound.js?v=compiled-semantic-specialized-compounds-26";
import {
  AnimatedTransform3dNode,
  CombineObjects3dNode,
  MediaMeshNode,
  MeshDisplayLodNode,
  Scene3dNode,
  SceneObject3dNode,
  SceneToImageNode,
} from "../../../mesh-engine/index.js?v=scene3d-reusable-procedural-mesh-10";

export const MODEL_MEDIA_GENERATOR_ID = "modelMedia";

const manifest = Object.freeze({
  id: MODEL_MEDIA_GENERATOR_ID,
  name: "Model Media",
  category: "3d",
  description: "Loads a project mesh and composes reusable LOD, transform, material, camera, Scene, and image nodes.",
  runtime: {
    timeDependent: (params = {}) =>
      Math.abs(Number(params.spinX) || 0) +
      Math.abs(Number(params.spinY) || 0) +
      Math.abs(Number(params.spinZ) || 0) > 0.0001,
  },
  params: [
    {
      ...createTextParam("mediaId", "3D model", "", { ui: "media", rows: 1 }),
      mediaCategory: "model",
    },
    createNumberParam("renderQuality", "Geometry detail", {
      min: 0,
      max: 1,
      step: 0.01,
      defaultValue: 0.5,
    }),
    createEnumParam(
      "renderMode",
      "Draw mode",
      ["surface", "wireframe", "surfaceWire", "outline", "surfaceOutline", "xrayOutline", "points"],
      "surface",
    ),
    createColorParam("surfaceColor", "Surface color", "#dce1dcff"),
    createColorParam("wireColor", "Wire color", "#141414dd"),
    createNumberParam("rotationX", "Rotate X", { min: -3.14, max: 3.14, step: 0.01, defaultValue: 0 }),
    createNumberParam("rotationY", "Rotate Y", { min: -3.14, max: 3.14, step: 0.01, defaultValue: 0 }),
    createNumberParam("rotationZ", "Rotate Z", { min: -3.14, max: 3.14, step: 0.01, defaultValue: 0 }),
    createNumberParam("modelScale", "Scale", { min: 0.1, max: 5, step: 0.01, defaultValue: 1 }),
    createNumberParam("spinX", "Spin X", { min: -3, max: 3, step: 0.01, defaultValue: 0 }),
    createNumberParam("spinY", "Spin Y", { min: -3, max: 3, step: 0.01, defaultValue: 0 }),
    createNumberParam("spinZ", "Spin Z", { min: -3, max: 3, step: 0.01, defaultValue: 0 }),
    createNumberParam("depth", "Depth scale", { min: 0.2, max: 3, step: 0.01, defaultValue: 1 }),
    createNumberParam("visibleDepth", "Visible depth", { min: 0.02, max: 1, step: 0.01, defaultValue: 1 }),
    createNumberParam("focalLength", "Focal length (mm)", { min: 8, max: 200, step: 0.1, defaultValue: 20.8 }),
    createNumberParam("wireThickness", "Wire thickness", { min: 0.5, max: 12, step: 0.1, defaultValue: 1 }),
    createNumberParam("wireDetail", "Wire detail", { min: 0, max: 1, step: 0.01, defaultValue: 0.25 }),
    createNumberParam("edgeAngle", "Edge angle", { min: 0, max: 180, step: 1, defaultValue: 35 }),
    createNumberParam("edgeBudget", "Edge budget", { min: 1000, max: 50000, step: 1000, defaultValue: 20000 }),
    createNumberParam("pointBudget", "Point budget", { min: 500, max: 50000, step: 500, defaultValue: 4000 }),
  ],
});

const NativeVisualComponent = defineGeneratorNode(manifest);

export const VisualComponent = defineScene3dVisualCompound(NativeVisualComponent, {
  nodes: [
    { id: "media", type: MediaMeshNode.id },
    { id: "lod", type: MeshDisplayLodNode.id },
    { id: "motion", type: AnimatedTransform3dNode.id },
    { id: "material", type: LitMeshMaterialProviderNode.id },
    { id: "object", type: SceneObject3dNode.id, parameters: { id: "model" } },
    { id: "objects", type: CombineObjects3dNode.id },
    { id: "camera", type: ModelFitCameraNode.id },
    { id: "scene", type: Scene3dNode.id },
    { id: "render", type: SceneToImageNode.id },
  ],
  connections: [
    { from: "media.mesh", to: "lod.mesh", type: "mesh" },
    { from: "media.importRotation", to: "motion.rotationOffset", type: "vector3" },
    { from: "lod.mesh", to: "object.mesh", type: "mesh" },
    { from: "motion.transform", to: "object.transform", type: "transform3d" },
    { from: "material.sceneMaterial", to: "object.material", type: "material3d" },
    { from: "object.object", to: "objects.a", type: "object3d" },
    { from: "objects.objects", to: "scene.objects", type: "list<object3d>" },
    { from: "camera.camera", to: "scene.camera", type: "camera3d" },
    { from: "scene.scene", to: "render.scene", type: "scene3d" },
    { from: "$in.componentTime", to: "render.componentTime", type: "number" },
    { from: "$in.viewport", to: "lod.viewport", type: "viewport" },
  ],
  controlBindings: {
    media: ["mediaId"],
    lod: ["renderMode", "renderQuality", "wireDetail", "edgeBudget"],
    motion: [
      { publicParameterId: "modelScale", targetParameterId: "uniformScale" },
      { publicParameterId: "depth", targetParameterId: "scaleZ" },
      "rotationX", "rotationY", "rotationZ",
      "spinX", "spinY", "spinZ",
    ],
    material: [
      "renderMode",
      "surfaceColor",
      "wireColor",
      "wireThickness",
      "pointBudget",
      "visibleDepth",
      "edgeAngle",
      "edgeBudget",
      "wireDetail",
      "renderQuality",
    ],
    camera: ["focalLength"],
  },
  controlPresentation: {
    media: { label: "Mesh", order: 0 },
    lod: { label: "Geometry", order: 10 },
    motion: { label: "Transform", order: 20 },
    material: { label: "Material", order: 30 },
    camera: { label: "Camera", order: 40 },
  },
});

export default VisualComponent;
