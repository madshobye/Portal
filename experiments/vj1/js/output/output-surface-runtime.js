import { clamp01 } from "../domain/models.js?v=chain-only-authority-1";
import { visibleSceneSurfaceIds } from "../domain/scene-routing.js?v=surface-identity-1";
import { BoundedRenderTargetPool } from "../libraries/cache-engine/render-cache/index.js?v=periodic-preview-maintenance-1";
import { SceneFrameGuideNode } from "../libraries/composition-engine/index.js?v=scene-frame-guide-node-1";
import { projectedQuadAspect } from "../libraries/render-engine/relative-geometry.js?v=frame-projection-aspect-1";
import { componentInstanceTime } from "../libraries/timing-engine/index.js";
import { contentTransformCanvasPlacement, isIdentityTransform, normalizedContentTransform } from "./content-coordinate-space.js?v=gc-allocation-1";
import { applyBlend } from "./blend-utils.js";
import { drawStandby } from "./generators.js?v=standby-grace-1";
import {
  applyBlendGlobal,
  cornersRect,
  directFitRects,
  scaledComponentSampleRect,
  unifyTransitionComponentRenderRequests,
} from "./component-render-layout.js?v=transition-demand-stability-1";
import { drawBuffer, drawSampleRect, withShaderInstancePrefix } from "./render-draw-utils.js?v=runtime-diagnostics-1";
import { orderedSurfaceProgram, planSurfaceRoutes, stableSurfaceRenderRequest } from "./surface-render-planner.js?v=live-overall-routing-1";
import {
  createSharedFramebufferTarget,
  isSharedFramebufferTarget,
  unwrapRenderTarget,
} from "./shared-framebuffer-target.js?v=render-diagnostics-1";

export function surfaceRouteOpacity(route = {}) {
  return clamp01(route.surface?.opacity ?? 1) * clamp01(route.component?.opacity ?? 1);
}

export function surfaceRouteBlend(route = {}) {
  const surfaceBlend = route.surface?.finalBlend || "normal";
  return surfaceBlend !== "normal" ? surfaceBlend : (route.component?.blend || "normal");
}

export class OutputSurfaceRuntime {
  constructor(renderer) {
    this.renderer = renderer;
    this.surfaceTexturePool = new BoundedRenderTargetPool({ maxItems: 12 });
    this.surfaceTextures = this.surfaceTexturePool.resources;
    this.transitionSurfaceTextures = new Map();
    this.activeTransitionTextureId = "";
    this.renderIdentityPrefix = "";
    this.transitionEffectPrefix = "";
  }

  applyFont(applyFont) {
    for (const target of this.surfaceTextures.values()) applyFont(target);
    for (const target of this.transitionSurfaceTextures.values()) applyFont(target);
  }

  dispose() {
    this.surfaceTexturePool.dispose();
    disposeGraphicsMap(this.transitionSurfaceTextures);
    this.activeTransitionTextureId = "";
    this.renderIdentityPrefix = "";
    this.transitionEffectPrefix = "";
  }

  renderSurfaces() {
    const transition = this.currentLiveTransition();
    if (transition) return this.renderTransitionSurfaces(transition);
    this.releaseTransitionSurfaceTextures();
    this.renderMappingSurfaces();
  }

