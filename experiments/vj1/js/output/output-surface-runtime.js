import { clamp01 } from "../domain/models.js?v=chain-only-authority-1";
import { componentInstanceTime } from "./render-runtime-math.js?v=render-coordinate-scope-3";
import { contentTransformCanvasPlacement, isIdentityTransform, normalizedContentTransform } from "./content-coordinate-space.js?v=gc-allocation-1";
import { applyBlend } from "./blend-utils.js";
import { drawStandby } from "./generators.js?v=standby-grace-1";
import {
  applyBlendGlobal,
  cornersRect,
  directFitRects,
  scaledComponentSampleRect,
} from "./component-render-layout.js?v=canvas-global-resolution-1";
import { drawBuffer, drawSampleRect, withShaderInstancePrefix } from "./render-draw-utils.js?v=render-diagnostics-1";
import { planSurfaceRoutes, stableSurfaceRenderRequest } from "./surface-render-planner.js?v=surface-runtime-extraction-1";
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
    this.surfaceTextures = new Map();
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
    disposeGraphicsMap(this.surfaceTextures);
    disposeGraphicsMap(this.transitionSurfaceTextures);
    this.activeTransitionTextureId = "";
    this.renderIdentityPrefix = "";
    this.transitionEffectPrefix = "";
  }

  renderSurfaces() {
    const transition = this.currentLiveTransition();
    if (transition) return this.renderTransitionSurfaces(transition);
    this.releaseTransitionSurfaceTextures();
    this.renderSingleSceneSurfaces();
  }

  renderSingleSceneSurfaces() {
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
          renderer.measureGpu(drawingContext, () => this.drawSurfaceRouteView(view, route));
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
      this.withSurfaceRenderIdentityPrefix(componentsShared ? "" : "transition-from:", () => this.buildSurfaceRenderPlan())
    );
    const toRoutes = this.withSurfaceRenderIdentityPrefix(
      componentsShared ? "" : "transition-to:",
      () => this.buildSurfaceRenderPlan()
    );
    const fromTextures = this.renderTransitionRouteTextures(fromRoutes, transition.fromState, "from");
    const toTextures = this.renderTransitionRouteTextures(toRoutes, targetState, "to");
    const fromBySurface = new Map(fromRoutes.map((route) => [route.surface.id, route]));
    const toBySurface = new Map(toRoutes.map((route) => [route.surface.id, route]));
    const surfaceIds = [];
    for (const surface of targetState.surfaces || []) {
      if ((fromBySurface.has(surface.id) || toBySurface.has(surface.id)) && !surfaceIds.includes(surface.id)) surfaceIds.push(surface.id);
    }
    for (const route of fromRoutes) if (!surfaceIds.includes(route.surface.id)) surfaceIds.push(route.surface.id);
    for (const surfaceId of surfaceIds) {
      const fromRoute = fromBySurface.get(surfaceId);
      const toRoute = toBySurface.get(surfaceId);
      const route = toRoute || fromRoute;
      const mapped = route?.mapped;
      if (!mapped?.mapperSurface) continue;
      const fromTexture = fromTextures.get(surfaceId) || this.getTransparentTransitionTexture("from", surfaceId, toRoute?.surfaceRequest);
      const toTexture = toTextures.get(surfaceId) || this.getTransparentTransitionTexture("to", surfaceId, fromRoute?.surfaceRequest);
      if (!fromTexture || !toTexture) continue;
      const feather = toRoute?.surface?.feather ?? fromRoute?.surface?.feather ?? 0;
      renderer.measureGpu(drawingContext, () => {
        push();
        try {
          applyBlendGlobal(surfaceRouteBlend(route));
          renderer.mapper.drawTransitionTextures(fromTexture, toTexture, mapped.mapperSurface, {
            fromProjectionFit: fromRoute?.surface?.projectionFit || (mapped.direct ? "contain" : "cover"),
            toProjectionFit: toRoute?.surface?.projectionFit || (mapped.direct ? "contain" : "cover"),
            feather,
            progress: transition.progress,
          });
        } finally {
          blendMode(BLEND);
          pop();
        }
      });
    }
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
      recordingFrameById: renderer.recordingFrameById,
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
      renderer.recordingFrameById = previous.recordingFrameById;
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

  buildSurfaceRenderPlan() {
    const renderer = this.renderer;
    const { routes, metrics } = planSurfaceRoutes({
      state: renderer.state,
      mapperSurfaces: renderer.mapperSurfaces,
      componentById: renderer.componentById,
      recordingFrameById: renderer.recordingFrameById,
      viewport: renderer.displayCanvasSize(renderer.state?.render || {}),
      pixelScale: renderer.renderPixelDensity(renderer.state?.render || {}),
      renderIdentityPrefix: this.renderIdentityPrefix,
      resolveRouteSourceNode: (surface) => renderer.resolveRouteSourceNode(surface),
    });
    renderer.frameProfile.surfaceRouteCandidates += metrics.candidates;
    renderer.frameProfile.surfaceRoutesCulled += metrics.culled;
    renderer.frameProfile.surfaceRoutesVisible += metrics.visible;
    renderer.frameProfile.componentRasterPixels += metrics.componentRasterPixels;
    return routes;
  }

  getSurfaceTexture(request = stableSurfaceRenderRequest(this.renderer.state?.render || {})) {
    const widthPx = Math.max(1, Math.round(Number(request.width) || 1));
    const heightPx = Math.max(1, Math.round(Number(request.height) || 1));
    const key = `${widthPx}x${heightPx}`;
    let target = this.surfaceTextures.get(key);
    if (!target) {
      target = createSharedFramebufferTarget(widthPx, heightPx) || createGraphics(widthPx, heightPx);
      if (!isSharedFramebufferTarget(target)) {
        this.renderer.applyGraphicsPixelDensity(target, this.renderer.requestPixelDensity(request));
        this.renderer.applyGraphicsFont(target);
      }
      this.surfaceTextures.set(key, target);
    }
    return target;
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
      else renderer.mapper.drawTexture(view.texture, mapped.mapperSurface, surface.projectionFit, surface.feather, { sourceRect: view.sourceRect, opacity });
    } finally {
      blendMode(BLEND);
      pop();
    }
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
        options: { sourceRect: view.sourceRect, opacity: surfaceRouteOpacity(route) },
      })));
    } finally {
      blendMode(BLEND);
      pop();
    }
  }

  drawDirectSurfaceView(view, route = {}, opacity = 1) {
    const rect = route.mapped?.directRect || cornersRect(route.mapped?.mapperSurface?.corners || []);
    const sourceRect = view?.sourceRect;
    const texture = view?.texture;
    if (!texture || !sourceRect || !rect || opacity <= 0) return;
    const fit = directFitRects(sourceRect.width, sourceRect.height, rect, route.surface?.projectionFit || "contain");
    const drawable = isSharedFramebufferTarget(texture) ? unwrapRenderTarget(texture) : texture;
    resetShader();
    imageMode(CORNER);
    tint(255, 255 * opacity);
    image(drawable,
      fit.destination.x - width * 0.5, fit.destination.y - height * 0.5,
      fit.destination.width, fit.destination.height,
      sourceRect.x + fit.source.x, sourceRect.y + fit.source.y,
      fit.source.width, fit.source.height);
    noTint();
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
    drawTransformedSampleRect(target, source, sampleRect, component?.transform);
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
      drawTransformedSampleRect(target, thumbnail.img, sampleRect, component?.transform);
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

function drawTransformedSampleRect(target, source, sampleRect, transform = {}) {
  const value = normalizedContentTransform(transform);
  const placement = contentTransformCanvasPlacement(value, target.width, target.height);
  target.push();
  target.translate(placement.centerX, placement.centerY);
  target.rotate(value.rotation);
  target.scale(value.scale);
  drawSampleRect(target, source, sampleRect, -target.width * 0.5, -target.height * 0.5, target.width, target.height);
  target.pop();
}

function disposeGraphicsMap(map) {
  for (const target of map.values()) target?.remove?.();
  map.clear();
}
