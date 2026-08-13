import { NodeRegistry } from "../../node-engine/node-definition.js";
import { defineNodeGroup } from "../../node-engine/node-group.js";
import { createNodeInstance } from "../../node-engine/node-group.js";
import { optionalType } from "../../node-engine/node-types.js";
import { ImageResizeNode, RasterImageType } from "../../image-engine/image-resize/index.js";
import { Detect3dFormatNode } from "../detect-3d-format/index.js";
import { MeshRenderNode } from "../mesh-render/index.js";
import { MeshType } from "../mesh-types.js";
import { MeshResolutionNode } from "../mesh-resolution/index.js";
import { ObjParserNode } from "../obj-parser/index.js";
import { Parse3dObjectGroup } from "../parse-3d-object/index.js";
import { Prepare3dAssetGroup } from "../prepare-3d-asset/index.js";
import { StlParserNode } from "../stl-parser/index.js";
import {
  createVisualRenderProcessContext,
  updateVisualRenderProcessContext,
} from "../../render-engine/render-process-context.js";

// Persisted media-thumbnail cache identity. Bump this whenever model preview
// geometry, framing, or shading changes so projects cannot retain an image
// produced by an older renderer indefinitely.
export const MODEL_THUMBNAIL_PIPELINE_VERSION = "topology-v2";

export const Convert3dFileToImageGroup = defineNodeGroup({
  id: "core.mesh.convert-3d-file-to-image",
  name: "Convert 3D File to Image",
  version: "0.1.0",
  description: "Prepares and renders a 3D file using live or bounded-thumbnail quality policies.",
  executionModel: "native-composite",
  authoring: {
    activation: "recompile",
    reason: "Its profile-dependent graph is inspectable until conditional graph execution is supported.",
  },
  inlets: {
    source: { type: "any", required: true },
    name: { type: "string", optional: true, defaultValue: "" },
    format: { type: { type: "enum", values: ["", "stl", "obj"] }, optional: true, defaultValue: "" },
    rasterImage: { type: optionalType(RasterImageType), optional: true },
  },
  parameters: {
    profile: { type: { type: "enum", values: ["live", "thumbnail"] }, defaultValue: "live", editor: { type: "select" } },
    resolution: { type: { type: "enum", values: ["source", "automatic", "single"] }, defaultValue: "automatic", editor: { type: "select" } },
    targetTriangles: { type: "number", defaultValue: 25000, allowedRange: [256, 120000], clamp: true },
    previewTriangles: { type: "number", defaultValue: 600, allowedRange: [1, 10000], clamp: true },
    width: { type: "number", defaultValue: 100, allowedRange: [1, 16384], clamp: true },
    height: { type: "number", defaultValue: 100, allowedRange: [1, 16384], clamp: true },
    fit: { type: { type: "enum", values: ["contain", "cover", "stretch"] }, defaultValue: "contain" },
    renderMode: { type: { type: "enum", values: ["surface", "points", "wireframe", "surfaceWire", "outline", "surfaceOutline", "xrayOutline"] }, defaultValue: "surface" },
  },
  outlets: {
    mesh: { type: optionalType(MeshType) },
    image: { type: optionalType("any") },
    renderResult: { type: "any" },
    format: { type: { type: "enum", values: ["stl", "obj"] } },
  },
  execution: { trigger: "input-change", domain: "main", stateful: true, asynchronous: true },
  capabilities: ["mesh-processing", "mesh-rendering", "produces-image", "expandable-group", "graph-placeable"],
  presentation: { catalogs: ["graph", "mesh", "image"], placeableOn: ["node-graph"], expandable: true, previewOutput: "image" },
  nodes: [
    { id: "prepare", type: Prepare3dAssetGroup.id, version: Prepare3dAssetGroup.version },
    { id: "render", type: MeshRenderNode.id, version: MeshRenderNode.version },
    { id: "resize", type: ImageResizeNode.id, version: ImageResizeNode.version },
  ],
  connections: [
    { from: "$in.source", to: "prepare.source" },
    { from: "prepare.mesh", to: "render.mesh" },
    { from: "render.result.image", to: "resize.image", when: { imageKind: "raster" } },
    { from: "resize.frame", to: "$out.image", when: { imageKind: "raster" } },
    { from: "render.result.image", to: "$out.image", when: { imageKind: "svg" } },
  ],
  publicInlets: { source: "prepare.source", name: "prepare.name", format: "prepare.format" },
  publicOutlets: { mesh: "prepare.mesh", image: ["render.result.image", "resize.frame"], format: "prepare.format" },
  program: convert3dFileToImageProgram,
});

