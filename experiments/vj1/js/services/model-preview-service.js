import { forEachModelTriangle, modelTriangleCount } from "../output/specialized/model-lod.js?v=model-qem-4";

const MAX_PREVIEW_TRIANGLES = 600;

// Model previews are deliberately CPU-only and short-lived. They never enter
// the renderer's QEM/LOD pipeline: browsing a library must not simplify every
// STL/OBJ just to draw a small card. The preview parser retains only a bounded
// reservoir of faces and releases the source text/buffer after producing SVG.
export async function createModelPreviewUrl(file) {
  const name = String(file?.relativePath || file?.webkitRelativePath || file?.name || "");
  const mesh = /\.obj$/i.test(name)
    ? parseObjPreviewMesh(await file.text())
    : parseStlPreviewMesh(await file.arrayBuffer());
  const svg = modelPreviewSvg(mesh);
  return URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
}

export function parseObjPreviewMesh(text = "", limit = MAX_PREVIEW_TRIANGLES) {
  const source = String(text || "");
  const vertices = [];
  const samples = [];
  const bounds = emptyBounds();
  let triangleSerial = 0;
  let randomState = 0x9e3779b9;
  let cursor = 0;
  while (cursor < source.length) {
    const newline = source.indexOf("\n", cursor);
    const line = source.slice(cursor, newline < 0 ? source.length : newline).trim();
    cursor = newline < 0 ? source.length : newline + 1;
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    const type = parts.shift();
    if (type === "v" && parts.length >= 3) {
      const vertex = [0, 1, 2].map((axis) => Number(parts[axis]) || 0);
      vertices.push(...vertex);
      includeBounds(bounds, vertex);
      continue;
    }
    if (type !== "f" || parts.length < 3) continue;
    const vertexCount = vertices.length / 3;
    const face = parts.map((token) => resolveObjPreviewIndex(token.split("/", 1)[0], vertexCount));
    for (let index = 1; index + 1 < face.length; index++) {
      const triangle = [face[0], face[index], face[index + 1]];
      if (triangle.some((value) => value < 0 || value >= vertexCount) || new Set(triangle).size < 3) continue;
      randomState = xorshift32(randomState + triangleSerial + 1);
      reservoirTriangle(samples, triangle, triangleSerial++, limit, randomState);
    }
  }
  if (!vertices.length || !samples.length) throw new Error("OBJ contained no previewable polygon faces");
  return indexedPreviewMesh(vertices, samples, bounds);
}

export function parseStlPreviewMesh(buffer, limit = MAX_PREVIEW_TRIANGLES) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer?.buffer || buffer || []);
  if (bytes.byteLength < 15) throw new Error("STL file is empty");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declaredTriangles = bytes.byteLength >= 84 ? view.getUint32(80, true) : 0;
  if (declaredTriangles > 0 && 84 + declaredTriangles * 50 === bytes.byteLength) {
    const samples = [];
    const count = Math.min(limit, declaredTriangles);
    for (let sample = 0; sample < count; sample++) {
      const triangleIndex = Math.min(declaredTriangles - 1, Math.floor(sample * declaredTriangles / count));
      const offset = 84 + triangleIndex * 50 + 12;
      const triangle = [];
      for (let corner = 0; corner < 3; corner++) {
        const vertexOffset = offset + corner * 12;
        triangle.push([0, 1, 2].map((axis) => view.getFloat32(vertexOffset + axis * 4, true)));
      }
      samples.push(triangle);
    }
    return trianglePreviewMesh(samples);
  }
  return parseAsciiStlPreviewMesh(new TextDecoder("utf-8").decode(bytes), limit);
}

