import { fitTargetUvToSourceUv } from "../libraries/render-engine/fit-geometry/index.js";
import { VISUAL_HIT_REGION_MODES } from "../libraries/render-engine/visual-node-contract.js";
import { contentTransformCanvasPlacement } from "./content-coordinate-space.js";

const COVERAGE_PLACEMENT = "__vj1PreviewCoveragePlacement";
const IDENTITY_AFFINE = Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

// Editor-only coverage index. Renderers register the isolated image they
// already produced for a source; pointer-down may then inspect one small alpha
// block. There is no pick render pass, persistent mask, or frame-time readback.
export class PreviewHitCoverage {
  constructor(host) {
    this.host = host;
    this.records = new Map();
    this.activeComponentId = "";
    this.unreadableTextures = new WeakSet();
    this.scratchCanvas = null;
  }

  dispose() {
    this.records.clear();
    this.activeComponentId = "";
    this.unreadableTextures = new WeakSet();
    this.scratchCanvas = null;
  }

  prepareRootRequest(component, request) {
    if (!this.captures(component, request)) return request;
    const componentId = String(component?.id || "");
    if (componentId !== this.activeComponentId) {
      this.records.clear();
      this.activeComponentId = componentId;
    }
    request[COVERAGE_PLACEMENT] = {
      matrix: { ...IDENTITY_AFFINE },
      rootWidth: positiveSize(request.width),
      rootHeight: positiveSize(request.height),
    };
    return request;
  }

  invalidateStructure() {
    this.records.clear();
  }

  prepareRegionRequest(component, parentRequest, regionRequest) {
    if (!this.captures(component, parentRequest) || !regionRequest?.roi) {
      return regionRequest;
    }
    const parent = coveragePlacement(parentRequest);
    regionRequest[COVERAGE_PLACEMENT] = {
      matrix: composeAffine(
        parent.matrix,
        regionToParentAffine(
          regionRequest.roi,
          regionRequest.width,
          regionRequest.height,
        ),
      ),
      rootWidth: parent.rootWidth,
      rootHeight: parent.rootHeight,
    };
    return regionRequest;
  }

  recordRaster(
    component,
    renderedItem,
    layerState,
    request,
    roi = null,
    hitRegion = VISUAL_HIT_REGION_MODES.RENDERED_ALPHA,
  ) {
    const texture = layerState?.buffer;
    if (!this.captures(component, request)) return;
    const itemId = String(renderedItem?.id || "");
    if (!itemId) return;
    if (hitRegion === VISUAL_HIT_REGION_MODES.NONE) {
      this.records.set(coverageKey(component.id, itemId), {
        kind: "none",
        componentId: component.id,
        itemId,
      });
      return;
    }
    if (hitRegion === VISUAL_HIT_REGION_MODES.BOUNDARY) {
      this.records.set(coverageKey(component.id, itemId), {
        kind: "boundary",
        componentId: component.id,
        itemId,
      });
      return;
    }
    if (!texture) return;
    const placement = coveragePlacement(request);
    const bufferToCurrent = roi
      ? regionToParentAffine(roi, texture.width, texture.height)
      : scaleAffine(
          positiveSize(request.width) / positiveSize(texture.width),
          positiveSize(request.height) / positiveSize(texture.height),
        );
    this.records.set(coverageKey(component.id, itemId), {
      kind: "raster",
      componentId: component.id,
      itemId,
      texture,
      bufferToRoot: composeAffine(placement.matrix, bufferToCurrent),
      rootWidth: placement.rootWidth,
      rootHeight: placement.rootHeight,
    });
  }

  recordPlaced(
    component,
    renderedItem,
    placed,
    request,
    hitRegion = VISUAL_HIT_REGION_MODES.RENDERED_ALPHA,
  ) {
    if (!this.captures(component, request)) return;
    const itemId = String(renderedItem?.id || "");
    if (!itemId) return;
    if (hitRegion === VISUAL_HIT_REGION_MODES.NONE) {
      this.records.set(coverageKey(component.id, itemId), {
        kind: "none",
        componentId: component.id,
        itemId,
      });
      return;
    }
    if (hitRegion === VISUAL_HIT_REGION_MODES.BOUNDARY) {
      this.records.set(coverageKey(component.id, itemId), {
        kind: "boundary",
        componentId: component.id,
        itemId,
      });
      return;
    }
    if (!placed?.texture) return;
    const placement = coveragePlacement(request);
    this.records.set(coverageKey(component.id, itemId), {
      kind: "placed",
      componentId: component.id,
      itemId,
      placed,
      currentToRoot: placement.matrix,
      currentWidth: positiveSize(request.width),
      currentHeight: positiveSize(request.height),
      rootWidth: placement.rootWidth,
      rootHeight: placement.rootHeight,
    });
  }

