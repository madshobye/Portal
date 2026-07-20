import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";
import { listType, numberType, recordType } from "../../node-engine/node-types.js";
import { attachLegacyTriangleView, MeshType, modelTriangleCount } from "../mesh-types.js";
import { buildMeshoptimizerLods, indexedMeshToTriangleSoup } from "../meshoptimizer-simplifier.js";

export const MODEL_LOD_TRIANGLE_LEVELS = Object.freeze([120000, 80000, 50000, 25000, 12000, 6000, 3000]);

const MeshResolutionStatsType = recordType("mesh-resolution-stats", {
  sourceTriangles: numberType(),
  resultTriangles: numberType(),
  levels: listType("number"),
});

export const MeshResolutionNode = defineNode({
  id: "core.mesh.resolution",
  name: "Mesh Resolution",
  version: "0.1.0",
  description: "Builds automatic progressive mesh LODs or one target resolution using meshoptimizer QEM.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: { mesh: { type: MeshType, required: true } },
  parameters: {
    mode: {
      type: { type: "enum", values: ["automatic", "single"] },
      defaultValue: "automatic",
      editor: { type: "select" },
    },
    targetTriangles: {
      type: "number",
      defaultValue: 25000,
      allowedRange: [256, 120000],
      displayRange: [256, 120000],
      scale: "log",
      clamp: true,
      editor: { type: "slider", step: 1 },
    },
  },
  outlets: {
    mesh: { type: MeshType },
    statistics: { type: MeshResolutionStatsType },
  },
  execution: { trigger: "input-change", domain: "worker", pure: true, asynchronous: true },
  capabilities: ["mesh-processing", "mesh-resolution", "worker-safe", "graph-placeable"],
  presentation: { catalogs: ["graph", "mesh"], placeableOn: ["node-graph"], previewOutput: "mesh" },
  parts: [{
    id: "mesh-resolution-policy",
    name: "Mesh resolution algorithm",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    export: "buildAutomaticModelLods",
    source: [
      buildAutomaticModelLods,
      simplifyMeshByQuadricError,
      selectModelLod,
      modelLodTargetTriangles,
    ].map((fn) => fn.toString()).join("\n\n"),
  }],
  process: ({ mesh, mode, targetTriangles }) => {
    const sourceTriangles = modelTriangleCount(mesh);
    const result = mode === "single"
      ? attachLegacyTriangleView(buildMeshoptimizerLods(mesh, [targetTriangles])[0])
      : buildAutomaticModelLods(mesh);
    return {
      mesh: result,
      statistics: {
        sourceTriangles,
        resultTriangles: modelTriangleCount(result),
        levels: (result.lods || [result]).map(modelTriangleCount),
      },
    };
  },
});

export function buildAutomaticModelLods(mesh = {}, levels = MODEL_LOD_TRIANGLE_LEVELS) {
  const sourceTriangleCount = modelTriangleCount(mesh);
  if (!sourceTriangleCount) return attachLegacyTriangleView(mesh);
  const requested = Array.from(new Set(levels.map((value) => Math.max(256, Math.floor(Number(value) || 0)))))
    .filter((value) => value < sourceTriangleCount)
    .sort((a, b) => b - a);
  if (!requested.length) {
    const lod = { ...indexedMeshToTriangleSoup(mesh), sourceTriangleCount, lodLevel: 0 };
    const result = { ...lod, lods: [lod] };
    attachLegacyTriangleView(lod);
    return attachLegacyTriangleView(result);
  }
  const lods = buildMeshoptimizerLods(mesh, requested);
  lods.forEach((lod, index) => {
    lod.sourceTriangleCount = sourceTriangleCount;
    lod.lodLevel = index;
  });
  const result = { ...lods[0], lods };
  for (const lod of lods) attachLegacyTriangleView(lod);
  return attachLegacyTriangleView(result);
}

export function simplifyMeshByVertexClustering(mesh = {}, targetTriangles = 50000) {
  return buildMeshoptimizerLods(mesh, [targetTriangles])[0];
}

export function simplifyMeshByQuadricError(mesh = {}, targetTriangles = 50000) {
  return buildMeshoptimizerLods(mesh, [targetTriangles])[0];
}

export function selectModelLod(mesh = {}, targetTriangles = Infinity) {
  const lods = Array.isArray(mesh.lods) && mesh.lods.length ? mesh.lods : [mesh];
  const target = Number.isFinite(Number(targetTriangles)) ? Math.max(1, Number(targetTriangles)) : Infinity;
  let selected = lods[0];
  for (const lod of lods) {
    selected = lod;
    if (modelTriangleCount(lod) <= target) break;
  }
  return selected;
}

export function modelLodTargetTriangles({ width = 1, height = 1, renderMode = "surface", renderQuality = 0.5, edgeBudget = 20000, wireDetail = 0.25 } = {}) {
  const pixels = Math.max(1, Number(width) || 1) * Math.max(1, Number(height) || 1);
  const quality = 0.45 + Math.max(0, Math.min(1, Number(renderQuality) || 0)) * 1.1;
  const perceptualOutline = renderMode === "outline" || renderMode === "surfaceOutline" || renderMode === "xrayOutline";
  const constructionWire = renderMode === "wireframe" || renderMode === "surfaceWire";
  if (constructionWire) {
    // Intentional allocation-stable fast path: complete coherent wire LODs avoid
    // disconnected sampled-edge artifacts and are independent of resolution.
    const detail = Math.max(0, Math.min(1, Number(wireDetail) || 0));
    return Math.round(3000 + detail * 22000);
  }
  const pixelsPerTriangle = perceptualOutline ? 20 : 6;
  const rasterTarget = Math.max(12000, Math.min(120000, Math.round((pixels / pixelsPerTriangle) * quality)));
  if (!perceptualOutline) return rasterTarget;
  const completeEdgeTriangleBudget = Math.max(1000, Math.floor(
    Math.max(1000, Math.min(50000, Number(edgeBudget) || 20000)) / 1.6
  ));
  return Math.min(rasterTarget, completeEdgeTriangleBudget);
}
