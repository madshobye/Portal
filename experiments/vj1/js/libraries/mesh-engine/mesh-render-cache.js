import { modelTriangleNormal, normalizeModelVector } from "./mesh-geometry.js";
import { forEachModelTriangle, meshResourceCacheKey, modelTriangleCount } from "./mesh-types.js";

export function drawPointCloud(target, points, wireColor = [245, 245, 245, 255], wireThickness = 1) {
  if (!points?.length) return;
  target.noFill();
  target.stroke(...wireColor);
  target.strokeWeight(wireThickness);
  target.beginShape(POINTS);
  for (let index = 0; index + 2 < points.length; index += 3) {
    target.vertex(points[index], points[index + 1], points[index + 2]);
  }
  target.endShape();
}

export function drawParsedModel(target, mesh, renderMode = "surface", surfaceColor = [220, 225, 220, 255], wireColor = [20, 20, 20, 220], wireThickness = 1) {
  if (renderMode === "points") {
    drawPointCloud(target, buildParsedModelPointCloud(mesh, 4000), wireColor, wireThickness);
    return;
  }
  if (renderMode !== "wireframe") {
    target.noStroke();
    target.ambientMaterial?.(...surfaceColor);
    target.fill?.(...surfaceColor);
    drawWithPolygonOffset(target, renderMode === "surfaceWire", () => drawParsedTriangles(target, mesh));
  }
  if (renderMode === "wireframe" || renderMode === "surfaceWire") {
    target.noFill();
    target.stroke(...wireColor);
    target.strokeWeight(wireThickness);
    drawParsedTriangles(target, mesh);
  }
}

export function drawGeometryModel(target, geometry, renderMode = "surface", surfaceColor = [220, 225, 220, 255], wireColor = [20, 20, 20, 220], wireThickness = 1) {
  if (renderMode !== "wireframe") {
    target.noStroke();
    target.ambientMaterial?.(...surfaceColor);
    target.fill?.(...surfaceColor);
    drawWithPolygonOffset(target, renderMode === "surfaceWire", () => target.model(geometry));
  }
  if (renderMode === "wireframe" || renderMode === "surfaceWire") {
    target.noFill();
    target.stroke(...wireColor);
    target.strokeWeight(wireThickness);
    target.model(geometry);
  }
}

export function drawWithPolygonOffset(target, enabled, draw) {
  const gl = target?.drawingContext;
  if (!enabled || !gl?.polygonOffset || typeof draw !== "function") return draw?.();
  const wasEnabled = gl.isEnabled(gl.POLYGON_OFFSET_FILL);
  const previousFactor = gl.getParameter(gl.POLYGON_OFFSET_FACTOR);
  const previousUnits = gl.getParameter(gl.POLYGON_OFFSET_UNITS);
  gl.enable(gl.POLYGON_OFFSET_FILL);
  gl.polygonOffset(1, 2);
  try {
    return draw();
  } finally {
    gl.polygonOffset(previousFactor, previousUnits);
    if (!wasEnabled) gl.disable(gl.POLYGON_OFFSET_FILL);
  }
}

export function ensureParsedModelGeometry(item, mesh = item?.modelData) {
  if (item.modelGeometryFailed) return null;
  const geometryKey = `geometry:${meshResourceCacheKey(mesh)}`;
  if (item.modelGeometry && item.modelGeometryKey === geometryKey) return item.modelGeometry;
  item.modelGeometry = null;
  const Geometry = globalThis.p5?.Geometry;
  if (!mesh || typeof Geometry !== "function") return null;
  const geometry = new Geometry();
  geometry.gid = `vj1-stl-${stableGeometryId(item.id)}`;
  forEachModelTriangle(mesh, (triangle) => {
    const base = geometry.vertices.length;
    const normal = normalizeModelVector(triangle.normal || modelTriangleNormal(triangle.vertices || []));
    for (const vertex of triangle.vertices || []) {
      geometry.vertices.push(createGeometryVector(vertex[0], vertex[1], vertex[2]));
      geometry.vertexNormals?.push?.(createGeometryVector(normal[0], normal[1], normal[2]));
    }
    geometry.faces.push([base, base + 1, base + 2]);
  });
  if (!geometry.vertices.length || !geometry.faces.length) return null;
  geometry._makeTriangleEdges?.();
  geometry._edgesToVertices?.();
  item.modelGeometry = geometry;
  item.modelGeometryKey = geometryKey;
  return geometry;
}