  renderMappingSurfaces() {
    const renderer = this.renderer;
    const outputBlackout = renderer.isOutputBlackout();
    const routes = this.buildSurfaceRenderPlan();
    let mapperBatch = [];
    let mapperBatchBlend = "";
    const flushMapperBatch = () => {
      if (!mapperBatch.length) return;
      const batch = mapperBatch;
      const blend = mapperBatchBlend;
      mapperBatch = [];
      mapperBatchBlend = "";
      renderer.measureGpu(drawingContext, () => this.drawSurfaceRouteViewBatch(batch, blend));
    };
    for (const route of routes) {
      const { surface, mapped, surfaceRequest: request } = route;
      if (this.canDirectProjectSurfaceRoute(route, outputBlackout)) {
        const view = this.renderSurfaceRouteView(route);
        if (!view) continue;
        renderer.frameProfile.directSurfaceSamples++;
        renderer.frameProfile.avoidedSurfaceRasterPixels += request.width * request.height;
        if (mapped.direct && Number(surface.feather) <= 0) {
          flushMapperBatch();
          renderer.measureGpu(drawingContext, () => {
            this.drawSurfaceRouteView(view, route);
            this.drawLiveMonitorGuideNodes(route);
          });
          continue;
        }
        const blend = surfaceRouteBlend(route);
        if (mapperBatch.length && blend !== mapperBatchBlend) flushMapperBatch();
        mapperBatchBlend = blend;
        mapperBatch.push({ view, route });
        continue;
      }
      flushMapperBatch();
      renderer.frameProfile.surfaceRasterPixels += request.width * request.height;
      const target = this.getSurfaceTexture(request);
      if (!target) continue;
      target.push();
      target.clear();
      if (!outputBlackout) this.drawSurfaceRoute(target, route);
      else target.background(0);
      target.pop();
      renderer.measureGpu(drawingContext, () => {
        push();
        try {
          applyBlendGlobal(surfaceRouteBlend(route));
          if (mapped.direct && Number(surface.feather) > 0) {
            renderer.mapper.drawTexture(target, mapped.mapperSurface, surface.projectionFit, surface.feather, {
              opacity: surfaceRouteOpacity(route),
            });
          } else if (mapped.direct) this.drawDirectSurfaceTexture(target, route);
          else renderer.mapper.drawTexture(target, mapped.mapperSurface, surface.projectionFit, surface.feather, {
            opacity: surfaceRouteOpacity(route),
          });
          this.drawLiveMonitorGuideNodes(route);
        } finally {
          blendMode(BLEND);
          pop();
        }
      });
    }
    flushMapperBatch();
  }

  currentLiveTransition(nowMs = Date.now()) {
    const transition = this.renderer.state?.liveTransition;
    const durationMs = Math.max(0, Number(transition?.durationMs) || 0);
    const startedAtMs = Number(transition?.startedAtMs) || 0;
    if (!transition?.fromState || !durationMs || !startedAtMs) return null;
    const progress = Math.max(0, Math.min(1, (Number(nowMs) - startedAtMs) / durationMs));
    return progress >= 1 ? null : { ...transition, progress };
  }