  contains(component, item, frame, x, y, radius = 0) {
    const record = this.records.get(coverageKey(component?.id, item?.id));
    if (!record || !frame?.width || !frame?.height) {
      return null;
    }
    if (record.kind === "none") return false;
    if (record.kind === "boundary") return true;
    const rootPoint = {
      x: (Number(x) - Number(frame.x || 0)) * record.rootWidth / positiveSize(frame.width),
      y: (Number(y) - Number(frame.y || 0)) * record.rootHeight / positiveSize(frame.height),
    };
    const rootRadius = {
      x: Math.max(0, Number(radius) || 0) * record.rootWidth / positiveSize(frame.width),
      y: Math.max(0, Number(radius) || 0) * record.rootHeight / positiveSize(frame.height),
    };
    const sampleRect = record.kind === "placed"
      ? placedSampleRect(record, rootPoint, rootRadius)
      : rasterSampleRect(record, rootPoint, rootRadius);
    if (!sampleRect) return false;
    return this.readAlpha(record.kind === "placed" ? record.placed.texture : record.texture, sampleRect);
  }

  captures(component, request) {
    return this.host?.mode === "component" &&
      request?.reason === "component-preview" &&
      String(component?.id || "") ===
        String(this.host?.state?.ui?.selectedComponentId || "");
  }

  readAlpha(texture, rect) {
    const bounds = textureDimensions(texture);
    const clipped = integerSampleRect(rect, bounds);
    if (!clipped) return false;
    try {
      const pixels = texturePixels(texture, clipped, () => this.canvas());
      if (!pixels) return null;
      for (let index = 3; index < pixels.length; index += 4) {
        // Only fully transparent coverage clicks through. One nonzero alpha
        // sample is enough, so translucent content and thin wires remain easy
        // to select.
        if (pixels[index] > 0) return true;
      }
      return false;
    } catch (error) {
      if (
        texture &&
        (typeof texture === "object" || typeof texture === "function") &&
        !this.unreadableTextures.has(texture)
      ) {
        this.unreadableTextures.add(texture);
        console.warn("[VJ1_PREVIEW_ALPHA_PICK_UNAVAILABLE]", {
          message: error?.message || String(error || "pixel read failed"),
        });
      }
      return null;
    }
  }

  canvas() {
    if (this.scratchCanvas) return this.scratchCanvas;
    if (typeof OffscreenCanvas === "function") {
      this.scratchCanvas = new OffscreenCanvas(1, 1);
    } else if (globalThis.document?.createElement) {
      this.scratchCanvas = document.createElement("canvas");
    }
    return this.scratchCanvas;
  }
}

export function rasterSampleRect(record, rootPoint, rootRadius) {
  const inverse = invertAffine(record?.bufferToRoot);
  if (!inverse) return null;
  return mappedNeighborhoodRect(
    inverse,
    rootPoint,
    rootRadius,
  );
}

export function placedSampleRect(record, rootPoint, rootRadius) {
  const rootToCurrent = invertAffine(record?.currentToRoot);
  if (!rootToCurrent) return null;
  const points = neighborhoodPoints(rootPoint, rootRadius)
    .map((point) => applyAffine(rootToCurrent, point))
    .map((point) => placedPointToSource(record, point))
    .filter(Boolean);
  return points.length ? pointsBounds(points) : null;
}

export function regionToParentAffine(roi = {}, bufferWidth = 1, bufferHeight = 1) {
  const rotation = Number(roi.rotation) || 0;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const scaleX = positiveSize(roi.width) / positiveSize(bufferWidth);
  const scaleY = positiveSize(roi.height) / positiveSize(bufferHeight);
  const left = -positiveSize(roi.boundaryWidth) * 0.5 + (Number(roi.sampleX) || 0);
  const top = -positiveSize(roi.boundaryHeight) * 0.5 + (Number(roi.sampleY) || 0);
  return {
    a: cosine * scaleX,
    b: sine * scaleX,
    c: -sine * scaleY,
    d: cosine * scaleY,
    e: (Number(roi.centerX) || 0) + cosine * left - sine * top,
    f: (Number(roi.centerY) || 0) + sine * left + cosine * top,
  };
}

