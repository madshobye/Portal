import { manualSurfaceTextureLimit } from "../domain/render-resolution.js?v=adaptive-component-demand-29";
import {
  componentRenderInstanceKey,
  componentSourceView,
  sharedComponentRenderRequests,
} from "./component-render-layout.js?v=instance-sync-60";
import {
  createRenderRequest,
  frameSize,
  sourceRenderDemand,
  SURFACE_DEMAND_OVERSCAN,
} from "./render-geometry.js?v=adaptive-component-demand-29";

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

export function planSurfaceRoutes({
  state = {},
  mapperSurfaces = new Map(),
  componentById = new Map(),
  recordingFrameById = new Map(),
  viewport = {},
  pixelScale = 1,
  renderIdentityPrefix = "",
  resolveRouteSourceNode = () => null,
} = {}) {
  const routes = [];
  const metrics = { candidates: 0, culled: 0, visible: 0, componentRasterPixels: 0 };
  const manualSurfaceLimit = manualSurfaceTextureLimit(state.render || {}, pixelScale);
  for (const storedSurface of state.surfaces || []) {
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
      overscan: Number(state.render?.sampling?.surfaceOverscan) || SURFACE_DEMAND_OVERSCAN,
      preserveFullFootprint: mapped.direct,
    });
    if (!demand) {
      metrics.culled++;
      continue;
    }
    routes.push({ surface, mapped, component, sourceView, demand });
  }

  // Recording frames are views into their parent Canvas. Share one parent
  // component request, then crop each route downstream.
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
  for (const request of componentRequests.values()) {
    metrics.componentRasterPixels += request.width * request.height;
  }
  return { routes, metrics };
}