  renderTransitionSurfaces(transition) {
    const renderer = this.renderer;
    const targetState = renderer.state;
    if (renderer.isOutputBlackout()) return;
    if (this.activeTransitionTextureId !== transition.id) {
      this.releaseTransitionSurfaceTextures();
      this.activeTransitionTextureId = transition.id;
    }
    const componentsShared = transition.componentsShared === true;
    renderer.componentOutput.clear();
    const fromRoutes = this.withRenderState(transition.fromState, () =>
      this.withSurfaceRenderIdentityPrefix(componentsShared ? "" : "transition-from:", () =>
        // Mapping programs belong to the current render state. The temporary
        // transition state has its own resolved Scene route; using the current
        // compiled surfaces here made the from-side sample the target Scene.
        // Passing its already-normalized surfaces avoids both that alias and
        // recompiling the Mapping graph on every transition frame.
        this.buildSurfaceRenderPlan(transition.fromState?.surfaces || [])
      )
    );
    const toRoutes = this.withSurfaceRenderIdentityPrefix(
      componentsShared ? "" : "transition-to:",
      () => this.buildSurfaceRenderPlan()
    );
    if (componentsShared) unifyTransitionComponentRenderRequests(fromRoutes, toRoutes);
    const fromBySurface = new Map(fromRoutes.map((route) => [route.surface.id, route]));
    const toBySurface = new Map(toRoutes.map((route) => [route.surface.id, route]));
    const changedSurfaceIds = new Set();
    for (const surfaceId of new Set([...fromBySurface.keys(), ...toBySurface.keys()])) {
      const fromRoute = fromBySurface.get(surfaceId);
      const toRoute = toBySurface.get(surfaceId);
      // Component override sharing controls cache identity, not route geometry.
      // Only a source-program difference sends a Surface through transition
      // textures. Otherwise an unrelated Surface patch makes every stable
      // Overall route take the double-sampled transition path and visibly
      // changes its scale for the duration of the blend.
      if (!fromRoute || !toRoute || transitionRouteSourceKey(fromRoute) !== transitionRouteSourceKey(toRoute)) {
        changedSurfaceIds.add(surfaceId);
      }
    }
    // Ordinary Surface routes transition between the same texture views used
    // by the stable renderer. This keeps crop, source fit and projection fit
    // as presentation metadata in one mapper pass. The previous path first
    // baked source fit into a Surface-sized raster and then applied cover
    // again; depending on route demand/cache state that visibly zoomed the
    // transition. Shader/effect routes still use the buffered fallback below.
    const directTransitionViews = new Map();
    for (const surfaceId of changedSurfaceIds) {
      const fromRoute = fromBySurface.get(surfaceId);
      const toRoute = toBySurface.get(surfaceId);
      if (!fromRoute || !toRoute) continue;
      const fromView = this.withRenderState(transition.fromState, () =>
        this.canDirectProjectSurfaceRoute(fromRoute, false)
          ? this.renderSurfaceRouteView(fromRoute)
          : null
      );
      const toView = this.withRenderState(targetState, () =>
        this.canDirectProjectSurfaceRoute(toRoute, false)
          ? this.renderSurfaceRouteView(toRoute)
          : null
      );
      if (fromView && toView) directTransitionViews.set(surfaceId, { fromView, toView });
    }
    const bufferedTransitionSurfaceIds = new Set(
      [...changedSurfaceIds].filter((surfaceId) => !directTransitionViews.has(surfaceId))
    );
    const fromTextures = this.renderTransitionRouteTextures(
      fromRoutes.filter((route) => bufferedTransitionSurfaceIds.has(route.surface.id)),
      transition.fromState,
      "from"
    );
    const toTextures = this.renderTransitionRouteTextures(
      toRoutes.filter((route) => bufferedTransitionSurfaceIds.has(route.surface.id)),
      targetState,
      "to"
    );
    // Transition compositing must use the same backplane order as the normal
    // render path. Building this list from raw state.surfaces put derived
    // direct-output routes (especially "Full surface") after authored mapped
    // Surfaces, so they covered the projection for the duration of a Live
    // transition. This only orders the existing draws; it adds no pass or
    // render target.
    const transitionSurfaces = [];
    const transitionSurfaceIds = new Set();
    for (const route of [...toRoutes, ...fromRoutes]) {
      const surfaceId = String(route?.surface?.id || "");
      if (!surfaceId || transitionSurfaceIds.has(surfaceId)) continue;
      transitionSurfaceIds.add(surfaceId);
      transitionSurfaces.push(route.surface);
    }
    const surfaceIds = orderedSurfaceProgram(transitionSurfaces).map((surface) => surface.id);
    for (const surfaceId of surfaceIds) {
      const fromRoute = fromBySurface.get(surfaceId);
      const toRoute = toBySurface.get(surfaceId);
      // A route outside the source-program diff must remain on the exact same
      // direct/stable path it uses before and after the transition. Sending it
      // through two transition textures needlessly changes its sampling and
      // made one Surface patch resize unrelated Surfaces during the blend.
      if (!changedSurfaceIds.has(surfaceId) && toRoute) {
        this.renderStableSurfaceRoute(toRoute);
        continue;
      }
      const route = toRoute || fromRoute;
      const mapped = route?.mapped;
      if (!mapped?.mapperSurface) continue;
      const directViews = directTransitionViews.get(surfaceId);
      const fromTexture = directViews?.fromView?.texture
        || fromTextures.get(surfaceId)
        || this.getTransparentTransitionTexture("from", surfaceId, toRoute?.surfaceRequest);
      const toTexture = directViews?.toView?.texture
        || toTextures.get(surfaceId)
        || this.getTransparentTransitionTexture("to", surfaceId, fromRoute?.surfaceRequest);
      if (!fromTexture || !toTexture) continue;
      const feather = toRoute?.surface?.feather ?? fromRoute?.surface?.feather ?? 0;
      renderer.measureGpu(drawingContext, () => {
        push();
        try {
          applyBlendGlobal(surfaceRouteBlend(route));
          renderer.mapper.drawTransitionTextures(fromTexture, toTexture, mapped.mapperSurface, {
            // Projection fit belongs to the mapper for both route forms. A
            // direct view also supplies its source-fit metadata below; a
            // buffered route has only flattened that earlier source-fit stage,
            // not the Surface projection fit. Stretching the buffered route
            // therefore dropped `contain` during the blend and snapped back to
            // it on the first stable frame.
            fromProjectionFit: fromRoute?.surface?.projectionFit
              || toRoute?.surface?.projectionFit
              || "cover",
            toProjectionFit: toRoute?.surface?.projectionFit
              || fromRoute?.surface?.projectionFit
              || "cover",
            ...(directViews ? {
              fromSourceRect: directViews.fromView.sourceRect,
              toSourceRect: directViews.toView.sourceRect,
              fromSourceFitActive: fromRoute?.surface?.sourceFitActive === true,
              toSourceFitActive: toRoute?.surface?.sourceFitActive === true,
              fromSourceFit: fromRoute?.surface?.sourceFit || "cover",
              toSourceFit: toRoute?.surface?.sourceFit || "cover",
              fromSourceAspect: fromRoute?.surface?.sourceAspect || 1,
              toSourceAspect: toRoute?.surface?.sourceAspect || 1,
              fromOpacity: surfaceRouteOpacity(fromRoute),
              toOpacity: surfaceRouteOpacity(toRoute),
            } : {}),
            feather,
            progress: transition.progress,
          });
          this.drawLiveMonitorGuideNodes(route);
        } finally {
          blendMode(BLEND);
          pop();
        }
      });
    }
  }

