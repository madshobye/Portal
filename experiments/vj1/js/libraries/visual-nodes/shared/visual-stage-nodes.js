import { defineNode, NODE_IMPLEMENTATION_KINDS } from "../../node-engine/node-definition.js";
import {
  FeatureMorphAnalysisType,
  DrawableMediaResourceType,
  GazeBlinkUniformsType,
  GeometryProviderType,
  MediaImageResourceType,
  TextMaskProviderType,
  TopologyProviderType,
  VisualCameraProviderType,
  VisualMaterialProviderType,
} from "./visual-stage-types.js";
import { PlanarGridGeometryProviderNode } from "../providers/planar-grid/index.js?v=retained-resource-2";
import { LitMeshMaterialProviderNode } from "../providers/lit-mesh-material/index.js?v=canonical-material-1";
import { AnatomyGeometryProviderNode } from "../providers/anatomy-geometry/index.js?v=canonical-anatomy-face-4";
import { AnatomyMotionTransform3dNode } from "../providers/anatomy-motion-transform/index.js?v=compiled-capability-revision-1";
import { AnatomyMaterialPaletteNode } from "../providers/anatomy-material-palette/index.js?v=anatomy-scene3d-1";
import { TerrainHeightFieldGeometryProviderNode } from "../providers/terrain-height-field/index.js?v=semantic-terrain-node-ownership-1";
import { TerrainBiomeMaterialProviderNode } from "../providers/terrain-biome-material/index.js?v=semantic-terrain-node-ownership-1";
import { TerrainWireMaterialProviderNode } from "../providers/terrain-wire-material/index.js?v=semantic-terrain-node-ownership-1";
import { TerrainFlightCameraProviderNode } from "../providers/terrain-flight-camera/index.js?v=semantic-terrain-render-nodes-1";
import { ModelFitCameraNode } from "../providers/model-fit-camera/index.js?v=semantic-anatomy-render-node-1";
import { MeshPatternTopologyProviderNode } from "../providers/mesh-pattern-topology/index.js?v=visual-provider-authoring-1";
import { MeshPatternFillMaterialProviderNode } from "../providers/mesh-pattern-fill-material/index.js?v=visual-provider-authoring-1";
import { MeshPatternWireMaterialProviderNode } from "../providers/mesh-pattern-wire-material/index.js?v=visual-provider-authoring-1";
import {
  TerrainSurfaceToImageNode,
  TerrainWireToImageNode,
} from "../renderers/terrain-passes/index.js?v=mesh-geometry-detail-2";
import {
  MeshPatternFillToImageNode,
  MeshPatternWireToImageNode,
} from "../renderers/mesh-pattern-passes/index.js?v=framebuffer-sequence-1";
import { MediaImageResourceNode } from "../providers/media-image-resource/index.js?v=typed-media-render-process-1";
import { ProjectMediaResourceNode } from "../providers/project-media-resource/index.js";
import {
  MobileNetMorphAnalysisNode,
  SuperPointMorphAnalysisNode,
} from "../providers/feature-morph-analysis/index.js?v=visual-provider-authoring-1";
import { FeatureMorphToImageNode } from "../renderers/feature-morph-to-image/index.js?v=visual-provider-authoring-1";
import { TextMaskProviderNode } from "../providers/text-mask/index.js?v=visual-provider-authoring-1";
import { TextMaskToImageNode } from "../renderers/text-mask-to-image/index.js?v=visual-provider-authoring-1";
import { ScreenInputResourceNode } from "../providers/screen-input-resource/index.js?v=async-media-dirty-1";
import { CameraInputResourceNode } from "../providers/camera-input-resource/index.js?v=async-media-dirty-1";
import { MediaResourceToImageNode } from "../renderers/media-resource-to-image/index.js?v=async-media-dirty-1";
import { GazeBlinkControllerNode } from "../providers/gaze-blink-controller/index.js?v=gaze-blink-semantic-1";

export {
  GeometryProviderType,
  AnatomyGeometryProviderNode,
  AnatomyMotionTransform3dNode,
  AnatomyMaterialPaletteNode,
  LitMeshMaterialProviderNode,
  PlanarGridGeometryProviderNode,
  TerrainHeightFieldGeometryProviderNode,
  TerrainBiomeMaterialProviderNode,
  TerrainWireMaterialProviderNode,
  TerrainFlightCameraProviderNode,
  ModelFitCameraNode,
  FeatureMorphAnalysisType,
  DrawableMediaResourceType,
  GazeBlinkUniformsType,
  FeatureMorphToImageNode,
  MediaImageResourceNode,
  ProjectMediaResourceNode,
  MediaImageResourceType,
  MediaResourceToImageNode,
  MobileNetMorphAnalysisNode,
  MeshPatternTopologyProviderNode,
  MeshPatternFillMaterialProviderNode,
  MeshPatternWireMaterialProviderNode,
  MeshPatternFillToImageNode,
  MeshPatternWireToImageNode,
  TerrainSurfaceToImageNode,
  TerrainWireToImageNode,
  TextMaskProviderNode,
  TextMaskProviderType,
  TextMaskToImageNode,
  TopologyProviderType,
  SuperPointMorphAnalysisNode,
  ScreenInputResourceNode,
  CameraInputResourceNode,
  GazeBlinkControllerNode,
  VisualCameraProviderType,
  VisualMaterialProviderType,
};

