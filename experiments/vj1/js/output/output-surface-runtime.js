import { clamp01 } from "../domain/models.js?v=surface-terminology-1";
import { visibleSceneSurfaceIds } from "../domain/scene-routing.js?v=live-output-matrix-contract-3";
import { BoundedRenderTargetPool } from "../libraries/cache-engine/render-cache/index.js?v=periodic-preview-maintenance-1";
import { SceneSurfaceGuideNode } from "../libraries/composition-engine/index.js?v=compiled-capability-revision-1";
import { projectedQuadAspect } from "../libraries/render-engine/relative-geometry.js?v=frame-projection-aspect-1";
import { componentInstanceTime } from "../libraries/timing-engine/index.js";
import { sceneLogicalSize } from "../domain/render-settings.js?v=surface-terminology-1";
import { contentTransformCanvasPlacement, isIdentityTransform, normalizedContentTransform } from "./content-coordinate-space.js?v=gc-allocation-1";
import { applyBlend } from "./blend-utils.js";
import {
  drawStandby,
  standbyDiagnosticsVisible,
} from "./generators.js?v=standby-local-diagnostic-1";
import {
  applyBlendGlobal,
  cornersRect,
  directFitRects,
  fittedSampleRect,
  scaledComponentSampleRect,
  unifyTransitionComponentRenderRequests,
} from "./component-render-layout.js?v=surface-terminology-1";
import {
  drawBuffer,
  drawSampleRect,
  renderTargetImageGeometry,
  withShaderInstancePrefix,
} from "./render-draw-utils.js?v=runtime-diagnostics-1";
import { orderedSurfaceProgram, planSurfaceRoutes, stableSurfaceRenderRequest } from "./surface-render-planner.js?v=explicit-direct-surface-hierarchy-1";
import {
  createSharedFramebufferTarget,
  isSharedFramebufferTarget,
  unwrapRenderTarget,
} from "./shared-framebuffer-target.js?v=premultiplied-alpha-5";

export function surfaceRouteOpacity(route = {}) {
  return clamp01(route.surface?.opacity ?? 1) * clamp01(route.component?.opacity ?? 1);
}

// Scene Mapping guides always describe the project Scene, never the intrinsic
// frame of the source mounted into that Scene. An ordinary Component is
// conceptually adapted through a temporary Scene with `cover`; using the
// Component's demand rectangle here makes guide geometry jump during a
// mixed-aspect transition even though the presentation space did not change.
export function liveSceneGuideContext(render = {}) {
  const logicalSize = sceneLogicalSize(render);
  return {
    logicalSize,
    sampleRect: {
      x: 0,
      y: 0,
      width: logicalSize.width,
      height: logicalSize.height,
    },
    sourceAspect: logicalSize.width / logicalSize.height,
  };
}

export function surfaceRouteBlend(route = {}) {
  const surfaceBlend = route.surface?.finalBlend || "normal";
  return surfaceBlend !== "normal" ? surfaceBlend : (route.component?.blend || "normal");
}

function surfaceRouteLogicalAspect(route = {}) {
  return Math.max(
    0.0001,
    (Number(route?.demand?.surfaceSize?.width) || 1) /
      Math.max(1, Number(route?.demand?.surfaceSize?.height) || 1)
  );
}

export class OutputSurfaceRuntime {
  constructor(renderer, {
    resolveTransition = (...args) => renderer.transitionRuntime?.resolve(...args),
  } = {}) {
    this.renderer = renderer;
    this.resolveTransition = resolveTransition;
    this.surfaceTexturePool = new BoundedRenderTargetPool({ maxItems: 12 });
    this.surfaceTextures = this.surfaceTexturePool.resources;
    this.transitionSurfaceTextures = new Map();
    this.activeTransitionTextureId = "";
    this.renderIdentityPrefix = "";
    this.transitionEffectPrefix = "";
    this.rootTransformDetailWarnings = new Set();
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
    this.rootTransformDetailWarnings.clear();
  }

  renderSurfaces() {
    const transition = this.currentLiveTransition();
    if (transition) return this.renderTransitionSurfaces(transition);
    this.releaseTransitionSurfaceTextures();
    this.renderMappingSurfaces();
  }

