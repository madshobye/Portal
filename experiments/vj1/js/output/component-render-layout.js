import { VJ1 } from "../constants.js";
import { componentFrameMetrics } from "../domain/component-frame.js";
import { createRenderRequest, RECORDING_FRAME_DEMAND_SCALE } from "./render-geometry.js?v=adaptive-component-demand-29";

export function directFitRects(sourceWidth, sourceHeight, target = {}, fit = "stretch") {
  const sw = Math.max(1, Number(sourceWidth) || 1);
  const sh = Math.max(1, Number(sourceHeight) || 1);
  const destination = {
    x: Number(target.x) || 0,
    y: Number(target.y) || 0,
    width: Math.max(1, Number(target.width) || 1),
    height: Math.max(1, Number(target.height) || 1),
  };
  const source = { x: 0, y: 0, width: sw, height: sh };
  if (fit === "contain") {
    const scale = Math.min(destination.width / sw, destination.height / sh);
    const widthPx = sw * scale;
    const heightPx = sh * scale;
    destination.x += (destination.width - widthPx) * 0.5;
    destination.y += (destination.height - heightPx) * 0.5;
    destination.width = widthPx;
    destination.height = heightPx;
  } else if (fit === "cover") {
    const sourceAspect = sw / sh;
    const targetAspect = destination.width / destination.height;
    if (sourceAspect > targetAspect) {
      source.width = sh * targetAspect;
      source.x = (sw - source.width) * 0.5;
    } else {
      source.height = sw / targetAspect;
      source.y = (sh - source.height) * 0.5;
    }
  }
  return { source, destination };
}

export function rectToCorners(rect = {}) {
  const x = Number(rect.x) || 0;
  const y = Number(rect.y) || 0;
  const width = Math.max(1, Number(rect.width) || 1);
  const height = Math.max(1, Number(rect.height) || 1);
  return [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
}

export function cornersRect(corners = []) {
  if (!Array.isArray(corners) || corners.length !== 4) return null;
  const xs = corners.map((corner) => Number(corner?.x));
  const ys = corners.map((corner) => Number(corner?.y));
  if (![...xs, ...ys].every(Number.isFinite)) return null;
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(1, Math.max(...xs) - x), height: Math.max(1, Math.max(...ys) - y) };
}

export function applyBlendGlobal(blend = "normal") {
  if (!blend || blend === "normal") blendMode(BLEND);
  else if (blend === "add") blendMode(ADD);
  else if (blend === "screen") blendMode(SCREEN);
  else if (blend === "multiply") blendMode(MULTIPLY);
  else {
    const mode = globalThis[String(blend || "").toUpperCase()];
    blendMode(typeof mode !== "undefined" ? mode : BLEND);
  }
}

export function drawWebGLBuffer(pg, source, x, y, w, h) {
  pg.push();
  pg.translate(x, y + h);
  pg.scale(1, -1);
  pg.image(source, 0, 0, w, h);
  pg.pop();
}

export function canvasRectCorners(rect = {}) {
  return [
    { id: "nw", x: rect.x, y: rect.y },
    { id: "ne", x: rect.x + rect.width, y: rect.y },
    { id: "sw", x: rect.x, y: rect.y + rect.height },
    { id: "se", x: rect.x + rect.width, y: rect.y + rect.height },
  ];
}

