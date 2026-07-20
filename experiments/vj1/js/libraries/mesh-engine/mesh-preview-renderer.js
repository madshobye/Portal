import { forEachModelTriangle, modelTriangleCount } from "./mesh-types.js";

// Compatibility exports only. Parsing—including the bounded thumbnail policy—
// is owned by the editable parser nodes.
export { parseObjPreviewMesh } from "./obj-parser/index.js";
export { parseStlPreviewMesh } from "./stl-parser/index.js";

const MAX_PREVIEW_TRIANGLES = 600;

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
