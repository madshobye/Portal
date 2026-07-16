export const TERRAIN_GRID_CELLS = 48;

export function terrainSurfaceGridVertices(widthCells = TERRAIN_GRID_CELLS, depthCells = widthCells) {
  const width = normalizedCellCount(widthCells, 1);
  const depth = normalizedCellCount(depthCells, 1);
  const vertices = new Float32Array((width + 1) * (depth + 2) * 2);
  let offset = 0;
  for (let y = 0; y <= depth + 1; y++) {
    for (let x = 0; x <= width; x++) {
      vertices[offset++] = x;
      vertices[offset++] = y;
    }
  }
  return vertices;
}

export function terrainSurfaceTriangleIndices(widthCells = TERRAIN_GRID_CELLS, depthCells = widthCells, baseRow = -1) {
  const width = normalizedCellCount(widthCells, 1);
  const depth = normalizedCellCount(depthCells, 1);
  const indices = new Uint16Array(width * (depth + 1) * 6);
  const row = width + 1;
  let offset = 0;
  for (let y = 0; y <= depth; y++) {
    for (let x = 0; x < width; x++) {
      const a = y * row + x;
      const b = a + 1;
      const d = a + row;
      const c = d + 1;
      indices.set(terrainSurfaceUsesForwardDiagonal(x, baseRow + y)
        ? [a, b, c, a, c, d]
        : [a, b, d, d, b, c], offset);
      offset += 6;
    }
  }
  return indices;
}

export function terrainExpandedGridWireVertices(widthCells = TERRAIN_GRID_CELLS, depthCells = widthCells) {
  const width = normalizedCellCount(widthCells, 1);
  const depth = normalizedCellCount(depthCells, 1);
  const edgeCount = width * (depth + 2) + (width + 1) * (depth + 1) + width * (depth + 1) * 2;
  const vertices = new Float32Array(edgeCount * 6 * 6);
  let offset = 0;
  const edge = (startX, startY, endX, endY) => {
    for (const [side, along] of [[-1, 0], [-1, 1], [1, 1], [-1, 0], [1, 1], [1, 0]]) {
      vertices[offset++] = startX;
      vertices[offset++] = startY;
      vertices[offset++] = endX;
      vertices[offset++] = endY;
      vertices[offset++] = side;
      vertices[offset++] = along;
    }
  };
  for (let y = 0; y <= depth + 1; y++) {
    for (let x = 0; x < width; x++) edge(x, y, x + 1, y);
  }
  for (let y = 0; y <= depth; y++) {
    for (let x = 0; x <= width; x++) edge(x, y, x, y + 1);
    for (let x = 0; x < width; x++) {
      edge(x, y, x + 1, y + 1);
      edge(x + 1, y, x, y + 1);
    }
  }
  return vertices;
}

export function normalizedTerrainIrregularity(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0.62;
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

export function terrainTriangleEdgeUvs(widthCells = TERRAIN_GRID_CELLS, irregularity = 0.62, travelRows = null, depthCells = widthCells) {
  const mesh = terrainIrregularMesh(widthCells, depthCells, irregularity, travelRows);
  const uniqueEdges = new Map();
  for (const face of mesh.faces) {
    for (const [start, end] of [[face[0], face[1]], [face[1], face[2]], [face[2], face[0]]]) {
      const key = start < end ? `${start}:${end}` : `${end}:${start}`;
      if (!uniqueEdges.has(key)) uniqueEdges.set(key, [start, end]);
    }
  }
  const values = [];
  for (const [start, end] of uniqueEdges.values()) values.push(...mesh.points[start], ...mesh.points[end]);
  return new Float32Array(values);
}

export function terrainExpandedWireVertices(widthCells = TERRAIN_GRID_CELLS, irregularity = 0.62, travelRows = null, depthCells = widthCells) {
  const edges = terrainTriangleEdgeUvs(widthCells, irregularity, travelRows, depthCells);
  const vertices = [];
  for (let index = 0; index < edges.length; index += 4) {
    const [startX, startY, endX, endY] = edges.subarray(index, index + 4);
    const vertex = (side, along) => vertices.push(startX, startY, endX, endY, side, along);
    vertex(-1, 0);
    vertex(-1, 1);
    vertex(1, 1);
    vertex(-1, 0);
    vertex(1, 1);
    vertex(1, 0);
  }
  return new Float32Array(vertices);
}

const terrainMeshCache = new Map();

function terrainSurfaceUsesForwardDiagonal(x, worldRow) {
  const selector = ((x * 17 + worldRow * 31 + x * worldRow * 13 + 79) % 11 + 11) % 11;
  return selector >= 5;
}

function terrainIrregularMesh(widthCells, depthCells, irregularity, travelRows) {
  const amount = normalizedTerrainIrregularity(irregularity);
  const moving = Number.isFinite(travelRows);
  const baseRow = moving ? Math.floor(travelRows) - 1 : 0;
  const rowCount = moving ? depthCells + 2 : depthCells + 1;
  const key = `${widthCells}:${depthCells}:${Math.round(amount * 100)}:${baseRow}:${moving ? 1 : 0}`;
  if (terrainMeshCache.has(key)) return terrainMeshCache.get(key);
  const points = [];
  const maxOffset = 0.44 * amount;
  for (let y = 0; y < rowCount; y++) {
    const worldRow = baseRow + y;
    for (let x = 0; x <= widthCells; x++) {
      const offsetX = x === 0 || x === widthCells ? 0 : (terrainMeshHash(x, worldRow, 17) * 2 - 1) * maxOffset / widthCells;
      const offsetY = moving || (y !== 0 && y !== depthCells) ? (terrainMeshHash(0, worldRow, 43) * 2 - 1) * maxOffset : 0;
      points.push([x / widthCells + offsetX, moving ? worldRow + offsetY : y / depthCells + offsetY / depthCells]);
    }
  }
  const faces = [];
  const row = widthCells + 1;
  for (let y = 0; y < rowCount - 1; y++) {
    for (let x = 0; x < widthCells; x++) {
      const a = y * row + x;
      const b = a + 1;
      const d = a + row;
      const c = d + 1;
      if (terrainMeshHash(x, baseRow + y, 79) < 0.5) faces.push([a, b, d], [d, b, c]);
      else faces.push([a, b, c], [a, c, d]);
    }
  }
  const mesh = { points, faces };
  terrainMeshCache.set(key, mesh);
  while (terrainMeshCache.size > 12) terrainMeshCache.delete(terrainMeshCache.keys().next().value);
  return mesh;
}

function terrainMeshHash(x, y, salt = 0) {
  let value = Math.imul((x + 101 + salt) | 0, 374761393) ^ Math.imul((y + 313 - salt) | 0, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function normalizedCellCount(value, minimum) {
  return Math.max(minimum, Math.round(Number(value) || minimum));
}
