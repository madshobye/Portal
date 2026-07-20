import { NodeRegistry } from "../../node-engine/node-definition.js";
import { createNodeInstance, defineNodeGroup } from "../../node-engine/node-group.js";
import { Detect3dFormatNode } from "../detect-3d-format/index.js";
import { MeshResolutionNode } from "../mesh-resolution/index.js";
import { MeshType } from "../mesh-types.js";
import { ObjParserNode } from "../obj-parser/index.js";
import { Parse3dObjectGroup } from "../parse-3d-object/index.js";
import { StlParserNode } from "../stl-parser/index.js";

export const Prepare3dAssetGroup = defineNodeGroup({
  id: "core.mesh.prepare-3d-asset",
  name: "Prepare 3D Asset",
  version: "0.1.0",
  description: "Parses a supported 3D file and optionally builds its reusable mesh resolution set.",
  inlets: {
    source: { type: "any", required: true },
    name: { type: "string", optional: true, defaultValue: "" },
    format: { type: { type: "enum", values: ["", "stl", "obj"] }, optional: true, defaultValue: "" },
  },
  parameters: {
    profile: {
      type: { type: "enum", values: ["full", "preview"] },
      defaultValue: "full",
      editor: { type: "select" },
    },
    triangleLimit: {
      type: "number",
      defaultValue: 600,
      allowedRange: [1, 10000],
      clamp: true,
    },
    resolution: {
      type: { type: "enum", values: ["source", "automatic", "single"] },
      defaultValue: "automatic",
      editor: { type: "select" },
    },
    targetTriangles: { type: "number", defaultValue: 25000, allowedRange: [256, 120000], clamp: true },
  },
  outlets: {
    mesh: { type: MeshType },
    format: { type: { type: "enum", values: ["stl", "obj"] } },
  },
  execution: { trigger: "input-change", domain: "worker", pure: true, asynchronous: true },
  capabilities: ["mesh-processing", "format-routing", "expandable-group", "graph-placeable"],
  presentation: { catalogs: ["graph", "mesh"], placeableOn: ["node-graph"], expandable: true, previewOutput: "mesh" },
  nodes: [
    { id: "parse", type: Parse3dObjectGroup.id, version: Parse3dObjectGroup.version },
    { id: "resolution", type: MeshResolutionNode.id, version: MeshResolutionNode.version },
  ],
  connections: [
    { from: "$in.source", to: "parse.source" },
    { from: "parse.mesh", to: "resolution.mesh", when: { resolution: ["automatic", "single"] } },
    { from: "resolution.mesh", to: "$out.mesh", when: { resolution: ["automatic", "single"] } },
    { from: "parse.mesh", to: "$out.mesh", when: { resolution: "source" } },
  ],
  publicInlets: { source: "parse.source", name: "parse.name", format: "parse.format" },
  publicOutlets: { mesh: ["parse.mesh", "resolution.mesh"], format: "parse.format" },
  program: prepare3dAssetProgram,
});

async function prepare3dAssetProgram({
  source, name = "", format = "", profile = "full", triangleLimit = 600,
  resolution = "automatic", targetTriangles = 25000,
} = {}, { run }) {
  const parsed = await run("parse", { source, name, format }, { parameters: { profile, triangleLimit } });
  if (resolution === "source") return parsed;
  const resolved = await run("resolution", { mesh: parsed.mesh }, {
    parameters: { mode: resolution, targetTriangles },
  });
  return { mesh: resolved.mesh, format: parsed.format };
}

export const Prepare3dAssetNodeTypes = Object.freeze([
  Detect3dFormatNode,
  StlParserNode,
  ObjParserNode,
  MeshResolutionNode,
]);

export const Prepare3dAssetNodeRegistry = new NodeRegistry([
  ...Prepare3dAssetNodeTypes,
  Parse3dObjectGroup,
  Prepare3dAssetGroup,
]);

// Workers and traditional callers invoke the same inspectable group program;
// there is no parallel parser or resolution implementation hidden here.
export async function prepare3dAsset(inputs = {}) {
  const instance = createNodeInstance(Prepare3dAssetGroup, {
    registry: Prepare3dAssetNodeRegistry,
    parameters: {
      profile: inputs.profile,
      triangleLimit: inputs.triangleLimit,
      resolution: inputs.resolution,
      targetTriangles: inputs.targetTriangles,
    },
  });
  try {
    return await instance.run(inputs);
  } finally {
    instance.dispose();
  }
}