export function ensureParsedModelPointCloud(item, pointBudget = 4000, mesh = item?.modelData) {
  const budget = boundedBudget(pointBudget);
  const key = `stl:${meshResourceCacheKey(mesh)}:${budget}`;
  if (item?.modelPointCloud && item.modelPointCloudKey === key) return item.modelPointCloud;
  const points = buildParsedModelPointCloud(mesh, budget);
  if (item) {
    item.modelPointCloud = points;
    item.modelPointCloudKey = key;
  }
  return points;
}

export function ensureParsedModelWireLines(item, lineBudget = 4000, mesh = item?.modelData) {
  const budget = boundedBudget(lineBudget);
  const key = `wire:${meshResourceCacheKey(mesh)}:${budget}`;
  if (item?.modelWireLines && item.modelWireLinesKey === key) return item.modelWireLines;
  const lines = buildParsedModelWireLines(mesh, budget);
  if (item) {
    item.modelWireLines = lines;
    item.modelWireLinesKey = key;
  }
  return lines;
}

export function ensureParsedModelThickWireVertices(item, lineBudget = 4000, mesh = item?.modelData) {
  const budget = boundedBudget(lineBudget);
  const key = `thickWire:${meshResourceCacheKey(mesh)}:${budget}`;
  if (item?.modelThickWireVertices && item.modelThickWireVerticesKey === key) return item.modelThickWireVertices;
  const vertices = buildParsedModelThickWireVertices(ensureParsedModelWireLines(item, budget, mesh));
  if (item) {
    item.modelThickWireVertices = vertices;
    item.modelThickWireVerticesKey = key;
  }
  return vertices;
}

export function ensureParsedModelPerceptualWireVertices(item, lineBudget = 4000, mesh = item?.modelData) {
  const budget = boundedBudget(lineBudget);
  if (!item) return buildParsedModelPerceptualWireVertices(buildParsedModelPerceptualEdges(mesh), budget);
  const meshKey = `perceptual:${meshResourceCacheKey(mesh)}`;
  if (!item?.modelPerceptualEdges || item.modelPerceptualEdgesKey !== meshKey) {
    item.modelPerceptualEdges = buildParsedModelPerceptualEdges(mesh);
    item.modelPerceptualEdgesKey = meshKey;
    item.modelPerceptualWireVertices = null;
    item.modelPerceptualWireVerticesKey = "";
  }
  const key = `${meshKey}:${budget}`;
  if (item?.modelPerceptualWireVertices && item.modelPerceptualWireVerticesKey === key) {
    return item.modelPerceptualWireVertices;
  }
  const vertices = buildParsedModelPerceptualWireVertices(item?.modelPerceptualEdges, budget);
  if (item) {
    item.modelPerceptualWireVertices = vertices;
    item.modelPerceptualWireVerticesKey = key;
  }
  return vertices;
}

export function ensureP5ModelPointCloud(item, pointBudget = 4000) {
  const budget = boundedBudget(pointBudget);
  const vertices = Array.isArray(item?.model?.vertices) ? item.model.vertices : [];
  const key = `p5:${vertices.length}:${budget}`;
  if (item?.modelPointCloud && item.modelPointCloudKey === key) return item.modelPointCloud;
  const stride = Math.max(1, Math.ceil(vertices.length / budget));
  const count = Math.ceil(vertices.length / stride);
  const points = new Float32Array(count * 3);
  let write = 0;
  for (let index = 0; index < vertices.length && write + 2 < points.length; index += stride) {
    const vertex = vertices[index] || {};
    points[write++] = Number(vertex.x) || 0;
    points[write++] = Number(vertex.y) || 0;
    points[write++] = Number(vertex.z) || 0;
  }
  if (item) {
    item.modelPointCloud = points.subarray(0, write);
    item.modelPointCloudKey = key;
  }
  return item?.modelPointCloud || points.subarray(0, write);
}

export function buildParsedModelPointCloud(mesh, pointBudget = 4000) {
  const totalVertices = modelTriangleCount(mesh) * 3;
  if (!totalVertices) return new Float32Array(0);
  const budget = boundedBudget(pointBudget);
  const stride = Math.max(1, Math.ceil(totalVertices / budget));
  const count = Math.ceil(totalVertices / stride);
  const points = new Float32Array(count * 3);
  if (mesh?.positions instanceof Float32Array) {
    let write = 0;
    for (let vertexIndex = 0; vertexIndex < totalVertices && write + 2 < points.length; vertexIndex += stride) {
      const offset = vertexIndex * 3;
      points[write++] = mesh.positions[offset];
      points[write++] = mesh.positions[offset + 1];
      points[write++] = mesh.positions[offset + 2];
    }
    return points.subarray(0, write);
  }
  let seen = 0;
  let write = 0;
  forEachModelTriangle(mesh, (triangle) => {
    for (const vertex of triangle.vertices || []) {
      if (seen % stride === 0 && write + 2 < points.length) {
        points[write++] = Number(vertex[0]) || 0;
        points[write++] = Number(vertex[1]) || 0;
        points[write++] = Number(vertex[2]) || 0;
      }
      seen++;
    }
  });
  return points.subarray(0, write);
}

