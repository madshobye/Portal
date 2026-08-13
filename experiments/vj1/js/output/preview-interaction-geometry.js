import { getEffectNodeComponent as getShaderComponent } from "../libraries/visual-nodes/index.js";
import {
  combineContentTransforms,
  contentTransformCanvasPlacement,
  isIdentityTransform,
  localContentDragDelta,
  normalizedContentTransform,
} from "./content-coordinate-space.js";

export { combineContentTransforms, isIdentityTransform, normalizedContentTransform } from "./content-coordinate-space.js";

export function findChainItemById(chain = [], id = "") {
  if (!Array.isArray(chain) || !id) return null;
  for (const item of chain) {
    if (item.id === id) return item;
    const nested = item.kind === "group" ? findChainItemById(item.chain, id) : null;
    if (nested) return nested;
  }
  return null;
}

export function findChainItemTransformContext(chain = [], id = "", parentTransform = normalizedContentTransform()) {
  if (!Array.isArray(chain) || !id) return null;
  for (const item of chain) {
    const localTransform = normalizedContentTransform(item?.transform);
    const transform = combineContentTransforms(parentTransform, localTransform);
    if (item?.id === id) return { item, parentTransform, transform };
    if (item?.kind === "group") {
      const nested = findChainItemTransformContext(item.chain, id, transform);
      if (nested) return nested;
    }
  }
  return null;
}

export function isPhysicalChainItem(
  item = {},
  effectComponentForId = getShaderComponent,
) {
  if (item.kind === "source") return item.source?.type !== "black";
  if (item.kind !== "effect") return false;
  const component = effectComponentForId?.(item.componentId);
  return component?.spatial === true || component?.boundaryEditable === true;
}

export function hitTestChainItems({
  chain = [],
  component = {},
  frame = {},
  x = 0,
  y = 0,
  parentTransform = normalizedContentTransform(),
  ownerGroup = null,
  baseRectForItem = () => ({ x: 0, y: 0, width: frame.width, height: frame.height }),
  containsItem = null,
  effectComponentForId = getShaderComponent,
} = {}) {
  for (let index = chain.length - 1; index >= 0; index--) {
    const item = chain[index];
    if (!item || item.enabled === false || clamp01(item.opacity ?? 1) <= 0.001) continue;
    const transform = combineContentTransforms(parentTransform, item.transform);
    if (item.kind === "group") {
      const nested = hitTestChainItems({
        chain: item.chain || [],
        component,
        frame,
        x,
        y,
        parentTransform: transform,
        ownerGroup: ownerGroup || item,
        baseRectForItem,
        containsItem,
        effectComponentForId,
      });
      if (nested) return nested;
      continue;
    }
    if (!isPhysicalChainItem(item, effectComponentForId)) continue;
    const baseRect = baseRectForItem(component, item, frame);
    const contains = typeof containsItem === "function"
      ? containsItem(component, item, frame, x, y)
      : pointInTransformedRect(x, y, frame, baseRect, transform);
    if (contains) return ownerGroup || item;
  }
  return null;
}

export function groupLocalBounds({
  group = {},
  component = {},
  frame = {},
  baseRectForItem = () => ({ x: 0, y: 0, width: frame.width, height: frame.height }),
  effectComponentForId = getShaderComponent,
} = {}) {
  const localFrame = {
    x: 0,
    y: 0,
    width: Math.max(1, Number(frame.width) || 1),
    height: Math.max(1, Number(frame.height) || 1),
  };
  const bounds = [];
  for (const item of group.chain || []) {
    if (!item || item.enabled === false || clamp01(item.opacity ?? 1) <= 0.001) continue;
    if (item.kind === "group") {
      const nested = groupLocalBounds({
        group: item,
        component,
        frame: localFrame,
        baseRectForItem,
        effectComponentForId,
      });
      if (nested) bounds.push(transformedRectBounds(localFrame, nested, item.transform));
      continue;
    }
    if (!isPhysicalChainItem(item, effectComponentForId)) continue;
    const baseRect = baseRectForItem(component, item, localFrame);
    if (baseRect) bounds.push(transformedRectBounds(localFrame, baseRect, item.transform));
  }
  return unionRects(bounds);
}