  renderMappingSurfaces() {
    const renderer = this.renderer;
    const outputBlackout = renderer.readinessRuntime.isBlackout();
    const routes = this.buildSurfaceRenderPlan();
    let mapperBatch = [];
    let mapperBatchBlend = "";
    const flushMapperBatch = () => {
      if (!mapperBatch.length) return;
      const batch = mapperBatch;
      const blend = mapperBatchBlend;
      mapperBatch = [];
      mapperBatchBlend = "";
      renderer.presentationRuntime.measureGpu(drawingContext, () => this.drawSurfaceRouteViewBatch(batch, blend));
    };
    for (const route of routes) {
      const { surface, mapped, surfaceRequest: request } = route;
      if (this.canDirectProjectSurfaceRoute(route, outputBlackout)) {
        const view = this.renderSurfaceRouteView(route);
        if (!view) continue;
        renderer.profileRuntime.frameProfile.directSurfaceSamples++;
        renderer.profileRuntime.frameProfile.avoidedSurfaceRasterPixels += request.width * request.height;
        if (mapped.direct && Number(surface.feather) <= 0) {
          flushMapperBatch();
          renderer.presentationRuntime.measureGpu(drawingContext, () => {
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
      renderer.profileRuntime.frameProfile.surfaceRasterPixels += request.width * request.height;
      const target = this.getSurfaceTexture(request);
      if (!target) continue;
      target.push();
      target.clear();
      if (!outputBlackout) this.drawSurfaceRoute(target, route);
      else target.background(0);
      target.pop();
      renderer.presentationRuntime.measureGpu(drawingContext, () => {
        push();
        try {
          applyBlendGlobal(surfaceRouteBlend(route));
          this.drawBufferedSurfaceTexture(target, route);
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
    if (progress >= 1) return null;
    const resolved = this.resolveTransition?.(
      transition.transitionId,
      transition.transitionParameters
    ) || {};
    return { ...transition, ...resolved, progress };
  }

  renderTransitionSurfaces(transition) {
    const renderer = this.renderer;
    const targetState = renderer.state;
    if (renderer.readinessRuntime.isBlackout()) return;
    if (this.activeTransitionTextureId !== transition.id) {
      this.releaseTransitionSurfaceTextures();
      this.activeTransitionTextureId = transition.id;
    }
    const componentsShared = transition.componentsShared === true;
    renderer.resourceRuntime.componentOutput.clear();
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
      renderer.presentationRuntime.measureGpu(drawingContext, () => {
        push();
        try {
          applyBlendGlobal(surfaceRouteBlend(route));
          renderer.mappingRuntime.mapper.drawTransitionTextures(fromTexture, toTexture, mapped.mapperSurface, {
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
            fromTextureViewUv: directViews?.fromView?.textureViewUv
              || fromRoute?.surfacePresentationUvRect,
            toTextureViewUv: directViews?.toView?.textureViewUv
              || toRoute?.surfacePresentationUvRect,
            fromLogicalSourceAspect: directViews?.fromView?.logicalSourceAspect
              || surfaceRouteLogicalAspect(fromRoute),
            toLogicalSourceAspect: directViews?.toView?.logicalSourceAspect
              || surfaceRouteLogicalAspect(toRoute),
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
            transitionKernel: transition.kernel || transition.transitionKernel,
            transitionParameters: transition.parameters || transition.transitionParameters,
            transitionTime: renderer.frameRuntime.visualTime,
            transitionTimeDelta: renderer.frameRuntime.visualDeltaSeconds,
            transitionFrameIndex: renderer.frameRuntime.frameIndex,
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
      renderer.profileRuntime.frameProfile.directSurfaceSamples++;
      renderer.profileRuntime.frameProfile.avoidedSurfaceRasterPixels += request.width * request.height;
      renderer.presentationRuntime.measureGpu(drawingContext, () => {
        this.drawSurfaceRouteView(view, route);
        this.drawLiveMonitorGuideNodes(route);
      });
      return;
    }
    renderer.profileRuntime.frameProfile.surfaceRasterPixels += request.width * request.height;
    const target = this.getSurfaceTexture(request);
    if (!target) return;
    target.push();
    target.clear();
    if (!outputBlackout) this.drawSurfaceRoute(target, route);
    else target.background(0);
    target.pop();
    renderer.presentationRuntime.measureGpu(drawingContext, () => {
      push();
      try {
        applyBlendGlobal(surfaceRouteBlend(route));
        this.drawBufferedSurfaceTexture(target, route);
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
        renderer.profileRuntime.frameProfile.surfaceRasterPixels += route.surfaceRequest.width * route.surfaceRequest.height;
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
      target = createSharedFramebufferTarget(widthPx, heightPx);
      if (!isSharedFramebufferTarget(target)) {
        this.renderer.resourceRuntime.applyGraphicsPixelDensity(
          target,
          this.renderer.renderRequestRuntime.pixelDensity(request),
        );
        this.renderer.resourceRuntime.applyGraphicsFont(target);
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
    const programs = renderer.componentProgramRuntime;
    const previous = {
      state: renderer.state,
      componentById: programs.componentById,
      routeSourceNodeById: programs.routeSourceNodeById,
    };
    renderer.state = renderState;
    programs.rebuildLookups();
    try {
      return callback();
    } finally {
      // Render state and its derived route indexes are one context. Restore the
      // exact previous maps so temporary transition scopes cannot leak routes.
      renderer.state = previous.state;
      programs.componentById = previous.componentById;
      programs.routeSourceNodeById = previous.routeSourceNodeById;
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
    const viewport = renderer.presentationGeometry.displayCanvasSize(render);
    const previewTransform = renderer.presentationGeometry.viewportTransform(render);
    const identityViewport = Math.abs(previewTransform.zoom - 1) < 1e-12 &&
      Math.abs(previewTransform.x) < 1e-12 &&
      Math.abs(previewTransform.y) < 1e-12;
    const transformDemandCorners = (corners = []) => identityViewport
      ? corners
      : corners.map((corner) => ({
          x: viewport.width * 0.5 + ((Number(corner?.x) || 0) - viewport.width * 0.5) * previewTransform.zoom + previewTransform.x,
          y: viewport.height * 0.5 + ((Number(corner?.y) || 0) - viewport.height * 0.5) * previewTransform.zoom + previewTransform.y,
        }));
    const { routes, metrics } = planSurfaceRoutes({
      state: renderer.state,
      mapperSurfaces: renderer.mappingRuntime.surfaces,
      componentById: renderer.componentProgramRuntime.componentById,
      viewport,
      pixelScale: renderer.presentationGeometry.pixelDensity(render),
      transformDemandCorners,
      // Standalone Output retains its established full projection request.
      // Embedded previews can safely exclude the part clipped by their fixed
      // p5 canvas after the final viewport transform.
      preserveDirectFootprint: renderer.mode === "output",
      // Standalone Output is the final consumer and can therefore request a
      // coordinate-correct source ROI from its actual canvas. Editor pan/zoom
      // remains presentation-only and must not invalidate Component textures.
      allowViewportRegions: renderer.mode === "output",
      renderIdentityPrefix: this.renderIdentityPrefix,
      surfaceProgram: orderedSurfaceProgram(
        surfaceProgram ||
          renderer.mappingProgramRuntime.surfaces(renderer.state),
      ),
      resolveRouteSourceNode: (surface) =>
        renderer.componentProgramRuntime.resolveRouteSourceNode(surface),
      isComponentRegionSafe: (component) =>
        renderer.sourceRuntime.componentRegionSafe(component) === true,
      isComponentFrameFanoutSafe: (component) =>
        renderer.sourceRuntime.sceneComponentFrameFanoutSafe(component) !== false,
    });
    renderer.profileRuntime.frameProfile.surfaceRouteCandidates += metrics.candidates;
    renderer.profileRuntime.frameProfile.surfaceRoutesCulled += metrics.culled;
    renderer.profileRuntime.frameProfile.surfaceRoutesVisible += metrics.visible;
    renderer.profileRuntime.frameProfile.componentRasterPixels += metrics.componentRasterPixels;
    for (const componentId of metrics.rootTransformDetailLimited || []) {
      if (this.rootTransformDetailWarnings.has(componentId)) continue;
      this.rootTransformDetailWarnings.add(componentId);
      console.warn("[VJ1_ROOT_CONTENT_DETAIL_LIMITED]", {
        componentId,
        message: "Root Content scale cannot use transformed ROI because the compiled graph contains a full-frame or non-region-safe operation; retaining bounded render demand.",
      });
    }
    for (const route of routes) {
      renderer.presentationMetrics.recordPresentedRequest(route.componentRequest || route.surfaceRequest);
    }
    return routes;
  }

  getSurfaceTexture(request = stableSurfaceRenderRequest(this.renderer.state?.render || {})) {
    const widthPx = Math.max(1, Math.round(Number(request.width) || 1));
    const heightPx = Math.max(1, Math.round(Number(request.height) || 1));
    const key = `${widthPx}x${heightPx}`;
    return this.surfaceTexturePool.acquire(key, this.renderer.frameRuntime.frameIndex, () => {
      const target = createSharedFramebufferTarget(widthPx, heightPx);
      if (!isSharedFramebufferTarget(target)) {
        this.renderer.resourceRuntime.applyGraphicsPixelDensity(
          target,
          this.renderer.renderRequestRuntime.pixelDensity(request),
        );
        this.renderer.resourceRuntime.applyGraphicsFont(target);
      }
      return target;
    });
  }

  drawDirectSurfaceTexture(texture, route = {}, alpha = 1) {
    const rect = route.mapped?.directRect || cornersRect(route.mapped?.mapperSurface?.corners || []);
    if (!texture || !rect || alpha <= 0) return;
    const fit = directFitRects(texture.width, texture.height, rect, route.surface?.projectionFit || "contain");
    const drawable = isSharedFramebufferTarget(texture) ? unwrapRenderTarget(texture) : texture;
    const geometry = renderTargetImageGeometry(
      texture,
      {
        x: fit.destination.x - width * 0.5,
        y: fit.destination.y - height * 0.5,
        width: fit.destination.width,
        height: fit.destination.height,
      },
      fit.source,
    );
    push();
    try {
      resetShader();
      imageMode(CORNER);
      applyBlendGlobal(surfaceRouteBlend(route));
      tint(255, 255 * clamp01(alpha) * surfaceRouteOpacity(route));
      image(
        drawable,
        geometry.destination.x,
        geometry.destination.y,
        geometry.destination.width,
        geometry.destination.height,
        geometry.sample.x,
        geometry.sample.y,
        geometry.sample.width,
        geometry.sample.height,
      );
      noTint();
      blendMode(BLEND);
    } finally {
      pop();
    }
  }

  canDirectProjectSurfaceRoute(route = {}, outputBlackout = false) {
    if (outputBlackout || this.renderer.presentationRuntime.shouldUseThumbnailPreview()) return false;
    return !route.surface?.finalShaderChain?.length && isIdentityTransform(route.component?.transform);
  }

  renderSurfaceRouteView(route = {}) {
    const renderer = this.renderer;
    const { surface = {}, component = null, componentRequest = null, demand = null } = route;
    if (!surface.componentId) return null;
    const componentTime = componentInstanceTime(
      component,
      renderer.frameRuntime.componentTimes.get(surface.componentId) || 0,
      surface.id,
    );
    const texture = component
      ? renderer.componentRenderRuntime.render(
          component,
          componentTime,
          componentRequest,
        )
      : renderer.resourceRuntime.mainMix;
    if (!texture) return null;
    if (componentRequest?.regionView) {
      return {
        texture,
        sourceRect: { x: 0, y: 0, width: texture.width, height: texture.height },
        textureViewUv: route.presentationUvRect,
        logicalSourceAspect: Math.max(0.0001,
          (Number(demand?.sampleRect?.width) || 1) /
          Math.max(1, Number(demand?.sampleRect?.height) || 1)),
      };
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
      else renderer.mappingRuntime.mapper.drawTexture(view.texture, mapped.mapperSurface, surface.projectionFit, surface.feather, {
        sourceRect: view.sourceRect,
        opacity,
        sourceFitActive: surface.sourceFitActive,
        sourceFit: surface.sourceFit,
        sourceAspect: surface.sourceAspect,
        ...(view.textureViewUv ? {
          textureViewUv: view.textureViewUv,
          logicalSourceAspect: view.logicalSourceAspect,
        } : {}),
      });
    } finally {
      blendMode(BLEND);
      pop();
    }
  }

  drawBufferedSurfaceTexture(texture, route = {}) {
    const renderer = this.renderer;
    const { surface = {}, mapped = {}, demand = {} } = route;
    const viewUv = route.surfacePresentationUvRect;
    if (mapped.direct && Number(surface.feather) <= 0 && !viewUv) {
      this.drawDirectSurfaceTexture(texture, route);
      return;
    }
    renderer.mappingRuntime.mapper.drawTexture(
      texture,
      mapped.mapperSurface,
      surface.projectionFit,
      surface.feather,
      {
        opacity: surfaceRouteOpacity(route),
        ...(viewUv ? {
          textureViewUv: viewUv,
          logicalSourceAspect: Math.max(
            0.0001,
            (Number(demand.surfaceSize?.width) || 1) /
              Math.max(1, Number(demand.surfaceSize?.height) || 1)
          ),
        } : {}),
      }
    );
  }

  drawLiveMonitorGuideNodes(route = {}) {
    const renderer = this.renderer;
    if (renderer.mode !== "live" || renderer.state?.ui?.workspace !== "live") return;
    if (String(renderer.state?.ui?.live?.previewSurfaceId || "__mapping__") !== "__mapping__") return;
    if (route.mapped?.direct !== true) return;
    // This is the actual routed render boundary. A CSS outline can only mark
    // the full p5 host canvas and is therefore wrong whenever the monitor is
    // letterboxed inside it.
    renderer.mappingRuntime.mapper.drawGuidePaths([[
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]], route.mapped.mapperSurface, { color: [84, 228, 212, 184], weight: 1 });
    this.drawSceneSurfaceGuideNode(route);
  }

  drawSceneSurfaceGuideNode(route = {}) {
    const renderer = this.renderer;
    // The guide belongs to the Scene Mapping monitor, not to its current source.
    // Overall can transition between Scenes and standalone Components; tying the
    // guide to component.type made it disappear for the Component endpoint.
    const corners = route.mapped?.mapperSurface?.corners;
    if (!Array.isArray(corners) || corners.length !== 4) return;
    const { logicalSize, sampleRect, sourceAspect } =
      liveSceneGuideContext(renderer.state?.render);
    const targetAspect = projectedQuadAspect(corners, sourceAspect);
    const selectedMapping = renderer.state?.mappings?.find((mapping) =>
      String(mapping.id) === String(renderer.state?.ui?.selectedMappingId || "")
    ) || renderer.state?.mappings?.[0] || null;
    const guideSurfaces = renderer.state?.livePreviewGuideSurfaces
      || renderer.state?.surfaces
      || selectedMapping?.surfaces
      || [];
    const visibleSurfaceIds = visibleSceneSurfaceIds(guideSurfaces);
    const { paths } = SceneSurfaceGuideNode.process({
      // Live's materialized route program is the authority here. It includes
      // output-backed Surfaces as well as authored projection Surfaces; the
      // Mapping model alone can omit those derived output routes and previously
      // left Overall preview showing only the Full surface rectangle.
      surfaces: guideSurfaces.filter((surface) =>
        visibleSurfaceIds.has(String(surface.id || ""))
      ),
      logicalSize,
      sampleRect,
      sourceAspect,
      targetAspect,
      projectionFit: route.surface?.projectionFit || "cover",
    });
    renderer.mappingRuntime.mapper.drawGuidePaths(paths, route.mapped.mapperSurface);
  }

  drawSurfaceRouteViewBatch(items = [], blend = "normal") {
    if (!items.length) return;
    push();
    try {
      applyBlendGlobal(blend);
      this.renderer.mappingRuntime.mapper.drawTextureBatch(items.map(({ view, route }) => ({
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
          ...(view.textureViewUv ? {
            textureViewUv: view.textureViewUv,
            logicalSourceAspect: view.logicalSourceAspect,
          } : {}),
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
    // A Scene Surface crop is a texture view, not a new raster. Sample it with
    // the same mapping shader used by projected surfaces so shared
    // framebuffers stay in the main GL context. p5.image's source-rectangle
    // path can ask Chromium to copy a sub-texture with a negative internal
    // offset after a WebGL source resize; it also duplicates the crop/fit
    // rules maintained by the mapper. This remains one direct shader draw and
    // introduces no surface buffer or readback.
    this.renderer.mappingRuntime.mapper.drawTexture(
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
        ...(view.textureViewUv ? {
          textureViewUv: view.textureViewUv,
          logicalSourceAspect: view.logicalSourceAspect,
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
    if (renderer.presentationRuntime.shouldUseThumbnailPreview()) {
      return this.drawSurfaceThumbnailRoute(target, surface, demand, compositeOpacity);
    }
    const componentTime = componentInstanceTime(
      component,
      renderer.frameRuntime.componentTimes.get(surface.componentId) || 0,
      surface.id,
    );
    if (route.rootTransformRegion?.empty === true) {
      target.clear();
      return;
    }
    const source = component
      ? renderer.componentRenderRuntime.render(
          component,
          componentTime,
          componentRequest,
        )
      : renderer.resourceRuntime.mainMix;
    target.push();
    applyBlend(target, "normal");
    target.tint(255, 255 * clamp01(compositeOpacity));
    if (route.rootTransformRegion) {
      drawTransformedRegion(
        target,
        source,
        route.rootTransformRegion,
        component?.transform,
      );
    } else {
      const sampleRect = scaledComponentSampleRect(demand?.sampleRect, demand?.logicalSize, source);
      drawTransformedSampleRect(
        target,
        source,
        sampleRect,
        component?.transform,
        surface.sourceFitActive ? surface.sourceFit : "stretch"
      );
    }
    target.noTint();
    target.blendMode(BLEND);
    target.pop();
    if (surface.finalShaderChain?.length) {
      const effectIdentity = this.transitionEffectPrefix ? `${this.transitionEffectPrefix}:${surface.id}` : surface.id;
      const effected = renderer.shaderEffectRuntime.renderChain(
        target,
        withShaderInstancePrefix(surface.finalShaderChain, effectIdentity),
        request,
        renderer.frameRuntime.visualTime,
      );
      drawBuffer(
        target,
        effected,
        0,
        0,
        target.width,
        target.height,
        renderer.renderTargetRuntime.isShaderBuffer(effected),
      );
    }
  }

  drawSurfaceThumbnailRoute(target, surface, demand = null, compositeOpacity = 1) {
    const renderer = this.renderer;
    const component = renderer.componentProgramRuntime.componentForId(surface.componentId);
    const thumbnail = renderer.thumbnailRuntime.getThumbnailImage(component);
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
        visible: standbyDiagnosticsVisible({
          mode: renderer.mode,
          debugPreview: renderer.state?.ui?.debugPreview,
        }),
        frame: renderer.frameRuntime.frameIndex,
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

function drawTransformedRegion(target, source, region = {}, transform = {}) {
  const value = normalizedContentTransform(transform);
  const fullSize = region.targetSize || { width: target.width, height: target.height };
  const viewport = region.targetViewport || {
    x: 0,
    y: 0,
    width: fullSize.width,
    height: fullSize.height,
  };
  const destinationRect = region.destinationRect || {};
  const placement = contentTransformCanvasPlacement(value, fullSize.width, fullSize.height);
  const scaleX = target.width / Math.max(1e-9, Number(viewport.width) || target.width);
  const scaleY = target.height / Math.max(1e-9, Number(viewport.height) || target.height);
  target.push();
  // A viewport ROI is a cropped backing store for the same full Surface
  // coordinate system. Move that full domain behind the cropped target before
  // applying the authored transform; never recenter the crop as a new canvas.
  target.scale(scaleX, scaleY);
  target.translate(-(Number(viewport.x) || 0), -(Number(viewport.y) || 0));
  target.translate(placement.centerX, placement.centerY);
  target.rotate(value.rotation);
  target.scale(value.scale);
  drawBuffer(
    target,
    source,
    destinationRect.x - fullSize.width * 0.5,
    destinationRect.y - fullSize.height * 0.5,
    destinationRect.width,
    destinationRect.height,
    source?.__vj1ShaderBuffer === true,
  );
  target.pop();
}

function disposeGraphicsMap(map) {
  for (const target of map.values()) target?.remove?.();
  map.clear();
}