  renderStableSurfaceRoute(route, outputBlackout = false) {
    const renderer = this.renderer;
    const { surface, mapped, surfaceRequest: request } = route;
    if (this.canDirectProjectSurfaceRoute(route, outputBlackout)) {
      const view = this.renderSurfaceRouteView(route);
      if (!view) return;
      renderer.frameProfile.directSurfaceSamples++;
      renderer.frameProfile.avoidedSurfaceRasterPixels += request.width * request.height;
      renderer.measureGpu(drawingContext, () => {
        this.drawSurfaceRouteView(view, route);
        this.drawLiveMonitorGuideNodes(route);
      });
      return;
    }
    renderer.frameProfile.surfaceRasterPixels += request.width * request.height;
    const target = this.getSurfaceTexture(request);
    if (!target) return;
    target.push();
    target.clear();
    if (!outputBlackout) this.drawSurfaceRoute(target, route);
    else target.background(0);
    target.pop();
    renderer.measureGpu(drawingContext, () => {
      push();
      try {
        applyBlendGlobal(surfaceRouteBlend(route));
        if (mapped.direct && Number(surface.feather) <= 0) this.drawDirectSurfaceTexture(target, route);
        else renderer.mapper.drawTexture(target, mapped.mapperSurface, surface.projectionFit, surface.feather, {
          opacity: surfaceRouteOpacity(route),
        });
        this.drawLiveMonitorGuideNodes(route);
      } finally {
        blendMode(BLEND);
        pop();
      }
    });
  }

  renderTransitionRouteTextures(routes, renderState, side) {
    const renderer = this.renderer;
    const textures = new Map();
    this.withRenderState(renderState, () => {
      for (const route of routes) {
        renderer.frameProfile.surfaceRasterPixels += route.surfaceRequest.width * route.surfaceRequest.height;
        const texture = this.getTransitionSurfaceTexture(side, route.surface.id, route.surfaceRequest);
        if (!texture) continue;
        texture.push();
        texture.clear();
        const previousEffectPrefix = this.transitionEffectPrefix;
        this.transitionEffectPrefix = side;
        try {
          this.drawSurfaceRoute(texture, route, { compositeOpacity: surfaceRouteOpacity(route) });
        } finally {
          this.transitionEffectPrefix = previousEffectPrefix;
        }
        texture.pop();
        textures.set(route.surface.id, texture);
      }
    });
    return textures;
  }

  getTransitionSurfaceTexture(side, surfaceId, request = stableSurfaceRenderRequest(this.renderer.state?.render || {})) {
    const widthPx = Math.max(1, Math.round(Number(request?.width) || 1));
    const heightPx = Math.max(1, Math.round(Number(request?.height) || 1));
    const key = `${side}:${surfaceId}`;
    let target = this.transitionSurfaceTextures.get(key);
    if (!target || target.width !== widthPx || target.height !== heightPx) {
      target?.remove?.();
      target = createSharedFramebufferTarget(widthPx, heightPx) || createGraphics(widthPx, heightPx);
      if (!isSharedFramebufferTarget(target)) {
        this.renderer.applyGraphicsPixelDensity(target, this.renderer.requestPixelDensity(request));
        this.renderer.applyGraphicsFont(target);
      }
      this.transitionSurfaceTextures.set(key, target);
    }
    return target;
  }