export function composeAffine(outer = IDENTITY_AFFINE, inner = IDENTITY_AFFINE) {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

export function invertAffine(matrix = IDENTITY_AFFINE) {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
  return {
    a: matrix.d / determinant,
    b: -matrix.b / determinant,
    c: -matrix.c / determinant,
    d: matrix.a / determinant,
    e: (matrix.c * matrix.f - matrix.d * matrix.e) / determinant,
    f: (matrix.b * matrix.e - matrix.a * matrix.f) / determinant,
  };
}

function coveragePlacement(request = {}) {
  return request[COVERAGE_PLACEMENT] || {
    matrix: { ...IDENTITY_AFFINE },
    rootWidth: positiveSize(request.width),
    rootHeight: positiveSize(request.height),
  };
}

function scaleAffine(x, y) {
  return { a: x, b: 0, c: 0, d: y, e: 0, f: 0 };
}

function mappedNeighborhoodRect(matrix, point, radius) {
  return pointsBounds(
    neighborhoodPoints(point, radius).map((candidate) =>
      applyAffine(matrix, candidate)
    ),
  );
}

function neighborhoodPoints(point, radius) {
  const xs = radius.x > 0
    ? [point.x - radius.x, point.x, point.x + radius.x]
    : [point.x];
  const ys = radius.y > 0
    ? [point.y - radius.y, point.y, point.y + radius.y]
    : [point.y];
  return xs.flatMap((x) => ys.map((y) => ({ x, y })));
}

function pointsBounds(points) {
  if (!points?.length) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return {
    x: left,
    y: top,
    width: Math.max(1, Math.max(...xs) - left + 1),
    height: Math.max(1, Math.max(...ys) - top + 1),
  };
}

function placedPointToSource(record, point) {
  const placed = record.placed;
  const transform = placed.transform || {};
  const placement = contentTransformCanvasPlacement(
    transform,
    record.currentWidth,
    record.currentHeight,
  );
  const dx = point.x - placement.centerX;
  const dy = point.y - placement.centerY;
  const cosine = Math.cos(-placement.rotation);
  const sine = Math.sin(-placement.rotation);
  const scale = Math.max(0.0001, Number(placement.scale) || 1);
  const targetX = (dx * cosine - dy * sine) / scale + record.currentWidth * 0.5;
  const targetY = (dx * sine + dy * cosine) / scale + record.currentHeight * 0.5;
  const rect = placed.destinationRect;
  const targetUv = {
    x: (targetX - rect.x) / positiveSize(rect.width),
    y: (targetY - rect.y) / positiveSize(rect.height),
  };
  if (targetUv.x < 0 || targetUv.x > 1 || targetUv.y < 0 || targetUv.y > 1) {
    return null;
  }
  const sourceSize = textureDimensions(placed.texture);
  const sourceUv = fitTargetUvToSourceUv(
    targetUv,
    sourceSize.width / sourceSize.height,
    positiveSize(rect.width) / positiveSize(rect.height),
    placed.fit,
  );
  if (!sourceUv.inside) return null;
  return {
    x: sourceUv.x * sourceSize.width,
    y: sourceUv.y * sourceSize.height,
  };
}

function texturePixels(texture, rect, getCanvas) {
  if (typeof texture?.get === "function") {
    const sample = texture.get(rect.x, rect.y, rect.width, rect.height);
    sample?.loadPixels?.();
    if (sample?.pixels?.length) return sample.pixels;
    if (Array.isArray(sample) || ArrayBuffer.isView(sample)) return sample;
  }
  const source = texture?.elt || texture?.canvas || texture;
  const canvas = getCanvas();
  const context = canvas?.getContext?.("2d", { willReadFrequently: true });
  if (!source || !context) return null;
  canvas.width = rect.width;
  canvas.height = rect.height;
  context.clearRect(0, 0, rect.width, rect.height);
  context.drawImage(
    source,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    rect.width,
    rect.height,
  );
  return context.getImageData(0, 0, rect.width, rect.height).data;
}

function integerSampleRect(rect, bounds) {
  const left = Math.max(0, Math.floor(Number(rect.x) || 0));
  const top = Math.max(0, Math.floor(Number(rect.y) || 0));
  const right = Math.min(bounds.width, Math.ceil((Number(rect.x) || 0) + positiveSize(rect.width)));
  const bottom = Math.min(bounds.height, Math.ceil((Number(rect.y) || 0) + positiveSize(rect.height)));
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function textureDimensions(texture) {
  const source = texture?.elt || texture?.canvas || texture || {};
  return {
    width: positiveSize(
      source.videoWidth || source.naturalWidth || texture?.width || source.width,
    ),
    height: positiveSize(
      source.videoHeight || source.naturalHeight || texture?.height || source.height,
    ),
  };
}

function applyAffine(matrix, point) {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

function coverageKey(componentId, itemId) {
  return `${String(componentId || "")}/${String(itemId || "")}`;
}

function positiveSize(value) {
  return Math.max(1, Number(value) || 1);
}