export function pointInTransformedRect(x, y, frame = {}, baseRect = {}, transform = {}) {
  const value = normalizedContentTransform(transform);
  const placement = contentTransformCanvasPlacement(value, frame.width, frame.height);
  const frameCenterX = (Number(frame.x) || 0) + (Number(frame.width) || 0) * 0.5;
  const frameCenterY = (Number(frame.y) || 0) + (Number(frame.height) || 0) * 0.5;
  const translatedCenterX = (Number(frame.x) || 0) + placement.centerX;
  const translatedCenterY = (Number(frame.y) || 0) + placement.centerY;
  const local = screenToLayerLocal(x, y, translatedCenterX, translatedCenterY, value.rotation);
  const unscaledX = local.x / Math.max(0.01, value.scale) + frameCenterX;
  const unscaledY = local.y / Math.max(0.01, value.scale) + frameCenterY;
  const left = (Number(frame.x) || 0) + (Number(baseRect.x) || 0);
  const top = (Number(frame.y) || 0) + (Number(baseRect.y) || 0);
  return unscaledX >= left && unscaledX <= left + Math.max(1, Number(baseRect.width) || 1)
    && unscaledY >= top && unscaledY <= top + Math.max(1, Number(baseRect.height) || 1);
}

export function transformedRectCenter(frame = {}, baseRect = {}, transform = {}) {
  const value = normalizedContentTransform(transform);
  const placement = contentTransformCanvasPlacement(value, frame.width, frame.height);
  const frameCenterX = (Number(frame.x) || 0) + (Number(frame.width) || 0) * 0.5;
  const frameCenterY = (Number(frame.y) || 0) + (Number(frame.height) || 0) * 0.5;
  const baseCenterX = (Number(frame.x) || 0) + (Number(baseRect.x) || 0) + (Number(baseRect.width) || 0) * 0.5;
  const baseCenterY = (Number(frame.y) || 0) + (Number(baseRect.y) || 0) + (Number(baseRect.height) || 0) * 0.5;
  const offsetX = (baseCenterX - frameCenterX) * value.scale;
  const offsetY = (baseCenterY - frameCenterY) * value.scale;
  const cosine = Math.cos(value.rotation);
  const sine = Math.sin(value.rotation);
  return {
    x: (Number(frame.x) || 0) + placement.centerX + offsetX * cosine - offsetY * sine,
    y: (Number(frame.y) || 0) + placement.centerY + offsetX * sine + offsetY * cosine,
  };
}

export function transformedRectBounds(frame = {}, baseRect = {}, transform = {}) {
  const value = normalizedContentTransform(transform);
  const placement = contentTransformCanvasPlacement(value, frame.width, frame.height);
  const frameCenterX = (Number(frame.x) || 0) + (Number(frame.width) || 0) * 0.5;
  const frameCenterY = (Number(frame.y) || 0) + (Number(frame.height) || 0) * 0.5;
  const transformCenterX = (Number(frame.x) || 0) + placement.centerX;
  const transformCenterY = (Number(frame.y) || 0) + placement.centerY;
  const left = (Number(frame.x) || 0) + (Number(baseRect.x) || 0);
  const top = (Number(frame.y) || 0) + (Number(baseRect.y) || 0);
  const right = left + Math.max(1, Number(baseRect.width) || 1);
  const bottom = top + Math.max(1, Number(baseRect.height) || 1);
  const cosine = Math.cos(value.rotation);
  const sine = Math.sin(value.rotation);
  const corners = [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ].map(([x, y]) => {
    const dx = (x - frameCenterX) * value.scale;
    const dy = (y - frameCenterY) * value.scale;
    return {
      x: transformCenterX + dx * cosine - dy * sine,
      y: transformCenterY + dx * sine + dy * cosine,
    };
  });
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX - (Number(frame.x) || 0),
    y: minY - (Number(frame.y) || 0),
    width: Math.max(1, Math.max(...xs) - minX),
    height: Math.max(1, Math.max(...ys) - minY),
  };
}

