export const TERRAIN_HEIGHT_FIELD_PROVIDER = "terrain-height-field";
export const PLANAR_GRID_PROVIDER = "planar-grid";

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
