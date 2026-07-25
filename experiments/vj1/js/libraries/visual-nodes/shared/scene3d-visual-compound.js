import { defineNodeGroup } from "../../node-engine/node-group.js?v=explicit-group-compiler-public-group-ports-1";
import { defineVisualNodeContract } from "../../render-engine/visual-node-contract.js";
import { componentFromNodeDefinition } from "./visual-node-factory.js";

const SCENE_3D_VISUAL_CONTRACT = defineVisualNodeContract({
  transform: { domain: "content" },
  roi: {
    mode: "projective",
    coordinateSpace: "projective",
    inputMapping: "sub-frustum",
    pixelEquivalentToFullFrame: true,
  },
  allocation: { mode: "retained" },
  alpha: { input: "premultiplied", output: "premultiplied" },
});

export function defineScene3dVisualCompound(component, {
  nodes = [],
  connections = [],
  publicInlets = {},
  output = "render.texture",
  controlBindings = {},
  controlPresentation = {},
} = {}) {
  const base = component?.nodeDefinition;
  if (!base) throw new Error("SCENE_3D_VISUAL_COMPOUND_BASE_MISSING");
  const definition = defineNodeGroup({
    ...base,
    executionModel: "compiled-graph",
    compiler: { id: "vj1.scene-3d.direct-program", target: "scene-3d" },
    graphEditable: true,
    authoring: {
      activation: "recompile",
      reason: "The typed 3D graph compiles into direct retained mesh draws; the frame loop never interprets it.",
    },
    inlets: {
      ...(base.inlets || {}),
    },
    nodes,
    connections,
    publicInlets: {
      ...publicInlets,
    },
    publicOutlets: { texture: output },
    controlBindings,
    controlPresentation,
    capabilities: [
      ...new Set([
        ...(base.capabilities || []),
        "scene-3d-program",
        "multi-object-3d",
        "expandable-group",
        "compiled-fast-path",
      ]),
    ],
    presentation: {
      ...(base.presentation || {}),
      catalogs: [...new Set([...(base.presentation?.catalogs || []), "node-graph", "visual-source", "scene-3d"])],
      placeableOn: [...new Set([...(base.presentation?.placeableOn || []), "visual-graph", "node-graph"])],
      expandable: true,
      previewOutput: "texture",
    },
    metadata: {
      ...(base.metadata || {}),
      visualCompilerHook: {
        id: "vj1.visual.compound",
        contract: SCENE_3D_VISUAL_CONTRACT,
      },
      nativeRenderer: "",
      renderAuthority: "compiled-graph",
    },
    // The executable implementation belongs to the child nodes. Keeping a
    // former monolithic parent implementation here would expose editable code
    // that no longer participates in rendering.
    parts: [],
  });
  return componentFromNodeDefinition(component, definition, {
    renderAuthority: "compiled-graph",
  });
}