// Return the smallest source-space rectangle that can contribute to a visible
// viewport. The result is conservative for rotated objects (the inverse of the
// clipped screen AABB), so it may render a few extra corner pixels but can
// never discard pixels that belong in the final composition.
export function transformedRectVisibleRegion(frame = {}, baseRect = {}, transform = {}, viewport = {}) {
  const bounds = transformedRectBounds(frame, baseRect, transform);
  const left = Math.max(Number(bounds.x) || 0, Number(viewport.x) || 0);
  const top = Math.max(Number(bounds.y) || 0, Number(viewport.y) || 0);
  const right = Math.min(
    (Number(bounds.x) || 0) + Math.max(0, Number(bounds.width) || 0),
    (Number(viewport.x) || 0) + Math.max(0, Number(viewport.width) || 0)
  );
  const bottom = Math.min(
    (Number(bounds.y) || 0) + Math.max(0, Number(bounds.height) || 0),
    (Number(viewport.y) || 0) + Math.max(0, Number(viewport.height) || 0)
  );
  if (right <= left || bottom <= top) return null;

  const value = normalizedContentTransform(transform);
  const transformPlacement = contentTransformCanvasPlacement(value, frame.width, frame.height);
  const frameX = Number(frame.x) || 0;
  const frameY = Number(frame.y) || 0;
  const frameCenterX = frameX + Math.max(1, Number(frame.width) || 1) * 0.5;
  const frameCenterY = frameY + Math.max(1, Number(frame.height) || 1) * 0.5;
  const transformCenterX = frameX + transformPlacement.centerX;
  const transformCenterY = frameY + transformPlacement.centerY;
  const cosine = Math.cos(-value.rotation);
  const sine = Math.sin(-value.rotation);
  const sourceLeft = frameX + (Number(baseRect.x) || 0);
  const sourceTop = frameY + (Number(baseRect.y) || 0);
  const sourceWidth = Math.max(1, Number(baseRect.width) || 1);
  const sourceHeight = Math.max(1, Number(baseRect.height) || 1);
  const sourcePoints = [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ].map(([x, y]) => {
    const dx = x - transformCenterX;
    const dy = y - transformCenterY;
    return {
      x: (dx * cosine - dy * sine) / value.scale + frameCenterX,
      y: (dx * sine + dy * cosine) / value.scale + frameCenterY,
    };
  });
  const u0 = clamp01(Math.min(...sourcePoints.map((point) => (point.x - sourceLeft) / sourceWidth)));
  const v0 = clamp01(Math.min(...sourcePoints.map((point) => (point.y - sourceTop) / sourceHeight)));
  const u1 = clamp01(Math.max(...sourcePoints.map((point) => (point.x - sourceLeft) / sourceWidth)));
  const v1 = clamp01(Math.max(...sourcePoints.map((point) => (point.y - sourceTop) / sourceHeight)));
  if (u1 <= u0 || v1 <= v0) return null;
  return {
    uvRect: [u0, v0, u1 - u0, v1 - v0],
    destinationRect: {
      x: (Number(baseRect.x) || 0) + u0 * sourceWidth,
      y: (Number(baseRect.y) || 0) + v0 * sourceHeight,
      width: (u1 - u0) * sourceWidth,
      height: (v1 - v0) * sourceHeight,
    },
    visibleBounds: { x: left, y: top, width: right - left, height: bottom - top },
  };
}

export function chainTransformDragScale(initialScale, startDistance, currentDistance) {
  const initial = Math.max(0.05, Number(initialScale) || 1);
  const ratio = Math.max(0.0001, Number(currentDistance) || 1) / Math.max(1, Number(startDistance) || 1);
  return Math.max(0.05, Math.min(8, initial * Math.sqrt(ratio)));
}