export function buildParsedModelWireLines(mesh, lineBudget = 4000) {
  const triangleCount = modelTriangleCount(mesh);
  if (!triangleCount) return new Float32Array(0);
  const totalEdges = triangleCount * 3;
  const budget = boundedBudget(lineBudget);
  const stride = Math.max(1, Math.ceil(totalEdges / budget));
  const count = Math.ceil(totalEdges / stride);
  const lines = new Float32Array(count * 6);
  if (mesh?.positions instanceof Float32Array) {
    let seen = 0;
    let write = 0;
    for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex++) {
      const offset = triangleIndex * 9;
      write = appendSampledWireLineFromPositions(lines, write, seen++, stride, mesh.positions, offset, offset + 3);
      write = appendSampledWireLineFromPositions(lines, write, seen++, stride, mesh.positions, offset + 3, offset + 6);
      write = appendSampledWireLineFromPositions(lines, write, seen++, stride, mesh.positions, offset + 6, offset);
    }
    return lines.subarray(0, write);
  }
  let seen = 0;
  let write = 0;
  forEachModelTriangle(mesh, (triangle) => {
    const vertices = triangle.vertices || [];
    write = appendSampledWireLine(lines, write, seen++, stride, vertices[0], vertices[1]);
    write = appendSampledWireLine(lines, write, seen++, stride, vertices[1], vertices[2]);
    write = appendSampledWireLine(lines, write, seen++, stride, vertices[2], vertices[0]);
  });
  return lines.subarray(0, write);
}

function appendSampledWireLineFromPositions(lines, write, seen, stride, positions, start, end) {
  if (seen % stride !== 0 || write + 5 >= lines.length) return write;
  lines[write++] = positions[start];
  lines[write++] = positions[start + 1];
  lines[write++] = positions[start + 2];
  lines[write++] = positions[end];
  lines[write++] = positions[end + 1];
  lines[write++] = positions[end + 2];
  return write;
}

// One logical edge is stored once as:
// start.xyz, end.xyz, firstFaceNormal.xyz, secondFaceNormal.xyz, boundary.
// The two face normals allow the GPU to reveal view-dependent silhouettes;
// adjacency removes the duplicate triangle edges that make ordinary STL
// wireframes look like triangulation rather than object structure.
export function buildParsedModelPerceptualEdges(mesh) {
  const triangleCount = modelTriangleCount(mesh);
  if (!triangleCount) return new Float32Array(0);
  const epsilon = modelVertexMergeEpsilon(mesh);
  const edges = new Map();
  forEachModelTriangle(mesh, (triangle) => {
    const vertices = triangle.vertices || [];
    if (vertices.length < 3) return;
    const normal = normalizeModelVector(triangle.normal || modelTriangleNormal(vertices));
    appendPerceptualEdge(edges, vertices[0], vertices[1], normal, epsilon);
    appendPerceptualEdge(edges, vertices[1], vertices[2], normal, epsilon);
    appendPerceptualEdge(edges, vertices[2], vertices[0], normal, epsilon);
  });
  const data = new Float32Array(edges.size * 13);
  let write = 0;
  for (const edge of edges.values()) {
    const firstNormal = edge.normals[0] || [0, 0, 1];
    const secondNormal = edge.normals[1] || firstNormal;
    const boundary = edge.normals.length === 1 || edge.normals.length > 2 ? 1 : 0;
    for (const value of [...edge.start, ...edge.end, ...firstNormal, ...secondNormal, boundary]) {
      data[write++] = Number(value) || 0;
    }
  }
  return data.subarray(0, write);
}

function buildParsedModelThickWireVertices(lines) {
  if (!lines?.length) return new Float32Array(0);
  const lineCount = Math.floor(lines.length / 6);
  const vertices = new Float32Array(lineCount * 6 * 8);
  let write = 0;
  for (let index = 0; index + 5 < lines.length; index += 6) {
    const values = Array.from(lines.subarray(index, index + 6));
    write = appendThickWireVertex(vertices, write, ...values, -1, 0);
    write = appendThickWireVertex(vertices, write, ...values, 1, 0);
    write = appendThickWireVertex(vertices, write, ...values, -1, 1);
    write = appendThickWireVertex(vertices, write, ...values, -1, 1);
    write = appendThickWireVertex(vertices, write, ...values, 1, 0);
    write = appendThickWireVertex(vertices, write, ...values, 1, 1);
  }
  return vertices.subarray(0, write);
}

