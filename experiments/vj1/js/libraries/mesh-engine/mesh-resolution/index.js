import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";
import { listType, numberType, recordType } from "../../node-engine/node-types.js";
import { attachLegacyTriangleView, MeshType, modelTriangleCount } from "../mesh-types.js";
import { buildMeshoptimizerLods, indexedMeshToTriangleSoup } from "../meshoptimizer-simplifier.js";

export const MODEL_LOD_TRIANGLE_LEVELS = Object.freeze([
  250000,
  160000,
  80000,
  50000,
  25000,
  12000,
  6000,
]);
// Geometry detail is a visual control, not an unrestricted simplifier target.
// Keep both ends useful across every draw mode: the low end must retain enough
// topology for coherent outlines, while the high end must not make a filled
// surface needlessly expensive. Values from 0–1 preserve the established
// 6k–80k response for saved projects. The extended 1–2 range is reserved for
// dense meshes that visibly benefit from up to 250k triangles. Surface and
// outline deliberately share this range and the same selected LOD.
const MIN_DISPLAY_TRIANGLES = 6000;
const STANDARD_DISPLAY_TRIANGLES = 80000;
const MAX_DISPLAY_TRIANGLES = 250000;

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
  moduleBindings: {
    MODEL_LOD_TRIANGLE_LEVELS,
    attachLegacyTriangleView,
    modelTriangleCount,
    buildMeshoptimizerLods,
    indexedMeshToTriangleSoup,
  },
  capabilities: ["mesh-processing", "mesh-resolution", "worker-safe", "graph-placeable"],
  presentation: { catalogs: ["graph", "mesh"], placeableOn: ["node-graph"], previewOutput: "mesh" },
  parts: [
    {
      id: "mesh-resolution-policy",
      name: "Mesh resolution algorithm",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      exports: [
        "buildAutomaticModelLods",
        "selectModelLod",
        "modelGeometryTriangleBudget",
        "modelLodTargetTriangles",
      ],
      source: [
        `const MIN_DISPLAY_TRIANGLES = ${MIN_DISPLAY_TRIANGLES};
const STANDARD_DISPLAY_TRIANGLES = ${STANDARD_DISPLAY_TRIANGLES};
const MAX_DISPLAY_TRIANGLES = ${MAX_DISPLAY_TRIANGLES};`,
        buildAutomaticModelLods,
        simplifyMeshByQuadricError,
        selectModelLod,
        modelGeometryTriangleBudget,
        modelLodTargetTriangles,
      ].map((fn) => fn.toString()).join("\n\n"),
    },
    {
      id: "mesh-resolution-process",
      name: "Mesh resolution process entry",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      export: "meshResolutionNodeProcess",
      entry: "process",
      dependsOn: ["mesh-resolution-policy"],
      source: meshResolutionNodeProcess.toString(),
    },
  ],
  process: meshResolutionNodeProcess,
});

export function meshResolutionNodeProcess({ mesh, mode, targetTriangles } = {}) {
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
}

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

// Authored geometry detail is deliberately logarithmic. Equal slider travel
// therefore produces a useful visual change across both small and very dense
// meshes instead of spending most of the control range near the maximum.
export function modelGeometryTriangleBudget(detail = 0.5) {
  const normalized = Math.max(0, Math.min(2, Number(detail) || 0));
  if (normalized <= 1) {
    return Math.round(
      MIN_DISPLAY_TRIANGLES *
      Math.pow(STANDARD_DISPLAY_TRIANGLES / MIN_DISPLAY_TRIANGLES, normalized)
    );
  }
  return Math.round(
    STANDARD_DISPLAY_TRIANGLES *
    Math.pow(
      MAX_DISPLAY_TRIANGLES / STANDARD_DISPLAY_TRIANGLES,
      normalized - 1,
    )
  );
}

export function modelLodTargetTriangles({
  width = 1,
  height = 1,
  renderMode = "surface",
  geometryDetail = 0.5,
  wireDetail = 0.25,
} = {}) {
  const pixels = Math.max(1, Number(width) || 1) * Math.max(1, Number(height) || 1);
  const constructionWire = renderMode === "wireframe" || renderMode === "surfaceWire";
  let authoredBudget = modelGeometryTriangleBudget(geometryDetail);
  if (constructionWire) {
    // Wire detail may request a coarser complete mesh, but it can never exceed
    // the common Geometry detail cap. This preserves coherent connected lines.
    authoredBudget = Math.min(
      authoredBudget,
      modelGeometryTriangleBudget(wireDetail),
    );
  }
  // Pixel demand can reduce unnecessary geometry for a small ROI, but never
  // raise it above the authored cap. Outline and surface intentionally share
  // this mesh LOD; edgeBudget only controls extracted outline edges.
  const rasterDemand = Math.max(
    MIN_DISPLAY_TRIANGLES,
    Math.min(MAX_DISPLAY_TRIANGLES, Math.round(pixels / 6)),
  );
  return Math.min(authoredBudget, rasterDemand);
}
