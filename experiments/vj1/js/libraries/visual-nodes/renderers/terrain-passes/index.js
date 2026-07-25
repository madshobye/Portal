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
} from "../../shared/visual-stage-types.js";

export const TerrainSurfaceToImageNode = terrainRenderNode({
  id: "core.visual.terrain-surface-to-image",
  name: "Terrain Surface to Image",
  providerId: "terrain-surface-pass",
  kernel: "terrain-surface",
  nativeRenderer: "output/specialized:terrainSurface",
  description: "Lowers a Terrain height field, biome material, camera, and flight state into the retained surface GPU kernel.",
});

export const TerrainWireToImageNode = terrainRenderNode({
  id: "core.visual.terrain-wire-to-image",
  name: "Terrain Wire to Image",
  providerId: "terrain-wire-pass",
  kernel: "terrain-wire",
  nativeRenderer: "output/specialized:terrainWire",
  framebufferPass: {
    input: "target",
    preserve: ["color", "depth"],
  },
  description: "Lowers a Terrain height field, wire material, camera, and flight state into the retained expanded-edge GPU kernel.",
});

function terrainRenderNode({
  id,
  name,
  providerId,
  kernel,
  nativeRenderer,
  framebufferPass = null,
  description,
}) {
  return defineNode({
    id,
    name,
    version: "0.1.0",
    description,
    implementation: {
      kind: NODE_IMPLEMENTATION_KINDS.NATIVE,
      compiler: "vj1.visual.native-source",
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
      flightMode: {
        type: { type: "enum", values: ["free", "terrainFollow"] },
        defaultValue: "free",
      },
      renderQuality: { type: "number", defaultValue: 0.5, allowedRange: [0, 1], clamp: true },
    },
    outlets: { texture: { type: "texture" } },
    execution: {
      trigger: "change",
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
      "visual-stage",
      "graph-placeable",
      "compiled-only",
    ],
    presentation: {
      catalogs: ["node-graph", "terrain", "render", "visual-stage"],
      placeableOn: ["visual-graph", "node-graph", "native-visual-graph"],
      previewOutput: "texture",
    },
    metadata: {
      nativeKernel: kernel,
      nativeRenderer,
      nodeOwnedNativeModule: true,
      renderTarget: { depth: true },
      allocationStable: true,
      renderInvalidation: { mode: "dependency" },
      ...(framebufferPass ? { framebufferPass } : {}),
    },
  });
}
