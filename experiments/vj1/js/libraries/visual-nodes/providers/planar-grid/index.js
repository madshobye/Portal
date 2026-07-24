import { defineNode, NODE_IMPLEMENTATION_KINDS } from "../../../node-engine/node-definition.js";
import {
  retainPlanarGridMesh,
} from "../../../mesh-engine/planar-grid-mesh/index.js?v=retained-resource-2";
import { MeshType } from "../../../mesh-engine/mesh-types.js";
import { GeometryProviderType } from "../../shared/specialized-compound-types.js";

export const PlanarGridGeometryProviderNode = defineNode({
  id: "core.visual.planar-grid-geometry-provider",
  name: "Planar Grid Geometry",
  version: "0.1.0",
  description: "Produces both a canonical planar MeshResource and the descriptor used by retained specialized renderers.",
  implementation: NODE_IMPLEMENTATION_KINDS.DATA,
  inlets: {
    providerId: { type: "string", defaultValue: "planar-grid" },
    settings: { type: "record", defaultValue: {} },
    columns: { type: "number", defaultValue: 24, allowedRange: [1, 256], clamp: true, editor: { type: "slider", step: 1 } },
    rows: { type: "number", defaultValue: 24, allowedRange: [1, 256], clamp: true, editor: { type: "slider", step: 1 } },
    width: { type: "number", defaultValue: 2, allowedRange: [0.001, 10000], clamp: true, editor: { type: "slider", step: 0.01 } },
    depth: { type: "number", defaultValue: 2, allowedRange: [0.001, 10000], clamp: true, editor: { type: "slider", step: 0.01 } },
    axis: { type: { type: "enum", values: ["xz", "xy", "yz"] }, defaultValue: "xz", editor: { type: "select" } },
  },
  parameters: {
    providerId: { type: "string", defaultValue: "planar-grid" },
    enabled: { type: "boolean", defaultValue: true },
    settings: { type: "record", defaultValue: {} },
  },
  outlets: {
    geometry: { type: GeometryProviderType },
    mesh: { type: MeshType },
  },
  execution: { trigger: "input-change", domain: "main", pure: true, asynchronous: false },
  capabilities: [
    "geometry-provider",
    "mesh-source",
    "procedural-mesh",
    "scene-3d",
    "specialized-visual-stage",
    "planar-grid",
    "graph-placeable",
  ],
  presentation: {
    catalogs: ["node-graph", "mesh", "scene-3d", "specialized-visual"],
    placeableOn: ["node-graph", "native-visual-graph"],
  },
  process: planarGridGeometryProviderProcess,
});

export function planarGridGeometryProviderProcess(inputs = {}, { state = {}, output = null } = {}) {
  const settings = isRecord(inputs.settings) ? inputs.settings : {};
  const density = finiteClamp(settings.gridDensity, 0.25, 4, 1);
  const gridScale = finiteClamp(settings.gridScale, 0.001, 10000, 1);
  const gridWidth = finiteValue(settings.gridWidth, 24);
  const gridDepth = finiteValue(settings.gridDepth, 24);
  const options = {
    columns: settings.gridWidth === undefined
      ? inputs.columns
      : Math.round(gridWidth * density),
    rows: settings.gridDepth === undefined
      ? inputs.rows
      : Math.round(gridDepth * density),
    width: settings.gridWidth === undefined
      ? inputs.width
      : gridWidth * gridScale,
    depth: settings.gridDepth === undefined
      ? inputs.depth
      : gridDepth * gridScale,
    axis: inputs.axis,
  };
  const meshState = state.meshState || (state.meshState = {});
  const mesh = retainPlanarGridMesh(meshState, options);
  const result = output || state.output || (state.output = {
    geometry: null,
    mesh: null,
  });
  const geometry = result.geometry || (result.geometry = {});
  geometry.kind = "geometry";
  geometry.providerId = String(inputs.providerId || "planar-grid");
  geometry.settings = settings;
  geometry.enabled = inputs.enabled !== false;
  geometry.mesh = mesh;
  result.mesh = mesh;
  return result;
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function finiteValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function finiteClamp(value, minimum, maximum, fallback) {
  return Math.max(minimum, Math.min(maximum, finiteValue(value, fallback)));
}
