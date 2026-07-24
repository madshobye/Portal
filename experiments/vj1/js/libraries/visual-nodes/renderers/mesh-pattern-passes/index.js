import {
  defineNode,
  NODE_EDIT_ACTIVATION,
  NODE_EXECUTION_CLASSES,
  NODE_IMPLEMENTATION_KINDS,
  NODE_PART_KINDS,
} from "../../../node-engine/node-definition.js";
import {
  TopologyProviderType,
  VisualMaterialProviderType,
} from "../../shared/specialized-compound-types.js";
import {
  MESH_PATTERN_FILL_FRAGMENT_SHADER,
  MESH_PATTERN_FILL_VERTEX_SHADER,
  MESH_PATTERN_WIRE_FRAGMENT_SHADER,
  MESH_PATTERN_WIRE_VERTEX_SHADER,
} from "../../generators/mesh-patterns/shaders.js";

export const MeshPatternFillToImageNode = meshPatternRenderNode({
  id: "core.visual.mesh-pattern-fill-to-image",
  name: "Mesh Pattern Fill to Image",
  providerId: "mesh-pattern-fill-pass",
  kernel: "mesh-pattern-fill",
  nativeRenderer: "output/specialized:meshPatternFill",
  shaders: [
    shaderPart("mesh-pattern-fill-vertex", "2D Mesh Patterns fill vertex shader", "vertex", "mesh-pattern-fill", MESH_PATTERN_FILL_VERTEX_SHADER),
    shaderPart("mesh-pattern-fill-fragment", "2D Mesh Patterns fill fragment shader", "fragment", "mesh-pattern-fill", MESH_PATTERN_FILL_FRAGMENT_SHADER),
  ],
  description: "Lowers a mesh-pattern topology and fill material into the retained fill GPU kernel.",
});

export const MeshPatternWireToImageNode = meshPatternRenderNode({
  id: "core.visual.mesh-pattern-wire-to-image",
  name: "Mesh Pattern Wire to Image",
  providerId: "mesh-pattern-wire-pass",
  kernel: "mesh-pattern-wire",
  nativeRenderer: "output/specialized:meshPatternWire",
  shaders: [
    shaderPart("mesh-pattern-wire-vertex", "2D Mesh Patterns wire vertex shader", "vertex", "mesh-pattern-wire", MESH_PATTERN_WIRE_VERTEX_SHADER),
    shaderPart("mesh-pattern-wire-fragment", "2D Mesh Patterns wire fragment shader", "fragment", "mesh-pattern-wire", MESH_PATTERN_WIRE_FRAGMENT_SHADER),
  ],
  description: "Lowers a mesh-pattern topology and wire material into the retained expanded-line GPU kernel.",
});

function meshPatternRenderNode({ id, name, providerId, kernel, nativeRenderer, shaders, description }) {
  return defineNode({
    id,
    name,
    version: "0.1.0",
    description,
    implementation: {
      kind: NODE_IMPLEMENTATION_KINDS.NATIVE,
      compiler: "vj1.visual.specialized-compound",
      kernel,
    },
    inlets: {
      topology: { type: TopologyProviderType, required: true },
      material: { type: VisualMaterialProviderType, required: true },
      target: { type: "texture", optional: true },
    },
    parameters: {
      providerId: { type: "string", defaultValue: providerId },
      enabled: { type: "boolean", defaultValue: true },
      drawMode: {
        type: { type: "enum", values: ["fill", "wire", "fill + wire"] },
        defaultValue: "fill + wire",
      },
      amount: { type: "number", defaultValue: 1, allowedRange: [0, 1], clamp: true },
      renderQuality: { type: "number", defaultValue: 0.5, allowedRange: [0, 1], clamp: true },
    },
    outlets: { texture: { type: "texture" } },
    execution: {
      trigger: "frame",
      domain: "gpu",
      stateful: true,
      asynchronous: false,
      workload: NODE_EXECUTION_CLASSES.LIVE_FRAME,
      roi: { mode: "local", mapping: "projective-2d" },
    },
    authoring: {
      activation: NODE_EDIT_ACTIVATION.READ_ONLY,
      reason: "The node is an explicit compiler boundary for retained context-bound topology buffers; connected topology, material shaders, and controls remain editable.",
    },
    capabilities: [
      "render-operation",
      "retained-render-target",
      "mesh-pattern",
      "mesh-pattern-render-kernel",
      "specialized-visual-stage",
      "graph-placeable",
      "compiled-only",
    ],
    presentation: {
      catalogs: ["node-graph", "mesh-pattern", "render", "specialized-visual"],
      placeableOn: ["native-visual-graph"],
      previewOutput: "texture",
    },
    metadata: {
      nativeKernel: kernel,
      nativeRenderer,
      nodeOwnedNativeModule: true,
      allocationStable: true,
      nativeArtifactRequirements: {
        moduleExports: [],
        shaders: shaders.map((part) => part.id),
      },
    },
    parts: shaders,
  });
}

function shaderPart(id, name, stage, program, source) {
  return {
    id,
    name,
    kind: NODE_PART_KINDS.SHADER,
    language: "glsl",
    stage,
    program,
    editable: true,
    source,
  };
}
