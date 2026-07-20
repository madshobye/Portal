import { NODE_PART_KINDS } from "../../../node-engine/node-definition.js";
import {
  generateMeshPatternTopology,
  meshPatternAlgorithmModuleSource,
  MESH_PATTERN_FAMILIES,
  meshPatternTopologySignature,
} from "./runtime.js";
import { meshPatternPalette, meshPatternPaletteModuleSource } from "./palette.js";
import {
  MESH_PATTERN_FILL_FRAGMENT_SHADER,
  MESH_PATTERN_FILL_VERTEX_SHADER,
  MESH_PATTERN_WIRE_FRAGMENT_SHADER,
  MESH_PATTERN_WIRE_VERTEX_SHADER,
} from "./shaders.js";

export function meshPatternNodeProcess(inputs = {}, context = {}) {
  if (typeof context.renderNativeVisualNode !== "function") throw new Error("MESH_PATTERN_NODE_RENDER_HOST_MISSING");
  return context.renderNativeVisualNode({ inputs, context });
}

export function meshPatternNodeModuleParts() {
  return [
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
      id: "mesh-pattern-palette-module",
      name: "2D Mesh Patterns palette algorithm",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      exports: ["meshPatternPalette"],
      source: meshPatternPaletteModuleSource(),
    },
    {
      id: "mesh-pattern-process",
      name: "2D Mesh Patterns process entry",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      export: "meshPatternNodeProcess",
      entry: "process",
      dependsOn: ["mesh-pattern-topology-module", "mesh-pattern-palette-module"],
      source: meshPatternNodeProcess.toString(),
    },
    {
      id: "mesh-pattern-fill-vertex",
      name: "2D Mesh Patterns fill vertex shader",
      kind: NODE_PART_KINDS.SHADER,
      language: "glsl",
      stage: "vertex",
      program: "mesh-pattern-fill",
      editable: true,
      source: MESH_PATTERN_FILL_VERTEX_SHADER,
    },
    {
      id: "mesh-pattern-fill-fragment",
      name: "2D Mesh Patterns fill fragment shader",
      kind: NODE_PART_KINDS.SHADER,
      language: "glsl",
      stage: "fragment",
      program: "mesh-pattern-fill",
      editable: true,
      source: MESH_PATTERN_FILL_FRAGMENT_SHADER,
    },
    {
      id: "mesh-pattern-wire-vertex",
      name: "2D Mesh Patterns wire vertex shader",
      kind: NODE_PART_KINDS.SHADER,
      language: "glsl",
      stage: "vertex",
      program: "mesh-pattern-wire",
      editable: true,
      source: MESH_PATTERN_WIRE_VERTEX_SHADER,
    },
    {
      id: "mesh-pattern-wire-fragment",
      name: "2D Mesh Patterns wire fragment shader",
      kind: NODE_PART_KINDS.SHADER,
      language: "glsl",
      stage: "fragment",
      program: "mesh-pattern-wire",
      editable: true,
      source: MESH_PATTERN_WIRE_FRAGMENT_SHADER,
    },
  ];
}

export const MeshPatternNodeModuleExports = Object.freeze({
  MESH_PATTERN_FAMILIES,
  meshPatternTopologySignature,
  generateMeshPatternTopology,
  meshPatternPalette,
});