export function modelPreviewSvg(mesh = {}) {
  const triangleCount = modelTriangleCount(mesh);
  if (!triangleCount) throw new Error("Model preview has no triangles");
  const stride = Math.max(1, Math.ceil(triangleCount / MAX_PREVIEW_TRIANGLES));
  const projected = [];
  forEachModelTriangle(mesh, (triangle, index) => {
    if (index % stride) return;
    const points = (triangle.vertices || []).slice(0, 3).map(projectModelPoint);
    if (points.length !== 3) return;
    const depth = points.reduce((sum, point) => sum + point[2], 0) / 3;
    const light = Math.max(0.18, Math.min(0.95,
      0.42 + (Number(triangle.normal?.[0]) || 0) * -0.18
        + (Number(triangle.normal?.[1]) || 0) * 0.28
        + (Number(triangle.normal?.[2]) || 0) * 0.16));
    projected.push({ points, depth, light });
  });
  projected.sort((a, b) => a.depth - b.depth);
  const coordinates = projected.flatMap((triangle) => triangle.points);
  const minX = Math.min(...coordinates.map((point) => point[0]));
  const maxX = Math.max(...coordinates.map((point) => point[0]));
  const minY = Math.min(...coordinates.map((point) => point[1]));
  const maxY = Math.max(...coordinates.map((point) => point[1]));
  const span = Math.max(maxX - minX, maxY - minY, 0.0001);
  const scale = 82 / span;
  const centerX = (minX + maxX) * 0.5;
  const centerY = (minY + maxY) * 0.5;
  const polygons = projected.map(({ points, light }) => {
    const value = Math.round(light * 255);
    const normalized = points.map(([x, y]) => `${((x - centerX) * scale + 50).toFixed(2)},${((y - centerY) * scale + 50).toFixed(2)}`).join(" ");
    return `<polygon points="${normalized}" fill="rgb(${value} ${value} ${value})" stroke="rgba(255,255,255,.16)" stroke-width=".35"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img"><rect width="100" height="100" fill="#050505"/><g>${polygons}</g></svg>`;
}

function projectModelPoint(vertex = []) {
  const x = Number(vertex[0]) || 0;
  const y = Number(vertex[1]) || 0;
  const z = Number(vertex[2]) || 0;
  return [x * 0.86 + z * 0.5, -y * 0.9 + z * 0.28, z - x * 0.15];
}

function parseAsciiStlPreviewMesh(text, limit) {
  const samples = [];
  const pending = [];
  let triangleSerial = 0;
  let randomState = 0x85ebca6b;
  const vertexRe = /vertex\s+([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:e[-+]?\d+)?)/gi;
  let match;
  while ((match = vertexRe.exec(text))) {
    pending.push([Number(match[1]), Number(match[2]), Number(match[3])]);
    if (pending.length < 3) continue;
    randomState = xorshift32(randomState + triangleSerial + 1);
    reservoirTriangle(samples, pending.splice(0, 3), triangleSerial++, limit, randomState);
  }
  if (!samples.length) throw new Error("STL contained no previewable triangles");
  return trianglePreviewMesh(samples);
}

function indexedPreviewMesh(vertexValues, triangles, sourceBounds) {
  const raw = triangles.map((indices) => indices.map((index) => {
    const offset = index * 3;
    return [vertexValues[offset], vertexValues[offset + 1], vertexValues[offset + 2]];
  }));
  return trianglePreviewMesh(raw, sourceBounds);
}

function trianglePreviewMesh(triangles, suppliedBounds = null) {
  const bounds = suppliedBounds || emptyBounds();
  if (!suppliedBounds) for (const triangle of triangles) for (const vertex of triangle) includeBounds(bounds, vertex);
  const center = bounds.min.map((value, axis) => (value + bounds.max[axis]) * 0.5);
  const extent = Math.max(...bounds.max.map((value, axis) => Math.abs(value - bounds.min[axis])), 0.0001);
  const scale = 100 / extent;
  const positions = new Float32Array(triangles.length * 9);
  const faceNormals = new Float32Array(triangles.length * 3);
  let positionOffset = 0;
  let normalOffset = 0;
  for (const triangle of triangles) {
    const normalized = triangle.map((vertex) => vertex.map((value, axis) => (value - center[axis]) * scale));
    for (const vertex of normalized) for (const value of vertex) positions[positionOffset++] = value;
    const normal = triangleNormal(normalized);
    for (const value of normal) faceNormals[normalOffset++] = value;
  }
  return { positions, faceNormals, triangleCount: triangles.length };
}

function triangleNormal(vertices) {
  const [a, b, c] = vertices;
  const ab = b.map((value, axis) => value - a[axis]);
  const ac = c.map((value, axis) => value - a[axis]);
  const normal = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const length = Math.hypot(...normal) || 1;
  return normal.map((value) => value / length);
}

function reservoirTriangle(samples, triangle, serial, limit, randomState) {
  const capacity = Math.max(1, Math.floor(Number(limit) || MAX_PREVIEW_TRIANGLES));
  if (samples.length < capacity) {
    samples.push(triangle);
    return;
  }
  const slot = randomState % (serial + 1);
  if (slot < capacity) samples[slot] = triangle;
}

function resolveObjPreviewIndex(token, length) {
  const value = Number.parseInt(token, 10);
  if (!Number.isFinite(value) || value === 0) return -1;
  return value < 0 ? length + value : value - 1;
}

function xorshift32(value) {
  let result = value >>> 0;
  result ^= result << 13;
  result ^= result >>> 17;
  result ^= result << 5;
  return result >>> 0;
}

function emptyBounds() {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
}

function includeBounds(bounds, vertex) {
  for (let axis = 0; axis < 3; axis++) {
    bounds.min[axis] = Math.min(bounds.min[axis], vertex[axis]);
    bounds.max[axis] = Math.max(bounds.max[axis], vertex[axis]);
  }
}
