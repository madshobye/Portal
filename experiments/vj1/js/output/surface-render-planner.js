import { surfaceTextureCeiling } from "../domain/render-resolution.js?v=adaptive-component-demand-projector-resolution-ceilings-1";
import {
  componentRenderInstanceKey,
  componentRootTransformRegion,
  componentSourceView,
  sharedComponentRenderRequests,
} from "./component-render-layout.js?v=pixel-density-4";
import {
  createRenderRequest,
  frameSize,
  sourceRenderDemand,
  SURFACE_DEMAND_OVERSCAN,
} from "./render-geometry.js?v=output-viewport-roi-1";
import { visibleSurfaceUvRect } from "../libraries/mapping-engine/mapping-engine/index.js?v=output-viewport-roi-1";
import { createSurfaceCompositionEngine } from "../libraries/composition-engine/surface-composition/index.js?v=output-viewport-roi-1";

// Direct render-host bridge: the node owns the route algorithm while the
// renderer supplies its established geometry policies directly. This closure
// is compiled once and adds no node-runtime work to the frame loop.
export const planSurfaceRoutes = createSurfaceCompositionEngine({
  surfaceTextureCeiling,
  componentRenderInstanceKey,
  componentSourceView,
  componentRootTransformRegion,
  sharedComponentRenderRequests,
  createRenderRequest,
  sourceRenderDemand,
  visibleSurfaceUvRect,
  surfaceDemandOverscan: SURFACE_DEMAND_OVERSCAN,
  componentRegionSafe: (component) => component?.regionSafe === true,
  componentFrameFanoutSafe: (component) => component?.frameFanoutSafe !== false,
});

// Direct output routes are backplanes, not projection overlays. Draw a route
// spanning several outputs first, then output-specific direct routes, and
// finally authored mapped Surfaces. The stable source index preserves user
// ordering within each layer and requires no extra render target or pass.
export function orderedSurfaceProgram(surfaces = []) {
  return (surfaces || []).map((surface, index) => ({ surface, index })).sort((a, b) => {
    const aDirect = a.surface?.destination?.type === "direct";
    const bDirect = b.surface?.destination?.type === "direct";
    if (aDirect !== bDirect) return aDirect ? -1 : 1;
    if (aDirect) {
      const spanDifference = (b.surface.destination?.outputIds?.length || 0)
        - (a.surface.destination?.outputIds?.length || 0);
      if (spanDifference) return spanDifference;
    }
    return a.index - b.index;
  }).map(({ surface }) => surface);
}

export function stableSurfaceRenderRequest(render = {}, meta = {}) {
  const frame = frameSize(render);
  return createRenderRequest("surface", {
    width: Math.max(1, Math.round(frame.width)),
    height: Math.max(1, Math.round(frame.height)),
  }, {
    ...meta,
    timingId: meta.timingId || meta.surfaceId || "",
    renderIdentity: meta.renderIdentity ?? meta.instanceId ?? "",
  });
}
