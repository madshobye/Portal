import { createColorParam, createEnumParam, createNumberParam } from "../../shared/component-schema.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";
import {
  AnatomyGeometryProviderNode,
  ModelFitCameraNode,
} from "../../shared/specialized-compound.js?v=compiled-graph-value-authority-1";
import { defineScene3dVisualCompound } from "../../shared/scene3d-visual-compound.js?v=anatomy-scene3d-1";
import { AnatomyMotionTransform3dNode } from "../../providers/anatomy-motion-transform/index.js?v=anatomy-scene3d-1";
import { AnatomyMaterialPaletteNode } from "../../providers/anatomy-material-palette/index.js?v=anatomy-scene3d-1";
import {
  MeshCollectionObjects3dNode,
  Scene3dNode,
  SceneToImageNode,
} from "../../../mesh-engine/index.js?v=scene3d-reusable-procedural-mesh-10";

const manifest = Object.freeze({
    id: "anatomy",
    name: "Low Poly Anatomy",
    category: "character",
    runtime: {
      timeDependent: (params = {}) =>
        Math.abs(Number(params.spinX) || 0) +
          Math.abs(Number(params.spinY) || 0) +
          Math.abs(Number(params.spinZ) || 0) > 0.0001 ||
        (params.part === "heart" && (Number(params.heartPulse) || 0) > 0.0001),
    },
    params: [
      createEnumParam("part", "Part", ["face", "body", "hand", "arm", "leg", "heart"], "face"),
      createEnumParam("renderMode", "Draw mode", ["surface", "wireframe", "surfaceWire", "points"], "surface"),
      createColorParam("surfaceColor", "Surface color", "#d9d4c9ff"),
      createColorParam("wireColor", "Wire color", "#4b4944cc"),
      createNumberParam("modelScale", "Scale", { min: 0.1, max: 5, step: 0.01, defaultValue: 1 }),
      createNumberParam("rotationX", "Rotate X", { min: -3.14, max: 3.14, step: 0.01, defaultValue: -0.18 }),
      createNumberParam("rotationY", "Rotate Y", { min: -3.14, max: 3.14, step: 0.01, defaultValue: -0.45 }),
      createNumberParam("rotationZ", "Rotate Z", { min: -3.14, max: 3.14, step: 0.01, defaultValue: 0 }),
      createNumberParam("spinX", "Spin X", { min: -3, max: 3, step: 0.01, defaultValue: 0 }),
      createNumberParam("spinY", "Spin Y", { min: -3, max: 3, step: 0.01, defaultValue: 0 }),
      createNumberParam("spinZ", "Spin Z", { min: -3, max: 3, step: 0.01, defaultValue: 0 }),
      createNumberParam("depth", "Depth", { min: 0.2, max: 3, step: 0.01, defaultValue: 1 }),
      createNumberParam("wireThickness", "Wire thickness", { min: 0.5, max: 12, step: 0.1, defaultValue: 1.6 }),
      createNumberParam("detail", "Polygon detail", { min: 4, max: 14, step: 1, defaultValue: 8 }),
      createNumberParam("expression", "Expression", { min: -1, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("mouthOpen", "Mouth open", { min: 0, max: 1, step: 0.01, defaultValue: 0.1 }),
      createNumberParam("brow", "Brow", { min: -1, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("eyeSquint", "Eye squint", { min: 0, max: 1, step: 0.01, defaultValue: 0.15 }),
      createNumberParam("fingerBend", "Finger bend", { min: 0, max: 1, step: 0.01, defaultValue: 0.35 }),
      createNumberParam("limbBend", "Limb bend", { min: -1, max: 1, step: 0.01, defaultValue: 0.25 }),
      createNumberParam("heartPulse", "Heart pulse", { min: 0, max: 1, step: 0.01, defaultValue: 0.35 }),
    ],
  });

const NativeVisualComponent = defineGeneratorNode(manifest);

export const VisualComponent = defineScene3dVisualCompound(NativeVisualComponent, {
  nodes: [
    { id: "geometry", type: AnatomyGeometryProviderNode.id, parameters: { providerId: "low-poly-anatomy" } },
    { id: "motion", type: AnatomyMotionTransform3dNode.id },
    { id: "materials", type: AnatomyMaterialPaletteNode.id },
    { id: "objects", type: MeshCollectionObjects3dNode.id },
    { id: "camera", type: ModelFitCameraNode.id, parameters: { fieldOfView: Math.PI / 3 } },
    { id: "scene", type: Scene3dNode.id },
    { id: "render", type: SceneToImageNode.id },
  ],
  connections: [
    { from: "geometry.collection", to: "motion.collection", type: "mesh-collection" },
    { from: "geometry.collection", to: "objects.collection", type: "mesh-collection" },
    { from: "motion.transform", to: "objects.transform", type: "transform3d" },
    { from: "materials.defaultMaterial", to: "objects.defaultMaterial", type: "material3d" },
    { from: "materials.bindings", to: "objects.materialBindings", type: "list<material-binding3d>" },
    { from: "objects.objects", to: "scene.objects", type: "list<object3d>" },
    { from: "camera.camera", to: "scene.camera", type: "camera3d" },
    { from: "scene.scene", to: "render.scene", type: "scene3d" },
    { from: "$in.componentTime", to: "render.componentTime", type: "number" },
  ],
  controlBindings: {
    geometry: ["part", "detail", "depth", "expression", "mouthOpen", "brow", "eyeSquint", "fingerBend", "limbBend", "renderQuality"],
    motion: [
      "modelScale",
      "rotationX", "rotationY", "rotationZ", "spinX", "spinY", "spinZ",
      "heartPulse",
    ],
    materials: ["renderMode", "surfaceColor", "wireColor", "wireThickness"],
  },
  controlPresentation: {
    geometry: { label: "Geometry", order: 10 },
    motion: { label: "Transform", order: 20 },
    materials: { label: "Material", order: 30 },
  },
});
export default VisualComponent;
