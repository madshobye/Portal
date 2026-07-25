import {
  defineNode,
  NODE_IMPLEMENTATION_KINDS,
  NODE_PART_KINDS,
} from "../../../node-engine/node-definition.js";
import {
  generateMeshPatternTopology,
  meshPatternAlgorithmModuleSource,
  MESH_PATTERN_FAMILIES,
  meshPatternTopologySignature,
} from "../../generators/mesh-patterns/runtime.js";
import {
  createMeshCollection,
  MeshCollectionType,
} from "../../../mesh-engine/mesh-collection/index.js?v=mesh-collection-1";
import { TopologyProviderType } from "../../shared/visual-stage-types.js";

const TOPOLOGY_SETTING_IDS = Object.freeze([
  "pattern",
  "scale",
  "density",
  "irregularity",
  "rotation",
  "offsetX",
  "offsetY",
  "speed",
  "motion",
  "seed",
]);
const MAX_SHARED_MESH_PATTERN_TOPOLOGIES = 32;
const SHARED_MESH_PATTERN_TOPOLOGIES = new WeakMap();

export const MeshPatternTopologyProviderNode = defineNode({
  id: "core.visual.mesh-pattern-topology",
  name: "Mesh Pattern Topology",
  version: "0.1.0",
  description: "Owns the editable 2D mesh-pattern topology algorithm and publishes an aspect-dependent topology contract.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: {
    providerId: { type: "string", defaultValue: "mesh-pattern-topology" },
    settings: { type: "record", defaultValue: {} },
    pattern: { type: { type: "enum", values: [...MESH_PATTERN_FAMILIES] }, defaultValue: "cells" },
    scale: { type: "number", defaultValue: 8, allowedRange: [1, 40], clamp: true },
    density: { type: "number", defaultValue: 1, allowedRange: [0.25, 4], clamp: true },
    irregularity: { type: "number", defaultValue: 0.75, allowedRange: [0, 2], clamp: true },
    rotation: { type: "number", defaultValue: 0, allowedRange: [-3.14, 3.14], clamp: true },
    offsetX: { type: "number", defaultValue: 0, allowedRange: [-3, 3], clamp: true },
    offsetY: { type: "number", defaultValue: 0, allowedRange: [-3, 3], clamp: true },
    speed: { type: "number", defaultValue: 0, allowedRange: [0, 3], clamp: true },
    motion: { type: "number", defaultValue: 0.35, allowedRange: [0, 2], clamp: true },
    seed: { type: "number", defaultValue: 17, allowedRange: [0, 1000], clamp: true },
    aspect: { type: "number", defaultValue: 1, allowedRange: [0.2, 5], clamp: true },
  },
  parameters: {
    providerId: { type: "string", defaultValue: "mesh-pattern-topology" },
    enabled: { type: "boolean", defaultValue: true },
    settings: { type: "record", defaultValue: {} },
  },
  outlets: {
    topology: { type: TopologyProviderType },
    collection: { type: MeshCollectionType },
  },
  execution: { trigger: "input-change", domain: "main", pure: true, asynchronous: false },
  capabilities: [
    "topology-provider",
    "mesh-pattern",
    "mesh-source",
    "mesh-collection",
    "scene-3d",
    "retained-value-provider",
    "visual-stage",
    "graph-placeable",
  ],
  presentation: {
    catalogs: ["node-graph", "mesh-pattern", "topology", "mesh", "scene-3d", "visual-stage"],
    placeableOn: ["visual-graph", "node-graph", "native-visual-graph"],
  },
  parts: [
    {
      id: "mesh-pattern-topology-module",
      name: "2D Mesh Patterns topology engine",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      exports: ["MESH_PATTERN_FAMILIES", "meshPatternTopologySignature", "generateMeshPatternTopology"],
      source: meshPatternAlgorithmModuleSource(),
    },
    {
      id: "mesh-pattern-topology-provider-process",
      name: "Mesh Pattern Topology provider",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      export: "meshPatternTopologyProviderProcess",
      entry: "process",
      dependsOn: ["mesh-pattern-topology-module"],
      source: [
        "const MAX_SHARED_MESH_PATTERN_TOPOLOGIES = 32;\nconst SHARED_MESH_PATTERN_TOPOLOGIES = new WeakMap();",
        meshPatternTopologyProviderProcess,
        effectiveTopologySettings,
        retainSharedMeshPatternTopology,
        meshPatternTopologyToMeshCollection,
        meshPatternSlotMesh,
        appendLineRibbon,
        record,
      ].map(String).join("\n\n"),
    },
  ],
  moduleBindings: {
    TOPOLOGY_SETTING_IDS,
    createMeshCollection,
  },
  moduleExports: {
    MESH_PATTERN_FAMILIES,
    meshPatternTopologySignature,
    generateMeshPatternTopology,
  },
  process: meshPatternTopologyProviderProcess,
});

