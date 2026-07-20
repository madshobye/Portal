import { manualSurfaceTextureLimit } from "../domain/render-resolution.js?v=adaptive-component-demand-29";
import {
  componentRenderInstanceKey,
  componentSourceView,
  sharedComponentRenderRequests,
} from "./component-render-layout.js?v=canvas-global-resolution-1";
import {
  createRenderRequest,
  frameSize,
  sourceRenderDemand,
  SURFACE_DEMAND_OVERSCAN,
} from "./render-geometry.js?v=adaptive-component-demand-29";
import { createSurfaceCompositionEngine } from "../libraries/composition-engine/surface-composition/index.js";

// Direct render-host bridge: the node owns the route algorithm while the
// renderer supplies its established geometry policies directly. This closure
// is compiled once and adds no node-runtime work to the frame loop.
export const planSurfaceRoutes = createSurfaceCompositionEngine({
  manualSurfaceTextureLimit,
  componentRenderInstanceKey,
  componentSourceView,
  sharedComponentRenderRequests,
  createRenderRequest,
  sourceRenderDemand,
  surfaceDemandOverscan: SURFACE_DEMAND_OVERSCAN,
});

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
