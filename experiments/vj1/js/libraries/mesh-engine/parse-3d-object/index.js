import { NodeRegistry } from "../../node-engine/node-definition.js";
import { defineNodeGroup } from "../../node-engine/node-group.js";
import { Detect3dFormatNode } from "../detect-3d-format/index.js";
import { MeshType } from "../mesh-types.js";
import { ObjParserNode } from "../obj-parser/index.js";
import { StlParserNode } from "../stl-parser/index.js";

export const MeshParserNodeRegistry = new NodeRegistry([
  Detect3dFormatNode,
  StlParserNode,
  ObjParserNode,
]);

export const Parse3dObjectGroup = defineNodeGroup({
  id: "core.mesh.parse-3d-object",
  name: "Parse 3D Object",
  version: "0.1.0",
  description: "Detects STL or OBJ data and routes it through the corresponding owned parser node.",
  executionModel: "native-composite",
  authoring: {
    activation: "recompile",
    reason: "Its conditional graph is inspectable until conditional graph execution is supported.",
  },
  inlets: {
    source: { type: "any", required: true, description: "STL or OBJ source data." },
    name: { type: "string", optional: true, defaultValue: "", description: "Optional filename used for format detection." },
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
  },
  outlets: {
    mesh: { type: MeshType, description: "Parsed canonical mesh." },
    format: { type: { type: "enum", values: ["stl", "obj"] }, description: "Detected source format." },
  },
  execution: { trigger: "input-change", domain: "worker", pure: true, asynchronous: true },
  capabilities: ["mesh-parser", "format-routing", "expandable-group", "graph-placeable"],
  presentation: {
    catalogs: ["graph", "mesh"],
    placeableOn: ["node-graph"],
    expandable: true,
    previewOutput: "mesh",
  },
  nodes: [
    { id: "detect", type: Detect3dFormatNode.id, version: Detect3dFormatNode.version },
    { id: "stl", type: StlParserNode.id, version: StlParserNode.version },
    { id: "obj", type: ObjParserNode.id, version: ObjParserNode.version },
  ],
  connections: [
    { from: "$in.source", to: "detect.source" },
    { from: "detect.format", to: "stl.$enabled", when: { equals: "stl" } },
    { from: "detect.format", to: "obj.$enabled", when: { equals: "obj" } },
    { from: "stl.mesh", to: "$out.mesh", when: { format: "stl" } },
    { from: "obj.mesh", to: "$out.mesh", when: { format: "obj" } },
  ],
  publicInlets: { source: "detect.source", name: "detect.name", format: "detect.format" },
  publicOutlets: { mesh: ["stl.mesh", "obj.mesh"], format: "detect.format" },
  program: async ({ source, name = "", format = "", profile = "full", triangleLimit = 600 }, { run }) => {
    const detected = await run("detect", { source, name, format });
    const parsed = await run(detected.format, { source }, { parameters: { profile, triangleLimit } });
    return { mesh: parsed.mesh, format: detected.format };
  },
});