  getTransparentTransitionTexture(side, surfaceId, request) {
    const target = this.getTransitionSurfaceTexture(side, `${surfaceId}:empty`, request);
    target?.push?.();
    target?.clear?.();
    target?.pop?.();
    return target;
  }

  releaseTransitionSurfaceTextures() {
    if (!this.transitionSurfaceTextures.size && !this.activeTransitionTextureId) return;
    disposeGraphicsMap(this.transitionSurfaceTextures);
    this.activeTransitionTextureId = "";
  }

  withRenderState(renderState, callback) {
    const renderer = this.renderer;
    const previous = {
      state: renderer.state,
      componentById: renderer.componentById,
      frameById: renderer.frameById,
      routeSourceNodeById: renderer.routeSourceNodeById,
      routeSourceNodeByLegacyKey: renderer.routeSourceNodeByLegacyKey,
    };
    renderer.state = renderState;
    renderer.rebuildRouteLookups();
    try {
      return callback();
    } finally {
      // Render state and its derived route indexes are one context. Restore the
      // exact previous maps so temporary transition scopes cannot leak routes.
      renderer.state = previous.state;
      renderer.componentById = previous.componentById;
      renderer.frameById = previous.frameById;
      renderer.routeSourceNodeById = previous.routeSourceNodeById;
      renderer.routeSourceNodeByLegacyKey = previous.routeSourceNodeByLegacyKey;
    }
  }

  withSurfaceRenderIdentityPrefix(prefix, callback) {
    const previous = this.renderIdentityPrefix;
    this.renderIdentityPrefix = prefix;
    try {
      return callback();
    } finally {
      this.renderIdentityPrefix = previous;
    }
  }

  buildSurfaceRenderPlan(surfaceProgram = null) {
    const renderer = this.renderer;
    const render = renderer.state?.render || {};
    const viewport = renderer.displayCanvasSize(render);
    const previewTransform = renderer.previewViewportTransform(render);
    const transformDemandCorners = (corners = []) => corners.map((corner) => ({
      x: viewport.width * 0.5 + ((Number(corner?.x) || 0) - viewport.width * 0.5) * previewTransform.zoom + previewTransform.x,
      y: viewport.height * 0.5 + ((Number(corner?.y) || 0) - viewport.height * 0.5) * previewTransform.zoom + previewTransform.y,
    }));
    const { routes, metrics } = planSurfaceRoutes({
      state: renderer.state,
      mapperSurfaces: renderer.mapperSurfaces,
      componentById: renderer.componentById,
      viewport,
      pixelScale: renderer.renderPixelDensity(render),
      transformDemandCorners,
      // Standalone Output retains its established full projection request.
      // Embedded previews can safely exclude the part clipped by their fixed
      // p5 canvas after the final viewport transform.
      preserveDirectFootprint: renderer.mode === "output",
      renderIdentityPrefix: this.renderIdentityPrefix,
      surfaceProgram: orderedSurfaceProgram(surfaceProgram || renderer.mappingProgramSurfaces(renderer.state)),
      resolveRouteSourceNode: (surface) => renderer.resolveRouteSourceNode(surface),
      isComponentRegionSafe: (component) => renderer.sceneComponentRegionSafe?.(component) === true,
      isComponentFrameFanoutSafe: (component) => renderer.sceneComponentFrameFanoutSafe?.(component) !== false,
    });
    renderer.frameProfile.surfaceRouteCandidates += metrics.candidates;
    renderer.frameProfile.surfaceRoutesCulled += metrics.culled;
    renderer.frameProfile.surfaceRoutesVisible += metrics.visible;
    renderer.frameProfile.componentRasterPixels += metrics.componentRasterPixels;
    for (const route of routes) {
      renderer.recordPresentedRenderRequest(route.componentRequest || route.surfaceRequest);
    }
    return routes;
  }