// These generic descriptors remain migration-only definitions for old project
// graphs. They are ordinary data nodes and have no compiler or runtime authority.
export const ProceduralGeometryProviderNode = migrationDescriptorNode({
  id: "core.visual.procedural-geometry-provider",
  name: "Procedural Geometry",
  description: "Selects a procedural geometry provider and exposes its settings independently from rendering.",
  kind: "geometry",
  outlets: { geometry: { type: GeometryProviderType } },
  capabilities: ["geometry-provider", "scene-3d", "visual-stage"],
});

export const ProceduralTopologyProviderNode = migrationDescriptorNode({
  id: "core.visual.procedural-topology-provider",
  name: "Procedural Topology",
  description: "Selects a reusable 2D topology provider independently from its material and renderer.",
  kind: "topology",
  outlets: { topology: { type: TopologyProviderType } },
  capabilities: ["topology-provider", "visual-stage"],
});

export const ShaderMaterialProviderNode = migrationDescriptorNode({
  id: "core.visual.shader-material-provider",
  name: "Shader Material",
  description: "Selects a material or shader program independently from geometry and rendering.",
  kind: "material",
  outlets: { material: { type: VisualMaterialProviderType } },
  capabilities: ["material", "shader", "visual-stage"],
});

export const VisualCameraProviderNode = migrationDescriptorNode({
  id: "core.visual.camera-provider",
  name: "Visual Camera",
  description: "Selects a camera implementation independently from geometry and rendering.",
  kind: "camera",
  outlets: { camera: { type: VisualCameraProviderType } },
  capabilities: ["camera", "scene-3d", "visual-stage"],
});

export const NativeRenderToTextureNode = migrationDescriptorNode({
  id: "core.visual.native-render-to-texture",
  name: "Native Render to Texture",
  description: "Declares a retained render operation that produces a texture.",
  kind: "render",
  inlets: {
    geometry: { type: GeometryProviderType, optional: true },
    topology: { type: TopologyProviderType, optional: true },
    material: { type: VisualMaterialProviderType, required: true },
    camera: { type: VisualCameraProviderType, optional: true },
    transform: { type: "transform3d", optional: true },
    controller: { type: "any", optional: true },
    target: { type: "texture", optional: true },
  },
  outlets: { texture: { type: "texture" } },
  capabilities: ["render-operation", "retained-render-target", "visual-stage"],
});

export const VisualStageNodeDefinitions = Object.freeze([
  ProceduralGeometryProviderNode,
  AnatomyGeometryProviderNode,
  AnatomyMotionTransform3dNode,
  AnatomyMaterialPaletteNode,
  PlanarGridGeometryProviderNode,
  TerrainHeightFieldGeometryProviderNode,
  ProceduralTopologyProviderNode,
  ShaderMaterialProviderNode,
  LitMeshMaterialProviderNode,
  TerrainBiomeMaterialProviderNode,
  TerrainWireMaterialProviderNode,
  TerrainFlightCameraProviderNode,
  ModelFitCameraNode,
  VisualCameraProviderNode,
  MediaImageResourceNode,
  ProjectMediaResourceNode,
  ScreenInputResourceNode,
  CameraInputResourceNode,
  GazeBlinkControllerNode,
  SuperPointMorphAnalysisNode,
  MobileNetMorphAnalysisNode,
  FeatureMorphToImageNode,
  MediaResourceToImageNode,
  MeshPatternTopologyProviderNode,
  MeshPatternFillMaterialProviderNode,
  MeshPatternWireMaterialProviderNode,
  MeshPatternFillToImageNode,
  MeshPatternWireToImageNode,
  TerrainSurfaceToImageNode,
  TerrainWireToImageNode,
  TextMaskProviderNode,
  TextMaskToImageNode,
  NativeRenderToTextureNode,
]);

function migrationDescriptorNode({
  id,
  name,
  description,
  kind,
  providerId = "",
  inlets = {},
  outlets = {},
  capabilities = [],
}) {
  return defineNode({
    id,
    name,
    version: "0.1.0",
    description,
    implementation: NODE_IMPLEMENTATION_KINDS.DATA,
    inlets: {
      providerId: { type: "string", defaultValue: providerId },
      settings: { type: "record", defaultValue: {} },
      ...inlets,
    },
    parameters: {
      providerId: { type: "string", defaultValue: providerId },
      enabled: { type: "boolean", defaultValue: true },
      settings: { type: "record", defaultValue: {} },
    },
    outlets,
    execution: { trigger: "input-change", domain: "main", pure: true },
    capabilities: [...capabilities, "compiled-only", "migration-only"],
    presentation: {
      catalogs: ["migration"],
      placeableOn: [],
      hiddenFrom: ["node-library", "node-graph", "visual-stage"],
    },
    process: (inputs, { output = {} } = {}) => {
      const port = Object.keys(outlets)[0];
      const descriptor = output[port] || {};
      descriptor.kind = kind;
      descriptor.providerId = String(inputs.providerId || "");
      descriptor.settings = inputs.settings || {};
      descriptor.enabled = inputs.enabled !== false;
      output[port] = descriptor;
      return output;
    },
  });
}
