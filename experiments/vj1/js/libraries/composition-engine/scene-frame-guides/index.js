import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";

// Frame guides are route geometry, not a canvas overlay. The node converts
// authored Scene-relative Frames into the exact UV space sampled by a Surface;
// the Mapping engine then projects those paths through the Surface homography.
// This keeps the guide attached to the same fit/crop path as the image without
// allocating a texture or adding a render pass.
export function sceneFrameGuideNodeProcess({
  frames = [],
  logicalSize = {},
  sampleRect = null,
  sourceAspect = 1,
  targetAspect = 1,
  projectionFit = "cover",
} = {}) {
  const logicalWidth = Math.max(1, Number(logicalSize.width) || 1);
  const logicalHeight = Math.max(1, Number(logicalSize.height) || 1);
  const sample = {
    x: Number(sampleRect?.x) || 0,
    y: Number(sampleRect?.y) || 0,
    width: Math.max(1, Number(sampleRect?.width) || logicalWidth),
    height: Math.max(1, Number(sampleRect?.height) || logicalHeight),
  };
  const paths = (frames || [])
    // Output Frames are useful authored guides here, but they never define
    // this monitor's world or resolution. They are converted from the same
    // relative Scene space as user Frames and projected only as geometry.
    .map((frame) => {
      const x0 = ((Number(frame.x) || 0) * logicalWidth - sample.x) / sample.width;
      const y0 = ((Number(frame.y) || 0) * logicalHeight - sample.y) / sample.height;
      const x1 = (((Number(frame.x) || 0) + (Number(frame.width) || 0)) * logicalWidth - sample.x) / sample.width;
      const y1 = (((Number(frame.y) || 0) + (Number(frame.height) || 0)) * logicalHeight - sample.y) / sample.height;
      return [
        sourceUvToSurfaceUv({ x: x0, y: y0 }, sourceAspect, targetAspect, projectionFit),
        sourceUvToSurfaceUv({ x: x1, y: y0 }, sourceAspect, targetAspect, projectionFit),
        sourceUvToSurfaceUv({ x: x1, y: y1 }, sourceAspect, targetAspect, projectionFit),
        sourceUvToSurfaceUv({ x: x0, y: y1 }, sourceAspect, targetAspect, projectionFit),
      ];
    });
  return { paths };
}

export function sourceUvToSurfaceUv(point = {}, sourceAspect = 1, targetAspect = 1, fit = "cover") {
  const source = Math.max(0.0001, Number(sourceAspect) || 1);
  const target = Math.max(0.0001, Number(targetAspect) || 1);
  let x = Number(point.x) || 0;
  let y = Number(point.y) || 0;
  // This is the inverse of the Mapping shader's projection-fit sampling. It
  // answers where a source-space point is presented on the Surface.
  if (fit === "cover") {
    if (source > target) x = 0.5 + (x - 0.5) * (source / target);
    else y = 0.5 + (y - 0.5) * (target / source);
  } else if (fit === "contain") {
    if (source > target) y = 0.5 + (y - 0.5) * (target / source);
    else x = 0.5 + (x - 0.5) * (source / target);
  }
  return { x, y };
}

export const SceneFrameGuideNode = defineNode({
  id: "core.composition.scene-frame-guides",
  name: "Scene Frame Guides",
  version: "0.1.0",
  description: "Projects authored Scene Frame geometry through the same crop, fit, and Surface route as its source image.",
  implementation: NODE_IMPLEMENTATION_KINDS.NATIVE,
  inlets: {
    frames: { type: "any", required: true },
    logicalSize: { type: "any", required: true },
    sampleRect: { type: "any", optional: true },
    sourceAspect: { type: "number", required: true },
    targetAspect: { type: "number", required: true },
    projectionFit: { type: "string", optional: true, defaultValue: "cover" },
  },
  outlets: { paths: { type: "any" } },
  execution: { trigger: "manual", domain: "main", pure: true },
  capabilities: ["frame-guides", "relative-geometry", "projection-aware", "zero-buffer"],
  presentation: { catalogs: ["node-graph", "mapping"], placeableOn: ["presentation-graph"], previewOutput: "paths" },
  parts: [{
    id: "scene-frame-guide-projection",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    name: "Scene Frame guide projection",
    editable: true,
    module: import.meta.url,
    export: "sceneFrameGuideNodeProcess",
    source: [sceneFrameGuideNodeProcess, sourceUvToSurfaceUv].map((value) => value.toString()).join("\n\n"),
  }],
  process: sceneFrameGuideNodeProcess,
});
