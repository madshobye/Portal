import { defineNode, NODE_IMPLEMENTATION_KINDS } from "../../node-engine/node-definition.js";
import { MeshType } from "../mesh-types.js";

const MIN_CELLS = 1;
const MAX_CELLS = 256;

export const PlanarGridMeshNode = defineNode({
  id: "core.scene3d.planar-grid-mesh",
  name: "Planar Grid Mesh",
  version: "0.1.0",
  description: "Produces a retained canonical triangle mesh that can feed any ordinary Mesh, Object, Scene, or specialized geometry consumer.",
  implementation: NODE_IMPLEMENTATION_KINDS.DATA,
  inlets: {
    columns: {
      type: "number",
      defaultValue: 24,
      allowedRange: [MIN_CELLS, MAX_CELLS],
      clamp: true,
      editor: { type: "slider", step: 1 },
    },
    rows: {
      type: "number",
      defaultValue: 24,
      allowedRange: [MIN_CELLS, MAX_CELLS],
      clamp: true,
      editor: { type: "slider", step: 1 },
    },
    width: {
      type: "number",
      defaultValue: 2,
      allowedRange: [0.001, 10000],
      clamp: true,
      editor: { type: "slider", step: 0.01 },
    },
    depth: {
      type: "number",
      defaultValue: 2,
      allowedRange: [0.001, 10000],
      clamp: true,
      editor: { type: "slider", step: 0.01 },
    },
    axis: {
      type: { type: "enum", values: ["xz", "xy", "yz"] },
      defaultValue: "xz",
      editor: { type: "select" },
    },
  },
  outlets: { mesh: { type: MeshType } },
  execution: {
    trigger: "input-change",
    domain: "main",
    pure: true,
    asynchronous: false,
  },
  capabilities: [
    "scene-3d",
    "mesh-source",
    "geometry-provider",
    "procedural-mesh",
    "graph-placeable",
  ],
  presentation: {
    catalogs: ["graph", "mesh", "scene-3d"],
    placeableOn: ["node-graph"],
  },
  process: planarGridMeshNodeProcess,
});

export function planarGridMeshNodeProcess(inputs = {}, { state = {}, output = null } = {}) {
  const mesh = retainPlanarGridMesh(state, inputs);
  const result = output || state.output || (state.output = { mesh: null });
  result.mesh = mesh;
  return result;
}

// Canonical procedural mesh nodes and specialized lowering adapters share this
// owner. Resource identity therefore changes only when geometry changes, not
// when a native renderer updates camera, material, animation, or other settings.
export function retainPlanarGridMesh(state = {}, options = {}) {
  const normalized = normalizePlanarGridOptions(options);
  const signature = planarGridMeshSignature(normalized);
  if (state.signature !== signature || !state.mesh) {
    state.signature = signature;
    state.mesh = createPlanarGridMesh(normalized);
  }
  return state.mesh;
}

export function createPlanarGridMesh(options = {}) {
  const { columns, rows, width, depth, axis } = normalizePlanarGridOptions(options);
  const vertexColumns = columns + 1;
  const vertexRows = rows + 1;
  const vertexPositions = new Float32Array(vertexColumns * vertexRows * 3);
  const triangleIndices = new Uint32Array(columns * rows * 6);
  const halfWidth = width * 0.5;
  const halfDepth = depth * 0.5;
  let vertexOffset = 0;
  for (let row = 0; row <= rows; row += 1) {
    const v = row / rows;
    const acrossDepth = (v - 0.5) * depth;
    for (let column = 0; column <= columns; column += 1) {
      const u = column / columns;
      const acrossWidth = (u - 0.5) * width;
      const position = planarGridPosition(axis, acrossWidth, acrossDepth);
      vertexPositions[vertexOffset++] = position[0];
      vertexPositions[vertexOffset++] = position[1];
      vertexPositions[vertexOffset++] = position[2];
    }
  }
  let indexOffset = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = row * vertexColumns + column;
      const b = a + 1;
      const d = a + vertexColumns;
      const c = d + 1;
      triangleIndices[indexOffset++] = a;
      triangleIndices[indexOffset++] = axis === "xy" ? b : d;
      triangleIndices[indexOffset++] = axis === "xy" ? d : b;
      triangleIndices[indexOffset++] = b;
      triangleIndices[indexOffset++] = axis === "xy" ? c : d;
      triangleIndices[indexOffset++] = axis === "xy" ? d : c;
    }
  }
  const bounds = planarGridBounds(axis, halfWidth, halfDepth);
  return Object.freeze({
    kind: "mesh",
    representation: "indexed",
    vertexPositions,
    triangleIndices,
    triangleCount: columns * rows * 2,
    bounds,
    sourceBounds: bounds,
    metadata: Object.freeze({
      generator: PlanarGridMeshNode.id,
      columns,
      rows,
      width,
      depth,
      axis,
    }),
  });
}

export function planarGridMeshSignature(options = {}) {
  const normalized = normalizePlanarGridOptions(options);
  return `${normalized.columns}:${normalized.rows}:${normalized.width}:${normalized.depth}:${normalized.axis}`;
}

export function normalizePlanarGridOptions(options = {}) {
  return {
    columns: boundedCells(options.columns),
    rows: boundedCells(options.rows),
    width: positiveExtent(options.width),
    depth: positiveExtent(options.depth),
    axis: ["xz", "xy", "yz"].includes(options.axis) ? options.axis : "xz",
  };
}

function boundedCells(value) {
  const number = Number(value);
  return Math.max(
    MIN_CELLS,
    Math.min(MAX_CELLS, Math.round(Number.isFinite(number) ? number : 24)),
  );
}

function positiveExtent(value) {
  const number = Number(value);
  return Math.max(0.001, Math.min(10000, Number.isFinite(number) ? number : 2));
}

function planarGridPosition(axis, acrossWidth, acrossDepth) {
  if (axis === "xy") return [acrossWidth, acrossDepth, 0];
  if (axis === "yz") return [0, acrossDepth, acrossWidth];
  return [acrossWidth, 0, acrossDepth];
}

function planarGridBounds(axis, halfWidth, halfDepth) {
  if (axis === "xy") {
    return Object.freeze({
      min: Object.freeze([-halfWidth, -halfDepth, 0]),
      max: Object.freeze([halfWidth, halfDepth, 0]),
    });
  }
  if (axis === "yz") {
    return Object.freeze({
      min: Object.freeze([0, -halfDepth, -halfWidth]),
      max: Object.freeze([0, halfDepth, halfWidth]),
    });
  }
  return Object.freeze({
    min: Object.freeze([-halfWidth, 0, -halfDepth]),
    max: Object.freeze([halfWidth, 0, halfDepth]),
  });
}
