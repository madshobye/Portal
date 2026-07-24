import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";
import { fitSourceUvToTargetUv } from "../../render-engine/fit-geometry/index.js?v=fit-geometry-1";

// Surface guides are route geometry, not a canvas overlay. The node converts
// authored Scene-relative Surface rectangles into the exact UV space sampled by a Surface;
// the Mapping engine then projects those paths through the Surface homography.
// This keeps the guide attached to the same fit/crop path as the image without
// allocating a texture or adding a render pass.
export function sceneSurfaceGuideNodeProcess({
  surfaces = [],
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
  const paths = (surfaces || [])
    // Output Surfaces are useful authored guides here, but they never define
    // this monitor's world or resolution. They are converted from the same
    // relative Scene space as user Surfaces and projected only as geometry.
    .map((surface) => {
      const x0 = ((Number(surface.x) || 0) * logicalWidth - sample.x) / sample.width;
      const y0 = ((Number(surface.y) || 0) * logicalHeight - sample.y) / sample.height;
      const x1 = (((Number(surface.x) || 0) + (Number(surface.width) || 0)) * logicalWidth - sample.x) / sample.width;
      const y1 = (((Number(surface.y) || 0) + (Number(surface.height) || 0)) * logicalHeight - sample.y) / sample.height;
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
  return fitSourceUvToTargetUv(point, sourceAspect, targetAspect, fit);
}

export const SceneSurfaceGuideNode = defineNode({
  id: "core.composition.scene-surface-guides",
  name: "Scene Surface Guides",
  version: "0.1.0",
  description: "Projects authored Scene Surface geometry through the same crop, fit, and route as its source image.",
  implementation: NODE_IMPLEMENTATION_KINDS.NATIVE,
  inlets: {
    surfaces: { type: "any", required: true },
    logicalSize: { type: "any", required: true },
    sampleRect: { type: "any", optional: true },
    sourceAspect: { type: "number", required: true },
    targetAspect: { type: "number", required: true },
    projectionFit: { type: "string", optional: true, defaultValue: "cover" },
  },
  outlets: { paths: { type: "any" } },
  execution: { trigger: "manual", domain: "main", pure: true },
  capabilities: ["surface-guides", "relative-geometry", "projection-aware", "zero-buffer"],
  presentation: { catalogs: ["node-graph", "mapping"], placeableOn: ["presentation-graph"], previewOutput: "paths" },
  parts: [{
    id: "scene-surface-guide-projection",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    name: "Scene Surface guide projection",
    editable: true,
    module: import.meta.url,
    export: "sceneSurfaceGuideNodeProcess",
    source: [fitSourceUvToTargetUv, sceneSurfaceGuideNodeProcess, sourceUvToSurfaceUv].map((value) => value.toString()).join("\n\n"),
  }],
  process: sceneSurfaceGuideNodeProcess,
});