export function meshPatternTopologyProviderProcess(inputs = {}, { output = null, state = {}, renderRequest = null } = {}) {
  const settings = record(inputs.settings);
  const effectiveSettings = effectiveTopologySettings(
    inputs,
    settings,
    state.effectiveSettings || (state.effectiveSettings = {}),
  );
  const requestAspect = Number(renderRequest?.width) / Math.max(1, Number(renderRequest?.height) || 1);
  const aspect = Math.max(0.2, Math.min(5,
    Number.isFinite(requestAspect) && requestAspect > 0
      ? requestAspect
      : Number(inputs.aspect) || 1
  ));
  const signature = meshPatternTopologySignature(effectiveSettings, aspect);
  if (state.geometrySignature !== signature || !state.geometry || !state.collection) {
    const retained = retainSharedMeshPatternTopology(
      generateMeshPatternTopology,
      meshPatternTopologyToMeshCollection,
      signature,
      effectiveSettings,
      aspect,
    );
    state.geometrySignature = signature;
    state.geometry = retained.geometry;
    state.collection = retained.collection;
  }
  const result = output || state.output || (state.output = {
    topology: null,
    collection: null,
  });
  const topology = result.topology || (result.topology = {});
  topology.kind = "topology";
  topology.providerId = String(inputs.providerId || "mesh-pattern-topology");
  topology.resourceIdentity = topology.providerId;
  topology.resourceRevision = signature;
  topology.settings = settings;
  topology.enabled = inputs.enabled !== false;
  topology.geometry = state.geometry;
  topology.collection = state.collection;
  result.collection = state.collection;
  return result;
}

export function retainSharedMeshPatternTopology(
  generate,
  convert,
  signature,
  settings,
  aspect,
) {
  let byConverter = SHARED_MESH_PATTERN_TOPOLOGIES.get(generate);
  if (!byConverter) {
    byConverter = new WeakMap();
    SHARED_MESH_PATTERN_TOPOLOGIES.set(generate, byConverter);
  }
  let values = byConverter.get(convert);
  if (!values) {
    values = new Map();
    byConverter.set(convert, values);
  }
  let retained = values.get(signature);
  if (retained) {
    values.delete(signature);
    values.set(signature, retained);
    return retained;
  }
  const geometry = generate(settings, aspect);
  retained = Object.freeze({
    geometry,
    collection: convert(geometry),
  });
  values.set(signature, retained);
  while (values.size > MAX_SHARED_MESH_PATTERN_TOPOLOGIES) {
    values.delete(values.keys().next().value);
  }
  return retained;
}

function effectiveTopologySettings(inputs, settings, result) {
  for (const id of TOPOLOGY_SETTING_IDS) {
    const value = settings[id] === undefined ? inputs[id] : settings[id];
    if (value === undefined) delete result[id];
    else result[id] = value;
  }
  return result;
}

export function meshPatternTopologyToMeshCollection(topology = {}) {
  const slots = Array.from({ length: 4 }, () => []);
  const fill = topology.fillVertices instanceof Float32Array
    ? topology.fillVertices
    : new Float32Array();
  for (let offset = 0; offset + 8 < fill.length; offset += 9) {
    const slot = Math.max(0, Math.min(3, Math.round(Number(fill[offset + 2]) || 0)));
    const positions = slots[slot];
    for (let corner = 0; corner < 3; corner += 1) {
      const vertexOffset = offset + corner * 3;
      positions.push(fill[vertexOffset] - 0.5, 0.5 - fill[vertexOffset + 1], 0);
    }
  }
  if (!slots.some((positions) => positions.length)) {
    const lines = topology.lineSegments instanceof Float32Array
      ? topology.lineSegments
      : new Float32Array();
    for (let offset = 0; offset + 4 < lines.length; offset += 5) {
      const slot = Math.max(0, Math.min(3, Math.round(Number(lines[offset + 4]) || 0)));
      appendLineRibbon(
        slots[slot],
        lines[offset] - 0.5,
        0.5 - lines[offset + 1],
        lines[offset + 2] - 0.5,
        0.5 - lines[offset + 3],
      );
    }
  }
  const parts = slots.flatMap((positions, slot) => positions.length
    ? [{
        id: `palette-${slot}`,
        materialSlot: `palette-${slot}`,
        mesh: meshPatternSlotMesh(positions, topology.signature, slot),
      }]
    : []);
  if (!parts.length) throw new Error("MESH_PATTERN_TOPOLOGY_EMPTY");
  return createMeshCollection({
    id: `mesh-pattern:${String(topology.signature || "unknown")}`,
    parts,
    metadata: {
      family: String(topology.family || ""),
      topologySignature: String(topology.signature || ""),
      sourceNodeId: "core.visual.mesh-pattern-topology",
    },
  });
}

function meshPatternSlotMesh(values, signature, slot) {
  const positions = new Float32Array(values);
  const triangleCount = Math.floor(positions.length / 9);
  const faceNormals = new Float32Array(triangleCount * 3);
  for (let index = 0; index < triangleCount; index += 1) faceNormals[index * 3 + 2] = 1;
  return {
    positions,
    faceNormals,
    triangleCount,
    bounds: { min: [-0.5, -0.5, 0], max: [0.5, 0.5, 0] },
    sourceBounds: { min: [-0.5, -0.5, 0], max: [0.5, 0.5, 0] },
    resourceRevision: `${String(signature || "unknown")}:${slot}`,
    metadata: {
      topologySignature: String(signature || ""),
      materialSlot: `palette-${slot}`,
    },
  };
}

function appendLineRibbon(target, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy);
  if (length <= 0.000001) return;
  const width = 0.0015;
  const nx = -dy / length * width;
  const ny = dx / length * width;
  target.push(
    ax + nx, ay + ny, 0,
    ax - nx, ay - ny, 0,
    bx + nx, by + ny, 0,
    bx + nx, by + ny, 0,
    ax - nx, ay - ny, 0,
    bx - nx, by - ny, 0,
  );
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
