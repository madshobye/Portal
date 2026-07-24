export const TERRAIN_HEIGHT_FIELD_PROVIDER = "terrain-height-field";
export const PLANAR_GRID_PROVIDER = "planar-grid";
export const TERRAIN_GRID_CELLS = 48;

export function lowerTerrainGeometryProvider(params = {}, providerId = TERRAIN_HEIGHT_FIELD_PROVIDER) {
  if (providerId === TERRAIN_HEIGHT_FIELD_PROVIDER) return params;
  if (providerId === PLANAR_GRID_PROVIDER) {
    return {
      ...params,
      mountainHeight: 0,
    };
  }
  throw new Error(`TERRAIN_GEOMETRY_PROVIDER_UNSUPPORTED:${providerId || "missing"}`);
}

export function terrainGridSize(value) {
  const size = Number.isFinite(Number(value)) ? Number(value) : TERRAIN_GRID_CELLS;
  return Math.max(8, Math.min(144, Math.round(size)));
}

export function terrainTessellationSize(extent, gridDensity = 1) {
  const density = Math.max(0.25, Math.min(4, Number(gridDensity) || 1));
  return Math.max(4, Math.min(144, Math.round(terrainGridSize(extent) * density)));
}

export function terrainRowMetrics(componentTime, flightSpeed, gridDepth, gridDensity = 1, gridScale = 1) {
  const logicalDepth = terrainGridSize(gridDepth);
  const tessellatedDepth = terrainTessellationSize(logicalDepth, gridDensity);
  const cellScale = 1.5 * Math.max(0.1, Math.min(20, Number(gridScale) || 1));
  const rowSpacing = cellScale * logicalDepth / tessellatedDepth;
  const cameraTravel = Number(componentTime) * Math.max(0, Number(flightSpeed) || 0) * 7.0;
  return { cellScale, rowSpacing, travelRows: cameraTravel / rowSpacing };
}
