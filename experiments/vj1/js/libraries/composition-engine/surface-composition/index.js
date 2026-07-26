import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";

export function createSurfaceCompositionEngine({
  surfaceTextureCeiling,
  componentRenderInstanceKey,
  componentSourceView,
  componentRootTransformRegion,
  sharedComponentRenderRequests,
  createRenderRequest,
  sourceRenderDemand,
  visibleSurfaceUvRect = () => null,
  surfaceDemandOverscan = 1,
  componentRegionSafe = () => false,
  componentFrameFanoutSafe = () => true,
} = {}) {
  const normalizedSceneUvRect = (route) => {
    const logical = route?.sourceView?.logicalSize;
    const rect = route?.demand?.sampleRect;
    if (!logical || !rect || !(logical.width > 0) || !(logical.height > 0)) return null;
    return [
      rect.x / logical.width,
      rect.y / logical.height,
      rect.width / logical.width,
      rect.height / logical.height,
    ];
  };

  const sharedSceneRegionPlan = (routes, maxSurfaceSize) => {
    if (!routes.length || routes.some((route) =>
      route.component?.type !== "scene" ||
      route.surface?.sceneCrop !== true ||
      route.transformRegion ||
      route.viewportRegion
    )) return null;
    const views = routes.map((route) => ({
      route,
      uvRect: normalizedSceneUvRect(route),
    }));
    if (views.some((view) => !view.uvRect)) return null;
    const left = Math.min(...views.map((view) => view.uvRect[0]));
    const top = Math.min(...views.map((view) => view.uvRect[1]));
    const right = Math.max(...views.map((view) => view.uvRect[0] + view.uvRect[2]));
    const bottom = Math.max(...views.map((view) => view.uvRect[1] + view.uvRect[3]));
    const uvRect = [left, top, right - left, bottom - top];
    if (!(uvRect[2] > 0) || !(uvRect[3] > 0)) return null;

    // Every recording frame describes how many output pixels its Scene crop
    // needs. Convert those demands to a virtual full-Scene pixel density, take
    // the strictest density once, then allocate only the union of the active
    // crops. The Scene graph executes once and every Surface samples its own
    // sub-view from that shared texture.
    const fullRasterWidth = Math.max(...views.map(({ route, uvRect: view }) =>
      route.demand.surfaceSize.width / Math.max(Number.EPSILON, view[2])
    ));
    const fullRasterHeight = Math.max(...views.map(({ route, uvRect: view }) =>
      route.demand.surfaceSize.height / Math.max(Number.EPSILON, view[3])
    ));
    const ceiling = maxSurfaceSize || { width: 8192, height: 8192 };
    const ceilPhysicalPixels = (value) => {
      const nearest = Math.round(value);
      return Math.abs(value - nearest) < 1e-6 ? nearest : Math.ceil(value);
    };
    const requestedWidth = Math.max(1, ceilPhysicalPixels(fullRasterWidth * uvRect[2]));
    const requestedHeight = Math.max(1, ceilPhysicalPixels(fullRasterHeight * uvRect[3]));
    const ceilingScale = Math.min(
      1,
      ceiling.width / requestedWidth,
      ceiling.height / requestedHeight,
    );
    const size = {
      width: Math.max(1, Math.floor(requestedWidth * ceilingScale)),
      height: Math.max(1, Math.floor(requestedHeight * ceilingScale)),
    };
    const presentationUvRects = new Map(views.map(({ route, uvRect: view }) => [
      route.surface.id,
      [
        (view[0] - uvRect[0]) / uvRect[2],
        (view[1] - uvRect[1]) / uvRect[3],
        view[2] / uvRect[2],
        view[3] / uvRect[3],
      ],
    ]));
    return {
      uvRect,
      size,
      presentationUvRects,
      demandScale: Math.max(...routes.map((route) => route.demand.rasterScale || 1)),
    };
  };

  return function planSurfaceComposition({
    state = {},
    mapperSurfaces = new Map(),
    componentById = new Map(),
    viewport = {},
    pixelScale = 1,
    transformDemandCorners = (corners) => corners,
    preserveDirectFootprint = true,
    allowViewportRegions = false,
    renderIdentityPrefix = "",
    surfaceProgram = null,
    resolveRouteSourceNode = () => null,
    isComponentRegionSafe = componentRegionSafe,
    isComponentFrameFanoutSafe = componentFrameFanoutSafe,
  } = {}) {
    const routes = [];
    const metrics = {
      candidates: 0,
      culled: 0,
      visible: 0,
      componentRasterPixels: 0,
      rootTransformDetailLimited: [],
    };
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
      };
      const mapped = mapperSurfaces.get(surface.id);
      const component = componentById.get(surface.componentId);
      if (!mapped?.mapperSurface || !component) continue;
      const sourceView = componentSourceView(state.render, component, surface);
      const regionSafe = isComponentRegionSafe(component);
      const authoredRootScale = Math.max(0.01, Math.abs(Number(component.transform?.scale) || 1));
      if (!regionSafe && authoredRootScale > 1.001 && !metrics.rootTransformDetailLimited.includes(component.id)) {
        metrics.rootTransformDetailLimited.push(component.id);
      }
      const maxSurfaceSize = textureCeiling || { width: 8192, height: 8192 };
      const demandCorners = transformDemandCorners(mapped.mapperSurface.corners, mapped, surface);
      const visibleUvRect = allowViewportRegions
        ? visibleSurfaceUvRect(demandCorners, viewport)
        : null;
      const demand = sourceRenderDemand({
        ...sourceView,
        maxSurfaceSize,
        corners: demandCorners,
        viewport,
        pixelScale,
        overscan: Number(state.render?.sampling?.surfaceOverscan) || surfaceDemandOverscan,
        preserveFullFootprint: mapped.direct && preserveDirectFootprint,
        projectionFit: surface.projectionFit,
        sourceFitActive: surface.sourceFitActive,
        sourceFit: surface.sourceFit,
        sourceAspect: surface.sourceAspect,
        visibleUvRect,
      });
      if (!demand) {
        metrics.culled++;
        continue;
      }
      const viewportRegion = regionSafe &&
        !surface.finalShaderChain?.length
        ? demand.viewportRegion
        : null;
      const transformRegion = regionSafe
        ? componentRootTransformRegion({
            logicalSize: sourceView.logicalSize,
            sampleRect: demand.sampleRect,
            targetSize: demand.surfaceSize,
            targetViewUv: viewportRegion?.surfaceViewUv,
            transform: component.transform,
            fit: surface.sourceFitActive ? surface.sourceFit : "stretch",
          })
        : null;
      routes.push({
        surface,
        mapped,
        component,
        sourceView,
        demand,
        transformRegion,
        viewportRegion,
        regionSafe,
      });
    }

    const requestableRoutes = routes.filter((route) => route.transformRegion?.empty !== true);
    const initialRequests = sharedComponentRenderRequests(requestableRoutes, renderIdentityPrefix);
    const regionalRouteIds = new Set();
    const sharedSceneRegions = new Map();
    const candidatesByComponent = new Map();
    for (const route of routes) {
      const transformedRoot = route.transformRegion && route.transformRegion.empty !== true;
      const sceneCrop = route.component?.type === "scene" && route.surface?.sceneCrop === true;
      const viewportRegion = !!route.viewportRegion;
      if ((!transformedRoot && !sceneCrop && !viewportRegion) || !route.regionSafe) continue;
      const key = componentRenderInstanceKey(route.component, route.surface.id);
      const list = candidatesByComponent.get(key) || [];
      list.push(route);
      candidatesByComponent.set(key, list);
    }
    for (const [key, candidates] of candidatesByComponent) {
      if (
        candidates.every((route) => !route.transformRegion && !route.viewportRegion) &&
        routes.some((route) => componentRenderInstanceKey(route.component, route.surface.id) === key && route.surface?.sceneCrop !== true)
      ) continue;
      // A regional request executes the Scene graph once for every consuming
      // frame. That is cheap for synchronized graph branches, but it multiplies
      // independent component instances: the same placement would be rendered
      // again for each frame route. Keep the existing single Scene raster in
      // that case. This preserves independent placement timing without adding
      // another texture or turning "async" into consumer-specific execution.
      if (candidates.length > 1 && !isComponentFrameFanoutSafe(candidates[0].component)) continue;
      // One final consumer has one exact source view. Keep that view on the
      // output pixel grid even when the crop is small; otherwise the full
      // texture is fractionally resampled for no sharing benefit.
      if (candidates.length === 1 && candidates[0].viewportRegion) {
        regionalRouteIds.add(candidates[0].surface.id);
        continue;
      }
      const full = initialRequests.get(key);
      if (!full) continue;
      const sceneRegion = isComponentFrameFanoutSafe(candidates[0].component)
        ? sharedSceneRegionPlan(candidates, textureCeiling || { width: 8192, height: 8192 })
        : null;
      if (sceneRegion) {
        const needsRegionalDetail = candidates.some((route) => {
          const logical = route.sourceView.logicalSize;
          const rect = route.demand.sampleRect;
          const sampledWidth = full.width * rect.width / Math.max(1, logical.width);
          const sampledHeight = full.height * rect.height / Math.max(1, logical.height);
          return route.demand.surfaceSize.width > sampledWidth * 1.05 ||
            route.demand.surfaceSize.height > sampledHeight * 1.05;
        });
        const regionPixels = sceneRegion.size.width * sceneRegion.size.height;
        if (needsRegionalDetail || regionPixels * 1.15 < full.width * full.height) {
          sharedSceneRegions.set(key, sceneRegion);
          for (const route of candidates) regionalRouteIds.add(route.surface.id);
          continue;
        }
      }
      const regionalPixels = candidates.reduce((sum, route) => {
        const size = route.viewportRegion?.rasterSize || route.demand.surfaceSize;
        return sum + size.width * size.height;
      }, 0);
      const needsRegionalDetail = candidates.some((route) => {
        if (route.transformRegion && route.transformRegion.empty !== true) return true;
        const logical = route.sourceView.logicalSize;
        const rect = route.demand.sampleRect;
        const sampledWidth = full.width * rect.width / Math.max(1, logical.width);
        const sampledHeight = full.height * rect.height / Math.max(1, logical.height);
        return route.demand.surfaceSize.width > sampledWidth * 1.05 ||
          route.demand.surfaceSize.height > sampledHeight * 1.05;
      });
      // Regional rendering is also a quality path. A small frame mapped over
      // a large surface may require more pixels than the ordinary full Scene
      // request, while still being dramatically cheaper than enlarging the
      // complete Scene enough to give that crop equivalent detail.
      if (!needsRegionalDetail && regionalPixels * 1.15 >= full.width * full.height) continue;
      for (const route of candidates) regionalRouteIds.add(route.surface.id);
    }
    const componentRequests = sharedComponentRenderRequests(
      requestableRoutes.filter((route) => !regionalRouteIds.has(route.surface.id)),
      renderIdentityPrefix
    );
    for (const [renderInstanceKey, plan] of sharedSceneRegions) {
      const route = candidatesByComponent.get(renderInstanceKey)?.[0];
      const logical = route?.sourceView?.logicalSize;
      if (!logical) continue;
      plan.componentRequest = createRenderRequest("scene-region", plan.size, {
        timingId: renderInstanceKey,
        renderIdentity: `${renderIdentityPrefix}${renderInstanceKey}:scene-union`,
        logicalWidth: logical.width,
        logicalHeight: logical.height,
        demandScale: plan.demandScale,
        uvRect: plan.uvRect,
        regionView: true,
      });
    }
    for (const route of routes) {
      const renderInstanceKey = componentRenderInstanceKey(route.component, route.surface.id);
      if (route.transformRegion?.empty === true) {
        route.componentRequest = null;
        route.rootTransformRegion = route.transformRegion;
        route.surfaceRequest = createRenderRequest("surface", route.demand.surfaceSize, {
          surfaceId: route.surface.id,
          timingId: route.surface.id,
          logicalWidth: route.demand.sampleRect.width,
          logicalHeight: route.demand.sampleRect.height,
          demandScale: route.demand.rasterScale,
        });
        continue;
      }
      const regional = regionalRouteIds.has(route.surface.id);
      if (regional) {
        const sharedSceneRegion = sharedSceneRegions.get(renderInstanceKey);
        if (sharedSceneRegion?.componentRequest) {
          route.componentRequest = sharedSceneRegion.componentRequest;
          route.rootTransformRegion = null;
          route.presentationUvRect = sharedSceneRegion.presentationUvRects.get(route.surface.id) || null;
          route.surfacePresentationUvRect = null;
        } else {
          const logical = route.sourceView.logicalSize;
          const rect = route.demand.sampleRect;
          const uvRect = route.transformRegion?.uvRect || route.viewportRegion?.uvRect || [
            rect.x / logical.width,
            rect.y / logical.height,
            rect.width / logical.width,
            rect.height / logical.height,
          ];
          const regionalSize = route.viewportRegion?.rasterSize || route.demand.surfaceSize;
          route.componentRequest = createRenderRequest("scene-region", regionalSize, {
            timingId: renderInstanceKey,
            renderIdentity: `${renderIdentityPrefix}${renderInstanceKey}:surface:${route.surface.id}`,
            logicalWidth: logical.width,
            logicalHeight: logical.height,
            demandScale: route.viewportRegion?.rasterScale || route.demand.rasterScale,
            uvRect,
            regionView: true,
          });
          route.rootTransformRegion = route.transformRegion || null;
          route.presentationUvRect = route.transformRegion
            ? null
            : (route.viewportRegion?.textureViewUv || null);
          route.surfacePresentationUvRect = route.transformRegion && route.viewportRegion
            ? route.viewportRegion.surfaceViewUv
            : null;
        }
      } else {
        route.componentRequest = componentRequests.get(renderInstanceKey);
      }
      const scale = route.surfacePresentationUvRect
        ? route.viewportRegion.rasterScale
        : (route.componentRequest?.demandScale || route.demand.rasterScale);
      const surfaceSize = route.surfacePresentationUvRect
        ? route.viewportRegion.rasterSize
        : route.demand.surfaceSize;
      route.surfaceRequest = createRenderRequest("surface", surfaceSize, {
        surfaceId: route.surface.id,
        timingId: route.surface.id,
        logicalWidth: route.demand.sampleRect.width,
        logicalHeight: route.demand.sampleRect.height,
        demandScale: scale,
      });
    }
    metrics.visible = routes.length;
    for (const request of componentRequests.values()) metrics.componentRasterPixels += request.width * request.height;
    for (const plan of sharedSceneRegions.values()) {
      if (plan.componentRequest) metrics.componentRasterPixels += plan.componentRequest.width * plan.componentRequest.height;
    }
    for (const route of routes) {
      const key = componentRenderInstanceKey(route.component, route.surface.id);
      if (regionalRouteIds.has(route.surface.id) && !sharedSceneRegions.has(key)) {
        metrics.componentRasterPixels += route.componentRequest.width * route.componentRequest.height;
      }
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
