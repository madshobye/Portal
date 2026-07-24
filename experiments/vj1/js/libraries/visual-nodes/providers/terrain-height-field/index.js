import {
  defineNode,
  NODE_IMPLEMENTATION_KINDS,
  NODE_PART_KINDS,
} from "../../../node-engine/node-definition.js";
import { MeshType } from "../../../mesh-engine/mesh-types.js";
import { retainPlanarGridMesh } from "../../../mesh-engine/planar-grid-mesh/index.js?v=retained-resource-2";
import {
  terrainGridSize,
  terrainRowMetrics,
  terrainTessellationSize,
} from "../../../terrain-engine/geometry-provider/index.js?v=semantic-terrain-contract-4";
import {
  TerrainKernelTopologyModuleExports,
  terrainKernelTopologyModuleSource,
} from "../../../terrain-engine/kernel-topology/index.js?v=semantic-terrain-node-ownership-1";
import { GeometryProviderType } from "../../shared/specialized-compound-types.js";

export const TerrainHeightFieldGeometryProviderNode = defineNode({
  id: "core.visual.terrain-height-field-geometry",
  name: "Terrain Height Field",
  version: "0.1.0",
  description: "Produces canonical grid topology plus a height-field displacement contract that can lower to retained Terrain GPU kernels.",
  implementation: NODE_IMPLEMENTATION_KINDS.DATA,
  inlets: {
    providerId: { type: "string", defaultValue: "terrain-height-field" },
    settings: { type: "record", defaultValue: {} },
    mountainHeight: { type: "number", defaultValue: 2.4, allowedRange: [0.05, 100], clamp: true },
    terrainScale: { type: "number", defaultValue: 0.62, allowedRange: [0.02, 5], clamp: true },
    lakeLevel: { type: "number", defaultValue: -0.12, allowedRange: [-100, 100], clamp: true },
    viewDistance: { type: "number", defaultValue: 0.85, allowedRange: [0.1, 3], clamp: true },
    globeRadius: { type: "number", defaultValue: 280, allowedRange: [60, 10000], clamp: true },
    gridWidth: { type: "number", defaultValue: 48, allowedRange: [8, 144], clamp: true },
    gridDepth: { type: "number", defaultValue: 48, allowedRange: [8, 144], clamp: true },
    gridDensity: { type: "number", defaultValue: 1, allowedRange: [0.25, 4], clamp: true },
    gridScale: { type: "number", defaultValue: 1, allowedRange: [0.1, 20], clamp: true },
    gridJitter: { type: "number", defaultValue: 0.62, allowedRange: [0, 1], clamp: true },
  },
  parameters: {
    providerId: { type: "string", defaultValue: "terrain-height-field" },
    enabled: { type: "boolean", defaultValue: true },
    settings: { type: "record", defaultValue: {} },
  },
  outlets: {
    geometry: { type: GeometryProviderType },
    mesh: { type: MeshType },
    heightField: { type: "record" },
  },
  execution: { trigger: "input-change", domain: "main", pure: true, asynchronous: false },
  capabilities: [
    "geometry-provider",
    "mesh-source",
    "height-field",
    "procedural-mesh",
    "scene-3d",
    "specialized-visual-stage",
    "graph-placeable",
  ],
  presentation: {
    catalogs: ["node-graph", "mesh", "terrain", "scene-3d", "specialized-visual"],
    placeableOn: ["node-graph", "native-visual-graph"],
  },
  metadata: {
    nativeArtifactRequirements: {
      moduleExports: Object.keys(TerrainKernelTopologyModuleExports),
      shaders: [],
    },
  },
  parts: [
    {
      id: "terrain-mesh-module",
      name: "Terrain mesh and topology algorithm",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      exports: Object.keys(TerrainKernelTopologyModuleExports),
      source: terrainKernelTopologyModuleSource(),
    },
    {
      id: "terrain-height-field-process",
      name: "Terrain Height Field provider",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      export: "terrainHeightFieldGeometryProviderProcess",
      entry: "process",
      dependsOn: ["terrain-mesh-module"],
      source: [
        terrainHeightFieldGeometryProviderProcess,
        normalizedTerrainGeometry,
        setting,
        bounded,
        record,
      ].map(String).join("\n\n"),
    },
  ],
  moduleBindings: { retainPlanarGridMesh },
  moduleExports: TerrainKernelTopologyModuleExports,
  process: terrainHeightFieldGeometryProviderProcess,
});

export function terrainHeightFieldGeometryProviderProcess(inputs = {}, { state = {}, output = null } = {}) {
  const settings = record(inputs.settings);
  const values = normalizedTerrainGeometry(settings, inputs);
  const columns = terrainTessellationSize(values.gridWidth, values.gridDensity);
  const rows = terrainTessellationSize(values.gridDepth, values.gridDensity);
  const metrics = terrainRowMetrics(0, 0, values.gridDepth, values.gridDensity, values.gridScale);
  const mesh = retainPlanarGridMesh(state.meshState || (state.meshState = {}), {
    columns,
    rows,
    width: terrainGridSize(values.gridWidth) * metrics.cellScale * 1.44,
    depth: rows * metrics.rowSpacing,
    axis: "xz",
  });
  const signature = JSON.stringify(values);
  if (state.heightFieldSignature !== signature || !state.heightField) {
    state.heightFieldSignature = signature;
    state.heightField = Object.freeze({
      kind: "terrain-height-field",
      contractVersion: 1,
      mesh,
      settings: Object.freeze({ ...values }),
      attributeContract: Object.freeze({
        coordinates: "mesh-local xz",
        displacement: "height-field",
        nativeAttributes: Object.freeze(["gridCoord"]),
      }),
    });
  }
  const result = output || state.output || (state.output = {
    geometry: null,
    mesh: null,
    heightField: null,
  });
  const geometry = result.geometry || (result.geometry = {});
  geometry.kind = "geometry";
  geometry.providerId = String(inputs.providerId || "terrain-height-field");
  geometry.settings = settings;
  geometry.enabled = inputs.enabled !== false;
  geometry.mesh = mesh;
  geometry.heightField = state.heightField;
  result.mesh = mesh;
  result.heightField = state.heightField;
  return result;
}

function normalizedTerrainGeometry(settings, inputs) {
  return {
    mountainHeight: bounded(setting(settings, inputs, "mountainHeight"), 0.05, 100, 2.4),
    terrainScale: bounded(setting(settings, inputs, "terrainScale"), 0.02, 5, 0.62),
    lakeLevel: bounded(setting(settings, inputs, "lakeLevel"), -100, 100, -0.12),
    viewDistance: bounded(setting(settings, inputs, "viewDistance"), 0.1, 3, 0.85),
    globeRadius: bounded(setting(settings, inputs, "globeRadius"), 60, 10000, 280),
    gridWidth: terrainGridSize(setting(settings, inputs, "gridWidth")),
    gridDepth: terrainGridSize(setting(settings, inputs, "gridDepth")),
    gridDensity: bounded(setting(settings, inputs, "gridDensity"), 0.25, 4, 1),
    gridScale: bounded(setting(settings, inputs, "gridScale"), 0.1, 20, 1),
    gridJitter: bounded(setting(settings, inputs, "gridJitter"), 0, 1, 0.62),
  };
}

function setting(settings, inputs, id) {
  return settings[id] === undefined ? inputs[id] : settings[id];
}

function bounded(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Math.max(minimum, Math.min(maximum, Number.isFinite(number) ? number : fallback));
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