export function distanceSquared(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function canvasFrameBorderHit(rect = {}, x = 0, y = 0, tolerance = 8) {
  const inset = Math.max(0, Number(tolerance) || 0);
  const left = Number(rect.x) || 0;
  const top = Number(rect.y) || 0;
  const right = left + Math.max(0, Number(rect.width) || 0);
  const bottom = top + Math.max(0, Number(rect.height) || 0);
  const withinX = x >= left - inset && x <= right + inset;
  const withinY = y >= top - inset && y <= bottom + inset;
  return (withinY && (Math.abs(x - left) <= inset || Math.abs(x - right) <= inset))
    || (withinX && (Math.abs(y - top) <= inset || Math.abs(y - bottom) <= inset));
}

export function moveCanvasFrameRect(rect, dx, dy, canvasWidth, canvasHeight) {
  return {
    ...rect,
    x: Math.round(Math.max(0, Math.min(canvasWidth - rect.width, rect.x + dx))),
    y: Math.round(Math.max(0, Math.min(canvasHeight - rect.height, rect.y + dy))),
  };
}

export function resizeCanvasFrameRect(rect, corner, dx, dy, canvasWidth, canvasHeight) {
  const minSize = 16;
  const east = corner.includes("e");
  const south = corner.includes("s");
  const anchorX = east ? rect.x : rect.x + rect.width;
  const anchorY = south ? rect.y : rect.y + rect.height;
  const draggedX = (east ? rect.x + rect.width : rect.x) + dx;
  const draggedY = (south ? rect.y + rect.height : rect.y) + dy;
  const cornerX = east
    ? Math.max(anchorX + minSize, Math.min(canvasWidth, draggedX))
    : Math.max(0, Math.min(anchorX - minSize, draggedX));
  const cornerY = south
    ? Math.max(anchorY + minSize, Math.min(canvasHeight, draggedY))
    : Math.max(0, Math.min(anchorY - minSize, draggedY));
  return {
    x: Math.round(east ? anchorX : cornerX),
    y: Math.round(south ? anchorY : cornerY),
    width: Math.round(Math.abs(cornerX - anchorX)),
    height: Math.round(Math.abs(cornerY - anchorY)),
  };
}

export function canvasComponentPlacementRect(canvas = {}, sourceMetrics = {}, target = {}, placement = null) {
  const canvasWidth = Math.max(1, Number(canvas.width) || VJ1.canvasWidth);
  const canvasHeight = Math.max(1, Number(canvas.height) || VJ1.canvasHeight);
  const targetWidth = Math.max(1, Number(target.width) || canvasWidth);
  const targetHeight = Math.max(1, Number(target.height) || canvasHeight);
  const placementScale = Number(placement?.scale);
  const hasRelativePlacement = Number.isFinite(placementScale) && placementScale > 0;
  const sourceWidth = Math.max(1, Number(sourceMetrics.baseWidth) || Number(sourceMetrics.width) || 1);
  const sourceHeight = Math.max(1, Number(sourceMetrics.baseHeight) || Number(sourceMetrics.height) || 1);
  const logicalWidth = placementScale * canvasWidth;
  const logicalHeight = logicalWidth * sourceHeight / sourceWidth;
  const width = Math.max(1, hasRelativePlacement
    ? logicalWidth * targetWidth / canvasWidth
    : sourceWidth * targetWidth / canvasWidth);
  const height = Math.max(1, hasRelativePlacement
    ? logicalHeight * targetHeight / canvasHeight
    : sourceHeight * targetHeight / canvasHeight);
  return {
    x: Math.round((targetWidth - width) * 0.5),
    y: Math.round((targetHeight - height) * 0.5),
    width: Math.round(width),
    height: Math.round(height),
  };
}

export function componentReferencePlacement(parent = {}, child = {}, render = {}, target = {}, placement = null) {
  const targetWidth = Math.max(1, Number(target.width) || 1);
  const targetHeight = Math.max(1, Number(target.height) || 1);
  if (parent.type !== "canvas") return { x: 0, y: 0, width: targetWidth, height: targetHeight };
  return canvasComponentPlacementRect(parent.canvas, componentFrameMetrics(render, child), target, placement);
}

export function fullTargetRect(target = {}) {
  return { x: 0, y: 0, width: Math.max(1, Number(target.width) || 1), height: Math.max(1, Number(target.height) || 1) };
}

export function componentReferenceRenderRequest(render = {}, component = {}, placement = {}, meta = {}) {
  const metrics = componentFrameMetrics(render, component);
  const demandScale = Math.max(
    Math.max(1, Number(placement.width) || 1) / metrics.baseWidth,
    Math.max(1, Number(placement.height) || 1) / metrics.baseHeight
  ) * Math.max(0.05, Number(metrics.resolutionScale) || 1);
  const limit = componentAdaptiveRasterLimit(metrics);
  const scale = Math.min(limit.width / metrics.baseWidth, limit.height / metrics.baseHeight, demandScale);
  return createRenderRequest("texture", {
    width: quantizedRenderDimension(metrics.baseWidth * scale, limit.width),
    height: quantizedRenderDimension(metrics.baseHeight * scale, limit.height),
  }, { ...meta, logicalWidth: metrics.baseWidth, logicalHeight: metrics.baseHeight, demandScale: scale });
}

export function componentPreviewRenderRequest(render = {}, component = {}, viewportWidth = 1, viewportHeight = 1, pixelScale = 1, meta = {}) {
  const metrics = componentFrameMetrics(render, component);
  const fitted = containedRect(viewportWidth, viewportHeight, metrics.baseWidth, metrics.baseHeight);
  return componentReferenceRenderRequest(render, component, {
    width: fitted.width * Math.max(0.05, Number(pixelScale) || 1),
    height: fitted.height * Math.max(0.05, Number(pixelScale) || 1),
  }, meta);
}

export function canvasPreviewRenderRequest(component = {}, viewportWidth = 1, viewportHeight = 1, meta = {}) {
  const canvas = component.canvas || {};
  const width = Math.max(1, Math.round(Number(canvas.width) || VJ1.canvasWidth));
  const height = Math.max(1, Math.round(Number(canvas.height) || VJ1.canvasHeight));
  const quality = ["auto", "low", "full"].includes(canvas.previewQuality) ? canvas.previewQuality : "auto";
  const resolutionScale = Math.max(0.5, Math.min(2, Number(component.resolutionScale) || 1));
  const fitScale = Math.min(Math.max(1, Number(viewportWidth) || 1) / width, Math.max(1, Number(viewportHeight) || 1) / height, 1);
  const scale = (quality === "full" ? 1 : quality === "low" ? fitScale * 0.5 : fitScale) * resolutionScale;
  return createRenderRequest("texture", {
    width: Math.max(1, Math.min(8192, Math.round(width * scale))),
    height: Math.max(1, Math.min(8192, Math.round(height * scale))),
  }, meta);
}

export function routeSourceLookupKey(componentId = "", outputFrameId = "") {
  return `${componentId}\u0000${outputFrameId || ""}`;
}

export function componentSourceView(render = {}, component = {}, surface = {}, recordingFrames = [], recordingFrameById = null) {
  const placementScale = Math.max(0.0001, Number(component?.transform?.scale) || 1);
  if (component.type === "canvas") {
    const logicalSize = {
      width: Math.max(1, Number(component.canvas?.width) || VJ1.canvasWidth),
      height: Math.max(1, Number(component.canvas?.height) || VJ1.canvasHeight),
    };
    const recordingFrame = typeof recordingFrameById?.get === "function"
      ? recordingFrameById.get(surface.outputFrameId)
      : recordingFrames.find((item) => item.id === surface.outputFrameId);
    return {
      logicalSize,
      sampleRect: recordingFrame || { x: 0, y: 0, width: logicalSize.width, height: logicalSize.height },
      maxRasterSize: canvasMaxRasterSize(render, logicalSize, component.resolutionScale),
      samplingScale: Math.max(0.5, Math.min(2, Number(component.resolutionScale) || 1)) * (recordingFrame
        ? Math.max(0.5, Math.min(2, Number(render.sampling?.recordingFrameScale) || RECORDING_FRAME_DEMAND_SCALE))
        : 1) * placementScale,
    };
  }
  const metrics = componentFrameMetrics(render, component);
  const logicalSize = { width: metrics.baseWidth, height: metrics.baseHeight };
  return {
    logicalSize,
    sampleRect: { x: 0, y: 0, width: logicalSize.width, height: logicalSize.height },
    maxRasterSize: componentAdaptiveRasterLimit(logicalSize),
    samplingScale: Math.max(0.05, Number(metrics.resolutionScale) || 1) * placementScale,
  };
}

export function componentAdaptiveRasterLimit(logicalSize = {}) {
  const width = Math.max(1, Number(logicalSize.baseWidth ?? logicalSize.width) || 1);
  const height = Math.max(1, Number(logicalSize.baseHeight ?? logicalSize.height) || 1);
  const scale = Math.min(8192 / width, 8192 / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function canvasMaxRasterSize(render = {}, logicalSize = {}, resolutionScale = 1) {
  const width = Math.max(1, Number(logicalSize.width) || VJ1.canvasWidth);
  const height = Math.max(1, Number(logicalSize.height) || VJ1.canvasHeight);
  const componentScale = Math.max(0.5, Math.min(2, Number(resolutionScale) || 1));
  const limitToLogicalSize = render.sampling?.limitCanvasToLogicalSize !== false;
  const density = Math.max(0.5, Math.min(2, Number(render.pixelDensity) || 1));
  const frameScale = Math.max(0.5, Math.min(2, Number(render.sampling?.recordingFrameScale) || RECORDING_FRAME_DEMAND_SCALE));
  const scale = (limitToLogicalSize ? 1 : Math.max(1, frameScale, density)) * componentScale;
  return { width: Math.min(8192, Math.max(1, Math.round(width * scale))), height: Math.min(8192, Math.max(1, Math.round(height * scale))) };
}

export function scaledComponentSampleRect(sampleRect = {}, logicalSize = {}, source = {}) {
  const logicalWidth = Math.max(1, Number(logicalSize?.width) || Number(source?.width) || 1);
  const logicalHeight = Math.max(1, Number(logicalSize?.height) || Number(source?.height) || 1);
  const sourceWidth = Math.max(1, Number(source?.width) || logicalWidth);
  const sourceHeight = Math.max(1, Number(source?.height) || logicalHeight);
  return {
    x: (Math.max(0, Number(sampleRect?.x) || 0) / logicalWidth) * sourceWidth,
    y: (Math.max(0, Number(sampleRect?.y) || 0) / logicalHeight) * sourceHeight,
    width: (Math.max(1, Number(sampleRect?.width) || logicalWidth) / logicalWidth) * sourceWidth,
    height: (Math.max(1, Number(sampleRect?.height) || logicalHeight) / logicalHeight) * sourceHeight,
  };
}

export function sharedComponentRenderRequests(routes = [], renderIdentityPrefix = "") {
  const planned = new Map();
  for (const route of routes) {
    const id = componentRenderInstanceKey(route?.component, route?.surface?.id);
    if (!id || !route?.sourceView || !route?.demand) continue;
    const previous = planned.get(id);
    if (!previous || route.demand.rasterScale > previous.scale) planned.set(id, { route, scale: route.demand.rasterScale });
  }
  return new Map(Array.from(planned, ([id, { route, scale }]) => {
    const logical = route.sourceView.logicalSize;
    const maximum = route.sourceView.maxRasterSize;
    return [id, createRenderRequest("texture", {
      width: quantizedRenderDimension(logical.width * scale, maximum.width),
      height: quantizedRenderDimension(logical.height * scale, maximum.height),
    }, {
      timingId: id,
      renderIdentity: `${renderIdentityPrefix}${id}`,
      logicalWidth: logical.width,
      logicalHeight: logical.height,
      demandScale: scale,
    })];
  }));
}

export function componentRenderInstanceKey(component = {}, instanceId = "") {
  const componentId = String(component?.id || "");
  if (!componentId || component?.syncInstances !== false) return componentId;
  const placementId = String(instanceId || "default");
  return `${componentId}:instance:${placementId}`;
}

function containedRect(containerWidth, containerHeight, contentWidth, contentHeight) {
  const width = Math.max(1, Number(containerWidth) || 1);
  const height = Math.max(1, Number(containerHeight) || 1);
  const contentW = Math.max(1, Number(contentWidth) || 1);
  const contentH = Math.max(1, Number(contentHeight) || 1);
  const scale = Math.min(width / contentW, height / contentH);
  return { width: contentW * scale, height: contentH * scale };
}

function quantizedRenderDimension(value, maximum) {
  const upper = Math.max(1, Math.round(Number(maximum) || 1));
  const next = Math.min(upper, Math.max(1, Math.round(Number(value) || 1)));
  if (next < 16) return next;
  return Math.min(upper, Math.max(16, Math.round(next / 16) * 16));
}

export function resolutionScaledStrokeWidth(strokeWidth, request = {}, backingSize = null) {
  const width = Math.max(0, Number(strokeWidth) || 0);
  if (width <= 0) return 0;
  const logicalWidth = Math.max(1, Number(request.logicalWidth) || Number(request.width) || 1);
  const logicalHeight = Math.max(1, Number(request.logicalHeight) || Number(request.height) || 1);
  const rasterWidth = Math.max(1, Number(backingSize?.width) || Number(request.width) || logicalWidth);
  const rasterHeight = Math.max(1, Number(backingSize?.height) || Number(request.height) || logicalHeight);
  const rasterScale = Math.max(0.01, Math.min(rasterWidth / logicalWidth, rasterHeight / logicalHeight));
  return Math.max(0.125, width * rasterScale);
}
