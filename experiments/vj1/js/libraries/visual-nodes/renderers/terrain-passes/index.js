import {
  defineNode,
  NODE_EDIT_ACTIVATION,
  NODE_EXECUTION_CLASSES,
  NODE_IMPLEMENTATION_KINDS,
} from "../../../node-engine/node-definition.js";
import { TerrainFlightStateType } from "../../../terrain-engine/flight-controller/index.js";
import {
  GeometryProviderType,
  VisualCameraProviderType,
  VisualMaterialProviderType,
} from "../../shared/specialized-compound-types.js";

export const TerrainSurfaceToImageNode = terrainRenderNode({
  id: "core.visual.terrain-surface-to-image",
  name: "Terrain Surface to Image",
  providerId: "terrain-surface-pass",
  kernel: "terrain-surface",
  description: "Lowers a Terrain height field, biome material, camera, and flight state into the retained surface GPU kernel.",
});

export const TerrainWireToImageNode = terrainRenderNode({
  id: "core.visual.terrain-wire-to-image",
  name: "Terrain Wire to Image",
  providerId: "terrain-wire-pass",
  kernel: "terrain-wire",
  description: "Lowers a Terrain height field, wire material, camera, and flight state into the retained expanded-edge GPU kernel.",
});

function terrainRenderNode({ id, name, providerId, kernel, description }) {
  return defineNode({
    id,
    name,
    version: "0.1.0",
    description,
    implementation: {
      kind: NODE_IMPLEMENTATION_KINDS.NATIVE,
      compiler: "vj1.visual.specialized-compound",
      kernel,
    },
    inlets: {
      geometry: { type: GeometryProviderType, required: true },
      material: { type: VisualMaterialProviderType, required: true },
      camera: { type: VisualCameraProviderType, required: true },
      controller: { type: TerrainFlightStateType, required: true },
      target: { type: "texture", optional: true },
    },
    parameters: {
      providerId: { type: "string", defaultValue: providerId },
      enabled: { type: "boolean", defaultValue: true },
      style: {
        type: { type: "enum", values: ["biome", "wire", "hybrid"] },
        defaultValue: "hybrid",
      },
      renderQuality: { type: "number", defaultValue: 0.5, allowedRange: [0, 1], clamp: true },
    },
    outlets: { texture: { type: "texture" } },
    execution: {
      trigger: "frame",
      domain: "gpu",
      stateful: true,
      asynchronous: false,
      workload: NODE_EXECUTION_CLASSES.LIVE_FRAME,
      roi: { mode: "local", mapping: "identity" },
    },
    authoring: {
      activation: NODE_EDIT_ACTIVATION.READ_ONLY,
      reason: "The node is an explicit compiler boundary for a retained context-bound GPU kernel; its connected providers and parameters remain editable.",
    },
    capabilities: [
      "render-operation",
      "retained-render-target",
      "terrain",
      "terrain-render-kernel",
      "specialized-visual-stage",
      "graph-placeable",
      "compiled-only",
    ],
    presentation: {
      catalogs: ["node-graph", "terrain", "render", "specialized-visual"],
      placeableOn: ["native-visual-graph"],
      previewOutput: "texture",
    },
    metadata: {
      nativeKernel: kernel,
      nativeRenderer: "output/specialized:terrainFlyover",
      allocationStable: true,
    },
  });
}
