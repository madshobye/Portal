import { modelTriangleNormal, normalizeModelVector } from "./model-geometry.js?v=model-geometry-fix-30";

export function drawPointCloud(target, points, wireColor = [245, 245, 245, 255]) {
  if (!points?.length) return;
  target.noFill();
  target.stroke(...wireColor);
  target.strokeWeight(2);
  target.beginShape(POINTS);
  for (let index = 0; index + 2 < points.length; index += 3) {
    target.vertex(points[index], points[index + 1], points[index + 2]);
  }
  target.endShape();
}

export function drawParsedModel(target, mesh, renderMode = "surface", surfaceColor = [220, 225, 220, 255], wireColor = [20, 20, 20, 220], wireThickness = 1) {
  if (renderMode === "points") {
    drawPointCloud(target, buildParsedModelPointCloud(mesh, 4000), wireColor);
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

export function ensureParsedModelGeometry(item) {
  if (item.modelGeometryFailed) return null;
  if (item.modelGeometry) return item.modelGeometry;
  const mesh = item.modelData;
  const Geometry = globalThis.p5?.Geometry;
  if (!mesh || typeof Geometry !== "function") return null;
  const geometry = new Geometry();
  geometry.gid = `vj1-stl-${stableGeometryId(item.id)}`;
  for (const triangle of mesh.triangles || []) {
    const base = geometry.vertices.length;
    const normal = normalizeModelVector(triangle.normal || modelTriangleNormal(triangle.vertices || []));
    for (const vertex of triangle.vertices || []) {
      geometry.vertices.push(createGeometryVector(vertex[0], vertex[1], vertex[2]));
      geometry.vertexNormals?.push?.(createGeometryVector(normal[0], normal[1], normal[2]));
    }
    geometry.faces.push([base, base + 1, base + 2]);
  }
  if (!geometry.vertices.length || !geometry.faces.length) return null;
  geometry._makeTriangleEdges?.();
  geometry._edgesToVertices?.();
  item.modelGeometry = geometry;
  return geometry;
}

export function ensureParsedModelPointCloud(item, pointBudget = 4000) {
  const budget = boundedBudget(pointBudget);
  const mesh = item?.modelData;
  const key = `stl:${mesh?.triangles?.length || 0}:${budget}`;
  if (item?.modelPointCloud && item.modelPointCloudKey === key) return item.modelPointCloud;
  const points = buildParsedModelPointCloud(mesh, budget);
  if (item) {
    item.modelPointCloud = points;
    item.modelPointCloudKey = key;
  }
  return points;
}

export function ensureParsedModelWireLines(item, lineBudget = 4000) {
  const budget = boundedBudget(lineBudget);
  const mesh = item?.modelData;
  const key = `wire:${mesh?.triangles?.length || 0}:${budget}`;
  if (item?.modelWireLines && item.modelWireLinesKey === key) return item.modelWireLines;
  const lines = buildParsedModelWireLines(mesh, budget);
  if (item) {
    item.modelWireLines = lines;
    item.modelWireLinesKey = key;
  }
  return lines;
}

export function ensureParsedModelThickWireVertices(item, lineBudget = 4000) {
  const budget = boundedBudget(lineBudget);
  const mesh = item?.modelData;
  const key = `thickWire:${mesh?.triangles?.length || 0}:${budget}`;
  if (item?.modelThickWireVertices && item.modelThickWireVerticesKey === key) return item.modelThickWireVertices;
  const vertices = buildParsedModelThickWireVertices(ensureParsedModelWireLines(item, budget));
  if (item) {
    item.modelThickWireVertices = vertices;
    item.modelThickWireVerticesKey = key;
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
  const triangles = Array.isArray(mesh?.triangles) ? mesh.triangles : [];
  const totalVertices = triangles.length * 3;
  if (!totalVertices) return new Float32Array(0);
  const budget = boundedBudget(pointBudget);
  const stride = Math.max(1, Math.ceil(totalVertices / budget));
  const count = Math.ceil(totalVertices / stride);
  const points = new Float32Array(count * 3);
  let seen = 0;
  let write = 0;
  for (const triangle of triangles) {
    for (const vertex of triangle.vertices || []) {
      if (seen % stride === 0 && write + 2 < points.length) {
        points[write++] = Number(vertex[0]) || 0;
        points[write++] = Number(vertex[1]) || 0;
        points[write++] = Number(vertex[2]) || 0;
      }
      seen++;
    }
  }
  return points.subarray(0, write);
}

export function buildParsedModelWireLines(mesh, lineBudget = 4000) {
  const triangles = Array.isArray(mesh?.triangles) ? mesh.triangles : [];
  if (!triangles.length) return new Float32Array(0);
  const totalEdges = triangles.length * 3;
  const budget = boundedBudget(lineBudget);
  const stride = Math.max(1, Math.ceil(totalEdges / budget));
  const count = Math.ceil(totalEdges / stride);
  const lines = new Float32Array(count * 6);
  let seen = 0;
  let write = 0;
  for (const triangle of triangles) {
    const vertices = triangle.vertices || [];
    write = appendSampledWireLine(lines, write, seen++, stride, vertices[0], vertices[1]);
    write = appendSampledWireLine(lines, write, seen++, stride, vertices[1], vertices[2]);
    write = appendSampledWireLine(lines, write, seen++, stride, vertices[2], vertices[0]);
  }
  return lines.subarray(0, write);
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
  for (const triangle of mesh.triangles || []) {
    const normal = triangle.normal || [0, 0, 1];
    target.normal?.(normal[0], normal[1], normal[2]);
    for (const vertex of triangle.vertices || []) target.vertex(vertex[0], vertex[1], vertex[2]);
  }
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
  return Math.max(128, Math.min(50000, Math.round(Number(value) || 4000)));
}
