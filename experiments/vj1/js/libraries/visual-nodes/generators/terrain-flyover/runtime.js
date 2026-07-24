import {
  TERRAIN_GRID_CELLS,
  TerrainKernelTopologyModuleExports,
  normalizedTerrainIrregularity,
  terrainExpandedGridWireVertices,
  terrainExpandedWireVertices,
  terrainGridSize,
  terrainRowMetrics,
  terrainSafeNearDistance,
  terrainSurfaceGridVertices,
  terrainSurfaceTriangleIndices,
  terrainTessellationSize,
  terrainTriangleEdgeUvs,
} from "../../../terrain-engine/kernel-topology/index.js?v=semantic-terrain-node-ownership-1";

export {
  TERRAIN_GRID_CELLS,
  normalizedTerrainIrregularity,
  terrainExpandedGridWireVertices,
  terrainExpandedWireVertices,
  terrainGridSize,
  terrainRowMetrics,
  terrainSafeNearDistance,
  terrainSurfaceGridVertices,
  terrainSurfaceTriangleIndices,
  terrainTessellationSize,
  terrainTriangleEdgeUvs,
};

// The outer visual Group only declares the retained-host entry. Editable
// topology and shader implementations belong to its connected child nodes and
// are aggregated by the specialized compiler before the frame loop.
export function terrainNodeProcess(inputs = {}, context = {}) {
  if (typeof context.renderNativeVisualNode !== "function") throw new Error("TERRAIN_NODE_RENDER_HOST_MISSING");
  return context.renderNativeVisualNode({ inputs, context });
}

export function terrainNodeModuleParts() {
  return [];
}

export const TerrainNodeModuleExports = TerrainKernelTopologyModuleExports;
