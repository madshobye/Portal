import {
  createColorParam,
  createEnumParam,
  createNumberParam,
  createTextParam,
} from "../../shared/component-schema.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";
import {
  defineCompiledVisualCompound,
} from "../../shared/compiled-visual-compound.js";
import {
  LitMeshMaterialProviderNode,
  ModelFitCameraNode,
} from "../../shared/visual-stage-nodes.js";
import {
  AnimatedTransform3dNode,
  CombineObjects3dNode,
  MediaMeshNode,
  MeshDisplayLodNode,
  Scene3dNode,
  SceneObject3dNode,
  SceneToImageNode,
} from "../../../mesh-engine/index.js";

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
  primaryParamIds: [
    "mediaId",
    "renderMode",
    "geometryDetail",
    "surfaceColor",
    "wireColor",
    "modelScale",
  ],
  detailParamIds: [
    "rotationX",
    "rotationY",
    "rotationZ",
    "spinX",
    "spinY",
    "spinZ",
    "depth",
    "visibleDepth",
    "focalLength",
    "wireThickness",
    "edgeAngle",
    "edgeBudget",
    "pointBudget",
  ],
  params: [
    {
      ...createTextParam("mediaId", "3D model", "", { ui: "media", rows: 1 }),
      mediaCategory: "model",
    },
    createNumberParam("geometryDetail", "Geometry detail", {
      min: 0,
      max: 2,
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
    createNumberParam("edgeAngle", "Edge angle", { min: 0, max: 180, step: 1, defaultValue: 35 }),
    createNumberParam("edgeBudget", "Edge budget", { min: 1000, max: 50000, step: 1000, defaultValue: 20000 }),
    createNumberParam("pointBudget", "Point budget", { min: 500, max: 50000, step: 500, defaultValue: 4000 }),
  ],
});

const NativeVisualComponent = defineGeneratorNode(manifest);

export const VisualComponent = defineCompiledVisualCompound(NativeVisualComponent, {
  nodes: [
    { id: "media", definition: MediaMeshNode, role: "value" },
    { id: "lod", definition: MeshDisplayLodNode, role: "value" },
    { id: "motion", definition: AnimatedTransform3dNode, role: "value" },
    { id: "material", definition: LitMeshMaterialProviderNode, role: "value" },
    { id: "object", definition: SceneObject3dNode, role: "value", parameters: { id: "model" } },
    { id: "objects", definition: CombineObjects3dNode, role: "value" },
    { id: "camera", definition: ModelFitCameraNode, role: "value" },
    { id: "scene", definition: Scene3dNode, role: "value" },
    { id: "render", definition: SceneToImageNode, role: "renderer" },
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
    { from: "media.status", to: "render.resourceStatus", type: "resource-status" },
  ],
  output: "render.texture",
  parameterBindings: {
    media: ["mediaId"],
    lod: ["geometryDetail"],
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
    ],
    camera: ["focalLength"],
  },
  parameterPresentation: {
    media: { label: "Mesh", order: 0 },
    lod: { label: "Geometry", order: 10 },
    motion: { label: "Transform", order: 20 },
    material: { label: "Material", order: 30 },
    camera: { label: "Camera", order: 40 },
  },
});

export default VisualComponent;