export function transformHandleLayout(baseRect = {}, scale = 1, handleOffset = 52) {
  const boxWidth = Math.max(1, (Number(baseRect.width) || 1) * Math.max(0.01, Number(scale) || 1));
  const boxHeight = Math.max(1, (Number(baseRect.height) || 1) * Math.max(0.01, Number(scale) || 1));
  const offset = Math.max(24, Number(handleOffset) || 52);
  return {
    boxWidth,
    boxHeight,
    // The transform controls are a compact cluster around the object's pivot:
    // move at center, scale to the right, and rotate above. Their offset is
    // supplied in CSS-scaled pixels so even a full-frame object is reachable.
    scaleHandleX: offset,
    scaleHandleY: 0,
    rotateHandleX: 0,
    rotateHandleY: -offset,
  };
}

export function logicalPixelsPerCssPixel(logicalWidth = 1, logicalHeight = 1, cssWidth = 1, cssHeight = 1) {
  const x = Math.max(1, Number(logicalWidth) || 1) / Math.max(1, Number(cssWidth) || 1);
  const y = Math.max(1, Number(logicalHeight) || 1) / Math.max(1, Number(cssHeight) || 1);
  return Math.max(0.25, Math.min(8, Math.max(x, y)));
}

export function canvasPointerToLogicalPoint(clientX = 0, clientY = 0, rect = {}, logicalSize = {}) {
  const cssWidth = Math.max(1, Number(rect.width) || 1);
  const cssHeight = Math.max(1, Number(rect.height) || 1);
  const logicalWidth = Math.max(1, Number(logicalSize.width) || cssWidth);
  const logicalHeight = Math.max(1, Number(logicalSize.height) || cssHeight);
  return {
    x: (Number(clientX) - (Number(rect.left) || 0)) * logicalWidth / cssWidth,
    y: (Number(clientY) - (Number(rect.top) || 0)) * logicalHeight / cssHeight,
  };
}

export function resolveChainTransformDrag(drag = {}, x = 0, y = 0) {
  const next = { ...normalizedContentTransform(drag.transform) };
  if (drag.mode === "move") {
    const delta = localContentDragDelta(
      x - drag.startX,
      y - drag.startY,
      drag.parentTransform,
      drag.frameWidth,
      drag.frameHeight
    );
    next.x = clamp01(drag.transform.x + delta.x);
    next.y = clamp01(drag.transform.y + delta.y);
  } else if (drag.mode === "scale") {
    const distance = Math.max(1, Math.hypot(x - drag.centerX, y - drag.centerY));
    next.scale = chainTransformDragScale(drag.transform.scale, drag.startDistance, distance);
  } else if (drag.mode === "rotate") {
    const angle = Math.atan2(y - drag.centerY, x - drag.centerX);
    next.rotation = drag.transform.rotation + angle - drag.startAngle;
  }
  return next;
}

export function screenToLayerLocal(x, y, cx, cy, rotation) {
  const dx = x - cx;
  const dy = y - cy;
  const cosine = Math.cos(-rotation);
  const sine = Math.sin(-rotation);
  return { x: dx * cosine - dy * sine, y: dx * sine + dy * cosine };
}

export function pointInOrientedRect(x, y, rect = {}) {
  const centerX = Number(rect.centerX) || ((Number(rect.x) || 0) + (Number(rect.width) || 0) * 0.5);
  const centerY = Number(rect.centerY) || ((Number(rect.y) || 0) + (Number(rect.height) || 0) * 0.5);
  const local = screenToLayerLocal(x, y, centerX, centerY, Number(rect.rotation) || 0);
  return Math.abs(local.x) <= Math.max(1, Number(rect.width) || 1) * 0.5
    && Math.abs(local.y) <= Math.max(1, Number(rect.height) || 1) * 0.5;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function unionRects(rects = []) {
  const valid = rects.filter((rect) => rect && Number(rect.width) > 0 && Number(rect.height) > 0);
  if (!valid.length) return null;
  const left = Math.min(...valid.map((rect) => Number(rect.x) || 0));
  const top = Math.min(...valid.map((rect) => Number(rect.y) || 0));
  const right = Math.max(...valid.map((rect) => (Number(rect.x) || 0) + Number(rect.width)));
  const bottom = Math.max(...valid.map((rect) => (Number(rect.y) || 0) + Number(rect.height)));
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}