  getSurfaceTexture(request = stableSurfaceRenderRequest(this.renderer.state?.render || {})) {
    const widthPx = Math.max(1, Math.round(Number(request.width) || 1));
    const heightPx = Math.max(1, Math.round(Number(request.height) || 1));
    const key = `${widthPx}x${heightPx}`;
    return this.surfaceTexturePool.acquire(key, this.renderer.frameIndex, () => {
      const target = createSharedFramebufferTarget(widthPx, heightPx) || createGraphics(widthPx, heightPx);
      if (!isSharedFramebufferTarget(target)) {
        this.renderer.applyGraphicsPixelDensity(target, this.renderer.requestPixelDensity(request));
        this.renderer.applyGraphicsFont(target);
      }
      return target;
    });
  }

  drawDirectSurfaceTexture(texture, route = {}, alpha = 1) {
    const rect = route.mapped?.directRect || cornersRect(route.mapped?.mapperSurface?.corners || []);
    if (!texture || !rect || alpha <= 0) return;
    const fit = directFitRects(texture.width, texture.height, rect, route.surface?.projectionFit || "contain");
    const drawable = isSharedFramebufferTarget(texture) ? unwrapRenderTarget(texture) : texture;
    push();
    try {
      resetShader();
      imageMode(CORNER);
      applyBlendGlobal(surfaceRouteBlend(route));
      tint(255, 255 * clamp01(alpha) * surfaceRouteOpacity(route));
      image(drawable,
        fit.destination.x - width * 0.5, fit.destination.y - height * 0.5,
        fit.destination.width, fit.destination.height,
        fit.source.x, fit.source.y, fit.source.width, fit.source.height);
      noTint();
      blendMode(BLEND);
    } finally {
      pop();
    }
  }

  canDirectProjectSurfaceRoute(route = {}, outputBlackout = false) {
    if (outputBlackout || this.renderer.shouldUseThumbnailPreview()) return false;
    return !route.surface?.finalShaderChain?.length && isIdentityTransform(route.component?.transform);
  }

  renderSurfaceRouteView(route = {}) {
    const renderer = this.renderer;
    const { surface = {}, component = null, componentRequest = null, demand = null } = route;
    if (!surface.componentId) return null;
    const componentTime = componentInstanceTime(component, renderer.componentTimes.get(surface.componentId) || 0, surface.id);
    const texture = component ? renderer.renderComponentForRequest(component, componentTime, componentRequest) : renderer.mainMix;
    if (!texture) return null;
    if (componentRequest?.regionView) {
      return { texture, sourceRect: { x: 0, y: 0, width: texture.width, height: texture.height } };
    }
    return { texture, sourceRect: scaledComponentSampleRect(demand?.sampleRect, demand?.logicalSize, texture) };
  }

  drawSurfaceRouteView(view, route = {}) {
    const renderer = this.renderer;
    const { surface = {}, mapped = {} } = route;
    const opacity = surfaceRouteOpacity(route);
    push();
    try {
      applyBlendGlobal(surfaceRouteBlend(route));
      if (mapped.direct && Number(surface.feather) <= 0) this.drawDirectSurfaceView(view, route, opacity);
      else renderer.mapper.drawTexture(view.texture, mapped.mapperSurface, surface.projectionFit, surface.feather, {
        sourceRect: view.sourceRect,
        opacity,
        sourceFitActive: surface.sourceFitActive,
        sourceFit: surface.sourceFit,
        sourceAspect: surface.sourceAspect,
      });
    } finally {
      blendMode(BLEND);
      pop();
    }
  }

  drawLiveMonitorGuideNodes(route = {}) {
    const renderer = this.renderer;
    if (renderer.mode !== "live" || renderer.state?.ui?.workspace !== "live") return;
    if (String(renderer.state?.ui?.live?.previewSurfaceId || "__mapping__") !== "__mapping__") return;
    if (route.mapped?.direct !== true) return;
    // This is the actual routed render boundary. A CSS outline can only mark
    // the full p5 host canvas and is therefore wrong whenever the monitor is
    // letterboxed inside it.
    renderer.mapper.drawGuidePaths([[
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]], route.mapped.mapperSurface, { color: [84, 228, 212, 184], weight: 1 });
    this.drawSceneFrameGuideNode(route);
  }

