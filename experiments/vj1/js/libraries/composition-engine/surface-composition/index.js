import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";

export function createSurfaceCompositionEngine({
  surfaceTextureCeiling,
  componentRenderInstanceKey,
  componentSourceView,
  sharedComponentRenderRequests,
  createRenderRequest,
  sourceRenderDemand,
  surfaceDemandOverscan = 1,
  componentRegionSafe = () => false,
  componentFrameFanoutSafe = () => true,
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
    isComponentRegionSafe = componentRegionSafe,
    isComponentFrameFanoutSafe = componentFrameFanoutSafe,
  } = {}) {
    const routes = [];
    const metrics = { candidates: 0, culled: 0, visible: 0, componentRasterPixels: 0 };
    const textureCeiling = surfaceTextureCeiling(state.render || {});
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
      const maxSurfaceSize = textureCeiling || { width: 8192, height: 8192 };
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

    const initialRequests = sharedComponentRenderRequests(routes, renderIdentityPrefix);
    const regionalRouteIds = new Set();
    const candidatesByComponent = new Map();
    for (const route of routes) {
      if (route.component?.type !== "canvas" || !route.surface?.outputFrameId || !isComponentRegionSafe(route.component)) continue;
      const key = componentRenderInstanceKey(route.component, route.surface.id);
      const list = candidatesByComponent.get(key) || [];
      list.push(route);
      candidatesByComponent.set(key, list);
    }
    for (const [key, candidates] of candidatesByComponent) {
      if (routes.some((route) => componentRenderInstanceKey(route.component, route.surface.id) === key && !route.surface?.outputFrameId)) continue;
      // A regional request executes the Canvas graph once for every consuming
      // frame. That is cheap for synchronized graph branches, but it multiplies
      // independent component instances: the same placement would be rendered
      // again for each frame route. Keep the existing single Canvas raster in
      // that case. This preserves independent placement timing without adding
      // another texture or turning "async" into consumer-specific execution.
      if (candidates.length > 1 && !isComponentFrameFanoutSafe(candidates[0].component)) continue;
      const full = initialRequests.get(key);
      const regionalPixels = candidates.reduce((sum, route) => sum + route.demand.surfaceSize.width * route.demand.surfaceSize.height, 0);
      if (!full) continue;
      const needsRegionalDetail = candidates.some((route) => {
        const logical = route.sourceView.logicalSize;
        const rect = route.demand.sampleRect;
        const sampledWidth = full.width * rect.width / Math.max(1, logical.width);
        const sampledHeight = full.height * rect.height / Math.max(1, logical.height);
        return route.demand.surfaceSize.width > sampledWidth * 1.05 ||
          route.demand.surfaceSize.height > sampledHeight * 1.05;
      });
      // Regional rendering is also a quality path. A small frame mapped over
      // a large surface may require more pixels than the ordinary full Canvas
      // request, while still being dramatically cheaper than enlarging the
      // complete Canvas enough to give that crop equivalent detail.
      if (!needsRegionalDetail && regionalPixels * 1.15 >= full.width * full.height) continue;
      for (const route of candidates) regionalRouteIds.add(route.surface.id);
    }
    const componentRequests = sharedComponentRenderRequests(
      routes.filter((route) => !regionalRouteIds.has(route.surface.id)),
      renderIdentityPrefix
    );
    for (const route of routes) {
      const renderInstanceKey = componentRenderInstanceKey(route.component, route.surface.id);
      const regional = regionalRouteIds.has(route.surface.id);
      if (regional) {
        const logical = route.sourceView.logicalSize;
        const rect = route.demand.sampleRect;
        const uvRect = [rect.x / logical.width, rect.y / logical.height, rect.width / logical.width, rect.height / logical.height];
        route.componentRequest = createRenderRequest("canvas-region", route.demand.surfaceSize, {
          timingId: renderInstanceKey,
          renderIdentity: `${renderIdentityPrefix}${renderInstanceKey}:frame:${route.surface.outputFrameId}`,
          logicalWidth: route.demand.surfaceSize.width / Math.max(0.000001, uvRect[2]),
          logicalHeight: route.demand.surfaceSize.height / Math.max(0.000001, uvRect[3]),
          demandScale: route.demand.rasterScale,
          uvRect,
          regionView: true,
        });
      } else {
        route.componentRequest = componentRequests.get(renderInstanceKey);
      }
      const scale = route.componentRequest?.demandScale || route.demand.rasterScale;
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
    for (const route of routes) {
      if (regionalRouteIds.has(route.surface.id)) metrics.componentRasterPixels += route.componentRequest.width * route.componentRequest.height;
    }
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