function buildParsedModelPerceptualWireVertices(edges, lineBudget = 4000) {
  const edgeStride = 13;
  const edgeCount = Math.floor((edges?.length || 0) / edgeStride);
  if (!edgeCount) return new Float32Array(0);
  const stride = Math.max(1, Math.ceil(edgeCount / boundedBudget(lineBudget)));
  const sampledCount = Math.ceil(edgeCount / stride);
  const vertexStride = 15;
  const vertices = new Float32Array(sampledCount * 6 * vertexStride);
  let write = 0;
  for (let edgeIndex = 0; edgeIndex < edgeCount; edgeIndex += stride) {
    const offset = edgeIndex * edgeStride;
    const edge = edges.subarray(offset, offset + edgeStride);
    write = appendPerceptualWireVertex(vertices, write, edge, -1, 0);
    write = appendPerceptualWireVertex(vertices, write, edge, 1, 0);
    write = appendPerceptualWireVertex(vertices, write, edge, -1, 1);
    write = appendPerceptualWireVertex(vertices, write, edge, -1, 1);
    write = appendPerceptualWireVertex(vertices, write, edge, 1, 0);
    write = appendPerceptualWireVertex(vertices, write, edge, 1, 1);
  }
  return vertices.subarray(0, write);
}

function appendPerceptualWireVertex(vertices, write, edge, side, along) {
  for (let index = 0; index < 13; index++) vertices[write++] = Number(edge[index]) || 0;
  vertices[write++] = side;
  vertices[write++] = along;
  return write;
}

function appendPerceptualEdge(edges, a = [0, 0, 0], b = [0, 0, 0], normal = [0, 0, 1], epsilon = 0.000001) {
  const aKey = modelVertexKey(a, epsilon);
  const bKey = modelVertexKey(b, epsilon);
  if (aKey === bKey) return;
  const forward = aKey < bKey;
  const key = forward ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
  const edge = edges.get(key) || {
    start: (forward ? a : b).slice(0, 3).map((value) => Number(value) || 0),
    end: (forward ? b : a).slice(0, 3).map((value) => Number(value) || 0),
    normals: [],
  };
  edge.normals.push(normal);
  edges.set(key, edge);
}

function modelVertexMergeEpsilon(mesh) {
  const min = mesh?.bounds?.min;
  const max = mesh?.bounds?.max;
  const extent = Array.isArray(min) && Array.isArray(max)
    ? Math.max(...[0, 1, 2].map((axis) => Math.abs((Number(max[axis]) || 0) - (Number(min[axis]) || 0))))
    : 1;
  return Math.max(0.0000001, extent * 0.000001);
}

function modelVertexKey(vertex = [0, 0, 0], epsilon = 0.000001) {
  return vertex.slice(0, 3).map((value) => Math.round((Number(value) || 0) / epsilon)).join(",");
}

function appendThickWireVertex(vertices, write, ax, ay, az, bx, by, bz, side, along) {
  for (const value of [ax, ay, az, bx, by, bz, side, along]) vertices[write++] = value;
  return write;
}

function appendSampledWireLine(lines, write, seen, stride, a = [0, 0, 0], b = [0, 0, 0]) {
  if (seen % stride !== 0 || write + 5 >= lines.length) return write;
  for (const value of [...a.slice(0, 3), ...b.slice(0, 3)]) lines[write++] = Number(value) || 0;
  return write;
}

function drawParsedTriangles(target, mesh) {
  target.beginShape(TRIANGLES);
  forEachModelTriangle(mesh, (triangle) => {
    const normal = triangle.normal || [0, 0, 1];
    target.normal?.(normal[0], normal[1], normal[2]);
    for (const vertex of triangle.vertices || []) target.vertex(vertex[0], vertex[1], vertex[2]);
  });
  target.endShape();
}

function createGeometryVector(x = 0, y = 0, z = 0) {
  const Vector = globalThis.p5?.Vector;
  if (typeof Vector === "function") return new Vector(Number(x) || 0, Number(y) || 0, Number(z) || 0);
  if (typeof globalThis.createVector === "function") return globalThis.createVector(Number(x) || 0, Number(y) || 0, Number(z) || 0);
  return { x: Number(x) || 0, y: Number(y) || 0, z: Number(z) || 0 };
}

function stableGeometryId(id = "") {
  let hash = 2166136261;
  const text = String(id || "model");
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function boundedBudget(value) {
  return Math.max(128, Math.min(75000, Math.round(Number(value) || 4000)));
}