  drawSceneFrameGuideNode(route = {}) {
    const renderer = this.renderer;
    // The guide belongs to the Scene Mapping monitor, not to its current source.
    // Overall can transition between Scenes and standalone Components; tying the
    // guide to component.type made it disappear for the Component endpoint.
    const corners = route.mapped?.mapperSurface?.corners;
    if (!Array.isArray(corners) || corners.length !== 4) return;
    const logicalSize = route.demand?.logicalSize || { width: 1, height: 1 };
    const sampleRect = route.demand?.sampleRect || {
      x: 0,
      y: 0,
      width: Math.max(1, Number(logicalSize.width) || 1),
      height: Math.max(1, Number(logicalSize.height) || 1),
    };
    const sourceAspect = Math.max(0.0001,
      (Number(sampleRect.width) || 1) / Math.max(1, Number(sampleRect.height) || 1));
    const targetAspect = projectedQuadAspect(corners, sourceAspect);
    const selectedMapping = renderer.state?.mappings?.find((mapping) =>
      String(mapping.id) === String(renderer.state?.ui?.selectedMappingId || "")
    ) || renderer.state?.mappings?.[0] || null;
    const guideSurfaces = renderer.state?.ui?.live?.surfaceRoutes?.surfaces
      || selectedMapping?.surfaces
      || [];
    const visibleFrameIds = visibleSceneSurfaceIds(guideSurfaces);
    const { paths } = SceneFrameGuideNode.process({
      // Live's materialized route program is the authority here. It includes
      // output-backed Surfaces as well as authored projection Surfaces; the
      // Mapping model alone can omit those derived output routes and previously
      // left Overall preview showing only the Full surface rectangle.
      frames: guideSurfaces.filter((frame) =>
        visibleFrameIds.has(String(frame.id || ""))
      ),
      logicalSize,
      sampleRect,
      sourceAspect,
      targetAspect,
      projectionFit: route.surface?.projectionFit || "cover",
    });
    renderer.mapper.drawGuidePaths(paths, route.mapped.mapperSurface);
  }

  drawSurfaceRouteViewBatch(items = [], blend = "normal") {
    if (!items.length) return;
    push();
    try {
      applyBlendGlobal(blend);
      this.renderer.mapper.drawTextureBatch(items.map(({ view, route }) => ({
        texture: view.texture,
        surface: route.mapped.mapperSurface,
        projectionFit: route.surface.projectionFit,
        feather: route.surface.feather,
        options: {
          sourceRect: view.sourceRect,
          opacity: surfaceRouteOpacity(route),
          sourceFitActive: route.surface.sourceFitActive,
          sourceFit: route.surface.sourceFit,
          sourceAspect: route.surface.sourceAspect,
        },
      })));
    } finally {
      blendMode(BLEND);
      pop();
    }
  }

  drawDirectSurfaceView(view, route = {}, opacity = 1) {
    const sourceRect = view?.sourceRect;
    const texture = view?.texture;
    const mapperSurface = route.mapped?.mapperSurface;
    if (!texture || !sourceRect || !mapperSurface || opacity <= 0) return;
    // A recording frame is a texture view, not a new raster. Sample it with
    // the same mapping shader used by projected surfaces so shared
    // framebuffers stay in the main GL context. p5.image's source-rectangle
    // path can ask Chromium to copy a sub-texture with a negative internal
    // offset after a WebGL source resize; it also duplicates the crop/fit
    // rules maintained by the mapper. This remains one direct shader draw and
    // introduces no surface buffer or readback.
    this.renderer.mapper.drawTexture(
      texture,
      mapperSurface,
      route.surface?.projectionFit || "contain",
      0,
      {
        sourceRect,
        opacity,
        ...(route.surface?.sourceFitActive ? {
          sourceFitActive: true,
          sourceFit: route.surface.sourceFit,
          sourceAspect: route.surface.sourceAspect,
        } : {}),
      }
    );
  }

