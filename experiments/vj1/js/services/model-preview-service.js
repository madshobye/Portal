import { parseObjMesh, parseStlMesh } from "../output/specialized/model-parsers.js?v=model-preview-1";

const MAX_PREVIEW_TRIANGLES = 600;

// Model previews are deliberately CPU-only and short-lived. They reuse the
// renderer's pure file parsers, project a bounded triangle sample into SVG,
// and never allocate a p5/WebGL context or retain the source file contents.
export async function createModelPreviewUrl(file) {
  const name = String(file?.relativePath || file?.webkitRelativePath || file?.name || "");
  const mesh = /\.obj$/i.test(name)
    ? parseObjMesh(await file.text())
    : parseStlMesh(await file.arrayBuffer());
  const svg = modelPreviewSvg(mesh);
  return URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
}

export function modelPreviewSvg(mesh = {}) {
  const triangles = Array.isArray(mesh.triangles) ? mesh.triangles : [];
  if (!triangles.length) throw new Error("Model preview has no triangles");
  const stride = Math.max(1, Math.ceil(triangles.length / MAX_PREVIEW_TRIANGLES));
  const projected = [];
  for (let index = 0; index < triangles.length; index += stride) {
    const triangle = triangles[index];
    const points = (triangle.vertices || []).slice(0, 3).map(projectModelPoint);
    if (points.length !== 3) continue;
    const depth = points.reduce((sum, point) => sum + point[2], 0) / 3;
    const light = Math.max(0.18, Math.min(0.95,
      0.42 + (Number(triangle.normal?.[0]) || 0) * -0.18
        + (Number(triangle.normal?.[1]) || 0) * 0.28
        + (Number(triangle.normal?.[2]) || 0) * 0.16));
    projected.push({ points, depth, light });
  }
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