async function convert3dFileToImageProgram(inputs = {}, { run, renderProcess = null }) {
  const thumbnail = inputs.profile === "thumbnail";
  const prepared = await run("prepare", {
    source: inputs.source,
    name: inputs.name,
    format: inputs.format,
  }, {
    // A sparse sample of STL faces is not a smaller surface: it is a cloud of
    // disconnected triangles and renders as shredded geometry. Parse the
    // source once and build one topology-preserving thumbnail LOD instead.
    // This remains bounded before SVG generation and is persisted by the
    // media-thumbnail service, so it is not repeated when the picker opens.
    parameters: {
      profile: "full",
      triangleLimit: inputs.previewTriangles || 600,
      resolution: thumbnail ? "single" : (inputs.resolution || "automatic"),
      targetTriangles: thumbnail ? (inputs.previewTriangles || 600) : (inputs.targetTriangles || 25000),
    },
  });
  const rendered = await run("render", {
    mesh: prepared.mesh,
  }, {
    ...(renderProcess ? { renderProcess } : {}),
    parameters: {
      backend: thumbnail ? "svg" : "webgl",
      renderMode: inputs.renderMode || "surface",
    },
  });
  const renderResult = rendered.result;
  let image = renderResult.image;
  if (inputs.rasterImage) {
    if (!thumbnail) {
      // Deliberate specialization boundary: the reusable CPU resize node is a
      // bounded utility, never an implicit live-frame fallback.
      throw new Error("IMAGE_RESIZE_LIVE_BACKEND_REQUIRED");
    }
    const resized = await run("resize", {
      image: inputs.rasterImage,
      transform: renderProcess?.contentTransform,
    }, {
      executionClass: "bounded",
      parameters: { width: inputs.width, height: inputs.height, fit: inputs.fit },
    });
    image = resized.frame;
  }
  return { mesh: prepared.mesh, image, renderResult, format: prepared.format };
}

export const Convert3dFileToImageRegistry = new NodeRegistry([
  Detect3dFormatNode,
  StlParserNode,
  ObjParserNode,
  Parse3dObjectGroup,
  MeshResolutionNode,
  Prepare3dAssetGroup,
  MeshRenderNode,
  ImageResizeNode,
  Convert3dFileToImageGroup,
]);

export async function convert3dFileToImage(inputs = {}) {
  const instance = createNodeInstance(Convert3dFileToImageGroup, {
    registry: Convert3dFileToImageRegistry,
    parameters: {
      profile: inputs.profile,
      resolution: inputs.resolution,
      targetTriangles: inputs.targetTriangles,
      previewTriangles: inputs.previewTriangles,
      width: inputs.width,
      height: inputs.height,
      fit: inputs.fit,
      renderMode: inputs.renderMode,
    },
  });
  try {
    const renderProcess = inputs.target
      ? updateVisualRenderProcessContext(createVisualRenderProcessContext(), {
          target: inputs.target,
          time: inputs.componentTime,
          request: inputs.renderRequest || inputs.viewport,
          view: inputs.viewport,
          contentTransform: inputs.contentTransform,
          cacheOwner: inputs.cacheOwner,
        })
      : null;
    return await instance.run({
      source: inputs.source,
      name: inputs.name,
      format: inputs.format,
      rasterImage: inputs.rasterImage,
    }, renderProcess ? { renderProcess } : {});
  } finally {
    instance.dispose();
  }
}

export async function createModelPreviewBlob(file) {
  const converted = await convert3dFileToImage({
    source: file,
    name: file?.relativePath || file?.webkitRelativePath || file?.name || "",
    profile: "thumbnail",
  });
  return new Blob([converted.image.data], { type: "image/svg+xml" });
}

export async function createModelPreviewUrl(file) {
  return URL.createObjectURL(await createModelPreviewBlob(file));
}
