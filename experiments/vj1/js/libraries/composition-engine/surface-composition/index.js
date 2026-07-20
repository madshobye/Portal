import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";

export function createSurfaceCompositionEngine({
  manualSurfaceTextureLimit,
  componentRenderInstanceKey,
  componentSourceView,
  sharedComponentRenderRequests,
  createRenderRequest,
  sourceRenderDemand,
  surfaceDemandOverscan = 1,
} = {}) {
  return function planSurfaceComposition({
    state = {},
    mapperSurfaces = new Map(),
    componentById = new Map(),
    recordingFrameById = new Map(),
    viewport = {},
    pixelScale = 1,
    renderIdentityPrefix = "",
    surfaceProgram = null,
    resolveRouteSourceNode = () => null,
  } = {}) {
    const routes = [];
    const metrics = { candidates: 0, culled: 0, visible: 0, componentRasterPixels: 0 };
    const manualSurfaceLimit = manualSurfaceTextureLimit(state.render || {}, pixelScale);
    const storedSurfaces = Array.isArray(surfaceProgram) ? surfaceProgram : (state.surfaces || []);
    for (const storedSurface of storedSurfaces) {
      if (!storedSurface.enabled) continue;
      metrics.candidates++;
      const sourceNode = resolveRouteSourceNode(storedSurface);
      if (!sourceNode) continue;
      const surface = {
        ...storedSurface,
        sourceNodeId: sourceNode.id,
        componentId: sourceNode.componentId,
        outputFrameId: sourceNode.outputFrameId,
      };
      const mapped = mapperSurfaces.get(surface.id);
      const component = componentById.get(surface.componentId);
      if (!mapped?.mapperSurface || !component) continue;
      const sourceView = componentSourceView(
        state.render,
        component,
        surface,
        state.recordingFrames,
        recordingFrameById
      );
      const maxSurfaceSize = manualSurfaceLimit || { width: 8192, height: 8192 };
      const demand = sourceRenderDemand({
        ...sourceView,
        maxSurfaceSize,
        corners: mapped.mapperSurface.corners,
        viewport,
        pixelScale,
        overscan: Number(state.render?.sampling?.surfaceOverscan) || surfaceDemandOverscan,
        preserveFullFootprint: mapped.direct,
      });
      if (!demand) {
        metrics.culled++;
        continue;
      }
      routes.push({ surface, mapped, component, sourceView, demand });
    }

    // Recording frames are views into their parent Canvas. Sharing the parent
    // request here is intentional: it avoids duplicate render allocations.
    const componentRequests = sharedComponentRenderRequests(routes, renderIdentityPrefix);
    for (const route of routes) {
      const renderInstanceKey = componentRenderInstanceKey(route.component, route.surface.id);
      const scale = componentRequests.get(renderInstanceKey)?.demandScale || route.demand.rasterScale;
      route.componentRequest = componentRequests.get(renderInstanceKey);
      route.surfaceRequest = createRenderRequest("surface", route.demand.surfaceSize, {
        surfaceId: route.surface.id,
        timingId: route.surface.id,
        logicalWidth: route.demand.sampleRect.width,
        logicalHeight: route.demand.sampleRect.height,
        demandScale: scale,
      });
    }
    metrics.visible = routes.length;
    for (const request of componentRequests.values()) metrics.componentRasterPixels += request.width * request.height;
    return { routes, metrics };
  };
}

export const SurfaceCompositionNode = defineNode({
  id: "core.composition.surface-routes",
  name: "Surface Composition",
  version: "0.1.0",
  description: "Plans visible output routes, shared component requests, and surface render demand.",
  implementation: NODE_IMPLEMENTATION_KINDS.NATIVE,
  inlets: { state: { type: "any", required: true }, viewport: { type: "any", optional: true } },
  outlets: { routes: { type: "any" }, metrics: { type: "any" } },
  execution: { trigger: "manual", domain: "main", pure: true },
  parts: [{
    id: "surface-composition-planner",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    name: "Surface composition planner",
    editable: false,
    metadata: { compilerLocked: true, reason: "host render-demand dependencies" },
    source: createSurfaceCompositionEngine.toString(),
  }],
  capabilities: ["output-composition", "surface-routing", "render-demand"],
  process: (inputs, context = {}) => {
    if (typeof context.plan !== "function") throw new Error("SURFACE_COMPOSITION_ADAPTER_REQUIRED");
    return context.plan(inputs);
  },
});