  drawSurfaceRoute(target, route = {}, { compositeOpacity = 1 } = {}) {
    const renderer = this.renderer;
    const { surface = {}, component = null, surfaceRequest: request = null, componentRequest = null, demand = null } = route;
    if (!surface.componentId) {
      target.clear();
      return;
    }
    if (renderer.shouldUseThumbnailPreview()) {
      return this.drawSurfaceThumbnailRoute(target, surface, demand, compositeOpacity);
    }
    const componentTime = componentInstanceTime(component, renderer.componentTimes.get(surface.componentId) || 0, surface.id);
    const source = component ? renderer.renderComponentForRequest(component, componentTime, componentRequest) : renderer.mainMix;
    target.push();
    applyBlend(target, "normal");
    target.tint(255, 255 * clamp01(compositeOpacity));
    const sampleRect = scaledComponentSampleRect(demand?.sampleRect, demand?.logicalSize, source);
    drawTransformedSampleRect(
      target,
      source,
      sampleRect,
      component?.transform,
      surface.sourceFitActive ? surface.sourceFit : "stretch"
    );
    target.noTint();
    target.blendMode(BLEND);
    target.pop();
    if (surface.finalShaderChain?.length) {
      const effectIdentity = this.transitionEffectPrefix ? `${this.transitionEffectPrefix}:${surface.id}` : surface.id;
      const effected = renderer.renderShaderChain(target, withShaderInstancePrefix(surface.finalShaderChain, effectIdentity), request, renderer.visualTime);
      drawBuffer(target, effected, 0, 0, target.width, target.height, renderer.isShaderBuffer(effected));
    }
  }

  drawSurfaceThumbnailRoute(target, surface, demand = null, compositeOpacity = 1) {
    const renderer = this.renderer;
    const component = renderer.state.components.find((item) => item.id === surface.componentId);
    const thumbnail = renderer.getThumbnailImage(component);
    target.push();
    applyBlend(target, "normal");
    target.tint(255, 255 * clamp01(compositeOpacity));
    if (thumbnail?.ready && thumbnail.img) {
      const sampleRect = scaledComponentSampleRect(demand?.sampleRect, demand?.logicalSize, thumbnail.img);
      drawTransformedSampleRect(
        target,
        thumbnail.img,
        sampleRect,
        component?.transform,
        surface.sourceFitActive ? surface.sourceFit : "stretch"
      );
    } else {
      const isLoading = !!component?.thumbnail;
      drawStandby(target, isLoading ? "loading thumbnail" : "no thumbnail", {
        visible: renderer.state?.ui?.debugPreview !== false,
        frame: renderer.frameIndex,
        graceMs: isLoading ? 1000 : 0,
      });
    }
    target.noTint();
    target.blendMode(BLEND);
    target.pop();
  }
}

export function transitionRouteSourceKey(route = {}) {
  const surface = route.surface || {};
  return JSON.stringify([
    surface.sourceNodeId || "",
    surface.componentId || "",
    surface.sceneCrop === true,
    surface.sourceFit || "cover",
    surface.sourceFitActive === true,
    Math.round((Number(surface.sourceAspect) || 1) * 1e6) / 1e6,
  ]);
}

function drawTransformedSampleRect(target, source, sampleRect, transform = {}, fit = "stretch") {
  const value = normalizedContentTransform(transform);
  const placement = contentTransformCanvasPlacement(value, target.width, target.height);
  const fitted = fittedSampleRect(sampleRect, target.width, target.height, fit);
  target.push();
  target.translate(placement.centerX, placement.centerY);
  target.rotate(value.rotation);
  target.scale(value.scale);
  drawSampleRect(target, source, fitted.source,
    fitted.x - target.width * 0.5,
    fitted.y - target.height * 0.5,
    fitted.width,
    fitted.height);
  target.pop();
}

function fittedSampleRect(source = {}, targetWidth = 1, targetHeight = 1, fit = "stretch") {
  const tw = Math.max(1, Number(targetWidth) || 1);
  const th = Math.max(1, Number(targetHeight) || 1);
  const sw = Math.max(1, Number(source.width) || 1);
  const sh = Math.max(1, Number(source.height) || 1);
  if (fit === "contain") {
    const scale = Math.min(tw / sw, th / sh);
    const width = sw * scale;
    const height = sh * scale;
    return { source, x: (tw - width) * 0.5, y: (th - height) * 0.5, width, height };
  }
  if (fit === "cover") {
    const targetAspect = tw / th;
    const sourceAspect = sw / sh;
    if (sourceAspect > targetAspect) {
      const width = sh * targetAspect;
      return { source: { ...source, x: source.x + (sw - width) * 0.5, width }, x: 0, y: 0, width: tw, height: th };
    }
    const height = sw / targetAspect;
    return { source: { ...source, y: source.y + (sh - height) * 0.5, height }, x: 0, y: 0, width: tw, height: th };
  }
  return { source, x: 0, y: 0, width: tw, height: th };
}

function disposeGraphicsMap(map) {
  for (const target of map.values()) target?.remove?.();
  map.clear();
}
